"""
Sales, cost and revenue views computed straight from the source tables.

Every endpoint is scoped to ONE scenario and a month window: forecast_id
omitted -> the base scenario (forecast.is_base = 1), else the lowest
forecast_id; start_period / end_period (YYYY-MM, inclusive) default to the
scenario's first / last month with sales. Responses echo the scenario and
window used. Periods are compared on their first seven characters, so a row
stored as '2027-12-01' belongs to 2027-12.
"""
from fastapi import APIRouter, HTTPException, Query
from typing import Optional, Dict, Any, List
from datetime import datetime

from db.database import db_manager
from db.models import ForecastResponse
from services.financial_statements import window_total
from utils.cost_rollup import (
    calculate_unit_costs,
    load_bom_lines,
    load_router_operations,
    load_scope_lines,
    resolve_cost_window,
    scope_metadata,
    scope_warnings,
)

router = APIRouter(prefix="/source-data", tags=["source-data"])

REVENUE_GROUP_BY = ("period", "customer", "unit", "customer_unit", "customer_type", "product_type")


def _scope(cursor, forecast_id: Optional[str], start_period: Optional[str], end_period: Optional[str]) -> Dict[str, Any]:
    """resolve_cost_window, turning a bad window into a 400."""
    try:
        return resolve_cost_window(cursor, forecast_id, start_period, end_period)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/sales-forecast", response_model=ForecastResponse)
async def get_sales_forecast_from_source(
    forecast_id: Optional[str] = Query(None, description="Scenario id; omitted = the base scenario"),
    start_period: Optional[str] = Query(None, description="Start period (YYYY-MM)"),
    end_period: Optional[str] = Query(None, description="End period (YYYY-MM)")
):
    """
    Get sales forecast data directly from source tables (sales, customers, units)
    and calculate COGS from BOM, routing, and labor data.

    With no start / end every row of the scenario is listed (including rows
    whose period is not a month, counted in metadata.non_monthly_rows); with
    a window, rows are matched on the first seven characters of the period.
    """
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        scope = _scope(cursor, forecast_id, start_period, end_period)
        windowed = bool((start_period and start_period.strip()) or (end_period and end_period.strip()))

        query = """
            SELECT s.sale_id, s.customer_id, s.unit_id, s.period, s.quantity,
                   s.unit_price, s.total_revenue, s.forecast_id,
                   c.customer_name, c.customer_type, c.region,
                   u.unit_name, u.unit_description, u.base_price,
                   u.bom_id, u.bom_version, u.router_id
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.customer_id
            LEFT JOIN units u ON s.unit_id = u.unit_id
            WHERE s.forecast_id = ?
        """
        params: List[Any] = [scope["forecast_id"]]
        if windowed:
            query += " AND substr(s.period, 1, 7) >= ? AND substr(s.period, 1, 7) <= ?"
            params += [scope["start_period"], scope["end_period"]]
        query += " ORDER BY s.period, s.customer_id, s.unit_id"

        cursor.execute(query, params)
        sales_rows = cursor.fetchall()

        columns = [description[0] for description in cursor.description]
        sales_data = [dict(zip(columns, row)) for row in sales_rows]

        # Per-unit cost math lives in utils.cost_rollup so this endpoint
        # agrees with /products/cost-summary by construction. Cache by
        # (bom_id, bom_version, router_id) — the same product shows up
        # many times across periods/customers, no need to re-query per
        # sale row.
        unit_cost_cache: Dict[tuple, Dict[str, Any]] = {}

        def _costs_for(bom_id, bom_version, router_id):
            key = (bom_id, bom_version, router_id)
            if key not in unit_cost_cache:
                unit_cost_cache[key] = calculate_unit_costs(cursor, bom_id, bom_version, router_id)
            return unit_cost_cache[key]

        forecast_data = []
        for sale in sales_data:
            quantity = sale.get('quantity') or 0
            uc = _costs_for(sale.get('bom_id'), sale.get('bom_version'), sale.get('router_id'))

            total_material_cost = uc['material_per_unit'] * quantity
            total_labor_cost = uc['labor_per_unit'] * quantity
            total_machine_cost = uc['machine_per_unit'] * quantity
            total_cogs = total_material_cost + total_labor_cost + total_machine_cost

            total_revenue = sale.get('total_revenue') or 0.0
            gross_profit = total_revenue - total_cogs
            margin_percentage = (gross_profit / total_revenue * 100) if total_revenue > 0 else 0

            forecast_data.append({
                **sale,
                'material_cost': total_material_cost,
                'labor_cost': total_labor_cost,
                'machine_cost': total_machine_cost,
                'total_cogs': total_cogs,
                'gross_profit': gross_profit,
                'margin_percentage': margin_percentage,
                'material_cost_per_unit': uc['material_per_unit'],
                'labor_cost_per_unit': uc['labor_per_unit'],
                'machine_cost_per_unit': uc['machine_per_unit'],
                'cost_warnings': uc['warnings'],
            })

        # Calculate summary statistics
        total_revenue = sum(f['total_revenue'] or 0 for f in forecast_data)
        total_cogs = sum(f['total_cogs'] or 0 for f in forecast_data)
        total_gross_profit = total_revenue - total_cogs
        overall_margin = (total_gross_profit / total_revenue * 100) if total_revenue > 0 else 0

        return ForecastResponse(
            status="success",
            data={
                "sales_forecast": forecast_data,
                "summary": {
                    "total_revenue": total_revenue,
                    "total_cogs": total_cogs,
                    "total_gross_profit": total_gross_profit,
                    "overall_margin_percentage": overall_margin,
                    "record_count": len(forecast_data)
                },
                "metadata": {
                    **scope_metadata(scope),
                    "period_filter_applied": windowed,
                    "generated_at": datetime.now().isoformat(),
                    "source": "calculated_from_source_tables"
                },
                "warnings": scope_warnings(cursor, scope),
            },
            message=f"Retrieved and calculated forecast data for {scope['forecast_id'] or 'no scenario'} "
                    f"with {len(forecast_data)} records"
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate sales forecast from source: {str(e)}")
    finally:
        db_manager.close_connection(conn)


@router.get("/cost-breakdown", response_model=ForecastResponse)
async def get_cost_breakdown_from_source(
    forecast_id: Optional[str] = Query(None, description="Scenario id; omitted = the base scenario"),
    unit_id: Optional[str] = Query(None, description="Specific unit ID to analyze"),
    start_period: Optional[str] = Query(None, description="Start period (YYYY-MM)"),
    end_period: Optional[str] = Query(None, description="End period (YYYY-MM)"),
):
    """
    Get detailed cost breakdown for products from source tables.

    Lists the products with sales in the scenario's window (or the one
    `unit_id`, sold or not). Per unit: each BOM line of the product's BOM
    version and each routing step with its labor and machine cost, costed
    exactly as utils.cost_rollup.calculate_unit_costs does (line cost = qty x
    unit_price, else the stored material_cost; a step with no labor rate
    costs $0 and is flagged in `warnings`), so the per-unit totals match the
    cost summary and the statements.
    """
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        scope = _scope(cursor, forecast_id, start_period, end_period)
        loaded = load_scope_lines(cursor, scope)

        sold: Dict[str, Dict[str, float]] = {}
        for line in loaded["lines"]:
            entry = sold.setdefault(line["unit_id"], {"quantity": 0.0, "net_sales": 0.0})
            entry["quantity"] += line["quantity"]
            entry["net_sales"] += line["net_sales"]

        unit_ids = [unit_id] if unit_id else sorted(u for u in sold if u)
        units = []
        if unit_ids:
            placeholders = ",".join("?" for _ in unit_ids)
            cursor.execute(
                f"""SELECT unit_id, unit_name, bom_id, bom_version, router_id, base_price
                    FROM units WHERE unit_id IN ({placeholders}) ORDER BY unit_id""",
                unit_ids,
            )
            units = cursor.fetchall()

        cost_breakdown_data = []
        for this_unit_id, unit_name, bom_id, bom_version, router_id, base_price in units:
            costs = calculate_unit_costs(cursor, bom_id, bom_version, router_id)
            bom = load_bom_lines(cursor, bom_id, bom_version)

            bom_items = [{
                'line': line['bom_line'],
                'description': line['material_description'],
                'quantity': line['qty'],
                'unit': line['unit'],
                'unit_price': line['unit_price'],
                'total_cost': line['line_cost'],
                'stored_material_cost': line['material_cost'],
            } for line in bom['lines']]

            router_operations = [{
                'sequence': op['sequence'],
                'description': op['operation_description'],
                'machine_id': op['machine_id'],
                'machine_name': op['machine_name'],
                'machine_minutes': op['machine_minutes'],
                'machine_rate': op['machine_rate'],
                'labor_type_id': op['labor_type_id'],
                'labor_type_name': op['labor_type_name'],
                'labor_minutes': op['labor_minutes'],
                'labor_rate': op['labor_rate'],
                'machine_cost': op['machine_cost'],
                'labor_cost': op['labor_cost'],
                'total_operation_cost': op['machine_cost'] + op['labor_cost'],
            } for op in load_router_operations(cursor, router_id)]

            total_unit_cost = costs['material_per_unit'] + costs['labor_per_unit'] + costs['machine_per_unit']
            margin = (base_price or 0) - total_unit_cost
            margin_percentage = (margin / (base_price or 1) * 100) if base_price else 0
            in_window = sold.get(this_unit_id, {"quantity": 0.0, "net_sales": 0.0})

            cost_breakdown_data.append({
                'unit_id': this_unit_id,
                'unit_name': unit_name,
                'base_price': base_price,
                'bom_id': bom_id,
                'bom_version': bom_version,
                'bom_version_used': costs['bom_version_used'],
                'bom_versions_available': costs['bom_versions_available'],
                'router_id': router_id,
                'material_cost': costs['material_per_unit'],
                'labor_cost': costs['labor_per_unit'],
                'machine_cost': costs['machine_per_unit'],
                'total_cost': total_unit_cost,
                'margin': margin,
                'margin_percentage': margin_percentage,
                'warnings': costs['warnings'],
                'forecast_quantity': in_window['quantity'],
                'forecast_net_sales': in_window['net_sales'],
                'forecast_total_cost': total_unit_cost * in_window['quantity'],
                'bom_items': bom_items,
                'router_operations': router_operations,
            })

        return ForecastResponse(
            status="success",
            data={
                "cost_breakdown": cost_breakdown_data,
                "summary": {
                    "units_analyzed": len(cost_breakdown_data),
                    "total_units": len(units)
                },
                **scope_metadata(scope),
                "warnings": scope_warnings(cursor, scope, loaded),
            },
            message=f"Generated detailed cost breakdown for {len(cost_breakdown_data)} units"
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate cost breakdown: {str(e)}")
    finally:
        db_manager.close_connection(conn)


# Line key (services.financial_statements.load_sales_lines) -> summary field.
_REVENUE_METRICS = {
    "quantity": "total_quantity",
    "gross_sales": "gross_sales",
    "terms_allowance": "terms_allowance",
    "chargebacks": "chargebacks",
    "other_allowance": "other_allowances",
    "excise_tax": "excise_tax",
    "total_sales_deductions": "total_sales_deductions",
    "net_sales": "net_sales",
    "commission": "commissions",
    "materials": "materials",
    "labor": "labor",
    "machine": "machine",
    "product_cogs": "product_cogs",
}


def _revenue_group_header(group_by: str, line: Dict[str, Any]) -> Dict[str, Any]:
    """Identifying fields of the group a sales line belongs to."""
    customer_type = line["customer_type"] or "Unassigned"
    unit_type = line["unit_type"] or "Unassigned"
    if group_by == "period":
        return {"period": line["period"]}
    if group_by == "customer":
        return {"customer_id": line["customer_id"], "customer_name": line["customer_name"],
                "customer_type": line["customer_type"]}
    if group_by == "unit":
        return {"unit_id": line["unit_id"], "unit_name": line["unit_name"], "unit_type": line["unit_type"]}
    if group_by == "customer_unit":
        return {"customer_id": line["customer_id"], "customer_name": line["customer_name"],
                "unit_id": line["unit_id"], "unit_name": line["unit_name"],
                "customer_type": line["customer_type"], "unit_type": line["unit_type"]}
    if group_by == "customer_type":
        return {"customer_type": customer_type}
    return {"unit_type": unit_type}


def _finish_revenue_group(entry: Dict[str, Any]) -> Dict[str, Any]:
    """Derived fields and rounding for one revenue-summary group (or the totals)."""
    qty = entry["total_quantity"]
    net = entry["net_sales"]
    entry["gross_margin_pct"] = round((net - entry["product_cogs"]) / net * 100, 2) if net else 0.0
    entry["avg_unit_price"] = round(entry["gross_sales"] / qty, 4) if qty else None
    entry["avg_net_price"] = round(net / qty, 4) if qty else None
    entry["cogs_per_unit"] = round(entry["product_cogs"] / qty, 4) if qty else None
    for key in _REVENUE_METRICS.values():
        entry[key] = round(entry[key], 4 if key == "total_quantity" else 2)
    # From the rounded figures, so the numbers shown add up to the cent.
    entry["total_revenue"] = entry["gross_sales"]
    entry["gross_margin"] = round(entry["net_sales"] - entry["product_cogs"], 2)
    for key in ("customers", "products", "periods"):
        entry.pop(key, None)
    return entry


@router.get("/revenue-summary", response_model=ForecastResponse)
async def get_revenue_summary_from_source(
    forecast_id: Optional[str] = Query(None, description="Scenario id; omitted = the base scenario"),
    group_by: str = Query("period", description="Group by: " + ", ".join(REVENUE_GROUP_BY)),
    start_period: Optional[str] = Query(None, description="Start period (YYYY-MM)"),
    end_period: Optional[str] = Query(None, description="End period (YYYY-MM)"),
):
    """
    Get revenue summary grouped by different dimensions from source sales data.

    Built on services.financial_statements.load_sales_lines (the rows and
    numbers the income statement uses). Every group carries quantity, gross
    sales (`total_revenue` = gross sales, as before), each sales deduction,
    net sales, commissions, product COGS (materials, standard labor,
    machine) and gross margin = net sales - product COGS: the contribution
    margin, before the direct labor variance, indirect labor and factory
    overhead that the income statement's gross profit also deducts. The
    totals equal the income statement's lines for the window to the cent.
    `avg_unit_price` is quantity-weighted: gross sales / quantity.
    """
    if group_by not in REVENUE_GROUP_BY:
        raise HTTPException(status_code=400, detail=f"Invalid group_by parameter. Use: {', '.join(REVENUE_GROUP_BY)}")

    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        scope = _scope(cursor, forecast_id, start_period, end_period)
        loaded = load_scope_lines(cursor, scope)
        lines = loaded["lines"]

        def _empty(header: Dict[str, Any]) -> Dict[str, Any]:
            return {**header, **dict.fromkeys(_REVENUE_METRICS.values(), 0.0),
                    "customers": set(), "products": set(), "periods": set()}

        groups: Dict[tuple, Dict[str, Any]] = {}
        totals = _empty({})
        # The window totals are added month by month, as the statements add them, so they equal the
        # income statement to the cent (one running sum over the lines can land a half cent the other way).
        monthly: Dict[str, Dict[str, float]] = {field: {} for field in _REVENUE_METRICS.values()}
        for line in lines:
            header = _revenue_group_header(group_by, line)
            entry = groups.get(tuple(header.values()))
            if entry is None:
                entry = groups[tuple(header.values())] = _empty(header)
            for line_key, field in _REVENUE_METRICS.items():
                entry[field] += line[line_key]
                month = monthly[field]
                month[line["period"]] = month.get(line["period"], 0.0) + line[line_key]
            for target in (entry, totals):
                target["customers"].add(line["customer_id"])
                target["products"].add(line["unit_id"])
                target["periods"].add(line["period"])
        window = sorted(totals["periods"])
        for field, months in monthly.items():
            totals[field] = window_total(months, window)

        summary_data = []
        for entry in groups.values():
            entry["customer_count"] = len(entry["customers"])
            entry["product_count"] = len(entry["products"])
            entry["periods_active"] = len(entry["periods"])
            if group_by == "customer":
                entry["products_ordered"] = entry["product_count"]
            summary_data.append(_finish_revenue_group(entry))
        if group_by == "period":
            summary_data.sort(key=lambda r: r["period"])
        else:
            summary_data.sort(key=lambda r: -(r["total_revenue"] or 0))

        totals_out = {
            "total_records": len(lines),
            "unique_customers": len(totals["customers"]),
            "unique_products": len(totals["products"]),
            "periods_covered": len(totals["periods"]),
        }
        totals_out.update(_finish_revenue_group(totals))

        return ForecastResponse(
            status="success",
            data={
                "revenue_summary": summary_data,
                "totals": totals_out,
                "group_by": group_by,
                **scope_metadata(scope),
                "notes": "total_revenue = gross sales; net_sales = gross sales - sales deductions; "
                         "gross_margin = net sales - product COGS (materials + standard labor + machine): the "
                         "contribution margin, before the direct labor variance, indirect labor and factory overhead "
                         "that gross profit on the income statement also deducts; "
                         "avg_unit_price = gross sales / quantity.",
                "warnings": scope_warnings(cursor, scope, loaded),
            },
            message=f"Generated revenue summary grouped by {group_by} for {scope['forecast_id'] or 'no scenario'}"
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate revenue summary: {str(e)}")
    finally:
        db_manager.close_connection(conn)
