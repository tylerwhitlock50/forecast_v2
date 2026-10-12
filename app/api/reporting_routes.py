"""
Reporting API: financial statements, budget-vs-actual, and the planning
inputs that feed them (assumptions, capex, actuals).

All statement maths lives in services.financial_statements; this module
only handles HTTP concerns and persistence of the planning inputs.
"""
import csv
import io
import logging
import math
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool

from db.database import db_manager
from db.models import (
    CapitalExpenditureCreate,
    CapitalExpenditureUpdate,
    FinancialAssumptionsUpdate,
    ForecastResponse,
)
from services.financial_statements import (
    DEFAULT_ASSUMPTIONS,
    VARIANCE_LINE_ITEMS,
    build_statements,
    build_variance,
    load_actuals,
    load_assumptions,
    period_range,
    statements_to_rows,
    validate_period,
)
from services import actuals as actuals_service
from services.operations_forecast import (
    DEFAULT_HOURS_PER_FTE,
    build_cogs_forecast,
    build_labor_forecast,
    sales_detail_report,
)
from services.workbook_export import (
    XLSX_MEDIA_TYPE,
    sales_detail_columns,
    statement_lines,
    scenario_names,
    workbook_bytes,
    workbook_filename,
)

router = APIRouter(prefix="/reporting", tags=["reporting"])
logger = logging.getLogger(__name__)


def _parse_forecast_ids(forecast_ids: List[str]) -> List[str]:
    """Accept both repeated query params and a single comma-separated value."""
    out: List[str] = []
    for value in forecast_ids or []:
        out.extend(v.strip() for v in str(value).split(",") if v.strip())
    if not out:
        raise HTTPException(status_code=422, detail="At least one forecast_id is required")
    return out


def _check_window(start_period: str, end_period: str) -> None:
    try:
        period_range(start_period, end_period)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


def _check_period(period: str) -> str:
    """A YYYY-MM period filter, or 422 ('Jan 2027', '2027-1' and '2027-Q1' are not months)."""
    try:
        return validate_period(str(period).strip())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


# ---------------------------------------------------------------------------
# Statements
# ---------------------------------------------------------------------------

@router.get("/statements", response_model=ForecastResponse)
async def get_financial_statements(
    forecast_ids: List[str] = Query(..., description="Forecast IDs (repeat or comma-separate)"),
    start_period: str = Query(..., description="Start period (YYYY-MM)"),
    end_period: str = Query(..., description="End period (YYYY-MM)"),
    include_raises: bool = Query(True, description="Apply scheduled payroll raises"),
):
    """Period-by-period income statement, cash flow and balance sheet."""
    ids = _parse_forecast_ids(forecast_ids)
    _check_window(start_period, end_period)
    conn = db_manager.get_connection()
    try:
        statements = build_statements(conn.cursor(), ids, start_period, end_period, include_raises=include_raises)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.exception("Error building financial statements")
        raise HTTPException(status_code=500, detail=f"Error building financial statements: {exc}")
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(
        status="success",
        data=statements,
        message=f"Built statements for {len(statements['periods'])} period(s)",
    )


# Backward-compatible alias for callers of the old endpoint name.
@router.get("/financial-statements", response_model=ForecastResponse, include_in_schema=False)
async def get_financial_statements_legacy(
    forecast_ids: List[str] = Query(...),
    start_period: str = Query(...),
    end_period: str = Query(...),
):
    return await get_financial_statements(forecast_ids, start_period, end_period, True)


@router.get("/statements/export")
async def export_financial_statements(
    forecast_ids: List[str] = Query(...),
    start_period: str = Query(...),
    end_period: str = Query(...),
    layout: str = Query("wide", description="'wide' (one column per period) or 'long'"),
):
    """Download the statements as CSV."""
    ids = _parse_forecast_ids(forecast_ids)
    _check_window(start_period, end_period)
    conn = db_manager.get_connection()
    try:
        statements = build_statements(conn.cursor(), ids, start_period, end_period)
    finally:
        db_manager.close_connection(conn)

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    if layout == "long":
        writer.writerow(["statement", "period", "line_item", "amount"])
        for row in statements_to_rows(statements):
            writer.writerow([row["statement"], row["period"], row["line_item"], row["amount"]])
    else:
        # One block per statement: a human label, the line key, one column
        # per period and (except the balance sheet) the window total. Lines
        # come from the engine's rows, so new statement lines appear here
        # without changes.
        periods = statements["periods"]
        for key, label in (("income_statement", "Income Statement"),
                           ("cash_flow", "Cash Flow"),
                           ("balance_sheet", "Balance Sheet")):
            rows = statements[key]["by_period"]
            has_total = key != "balance_sheet"
            writer.writerow([label, "line_item"] + periods + (["Total"] if has_total else []))
            totals = statements[key].get("totals", {})
            for line, line_label in statement_lines(statements, key):
                values = [r.get(line, "") for r in rows]
                extra = [totals.get(line, "")] if has_total else []
                writer.writerow([line_label, line] + values + extra)
            writer.writerow([])

    filename = f"financial_statements_{start_period}_{end_period}.csv"
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# COGS / labor forecasts, sales detail and the Excel workbook
# ---------------------------------------------------------------------------

async def _build_report(label: str, builder, *args, **kwargs):
    """
    Run a report builder on a fresh connection in a worker thread (a large
    forecast takes seconds and must not block the event loop).
    ValueError -> 422, anything else -> 500.
    """
    return await run_in_threadpool(_run_builder, label, builder, *args, **kwargs)


def _run_builder(label: str, builder, *args, **kwargs):
    conn = db_manager.get_connection()
    try:
        return builder(conn.cursor(), *args, **kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error building %s", label)
        raise HTTPException(status_code=500, detail=f"Error building {label}: {exc}")
    finally:
        db_manager.close_connection(conn)


def _check_hours_per_fte(hours_per_fte: float) -> float:
    if hours_per_fte is None or not math.isfinite(hours_per_fte) or hours_per_fte <= 0:
        raise HTTPException(status_code=422, detail="hours_per_fte must be a number greater than zero")
    return float(hours_per_fte)


@router.get("/cogs-forecast", response_model=ForecastResponse)
async def get_cogs_forecast(
    forecast_ids: List[str] = Query(..., description="Forecast IDs (repeat or comma-separate)"),
    start_period: str = Query(..., description="Start period (YYYY-MM)"),
    end_period: str = Query(..., description="End period (YYYY-MM)"),
):
    """
    Gross sales -> sales deductions -> net sales -> COGS -> gross profit by
    month (ties to the income statement), plus contribution margin by
    product, customer, customer type and product type, and unit costs.
    """
    ids = _parse_forecast_ids(forecast_ids)
    _check_window(start_period, end_period)
    report = await _build_report("COGS forecast", build_cogs_forecast, ids, start_period, end_period)
    return ForecastResponse(
        status="success",
        data=report,
        message=f"COGS forecast for {len(report['periods'])} period(s), {report.get('line_count', 0)} sales line(s)",
    )


@router.get("/labor-forecast", response_model=ForecastResponse)
async def get_labor_forecast(
    forecast_ids: List[str] = Query(..., description="Forecast IDs (repeat or comma-separate)"),
    start_period: str = Query(..., description="Start period (YYYY-MM)"),
    end_period: str = Query(..., description="End period (YYYY-MM)"),
    hours_per_fte: float = Query(DEFAULT_HOURS_PER_FTE, description="Paid hours per FTE per month (40 x 52 / 12 = 173.33)"),
):
    """Direct labor hours, cost and FTEs by labor type by month, machine hours vs capacity, labor by product."""
    ids = _parse_forecast_ids(forecast_ids)
    _check_window(start_period, end_period)
    hours = _check_hours_per_fte(hours_per_fte)
    report = await _build_report("labor forecast", build_labor_forecast, ids, start_period, end_period, hours_per_fte=hours)
    return ForecastResponse(
        status="success",
        data=report,
        message=f"Labor forecast for {len(report['periods'])} period(s)",
    )


@router.get("/sales-detail", response_model=ForecastResponse)
async def get_sales_detail(
    forecast_ids: List[str] = Query(..., description="Forecast IDs (repeat or comma-separate)"),
    start_period: str = Query(..., description="Start period (YYYY-MM)"),
    end_period: str = Query(..., description="End period (YYYY-MM)"),
    limit: int = Query(1000, ge=1, le=20000, description="Rows to return (max 20000)"),
    offset: int = Query(0, ge=0, description="Rows to skip"),
    period: Optional[str] = Query(None, description="Only this month (YYYY-MM, inside the window)"),
    customer_id: Optional[str] = Query(None, description="Only this customer"),
    customer_type: Optional[str] = Query(None, description="Only this customer type (case-insensitive)"),
    unit_id: Optional[str] = Query(None, description="Only this product"),
    unit_type: Optional[str] = Query(None, description="Only this product type (case-insensitive)"),
):
    """
    Every sales line in the window with its deductions, net sales, product
    COGS, contribution margin, labor / machine hours and the deduction rules
    applied, optionally filtered (``period`` must be a YYYY-MM month inside
    the window, else 422).

    Every money amount of a row is rounded to the cent and the row
    cross-foots (unit_price keeps 4 decimals, so quantity x unit_price =
    gross_sales). Totals cover every matching row, not just the page:

    * ``totals``: sums of the rows as shown (= SUM of the column in Excel);
    * ``report_totals``: sums of the unrounded lines; without filters they
      equal the income statement and the COGS forecast for the window;
    * ``rounding``: ``report_totals - totals`` (per-line cent rounding).
    """
    ids = _parse_forecast_ids(forecast_ids)
    _check_window(start_period, end_period)
    filters = {"period": period, "customer_id": customer_id, "customer_type": customer_type,
               "unit_id": unit_id, "unit_type": unit_type}
    if period is not None and period.strip():
        filters["period"] = _check_period(period)
    report = await _build_report("sales detail", sales_detail_report, ids, start_period, end_period, filters=filters)
    rows = report["rows"]
    page = rows[offset:offset + limit]
    data = {
        "forecast_ids": ids,
        "start_period": start_period,
        "end_period": end_period,
        "total_count": len(rows),
        "offset": offset,
        "limit": limit,
        "returned": len(page),
        "has_more": offset + len(page) < len(rows),
        "totals": report["totals"],
        "report_totals": report["report_totals"],
        "rounding": report["rounding"],
        "columns": [{"key": k, "label": label} for k, label, _kind in sales_detail_columns(rows)],
        "rows": page,
    }
    if report["filters"]:
        data["filters"] = report["filters"]
    return ForecastResponse(
        status="success",
        data=data,
        message=f"Returned {len(page)} of {len(rows)} sales line(s)",
    )


@router.get("/workbook")
async def download_workbook(
    forecast_ids: List[str] = Query(..., description="Forecast IDs (repeat or comma-separate)"),
    start_period: str = Query(..., description="Start period (YYYY-MM)"),
    end_period: str = Query(..., description="End period (YYYY-MM)"),
    hours_per_fte: float = Query(DEFAULT_HOURS_PER_FTE, description="Paid hours per FTE per month"),
):
    """
    Excel workbook (.xlsx) of the forecast: Read Me (how every number is
    computed, warnings), gross margin bridge, income statement, by product /
    customer / customer type, labor, machine hours, unit costs, sales detail,
    deduction rules, price list, cash flow and balance sheet.
    """
    ids = _parse_forecast_ids(forecast_ids)
    _check_window(start_period, end_period)
    hours = _check_hours_per_fte(hours_per_fte)
    content = await _build_report("forecast workbook", workbook_bytes, ids, start_period, end_period, hours_per_fte=hours)
    names = await _build_report("workbook file name", scenario_names, ids)
    filename = workbook_filename(ids, start_period, end_period, names)
    return StreamingResponse(
        iter([content]),
        media_type=XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(content)),
        },
    )


# ---------------------------------------------------------------------------
# Budget vs actual
# ---------------------------------------------------------------------------

@router.get("/variance", response_model=ForecastResponse)
async def get_variance(
    forecast_ids: List[str] = Query(...),
    start_period: str = Query(...),
    end_period: str = Query(...),
):
    """Budget (from the statements) versus recorded actuals, by line and period.
    Also lists the window's closed months (``closed_periods``)."""
    ids = _parse_forecast_ids(forecast_ids)
    _check_window(start_period, end_period)
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        variance = build_variance(cursor, ids, start_period, end_period)
        variance["closed_periods"] = actuals_service.closed_in_window(cursor, start_period, end_period)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.exception("Error building variance report")
        raise HTTPException(status_code=500, detail=f"Error building variance report: {exc}")
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data=variance, message="Variance report built")


# ---------------------------------------------------------------------------
# Actuals: entry, import, batches, month-end close (logic in services.actuals)
# ---------------------------------------------------------------------------

def _actuals_error(exc: "actuals_service.ActualsError") -> JSONResponse:
    content: Dict[str, Any] = {"status": "error", "detail": str(exc), "message": str(exc)}
    if exc.data is not None:
        content["data"] = exc.data
    return JSONResponse(status_code=exc.status, content=content)


def _import_response(status_code: int, report: Dict[str, Any]):
    """A refused write: 422 / 409 with the explanation in ``detail`` and the full report in ``data``."""
    if status_code >= 400:
        return JSONResponse(status_code=status_code, content={
            "status": "rejected", "detail": report["message"], "message": report["message"], "data": report,
        })
    return ForecastResponse(status="success", data=report, message=report["message"])


def _flag(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in ("1", "true", "yes", "y", "on")


def _run_actuals_import(rows, *, dry_run, allow_partial, combine_duplicates, control_total, source, filename,
                        note, file_info=None, replace_lines=False):
    conn = db_manager.get_connection()
    try:
        return actuals_service.run_import(
            conn, rows, dry_run=dry_run, allow_partial=allow_partial, combine_duplicates=combine_duplicates,
            control_total=control_total, source=source, filename=filename, note=note, file_info=file_info,
            replace_lines=replace_lines)
    finally:
        db_manager.close_connection(conn)


@router.get("/actuals/line-items", response_model=ForecastResponse)
async def get_actual_line_items():
    """The statement lines actuals can be recorded against, with the names an import accepts for each."""
    items = []
    for key, meta in VARIANCE_LINE_ITEMS.items():
        aliases = [a for a in actuals_service.LINE_ALIASES.get(key, ())]
        items.append({"line_item": key, **meta, "aliases": aliases})
    return ForecastResponse(status="success", data={"line_items": items}, message="Line items")


@router.get("/actuals", response_model=ForecastResponse)
async def get_actuals(
    start_period: str = Query(...),
    end_period: str = Query(...),
):
    _check_window(start_period, end_period)
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        rows = load_actuals(cursor, start_period, end_period)
        cursor.execute("SELECT actual_id, batch_id FROM actuals WHERE period >= ? AND period <= ?",
                       (start_period, end_period))
        batch_of = dict(cursor.fetchall())
        for row in rows:
            row.setdefault("batch_id", batch_of.get(row.get("actual_id")))
        closed = actuals_service.closed_in_window(cursor, start_period, end_period)
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data={"actuals": rows, "closed_periods": closed},
                            message=f"Retrieved {len(rows)} actuals")


@router.post("/actuals", response_model=ForecastResponse)
async def upsert_actuals(
    payload: Dict[str, Any] = Body(...),
    dry_run: Optional[bool] = Query(None),
    allow_partial: Optional[bool] = Query(None),
    combine_duplicates: Optional[bool] = Query(None),
    control_total: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    replace_lines: Optional[bool] = Query(None),
):
    """
    Create or update actuals from JSON: ``{entries: [{period, line_item, amount, reference_id?, notes?,
    source?}], dry_run?, allow_partial?, combine_duplicates?, control_total?, replace_lines?, source?,
    filename?, note?, first_row_number? | row_numbers?}`` (flags may also be query parameters; the body
    wins). Column names go through the same aliases as a file import (Month, Account, Actual ...). Same
    pipeline and answers as the file import: (period, line_item, reference_id) is the key and amounts
    under different references add up (``line_totals`` gives each month + line's total before and
    after); ``replace_lines`` removes the other references of every month + line in the request (undo
    puts them back); atomic unless allow_partial; a refused write is 422 (409 for a closed month) with
    the report in ``data``.
    """
    if not isinstance(payload, dict):
        return _actuals_error(actuals_service.ActualsError("Send {entries: [...]}"))
    entries = payload.get("entries", payload.get("rows"))

    def pick(name, query_value):
        return payload[name] if name in payload and payload[name] is not None else query_value

    try:
        first_row = int(payload.get("first_row_number") or 1)
        rows = actuals_service.rows_from_entries(entries, first_row, payload.get("row_numbers"))
        control = actuals_service.parse_control_total(pick("control_total", control_total))
        status_code, report = await run_in_threadpool(
            _run_actuals_import, rows,
            dry_run=_flag(pick("dry_run", dry_run)),
            allow_partial=_flag(pick("allow_partial", allow_partial)),
            combine_duplicates=_flag(pick("combine_duplicates", combine_duplicates)),
            control_total=control, source=pick("source", source) or "api",
            filename=payload.get("filename"), note=payload.get("note"),
            replace_lines=_flag(pick("replace_lines", replace_lines)))
    except actuals_service.ActualsError as exc:
        return _actuals_error(exc)
    except (TypeError, ValueError) as exc:
        return _actuals_error(actuals_service.ActualsError(str(exc)))
    return _import_response(status_code, report)


@router.post("/actuals/import", response_model=ForecastResponse)
async def import_actuals(
    file: UploadFile = File(...),
    source: Optional[str] = Query(None, description="Where the numbers come from (default: the file name)"),
    dry_run: bool = Query(False, description="Check the file and report what would happen; write nothing"),
    allow_partial: bool = Query(False, description="Write the valid rows even if some rows are rejected"),
    combine_duplicates: bool = Query(False, description="Add up rows with the same period, line and reference"),
    control_total: Optional[str] = Query(None, description="The file's amounts must add up to this (within 0.005)"),
    sheet: Optional[str] = Query(None, description="Excel sheet (default: the first with period / line / amount columns)"),
    note: Optional[str] = Query(None, description="A note kept with the import batch"),
    replace_lines: bool = Query(False, description=(
        "For every month + line in the file, remove the amounts stored under other references (undo puts "
        "them back), so the line's month total becomes the file's")),
):
    """
    Import actuals from a CSV or XLSX file: one row per month and line with the columns period,
    line_item and amount (optional reference_id, notes). Common header names are accepted (Month,
    Account, Line, Actual, Ref, Memo) and line items may be keys, labels or common names ('Net Sales').
    Atomic: any rejected row and nothing is written (422, or 409 when a row would change a closed month,
    with the full report in ``data``) unless allow_partial. A dry run always answers 200 with the report
    (``outcome`` = what a real import would do; ``line_totals`` = each month + line's stored total before
    and after, with the amounts under other references, which add up unless replace_lines). Every write
    is recorded as a batch you can undo.
    """
    raw = await file.read()

    def run():
        rows, info = actuals_service.read_table(file.filename, raw, sheet)
        control = actuals_service.parse_control_total(control_total)
        return _run_actuals_import(
            rows, dry_run=dry_run, allow_partial=allow_partial, combine_duplicates=combine_duplicates,
            control_total=control, source=source or "file import", filename=file.filename, note=note,
            file_info=info, replace_lines=replace_lines)

    try:
        status_code, report = await run_in_threadpool(run)
    except actuals_service.ActualsError as exc:
        return _actuals_error(exc)
    return _import_response(status_code, report)


@router.delete("/actuals", response_model=ForecastResponse)
async def delete_actuals(
    period: Optional[str] = Query(None, description="Delete all actuals for this period"),
    line_item: Optional[str] = Query(None),
    actual_id: Optional[str] = Query(None),
):
    """Delete actuals by id, month and / or line. Refused (409) when a matching row is in a closed month.
    The deletion is recorded in the batch history."""
    if not any([period, line_item, actual_id]):
        raise HTTPException(status_code=422, detail="Provide actual_id, period and/or line_item")
    period = _check_period(period) if period else None
    conn = db_manager.get_connection()
    try:
        result = actuals_service.delete_actuals(conn, period=period, line_item=line_item, actual_id=actual_id)
    except actuals_service.ActualsError as exc:
        return _actuals_error(exc)
    finally:
        db_manager.close_connection(conn)
    deleted = result["deleted"]
    return ForecastResponse(status="success", data=result, message=f"Deleted {deleted} actual(s)")


@router.get("/actuals/batches", response_model=ForecastResponse)
async def list_actuals_batches(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """Every actuals import / save / deletion, newest first, with the rows each still owns and whether it can be undone."""
    conn = db_manager.get_connection()
    try:
        data = actuals_service.list_batches(conn, limit, offset)
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data=data, message=f"{len(data['batches'])} batch(es)")


@router.delete("/actuals/batches/{batch_id}", response_model=ForecastResponse)
async def undo_actuals_batch(
    batch_id: str,
    dry_run: bool = Query(False, description="Report what undo would remove or restore; change nothing"),
):
    """
    Undo an import, as if it had never run: every month + line it touched
    ends up as replaying the imports still in place (and the deletions), in
    their original order, would leave it. Rows it added go, rows it overwrote
    go back to the latest earlier import still in place, rows it replaced
    (replace_lines) come back, a later correction is kept and a row a later
    import found unchanged stays with that import (``rows_to_reassign``).
    Any undo order gives the same rows. Refused (409) for closed months.
    """
    conn = db_manager.get_connection()
    try:
        result = actuals_service.undo_batch(conn, batch_id.strip(), dry_run=dry_run)
    except actuals_service.ActualsError as exc:
        return _actuals_error(exc)
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data=result, message=result["message"])


@router.get("/actuals/periods", response_model=ForecastResponse)
async def list_actuals_periods(
    start_period: Optional[str] = Query(None, description="With end_period: list every month of the window"),
    end_period: Optional[str] = Query(None),
):
    """Months with their close status (open / closed, by whom, when) and how many actuals they hold."""
    if bool(start_period) != bool(end_period):
        raise HTTPException(status_code=422, detail="Give both start_period and end_period, or neither")
    if start_period:
        _check_window(start_period, end_period)
    conn = db_manager.get_connection()
    try:
        data = actuals_service.list_periods(conn, start_period, end_period)
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data=data, message=f"{len(data['closed_periods'])} closed month(s)")


@router.post("/actuals/periods/{period}/close", response_model=ForecastResponse)
async def close_actuals_period(period: str, request: Request, payload: Optional[Dict[str, Any]] = Body(None)):
    """Close a month: its actuals cannot be imported, changed, deleted or undone until it is reopened.
    Body: {closed_by?, note?} (closed_by defaults to the X-Forecast-User header). Closing a closed month
    changes nothing."""
    period = _check_period(period)
    payload = payload or {}
    closed_by = payload.get("closed_by") or request.headers.get("x-forecast-user")
    conn = db_manager.get_connection()
    try:
        result = actuals_service.close_period(conn, period, closed_by, payload.get("note"))
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data=result, message=result["message"])


@router.post("/actuals/periods/{period}/reopen", response_model=ForecastResponse)
async def reopen_actuals_period(period: str, request: Request, payload: Optional[Dict[str, Any]] = Body(None)):
    """Reopen a closed month. Body: {reason (required), reopened_by?} (reopened_by defaults to the
    X-Forecast-User header); the reason is kept with the month (``note``, newest first, also after the
    month is closed again)."""
    period = _check_period(period)
    payload = payload or {}
    reopened_by = payload.get("reopened_by") or request.headers.get("x-forecast-user")
    conn = db_manager.get_connection()
    try:
        result = actuals_service.reopen_period(conn, period, payload.get("reason"), reopened_by)
    except actuals_service.ActualsError as exc:
        return _actuals_error(exc)
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data=result, message=result["message"])


# ---------------------------------------------------------------------------
# Assumptions
# ---------------------------------------------------------------------------

@router.get("/assumptions", response_model=ForecastResponse)
async def get_assumptions(forecast_id: str = Query(...)):
    conn = db_manager.get_connection()
    try:
        assumptions, found = load_assumptions(conn.cursor(), forecast_id)
    finally:
        db_manager.close_connection(conn)
    assumptions = {**assumptions, "forecast_id": forecast_id, "found": found}
    return ForecastResponse(
        status="success",
        data={"assumptions": assumptions, "defaults": DEFAULT_ASSUMPTIONS},
        message="Assumptions retrieved" if found else "No saved assumptions; defaults returned",
    )


@router.put("/assumptions", response_model=ForecastResponse)
async def save_assumptions(forecast_id: str = Query(...), payload: FinancialAssumptionsUpdate = None):
    if payload is None:
        raise HTTPException(status_code=422, detail="Request body required")
    if payload.opening_period:
        try:
            validate_period(payload.opening_period)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
    data = payload.dict()
    # Optional newer fields: leaving them out keeps the stored value, so an
    # older client that does not know the field cannot reset it.
    for optional_key in ("excise_payable_days",):
        if data.get(optional_key) is None:
            data.pop(optional_key, None)
        elif float(data[optional_key]) < 0:
            raise HTTPException(status_code=422, detail=f"{optional_key} must be zero or more")
    columns = list(data.keys())
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM forecast WHERE forecast_id = ?", (forecast_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail=f"Forecast '{forecast_id}' not found")
        placeholders = ", ".join("?" for _ in columns)
        updates = ", ".join(f"{c} = excluded.{c}" for c in columns)
        cursor.execute(
            f"""
            INSERT INTO financial_assumptions (forecast_id, {', '.join(columns)}, updated_at)
            VALUES (?, {placeholders}, CURRENT_TIMESTAMP)
            ON CONFLICT(forecast_id) DO UPDATE SET {updates}, updated_at = CURRENT_TIMESTAMP
            """,
            [forecast_id] + [data[c] for c in columns],
        )
        conn.commit()
        assumptions, _ = load_assumptions(cursor, forecast_id)
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data={"assumptions": assumptions}, message="Assumptions saved")


# ---------------------------------------------------------------------------
# Capital expenditures
# ---------------------------------------------------------------------------

def _capex_rows(cursor, forecast_id: Optional[str]) -> List[Dict[str, Any]]:
    if forecast_id:
        cursor.execute(
            "SELECT * FROM capital_expenditures WHERE forecast_id = ? OR forecast_id IS NULL ORDER BY purchase_period, asset_name",
            (forecast_id,),
        )
    else:
        cursor.execute("SELECT * FROM capital_expenditures ORDER BY purchase_period, asset_name")
    columns = [d[0] for d in cursor.description]
    rows = []
    for row in cursor.fetchall():
        item = dict(zip(columns, row))
        item["is_active"] = bool(item.get("is_active", 1))
        rows.append(item)
    return rows


@router.get("/capex", response_model=ForecastResponse)
async def list_capex(forecast_id: Optional[str] = Query(None)):
    conn = db_manager.get_connection()
    try:
        rows = _capex_rows(conn.cursor(), forecast_id)
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data={"capex": rows}, message=f"Retrieved {len(rows)} capital item(s)")


@router.post("/capex", response_model=ForecastResponse)
async def create_capex(item: CapitalExpenditureCreate):
    try:
        validate_period(item.purchase_period)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if item.useful_life_months < 0 or item.amount < 0:
        raise HTTPException(status_code=422, detail="amount and useful_life_months must be non-negative")
    capex_id = f"CAPEX-{uuid.uuid4().hex[:8].upper()}"
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO capital_expenditures (
                capex_id, forecast_id, asset_name, category, amount, purchase_period,
                useful_life_months, salvage_value, depreciation_method, description, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (capex_id, item.forecast_id, item.asset_name, item.category, item.amount, item.purchase_period,
             item.useful_life_months, item.salvage_value, item.depreciation_method, item.description,
             1 if item.is_active else 0),
        )
        conn.commit()
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data={"capex_id": capex_id}, message="Capital item created")


@router.put("/capex/{capex_id}", response_model=ForecastResponse)
async def update_capex(capex_id: str, item: CapitalExpenditureUpdate):
    updates = item.dict(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")
    if "purchase_period" in updates and updates["purchase_period"]:
        try:
            validate_period(updates["purchase_period"])
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
    if "is_active" in updates and updates["is_active"] is not None:
        updates["is_active"] = 1 if updates["is_active"] else 0
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM capital_expenditures WHERE capex_id = ?", (capex_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Capital item not found")
        assignments = ", ".join(f"{k} = ?" for k in updates)
        cursor.execute(
            f"UPDATE capital_expenditures SET {assignments}, updated_at = CURRENT_TIMESTAMP WHERE capex_id = ?",
            list(updates.values()) + [capex_id],
        )
        conn.commit()
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data={"capex_id": capex_id}, message="Capital item updated")


@router.delete("/capex/{capex_id}", response_model=ForecastResponse)
async def delete_capex(capex_id: str):
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM capital_expenditures WHERE capex_id = ?", (capex_id,))
        deleted = cursor.rowcount
        conn.commit()
    finally:
        db_manager.close_connection(conn)
    if not deleted:
        raise HTTPException(status_code=404, detail="Capital item not found")
    return ForecastResponse(status="success", data={"capex_id": capex_id}, message="Capital item deleted")
