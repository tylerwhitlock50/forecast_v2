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
from services.financial_statements import add_months, loans_by_period, period_range, schedule_rounding_residue
from services.financial_statements import _parse_date as _engine_date


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
#: A kept row dated within this many days of its numbered calendar date is on
#: the loan's calendar (schedules saved with 30.44-day steps drift a few days
#: either side of it).
ON_CALENDAR_DAYS = 15
PERIOD_NAMES = {1: 'month', 3: 'quarter', 12: 'year'}


def _cents(value: Any) -> float:
    """Money rounded to cents, never -0.0."""
    return round(float(value or 0), 2) + 0.0


def calculate_loan_payment(principal: float, annual_rate: float, term_months: int, payment_type: str = "amortizing") -> float:
    """Monthly loan payment amount, in cents."""
    if payment_type == "interest_only":
        return round(principal * (annual_rate / 12), 2)

    # Amortizing loan payment calculation
    if annual_rate == 0:
        return round(principal / term_months, 2)

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


def _installments(term_months: int, freq_months: int) -> int:
    """Installments in a term: one per payment period, the last one a short
    period when the term is not a whole number of periods."""
    if term_months <= 0:
        return 0
    return -(-term_months // freq_months)


def _installment_months(number: int, freq_months: int, term_months: int) -> int:
    """Months after the start date that installment `number` falls due on the
    loan's calendar: `number` periods on, the last one at maturity when the
    term is not a whole number of periods (numbers past the term continue a
    period apart)."""
    if number <= 0:
        return 0
    full = _installments(term_months, freq_months)
    if number <= full:
        return min(number * freq_months, term_months)
    return max(term_months, 0) + (number - full) * freq_months


def _tail_months(anchor: int, freq_months: int, term_months: int, count: int) -> List[int]:
    """Months after the start date of the `count` installments after calendar
    position `anchor`: a period apart, the one that would pass maturity
    falling at maturity instead (a short final period)."""
    months, position = [], anchor
    for _ in range(count):
        following = position + freq_months
        if position < term_months < following:
            following = term_months
        months.append(following)
        position = following
    return months


def _installments_after(anchor: int, freq_months: int, term_months: int) -> int:
    """Installments from calendar position `anchor` to maturity; one (to pay
    off what is left) when the term has already run out."""
    if term_months > anchor:
        return _installments(term_months - anchor, freq_months)
    return 1


def _period_rate(annual_rate: float, months: int) -> float:
    """Interest rate for an installment period of `months` months."""
    return annual_rate / (12 / months)


def _level_payment(balance: float, annual_rate: float, lengths: List[int], future_value: float = 0.0) -> float:
    """Level installment that brings `balance` down to `future_value` over
    installment periods of the given lengths (months). Equal periods with
    nothing left at the end use the usual annuity (`calculate_loan_payment`
    / `_period_payment`); a short final period or a balloon amount use the
    general annuity on each period's own rate."""
    n = len(lengths)
    if n == 0:
        return round(balance, 2)
    if future_value <= 0.005 and len(set(lengths)) == 1:
        if lengths[0] == 1:
            return calculate_loan_payment(balance, annual_rate, n, "amortizing")
        return _period_payment(balance, annual_rate, n * lengths[0], lengths[0])
    # balance * prod(1 + r_i) - payment * sum_j prod_{i > j}(1 + r_i) = future_value
    annuity, growth = 0.0, 1.0
    for rate in reversed([_period_rate(annual_rate, m) for m in lengths]):
        annuity += growth
        growth *= 1 + rate
    payment = (balance * growth - future_value) / annuity
    return payment if annual_rate == 0 else round(payment, 2)


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
    anchor_months: Optional[int] = None,
) -> List[LoanPayment]:
    """
    Amortization schedule on calendar months (`add_months`, day clamped to
    month end). Installment n of a new loan is due n payment periods after
    the start date; when the term is not a whole number of periods the last
    installment falls at maturity (start date + term) and covers the months
    left. Each installment's interest covers the months since the one before.

    With `first_payment_number` > 1 and `opening_balance` it builds only the
    rest of a schedule whose earlier installments are history: it continues
    from calendar position `anchor_months` (months after the start date the
    history ends at; installment first_payment_number - 1's by default), a
    period apart to maturity, numbered on from `first_payment_number`, and
    re-amortises `opening_balance` over those installments. When the history
    already runs to maturity one final installment pays the balance off.

    The schedule is worked in cents: each installment's interest is rounded
    first, its principal is the payment less that interest (rounded), and
    the running balance (stored as remaining_balance) is reduced by exactly
    the stored principal. The last installment always clears the balance,
    so the principal column adds up exactly to the principal (or to
    `opening_balance` for a rebuilt tail):

    * amortizing: level installments over the term; with `balloon_date` the
      first installment on or after it repays the balance still owed (a
      balloon); with `balloon_payment` the level installment is sized to
      leave that amount owing, repaid by the balloon installment (or by the
      last installment, at maturity).
    * interest_only: interest each period; the principal is repaid on the
      balloon date or, without one, with the last installment at maturity.
    """
    remaining_balance = round(float(principal if opening_balance is None else opening_balance), 2)
    if remaining_balance <= 0.005:
        return []
    freq_months = FREQUENCY_MONTHS.get(payment_frequency, 1)
    term = int(term_months or 0)
    anchor = (_installment_months(first_payment_number - 1, freq_months, term)
              if anchor_months is None else int(anchor_months))
    months = _tail_months(anchor, freq_months, term, _installments_after(anchor, freq_months, term))
    lengths = [later - earlier for earlier, later in zip([anchor] + months[:-1], months)]
    start = _parse_day(start_date)
    dates = [add_months(start, m) for m in months]
    balloon = _parse_day(balloon_date)
    payoff = next((i for i, d in enumerate(dates) if balloon is not None and d >= balloon), len(dates) - 1)

    if payment_type == "interest_only":
        level = None
    elif balloon_payment and float(balloon_payment) > 0:
        level = _level_payment(remaining_balance, annual_rate, lengths[:payoff + 1],
                               min(float(balloon_payment), remaining_balance))
    else:
        level = _level_payment(remaining_balance, annual_rate, lengths)

    payments = []
    for i, (due, length) in enumerate(zip(dates, lengths)):
        payment_num = first_payment_number + i
        interest_payment = round(remaining_balance * _period_rate(annual_rate, length), 2)
        last = i == payoff
        if level is None:
            # Interest only; the balloon (or the last installment) repays the principal.
            principal_payment = remaining_balance if last else 0.0
        else:
            principal_payment = round(level - interest_payment, 2)
            # Never pay more principal than is owed, and clear the balance on
            # the balloon / last installment.
            if principal_payment > remaining_balance or last:
                principal_payment = remaining_balance
        # In cents: the stored principal is exactly what comes off the balance.
        remaining_balance = round(remaining_balance - principal_payment, 2) + 0.0

        payments.append(LoanPayment(
            payment_id=f"{loan_id}-{payment_num:03d}",
            loan_id=loan_id,
            payment_number=payment_num,
            payment_date=due.strftime('%Y-%m-%d'),
            payment_amount=_cents(principal_payment + interest_payment),
            principal_payment=_cents(principal_payment),
            interest_payment=_cents(interest_payment),
            remaining_balance=remaining_balance,
            payment_status="scheduled"
        ))
        if last or remaining_balance <= 0.005:
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


def _cross_field_errors(values: Dict[str, Any], changed: Optional[List[str]] = None) -> List[str]:
    """Checks that combine fields, run on the loan's effective values (create:
    the posted loan; update: the stored loan with the changes applied). With
    `changed`, only the checks involving a changed field run, so an edit never
    fails on a stored value it does not touch.

    * loan_term_months is a whole number of payment periods (a multiple of 3
      for quarterly, of 12 for annual payments);
    * balloon_date is after start_date and on or before maturity (start_date
      + loan_term_months);
    * balloon_payment is not more than principal_amount.
    """
    errors: List[str] = []

    def involved(*names):
        return changed is None or any(name in changed for name in names)

    try:
        term = int(round(float(values.get('loan_term_months') or 0)))
    except (TypeError, ValueError):
        term = 0
    frequency = str(values.get('payment_frequency') or 'monthly').strip().lower()
    per = FREQUENCY_MONTHS.get(frequency, 1)
    if per > 1 and term > 0 and term % per and involved('loan_term_months', 'payment_frequency'):
        lower, upper = term // per * per, (term // per + 1) * per
        choices = f"{lower} or {upper}" if lower else str(upper)
        errors.append(f"loan_term_months ({term}) must be a whole number of {PERIOD_NAMES[per]}s (a multiple of {per}) "
                      f"for {frequency} payments: use {choices} months, or monthly payments")

    start = _parse_day(values.get('start_date'))
    balloon = _parse_day(values.get('balloon_date'))
    if balloon and start and involved('balloon_date', 'start_date', 'loan_term_months'):
        maturity = add_months(start, term) if term > 0 else None
        if balloon <= start:
            errors.append(f"balloon_date ({balloon.isoformat()}) must be after start_date ({start.isoformat()})")
        elif maturity and balloon > maturity:
            errors.append(f"balloon_date ({balloon.isoformat()}) must be on or before the loan's maturity "
                          f"({maturity.isoformat()}: start_date + {term} months)")

    if values.get('balloon_payment') not in (None, '') and involved('balloon_payment', 'principal_amount'):
        try:
            balloon_payment = float(values['balloon_payment'])
            principal = float(values.get('principal_amount') or 0)
        except (TypeError, ValueError):
            balloon_payment = None
        if balloon_payment is not None and balloon_payment > principal + 0.005:
            errors.append(f"balloon_payment ({balloon_payment:,.2f}) cannot be more than principal_amount "
                          f"({principal:,.2f})")
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


def _owed_after_history(terms: Dict[str, Any], kept: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    What the installments after the kept history repay (`opening`): the
    loan's principal less the principal of the kept installments, so every
    rebuild and repair repays the loan's CURRENT principal_amount. The last
    kept row's remaining_balance (`stored`) is history, stated on the
    principal of its time; it stops matching once the principal is changed
    after payments were recorded, and the difference must not be lost on a
    later rebuild.

    `adjusted` when the two differ by more than the kept rows' rounding
    (`tolerance`: BALANCE_TOLERANCE plus half a cent per row, the most that
    rounding each row's principal and balance to cents can add up to).
    Also returns stored and repaid (the principal of the kept rows).

    Kept rows whose last one says nothing is owed and whose principal
    misses the loan's by rounding alone (a schedule saved before schedules
    were generated in cents, `schedule_rounding_residue`) paid the loan
    off: `opening` is 0, never a few cents owed or overpaid.
    """
    repaid = round(sum(float(r.get('principal_payment') or 0) for r in kept), 2)
    opening = round(terms['principal'] - repaid, 2)
    if kept and schedule_rounding_residue(terms['principal'], [r.get('principal_payment') for r in kept],
                                          kept[-1].get('remaining_balance')):
        opening = 0.0
    stored = round(float(kept[-1].get('remaining_balance') or 0), 2) if kept else opening
    tolerance = BALANCE_TOLERANCE + 0.005 * len(kept)
    return {'opening': opening, 'stored': stored, 'repaid': repaid,
            'adjusted': bool(kept) and abs(opening - stored) > tolerance, 'tolerance': tolerance}


def _balance_owed(loan: Dict[str, Any], rows: List[Dict[str, Any]]) -> float:
    """
    What is still owed on a loan, from its saved schedule (the loan list's and
    the portfolio summary's current_balance): the principal less the
    principal of the installments kept as recorded history, the same rule
    as `_owed_after_history`, so the same loan state always shows the same
    balance and a principal changed after recorded payments counts. In
    cents and never negative; nothing once recorded installments paid the
    loan off, a legacy schedule's rounding residue included. A loan with no
    saved schedule owes its principal when it has a start date (as the
    statements read it), else the stored current_balance.
    """
    terms = _terms(loan)
    if not rows:
        stored = loan.get('current_balance')
        return _cents(terms['principal'] if terms['start'] is not None or stored is None else stored)
    kept, _rest = _split_history(rows)
    owed = _owed_after_history(terms, kept)['opening'] if kept else terms['principal']
    return _cents(max(owed, 0.0))


def _principal_note(terms: Dict[str, Any], kept: List[Dict[str, Any]], owed: Dict[str, Any], number: int) -> str:
    """Why the installments after the history repay more (or less) than the
    last kept row's remaining balance shows."""
    difference = owed['opening'] - owed['stored']
    return (f"The loan's principal ({terms['principal']:,.2f}) less the {owed['repaid']:,.2f} of principal in the "
            f"{_plural(len(kept), 'installment')} kept as recorded leaves {owed['opening']:,.2f} owed, "
            f"{abs(difference):,.2f} {'more' if difference > 0 else 'less'} than the {owed['stored']:,.2f} the last of "
            f"them (installment {number}) shows, as after a principal change once payments were recorded: the "
            f"installments after it repay {owed['opening']:,.2f}, so the schedule repays the principal in full.")


def _follows_frequency(terms: Dict[str, Any], kept: List[Dict[str, Any]], rest: Optional[List[Dict[str, Any]]],
                       per: int, previous: Optional[Dict[str, Any]] = None) -> bool:
    """
    True when the kept history really follows payment frequency `per` (not
    the loan's own one), i.e. it was kept from before a frequency change:
    every dated kept row is within ON_CALENDAR_DAYS of its numbered date on
    that frequency's calendar from the start date, and

    * this edit (`previous`, the stored terms) changes the frequency from
      `per`, with the start date unchanged; or
    * the saved installments after the history (`rest`) already continue
      from that frequency's position, as the frequency change saved them
      (the start date unchanged by this edit).

    Dates alone do not decide it: a history on the loan's own calendar that
    was paid late, or one dated on an earlier start date's calendar, can
    fall on another frequency's positions by chance.
    """
    start, term = terms['start'], terms['term']
    dated = [(int(r.get('payment_number') or 0), _parse_day(r.get('payment_date'))) for r in kept]
    dated = [(n, d) for n, d in dated if d is not None]
    if not dated or any(abs((d - add_months(start, _installment_months(n, per, term))).days) > ON_CALENDAR_DAYS
                        for n, d in dated):
        return False
    saved = terms
    if previous is not None:
        if previous['start'] != start:
            return False
        if previous['freq_months'] == per:
            return True
        saved = previous
    following = _parse_day(rest[0].get('payment_date')) if rest else None
    if following is None:
        return False
    number = int(kept[-1].get('payment_number') or len(kept))
    position = _installment_months(number, per, saved['term'])
    expected = add_months(start, _tail_months(position, saved['freq_months'], saved['term'], 1)[0])
    return abs((following - expected).days) <= ON_CALENDAR_DAYS


def _history_anchor(terms: Dict[str, Any], kept: List[Dict[str, Any]],
                    rest: Optional[List[Dict[str, Any]]] = None,
                    previous: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Where the kept history ends on the loan's calendar, as months after the
    start date (`months`); the installments after it continue a payment
    period apart from there.

    * No history: 0, so installment n is due n periods after the start date.
    * The last kept row (installment n0) dated within ON_CALENDAR_DAYS of its
      calendar date (n0 periods after the start; schedules saved with
      30.44-day steps drift a few days either side): that position, so the
      next installment is due on its own calendar date and rows already on
      their dates never move.
    * History kept from before a frequency change (`_follows_frequency`, given
      the rows after the history `rest` and the stored terms `previous` of an
      edit): installment n0's position on that frequency's calendar.
    * Otherwise (the start date changed, the history is far from its dates,
      or it is on another frequency's positions only by chance): the last
      calendar position on or before the last kept date, so the next
      installment is the first one a period after it and no period after it
      is left without a payment. `pushed` when that is later than
      installment n0 + 1's own calendar date (which falls on or before the
      last kept payment): the tail is pushed off the loan's own calendar.

    Also returns last_date (the latest kept date), number (the last kept
    installment number) and numbered_date (its calendar date).
    """
    result: Dict[str, Any] = {'months': 0, 'last_date': None, 'number': 0, 'numbered_date': None, 'pushed': False}
    if not kept:
        return result
    start, term, freq = terms['start'], terms['term'], terms['freq_months']
    number = int(kept[-1].get('payment_number') or len(kept))
    last = _last_kept_date(kept)
    numbered = _installment_months(number, freq, term)
    result.update(months=numbered, last_date=last, number=number, numbered_date=add_months(start, numbered))
    if last is None or abs((last - add_months(start, numbered)).days) <= ON_CALENDAR_DAYS:
        return result
    for per in sorted(set(FREQUENCY_MONTHS.values())):
        if per != freq and _follows_frequency(terms, kept, rest, per, previous):
            result['months'] = _installment_months(number, per, term)
            return result
    position = max(_month_index(last) - _month_index(start), 0)
    if position and add_months(start, position) > last:
        position -= 1
    following = add_months(start, _installment_months(number + 1, freq, term))
    result.update(months=position, pushed=following <= last)
    return result


def _expected_dates(terms: Dict[str, Any], kept: List[Dict[str, Any]], rest: List[Dict[str, Any]]) -> List[str]:
    """Calendar-correct due dates for the rows after the history: a payment
    period apart from where the history ends (`_history_anchor`), so
    installment n is due n periods after the start date unless the history
    is off that calendar; the one that would pass maturity at maturity."""
    if not rest or terms['start'] is None:
        return []
    anchor = _history_anchor(terms, kept, rest)['months']
    return [add_months(terms['start'], m).isoformat()
            for m in _tail_months(anchor, terms['freq_months'], terms['term'], len(rest))]


def _start_after_history(new_start: Optional[date], rows: List[Dict[str, Any]]) -> Optional[str]:
    """Why a new start date cannot be used: it is after the payment history
    that is kept as recorded (a loan cannot be repaid before it starts), or
    None when it is fine."""
    if new_start is None:
        return None
    kept, _ = _split_history(rows)
    dates = sorted(d for r in kept for d in (_parse_day(r.get('payment_date')), _parse_day(r.get('actual_payment_date')))
                   if d)
    if not dates or new_start <= dates[0]:
        return None
    return (f"The new start date {_nice_date(new_start)} is after the payment history kept for this loan "
            f"({_plural(len(kept), 'installment')} kept as recorded, the earliest dated {_nice_date(dates[0])}): a loan "
            f"cannot be repaid before it starts, and recorded payments are never moved. Use a start date on or before "
            f"{_nice_date(dates[0])}, or clear those payments' paid / skipped status, actual date, amount and note first.")


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


def _push_warning(terms: Dict[str, Any], anchor: Dict[str, Any], rows: List[Dict[str, Any]],
                  final_rows: List[Dict[str, Any]], first_date: Optional[str]) -> str:
    """Why the installments after the history are later than the start date's
    calendar puts them (`_history_anchor` pushed them past the last kept
    payment), with the payoff dates before and after (or the one it stays
    on)."""
    following = add_months(terms['start'], _installment_months(anchor['number'] + 1, terms['freq_months'], terms['term']))
    text = (f"The recorded payments do not follow the loan's calendar from its start date ({_nice_date(terms['start'])}): "
            f"installment {anchor['number'] + 1} would fall due on {_nice_date(following)}, on or before the last "
            f"recorded payment ({_nice_date(anchor['last_date'])}). The installments after it continue on the calendar "
            f"after that payment" + (f", from {_nice_date(first_date)}" if first_date else ""))
    before = _summary(rows)['last_payment_date']
    after = _summary(final_rows)['last_payment_date']
    if before and after and before != after:
        text += f"; the payoff moves from {_nice_date(before)} to {_nice_date(after)}"
    elif after:
        text += f"; the payoff stays on {_nice_date(after)}"
    return text + "."


def _plan_regeneration(cursor, loan: Dict[str, Any], rows: List[Dict[str, Any]],
                       previous: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Keep the history rows exactly; rebuild every installment after the
    last one, numbered on from it, a payment period apart on the loan's
    calendar from where the history ends (`_history_anchor`) to maturity.
    They repay the loan's current principal less the principal of the kept
    rows (`_owed_after_history`; the principal when there is no history), so
    a principal changed after recorded payments stays applied on every later
    rebuild and repair (warning when it differs from the last kept row's
    remaining balance; 422 when the kept rows already repay more than the
    principal).

    `previous` is the stored loan before an edit (None for a repair):

    * a payment frequency change after recorded payments continues one new
      period after the last kept payment, over the months left to maturity;
    * a principal change after recorded payments adds the difference to the
      balance the rebuilt installments repay (refused with 422 when the new
      principal is less than what the kept payments already repaid).
    """
    terms = _terms(loan)
    if terms['start'] is None:
        raise HTTPException(status_code=422, detail="The loan's start date is not a date (YYYY-MM-DD); fix it before rebuilding the schedule.")
    kept, rest = _split_history(rows)
    warnings: List[str] = []
    old = _terms(previous) if previous is not None else None
    anchor = _history_anchor(terms, kept, rest, old)
    recorded = sum(1 for r in kept if _is_recorded(r))
    if kept:
        owed = _owed_after_history(terms, kept)
        opening = owed['opening']
        first_number = anchor['number'] + 1
        delta = terms['principal'] - old['principal'] if old is not None else 0.0
        if opening < -0.005:
            raise HTTPException(status_code=422, detail=(
                f"The {'new ' if abs(delta) > 0.005 else ''}principal ({terms['principal']:,.2f}) is less than the "
                f"{owed['repaid']:,.2f} already repaid by the {_plural(len(kept), 'installment')} kept as recorded "
                f"history, so the balance would be negative. Enter a principal of at least {owed['repaid']:,.2f}, or "
                f"clear those payments' paid status first."))
        if abs(delta) > 0.005:
            warnings.append(
                f"Principal changed from {old['principal']:,.2f} to {terms['principal']:,.2f} after "
                f"{_plural(recorded, 'recorded payment')}: those payments stay as recorded, and the difference of "
                f"{abs(delta):,.2f} is {'added to' if delta > 0 else 'taken off'} the {opening - delta:,.2f} owed after "
                f"installment {anchor['number']}, so {opening:,.2f} is repaid by the installments after it.")
        elif owed['adjusted']:
            warnings.append(_principal_note(terms, kept, owed, anchor['number']))
        opening = max(opening, 0.0)
    else:
        opening = terms['principal']
        first_number = 1
    loan_id = loan['loan_id']
    new = generate_amortization_schedule(
        loan_id, terms['principal'], terms['rate'], terms['term'], terms['start'].isoformat(),
        terms['payment_type'], terms['balloon_payment'],
        terms['balloon_date'].isoformat() if terms['balloon_date'] else None, terms['frequency'],
        first_payment_number=first_number, opening_balance=opening, anchor_months=anchor['months'],
    )
    taken = {r.get('payment_id') for r in kept}
    new_rows = []
    for p in new:
        row = p.model_dump()
        row['payment_id'] = _unique_payment_id(cursor, loan_id, row['payment_id'], taken)
        new_rows.append(row)
    final_rows = kept + new_rows
    first_date = new_rows[0]['payment_date'] if new_rows else None
    maturity = add_months(terms['start'], terms['term'])

    if kept and old is not None and old['frequency'] != terms['frequency'] and new_rows:
        months_left = terms['term'] - anchor['months']
        unit = PERIOD_NAMES.get(terms['freq_months'], 'period')
        warnings.append(
            f"Payment frequency changed from {old['frequency']} to {terms['frequency']} after "
            f"{_plural(recorded, 'recorded payment')}: the {opening:,.2f} still owed is re-amortised over the "
            + (f"{_plural(months_left, 'month')} left to maturity ({_nice_date(maturity)}) " if months_left > 0 else "")
            + f"as {_plural(len(new_rows), terms['frequency'] + ' installment')}, the first on {_nice_date(first_date)}, "
            f"one {unit} after the last kept payment; each installment's interest covers the months since the one before.")
    elif kept and anchor['pushed']:
        warnings.append(_push_warning(terms, anchor, rows, final_rows, first_date))
    if kept and opening <= 0.005 and rest:
        warnings.append("The recorded payments already repay the loan; the unpaid installments after them are removed.")
    if kept and anchor['months'] >= terms['term'] and new_rows:
        warnings.append("The recorded payments run to the end of the term with a balance left; one final installment pays it off.")
    elif new_rows and terms['freq_months'] > 1 and terms['term'] % terms['freq_months']:
        warnings.append(
            f"The term ({terms['term']} months) is not a whole number of {PERIOD_NAMES[terms['freq_months']]}s: the last "
            f"installment, at maturity ({_nice_date(maturity)}), covers the "
            f"{_plural(terms['term'] % terms['freq_months'], 'month')} left.")
    warnings += _balloon_notes(terms, new_rows)
    return {
        'action': 'regenerate', 'kept': kept, 'removed': rest, 'new': new_rows, 'redated': [],
        'final_rows': final_rows, 'opening_balance': opening, 'anchor_months': anchor['months'], 'warnings': warnings,
    }


def _balloon_notes(terms: Dict[str, Any], new_rows: List[Dict[str, Any]]) -> List[str]:
    """An interest-only loan's balloon repays the whole balance owed: say so
    when the stored balloon_payment is a different amount."""
    if terms['payment_type'] != 'interest_only' or not new_rows:
        return []
    try:
        stated = float(terms['balloon_payment'] or 0)
    except (TypeError, ValueError):
        return []
    balloon = new_rows[-1]
    if stated <= 0 or abs(stated - float(balloon['principal_payment'] or 0)) <= 1.0:
        return []
    return [f"balloon_payment ({stated:,.2f}) is not used for an interest-only loan: the balloon installment on "
            f"{_nice_date(balloon['payment_date'])} repays the balance owed, {float(balloon['principal_payment']):,.2f}."]


def _no_plan(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {'action': 'none', 'kept': [], 'removed': [], 'new': [], 'redated': [], 'final_rows': rows,
            'opening_balance': None, 'warnings': []}


def _summary(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Totals, payoff date and next unpaid installment of a schedule.
    payoff_date is the last installment's date only when it brings the
    balance to zero (None when money is still owed after it);
    last_payment_date is the last installment's date either way."""
    ordered = sorted(rows, key=lambda r: int(r.get('payment_number') or 0))
    _, rest = _split_history(ordered)
    last = ordered[-1] if ordered else {}
    final_balance = round(float(last.get('remaining_balance') or 0), 2) if ordered else None

    def total(key):
        return round(sum(float(r.get(key) or 0) for r in ordered), 2)

    return {
        'payments': len(ordered),
        'paid': sum(1 for r in ordered if str(r.get('payment_status') or '').lower() == 'paid'),
        'recorded': sum(1 for r in ordered if _is_recorded(r)),
        'total_payments': total('payment_amount'),
        'total_principal': total('principal_payment'),
        'total_interest': total('interest_payment'),
        'payoff_date': last.get('payment_date') if ordered and final_balance <= 0.01 else None,
        'last_payment_date': last.get('payment_date') if ordered else None,
        'final_balance': final_balance,
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
    after = _summary(plan['final_rows'])
    opening = plan.get('opening_balance')
    if plan['action'] == 'regenerate' and not plan['new'] and opening is not None and plan['final_rows']:
        # Nothing is left to schedule after the kept history: what is owed is the derived opening (principal
        # less the kept principal), not the last kept row's balance, which may be stated on an old principal.
        after['final_balance'] = round(float(opening), 2) + 0.0
        after['payoff_date'] = after['last_payment_date'] if opening <= 0.01 else None
    return {
        'action': plan['action'],
        'schedule': _schedule_counts(plan),
        'before': _summary(rows),
        'after': after,
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
            anchor = plan.get('anchor_months')
            if anchor is None:
                anchor = _installment_months(int(plan['kept'][-1].get('payment_number') or 0), terms['freq_months'], terms['term'])
            remaining_months = max(terms['term'] - anchor, 1)
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


def _chain_holds(starts: List[float], rows: List[Dict[str, Any]]) -> bool:
    """True when each row's remaining balance is the balance before it less
    its principal (within BALANCE_TOLERANCE), the first row starting from
    one of the balances in `starts`."""
    balances = list(starts)
    for row in rows:
        principal_paid = float(row.get('principal_payment') or 0)
        remaining = float(row.get('remaining_balance') or 0)
        if not any(abs(balance - principal_paid - remaining) <= BALANCE_TOLERANCE for balance in balances):
            return False
        balances = [remaining]
    return True


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
    owed: Optional[Dict[str, Any]] = None

    # The statements only read active loans, so an inactive one's schedule
    # cannot put anything in the wrong month there until it is reactivated.
    active = entry['is_active']
    inactive_note = "" if active else " The loan is inactive, so it is not on the statements until it is reactivated."

    if terms['start'] is None:
        issues.append('bad_start_date')
        entry.update(issues=issues, needs_recompute=False, proposed_action='fix_loan_terms',
                     statement_impact=active, severity='warning' if active else 'info',
                     summary=f"The start date '{loan.get('start_date')}' is not a date, so the payment calendar cannot be checked. Edit the loan and enter the start date." + inactive_note)
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

        # Balances: the rows after the history start from what the principal
        # leaves owed after it (`_owed_after_history`, the principal with no
        # history; while the last kept row's remaining balance differs from
        # that only by rounding, a tail saved from it is consistent too), and
        # each row's remaining balance = previous balance - principal.
        owed = _owed_after_history(terms, kept) if kept else None
        if owed is not None and owed['opening'] < -0.005:
            issues.append('balance_break')
            entry['overpaid'] = round(-owed['opening'], 2)
        elif owed is None:
            if not _chain_holds([terms['principal']], rest):
                issues.append('balance_break')
        elif not _chain_holds([owed['opening']] + ([] if owed['adjusted'] else [owed['stored']]), rest):
            issues.append('balance_break')
            if owed['adjusted'] and _chain_holds([owed['stored']], rest):
                entry['principal_difference'] = round(owed['opening'] - owed['stored'], 2)

        # Completeness: the schedule stops before the end of the term with money
        # still owed, or ends without paying the loan off (old quarterly /
        # annual maths left a residue; old interest-only schedules without a
        # balloon date never repaid the principal; a principal raised after
        # the last installment was recorded).
        last = rows[-1]
        total_periods = _installments(terms['term'], terms['freq_months'])
        left = float(last.get('remaining_balance') or 0)
        if not rest and owed is not None and owed['adjusted']:
            left = max(owed['opening'], 0.0)
        stops_early = left > 0.01 and int(last.get('payment_number') or 0) < total_periods
        not_repaid = left > 1.0
        if stops_early or not_repaid:
            issues.append('incomplete')
            entry['balance_left'] = round(left, 2)
            entry['stops_early'] = stops_early

    if not issues:
        return None
    needs_recompute = any(i in issues for i in ('no_schedule', 'numbering_gap', 'balance_break', 'incomplete'))
    statement_impact = active and (needs_recompute
                                   or bool(entry['wrong_month'] or entry['missing_dates'] or entry['out_of_order']))

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
    last_kept = int(kept[-1].get('payment_number') or len(kept)) if kept else 0
    if 'overpaid' in entry:
        repaid = terms['principal'] + entry['overpaid']
        parts.append(f"the {_plural(len(kept), 'installment')} kept as recorded repay ${repaid:,.2f} of principal, "
                     f"more than the loan's principal of ${terms['principal']:,.2f}: enter a principal of at least "
                     f"${repaid:,.2f}, or clear those payments' paid status, before the schedule can be rebuilt")
    elif 'principal_difference' in entry:
        parts.append(f"the installments after installment {last_kept} repay ${owed['stored']:,.2f}, but the principal "
                     f"(${terms['principal']:,.2f}) less the recorded payments leaves ${owed['opening']:,.2f} owed "
                     f"(the principal was changed after payments were recorded)")
    elif 'balance_break' in issues:
        parts.append("remaining balances do not add up")
    if 'incomplete' in issues:
        parts.append(f"the schedule stops before the end of the term with ${entry['balance_left']:,.2f} still owed"
                     if entry.get('stops_early') else
                     f"the last installment leaves ${entry['balance_left']:,.2f} unpaid")
    summary = "; ".join(parts)
    summary = summary[:1].upper() + summary[1:] + "."
    if entry['paid_rows'] and 'overpaid' not in entry:
        summary += f" {_plural(entry['paid_rows'], 'paid payment')} will be kept as recorded."
    summary += inactive_note

    entry.update(
        issues=issues,
        needs_recompute=needs_recompute,
        proposed_action='fix_loan_terms' if 'overpaid' in entry else 'regenerate' if needs_recompute else 'redate',
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
    end of the term, or that has no schedule at all. The rows after the
    history must repay the principal less the principal of the kept rows
    (`_owed_after_history`): a schedule adjusted for a principal changed
    after recorded payments is consistent; one that repays the old balance
    is a balance_break with principal_difference (owed less what it
    repays), and kept rows that repay more than the principal are a
    balance_break with overpaid and proposed_action 'fix_loan_terms'.

    Each entry: loan_id, loan_name, lender, is_active, start_date,
    payment_frequency, payments, paid_rows, unpaid_rows, drifted,
    wrong_month, missing_dates, out_of_order, issues (list of 'date_drift',
    'wrong_month', 'missing_date', 'out_of_order', 'numbering_gap',
    'balance_break', 'incomplete', 'no_schedule', 'bad_start_date'),
    examples (up to 3 {payment_number, stored_date, expected_date, issue}),
    needs_recompute, proposed_action ('redate' | 'regenerate' |
    'fix_loan_terms'), statement_impact (payments land in the wrong month or
    are missing on the statements, or the loan is not fully repaid there;
    always false for an inactive loan, which the statements do not read),
    severity ('warning' when statement_impact, else 'info'), summary (one
    plain sentence) and action. Never writes.

    Calendar-correct dates come from `_history_anchor`: installment n is due
    n periods after the start date (the last one at maturity when the term
    is not a whole number of periods); after kept history that is off that
    calendar, the installments continue a period apart after it.
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
    expected = _expected_dates(terms, kept, rest)
    for row, exp in zip(rest, expected):
        current = str(row.get('payment_date') or '').strip()
        if current != exp:
            redated.append({'payment_number': row.get('payment_number'), 'from_date': row.get('payment_date'),
                            'to_date': exp, '_rowid': row['_rowid']})
            row = dict(row, payment_date=exp)
        final_rows.append(row)
    warnings = []
    anchor = _history_anchor(terms, kept, rest)
    if redated and anchor['pushed']:
        warnings.append(_push_warning(terms, anchor, rows, final_rows, expected[0] if expected else None))
    return {
        'action': 'redate' if redated else 'none', 'kept': kept if redated else [], 'removed': [], 'new': [],
        'redated': redated, 'final_rows': final_rows, 'opening_balance': None, 'warnings': warnings, 'audit': audit,
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
        elif after.get('last_payment_date') and (after.get('final_balance') or 0) > 0.01:
            text += (f", last installment {_nice_date(after['last_payment_date'])} with "
                     f"${after['final_balance']:,.2f} still owed")
        return text
    if plan['action'] == 'redate':
        return (f"{_plural(counts['redated'], 'unpaid installment')} moved onto calendar dates, amounts unchanged"
                + (f"; {_plural(counts['kept_paid'], 'recorded payment')} kept as recorded" if counts['kept_paid'] else ""))
    return "payment schedule unchanged"


@router.post("/", response_model=ForecastResponse)
async def create_loan(loan_data: LoanCreate):
    """
    Create a new loan and generate its amortization schedule (see
    `generate_amortization_schedule`). Refused with 422 when a value is
    invalid, the term is not a whole number of payment periods, the balloon
    date is not after the start date and on or before maturity, or the
    balloon payment is more than the principal. Response data: loan_id,
    payments_generated and warnings.
    """
    conn = None
    try:
        from db.database import db_manager

        values = loan_data.model_dump()
        errors = _validation_errors(values) or _cross_field_errors(values)
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

        warnings = _balloon_notes(_terms({**values, 'start_date': start_date, 'payment_type': payment_type,
                                          'payment_frequency': payment_frequency}),
                                  [p.model_dump() for p in payments])
        return ForecastResponse(
            status="success",
            data={"loan_id": loan_id, "payments_generated": len(payments), "warnings": warnings},
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

            # What is owed comes from the schedule (principal less recorded principal), never the stored column,
            # which only an edit of the loan's terms refreshes.
            current_balance_val = _balance_owed(loan_dict, _load_rows(cursor, loan_dict['loan_id']))

            monthly_payment_amount_val = loan_dict.get('monthly_payment_amount')
            if monthly_payment_amount_val is None:
                monthly_payment_amount_val = computed_monthly_payment
            monthly_payment_amount_val = _cents(monthly_payment_amount_val)

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
                total_interest_paid=_cents(loan_dict.get('total_interest_paid')),
                total_interest_remaining=_cents(loan_dict.get('total_interest_remaining'))
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
                AVG(interest_rate) as avg_interest_rate,
                MIN(interest_rate) as min_interest_rate,
                MAX(interest_rate) as max_interest_rate
            FROM loans
        """)
        stats = cursor.fetchone()
        print(f"Basic stats: {stats}")

        # Balances owed come from each loan's schedule (`_balance_owed`, as the loan list shows them), never the
        # stored current_balance column; payments are summed as the list shows them, in cents.
        cursor.execute("SELECT * FROM loans")
        columns = [d[0] for d in cursor.description]
        all_loans = [dict(zip(columns, row)) for row in cursor.fetchall()]
        balances = {loan['loan_id']: _balance_owed(loan, _load_rows(cursor, loan['loan_id'])) for loan in all_loans}
        total_monthly = _cents(sum(_cents(loan.get('monthly_payment_amount')) for loan in all_loans))

        # Get loans by type
        print("Getting loans by type...")
        cursor.execute("""
            SELECT loan_type,
                   COUNT(*) as count,
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
                "total_balance": _cents(sum(balances[loan['loan_id']] for loan in all_loans
                                            if loan.get('loan_type') == row[0] and _norm('is_active', loan.get('is_active')))),
                "avg_interest_rate": row[2]
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
            total_principal=_cents(stats[2]),
            total_current_balance=_cents(sum(balances.values())),
            total_monthly_payments=total_monthly,
            total_annual_payments=_cents(total_monthly * 12),
            upcoming_payments=upcoming_payments,
            loans_by_type=loans_by_type,
            interest_rate_summary={
                "average": stats[3] or 0,
                "minimum": stats[4] or 0,
                "maximum": stats[5] or 0
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
    """
    Debt service and debt per month over a window, from the saved schedules
    of the active loans (the rows the statements book). Every month in the
    window is listed, with zero flows when nothing is due.

    Per month: total_principal, total_interest, total_payment, loan_proceeds
    and remaining_balance, the debt owed at the end of the month: the
    opening balance plus proceeds minus principal, rolled forward exactly as
    the balance sheet's debt line (`services.financial_statements.
    loans_by_period`; a saved schedule whose principal misses the loan's
    principal by rounding alone books the difference with its last
    installment, so the balance is 0.00 once it is paid). loan_payments
    lists each loan with a payment or proceeds that month (loan_id,
    loan_name, lender, loan_type, principal_payment, interest_payment,
    payment_amount, payment_count, loan_proceeds, remaining_balance).
    """
    try:
        periods = period_range(start_period, end_period)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"{e} (periods are YYYY-MM)")
    conn = None
    try:
        from db.database import db_manager

        conn = db_manager.get_connection()
        cursor = conn.cursor()
        flows = loans_by_period(cursor, periods)
        window = set(periods)
        cursor.execute("SELECT loan_id, loan_name, lender, loan_type FROM loans WHERE is_active = 1")
        names = {row[0]: row[1:] for row in cursor.fetchall()}
        # Payment counts per loan and month, dated as the engine dates them. The amounts are the engine's, which
        # book a legacy schedule's rounding residue with its last installment (`schedule_rounding_residue`).
        paid: Dict[Tuple[str, str], int] = {}
        cursor.execute("SELECT lp.loan_id, lp.payment_date FROM loan_payments lp "
                       "JOIN loans l ON l.loan_id = lp.loan_id WHERE l.is_active = 1")
        for loan_id, pay_date in cursor.fetchall():
            day = _engine_date(pay_date)
            period = day.strftime("%Y-%m") if day else None
            if period in window:
                paid[(loan_id, period)] = paid.get((loan_id, period), 0) + 1

        balances = {loan_id: float(entry["opening_balance"]) for loan_id, entry in flows["by_loan"].items()}
        debt = float(flows["opening_debt"])
        projections = []
        for period in periods:
            debt += flows["proceeds"][period] - flows["principal"][period]
            loan_rows = []
            for loan_id, entry in flows["by_loan"].items():
                balances[loan_id] += entry["proceeds"][period] - entry["principal"][period]
                count = paid.get((loan_id, period), 0)
                if not count and not entry["proceeds"][period]:
                    continue
                loan_name, lender, loan_type = names.get(loan_id, (entry.get("loan_name"), None, None))
                loan_rows.append({
                    "loan_id": loan_id, "loan_name": loan_name, "lender": lender, "loan_type": loan_type,
                    "principal_payment": _cents(entry["principal"][period]),
                    "interest_payment": _cents(entry["interest"][period]),
                    "payment_amount": _cents(entry["payments"][period]), "payment_count": count,
                    "loan_proceeds": _cents(entry["proceeds"][period]),
                    "remaining_balance": _cents(balances[loan_id]),
                })
            loan_rows.sort(key=lambda r: (str(r["loan_name"] or ""), r["loan_id"]))
            projection = CashFlowProjection(
                period=period, loan_payments=loan_rows,
                total_principal=_cents(flows["principal"][period]),
                total_interest=_cents(flows["interest"][period]),
                total_payment=_cents(flows["payments"][period]),
                remaining_balance=_cents(debt),
            ).model_dump()
            projection["loan_proceeds"] = _cents(flows["proceeds"][period])
            projections.append(projection)

        db_manager.close_connection(conn)

        return ForecastResponse(
            status="success",
            data={"projections": projections},
            message=f"Retrieved cash flow projections for {len(projections)} periods"
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
      are replaced: they repay the loan's principal less the principal of
      the kept rows (that row's remaining_balance unless the principal was
      changed after it, with a warning; the principal when there is no
      history), are numbered on from its payment_number, re-amortised over
      the months left to maturity and dated on calendar months (installment
      n = start date + n payment periods, day clamped to month end; when the
      history is off that calendar, e.g. after a start date change, they
      continue on the calendar after the last recorded payment, with a
      warning giving the old and new payoff dates).
    * A payment_frequency change after recorded payments continues one new
      period after the last kept payment, to maturity; each installment's
      interest covers the months since the one before (warning).
    * A principal_amount change after recorded payments adds the difference
      to the balance the rebuilt installments repay (warning); 422 when the
      new principal is less than what the kept payments already repaid.
    * 422 when start_date would be after the payment history kept as
      recorded, when the term is not a whole number of payment periods, or
      when the balloon date / payment do not fit the loan (checked on the
      stored loan with the changes applied, only for the fields changed).
    * `?preview=true` (or `"preview": true` in the body) returns the same
      answer without writing anything; the flag is never a loan field.

    Response data: loan_id, preview, changed_fields, changes {field: {from,
    to}}, action ('none' | 'regenerate'), schedule {regenerated, kept_paid,
    kept, removed, added, redated}, before / after {payments, paid, recorded,
    total_payments, total_principal, total_interest, payoff_date (null when
    the last installment leaves money owed), last_payment_date,
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
        # Always take the body flag out (even when the query flag is set), so
        # it is never compared or saved as a loan field.
        body_preview = body.pop('preview', None)
        preview = bool(preview or body_preview)
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
        errors = _cross_field_errors(updated, changed)
        if errors:
            raise HTTPException(status_code=422, detail="; ".join(errors))
        schedule_changed = [f for f in changed if f in SCHEDULE_FIELDS]

        rows = _load_rows(cursor, loan_id)
        if 'start_date' in schedule_changed:
            problem = _start_after_history(_parse_day(updated.get('start_date')), rows)
            if problem:
                raise HTTPException(status_code=422, detail=problem)
        plan = _plan_regeneration(cursor, updated, rows, previous=loan) if schedule_changed else _no_plan(rows)
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
    * rebuilt as in `PUT /loans/{id}` (repaying the principal less the
      principal of the kept rows, so a principal changed after recorded
      payments is kept; numbered on, rest of the term) when the schedule is
      incomplete, has numbering gaps, broken balances (including installments
      that repay a different amount than the principal leaves owed), or no
      rows at all.
    * 422 when the kept rows already repay more than the principal (the
      audit proposes 'fix_loan_terms': correct the principal first).

    A re-dated tail pushed off the loan's own calendar (the next calendar
    date is on or before the last kept payment) warns with the payoff dates.

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
