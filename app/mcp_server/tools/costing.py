"""Product costing tools: cost rollups, utilization and BOM repricing."""
from __future__ import annotations

from typing import Annotated, Any, Dict, List, Optional
from urllib.parse import quote

from pydantic import Field
from mcp.server.mcpserver.exceptions import ToolError

import db.database as dbmod
from services.model_adjustments import AdjustmentError, adjust_material_costs
from utils.cost_rollup import bom_line_cost
from mcp_server.core import DESTRUCTIVE, READ, call, drop_keys, mcp

Scenario = Annotated[Optional[str], Field(description=(
    "Scenario id whose sales quantities drive the numbers; omit for the base scenario "
    "(the response's forecast_id says which one was used)"))]
Start = Annotated[Optional[str], Field(description="YYYY-MM window start; defaults to the scenario's first sales month")]
End = Annotated[Optional[str], Field(description="YYYY-MM window end; defaults to the scenario's last sales month")]
Monthly = Annotated[bool, Field(description="Include the per-month arrays (larger response)")]

#: Per-month arrays the utilization endpoints return; dropped unless include_monthly.
MONTHLY_KEYS = ("monthly", "by_period", "periods")


def _window(forecast_id: Optional[str], start_period: Optional[str], end_period: Optional[str]) -> Dict[str, Any]:
    return {"forecast_id": forecast_id, "start_period": start_period, "end_period": end_period}


def _trim(body: Dict[str, Any], include_monthly: bool) -> Dict[str, Any]:
    out = body if include_monthly else drop_keys(body, MONTHLY_KEYS)
    out.pop("metadata", None)
    return out


async def _check_scenario(forecast_id: Optional[str]) -> None:
    """An unknown scenario id is an error (the costing endpoints would answer with zeros)."""
    if forecast_id is None or not str(forecast_id).strip():
        return
    try:
        await call("GET", f"/forecast/scenario/{quote(str(forecast_id).strip(), safe='')}")
    except ToolError as exc:
        if "404" in str(exc):
            raise ToolError(f"Scenario '{forecast_id}' not found; see forecast_list_scenarios")
        raise


def _top(body: Dict[str, Any], key: str, top_n: int, sort_key: Optional[str] = None) -> None:
    """Keep the first ``top_n`` entries of body[key] (largest ``sort_key`` first); report how many were left out."""
    items = body.get(key)
    if not isinstance(items, list):
        return
    if sort_key:
        items = sorted(items, key=lambda r: -float((r or {}).get(sort_key) or 0))
    body[key] = items[:top_n]
    body[f"{key}_total_count"] = len(items)
    if len(items) > top_n:
        body[f"{key}_omitted"] = len(items) - top_n
        body["hint"] = (f"{len(items) - top_n} more {key.replace('_', ' ')} not shown (totals cover all); raise "
                        f"top_n or filter by unit_id")


TopN = Annotated[int, Field(description="Max products listed, largest net sales first (totals cover all)", ge=1, le=2000)]


@mcp.tool(name="forecast_product_cost_summary", annotations=READ)
async def product_cost_summary(forecast_id: Scenario = None, start_period: Start = None,
                               end_period: End = None,
                               unit_id: Annotated[Optional[str], Field(description="Only this product")] = None,
                               top_n: TopN = 50) -> Dict[str, Any]:
    """Per-product forecast quantity, gross / net sales, material / labor /
    machine cost, total product COGS and gross margin for the window, rolled
    up from BOM + routing for the scenario's quantities (ties to the
    statements' product COGS). Includes per-unit costs and data-quality
    warnings for products missing a BOM, routing, machine or labor rate.
    Lists the top_n products by net sales; summary.totals cover every
    product. An unknown scenario id is an error."""
    await _check_scenario(forecast_id)
    body = _trim(await call("GET", "/products/cost-summary", params=_window(forecast_id, start_period, end_period)), True)
    if unit_id:
        products = [p for p in body.get("products") or [] if p.get("product_id") == unit_id]
        if not products:
            raise ToolError(f"Product '{unit_id}' not found; check ids with forecast_query_table(table='units')")
        body["products"] = products
    _top(body, "products", top_n, "net_sales")
    return body


@mcp.tool(name="forecast_unit_cost_preview", annotations=READ)
async def unit_cost_preview(
    bom_id: Optional[str] = None,
    bom_version: Annotated[str, Field(description="BOM version string, e.g. '1.0'")] = "1.0",
    router_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Per-unit material, labor and machine cost for a BOM + routing
    combination (what a product using them costs), with data-quality
    warnings. Use it to check a product right after loading its BOM and
    routing."""
    return await call("GET", "/products/unit-cost", params={
        "bom_id": bom_id, "bom_version": bom_version, "router_id": router_id,
    })


@mcp.tool(name="forecast_cost_breakdown", annotations=READ)
async def cost_breakdown(
    forecast_id: Scenario = None,
    unit_id: Annotated[Optional[str], Field(description="Limit to one product")] = None,
    include_lines: Annotated[Optional[bool], Field(description=(
        "Include each BOM line and routing step; defaults to true with unit_id, false otherwise "
        "(one summary row per product)"))] = None,
    start_period: Start = None,
    end_period: End = None,
    top_n: Annotated[int, Field(description="Max products listed, largest forecast net sales first", ge=1, le=2000)] = 50,
) -> Dict[str, Any]:
    """Per-unit COGS per product: material, labor and machine cost, and with
    include_lines each BOM material line and each routing operation with
    its labor and machine cost. `margin` / `margin_percentage` are against
    the product's LIST price (units.base_price), not the forecast's selling
    prices; for margin at forecast prices use forecast_product_cost_summary.
    forecast_quantity / forecast_net_sales are the window's sales. Lists the
    top_n products by forecast net sales."""
    await _check_scenario(forecast_id)
    body = await call("GET", "/source-data/cost-breakdown", params={
        **_window(forecast_id, start_period, end_period), "unit_id": unit_id,
    })
    lines = include_lines if include_lines is not None else bool(unit_id)
    if not lines:
        for product in body.get("cost_breakdown") or []:
            if isinstance(product, dict):
                product["bom_line_count"] = len(product.pop("bom_items", None) or [])
                product["routing_step_count"] = len(product.pop("router_operations", None) or [])
    _top(body, "cost_breakdown", top_n, "forecast_net_sales")
    return _trim(body, False)


#: Products / BOMs named per material unless include_products (the counts are always given).
MATERIAL_USERS_SHOWN = 3


@mcp.tool(name="forecast_materials_usage", annotations=READ)
async def materials_usage(
    forecast_id: Scenario = None, start_period: Start = None, end_period: End = None,
    top_n: Annotated[int, Field(description="Max materials listed, largest spend first (totals cover every material)",
                                ge=1, le=5000)] = 50,
    material_contains: Annotated[Optional[str], Field(
        description="Case-insensitive substring of the material description, e.g. 'barrel'")] = None,
    bom_id: Annotated[Optional[str], Field(description="Only materials of this BOM")] = None,
    include_products: Annotated[bool, Field(
        description="List every product and BOM using each material (default: the first 3 plus counts)")] = False,
    include_monthly: Monthly = False,
) -> Dict[str, Any]:
    """Total quantity and spend per material for the scenario's forecast
    volume in the window, largest spend first, with the products and BOMs
    that use each material; totals tie to the statements' material COGS
    (and always cover every material, also when the list is cut to top_n or
    filtered: filtered_totals then gives the filter's share)."""
    body = await call("GET", "/products/materials/usage", params=_window(forecast_id, start_period, end_period))
    materials = body.get("materials") or []
    filters: Dict[str, Any] = {}
    if material_contains:
        wanted = material_contains.strip().lower()
        materials = [m for m in materials if wanted in str(m.get("material_description") or "").lower()]
        filters["material_contains"] = material_contains
    if bom_id:
        prefix = f"{bom_id.strip()} v"
        materials = [m for m in materials if any(str(b).startswith(prefix) for b in m.get("boms") or [])]
        filters["bom_id"] = bom_id
    materials = sorted(materials, key=lambda m: -float(m.get("total_cost") or 0))
    shown = []
    for m in materials[:top_n]:
        m = dict(m)
        m["products_using_count"] = len(m.get("products_using") or [])
        m["boms_count"] = len(m.get("boms") or [])
        if not include_products:
            m["products_using"] = (m.get("products_using") or [])[:MATERIAL_USERS_SHOWN]
            m["boms"] = (m.get("boms") or [])[:MATERIAL_USERS_SHOWN]
        shown.append(m)
    body["materials"] = shown
    body["materials_total_count"] = len(materials)
    if len(materials) > top_n:
        body["materials_omitted"] = len(materials) - top_n
        body["hint"] = (f"{len(materials) - top_n} smaller materials not listed (totals cover all); raise top_n or "
                        f"filter with material_contains / bom_id")
    if filters:
        body["filters"] = filters
        body["filtered_totals"] = {"material_count": len(materials),
                                   "total_cost": round(sum(float(m.get("total_cost") or 0) for m in materials), 2)}
    return _trim(body, include_monthly)


@mcp.tool(name="forecast_machine_utilization", annotations=READ)
async def machine_utilization(forecast_id: Scenario = None, start_period: Start = None, end_period: End = None,
                              include_monthly: Monthly = False) -> Dict[str, Any]:
    """Machine hours needed versus capacity, per machine, month by month for
    the window. utilization_percent is the AVERAGE month (average monthly
    required minutes / available_minutes_per_month); peak_utilization_percent
    and peak_period are the busiest month; over_capacity_periods lists the
    months over 100%. Report both average and peak. A machine with no
    capacity set has utilization null and a capacity_not_set warning.
    totals (every machine together: total_hours_required, total_cost, and
    with include_monthly the months) is the income statement's machine line
    (cogs_manufacturing) to the cent; quote it rather than adding up the
    machines' total_cost, which are rounded one by one."""
    body = await call("GET", "/products/machines/utilization", params=_window(forecast_id, start_period, end_period))
    if body.get("machines") and body.get("forecast_id") and body.get("start_period") and body.get("end_period"):
        labor = await call("GET", "/reporting/labor-forecast", params={
            "forecast_ids": body["forecast_id"], "start_period": body["start_period"],
            "end_period": body["end_period"]})
        machine_totals = labor.get("machine_totals") or {}
        body["totals"] = {
            "machine_count": len(body["machines"]),
            "total_hours_required": machine_totals.get("hours"),
            "total_cost": machine_totals.get("cost"),
            "monthly": [{"period": r.get("period"), "hours_required": r.get("hours"), "cost": r.get("cost")}
                        for r in labor.get("machine_totals_by_period") or []],
            "note": machine_totals.get("note"),
        }
    return _trim(body, include_monthly)


@mcp.tool(name="forecast_labor_utilization", annotations=READ)
async def labor_utilization(forecast_id: Scenario = None, start_period: Start = None, end_period: End = None,
                            include_monthly: Monthly = False) -> Dict[str, Any]:
    """Direct labor hours and cost per labor type for the scenario's volume
    in the window (from the routings), with average and peak monthly hours
    and FTEs. For a month-by-month labor forecast use forecast_labor_forecast."""
    body = await call("GET", "/products/labor/utilization", params=_window(forecast_id, start_period, end_period))
    return _trim(body, include_monthly)


@mcp.tool(name="forecast_list_bom", annotations=READ)
async def list_bom(
    bom_id: Annotated[Optional[str], Field(description="One BOM; omit for all lines")] = None,
    version: Annotated[Optional[str], Field(description="BOM version, e.g. '1.0'")] = None,
    material_contains: Annotated[Optional[str], Field(description="Case-insensitive substring of material_description, e.g. 'steel'")] = None,
    limit: Annotated[int, Field(description="Max lines returned (totals cover every matching line)", ge=1, le=2000)] = 100,
) -> Dict[str, Any]:
    """List BOM lines (material, qty, unit price, line cost) with the products
    that use each BOM and the record_id forecast_update_record needs. Use it
    to see what a material change touches. line_cost = qty x unit_price
    (the stored material_cost when price or qty is missing), which is what
    the costing engine uses."""
    where: List[str] = []
    params: List[Any] = []
    if bom_id:
        where.append("b.bom_id = ?")
        params.append(bom_id)
    if version:
        where.append("b.version = ?")
        params.append(version)
    if material_contains:
        where.append("LOWER(COALESCE(b.material_description, '')) LIKE ?")
        params.append(f"%{material_contains.lower()}%")
    conn = dbmod.db_manager.get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""
            SELECT b.bom_id, b.version, b.bom_line, b.material_description, b.qty, b.unit,
                   b.unit_price, b.material_cost, b.target_cost,
                   (SELECT GROUP_CONCAT(u.unit_id) FROM units u
                     WHERE u.bom_id = b.bom_id AND u.bom_version = b.version) AS used_by
            FROM bom b
            {('WHERE ' + ' AND '.join(where)) if where else ''}
            ORDER BY b.bom_id, b.version, b.bom_line
            """,
            params,
        )
        columns = [d[0] for d in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
    finally:
        dbmod.db_manager.close_connection(conn)
    total = 0.0
    for row in rows:
        row["record_id"] = f"{row['bom_id']}-{row['version']}-{row['bom_line']}"
        row["used_by"] = row["used_by"].split(",") if row.get("used_by") else []
        row["line_cost"] = bom_line_cost(row.get("qty"), row.get("unit_price"), row.get("material_cost"))
        total += row["line_cost"]
    out: Dict[str, Any] = {"count": len(rows), "material_cost_total": round(total, 4), "lines": rows[:limit]}
    if len(rows) > limit:
        out["lines_truncated"] = True
        out["hint"] = "Filter by bom_id or material_contains, or raise limit"
    return out


@mcp.tool(name="forecast_adjust_material_costs", annotations=DESTRUCTIVE)
async def adjust_material_costs_tool(
    material_contains: Annotated[Optional[str], Field(description="Case-insensitive substring of material_description, e.g. 'steel'")] = None,
    bom_ids: Annotated[Optional[List[str]], Field(description="Restrict to these BOM ids")] = None,
    bom_version: Annotated[Optional[str], Field(description="Restrict to one BOM version")] = None,
    price_multiplier: Annotated[Optional[float], Field(description="Multiply unit_price (1.12 = +12%)", ge=0)] = None,
    price_delta: Annotated[Optional[float], Field(description="Add to unit_price per unit of material")] = None,
    unit_price: Annotated[Optional[float], Field(description="Set unit_price to this value", ge=0)] = None,
    dry_run: Annotated[bool, Field(description="Preview matched lines and the per-product impact without writing")] = False,
) -> Dict[str, Any]:
    """Bulk re-price BOM material lines, e.g. 'steel is going up 12%' =>
    material_contains='steel', price_multiplier=1.12. Keeps material_cost =
    qty x unit_price and reports the per-unit material cost change for every
    product that uses the touched BOMs. BOMs are company-wide, not scenario
    data: the change applies to every scenario and every period, and
    branching a scenario does not isolate it. Snapshot first with
    forecast_save_database, preview with dry_run=true, and show the impact
    by running forecast_financial_statements before and after."""
    conn = dbmod.db_manager.get_connection()
    try:
        result = adjust_material_costs(
            conn.cursor(), material_contains=material_contains, bom_ids=bom_ids, bom_version=bom_version,
            price_multiplier=price_multiplier, price_delta=price_delta, unit_price=unit_price, dry_run=dry_run,
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
    if result["matched_lines"] == 0:
        result["hint"] = "No BOM lines matched; check material names with forecast_list_bom"
    return result
