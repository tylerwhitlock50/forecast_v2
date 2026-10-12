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
overhead, indirect labor and the direct labor variance (payroll classed
direct or indirect, see financial_statements.labor_lines_by_period), so it
ties to the income statement.
"""
from __future__ import annotations

import math
from datetime import datetime
from decimal import ROUND_HALF_EVEN, Decimal
from typing import Any, Dict, Iterable, List, Optional, Sequence

from services.financial_statements import (
    describe_labor_policy,
    labor_coverage,
    require_known_scenarios,
    expenses_by_period,
    labor_lines_by_period,
    load_sales_lines,
    payroll_by_period,
    period_range,
    validate_period,
    window_total,
)
from services.pricing import CONTRA_REVENUE_TYPES

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


def _type_label(value: Any) -> str:
    return str(value).strip() if value is not None and str(value).strip() else "Unassigned"


def _type_key(value: Any) -> str:
    """Customer / product types group case-insensitively ('Dealer' == 'dealer ')."""
    return _type_label(value).lower()


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
    # Payroll classed direct / indirect lands in COGS exactly as on the income statement.
    labor_lines = labor_lines_by_period(payroll_by_period(cursor, forecast_ids, periods),
                                        {p: by_period_metrics[p]["labor"] for p in periods}, periods)

    summary_rows: List[Dict[str, Any]] = []
    totals = _empty_metrics()
    totals.update({"labor_variance": 0.0, "indirect_labor": 0.0, "factory_overhead": 0.0, "other_cogs": 0.0,
                   "total_cogs": 0.0, "gross_profit": 0.0})
    for p in periods:
        m = by_period_metrics[p]
        overhead = expenses["factory_overhead"][p]
        other = expenses["other_cogs"][p]
        variance = labor_lines["labor_variance"][p]
        indirect = labor_lines["indirect_labor"][p]
        total_cogs = m["product_cogs"] + variance + indirect + overhead + other
        row = {"period": p, **m, "labor_variance": variance, "indirect_labor": indirect,
               "factory_overhead": overhead, "other_cogs": other,
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
    elif lines and not loaded["rows_with_deductions"]:
        warnings.append({
            "code": "no_deduction_rules",
            "level": "info",
            "rule_count": loaded["deduction_rule_count"],
            "message": f"{loaded['deduction_rule_count']} deduction rule(s) exist but none applies to the sales in "
                       f"this window (check their customer / product scope and months), so net sales equal gross sales.",
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
        "by_customer_type": _group(lines, periods, lambda l: _type_key(l["customer_type"]),
                                   lambda l: {"customer_type": _type_label(l["customer_type"])}),
        "by_product_type": _group(lines, periods, lambda l: _type_key(l["unit_type"]),
                                  lambda l: {"unit_type": _type_label(l["unit_type"])}),
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
    # Standard direct labor cost per month, added line by line exactly as the statements engine adds
    # line['labor'] (revenue_and_cogs_by_period), so it is the income statement's Direct labor (standard)
    # to the cent; the per-labor-type costs below are a breakdown of it.
    standard_cost = {p: 0.0 for p in periods}
    for line in lines:
        p = line["period"]
        standard_cost[p] += line["labor"]
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
        entry["totals"] = {
            "hours": hours_total, "cost": cost_total,
            "avg_fte": sum(ftes) / len(ftes) if ftes else 0.0,
            "peak_fte": max(ftes) if ftes else 0.0,
        }
        by_labor_type.append(_round(entry))
    by_labor_type.sort(key=lambda e: -(e["totals"]["hours"] or 0))
    for p, bucket in totals_by_period.items():
        bucket["fte"] = bucket["hours"] / hours_per_fte
        bucket["cost"] = standard_cost[p]          # the statement's figure, not the sum of the per-type rows
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

    payroll = payroll_by_period(cursor, forecast_ids, periods)
    payroll_cost = window_total(payroll["total"], periods)
    labor_lines = labor_lines_by_period(payroll, standard_cost, periods)

    # Standard (routings) vs payroll (employees classed direct), month by month.
    comparison_rows = []
    sums = {"standard_hours": 0.0, "standard_cost": 0.0, "direct_payroll_cost": 0.0, "paid_hours": 0.0,
            "labor_variance": 0.0, "indirect_payroll_cost": 0.0}
    for p in periods:
        paid_hours = payroll["paid_hours_by_class"]["direct"][p]
        row = {
            "period": p,
            "standard_hours": totals_by_period[p]["hours"],
            "standard_cost": totals_by_period[p]["cost"],
            "direct_payroll_cost": labor_lines["direct_payroll"][p],
            "paid_hours": paid_hours,
            "labor_variance": labor_lines["labor_variance"][p],
            "indirect_payroll_cost": labor_lines["indirect_labor"][p],
        }
        row["utilization_pct"] = row["standard_hours"] / paid_hours * 100 if paid_hours > 0 else None
        for key in sums:
            sums[key] += row[key]
        comparison_rows.append(_round(row))
    sums["utilization_pct"] = sums["standard_hours"] / sums["paid_hours"] * 100 if sums["paid_hours"] > 0 else None
    # Window totals are the month-by-month sums above (the statements' own arithmetic), never a second sum().
    direct_labor_cost = sums["standard_cost"]
    admin_cost = window_total(labor_lines["payroll"], periods)
    unclassified = payroll["unclassified_employees"]
    coverage = labor_coverage(labor_lines["direct_payroll"], standard_cost, periods)
    policy_message = describe_labor_policy(direct_labor_cost, sums["direct_payroll_cost"], sums["labor_variance"],
                                           sums["indirect_payroll_cost"], admin_cost, unclassified,
                                           standard_only=coverage["standard_only_labor"],
                                           direct_months=coverage["months_with_direct_pay"],
                                           standard_only_months=coverage["standard_only_months"])
    if sums["direct_payroll_cost"] > 0 and sums["paid_hours"] > 0:
        policy_message += (f" Employees classed Direct are paid for {sums['paid_hours']:,.0f} hours; the routings "
                           f"need {sums['standard_hours']:,.0f} ({sums['utilization_pct']:,.0f}% utilization).")

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
            "hours": sums["standard_hours"],
            "cost": direct_labor_cost,
            "avg_fte": sum(all_ftes) / len(all_ftes) if all_ftes else 0.0,
            "peak_fte": max(all_ftes) if all_ftes else 0.0,
            "direct_payroll_cost": sums["direct_payroll_cost"],
            "paid_hours": sums["paid_hours"],
            "labor_variance": sums["labor_variance"],
            "utilization_pct": sums["utilization_pct"],
            "indirect_payroll_cost": sums["indirect_payroll_cost"],
        }),
        "standard_vs_payroll": {
            "by_period": comparison_rows,
            "totals": _round(sums),
            "direct_employee_count": sum(1 for e in payroll["employees"]
                                         if e.get("labor_class") == "direct" and e["total"] > 0),
            "basis": ("Standard = routing labor minutes x units sold (hours) and x labor rates (cost). Paid hours = "
                      "weekly hours x 52 / 12 of employees classed Direct, prorated for start and end dates. "
                      "Utilization = standard hours / paid hours. Variance = direct payroll - standard cost in "
                      "months with direct payroll; it is the Direct labor variance line on the income statement."),
        },
        "by_machine": by_machine,
        "by_product": by_product,
        "payroll_note": _round({
            "direct_labor_cost": direct_labor_cost,
            "payroll_cost": payroll_cost,
            "direct_payroll_cost": sums["direct_payroll_cost"],
            "indirect_payroll_cost": sums["indirect_payroll_cost"],
            "admin_payroll_cost": admin_cost,
            "labor_variance": sums["labor_variance"],
            "cogs_direct_labor": round(round(direct_labor_cost, 2) + round(sums["labor_variance"], 2), 2),
            "months_with_direct_pay": coverage["months_with_direct_pay"],
            "standard_only_months": coverage["standard_only_months"],
            "standard_only_labor": coverage["standard_only_labor"],
            "unclassified_employees": unclassified,
            "message": policy_message,
        }),
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Sales detail (one flat row per sales line, for the table and the export)
# ---------------------------------------------------------------------------

#: Money columns of a sales detail row. Each is a cent amount on every row.
DETAIL_MONEY_COLUMNS = (
    "gross_sales", "terms_allowance", "chargebacks", "other_allowances", "excise_tax", "total_sales_deductions",
    "net_sales", "commissions", "materials", "labor", "machine", "product_cogs", "contribution_margin",
)
#: Columns that are not meaningful to add up across rows.
DETAIL_NOT_SUMMED = frozenset({"unit_price"})
#: Filters sales_detail_report accepts.
DETAIL_FILTERS = ("period", "customer_id", "customer_type", "unit_id", "unit_type")
#: Decimals kept on a row's unit price (a 40%-off-list price of 23.994 stays 23.994).
PRICE_DECIMALS = 4

_CENT = Decimal("0.01")


def _cents(value: Any) -> float:
    """Round a money amount to the cent (decimal half-even, so exact half cents do not drift the totals up)."""
    number = float(value or 0)
    if not math.isfinite(number):
        return 0.0
    return float(Decimal(repr(number)).quantize(_CENT, rounding=ROUND_HALF_EVEN)) + 0.0


def _detail_row(line: Dict[str, Any]) -> Dict[str, Any]:
    """
    One flat sales detail row whose money columns are cent amounts that
    cross-foot: quantity x unit price = gross sales (unit price kept to 4
    decimals), the deduction columns add up to total sales deductions,
    gross - deductions = net sales, materials + labor + machine = product
    COGS and net sales - product COGS = contribution margin.
    """
    gross = _cents(line["gross_sales"])
    terms = _cents(line["terms_allowance"])
    chargebacks = _cents(line["chargebacks"])
    other = _cents(line["other_allowance"])
    excise = _cents(line["excise_tax"])
    deductions = round(terms + chargebacks + other + excise, 2)
    net = round(gross - deductions, 2)
    materials = _cents(line["materials"])
    labor = _cents(line["labor"])
    machine = _cents(line["machine"])
    cogs = round(materials + labor + machine, 2)
    return {
        "period": line["period"],
        "forecast_id": line["forecast_id"],
        "sale_id": line["sale_id"],
        "customer_id": line["customer_id"],
        "customer_name": line["customer_name"],
        "customer_type": line["customer_type"],
        "unit_id": line["unit_id"],
        "unit_name": line["unit_name"],
        "unit_type": line["unit_type"],
        "quantity": round(float(line["quantity"] or 0), 4),
        "unit_price": round(float(line["unit_price"] or 0), PRICE_DECIMALS),
        "gross_sales": gross,
        "terms_allowance": terms,
        "chargebacks": chargebacks,
        "other_allowances": other,
        "excise_tax": excise,
        "total_sales_deductions": deductions,
        "net_sales": net,
        "commissions": _cents(line["commission"]),
        "materials": materials,
        "labor": labor,
        "machine": machine,
        "product_cogs": cogs,
        "contribution_margin": round(net - cogs, 2),
        "labor_hours": round(line["labor_minutes"] / 60.0, 4),
        "machine_hours": round(line["machine_minutes"] / 60.0, 4),
        "rules_applied": ", ".join(f"{k}={v}" for k, v in sorted(line["applied_rules"].items())),
    }


def _unrounded_values(line: Dict[str, Any]) -> Dict[str, float]:
    """The engine's unrounded amounts of a line, under the sales detail keys."""
    return {
        "quantity": float(line["quantity"] or 0),
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
    }


#: Sales detail keys of the deductions that reduce gross sales to net sales, in statement order.
_CONTRA_DETAIL_KEYS = tuple(_LINE_TO_REPORT[t] for t in CONTRA_REVENUE_TYPES)


def _statement_sums(lines: Iterable[Dict[str, Any]], periods: Sequence[str]) -> Dict[str, float]:
    """
    Window totals of the engine's unrounded lines, added the way the
    statements add them: each line into its month in load order
    (revenue_and_cogs_by_period, build_cogs_forecast), then the months in
    order (window_total, the statements' totals). One running sum over all
    the lines is the same maths in another order and can land on the other
    side of a half cent: the 2027 sample's direct labor is 449,997.575 to
    the float, .57 month by month and .58 line by line. Total sales
    deductions is, as on the income statement, each month's terms +
    chargebacks + other allowances + excise tax.
    """
    by_period: Dict[str, Dict[str, float]] = {}
    for line in lines:
        p = line["period"]
        for key, value in _unrounded_values(line).items():
            month = by_period.setdefault(key, {})
            month[p] = month.get(p, 0.0) + float(value or 0)
    deductions = by_period.get("total_sales_deductions")
    if deductions is not None:
        for p in deductions:
            deductions[p] = sum(by_period[k].get(p, 0.0) for k in _CONTRA_DETAIL_KEYS)
    return {key: window_total(months, periods) for key, months in by_period.items()}


def _finish_sums(sums: Dict[str, float]) -> Dict[str, float]:
    """Money to the cent; quantities and hours to 4 decimals."""
    return {k: (round(v, 2) if k in DETAIL_MONEY_COLUMNS else round(v, 4)) + 0.0 for k, v in sums.items()}


def detail_totals(rows: Iterable[Dict[str, Any]]) -> Dict[str, float]:
    """
    Column totals of sales detail rows as they are shown (every numeric
    column except the unit price): money to the cent, quantities and hours
    to 4 decimals. They equal a SUM of the column in Excel.
    """
    sums: Dict[str, float] = {}
    for row in rows:
        for key, value in row.items():
            if key in DETAIL_NOT_SUMMED or isinstance(value, bool) or not isinstance(value, (int, float)):
                continue
            sums[key] = sums.get(key, 0.0) + float(value)
    return _finish_sums(sums)


def _matches(line: Dict[str, Any], filters: Dict[str, str]) -> bool:
    for key, wanted in filters.items():
        value = line.get(key)
        if key in ("customer_type", "unit_type"):
            if str(value or "").strip().lower() != wanted.strip().lower():
                return False
        elif str(value or "").strip() != wanted.strip():
            return False
    return True


def sales_detail_report(cursor, forecast_ids: Sequence[str], start_period: str, end_period: str,
                        filters: Optional[Dict[str, Optional[str]]] = None) -> Dict[str, Any]:
    """
    The window's sales lines as flat, export-ready rows plus three sets of
    totals:

    * ``rows``: one row per sales line (see ``_detail_row``); money columns
      are cent amounts that cross-foot on the row, the unit price keeps 4
      decimals.
    * ``totals``: the sums of the rows as shown, so they equal a SUM of the
      column in Excel.
    * ``report_totals``: the sums of the engine's unrounded lines, added
      month by month as the statements add them (see _statement_sums) and
      rounded once. Without filters every column equals the income
      statement for the window to the cent (product COGS and contribution
      margin equal the COGS forecast); with only a ``period`` filter they
      equal that month's. With a product / customer / type filter they are
      added line by line, as the COGS forecast adds its groups, so they
      equal that group (by_product, by_customer, ...) to the cent.
    * ``rounding``: ``report_totals - totals`` per column: what rounding
      every line to the cent moved the column total (usually a few cents).

    ``filters`` (optional, all must match): ``period`` (a YYYY-MM month in
    the window), ``customer_id``, ``unit_id`` (exact), ``customer_type``,
    ``unit_type`` (case-insensitive). Raises ValueError for a bad window or
    period, an unknown scenario or an unknown filter.
    """
    periods = period_range(start_period, end_period)
    forecast_ids = [f for f in forecast_ids if f]
    require_known_scenarios(cursor, forecast_ids)
    active = {k: str(v) for k, v in (filters or {}).items() if v is not None and str(v).strip()}
    unknown = sorted(set(active) - set(DETAIL_FILTERS))
    if unknown:
        raise ValueError(f"Unknown sales detail filter(s): {', '.join(unknown)}")
    if "period" in active:
        active["period"] = validate_period(active["period"].strip())
        if active["period"] not in periods:
            raise ValueError(f"period {active['period']} is outside the window {periods[0]} to {periods[-1]}")
    loaded = load_sales_lines(cursor, forecast_ids, periods)

    matched = [line for line in loaded["lines"] if not active or _matches(line, active)]
    rows = [_detail_row(line) for line in matched]
    totals = detail_totals(rows)
    if any(key != "period" for key in active):
        # A product / customer / type filter: added line by line, as the COGS forecast's group views add a
        # group (by_product, by_customer, ...), so the filtered totals equal that group to the cent.
        sums: Dict[str, float] = {}
        for line in matched:
            for key, value in _unrounded_values(line).items():
                sums[key] = sums.get(key, 0.0) + float(value or 0)
    else:
        sums = _statement_sums(matched, periods)
    report_totals = _finish_sums(sums) if rows else {}
    rounding = {k: round(report_totals[k] - totals.get(k, 0.0), 2) + 0.0
                for k in DETAIL_MONEY_COLUMNS if k in report_totals}
    return {
        "rows": rows,
        "filters": active,
        "totals": totals,
        "report_totals": report_totals,
        "rounding": rounding,
    }


def sales_detail_rows(cursor, forecast_ids: Sequence[str], start_period: str, end_period: str) -> List[Dict[str, Any]]:
    """Flat, export-ready sales lines (no nested dicts) for the window; see sales_detail_report."""
    return sales_detail_report(cursor, forecast_ids, start_period, end_period)["rows"]
