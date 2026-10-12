"""Operating expense tools: categories, expenses and the expense forecast."""
from __future__ import annotations

from typing import Annotated, Any, Dict, Optional

from pydantic import Field
from mcp.server.mcpserver.exceptions import ToolError

from mcp_server.core import DESTRUCTIVE, READ, UPSERT, WRITE, call, mcp, require, strip_none

FREQUENCIES = ("monthly", "quarterly", "biannually", "annually", "one_time", "weekly")
CATEGORY_TYPES = ("factory_overhead", "admin_expense", "cogs")
EXPENSE_FIELDS = (
    "expense_name", "category_id", "amount", "frequency", "start_date", "end_date", "vendor", "description",
    "payment_method", "approval_required", "approved_by", "approval_date", "expense_allocation",
    "amortization_months", "department", "cost_center", "is_active", "forecast_id",
)


@mcp.tool(name="forecast_list_expense_categories", annotations=READ)
async def list_expense_categories(
    category_type: Annotated[Optional[str], Field(description="factory_overhead, admin_expense or cogs")] = None,
) -> Dict[str, Any]:
    """List expense categories. category_type decides where an expense lands
    on the income statement (factory overhead in COGS, admin below gross profit)."""
    return await call("GET", "/expenses/categories", params={"category_type": category_type})


@mcp.tool(name="forecast_create_expense_category", annotations=WRITE)
async def create_expense_category(
    category_name: str,
    category_type: Annotated[str, Field(description="factory_overhead, admin_expense or cogs")],
    parent_category_id: Optional[str] = None,
    account_code: Optional[str] = None,
    description: Optional[str] = None,
) -> Dict[str, Any]:
    """Create an expense category."""
    if category_type not in CATEGORY_TYPES:
        raise ToolError(f"category_type must be one of {', '.join(CATEGORY_TYPES)}")
    return await call("POST", "/expenses/categories", json=strip_none({
        "category_name": require(category_name, "category_name"), "category_type": category_type,
        "parent_category_id": parent_category_id, "account_code": account_code, "description": description,
    }))


@mcp.tool(name="forecast_list_expenses", annotations=READ)
async def list_expenses(
    forecast_id: Annotated[Optional[str], Field(description="Scenario; company-wide (NULL) expenses are always included")] = None,
    category_id: Optional[str] = None,
    frequency: Optional[str] = None,
    is_active: Optional[bool] = None,
    department: Optional[str] = None,
    vendor: Optional[str] = None,
    limit: Annotated[int, Field(description="Expenses per page", ge=1, le=2000)] = 50,
    offset: Annotated[int, Field(ge=0)] = 0,
) -> Dict[str, Any]:
    """List operating expenses with category, frequency, dates, next payment
    and annual cost. Paged: total_count covers every matching expense; for
    totals by category use forecast_expense_summary."""
    body = await call("GET", "/expenses/", params={
        "forecast_id": forecast_id, "category_id": category_id, "frequency": frequency,
        "is_active": is_active, "department": department, "vendor": vendor,
    })
    expenses = body.get("expenses")
    if isinstance(expenses, list):
        body["expenses"] = expenses[offset:offset + limit]
        body["total_count"] = len(expenses)
        more = offset + len(body["expenses"]) < len(expenses)
        body["next_offset"] = offset + len(body["expenses"]) if more else None
    return body


@mcp.tool(name="forecast_create_expense", annotations=WRITE)
async def create_expense(
    expense_name: str,
    category_id: Annotated[str, Field(description="From forecast_list_expense_categories")],
    amount: Annotated[float, Field(description="Amount per occurrence", ge=0)],
    frequency: Annotated[str, Field(description=", ".join(FREQUENCIES))],
    start_date: Annotated[str, Field(description="YYYY-MM-DD of the first occurrence")],
    end_date: Annotated[Optional[str], Field(description="YYYY-MM-DD of the last occurrence; omit for open-ended")] = None,
    vendor: Optional[str] = None,
    description: Optional[str] = None,
    department: Optional[str] = None,
    cost_center: Optional[str] = None,
    expense_allocation: Annotated[str, Field(description="immediate (expense when paid) or amortized over amortization_months")] = "immediate",
    amortization_months: Optional[int] = None,
    forecast_id: Annotated[Optional[str], Field(description="Scenario; omit for a company-wide expense")] = None,
) -> Dict[str, Any]:
    """Create an operating expense; its per-period allocations are generated
    from frequency, start_date and end_date."""
    if frequency not in FREQUENCIES:
        raise ToolError(f"frequency must be one of {', '.join(FREQUENCIES)}")
    if expense_allocation not in ("immediate", "amortized"):
        raise ToolError("expense_allocation must be immediate or amortized")
    return await call("POST", "/expenses/", json=strip_none({
        "expense_name": require(expense_name, "expense_name"), "category_id": category_id, "amount": amount,
        "frequency": frequency, "start_date": start_date, "end_date": end_date, "vendor": vendor,
        "description": description, "department": department, "cost_center": cost_center,
        "expense_allocation": expense_allocation, "amortization_months": amortization_months,
        "forecast_id": forecast_id,
    }))


@mcp.tool(name="forecast_update_expense", annotations=UPSERT)
async def update_expense(
    expense_id: str,
    updates: Annotated[Dict[str, Any], Field(description=f"Fields to change; any of {', '.join(EXPENSE_FIELDS)}")],
) -> Dict[str, Any]:
    """Update an expense (amount, frequency, dates, category, scenario, active
    flag, ...). Allocations are regenerated when the schedule changes."""
    unknown = [k for k in updates if k not in EXPENSE_FIELDS]
    if unknown:
        raise ToolError(f"Unknown expense fields: {', '.join(unknown)}. Allowed: {', '.join(EXPENSE_FIELDS)}")
    if not updates:
        raise ToolError("updates must contain at least one field")
    return await call("PUT", f"/expenses/{require(expense_id, 'expense_id')}", json=updates)


@mcp.tool(name="forecast_delete_expense", annotations=DESTRUCTIVE)
async def delete_expense(expense_id: str) -> Dict[str, Any]:
    """Delete an expense and its allocations. To stop it from a date instead,
    set end_date with forecast_update_expense."""
    return await call("DELETE", f"/expenses/{require(expense_id, 'expense_id')}")


@mcp.tool(name="forecast_expense_forecast", annotations=READ)
async def expense_forecast(
    start_period: Annotated[str, Field(description="YYYY-MM")],
    end_period: Annotated[str, Field(description="YYYY-MM")],
    forecast_id: Optional[str] = None,
    category_type: Annotated[Optional[str], Field(description="factory_overhead, admin_expense or cogs")] = None,
) -> Dict[str, Any]:
    """Expense totals per period and category over a window."""
    return await call("GET", "/expenses/forecast", params={
        "start_period": start_period, "end_period": end_period,
        "forecast_id": forecast_id, "category_type": category_type,
    })


@mcp.tool(name="forecast_expense_summary", annotations=READ)
async def expense_summary(forecast_id: Optional[str] = None) -> Dict[str, Any]:
    """Expense totals by frequency and category type, upcoming and overdue
    payments, and top categories."""
    return await call("GET", "/expenses/summary", params={"forecast_id": forecast_id})
