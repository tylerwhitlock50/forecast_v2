"""Sales forecast tools: read, upsert, delete, import and bulk adjust."""
from __future__ import annotations

from typing import Annotated, Any, Dict, List, Literal, Optional, Tuple

from pydantic import Field
from mcp.server.mcpserver.exceptions import ToolError

import db.database as dbmod
from services.model_adjustments import AdjustmentError, adjust_sales
from services.workbook_export import sales_detail_totals
from utils.period_normalizer import month_from_name, normalize_month
from mcp_server.core import (
    DESTRUCTIVE, READ, UPSERT, as_table, call, check_row_keys, error_list, format_row_errors, mcp, page,
    require,
)

Layout = Annotated[Literal["table", "records"], Field(description=(
    "table: `columns` once plus one array per row (default, about half the size); records: one object per row"))]

#: Columns of a sales line in the compact (default) view of forecast_list_sales.
COMPACT_SALES_FIELDS = (
    "sale_id", "period", "customer_id", "unit_id", "quantity", "unit_price",
    "gross_sales", "total_sales_deductions", "net_sales", "product_cogs", "contribution_margin",
)
#: Every column a sales line can carry (the /reporting/sales-detail row).
ALL_SALES_FIELDS = (
    "period", "forecast_id", "sale_id", "customer_id", "customer_name", "customer_type", "unit_id", "unit_name",
    "unit_type", "quantity", "unit_price", "gross_sales", "terms_allowance", "chargebacks", "other_allowances",
    "excise_tax", "total_sales_deductions", "net_sales", "commissions", "materials", "labor", "machine",
    "product_cogs", "contribution_margin", "labor_hours", "machine_hours", "rules_applied",
)

PERIOD_FORMATS = ("Periods are calendar months: 2027-01, 2027-1, 2027/01, 1/2027, 1/15/2027, 2027-01-15, "
                  "Jan-27, Jan 2027, January 2027 or an Excel serial date; a bare month name (Jan) needs a year. "
                  "Quarters (2027-Q1), weeks and month 13 are rejected: split them into months.")


async def _scenario(forecast_id: str) -> Dict[str, Any]:
    """The scenario record (404 -> ToolError naming the id)."""
    return await call("GET", f"/forecast/scenario/{forecast_id}")


async def _sales_detail(forecast_id: str, start: str, end: str) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Every sales-detail row of the window (paged through the endpoint) and the endpoint's totals."""
    rows: List[Dict[str, Any]] = []
    totals: Dict[str, Any] = {}
    offset = 0
    while True:
        body = await call("GET", "/reporting/sales-detail", params={
            "forecast_ids": [forecast_id], "start_period": start, "end_period": end, "limit": 20000, "offset": offset,
        })
        chunk = body.get("rows") or []
        rows.extend(chunk)
        totals = body.get("totals") or totals
        if not body.get("has_more") or not chunk:
            return rows, totals
        offset += len(chunk)


@mcp.tool(name="forecast_list_sales", annotations=READ)
async def list_sales(
    forecast_id: Annotated[str, Field(description="Scenario id; sales always belong to one scenario")],
    start_period: Annotated[Optional[str], Field(description="YYYY-MM; defaults to the scenario's first sales month")] = None,
    end_period: Annotated[Optional[str], Field(description="YYYY-MM; defaults to the scenario's last sales month")] = None,
    customer_id: Optional[str] = None,
    unit_id: Annotated[Optional[str], Field(description="Product id")] = None,
    customer_type: Annotated[Optional[str], Field(description="Only customers of this type (case-insensitive), e.g. Distributor")] = None,
    fields: Annotated[Optional[List[str]], Field(description=(
        "Columns per row. Omit for the compact set (" + ", ".join(COMPACT_SALES_FIELDS) + "). "
        "['all'] returns every column: " + ", ".join(ALL_SALES_FIELDS) + "."))] = None,
    limit: Annotated[int, Field(description="Rows to return (totals always cover every matching row)", ge=0, le=500)] = 50,
    offset: Annotated[int, Field(ge=0)] = 0,
    layout: Layout = "table",
) -> Dict[str, Any]:
    """Sales forecast lines of one scenario (one row per customer x product x
    month) with gross sales, sales deductions, net sales and product COGS,
    computed exactly as the statements compute them. Filter by window,
    customer, customer type or product. `totals` always cover ALL matching
    rows (not just the page), so limit=0 answers "how much" without rows.
    For totals by month, product, customer or customer type use
    forecast_revenue_summary (or forecast_cogs_forecast) rather than paging
    through rows; a full year of a real forecast is thousands of rows."""
    fid = require(forecast_id, "forecast_id")
    if fields:
        bad = [f for f in fields if f not in ALL_SALES_FIELDS and f != "all"]
        if bad:
            raise ToolError(f"Unknown fields: {', '.join(bad)}. Choose from {', '.join(ALL_SALES_FIELDS)} or ['all']")
    scenario = await _scenario(fid)
    start = start_period or scenario.get("start_period")
    end = end_period or scenario.get("end_period")
    out: Dict[str, Any] = {"forecast_id": fid}
    if not start or not end:
        out.update({"rows": [], "total_count": 0, "returned": 0, "offset": offset, "has_more": False,
                    "next_offset": None, "totals": {},
                    "message": f"Scenario {fid} has no monthly sales rows yet; import them with forecast_import_sales"})
        return out
    rows, totals = await _sales_detail(fid, start, end)
    filtered = bool(customer_id or unit_id or customer_type)
    if customer_id:
        rows = [r for r in rows if r.get("customer_id") == customer_id]
    if unit_id:
        rows = [r for r in rows if r.get("unit_id") == unit_id]
    if customer_type:
        wanted = customer_type.strip().lower()
        rows = [r for r in rows if (r.get("customer_type") or "").strip().lower() == wanted]
    if filtered:
        totals = sales_detail_totals(rows)
    totals = {"rows": len(rows), **totals}
    paged = page(rows, limit, offset)
    if not fields:
        keep: Optional[Tuple[str, ...]] = COMPACT_SALES_FIELDS
    elif "all" in fields:
        keep = None
    else:
        keep = tuple(fields)
    if keep is not None:
        paged["rows"] = [{k: r.get(k) for k in keep} for r in paged["rows"]]
    if layout == "table":
        shaped = as_table(paged["rows"], list(keep) if keep is not None else None)
        paged["columns"], paged["rows"] = shaped["columns"], shaped["rows"]
    out.update({"start_period": start, "end_period": end, **paged, "totals": totals})
    if paged["has_more"] and limit:
        out["hint"] = ("More rows match; page with offset=next_offset, narrow the filters, or use "
                       "forecast_revenue_summary for grouped totals")
    return out


def _known_ids(table: str, column: str, values: List[str]) -> set:
    """Which of ``values`` exist in ``table.column`` (read-only lookup)."""
    if not values:
        return set()
    conn = dbmod.db_manager.get_connection()
    try:
        cursor = conn.cursor()
        found: set = set()
        unique = sorted(set(values))
        for i in range(0, len(unique), 500):
            chunk = unique[i:i + 500]
            cursor.execute(f"SELECT {column} FROM {table} WHERE {column} IN ({', '.join('?' for _ in chunk)})", chunk)
            found.update(row[0] for row in cursor.fetchall())
        return found
    finally:
        dbmod.db_manager.close_connection(conn)


def _existing_sales_keys(forecast_id: str) -> set:
    """(customer_id, unit_id, period) of every sales row in a scenario."""
    conn = dbmod.db_manager.get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT customer_id, unit_id, period FROM sales WHERE forecast_id = ?", (forecast_id,))
        return {(c, u, str(p)[:7]) for c, u, p in cursor.fetchall()}
    finally:
        dbmod.db_manager.close_connection(conn)


def _number(value: Any, label: str) -> Optional[float]:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if isinstance(value, bool):
        raise ToolError(f"{label} must be a number, got {value!r}")
    try:
        if isinstance(value, str):
            return float(value.replace(",", "").replace("$", "").strip())
        return float(value)
    except (TypeError, ValueError):
        raise ToolError(f"{label} must be a number, got {value!r}")


UPSERT_ROW_FIELDS = ("customer_id", "unit_id", "period", "quantity", "unit_price")


@mcp.tool(name="forecast_upsert_sales", annotations=DESTRUCTIVE)
async def upsert_sales(
    forecast_id: Annotated[str, Field(description="Scenario the rows belong to")],
    rows: Annotated[List[Dict[str, Any]], Field(
        description="Rows of {customer_id, unit_id, period (YYYY-MM), quantity (>= 0), unit_price (optional)}. "
                    "Matched on customer + product + month within the scenario. Ids must already exist "
                    "(create customers / products first).",
        min_length=1)],
    operation: Annotated[str, Field(description="replace (set quantity and price, creating missing rows), "
                                                "add (add quantity to an existing row, or create it when unit_price is given) "
                                                "or subtract (reduce an existing row's quantity; rows that do not exist are skipped)")] = "replace",
    dry_run: Annotated[bool, Field(description="Validate and report what would change without writing")] = False,
) -> Dict[str, Any]:
    """Create or update sales forecast rows, all-or-nothing: if any row is
    invalid (unknown customer / product / scenario, a period that is not a
    month, a negative quantity or price) nothing is written and the error
    names the rows. 'replace' sets quantity and unit_price and creates rows
    that do not exist; a missing or 0 unit_price is filled from the price
    list (customer, then customer type, then all customers) and then the
    product's base price. 'add' / 'subtract' change quantity relative to the
    existing row and keep its price unless a new unit_price is given; 'add'
    to a row that does not exist creates it (unit_price required), 'subtract'
    from one that does not exist is skipped and reported. Revenue is
    quantity x unit_price. For a whole file of rows use forecast_import_sales."""
    if operation not in ("replace", "add", "subtract"):
        raise ToolError("operation must be replace, add or subtract")
    fid = require(forecast_id, "forecast_id")
    check_row_keys(rows, UPSERT_ROW_FIELDS)
    if not _known_ids("forecast", "forecast_id", [fid]):
        raise ToolError(f"Scenario '{fid}' not found; see forecast_list_scenarios")

    items: List[Dict[str, Any]] = []
    problems: List[Dict[str, Any]] = []
    for i, row in enumerate(rows):
        missing = [k for k in ("customer_id", "unit_id", "period") if row.get(k) in (None, "")]
        if missing:
            raise ToolError(f"rows[{i}] is missing {', '.join(missing)}")
        period = normalize_month(row["period"])
        if not period:
            problems.append({"row": i, "error": f"invalid period '{row['period']}': use a month such as 2027-01"})
            continue
        if row.get("quantity") is None:
            problems.append({"row": i, "error": "quantity is required"})
            continue
        qty = _number(row.get("quantity"), f"rows[{i}].quantity")
        price = _number(row.get("unit_price"), f"rows[{i}].unit_price")
        if qty is None or qty < 0:
            problems.append({"row": i, "error": f"quantity must be zero or more, got {row.get('quantity')!r}"})
            continue
        if price is not None and price < 0:
            problems.append({"row": i, "error": f"unit_price cannot be negative ({price:g})"})
            continue
        item = {"forecast_id": fid, "customer_id": str(row["customer_id"]).strip(),
                "unit_id": str(row["unit_id"]).strip(), "period": period, "quantity": qty}
        if price is not None:
            item["unit_price"] = price
            item["total_revenue"] = qty * price
        items.append({"index": i, **item})

    known_customers = _known_ids("customers", "customer_id", [it["customer_id"] for it in items])
    known_units = _known_ids("units", "unit_id", [it["unit_id"] for it in items])
    for it in items:
        if it["customer_id"] not in known_customers:
            problems.append({"row": it["index"], "error": f"customer '{it['customer_id']}' does not exist"})
        elif it["unit_id"] not in known_units:
            problems.append({"row": it["index"], "error": f"product '{it['unit_id']}' does not exist"})
    if problems:
        problems.sort(key=lambda p: p["row"])
        raise ToolError(f"{len(problems)} invalid row(s), nothing written (rows are 0-based): "
                        f"{format_row_errors(problems)}. Check ids with forecast_query_table "
                        f"(customers / units) and create missing ones with forecast_import_customers / "
                        f"forecast_import_products.")

    if operation == "replace":
        payload = {
            "forecast_id": fid,
            "sales": [{k: it[k] for k in ("customer_id", "unit_id", "period", "quantity", "unit_price") if k in it}
                      for it in items],
            "options": {"autoCreate": False, "allowZeroPrice": False},
        }
        preview = await call("POST", "/forecast/smart_import_sales", json={**payload, "dry_run": True})
        errors = preview.get("errors") or []
        if errors:
            errors = [{**e, "row": e["row"] - 1} if isinstance(e, dict) and isinstance(e.get("row"), int) else e
                      for e in errors]
            raise ToolError(f"{len(errors)} row(s) cannot be written, nothing written (rows are 0-based): "
                            f"{format_row_errors(errors)}")
        result = preview if dry_run else await call("POST", "/forecast/smart_import_sales", json={**payload, "dry_run": False})
        return {
            "operation": "replace", "dry_run": dry_run,
            "updated_count": result.get("imported", 0), "inserted": result.get("inserted", 0),
            "updated": result.get("updated", 0), "price_sources": result.get("price_sources", {}),
            "start_period": result.get("start_period"), "end_period": result.get("end_period"),
            "total_quantity": result.get("total_quantity"), "total_revenue": result.get("total_revenue"),
            "warnings": result.get("warnings") or [],
            "message": result.get("message"),
        }

    # add / subtract: relative to the stored row.
    skipped: List[Dict[str, Any]] = []
    existing = _existing_sales_keys(fid)
    forecasts = []
    for it in items:
        key = (it["customer_id"], it["unit_id"], it["period"])
        body = {k: v for k, v in it.items() if k != "index"}
        if key in existing:
            forecasts.append(body)
        elif operation == "subtract":
            skipped.append({"customer_id": key[0], "unit_id": key[1], "period": key[2],
                            "reason": "no existing row to subtract from"})
        elif "unit_price" in body:
            forecasts.append(body)  # creates the row with the given quantity and price
        else:
            raise ToolError(
                f"rows[{it['index']}] ({key[0]} / {key[1]} / {key[2]}) does not exist in scenario {fid}; "
                f"give unit_price to create it, or check ids and periods with forecast_list_sales"
            )
    out: Dict[str, Any] = {"operation": operation, "dry_run": dry_run}
    if skipped:
        out["skipped"] = skipped
    if not forecasts:
        out.update({"updated_count": 0, "message": "No rows changed"})
        return out
    if dry_run:
        out.update({"updated_count": len(forecasts), "message": f"Dry run: {len(forecasts)} row(s) would change"})
        return out
    result = await call("POST", "/forecast/bulk_update", json={"forecasts": forecasts, "operation": operation})
    out.update(result)
    return out


@mcp.tool(name="forecast_delete_sale", annotations=DESTRUCTIVE)
async def delete_sale(sale_id: Annotated[str, Field(description="sale_id of the row (from forecast_list_sales)")]) -> Dict[str, Any]:
    """Delete one sales forecast row."""
    return await call("DELETE", f"/forecast/delete/sales/{require(sale_id, 'sale_id')}")


def _negative_quantity_errors(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Rows (1-based) whose quantity, or a month column of a wide row, is negative."""
    from api.import_routes import SALES_FIELDS, _number as parse_cell

    errors: List[Dict[str, Any]] = []
    for row_no, raw in enumerate(rows, start=1):
        if not isinstance(raw, dict):
            continue
        data, extra = SALES_FIELDS.map_row(raw)
        cells = [("quantity", data.get("quantity"))]
        cells += [(str(k), raw.get(k)) for k in extra if normalize_month(k) or month_from_name(k)]
        for label, cell in cells:
            try:
                value = parse_cell(cell, label)
            except Exception:  # unparseable: the import reports it itself
                continue
            if value is not None and value < 0:
                errors.append({"row": row_no, "error": f"{label} cannot be negative ({value:g})"})
                break
    return errors


@mcp.tool(name="forecast_import_sales", annotations=UPSERT)
async def import_sales(
    forecast_id: Annotated[str, Field(description="Scenario to import into (must exist)")],
    rows: Annotated[Optional[List[Dict[str, Any]]], Field(
        description=(
            "Long rows {customer_id, unit_id, period, quantity, unit_price?} or wide rows {customer_id, unit_id, "
            "'2027-01': qty, '2027-02': qty, ...}. Column names are matched loosely (Customer, SKU, Product, Qty, "
            "Price, Month, ...). customer_name / customer_type / unit_name / unit_type / base_price are used only "
            "when auto_create makes a new customer or product. " + PERIOD_FORMATS + " Give rows OR file_path."))] = None,
    file_path: Annotated[Optional[str], Field(description=(
        "Instead of rows: a .csv/.xlsx the API can read, relative to the data folder (Docker: ./data on the host), "
        "e.g. 'imports/sales_2027.xlsx'. Preferred for real forecasts: rows do not pass through the conversation."))] = None,
    sheet: Annotated[Optional[str], Field(description="XLSX sheet (default: the active one)")] = None,
    header_row: Annotated[Optional[int], Field(description="1-based header row of the file (default: first row with 2+ filled cells)", ge=1)] = None,
    auto_create: Annotated[bool, Field(description="Create customers / products whose id is unknown (with the row's names and types). "
                                                   "Default false: an unknown id is an error, which catches typos")] = False,
    year: Annotated[Optional[int], Field(description="Year for bare month names (Jan, Feb, ...) or month columns without a year", ge=1900, le=2200)] = None,
    allow_zero_price: Annotated[bool, Field(description="Import rows that have no price and no price-list / base price at 0 instead of rejecting them")] = False,
    dry_run: Annotated[bool, Field(description="Validate and report totals without writing (always safe)")] = False,
    allow_partial: Annotated[bool, Field(description="Write the valid rows even when some rows fail (default: all-or-nothing)")] = False,
    mode: Annotated[str, Field(description=(
        "upsert (default): add / update the file's rows and keep the scenario's other rows. "
        "replace: also delete the scenario's rows in the months the file covers that the file no longer has "
        "(re-importing a revised 2027 forecast; other years untouched). replace_all: delete every other row of "
        "the scenario. Replace modes need every row to be valid."))] = "upsert",
) -> Dict[str, Any]:
    """Import a monthly sales forecast into a scenario. Existing rows for the
    same customer + product + month are updated; mode=replace also removes
    stale lines in the file's months. Price: a row's own
    unit_price (> 0) is kept; a blank or 0 price is resolved from the price
    list (customer, then customer type, then all customers) and then the
    product's base price; still-unpriced rows are errors unless
    allow_zero_price. Quantities must be zero or more (decimals are kept).
    All-or-nothing by default: if any row fails, nothing is written and the
    error lists the failing rows (1-based); fix them and call again, or pass
    allow_partial=true. Returns rows imported, price sources and the
    quantity / revenue totals and month range written, so you can reconcile
    against the source file without a second call."""
    fid = require(forecast_id, "forecast_id")
    if mode not in ("upsert", "replace", "replace_all"):
        raise ToolError("mode must be upsert, replace or replace_all")
    if mode != "upsert" and allow_partial:
        raise ToolError("allow_partial cannot be combined with a replace mode: replacing needs every row to be valid")
    from mcp_server.tools.imports import load_rows  # file parsing shared with the other import tools

    rows, source = load_rows(rows, file_path, sheet, header_row)
    local_errors = _negative_quantity_errors(rows)
    bad_rows = {e["row"] for e in local_errors}
    sendable = [(row_no, row) for row_no, row in enumerate(rows, start=1) if row_no not in bad_rows]
    if local_errors and not (allow_partial or dry_run):
        raise ToolError(f"{len(local_errors)} row(s) have a negative quantity, nothing written: "
                        f"{format_row_errors(local_errors)}")
    if not sendable:
        raise ToolError(f"No valid rows to import: {format_row_errors(local_errors)}")

    def body(dry: bool) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "forecast_id": fid, "sales": [row for _, row in sendable], "dry_run": dry, "mode": mode,
            "options": {"autoCreate": auto_create, "allowZeroPrice": allow_zero_price},
        }
        if year is not None:
            payload["year"] = year
        return payload

    def remap(errors: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
        """API row numbers count the rows sent; map them back to the caller's rows."""
        out = []
        for err in errors or []:
            n = err.get("row") if isinstance(err, dict) else None
            if isinstance(n, int) and 1 <= n <= len(sendable):
                err = {**err, "row": sendable[n - 1][0]}
            out.append(err)
        return out

    def by_row(err: Any) -> int:
        return (err.get("row") or 0) if isinstance(err, dict) else 0

    preview = await call("POST", "/forecast/smart_import_sales", json=body(True))
    errors = sorted(local_errors + remap(preview.get("errors")), key=by_row)
    if errors and not (dry_run or allow_partial):
        raise ToolError(f"{len(errors)} of {len(rows)} row(s) failed validation, nothing written: "
                        f"{format_row_errors(errors)}. Fix those rows and call again "
                        f"(or pass allow_partial=true to import the valid rows).")
    result = preview if dry_run else await call("POST", "/forecast/smart_import_sales", json=body(False))
    if result.get("replace_blocked") and not dry_run:
        raise ToolError(f"Nothing was changed: {result.get('message')}")
    if not dry_run:
        errors = sorted(local_errors + remap(result.get("errors")), key=by_row)
    out = {k: v for k, v in result.items() if k != "errors"}
    if source:
        out["source"] = source
    out.update(error_list(errors))
    if dry_run:
        out["status"] = "dry_run_with_errors" if errors else "dry_run"
    else:
        out["status"] = "partial" if errors else "imported"
    return out


#: forecast_revenue_summary group_by spellings the API names differently.
REVENUE_GROUP_ALIASES = {"product": "unit", "unit_type": "product_type"}


@mcp.tool(name="forecast_revenue_summary", annotations=READ)
async def revenue_summary(
    forecast_id: Annotated[str, Field(description="Scenario id")],
    group_by: Annotated[Literal["period", "customer", "unit", "product", "customer_unit", "customer_type", "product_type",
                                "unit_type"], Field(
        description="period, customer, unit (= product), customer_unit, customer_type or product_type (= unit_type)")
    ] = "period",
    start_period: Annotated[Optional[str], Field(description="YYYY-MM; defaults to the scenario's first sales month")] = None,
    end_period: Annotated[Optional[str], Field(description="YYYY-MM; defaults to the scenario's last sales month")] = None,
    limit: Annotated[int, Field(description="Max groups returned (largest first, except group_by=period); totals cover all", ge=1, le=1000)] = 100,
    layout: Layout = "table",
) -> Dict[str, Any]:
    """Sales totals for one scenario grouped by month, customer, product,
    customer + product, customer type or product type: quantity, gross sales
    (quantity x price), sales deductions, net sales, product COGS and gross
    margin %, with avg_unit_price = gross sales / quantity. `totals` cover
    every group. For a monthly P&L use forecast_financial_statements."""
    api_group = REVENUE_GROUP_ALIASES.get(group_by, group_by)
    body = await call("GET", "/source-data/revenue-summary", params={
        "forecast_id": require(forecast_id, "forecast_id"), "group_by": api_group,
        "start_period": start_period, "end_period": end_period,
    })
    groups = body.get("revenue_summary")
    if groups is None:
        groups = body.get("items") or []
    out = {k: v for k, v in body.items() if k not in ("revenue_summary", "items", "metadata")}
    out["group_count"] = len(groups)
    out["groups"] = as_table(groups[:limit]) if layout == "table" else groups[:limit]
    if len(groups) > limit:
        out["groups_truncated"] = True
    return out


@mcp.tool(name="forecast_adjust_sales", annotations=DESTRUCTIVE)
async def adjust_sales_tool(
    forecast_id: Annotated[str, Field(description="Scenario whose sales rows are adjusted")],
    periods: Annotated[Optional[List[str]], Field(description="Explicit months, e.g. ['2026-06', '2026-08', '2026-09']")] = None,
    start_period: Annotated[Optional[str], Field(description="Inclusive window start YYYY-MM (alternative to periods)")] = None,
    end_period: Annotated[Optional[str], Field(description="Inclusive window end YYYY-MM")] = None,
    customer_ids: Annotated[Optional[List[str]], Field(description="Restrict to these customers")] = None,
    customer_types: Annotated[Optional[List[str]], Field(description="Restrict to customers of these types (case-insensitive), e.g. ['Distributor']")] = None,
    unit_ids: Annotated[Optional[List[str]], Field(description="Restrict to these products")] = None,
    unit_types: Annotated[Optional[List[str]], Field(description="Restrict to products of these types (units.unit_type, case-insensitive)")] = None,
    all_rows: Annotated[bool, Field(description="Must be true to adjust EVERY row of the scenario when no filter is given")] = False,
    price_multiplier: Annotated[Optional[float], Field(description="Multiply unit_price (0.65 = 35% discount)", ge=0)] = None,
    price_delta: Annotated[Optional[float], Field(description="Add to unit_price (negative to cut)")] = None,
    price: Annotated[Optional[float], Field(description="Set unit_price to this value", ge=0)] = None,
    quantity_multiplier: Annotated[Optional[float], Field(description="Multiply quantity (1.1 = +10% volume)", ge=0)] = None,
    quantity_delta: Annotated[Optional[float], Field(description="Add to quantity (negative to reduce)")] = None,
    quantity: Annotated[Optional[float], Field(description="Set quantity to this value", ge=0)] = None,
    dry_run: Annotated[bool, Field(description="Preview the matched rows and revenue impact without writing")] = False,
) -> Dict[str, Any]:
    """Bulk re-price and/or re-volume sales rows in a scenario, filtered by
    months, customers / customer types and products / product types (filters
    combine with AND). Example: 'ASP down 35% in June, August and September'
    => periods=[2026-06, 2026-08, 2026-09], price_multiplier=0.65. Give one
    price op and/or one quantity op. New prices are rounded to 4 decimals,
    quantities to whole units; revenue is recomputed. Without any filter the
    tool refuses unless all_rows=true. Run with dry_run=true first and show
    the user the before / after totals."""
    fid = require(forecast_id, "forecast_id")
    if customer_types:
        customer_ids = _ids_of_types("customers", "customer_id", "customer_type", customer_types, customer_ids, "customer")
    if unit_types:
        unit_ids = _ids_of_types("units", "unit_id", "unit_type", unit_types, unit_ids, "product")
    has_filter = bool(periods or start_period or end_period or customer_ids or unit_ids)
    if not has_filter and not all_rows:
        raise ToolError(
            f"No filter given: this would change every sales row of scenario {fid}. Pass periods, "
            f"start_period / end_period, customer_ids, customer_types, unit_ids or unit_types, or all_rows=true "
            f"to adjust the whole scenario. Nothing was changed."
        )
    conn = dbmod.db_manager.get_connection()
    try:
        result = adjust_sales(
            conn.cursor(), fid,
            periods=periods, start_period=start_period, end_period=end_period,
            customer_ids=customer_ids, unit_ids=unit_ids,
            price_multiplier=price_multiplier, price_delta=price_delta, price=price,
            quantity_multiplier=quantity_multiplier, quantity_delta=quantity_delta, quantity=quantity,
            dry_run=dry_run,
        )
        if dry_run:
            conn.rollback()
        else:
            conn.commit()
    except AdjustmentError as exc:
        conn.rollback()
        raise ToolError(str(exc))
    except Exception:
        conn.rollback()
        raise
    finally:
        dbmod.db_manager.close_connection(conn)
    if (customer_types or unit_types) and isinstance(result.get("filters"), dict):
        result["filters"].update({"customer_types": customer_types, "unit_types": unit_types})
    if result.get("matched_rows") == 0:
        result["hint"] = "No sales rows matched; check the scenario id, periods (YYYY-MM) and ids with forecast_list_sales"
    return result


def _ids_of_types(table: str, key: str, type_col: str, types: List[str], ids: Optional[List[str]],
                  label: str) -> List[str]:
    """Ids whose type is one of ``types`` (intersected with ``ids`` when given)."""
    wanted = {t.strip().lower() for t in types if t and t.strip()}
    conn = dbmod.db_manager.get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(f"SELECT {key}, {type_col} FROM {table}")
        records = cursor.fetchall()
    finally:
        dbmod.db_manager.close_connection(conn)
    matched = [rid for rid, rtype in records if (rtype or "").strip().lower() in wanted]
    if not matched:
        known = sorted({str(rtype).strip() for _, rtype in records if rtype and str(rtype).strip()})
        raise ToolError(f"No {label} has {type_col} {', '.join(types)}. Known {type_col} values: "
                        f"{', '.join(known) or '(none set)'}. Nothing was changed.")
    if ids:
        allowed = set(ids)
        matched = [rid for rid in matched if rid in allowed]
        if not matched:
            raise ToolError(f"None of the given {label} ids has {type_col} {', '.join(types)}; nothing matched")
    return matched
