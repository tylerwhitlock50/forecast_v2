"""
Financial statements engine.

Single source of truth for the reporting module. Builds a period-by-period
income statement, cash flow statement and balance sheet for one or more
forecast scenarios, driven entirely by data already in the database:

  * revenue + product COGS   -> sales / units / bom / routers  (utils.cost_rollup)
  * sales deductions         -> sales_deduction_rules (services.pricing): terms,
                                chargebacks, other allowances and embedded excise
                                tax take gross sales to net sales; commissions
                                are a selling expense
  * payroll                  -> payroll / payroll_config, prorated to each month
  * overhead + opex          -> expense_allocations / expenses / expense_categories
  * interest + principal     -> loan_payments / loans
  * capex + depreciation     -> capital_expenditures (+ opening fixed assets)
  * opening balances, DSO/DIO/DPO, tax rate -> financial_assumptions

Every function takes an open sqlite cursor and returns plain dicts so the
route layer stays thin and the maths is unit-testable without HTTP.

Conventions
-----------
* Periods are 'YYYY-MM' strings. A reporting window is inclusive on both ends.
* Opening balances are stated as at the END of assumptions.opening_period; the
  model starts the month after. A window that starts later is rolled forward
  from there (see resolve_carry_forward), so the balances a window reports
  never depend on where the window starts.
* Cash flow totals sum flows; opening/closing cash totals are balances.
* Scenario scoping: rows whose forecast_id is in the selected set OR NULL are
  included. NULL means "company-wide" (shared by every scenario). Revenue is
  always scenario-specific so it is never NULL-scoped.
* "revenue" on the income statement is NET sales: gross sales less the
  contra-revenue deductions (terms allowance, chargebacks, other allowances,
  excise tax). With no deduction rules net sales equal gross sales.
* Working capital uses a simple days convention:
      AR  = (net sales + excise tax) * dso_days / AVG_DAYS_PER_MONTH
      INV = product_cogs_in_month    * dio_days / AVG_DAYS_PER_MONTH
      AP  = purchases_in_month       * dpo_days / AVG_DAYS_PER_MONTH
      Excise tax payable = excise_in_month * excise_payable_days / AVG_DAYS_PER_MONTH
  AR is what customers owe: the invoice (which includes the embedded excise)
  less the allowances they deduct. Purchases = materials + factory overhead
  + other COGS + admin + operating expenses + commissions (payroll is
  assumed paid in-month).
* Debt is rolled forward from the opening balance using scheduled principal
  payments and new-loan proceeds, which keeps the balance sheet identity exact.
* Opening equity is plugged so the opening balance sheet balances unless the
  user supplies it explicitly, in which case any imbalance is reported.
* Income tax accrues on year-to-date pre-tax income within each calendar
  year, so loss months net against profitable ones; the year's tax is never
  negative (no carry-back / carry-forward across years).
* Payroll burden is employer cost only (social security, medicare,
  unemployment, workers comp, benefits); income tax withheld from employees
  is not added. Salaried employees store their annual salary. Each month
  accrues annual cost / 12, weighted by day for a hire, a leaver and a raise
  (which applies from next_review_date itself); pay runs weight their pay
  period's days the same way (gross_for_days).
* Labor classes (payroll.labor_class) decide where pay lands, automatically:
    admin or not classified -> operating expense 'payroll';
    indirect                -> COGS 'indirect_labor' (factory support staff);
    direct                  -> COGS. 'cogs_labor' stays the routing standard
                               and, in every month with direct payroll,
                               'labor_variance' = direct payroll - standard,
                               so total direct labor = direct payroll and no
                               production worker is counted twice.
  With no employee classed direct the statement is the routing standard only,
  as before. Inventory (DIO) is always valued on product COGS at standard.
"""
from __future__ import annotations

import calendar
import json
import re
from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from services.pricing import (
    CONTRA_REVENUE_TYPES,
    DEDUCTION_TYPES,
    DeductionResolver,
    load_deduction_rules,
)
from utils.cost_rollup import calculate_unit_costs

AVG_DAYS_PER_MONTH = 365.25 / 12

DEFAULT_ASSUMPTIONS: Dict[str, Any] = {
    "opening_period": None,
    "opening_cash": 0.0,
    "opening_accounts_receivable": 0.0,
    "opening_inventory": 0.0,
    "opening_fixed_assets": 0.0,
    "opening_accumulated_depreciation": 0.0,
    "opening_fixed_assets_remaining_life_months": 0,
    "opening_accounts_payable": 0.0,
    "opening_other_liabilities": 0.0,
    "opening_equity": None,
    "dso_days": 30.0,
    "dio_days": 60.0,
    "dpo_days": 30.0,
    "income_tax_rate": 0.21,
    "minimum_cash_balance": 0.0,
    "excise_payable_days": 30.0,
    "notes": None,
}

#: The company's biweekly pay calendar when payroll_config.pay_anchor_date is
#: not set: a fixed Friday, so every report, window and the pay-run forecast
#: use the same paydays (this one puts paydays on 1 Jan 2027 and 2 Jan 2026).
DEFAULT_PAY_ANCHOR_DATE = date(2021, 1, 8)

DEFAULT_PAYROLL_CONFIG: Dict[str, Any] = {
    "config_id": "default",
    "federal_tax_rate": 0.22,
    "state_tax_rate": 0.06,
    "social_security_rate": 0.062,
    "medicare_rate": 0.0145,
    "unemployment_rate": 0.006,
    "benefits_rate": 0.25,
    "workers_comp_rate": 0.015,
    "pay_frequency": "biweekly",
    "pay_anchor_date": DEFAULT_PAY_ANCHOR_DATE.isoformat(),
}

PAY_PERIODS_PER_YEAR = {
    "weekly": 52,
    "biweekly": 26,
    "semimonthly": 24,
    "monthly": 12,
}

# Statement lines that actuals can be recorded against, with the sign
# convention used for the favourable/unfavourable flag.
#   direction = 'income'  -> actual above budget is favourable
#   direction = 'expense' -> actual below budget is favourable
VARIANCE_LINE_ITEMS: Dict[str, Dict[str, str]] = {
    "gross_sales":        {"label": "Gross Sales",             "direction": "income",  "statement": "income"},
    # The gross-to-net detail lines (labels as on the income statement); Sales Deductions is their sum.
    "terms_allowance":    {"label": "Terms allowance",         "direction": "expense", "statement": "income"},
    "chargebacks":        {"label": "Chargebacks allowance",   "direction": "expense", "statement": "income"},
    "other_allowances":   {"label": "Other discounts & allowances", "direction": "expense", "statement": "income"},
    "excise_tax":         {"label": "Excise tax (FET)",        "direction": "expense", "statement": "income"},
    "total_sales_deductions": {"label": "Sales Deductions",    "direction": "expense", "statement": "income"},
    "revenue":            {"label": "Net Sales",               "direction": "income",  "statement": "income"},
    "cogs_materials":     {"label": "COGS - Materials",        "direction": "expense", "statement": "income"},
    "cogs_labor":         {"label": "COGS - Direct Labor",     "direction": "expense", "statement": "income"},
    "labor_variance":     {"label": "COGS - Direct Labor Variance", "direction": "expense", "statement": "income"},
    "cogs_manufacturing": {"label": "COGS - Machine / Mfg",    "direction": "expense", "statement": "income"},
    "indirect_labor":     {"label": "COGS - Indirect Labor",   "direction": "expense", "statement": "income"},
    "factory_overhead":   {"label": "COGS - Factory Overhead", "direction": "expense", "statement": "income"},
    "other_cogs":         {"label": "COGS - Other",            "direction": "expense", "statement": "income"},
    "total_cogs":         {"label": "Total COGS",              "direction": "expense", "statement": "income"},
    "gross_profit":       {"label": "Gross Profit",            "direction": "income",  "statement": "income"},
    "commissions":        {"label": "Sales Commissions",       "direction": "expense", "statement": "income"},
    "payroll":            {"label": "Payroll",                 "direction": "expense", "statement": "income"},
    "admin_expense":      {"label": "Admin Expenses",          "direction": "expense", "statement": "income"},
    "operating_expense":  {"label": "Operating Expenses",      "direction": "expense", "statement": "income"},
    "depreciation":       {"label": "Depreciation",            "direction": "expense", "statement": "income"},
    "operating_income":   {"label": "Operating Income",        "direction": "income",  "statement": "income"},
    "interest_expense":   {"label": "Interest Expense",        "direction": "expense", "statement": "income"},
    "income_tax":         {"label": "Income Tax",              "direction": "expense", "statement": "income"},
    "net_income":         {"label": "Net Income",              "direction": "income",  "statement": "income"},
    "capex":              {"label": "Capital Expenditures",    "direction": "expense", "statement": "cash_flow"},
    "closing_cash":       {"label": "Closing Cash",            "direction": "income",  "statement": "balance_sheet"},
}

#: Sales Deductions (total_sales_deductions) is the sum of these lines. A month's actuals carry EITHER the
#: detail lines OR the total, never both: with detail lines only, the total's actual is their sum; with the
#: total only, the detail lines of that month are carried in it (not missing); with both, build_variance
#: compares the total as entered and warns (sales_deductions_total_and_detail).
SALES_DEDUCTION_DETAIL_LINES: Tuple[str, ...] = ("terms_allowance", "chargebacks", "other_allowances", "excise_tax")


# ---------------------------------------------------------------------------
# Period helpers
# ---------------------------------------------------------------------------

def validate_period(period: str) -> str:
    """Return the period if it is a valid 'YYYY-MM' string, else raise ValueError."""
    if not isinstance(period, str) or len(period) != 7 or period[4] != "-":
        raise ValueError(f"Invalid period '{period}', expected YYYY-MM")
    year, month = period.split("-")
    if not (year.isdigit() and month.isdigit() and 1 <= int(month) <= 12):
        raise ValueError(f"Invalid period '{period}', expected YYYY-MM")
    return period


def period_range(start_period: str, end_period: str) -> List[str]:
    """Inclusive list of 'YYYY-MM' periods between start and end."""
    validate_period(start_period)
    validate_period(end_period)
    sy, sm = (int(x) for x in start_period.split("-"))
    ey, em = (int(x) for x in end_period.split("-"))
    if (sy, sm) > (ey, em):
        raise ValueError("start_period must be on or before end_period")
    periods: List[str] = []
    y, m = sy, sm
    while (y, m) <= (ey, em):
        periods.append(f"{y:04d}-{m:02d}")
        m += 1
        if m > 12:
            m = 1
            y += 1
    return periods


def shift_period(period: str, months: int) -> str:
    """Return the period `months` after (or before, if negative) `period`."""
    y, m = (int(x) for x in period.split("-"))
    idx = y * 12 + (m - 1) + months
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def months_between(start_period: str, end_period: str) -> int:
    """Number of months from start to end (0 when equal, negative if end is earlier)."""
    sy, sm = (int(x) for x in start_period.split("-"))
    ey, em = (int(x) for x in end_period.split("-"))
    return (ey * 12 + em) - (sy * 12 + sm)


def period_bounds(period: str) -> Tuple[date, date]:
    """First and last calendar day of a period."""
    y, m = (int(x) for x in period.split("-"))
    last = calendar.monthrange(y, m)[1]
    return date(y, m, 1), date(y, m, last)


def month_end(d: date) -> date:
    """Last calendar day of the month containing `d`."""
    return date(d.year, d.month, calendar.monthrange(d.year, d.month)[1])


def add_months(d: date, months: int) -> date:
    """
    Calendar-month arithmetic that keeps the day of month where possible and
    clamps to the month end otherwise (Jan 31 + 1 month = Feb 28/29).
    """
    idx = d.year * 12 + (d.month - 1) + months
    year, month = idx // 12, idx % 12 + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def pay_run_dates(frequency: str, start: date, count: int, anchor: Optional[date] = None) -> List[date]:
    """
    The next `count` pay dates on or after `start`, on the company's fixed
    pay calendar (real calendar dates):

      * weekly: every Friday
      * biweekly: every other Friday, anchor + 14 x k days (`anchor` is a
        known payday, default DEFAULT_PAY_ANCHOR_DATE)
      * semimonthly: the 15th and the last day of each month
      * monthly: the last day of each month

    `start` only picks the first run listed; it never moves the calendar, so
    a month has the same paydays whatever window or start date asks for it.
    No average-day increments, so month ends, February and leap years land
    on the right day and a year's worth of runs never drifts.
    """
    if count <= 0:
        return []
    if frequency == "weekly":
        first = start + timedelta(days=(4 - start.weekday()) % 7)  # Friday on/after start
        return [first + timedelta(days=7 * i) for i in range(count)]
    if frequency == "biweekly":
        anchor = anchor or DEFAULT_PAY_ANCHOR_DATE
        steps = -((anchor - start).days // 14)   # ceil((start - anchor) / 14 days)
        first = anchor + timedelta(days=14 * steps)
        return [first + timedelta(days=14 * i) for i in range(count)]

    dates: List[date] = []
    cursor = date(start.year, start.month, 1)
    while len(dates) < count:
        candidates = [month_end(cursor)]
        if frequency == "semimonthly":
            candidates.insert(0, date(cursor.year, cursor.month, 15))
        for candidate in candidates:
            if candidate >= start and len(dates) < count:
                dates.append(candidate)
        cursor = add_months(cursor, 1)
    return dates


def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%m/%d/%Y", "%Y-%m"):
        try:
            parsed = datetime.strptime(text[:19] if "T" in text else text, fmt)
            return parsed.date()
        except ValueError:
            continue
    return None


def _scope_clause(column: str, forecast_ids: Sequence[str], include_null: bool = True) -> Tuple[str, List[Any]]:
    """SQL fragment limiting `column` to the selected scenarios (and NULL rows)."""
    if not forecast_ids:
        return ("1=1", []) if include_null else ("1=0", [])
    placeholders = ",".join("?" for _ in forecast_ids)
    clause = f"{column} IN ({placeholders})"
    if include_null:
        clause = f"({clause} OR {column} IS NULL)"
    return clause, list(forecast_ids)


def _zero_by_period(periods: Iterable[str]) -> Dict[str, float]:
    return {p: 0.0 for p in periods}


# ---------------------------------------------------------------------------
# Assumptions and config
# ---------------------------------------------------------------------------

def load_assumptions(cursor, forecast_id: Optional[str]) -> Tuple[Dict[str, Any], bool]:
    """Return (assumptions, found). Falls back to DEFAULT_ASSUMPTIONS."""
    result = dict(DEFAULT_ASSUMPTIONS)
    if not forecast_id:
        return result, False
    cursor.execute("SELECT * FROM financial_assumptions WHERE forecast_id = ?", (forecast_id,))
    row = cursor.fetchone()
    if not row:
        return result, False
    columns = [d[0] for d in cursor.description]
    stored = dict(zip(columns, row))
    for key in DEFAULT_ASSUMPTIONS:
        if key in stored and stored[key] is not None:
            result[key] = stored[key]
    if stored.get("opening_equity") is None:
        result["opening_equity"] = None
    result["forecast_id"] = forecast_id
    result["updated_at"] = stored.get("updated_at")
    return result, True


def load_payroll_config(cursor) -> Dict[str, Any]:
    """Latest payroll_config row, or defaults."""
    cursor.execute("SELECT * FROM payroll_config ORDER BY rowid DESC LIMIT 1")
    row = cursor.fetchone()
    config = dict(DEFAULT_PAYROLL_CONFIG)
    if row:
        columns = [d[0] for d in cursor.description]
        stored = dict(zip(columns, row))
        for key in config:
            if stored.get(key) is not None:
                config[key] = stored[key]
    if config.get("pay_frequency") not in PAY_PERIODS_PER_YEAR:
        config["pay_frequency"] = "biweekly"
    anchor = _parse_date(config.get("pay_anchor_date"))
    if not anchor or anchor.weekday() != 4:   # an unreadable or non-Friday anchor: the default calendar
        anchor = DEFAULT_PAY_ANCHOR_DATE
    config["pay_anchor_date"] = anchor.isoformat()
    return config


def pay_anchor(config: Dict[str, Any]) -> date:
    """The configured biweekly payday the pay calendar is built from (DEFAULT_PAY_ANCHOR_DATE when unset)."""
    anchor = _parse_date((config or {}).get("pay_anchor_date"))
    return anchor if anchor and anchor.weekday() == 4 else DEFAULT_PAY_ANCHOR_DATE


# ---------------------------------------------------------------------------
# Revenue and product COGS
# ---------------------------------------------------------------------------

_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")

#: Statement line key for each deduction type (other_allowance rules sum into
#: the plural "other_allowances" line).
DEDUCTION_LINE_KEYS: Dict[str, str] = {k: v["statement_line"] for k, v in DEDUCTION_TYPES.items()}


def load_sales_lines(cursor, forecast_ids: Sequence[str], periods: Sequence[str],
                     deduction_rules: Optional[Sequence[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """
    Every sales row in the selected scenarios and months, enriched with the
    numbers the rest of the model reports: gross sales, each sales deduction
    and commission (services.pricing rules), net sales, per-unit BOM/routing
    cost times quantity, contribution margin, and labor / machine minutes by
    labor type / machine. The income statement, the COGS and labor forecasts
    and the exports all aggregate these lines, so they always agree.

    Returns {"lines", "unit_costs", "cost_warnings", "non_monthly_rows",
    "deduction_rule_count", "rows_with_deductions"}. Rows whose period is not a
    YYYY-MM month (quarters, weeks, junk) cannot be placed on the monthly
    statements; they are counted in non_monthly_rows.
    """
    out: Dict[str, Any] = {
        "lines": [],
        "unit_costs": {},
        "cost_warnings": {},
        "non_monthly_rows": 0,
        "deduction_rule_count": 0,
        "rows_with_deductions": 0,
    }
    if not forecast_ids or not periods:
        return out

    scope, params = _scope_clause("s.forecast_id", forecast_ids, include_null=False)
    cursor.execute(
        f"""
        SELECT COUNT(*) FROM sales s
        WHERE {scope} AND (s.period IS NULL OR substr(s.period, 1, 7) NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
        """,
        params,
    )
    out["non_monthly_rows"] = int(cursor.fetchone()[0] or 0)

    cursor.execute(
        f"""
        SELECT s.sale_id, s.forecast_id, s.period, s.customer_id, s.unit_id, s.quantity, s.unit_price, s.total_revenue,
               u.unit_name, u.unit_type, u.bom_id, u.bom_version, u.router_id,
               c.customer_name, c.customer_type
        FROM sales s
        LEFT JOIN units u ON s.unit_id = u.unit_id
        LEFT JOIN customers c ON s.customer_id = c.customer_id
        WHERE {scope} AND substr(s.period, 1, 7) >= ? AND substr(s.period, 1, 7) <= ?
        ORDER BY s.period, s.customer_id, s.unit_id
        """,
        params + [periods[0], periods[-1]],
    )
    rows = cursor.fetchall()

    if deduction_rules is None:
        deduction_rules = load_deduction_rules(cursor, forecast_ids)
    resolver = DeductionResolver(deduction_rules)
    out["deduction_rule_count"] = len(resolver.rules)

    period_set = set(periods)
    unit_cost_cache: Dict[Tuple, Dict[str, Any]] = {}
    zero_deductions = {dtype: 0.0 for dtype in DEDUCTION_TYPES}

    for (sale_id, forecast_id, period, customer_id, unit_id, quantity, unit_price, total_revenue,
         unit_name, unit_type, bom_id, bom_version, router_id, customer_name, customer_type) in rows:
        period = str(period)[:7] if period else None
        if not period or not _MONTH_RE.match(period) or period not in period_set:
            continue
        qty = float(quantity or 0)
        # quantity x unit_price is the truth; total_revenue is a stored copy
        # that a quantity-only edit can leave stale. Rows with no price (legacy
        # loads) fall back to the stored total.
        if unit_price is not None:
            gross = qty * float(unit_price)
        else:
            gross = float(total_revenue or 0)

        key = (bom_id, bom_version, router_id)
        if key not in unit_cost_cache:
            unit_cost_cache[key] = calculate_unit_costs(cursor, bom_id, bom_version, router_id)
        uc = unit_cost_cache[key]
        out["unit_costs"].setdefault(unit_id or "unknown", {
            "unit_id": unit_id, "unit_name": unit_name, "unit_type": unit_type,
            "bom_id": bom_id, "bom_version": bom_version, "router_id": router_id, **uc,
        })
        if uc["warnings"]:
            out["cost_warnings"][unit_id or "unknown"] = sorted(set(uc["warnings"]))

        line: Dict[str, Any] = {
            "period": period,
            "sale_id": sale_id,
            "forecast_id": forecast_id,
            "customer_id": customer_id,
            "customer_name": customer_name,
            "customer_type": customer_type,
            "unit_id": unit_id,
            "unit_name": unit_name,
            "unit_type": unit_type,
            "quantity": qty,
            "unit_price": float(unit_price) if unit_price is not None else (gross / qty if qty else 0.0),
            "gross_sales": gross,
        }
        if resolver:
            deductions = resolver.compute(line)
            if deductions["applied_rules"]:
                out["rows_with_deductions"] += 1
        else:
            deductions = {**zero_deductions, "total_sales_deductions": 0.0, "net_sales": gross, "applied_rules": {}}
        for dtype in DEDUCTION_TYPES:
            line[dtype] = deductions[dtype]
        line["total_sales_deductions"] = deductions["total_sales_deductions"]
        line["net_sales"] = deductions["net_sales"]
        line["applied_rules"] = deductions["applied_rules"]

        materials = uc["material_per_unit"] * qty
        labor = uc["labor_per_unit"] * qty
        machine = uc["machine_per_unit"] * qty
        line["materials"] = materials
        line["labor"] = labor
        line["machine"] = machine
        line["product_cogs"] = materials + labor + machine
        line["contribution_margin"] = line["net_sales"] - line["product_cogs"]
        line["labor_minutes"] = uc.get("labor_minutes_per_unit", 0.0) * qty
        line["machine_minutes"] = uc.get("machine_minutes_per_unit", 0.0) * qty
        line["labor_by_type"] = {
            t: {"minutes": v["minutes"] * qty, "cost": v["cost"] * qty}
            for t, v in (uc.get("labor_by_type") or {}).items()
        }
        line["machine_by_id"] = {
            m: {"minutes": v["minutes"] * qty, "cost": v["cost"] * qty}
            for m, v in (uc.get("machine_by_id") or {}).items()
        }
        out["lines"].append(line)

    return out


def revenue_and_cogs_by_period(cursor, forecast_ids: Sequence[str], periods: Sequence[str],
                               detail_periods: Optional[Sequence[str]] = None,
                               sales_lines: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Gross sales, sales deductions, net sales ("revenue") and BOM/routing COGS
    per period for the selected scenarios, aggregated from load_sales_lines.

    `periods` drives the per-period totals (every modelled month, including
    months rolled forward before a report window); `detail_periods` limits the
    product / customer / customer-type breakdown and record count to the
    reported window.
    """
    out: Dict[str, Any] = {
        "gross_sales": _zero_by_period(periods),
        "revenue": _zero_by_period(periods),
        "quantity": _zero_by_period(periods),
        "materials": _zero_by_period(periods),
        "labor": _zero_by_period(periods),
        "manufacturing": _zero_by_period(periods),
        "deductions": {dtype: _zero_by_period(periods) for dtype in DEDUCTION_TYPES},
        "by_product": {},
        "by_customer": {},
        "by_customer_type": {},
        "cost_warnings": {},
        "record_count": 0,
        "non_monthly_rows": 0,
        "deduction_rule_count": 0,
        "rows_with_deductions": 0,
    }
    if not forecast_ids or not periods:
        return out
    loaded = sales_lines if sales_lines is not None else load_sales_lines(cursor, forecast_ids, periods)
    for key in ("cost_warnings", "non_monthly_rows", "deduction_rule_count", "rows_with_deductions"):
        out[key] = loaded[key]

    period_set = set(periods)
    detail_set = set(detail_periods) if detail_periods is not None else period_set

    for line in loaded["lines"]:
        period = line["period"]
        if period not in period_set:
            continue
        out["gross_sales"][period] += line["gross_sales"]
        out["revenue"][period] += line["net_sales"]
        out["quantity"][period] += line["quantity"]
        out["materials"][period] += line["materials"]
        out["labor"][period] += line["labor"]
        out["manufacturing"][period] += line["machine"]
        for dtype in DEDUCTION_TYPES:
            out["deductions"][dtype][period] += line[dtype]
        if period not in detail_set:
            continue
        out["record_count"] += 1

        prod = out["by_product"].setdefault(line["unit_id"] or "unknown", {
            "unit_id": line["unit_id"], "unit_name": line["unit_name"], "unit_type": line["unit_type"],
            "gross_sales": 0.0, "total_sales_deductions": 0.0, "revenue": 0.0, "cogs": 0.0, "quantity": 0.0,
        })
        cust = out["by_customer"].setdefault(line["customer_id"] or "unknown", {
            "customer_id": line["customer_id"], "customer_name": line["customer_name"],
            "customer_type": line["customer_type"],
            "gross_sales": 0.0, "total_sales_deductions": 0.0, "revenue": 0.0, "cogs": 0.0, "quantity": 0.0,
        })
        ctype = str(line["customer_type"]).strip() if line["customer_type"] and str(line["customer_type"]).strip() else "Unassigned"
        # Group case-insensitively; the first spelling seen is the label.
        ctype_key = next((k for k in out["by_customer_type"] if k.lower() == ctype.lower()), ctype)
        ctype_entry = out["by_customer_type"].setdefault(ctype_key, {
            "customer_type": ctype_key,
            "gross_sales": 0.0, "total_sales_deductions": 0.0, "revenue": 0.0, "cogs": 0.0, "quantity": 0.0,
        })
        for entry in (prod, cust, ctype_entry):
            entry["gross_sales"] += line["gross_sales"]
            entry["total_sales_deductions"] += line["total_sales_deductions"]
            entry["revenue"] += line["net_sales"]
            entry["cogs"] += line["product_cogs"]
            entry["quantity"] += line["quantity"]

    return out


# ---------------------------------------------------------------------------
# Payroll
# ---------------------------------------------------------------------------

#: A salaried employee's rate at or above this is an annual salary; below it
#: is an hourly equivalent (older data stored salaried staff as $/hour while
#: the UI asks for the annual salary).
ANNUAL_SALARY_THRESHOLD = 1000.0


def annual_base_pay(rate_type: Optional[str], rate: float, weekly_hours: Any = None) -> float:
    """Annual gross pay: hourly = rate x weekly hours x 52; salary = the annual salary."""
    rate = float(rate or 0)
    if (rate_type or "hourly") == "salary":
        return rate if rate >= ANNUAL_SALARY_THRESHOLD else rate * 40 * 52
    return rate * float(weekly_hours or 0) * 52


def _employee_annual_gross(emp: Dict[str, Any], rate: float) -> float:
    return annual_base_pay(emp.get("rate_type"), rate, emp.get("weekly_hours"))


#: Employer-paid payroll costs. federal_tax_rate / state_tax_rate are income
#: tax WITHHELD from the employee's gross pay, not an extra employer cost, so
#: they are not part of the burden.
EMPLOYER_BURDEN_KEYS = ("social_security_rate", "medicare_rate", "unemployment_rate", "workers_comp_rate")


def _burden_multiplier(config: Dict[str, Any], benefits_eligible: bool) -> float:
    rate = 1.0
    for key in EMPLOYER_BURDEN_KEYS:
        rate += float(config.get(key) or 0)
    if benefits_eligible:
        rate += float(config.get("benefits_rate") or 0)
    return rate


def _active_fraction(period: str, start: Optional[date], end: Optional[date]) -> float:
    """Fraction of the month an employee is on payroll (0..1)."""
    first, last = period_bounds(period)
    active_start = max(first, start) if start else first
    active_end = min(last, end) if end else last
    if active_end < active_start:
        return 0.0
    days_in_month = (last - first).days + 1
    return ((active_end - active_start).days + 1) / days_in_month


def rate_segments(emp: Dict[str, Any], first: date, last: date, include_raises: bool,
                  start: Optional[date] = None, end: Optional[date] = None) -> List[Tuple[int, float]]:
    """
    The days of first..last (inclusive) the employee is on payroll (between
    `start` and `end`), as [(days, rate), ...]. The raise applies from
    next_review_date itself, so a month or pay period that contains the
    review date is split into the days before it (old rate) and the days
    from it (new rate). expected_raise above 1 is a flat amount, 1 or less a
    fraction.
    """
    active_start = max(first, start) if start else first
    active_end = min(last, end) if end else last
    if active_end < active_start:
        return []
    days = (active_end - active_start).days + 1
    rate = float(emp.get("hourly_rate") or 0)
    review = _parse_date(emp.get("next_review_date")) if include_raises else None
    raise_amt = float(emp.get("expected_raise") or 0) if include_raises else 0.0
    if not (review and raise_amt) or review > active_end:
        return [(days, rate)]
    raised = rate + raise_amt if raise_amt > 1 else rate * (1 + raise_amt)
    if review <= active_start:
        return [(days, raised)]
    before = (review - active_start).days
    return [(before, rate), (days - before, raised)]


def gross_for_days(emp: Dict[str, Any], first: date, last: date, periods_per_year: int, period_days: int,
                   include_raises: bool, start: Optional[date] = None, end: Optional[date] = None) -> float:
    """
    Gross pay for the employee's days on payroll in first..last, inside a
    pay period (or month) of `period_days` days that pays annual gross /
    `periods_per_year`: each day earns that period's pay / period_days at the
    rate in force on the day (see rate_segments). The statements call it per
    calendar month (12 a year), the pay runs per pay period, so both apply a
    hire, a leaver and a raise from the same day.
    """
    return sum(
        annual_base_pay(emp.get("rate_type"), rate, emp.get("weekly_hours")) / periods_per_year * (days / period_days)
        for days, rate in rate_segments(emp, first, last, include_raises, start, end)
    )


def normalize_allocations(value: Any) -> Dict[str, float]:
    """
    Business-unit allocations in PERCENT. Accepts a dict or its JSON text.
    Fractions that sum to 1 ({"OEM Work": 0.7, ...}) are converted to
    percent; non-numeric and negative entries are dropped.
    """
    if isinstance(value, str):
        try:
            value = json.loads(value) if value.strip() else {}
        except (json.JSONDecodeError, TypeError):
            return {}
    if not isinstance(value, dict):
        return {}
    clean: Dict[str, float] = {}
    for unit, pct in value.items():
        try:
            number = float(pct)
        except (TypeError, ValueError):
            continue
        if number != number or number < 0:  # NaN or negative
            continue
        clean[str(unit)] = number
    total = sum(clean.values())
    if clean and all(v <= 1 for v in clean.values()) and 0.99 <= total <= 1.01:
        clean = {k: round(v * 100, 6) for k, v in clean.items()}
    return clean


def allocation_shares(allocations: Any) -> Tuple[Dict[str, float], float]:
    """
    (share per business unit, unallocated share), shares as fractions of the
    employee's cost. Allocations within 0.01 of 100% count as exactly 100%;
    over 100% they are scaled down so a unit view never exceeds the cost.
    """
    pct = normalize_allocations(allocations)
    total = sum(pct.values())
    if total <= 0:
        return {}, 1.0
    if total >= 100 - 0.01:
        return {unit: v / total for unit, v in pct.items() if v > 0}, 0.0
    return {unit: v / 100 for unit, v in pct.items() if v > 0}, 1 - total / 100


#: Where an employee's pay lands on the statements (payroll.labor_class).
#: NULL / blank = not classified, treated like 'admin'.
LABOR_CLASSES: Tuple[str, ...] = ("direct", "indirect", "admin")
#: Keys of payroll_by_period()['by_labor_class'] (the three classes plus 'unclassified').
LABOR_CLASS_KEYS: Tuple[str, ...] = LABOR_CLASSES + ("unclassified",)
LABOR_CLASS_LABELS: Dict[str, str] = {
    "direct": "Direct",
    "indirect": "Indirect (factory)",
    "admin": "Admin",
    "unclassified": "Not classified",
}
_LABOR_CLASS_ALIASES: Dict[str, str] = {
    "direct": "direct", "direct labor": "direct", "direct labour": "direct", "dl": "direct",
    "indirect": "indirect", "indirect labor": "indirect", "indirect labour": "indirect", "il": "indirect",
    "admin": "admin", "administrative": "admin", "administration": "admin", "g&a": "admin", "sg&a": "admin",
}
LABOR_CLASS_ERROR = "labor_class must be direct, indirect or admin (or empty for not classified)"


def normalize_labor_class(value: Any, strict: bool = True) -> Optional[str]:
    """
    'Direct' / ' indirect ' / 'ADMIN' / 'direct labor' -> 'direct' / 'indirect' /
    'admin'; None or blank -> None (not classified). Anything else raises
    ValueError (strict) or reads as not classified (strict=False, for stored data).
    """
    if value is None:
        return None
    text = " ".join(str(value).strip().lower().replace("_", " ").split())
    if not text:
        return None
    if text in _LABOR_CLASS_ALIASES:
        return _LABOR_CLASS_ALIASES[text]
    if strict:
        raise ValueError(f"{LABOR_CLASS_ERROR}; got {value!r}")
    return None


def _payroll_columns(cursor) -> set:
    try:
        cursor.execute("PRAGMA table_info(payroll)")
        return {row[1] for row in cursor.fetchall()}
    except Exception:
        return set()


def load_employees(cursor, forecast_ids: Sequence[str]) -> List[Dict[str, Any]]:
    scope, params = _scope_clause("forecast_id", forecast_ids, include_null=True)
    # Databases from before labor classes have no labor_class column until
    # initialize_schema migrates them; read them as not classified.
    labor_class = "labor_class" if "labor_class" in _payroll_columns(cursor) else "NULL AS labor_class"
    cursor.execute(
        f"""
        SELECT employee_id, employee_name, department, weekly_hours, hourly_rate,
               rate_type, labor_type, start_date, end_date, next_review_date,
               expected_raise, benefits_eligible, allocations, forecast_id, {labor_class}
        FROM payroll
        WHERE {scope}
        ORDER BY employee_name
        """,
        params,
    )
    columns = [d[0] for d in cursor.description]
    employees = []
    for row in cursor.fetchall():
        emp = dict(zip(columns, row))
        try:
            emp["allocations"] = json.loads(emp["allocations"]) if emp.get("allocations") else {}
        except (json.JSONDecodeError, TypeError):
            emp["allocations"] = {}
        emp["labor_class"] = normalize_labor_class(emp.get("labor_class"), strict=False)
        employees.append(emp)
    return employees


def weekly_paid_hours(emp: Dict[str, Any]) -> float:
    """Scheduled paid hours a week: weekly_hours, or 40 for a salaried employee with none recorded."""
    hours = float(emp.get("weekly_hours") or 0)
    if hours <= 0 and (emp.get("rate_type") or "hourly") == "salary":
        hours = 40.0
    return hours


def payroll_by_period(cursor, forecast_ids: Sequence[str], periods: Sequence[str],
                      include_raises: bool = True,
                      config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Fully burdened payroll cost per calendar month, prorated for hires/terms.

    Besides the totals it returns, per labor class (LABOR_CLASS_KEYS):
    ``by_labor_class`` (cost per month) and ``paid_hours_by_class`` (weekly
    hours x 52 / 12 per month, prorated like the cost), plus
    ``unclassified_employees``: employees with no labor class and pay in
    the periods.
    """
    config = config or load_payroll_config(cursor)
    employees = load_employees(cursor, forecast_ids)
    totals = _zero_by_period(periods)
    gross = _zero_by_period(periods)
    by_department: Dict[str, Dict[str, float]] = {}
    by_business_unit: Dict[str, Dict[str, float]] = {}
    by_labor_class = {key: _zero_by_period(periods) for key in LABOR_CLASS_KEYS}
    paid_hours_by_class = {key: _zero_by_period(periods) for key in LABOR_CLASS_KEYS}
    headcount = _zero_by_period(periods)
    employee_rows: List[Dict[str, Any]] = []
    unclassified: List[Dict[str, Any]] = []

    for emp in employees:
        start = _parse_date(emp.get("start_date"))
        end = _parse_date(emp.get("end_date"))
        multiplier = _burden_multiplier(config, bool(emp.get("benefits_eligible", 1)))
        labor_class = emp.get("labor_class") or "unclassified"
        monthly_hours = weekly_paid_hours(emp) * 52 / 12
        emp_by_period: Dict[str, float] = {}
        for period in periods:
            fraction = _active_fraction(period, start, end)
            if fraction <= 0:
                emp_by_period[period] = 0.0
                continue
            first, last = period_bounds(period)
            # Prorated by day for a hire or a leaver, and across a raise dated inside the month.
            monthly_gross = gross_for_days(emp, first, last, 12, (last - first).days + 1, include_raises, start, end)
            cost = monthly_gross * multiplier
            emp_by_period[period] = cost
            totals[period] += cost
            gross[period] += monthly_gross
            headcount[period] += fraction
            by_labor_class[labor_class][period] += cost
            paid_hours_by_class[labor_class][period] += monthly_hours * fraction
            dept = emp.get("department") or "Unassigned"
            by_department.setdefault(dept, _zero_by_period(periods))[period] += cost
            allocations = emp.get("allocations") or {}
            if allocations:
                shares, unallocated = allocation_shares(allocations)
                for unit, share in shares.items():
                    by_business_unit.setdefault(unit, _zero_by_period(periods))[period] += cost * share
                if unallocated > 1e-9:
                    by_business_unit.setdefault("Unallocated", _zero_by_period(periods))[period] += cost * unallocated
        total = sum(emp_by_period.values())
        employee_rows.append({
            "employee_id": emp.get("employee_id"),
            "employee_name": emp.get("employee_name"),
            "department": emp.get("department"),
            "forecast_id": emp.get("forecast_id"),
            "labor_class": emp.get("labor_class"),
            "by_period": emp_by_period,
            "total": total,
        })
        if labor_class == "unclassified" and total > 0:
            unclassified.append({"employee_id": emp.get("employee_id"), "employee_name": emp.get("employee_name"),
                                 "department": emp.get("department")})

    return {
        "total": totals,
        "gross": gross,
        "headcount": headcount,
        "by_department": by_department,
        "by_business_unit": by_business_unit,
        "by_labor_class": by_labor_class,
        "paid_hours_by_class": paid_hours_by_class,
        "unclassified_employees": unclassified,
        "employees": employee_rows,
        "config": config,
    }


def labor_lines_by_period(payroll: Dict[str, Any], standard_labor: Dict[str, float],
                          periods: Sequence[str]) -> Dict[str, Dict[str, float]]:
    """
    Statement lines from payroll by labor class and the routing standard
    direct labor of each month (see the module docstring):

      payroll        = admin + not classified pay (operating expense)
      indirect_labor = indirect pay (COGS)
      direct_payroll = direct pay (memo)
      labor_variance = direct pay - routing standard, in months with direct
                       pay; 0 otherwise (the standard stands alone)
    """
    by_class = payroll["by_labor_class"]
    out: Dict[str, Dict[str, float]] = {k: {} for k in ("payroll", "indirect_labor", "direct_payroll", "labor_variance")}
    for p in periods:
        direct = by_class["direct"].get(p, 0.0)
        out["payroll"][p] = by_class["admin"].get(p, 0.0) + by_class["unclassified"].get(p, 0.0)
        out["indirect_labor"][p] = by_class["indirect"].get(p, 0.0)
        out["direct_payroll"][p] = direct
        out["labor_variance"][p] = (direct - float(standard_labor.get(p, 0.0))) if direct > 0 else 0.0
    return out


def _names(employees: Sequence[Dict[str, Any]], limit: int = 6) -> str:
    names = [str(e.get("employee_name") or e.get("employee_id")) for e in employees]
    if len(names) > limit:
        return ", ".join(names[:limit]) + f" and {len(names) - limit} more"
    return ", ".join(names)


def window_total(values: Dict[str, float], periods: Sequence[str]) -> float:
    """
    Sum of a {period: amount} dict over `periods`, added month by month in
    order: the same float arithmetic as the statements' totals, so a figure
    built from the same months rounds to the same cent (the built-in sum()
    is compensated on Python 3.12+ and can land on the other side of a half
    cent).
    """
    total = 0.0
    for p in periods:
        total += float(values.get(p, 0.0) or 0.0)
    return total


def month_ranges(periods: Sequence[str]) -> str:
    """'2027-01..2027-03, 2027-06' for a sorted list of months (runs of consecutive months collapsed)."""
    spans: List[List[str]] = []
    for p in periods:
        if spans and shift_period(spans[-1][-1], 1) == p:
            spans[-1].append(p)
        else:
            spans.append([p])
    return ", ".join(s[0] if len(s) == 1 else f"{s[0]}..{s[-1]}" for s in spans)


def labor_coverage(direct_payroll: Dict[str, float], standard_labor: Dict[str, float],
                   periods: Sequence[str]) -> Dict[str, Any]:
    """
    Which months of a window book direct labor at direct payroll and which
    at the routing standard alone (labor_lines_by_period replaces the
    standard month by month): months_with_direct_pay, standard_only_months
    (routing labor but no direct pay) and standard_only_labor, their
    standard.
    """
    direct_months = [p for p in periods if float(direct_payroll.get(p, 0.0)) > 0]
    standard_only = [p for p in periods
                     if float(direct_payroll.get(p, 0.0)) <= 0 and float(standard_labor.get(p, 0.0)) > 0]
    return {
        "months_with_direct_pay": direct_months,
        "standard_only_months": standard_only,
        "standard_only_labor": window_total(standard_labor, standard_only),
    }


def describe_unclassified_effect(direct_months: Sequence[str], standard_only_months: Sequence[str],
                                 has_direct_pay: Optional[bool] = None) -> str:
    """
    What leaving a production worker unclassified does to the statements,
    month by month: counted twice where the routing standard stands alone,
    in operating expenses instead of COGS where direct payroll replaced it.
    """
    twice = ("Direct labor in COGS comes from the routings, so a production worker left unclassified is counted "
             "twice (routing standard in COGS and pay in Payroll).")
    misplaced = ("Direct labor in COGS is the pay of employees classed Direct, so a production worker left "
                 "unclassified is counted once, in Payroll (operating expenses) instead of COGS: gross margin is "
                 "overstated.")
    if not (bool(direct_months) if has_direct_pay is None else has_direct_pay):
        return twice
    if not (direct_months and standard_only_months):
        return misplaced
    return (f"In months with direct pay ({month_ranges(direct_months)}) a production worker left unclassified is in "
            f"Payroll (operating expenses) instead of COGS, so gross margin is overstated; in months without direct "
            f"pay ({month_ranges(standard_only_months)}) direct labor comes from the routings and that worker is "
            f"counted twice (routing standard in COGS and pay in Payroll).")


def describe_labor_policy(standard: float, direct_payroll: float, variance: float, indirect: float,
                          admin: float, unclassified: Sequence[Dict[str, Any]], *,
                          standard_only: float = 0.0, direct_months: Sequence[str] = (),
                          standard_only_months: Sequence[str] = ()) -> str:
    """
    Plain-spoken explanation of where payroll landed, for notes and the Read
    Me. Direct payroll replaces the routing standard month by month, so when
    some months of the window have routing labor but no direct pay
    (`standard_only_months`, whose standard is `standard_only`) the message
    says which months use which basis. Every figure it names adds up, in
    cents, to the income statement's direct labor (standard + variance).
    """
    cents = lambda v: round(float(v or 0) + 0.0, 2)  # noqa: E731
    money = lambda v: f"${v:,.2f}" if v >= 0 else f"-${-v:,.2f}"  # noqa: E731
    std, var = cents(standard), cents(variance)
    total = cents(std + var)                      # the income statement's direct labor
    std_only = cents(standard_only) if standard_only_months else 0.0
    adjust = "plus" if var >= 0 else "less"
    above = "payroll above standard" if var >= 0 else "payroll below standard"
    if direct_payroll > 0 and direct_months and std_only > 0:
        # Each figure is derived from the rounded ones so the sentence adds up in cents: total = direct pay +
        # standard alone, and direct pay = standard of the direct months + variance.
        paid = cents(direct_payroll)              # pay of employees classed Direct (all in the direct months)
        std_only = cents(total - paid)            # the routing standard of the months without direct pay
        std_paid_months = cents(paid - var)       # the routing standard of the months with direct pay
        parts = [f"Direct labor in COGS is {money(total)}. In months with direct pay ({month_ranges(direct_months)}) "
                 f"it is the pay of employees classed Direct ({money(paid)}): the routing standard "
                 f"({money(std_paid_months)}) {adjust} a direct labor variance of {money(abs(var))} ({above}). In "
                 f"months without direct pay ({month_ranges(standard_only_months)}) it is the routing standard "
                 f"alone ({money(std_only)}), so gross margin moves when direct pay starts or stops. Nobody is "
                 f"counted twice."]
    elif direct_payroll > 0:
        parts = [f"Direct labor in COGS is the routing standard ({money(std)}) {adjust} a direct labor variance of "
                 f"{money(abs(var))} ({above}), so it equals the pay of employees classed Direct ({money(total)}); "
                 f"nobody is counted twice."]
    else:
        parts = [f"Direct labor in COGS is the routing standard ({money(std)}): routing minutes x labor rates. "
                 f"No employee classed Direct is paid in these months, so payroll does not replace it."]
    if indirect > 0:
        parts.append(f"Indirect (factory) employees ({money(cents(indirect))}) are in COGS as Indirect labor.")
    parts.append(f"Admin and unclassified employees ({money(cents(admin))}) are Payroll in operating expenses.")
    if unclassified:
        effect = describe_unclassified_effect(direct_months, standard_only_months, has_direct_pay=direct_payroll > 0)
        parts.append(f"Not classified (treated as Admin): {_names(unclassified)}. {effect} Class any production "
                     f"worker among them Direct.")
    return " ".join(parts)


# ---------------------------------------------------------------------------
# Expenses
# ---------------------------------------------------------------------------

def expenses_by_period(cursor, forecast_ids: Sequence[str], periods: Sequence[str],
                       detail_periods: Optional[Sequence[str]] = None) -> Dict[str, Any]:
    """
    Expense allocations per period, bucketed by statement line.

    The category breakdown (`by_category`) covers `detail_periods` only
    (defaults to `periods`), so carried-forward months feed the balances
    but not the reported detail.
    """
    scope, params = _scope_clause("e.forecast_id", forecast_ids, include_null=True)
    cursor.execute(
        f"""
        SELECT a.period, c.category_type, c.category_name, SUM(a.allocated_amount)
        FROM expense_allocations a
        JOIN expenses e ON a.expense_id = e.expense_id
        JOIN expense_categories c ON e.category_id = c.category_id
        WHERE {scope} AND a.period >= ? AND a.period <= ?
          AND (e.is_active IS NULL OR e.is_active = 1)
        GROUP BY a.period, c.category_type, c.category_name
        """,
        params + [periods[0], periods[-1]],
    )
    out = {
        "factory_overhead": _zero_by_period(periods),
        "other_cogs": _zero_by_period(periods),
        "admin": _zero_by_period(periods),
        "operating": _zero_by_period(periods),
        "by_category": {},
    }
    period_set = set(periods)
    detail_periods = list(detail_periods) if detail_periods is not None else list(periods)
    detail_set = set(detail_periods)
    for period, category_type, category_name, amount in cursor.fetchall():
        if period not in period_set:
            continue
        amount = float(amount or 0)
        if category_type == "factory_overhead":
            bucket = "factory_overhead"
        elif category_type == "cogs":
            bucket = "other_cogs"
        elif category_type == "admin_expense":
            bucket = "admin"
        else:
            bucket = "operating"
        out[bucket][period] += amount
        if period not in detail_set:
            continue
        cat = out["by_category"].setdefault(category_name or "Uncategorized", {
            "category_type": category_type, "bucket": bucket, "by_period": _zero_by_period(detail_periods), "total": 0.0,
        })
        cat["by_period"][period] += amount
        cat["total"] += amount
    return out


# ---------------------------------------------------------------------------
# Loans
# ---------------------------------------------------------------------------

#: Most a saved loan schedule's principal column can miss the principal by per installment through
#: rounding alone (schedules saved before they were generated in cents rounded each row on its own).
ROUNDING_RESIDUE_PER_INSTALLMENT = 0.01


def schedule_rounding_residue(principal_amount: Any, principal_payments: Sequence[Any],
                              last_remaining_balance: Any) -> float:
    """
    What a saved schedule's principal column misses the loan's principal by
    when that is only rounding, else 0.0. Schedules are generated in cents
    (each installment's principal and the running balance rounded, the last
    installment clearing the balance exactly), so their principal adds up to
    the principal; schedules saved before that rounded each row's principal
    on its own and add up to the principal plus or minus a few cents while
    their last installment says nothing is owed. Returns principal -
    sum(principal) (rounded to cents) when the last installment's stored
    remaining_balance and that difference are both within
    ROUNDING_RESIDUE_PER_INSTALLMENT per installment of zero; a larger
    difference is a real balance (a principal changed after the last
    payment, an incomplete or interest-only schedule) and is left alone.
    """
    if not principal_payments or principal_amount is None or last_remaining_balance is None:
        return 0.0
    try:
        residue = round(float(principal_amount) - sum(float(p or 0) for p in principal_payments), 2)
        left = float(last_remaining_balance)
    except (TypeError, ValueError):
        return 0.0
    tolerance = ROUNDING_RESIDUE_PER_INSTALLMENT * len(principal_payments) + 0.0005
    if abs(residue) < 0.005 or abs(residue) > tolerance or abs(left) > tolerance:
        return 0.0
    return residue


def loans_by_period(cursor, periods: Sequence[str]) -> Dict[str, Any]:
    """
    Scheduled principal/interest per period, opening debt and new-loan
    proceeds, from the saved schedules of the active loans. A schedule whose
    principal column misses the principal by rounding alone
    (`schedule_rounding_residue`) books the difference with its last
    installment's principal (and payment), so debt is 0.00 once that
    installment is paid.
    """
    first_day, _ = period_bounds(periods[0])
    _, last_day = period_bounds(periods[-1])

    cursor.execute(
        "SELECT loan_id, loan_name, principal_amount, start_date, current_balance FROM loans WHERE is_active = 1"
    )
    loans = cursor.fetchall()
    principal = _zero_by_period(periods)
    interest = _zero_by_period(periods)
    payments = _zero_by_period(periods)
    proceeds = _zero_by_period(periods)
    opening_debt = 0.0
    by_loan: Dict[str, Dict[str, Any]] = {}
    period_set = set(periods)

    for loan_id, loan_name, principal_amount, start_date, current_balance in loans:
        originated = _parse_date(start_date)
        cursor.execute(
            """
            SELECT payment_date, principal_payment, interest_payment, payment_amount, remaining_balance
            FROM loan_payments WHERE loan_id = ? ORDER BY payment_number
            """,
            (loan_id,),
        )
        schedule = [list(row) for row in cursor.fetchall()]
        residue = schedule_rounding_residue(principal_amount, [row[1] for row in schedule],
                                            schedule[-1][4] if schedule else None)
        if residue:
            last = schedule[-1]
            last[1] = round(float(last[1] or 0) + residue, 2)
            last[3] = round(float(last[3] or 0) + residue, 2)

        # Opening balance = the principal less the principal scheduled before
        # the window (the debt a longer window shows at that month; a stored
        # remaining_balance is stated on the principal of its time, so it
        # misses a principal changed after payments were recorded), or the
        # full principal if the loan exists but hasn't been paid yet.
        balance_before = None
        repaid_before = 0.0
        for pay_date, p_amt, _i, _a, remaining in schedule:
            d = _parse_date(pay_date)
            if d and d < first_day:
                repaid_before += float(p_amt or 0)
                balance_before = float(remaining or 0)
        if balance_before is not None and principal_amount is not None:
            balance_before = round(float(principal_amount) - repaid_before, 2) + 0.0   # never -0.0
        if balance_before is None:
            if originated and originated < first_day:
                balance_before = float(principal_amount or 0)
            elif not originated and not schedule:
                balance_before = float(current_balance or 0)
            else:
                balance_before = 0.0
        opening_debt += balance_before

        loan_entry = by_loan.setdefault(loan_id, {
            "loan_name": loan_name, "opening_balance": balance_before,
            "principal": _zero_by_period(periods), "interest": _zero_by_period(periods),
            "payments": _zero_by_period(periods), "proceeds": _zero_by_period(periods),
        })

        if originated and first_day <= originated <= last_day:
            p = originated.strftime("%Y-%m")
            proceeds[p] += float(principal_amount or 0)
            loan_entry["proceeds"][p] += float(principal_amount or 0)

        for pay_date, p_amt, i_amt, total, _remaining in schedule:
            d = _parse_date(pay_date)
            if not d:
                continue
            p = d.strftime("%Y-%m")
            if p not in period_set:
                continue
            principal[p] += float(p_amt or 0)
            interest[p] += float(i_amt or 0)
            payments[p] += float(total or 0)
            loan_entry["principal"][p] += float(p_amt or 0)
            loan_entry["interest"][p] += float(i_amt or 0)
            loan_entry["payments"][p] += float(total or 0)

    return {
        "principal": principal,
        "interest": interest,
        "payments": payments,
        "proceeds": proceeds,
        "opening_debt": opening_debt,
        "by_loan": by_loan,
    }


# ---------------------------------------------------------------------------
# Capex and depreciation
# ---------------------------------------------------------------------------

def capex_by_period(cursor, forecast_ids: Sequence[str], periods: Sequence[str],
                    assumptions: Dict[str, Any]) -> Dict[str, Any]:
    """Capital purchases and straight-line depreciation per period."""
    scope, params = _scope_clause("forecast_id", forecast_ids, include_null=True)
    cursor.execute(
        f"""
        SELECT capex_id, asset_name, category, amount, purchase_period, useful_life_months,
               salvage_value, depreciation_method
        FROM capital_expenditures
        WHERE {scope} AND (is_active IS NULL OR is_active = 1)
        ORDER BY purchase_period, asset_name
        """,
        params,
    )
    capex = _zero_by_period(periods)
    depreciation = _zero_by_period(periods)
    items: List[Dict[str, Any]] = []
    period_set = set(periods)
    first = periods[0]

    # Depreciation of the opening fixed-asset base.
    opening_net = float(assumptions.get("opening_fixed_assets") or 0) - float(assumptions.get("opening_accumulated_depreciation") or 0)
    remaining_life = int(assumptions.get("opening_fixed_assets_remaining_life_months") or 0)
    opening_dep = _zero_by_period(periods)
    if opening_net > 0 and remaining_life > 0:
        monthly = opening_net / remaining_life
        for i, period in enumerate(periods):
            if i < remaining_life:
                opening_dep[period] = monthly
                depreciation[period] += monthly

    for (capex_id, asset_name, category, amount, purchase_period, life, salvage, method) in cursor.fetchall():
        amount = float(amount or 0)
        life = int(life or 0)
        salvage = float(salvage or 0)
        try:
            validate_period(purchase_period)
        except ValueError:
            continue
        item_dep = _zero_by_period(periods)
        if purchase_period in period_set:
            capex[purchase_period] += amount
        if (method or "straight_line") == "straight_line" and life > 0:
            monthly = max(amount - salvage, 0.0) / life
            for period in periods:
                offset = months_between(purchase_period, period)
                if 0 <= offset < life:
                    item_dep[period] = monthly
                    depreciation[period] += monthly
        items.append({
            "capex_id": capex_id,
            "asset_name": asset_name,
            "category": category,
            "amount": amount,
            "purchase_period": purchase_period,
            "useful_life_months": life,
            "in_window": purchase_period in period_set,
            "depreciation_by_period": item_dep,
        })

    return {
        "capex": capex,
        "depreciation": depreciation,
        "opening_asset_depreciation": opening_dep,
        "items": items,
    }


# ---------------------------------------------------------------------------
# Statement assembly
# ---------------------------------------------------------------------------

def _round_dict(d: Dict[str, Any], ndigits: int = 2) -> Dict[str, Any]:
    out = {}
    for k, v in d.items():
        if isinstance(v, float):
            out[k] = round(v, ndigits)
        elif isinstance(v, dict):
            out[k] = _round_dict(v, ndigits)
        else:
            out[k] = v
    return out


def _slice(by_period: Dict[str, Any], periods: Sequence[str]) -> Dict[str, Any]:
    """Restrict a {period: value} dict to the given periods, in order."""
    return {p: by_period[p] for p in periods if p in by_period}


def resolve_carry_forward(assumptions: Dict[str, Any], start_period: str) -> Tuple[List[str], Optional[Dict[str, Any]]]:
    """
    Months that must be rolled forward before a reporting window starts.

    The opening balances are stated as at the END of `opening_period`, so the
    model starts in the month after it. When a report starts later than that,
    every month in between is computed (cash, working capital, capex,
    depreciation, debt and retained earnings) so the window's opening column
    is the true carried balance and a March-only report shows the same March
    as a January-to-December report.

    Returns (carry_periods, warning). The warning explains why no carry
    forward could be done: the opening period is unset, or the window starts
    before the first modelled month.
    """
    opening_period = assumptions.get("opening_period")
    if not opening_period:
        return [], {
            "code": "opening_period_unset",
            "message": (
                f"No opening balance date is set, so the opening balances are applied at the start of this "
                f"report ({start_period}). Set the opening period under Assumptions so earlier months "
                f"are rolled forward and the closing balances do not depend on the report window."
            ),
        }
    try:
        validate_period(str(opening_period))
    except ValueError:
        return [], {
            "code": "opening_period_invalid",
            "message": f"Opening period '{opening_period}' is not a valid YYYY-MM; opening balances are applied at {start_period}.",
        }
    first_model = shift_period(str(opening_period), 1)
    if first_model < start_period:
        return period_range(first_model, shift_period(start_period, -1)), None
    if first_model > start_period:
        return [], {
            "code": "window_before_opening",
            "message": (
                f"The report starts in {start_period}, before the first month after the opening balance date "
                f"({opening_period}). Balances before {first_model} are not modelled; the opening balances are "
                f"applied at {start_period} instead."
            ),
        }
    return [], None


def require_known_scenarios(cursor, forecast_ids: Sequence[str]) -> None:
    """Raise ValueError naming any scenario id that does not exist (reports never return silent zeros)."""
    ids = [f for f in forecast_ids if f]
    if not ids:
        raise ValueError("At least one forecast_id is required")
    cursor.execute(f"SELECT forecast_id FROM forecast WHERE forecast_id IN ({','.join('?' for _ in ids)})", ids)
    known = {row[0] for row in cursor.fetchall()}
    unknown = [f for f in ids if f not in known]
    if unknown:
        raise ValueError(f"Unknown scenario id(s): {', '.join(unknown)}")


def build_statements(cursor, forecast_ids: Sequence[str], start_period: str, end_period: str,
                     include_raises: bool = True) -> Dict[str, Any]:
    """Build the full statement set for a reporting window."""
    forecast_ids = [f for f in forecast_ids if f]
    if not forecast_ids:
        raise ValueError("At least one forecast_id is required")
    periods = period_range(start_period, end_period)
    require_known_scenarios(cursor, forecast_ids)

    # Assumptions come from the first selected scenario (they describe the
    # company, not the scenario), falling back to defaults.
    assumptions, found = load_assumptions(cursor, forecast_ids[0])
    warnings: List[Dict[str, Any]] = []
    carry_periods, carry_warning = resolve_carry_forward(assumptions, start_period)
    if not found:
        hint = ""
        if carry_warning and carry_warning["code"] == "opening_period_unset":
            hint = " Opening balances are applied at the start of this report; set an opening period so earlier months roll forward."
            carry_warning = None
        warnings.append({
            "code": "default_assumptions",
            "message": "No financial assumptions saved for this scenario; using defaults (zero opening balances, 30/60/30 day working capital, 21% tax)." + hint,
        })
    if carry_warning:
        warnings.append(carry_warning)

    # Everything balance-related is computed from the first modelled month;
    # the window is sliced out afterwards.
    all_periods = carry_periods + periods
    window_set = set(periods)

    sales_lines = load_sales_lines(cursor, forecast_ids, all_periods)
    sales = revenue_and_cogs_by_period(cursor, forecast_ids, all_periods, detail_periods=periods,
                                       sales_lines=sales_lines)
    payroll = payroll_by_period(cursor, forecast_ids, all_periods, include_raises=include_raises)
    labor_lines = labor_lines_by_period(payroll, sales["labor"], all_periods)
    expenses = expenses_by_period(cursor, forecast_ids, all_periods, detail_periods=periods)
    loans = loans_by_period(cursor, all_periods)
    capex = capex_by_period(cursor, forecast_ids, all_periods, assumptions)

    if sales["cost_warnings"]:
        warnings.append({
            "code": "cost_warnings",
            "message": f"{len(sales['cost_warnings'])} product(s) have incomplete BOM/routing data; their COGS may be understated.",
            "products": sales["cost_warnings"],
        })
    if sales["non_monthly_rows"]:
        warnings.append({
            "code": "non_monthly_sales_periods",
            "message": (
                f"{sales['non_monthly_rows']} sales row(s) in the selected scenario(s) have a period that is not a "
                f"YYYY-MM month (e.g. a quarter or week) and are left out of the monthly statements."
            ),
        })
    window_gross = sum(sales["gross_sales"][p] for p in periods)
    if window_gross and not sales["deduction_rule_count"]:
        warnings.append({
            "code": "no_deduction_rules",
            "level": "info",
            "message": "No discount, allowance, excise or commission rules are set up, so net sales equal gross sales. "
                       "Add them under Pricing & Deductions.",
        })
    elif window_gross and not any(line.get("applied_rules") for line in sales_lines["lines"]
                                  if line["period"] in window_set):
        # Rules exist but every one is scoped to customers / types / products / months with no sales in the window
        # (e.g. FET for product type 'Rifles' when the products are 'Rifle').
        rule_count = int(sales["deduction_rule_count"])
        warnings.append({
            "code": "no_deduction_rules",
            "level": "info",
            "rule_count": rule_count,
            "message": f"{rule_count} deduction rule{'s are' if rule_count != 1 else ' is'} set up but none applies to "
                       f"any sales row in {periods[0]}..{periods[-1]}, so net sales equal gross sales. Check the "
                       f"customers, customer types, products, product types and months the rules are scoped to "
                       f"under Pricing & Deductions.",
        })

    # Labor policy for the window: what landed where, and who is not classified.
    window_unclassified = [
        e for e in (
            {"employee_id": row["employee_id"], "employee_name": row["employee_name"], "department": row["department"],
             "window_cost": sum(row["by_period"].get(p, 0.0) for p in periods)}
            for row in payroll["employees"] if not row.get("labor_class")
        ) if e["window_cost"] > 0
    ]
    # Window totals add month by month, like the income statement's totals, so they match it to the cent.
    window_standard = window_total(sales["labor"], periods)
    coverage = labor_coverage(labor_lines["direct_payroll"], sales["labor"], periods)
    labor_policy = {
        "direct_payroll_in_cogs": bool(coverage["months_with_direct_pay"]),
        "standard_direct_labor": window_standard,
        "direct_payroll": window_total(labor_lines["direct_payroll"], periods),
        "labor_variance": window_total(labor_lines["labor_variance"], periods),
        "indirect_labor": window_total(labor_lines["indirect_labor"], periods),
        "admin_payroll": window_total(labor_lines["payroll"], periods),
        **coverage,
        "unclassified_employees": [{k: e[k] for k in ("employee_id", "employee_name", "department")}
                                   for e in window_unclassified],
    }
    # Direct labor in COGS as the income statement shows it (cogs_labor + labor_variance totals).
    labor_policy["cogs_direct_labor"] = round(round(window_standard, 2) + round(labor_policy["labor_variance"], 2), 2)
    labor_policy["message"] = describe_labor_policy(
        labor_policy["standard_direct_labor"], labor_policy["direct_payroll"], labor_policy["labor_variance"],
        labor_policy["indirect_labor"], labor_policy["admin_payroll"], labor_policy["unclassified_employees"],
        standard_only=coverage["standard_only_labor"], direct_months=coverage["months_with_direct_pay"],
        standard_only_months=coverage["standard_only_months"])
    if labor_policy["direct_payroll_in_cogs"] and coverage["standard_only_months"]:
        months = coverage["standard_only_months"]
        warnings.append({
            "code": "partial_direct_payroll",
            "level": "info",
            "message": (
                f"Direct labor in COGS is the pay of employees classed Direct in "
                f"{month_ranges(coverage['months_with_direct_pay'])}, but {month_ranges(months)} "
                f"{'have' if len(months) != 1 else 'has'} routing labor and no direct pay, so "
                f"{'those months use' if len(months) != 1 else 'that month uses'} the routing standard alone "
                f"(${coverage['standard_only_labor']:,.2f}). Gross margin moves when direct pay starts or stops; "
                f"check the start and end dates of the employees classed Direct."
            ),
            "periods": months,
        })
    if window_unclassified and window_standard > 0:
        count = len(window_unclassified)
        warnings.append({
            "code": "unclassified_payroll",
            "level": "info",
            "message": (
                f"{count} employee{'s have' if count != 1 else ' has'} no labor class, so "
                f"{'their' if count != 1 else 'the'} pay is in Payroll (operating expenses): "
                f"{_names(window_unclassified)}. "
                f"{describe_unclassified_effect(coverage['months_with_direct_pay'], coverage['standard_only_months'])}"
                f" Under Payroll, class production workers Direct, factory support Indirect and everyone else Admin."
            ),
            "employees": labor_policy["unclassified_employees"],
            "direct_payroll_in_cogs": labor_policy["direct_payroll_in_cogs"],
            "standard_only_months": coverage["standard_only_months"],
        })

    tax_rate = float(assumptions.get("income_tax_rate") or 0)
    dso = float(assumptions.get("dso_days") or 0)
    dio = float(assumptions.get("dio_days") or 0)
    dpo = float(assumptions.get("dpo_days") or 0)
    min_cash = float(assumptions.get("minimum_cash_balance") or 0)
    excise_days = assumptions.get("excise_payable_days")
    excise_days = 30.0 if excise_days is None else float(excise_days)

    # Opening balance sheet, as at the end of the month before the first modelled month.
    opening_cash = float(assumptions.get("opening_cash") or 0)
    opening_ar = float(assumptions.get("opening_accounts_receivable") or 0)
    opening_inv = float(assumptions.get("opening_inventory") or 0)
    opening_fa_gross = float(assumptions.get("opening_fixed_assets") or 0)
    opening_acc_dep = float(assumptions.get("opening_accumulated_depreciation") or 0)
    opening_ap = float(assumptions.get("opening_accounts_payable") or 0)
    opening_other = float(assumptions.get("opening_other_liabilities") or 0)
    opening_debt = float(loans["opening_debt"])
    opening_assets = opening_cash + opening_ar + opening_inv + (opening_fa_gross - opening_acc_dep)
    opening_liabilities = opening_ap + opening_other + opening_debt
    if assumptions.get("opening_equity") is None:
        opening_equity = opening_assets - opening_liabilities
        equity_plugged = True
    else:
        opening_equity = float(assumptions["opening_equity"])
        equity_plugged = False
        imbalance = opening_assets - opening_liabilities - opening_equity
        if abs(imbalance) > 0.5:
            warnings.append({
                "code": "opening_imbalance",
                "message": f"Opening balance sheet does not balance by {imbalance:,.2f}; equity is shown as entered.",
                "amount": imbalance,
            })

    # Same keys as a period row so the UI can treat it as column zero.
    model_opening = {
        "period": shift_period(all_periods[0], -1),
        "cash": opening_cash,
        "accounts_receivable": opening_ar,
        "inventory": opening_inv,
        "total_current_assets": opening_cash + opening_ar + opening_inv,
        "fixed_assets_gross": opening_fa_gross,
        "accumulated_depreciation": opening_acc_dep,
        "fixed_assets_net": opening_fa_gross - opening_acc_dep,
        "total_assets": opening_assets,
        "accounts_payable": opening_ap,
        "excise_tax_payable": 0.0,
        "other_liabilities": opening_other,
        "total_current_liabilities": opening_ap + opening_other,
        "debt": opening_debt,
        "total_liabilities": opening_liabilities,
        "opening_equity": opening_equity,
        "retained_earnings": 0.0,
        "total_equity": opening_equity,
        "equity": opening_equity,
        "total_liabilities_and_equity": opening_liabilities + opening_equity,
        "balance_check": opening_assets - (opening_liabilities + opening_equity),
        "working_capital": (opening_cash + opening_ar + opening_inv) - (opening_ap + opening_other),
        "equity_plugged": equity_plugged,
    }

    all_income: List[Dict[str, Any]] = []
    all_cash: List[Dict[str, Any]] = []
    all_balance: List[Dict[str, Any]] = []

    prev_ar, prev_inv, prev_ap, prev_excise = opening_ar, opening_inv, opening_ap, 0.0
    cash = opening_cash
    fa_gross = opening_fa_gross
    acc_dep = opening_acc_dep
    debt = opening_debt
    cumulative_ni = 0.0
    tax_year = None
    pre_tax_ytd = 0.0
    tax_ytd = 0.0
    cash_shortfall_periods: List[str] = []

    for period in all_periods:
        gross_sales = sales["gross_sales"][period]
        deductions = {dtype: sales["deductions"][dtype][period] for dtype in DEDUCTION_TYPES}
        total_deductions = sum(deductions[t] for t in CONTRA_REVENUE_TYPES)
        excise = deductions["excise_tax"]
        commissions = deductions["commission"]
        revenue = sales["revenue"][period]
        materials = sales["materials"][period]
        labor = sales["labor"][period]
        manufacturing = sales["manufacturing"][period]
        factory_overhead = expenses["factory_overhead"][period]
        other_cogs = expenses["other_cogs"][period]
        # Labor classes: direct pay replaces the routing standard through the
        # variance line, indirect pay is a factory cost, the rest is opex.
        labor_variance = labor_lines["labor_variance"][period]
        indirect_labor = labor_lines["indirect_labor"][period]
        total_cogs = (materials + labor + labor_variance + manufacturing + indirect_labor
                      + factory_overhead + other_cogs)
        gross_profit = revenue - total_cogs

        payroll_cost = labor_lines["payroll"][period]
        admin = expenses["admin"][period]
        operating = expenses["operating"][period]
        dep = capex["depreciation"][period]
        total_opex = commissions + payroll_cost + admin + operating + dep
        operating_income = gross_profit - total_opex

        interest = loans["interest"][period]
        pre_tax = operating_income - interest
        # Tax accrues on year-to-date income so a loss month offsets earlier
        # profit in the same calendar year (never below zero for the year).
        if period[:4] != tax_year:
            tax_year, pre_tax_ytd, tax_ytd = period[:4], 0.0, 0.0
        pre_tax_ytd += pre_tax
        tax = max(pre_tax_ytd, 0.0) * tax_rate - tax_ytd
        tax_ytd += tax
        net_income = pre_tax - tax
        cumulative_ni += net_income

        all_income.append({
            "period": period,
            "gross_sales": gross_sales,
            "terms_allowance": deductions["terms_allowance"],
            "chargebacks": deductions["chargebacks"],
            "other_allowances": deductions["other_allowance"],
            "excise_tax": excise,
            "total_sales_deductions": total_deductions,
            "revenue": revenue,
            "units_sold": sales["quantity"][period],
            "cogs_materials": materials,
            "cogs_labor": labor,
            "labor_variance": labor_variance,
            "cogs_manufacturing": manufacturing,
            "indirect_labor": indirect_labor,
            "factory_overhead": factory_overhead,
            "other_cogs": other_cogs,
            "total_cogs": total_cogs,
            "gross_profit": gross_profit,
            "gross_margin_pct": (gross_profit / revenue * 100) if revenue else 0.0,
            "commissions": commissions,
            "payroll": payroll_cost,
            "admin_expense": admin,
            "operating_expense": operating,
            "depreciation": dep,
            "total_operating_expenses": total_opex,
            "operating_income": operating_income,
            "operating_margin_pct": (operating_income / revenue * 100) if revenue else 0.0,
            "interest_expense": interest,
            "pre_tax_income": pre_tax,
            "income_tax": tax,
            "net_income": net_income,
            "net_margin_pct": (net_income / revenue * 100) if revenue else 0.0,
        })

        # Working capital balances at period end
        product_cogs = materials + labor + manufacturing
        purchases = materials + factory_overhead + other_cogs + admin + operating + commissions
        # Customers owe the invoice (incl. the embedded excise) less the
        # allowances they deduct; the excise is owed on to the government.
        ar = (revenue + excise) * dso / AVG_DAYS_PER_MONTH
        inv = product_cogs * dio / AVG_DAYS_PER_MONTH
        ap = purchases * dpo / AVG_DAYS_PER_MONTH
        excise_payable = excise * excise_days / AVG_DAYS_PER_MONTH
        delta_ar = ar - prev_ar
        delta_inv = inv - prev_inv
        delta_ap = ap - prev_ap
        delta_excise = excise_payable - prev_excise

        cfo = net_income + dep - delta_ar - delta_inv + delta_ap + delta_excise
        capex_amt = capex["capex"][period]
        cfi = -capex_amt
        proceeds = loans["proceeds"][period]
        principal = loans["principal"][period]
        cff = proceeds - principal
        net_change = cfo + cfi + cff
        opening_cash_period = cash
        cash = cash + net_change
        if cash < min_cash and period in window_set:
            cash_shortfall_periods.append(period)

        all_cash.append({
            "period": period,
            "net_income": net_income,
            "depreciation": dep,
            "change_in_accounts_receivable": -delta_ar,
            "change_in_inventory": -delta_inv,
            "change_in_accounts_payable": delta_ap,
            "change_in_excise_tax_payable": delta_excise,
            "operating_cash_flow": cfo,
            "capex": -capex_amt,
            "investing_cash_flow": cfi,
            "loan_proceeds": proceeds,
            "principal_payments": -principal,
            "financing_cash_flow": cff,
            "net_cash_flow": net_change,
            "opening_cash": opening_cash_period,
            "closing_cash": cash,
            "interest_paid": interest,
            "taxes_paid": tax,
        })

        fa_gross += capex_amt
        acc_dep += dep
        debt = debt + proceeds - principal
        equity = opening_equity + cumulative_ni
        total_assets = cash + ar + inv + (fa_gross - acc_dep)
        current_liabilities = ap + excise_payable + opening_other
        total_liabilities = current_liabilities + debt
        all_balance.append({
            "period": period,
            "cash": cash,
            "accounts_receivable": ar,
            "inventory": inv,
            "total_current_assets": cash + ar + inv,
            "fixed_assets_gross": fa_gross,
            "accumulated_depreciation": acc_dep,
            "fixed_assets_net": fa_gross - acc_dep,
            "total_assets": total_assets,
            "accounts_payable": ap,
            "excise_tax_payable": excise_payable,
            "other_liabilities": opening_other,
            "total_current_liabilities": current_liabilities,
            "debt": debt,
            "total_liabilities": total_liabilities,
            "opening_equity": opening_equity,
            "retained_earnings": cumulative_ni,
            "total_equity": equity,
            "total_liabilities_and_equity": total_liabilities + equity,
            "balance_check": total_assets - (total_liabilities + equity),
            "working_capital": (cash + ar + inv) - current_liabilities,
        })
        prev_ar, prev_inv, prev_ap, prev_excise = ar, inv, ap, excise_payable

    # Slice the window out of the modelled range. The opening column is the
    # balance sheet at the end of the month before the window: the carried
    # balance when months were rolled forward, else the stated opening balances.
    n_carry = len(carry_periods)
    income_rows = all_income[n_carry:]
    cash_rows = all_cash[n_carry:]
    balance_rows = all_balance[n_carry:]
    if n_carry:
        opening = dict(all_balance[n_carry - 1])
        opening["equity"] = opening["total_equity"]
        opening["equity_plugged"] = equity_plugged
    else:
        opening = model_opening

    if cash_shortfall_periods:
        warnings.append({
            "code": "cash_below_minimum",
            "message": f"Projected cash falls below the minimum balance in {len(cash_shortfall_periods)} period(s).",
            "periods": cash_shortfall_periods,
        })

    def _totals(rows: List[Dict[str, Any]], skip: Iterable[str] = ()) -> Dict[str, float]:
        skip = set(skip) | {"period"}
        totals: Dict[str, float] = {}
        for row in rows:
            for k, v in row.items():
                if k in skip or not isinstance(v, (int, float)):
                    continue
                totals[k] = totals.get(k, 0.0) + float(v)
        return totals

    income_totals = _totals(income_rows, skip=("gross_margin_pct", "operating_margin_pct", "net_margin_pct"))
    rev_total = income_totals.get("revenue", 0.0)
    income_totals["gross_margin_pct"] = (income_totals.get("gross_profit", 0.0) / rev_total * 100) if rev_total else 0.0
    income_totals["operating_margin_pct"] = (income_totals.get("operating_income", 0.0) / rev_total * 100) if rev_total else 0.0
    income_totals["net_margin_pct"] = (income_totals.get("net_income", 0.0) / rev_total * 100) if rev_total else 0.0

    # Cash balances are not flows: the Total column carries the window's
    # opening and closing balance, never a sum of monthly balances.
    cash_totals = _totals(cash_rows, skip=("opening_cash", "closing_cash"))
    window_opening_cash = opening["cash"]
    cash_totals["opening_cash"] = window_opening_cash
    cash_totals["closing_cash"] = cash
    net_cash_flow_total = cash_totals.get("net_cash_flow", 0.0)
    cash_reconciliation = {
        "opening_cash": window_opening_cash,
        "net_cash_flow": net_cash_flow_total,
        "closing_cash": cash,
        "difference": (window_opening_cash + net_cash_flow_total) - cash,
    }

    employee_rows = []
    for emp in payroll["employees"]:
        by_period = _slice(emp["by_period"], periods)
        employee_rows.append({**emp, "by_period": by_period, "total": sum(by_period.values())})

    return {
        "forecast_ids": list(forecast_ids),
        "periods": periods,
        "start_period": periods[0],
        "end_period": periods[-1],
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "assumptions": _round_dict({k: v for k, v in assumptions.items() if k != "notes"} | {"notes": assumptions.get("notes"), "found": found}),
        "carry_forward": {
            "opening_period": assumptions.get("opening_period"),
            "balances_as_of": opening["period"],
            "rolled_forward_periods": carry_periods,
            "months_rolled_forward": n_carry,
        },
        "warnings": warnings,
        "income_statement": {
            "by_period": [_round_dict(r) for r in income_rows],
            "totals": _round_dict(income_totals),
        },
        "cash_flow": {
            "by_period": [_round_dict(r) for r in cash_rows],
            "totals": _round_dict(cash_totals),
            "reconciliation": _round_dict(cash_reconciliation),
        },
        "balance_sheet": {
            "opening": _round_dict(opening),
            "by_period": [_round_dict(r) for r in balance_rows],
            "closing": _round_dict(balance_rows[-1]) if balance_rows else None,
        },
        "detail": {
            "revenue_by_product": _round_dict(sales["by_product"]),
            "revenue_by_customer": _round_dict(sales["by_customer"]),
            "revenue_by_customer_type": _round_dict(sales["by_customer_type"]),
            "sales_deductions": {
                "rule_count": sales["deduction_rule_count"],
                "rows_with_deductions": sales["rows_with_deductions"],
                "by_type": {
                    dtype: {
                        "label": meta["label"],
                        "treatment": meta["treatment"],
                        "statement_line": meta["statement_line"],
                        "total": round(sum(sales["deductions"][dtype][p] for p in periods), 2),
                    }
                    for dtype, meta in DEDUCTION_TYPES.items()
                },
            },
            "expenses_by_category": _round_dict(expenses["by_category"]),
            "payroll_by_department": _round_dict({d: _slice(v, periods) for d, v in payroll["by_department"].items()}),
            "payroll_by_business_unit": _round_dict({u: _slice(v, periods) for u, v in payroll["by_business_unit"].items()}),
            "payroll_headcount": _round_dict(_slice(payroll["headcount"], periods)),
            "payroll_by_labor_class": _round_dict({k: _slice(v, periods) for k, v in payroll["by_labor_class"].items()}),
            "labor_policy": _round_dict(labor_policy),
            "payroll_employees": [_round_dict(e) for e in employee_rows],
            "loans": _round_dict({
                lid: {
                    **entry,
                    # Balance at the start of the reported window: the modelled opening balance
                    # rolled through the carried months' proceeds and principal payments.
                    "opening_balance": entry["opening_balance"]
                    + sum(entry["proceeds"][p] for p in carry_periods)
                    - sum(entry["principal"][p] for p in carry_periods),
                    "principal": _slice(entry["principal"], periods),
                    "interest": _slice(entry["interest"], periods),
                    "proceeds": _slice(entry["proceeds"], periods),
                }
                for lid, entry in loans["by_loan"].items()
            }),
            "capex_items": [
                _round_dict({
                    **i,
                    "in_window": i["purchase_period"] in window_set,
                    "depreciation_by_period": _slice(i["depreciation_by_period"], periods),
                })
                for i in capex["items"]
            ],
        },
    }


# ---------------------------------------------------------------------------
# Actuals and variance
# ---------------------------------------------------------------------------

def load_actuals(cursor, start_period: str, end_period: str) -> List[Dict[str, Any]]:
    cursor.execute(
        """
        SELECT actual_id, period, line_item, amount, reference_id, source, notes, updated_at
        FROM actuals WHERE period >= ? AND period <= ?
        ORDER BY period, line_item, reference_id
        """,
        (start_period, end_period),
    )
    columns = [d[0] for d in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _budget_lines_by_period(statements: Dict[str, Any]) -> Dict[str, Dict[str, float]]:
    """Map line_item -> {period: budget} from a built statement set."""
    lines: Dict[str, Dict[str, float]] = {k: {} for k in VARIANCE_LINE_ITEMS}
    for row in statements["income_statement"]["by_period"]:
        p = row["period"]
        for key, meta in VARIANCE_LINE_ITEMS.items():
            if meta["statement"] == "income":
                lines[key][p] = float(row.get(key, 0.0))
    for row in statements["cash_flow"]["by_period"]:
        lines["capex"][row["period"]] = -float(row.get("capex", 0.0))
    for row in statements["balance_sheet"]["by_period"]:
        lines["closing_cash"][row["period"]] = float(row.get("cash", 0.0))
    return lines


def _favorable(variance: Optional[float], direction: str) -> Optional[bool]:
    if variance is None:
        return None
    return variance >= 0 if direction == "income" else variance <= 0


def build_variance(cursor, forecast_ids: Sequence[str], start_period: str, end_period: str,
                   statements: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Budget vs actual for every statement line.

    A line/month with no recorded actual is MISSING (actual = None, no
    variance); a recorded amount of 0 is a confirmed zero and is compared
    like any other actual. To-date totals compare each line only over the
    months that line has actuals for, and every line reports which months
    are missing up to the latest month that has any actuals, so partial
    entry (e.g. January revenue but only February payroll) is visible
    instead of producing a misleading variance.

    Sales Deductions is the sum of the gross-to-net detail lines
    (SALES_DEDUCTION_DETAIL_LINES). A month's actuals carry either the detail
    lines or the total: with detail lines only, the total's actual is the sum
    of the detail lines entered (``derived_periods``); with the total only,
    the month's detail lines are carried in it (``in_total_periods``) and are
    not missing. With both, the total is compared as entered and the report
    warns (``sales_deductions_total_and_detail``).
    """
    statements = statements or build_statements(cursor, forecast_ids, start_period, end_period)
    periods = statements["periods"]
    budget = _budget_lines_by_period(statements)

    actual: Dict[str, Dict[str, float]] = {k: {} for k in VARIANCE_LINE_ITEMS}
    unknown_lines: set = set()
    for entry in load_actuals(cursor, periods[0], periods[-1]):
        key = entry["line_item"]
        if key not in VARIANCE_LINE_ITEMS:
            unknown_lines.add(key)
            continue
        actual[key][entry["period"]] = actual[key].get(entry["period"], 0.0) + float(entry["amount"] or 0)

    # Sales deductions: a month carries either the detail lines or their total.
    total_key = "total_sales_deductions"
    derived_from: Dict[str, List[str]] = {}   # month -> the detail lines its Sales Deductions actual adds up
    in_total: set = set()                     # months whose detail lines are carried in the entered total
    overlap: List[Dict[str, Any]] = []        # months with both the total and detail lines
    deduction_months = set(actual[total_key]).union(*(actual[k] for k in SALES_DEDUCTION_DETAIL_LINES))
    for p in sorted(deduction_months):
        given = [k for k in SALES_DEDUCTION_DETAIL_LINES if p in actual[k]]
        detail_sum = 0.0
        for k in given:
            detail_sum += actual[k][p]
        if p not in actual[total_key]:
            actual[total_key][p] = detail_sum
            derived_from[p] = given
        elif given:
            entered = actual[total_key][p]
            overlap.append({"period": p, "total": round(entered, 2), "detail_lines": given,
                            "detail_sum": round(detail_sum, 2), "difference": round(entered - detail_sum, 2)})
        else:
            in_total.add(p)

    periods_with_actuals = sorted({p for line in actual.values() for p in line})
    actuals_through = periods_with_actuals[-1] if periods_with_actuals else None
    through_periods = [p for p in periods if actuals_through and p <= actuals_through]

    def _over(values: Dict[str, float], months: Sequence[str], is_balance: bool) -> float:
        """Flows add up over months; a balance (closing cash) is its value at the last month."""
        if not months:
            return 0.0
        if is_balance:
            return values.get(months[-1], 0.0)
        return sum(values.get(p, 0.0) for p in months)

    lines_out: List[Dict[str, Any]] = []
    incomplete_lines: List[Dict[str, Any]] = []
    lines_without_actuals: List[str] = []
    for key, meta in VARIANCE_LINE_ITEMS.items():
        is_balance = meta["statement"] == "balance_sheet"
        # A detail line of a month that has only the Sales Deductions total is carried in it, not missing.
        carried = in_total if key in SALES_DEDUCTION_DETAIL_LINES else set()
        by_period = []
        for p in periods:
            b = budget[key].get(p, 0.0)
            a = actual[key].get(p)
            variance = (a - b) if a is not None else None
            by_period.append({
                "period": p,
                "budget": round(b, 2),
                "actual": round(a, 2) if a is not None else None,
                "variance": round(variance, 2) if variance is not None else None,
                "variance_pct": round(variance / abs(b) * 100, 2) if (variance is not None and b) else None,
                "favorable": _favorable(variance, meta["direction"]),
            })

        compared = [p for p in periods if p in actual[key]]
        missing = [p for p in through_periods if p not in actual[key] and p not in carried]
        if not compared:
            coverage = "none"
        elif missing:
            coverage = "partial"
        else:
            coverage = "complete"

        # To-date totals are apples to apples: only months where THIS line has an actual.
        b_total = _over(budget[key], periods, is_balance)
        b_ytd = _over(budget[key], compared, is_balance)
        a_ytd = _over(actual[key], compared, is_balance) if compared else None
        v_ytd = (a_ytd - b_ytd) if a_ytd is not None else None
        b_through = _over(budget[key], through_periods, is_balance)
        line_out: Dict[str, Any] = {
            "line_item": key,
            "label": meta["label"],
            "direction": meta["direction"],
            "statement": meta["statement"],
            "has_actuals": bool(compared),
            "coverage": coverage,
            "by_period": by_period,
            "totals": {
                "budget_full_period": round(b_total, 2),
                "budget_through_latest_actual": round(b_through, 2),
                "budget_to_date": round(b_ytd, 2),
                "actual_to_date": round(a_ytd, 2) if a_ytd is not None else None,
                "variance_to_date": round(v_ytd, 2) if v_ytd is not None else None,
                "variance_pct_to_date": round(v_ytd / abs(b_ytd) * 100, 2) if (v_ytd is not None and b_ytd) else None,
                "favorable": _favorable(v_ytd, meta["direction"]),
                "periods_compared": compared,
                "missing_periods": missing,
                "coverage": coverage,
            },
        }
        if key == total_key:
            line_out["derived_periods"] = sorted(derived_from)
        elif key in SALES_DEDUCTION_DETAIL_LINES:
            line_out["in_total_periods"] = [p for p in periods if p in in_total]
        lines_out.append(line_out)
        if coverage == "partial":
            incomplete_lines.append({"line_item": key, "label": meta["label"], "missing_periods": missing})
        elif coverage == "none" and not carried:
            lines_without_actuals.append(key)

    period_coverage = []
    for p in through_periods:
        carried_lines = [k for k in SALES_DEDUCTION_DETAIL_LINES if p in in_total]
        required = [k for k in VARIANCE_LINE_ITEMS if k not in carried_lines]
        entered = [k for k in required if p in actual[k]]
        period_coverage.append({
            "period": p,
            "lines_entered": len(entered),
            "lines_total": len(required),
            "lines_missing": [k for k in required if p not in actual[k]],
            "lines_in_total": carried_lines,
            "complete": len(entered) == len(required),
        })

    warnings = list(statements.get("warnings", []))
    if overlap:
        differ = [o for o in overlap if abs(o["difference"]) >= 0.005]
        tie = (f"the detail lines differ from it in {month_ranges([o['period'] for o in differ])} (e.g. "
               f"{differ[0]['period']}: total {differ[0]['total']:,.2f}, detail lines {differ[0]['detail_sum']:,.2f})"
               if differ else "the detail lines add up to it")
        warnings.append({
            "code": "sales_deductions_total_and_detail",
            "message": (
                f"Sales Deductions actuals are entered both as a total and as detail lines (terms allowance, "
                f"chargebacks, other allowances, excise tax) for {month_ranges([o['period'] for o in overlap])}. "
                f"A month should carry either the detail lines or the total, never both: Sales Deductions compares "
                f"the total as entered and {tie}. Delete the total for those months (it is then the sum of the "
                f"detail lines) or delete the detail lines."
            ),
            "periods": overlap,
        })
    if derived_from:
        message = (f"Sales Deductions actuals for {month_ranges(sorted(derived_from))} are the sum of the detail lines "
                   f"entered (terms allowance, chargebacks, other allowances, excise tax); no total was entered for "
                   f"those months.")
        absent = [(VARIANCE_LINE_ITEMS[k]["label"], [p for p in sorted(derived_from) if k not in derived_from[p]])
                  for k in SALES_DEDUCTION_DETAIL_LINES]
        absent = [(label, months) for label, months in absent if months]
        if absent:
            message += (" Not entered, so 0 in that total (enter 0 to confirm): "
                        + "; ".join(f"{label} {month_ranges(months)}" for label, months in absent) + ".")
        warnings.append({
            "code": "sales_deductions_from_detail",
            "level": "info",
            "message": message,
            "periods": sorted(derived_from),
        })
    if unknown_lines:
        warnings.append({
            "code": "unknown_actual_lines",
            "message": f"Ignored actuals for unknown line items: {', '.join(sorted(unknown_lines))}",
        })
    if incomplete_lines:
        detail = "; ".join(
            f"{line['label']} (missing {', '.join(line['missing_periods'])})" for line in incomplete_lines
        )
        warnings.append({
            "code": "incomplete_actuals",
            "message": (
                f"Actuals are incomplete through {actuals_through} for {len(incomplete_lines)} line(s): {detail}. "
                f"To-date variances compare only the months each line has actuals for."
            ),
            "lines": incomplete_lines,
        })
    if actuals_through and lines_without_actuals:
        warnings.append({
            "code": "lines_without_actuals",
            "message": f"{len(lines_without_actuals)} line(s) have no actuals in this window and are shown as missing, not as zero.",
            "lines": lines_without_actuals,
        })

    return {
        "forecast_ids": statements["forecast_ids"],
        "periods": periods,
        "periods_with_actuals": periods_with_actuals,
        "actuals_through": actuals_through,
        "period_coverage": period_coverage,
        "incomplete_lines": incomplete_lines,
        "lines_without_actuals": lines_without_actuals,
        "line_items": lines_out,
        "warnings": warnings,
    }


def statements_to_rows(statements: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Flatten a statement set into long-format rows for CSV export."""
    rows: List[Dict[str, Any]] = []
    for statement_key, label in (("income_statement", "Income Statement"),
                                 ("cash_flow", "Cash Flow"),
                                 ("balance_sheet", "Balance Sheet")):
        for row in statements[statement_key]["by_period"]:
            for k, v in row.items():
                if k == "period":
                    continue
                rows.append({"statement": label, "period": row["period"], "line_item": k, "amount": v})
    return rows
