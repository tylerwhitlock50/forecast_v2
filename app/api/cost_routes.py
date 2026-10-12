"""
Product costing endpoints: unit cost preview, per-product cost summary,
material usage, and machine / labor utilization.

Every endpoint that reads sales is scoped to ONE scenario and a month window:

  * forecast_id omitted -> the base scenario (forecast.is_base = 1), else the
    lowest forecast_id; the response echoes `forecast_id` and
    `forecast_id_source` ("requested" / "base" / "first"). Scenarios are
    never summed together.
  * start_period / end_period (YYYY-MM, inclusive) default to the scenario's
    first / last month with sales, so omitting both covers the whole
    scenario. The response echoes the window used.

Quantities, revenue and cost come from services.financial_statements
.load_sales_lines (the rows the income statement uses: a period stored as
'2027-12-01' is December, a '2027-Q1' row is excluded and reported), so the
totals here tie to the statements and the COGS / labor forecasts.
"""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query

from db.models import ForecastResponse
from services.operations_forecast import DEFAULT_HOURS_PER_FTE, build_labor_forecast
from utils.cost_rollup import (
    calculate_unit_costs,
    load_bom_lines,
    load_scope_lines,
    month_sql,
    resolve_cost_window,
    scope_metadata,
    scope_warnings,
)

router = APIRouter(prefix="/products", tags=["cost"])

_SCENARIO_HELP = "Scenario id; omitted = the base scenario (never the sum of scenarios)"
_START_HELP = "First month (YYYY-MM); omitted = the scenario's first month with sales"
_END_HELP = "Last month (YYYY-MM); omitted = the scenario's last month with sales"


def _scope(cursor, forecast_id: Optional[str], start_period: Optional[str], end_period: Optional[str]) -> Dict[str, Any]:
    """resolve_cost_window, turning a bad window into a 400."""
    try:
        return resolve_cost_window(cursor, forecast_id, start_period, end_period)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _pct(numerator: float, denominator: float) -> float:
    return numerator / denominator * 100 if denominator > 0 else 0


@router.get("/unit-cost", response_model=ForecastResponse)
async def get_unit_cost_preview(
    bom_id: Optional[str] = Query(None),
    bom_version: Optional[str] = Query("1.0"),
    router_id: Optional[str] = Query(None),
):
    """
    Return per-unit material/labor/machine cost for a hypothetical BOM +
    router pairing. Used by Product edit / BOM / Router modals to show a
    live "≈ $X/unit" preview before the pairing is committed.
    """
    try:
        from db.database import db_manager

        conn = db_manager.get_connection()
        cursor = conn.cursor()
        unit_costs = calculate_unit_costs(cursor, bom_id, bom_version, router_id)
        db_manager.close_connection(conn)

        total = (
            unit_costs["material_per_unit"]
            + unit_costs["labor_per_unit"]
            + unit_costs["machine_per_unit"]
        )
        return ForecastResponse(
            status="success",
            data={
                "material_per_unit": unit_costs["material_per_unit"],
                "labor_per_unit": unit_costs["labor_per_unit"],
                "machine_per_unit": unit_costs["machine_per_unit"],
                "total_per_unit": total,
                "warnings": unit_costs["warnings"],
                "bom_version_used": unit_costs["bom_version_used"],
                "bom_versions_available": unit_costs["bom_versions_available"],
            },
            message="Unit cost preview computed",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error computing unit cost: {str(e)}")


@router.get("/cost-summary", response_model=ForecastResponse)
async def get_products_cost_summary(
    forecast_id: Optional[str] = Query(None, description=_SCENARIO_HELP),
    start_period: Optional[str] = Query(None, description=_START_HELP),
    end_period: Optional[str] = Query(None, description=_END_HELP),
):
    """
    Get cost summary for all products including COGS calculation.
    Each product row includes a `warnings` list naming the data-quality
    issues that may be silently understating its cost; the response
    `summary` rolls up how many products are affected.

    Quantities and revenue cover one scenario and month window (see the
    module docstring). `forecasted_revenue` is NET sales (gross sales less
    discounts, allowances and excise), the income statement's revenue, and
    `gross_margin` = net sales - product COGS; `gross_sales` and
    `total_sales_deductions` are reported alongside. Every product is
    listed, including ones with no sales in the window (quantity 0).
    """
    from db.database import db_manager

    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        scope = _scope(cursor, forecast_id, start_period, end_period)
        loaded = load_scope_lines(cursor, scope)

        metrics = ("quantity", "gross_sales", "total_sales_deductions", "net_sales", "materials", "labor", "machine")
        by_unit: Dict[str, Dict[str, float]] = {}
        for line in loaded["lines"]:
            agg = by_unit.setdefault(line["unit_id"] or "unknown", dict.fromkeys(metrics, 0.0))
            for key in metrics:
                agg[key] += line[key]

        cursor.execute(
            "SELECT u.unit_id, u.unit_name, u.bom_id, u.bom_version, u.router_id, u.router_version, u.base_price "
            "FROM units u"
        )
        products = [row[:5] for row in cursor.fetchall()]
        known = {row[0] for row in products}
        # Sales rows for a product that is not in the units table still count in
        # the statements; list them so the totals tie.
        for unit_id in by_unit:
            if unit_id not in known:
                info = loaded["unit_costs"].get(unit_id, {})
                products.append((unit_id, info.get("unit_name"), None, None, None))

        unit_cost_cache: Dict[tuple, Dict[str, Any]] = {}
        cost_summaries = []
        for unit_id, unit_name, bom_id, bom_version, router_id in products:
            key = (bom_id, bom_version, router_id)
            if key not in unit_cost_cache:
                unit_cost_cache[key] = calculate_unit_costs(cursor, bom_id, bom_version, router_id)
            unit_costs = unit_cost_cache[key]
            agg = by_unit.get(unit_id) or dict.fromkeys(metrics, 0.0)

            forecasted_revenue = agg["net_sales"]
            material_cost = agg["materials"]
            labor_cost = agg["labor"]
            machine_cost = agg["machine"]
            total_cogs = material_cost + labor_cost + machine_cost
            gross_margin = forecasted_revenue - total_cogs

            cost_summaries.append({
                "product_id": unit_id,
                "product_name": unit_name,
                "bom_id": bom_id,
                "bom_version": bom_version,
                "bom_version_used": unit_costs["bom_version_used"],
                "router_id": router_id,
                "forecast_quantity": agg["quantity"],
                "forecasted_revenue": forecasted_revenue,
                "gross_sales": agg["gross_sales"],
                "total_sales_deductions": agg["total_sales_deductions"],
                "net_sales": agg["net_sales"],
                "material_cost": material_cost,
                "labor_cost": labor_cost,
                "machine_cost": machine_cost,
                "total_cogs": total_cogs,
                "gross_margin": gross_margin,
                "gross_margin_percent": _pct(gross_margin, forecasted_revenue),
                "unit_material_cost": unit_costs["material_per_unit"],
                "unit_labor_cost": unit_costs["labor_per_unit"],
                "unit_machine_cost": unit_costs["machine_per_unit"],
                "unit_total_cost": (
                    unit_costs["material_per_unit"]
                    + unit_costs["labor_per_unit"]
                    + unit_costs["machine_per_unit"]
                ),
                "warnings": unit_costs["warnings"],
            })

        products_with_warnings = sum(1 for p in cost_summaries if p["warnings"])
        sold = [p for p in cost_summaries if p["forecast_quantity"]]
        totals = {
            "units": sum(p["forecast_quantity"] for p in cost_summaries),
            "gross_sales": sum(p["gross_sales"] for p in cost_summaries),
            "total_sales_deductions": sum(p["total_sales_deductions"] for p in cost_summaries),
            "net_sales": sum(p["net_sales"] for p in cost_summaries),
            "material_cost": sum(p["material_cost"] for p in cost_summaries),
            "labor_cost": sum(p["labor_cost"] for p in cost_summaries),
            "machine_cost": sum(p["machine_cost"] for p in cost_summaries),
            "total_cogs": sum(p["total_cogs"] for p in cost_summaries),
        }
        totals["gross_margin"] = totals["net_sales"] - totals["total_cogs"]
        totals["gross_margin_percent"] = _pct(totals["gross_margin"], totals["net_sales"])

        return ForecastResponse(
            status="success",
            data={
                "products": cost_summaries,
                "summary": {
                    "product_count": len(cost_summaries),
                    "products_with_warnings": products_with_warnings,
                    "products_in_forecast": len(sold),
                    "products_in_forecast_with_warnings": sum(1 for p in sold if p["warnings"]),
                    "start_period": scope["start_period"],
                    "end_period": scope["end_period"],
                    "months_in_window": scope["months_in_window"],
                    "totals": totals,
                },
                **scope_metadata(scope),
                "warnings": scope_warnings(cursor, scope, loaded),
            },
            message=f"Retrieved cost summary for {len(cost_summaries)} products",
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving cost summary: {str(e)}")
    finally:
        db_manager.close_connection(conn)


@router.get("/materials/usage", response_model=ForecastResponse)
async def get_materials_usage(
    forecast_id: Optional[str] = Query(None, description=_SCENARIO_HELP),
    start_period: Optional[str] = Query(None, description=_START_HELP),
    end_period: Optional[str] = Query(None, description=_END_HELP),
):
    """
    Get material usage forecast for purchasing decisions.

    Each product is exploded through the BOM version it is costed with
    (utils.cost_rollup.load_bom_lines: tolerant version match, line cost =
    qty x unit_price, else the stored material_cost), so `totals.total_cost`
    equals the statements' material COGS for the window. Materials are keyed
    by description + unit + unit price, with quantity and cost per month.
    """
    from db.database import db_manager

    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        scope = _scope(cursor, forecast_id, start_period, end_period)
        periods = scope["periods"]
        loaded = load_scope_lines(cursor, scope)

        units_by_period: Dict[tuple, float] = {}
        for line in loaded["lines"]:
            key = (line["unit_id"] or "unknown", line["period"])
            units_by_period[key] = units_by_period.get(key, 0.0) + line["quantity"]

        bom_cache: Dict[tuple, Dict[str, Any]] = {}
        materials: Dict[tuple, Dict[str, Any]] = {}
        for (unit_id, period), units in units_by_period.items():
            info = loaded["unit_costs"].get(unit_id) or {}
            bom_key = (info.get("bom_id"), info.get("bom_version"))
            if not bom_key[0]:
                continue
            if bom_key not in bom_cache:
                bom_cache[bom_key] = load_bom_lines(cursor, *bom_key)
            bom = bom_cache[bom_key]
            for bom_line in bom["lines"]:
                key = (bom_line["material_description"], bom_line["unit"], bom_line["unit_price"])
                entry = materials.get(key)
                if entry is None:
                    entry = materials[key] = {
                        "material_description": key[0],
                        "unit": key[1],
                        "unit_price": key[2],
                        "total_quantity_needed": 0.0,
                        "total_cost": 0.0,
                        "products_using": set(),
                        "boms": set(),
                        "by_period": {p: {"quantity": 0.0, "cost": 0.0} for p in periods},
                    }
                quantity = bom_line["qty_per_unit"] * units
                cost = bom_line["line_cost"] * units
                entry["total_quantity_needed"] += quantity
                entry["total_cost"] += cost
                entry["by_period"][period]["quantity"] += quantity
                entry["by_period"][period]["cost"] += cost
                entry["products_using"].add(info.get("unit_name") or unit_id)
                entry["boms"].add(f"{bom_key[0]} v{bom['version_used']}")

        materials_usage = []
        for entry in materials.values():
            qty = entry["total_quantity_needed"]
            materials_usage.append({
                **entry,
                "total_quantity_needed": round(qty, 4),
                "total_cost": round(entry["total_cost"], 2),
                "avg_unit_cost": round(entry["total_cost"] / qty, 4) if qty else None,
                "products_using": sorted(entry["products_using"]),
                "boms": sorted(entry["boms"]),
                "by_period": {p: {"quantity": round(v["quantity"], 4), "cost": round(v["cost"], 2)}
                              for p, v in entry["by_period"].items()},
            })
        materials_usage.sort(key=lambda m: -m["total_cost"])

        cost_by_period = {p: round(sum(m["by_period"][p]["cost"] for m in materials.values()), 2) for p in periods}
        return ForecastResponse(
            status="success",
            data={
                "materials": materials_usage,
                "totals": {
                    "material_count": len(materials_usage),
                    "total_cost": round(sum(m["total_cost"] for m in materials.values()), 2),
                    "cost_by_period": cost_by_period,
                },
                **scope_metadata(scope),
                "periods": periods,
                "warnings": scope_warnings(cursor, scope, loaded),
            },
            message=f"Retrieved material usage for {len(materials_usage)} materials"
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving material usage: {str(e)}")
    finally:
        db_manager.close_connection(conn)


def _minutes(hours: float) -> int:
    """
    Whole minutes from build_labor_forecast hours (rounded to 0.01 h, i.e.
    within 0.3 minutes), so a 50-minute requirement reads 50, not 49.8.
    """
    return int(round((hours or 0) * 60))


def _peak(monthly: List[Dict[str, Any]], key: str) -> Optional[Dict[str, Any]]:
    """The first month with the highest `key`, or None when every month is zero."""
    best = max(monthly, key=lambda m: m[key] or 0, default=None)
    return best if best and best[key] else None


@router.get("/machines/utilization", response_model=ForecastResponse)
async def get_machines_utilization(
    forecast_id: Optional[str] = Query(None, description=_SCENARIO_HELP),
    start_period: Optional[str] = Query(None, description=_START_HELP),
    end_period: Optional[str] = Query(None, description=_END_HELP),
):
    """
    Get machine utilization forecast and capacity analysis, month by month.

    Capacity (`available_minutes_per_month`) is a MONTHLY figure, so it is
    compared with each month's required minutes, never with the window
    total. Per machine: `utilization_percent` = average monthly minutes /
    monthly capacity, `peak_utilization_percent` / `peak_period` = the
    busiest month, `capacity_exceeded` = at least one month over capacity
    (`over_capacity_periods`), and a `monthly` breakdown. Required minutes
    come from services.operations_forecast.build_labor_forecast (hours to
    0.01 h, minutes to the whole minute). A machine with no capacity set
    reports utilization null and the warning `capacity_not_set`, and is
    never flagged as exceeded.
    """
    from db.database import db_manager

    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        scope = _scope(cursor, forecast_id, start_period, end_period)
        periods = scope["periods"]
        months = len(periods)
        machines_utilization: List[Dict[str, Any]] = []
        warnings = scope_warnings(cursor, scope)

        if scope["forecast_id"] and periods:
            report = build_labor_forecast(cursor, [scope["forecast_id"]], periods[0], periods[-1])
            cursor.execute("SELECT machine_id, available_minutes_per_month FROM machines")
            capacity = {machine_id: minutes for machine_id, minutes in cursor.fetchall()}
            warnings += [w for w in report["warnings"] if w["code"] in ("machine_over_capacity", "cost_warnings")]

            for entry in report["by_machine"]:
                machine_id = entry["machine_id"]
                found = machine_id in capacity
                available = float(capacity[machine_id]) if found and capacity[machine_id] is not None else None
                has_capacity = bool(available and available > 0)

                monthly = []
                for period in periods:
                    bucket = entry["by_period"][period]
                    util = bucket["utilization_pct"] if has_capacity else None
                    monthly.append({
                        "period": period,
                        "minutes_required": _minutes(bucket["hours"]),
                        "hours_required": bucket["hours"],
                        "available_minutes": available,
                        "utilization_percent": util,
                        "over_capacity": bool(util is not None and util > 100),
                        "cost": bucket["cost"],
                    })
                total_hours = entry["totals"]["hours"]
                total_minutes = _minutes(total_hours)
                average_minutes = total_minutes / months
                peak = _peak(monthly, "minutes_required")
                over = [m["period"] for m in monthly if m["over_capacity"]]
                machine_warnings = [] if has_capacity else ["capacity_not_set" if found else "machine_not_found"]

                machines_utilization.append({
                    "machine_id": machine_id,
                    "machine_name": entry["machine_name"],
                    "total_minutes_required": total_minutes,
                    "total_hours_required": total_hours,
                    "available_minutes_per_month": available,
                    "available_hours_per_month": round(available / 60, 2) if available is not None else None,
                    "average_monthly_minutes": round(average_minutes, 2),
                    "average_monthly_hours": round(average_minutes / 60, 2),
                    "utilization_percent": round(total_hours * 60 / months / available * 100, 2) if has_capacity else None,
                    "peak_utilization_percent": peak["utilization_percent"] if peak and has_capacity else None,
                    "peak_period": peak["period"] if peak else None,
                    "capacity_exceeded": bool(over),
                    "over_capacity_periods": over,
                    "months_over_capacity": len(over),
                    "months_in_window": months,
                    "total_cost": entry["totals"]["cost"],
                    "monthly": monthly,
                    "warnings": machine_warnings,
                })

            no_capacity = [m["machine_id"] for m in machines_utilization if m["utilization_percent"] is None]
            if no_capacity:
                warnings.append({
                    "code": "capacity_not_set",
                    "message": f"No monthly capacity (available_minutes_per_month) for {', '.join(no_capacity)}; "
                               f"their utilization cannot be computed.",
                    "machine_ids": no_capacity,
                })

        return ForecastResponse(
            status="success",
            data={
                "machines": machines_utilization,
                **scope_metadata(scope),
                "periods": periods,
                "utilization_basis": "utilization_percent = average monthly required minutes / monthly capacity; "
                                     "peak_utilization_percent = busiest month",
                "warnings": warnings,
            },
            message=f"Retrieved utilization for {len(machines_utilization)} machines"
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving machine utilization: {str(e)}")
    finally:
        db_manager.close_connection(conn)


def _labor_products(cursor, scope: Dict[str, Any]) -> Dict[str, List[str]]:
    """Products with sales in the window whose routing has labor minutes, per labor type ('unassigned' = no type)."""
    cursor.execute(
        f"""
        SELECT DISTINCT COALESCE(NULLIF(TRIM(ro.labor_type_id), ''), 'unassigned'), COALESCE(u.unit_name, u.unit_id)
        FROM sales s
        JOIN units u ON s.unit_id = u.unit_id
        JOIN router_operations ro ON ro.router_id = u.router_id
        WHERE s.forecast_id = ?
          AND {month_sql("s.period")}
          AND substr(s.period, 1, 7) BETWEEN ? AND ?
          AND COALESCE(ro.labor_minutes, 0) > 0
        """,
        (scope["forecast_id"], scope["start_period"], scope["end_period"]),
    )
    products: Dict[str, List[str]] = {}
    for labor_type_id, name in cursor.fetchall():
        products.setdefault(labor_type_id, []).append(name)
    return {k: sorted(v) for k, v in products.items()}


@router.get("/labor/utilization", response_model=ForecastResponse)
async def get_labor_utilization(
    forecast_id: Optional[str] = Query(None, description=_SCENARIO_HELP),
    start_period: Optional[str] = Query(None, description=_START_HELP),
    end_period: Optional[str] = Query(None, description=_END_HELP),
    hours_per_fte: Optional[float] = Query(None, gt=0, description="Paid hours per FTE per month (default 173.33)"),
):
    """
    Get labor utilization forecast and cost analysis, month by month.

    Per labor type: window totals (`total_minutes_required`, `total_hours`,
    `total_cost`), `average_monthly_hours`, the busiest month
    (`peak_monthly_hours`, `peak_period`), FTEs (`avg_fte`, `peak_fte` =
    hours / hours_per_fte) and a `monthly` breakdown, from
    services.operations_forecast.build_labor_forecast (hours to 0.01 h,
    minutes to the whole minute), so
    labor cost equals the statements' direct labor. Routing steps with labor
    minutes but no labor type are reported under labor_type_id "unassigned"
    at $0 (warning `labor_without_type`).
    """
    from db.database import db_manager

    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        scope = _scope(cursor, forecast_id, start_period, end_period)
        periods = scope["periods"]
        months = len(periods)
        fte_hours = float(hours_per_fte or DEFAULT_HOURS_PER_FTE)
        labor_utilization: List[Dict[str, Any]] = []
        warnings = scope_warnings(cursor, scope)

        if scope["forecast_id"] and periods:
            report = build_labor_forecast(cursor, [scope["forecast_id"]], periods[0], periods[-1], fte_hours)
            warnings += [w for w in report["warnings"] if w["code"] != "machine_over_capacity"]
            products = _labor_products(cursor, scope)

            for entry in report["by_labor_type"]:
                monthly = [{
                    "period": period,
                    "hours": entry["by_period"][period]["hours"],
                    "minutes": _minutes(entry["by_period"][period]["hours"]),
                    "cost": entry["by_period"][period]["cost"],
                    "fte": entry["by_period"][period]["fte"],
                } for period in periods]
                total_hours = entry["totals"]["hours"]
                peak = _peak(monthly, "hours")
                labor_utilization.append({
                    "labor_type_id": entry["labor_type_id"],
                    "labor_type_name": entry["labor_type_name"],
                    "hourly_rate": entry["hourly_rate"],
                    "total_minutes_required": _minutes(total_hours),
                    "total_hours": total_hours,
                    "total_cost": entry["totals"]["cost"],
                    "products_involved": products.get(entry["labor_type_id"], []),
                    "months_in_window": months,
                    "average_monthly_hours": round(total_hours / months, 2),
                    "peak_monthly_hours": peak["hours"] if peak else 0.0,
                    "peak_period": peak["period"] if peak else None,
                    "avg_fte": entry["totals"]["avg_fte"],
                    "peak_fte": entry["totals"]["peak_fte"],
                    "monthly": monthly,
                })

        return ForecastResponse(
            status="success",
            data={
                "labor": labor_utilization,
                **scope_metadata(scope),
                "periods": periods,
                "hours_per_fte": fte_hours,
                "warnings": warnings,
            },
            message=f"Retrieved utilization for {len(labor_utilization)} labor types"
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving labor utilization: {str(e)}")
    finally:
        db_manager.close_connection(conn)
