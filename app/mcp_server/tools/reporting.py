"""Reporting tools: statements, variance, actuals, assumptions and capex."""
from __future__ import annotations

import os
from typing import Annotated, Any, Dict, List, Literal, Optional

import anyio
from pydantic import Field
from mcp.server.mcpserver.exceptions import ToolError

from mcp_server.core import DESTRUCTIVE, READ, UPSERT, WRITE, as_table, call, mcp, require, strip_none, to_json_text
from mcp_server.tools._common import scenario_window
from mcp_server.tools.imports import resolve_path
from services import actuals as actuals_service

SECTIONS = ("income_statement", "cash_flow", "balance_sheet", "detail", "assumptions", "carry_forward", "warnings")
DETAIL_KEYS = (
    "revenue_by_product", "revenue_by_customer", "revenue_by_customer_type", "sales_deductions",
    "expenses_by_category", "payroll_by_department", "payroll_by_business_unit", "payroll_headcount",
    "payroll_employees", "loans", "capex_items",
)
ASSUMPTION_FIELDS = (
    "opening_period", "opening_cash", "opening_accounts_receivable", "opening_inventory", "opening_fixed_assets",
    "opening_accumulated_depreciation", "opening_fixed_assets_remaining_life_months", "opening_accounts_payable",
    "opening_other_liabilities", "opening_equity", "dso_days", "dio_days", "dpo_days", "income_tax_rate",
    "minimum_cash_balance", "excise_payable_days", "notes",
)
#: Assumptions that stay null when unset (the API keeps the stored value or plugs / defaults it).
NULLABLE_ASSUMPTIONS = ("opening_period", "opening_equity", "excise_payable_days", "notes")
CAPEX_FIELDS = (
    "asset_name", "category", "amount", "purchase_period", "useful_life_months", "salvage_value",
    "depreciation_method", "description", "is_active", "forecast_id",
)
#: Windows longer than this many months default to the compact statement view.
COMPACT_AFTER_MONTHS = 12
#: In the default (no sections) view a detail table with more entries than this (one per product, customer,
#: employee, ...) is left out and listed in detail_omitted, so the default stays small on a real catalog.
DEFAULT_DETAIL_MAX_ENTRIES = 15
#: A default view longer than this (characters) falls back to the compact view.
DEFAULT_VIEW_MAX_CHARS = 40_000

Window = Annotated[str, Field(description="YYYY-MM")]
OptionalWindow = Annotated[Optional[str], Field(description="YYYY-MM; default: the scenarios' sales window")]


def _months(start: str, end: str) -> int:
    try:
        (y1, m1), (y2, m2) = (map(int, start.split("-")[:2]), map(int, end.split("-")[:2]))
        return (y2 - y1) * 12 + (m2 - m1) + 1
    except ValueError:
        return 0


def _apply_layout(out: Dict[str, Any], layout: str) -> Dict[str, Any]:
    """by_period lists as {columns, rows} tables (layout='table')."""
    if layout != "table":
        return out
    for stmt in ("income_statement", "cash_flow", "balance_sheet"):
        section = out.get(stmt)
        if isinstance(section, dict) and isinstance(section.get("by_period"), list):
            out[stmt] = {**section, "by_period": as_table(section["by_period"])}
    return out


def _headline(body: Dict[str, Any]) -> Dict[str, Any]:
    """Totals that answer "what changed" whatever sections were asked for."""
    out: Dict[str, Any] = {}
    if isinstance(body.get("income_statement"), dict):
        out["income_statement_totals"] = body["income_statement"].get("totals")
    if isinstance(body.get("cash_flow"), dict):
        out["cash_flow_totals"] = body["cash_flow"].get("totals")
    if isinstance(body.get("balance_sheet"), dict):
        out["balance_sheet_closing"] = body["balance_sheet"].get("closing")
    return out


def _entries(table: Any) -> int:
    return len(table) if isinstance(table, (list, dict)) else 0


@mcp.tool(name="forecast_financial_statements", annotations=READ)
async def financial_statements(
    forecast_ids: Annotated[List[str], Field(description="Scenario ids to include (usually one); an unknown id is an error", min_length=1)],
    start_period: OptionalWindow = None,
    end_period: OptionalWindow = None,
    include_raises: Annotated[bool, Field(description="Apply scheduled payroll raises")] = True,
    sections: Annotated[Optional[List[str]], Field(description=(
        f"Subset of {', '.join(SECTIONS)}, or one detail table as 'detail.<name>' ({', '.join(DETAIL_KEYS)}). "
        f"Omit for the statements plus the detail tables when the window is {COMPACT_AFTER_MONTHS} months or less "
        f"(a detail table with more than {DEFAULT_DETAIL_MAX_ENTRIES} entries, e.g. revenue_by_product on a real "
        f"catalog, is named in detail_omitted instead: ask for it as 'detail.<name>'), or for the compact view "
        f"(income statement by month + cash-flow totals + closing balance sheet + warnings) on longer windows. "
        f"Headline totals and warnings are always included."))] = None,
    layout: Annotated[Literal["table", "records"], Field(description=(
        "table: each statement's by_period is {columns, rows} with one array per month (default, ~40% smaller); "
        "records: one object per month"))] = "table",
) -> Dict[str, Any]:
    """Period-by-period income statement (gross sales, sales deductions, net
    sales = revenue, COGS, gross profit, opex, net income), cash flow and
    balance sheet for a window, built by the statements engine (the single
    source of truth for every reported number). Each statement has by_period
    rows and totals; detail holds revenue by product / customer / customer
    type, deductions, expenses by category, payroll by department, loans and
    capex. Use sections to keep the response small, e.g. ['income_statement']
    or ['detail.revenue_by_product']; a multi-year window defaults to the
    compact view. start_period / end_period default to the scenarios' sales
    window."""
    if not (start_period and end_period):
        start_period, end_period, _sales_window = await scenario_window(forecast_ids, start_period, end_period)
    body = await call("GET", "/reporting/statements", params={
        "forecast_ids": forecast_ids, "start_period": start_period, "end_period": end_period,
        "include_raises": include_raises,
    })
    requested = list(sections or [])
    top = [s for s in requested if not s.startswith("detail.")]
    details = [s.split(".", 1)[1] for s in requested if s.startswith("detail.")]
    bad = [s for s in top if s not in SECTIONS]
    if bad:
        raise ToolError(f"Unknown sections: {', '.join(bad)}. Choose from {', '.join(SECTIONS)} "
                        f"or detail.<name> ({', '.join(DETAIL_KEYS)})")
    detail_body = body.get("detail") or {}
    bad_detail = [d for d in details if d not in detail_body]
    if bad_detail:
        raise ToolError(f"Unknown detail tables: {', '.join(bad_detail)}. Choose from {', '.join(detail_body) or ', '.join(DETAIL_KEYS)}")
    months = len(body.get("periods") or []) or _months(start_period, end_period)
    compact_default = not requested and months > COMPACT_AFTER_MONTHS
    if not requested and not compact_default:
        full = dict(body)
        omitted = {name: _entries(table) for name, table in detail_body.items()
                   if _entries(table) > DEFAULT_DETAIL_MAX_ENTRIES}
        if omitted:
            full["detail"] = {name: table for name, table in detail_body.items() if name not in omitted}
            full["detail_omitted"] = omitted
            full["note"] = (f"Detail tables with more than {DEFAULT_DETAIL_MAX_ENTRIES} entries are left out of the "
                            f"default view: ask for one with sections=['detail.<name>'] "
                            f"(e.g. {', '.join(repr('detail.' + n) for n in omitted)}).")
        full = _apply_layout(full, layout)
        if len(to_json_text(full)) <= DEFAULT_VIEW_MAX_CHARS:
            return full
        compact_default = True   # still too large (many departments, loans, ...): the compact view
    if compact_default:
        top = ["income_statement", "warnings"]
    keep = {"forecast_ids", "start_period", "end_period", "message", "warnings", *top}
    out = {k: v for k, v in body.items() if k in keep}
    out["months"] = months
    if details and "detail" not in top:
        out["detail"] = {d: detail_body[d] for d in details}
    for key, value in _headline(body).items():
        stmt = key.rsplit("_", 1)[0] if key != "balance_sheet_closing" else "balance_sheet"
        if stmt not in top:
            out[key] = value
    if compact_default:
        reason = (f"{months}-month window" if months > COMPACT_AFTER_MONTHS
                  else "The full statements would be too large for one response")
        out["note"] = (f"{reason}: returned the income statement by month plus headline totals. "
                       f"Pass sections=[...] (e.g. ['cash_flow'], ['balance_sheet'], ['detail.revenue_by_product']) "
                       f"for the rest.")
    return _apply_layout(out, layout)


@mcp.tool(name="forecast_variance", annotations=READ)
async def variance(
    forecast_ids: Annotated[List[str], Field(min_length=1)],
    start_period: Window,
    end_period: Window,
    layout: Annotated[Literal["table", "records"], Field(description=(
        "table: each line's by_period is {columns, rows} with one array per month (default, about half the "
        "size); records: one object per month"))] = "table",
) -> Dict[str, Any]:
    """Budget vs actual by statement line and period: forecast, actual,
    variance and variance %, for periods that have actuals recorded. Each
    line has totals (to date: only the months that line has actuals for),
    coverage and missing months. On a long window the month-by-month rows of
    lines without any actuals are left out (lines_by_period_omitted)."""
    body = await call("GET", "/reporting/variance", params={
        "forecast_ids": forecast_ids, "start_period": start_period, "end_period": end_period,
    })
    lines = body.get("line_items")
    if not isinstance(lines, list):
        return body
    if layout == "table":
        body["line_items"] = [{**line, "by_period": as_table(line["by_period"])}
                              if isinstance(line, dict) and isinstance(line.get("by_period"), list) else line
                              for line in lines]
    if len(to_json_text(body)) > DEFAULT_VIEW_MAX_CHARS:
        omitted = [line.get("line_item") for line in body["line_items"]
                   if isinstance(line, dict) and not line.get("has_actuals") and "by_period" in line]
        body["line_items"] = [{k: v for k, v in line.items() if k != "by_period"}
                              if isinstance(line, dict) and line.get("line_item") in omitted else line
                              for line in body["line_items"]]
        if omitted:
            body["lines_by_period_omitted"] = omitted
            body["note"] = ("Month-by-month rows are left out for lines with no actuals (their budget by month is "
                            "in forecast_financial_statements); narrow the window to see them here.")
    return body


@mcp.tool(name="forecast_actual_line_items", annotations=READ)
async def actual_line_items() -> Dict[str, Any]:
    """The statement lines actuals can be recorded against (line_item key,
    label, direction, statement) and the other names an import accepts for
    each ('Net Sales' -> revenue, 'Salaries & Wages' -> payroll)."""
    return await call("GET", "/reporting/actuals/line-items")


@mcp.tool(name="forecast_list_actuals", annotations=READ)
async def list_actuals(start_period: Window, end_period: Window) -> Dict[str, Any]:
    """Recorded actual results by period and statement line (with the batch
    that wrote each row), plus the window's closed months."""
    return await call("GET", "/reporting/actuals", params={"start_period": start_period, "end_period": end_period})


#: Rows of the per-row report shown without detail=True.
ACTUALS_ROWS_SAMPLE = 25

ActualsDryRun = Annotated[bool, Field(description=(
    "Check everything and report what would happen (per-row actions, totals, problems); write nothing. "
    "Do this first."))]
AllowPartial = Annotated[bool, Field(description=(
    "Write the valid rows even if some rows are rejected (default: any rejected row and NOTHING is written)"))]
CombineDuplicates = Annotated[bool, Field(description=(
    "Add up rows with the same period + line_item + reference_id (default: they are an error naming both rows)"))]
ControlTotal = Annotated[Optional[float], Field(description=(
    "The sum of every amount in the rows must equal this (within 0.005), e.g. the trial-balance total; "
    "otherwise nothing is written"))]
ActualsSource = Annotated[Optional[str], Field(description="Where the numbers come from, kept on each row and the batch")]
ActualsNote = Annotated[Optional[str], Field(description="A note kept with the import batch (e.g. 'April close, TB v2')")]
ActualsDetail = Annotated[bool, Field(description="Every row's action and every problem instead of a sample")]
ReplaceLines = Annotated[bool, Field(description=(
    "For every month + line in the rows, remove the amounts stored under OTHER references in the same write "
    "(undo puts them back), so the line's month total becomes exactly the rows' total. Use it when the rows "
    "replace what is stored (a corrected file, a trial-balance summary over GL detail, a hand-entered month "
    "total). Default: amounts under other references are kept and ADDED (line_totals and warnings show it)"))]


def _next_hint(body: Dict[str, Any], errors: List[Dict[str, Any]], allow_partial: bool) -> str:
    """What to do after a refused write, from the reason it was refused (in the order the service checks)."""
    closed = body.get("closed_periods") or []
    if closed:
        months = ", ".join(str(c.get("label") or c.get("period")) for c in closed)
        return (f"Nothing was written: {months} {'is' if len(closed) == 1 else 'are'} closed, and a row that "
                "changes a closed month refuses the whole call, even with allow_partial. Reopen the month with "
                "forecast_reopen_actuals_period (a reason is required) or remove those rows (rows whose amounts "
                "already match are fine), then call again.")
    if body.get("request_errors"):
        return ("Nothing was written: the rows do not add up to control_total (see control_difference). Fix the "
                "amounts or control_total; allow_partial does not bypass this check.")
    valid = (body.get("inserted") or 0) + (body.get("updated") or 0) + (body.get("unchanged") or 0)
    if errors and not allow_partial and valid:
        return ("Nothing was written. Fix the rows in errors, or pass allow_partial=true to write only the "
                "valid rows.")
    if errors:
        return "Nothing was written: none of the rows is valid. Fix the rows in errors and call again."
    return "Nothing was written. See message."


def _actuals_result(body: Dict[str, Any], detail: bool, source_file: Optional[Dict[str, Any]] = None,
                    allow_partial: bool = False) -> Dict[str, Any]:
    """The import report trimmed for the model: counts, problems, totals, month totals and a sample of rows."""
    keep = ("outcome", "written", "dry_run", "batch_id", "message", "rows_in_file", "inserted", "updated",
            "unchanged", "rejected", "replaced", "control_total", "control_difference", "control_matches",
            "stored_before_total", "stored_after_total", "control_difference_after", "control_matches_after",
            "closed_periods", "request_errors", "warnings")
    out: Dict[str, Any] = {k: body.get(k) for k in keep if body.get(k) not in (None, [], "")}
    out["status"] = {"imported": "ok", "unchanged": "ok", "partial": "partial", "rejected": "rejected"}.get(
        body.get("outcome"), body.get("outcome"))
    if source_file:
        out["file"] = source_file
    errors = body.get("errors") or []
    limit = 500 if detail else ACTUALS_ROWS_SAMPLE
    out["errors"] = errors[:limit]
    if len(errors) > limit:
        out["errors_omitted"] = len(errors) - limit
    duplicates = body.get("duplicates") or []
    if duplicates:
        out["duplicates"] = duplicates[:limit]
    totals = body.get("totals") or {}
    out["totals"] = {
        "grand_total": totals.get("grand_total"),
        "by_line_item": [{k: t.get(k) for k in ("line_item", "label", "amount", "rows")} for t in totals.get("by_line_item") or []],
        "by_period": [{k: t.get(k) for k in ("period", "label", "amount", "rows")} for t in totals.get("by_period") or []],
    }
    # Each month + line's stored total before / after; lines with amounts under other references first.
    line_totals = sorted(body.get("line_totals") or [], key=lambda t: not t.get("other_references"))
    shown = (line_totals if detail else line_totals[:ACTUALS_ROWS_SAMPLE])[:500]
    if shown:
        out["line_totals"] = [{**{k: t.get(k) for k in ("period", "line_item", "line_label", "before", "file_amount",
                                                         "after", "replaced")},
                               "other_references": [{k: o.get(k) for k in ("reference_id", "amount", "batch_id")}
                                                    for o in (t.get("other_references") or [])[:10]]}
                              for t in shown]
        if len(line_totals) > len(shown):
            out["line_totals_omitted"] = len(line_totals) - len(shown)
    rows = body.get("rows") or []
    if detail:
        out["rows"] = as_table(rows[:5000]) if rows else []
    else:
        changed = [{k: r.get(k) for k in ("row", "period", "line_item", "reference_id", "amount", "previous_amount")}
                   for r in rows if r.get("action") == "updated"]
        if changed:
            out["changed_rows"] = changed[:ACTUALS_ROWS_SAMPLE]
            if len(changed) > ACTUALS_ROWS_SAMPLE:
                out["changed_rows_omitted"] = len(changed) - ACTUALS_ROWS_SAMPLE
    if body.get("outcome") == "rejected":
        out["nothing_written"] = True
        out["next"] = _next_hint(body, errors, allow_partial)
    elif body.get("dry_run"):
        out["next"] = "Dry run only: nothing was written. Call again with dry_run=false to write."
    return out


async def _write_actuals(payload: Dict[str, Any], detail: bool,
                         source_file: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """POST /reporting/actuals. A refused write (HTTP 422 / 409, nothing written) comes back as status
    'rejected' with the same report a dry run gives, so the model sees every row's problem."""
    try:
        body = await call("POST", "/reporting/actuals", json=payload)
    except ToolError as refused:
        if payload.get("dry_run"):
            raise
        try:
            body = await call("POST", "/reporting/actuals", json={**payload, "dry_run": True})
        except ToolError:
            raise refused
        if body.get("outcome") != "rejected":   # the data changed in between: report the refusal as it was
            raise refused
        body = {**body, "dry_run": False, "message": str(refused).split(": ", 1)[-1]}
    return _actuals_result(body, detail, source_file, allow_partial=bool(payload.get("allow_partial")))


async def _write_actuals_safely(payload: Dict[str, Any], detail: bool, what: str,
                                source_file: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """_write_actuals that never fails with the SDK's bare 'Error executing tool': an unexpected error
    comes back as a ToolError naming the file (or tool) and the reason."""
    try:
        return await _write_actuals(payload, detail, source_file)
    except ToolError:
        raise
    except Exception as exc:  # noqa: BLE001 - reported to the model with its reason
        raise ToolError(f"{what}: the import failed before anything was written ({type(exc).__name__}: {exc})"
                        ) from exc


def _actuals_payload(entries: List[Dict[str, Any]], dry_run: bool, allow_partial: bool, combine_duplicates: bool,
                     control_total: Optional[float], source: Optional[str], note: Optional[str],
                     replace_lines: bool = False) -> Dict[str, Any]:
    return strip_none({
        "entries": entries, "dry_run": dry_run, "allow_partial": allow_partial,
        "combine_duplicates": combine_duplicates, "control_total": control_total,
        "replace_lines": replace_lines or None, "source": source or "mcp", "note": note,
    })


@mcp.tool(name="forecast_upsert_actuals", annotations=UPSERT)
async def upsert_actuals(
    entries: Annotated[List[Dict[str, Any]], Field(
        description=("Rows of {period (YYYY-MM or 'Apr 2026'), line_item (key, label or common name, see "
                     "forecast_actual_line_items), amount (number or '$1,234.50' / '(500)'; 0 = confirmed zero, "
                     "blank is rejected), reference_id?, notes?, source?}"),
        min_length=1)],
    dry_run: ActualsDryRun = False,
    allow_partial: AllowPartial = False,
    combine_duplicates: CombineDuplicates = False,
    control_total: ControlTotal = None,
    replace_lines: ReplaceLines = False,
    source: ActualsSource = None,
    note: ActualsNote = None,
    detail: ActualsDetail = False,
) -> Dict[str, Any]:
    """Record or overwrite actual results for budget vs actual, matched on
    period + line_item + reference_id. Amounts under different references
    ADD UP for a month + line: line_totals shows each month + line's stored
    total before and after (with the amounts under other references) and a
    warning names them; replace_lines=true replaces them instead. Atomic: if
    any row is rejected nothing is written (status 'rejected', with every
    row's problem) unless allow_partial. A row that would change a closed
    month refuses the whole call. Each write is an import batch (batch_id)
    that forecast_undo_actuals_batch can undo. Reports per-row actions
    (inserted / updated / unchanged / rejected) and totals by line and month."""
    return await _write_actuals_safely(
        _actuals_payload(entries, dry_run, allow_partial, combine_duplicates, control_total, source, note,
                         replace_lines), detail, "forecast_upsert_actuals")


@mcp.tool(name="forecast_import_actuals", annotations=UPSERT)
async def import_actuals(
    rows: Annotated[Optional[List[Dict[str, Any]]], Field(description=(
        "Rows as objects of column: value (period / month, line_item / account / line, amount / actual, "
        "reference_id / ref, notes / memo). Give rows OR file_path."))] = None,
    file_path: Annotated[Optional[str], Field(description=(
        "Instead of rows: a .csv/.xlsx in the data folder, relative to it (Docker: ./data on the host), e.g. "
        "'imports/actuals_2026_04.xlsx'. One row per month and line."))] = None,
    sheet: Annotated[Optional[str], Field(description="XLSX sheet (default: the first with period / line / amount columns)")] = None,
    header_row: Annotated[Optional[int], Field(description="1-based header row (default: detected)", ge=1)] = None,
    dry_run: ActualsDryRun = False,
    allow_partial: AllowPartial = False,
    combine_duplicates: CombineDuplicates = False,
    control_total: ControlTotal = None,
    replace_lines: ReplaceLines = False,
    source: ActualsSource = None,
    note: ActualsNote = None,
    detail: ActualsDetail = False,
) -> Dict[str, Any]:
    """Import actual results from a CSV / XLSX file (or rows read from one)
    with the same checks as the Budget vs Actual screen's import: header
    aliases, every row validated, duplicates (same month + line + reference)
    are an error unless combine_duplicates, optional control_total
    reconciliation, closed months refused. Atomic unless allow_partial. Run
    with dry_run=true first and check totals against the trial balance, and
    line_totals (each month + line's stored total after the import): amounts
    already stored under other references are added unless replace_lines.
    Errors name spreadsheet rows."""
    if rows and file_path:
        raise ToolError("Give rows or file_path, not both")
    file_info = None
    if file_path:
        path = resolve_path(file_path)
        try:
            with open(path, "rb") as fh:
                raw = fh.read()
            parsed, info = await anyio.to_thread.run_sync(actuals_service.read_table, os.path.basename(path), raw,
                                                          sheet, header_row)
        except actuals_service.ActualsError as exc:
            raise ToolError(f"{file_path}: {exc}")
        except Exception as exc:  # noqa: BLE001 - never the SDK's bare 'Error executing tool'
            raise ToolError(f"{file_path}: the file could not be read ({type(exc).__name__}: {exc})") from exc
        file_info = {k: v for k, v in info.items() if v is not None}
        # read_table's cells are JSON-safe (Excel dates -> 'YYYY-MM-DD'), so they post as JSON entries.
        payload = _actuals_payload([r for _n, r in parsed], dry_run, allow_partial, combine_duplicates,
                                   control_total, source or f"mcp: {os.path.basename(path)}", note, replace_lines)
        payload["row_numbers"] = [n for n, _r in parsed]
        payload["filename"] = os.path.basename(path)
    else:
        if sheet or header_row:
            raise ToolError("sheet / header_row apply to file_path only")
        if not rows:
            raise ToolError("Give rows (a non-empty list of objects) or file_path")
        payload = _actuals_payload(rows, dry_run, allow_partial, combine_duplicates, control_total, source, note,
                                   replace_lines)
    return await _write_actuals_safely(payload, detail, file_path or "forecast_import_actuals", file_info)


@mcp.tool(name="forecast_delete_actuals", annotations=DESTRUCTIVE)
async def delete_actuals(
    period: Annotated[Optional[str], Field(description="Delete every actual in this YYYY-MM")] = None,
    line_item: Annotated[Optional[str], Field(description="With period: only this line")] = None,
    actual_id: Annotated[Optional[str], Field(description="Delete one row by id")] = None,
) -> Dict[str, Any]:
    """Delete recorded actuals by period (and line item) or by id. Refused
    for a closed month (reopen it first). The deletion is kept in the batch
    history. To take back one import, use forecast_undo_actuals_batch."""
    if not (period or actual_id):
        raise ToolError("Give period (optionally with line_item) or actual_id")
    return await call("DELETE", "/reporting/actuals", params={
        "period": period, "line_item": line_item, "actual_id": actual_id,
    })


@mcp.tool(name="forecast_list_actuals_batches", annotations=READ)
async def list_actuals_batches(
    limit: Annotated[int, Field(ge=1, le=200)] = 20,
    offset: Annotated[int, Field(ge=0)] = 0,
) -> Dict[str, Any]:
    """The actuals import history, newest first: each batch's source / file,
    rows inserted / updated / unchanged / rejected, file and control totals,
    status (imported, partial, undone, deleted), the rows it still owns and
    whether it can be undone."""
    body = await call("GET", "/reporting/actuals/batches", params={"limit": limit, "offset": offset})
    batches = body.get("batches") or []
    body["batches"] = as_table(batches) if batches else []
    return body


@mcp.tool(name="forecast_undo_actuals_batch", annotations=DESTRUCTIVE)
async def undo_actuals_batch(
    batch_id: Annotated[str, Field(description="ACT-xxxxxxxx from forecast_list_actuals_batches or an import result")],
    dry_run: Annotated[bool, Field(description="Report what would be removed; change nothing (default)")] = True,
) -> Dict[str, Any]:
    """Undo an actuals import: rows the batch added are deleted, rows it
    replaced (replace_lines) are put back (rows_to_put_back / put_back) and
    rows it overwrote go back to the value of the latest earlier import that
    is not undone (rows_to_restore / restored; changed[].action says which).
    Only rows still stamped with the batch: a row changed since by a later
    entry belongs to that entry and stays. Refused for closed months.
    dry_run defaults to true: call again with dry_run=false to undo."""
    return await call("DELETE", f"/reporting/actuals/batches/{require(batch_id, 'batch_id')}",
                      params={"dry_run": dry_run})


@mcp.tool(name="forecast_actuals_periods", annotations=READ)
async def actuals_periods(
    start_period: Annotated[Optional[str], Field(description="YYYY-MM; with end_period lists every month of the window")] = None,
    end_period: Annotated[Optional[str], Field(description="YYYY-MM")] = None,
) -> Dict[str, Any]:
    """Months with their close status (open / closed, by whom, when, note)
    and how many actuals each holds. Without a window: every month that has
    actuals or a close record."""
    body = await call("GET", "/reporting/actuals/periods", params={"start_period": start_period, "end_period": end_period})
    periods = body.get("periods") or []
    body["periods"] = as_table(periods) if periods else []
    return body


@mcp.tool(name="forecast_close_actuals_period", annotations=WRITE)
async def close_actuals_period(
    period: Annotated[str, Field(description="YYYY-MM")],
    closed_by: Annotated[Optional[str], Field(description="Who closes the month")] = None,
    note: Optional[str] = None,
) -> Dict[str, Any]:
    """Close a month: its actuals can then not be imported, changed, deleted
    or undone until it is reopened with a reason."""
    return await call("POST", f"/reporting/actuals/periods/{require(period, 'period')}/close",
                      json=strip_none({"closed_by": closed_by, "note": note}))


@mcp.tool(name="forecast_reopen_actuals_period", annotations=WRITE)
async def reopen_actuals_period(
    period: Annotated[str, Field(description="YYYY-MM")],
    reason: Annotated[str, Field(description="Why the closed month must change (kept with the month)", min_length=1)],
    reopened_by: Optional[str] = None,
) -> Dict[str, Any]:
    """Reopen a closed month so its actuals can change again. A reason is required."""
    return await call("POST", f"/reporting/actuals/periods/{require(period, 'period')}/reopen",
                      json=strip_none({"reason": require(reason, "reason"), "reopened_by": reopened_by}))


@mcp.tool(name="forecast_get_assumptions", annotations=READ)
async def get_assumptions(forecast_id: Annotated[str, Field(description="Scenario id")]) -> Dict[str, Any]:
    """Opening balances (cash, AR, inventory, fixed assets, AP, equity) as at
    the end of opening_period, working-capital days (DSO / DIO / DPO, and
    excise_payable_days for excise tax owed), income tax rate and minimum
    cash for a scenario. 'found' is false when defaults are in use."""
    return await call("GET", "/reporting/assumptions", params={"forecast_id": require(forecast_id, "forecast_id")})


@mcp.tool(name="forecast_update_assumptions", annotations=UPSERT)
async def update_assumptions(
    forecast_id: Annotated[str, Field(description="Scenario id")],
    updates: Annotated[Dict[str, Any], Field(description=f"Fields to change; any of {', '.join(ASSUMPTION_FIELDS)}. Rates are fractions (0.21 = 21%), days are numbers.")],
) -> Dict[str, Any]:
    """Save financial assumptions for a scenario. Only the fields given change;
    the rest keep their current (or default) values. opening_period (YYYY-MM)
    is the month the opening balances are stated at; the model starts the
    month after. opening_equity left null is plugged so the opening balance
    sheet balances."""
    forecast_id = require(forecast_id, "forecast_id")
    unknown = [k for k in updates if k not in ASSUMPTION_FIELDS]
    if unknown:
        raise ToolError(f"Unknown assumption fields: {', '.join(unknown)}. Allowed: {', '.join(ASSUMPTION_FIELDS)}")
    if not updates:
        raise ToolError("updates must contain at least one field")
    current = (await call("GET", "/reporting/assumptions", params={"forecast_id": forecast_id})).get("assumptions") or {}
    merged = {k: current.get(k) for k in ASSUMPTION_FIELDS}
    merged.update(updates)
    for key in ASSUMPTION_FIELDS:
        if merged.get(key) is None and key not in NULLABLE_ASSUMPTIONS:
            merged[key] = 0 if key == "opening_fixed_assets_remaining_life_months" else 0.0
    return await call("PUT", "/reporting/assumptions", params={"forecast_id": forecast_id}, json=merged)


@mcp.tool(name="forecast_list_capex", annotations=READ)
async def list_capex(
    forecast_id: Annotated[Optional[str], Field(description="Scenario; company-wide (NULL) items are always included")] = None,
) -> Dict[str, Any]:
    """Planned capital expenditures (asset, amount, purchase month, useful
    life). Depreciated straight-line into the statements."""
    return await call("GET", "/reporting/capex", params={"forecast_id": forecast_id})


@mcp.tool(name="forecast_create_capex", annotations=WRITE)
async def create_capex(
    asset_name: str,
    amount: Annotated[float, Field(gt=0)],
    purchase_period: Annotated[str, Field(description="YYYY-MM the cash goes out")],
    useful_life_months: Annotated[int, Field(gt=0)] = 60,
    salvage_value: float = 0.0,
    category: Optional[str] = None,
    description: Optional[str] = None,
    forecast_id: Annotated[Optional[str], Field(description="Scenario; omit for company-wide")] = None,
) -> Dict[str, Any]:
    """Plan an asset purchase. Cash leaves in purchase_period; depreciation
    runs straight-line over useful_life_months from that month."""
    return await call("POST", "/reporting/capex", json=strip_none({
        "asset_name": require(asset_name, "asset_name"), "amount": amount, "purchase_period": purchase_period,
        "useful_life_months": useful_life_months, "salvage_value": salvage_value, "category": category,
        "description": description, "forecast_id": forecast_id,
    }))


@mcp.tool(name="forecast_update_capex", annotations=UPSERT)
async def update_capex(
    capex_id: str,
    updates: Annotated[Dict[str, Any], Field(description=f"Fields to change; any of {', '.join(CAPEX_FIELDS)}")],
) -> Dict[str, Any]:
    """Update a planned capital expenditure (amount, month, life, active flag)."""
    unknown = [k for k in updates if k not in CAPEX_FIELDS]
    if unknown:
        raise ToolError(f"Unknown capex fields: {', '.join(unknown)}. Allowed: {', '.join(CAPEX_FIELDS)}")
    if not updates:
        raise ToolError("updates must contain at least one field")
    return await call("PUT", f"/reporting/capex/{require(capex_id, 'capex_id')}", json=updates)


@mcp.tool(name="forecast_delete_capex", annotations=DESTRUCTIVE)
async def delete_capex(capex_id: str) -> Dict[str, Any]:
    """Delete a planned capital expenditure."""
    return await call("DELETE", f"/reporting/capex/{require(capex_id, 'capex_id')}")
