"""
Loan Management API Routes
Provides comprehensive loan management, amortization schedule calculation, and cash flow forecasting

Payment history is never rewritten. A schedule row is HISTORY when its
status is 'paid' or 'skipped', or when it carries an actual payment date,
an actual amount or a note. Changing a loan's terms rebuilds only the
installments after the last history row; legacy schedules (saved with
30.44-day dates before the calendar-month fix) are listed by
`GET /loans/schedule-audit` and repaired only on request with
`POST /loans/{loan_id}/repair-schedule` (dry run by default).
"""

import re
from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import BaseModel
from typing import Any, Dict, List, Optional, Tuple
from datetime import date, datetime, timedelta
import uuid
import math
from decimal import Decimal, ROUND_HALF_UP

from db.models import (
    ForecastResponse, Loan, LoanCreate, LoanUpdate, LoanPayment, LoanPaymentCreate,
    AmortizationSchedule, LoanWithDetails, LoanSummary, CashFlowProjection
)
from services.financial_statements import add_months


def payment_date_for(start_date: str, months_after: int) -> str:
    """
    Scheduled payment date `months_after` calendar months after the loan
    start date, keeping the day of month and clamping to month end
    (a loan started Jan 31 pays Feb 28/29, Mar 31, Apr 30, ...). Calendar
    months, not 30.44-day increments, so a schedule never drifts or skips a
    month.
    """
    start = datetime.strptime(start_date, '%Y-%m-%d').date()
    return add_months(start, months_after).strftime('%Y-%m-%d')

router = APIRouter(prefix="/loans", tags=["loans"])

FREQUENCY_MONTHS = {"monthly": 1, "quarterly": 3, "annually": 12}
LOAN_TYPES = ('term_loan', 'line_of_credit', 'sba_loan', 'equipment_loan', 'real_estate_loan')
PAYMENT_TYPES = ('amortizing', 'interest_only')
#: Loan fields that change the payment schedule when their value changes.
SCHEDULE_FIELDS = ('principal_amount', 'interest_rate', 'loan_term_months', 'start_date', 'payment_type',
                   'payment_frequency', 'balloon_payment', 'balloon_date')
#: Statuses that record something that happened; such rows are history.
RECORDED_STATUSES = ('paid', 'skipped')
PAYMENT_COLUMNS = ('payment_id', 'loan_id', 'payment_number', 'payment_date', 'payment_amount',
                   'principal_payment', 'interest_payment', 'remaining_balance', 'payment_status',
                   'actual_payment_date', 'actual_payment_amount', 'notes')
#: Balance-chain tolerance for legacy rows (each stored value is rounded to cents).
BALANCE_TOLERANCE = 0.05


def calculate_loan_payment(principal: float, annual_rate: float, term_months: int, payment_type: str = "amortizing") -> float:
    """Calculate monthly loan payment amount"""
    if payment_type == "interest_only":
        return principal * (annual_rate / 12)

    # Amortizing loan payment calculation
    if annual_rate == 0:
        return principal / term_months

    monthly_rate = annual_rate / 12
    payment = principal * (monthly_rate * (1 + monthly_rate) ** term_months) / ((1 + monthly_rate) ** term_months - 1)

    return round(payment, 2)


def _period_payment(balance: float, annual_rate: float, remaining_months: int, freq_months: int) -> float:
    """Level payment per installment that repays `balance` over the remaining
    months. Monthly loans use `calculate_loan_payment` unchanged; quarterly /
    annual loans use the annuity on the per-period rate and period count."""
    if freq_months == 1:
        return calculate_loan_payment(balance, annual_rate, max(remaining_months, 1), "amortizing")
    periods = max(remaining_months // freq_months, 1)
    rate = annual_rate * freq_months / 12
    if rate == 0:
        return balance / periods
    return round(balance * (rate * (1 + rate) ** periods) / ((1 + rate) ** periods - 1), 2)


def generate_amortization_schedule(
    loan_id: str,
    principal: float,
    annual_rate: float,
    term_months: int,
    start_date: str,
    payment_type: str = "amortizing",
    balloon_payment: Optional[float] = None,
    balloon_date: Optional[str] = None,
    payment_frequency: str = "monthly",
    *,
    first_payment_number: int = 1,
    opening_balance: Optional[float] = None,
    cycle_offset: int = 0,
) -> List[LoanPayment]:
    """
    Amortization schedule for a loan, installment n due `n` payment periods
    after the start date on calendar months (`payment_date_for`).

    With `first_payment_number` > 1 and `opening_balance` it builds only the
    rest of a schedule: installments first_payment_number..end of term,
    re-amortising `opening_balance` over the remaining term (used when the
    earlier installments are history and must be kept). `cycle_offset`
    pushes the due dates that many periods later (used when a start date
    change would otherwise date new installments before recorded ones).
    The last installment always clears the balance (no rounding residue).
    """
    payments = []
    remaining_balance = principal if opening_balance is None else opening_balance

    # Calculate payment frequency multiplier
    freq_months = FREQUENCY_MONTHS.get(payment_frequency, 1)

    # Adjust calculations for payment frequency
    periods_per_year = 12 / freq_months
    period_rate = annual_rate / periods_per_year
    total_periods = term_months // freq_months

    numbers = list(range(first_payment_number, total_periods + 1))
    force_payoff = False
    if not numbers and first_payment_number > 1 and remaining_balance > 0.01:
        # History already runs to (or past) the end of the term but a balance
        # is left: one final installment pays it off.
        numbers = [first_payment_number]
        force_payoff = True
    if not numbers or remaining_balance <= 0.005:
        return []

    def due(payment_num: int) -> datetime:
        return datetime.strptime(payment_date_for(start_date, freq_months * (payment_num + cycle_offset)), '%Y-%m-%d')

    balloon = datetime.strptime(balloon_date[:10], '%Y-%m-%d') if balloon_date else None

    if payment_type == "interest_only":
        # Interest-only payments
        interest_payment = remaining_balance * period_rate
        principal_payment = 0

        for payment_num in numbers:
            payment_date = due(payment_num)

            # Check if this is the balloon payment date
            is_balloon = False
            if (balloon and payment_date >= balloon) or force_payoff:
                principal_payment = remaining_balance
                is_balloon = True

            payment_amount = interest_payment + principal_payment
            remaining_balance -= principal_payment

            payment = LoanPayment(
                payment_id=f"{loan_id}-{payment_num:03d}",
                loan_id=loan_id,
                payment_number=payment_num,
                payment_date=payment_date.strftime('%Y-%m-%d'),
                payment_amount=round(payment_amount, 2),
                principal_payment=round(principal_payment, 2),
                interest_payment=round(interest_payment, 2),
                remaining_balance=round(remaining_balance, 2),
                payment_status="scheduled"
            )
            payments.append(payment)

            if is_balloon:
                break

            # Reset principal payment for next iteration
            principal_payment = 0

    else:
        # Amortizing loan
        remaining_months = term_months - (first_payment_number - 1) * freq_months
        if remaining_months <= 0:
            remaining_months = freq_months
        if freq_months == 1:
            payment_amount = calculate_loan_payment(remaining_balance, annual_rate, remaining_months, payment_type)
        else:
            payment_amount = _period_payment(remaining_balance, annual_rate, remaining_months, freq_months)
        last_number = numbers[-1]

        for payment_num in numbers:
            payment_date = due(payment_num)

            interest_payment = remaining_balance * period_rate
            principal_payment = payment_amount - interest_payment
            amount = payment_amount

            # Never pay more principal than is owed, and clear the balance on
            # the last installment.
            if principal_payment > remaining_balance or payment_num == last_number:
                principal_payment = remaining_balance
                amount = principal_payment + interest_payment

            remaining_balance -= principal_payment

            payment = LoanPayment(
                payment_id=f"{loan_id}-{payment_num:03d}",
                loan_id=loan_id,
                payment_number=payment_num,
                payment_date=payment_date.strftime('%Y-%m-%d'),
                payment_amount=round(amount, 2),
                principal_payment=round(principal_payment, 2),
                interest_payment=round(interest_payment, 2),
                remaining_balance=round(remaining_balance, 2),
                payment_status="scheduled"
            )
            payments.append(payment)

            if remaining_balance <= 0.01:  # Account for rounding
                break

    return payments


# ---------------------------------------------------------------------------
# Values, validation and change detection
# ---------------------------------------------------------------------------

def _parse_day(value: Any) -> Optional[date]:
    """A calendar date from 'YYYY-MM-DD' (optionally with a time part),
    'YYYY/MM/DD', 'MM/DD/YYYY' or a date object; None when blank or
    unparseable."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    head = re.split(r'[T ]', text, maxsplit=1)[0]
    for fmt in ('%Y-%m-%d', '%Y/%m/%d', '%m/%d/%Y'):
        try:
            return datetime.strptime(head, fmt).date()
        except ValueError:
            continue
    return None


def _norm(field: str, value: Any) -> Any:
    """Comparable form of a loan field value: 5.0 == 5,
    '2026-01-01' == '2026-01-01T00:00:00', '' == None, NULL payment type =
    amortizing, NULL frequency = monthly."""
    if isinstance(value, str):
        value = value.strip()
        if value == '':
            value = None
    if field == 'payment_type':
        return str(value or 'amortizing').lower()
    if field == 'payment_frequency':
        return str(value or 'monthly').lower()
    if value is None:
        return None
    if field in ('principal_amount', 'interest_rate', 'balloon_payment'):
        try:
            return round(float(value), 6)
        except (TypeError, ValueError):
            return value
    if field == 'loan_term_months':
        try:
            return int(round(float(value)))
        except (TypeError, ValueError):
            return value
    if field in ('start_date', 'balloon_date'):
        parsed = _parse_day(value)
        return parsed.isoformat() if parsed else str(value)
    if field == 'is_active':
        if isinstance(value, str):
            return value.lower() in ('1', 'true', 'yes')
        return bool(value)
    return value


def _store_value(field: str, value: Any) -> Any:
    """The value written to the loans table (dates as YYYY-MM-DD, enums lower-case)."""
    if field in ('start_date', 'balloon_date'):
        if isinstance(value, str) and not value.strip():
            return None                       # a cleared balloon date is NULL, not ''
        parsed = _parse_day(value)
        return parsed.isoformat() if parsed else value
    if field in ('payment_type', 'payment_frequency', 'loan_type') and isinstance(value, str):
        return value.strip().lower()
    if field == 'loan_term_months':
        return int(round(float(value)))
    return value


def _validation_errors(values: Dict[str, Any]) -> List[str]:
    """Plain-language problems with the given loan field values (only the
    fields present are checked)."""
    errors = []

    def present(name):
        return name in values and values[name] is not None

    def number(name):
        try:
            return float(values[name])
        except (TypeError, ValueError):
            errors.append(f"{name} must be a number")
            return None

    for name in ('loan_name', 'lender'):
        if present(name) and not str(values[name]).strip():
            errors.append(f"{name} cannot be blank")
    if present('loan_type') and str(values['loan_type']).strip().lower() not in LOAN_TYPES:
        errors.append(f"loan_type must be one of {', '.join(LOAN_TYPES)}")
    if present('payment_type') and str(values['payment_type']).strip().lower() not in PAYMENT_TYPES:
        errors.append(f"payment_type must be one of {', '.join(PAYMENT_TYPES)}")
    if present('payment_frequency') and str(values['payment_frequency']).strip().lower() not in FREQUENCY_MONTHS:
        errors.append(f"payment_frequency must be one of {', '.join(FREQUENCY_MONTHS)}")
    if present('principal_amount'):
        v = number('principal_amount')
        if v is not None and v <= 0:
            errors.append("principal_amount must be greater than 0")
    if present('interest_rate'):
        v = number('interest_rate')
        if v is not None and not 0 <= v <= 100:
            errors.append("interest_rate is an annual percentage between 0 and 100 (e.g. 7.5)")
    if present('loan_term_months'):
        v = number('loan_term_months')
        if v is not None and (v < 1 or v != int(v)):
            errors.append("loan_term_months must be a whole number of months, at least 1")
    if present('balloon_payment'):
        v = number('balloon_payment')
        if v is not None and v < 0:
            errors.append("balloon_payment cannot be negative")
    if present('start_date') and not str(values['start_date']).strip():
        errors.append("start_date cannot be blank")
    for name in ('start_date', 'balloon_date'):
        if present(name) and str(values[name]).strip() and _parse_day(values[name]) is None:
            errors.append(f"{name} must be a date (YYYY-MM-DD)")
    return errors


# ---------------------------------------------------------------------------
# Schedule history: keep recorded rows, rebuild the rest
# ---------------------------------------------------------------------------

def _is_recorded(row: Dict[str, Any]) -> bool:
    """History: paid / skipped, or an actual date, actual amount or note."""
    status = str(row.get('payment_status') or '').strip().lower()
    return (status in RECORDED_STATUSES
            or str(row.get('actual_payment_date') or '').strip() != ''
            or row.get('actual_payment_amount') is not None
            or str(row.get('notes') or '').strip() != '')


def _split_history(rows: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """(kept, rest): every row up to and including the last history row is
    kept; only the rows after it can be rebuilt or re-dated."""
    last = -1
    for i, row in enumerate(rows):
        if _is_recorded(row):
            last = i
    return rows[:last + 1], rows[last + 1:]


def _load_loan(cursor, loan_id: str) -> Optional[Dict[str, Any]]:
    cursor.execute("SELECT * FROM loans WHERE loan_id = ?", (loan_id,))
    row = cursor.fetchone()
    if not row:
        return None
    return dict(zip([d[0] for d in cursor.description], row))


def _load_rows(cursor, loan_id: str) -> List[Dict[str, Any]]:
    cursor.execute(
        f"SELECT rowid AS _rowid, {', '.join(PAYMENT_COLUMNS)} FROM loan_payments "
        "WHERE loan_id = ? ORDER BY payment_number, rowid",
        (loan_id,),
    )
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, r)) for r in cursor.fetchall()]


def _public_row(row: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: row.get(k) for k in PAYMENT_COLUMNS}
    out['recorded'] = _is_recorded(row)
    return out


def _terms(loan: Dict[str, Any]) -> Dict[str, Any]:
    frequency = str(loan.get('payment_frequency') or 'monthly').strip().lower()
    return {
        'principal': float(loan.get('principal_amount') or 0),
        'rate': float(loan.get('interest_rate') or 0) / 100,
        'term': int(loan.get('loan_term_months') or 0),
        'start': _parse_day(loan.get('start_date')),
        'payment_type': str(loan.get('payment_type') or 'amortizing').strip().lower(),
        'frequency': frequency,
        'freq_months': FREQUENCY_MONTHS.get(frequency, 1),
        'balloon_payment': loan.get('balloon_payment'),
        'balloon_date': _parse_day(loan.get('balloon_date')),
    }


def _month_index(d: date) -> int:
    return d.year * 12 + d.month


def _last_kept_date(kept: List[Dict[str, Any]]) -> Optional[date]:
    dates = [d for d in (_parse_day(r.get('payment_date')) for r in kept) if d]
    return max(dates) if dates else None


def _cycle_offset(start: date, freq_months: int, first_number: int, after: Optional[date]) -> int:
    """Periods to push new installments so the first lands in a month after
    the last kept row (0 when the loan's calendar already does)."""
    if after is None:
        return 0
    k = first_number
    while k < first_number + 1200 and _month_index(add_months(start, freq_months * k)) <= _month_index(after):
        k += 1
    return k - first_number


def _expected_dates(terms: Dict[str, Any], kept: List[Dict[str, Any]], rest: List[Dict[str, Any]]) -> List[str]:
    """Calendar-correct due dates for the rows after the history: installment
    n is due n periods after the start date (pushed past the last kept row
    if the calendar would put it on or before it)."""
    if not rest or terms['start'] is None:
        return []
    first = int(rest[0].get('payment_number') or 0)
    offset = _cycle_offset(terms['start'], terms['freq_months'], first, _last_kept_date(kept))
    return [add_months(terms['start'], terms['freq_months'] * (int(r.get('payment_number') or 0) + offset)).isoformat()
            for r in rest]


def _unique_payment_id(cursor, loan_id: str, wanted: str, taken: set) -> str:
    """payment_id is unique across all loans; keep the readable id unless it
    is already used by a kept row or another loan."""
    candidate = wanted
    while True:
        clash = candidate in taken
        if not clash and cursor is not None:
            cursor.execute("SELECT 1 FROM loan_payments WHERE payment_id = ? AND loan_id != ?", (candidate, loan_id))
            clash = cursor.fetchone() is not None
        if not clash:
            taken.add(candidate)
            return candidate
        candidate = f"{wanted}-{uuid.uuid4().hex[:6]}"


def _plan_regeneration(cursor, loan: Dict[str, Any], rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Keep the history rows exactly; rebuild every installment after the
    last one from its remaining balance (the principal when there is no
    history), numbered on from it, for the rest of the term."""
    terms = _terms(loan)
    if terms['start'] is None:
        raise HTTPException(status_code=422, detail="The loan's start date is not a date (YYYY-MM-DD); fix it before rebuilding the schedule.")
    kept, rest = _split_history(rows)
    warnings: List[str] = []
    if kept:
        opening = float(kept[-1].get('remaining_balance') or 0)
        first_number = int(kept[-1].get('payment_number') or len(kept)) + 1
    else:
        opening = terms['principal']
        first_number = 1
    after = _last_kept_date(kept)
    offset = _cycle_offset(terms['start'], terms['freq_months'], first_number, after)
    if offset and kept:
        warnings.append(
            f"The start date puts installment {first_number} on or before the last recorded payment "
            f"({after.isoformat()}); the new installments continue on the loan's calendar after it."
        )
    loan_id = loan['loan_id']
    new = generate_amortization_schedule(
        loan_id, terms['principal'], terms['rate'], terms['term'], terms['start'].isoformat(),
        terms['payment_type'], terms['balloon_payment'],
        terms['balloon_date'].isoformat() if terms['balloon_date'] else None, terms['frequency'],
        first_payment_number=first_number, opening_balance=opening, cycle_offset=offset,
    )
    taken = {r.get('payment_id') for r in kept}
    new_rows = []
    for p in new:
        row = p.model_dump()
        row['payment_id'] = _unique_payment_id(cursor, loan_id, row['payment_id'], taken)
        new_rows.append(row)
    if kept and opening <= 0.005 and rest:
        warnings.append("The recorded payments already repay the loan; the unpaid installments after them are removed.")
    if kept and int(kept[-1].get('payment_number') or 0) >= terms['term'] // max(terms['freq_months'], 1) and new_rows:
        warnings.append("The recorded payments run to the end of the term with a balance left; one final installment pays it off.")
    return {
        'action': 'regenerate', 'kept': kept, 'removed': rest, 'new': new_rows, 'redated': [],
        'final_rows': kept + new_rows, 'opening_balance': opening, 'warnings': warnings,
    }


def _no_plan(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {'action': 'none', 'kept': [], 'removed': [], 'new': [], 'redated': [], 'final_rows': rows,
            'opening_balance': None, 'warnings': []}


def _summary(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Totals, payoff date and next unpaid installment of a schedule."""
    ordered = sorted(rows, key=lambda r: int(r.get('payment_number') or 0))
    _, rest = _split_history(ordered)
    last = ordered[-1] if ordered else {}

    def total(key):
        return round(sum(float(r.get(key) or 0) for r in ordered), 2)

    return {
        'payments': len(ordered),
        'paid': sum(1 for r in ordered if str(r.get('payment_status') or '').lower() == 'paid'),
        'recorded': sum(1 for r in ordered if _is_recorded(r)),
        'total_payments': total('payment_amount'),
        'total_principal': total('principal_payment'),
        'total_interest': total('interest_payment'),
        'payoff_date': last.get('payment_date') if ordered else None,
        'final_balance': round(float(last.get('remaining_balance') or 0), 2) if ordered else None,
        'next_payment_date': rest[0].get('payment_date') if rest else None,
    }


def _schedule_counts(plan: Dict[str, Any]) -> Dict[str, Any]:
    if plan['action'] == 'none':
        return {'regenerated': False, 'kept_paid': 0, 'kept': 0, 'removed': 0, 'added': 0, 'redated': 0}
    return {
        'regenerated': plan['action'] == 'regenerate',
        'kept_paid': sum(1 for r in plan['kept'] if _is_recorded(r)),
        'kept': len(plan['kept']),
        'removed': len(plan['removed']),
        'added': len(plan['new']),
        'redated': len(plan['redated']),
    }


def _plan_payload(rows: List[Dict[str, Any]], plan: Dict[str, Any]) -> Dict[str, Any]:
    """The before / after preview shared by updates and repairs."""
    return {
        'action': plan['action'],
        'schedule': _schedule_counts(plan),
        'before': _summary(rows),
        'after': _summary(plan['final_rows']),
        'kept_rows': [_public_row(r) for r in plan['kept']],
        'removed_rows': [_public_row(r) for r in plan['removed']],
        'new_rows': [_public_row(r) for r in plan['new']],
        'redated_rows': [{k: r[k] for k in ('payment_number', 'from_date', 'to_date')} for r in plan['redated']],
        'warnings': list(plan['warnings']),
    }


def _apply_plan(cursor, loan: Dict[str, Any], plan: Dict[str, Any]) -> None:
    """Write a plan: delete / insert / re-date only the non-history rows and
    refresh the loan's balance, payment and next payment date."""
    loan_id = loan['loan_id']
    if plan['action'] == 'none':
        return
    if plan['action'] == 'regenerate':
        for row in plan['removed']:
            cursor.execute("DELETE FROM loan_payments WHERE rowid = ?", (row['_rowid'],))
        for row in plan['new']:
            cursor.execute(
                f"INSERT INTO loan_payments ({', '.join(PAYMENT_COLUMNS[:9])}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                tuple(row[k] for k in PAYMENT_COLUMNS[:9]),
            )
        terms = _terms(loan)
        opening = plan['opening_balance'] if plan['opening_balance'] is not None else terms['principal']
        if plan['kept']:
            remaining_months = max(terms['term'] - int(plan['kept'][-1].get('payment_number') or 0) * terms['freq_months'], 1)
            monthly = calculate_loan_payment(opening, terms['rate'], remaining_months, terms['payment_type']) if opening > 0.005 else 0
        else:
            monthly = calculate_loan_payment(terms['principal'], terms['rate'], max(terms['term'], 1), terms['payment_type'])
        next_date = _summary(plan['final_rows'])['next_payment_date']
        cursor.execute(
            "UPDATE loans SET current_balance = ?, monthly_payment_amount = ?, "
            "next_payment_date = COALESCE(?, next_payment_date) WHERE loan_id = ?",
            (round(opening, 2), monthly, next_date, loan_id),
        )
    elif plan['action'] == 'redate':
        for change in plan['redated']:
            cursor.execute("UPDATE loan_payments SET payment_date = ? WHERE rowid = ?", (change['to_date'], change['_rowid']))
        next_date = _summary(plan['final_rows'])['next_payment_date']
        cursor.execute("UPDATE loans SET next_payment_date = COALESCE(?, next_payment_date) WHERE loan_id = ?",
                       (next_date, loan_id))


# ---------------------------------------------------------------------------
# Legacy schedule audit and repair
# ---------------------------------------------------------------------------

def _plural(n: int, word: str) -> str:
    return f"{n} {word}" + ("" if n == 1 else "s")


def _audit_loan(loan: Dict[str, Any], rows: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Problems with a loan's unpaid installments, or None when the schedule
    is on calendar months, complete and consistent."""
    terms = _terms(loan)
    kept, rest = _split_history(rows)
    entry: Dict[str, Any] = {
        'loan_id': loan.get('loan_id'),
        'loan_name': loan.get('loan_name'),
        'lender': loan.get('lender'),
        'is_active': bool(_norm('is_active', loan.get('is_active') if loan.get('is_active') is not None else 1)),
        'start_date': loan.get('start_date'),
        'payment_frequency': terms['frequency'],
        'payments': len(rows),
        'paid_rows': sum(1 for r in kept if _is_recorded(r)),
        'unpaid_rows': len(rest),
        'drifted': 0, 'wrong_month': 0, 'missing_dates': 0, 'out_of_order': 0,
        'issues': [], 'examples': [],
    }
    issues: List[str] = []

    if terms['start'] is None:
        issues.append('bad_start_date')
        entry.update(issues=issues, needs_recompute=False, proposed_action='fix_loan_terms',
                     statement_impact=True, severity='warning',
                     summary=f"The start date '{loan.get('start_date')}' is not a date, so the payment calendar cannot be checked. Edit the loan and enter the start date.")
        return entry

    if not rows:
        if terms['principal'] <= 0 or terms['term'] <= 0:
            return None
        issues.append('no_schedule')
    else:
        # Numbering: the rows after the history continue 1, 2, 3 ... without gaps.
        first_expected = int(kept[-1].get('payment_number') or 0) + 1 if kept else 1
        numbers = [int(r.get('payment_number') or 0) for r in rest]
        if numbers and numbers != list(range(first_expected, first_expected + len(numbers))):
            issues.append('numbering_gap')

        # Dates.
        expected = _expected_dates(terms, kept, rest)
        previous = _last_kept_date(kept)
        for row, exp in zip(rest, expected):
            raw = str(row.get('payment_date') or '').strip()
            stored = _parse_day(raw)
            issue = None
            if stored is None:
                entry['missing_dates'] += 1
                issue = 'missing_date'
            else:
                if previous is not None and stored <= previous:
                    entry['out_of_order'] += 1
                    issue = 'out_of_order'
                if raw != exp:
                    entry['drifted'] += 1
                    if _month_index(stored) != _month_index(date.fromisoformat(exp)):
                        entry['wrong_month'] += 1
                        issue = issue or 'wrong_month'
                    else:
                        issue = issue or 'date_drift'
                previous = stored if previous is None else max(previous, stored)
            if issue and len(entry['examples']) < 3:
                entry['examples'].append({'payment_number': row.get('payment_number'), 'stored_date': raw or None,
                                          'expected_date': exp, 'issue': issue})
        if entry['drifted']:
            issues.append('date_drift')
        if entry['wrong_month']:
            issues.append('wrong_month')
        if entry['missing_dates']:
            issues.append('missing_date')
        if entry['out_of_order']:
            issues.append('out_of_order')

        # Balances: each row's remaining balance = previous balance - principal.
        balance = float(kept[-1].get('remaining_balance') or 0) if kept else terms['principal']
        for row in rest:
            principal_paid = float(row.get('principal_payment') or 0)
            remaining = float(row.get('remaining_balance') or 0)
            if abs(balance - principal_paid - remaining) > BALANCE_TOLERANCE:
                issues.append('balance_break')
                break
            balance = remaining

        # Completeness: the schedule stops before the end of the term with money
        # still owed, or (amortizing loans) runs the full term but does not pay
        # the loan off (old quarterly / annual maths left a residue).
        last = rows[-1]
        total_periods = terms['term'] // terms['freq_months']
        left = float(last.get('remaining_balance') or 0)
        stops_early = left > 0.01 and int(last.get('payment_number') or 0) < total_periods
        not_repaid = terms['payment_type'] == 'amortizing' and left > 1.0
        if stops_early or not_repaid:
            issues.append('incomplete')
            entry['balance_left'] = round(left, 2)
            entry['stops_early'] = stops_early

    if not issues:
        return None
    needs_recompute = any(i in issues for i in ('no_schedule', 'numbering_gap', 'balance_break', 'incomplete'))
    statement_impact = needs_recompute or bool(entry['wrong_month'] or entry['missing_dates'] or entry['out_of_order'])

    parts = []
    if 'no_schedule' in issues:
        parts.append("no payment schedule is saved, so the statements show no payments for it")
    if entry['drifted']:
        text = f"{_plural(entry['drifted'], 'unpaid payment')} not on the loan's calendar dates"
        if entry['wrong_month']:
            text += f" ({entry['wrong_month']} in the wrong month)"
        parts.append(text)
    if entry['missing_dates']:
        parts.append(f"{_plural(entry['missing_dates'], 'payment')} without a date")
    if entry['out_of_order']:
        parts.append(f"{_plural(entry['out_of_order'], 'payment')} dated before the one before it")
    if 'numbering_gap' in issues:
        parts.append("payment numbers have gaps")
    if 'balance_break' in issues:
        parts.append("remaining balances do not add up")
    if 'incomplete' in issues:
        parts.append(f"the schedule stops before the end of the term with ${entry['balance_left']:,.2f} still owed"
                     if entry.get('stops_early') else
                     f"the last installment leaves ${entry['balance_left']:,.2f} unpaid")
    summary = "; ".join(parts)
    summary = summary[:1].upper() + summary[1:] + "."
    if entry['paid_rows']:
        summary += f" {_plural(entry['paid_rows'], 'paid payment')} will be kept as recorded."

    entry.update(
        issues=issues,
        needs_recompute=needs_recompute,
        proposed_action='regenerate' if needs_recompute else 'redate',
        statement_impact=statement_impact,
        severity='warning' if statement_impact else 'info',
        summary=summary,
        action=f"Review & repair on the Loans screen (POST /loans/{loan.get('loan_id')}/repair-schedule, dry run first)",
    )
    return entry


def _audit_report(cursor) -> Tuple[List[Dict[str, Any]], int]:
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='loans'")
    if not cursor.fetchone():
        return [], 0
    cursor.execute("SELECT * FROM loans ORDER BY loan_name, loan_id")
    cols = [d[0] for d in cursor.description]
    loans = [dict(zip(cols, r)) for r in cursor.fetchall()]
    found = []
    for loan in loans:
        entry = _audit_loan(loan, _load_rows(cursor, loan['loan_id']))
        if entry:
            found.append(entry)
    return found, len(loans)


def schedule_audit(cursor) -> List[Dict[str, Any]]:
    """
    Read-only check of every loan's saved schedule. Returns one entry per
    loan whose unpaid installments (the rows after the last paid / recorded
    one) are not on the calendar-correct dates (installment n = start date +
    n payment periods, day clamped to month end), have missing or
    out-of-order dates, gaps in numbering, broken balances, stop before the
    end of the term, or that has no schedule at all.

    Each entry: loan_id, loan_name, lender, is_active, start_date,
    payment_frequency, payments, paid_rows, unpaid_rows, drifted,
    wrong_month, missing_dates, out_of_order, issues (list of 'date_drift',
    'wrong_month', 'missing_date', 'out_of_order', 'numbering_gap',
    'balance_break', 'incomplete', 'no_schedule', 'bad_start_date'),
    examples (up to 3 {payment_number, stored_date, expected_date, issue}),
    needs_recompute, proposed_action ('redate' | 'regenerate' |
    'fix_loan_terms'), statement_impact (payments land in the wrong month or
    are missing on the statements), severity ('warning' | 'info'), summary
    (one plain sentence) and action. Never writes.
    """
    return _audit_report(cursor)[0]


def _plan_repair(cursor, loan: Dict[str, Any], rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Re-date the unpaid installments after the history onto calendar
    months (amounts unchanged), or rebuild them when the schedule is
    incomplete / inconsistent. History rows are never touched."""
    audit = _audit_loan(loan, rows)
    if audit is None:
        plan = _no_plan(rows)
        plan['audit'] = None
        return plan
    if audit['proposed_action'] == 'fix_loan_terms':
        raise HTTPException(status_code=422, detail=audit['summary'])
    if audit['needs_recompute']:
        plan = _plan_regeneration(cursor, loan, rows)
        plan['audit'] = audit
        return plan
    terms = _terms(loan)
    kept, rest = _split_history(rows)
    redated = []
    final_rows = list(kept)
    for row, exp in zip(rest, _expected_dates(terms, kept, rest)):
        current = str(row.get('payment_date') or '').strip()
        if current != exp:
            redated.append({'payment_number': row.get('payment_number'), 'from_date': row.get('payment_date'),
                            'to_date': exp, '_rowid': row['_rowid']})
            row = dict(row, payment_date=exp)
        final_rows.append(row)
    return {
        'action': 'redate' if redated else 'none', 'kept': kept if redated else [], 'removed': [], 'new': [],
        'redated': redated, 'final_rows': final_rows, 'opening_balance': None, 'warnings': [], 'audit': audit,
    }


def _nice_date(value: Any) -> str:
    """'2027-01-01' -> 'Jan 1, 2027' for messages people read."""
    d = _parse_day(value)
    return f"{d:%b} {d.day}, {d.year}" if d else str(value)


def _describe_plan(plan: Dict[str, Any], payload: Dict[str, Any]) -> str:
    counts = payload['schedule']
    after = payload['after']
    if plan['action'] == 'regenerate':
        kept = counts['kept_paid']
        text = (f"schedule rebuilt after {_plural(kept, 'recorded payment')} (kept as recorded): "
                if kept else "schedule rebuilt: ")
        text += f"{_plural(counts['removed'], 'unpaid installment')} replaced with {counts['added']} new"
        if after.get('payoff_date'):
            text += f", payoff {_nice_date(after['payoff_date'])}"
        return text
    if plan['action'] == 'redate':
        return (f"{_plural(counts['redated'], 'unpaid installment')} moved onto calendar dates, amounts unchanged"
                + (f"; {_plural(counts['kept_paid'], 'recorded payment')} kept as recorded" if counts['kept_paid'] else ""))
    return "payment schedule unchanged"


@router.post("/", response_model=ForecastResponse)
async def create_loan(loan_data: LoanCreate):
    """Create a new loan and generate its amortization schedule"""
    conn = None
    try:
        from db.database import db_manager

        errors = _validation_errors(loan_data.model_dump())
        if errors:
            raise HTTPException(status_code=422, detail="; ".join(errors))
        start_date = _store_value('start_date', loan_data.start_date)
        balloon_date = _store_value('balloon_date', loan_data.balloon_date) if loan_data.balloon_date else None
        payment_type = _store_value('payment_type', loan_data.payment_type)
        payment_frequency = _store_value('payment_frequency', loan_data.payment_frequency or 'monthly')
        loan_type = _store_value('loan_type', loan_data.loan_type)

        # Generate loan ID
        loan_id = f"LOAN-{str(uuid.uuid4())[:8].upper()}"

        # Calculate payment amount
        monthly_payment = calculate_loan_payment(
            loan_data.principal_amount,
            loan_data.interest_rate / 100,  # Convert percentage to decimal
            loan_data.loan_term_months,
            payment_type
        )

        # First payment one calendar month after the start date
        next_payment_date = payment_date_for(start_date, 1)

        conn = db_manager.get_connection()
        cursor = conn.cursor()

        # Insert loan
        cursor.execute("""
            INSERT INTO loans (
                loan_id, loan_name, lender, loan_type, principal_amount, interest_rate,
                loan_term_months, start_date, payment_type, payment_frequency,
                balloon_payment, balloon_date, description, collateral_description,
                guarantor, loan_officer, account_number, is_active, current_balance,
                next_payment_date, monthly_payment_amount
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            loan_id, loan_data.loan_name, loan_data.lender, loan_type,
            loan_data.principal_amount, loan_data.interest_rate, loan_data.loan_term_months,
            start_date, payment_type, payment_frequency,
            loan_data.balloon_payment, balloon_date, loan_data.description,
            loan_data.collateral_description, loan_data.guarantor, loan_data.loan_officer,
            loan_data.account_number, loan_data.is_active, loan_data.principal_amount,
            next_payment_date, monthly_payment
        ))

        # Generate and insert amortization schedule
        payments = generate_amortization_schedule(
            loan_id,
            loan_data.principal_amount,
            loan_data.interest_rate / 100,
            loan_data.loan_term_months,
            start_date,
            payment_type,
            loan_data.balloon_payment,
            balloon_date,
            payment_frequency
        )

        for payment in payments:
            cursor.execute("""
                INSERT INTO loan_payments (
                    payment_id, loan_id, payment_number, payment_date, payment_amount,
                    principal_payment, interest_payment, remaining_balance, payment_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                payment.payment_id, payment.loan_id, payment.payment_number,
                payment.payment_date, payment.payment_amount, payment.principal_payment,
                payment.interest_payment, payment.remaining_balance, payment.payment_status
            ))

        conn.commit()
        db_manager.close_connection(conn)

        return ForecastResponse(
            status="success",
            data={"loan_id": loan_id, "payments_generated": len(payments)},
            message=f"Loan '{loan_data.loan_name}' created successfully with {len(payments)} scheduled payments"
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating loan: {str(e)}")
    finally:
        if conn is not None:
            conn.close()


@router.get("/schedule-audit", response_model=ForecastResponse)
async def get_schedule_audit():
    """
    Legacy schedule check (read-only). Lists every loan whose unpaid
    installments are not on calendar-month dates (schedules saved before the
    date fix used 30.44-day steps: Jan 31 / Mar 2 / Apr 2), have missing or
    out-of-order dates, broken balances, stop before the end of the term, or
    that has no schedule. Paid / recorded installments are history and are
    never flagged for change. Nothing is fixed automatically: repair one
    loan at a time with `POST /loans/{loan_id}/repair-schedule` (dry run
    first). Entry fields: see `schedule_audit`.
    """
    conn = None
    try:
        from db.database import db_manager

        conn = db_manager.get_connection()
        found, checked = _audit_report(conn.cursor())
        affecting = sum(1 for e in found if e['statement_impact'])
        if found:
            message = (f"{len(found)} of {_plural(checked, 'loan')} {'has a payment schedule' if len(found) == 1 else 'have payment schedules'} "
                       "to review" + (f" ({affecting} affect{'s' if affecting == 1 else ''} the statements)" if affecting else ""))
        else:
            message = f"All {_plural(checked, 'loan')} have schedules on calendar months" if checked else "No loans"
        return ForecastResponse(
            status="success",
            data={
                "loans": found,
                "loans_checked": checked,
                "loans_with_issues": len(found),
                "loans_affecting_statements": affecting,
                "installments_to_redate": sum(e['drifted'] + e['missing_dates'] for e in found),
            },
            message=message,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error checking loan schedules: {str(e)}")
    finally:
        if conn is not None:
            conn.close()


@router.get("/", response_model=ForecastResponse)
async def get_loans(active_only: bool = Query(True)):
    """Get all loans with summary information"""
    conn = None
    try:
        from db.database import db_manager
        
        print(f"Getting loans with active_only={active_only}")
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # First, let's check if the loans table exists and has data
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='loans'")
        if not cursor.fetchone():
            print("Loans table does not exist!")
            return ForecastResponse(
                status="success",
                data={"loans": []},
                message="No loans table found"
            )
        
        # Check if there's any data in the loans table
        cursor.execute("SELECT COUNT(*) FROM loans")
        loan_count = cursor.fetchone()[0]
        print(f"Found {loan_count} loans in database")
        
        if loan_count == 0:
            return ForecastResponse(
                status="success",
                data={"loans": []},
                message="No loans found in database"
            )
        
        # Build query
        query = """
            SELECT l.*, 
                   COUNT(lp.payment_id) as total_payments,
                   COUNT(CASE WHEN lp.payment_status = 'paid' THEN 1 END) as payments_made,
                   SUM(CASE WHEN lp.payment_status = 'paid' THEN lp.interest_payment ELSE 0 END) as total_interest_paid,
                   SUM(CASE WHEN lp.payment_status != 'paid' THEN lp.interest_payment ELSE 0 END) as total_interest_remaining
            FROM loans l
            LEFT JOIN loan_payments lp ON l.loan_id = lp.loan_id
        """
        
        params = []
        if active_only:
            query += " WHERE l.is_active = 1"
        
        query += " GROUP BY l.loan_id ORDER BY l.created_date DESC"
        
        print(f"Executing query: {query}")
        cursor.execute(query, params)
        loan_rows = cursor.fetchall()
        
        # Get column names
        columns = [description[0] for description in cursor.description]
        print(f"Columns: {columns}")
        
        loans = []
        for row in loan_rows:
            loan_dict = dict(zip(columns, row))
            print(f"Processing loan: {loan_dict.get('loan_id', 'Unknown')}")
            
            # Calculate payments remaining
            total_payments = loan_dict.get('total_payments', 0)
            payments_made = loan_dict.get('payments_made', 0)
            payments_remaining = total_payments - payments_made
            
            # Normalize nullable DB fields to safe defaults expected by the model/UI
            normalized_payment_type = loan_dict.get('payment_type') or 'amortizing'
            normalized_payment_frequency = loan_dict.get('payment_frequency') or 'monthly'

            # Compute sensible fallbacks for required fields that may be NULL in legacy data
            principal = loan_dict['principal_amount']
            annual_rate_pct = loan_dict['interest_rate']
            term_months = loan_dict['loan_term_months']
            start_date_val = loan_dict['start_date']

            computed_monthly_payment = calculate_loan_payment(
                principal,
                (annual_rate_pct or 0) / 100,
                term_months or 1,
                normalized_payment_type
            )

            current_balance_val = loan_dict.get('current_balance')
            if current_balance_val is None:
                current_balance_val = principal

            monthly_payment_amount_val = loan_dict.get('monthly_payment_amount')
            if monthly_payment_amount_val is None:
                monthly_payment_amount_val = computed_monthly_payment

            next_payment_date_val = loan_dict.get('next_payment_date')
            if not next_payment_date_val and start_date_val:
                next_payment_date_val = payment_date_for(start_date_val, 1)

            created_date_val = loan_dict.get('created_date') or start_date_val or ''
            updated_date_val = loan_dict.get('updated_date') or created_date_val

            loan_with_details = LoanWithDetails(
                loan_id=loan_dict['loan_id'],
                loan_name=loan_dict['loan_name'],
                lender=loan_dict['lender'],
                loan_type=loan_dict['loan_type'],
                principal_amount=loan_dict['principal_amount'],
                interest_rate=loan_dict['interest_rate'],
                loan_term_months=loan_dict['loan_term_months'],
                start_date=start_date_val,
                payment_type=normalized_payment_type,
                payment_frequency=normalized_payment_frequency,
                balloon_payment=loan_dict.get('balloon_payment'),
                balloon_date=loan_dict.get('balloon_date'),
                description=loan_dict.get('description'),
                collateral_description=loan_dict.get('collateral_description'),
                guarantor=loan_dict.get('guarantor'),
                loan_officer=loan_dict.get('loan_officer'),
                account_number=loan_dict.get('account_number'),
                is_active=bool(loan_dict['is_active']),
                created_date=created_date_val,
                updated_date=updated_date_val,
                current_balance=current_balance_val,
                next_payment_date=next_payment_date_val,
                monthly_payment_amount=monthly_payment_amount_val,
                payments_made=payments_made,
                payments_remaining=payments_remaining,
                total_interest_paid=loan_dict.get('total_interest_paid', 0) or 0,
                total_interest_remaining=loan_dict.get('total_interest_remaining', 0) or 0
            )
            loans.append(loan_with_details.dict())
        
        db_manager.close_connection(conn)
        
        print(f"Successfully retrieved {len(loans)} loans")
        return ForecastResponse(
            status="success",
            data={"loans": loans},
            message=f"Retrieved {len(loans)} loans"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"Error in get_loans: {str(e)}")
        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Error retrieving loans: {str(e)}")
    finally:
        if conn is not None:
            conn.close()

@router.get("/{loan_id}/schedule", response_model=ForecastResponse)
async def get_amortization_schedule(loan_id: str):
    """Get the complete amortization schedule for a loan"""
    conn = None
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Get loan details
        cursor.execute("SELECT * FROM loans WHERE loan_id = ?", (loan_id,))
        loan_row = cursor.fetchone()
        
        if not loan_row:
            raise HTTPException(status_code=404, detail="Loan not found")
        
        # Get loan column names
        cursor.execute("PRAGMA table_info(loans)")
        loan_columns = [col[1] for col in cursor.fetchall()]
        loan_data = dict(zip(loan_columns, loan_row))
        
        # Get payment schedule (legacy rows may carry NULLs; show them as blanks / zeros)
        rows = _load_rows(cursor, loan_id)
        payments = []
        for row in rows:
            payments.append(LoanPayment(
                payment_id=str(row.get('payment_id') or f"row-{row['_rowid']}"),
                loan_id=loan_id,
                payment_number=int(row.get('payment_number') or 0),
                payment_date=str(row.get('payment_date') or ''),
                payment_amount=float(row.get('payment_amount') or 0),
                principal_payment=float(row.get('principal_payment') or 0),
                interest_payment=float(row.get('interest_payment') or 0),
                remaining_balance=float(row.get('remaining_balance') or 0),
                payment_status=str(row.get('payment_status') or 'scheduled'),
                actual_payment_date=row.get('actual_payment_date'),
                actual_payment_amount=row.get('actual_payment_amount'),
                notes=row.get('notes'),
            ))
        
        # Calculate totals
        total_payments = sum(p.payment_amount for p in payments)
        total_interest = sum(p.interest_payment for p in payments)
        
        schedule = AmortizationSchedule(
            loan_id=loan_id,
            loan_name=loan_data['loan_name'],
            lender=loan_data['lender'],
            payment_schedule=payments,
            total_payments=total_payments,
            total_interest=total_interest,
            loan_summary={
                "principal_amount": loan_data['principal_amount'],
                "interest_rate": loan_data['interest_rate'],
                "loan_term_months": loan_data['loan_term_months'],
                "payment_type": loan_data['payment_type'],
                "payment_frequency": loan_data.get('payment_frequency') or 'monthly',
                "start_date": loan_data.get('start_date'),
                "total_payments": total_payments,
                "total_interest": total_interest,
                "average_monthly_payment": total_payments / len(payments) if payments else 0
            }
        )
        data = schedule.model_dump()
        # History rows (paid / skipped / actuals / notes) are kept exactly when
        # the loan's terms change: flag them so screens can mark them.
        kept, _rest = _split_history(rows)
        for i, (payment, row) in enumerate(zip(data['payment_schedule'], rows)):
            payment['recorded'] = _is_recorded(row)
            payment['locked'] = i < len(kept)   # kept as is when the terms change
        data['history'] = {
            'recorded': sum(1 for r in rows if _is_recorded(r)),
            'paid': sum(1 for r in rows if str(r.get('payment_status') or '').lower() == 'paid'),
            'last_recorded_payment_number': kept[-1].get('payment_number') if kept else None,
        }
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data=data,
            message=f"Retrieved amortization schedule with {len(payments)} payments"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving amortization schedule: {str(e)}")
    finally:
        if conn is not None:
            conn.close()

@router.get("/summary", response_model=ForecastResponse)
async def get_loan_summary():
    """Get comprehensive loan portfolio summary"""
    conn = None
    try:
        from db.database import db_manager
        
        print("Getting loan summary...")
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Check if loans table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='loans'")
        if not cursor.fetchone():
            print("Loans table does not exist for summary!")
            return ForecastResponse(
                status="success",
                data={
                    "total_loans": 0,
                    "active_loans": 0,
                    "total_principal": 0,
                    "total_current_balance": 0,
                    "total_monthly_payments": 0,
                    "total_annual_payments": 0,
                    "interest_rate_summary": {"average": 0, "minimum": 0, "maximum": 0},
                    "loans_by_type": [],
                    "upcoming_payments": []
                },
                message="No loans table found"
            )
        
        # Get basic loan statistics
        print("Getting basic statistics...")
        cursor.execute("""
            SELECT 
                COUNT(*) as total_loans,
                COUNT(CASE WHEN is_active = 1 THEN 1 END) as active_loans,
                SUM(principal_amount) as total_principal,
                SUM(current_balance) as total_current_balance,
                SUM(monthly_payment_amount) as total_monthly_payments,
                AVG(interest_rate) as avg_interest_rate,
                MIN(interest_rate) as min_interest_rate,
                MAX(interest_rate) as max_interest_rate
            FROM loans
        """)
        stats = cursor.fetchone()
        print(f"Basic stats: {stats}")
        
        # Get loans by type
        print("Getting loans by type...")
        cursor.execute("""
            SELECT loan_type, 
                   COUNT(*) as count,
                   SUM(current_balance) as total_balance,
                   AVG(interest_rate) as avg_rate
            FROM loans 
            WHERE is_active = 1
            GROUP BY loan_type
        """)
        loans_by_type = []
        for row in cursor.fetchall():
            loans_by_type.append({
                "loan_type": row[0],
                "count": row[1],
                "total_balance": row[2],
                "avg_interest_rate": row[3]
            })
        print(f"Loans by type: {loans_by_type}")
        
        # Get upcoming payments (next 30 days)
        print("Getting upcoming payments...")
        cursor.execute("""
            SELECT l.loan_name, l.lender, lp.payment_date, lp.payment_amount, lp.payment_status
            FROM loan_payments lp
            JOIN loans l ON lp.loan_id = l.loan_id
            WHERE lp.payment_date BETWEEN date('now') AND date('now', '+30 days')
              AND lp.payment_status = 'scheduled'
              AND l.is_active = 1
            ORDER BY lp.payment_date
            LIMIT 10
        """)
        upcoming_payments = []
        for row in cursor.fetchall():
            upcoming_payments.append({
                "loan_name": row[0],
                "lender": row[1],
                "payment_date": row[2],
                "payment_amount": row[3],
                "payment_status": row[4]
            })
        print(f"Upcoming payments: {upcoming_payments}")
        
        db_manager.close_connection(conn)
        
        summary = LoanSummary(
            total_loans=stats[0] or 0,
            active_loans=stats[1] or 0,
            total_principal=stats[2] or 0,
            total_current_balance=stats[3] or 0,
            total_monthly_payments=stats[4] or 0,
            total_annual_payments=(stats[4] or 0) * 12,
            upcoming_payments=upcoming_payments,
            loans_by_type=loans_by_type,
            interest_rate_summary={
                "average": stats[5] or 0,
                "minimum": stats[6] or 0,
                "maximum": stats[7] or 0
            }
        )
        
        print("Successfully retrieved loan summary")
        return ForecastResponse(
            status="success",
            data=summary.dict(),
            message="Retrieved loan portfolio summary"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"Error in get_loan_summary: {str(e)}")
        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Error retrieving loan summary: {str(e)}")
    finally:
        if conn is not None:
            conn.close()

@router.get("/cash-flow", response_model=ForecastResponse)
async def get_loan_cash_flow_projection(
    start_period: str = Query(..., description="Start period in YYYY-MM format"),
    end_period: str = Query(..., description="End period in YYYY-MM format")
):
    """Get loan payment cash flow projection for specified period range"""
    conn = None
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Convert periods to date range
        start_date = f"{start_period}-01"
        end_date = f"{end_period}-31"  # End of month
        
        cursor.execute("""
            SELECT 
                strftime('%Y-%m', lp.payment_date) as period,
                l.loan_name,
                l.lender,
                l.loan_type,
                SUM(lp.principal_payment) as total_principal,
                SUM(lp.interest_payment) as total_interest,
                SUM(lp.payment_amount) as total_payment,
                COUNT(*) as payment_count
            FROM loan_payments lp
            JOIN loans l ON lp.loan_id = l.loan_id
            WHERE lp.payment_date >= ? AND lp.payment_date <= ?
              AND l.is_active = 1
            GROUP BY strftime('%Y-%m', lp.payment_date), l.loan_id
            ORDER BY period, l.loan_name
        """, (start_date, end_date))
        
        payment_data = cursor.fetchall()
        
        # Group by period
        projections = {}
        for row in payment_data:
            period = row[0]
            if period not in projections:
                projections[period] = {
                    "period": period,
                    "loan_payments": [],
                    "total_principal": 0,
                    "total_interest": 0,
                    "total_payment": 0,
                    "remaining_balance": 0
                }
            
            loan_payment = {
                "loan_name": row[1],
                "lender": row[2],
                "loan_type": row[3],
                "principal_payment": row[4],
                "interest_payment": row[5],
                "payment_amount": row[6],
                "payment_count": row[7]
            }
            
            projections[period]["loan_payments"].append(loan_payment)
            projections[period]["total_principal"] += row[4]
            projections[period]["total_interest"] += row[5]
            projections[period]["total_payment"] += row[6]
        
        # Calculate remaining balance for each period
        for period in sorted(projections.keys()):
            cursor.execute("""
                SELECT SUM(l.current_balance) as total_balance
                FROM loans l
                WHERE l.is_active = 1
            """)
            balance_row = cursor.fetchone()
            projections[period]["remaining_balance"] = balance_row[0] if balance_row[0] else 0
        
        db_manager.close_connection(conn)
        
        projection_list = [CashFlowProjection(**data) for data in projections.values()]
        
        return ForecastResponse(
            status="success",
            data={"projections": [p.dict() for p in projection_list]},
            message=f"Retrieved cash flow projections for {len(projection_list)} periods"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving cash flow projection: {str(e)}")
    finally:
        if conn is not None:
            conn.close()

class LoanUpdateRequest(LoanUpdate):
    """LoanUpdate plus `preview` (same as `?preview=true`)."""
    preview: Optional[bool] = None


class RepairScheduleRequest(BaseModel):
    dry_run: bool = True


@router.put("/{loan_id}", response_model=ForecastResponse)
async def update_loan(
    loan_id: str,
    loan_update: LoanUpdateRequest,
    preview: bool = Query(False, description="Return the before / after schedule without saving anything"),
):
    """
    Update a loan. Payment history is never deleted or changed.

    * Fields sent as null are left as they are. A field counts as changed only
      when its value really differs from the stored one (5.0 == 5,
      '2026-01-01' == '2026-01-01T00:00:00', '' == empty), so re-sending the
      current values changes nothing.
    * The schedule is rebuilt only when a schedule field (principal_amount,
      interest_rate, loan_term_months, start_date, payment_type,
      payment_frequency, balloon_payment, balloon_date) changes.
    * Rebuilding keeps every row up to and including the last HISTORY row
      (status 'paid' or 'skipped', or an actual_payment_date,
      actual_payment_amount or note) exactly as stored. Installments after it
      are replaced: they start from that row's remaining_balance (the
      principal when there is no history), are numbered on from its
      payment_number, re-amortised over the rest of the term and dated on
      calendar months (installment n = start date + n payment periods, day
      clamped to month end; pushed past the last recorded payment if a start
      date change would date them on or before it).
    * `?preview=true` (or `"preview": true` in the body) returns the same
      answer without writing anything.

    Response data: loan_id, preview, changed_fields, changes {field: {from,
    to}}, action ('none' | 'regenerate'), schedule {regenerated, kept_paid,
    kept, removed, added, redated}, before / after {payments, paid, recorded,
    total_payments, total_principal, total_interest, payoff_date,
    final_balance, next_payment_date}, kept_rows, removed_rows, new_rows,
    redated_rows, warnings.
    """
    conn = None
    try:
        from db.database import db_manager

        conn = db_manager.get_connection()
        cursor = conn.cursor()

        loan = _load_loan(cursor, loan_id)
        if not loan:
            raise HTTPException(status_code=404, detail="Loan not found")

        body = loan_update.model_dump(exclude_unset=True)
        preview = bool(preview or body.pop('preview', None))
        values = {k: v for k, v in body.items() if v is not None}
        if not values:
            raise HTTPException(status_code=400, detail="No fields to update")
        errors = _validation_errors(values)
        if errors:
            raise HTTPException(status_code=422, detail="; ".join(errors))

        changed = [f for f in values if _norm(f, values[f]) != _norm(f, loan.get(f))]
        updated = dict(loan)
        for field in changed:
            updated[field] = _store_value(field, values[field])
        schedule_changed = [f for f in changed if f in SCHEDULE_FIELDS]

        rows = _load_rows(cursor, loan_id)
        plan = _plan_regeneration(cursor, updated, rows) if schedule_changed else _no_plan(rows)
        payload = _plan_payload(rows, plan)

        if not changed:
            message = "No changes: the loan already has these values; payment schedule unchanged"
        else:
            message = ("Preview only, nothing saved: " if preview else "Loan updated; ") + _describe_plan(plan, payload)

        if not preview and changed:
            assignments = ", ".join(f"{f} = ?" for f in changed)
            cursor.execute(
                f"UPDATE loans SET {assignments}, updated_date = CURRENT_TIMESTAMP WHERE loan_id = ?",
                [updated[f] for f in changed] + [loan_id],
            )
            if schedule_changed:
                _apply_plan(cursor, updated, plan)
            conn.commit()

        data = {
            "loan_id": loan_id,
            "preview": preview,
            "changed_fields": changed,
            "changes": {f: {"from": loan.get(f), "to": updated[f]} for f in changed},
            **payload,
        }
        return ForecastResponse(status="success", data=data, message=message)

    except HTTPException:
        raise
    except Exception as e:
        if conn is not None:
            conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error updating loan: {str(e)}")
    finally:
        if conn is not None:
            conn.close()


@router.post("/{loan_id}/repair-schedule", response_model=ForecastResponse)
async def repair_schedule(loan_id: str, request: Optional[RepairScheduleRequest] = Body(None)):
    """
    Put a legacy schedule back on calendar months. Never runs by itself, and
    `dry_run` defaults to true (preview only): send `{"dry_run": false}` to
    save.

    Paid / recorded installments (and every row before the last of them) are
    history and are kept exactly. The unpaid installments after them are:

    * re-dated onto the loan's calendar (installment n = start date + n
      payment periods) with amounts unchanged, when only their dates are off
      (drifted, wrong month, missing or out of order);
    * rebuilt as in `PUT /loans/{id}` (from the last kept balance, numbered
      on, rest of the term) when the schedule is incomplete, has numbering
      gaps, broken balances, or no rows at all.

    Response data: the same before / after preview as the loan update
    (action 'none' | 'redate' | 'regenerate', schedule {regenerated,
    kept_paid, kept, removed, added, redated}, before, after, kept_rows,
    removed_rows, new_rows, redated_rows [{payment_number, from_date,
    to_date}], warnings) plus loan_id, dry_run and audit (the
    schedule-audit entry, or null when nothing needs repair).
    """
    dry_run = True if request is None else bool(request.dry_run)
    conn = None
    try:
        from db.database import db_manager

        conn = db_manager.get_connection()
        cursor = conn.cursor()
        loan = _load_loan(cursor, loan_id)
        if not loan:
            raise HTTPException(status_code=404, detail="Loan not found")
        rows = _load_rows(cursor, loan_id)
        plan = _plan_repair(cursor, loan, rows)
        payload = _plan_payload(rows, plan)
        if plan['action'] == 'none':
            message = "Nothing to repair: the unpaid installments are already on calendar months"
        else:
            message = ("Dry run, nothing saved: " if dry_run else "Schedule repaired: ") + _describe_plan(plan, payload)
            if not dry_run:
                _apply_plan(cursor, loan, plan)
                cursor.execute("UPDATE loans SET updated_date = CURRENT_TIMESTAMP WHERE loan_id = ?", (loan_id,))
                conn.commit()
        return ForecastResponse(
            status="success",
            data={"loan_id": loan_id, "loan_name": loan.get('loan_name'), "dry_run": dry_run,
                  "audit": plan.get('audit'), **payload},
            message=message,
        )
    except HTTPException:
        raise
    except Exception as e:
        if conn is not None:
            conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error repairing loan schedule: {str(e)}")
    finally:
        if conn is not None:
            conn.close()


@router.delete("/{loan_id}", response_model=ForecastResponse)
async def delete_loan(loan_id: str):
    """Delete a loan and its payment schedule"""
    conn = None
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Check if loan exists
        cursor.execute("SELECT loan_name FROM loans WHERE loan_id = ?", (loan_id,))
        loan_row = cursor.fetchone()
        if not loan_row:
            raise HTTPException(status_code=404, detail="Loan not found")
        
        loan_name = loan_row[0]
        
        # Delete payment schedule first (due to foreign key constraint)
        cursor.execute("DELETE FROM loan_payments WHERE loan_id = ?", (loan_id,))
        
        # Delete loan
        cursor.execute("DELETE FROM loans WHERE loan_id = ?", (loan_id,))
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"loan_id": loan_id},
            message=f"Loan '{loan_name}' deleted successfully"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting loan: {str(e)}")
    finally:
        if conn is not None:
            conn.close()
