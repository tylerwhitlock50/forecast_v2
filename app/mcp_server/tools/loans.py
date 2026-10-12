"""Loan tools: debt, amortization schedules and debt-service cash flow."""
from __future__ import annotations

from typing import Annotated, Any, Dict, Literal, Optional
from urllib.parse import quote

from pydantic import Field
from mcp.server.mcpserver.exceptions import ToolError

from mcp_server.core import DESTRUCTIVE, READ, UPSERT, WRITE, as_table, call, mcp, require, strip_none

LOAN_TYPES = ("term_loan", "line_of_credit", "sba_loan", "equipment_loan", "real_estate_loan")
LOAN_FIELDS = (
    "loan_name", "lender", "loan_type", "principal_amount", "interest_rate", "loan_term_months", "start_date",
    "payment_type", "payment_frequency", "balloon_payment", "balloon_date", "description",
    "collateral_description", "guarantor", "loan_officer", "account_number", "is_active",
)


@mcp.tool(name="forecast_list_loans", annotations=READ)
async def list_loans(
    active_only: Annotated[bool, Field(description="Hide inactive loans")] = True,
) -> Dict[str, Any]:
    """List loans with balance, payment amount, next payment and interest
    paid / remaining. Loans are company-wide (not scenario-scoped)."""
    return await call("GET", "/loans/", params={"active_only": active_only})


@mcp.tool(name="forecast_create_loan", annotations=WRITE)
async def create_loan(
    loan_name: str,
    lender: str,
    loan_type: Annotated[str, Field(description=", ".join(LOAN_TYPES))],
    principal_amount: Annotated[float, Field(gt=0)],
    interest_rate: Annotated[float, Field(description="Annual rate as a percentage, e.g. 7.5", ge=0)],
    loan_term_months: Annotated[int, Field(gt=0)],
    start_date: Annotated[str, Field(description="YYYY-MM-DD origination date; proceeds land in that month")],
    payment_type: Annotated[str, Field(description="amortizing or interest_only")] = "amortizing",
    payment_frequency: Annotated[str, Field(description="monthly, quarterly or annually")] = "monthly",
    balloon_payment: Optional[float] = None,
    balloon_date: Optional[str] = None,
    description: Optional[str] = None,
) -> Dict[str, Any]:
    """Add a loan and generate its amortization schedule. Proceeds, interest
    and principal flow into the cash flow statement and balance sheet."""
    if loan_type not in LOAN_TYPES:
        raise ToolError(f"loan_type must be one of {', '.join(LOAN_TYPES)}")
    if payment_type not in ("amortizing", "interest_only"):
        raise ToolError("payment_type must be amortizing or interest_only")
    if payment_frequency not in ("monthly", "quarterly", "annually"):
        raise ToolError("payment_frequency must be monthly, quarterly or annually")
    return await call("POST", "/loans/", json=strip_none({
        "loan_name": require(loan_name, "loan_name"), "lender": lender, "loan_type": loan_type,
        "principal_amount": principal_amount, "interest_rate": interest_rate, "loan_term_months": loan_term_months,
        "start_date": start_date, "payment_type": payment_type, "payment_frequency": payment_frequency,
        "balloon_payment": balloon_payment, "balloon_date": balloon_date, "description": description,
    }))


@mcp.tool(name="forecast_update_loan", annotations=UPSERT)
async def update_loan(
    loan_id: str,
    updates: Annotated[Dict[str, Any], Field(description=f"Fields to change; any of {', '.join(LOAN_FIELDS)}")],
) -> Dict[str, Any]:
    """Update a loan's terms (rate, principal, term, dates, active flag). The
    schedule is regenerated when terms change."""
    unknown = [k for k in updates if k not in LOAN_FIELDS]
    if unknown:
        raise ToolError(f"Unknown loan fields: {', '.join(unknown)}. Allowed: {', '.join(LOAN_FIELDS)}")
    if not updates:
        raise ToolError("updates must contain at least one field")
    return await call("PUT", f"/loans/{require(loan_id, 'loan_id')}", json=updates)


@mcp.tool(name="forecast_delete_loan", annotations=DESTRUCTIVE)
async def delete_loan(loan_id: str) -> Dict[str, Any]:
    """Delete a loan and its schedule."""
    return await call("DELETE", f"/loans/{require(loan_id, 'loan_id')}")


@mcp.tool(name="forecast_loan_schedule", annotations=READ)
async def loan_schedule(
    loan_id: str,
    start_period: Annotated[Optional[str], Field(description="Only payments from this month (YYYY-MM)")] = None,
    end_period: Annotated[Optional[str], Field(description="Only payments up to this month (YYYY-MM)")] = None,
    limit: Annotated[int, Field(description="Payments per page (totals cover the whole loan)", ge=1, le=1000)] = 120,
    offset: Annotated[int, Field(ge=0)] = 0,
    layout: Annotated[Literal["table", "records"], Field(description=(
        "table: payment_schedule is {columns, rows} (default, about half the size); records: one object per "
        "payment"))] = "table",
) -> Dict[str, Any]:
    """Amortization schedule for one loan: each payment's principal,
    interest and remaining balance, paged (a 30-year mortgage has 360
    payments; filter by start_period / end_period or page with offset).
    total_payments / total_interest and loan_summary cover the whole loan."""
    body = await call("GET", f"/loans/{quote(require(loan_id, 'loan_id'), safe='')}/schedule")
    payments = body.get("payment_schedule")
    if not isinstance(payments, list):
        return body
    if start_period or end_period:
        lo, hi = (start_period or "0000-00").strip(), (end_period or "9999-99").strip()
        payments = [p for p in payments if lo <= str(p.get("payment_date") or "")[:7] <= hi]
    chunk = payments[offset:offset + limit]
    more = offset + len(chunk) < len(payments)
    body["payment_schedule"] = as_table(chunk) if layout == "table" else chunk
    body.update({"payment_count": len(payments), "returned": len(chunk), "offset": offset,
                 "next_offset": offset + len(chunk) if more else None})
    return body


@mcp.tool(name="forecast_loan_summary", annotations=READ)
async def loan_summary() -> Dict[str, Any]:
    """Portfolio view: total principal, balances, monthly debt service,
    upcoming payments and the mix by loan type."""
    return await call("GET", "/loans/summary")


@mcp.tool(name="forecast_loan_cash_flow", annotations=READ)
async def loan_cash_flow(
    start_period: Annotated[str, Field(description="YYYY-MM")],
    end_period: Annotated[str, Field(description="YYYY-MM")],
) -> Dict[str, Any]:
    """Debt service (principal + interest) per period over a window."""
    return await call("GET", "/loans/cash-flow", params={"start_period": start_period, "end_period": end_period})
