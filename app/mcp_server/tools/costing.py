"""Product costing tools: cost rollups, utilization and BOM repricing."""
from __future__ import annotations

from typing import Annotated, Any, Dict, List, Optional

from pydantic import Field
from mcp.server.fastmcp.exceptions import ToolError

import db.database as dbmod
from services.model_adjustments import AdjustmentError, adjust_material_costs
from mcp_server.core import READ, WRITE, call, mcp, require

Scenario = Annotated[Optional[str], Field(description="Scenario id; quantities come from its sales rows")]


@mcp.tool(name="forecast_product_cost_summary", annotations=READ)
async def product_cost_summary(forecast_id: Scenario = None) -> Dict[str, Any]:
    """Per-product forecasted revenue, material / labor / machine cost, total
    COGS and gross margin, rolled up from BOM + routing for the scenario's
    quantities. Includes data-quality warnings for products missing a BOM,
    router, machine or labor rate."""
    return await call("GET", "/products/cost-summary", params={"forecast_id": forecast_id})


@mcp.tool(name="forecast_unit_cost_preview", annotations=READ)
async def unit_cost_preview(
    bom_id: Optional[str] = None,
    bom_version: str = "1.0",
    router_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Per-unit material, labor and machine cost for a BOM + router combination
    (what a product using them would cost), with data-quality warnings."""
    return await call("GET", "/products/unit-cost", params={
        "bom_id": bom_id, "bom_version": bom_version, "router_id": router_id,
    })


@mcp.tool(name="forecast_cost_breakdown", annotations=READ)
async def cost_breakdown(
    forecast_id: Scenario = None,
    unit_id: Annotated[Optional[str], Field(description="Limit to one product")] = None,
) -> Dict[str, Any]:
    """Line-level COGS breakdown per product: each BOM material line and each
    routing operation with its labor and machine cost."""
    return await call("GET", "/source-data/cost-breakdown", params={"forecast_id": forecast_id, "unit_id": unit_id})


@mcp.tool(name="forecast_materials_usage", annotations=READ)
async def materials_usage(forecast_id: Scenario = None) -> Dict[str, Any]:
    """Total quantity and spend per material across the scenario's forecasted
    volume, with the products that use each material."""
    return await call("GET", "/products/materials/usage", params={"forecast_id": forecast_id})


@mcp.tool(name="forecast_machine_utilization", annotations=READ)
async def machine_utilization(forecast_id: Scenario = None) -> Dict[str, Any]:
    """Required machine minutes versus available minutes per machine for the
    scenario's volume, flagging machines over capacity."""
    return await call("GET", "/products/machines/utilization", params={"forecast_id": forecast_id})


@mcp.tool(name="forecast_labor_utilization", annotations=READ)
async def labor_utilization(forecast_id: Scenario = None) -> Dict[str, Any]:
    """Required labor minutes and cost per labor type for the scenario's volume."""
    return await call("GET", "/products/labor/utilization", params={"forecast_id": forecast_id})


@mcp.tool(name="forecast_list_bom", annotations=READ)
async def list_bom(
    bom_id: Annotated[Optional[str], Field(description="One BOM; omit for all lines")] = None,
    version: Annotated[Optional[str], Field(description="BOM version, e.g. '1.0'")] = None,
    material_contains: Annotated[Optional[str], Field(description="Case-insensitive substring of material_description, e.g. 'steel'")] = None,
) -> Dict[str, Any]:
    """List BOM lines (material, qty, unit price, material cost) with the
    products that use each BOM. Use it to see what a material change touches."""
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
    for row in rows:
        row["used_by"] = row["used_by"].split(",") if row.get("used_by") else []
    return {"lines": rows, "count": len(rows),
            "material_cost_total": round(sum(float(r.get("material_cost") or 0) for r in rows), 4)}


@mcp.tool(name="forecast_adjust_material_costs", annotations=WRITE)
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
    product that uses the touched BOMs. BOM prices apply to all periods: to
    phase a change in from a month, branch a scenario for that horizon."""
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
