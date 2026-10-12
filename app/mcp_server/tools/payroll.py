"""Payroll tools: employees, burden configuration and the payroll forecast."""
from __future__ import annotations

from typing import Annotated, Any, Dict, List, Optional

from pydantic import Field
from mcp.server.mcpserver.exceptions import ToolError

from mcp_server.core import DESTRUCTIVE, READ, UPSERT, WRITE, call, mcp, require, strip_none

EMPLOYEE_FIELDS = (
    "employee_name", "department", "weekly_hours", "hourly_rate", "rate_type", "labor_type",
    "start_date", "end_date", "next_review_date", "expected_raise", "benefits_eligible",
    "allocations", "forecast_id",
)


@mcp.tool(name="forecast_list_employees", annotations=READ)
async def list_employees(
    forecast_id: Annotated[Optional[str], Field(description="Scenario; company-wide (NULL) employees are always included")] = None,
    department: Optional[str] = None,
    status: Annotated[Optional[str], Field(description="active or inactive")] = None,
    business_unit: Annotated[Optional[str], Field(description="Filter by business-unit allocation key")] = None,
) -> Dict[str, Any]:
    """List employees with pay, dates, raises and business-unit allocations."""
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
    weekly_hours: Annotated[int, Field(description="Scheduled hours per week", ge=0)],
    hourly_rate: Annotated[float, Field(description="Hourly rate, or annual salary when rate_type is 'salary'", ge=0)],
    labor_type: Annotated[str, Field(description="Labor type / role label")],
    start_date: Annotated[str, Field(description="YYYY-MM-DD; payroll is prorated from this date")],
    rate_type: Annotated[str, Field(description="hourly or salary")] = "hourly",
    end_date: Annotated[Optional[str], Field(description="YYYY-MM-DD; payroll stops after this date")] = None,
    next_review_date: Annotated[Optional[str], Field(description="YYYY-MM-DD when expected_raise applies")] = None,
    expected_raise: Annotated[float, Field(description="Raise as a fraction (0.03 = 3%) applied from next_review_date")] = 0.0,
    benefits_eligible: bool = True,
    allocations: Annotated[Optional[Dict[str, float]], Field(description="Business-unit allocation fractions, e.g. {\"Manufacturing\": 0.7, \"Admin\": 0.3}")] = None,
    forecast_id: Annotated[Optional[str], Field(description="Scenario the hire belongs to; omit for company-wide")] = None,
) -> Dict[str, Any]:
    """Add an employee (a planned hire, when start_date is in the future).
    Payroll is prorated per calendar month from start_date to end_date and
    burdened with the payroll config rates."""
    if rate_type not in ("hourly", "salary"):
        raise ToolError("rate_type must be hourly or salary")
    body = strip_none({
        "employee_name": require(employee_name, "employee_name"), "department": department,
        "weekly_hours": weekly_hours, "hourly_rate": hourly_rate, "rate_type": rate_type, "labor_type": labor_type,
        "start_date": start_date, "end_date": end_date, "next_review_date": next_review_date,
        "expected_raise": expected_raise, "benefits_eligible": benefits_eligible,
        "allocations": allocations, "forecast_id": forecast_id,
    })
    return await call("POST", "/payroll/employees", json=body)


@mcp.tool(name="forecast_update_employee", annotations=UPSERT)
async def update_employee(
    employee_id: str,
    updates: Annotated[Dict[str, Any], Field(description=f"Fields to change; any of {', '.join(EMPLOYEE_FIELDS)}")],
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
    merged.setdefault("expected_raise", 0.0)
    if merged.get("expected_raise") is None:
        merged["expected_raise"] = 0.0
    if merged.get("rate_type") is None:
        merged["rate_type"] = "hourly"
    return await call("PUT", f"/payroll/employees/{employee_id}", json=merged)


@mcp.tool(name="forecast_delete_employee", annotations=DESTRUCTIVE)
async def delete_employee(employee_id: str) -> Dict[str, Any]:
    """Remove an employee from the model. To plan a departure instead, set
    end_date with forecast_update_employee."""
    return await call("DELETE", f"/payroll/employees/{require(employee_id, 'employee_id')}")


@mcp.tool(name="forecast_get_payroll_config", annotations=READ)
async def get_payroll_config() -> Dict[str, Any]:
    """Payroll burden rates (employer taxes, benefits, workers comp) and pay
    frequency used to load every employee's gross pay."""
    return await call("GET", "/payroll/config")


@mcp.tool(name="forecast_update_payroll_config", annotations=UPSERT)
async def update_payroll_config(
    federal_tax_rate: Optional[float] = None,
    state_tax_rate: Optional[float] = None,
    social_security_rate: Optional[float] = None,
    medicare_rate: Optional[float] = None,
    unemployment_rate: Optional[float] = None,
    benefits_rate: Annotated[Optional[float], Field(description="Benefits load as a fraction of gross for benefits-eligible staff")] = None,
    workers_comp_rate: Optional[float] = None,
    pay_frequency: Annotated[Optional[str], Field(description="weekly, biweekly, semimonthly or monthly")] = None,
) -> Dict[str, Any]:
    """Change payroll burden rates or pay frequency. Rates are fractions
    (0.062 = 6.2%). Only the fields given change."""
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
    forecast_id: Annotated[Optional[str], Field(description="Scenario; company-wide employees are always included")] = None,
    start_period: Annotated[Optional[str], Field(description="YYYY-MM; with end_period gives the monthly view used by the statements")] = None,
    end_period: Annotated[Optional[str], Field(description="YYYY-MM")] = None,
    include_raises: bool = True,
    periods: Annotated[int, Field(description="Pay-run mode only: number of pay periods to project when no month window is given", ge=1, le=260)] = 26,
) -> Dict[str, Any]:
    """Payroll cost projection. With a start / end month it returns the
    monthly, prorated, burdened payroll by department and business unit
    (the same numbers the statements use); without one it projects the next
    N pay runs."""
    return await call("GET", "/payroll/forecast", params={
        "forecast_id": forecast_id, "start_period": start_period, "end_period": end_period,
        "include_raises": include_raises, "periods": periods,
    })


@mcp.tool(name="forecast_payroll_summary", annotations=READ)
async def payroll_summary() -> Dict[str, Any]:
    """Headcount and annual payroll cost by department and business unit."""
    return await call("GET", "/payroll/reports/summary")
