"""
Payroll routes: employees, payroll config, per-employee cost, the pay-run and
monthly forecasts, and department / business-unit analytics.

Every number here follows the statements engine's rules
(``services.financial_statements``) so the payroll screens, the MCP tools and
the income statement agree:

* Annual gross pay is ``annual_base_pay(rate_type, rate, weekly_hours)``:
  hourly = rate x weekly hours x 52; salary = the annual salary (a salary
  under ``ANNUAL_SALARY_THRESHOLD`` is a legacy hourly equivalent x 2,080).
* Employer cost is gross x ``_burden_multiplier(config, benefits_eligible)``
  = gross x (1 + social security + medicare + unemployment + workers comp
  [+ benefits when eligible]).
* ``federal_tax_rate`` / ``state_tax_rate`` are income tax WITHHELD from the
  employee's gross pay. They are reported (with the employee's matching FICA)
  as withholding and net pay, never as an employer cost.

So 12 months of statement accrual equal an employee's annual cost, and
runs_per_year x the per-run cost equal it too. Department and business-unit
totals are sums of the same per-employee figures; pass start_period /
end_period to get the statements' own accrual for a window as well.

* ``labor_class`` (direct / indirect / admin, NULL = not classified) decides
  where pay lands on the statements: direct in COGS (replacing the routing
  standard through the direct labor variance), indirect in COGS as indirect
  labor, admin / not classified in operating-expense payroll.
* ``GET /payroll/statement-bridge`` reconciles the statements' monthly
  accrual with the cash paid on pay dates.
"""
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import ConfigDict
from typing import Optional, Dict, Any, List, Sequence, Tuple
from datetime import date, datetime, timedelta
import uuid
import json

from db.models import (
    Payroll, PayrollCreate, PayrollBase,
    PayrollConfig, PayrollConfigUpdate,
    ForecastResponse
)
from db.database import db_manager
from services.governance import LOCK_TOKEN, is_lock_error, locked_message
from services.financial_statements import (
    ANNUAL_SALARY_THRESHOLD,
    EMPLOYER_BURDEN_KEYS,
    LABOR_CLASS_ERROR,
    LABOR_CLASS_KEYS,
    LABOR_CLASS_LABELS,
    PAY_PERIODS_PER_YEAR,
    _burden_multiplier,
    _parse_date,
    add_months,
    allocation_shares,
    annual_base_pay,
    gross_for_days,
    load_employees,
    load_payroll_config,
    normalize_allocations,
    normalize_labor_class,
    pay_anchor,
    payroll_by_period,
    period_bounds,
    period_range,
    pay_run_dates,
)

router = APIRouter(prefix="/payroll", tags=["payroll"])

#: Business units the payroll screens always show (allocations may name others).
STANDARD_BUSINESS_UNITS = [
    "Customer-Centric Brands",
    "OEM Work",
    "Internal Operations",
    "Other Projects",
]
#: Bucket for the part of an employee's cost whose allocations do not reach 100%.
UNALLOCATED = "Unallocated"

EMPLOYEE_COLUMNS = (
    "employee_name", "department", "weekly_hours", "hourly_rate", "rate_type", "labor_type",
    "start_date", "end_date", "next_review_date", "expected_raise", "benefits_eligible",
    "allocations", "forecast_id", "labor_class",
)
#: Columns every employee read returns (labor_class: direct / indirect / admin / null).
_EMPLOYEE_SELECT = """
    SELECT employee_id, employee_name, department, weekly_hours, hourly_rate,
           rate_type, labor_type, start_date, end_date, next_review_date,
           expected_raise, benefits_eligible, allocations, forecast_id, labor_class
    FROM payroll
"""


class EmployeeCreate(PayrollCreate):
    """PayrollCreate plus the employee's labor class."""
    model_config = ConfigDict(extra="ignore")
    labor_class: Optional[str] = None


class EmployeeUpdate(PayrollBase):
    """PayrollBase plus the labor class; a body without labor_class keeps the stored one."""
    model_config = ConfigDict(extra="ignore")
    labor_class: Optional[str] = None
RATE_TYPES = ("hourly", "salary")
#: An hourly rate above this is almost certainly an annual salary typed as hourly.
MAX_PLAUSIBLE_HOURLY_RATE = 500.0

WITHHOLDING_NOTE = ("federal_tax_rate / state_tax_rate are employee income-tax withholding (shown with the "
                    "employee's matching FICA as withholding and net pay); they are not an employer cost.")


# ========================
# Shared payroll maths (engine rules)
# ========================

def _round(value: float, places: int = 2) -> float:
    return round(float(value or 0), places)


def _round_dict(values: Dict[str, Any], places: int = 2) -> Dict[str, Any]:
    return {k: (_round(v, places) if isinstance(v, float) else v) for k, v in values.items()}


def benefits_eligible(emp: Dict[str, Any]) -> bool:
    """Same truthiness rule as the statements engine."""
    return bool(emp.get("benefits_eligible", 1))


def runs_per_year(config: Dict[str, Any]) -> int:
    return PAY_PERIODS_PER_YEAR.get(config.get("pay_frequency"), 26)


def pay_breakdown(gross: float, config: Dict[str, Any], eligible: bool) -> Dict[str, float]:
    """
    Employer cost and employee withholding for `gross` pay (any period).

    total_cost = gross x the engine's burden multiplier = gross + employer
    taxes + benefits. Withholding (federal / state income tax plus the
    employee's matching social security and medicare) is information only:
    it comes out of gross pay, so it never adds to total_cost.
    """
    gross = float(gross or 0)
    employer = {key[: -len("_rate")]: gross * float(config.get(key) or 0) for key in EMPLOYER_BURDEN_KEYS}
    benefits = gross * float(config.get("benefits_rate") or 0) if eligible else 0.0
    total_cost = gross * _burden_multiplier(config, eligible)
    federal = gross * float(config.get("federal_tax_rate") or 0)
    state = gross * float(config.get("state_tax_rate") or 0)
    employee_fica = gross * (float(config.get("social_security_rate") or 0) + float(config.get("medicare_rate") or 0))
    withholding = federal + state + employee_fica
    return {
        "gross_pay": gross,
        **employer,
        "employer_taxes": sum(employer.values()),
        "benefits": benefits,
        "total_cost": total_cost,
        "federal_tax": federal,
        "state_tax": state,
        "employee_fica": employee_fica,
        "withholding": withholding,
        "net_pay": gross - withholding,
    }


def rate_basis(emp: Dict[str, Any]) -> str:
    """How hourly_rate is read: hourly wage, annual salary, or a legacy hourly-equivalent salary."""
    if (emp.get("rate_type") or "hourly") == "salary":
        rate = float(emp.get("hourly_rate") or 0)
        return "annual_salary" if rate >= ANNUAL_SALARY_THRESHOLD else "legacy_hourly_equivalent"
    return "hourly"


def rate_warnings(rate_type: Optional[str], rate: Any) -> List[str]:
    try:
        value = float(rate or 0)
    except (TypeError, ValueError):
        return []
    if (rate_type or "hourly") == "salary" and 0 < value < ANNUAL_SALARY_THRESHOLD:
        return [f"Salary {value:g} is under {ANNUAL_SALARY_THRESHOLD:,.0f}, so it is read as an hourly equivalent "
                f"(${value * 2080:,.0f} a year). Enter the annual salary instead."]
    if (rate_type or "hourly") == "hourly" and value > MAX_PLAUSIBLE_HOURLY_RATE:
        return [f"Hourly rate {value:g} means ${value:,.0f} an hour. If this is an annual salary, set rate_type "
                f"'salary'."]
    return []


def _hours_per_week(emp: Dict[str, Any]) -> float:
    hours = float(emp.get("weekly_hours") or 0)
    if hours <= 0 and (emp.get("rate_type") or "hourly") == "salary":
        hours = 40.0
    return hours


def employee_annual_cost(emp: Dict[str, Any], config: Dict[str, Any], rate: Optional[float] = None) -> Dict[str, float]:
    """
    Annual (run-rate) pay for one employee at `rate` (default: the stored
    rate, no raise): gross, employer taxes, benefits, total employer cost
    (== 12 months of the statements' payroll accrual), withholding and net.
    """
    rate = float(emp.get("hourly_rate") or 0) if rate is None else float(rate)
    gross = annual_base_pay(emp.get("rate_type"), rate, emp.get("weekly_hours"))
    eligible = benefits_eligible(emp)
    out = pay_breakdown(gross, config, eligible)
    hours = _hours_per_week(emp)
    out["burden_multiplier"] = _burden_multiplier(config, eligible)
    out["hourly_equivalent"] = gross / (hours * 52) if hours > 0 else 0.0
    return out


def run_gross(emp: Dict[str, Any], window: Tuple[date, date], runs: int, include_raises: bool,
              first: Optional[date] = None, last: Optional[date] = None) -> float:
    """
    Gross pay a run with pay period `window` pays for the employee's days on
    payroll in first..last (default: the whole pay period). Each day of the
    pay period earns annual gross / runs / its days, at the rate in force on
    that day: the engine's rule (financial_statements.gross_for_days), so a
    hire, a leaver and a raise start on the same day in the pay runs as on
    the income statement. `emp` carries the parsed `_start` / `_end` dates.
    """
    first = max(first or window[0], window[0])
    last = min(last or window[1], window[1])
    return gross_for_days(emp, first, last, runs, (window[1] - window[0]).days + 1, include_raises,
                          emp.get("_start"), emp.get("_end"))


def pay_run_window(frequency: str, pay_date: date) -> Tuple[date, date]:
    """The days a pay run pays for (inclusive)."""
    if frequency == "weekly":
        return pay_date - timedelta(days=6), pay_date
    if frequency == "biweekly":
        return pay_date - timedelta(days=13), pay_date
    if frequency == "semimonthly":
        return (pay_date.replace(day=1) if pay_date.day <= 15 else pay_date.replace(day=16)), pay_date
    return pay_date.replace(day=1), pay_date  # monthly: the calendar month


def _active_share(window: Tuple[date, date], start: Optional[date], end: Optional[date]) -> float:
    """Fraction of a pay period the employee is on payroll (0..1), like the engine's monthly proration."""
    first, last = window
    active_start = max(first, start) if start else first
    active_end = min(last, end) if end else last
    if active_end < active_start:
        return 0.0
    return ((active_end - active_start).days + 1) / ((last - first).days + 1)


def _validated_allocations(value: Optional[Dict[str, Any]]) -> Dict[str, float]:
    """Allocations for a write: numbers >= 0, fractions converted to percent."""
    if not value:
        return {}
    for unit, pct in value.items():
        try:
            number = float(pct)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail=f"allocations['{unit}'] must be a number (percent), got {pct!r}")
        if number < 0:
            raise HTTPException(status_code=422, detail=f"allocations['{unit}'] cannot be negative")
    return normalize_allocations(value)


def _labor_class(value: Any) -> Optional[str]:
    """Validated labor class for a write: direct / indirect / admin, or None (not classified)."""
    try:
        return normalize_labor_class(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{LABOR_CLASS_ERROR}; got {value!r}")


def _employee_status(emp: Dict[str, Any], today: Optional[date] = None) -> str:
    end = _parse_date(emp.get("end_date"))
    return "inactive" if end and end <= (today or date.today()) else "active"


# ========================
# Scope and loading helpers
# ========================

def _scenario_exists(cursor, forecast_id: str) -> bool:
    cursor.execute("SELECT 1 FROM forecast WHERE forecast_id = ?", (forecast_id,))
    return cursor.fetchone() is not None


def _resolve_scope(cursor, forecast_id: Optional[str]) -> Tuple[List[str], Dict[str, Any]]:
    """
    Scenario scope for an aggregate (forecast, departments, business units,
    summary): the given scenario (404 if unknown) plus company-wide staff;
    when omitted, the base scenario; with no base scenario, every employee.
    """
    if forecast_id:
        if not _scenario_exists(cursor, forecast_id):
            raise HTTPException(status_code=404, detail=f"Scenario '{forecast_id}' not found")
        return [forecast_id], {"forecast_id": forecast_id, "defaulted": False}
    try:
        cursor.execute("SELECT forecast_id FROM forecast WHERE is_base = 1 ORDER BY forecast_id LIMIT 1")
        row = cursor.fetchone()
    except Exception:
        row = None
    if row:
        return [row[0]], {"forecast_id": row[0], "defaulted": True,
                          "note": "forecast_id omitted: the base scenario (plus company-wide staff) is used"}
    return [], {"forecast_id": None, "defaulted": True,
                "note": "forecast_id omitted and no base scenario: employees of every scenario are included"}


def _window(start_period: Optional[str], end_period: Optional[str]) -> Optional[List[str]]:
    if not (start_period or end_period):
        return None
    if not (start_period and end_period):
        raise HTTPException(status_code=422, detail="start_period and end_period are both required")
    try:
        return period_range(start_period, end_period)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


def _prepare_employee(emp: Dict[str, Any]) -> Dict[str, Any]:
    emp["allocations"] = normalize_allocations(emp.get("allocations"))
    emp["status"] = _employee_status(emp)
    emp["labor_class"] = normalize_labor_class(emp.get("labor_class"), strict=False)
    return emp


def _check_forecast_id(cursor, forecast_id: Optional[str]) -> None:
    if forecast_id and not _scenario_exists(cursor, forecast_id):
        raise HTTPException(status_code=422, detail=f"Scenario '{forecast_id}' not found; omit forecast_id for a "
                                                    f"company-wide employee")


def _check_employee_fields(rate_type: Optional[str], start_date: Optional[str], end_date: Optional[str] = None,
                           next_review_date: Optional[str] = None) -> None:
    if rate_type is not None and rate_type not in RATE_TYPES:
        raise HTTPException(status_code=422, detail="rate_type must be 'hourly' or 'salary'")
    for name, value in (("start_date", start_date), ("end_date", end_date), ("next_review_date", next_review_date)):
        if value and not _parse_date(value):
            raise HTTPException(status_code=422, detail=f"{name} '{value}' is not a date (use YYYY-MM-DD)")
    start, end = _parse_date(start_date), _parse_date(end_date)
    if start and end and end < start:
        raise HTTPException(status_code=422, detail=f"end_date {end.isoformat()} is before start_date "
                                                    f"{start.isoformat()}: the employee would never be paid")


def _check_amounts(weekly_hours: Any = None, hourly_rate: Any = None) -> None:
    """Weekly hours 0..168 (decimals allowed, e.g. 37.5) and a pay rate of 0 or more (bulk updates)."""
    for name, value, top in (("weekly_hours", weekly_hours, 168.0), ("hourly_rate", hourly_rate, None)):
        if value is None:
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail=f"{name} must be a number, got {value!r}")
        if number != number or number < 0 or (top is not None and number > top):
            limit = f"between 0 and {top:g}" if top is not None else "0 or more"
            raise HTTPException(status_code=422, detail=f"{name} must be {limit}, got {value!r}")


# ========================
# Employee Management
# ========================

@router.get("/employees", response_model=ForecastResponse)
async def get_employees(
    department: Optional[str] = Query(None, description="Filter by department"),
    status: Optional[str] = Query(None, description="Filter by status (active/inactive)"),
    business_unit: Optional[str] = Query(None, description="Filter by business unit allocation"),
    forecast_id: Optional[str] = Query(None, description="Filter by forecast ID"),
    labor_class: Optional[str] = Query(None, description="Filter by labor class: direct, indirect, admin, or "
                                                         "unclassified (no class)"),
    include_costs: bool = Query(False, description="Add each employee's annual cost breakdown (gross, employer "
                                                   "taxes, benefits, withholding, net pay)"),
):
    """
    Get all employees with optional filtering. Each row carries annual_gross
    and annual_cost (employer cost, the same rules as the statements) and
    labor_class (direct / indirect / admin, null = not classified).
    """
    try:
        class_filter = None
        if labor_class:
            class_filter = "unclassified" if labor_class.strip().lower() in ("unclassified", "none", "not classified") \
                else _labor_class(labor_class)
        conn = db_manager.get_connection()
        try:
            cursor = conn.cursor()
            query = _EMPLOYEE_SELECT
            conditions = []
            params: List[Any] = []
            if department:
                conditions.append("department = ?")
                params.append(department)
            if forecast_id:
                # Company-wide employees (NULL forecast_id) belong to every
                # scenario, exactly as the statements engine treats them.
                conditions.append("(forecast_id = ? OR forecast_id IS NULL)")
                params.append(forecast_id)
            if conditions:
                query += " WHERE " + " AND ".join(conditions)
            query += " ORDER BY employee_name"
            cursor.execute(query, params)
            columns = [d[0] for d in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
            config = load_payroll_config(cursor)
        finally:
            db_manager.close_connection(conn)

        employee_list = []
        for employee_dict in rows:
            _prepare_employee(employee_dict)
            if status in ("active", "inactive") and employee_dict["status"] != status:
                continue
            if business_unit and not employee_dict["allocations"].get(business_unit):
                continue
            if class_filter and (employee_dict["labor_class"] or "unclassified") != class_filter:
                continue
            cost = employee_annual_cost(employee_dict, config)
            employee_dict["rate_basis"] = rate_basis(employee_dict)
            employee_dict["annual_gross"] = _round(cost["gross_pay"])
            employee_dict["annual_cost"] = _round(cost["total_cost"])
            if include_costs:
                employee_dict["cost_breakdown"] = _round_dict({
                    k: v for k, v in cost.items() if k not in ("gross_pay", "total_cost")
                }, 4)
            employee_list.append(employee_dict)

        return ForecastResponse(
            status="success",
            data={"employees": employee_list},
            message=f"Retrieved {len(employee_list)} employees"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving employees: {str(e)}")


def _fetch_employee(cursor, employee_id: str) -> Dict[str, Any]:
    cursor.execute(_EMPLOYEE_SELECT + " WHERE employee_id = ?", (employee_id,))
    row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Employee '{employee_id}' not found")
    columns = [d[0] for d in cursor.description]
    return _prepare_employee(dict(zip(columns, row)))


@router.get("/employees/{employee_id}", response_model=ForecastResponse)
async def get_employee(employee_id: str):
    """
    Get a specific employee by ID, with annual_gross / annual_cost.
    """
    try:
        conn = db_manager.get_connection()
        try:
            cursor = conn.cursor()
            employee = _fetch_employee(cursor, employee_id)
            config = load_payroll_config(cursor)
        finally:
            db_manager.close_connection(conn)
        cost = employee_annual_cost(employee, config)
        employee["rate_basis"] = rate_basis(employee)
        employee["annual_gross"] = _round(cost["gross_pay"])
        employee["annual_cost"] = _round(cost["total_cost"])
        return ForecastResponse(
            status="success",
            data={"employee": employee},
            message="Employee retrieved successfully"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving employee: {str(e)}")


@router.post("/employees", response_model=ForecastResponse)
async def create_employee(employee: EmployeeCreate):
    """
    Create a new employee. hourly_rate is the hourly wage, or the ANNUAL
    salary when rate_type is 'salary'. Allocations are percent (fractions
    summing to 1 are converted). labor_class: direct (builds product; their
    pay replaces the routing standard in COGS), indirect (factory support,
    COGS), admin, or empty (not classified, treated as admin).
    """
    try:
        _check_employee_fields(employee.rate_type, employee.start_date, employee.end_date, employee.next_review_date)
        labor_class = _labor_class(employee.labor_class)
        start = _parse_date(employee.start_date)
        if not start:
            raise HTTPException(status_code=422, detail="start_date is required (YYYY-MM-DD)")
        allocations = _validated_allocations(employee.allocations)
        conn = db_manager.get_connection()
        try:
            cursor = conn.cursor()
            _check_forecast_id(cursor, employee.forecast_id)
            # Timestamp + random suffix: two hires saved in the same second must not collide.
            employee_id = f"EMP-{int(datetime.now().timestamp())}-{uuid.uuid4().hex[:6]}"
            next_review_date = employee.next_review_date or add_months(start, 12).isoformat()
            cursor.execute("""
                INSERT INTO payroll (
                    employee_id, employee_name, department, weekly_hours, hourly_rate,
                    rate_type, labor_type, start_date, end_date, next_review_date,
                    expected_raise, benefits_eligible, allocations, forecast_id, labor_class
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                employee_id, employee.employee_name, employee.department,
                employee.weekly_hours, employee.hourly_rate, employee.rate_type,
                employee.labor_type, employee.start_date, employee.end_date,
                next_review_date, employee.expected_raise, employee.benefits_eligible,
                json.dumps(allocations), employee.forecast_id, labor_class
            ))
            conn.commit()
        finally:
            db_manager.close_connection(conn)

        data: Dict[str, Any] = {"employee_id": employee_id, "labor_class": labor_class}
        warnings = rate_warnings(employee.rate_type, employee.hourly_rate)
        if warnings:
            data["warnings"] = warnings
        return ForecastResponse(status="success", data=data, message="Employee created successfully")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating employee: {str(e)}")


@router.put("/employees/{employee_id}", response_model=ForecastResponse)
async def update_employee(employee_id: str, employee: EmployeeUpdate):
    """
    Update an existing employee (every field is replaced). labor_class is
    replaced only when the body names it (null clears it), so a client that
    does not know labor classes never wipes one.
    """
    try:
        _check_employee_fields(employee.rate_type, employee.start_date, employee.end_date, employee.next_review_date)
        allocations = _validated_allocations(employee.allocations)
        sets_class = "labor_class" in employee.model_fields_set
        labor_class = _labor_class(employee.labor_class) if sets_class else None
        conn = db_manager.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT employee_id FROM payroll WHERE employee_id = ?", (employee_id,))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail=f"Employee '{employee_id}' not found")
            _check_forecast_id(cursor, employee.forecast_id)
            cursor.execute(f"""
                UPDATE payroll SET
                    employee_name = ?, department = ?, weekly_hours = ?, hourly_rate = ?,
                    rate_type = ?, labor_type = ?, start_date = ?, end_date = ?,
                    next_review_date = ?, expected_raise = ?, benefits_eligible = ?, allocations = ?,
                    forecast_id = ?{", labor_class = ?" if sets_class else ""}
                WHERE employee_id = ?
            """, (
                employee.employee_name, employee.department, employee.weekly_hours,
                employee.hourly_rate, employee.rate_type, employee.labor_type,
                employee.start_date, employee.end_date, employee.next_review_date,
                employee.expected_raise, employee.benefits_eligible, json.dumps(allocations),
                employee.forecast_id, *([labor_class] if sets_class else []), employee_id
            ))
            conn.commit()
        finally:
            db_manager.close_connection(conn)

        data: Dict[str, Any] = {"employee_id": employee_id}
        warnings = rate_warnings(employee.rate_type, employee.hourly_rate)
        if warnings:
            data["warnings"] = warnings
        return ForecastResponse(status="success", data=data, message="Employee updated successfully")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating employee: {str(e)}")


@router.delete("/employees/{employee_id}", response_model=ForecastResponse)
async def delete_employee(employee_id: str):
    """
    Delete an employee
    """
    try:
        conn = db_manager.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT employee_id FROM payroll WHERE employee_id = ?", (employee_id,))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail=f"Employee '{employee_id}' not found")
            cursor.execute("DELETE FROM payroll WHERE employee_id = ?", (employee_id,))
            conn.commit()
        finally:
            db_manager.close_connection(conn)

        return ForecastResponse(
            status="success",
            data={"employee_id": employee_id},
            message="Employee deleted successfully"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting employee: {str(e)}")


# ========================
# Payroll Configuration
# ========================

def _burden_summary(config: Dict[str, Any]) -> Dict[str, Any]:
    employer_rate = sum(float(config.get(k) or 0) for k in EMPLOYER_BURDEN_KEYS)
    return {
        "employer_tax_rate": _round(employer_rate, 6),
        "benefits_rate": _round(float(config.get("benefits_rate") or 0), 6),
        "multiplier_benefits_eligible": _round(_burden_multiplier(config, True), 6),
        "multiplier_not_eligible": _round(_burden_multiplier(config, False), 6),
        "employer_cost_keys": list(EMPLOYER_BURDEN_KEYS) + ["benefits_rate (benefits-eligible staff only)"],
        "withholding_keys": ["federal_tax_rate", "state_tax_rate"],
        "note": WITHHOLDING_NOTE,
        "pay_frequency": config.get("pay_frequency"),
        "runs_per_year": runs_per_year(config),
    }


@router.get("/config", response_model=ForecastResponse)
async def get_payroll_config():
    """
    Payroll configuration: employer burden rates, benefits rate, pay
    frequency, and the federal / state income-tax WITHHOLDING rates (employee
    side, not an employer cost). `burden` summarises the resulting multipliers.
    """
    try:
        conn = db_manager.get_connection()
        try:
            cursor = conn.cursor()
            config = load_payroll_config(cursor)
            cursor.execute("SELECT * FROM payroll_config ORDER BY rowid DESC LIMIT 1")
            row = cursor.fetchone()
            if row:
                stored = dict(zip([d[0] for d in cursor.description], row))
                for key, value in stored.items():
                    if key not in config and value is not None:
                        config[key] = value
        finally:
            db_manager.close_connection(conn)

        return ForecastResponse(
            status="success",
            data={"config": config, "burden": _burden_summary(config)},
            message="Payroll configuration retrieved successfully"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving payroll config: {str(e)}")


CONFIG_FIELDS = ("federal_tax_rate", "state_tax_rate", "social_security_rate", "medicare_rate",
                 "unemployment_rate", "benefits_rate", "workers_comp_rate", "pay_frequency", "pay_anchor_date")


def _pay_frequency(value: Any) -> str:
    """weekly / biweekly / semimonthly / monthly ('Semi-monthly', 'bi_weekly' are read the same); else 422."""
    text = "".join(str(value or "").lower().replace("-", " ").replace("_", " ").split())
    if text not in PAY_PERIODS_PER_YEAR:
        raise HTTPException(status_code=422, detail=f"pay_frequency must be weekly, biweekly, semimonthly or "
                                                    f"monthly; got {value!r}")
    return text


def _pay_anchor_date(value: Any) -> str:
    """A known biweekly payday: a Friday as YYYY-MM-DD; else 422."""
    day = _parse_date(value)
    if not day:
        raise HTTPException(status_code=422, detail=f"pay_anchor_date {value!r} is not a date (use YYYY-MM-DD)")
    if day.weekday() != 4:
        friday = day + timedelta(days=(4 - day.weekday()) % 7)
        raise HTTPException(status_code=422, detail=f"pay_anchor_date {day.isoformat()} is a {day.strftime('%A')}: "
                                                    f"biweekly pay runs are on Fridays, so give a Friday payday "
                                                    f"(e.g. {friday.isoformat()})")
    return day.isoformat()


@router.post("/config", response_model=ForecastResponse)
async def update_payroll_config(config: PayrollConfigUpdate):
    """
    Update payroll tax and benefit configuration. Only the fields given
    change; the others keep their stored values (a new config row is saved,
    so the history is kept). pay_frequency must be weekly, biweekly,
    semimonthly or monthly (anything else is a 422, never stored as another
    frequency). pay_anchor_date is a known biweekly payday (a Friday): every
    biweekly payday is that date + 14 x k days, in every report. Rates are
    fractions between 0 and 1 (benefits up to 5).
    """
    try:
        changes = {k: v for k, v in config.model_dump(exclude_unset=True).items() if v is not None}
        if not changes:
            raise HTTPException(status_code=422, detail="Give at least one rate, pay_frequency or pay_anchor_date "
                                                        "to change")
        if "pay_frequency" in changes:
            changes["pay_frequency"] = _pay_frequency(changes["pay_frequency"])
        if "pay_anchor_date" in changes:
            changes["pay_anchor_date"] = _pay_anchor_date(changes["pay_anchor_date"])
        conn = db_manager.get_connection()
        try:
            cursor = conn.cursor()
            merged = {k: v for k, v in load_payroll_config(cursor).items() if k in CONFIG_FIELDS}
            merged.update(changes)
            config_id = f"CONFIG-{int(datetime.now().timestamp())}-{uuid.uuid4().hex[:6]}"
            # Insert new config (keep history)
            cursor.execute(f"""
                INSERT INTO payroll_config (config_id, {", ".join(CONFIG_FIELDS)})
                VALUES (?, {", ".join("?" for _ in CONFIG_FIELDS)})
            """, (config_id, *(merged[k] for k in CONFIG_FIELDS)))
            conn.commit()
            stored = load_payroll_config(cursor)
        finally:
            db_manager.close_connection(conn)

        return ForecastResponse(
            status="success",
            data={"config_id": config_id, "config": stored, "changed": sorted(changes),
                  "burden": _burden_summary(stored)},
            message="Payroll configuration updated successfully"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating payroll config: {str(e)}")


# ========================
# Payroll Calculations
# ========================

@router.get("/calculations/{employee_id}", response_model=ForecastResponse)
async def calculate_employee_costs(
    employee_id: str,
    pay_periods: int = Query(1, ge=1, le=520, description="Number of pay runs (configured pay frequency) to cost"),
):
    """
    Cost of one employee for N pay runs at the configured pay frequency:
    gross pay, employer taxes and benefits (total_cost = employer cost), and
    withholding / net pay for information. annual_cost == runs_per_year x
    the one-run total_cost == 12 months of the statements' payroll.
    """
    try:
        conn = db_manager.get_connection()
        try:
            cursor = conn.cursor()
            employee = _fetch_employee(cursor, employee_id)
            config = load_payroll_config(cursor)
        finally:
            db_manager.close_connection(conn)

        runs = runs_per_year(config)
        annual = employee_annual_cost(employee, config)
        gross_pay = annual["gross_pay"] / runs * pay_periods
        breakdown = pay_breakdown(gross_pay, config, benefits_eligible(employee))
        hours = _hours_per_week(employee) * 52 / runs * pay_periods
        calculation = {
            "employee_id": employee_id,
            "employee_name": employee["employee_name"],
            "pay_periods": pay_periods,
            "pay_frequency": config.get("pay_frequency"),
            "runs_per_year": runs,
            **_round_dict(breakdown),
            "effective_hourly_cost": _round(breakdown["total_cost"] / hours) if hours > 0 else 0,
            "annual_gross": _round(annual["gross_pay"]),
            "annual_cost": _round(annual["total_cost"]),
            "burden_multiplier": _round(annual["burden_multiplier"], 6),
            "rate_basis": rate_basis(employee),
            "note": "total_cost is the employer cost (gross + employer taxes + benefits). " + WITHHOLDING_NOTE,
        }
        warnings = rate_warnings(employee.get("rate_type"), employee.get("hourly_rate"))
        if warnings:
            calculation["warnings"] = warnings

        return ForecastResponse(
            status="success",
            data={"calculation": calculation},
            message="Employee cost calculation completed"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculating employee costs: {str(e)}")


# ========================
# Payroll Forecasting
# ========================

_TOTAL_KEYS = ("gross_pay", "employer_taxes", "benefits", "total_cost", "withholding", "net_pay")


def _pay_run_forecast(cursor, scope_ids: Sequence[str], config: Dict[str, Any], periods: int,
                      start: date, include_raises: bool, include_employees: bool) -> List[Dict[str, Any]]:
    """
    The next `periods` pay runs from `start` on the company's pay calendar
    (pay_run_dates with the configured pay_anchor_date, so `start` picks the
    first run but never moves the paydays). Each run pays annual gross /
    runs_per_year, weighted by the days of the pay period the employee is on
    payroll and the rate in force on each day (run_gross), burdened like
    the statements.
    """
    frequency = config.get("pay_frequency", "biweekly")
    runs = runs_per_year(config)
    employees = [_prepare_employee(emp) for emp in load_employees(cursor, scope_ids)]
    for emp in employees:
        emp["_start"] = _parse_date(emp.get("start_date"))
        emp["_end"] = _parse_date(emp.get("end_date"))
        emp["_eligible"] = benefits_eligible(emp)

    forecast = []
    for number, pay_date in enumerate(pay_run_dates(frequency, start, periods, pay_anchor(config)), start=1):
        window = pay_run_window(frequency, pay_date)
        totals = {k: 0.0 for k in _TOTAL_KEYS}
        details = []
        for emp in employees:
            share = _active_share(window, emp["_start"], emp["_end"])
            if share <= 0:
                continue
            gross = run_gross(emp, window, runs, include_raises)
            breakdown = pay_breakdown(gross, config, emp["_eligible"])
            for key in _TOTAL_KEYS:
                totals[key] += breakdown[key]
            if include_employees:
                details.append({
                    "employee_id": emp["employee_id"],
                    "employee_name": emp["employee_name"],
                    "department": emp["department"],
                    "labor_class": emp.get("labor_class"),
                    **{k: _round(breakdown[k]) for k in _TOTAL_KEYS},
                    "allocations": emp["allocations"],
                })
        run = {
            "period": number,
            "date": pay_date.isoformat(),
            "month": pay_date.strftime('%Y-%m'),
            "period_start": window[0].isoformat(),
            "period_end": window[1].isoformat(),
            **{k: _round(v) for k, v in totals.items()},
            "employee_count": sum(1 for emp in employees if _active_share(window, emp["_start"], emp["_end"]) > 0),
        }
        if include_employees:
            run["employee_details"] = details
        forecast.append(run)
    return forecast


def _monthly_forecast(cursor, scope_ids: Sequence[str], config: Dict[str, Any], months: List[str],
                      include_raises: bool, include_employees: bool) -> Dict[str, Any]:
    """The statements' own monthly payroll accrual, with the pay breakdown and business units."""
    result = payroll_by_period(cursor, scope_ids, months, include_raises=include_raises, config=config)
    employees = {emp["employee_id"]: _prepare_employee(emp) for emp in load_employees(cursor, scope_ids)}
    extra = {m: {k: 0.0 for k in ("employer_taxes", "benefits", "withholding", "net_pay")} for m in months}
    by_unit: Dict[str, Dict[str, float]] = {}
    for row in result["employees"]:
        emp = employees.get(row["employee_id"]) or {}
        eligible = benefits_eligible(emp)
        multiplier = _burden_multiplier(config, eligible)
        shares, unallocated = allocation_shares(emp.get("allocations"))
        if unallocated > 1e-9:
            shares = {**shares, UNALLOCATED: unallocated}
        for month, cost in row["by_period"].items():
            if not cost:
                continue
            breakdown = pay_breakdown(cost / multiplier, config, eligible)
            for key in extra[month]:
                extra[month][key] += breakdown[key]
            for unit, share in shares.items():
                by_unit.setdefault(unit, {m: 0.0 for m in months})[month] += cost * share

    forecast = [
        {
            "period": month,
            "total_cost": _round(result["total"][month]),
            "gross_pay": _round(result["gross"][month]),
            **{k: _round(v) for k, v in extra[month].items()},
            "headcount_fte": _round(result["headcount"][month]),
            "by_department": {d: _round(v[month]) for d, v in result["by_department"].items()},
            "by_business_unit": {u: _round(v[month]) for u, v in by_unit.items()},
            "by_labor_class": {c: _round(result["by_labor_class"][c][month]) for c in LABOR_CLASS_KEYS},
        }
        for month in months
    ]
    data: Dict[str, Any] = {
        "mode": "monthly",
        "forecast": forecast,
        "total_cost": _round(sum(result["total"].values())),
        "total_gross_pay": _round(sum(result["gross"].values())),
    }
    if include_employees:
        data["employees"] = [
            {**row, "by_period": {m: _round(v) for m, v in row["by_period"].items()}, "total": _round(row["total"])}
            for row in result["employees"]
        ]
    return data


@router.get("/forecast", response_model=ForecastResponse)
async def get_payroll_forecast(
    periods: Optional[int] = Query(None, ge=1, le=520, description="Number of pay runs to forecast (pay-period mode); "
                                                                   "default one year of runs for the configured pay "
                                                                   "frequency (12 / 24 / 26 / 52)"),
    include_raises: bool = Query(True, description="Include scheduled raises in forecast"),
    forecast_id: Optional[str] = Query(None, description="Scenario (company-wide staff always included); "
                                                         "defaults to the base scenario"),
    start_period: Optional[str] = Query(None, description="Start month (YYYY-MM) for monthly mode"),
    end_period: Optional[str] = Query(None, description="End month (YYYY-MM) for monthly mode"),
    start_date: Optional[str] = Query(None, description="Pay-period mode: first pay date on/after this date "
                                                        "(YYYY-MM-DD, default today)"),
    include_employees: bool = Query(True, description="Include per-employee rows (employee_details per run / "
                                                      "employees per month); false for totals only"),
):
    """
    Payroll forecast.

    * Monthly mode (start_period + end_period): fully burdened cost per
      calendar month, prorated for hire/termination dates. This is what the
      financial statements use, so the two always agree.
    * Pay-period mode (default): the next N pay runs on the company's pay
      calendar for the configured pay_frequency (N defaults to one year of
      runs: 12 monthly, 24 semimonthly, 26 biweekly, 52 weekly). Biweekly
      paydays are pay_anchor_date + 14 x k days, so start_date (default
      today) only picks the first run listed: the dates match
      GET /payroll/statement-bridge for any window. Each run is annual gross
      / runs per year, weighted by the days of the run's pay period the
      employee works at the rate in force on each day (a raise applies from
      next_review_date, as on the statements), so a year of runs at a
      constant rate equals the annual cost (and, with monthly pay, each run
      equals that month's statement accrual).

    total_cost is employer cost; withholding / net_pay are information only.
    """
    try:
        months = _window(start_period, end_period)
        first_pay = date.today()
        if start_date:
            first_pay = _parse_date(start_date)
            if not first_pay:
                raise HTTPException(status_code=422, detail=f"start_date '{start_date}' is not a date (use YYYY-MM-DD)")
        conn = db_manager.get_connection()
        try:
            cursor = conn.cursor()
            scope_ids, scope = _resolve_scope(cursor, forecast_id)
            config = load_payroll_config(cursor)
            if months:
                data = _monthly_forecast(cursor, scope_ids, config, months, include_raises, include_employees)
                data.update({"config": config, "scope": scope})
                return ForecastResponse(
                    status="success", data=data,
                    message=f"Generated monthly payroll forecast for {len(months)} month(s)",
                )
            horizon_default = periods is None
            run_count = runs_per_year(config) if horizon_default else periods
            forecast = _pay_run_forecast(cursor, scope_ids, config, run_count, first_pay, include_raises,
                                         include_employees)
        finally:
            db_manager.close_connection(conn)

        frequency = config.get("pay_frequency", "biweekly")
        totals = {k: _round(sum(run[k] for run in forecast)) for k in _TOTAL_KEYS}
        return ForecastResponse(
            status="success",
            data={"mode": "pay_period", "pay_frequency": frequency, "runs_per_year": runs_per_year(config),
                  "pay_anchor_date": config.get("pay_anchor_date"),
                  "periods": run_count, "horizon_default": horizon_default,
                  "forecast": forecast, "totals": totals, "config": config, "scope": scope},
            message=f"Generated payroll forecast for {run_count} {frequency} pay periods"
                    + (" (one year of pay runs)" if horizon_default else "")
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating payroll forecast: {str(e)}")


# ========================
# Statement accrual vs pay dates
# ========================

def _month_of(day: date) -> str:
    return day.strftime("%Y-%m")


def statement_bridge(cursor, scope_ids: Sequence[str], config: Dict[str, Any], months: List[str],
                     include_raises: bool = True) -> Dict[str, Any]:
    """
    Per month: payroll accrued by the statements (annual cost / 12 a month,
    weighted by day for hires, leavers and raises) vs payroll paid on the
    pay dates of the configured frequency, and the payroll owed at month end.

    Pay dates come from the company's one pay calendar (pay_run_dates with
    the configured pay_anchor_date), so a month has the same pay dates,
    paid amount and month-end balance whatever window is asked.

    * paid: the pay runs dated in the month (each pays its whole pay period);
    * difference = accrued - paid (timing between the statements and cash);
    * earned: pay for the days worked in the month, at the daily rate of the
      pay period each day belongs to (annual pay / 364 a day for weekly and
      biweekly pay);
    * accrued_payroll_balance: pay for days worked up to the month end that a
      later pay date pays (accrued payroll / wages payable). It is a balance
      of the month, not of the window, and moves by earned - paid;
      opening_accrued_payroll is the balance at the end of the month before
      the window.
    """
    accrual = payroll_by_period(cursor, scope_ids, months, include_raises=include_raises, config=config)
    frequency = config.get("pay_frequency", "biweekly")
    runs = runs_per_year(config)
    anchor = pay_anchor(config)
    first_day = period_bounds(months[0])[0]
    last_day = period_bounds(months[-1])[1]
    month_set = set(months)
    employees = [_prepare_employee(emp) for emp in load_employees(cursor, scope_ids)]
    for emp in employees:
        emp["_start"] = _parse_date(emp.get("start_date"))
        emp["_end"] = _parse_date(emp.get("end_date"))
        emp["_mult"] = _burden_multiplier(config, benefits_eligible(emp))

    # Every pay run whose pay period touches the window: from the first payday on or after its first day
    # (that pay period reaches back before the window) to the first payday after its last day (that pay
    # period holds the last days of the last month).
    candidates = pay_run_dates(frequency, first_day, runs * (len(months) // 12 + 2) + 4, anchor)
    dates = [d for d in candidates if d <= last_day]
    later = [d for d in candidates if d > last_day]
    in_window = len(dates)
    if later:
        dates.append(later[0])

    paid = {m: 0.0 for m in months}
    paid_by_class = {m: {c: 0.0 for c in LABOR_CLASS_KEYS} for m in months}
    earned = {m: 0.0 for m in months}
    owed = {m: 0.0 for m in months}
    pay_dates: Dict[str, List[str]] = {m: [] for m in months}
    opening = 0.0
    before_window = first_day - timedelta(days=1)
    for pay_date in dates:
        window = pay_run_window(frequency, pay_date)   # always ends on the pay date
        pay_month, start_month = _month_of(pay_date), _month_of(window[0])
        if pay_date <= last_day:
            pay_dates[pay_month].append(pay_date.isoformat())
        for emp in employees:
            if _active_share(window, emp["_start"], emp["_end"]) <= 0:
                continue
            mult = emp["_mult"]
            if pay_date <= last_day:
                cost = run_gross(emp, window, runs, include_raises) * mult
                paid[pay_month] += cost
                paid_by_class[pay_month][emp.get("labor_class") or "unclassified"] += cost
            # A pay period spans at most two calendar months: the days before the month end are owed at
            # that month end and paid by this later pay date.
            for month in ((pay_month,) if start_month == pay_month else (start_month, pay_month)):
                if month in month_set:
                    m_first, m_last = period_bounds(month)
                    earned[month] += run_gross(emp, window, runs, include_raises, m_first, m_last) * mult
            if start_month != pay_month:
                month_end = period_bounds(start_month)[1]
                carried = run_gross(emp, window, runs, include_raises, window[0], month_end) * mult
                if start_month in month_set:
                    owed[start_month] += carried
                elif month_end == before_window:
                    opening += carried

    rows = []
    cumulative = 0.0
    for month in months:
        accrued = accrual["total"][month]
        difference = accrued - paid[month]
        cumulative += difference
        rows.append({
            "period": month,
            "accrued": _round(accrued),
            "accrued_by_class": {c: _round(accrual["by_labor_class"][c][month]) for c in LABOR_CLASS_KEYS},
            "paid": _round(paid[month]),
            "paid_by_class": {c: _round(v) for c, v in paid_by_class[month].items()},
            "pay_runs": len(pay_dates[month]),
            "pay_dates": pay_dates[month],
            "difference": _round(difference),
            "cumulative_difference": _round(cumulative),
            "earned": _round(earned[month]),
            "accrued_payroll_balance": _round(owed[month]),
        })
    total_accrued = sum(accrual["total"].values())
    total_paid = sum(paid.values())
    label = {"weekly": "weekly", "biweekly": "every-other-week", "semimonthly": "twice-monthly",
             "monthly": "monthly"}.get(frequency, frequency)
    calendar = {"weekly": "every Friday",
                "biweekly": f"every other Friday from {anchor.isoformat()} (pay_anchor_date)",
                "semimonthly": "the 15th and the last day of each month",
                "monthly": "the last day of each month"}.get(frequency, frequency)
    return {
        "start_period": months[0],
        "end_period": months[-1],
        "pay_frequency": frequency,
        "runs_per_year": runs,
        "pay_anchor_date": anchor.isoformat(),
        "opening_accrued_payroll": _round(opening),
        "by_period": rows,
        "totals": {
            "accrued": _round(total_accrued),
            "paid": _round(total_paid),
            "difference": _round(total_accrued - total_paid),
            "earned": _round(sum(earned.values())),
            "pay_runs": in_window,
        },
        "closing_accrued_payroll": _round(owed[months[-1]]),
        "note": (
            "The statements accrue payroll evenly by calendar month (annual cost / 12, weighted by day for start "
            "and end dates and for a raise, which applies from its review date) and treat it as paid in the same "
            "month. Cash goes out on the " + label + " pay dates: " + calendar + ", the same dates for any "
            "window. Difference = accrued - paid. Owed at month end (accrued_payroll_balance) = pay for days "
            "worked up to the month end that a later pay date pays; it moves by earned - paid, where earned is "
            "the pay for the month's days at the pay period's daily rate. Over a year accrued and paid differ by "
            "timing, and by a run in a year with an extra pay date (27 every-other-week or 53 weekly Fridays). "
            "Pay is earned by the day (a year of weekly or every-other-week pay covers 364 days) while the "
            "statements spread the year evenly, so a hire, leaver or raise inside a pay period that does not "
            "line up with the calendar months leaves a small lasting difference too."
        ),
    }


def _default_bridge_window(cursor, scope_ids: Sequence[str]) -> List[str]:
    """The scenario's sales window widened to whole calendar years; the current year without sales."""
    where, params = "", []
    if scope_ids:
        where = f" AND forecast_id IN ({','.join('?' for _ in scope_ids)})"
        params = list(scope_ids)
    cursor.execute(
        "SELECT MIN(substr(period, 1, 7)), MAX(substr(period, 1, 7)) FROM sales "
        "WHERE substr(period, 1, 7) GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'" + where, params)
    first, last = cursor.fetchone() or (None, None)
    if not (first and last):
        year = date.today().year
        return period_range(f"{year}-01", f"{year}-12")
    return period_range(f"{first[:4]}-01", f"{last[:4]}-12")


@router.get("/statement-bridge", response_model=ForecastResponse)
async def get_statement_bridge(
    start_period: Optional[str] = Query(None, description="First month (YYYY-MM); with end_period omitted too, "
                                                          "the scenario's sales years (else this year)"),
    end_period: Optional[str] = Query(None, description="Last month (YYYY-MM)"),
    forecast_id: Optional[str] = Query(None, description="Scenario (company-wide staff always included); "
                                                         "defaults to the base scenario"),
    include_raises: bool = Query(True, description="Apply scheduled raises (as the statements do)"),
):
    """
    Statement payroll (accrued evenly by month, what the income statement
    shows) vs payroll paid on pay dates (the configured pay frequency), per
    month: accrued, paid, pay runs and dates, difference, cumulative
    difference and the implied accrued payroll at month end
    (opening_accrued_payroll + cumulative difference). Both sides split by
    labor class.
    """
    try:
        months = _window(start_period, end_period)
        conn = db_manager.get_connection()
        try:
            cursor = conn.cursor()
            scope_ids, scope = _resolve_scope(cursor, forecast_id)
            window_default = months is None
            if window_default:
                months = _default_bridge_window(cursor, scope_ids)
            config = load_payroll_config(cursor)
            data = statement_bridge(cursor, scope_ids, config, months, include_raises)
        finally:
            db_manager.close_connection(conn)
        data["scope"] = scope
        data["window_default"] = window_default
        return ForecastResponse(
            status="success", data=data,
            message=f"Payroll accrued vs paid for {len(months)} month(s), {data['pay_frequency']} pay",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error building the payroll bridge: {str(e)}")


# ========================
# Department / Business Unit analytics
# ========================

def _roster(cursor, forecast_id: Optional[str], status: Optional[str], months: Optional[List[str]]) -> Dict[str, Any]:
    """
    Employees in scope with their annual (run-rate) cost, plus, for a
    window, the statements' payroll accrual per employee.
    """
    scope_ids, scope = _resolve_scope(cursor, forecast_id)
    config = load_payroll_config(cursor)
    all_employees = [_prepare_employee(emp) for emp in load_employees(cursor, scope_ids)]
    employees = [emp for emp in all_employees if not status or status not in ("active", "inactive")
                 or emp["status"] == status]
    for emp in employees:
        emp["cost"] = employee_annual_cost(emp, config)
    window = None
    if months:
        result = payroll_by_period(cursor, scope_ids, months, config=config)
        by_employee = {row["employee_id"]: row["total"] for row in result["employees"]}
        window = {
            "start_period": months[0],
            "end_period": months[-1],
            "months": len(months),
            "total_cost": sum(result["total"].values()),
            "by_employee": by_employee,
            "by_department": {d: sum(v.values()) for d, v in result["by_department"].items()},
            "employees": {emp["employee_id"]: emp for emp in all_employees},
        }
    return {"scope": scope, "config": config, "employees": employees, "window": window}


def _department_rows(roster: Dict[str, Any], include_employees: bool) -> List[Dict[str, Any]]:
    window = roster["window"]
    departments: Dict[str, Dict[str, Any]] = {}

    def bucket(name: str) -> Dict[str, Any]:
        if name not in departments:
            departments[name] = {
                "department": name, "employee_count": 0,
                "total_annual_cost": 0.0, "total_annual_gross": 0.0,
                "total_employer_taxes": 0.0, "total_benefits": 0.0, "total_withholding": 0.0,
                "avg_hourly_rate": 0.0, "_hourly": 0.0, "employees": [],
            }
        return departments[name]

    for emp in roster["employees"]:
        cost = emp["cost"]
        dept = bucket(emp.get("department") or "Unassigned")
        dept["employee_count"] += 1
        dept["total_annual_cost"] += cost["total_cost"]
        dept["total_annual_gross"] += cost["gross_pay"]
        dept["total_employer_taxes"] += cost["employer_taxes"]
        dept["total_benefits"] += cost["benefits"]
        dept["total_withholding"] += cost["withholding"]
        dept["_hourly"] += cost["hourly_equivalent"]
        row = {
            "employee_id": emp["employee_id"],
            "employee_name": emp["employee_name"],
            "rate_type": emp.get("rate_type") or "hourly",
            "hourly_rate": emp.get("hourly_rate"),
            "hourly_equivalent": _round(cost["hourly_equivalent"]),
            "annual_gross": _round(cost["gross_pay"]),
            "annual_cost": _round(cost["total_cost"]),
        }
        if window:
            row["window_cost"] = _round(window["by_employee"].get(emp["employee_id"], 0.0))
        dept["employees"].append(row)

    if window:
        for name, total in window["by_department"].items():
            bucket(name)["window_cost"] = total
        for dept in departments.values():
            dept["window_cost"] = _round(dept.get("window_cost", 0.0))

    out = []
    for dept in departments.values():
        count = dept["employee_count"]
        dept["avg_annual_cost"] = _round(dept["total_annual_cost"] / count) if count else 0.0
        dept["avg_hourly_rate"] = _round(dept.pop("_hourly") / count) if count else 0.0
        for key in ("total_annual_cost", "total_annual_gross", "total_employer_taxes", "total_benefits",
                    "total_withholding"):
            dept[key] = _round(dept[key])
        if not include_employees:
            dept.pop("employees")
        out.append(dept)
    out.sort(key=lambda d: d["total_annual_cost"], reverse=True)
    return out


def _business_unit_rows(roster: Dict[str, Any], include_employees: bool) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Business-unit totals (allocations in percent; any shortfall goes to 'Unallocated') and allocation issues."""
    window = roster["window"]
    units: Dict[str, Dict[str, Any]] = {}

    def bucket(name: str) -> Dict[str, Any]:
        if name not in units:
            units[name] = {"business_unit": name, "total_annual_cost": 0.0, "fte_allocation": 0.0,
                           "employee_count": 0, "employees": []}
            if window:
                units[name]["window_cost"] = 0.0
        return units[name]

    for name in STANDARD_BUSINESS_UNITS:
        bucket(name)

    issues = []
    for emp in roster["employees"]:
        annual = emp["cost"]["total_cost"]
        shares, unallocated = allocation_shares(emp["allocations"])
        allocated_pct = sum(emp["allocations"].values())
        if abs(allocated_pct - 100) > 0.01:
            issues.append({"employee_id": emp["employee_id"], "employee_name": emp["employee_name"],
                           "allocated_percent": _round(allocated_pct)})
        if unallocated > 1e-9:
            shares = {**shares, UNALLOCATED: unallocated}
        for name, share in shares.items():
            unit = bucket(name)
            unit["total_annual_cost"] += annual * share
            unit["fte_allocation"] += share
            unit["employees"].append({
                "employee_id": emp["employee_id"],
                "employee_name": emp["employee_name"],
                "department": emp.get("department"),
                "allocation_percentage": _round(emp["allocations"].get(name, share * 100), 4),
                "allocated_cost": _round(annual * share),
            })

    if window:
        # The statements' accrual for the window, split with the same shares
        # (every employee in scope, including ones who have left since).
        for emp_id, total in window["by_employee"].items():
            emp = window["employees"].get(emp_id) or {}
            shares, unallocated = allocation_shares(emp.get("allocations"))
            if unallocated > 1e-9:
                shares = {**shares, UNALLOCATED: unallocated}
            for name, share in shares.items():
                bucket(name)["window_cost"] += total * share

    out = []
    for unit in units.values():
        unit["employee_count"] = len(unit["employees"])
        unit["total_annual_cost"] = _round(unit["total_annual_cost"])
        unit["fte_allocation"] = _round(unit["fte_allocation"], 4)
        if window:
            unit["window_cost"] = _round(unit["window_cost"])
        if not include_employees:
            unit.pop("employees")
        out.append(unit)
    out.sort(key=lambda u: u["total_annual_cost"], reverse=True)
    return out, issues


def _window_summary(window: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not window:
        return None
    return {"start_period": window["start_period"], "end_period": window["end_period"],
            "months": window["months"], "total_cost": _round(window["total_cost"]),
            "basis": "statements payroll accrual for the window (prorated hires / leavers, raises)"}


def _scope_param():
    return Query(None, description="Scenario (company-wide staff always included); defaults to the base scenario")


def _status_param():
    return Query("active", description="active (default), inactive, or all")


def _start_param():
    return Query(None, description="Optional window start (YYYY-MM): adds window_cost = the statements' accrual")


def _end_param():
    return Query(None, description="Optional window end (YYYY-MM)")


def _employees_param():
    return Query(True, description="Include the per-employee rows; false for totals only")


@router.get("/departments", response_model=ForecastResponse)
async def get_department_analytics(
    forecast_id: Optional[str] = _scope_param(),
    status: Optional[str] = _status_param(),
    start_period: Optional[str] = _start_param(),
    end_period: Optional[str] = _end_param(),
    include_employees: bool = _employees_param(),
):
    """
    Payroll by department. total_annual_cost is the annual employer cost
    (run rate at current rates); window_cost (with start/end_period) is the
    statements' payroll for that window.
    """
    try:
        months = _window(start_period, end_period)
        conn = db_manager.get_connection()
        try:
            roster = _roster(conn.cursor(), forecast_id, status, months)
        finally:
            db_manager.close_connection(conn)
        department_list = _department_rows(roster, include_employees)
        data: Dict[str, Any] = {"departments": department_list, "scope": roster["scope"]}
        if roster["window"]:
            data["window"] = _window_summary(roster["window"])
        return ForecastResponse(
            status="success",
            data=data,
            message=f"Retrieved analytics for {len(department_list)} departments"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving department analytics: {str(e)}")


@router.get("/business-units", response_model=ForecastResponse)
async def get_business_unit_analytics(
    forecast_id: Optional[str] = _scope_param(),
    status: Optional[str] = _status_param(),
    start_period: Optional[str] = _start_param(),
    end_period: Optional[str] = _end_param(),
    include_employees: bool = _employees_param(),
):
    """
    Payroll by business unit: each employee's annual employer cost split by
    their allocations (percent). Units named in allocations beyond the
    standard four are included; a shortfall under 100% is 'Unallocated', so
    the units always sum to the total payroll cost.
    """
    try:
        months = _window(start_period, end_period)
        conn = db_manager.get_connection()
        try:
            roster = _roster(conn.cursor(), forecast_id, status, months)
        finally:
            db_manager.close_connection(conn)
        unit_list, issues = _business_unit_rows(roster, include_employees)
        data: Dict[str, Any] = {
            "business_units": unit_list,
            "total_annual_cost": _round(sum(emp["cost"]["total_cost"] for emp in roster["employees"])),
            "allocation_issues": issues,
            "scope": roster["scope"],
        }
        if roster["window"]:
            data["window"] = _window_summary(roster["window"])
        return ForecastResponse(
            status="success",
            data=data,
            message=f"Retrieved analytics for {len(unit_list)} business units"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving business unit analytics: {str(e)}")


@router.put("/employees/{employee_id}/allocations", response_model=ForecastResponse)
async def update_employee_allocations(employee_id: str, allocations: Dict[str, float]):
    """
    Update business unit allocations for an employee: percent summing to 100
    (fractions summing to 1 are converted).
    """
    try:
        clean = _validated_allocations(allocations)
        total_allocation = sum(clean.values())
        if abs(total_allocation - 100) > 0.01:
            raise HTTPException(
                status_code=400,
                detail=f"Allocations must sum to 100%, got {total_allocation:g}%"
            )
        conn = db_manager.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT employee_id FROM payroll WHERE employee_id = ?", (employee_id,))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail=f"Employee '{employee_id}' not found")
            cursor.execute("UPDATE payroll SET allocations = ? WHERE employee_id = ?", (json.dumps(clean), employee_id))
            conn.commit()
        finally:
            db_manager.close_connection(conn)

        return ForecastResponse(
            status="success",
            data={"employee_id": employee_id, "allocations": clean},
            message="Employee allocations updated successfully"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating employee allocations: {str(e)}")


# ========================
# Bulk Operations
# ========================

@router.post("/bulk-update", response_model=ForecastResponse)
async def bulk_update_employees(updates: List[Dict[str, Any]]):
    """
    Bulk update multiple employees: each item is {employee_id, <field>: value, ...}
    with fields from the payroll employee columns. A field that fails
    validation is reported per item in `errors`. A batch that touches an
    employee of an approved and locked scenario (or moves one into it) is
    refused as a whole with 409 and nothing is written, like every other
    write to a locked scenario: the body is {detail, code: SCENARIO_LOCKED,
    forecast_id} and the change history files the refusal under that
    scenario.
    """
    try:
        conn = db_manager.get_connection()
        updated_count = 0
        errors = []
        try:
            cursor = conn.cursor()
            refusal = _refuse_locked_employee_updates(cursor, updates)
            if refusal is not None:
                return refusal
            for update in updates:
                employee_id = update.get("employee_id") if isinstance(update, dict) else None
                try:
                    if not employee_id:
                        errors.append("Missing employee_id in update")
                        continue
                    unknown = [f for f in update if f != "employee_id" and f not in EMPLOYEE_COLUMNS]
                    if unknown:
                        errors.append(f"Error updating {employee_id}: unknown field(s) {', '.join(map(str, unknown))}")
                        continue
                    fields = {k: v for k, v in update.items() if k != "employee_id"}
                    if "rate_type" in fields and fields["rate_type"] not in RATE_TYPES:
                        errors.append(f"Error updating {employee_id}: rate_type must be 'hourly' or 'salary'")
                        continue
                    _check_amounts(fields.get("weekly_hours"), fields.get("hourly_rate"))
                    if {"start_date", "end_date", "next_review_date"} & set(fields):
                        cursor.execute("SELECT start_date, end_date FROM payroll WHERE employee_id = ?", (employee_id,))
                        stored = cursor.fetchone() or (None, None)
                        _check_employee_fields(None, fields.get("start_date", stored[0]),
                                               fields.get("end_date", stored[1]), fields.get("next_review_date"))
                    if "labor_class" in fields:
                        fields["labor_class"] = _labor_class(fields["labor_class"])
                    if "allocations" in fields:
                        fields["allocations"] = json.dumps(_validated_allocations(fields["allocations"] or {}))
                    if not fields:
                        continue
                    set_clause = ", ".join(f"{field} = ?" for field in fields)
                    cursor.execute(f"UPDATE payroll SET {set_clause} WHERE employee_id = ?",
                                   [*fields.values(), employee_id])
                    if cursor.rowcount:
                        updated_count += 1
                    else:
                        errors.append(f"Error updating {employee_id}: employee not found")
                except HTTPException as e:
                    errors.append(f"Error updating {employee_id}: {e.detail}")
                except Exception as e:
                    if is_lock_error(e):
                        # A lock the pre-check could not see: refuse the whole batch, write nothing.
                        conn.rollback()
                        forecast_id, name = _locked_scenario_of(cursor, employee_id, update.get("forecast_id"))
                        return _locked_employees_response(forecast_id, name, [employee_id])
                    errors.append(f"Error updating {employee_id}: {str(e)}")
            conn.commit()
        finally:
            db_manager.close_connection(conn)

        return ForecastResponse(
            status="success",
            data={"updated_count": updated_count, "errors": errors},
            message=f"Bulk updated {updated_count} employees"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error in bulk update: {str(e)}")


def _locked_employees_response(forecast_id: Optional[str], name: Optional[str],
                               employee_ids: List[Any]) -> JSONResponse:
    """
    The 409 for a bulk update refused by a scenario lock, in the shape of
    every other lock refusal: {detail, code: SCENARIO_LOCKED, forecast_id}
    (the change history files it under that scenario).
    """
    who = ", ".join(str(e) for e in employee_ids)
    detail = (f"{locked_message(name)} (Updating employee{'s' if len(employee_ids) != 1 else ''} {who} refused; "
              f"nothing was changed.)")
    return JSONResponse(status_code=409, content={"detail": detail, "code": LOCK_TOKEN, "forecast_id": forecast_id})


def _locked_scenario_of(cursor, employee_id: Any, target: Any = None) -> Tuple[Optional[str], Optional[str]]:
    """(forecast_id, name) of the locked scenario an employee update hit: the employee's own, else the one the
    update moves it into; (None, None) when neither is locked."""
    cursor.execute("SELECT forecast_id FROM payroll WHERE employee_id = ?", (employee_id,))
    row = cursor.fetchone()
    for forecast_id in ((row[0] if row else None), target):
        if forecast_id in (None, ""):
            continue
        cursor.execute("SELECT forecast_id, name FROM forecast WHERE forecast_id = ? AND locked = 1", (forecast_id,))
        found = cursor.fetchone()
        if found:
            return found[0], found[1]
    return None, None


def _refuse_locked_employee_updates(cursor, updates: List[Any]) -> Optional[JSONResponse]:
    """
    The 409 (nothing written) when a bulk update touches an employee of an
    approved and locked scenario, or moves an employee into one, with the
    same readable message and body ({detail, code, forecast_id}) as the
    other lock refusals; None when no locked scenario is touched.
    """
    ids = [u.get("employee_id") for u in updates if isinstance(u, dict) and u.get("employee_id")]
    targets = [u.get("forecast_id") for u in updates if isinstance(u, dict) and u.get("forecast_id")]
    locked: Dict[str, List[str]] = {}
    names: Dict[str, str] = {}
    if ids:
        cursor.execute(f"""
            SELECT p.employee_id, f.forecast_id, f.name FROM payroll p
            JOIN forecast f ON f.forecast_id = p.forecast_id
            WHERE f.locked = 1 AND p.employee_id IN ({",".join("?" for _ in ids)})
        """, ids)
        for employee_id, forecast_id, name in cursor.fetchall():
            locked.setdefault(forecast_id, []).append(employee_id)
            names[forecast_id] = name
    if targets:
        cursor.execute(f"SELECT forecast_id, name FROM forecast WHERE locked = 1 AND forecast_id IN "
                       f"({','.join('?' for _ in targets)})", targets)
        for forecast_id, name in cursor.fetchall():
            names[forecast_id] = name
            bucket = locked.setdefault(forecast_id, [])
            for u in updates:
                if isinstance(u, dict) and u.get("forecast_id") == forecast_id and u.get("employee_id") \
                        and u["employee_id"] not in bucket:
                    bucket.append(u["employee_id"])
    if not locked:
        return None
    forecast_id = sorted(locked)[0]
    return _locked_employees_response(forecast_id, names.get(forecast_id), locked[forecast_id])


# ========================
# Reporting
# ========================

@router.get("/reports/summary", response_model=ForecastResponse)
async def get_payroll_summary(
    forecast_id: Optional[str] = _scope_param(),
    start_period: Optional[str] = _start_param(),
    end_period: Optional[str] = _end_param(),
    include_employees: bool = _employees_param(),
):
    """
    Payroll summary for active employees: headcount, annual employer cost
    (gross + employer taxes + benefits; withholding shown separately), per
    pay run and per month, by department and business unit, and the next
    pay run. With start/end_period, window.total_cost is the statements'
    payroll for that window.
    """
    try:
        months = _window(start_period, end_period)
        conn = db_manager.get_connection()
        try:
            cursor = conn.cursor()
            roster = _roster(cursor, forecast_id, "active", months)
            scope_ids = [roster["scope"]["forecast_id"]] if roster["scope"]["forecast_id"] else []
            next_run = _pay_run_forecast(cursor, scope_ids, roster["config"], 1, date.today(), True, False)
        finally:
            db_manager.close_connection(conn)

        employees = roster["employees"]
        config = roster["config"]
        departments = _department_rows(roster, include_employees)
        business_units, issues = _business_unit_rows(roster, include_employees)
        totals = {k: sum(emp["cost"][k] for emp in employees)
                  for k in ("gross_pay", "employer_taxes", "benefits", "total_cost", "withholding", "net_pay")}
        labor_classes = {c: {"label": LABOR_CLASS_LABELS[c], "employee_count": 0, "total_annual_cost": 0.0}
                         for c in LABOR_CLASS_KEYS}
        for emp in employees:
            bucket = labor_classes[emp.get("labor_class") or "unclassified"]
            bucket["employee_count"] += 1
            bucket["total_annual_cost"] += emp["cost"]["total_cost"]
        for bucket in labor_classes.values():
            bucket["total_annual_cost"] = _round(bucket["total_annual_cost"])
        total_employees = len(employees)
        total_annual_cost = totals["total_cost"]
        runs = runs_per_year(config)
        current_period = next_run[0] if next_run else {}

        summary = {
            "total_employees": total_employees,
            "total_annual_cost": _round(total_annual_cost),
            "avg_employee_cost": _round(total_annual_cost / total_employees) if total_employees else 0,
            "current_period_cost": current_period.get("total_cost", 0),
            "department_count": len(departments),
            "departments": departments,
            "business_units": business_units,
            "top_department": max(departments, key=lambda x: x["total_annual_cost"])["department"] if departments else None,
            "top_business_unit": max(business_units, key=lambda x: x["total_annual_cost"])["business_unit"] if business_units else None,
            "total_annual_gross": _round(totals["gross_pay"]),
            "total_employer_taxes": _round(totals["employer_taxes"]),
            "total_benefits": _round(totals["benefits"]),
            "total_withholding": _round(totals["withholding"]),
            "total_net_pay": _round(totals["net_pay"]),
            "monthly_cost": _round(total_annual_cost / 12),
            "per_run_cost": _round(total_annual_cost / runs),
            "pay_frequency": config.get("pay_frequency"),
            "runs_per_year": runs,
            "next_pay_date": current_period.get("date"),
            "avg_hourly_rate": _round(sum(emp["cost"]["hourly_equivalent"] for emp in employees) / total_employees)
            if total_employees else 0,
            "allocation_issues": issues,
            "labor_classes": labor_classes,
            "scope": roster["scope"],
            "basis": "annual employer cost at current rates for active employees (planned hires included); "
                     + WITHHOLDING_NOTE,
        }
        if roster["window"]:
            summary["window"] = _window_summary(roster["window"])

        return ForecastResponse(
            status="success",
            data={"summary": summary},
            message="Payroll summary report generated successfully"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating payroll summary: {str(e)}")
