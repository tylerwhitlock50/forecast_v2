"""Reporting tools: statements, variance, actuals, assumptions and capex."""
from __future__ import annotations

from typing import Annotated, Any, Dict, List, Literal, Optional

from pydantic import Field
from mcp.server.mcpserver.exceptions import ToolError

from mcp_server.core import DESTRUCTIVE, READ, UPSERT, WRITE, as_table, call, mcp, require, strip_none, to_json_text
from mcp_server.tools._common import scenario_window

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
    """The statement line names actuals can be recorded against."""
    return await call("GET", "/reporting/actuals/line-items")


@mcp.tool(name="forecast_list_actuals", annotations=READ)
async def list_actuals(start_period: Window, end_period: Window) -> Dict[str, Any]:
    """Recorded actual results by period and statement line."""
    return await call("GET", "/reporting/actuals", params={"start_period": start_period, "end_period": end_period})


@mcp.tool(name="forecast_upsert_actuals", annotations=UPSERT)
async def upsert_actuals(
    entries: Annotated[List[Dict[str, Any]], Field(
        description="Rows of {period (YYYY-MM), line_item (see forecast_actual_line_items), amount, reference_id?, source?, notes?}",
        min_length=1)],
) -> Dict[str, Any]:
    """Record or overwrite actual results for budget-vs-actual reporting.
    Matched on period + line_item + reference_id."""
    for i, entry in enumerate(entries):
        for key in ("period", "line_item", "amount"):
            if entry.get(key) is None:
                raise ToolError(f"entries[{i}] is missing {key}")
    return await call("POST", "/reporting/actuals", json={"entries": entries})


@mcp.tool(name="forecast_delete_actuals", annotations=DESTRUCTIVE)
async def delete_actuals(
    period: Annotated[Optional[str], Field(description="Delete every actual in this YYYY-MM")] = None,
    line_item: Annotated[Optional[str], Field(description="With period: only this line")] = None,
    actual_id: Annotated[Optional[str], Field(description="Delete one row by id")] = None,
) -> Dict[str, Any]:
    """Delete recorded actuals by period (and line item) or by id."""
    if not (period or actual_id):
        raise ToolError("Give period (optionally with line_item) or actual_id")
    return await call("DELETE", "/reporting/actuals", params={
        "period": period, "line_item": line_item, "actual_id": actual_id,
    })


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
