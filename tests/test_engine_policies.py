"""
Statement policies: annual salaries, employer-only payroll burden,
year-to-date income tax, quantity x price as the revenue truth, and
unknown scenario ids.
"""
import os
import shutil
import sqlite3
import sys
import tempfile

import pytest

_APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir, "app"))
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from app.db.database import DatabaseManager  # noqa: E402
from services import financial_statements as fs  # noqa: E402

F = "F-POL"


@pytest.fixture
def db():
    tmp = tempfile.mkdtemp()
    path = os.path.join(tmp, "pol.db")
    mgr = DatabaseManager(database_path=path, data_dir=tmp)
    mgr.initialize()
    conn = sqlite3.connect(path)
    c = conn.cursor()
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES (?, 'Policy', 1)", (F,))
    c.execute("INSERT INTO customers (customer_id, customer_name, customer_type) VALUES ('C1', 'Acme', 'Dealer')")
    c.execute("INSERT INTO units (unit_id, unit_name, base_price) VALUES ('P1', 'Widget', 100)")
    c.execute("""INSERT INTO payroll_config (config_id, federal_tax_rate, state_tax_rate, social_security_rate, medicare_rate,
                 unemployment_rate, benefits_rate, workers_comp_rate, pay_frequency)
                 VALUES ('CFG', 0.22, 0.06, 0.062, 0.0145, 0.006, 0.0, 0.0175, 'monthly')""")
    conn.commit()
    conn.close()
    yield mgr, path
    shutil.rmtree(tmp, ignore_errors=True)


def _build(mgr, start="2027-01", end="2027-12"):
    conn = mgr.get_connection()
    try:
        return fs.build_statements(conn.cursor(), [F], start, end)
    finally:
        conn.close()


def _exec(path, sql, params=()):
    conn = sqlite3.connect(path)
    conn.execute(sql, params)
    conn.commit()
    conn.close()


def test_annual_salary_is_not_multiplied_by_hours():
    assert fs.annual_base_pay("salary", 80000) == 80000
    # Legacy data stored salaried staff as an hourly equivalent.
    assert fs.annual_base_pay("salary", 40) == 40 * 2080
    assert fs.annual_base_pay("hourly", 30, 40) == 30 * 40 * 52


def test_burden_is_employer_cost_only(db):
    mgr, path = db
    _exec(path, """INSERT INTO payroll (employee_id, employee_name, weekly_hours, hourly_rate, rate_type, start_date, benefits_eligible)
                   VALUES ('E1', 'Pat', 40, 120000, 'salary', '2027-01-01', 1)""")
    stmt = _build(mgr)
    burden = 1 + 0.062 + 0.0145 + 0.006 + 0.0175  # no 22% federal / 6% state withholding
    assert stmt["income_statement"]["totals"]["payroll"] == pytest.approx(120000 * burden, abs=0.05)


def test_income_tax_nets_loss_months_within_the_year(db):
    mgr, path = db
    # Revenue Jan 10,000 (profit), Feb nothing; an admin expense makes Feb a loss.
    _exec(path, """INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id)
                   VALUES ('S1', 'C1', 'P1', '2027-01', 100, 100, 10000, ?)""", (F,))
    _exec(path, "INSERT INTO expense_categories (category_id, category_name, category_type) VALUES ('AD', 'Admin', 'admin_expense')")
    _exec(path, """INSERT INTO expenses (expense_id, expense_name, category_id, amount, frequency, start_date, is_active)
                   VALUES ('X1', 'Rent', 'AD', 4000, 'one_time', '2027-02-01', 1)""")
    _exec(path, """INSERT INTO expense_allocations (allocation_id, expense_id, period, allocated_amount, allocation_type)
                   VALUES ('A1', 'X1', '2027-02', 4000, 'one_time')""")
    _exec(path, """INSERT INTO financial_assumptions (forecast_id, opening_period, income_tax_rate) VALUES (?, '2026-12', 0.25)""", (F,))
    stmt = _build(mgr, "2027-01", "2027-03")
    rows = {r["period"]: r for r in stmt["income_statement"]["by_period"]}
    assert rows["2027-01"]["income_tax"] == pytest.approx(2500)
    assert rows["2027-02"]["income_tax"] == pytest.approx(-1000)  # reverses tax on the loss
    assert stmt["income_statement"]["totals"]["income_tax"] == pytest.approx(0.25 * (10000 - 4000))
    for r in stmt["balance_sheet"]["by_period"]:
        assert abs(r["balance_check"]) < 0.01


def test_tax_never_negative_for_the_year(db):
    mgr, path = db
    _exec(path, "INSERT INTO expense_categories (category_id, category_name, category_type) VALUES ('AD', 'Admin', 'admin_expense')")
    _exec(path, """INSERT INTO expenses (expense_id, expense_name, category_id, amount, frequency, start_date, is_active)
                   VALUES ('X1', 'Rent', 'AD', 4000, 'one_time', '2027-01-01', 1)""")
    _exec(path, """INSERT INTO expense_allocations (allocation_id, expense_id, period, allocated_amount, allocation_type)
                   VALUES ('A1', 'X1', '2027-01', 4000, 'one_time')""")
    stmt = _build(mgr, "2027-01", "2027-02")
    assert all(r["income_tax"] == 0 for r in stmt["income_statement"]["by_period"])


def test_revenue_uses_quantity_times_price_not_a_stale_total(db):
    mgr, path = db
    _exec(path, """INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id)
                   VALUES ('S1', 'C1', 'P1', '2027-01', 20, 100, 1000, ?)""", (F,))  # stale total (was 10 units)
    _exec(path, """INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id)
                   VALUES ('S2', 'C1', 'P1', '2027-02', 5, NULL, 750, ?)""", (F,))  # no price: stored total
    stmt = _build(mgr, "2027-01", "2027-02")
    rows = {r["period"]: r for r in stmt["income_statement"]["by_period"]}
    assert rows["2027-01"]["gross_sales"] == 2000
    assert rows["2027-02"]["gross_sales"] == 750


def test_full_date_period_in_the_last_month_is_counted(db):
    mgr, path = db
    _exec(path, """INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id)
                   VALUES ('S1', 'C1', 'P1', '2027-12-15', 1, 100, 100, ?)""", (F,))
    stmt = _build(mgr)
    assert stmt["income_statement"]["totals"]["gross_sales"] == 100


def test_unknown_scenario_is_rejected(db):
    mgr, _ = db
    conn = mgr.get_connection()
    try:
        with pytest.raises(ValueError, match="Unknown scenario"):
            fs.build_statements(conn.cursor(), ["NOPE"], "2027-01", "2027-12")
    finally:
        conn.close()


def test_non_monthly_periods_are_warned(db):
    mgr, path = db
    _exec(path, """INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id)
                   VALUES ('S1', 'C1', 'P1', '2027-Q1', 1, 100, 100, ?)""", (F,))
    stmt = _build(mgr)
    assert any(w["code"] == "non_monthly_sales_periods" for w in stmt["warnings"])
