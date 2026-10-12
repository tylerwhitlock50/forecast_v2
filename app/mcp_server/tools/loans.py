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
    loan_term_months: Annotated[int, Field(gt=0, description=(
        "Whole months to maturity; a multiple of 3 for quarterly and of 12 for annual payments"))],
    start_date: Annotated[str, Field(description="YYYY-MM-DD origination date; proceeds land in that month")],
    payment_type: Annotated[str, Field(description=(
        "amortizing, or interest_only (interest each period; the principal is repaid on balloon_date, or with the "
        "last installment at maturity when there is none)"))] = "amortizing",
    payment_frequency: Annotated[str, Field(description="monthly, quarterly or annually")] = "monthly",
    balloon_payment: Annotated[Optional[float], Field(description=(
        "Optional, at most principal_amount. Amortizing: the level installments are sized to leave this amount "
        "owing, repaid with the balloon installment (balloon_date, or the last installment at maturity). "
        "Interest-only: informational; the balloon repays the whole balance owed"))] = None,
    balloon_date: Annotated[Optional[str], Field(description=(
        "Optional YYYY-MM-DD, after start_date and on or before maturity (start_date + loan_term_months). The "
        "first installment on or after it repays the whole balance still owed (amortizing or interest_only); "
        "e.g. a 20-year amortization (loan_term_months 240) with a 5-year balloon"))] = None,
    description: Optional[str] = None,
) -> Dict[str, Any]:
    """Add a loan and generate its amortization schedule on calendar months
    (installment n due n payment periods after start_date). Proceeds,
    interest and principal flow into the cash flow statement and balance
    sheet. The last installment always clears the balance: amortizing loans
    pay level installments, with balloon_date the installment on or after it
    repays the rest; interest_only loans repay the principal on balloon_date
    or, without one, at maturity. Refused when the term is not whole payment
    periods, balloon_date is not after start_date and on or before maturity,
    or balloon_payment exceeds the principal. Returns loan_id,
    payments_generated and warnings."""
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


#: Schedule rows shown per list in an update / repair preview (the counts and
#: before / after totals always cover every row).
PREVIEW_ROWS = 6


def _compact_preview(body: Dict[str, Any], include_rows: bool) -> Dict[str, Any]:
    """Keep the counts and before / after totals; list rows as {columns, rows}
    tables, trimmed to the first and last few unless include_rows."""
    for key in ("kept_rows", "removed_rows", "new_rows"):
        rows = body.get(key)
        if not isinstance(rows, list):
            continue
        body[f"{key[:-5]}_count"] = len(rows)
        if not include_rows and len(rows) > PREVIEW_ROWS:
            head = rows[:PREVIEW_ROWS - 1]
            body[key] = as_table(head + rows[-1:])
            body[key]["omitted"] = len(rows) - PREVIEW_ROWS
            body[key]["note"] = f"first {PREVIEW_ROWS - 1} and the last row shown; include_rows=true lists all"
        else:
            body[key] = as_table(rows)
    redated = body.get("redated_rows")
    if isinstance(redated, list) and not include_rows and len(redated) > PREVIEW_ROWS:
        body["redated_rows"] = redated[:PREVIEW_ROWS]
        body["redated_rows_omitted"] = len(redated) - PREVIEW_ROWS
    return body


@mcp.tool(name="forecast_update_loan", annotations=UPSERT)
async def update_loan(
    loan_id: str,
    updates: Annotated[Dict[str, Any], Field(description=f"Fields to change; any of {', '.join(LOAN_FIELDS)}")],
    preview: Annotated[bool, Field(description=(
        "true: return what would change (changed fields, schedule kept / removed / added rows, total interest "
        "and payoff date before / after) without saving. Preview first when changing loan terms."))] = False,
    include_rows: Annotated[bool, Field(description="List every kept / removed / new schedule row instead of a sample")] = False,
) -> Dict[str, Any]:
    """Update a loan. Only fields whose value really changes count (5 == 5.0;
    re-sending current values changes nothing). The payment schedule is
    rebuilt only when a schedule field changes (principal_amount,
    interest_rate, loan_term_months, start_date, payment_type,
    payment_frequency, balloon_payment, balloon_date), and never touches
    history: paid / skipped installments and any with an actual date,
    actual amount or note are kept exactly; only the installments after
    the last of them are replaced (re-amortised from the principal less
    what the kept installments repaid, over the months left to maturity, on
    calendar months). After recorded
    payments: a payment_frequency change continues one new period after the
    last kept payment; a principal_amount change adds the difference to the
    balance still owed (refused if the new principal is less than what is
    already repaid); a start_date after the recorded payments is refused.
    The same term / balloon rules as forecast_create_loan apply to the
    loan with the changes applied. Returns schedule {regenerated, kept_paid,
    kept, removed, added}, before / after {total_interest, payoff_date (null
    while money is still owed after the last installment),
    last_payment_date, final_balance, ...}, warnings and samples of the
    rows."""
    unknown = [k for k in updates if k not in LOAN_FIELDS]
    if unknown:
        raise ToolError(f"Unknown loan fields: {', '.join(unknown)}. Allowed: {', '.join(LOAN_FIELDS)}")
    if not updates:
        raise ToolError("updates must contain at least one field")
    body = await call("PUT", f"/loans/{quote(require(loan_id, 'loan_id'), safe='')}", json=updates,
                      params={"preview": preview})
    return _compact_preview(body, include_rows)


@mcp.tool(name="forecast_loan_schedule_audit", annotations=READ)
async def loan_schedule_audit() -> Dict[str, Any]:
    """Legacy schedule check (read-only): loans whose unpaid installments are
    not on calendar-month dates (schedules saved before the date fix used
    30.44-day steps, e.g. Jan 31 / Mar 2 / Apr 2, which can put a payment in
    the wrong month on the cash flow), have missing / out-of-order dates,
    broken balances, stop before the end of the term, or have no schedule.
    Per loan: counts (drifted, wrong_month, missing_dates, out_of_order),
    issues, up to 3 examples, statement_impact, proposed_action
    ('redate' | 'regenerate') and a plain summary. Paid history is never
    flagged for change. Fix with forecast_repair_loan_schedule (dry run first)."""
    return await call("GET", "/loans/schedule-audit")


@mcp.tool(name="forecast_repair_loan_schedule", annotations=UPSERT)
async def repair_loan_schedule(
    loan_id: str,
    dry_run: Annotated[bool, Field(description=(
        "true (default): preview only. Show the user the preview, then call again with dry_run=false to save."))] = True,
    include_rows: Annotated[bool, Field(description="List every kept / removed / new schedule row instead of a sample")] = False,
) -> Dict[str, Any]:
    """Put one loan's legacy schedule back on calendar months. Paid /
    recorded installments are kept exactly. The unpaid installments after
    them are re-dated (amounts unchanged) when only dates are off, or rebuilt
    from the principal less what the kept installments repaid when the
    schedule is incomplete or inconsistent (also when it repays a different
    amount than the principal leaves owed). Returns action ('none' | 'redate' | 'regenerate'),
    schedule counts, redated_rows [{payment_number, from_date, to_date}],
    before / after totals and payoff date. Run with dry_run=true first."""
    body = await call("POST", f"/loans/{quote(require(loan_id, 'loan_id'), safe='')}/repair-schedule",
                      json={"dry_run": dry_run})
    return _compact_preview(body, include_rows)


@mcp.tool(name="forecast_delete_loan", annotations=DESTRUCTIVE)
async def delete_loan(loan_id: str) -> Dict[str, Any]:
    """Delete a loan and its whole schedule, paid history included (cannot be
    undone). To retire a paid-off loan and keep its history, update it with
    is_active=false instead."""
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
    """Debt service per month over a window (every month listed): principal,
    interest, total payment and loan proceeds, by loan and in total, from the
    saved schedules of active loans. remaining_balance is the debt owed at
    the end of each month and equals the balance sheet's debt line."""
    return await call("GET", "/loans/cash-flow", params={"start_period": start_period, "end_period": end_period})
