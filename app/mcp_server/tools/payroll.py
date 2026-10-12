"""Payroll tools: employees, burden configuration and the payroll forecast."""
from __future__ import annotations

from typing import Annotated, Any, Dict, Optional, Tuple

from pydantic import Field
from mcp.server.mcpserver.exceptions import ToolError

from mcp_server.core import DESTRUCTIVE, READ, UPSERT, WRITE, call, mcp, require, strip_none

EMPLOYEE_FIELDS = (
    "employee_name", "department", "weekly_hours", "hourly_rate", "rate_type", "labor_type",
    "start_date", "end_date", "next_review_date", "expected_raise", "benefits_eligible",
    "allocations", "forecast_id",
)

RATE_HELP = ("Pay rate. rate_type 'hourly': the hourly wage (annual gross = rate x weekly_hours x 52). "
             "rate_type 'salary': the ANNUAL salary, e.g. 85000 (a salary value under 1,000 is read as an "
             "hourly equivalent and multiplied by 2,080 hours).")
ALLOCATION_HELP = ("Business-unit split in PERCENT summing to 100, e.g. {\"Manufacturing\": 70, \"Admin\": 30}. "
                   "Fractions that sum to 1 ({\"Manufacturing\": 0.7, ...}) are converted to percent.")
MAX_HOURLY_RATE = 500.0
SALARY_THRESHOLD = 1000.0


def _allocations(value: Optional[Dict[str, Any]]) -> Tuple[Optional[Dict[str, float]], Optional[str]]:
    """Validated allocations in percent, plus a note when fractions were converted."""
    if not value:
        return value, None
    clean: Dict[str, float] = {}
    for unit, pct in value.items():
        try:
            number = float(pct)
        except (TypeError, ValueError):
            raise ToolError(f"allocations['{unit}'] must be a number (percent), got {pct!r}")
        if number < 0:
            raise ToolError(f"allocations['{unit}'] cannot be negative")
        clean[str(unit)] = number
    total = sum(clean.values())
    if clean and all(v <= 1 for v in clean.values()) and 0.99 <= total <= 1.01:
        clean = {k: round(v * 100, 4) for k, v in clean.items()}
        return clean, "allocations were given as fractions and were converted to percent"
    if not 99 <= total <= 101:
        return clean, (f"allocations sum to {total:g}%, not 100%: the business-unit view will carry {total:g}% "
                       f"of this employee's cost")
    return clean, None


def _check_rate(rate_type: Optional[str], rate: Any) -> Optional[str]:
    """Reject an hourly rate that is obviously an annual salary; warn on a tiny salary."""
    if rate is None:
        return None
    try:
        value = float(rate)
    except (TypeError, ValueError):
        raise ToolError(f"hourly_rate must be a number, got {rate!r}")
    if (rate_type or "hourly") == "hourly" and value > MAX_HOURLY_RATE:
        raise ToolError(f"hourly_rate {value:g} with rate_type 'hourly' would be ${value:,.0f} per hour. For an "
                        f"annual salary set rate_type='salary' (hourly_rate is then the annual salary).")
    if rate_type == "salary" and 0 < value < SALARY_THRESHOLD:
        return (f"rate_type 'salary' with hourly_rate {value:g} is read as an hourly equivalent "
                f"(${value * 2080:,.0f} a year); give the annual salary if that is not intended")
    return None


@mcp.tool(name="forecast_list_employees", annotations=READ)
async def list_employees(
    forecast_id: Annotated[Optional[str], Field(description="Scenario; company-wide (NULL) employees are always included")] = None,
    department: Optional[str] = None,
    status: Annotated[Optional[str], Field(description="active or inactive")] = None,
    business_unit: Annotated[Optional[str], Field(description="Filter by business-unit allocation key")] = None,
) -> Dict[str, Any]:
    """List employees with pay, dates, raises and business-unit allocations
    (percent)."""
    return await call("GET", "/payroll/employees", params={
        "forecast_id": forecast_id, "department": department, "status": status, "business_unit": business_unit,
    })


@mcp.tool(name="forecast_get_employee", annotations=READ)
async def get_employee(employee_id: str) -> Dict[str, Any]:
    """Get one employee record."""
    return await call("GET", f"/payroll/employees/{require(employee_id, 'employee_id')}")


@mcp.tool(name="forecast_create_employee", annotations=WRITE)
async def create_employee(
    employee_name: str,
    department: str,
    weekly_hours: Annotated[int, Field(description="Scheduled hours per week (used for hourly pay)", ge=0)],
    hourly_rate: Annotated[float, Field(description=RATE_HELP, ge=0)],
    labor_type: Annotated[str, Field(description="Labor type / role label")],
    start_date: Annotated[str, Field(description="YYYY-MM-DD; payroll is prorated from this date")],
    rate_type: Annotated[str, Field(description="hourly or salary (see hourly_rate)")] = "hourly",
    end_date: Annotated[Optional[str], Field(description="YYYY-MM-DD; payroll stops after this date")] = None,
    next_review_date: Annotated[Optional[str], Field(description="YYYY-MM-DD when expected_raise applies")] = None,
    expected_raise: Annotated[float, Field(description="Raise as a fraction (0.03 = 3%) applied from next_review_date")] = 0.0,
    benefits_eligible: bool = True,
    allocations: Annotated[Optional[Dict[str, float]], Field(description=ALLOCATION_HELP)] = None,
    forecast_id: Annotated[Optional[str], Field(description="Scenario the hire belongs to; omit for company-wide")] = None,
) -> Dict[str, Any]:
    """Add an employee (a planned hire, when start_date is in the future).
    Payroll is prorated per calendar month from start_date to end_date and
    loaded with the EMPLOYER burden from the payroll config (social
    security, medicare, unemployment, workers comp, plus benefits when
    benefits_eligible); income-tax withholding is not an employer cost.
    Note: production staff whose time is already costed through the
    routings' labor minutes would be counted twice if also added here."""
    if rate_type not in ("hourly", "salary"):
        raise ToolError("rate_type must be hourly or salary")
    warning = _check_rate(rate_type, hourly_rate)
    allocations, note = _allocations(allocations)
    body = strip_none({
        "employee_name": require(employee_name, "employee_name"), "department": department,
        "weekly_hours": weekly_hours, "hourly_rate": hourly_rate, "rate_type": rate_type, "labor_type": labor_type,
        "start_date": start_date, "end_date": end_date, "next_review_date": next_review_date,
        "expected_raise": expected_raise, "benefits_eligible": benefits_eligible,
        "allocations": allocations, "forecast_id": forecast_id,
    })
    result = await call("POST", "/payroll/employees", json=body)
    notes = [n for n in (warning, note) if n]
    if notes:
        result["notes"] = notes
    return result


@mcp.tool(name="forecast_update_employee", annotations=UPSERT)
async def update_employee(
    employee_id: str,
    updates: Annotated[Dict[str, Any], Field(description=(
        f"Fields to change; any of {', '.join(EMPLOYEE_FIELDS)}. hourly_rate follows rate_type: an hourly wage, "
        f"or the annual salary for rate_type 'salary'. allocations are percent summing to 100."))],
) -> Dict[str, Any]:
    """Update an employee: pay, hours, dates, raise, allocations or scenario.
    Only the fields given change (e.g. {\"end_date\": \"2026-09-30\"} to plan
    a departure, {\"hourly_rate\": 32} for a raise now)."""
    employee_id = require(employee_id, "employee_id")
    unknown = [k for k in updates if k not in EMPLOYEE_FIELDS]
    if unknown:
        raise ToolError(f"Unknown employee fields: {', '.join(unknown)}. Allowed: {', '.join(EMPLOYEE_FIELDS)}")
    if not updates:
        raise ToolError("updates must contain at least one field")
    current = (await call("GET", f"/payroll/employees/{employee_id}")).get("employee") or {}
    merged = {k: current.get(k) for k in EMPLOYEE_FIELDS}
    merged.update(updates)
    if merged.get("benefits_eligible") is not None:
        merged["benefits_eligible"] = bool(merged["benefits_eligible"])
    if merged.get("expected_raise") is None:
        merged["expected_raise"] = 0.0
    if merged.get("rate_type") is None:
        merged["rate_type"] = "hourly"
    notes = []
    if "hourly_rate" in updates or "rate_type" in updates:
        warning = _check_rate(merged.get("rate_type"), merged.get("hourly_rate"))
        if warning:
            notes.append(warning)
    if "allocations" in updates:
        merged["allocations"], note = _allocations(updates.get("allocations"))
        if note:
            notes.append(note)
    result = await call("PUT", f"/payroll/employees/{employee_id}", json=merged)
    if notes:
        result["notes"] = notes
    return result


@mcp.tool(name="forecast_delete_employee", annotations=DESTRUCTIVE)
async def delete_employee(employee_id: str) -> Dict[str, Any]:
    """Remove an employee from the model. To plan a departure instead, set
    end_date with forecast_update_employee."""
    return await call("DELETE", f"/payroll/employees/{require(employee_id, 'employee_id')}")


@mcp.tool(name="forecast_get_payroll_config", annotations=READ)
async def get_payroll_config() -> Dict[str, Any]:
    """Payroll configuration: employer burden rates (social_security_rate,
    medicare_rate, unemployment_rate, workers_comp_rate, benefits_rate for
    benefits-eligible staff) that load every employee's gross pay, the pay
    frequency, and federal_tax_rate / state_tax_rate, which are income-tax
    WITHHOLDING from the employee's pay and are not added to payroll cost."""
    return await call("GET", "/payroll/config")


@mcp.tool(name="forecast_update_payroll_config", annotations=UPSERT)
async def update_payroll_config(
    federal_tax_rate: Annotated[Optional[float], Field(description="Federal income-tax withholding (employee side; not an employer cost, does not change payroll cost)", ge=0, le=1)] = None,
    state_tax_rate: Annotated[Optional[float], Field(description="State income-tax withholding (employee side; not an employer cost)", ge=0, le=1)] = None,
    social_security_rate: Annotated[Optional[float], Field(description="Employer social security, e.g. 0.062", ge=0, le=1)] = None,
    medicare_rate: Annotated[Optional[float], Field(description="Employer medicare, e.g. 0.0145", ge=0, le=1)] = None,
    unemployment_rate: Annotated[Optional[float], Field(description="Employer FUTA / SUTA as a fraction of gross", ge=0, le=1)] = None,
    benefits_rate: Annotated[Optional[float], Field(description="Benefits load as a fraction of gross for benefits-eligible staff", ge=0, le=5)] = None,
    workers_comp_rate: Annotated[Optional[float], Field(description="Workers comp as a fraction of gross", ge=0, le=1)] = None,
    pay_frequency: Annotated[Optional[str], Field(description="weekly, biweekly, semimonthly or monthly")] = None,
) -> Dict[str, Any]:
    """Change payroll burden rates or pay frequency. Rates are fractions
    (0.062 = 6.2%). Only the fields given change. Payroll cost = gross pay x
    (1 + social security + medicare + unemployment + workers comp [+
    benefits]); the federal / state rates are withholding and do not move
    the statements."""
    updates = strip_none({
        "federal_tax_rate": federal_tax_rate, "state_tax_rate": state_tax_rate,
        "social_security_rate": social_security_rate, "medicare_rate": medicare_rate,
        "unemployment_rate": unemployment_rate, "benefits_rate": benefits_rate,
        "workers_comp_rate": workers_comp_rate, "pay_frequency": pay_frequency,
    })
    if not updates:
        raise ToolError("Give at least one rate or pay_frequency to change")
    if pay_frequency and pay_frequency not in ("weekly", "biweekly", "semimonthly", "monthly"):
        raise ToolError("pay_frequency must be weekly, biweekly, semimonthly or monthly")
    current = (await call("GET", "/payroll/config")).get("config") or {}
    merged = {k: v for k, v in current.items() if k in (
        "federal_tax_rate", "state_tax_rate", "social_security_rate", "medicare_rate",
        "unemployment_rate", "benefits_rate", "workers_comp_rate", "pay_frequency")}
    merged.update(updates)
    return await call("POST", "/payroll/config", json=merged)


@mcp.tool(name="forecast_payroll_forecast", annotations=READ)
async def payroll_forecast(
    forecast_id: Annotated[Optional[str], Field(description="Scenario (company-wide employees are always included); omit for the base scenario")] = None,
    start_period: Annotated[Optional[str], Field(description="YYYY-MM; with end_period gives the monthly view used by the statements")] = None,
    end_period: Annotated[Optional[str], Field(description="YYYY-MM")] = None,
    include_raises: bool = True,
    periods: Annotated[int, Field(description="Pay-run mode only: number of pay periods to project when no month window is given", ge=1, le=260)] = 26,
    start_date: Annotated[Optional[str], Field(description="Pay-run mode only: first pay date on/after this YYYY-MM-DD (default today)")] = None,
    include_employees: Annotated[bool, Field(description="Per-employee rows on every run / month (large); default totals only")] = False,
) -> Dict[str, Any]:
    """Payroll cost projection. With a start / end month it returns the
    monthly, prorated, employer-burdened payroll by department and business
    unit (the same numbers the statements use); without one it projects the
    next N pay runs. Defaults to the base scenario and totals only."""
    return await call("GET", "/payroll/forecast", params={
        "forecast_id": forecast_id, "start_period": start_period, "end_period": end_period,
        "include_raises": include_raises, "periods": periods, "start_date": start_date,
        "include_employees": include_employees,
    })


@mcp.tool(name="forecast_payroll_summary", annotations=READ)
async def payroll_summary(
    forecast_id: Annotated[Optional[str], Field(description="Scenario (company-wide employees are always included); omit for the base scenario")] = None,
    start_period: Annotated[Optional[str], Field(description="YYYY-MM; with end_period adds the statements' payroll for that window")] = None,
    end_period: Annotated[Optional[str], Field(description="YYYY-MM")] = None,
    include_employees: Annotated[bool, Field(description="Per-employee rows (large); default totals only")] = False,
) -> Dict[str, Any]:
    """Headcount and annual employer payroll cost by department and business
    unit (gross + employer taxes + benefits; withholding shown separately)."""
    return await call("GET", "/payroll/reports/summary", params={
        "forecast_id": forecast_id, "start_period": start_period, "end_period": end_period,
        "include_employees": include_employees,
    })
