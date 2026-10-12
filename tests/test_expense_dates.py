"""Expense schedules on real calendars: month-end start dates, leap days, no drift."""
import os
import sys
from datetime import date
from types import SimpleNamespace

import pytest

_APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir, "app"))
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from api.expense_routes import _occurrence, calculate_next_payment, generate_expense_allocations  # noqa: E402


def _expense(**kw):
    base = dict(start_date="2026-01-31", end_date="2026-12-31", frequency="monthly", expense_allocation="immediate",
                amortization_months=None, amount=100.0)
    base.update(kw)
    return SimpleNamespace(**base)


def _periods(expense):
    return [a["period"] for a in generate_expense_allocations("X", expense)]


def test_monthly_from_the_31st_covers_every_month_without_drift():
    assert _periods(_expense()) == [f"2026-{m:02d}" for m in range(1, 13)]
    assert _occurrence(date(2026, 1, 31), "monthly", 1) == date(2026, 2, 28)
    assert _occurrence(date(2026, 1, 31), "monthly", 2) == date(2026, 3, 31)


@pytest.mark.parametrize("frequency, expected", [
    ("quarterly", ["2026-01", "2026-04", "2026-07", "2026-10"]),
    ("biannually", ["2026-01", "2026-07"]),
    ("annually", ["2026-01"]),
])
def test_other_month_frequencies_from_a_month_end(frequency, expected):
    assert _periods(_expense(frequency=frequency)) == expected


def test_leap_day_annual_and_default_end_date():
    assert _periods(_expense(start_date="2028-02-29", end_date=None, frequency="annually")) == ["2028-02", "2029-02", "2030-02"]


def test_amortized_one_time_from_month_end():
    rows = generate_expense_allocations("X", _expense(frequency="one_time", expense_allocation="amortized", amortization_months=3))
    assert [r["period"] for r in rows] == ["2026-01", "2026-02", "2026-03"]
    assert sum(r["amount"] for r in rows) == pytest.approx(100.0)


def test_next_payment_never_raises_on_month_ends():
    nxt, amount = calculate_next_payment("2020-01-31", "monthly", 50.0)
    assert nxt is not None and amount == 50.0
