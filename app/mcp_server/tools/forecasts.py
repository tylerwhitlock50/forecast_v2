"""
Operating forecast tools: the COGS forecast (gross sales -> deductions ->
net sales -> COGS -> gross profit by month, product, customer, customer
type, product type, unit costs), the labor forecast (hours / cost / FTE by
labor type by month, machine hours vs capacity), the flat sales detail and
the Excel workbook export.

The first three wrap /reporting/cogs-forecast, /reporting/labor-forecast and
/reporting/sales-detail and only reshape the response into compact tables.
The export calls services.workbook_export.write_workbook directly (the
REST endpoint streams the file to a browser; an assistant needs it saved
on disk) into <data dir>/exports/.

Window: start_period / end_period default to the scenarios' sales window.
Percent fields ending in _pct are percentages (37.5 = 37.5%).
"""
import os
from typing import Annotated, Any, Dict, List, Literal, Optional

import anyio
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import Field

import db.database as dbmod
from utils.period_normalizer import normalize_month
from mcp_server.core import READ, UPSERT, call
from mcp_server.tools._common import (
    cap, clean_ids, compact_warnings, drop_empty, no_sales_hint, out, register, report_totals_block, scenario_window,
    table,
)

ForecastIds = Annotated[List[str], Field(description="Scenario ids, usually one, e.g. ['F001']", min_length=1)]
Start = Annotated[Optional[str], Field(description="First month YYYY-MM (default: the scenarios' first sales month)")]
End = Annotated[Optional[str], Field(description="Last month YYYY-MM, inclusive (default: the last sales month)")]
DEFAULT_HOURS_PER_FTE = 173.33
DOCKER_DATA_DIR = "/data"   # the API container's data volume (./data on the host, see docker-compose.yml)

BRIDGE_COLUMNS = (
    "period", "units", "gross_sales", "terms_allowance", "chargebacks", "other_allowances", "excise_tax",
    "total_sales_deductions", "net_sales", "materials", "labor", "machine", "product_cogs", "factory_overhead",
    "other_cogs", "total_cogs", "gross_profit", "gross_margin_pct", "commissions", "contribution_margin",
    "contribution_margin_pct",
)
GROUP_METRICS = (
    "units", "gross_sales", "terms_allowance", "chargebacks", "other_allowances", "excise_tax",
    "total_sales_deductions", "net_sales", "commissions", "materials", "labor", "machine", "product_cogs",
    "contribution_margin", "contribution_margin_pct", "avg_gross_price", "avg_net_price", "cost_per_unit",
)
ADDITIVE = ("units", "gross_sales", "terms_allowance", "chargebacks", "other_allowances", "excise_tax",
            "total_sales_deductions", "net_sales", "commissions", "materials", "labor", "machine", "product_cogs",
            "contribution_margin")
GROUP_HEADERS = {
    "product": ("by_product", ("unit_id", "unit_name", "unit_type")),
    "customer": ("by_customer", ("customer_id", "customer_name", "customer_type")),
    "customer_type": ("by_customer_type", ("customer_type",)),
    "product_type": ("by_product_type", ("unit_type",)),
}
PERIOD_METRICS = ("units", "gross_sales", "total_sales_deductions", "net_sales", "product_cogs", "contribution_margin")
UNIT_COST_COLUMNS = ("unit_id", "unit_name", "bom_id", "bom_version", "router_id", "material_per_unit",
                     "labor_per_unit", "machine_per_unit", "total_per_unit", "labor_minutes_per_unit",
                     "machine_minutes_per_unit", "warnings")
DEFAULT_DETAIL_COLUMNS = ("period", "customer_id", "unit_id", "quantity", "unit_price", "gross_sales",
                          "total_sales_deductions", "net_sales", "product_cogs", "contribution_margin")


def _query(ids: List[str], start: str, end: str, **extra: Any) -> Dict[str, Any]:
    return {"forecast_ids": ids, "start_period": start, "end_period": end, **extra}


def _group_rows(groups: List[Dict[str, Any]], headers: tuple, periods: List[str], top_n: int,
                include_periods: bool) -> Dict[str, Any]:
    shown, omitted = cap(groups, top_n)
    rows = []
    for g in shown:
        row = {h: g.get(h) for h in headers}
        row.update({m: (g.get("totals") or {}).get(m) for m in GROUP_METRICS})
        rows.append(row)
    result: Dict[str, Any] = {"total_groups": len(groups), "table": table(rows, (*headers, *GROUP_METRICS))}
    if omitted:
        others = {m: sum(float((g.get("totals") or {}).get(m) or 0) for g in groups[top_n:]) for m in ADDITIVE}
        others["groups"] = omitted
        result["others"] = others
    if include_periods:
        result["periods"] = periods
        result["by_period"] = [
            {**{h: g.get(h) for h in headers},
             **{m: [((g.get("by_period") or {}).get(p) or {}).get(m) for p in periods] for m in PERIOD_METRICS}}
            for g in shown
        ]
    return result


@register("forecast_cogs_forecast", READ)
async def cogs_forecast(
    forecast_ids: ForecastIds,
    start_period: Start = None,
    end_period: End = None,
    group_by: Annotated[Literal["summary", "product", "customer", "customer_type", "product_type", "unit_costs"], Field(
        description="summary: the monthly bridge gross sales -> each deduction -> net sales -> materials / labor / "
                    "machine -> overhead -> total COGS -> gross profit (ties to the income statement). product / "
                    "customer / customer_type / product_type: contribution margin (before overhead) per group, "
                    "largest net sales first. unit_costs: per-unit material / labor / machine cost and minutes "
                    "per product sold, with cost-data warnings.")] = "summary",
    include_periods: Annotated[bool, Field(
        description="Groups only: add per-month arrays (units, gross, deductions, net, COGS, margin) aligned with "
                    "'periods'")] = False,
    top_n: Annotated[int, Field(description="Max groups / products returned; the rest are summed in 'others'",
                                ge=1, le=1000)] = 25,
) -> str:
    """COGS forecast for a scenario window. Always returns the window totals
    (gross sales, deductions, net sales, COGS split, gross profit and
    margin) and warnings; group_by picks the breakdown. Tables are
    {columns, rows}. Amounts in dollars, *_pct in percent. Gross profit
    and COGS equal forecast_financial_statements for the same window;
    per-group figures are contribution margin before factory overhead."""
    ids = clean_ids(forecast_ids, "forecast_ids")
    start, end, sales_window = await scenario_window(ids, start_period, end_period)
    body = await call("GET", "/reporting/cogs-forecast", params=_query(ids, start, end))
    summary = body.get("summary") or {}
    result: Dict[str, Any] = {
        "forecast_ids": ids, "start_period": body.get("start_period"), "end_period": body.get("end_period"),
        "sales_lines": body.get("line_count"), "deduction_rule_count": body.get("deduction_rule_count"),
        "group_by": group_by, "totals": summary.get("totals") or {},
    }
    periods = body.get("periods") or []
    if group_by == "summary":
        result["by_period"] = table(summary.get("by_period") or [], BRIDGE_COLUMNS)
    elif group_by == "unit_costs":
        costs = []
        for uc in body.get("unit_costs") or []:
            row = dict(uc)
            row["warnings"] = ", ".join(uc.get("warnings") or []) or None
            costs.append(row)
        shown, omitted = cap(costs, top_n)
        result["unit_costs"] = table(shown, UNIT_COST_COLUMNS)
        if omitted:
            result["unit_costs_omitted"] = omitted
    else:
        key, headers = GROUP_HEADERS[group_by]
        result[key] = _group_rows(body.get(key) or [], headers, periods, top_n, include_periods)
    warnings = compact_warnings(body.get("warnings"))
    if warnings:
        result["warnings"] = warnings
    hint = no_sales_hint(body.get("line_count"), start, end, sales_window)
    if hint:
        result["hint"] = hint
    return out(result)


@register("forecast_labor_forecast", READ)
async def labor_forecast(
    forecast_ids: ForecastIds,
    start_period: Start = None,
    end_period: End = None,
    hours_per_fte: Annotated[float, Field(
        description="Paid hours per FTE per month (40 x 52 / 12 = 173.33); lower it for productive hours", gt=0)
    ] = DEFAULT_HOURS_PER_FTE,
    include_machines: Annotated[bool, Field(description="Machine hours vs capacity by month")] = True,
    include_products: Annotated[bool, Field(description="Labor hours and cost per product (top_n)")] = False,
    top_n: Annotated[int, Field(description="Max products when include_products", ge=1, le=1000)] = 25,
) -> str:
    """Direct labor forecast from routings x the sales forecast: hours,
    cost and FTEs (hours / hours_per_fte) by labor type by month, as arrays
    aligned with 'periods'; machine hours, utilization % of monthly capacity
    and over-capacity months; optional labor per product. Labor cost equals
    the income statement's direct labor (cogs_labor); payroll_note compares
    it with payroll (production workers in both are counted twice)."""
    ids = clean_ids(forecast_ids, "forecast_ids")
    start, end, sales_window = await scenario_window(ids, start_period, end_period)
    body = await call("GET", "/reporting/labor-forecast", params=_query(ids, start, end, hours_per_fte=hours_per_fte))
    periods = body.get("periods") or []
    by_period = {r.get("period"): r for r in body.get("totals_by_period") or []}

    def series(source: Dict[str, Any], metric: str) -> List[Any]:
        return [((source or {}).get(p) or {}).get(metric) for p in periods]

    result: Dict[str, Any] = {
        "forecast_ids": ids, "start_period": body.get("start_period"), "end_period": body.get("end_period"),
        "hours_per_fte": body.get("hours_per_fte"), "periods": periods,
        "totals": body.get("totals"),
        "by_period": {m: series(by_period, m) for m in ("hours", "cost", "fte")},
        "by_labor_type": [
            {"labor_type_id": t.get("labor_type_id"), "name": t.get("labor_type_name"),
             "hourly_rate": t.get("hourly_rate"), "totals": t.get("totals"),
             **{m: series(t.get("by_period"), m) for m in ("hours", "cost", "fte")}}
            for t in body.get("by_labor_type") or []
        ],
    }
    if include_machines:
        result["by_machine"] = [
            drop_empty({"machine_id": m.get("machine_id"), "name": m.get("machine_name"),
                        "machine_rate": m.get("machine_rate"),
                        "available_hours_per_month": m.get("available_hours_per_month"),
                        "totals": m.get("totals"), "over_capacity_periods": m.get("over_capacity_periods"),
                        "hours": series(m.get("by_period"), "hours"),
                        "utilization_pct": series(m.get("by_period"), "utilization_pct")},
                       keep=("available_hours_per_month",))
            for m in body.get("by_machine") or []
        ]
    if include_products:
        products = body.get("by_product") or []
        shown, omitted = cap(products, top_n)
        result["by_product"] = table(shown, ("unit_id", "unit_name", "units", "labor_hours", "labor_hours_per_unit",
                                             "labor_cost", "machine_hours"))
        if omitted:
            result["by_product_omitted"] = omitted
    note = body.get("payroll_note") or {}
    result["payroll_note"] = {k: note.get(k) for k in ("direct_labor_cost", "payroll_cost", "message")}
    warnings = compact_warnings(body.get("warnings"))
    if warnings:
        result["warnings"] = warnings
    hint = no_sales_hint(len(body.get("by_product") or []), start, end, sales_window)
    if hint:
        result["hint"] = hint
    return out(result)


@register("forecast_sales_detail", READ)
async def sales_detail(
    forecast_ids: ForecastIds,
    start_period: Start = None,
    end_period: End = None,
    columns: Annotated[Optional[List[str]], Field(
        description="Columns to return (default: period, customer_id, unit_id, quantity, unit_price, gross_sales, "
                    "total_sales_deductions, net_sales, product_cogs, contribution_margin). Also available: "
                    "forecast_id, sale_id, customer_name, customer_type, unit_name, unit_type, terms_allowance, "
                    "chargebacks, other_allowances, excise_tax, commissions, materials, labor, machine, labor_hours, "
                    "machine_hours, rules_applied")] = None,
    customer_id: Annotated[Optional[str], Field(description="Only this customer")] = None,
    customer_type: Annotated[Optional[str], Field(description="Only this customer type")] = None,
    unit_id: Annotated[Optional[str], Field(description="Only this product")] = None,
    period: Annotated[Optional[str], Field(description="Only this month (YYYY-MM; Jan-27 / 1/2027 also accepted)")] = None,
    limit: Annotated[int, Field(description="Rows per page", ge=1, le=2000)] = 50,
    offset: Annotated[int, Field(ge=0)] = 0,
) -> str:
    """Every sales line of the window as the statements engine sees it:
    gross sales, each deduction and the rules applied, net sales,
    commissions, material / labor / machine COGS, contribution margin and
    hours. Paged table; totals cover all matching rows: `totals` add up the
    rows as shown (cent-rounded lines), `report_totals` are the
    statement-exact figures (see rounding_note). For totals by month /
    product / customer use forecast_cogs_forecast instead."""
    ids = clean_ids(forecast_ids, "forecast_ids")
    if period is not None and str(period).strip():
        month = normalize_month(period)
        if not month:
            raise ToolError(f"period '{period}' is not a month; use YYYY-MM, e.g. 2027-01")
        period = month
    start, end, sales_window = await scenario_window(ids, start_period, end_period)
    filters = {"customer_id": customer_id, "customer_type": customer_type, "unit_id": unit_id, "period": period}
    active = {k: v for k, v in filters.items() if v}
    if active:
        body = await call("GET", "/reporting/sales-detail", params=_query(ids, start, end, limit=20000, offset=0))
        rows = [r for r in body.get("rows") or []
                if all(str(r.get(k) or "").strip().lower() == str(v).strip().lower() for k, v in active.items())]
        total_count = len(rows)
        if body.get("has_more"):
            raise ToolError("The window has more than 20,000 sales lines; narrow start_period / end_period to filter")
        numeric = [k for k in (rows[0] if rows else {}) if isinstance(rows[0].get(k), (int, float))
                   and k not in ("unit_price",)]
        totals = {k: sum(float(r.get(k) or 0) for r in rows) for k in numeric}
        page = rows[offset:offset + limit]
        exact: Dict[str, Any] = {}
        if rows:
            # The API's statement-exact totals for the same lines (ids as stored: the tool matches any case).
            api_filters = {k: (rows[0].get(k) if k in ("customer_id", "unit_id") else v) for k, v in active.items()}
            check = await call("GET", "/reporting/sales-detail",
                               params=_query(ids, start, end, limit=1, offset=0, **api_filters))
            if check.get("total_count") == total_count:
                exact = report_totals_block(check)
    else:
        body = await call("GET", "/reporting/sales-detail", params=_query(ids, start, end, limit=limit, offset=offset))
        page = body.get("rows") or []
        total_count = body.get("total_count") or 0
        totals = body.get("totals") or {}
        exact = report_totals_block(body)
    available = [c.get("key") for c in body.get("columns") or []] or list(page[0].keys() if page else [])
    wanted = list(columns) if columns else [c for c in DEFAULT_DETAIL_COLUMNS if not available or c in available]
    if available:
        unknown = [c for c in wanted if c not in available]
        if unknown:
            raise ToolError(f"Unknown column(s) {', '.join(unknown)}. Available: {', '.join(available)}")
    returned = len(page)
    result: Dict[str, Any] = {
        "forecast_ids": ids, "start_period": start, "end_period": end,
        "total_count": total_count, "returned": returned, "offset": offset,
        "next_offset": offset + returned if offset + returned < total_count else None,
        "totals": totals,
        **exact,
        "rows": table(page, wanted),
    }
    if active:
        result["filters"] = active
    hint = no_sales_hint(body.get("total_count"), start, end, sales_window)
    if hint:
        result["hint"] = hint
    return out(result)


def _scenario_names(ids: List[str]) -> Dict[str, str]:
    from services.workbook_export import scenario_names

    conn = dbmod.db_manager.get_connection()
    try:
        return scenario_names(conn.cursor(), ids)
    finally:
        dbmod.db_manager.close_connection(conn)


def _write(path: str, ids: List[str], start: str, end: str, hours_per_fte: float) -> Dict[str, Any]:
    from services.workbook_export import write_workbook

    conn = dbmod.db_manager.get_connection()
    try:
        return write_workbook(path, conn.cursor(), ids, start, end, hours_per_fte=hours_per_fte)
    finally:
        dbmod.db_manager.close_connection(conn)


@register("forecast_export_workbook", UPSERT)
async def export_workbook(
    forecast_ids: ForecastIds,
    start_period: Start = None,
    end_period: End = None,
    filename: Annotated[Optional[str], Field(
        description="File name (letters, digits, . _ -; .xlsx added). Default forecast_<scenario name>_<start>_<end>"
                    ".xlsx, e.g. forecast_2027-budget_2027-01_2027-12.xlsx. "
                    "An existing file of the same name is overwritten.")] = None,
    hours_per_fte: Annotated[float, Field(description="Paid hours per FTE per month for the labor sheet", gt=0)
                             ] = DEFAULT_HOURS_PER_FTE,
) -> str:
    """Save the forecast as an Excel workbook in the data folder's exports/
    subfolder: Read Me (how every number is computed, rule precedence,
    warnings), Gross Margin by month, Income Statement, By Product / By
    Customer / By Customer Type, Labor Forecast, Machine Hours, Unit Costs,
    Sales Detail (every line), Deduction Rules, Price List, Cash Flow and
    Balance Sheet. Returns the path (in Docker host_path_hint is where the
    user finds it: ./data/exports/...), the sheet names and the size."""
    from services.workbook_export import export_path

    ids = clean_ids(forecast_ids, "forecast_ids")
    start, end, sales_window = await scenario_window(ids, start_period, end_period)
    data_dir = dbmod.db_manager.data_dir
    names = None if filename else await anyio.to_thread.run_sync(_scenario_names, ids)
    path = export_path(data_dir, ids, start, end, filename, names)
    try:
        saved = await anyio.to_thread.run_sync(_write, path, ids, start, end, float(hours_per_fte))
    except ValueError as exc:
        raise ToolError(f"Cannot build the workbook: {exc}")
    except OSError as exc:
        raise ToolError(f"Cannot write {path}: {exc}")
    except Exception as exc:  # surface the reason; the SDK would hide an unexpected error's text
        raise ToolError(f"Workbook export failed: {type(exc).__name__}: {exc}")
    result: Dict[str, Any] = {
        "path": saved.get("path"), "filename": saved.get("filename"), "bytes": saved.get("bytes"),
        "sheets": saved.get("sheets"), "forecast_ids": ids, "start_period": start, "end_period": end,
        "sales_window": sales_window,
    }
    if os.path.realpath(data_dir) == DOCKER_DATA_DIR:
        result["host_path_hint"] = f"./data/exports/{saved.get('filename')}"
        result["note"] = ("The API runs in Docker: the file is in the data volume, i.e. ./data/exports/ next to "
                          "docker-compose.yml on the host.")
    return out(result)
