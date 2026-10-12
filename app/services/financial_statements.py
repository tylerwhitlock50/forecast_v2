"""
Financial statements engine.

Single source of truth for the reporting module. Builds a period-by-period
income statement, cash flow statement and balance sheet for one or more
forecast scenarios, driven entirely by data already in the database:

  * revenue + product COGS   -> sales / units / bom / routers  (utils.cost_rollup)
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
* Scenario scoping: rows whose forecast_id is in the selected set OR NULL are
  included. NULL means "company-wide" (shared by every scenario). Revenue is
  always scenario-specific so it is never NULL-scoped.
* Working capital uses a simple days convention:
      AR  = revenue_in_month      * dso_days / AVG_DAYS_PER_MONTH
      INV = product_cogs_in_month * dio_days / AVG_DAYS_PER_MONTH
      AP  = purchases_in_month    * dpo_days / AVG_DAYS_PER_MONTH
  where purchases = materials + factory overhead + other COGS + admin +
  operating expenses (payroll is assumed paid in-month).
* Debt is rolled forward from the opening balance using scheduled principal
  payments and new-loan proceeds, which keeps the balance sheet identity exact.
* Opening equity is plugged so the opening balance sheet balances unless the
  user supplies it explicitly, in which case any imbalance is reported.
"""
from __future__ import annotations

import calendar
import json
from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

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
    "notes": None,
}

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
    "revenue":            {"label": "Revenue",                 "direction": "income",  "statement": "income"},
    "cogs_materials":     {"label": "COGS - Materials",        "direction": "expense", "statement": "income"},
    "cogs_labor":         {"label": "COGS - Direct Labor",     "direction": "expense", "statement": "income"},
    "cogs_manufacturing": {"label": "COGS - Machine / Mfg",    "direction": "expense", "statement": "income"},
    "factory_overhead":   {"label": "COGS - Factory Overhead", "direction": "expense", "statement": "income"},
    "other_cogs":         {"label": "COGS - Other",            "direction": "expense", "statement": "income"},
    "total_cogs":         {"label": "Total COGS",              "direction": "expense", "statement": "income"},
    "gross_profit":       {"label": "Gross Profit",            "direction": "income",  "statement": "income"},
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
    return config


# ---------------------------------------------------------------------------
# Revenue and product COGS
# ---------------------------------------------------------------------------

def revenue_and_cogs_by_period(cursor, forecast_ids: Sequence[str], periods: Sequence[str]) -> Dict[str, Any]:
    """Revenue and BOM/routing-driven COGS per period for the selected scenarios."""
    out = {
        "revenue": _zero_by_period(periods),
        "quantity": _zero_by_period(periods),
        "materials": _zero_by_period(periods),
        "labor": _zero_by_period(periods),
        "manufacturing": _zero_by_period(periods),
        "by_product": {},
        "by_customer": {},
        "cost_warnings": {},
        "record_count": 0,
    }
    if not forecast_ids or not periods:
        return out

    scope, params = _scope_clause("s.forecast_id", forecast_ids, include_null=False)
    cursor.execute(
        f"""
        SELECT s.period, s.customer_id, s.unit_id, s.quantity, s.unit_price, s.total_revenue,
               u.unit_name, u.bom_id, u.bom_version, u.router_id,
               c.customer_name
        FROM sales s
        LEFT JOIN units u ON s.unit_id = u.unit_id
        LEFT JOIN customers c ON s.customer_id = c.customer_id
        WHERE {scope} AND s.period >= ? AND s.period <= ?
        """,
        params + [periods[0], periods[-1]],
    )
    rows = cursor.fetchall()
    period_set = set(periods)
    unit_cost_cache: Dict[Tuple, Dict[str, Any]] = {}

    for (period, customer_id, unit_id, quantity, unit_price, total_revenue,
         unit_name, bom_id, bom_version, router_id, customer_name) in rows:
        period = str(period)[:7] if period else None
        if period not in period_set:
            continue
        qty = float(quantity or 0)
        revenue = float(total_revenue) if total_revenue is not None else qty * float(unit_price or 0)

        key = (bom_id, bom_version, router_id)
        if key not in unit_cost_cache:
            unit_cost_cache[key] = calculate_unit_costs(cursor, bom_id, bom_version, router_id)
        uc = unit_cost_cache[key]
        materials = uc["material_per_unit"] * qty
        labor = uc["labor_per_unit"] * qty
        machine = uc["machine_per_unit"] * qty

        out["revenue"][period] += revenue
        out["quantity"][period] += qty
        out["materials"][period] += materials
        out["labor"][period] += labor
        out["manufacturing"][period] += machine
        out["record_count"] += 1

        prod = out["by_product"].setdefault(unit_id or "unknown", {
            "unit_id": unit_id, "unit_name": unit_name, "revenue": 0.0, "cogs": 0.0, "quantity": 0.0,
        })
        prod["revenue"] += revenue
        prod["cogs"] += materials + labor + machine
        prod["quantity"] += qty

        cust = out["by_customer"].setdefault(customer_id or "unknown", {
            "customer_id": customer_id, "customer_name": customer_name, "revenue": 0.0,
        })
        cust["revenue"] += revenue

        if uc["warnings"]:
            out["cost_warnings"][unit_id or "unknown"] = sorted(set(uc["warnings"]))

    return out


# ---------------------------------------------------------------------------
# Payroll
# ---------------------------------------------------------------------------

def _employee_annual_gross(emp: Dict[str, Any], rate: float) -> float:
    if (emp.get("rate_type") or "hourly") == "salary":
        return rate * 40 * 52
    return rate * float(emp.get("weekly_hours") or 0) * 52


def _burden_multiplier(config: Dict[str, Any], benefits_eligible: bool) -> float:
    rate = 1.0
    for key in ("federal_tax_rate", "state_tax_rate", "social_security_rate",
                "medicare_rate", "unemployment_rate", "workers_comp_rate"):
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


def _employee_rate_for_period(emp: Dict[str, Any], period: str, include_raises: bool) -> float:
    rate = float(emp.get("hourly_rate") or 0)
    if not include_raises:
        return rate
    review = _parse_date(emp.get("next_review_date"))
    raise_amt = float(emp.get("expected_raise") or 0)
    if review and raise_amt and review <= period_bounds(period)[0]:
        # Same convention as the legacy pay-period forecast: values above 1
        # are a flat $/hour bump, values <= 1 are a percentage.
        rate = rate + raise_amt if raise_amt > 1 else rate * (1 + raise_amt)
    return rate


def load_employees(cursor, forecast_ids: Sequence[str]) -> List[Dict[str, Any]]:
    scope, params = _scope_clause("forecast_id", forecast_ids, include_null=True)
    cursor.execute(
        f"""
        SELECT employee_id, employee_name, department, weekly_hours, hourly_rate,
               rate_type, labor_type, start_date, end_date, next_review_date,
               expected_raise, benefits_eligible, allocations, forecast_id
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
        employees.append(emp)
    return employees


def payroll_by_period(cursor, forecast_ids: Sequence[str], periods: Sequence[str],
                      include_raises: bool = True,
                      config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Fully burdened payroll cost per calendar month, prorated for hires/terms."""
    config = config or load_payroll_config(cursor)
    employees = load_employees(cursor, forecast_ids)
    totals = _zero_by_period(periods)
    gross = _zero_by_period(periods)
    by_department: Dict[str, Dict[str, float]] = {}
    by_business_unit: Dict[str, Dict[str, float]] = {}
    headcount = _zero_by_period(periods)
    employee_rows: List[Dict[str, Any]] = []

    for emp in employees:
        start = _parse_date(emp.get("start_date"))
        end = _parse_date(emp.get("end_date"))
        multiplier = _burden_multiplier(config, bool(emp.get("benefits_eligible", 1)))
        emp_by_period: Dict[str, float] = {}
        for period in periods:
            fraction = _active_fraction(period, start, end)
            if fraction <= 0:
                emp_by_period[period] = 0.0
                continue
            rate = _employee_rate_for_period(emp, period, include_raises)
            monthly_gross = _employee_annual_gross(emp, rate) / 12 * fraction
            cost = monthly_gross * multiplier
            emp_by_period[period] = cost
            totals[period] += cost
            gross[period] += monthly_gross
            headcount[period] += fraction
            dept = emp.get("department") or "Unassigned"
            by_department.setdefault(dept, _zero_by_period(periods))[period] += cost
            allocations = emp.get("allocations") or {}
            if allocations:
                for unit, pct in allocations.items():
                    try:
                        share = float(pct) / 100.0
                    except (TypeError, ValueError):
                        continue
                    by_business_unit.setdefault(unit, _zero_by_period(periods))[period] += cost * share
        employee_rows.append({
            "employee_id": emp.get("employee_id"),
            "employee_name": emp.get("employee_name"),
            "department": emp.get("department"),
            "forecast_id": emp.get("forecast_id"),
            "by_period": emp_by_period,
            "total": sum(emp_by_period.values()),
        })

    return {
        "total": totals,
        "gross": gross,
        "headcount": headcount,
        "by_department": by_department,
        "by_business_unit": by_business_unit,
        "employees": employee_rows,
        "config": config,
    }


# ---------------------------------------------------------------------------
# Expenses
# ---------------------------------------------------------------------------

def expenses_by_period(cursor, forecast_ids: Sequence[str], periods: Sequence[str]) -> Dict[str, Any]:
    """Expense allocations per period, bucketed by statement line."""
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
        cat = out["by_category"].setdefault(category_name or "Uncategorized", {
            "category_type": category_type, "bucket": bucket, "by_period": _zero_by_period(periods), "total": 0.0,
        })
        cat["by_period"][period] += amount
        cat["total"] += amount
    return out


# ---------------------------------------------------------------------------
# Loans
# ---------------------------------------------------------------------------

def loans_by_period(cursor, periods: Sequence[str]) -> Dict[str, Any]:
    """Scheduled principal/interest per period, opening debt and new-loan proceeds."""
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
        schedule = cursor.fetchall()

        # Opening balance = last scheduled remaining_balance before the window,
        # or the full principal if the loan exists but hasn't been paid yet.
        balance_before = None
        for pay_date, _p, _i, _a, remaining in schedule:
            d = _parse_date(pay_date)
            if d and d < first_day:
                balance_before = float(remaining or 0)
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
        })

        if originated and first_day <= originated <= last_day:
            p = originated.strftime("%Y-%m")
            proceeds[p] += float(principal_amount or 0)

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


def build_statements(cursor, forecast_ids: Sequence[str], start_period: str, end_period: str,
                     include_raises: bool = True) -> Dict[str, Any]:
    """Build the full statement set for a reporting window."""
    forecast_ids = [f for f in forecast_ids if f]
    if not forecast_ids:
        raise ValueError("At least one forecast_id is required")
    periods = period_range(start_period, end_period)

    # Assumptions come from the first selected scenario (they describe the
    # company, not the scenario), falling back to defaults.
    assumptions, found = load_assumptions(cursor, forecast_ids[0])
    warnings: List[Dict[str, Any]] = []
    if not found:
        warnings.append({
            "code": "default_assumptions",
            "message": "No financial assumptions saved for this scenario; using defaults (zero opening balances, 30/60/30 day working capital, 21% tax).",
        })

    sales = revenue_and_cogs_by_period(cursor, forecast_ids, periods)
    payroll = payroll_by_period(cursor, forecast_ids, periods, include_raises=include_raises)
    expenses = expenses_by_period(cursor, forecast_ids, periods)
    loans = loans_by_period(cursor, periods)
    capex = capex_by_period(cursor, forecast_ids, periods, assumptions)

    if sales["cost_warnings"]:
        warnings.append({
            "code": "cost_warnings",
            "message": f"{len(sales['cost_warnings'])} product(s) have incomplete BOM/routing data; their COGS may be understated.",
            "products": sales["cost_warnings"],
        })

    tax_rate = float(assumptions.get("income_tax_rate") or 0)
    dso = float(assumptions.get("dso_days") or 0)
    dio = float(assumptions.get("dio_days") or 0)
    dpo = float(assumptions.get("dpo_days") or 0)
    min_cash = float(assumptions.get("minimum_cash_balance") or 0)

    # Opening balance sheet
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
    opening = {
        "period": shift_period(periods[0], -1),
        "cash": opening_cash,
        "accounts_receivable": opening_ar,
        "inventory": opening_inv,
        "total_current_assets": opening_cash + opening_ar + opening_inv,
        "fixed_assets_gross": opening_fa_gross,
        "accumulated_depreciation": opening_acc_dep,
        "fixed_assets_net": opening_fa_gross - opening_acc_dep,
        "total_assets": opening_assets,
        "accounts_payable": opening_ap,
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

    income_rows: List[Dict[str, Any]] = []
    cash_rows: List[Dict[str, Any]] = []
    balance_rows: List[Dict[str, Any]] = []

    prev_ar, prev_inv, prev_ap = opening_ar, opening_inv, opening_ap
    cash = opening_cash
    fa_gross = opening_fa_gross
    acc_dep = opening_acc_dep
    debt = opening_debt
    cumulative_ni = 0.0
    cash_shortfall_periods: List[str] = []

    for period in periods:
        revenue = sales["revenue"][period]
        materials = sales["materials"][period]
        labor = sales["labor"][period]
        manufacturing = sales["manufacturing"][period]
        factory_overhead = expenses["factory_overhead"][period]
        other_cogs = expenses["other_cogs"][period]
        total_cogs = materials + labor + manufacturing + factory_overhead + other_cogs
        gross_profit = revenue - total_cogs

        payroll_cost = payroll["total"][period]
        admin = expenses["admin"][period]
        operating = expenses["operating"][period]
        dep = capex["depreciation"][period]
        total_opex = payroll_cost + admin + operating + dep
        operating_income = gross_profit - total_opex

        interest = loans["interest"][period]
        pre_tax = operating_income - interest
        tax = max(pre_tax, 0.0) * tax_rate
        net_income = pre_tax - tax
        cumulative_ni += net_income

        income_rows.append({
            "period": period,
            "revenue": revenue,
            "units_sold": sales["quantity"][period],
            "cogs_materials": materials,
            "cogs_labor": labor,
            "cogs_manufacturing": manufacturing,
            "factory_overhead": factory_overhead,
            "other_cogs": other_cogs,
            "total_cogs": total_cogs,
            "gross_profit": gross_profit,
            "gross_margin_pct": (gross_profit / revenue * 100) if revenue else 0.0,
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
        purchases = materials + factory_overhead + other_cogs + admin + operating
        ar = revenue * dso / AVG_DAYS_PER_MONTH
        inv = product_cogs * dio / AVG_DAYS_PER_MONTH
        ap = purchases * dpo / AVG_DAYS_PER_MONTH
        delta_ar = ar - prev_ar
        delta_inv = inv - prev_inv
        delta_ap = ap - prev_ap

        cfo = net_income + dep - delta_ar - delta_inv + delta_ap
        capex_amt = capex["capex"][period]
        cfi = -capex_amt
        proceeds = loans["proceeds"][period]
        principal = loans["principal"][period]
        cff = proceeds - principal
        net_change = cfo + cfi + cff
        opening_cash_period = cash
        cash = cash + net_change
        if cash < min_cash:
            cash_shortfall_periods.append(period)

        cash_rows.append({
            "period": period,
            "net_income": net_income,
            "depreciation": dep,
            "change_in_accounts_receivable": -delta_ar,
            "change_in_inventory": -delta_inv,
            "change_in_accounts_payable": delta_ap,
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
        total_liabilities = ap + opening_other + debt
        balance_rows.append({
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
            "other_liabilities": opening_other,
            "total_current_liabilities": ap + opening_other,
            "debt": debt,
            "total_liabilities": total_liabilities,
            "opening_equity": opening_equity,
            "retained_earnings": cumulative_ni,
            "total_equity": equity,
            "total_liabilities_and_equity": total_liabilities + equity,
            "balance_check": total_assets - (total_liabilities + equity),
            "working_capital": (cash + ar + inv) - (ap + opening_other),
        })
        prev_ar, prev_inv, prev_ap = ar, inv, ap

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

    cash_totals = _totals(cash_rows, skip=("opening_cash", "closing_cash"))
    cash_totals["opening_cash"] = opening_cash
    cash_totals["closing_cash"] = cash

    return {
        "forecast_ids": list(forecast_ids),
        "periods": periods,
        "start_period": periods[0],
        "end_period": periods[-1],
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "assumptions": _round_dict({k: v for k, v in assumptions.items() if k != "notes"} | {"notes": assumptions.get("notes"), "found": found}),
        "warnings": warnings,
        "income_statement": {
            "by_period": [_round_dict(r) for r in income_rows],
            "totals": _round_dict(income_totals),
        },
        "cash_flow": {
            "by_period": [_round_dict(r) for r in cash_rows],
            "totals": _round_dict(cash_totals),
        },
        "balance_sheet": {
            "opening": _round_dict(opening),
            "by_period": [_round_dict(r) for r in balance_rows],
            "closing": _round_dict(balance_rows[-1]) if balance_rows else None,
        },
        "detail": {
            "revenue_by_product": _round_dict(sales["by_product"]),
            "revenue_by_customer": _round_dict(sales["by_customer"]),
            "expenses_by_category": _round_dict(expenses["by_category"]),
            "payroll_by_department": _round_dict(payroll["by_department"]),
            "payroll_by_business_unit": _round_dict(payroll["by_business_unit"]),
            "payroll_headcount": _round_dict(payroll["headcount"]),
            "loans": _round_dict(loans["by_loan"]),
            "capex_items": [_round_dict(i) for i in capex["items"]],
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


def build_variance(cursor, forecast_ids: Sequence[str], start_period: str, end_period: str,
                   statements: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Budget vs actual for every statement line that has a budget or an actual."""
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

    periods_with_actuals = sorted({p for line in actual.values() for p in line})

    lines_out: List[Dict[str, Any]] = []
    for key, meta in VARIANCE_LINE_ITEMS.items():
        by_period = []
        b_total = a_total = 0.0
        has_actual = False
        for p in periods:
            b = budget[key].get(p, 0.0)
            a = actual[key].get(p)
            b_total += b
            if a is not None:
                has_actual = True
                a_total += a
            variance = (a - b) if a is not None else None
            favorable = None
            if variance is not None:
                favorable = variance >= 0 if meta["direction"] == "income" else variance <= 0
            by_period.append({
                "period": p,
                "budget": round(b, 2),
                "actual": round(a, 2) if a is not None else None,
                "variance": round(variance, 2) if variance is not None else None,
                "variance_pct": round(variance / abs(b) * 100, 2) if (variance is not None and b) else None,
                "favorable": favorable,
            })
        # Totals compare only periods where actuals exist, so YTD is apples to apples.
        b_ytd = sum(budget[key].get(p, 0.0) for p in periods_with_actuals)
        a_ytd = sum(actual[key].get(p, 0.0) for p in periods_with_actuals) if has_actual else None
        v_ytd = (a_ytd - b_ytd) if a_ytd is not None else None
        lines_out.append({
            "line_item": key,
            "label": meta["label"],
            "direction": meta["direction"],
            "statement": meta["statement"],
            "has_actuals": has_actual,
            "by_period": by_period,
            "totals": {
                "budget_full_period": round(b_total, 2),
                "budget_to_date": round(b_ytd, 2),
                "actual_to_date": round(a_ytd, 2) if a_ytd is not None else None,
                "variance_to_date": round(v_ytd, 2) if v_ytd is not None else None,
                "variance_pct_to_date": round(v_ytd / abs(b_ytd) * 100, 2) if (v_ytd is not None and b_ytd) else None,
                "favorable": (v_ytd >= 0 if meta["direction"] == "income" else v_ytd <= 0) if v_ytd is not None else None,
            },
        })

    warnings = list(statements.get("warnings", []))
    if unknown_lines:
        warnings.append({
            "code": "unknown_actual_lines",
            "message": f"Ignored actuals for unknown line items: {', '.join(sorted(unknown_lines))}",
        })

    return {
        "forecast_ids": statements["forecast_ids"],
        "periods": periods,
        "periods_with_actuals": periods_with_actuals,
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
