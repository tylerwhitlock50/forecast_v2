"""
COGS and labor forecasts.

Both reports aggregate the same enriched sales lines the statements engine
uses (financial_statements.load_sales_lines), so:

  * the COGS forecast's monthly gross profit equals the income statement's,
  * its labor and machine COGS equal the statement's direct labor and
    machine lines, and
  * the labor forecast's labor cost equals the statement's direct labor.

Per product / customer / customer type figures are a contribution margin
before factory overhead (overhead is a period expense from expense
allocations, not a per-unit cost); only the monthly summary carries
overhead, so it ties to the income statement.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence

from services.financial_statements import (
    require_known_scenarios,
    expenses_by_period,
    load_sales_lines,
    payroll_by_period,
    period_range,
)

DEFAULT_HOURS_PER_FTE = round(40 * 52 / 12, 2)  # 173.33 paid hours per month

# Line key -> report key (statement-style names).
_LINE_TO_REPORT = {
    "quantity": "units",
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
    "contribution_margin": "contribution_margin",
}
REPORT_METRICS = list(_LINE_TO_REPORT.values())
PERIOD_METRICS = ("units", "gross_sales", "total_sales_deductions", "net_sales", "product_cogs", "contribution_margin")


def _pct(numerator: float, denominator: float) -> float:
    return round(numerator / denominator * 100, 2) if denominator else 0.0


def _round(value: Any, ndigits: int = 2) -> Any:
    if isinstance(value, float):
        return round(value, ndigits)
    if isinstance(value, dict):
        # FTEs are small numbers; keep a third decimal.
        return {k: _round(v, max(ndigits, 3) if "fte" in str(k) else ndigits) for k, v in value.items()}
    if isinstance(value, list):
        return [_round(v, ndigits) for v in value]
    return value


def _empty_metrics() -> Dict[str, float]:
    return {m: 0.0 for m in REPORT_METRICS}


def _add_line(target: Dict[str, float], line: Dict[str, Any]) -> None:
    for line_key, report_key in _LINE_TO_REPORT.items():
        target[report_key] += float(line.get(line_key) or 0)


def _finish_totals(t: Dict[str, float]) -> Dict[str, float]:
    units = t.get("units", 0.0)
    t["contribution_margin_pct"] = _pct(t["contribution_margin"], t["net_sales"])
    t["deduction_pct_of_gross"] = _pct(t["total_sales_deductions"], t["gross_sales"])
    t["avg_gross_price"] = t["gross_sales"] / units if units else 0.0
    t["avg_net_price"] = t["net_sales"] / units if units else 0.0
    t["cost_per_unit"] = t["product_cogs"] / units if units else 0.0
    return t


def _group(lines: Sequence[Dict[str, Any]], periods: Sequence[str], key_fn, header_fn) -> List[Dict[str, Any]]:
    groups: Dict[Any, Dict[str, Any]] = {}
    for line in lines:
        key = key_fn(line)
        entry = groups.get(key)
        if entry is None:
            entry = {
                **header_fn(line),
                "totals": _empty_metrics(),
                "by_period": {p: {m: 0.0 for m in PERIOD_METRICS} for p in periods},
            }
            groups[key] = entry
        _add_line(entry["totals"], line)
        bucket = entry["by_period"][line["period"]]
        bucket["units"] += line["quantity"]
        bucket["gross_sales"] += line["gross_sales"]
        bucket["total_sales_deductions"] += line["total_sales_deductions"]
        bucket["net_sales"] += line["net_sales"]
        bucket["product_cogs"] += line["product_cogs"]
        bucket["contribution_margin"] += line["contribution_margin"]
    out = []
    for entry in groups.values():
        _finish_totals(entry["totals"])
        out.append(_round(entry))
    out.sort(key=lambda e: -(e["totals"].get("net_sales") or 0))
    return out


def build_cogs_forecast(cursor, forecast_ids: Sequence[str], start_period: str, end_period: str) -> Dict[str, Any]:
    """Gross sales -> deductions -> net sales -> COGS -> gross profit, by month and by dimension."""
    forecast_ids = [f for f in forecast_ids if f]
    if not forecast_ids:
        raise ValueError("At least one forecast_id is required")
    periods = period_range(start_period, end_period)
    require_known_scenarios(cursor, forecast_ids)
    loaded = load_sales_lines(cursor, forecast_ids, periods)
    lines = loaded["lines"]
    expenses = expenses_by_period(cursor, forecast_ids, periods)

    by_period_metrics = {p: _empty_metrics() for p in periods}
    for line in lines:
        _add_line(by_period_metrics[line["period"]], line)

    summary_rows: List[Dict[str, Any]] = []
    totals = _empty_metrics()
    totals.update({"factory_overhead": 0.0, "other_cogs": 0.0, "total_cogs": 0.0, "gross_profit": 0.0})
    for p in periods:
        m = by_period_metrics[p]
        overhead = expenses["factory_overhead"][p]
        other = expenses["other_cogs"][p]
        total_cogs = m["product_cogs"] + overhead + other
        row = {"period": p, **m, "factory_overhead": overhead, "other_cogs": other,
               "total_cogs": total_cogs, "gross_profit": m["net_sales"] - total_cogs}
        row["gross_margin_pct"] = _pct(row["gross_profit"], row["net_sales"])
        row["contribution_margin_pct"] = _pct(row["contribution_margin"], row["net_sales"])
        summary_rows.append(_round(row))
        for k in totals:
            totals[k] += row[k]
    _finish_totals(totals)
    totals["gross_margin_pct"] = _pct(totals["gross_profit"], totals["net_sales"])

    unit_costs = []
    for uc in loaded["unit_costs"].values():
        unit_costs.append(_round({
            "unit_id": uc["unit_id"], "unit_name": uc["unit_name"], "unit_type": uc["unit_type"],
            "bom_id": uc["bom_id"], "bom_version": uc["bom_version"], "router_id": uc["router_id"],
            "material_per_unit": uc["material_per_unit"], "labor_per_unit": uc["labor_per_unit"],
            "machine_per_unit": uc["machine_per_unit"],
            "total_per_unit": uc["material_per_unit"] + uc["labor_per_unit"] + uc["machine_per_unit"],
            "labor_minutes_per_unit": uc.get("labor_minutes_per_unit", 0.0),
            "machine_minutes_per_unit": uc.get("machine_minutes_per_unit", 0.0),
            "warnings": uc["warnings"],
        }, 4))
    unit_costs.sort(key=lambda u: str(u["unit_id"]))

    warnings: List[Dict[str, Any]] = []
    if loaded["cost_warnings"]:
        warnings.append({
            "code": "cost_warnings",
            "message": f"{len(loaded['cost_warnings'])} product(s) have incomplete BOM/routing data; their COGS may be understated.",
            "products": loaded["cost_warnings"],
        })
    if loaded["non_monthly_rows"]:
        warnings.append({
            "code": "non_monthly_sales_periods",
            "message": f"{loaded['non_monthly_rows']} sales row(s) have a period that is not a YYYY-MM month and are not included.",
        })
    if lines and not loaded["deduction_rule_count"]:
        warnings.append({
            "code": "no_deduction_rules",
            "level": "info",
            "message": "No discount, allowance, excise or commission rules are set up, so net sales equal gross sales.",
        })

    return {
        "forecast_ids": forecast_ids,
        "periods": periods,
        "start_period": periods[0],
        "end_period": periods[-1],
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "line_count": len(lines),
        "summary": {"by_period": summary_rows, "totals": _round(totals)},
        "by_product": _group(lines, periods, lambda l: l["unit_id"],
                             lambda l: {"unit_id": l["unit_id"], "unit_name": l["unit_name"], "unit_type": l["unit_type"]}),
        "by_customer": _group(lines, periods, lambda l: l["customer_id"],
                              lambda l: {"customer_id": l["customer_id"], "customer_name": l["customer_name"],
                                         "customer_type": l["customer_type"]}),
        "by_customer_type": _group(lines, periods, lambda l: l["customer_type"] or "Unassigned",
                                   lambda l: {"customer_type": l["customer_type"] or "Unassigned"}),
        "by_product_type": _group(lines, periods, lambda l: l["unit_type"] or "Unassigned",
                                  lambda l: {"unit_type": l["unit_type"] or "Unassigned"}),
        "unit_costs": unit_costs,
        "deduction_rule_count": loaded["deduction_rule_count"],
        "warnings": warnings,
    }


def build_labor_forecast(cursor, forecast_ids: Sequence[str], start_period: str, end_period: str,
                         hours_per_fte: Optional[float] = None) -> Dict[str, Any]:
    """Direct labor hours, cost and FTEs by labor type by month, plus machine hours vs capacity."""
    forecast_ids = [f for f in forecast_ids if f]
    if not forecast_ids:
        raise ValueError("At least one forecast_id is required")
    hours_per_fte = float(hours_per_fte or DEFAULT_HOURS_PER_FTE)
    if hours_per_fte <= 0:
        raise ValueError("hours_per_fte must be positive")
    periods = period_range(start_period, end_period)
    require_known_scenarios(cursor, forecast_ids)
    loaded = load_sales_lines(cursor, forecast_ids, periods)
    lines = loaded["lines"]

    cursor.execute("SELECT rate_id, rate_name, rate_amount FROM labor_rates")
    rates = {rid: (name, amount) for rid, name, amount in cursor.fetchall()}
    cursor.execute("SELECT machine_id, machine_name, machine_rate, available_minutes_per_month FROM machines")
    machines = {mid: (name, rate, avail) for mid, name, rate, avail in cursor.fetchall()}

    labor: Dict[str, Dict[str, Any]] = {}
    machine: Dict[str, Dict[str, Any]] = {}
    products: Dict[str, Dict[str, Any]] = {}
    for line in lines:
        p = line["period"]
        for type_id, v in line["labor_by_type"].items():
            name, amount = rates.get(type_id, (None, None))
            entry = labor.setdefault(type_id, {
                "labor_type_id": type_id,
                "labor_type_name": name or ("Unassigned (no labor type on the routing step)" if type_id == "unassigned" else type_id),
                "hourly_rate": amount,
                "by_period": {q: {"hours": 0.0, "cost": 0.0, "fte": 0.0} for q in periods},
            })
            entry["by_period"][p]["hours"] += v["minutes"] / 60.0
            entry["by_period"][p]["cost"] += v["cost"]
        for machine_id, v in line["machine_by_id"].items():
            name, rate, avail = machines.get(machine_id, (None, None, None))
            entry = machine.setdefault(machine_id, {
                "machine_id": machine_id,
                "machine_name": name or machine_id,
                "machine_rate": rate,
                "available_hours_per_month": (float(avail) / 60.0) if avail else None,
                "by_period": {q: {"hours": 0.0, "cost": 0.0, "utilization_pct": None} for q in periods},
            })
            entry["by_period"][p]["hours"] += v["minutes"] / 60.0
            entry["by_period"][p]["cost"] += v["cost"]
        prod = products.setdefault(line["unit_id"] or "unknown", {
            "unit_id": line["unit_id"], "unit_name": line["unit_name"],
            "units": 0.0, "labor_hours": 0.0, "labor_cost": 0.0, "machine_hours": 0.0,
        })
        prod["units"] += line["quantity"]
        prod["labor_hours"] += line["labor_minutes"] / 60.0
        prod["labor_cost"] += line["labor"]
        prod["machine_hours"] += line["machine_minutes"] / 60.0

    totals_by_period = {p: {"period": p, "hours": 0.0, "cost": 0.0, "fte": 0.0} for p in periods}
    by_labor_type = []
    for entry in labor.values():
        hours_total = cost_total = 0.0
        ftes = []
        for p, bucket in entry["by_period"].items():
            bucket["fte"] = bucket["hours"] / hours_per_fte
            hours_total += bucket["hours"]
            cost_total += bucket["cost"]
            ftes.append(bucket["fte"])
            totals_by_period[p]["hours"] += bucket["hours"]
            totals_by_period[p]["cost"] += bucket["cost"]
        entry["totals"] = {
            "hours": hours_total, "cost": cost_total,
            "avg_fte": sum(ftes) / len(ftes) if ftes else 0.0,
            "peak_fte": max(ftes) if ftes else 0.0,
        }
        by_labor_type.append(_round(entry))
    by_labor_type.sort(key=lambda e: -(e["totals"]["hours"] or 0))
    for bucket in totals_by_period.values():
        bucket["fte"] = bucket["hours"] / hours_per_fte
    period_rows = [_round(totals_by_period[p]) for p in periods]
    all_ftes = [totals_by_period[p]["fte"] for p in periods]

    warnings: List[Dict[str, Any]] = []
    by_machine = []
    for entry in machine.values():
        avail = entry["available_hours_per_month"]
        over = []
        hours_total = cost_total = 0.0
        peak = None
        for p, bucket in entry["by_period"].items():
            hours_total += bucket["hours"]
            cost_total += bucket["cost"]
            if avail:
                bucket["utilization_pct"] = bucket["hours"] / avail * 100
                peak = max(peak or 0.0, bucket["utilization_pct"])
                if bucket["utilization_pct"] > 100:
                    over.append(p)
        entry["totals"] = {"hours": hours_total, "cost": cost_total, "peak_utilization_pct": peak}
        entry["over_capacity_periods"] = over
        if over:
            warnings.append({
                "code": "machine_over_capacity",
                "message": f"{entry['machine_name']} needs more hours than available in {len(over)} month(s).",
                "machine_id": entry["machine_id"],
                "periods": over,
            })
        by_machine.append(_round(entry))
    by_machine.sort(key=lambda e: -(e["totals"]["hours"] or 0))

    by_product = []
    for prod in products.values():
        prod["labor_hours_per_unit"] = prod["labor_hours"] / prod["units"] if prod["units"] else 0.0
        by_product.append(_round(prod, 4))
    by_product.sort(key=lambda e: -(e["labor_hours"] or 0))

    if "unassigned" in labor:
        warnings.append({
            "code": "labor_without_type",
            "message": "Some routing steps have labor minutes but no labor type, so their hours are listed as "
                       "'Unassigned' and cost $0. Set a labor type on those steps.",
        })
    missing_rates = sorted(t for t in labor if t != "unassigned" and t not in rates)
    if missing_rates:
        warnings.append({
            "code": "missing_labor_rates",
            "message": f"Routing steps use labor types with no rate: {', '.join(missing_rates)} (cost $0).",
            "labor_type_ids": missing_rates,
        })
    if loaded["cost_warnings"]:
        warnings.append({
            "code": "cost_warnings",
            "message": f"{len(loaded['cost_warnings'])} product(s) have incomplete BOM/routing data.",
            "products": loaded["cost_warnings"],
        })

    direct_labor_cost = sum(r["cost"] for r in totals_by_period.values())
    payroll = payroll_by_period(cursor, forecast_ids, periods)
    payroll_cost = sum(payroll["total"].values())

    return {
        "forecast_ids": forecast_ids,
        "periods": periods,
        "start_period": periods[0],
        "end_period": periods[-1],
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "hours_per_fte": hours_per_fte,
        "by_labor_type": by_labor_type,
        "totals_by_period": period_rows,
        "totals": _round({
            "hours": sum(r["hours"] for r in totals_by_period.values()),
            "cost": direct_labor_cost,
            "avg_fte": sum(all_ftes) / len(all_ftes) if all_ftes else 0.0,
            "peak_fte": max(all_ftes) if all_ftes else 0.0,
        }),
        "by_machine": by_machine,
        "by_product": by_product,
        "payroll_note": _round({
            "direct_labor_cost": direct_labor_cost,
            "payroll_cost": payroll_cost,
            "message": (
                "Direct labor in COGS is routing minutes x labor rates. Payroll is reported separately as an "
                "operating expense. If production workers are also entered in Payroll their cost is counted "
                "twice; keep direct workers out of Payroll (or out of the routing labor rates)."
            ),
        }),
        "warnings": warnings,
    }


def sales_detail_rows(cursor, forecast_ids: Sequence[str], start_period: str, end_period: str) -> List[Dict[str, Any]]:
    """Flat, export-ready sales lines (no nested dicts) for the window."""
    periods = period_range(start_period, end_period)
    forecast_ids = [f for f in forecast_ids if f]
    require_known_scenarios(cursor, forecast_ids)
    loaded = load_sales_lines(cursor, forecast_ids, periods)
    out = []
    for line in loaded["lines"]:
        out.append(_round({
            "period": line["period"],
            "forecast_id": line["forecast_id"],
            "sale_id": line["sale_id"],
            "customer_id": line["customer_id"],
            "customer_name": line["customer_name"],
            "customer_type": line["customer_type"],
            "unit_id": line["unit_id"],
            "unit_name": line["unit_name"],
            "unit_type": line["unit_type"],
            "quantity": line["quantity"],
            "unit_price": line["unit_price"],
            "gross_sales": line["gross_sales"],
            "terms_allowance": line["terms_allowance"],
            "chargebacks": line["chargebacks"],
            "other_allowances": line["other_allowance"],
            "excise_tax": line["excise_tax"],
            "total_sales_deductions": line["total_sales_deductions"],
            "net_sales": line["net_sales"],
            "commissions": line["commission"],
            "materials": line["materials"],
            "labor": line["labor"],
            "machine": line["machine"],
            "product_cogs": line["product_cogs"],
            "contribution_margin": line["contribution_margin"],
            "labor_hours": line["labor_minutes"] / 60.0,
            "machine_hours": line["machine_minutes"] / 60.0,
            "rules_applied": ", ".join(f"{k}={v}" for k, v in sorted(line["applied_rules"].items())),
        }))
    return out
