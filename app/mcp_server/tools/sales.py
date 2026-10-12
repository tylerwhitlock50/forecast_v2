"""Sales forecast tools: read, upsert, delete, import and bulk adjust."""
from __future__ import annotations

from typing import Annotated, Any, Dict, List, Optional

from pydantic import Field
from mcp.server.fastmcp.exceptions import ToolError

import db.database as dbmod
from services.model_adjustments import AdjustmentError, adjust_sales
from mcp_server.core import DESTRUCTIVE, READ, UPSERT, WRITE, call, mcp, require, strip_none

Period = Annotated[Optional[str], Field(description="YYYY-MM")]


@mcp.tool(name="forecast_list_sales", annotations=READ)
async def list_sales(
    forecast_id: Annotated[str, Field(description="Scenario id; sales always belong to one scenario")],
    start_period: Period = None,
    end_period: Period = None,
    customer_id: Optional[str] = None,
    unit_id: Annotated[Optional[str], Field(description="Product id")] = None,
    limit: Annotated[int, Field(description="Max rows to return", ge=1, le=5000)] = 200,
    offset: Annotated[int, Field(ge=0)] = 0,
) -> Dict[str, Any]:
    """List sales forecast rows for a scenario with customer / product names
    and per-row COGS (material, labor, machine) and margin. Filter by period
    window, customer or product. Returns totals over the filtered rows."""
    body = await call("GET", "/source-data/sales-forecast", params={
        "forecast_id": require(forecast_id, "forecast_id"),
        "start_period": start_period, "end_period": end_period,
    })
    rows = body.get("sales_forecast", [])
    if customer_id:
        rows = [r for r in rows if r.get("customer_id") == customer_id]
    if unit_id:
        rows = [r for r in rows if r.get("unit_id") == unit_id]
    total = len(rows)
    page = rows[offset:offset + limit]
    revenue = sum(float(r.get("total_revenue") or 0) for r in rows)
    cogs = sum(float(r.get("total_cogs") or 0) for r in rows)
    return {
        "forecast_id": forecast_id,
        "rows": page,
        "total_count": total,
        "returned": len(page),
        "offset": offset,
        "has_more": offset + len(page) < total,
        "next_offset": offset + len(page) if offset + len(page) < total else None,
        "totals": {
            "revenue": round(revenue, 2),
            "cogs": round(cogs, 2),
            "gross_profit": round(revenue - cogs, 2),
            "quantity": sum(float(r.get("quantity") or 0) for r in rows),
        },
    }


@mcp.tool(name="forecast_upsert_sales", annotations=UPSERT)
async def upsert_sales(
    forecast_id: Annotated[str, Field(description="Scenario the rows belong to")],
    rows: Annotated[List[Dict[str, Any]], Field(
        description="Rows of {customer_id, unit_id, period (YYYY-MM), quantity, unit_price}. "
                    "Matched on customer + product + period within the scenario; missing rows are inserted.",
        min_length=1)],
    operation: Annotated[str, Field(description="replace (set quantity and price), add (add quantity, optionally set price) or subtract (reduce quantity)")] = "replace",
) -> Dict[str, Any]:
    """Create or update sales forecast rows. 'replace' sets quantity and
    unit_price; 'add' / 'subtract' change quantity relative to the existing
    row. total_revenue is recomputed as quantity x unit_price."""
    if operation not in ("replace", "add", "subtract"):
        raise ToolError("operation must be replace, add or subtract")
    fid = require(forecast_id, "forecast_id")
    forecasts = []
    for i, row in enumerate(rows):
        for key in ("customer_id", "unit_id", "period"):
            if not row.get(key):
                raise ToolError(f"rows[{i}] is missing {key}")
        qty = float(row.get("quantity", 0) or 0)
        price = row.get("unit_price")
        item = {"forecast_id": fid, "customer_id": row["customer_id"], "unit_id": row["unit_id"],
                "period": row["period"], "quantity": qty}
        if price is not None:
            item["unit_price"] = float(price)
            item["total_revenue"] = qty * float(price)
        elif operation == "replace":
            raise ToolError(f"rows[{i}] needs unit_price for operation=replace")
        forecasts.append(item)
    return await call("POST", "/forecast/bulk_update", json={"forecasts": forecasts, "operation": operation})


@mcp.tool(name="forecast_delete_sale", annotations=DESTRUCTIVE)
async def delete_sale(sale_id: Annotated[str, Field(description="sale_id of the row (from forecast_list_sales)")]) -> Dict[str, Any]:
    """Delete one sales forecast row."""
    return await call("DELETE", f"/forecast/delete/sales/{require(sale_id, 'sale_id')}")


@mcp.tool(name="forecast_import_sales", annotations=WRITE)
async def import_sales(
    forecast_id: Annotated[str, Field(description="Scenario to import into")],
    rows: Annotated[List[Dict[str, Any]], Field(
        description="Rows of {customer_id, unit_id (or product_id), period, quantity, unit_price (or price)}; "
                    "optional customer_name / unit_name are used when auto-creating master data", min_length=1)],
    auto_create: Annotated[bool, Field(description="Create unknown customers and products on the fly")] = True,
) -> Dict[str, Any]:
    """Smart import of sales rows: unknown customers / products are created when
    auto_create is true, periods are normalised, and existing rows for the same
    customer + product + period are replaced. Reports created and skipped rows."""
    return await call("POST", "/forecast/smart_import_sales", json={
        "forecast_id": require(forecast_id, "forecast_id"), "sales": rows, "options": {"autoCreate": auto_create},
    })


@mcp.tool(name="forecast_revenue_summary", annotations=READ)
async def revenue_summary(
    forecast_id: Annotated[str, Field(description="Scenario id")],
    group_by: Annotated[str, Field(description="period, customer, unit or customer_unit")] = "period",
) -> Dict[str, Any]:
    """Revenue, quantity and COGS totals grouped by period, customer, product
    or customer + product for one scenario."""
    if group_by not in ("period", "customer", "unit", "customer_unit"):
        raise ToolError("group_by must be period, customer, unit or customer_unit")
    return await call("GET", "/source-data/revenue-summary", params={
        "forecast_id": require(forecast_id, "forecast_id"), "group_by": group_by,
    })


@mcp.tool(name="forecast_adjust_sales", annotations=WRITE)
async def adjust_sales_tool(
    forecast_id: Annotated[str, Field(description="Scenario whose sales rows are adjusted")],
    periods: Annotated[Optional[List[str]], Field(description="Explicit months, e.g. ['2026-06', '2026-08', '2026-09']")] = None,
    start_period: Annotated[Optional[str], Field(description="Inclusive window start YYYY-MM (alternative to periods)")] = None,
    end_period: Annotated[Optional[str], Field(description="Inclusive window end YYYY-MM")] = None,
    customer_ids: Annotated[Optional[List[str]], Field(description="Restrict to these customers")] = None,
    unit_ids: Annotated[Optional[List[str]], Field(description="Restrict to these products")] = None,
    price_multiplier: Annotated[Optional[float], Field(description="Multiply unit_price (0.65 = 35% discount)", ge=0)] = None,
    price_delta: Annotated[Optional[float], Field(description="Add to unit_price (negative to cut)")] = None,
    price: Annotated[Optional[float], Field(description="Set unit_price to this value", ge=0)] = None,
    quantity_multiplier: Annotated[Optional[float], Field(description="Multiply quantity (1.1 = +10% volume)", ge=0)] = None,
    quantity_delta: Annotated[Optional[float], Field(description="Add to quantity (negative to reduce)")] = None,
    quantity: Annotated[Optional[float], Field(description="Set quantity to this value", ge=0)] = None,
    dry_run: Annotated[bool, Field(description="Preview the matched rows and revenue impact without writing")] = False,
) -> Dict[str, Any]:
    """Bulk re-price and/or re-volume sales rows in a scenario, filtered by
    months, customers and products. Example: 'ASP down 35% in June, August
    and September' => periods=[2026-06, 2026-08, 2026-09], price_multiplier=0.65.
    Give one price op and/or one quantity op. total_revenue is recomputed.
    Run with dry_run=true first and show the user the before / after totals."""
    conn = dbmod.db_manager.get_connection()
    try:
        result = adjust_sales(
            conn.cursor(), forecast_id,
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
    if result["matched_rows"] == 0:
        result["hint"] = "No sales rows matched; check the scenario id, periods (YYYY-MM) and ids with forecast_list_sales"
    return result
