"""
Financial statements engine + reporting route tests.

Seeds an isolated SQLite database with a small but complete company:
one product with BOM + routing, one customer, a hired-mid-window employee,
an overhead expense, an admin expense, an amortizing loan, a capex item,
and opening balances. Then checks the statements the engine builds
against hand-computed numbers and accounting identities.
"""
import os
import sys
import tempfile
import shutil
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

_APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir, "app"))
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from app.db.database import DatabaseManager  # noqa: E402
from services import financial_statements as fs  # noqa: E402


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------

FORECAST = "F-TEST"
WINDOW = ("2026-01", "2026-03")


def _seed(db_path: str) -> None:
    import sqlite3
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys=ON")
    c = conn.cursor()

    c.execute("INSERT INTO forecast (forecast_id, name) VALUES (?, ?)", (FORECAST, "Test"))
    c.execute("INSERT INTO forecast (forecast_id, name) VALUES (?, ?)", ("F-OTHER", "Other"))
    c.execute("INSERT INTO customers (customer_id, customer_name) VALUES ('C1', 'Acme')")
    c.execute("""INSERT INTO units (unit_id, unit_name, base_price, bom_id, bom_version, router_id, router_version)
                 VALUES ('P1', 'Widget', 100, 'BOM1', '1.0', 'R1', '1.0')""")
    # BOM: $20 material per unit
    c.execute("INSERT INTO bom_definitions (bom_id, bom_name, version) VALUES ('BOM1', 'Widget BOM', '1.0')")
    c.execute("""INSERT INTO bom (bom_id, version, bom_line, material_description, qty, unit, unit_price, material_cost, target_cost)
                 VALUES ('BOM1', '1.0', 1, 'Steel', 2, 'ea', 10, 20, 20)""")
    # Router: one op, 30 labor minutes @ $40/h = $20, 15 machine minutes @ $60/h = $15
    c.execute("INSERT INTO router_definitions (router_id, router_name, version) VALUES ('R1', 'Widget Router', '1.0')")
    c.execute("INSERT INTO machines (machine_id, machine_name, machine_rate) VALUES ('M1', 'Press', 60)")
    c.execute("INSERT INTO labor_rates (rate_id, rate_name, rate_amount, rate_type) VALUES ('L1', 'Operator', 40, 'hourly')")
    c.execute("""INSERT INTO router_operations (router_id, sequence, machine_id, machine_minutes, labor_minutes, labor_type_id, operation_description)
                 VALUES ('R1', 1, 'M1', 15, 30, 'L1', 'Form')""")

    # Sales: 10 units Jan, 20 Feb, 0 Mar @ $100. Another scenario's sales must be ignored.
    c.execute("INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id) VALUES ('S1','C1','P1','2026-01',10,100,1000,?)", (FORECAST,))
    c.execute("INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id) VALUES ('S2','C1','P1','2026-02',20,100,2000,?)", (FORECAST,))
    c.execute("INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id) VALUES ('S3','C1','P1','2026-02',99,100,9900,'F-OTHER')")

    # Payroll config: zero burden so numbers are easy; monthly pay.
    c.execute("""INSERT INTO payroll_config (config_id, federal_tax_rate, state_tax_rate, social_security_rate, medicare_rate,
                 unemployment_rate, benefits_rate, workers_comp_rate, pay_frequency)
                 VALUES ('CFG', 0, 0, 0, 0, 0, 0, 0, 'monthly')""")
    # Employee hired Feb 1: $30/h * 40h * 52 = $62,400/yr = $5,200/month. Not in Jan.
    c.execute("""INSERT INTO payroll (employee_id, employee_name, department, weekly_hours, hourly_rate, rate_type, start_date, benefits_eligible, forecast_id)
                 VALUES ('E1', 'Pat', 'Ops', 40, 30, 'hourly', '2026-02-01', 0, NULL)""")
    # Employee on another scenario must be ignored.
    c.execute("""INSERT INTO payroll (employee_id, employee_name, department, weekly_hours, hourly_rate, rate_type, start_date, benefits_eligible, forecast_id)
                 VALUES ('E2', 'Sam', 'Ops', 40, 99, 'hourly', '2026-01-01', 0, 'F-OTHER')""")

    # Expenses: factory overhead $300/mo, admin $100/mo (company-wide, NULL forecast)
    c.execute("INSERT INTO expense_categories (category_id, category_name, category_type) VALUES ('FO', 'Rent', 'factory_overhead')")
    c.execute("INSERT INTO expense_categories (category_id, category_name, category_type) VALUES ('AD', 'Software', 'admin_expense')")
    c.execute("""INSERT INTO expenses (expense_id, expense_name, category_id, amount, frequency, start_date, is_active, forecast_id)
                 VALUES ('X1', 'Rent', 'FO', 300, 'monthly', '2026-01-01', 1, NULL)""")
    c.execute("""INSERT INTO expenses (expense_id, expense_name, category_id, amount, frequency, start_date, is_active, forecast_id)
                 VALUES ('X2', 'Software', 'AD', 100, 'monthly', '2026-01-01', 1, NULL)""")
    for i, p in enumerate(["2026-01", "2026-02", "2026-03"]):
        c.execute("INSERT INTO expense_allocations (allocation_id, expense_id, period, allocated_amount, allocation_type) VALUES (?, 'X1', ?, 300, 'scheduled')", (f"A{i}", p))
        c.execute("INSERT INTO expense_allocations (allocation_id, expense_id, period, allocated_amount, allocation_type) VALUES (?, 'X2', ?, 100, 'scheduled')", (f"B{i}", p))

    # Loan: $10,000 originated 2025-06, 3 scheduled payments in window: $500 principal + $50 interest each.
    c.execute("""INSERT INTO loans (loan_id, loan_name, lender, loan_type, principal_amount, interest_rate, loan_term_months, start_date,
                 payment_type, is_active, current_balance, next_payment_date, monthly_payment_amount)
                 VALUES ('LN1', 'Term', 'Bank', 'term_loan', 10000, 0.06, 20, '2025-06-01', 'amortizing', 1, 9000, '2026-01-15', 550)""")
    # Two payments before the window leave a balance of 9,000.
    sched = [(1, '2025-11-15', 9500), (2, '2025-12-15', 9000), (3, '2026-01-15', 8500), (4, '2026-02-15', 8000), (5, '2026-03-15', 7500)]
    for n, d, rem in sched:
        c.execute("""INSERT INTO loan_payments (payment_id, loan_id, payment_number, payment_date, payment_amount, principal_payment, interest_payment, remaining_balance)
                     VALUES (?, 'LN1', ?, ?, 550, 500, 50, ?)""", (f"PM{n}", n, d, rem))

    # Capex: $1,200 machine bought Feb, 12 month life => $100/mo from Feb.
    c.execute("""INSERT INTO capital_expenditures (capex_id, forecast_id, asset_name, amount, purchase_period, useful_life_months)
                 VALUES ('CX1', ?, 'Lathe', 1200, '2026-02', 12)""", (FORECAST,))

    # Assumptions: balances as at end of Dec 2025 (so the model starts Jan 2026): opening cash 5,000,
    # AR 1,000, AP 400, 30/30/30 days, 25% tax, equity plugged.
    c.execute("""INSERT INTO financial_assumptions (forecast_id, opening_period, opening_cash, opening_accounts_receivable, opening_inventory,
                 opening_accounts_payable, dso_days, dio_days, dpo_days, income_tax_rate, minimum_cash_balance)
                 VALUES (?, '2025-12', 5000, 1000, 0, 400, 30, 30, 30, 0.25, 4000)""", (FORECAST,))

    conn.commit()
    conn.close()


@pytest.fixture(scope="module")
def engine_db():
    tmp = tempfile.mkdtemp()
    db_path = os.path.join(tmp, "fs.db")
    mgr = DatabaseManager(database_path=db_path, data_dir=tmp)
    mgr.initialize()
    _seed(db_path)
    yield mgr
    shutil.rmtree(tmp, ignore_errors=True)


@pytest.fixture(scope="module")
def client(engine_db):
    import app.db.database as dbmod
    original = dbmod.db_manager
    dbmod.db_manager = engine_db
    import db.database as dbmod_short
    original_short = dbmod_short.db_manager
    dbmod_short.db_manager = engine_db
    from api import reporting_routes, payroll_routes
    reporting_routes.db_manager = engine_db
    payroll_routes.db_manager = engine_db
    app = FastAPI()
    app.include_router(reporting_routes.router)
    app.include_router(payroll_routes.router)
    yield TestClient(app)
    dbmod.db_manager = original
    dbmod_short.db_manager = original_short


@pytest.fixture(scope="module")
def statements(engine_db):
    conn = engine_db.get_connection()
    try:
        return fs.build_statements(conn.cursor(), [FORECAST], *WINDOW)
    finally:
        conn.close()


def _row(stmt, section, period):
    return next(r for r in stmt[section]["by_period"] if r["period"] == period)


# ---------------------------------------------------------------------------
# Period helpers
# ---------------------------------------------------------------------------

class TestPeriods:
    def test_range_inclusive_across_year(self):
        assert fs.period_range("2025-11", "2026-02") == ["2025-11", "2025-12", "2026-01", "2026-02"]

    def test_bad_period_rejected(self):
        with pytest.raises(ValueError):
            fs.period_range("2026-13", "2026-14")
        with pytest.raises(ValueError):
            fs.period_range("2026-03", "2026-01")

    def test_shift_and_months_between(self):
        assert fs.shift_period("2026-01", -1) == "2025-12"
        assert fs.months_between("2026-02", "2027-01") == 11


# ---------------------------------------------------------------------------
# Income statement
# ---------------------------------------------------------------------------

class TestIncomeStatement:
    def test_revenue_scoped_to_scenario(self, statements):
        assert _row(statements, "income_statement", "2026-01")["revenue"] == 1000
        assert _row(statements, "income_statement", "2026-02")["revenue"] == 2000
        assert _row(statements, "income_statement", "2026-03")["revenue"] == 0
        assert statements["income_statement"]["totals"]["revenue"] == 3000

    def test_product_cogs_from_bom_and_routing(self, statements):
        jan = _row(statements, "income_statement", "2026-01")
        # 10 units: $20 material, $20 labor, $15 machine each
        assert jan["cogs_materials"] == 200
        assert jan["cogs_labor"] == 200
        assert jan["cogs_manufacturing"] == 150
        assert jan["factory_overhead"] == 300
        assert jan["total_cogs"] == 850
        assert jan["gross_profit"] == 150

    def test_payroll_prorated_to_window_not_annualized(self, statements):
        # Hired Feb 1 -> nothing in Jan, $5,200 in Feb and Mar. Other scenario's employee excluded.
        assert _row(statements, "income_statement", "2026-01")["payroll"] == 0
        assert _row(statements, "income_statement", "2026-02")["payroll"] == 5200
        assert _row(statements, "income_statement", "2026-03")["payroll"] == 5200
        assert statements["income_statement"]["totals"]["payroll"] == 10400

    def test_depreciation_starts_in_purchase_month(self, statements):
        assert _row(statements, "income_statement", "2026-01")["depreciation"] == 0
        assert _row(statements, "income_statement", "2026-02")["depreciation"] == 100
        assert _row(statements, "income_statement", "2026-03")["depreciation"] == 100

    def test_tax_only_on_positive_income(self, statements):
        jan = _row(statements, "income_statement", "2026-01")
        # GP 150 - admin 100 - interest 50 = 0 pre-tax -> no tax
        assert jan["pre_tax_income"] == 0
        assert jan["income_tax"] == 0
        feb = _row(statements, "income_statement", "2026-02")
        assert feb["pre_tax_income"] < 0
        assert feb["income_tax"] == 0

    def test_net_income_identity(self, statements):
        for r in statements["income_statement"]["by_period"]:
            assert r["net_income"] == pytest.approx(r["pre_tax_income"] - r["income_tax"], abs=0.01)
            assert r["operating_income"] == pytest.approx(r["gross_profit"] - r["total_operating_expenses"], abs=0.01)


# ---------------------------------------------------------------------------
# Cash flow and balance sheet
# ---------------------------------------------------------------------------

class TestCashAndBalance:
    def test_opening_balance_sheet_balances_with_plugged_equity(self, statements):
        opening = statements["balance_sheet"]["opening"]
        assert opening["debt"] == 9000
        assert opening["equity_plugged"] is True
        assert opening["total_assets"] == pytest.approx(opening["total_liabilities"] + opening["equity"], abs=0.01)

    def test_balance_sheet_balances_every_period(self, statements):
        for r in statements["balance_sheet"]["by_period"]:
            assert abs(r["balance_check"]) < 0.01, r

    def test_opening_row_has_same_keys_as_period_rows(self, statements):
        opening = statements["balance_sheet"]["opening"]
        period_keys = set(statements["balance_sheet"]["by_period"][0].keys())
        assert period_keys <= set(opening.keys())
        assert abs(opening["balance_check"]) < 0.01

    def test_cash_rolls_forward(self, statements):
        cash = statements["balance_sheet"]["opening"]["cash"]
        for cf, bs in zip(statements["cash_flow"]["by_period"], statements["balance_sheet"]["by_period"]):
            assert cf["opening_cash"] == pytest.approx(cash, abs=0.01)
            cash = cash + cf["net_cash_flow"]
            assert cf["closing_cash"] == pytest.approx(cash, abs=0.01)
            assert bs["cash"] == pytest.approx(cash, abs=0.01)
        assert statements["cash_flow"]["totals"]["closing_cash"] == pytest.approx(cash, abs=0.01)

    def test_debt_reduced_by_principal_only(self, statements):
        bs = statements["balance_sheet"]["by_period"]
        assert bs[0]["debt"] == 8500
        assert bs[2]["debt"] == 7500
        cf = statements["cash_flow"]["by_period"][0]
        assert cf["principal_payments"] == -500
        assert cf["financing_cash_flow"] == -500

    def test_capex_hits_cash_and_fixed_assets(self, statements):
        feb_cf = _row(statements, "cash_flow", "2026-02")
        assert feb_cf["capex"] == -1200
        feb_bs = _row(statements, "balance_sheet", "2026-02")
        assert feb_bs["fixed_assets_gross"] == 1200
        assert feb_bs["accumulated_depreciation"] == 100
        assert feb_bs["fixed_assets_net"] == 1100

    def test_working_capital_uses_days_assumptions(self, statements):
        jan = _row(statements, "balance_sheet", "2026-01")
        expected_ar = 1000 * 30 / fs.AVG_DAYS_PER_MONTH
        assert jan["accounts_receivable"] == pytest.approx(expected_ar, abs=0.01)
        jan_cf = _row(statements, "cash_flow", "2026-01")
        # AR fell from 1,000 opening to ~986 -> small cash inflow
        assert jan_cf["change_in_accounts_receivable"] == pytest.approx(1000 - expected_ar, abs=0.01)

    def test_cash_below_minimum_warning(self, statements):
        codes = {w["code"] for w in statements["warnings"]}
        assert "cash_below_minimum" in codes
        assert "default_assumptions" not in codes


class TestDefaults:
    def test_missing_assumptions_warns_and_uses_defaults(self, engine_db):
        conn = engine_db.get_connection()
        try:
            stmt = fs.build_statements(conn.cursor(), ["F-OTHER"], "2026-02", "2026-02")
        finally:
            conn.close()
        assert any(w["code"] == "default_assumptions" for w in stmt["warnings"])
        assert stmt["assumptions"]["income_tax_rate"] == 0.21
        assert stmt["income_statement"]["totals"]["revenue"] == 9900
        for r in stmt["balance_sheet"]["by_period"]:
            assert abs(r["balance_check"]) < 0.01

    def test_no_forecast_rejected(self, engine_db):
        conn = engine_db.get_connection()
        try:
            with pytest.raises(ValueError):
                fs.build_statements(conn.cursor(), [], "2026-01", "2026-01")
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

class TestReportingRoutes:
    def test_statements_endpoint(self, client):
        r = client.get("/reporting/statements", params={"forecast_ids": FORECAST, "start_period": "2026-01", "end_period": "2026-03"})
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["periods"] == ["2026-01", "2026-02", "2026-03"]
        assert data["income_statement"]["totals"]["revenue"] == 3000

    def test_statements_comma_separated_ids(self, client):
        r = client.get("/reporting/statements", params={"forecast_ids": f"{FORECAST},F-OTHER", "start_period": "2026-02", "end_period": "2026-02"})
        assert r.status_code == 200
        assert r.json()["data"]["income_statement"]["totals"]["revenue"] == 11900

    def test_statements_bad_window(self, client):
        r = client.get("/reporting/statements", params={"forecast_ids": FORECAST, "start_period": "2026-03", "end_period": "2026-01"})
        assert r.status_code == 422

    def test_export_csv(self, client):
        r = client.get("/reporting/statements/export", params={"forecast_ids": FORECAST, "start_period": "2026-01", "end_period": "2026-02"})
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        assert "Income Statement,2026-01,2026-02,Total" in r.text
        assert "\nrevenue,1000" in r.text

    def test_assumptions_roundtrip(self, client):
        r = client.get("/reporting/assumptions", params={"forecast_id": "F-OTHER"})
        assert r.status_code == 200
        assert r.json()["data"]["assumptions"]["found"] is False

        payload = {"opening_cash": 12345, "dso_days": 45, "income_tax_rate": 0.3, "opening_period": "2026-01"}
        r = client.put("/reporting/assumptions", params={"forecast_id": "F-OTHER"}, json=payload)
        assert r.status_code == 200, r.text
        r = client.get("/reporting/assumptions", params={"forecast_id": "F-OTHER"})
        a = r.json()["data"]["assumptions"]
        assert a["found"] is True and a["opening_cash"] == 12345 and a["dso_days"] == 45

        r = client.put("/reporting/assumptions", params={"forecast_id": "NOPE"}, json=payload)
        assert r.status_code == 404

    def test_capex_crud(self, client):
        r = client.post("/reporting/capex", json={"asset_name": "Truck", "amount": 50000, "purchase_period": "2026-06", "useful_life_months": 60, "forecast_id": "F-OTHER"})
        assert r.status_code == 200, r.text
        capex_id = r.json()["data"]["capex_id"]
        r = client.get("/reporting/capex", params={"forecast_id": "F-OTHER"})
        assert any(i["capex_id"] == capex_id for i in r.json()["data"]["capex"])
        r = client.put(f"/reporting/capex/{capex_id}", json={"amount": 55000})
        assert r.status_code == 200
        r = client.post("/reporting/capex", json={"asset_name": "Bad", "amount": 1, "purchase_period": "June"})
        assert r.status_code == 422
        r = client.delete(f"/reporting/capex/{capex_id}")
        assert r.status_code == 200
        r = client.delete(f"/reporting/capex/{capex_id}")
        assert r.status_code == 404

    def test_actuals_and_variance(self, client):
        entries = [
            {"period": "2026-01", "line_item": "revenue", "amount": 1100},
            {"period": "2026-01", "line_item": "payroll", "amount": 50},
        ]
        r = client.post("/reporting/actuals", json={"entries": entries})
        assert r.status_code == 200, r.text
        # Upsert overwrites
        r = client.post("/reporting/actuals", json={"entries": [{"period": "2026-01", "line_item": "revenue", "amount": 1200}]})
        assert r.status_code == 200
        r = client.get("/reporting/actuals", params={"start_period": "2026-01", "end_period": "2026-01"})
        rows = r.json()["data"]["actuals"]
        assert len(rows) == 2
        assert next(x for x in rows if x["line_item"] == "revenue")["amount"] == 1200

        r = client.post("/reporting/actuals", json={"entries": [{"period": "2026-01", "line_item": "bogus", "amount": 1}]})
        assert r.status_code == 422

        r = client.get("/reporting/variance", params={"forecast_ids": FORECAST, "start_period": "2026-01", "end_period": "2026-03"})
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["periods_with_actuals"] == ["2026-01"]
        revenue = next(l for l in data["line_items"] if l["line_item"] == "revenue")
        jan = revenue["by_period"][0]
        assert jan["budget"] == 1000 and jan["actual"] == 1200 and jan["variance"] == 200 and jan["favorable"] is True
        assert revenue["by_period"][1]["actual"] is None
        assert revenue["totals"]["budget_to_date"] == 1000  # only Jan, not the full 3,000
        payroll = next(l for l in data["line_items"] if l["line_item"] == "payroll")
        assert payroll["by_period"][0]["variance"] == 50 and payroll["by_period"][0]["favorable"] is False

    def test_actuals_csv_import(self, client):
        csv_text = "period,line_item,amount,notes\n2026-02,revenue,\"2,100\",from GL\n2026-02,admin_expense,90,\n2026-02,revenue,oops,\n"
        r = client.post("/reporting/actuals/import", files={"file": ("actuals.csv", csv_text, "text/csv")})
        assert r.status_code == 200, r.text
        assert r.json()["data"]["imported"] == 2
        assert len(r.json()["data"]["errors"]) == 1
        r = client.delete("/reporting/actuals", params={"period": "2026-02"})
        assert r.json()["data"]["deleted"] == 2

    def test_line_items_listed(self, client):
        r = client.get("/reporting/actuals/line-items")
        assert any(i["line_item"] == "net_income" for i in r.json()["data"]["line_items"])


class TestPayrollRoute:
    def test_monthly_mode_matches_engine(self, client):
        r = client.get("/payroll/forecast", params={"forecast_id": FORECAST, "start_period": "2026-01", "end_period": "2026-03"})
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["mode"] == "monthly"
        assert [m["total_cost"] for m in data["forecast"]] == [0, 5200, 5200]
        assert data["total_cost"] == 10400

    def test_pay_period_mode_uses_frequency(self, client):
        r = client.get("/payroll/forecast", params={"periods": 3})
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["mode"] == "pay_period"
        assert data["pay_frequency"] == "monthly"
        assert len(data["forecast"]) == 3

    def test_config_roundtrip_with_pay_frequency(self, client):
        r = client.post("/payroll/config", json={"pay_frequency": "weekly", "benefits_rate": 0.1})
        assert r.status_code == 200, r.text
        r = client.get("/payroll/config")
        assert r.json()["data"]["config"]["pay_frequency"] == "weekly"
        # restore so other tests in the module are unaffected
        r = client.post("/payroll/config", json={"pay_frequency": "monthly", "federal_tax_rate": 0, "state_tax_rate": 0,
                                                 "social_security_rate": 0, "medicare_rate": 0, "unemployment_rate": 0,
                                                 "benefits_rate": 0, "workers_comp_rate": 0})
        assert r.status_code == 200, r.text  # two saves in the same second must not collide
        assert client.get("/payroll/config").json()["data"]["config"]["pay_frequency"] == "monthly"


class TestScenarioComparison:
    @pytest.fixture(scope="class")
    def cmp_client(self, engine_db):
        import db.database as dbmod_short
        original = dbmod_short.db_manager
        dbmod_short.db_manager = engine_db
        from api import forecast_routes
        app = FastAPI()
        app.include_router(forecast_routes.router)
        yield TestClient(app)
        dbmod_short.db_manager = original

    def test_comparison_uses_engine_totals(self, cmp_client):
        r = cmp_client.get("/forecast/comparison", params={"forecast_ids": f"{FORECAST},F-OTHER"})
        assert r.status_code == 200, r.text
        rows = {row["forecast_id"]: row for row in r.json()["data"]["comparison"]}
        # F-TEST sales span Jan-Feb; payroll is the Feb hire only (not annualized)
        assert rows[FORECAST]["start_period"] == "2026-01" and rows[FORECAST]["end_period"] == "2026-02"
        assert rows[FORECAST]["revenue"] == 3000
        assert rows[FORECAST]["payroll"] == 5200
        assert rows["F-OTHER"]["revenue"] == 9900

    def test_comparison_explicit_window(self, cmp_client):
        r = cmp_client.get("/forecast/comparison", params={"forecast_ids": FORECAST, "start_period": "2026-03", "end_period": "2026-03"})
        assert r.status_code == 200
        row = r.json()["data"]["comparison"][0]
        assert row["revenue"] == 0 and row["payroll"] == 5200


# ---------------------------------------------------------------------------
# Carry-forward: a window must not change the balances it reports
# ---------------------------------------------------------------------------

BALANCE_KEYS = ("cash", "accounts_receivable", "inventory", "fixed_assets_gross", "accumulated_depreciation",
                "accounts_payable", "debt", "opening_equity", "retained_earnings", "total_equity", "total_assets",
                "total_liabilities", "balance_check")


def _build(engine_db, ids, start, end):
    conn = engine_db.get_connection()
    try:
        return fs.build_statements(conn.cursor(), ids, start, end)
    finally:
        conn.close()


class TestCarryForward:
    def test_march_only_matches_march_in_full_window(self, engine_db, statements):
        march_only = _build(engine_db, [FORECAST], "2026-03", "2026-03")
        assert march_only["carry_forward"] == {
            "opening_period": "2025-12",
            "balances_as_of": "2026-02",
            "rolled_forward_periods": ["2026-01", "2026-02"],
            "months_rolled_forward": 2,
        }
        full_mar = _row(statements, "balance_sheet", "2026-03")
        only_mar = march_only["balance_sheet"]["by_period"][0]
        for key in BALANCE_KEYS:
            assert only_mar[key] == pytest.approx(full_mar[key], abs=0.01), key
        # Income statement and cash flow for March are identical too.
        assert march_only["income_statement"]["by_period"][0] == _row(statements, "income_statement", "2026-03")
        assert march_only["cash_flow"]["by_period"][0] == _row(statements, "cash_flow", "2026-03")
        assert march_only["cash_flow"]["totals"]["closing_cash"] == full_mar["cash"]

    def test_opening_column_is_the_carried_february_balance(self, engine_db, statements):
        march_only = _build(engine_db, [FORECAST], "2026-03", "2026-03")
        opening = march_only["balance_sheet"]["opening"]
        feb = _row(statements, "balance_sheet", "2026-02")
        assert opening["period"] == "2026-02"
        for key in BALANCE_KEYS:
            assert opening[key] == pytest.approx(feb[key], abs=0.01), key
        # Not the stated opening balances: cash moved, debt was paid down, the lathe was bought and depreciated,
        # and two months of results sit in retained earnings.
        assert opening["cash"] != 5000
        assert opening["debt"] == 8000
        assert opening["fixed_assets_gross"] == 1200 and opening["accumulated_depreciation"] == 100
        assert opening["retained_earnings"] == pytest.approx(
            _row(statements, "income_statement", "2026-01")["net_income"] + _row(statements, "income_statement", "2026-02")["net_income"], abs=0.01)
        assert opening["equity_plugged"] is True
        assert abs(opening["balance_check"]) < 0.01
        assert march_only["cash_flow"]["by_period"][0]["opening_cash"] == pytest.approx(feb["cash"], abs=0.01)

    def test_every_single_month_window_matches_the_full_window(self, engine_db, statements):
        for period in ["2026-01", "2026-02", "2026-03"]:
            single = _build(engine_db, [FORECAST], period, period)
            full = _row(statements, "balance_sheet", period)
            for key in BALANCE_KEYS:
                assert single["balance_sheet"]["by_period"][0][key] == pytest.approx(full[key], abs=0.01), (period, key)
            assert abs(single["balance_sheet"]["by_period"][0]["balance_check"]) < 0.01

    def test_detail_is_limited_to_the_window(self, engine_db):
        march_only = _build(engine_db, [FORECAST], "2026-03", "2026-03")
        # No sales in March, so no product/customer detail even though Jan/Feb were rolled forward.
        assert march_only["detail"]["revenue_by_product"] == {}
        assert march_only["detail"]["revenue_by_customer"] == {}
        rent = march_only["detail"]["expenses_by_category"]["Rent"]
        assert list(rent["by_period"].keys()) == ["2026-03"] and rent["total"] == 300
        assert list(march_only["detail"]["payroll_headcount"].keys()) == ["2026-03"]
        assert march_only["income_statement"]["totals"]["revenue"] == 0
        assert march_only["income_statement"]["totals"]["payroll"] == 5200
        # The lathe was bought in February: carried into the balance sheet, but not purchased in this window.
        lathe = next(i for i in march_only["detail"]["capex_items"] if i["capex_id"] == "CX1")
        assert lathe["in_window"] is False
        assert list(lathe["depreciation_by_period"].keys()) == ["2026-03"]
        # The loan detail opens at the window start (after the Jan and Feb payments), matching the balance sheet.
        loan = march_only["detail"]["loans"]["LN1"]
        assert loan["opening_balance"] == 8000 == march_only["balance_sheet"]["opening"]["debt"]
        assert list(loan["principal"].keys()) == ["2026-03"] and loan["principal"]["2026-03"] == 500

    def test_detail_flags_match_a_window_that_starts_at_the_opening(self, statements):
        lathe = next(i for i in statements["detail"]["capex_items"] if i["capex_id"] == "CX1")
        assert lathe["in_window"] is True
        assert statements["detail"]["loans"]["LN1"]["opening_balance"] == 9000 == statements["balance_sheet"]["opening"]["debt"]

    def test_warnings_only_for_the_window(self, engine_db):
        # Cash dips below the 4,000 minimum from Feb; a Jan-only window must not report Feb.
        jan_only = _build(engine_db, [FORECAST], "2026-01", "2026-01")
        assert not any(w["code"] == "cash_below_minimum" for w in jan_only["warnings"])
        march_only = _build(engine_db, [FORECAST], "2026-03", "2026-03")
        shortfall = next(w for w in march_only["warnings"] if w["code"] == "cash_below_minimum")
        assert shortfall["periods"] == ["2026-03"]

    def test_window_before_opening_period_warns(self, engine_db):
        stmt = _build(engine_db, [FORECAST], "2025-11", "2025-12")
        codes = {w["code"] for w in stmt["warnings"]}
        assert "window_before_opening" in codes
        assert stmt["carry_forward"]["months_rolled_forward"] == 0
        assert stmt["balance_sheet"]["opening"]["cash"] == 5000

    def test_unset_opening_period_warns(self, engine_db):
        conn = engine_db.get_connection()
        c = conn.cursor()
        c.execute("INSERT INTO forecast (forecast_id, name) VALUES ('F-NOOPEN', 'No opening period')")
        c.execute("INSERT INTO financial_assumptions (forecast_id, opening_cash) VALUES ('F-NOOPEN', 100)")
        c.execute("INSERT INTO forecast (forecast_id, name) VALUES ('F-NOASSUMP', 'No assumptions at all')")
        conn.commit()
        try:
            stmt = fs.build_statements(c, ["F-NOOPEN"], "2026-03", "2026-03")
            codes = {w["code"] for w in stmt["warnings"]}
            assert "opening_period_unset" in codes
            assert "default_assumptions" not in codes
            assert stmt["carry_forward"]["months_rolled_forward"] == 0
            # Without saved assumptions the default warning carries the hint instead of a second warning.
            other = fs.build_statements(c, ["F-NOASSUMP"], "2026-03", "2026-03")
            other_codes = [w["code"] for w in other["warnings"]]
            assert "default_assumptions" in other_codes and "opening_period_unset" not in other_codes
            assert "opening period" in next(w for w in other["warnings"] if w["code"] == "default_assumptions")["message"]
        finally:
            c.execute("DELETE FROM financial_assumptions WHERE forecast_id = 'F-NOOPEN'")
            c.execute("DELETE FROM forecast WHERE forecast_id IN ('F-NOOPEN', 'F-NOASSUMP')")
            conn.commit()
            conn.close()

    def test_opening_assets_depreciate_through_the_carried_months(self, engine_db):
        conn = engine_db.get_connection()
        c = conn.cursor()
        c.execute("INSERT INTO forecast (forecast_id, name) VALUES ('F-ASSET', 'Asset base')")
        # $2,400 net opening fixed assets with 24 months left => $100/month from Jan 2026.
        c.execute("""INSERT INTO financial_assumptions (forecast_id, opening_period, opening_cash, opening_fixed_assets,
                     opening_accumulated_depreciation, opening_fixed_assets_remaining_life_months, income_tax_rate)
                     VALUES ('F-ASSET', '2025-12', 10000, 3000, 600, 24, 0)""")
        conn.commit()
        try:
            full = fs.build_statements(c, ["F-ASSET"], "2026-01", "2026-12")
            june_only = fs.build_statements(c, ["F-ASSET"], "2026-06", "2026-06")
            full_june = _row(full, "balance_sheet", "2026-06")
            only_june = june_only["balance_sheet"]["by_period"][0]
            assert only_june["accumulated_depreciation"] == pytest.approx(600 + 6 * 100, abs=0.01)
            assert only_june["accumulated_depreciation"] == pytest.approx(full_june["accumulated_depreciation"], abs=0.01)
            assert june_only["balance_sheet"]["opening"]["accumulated_depreciation"] == pytest.approx(600 + 5 * 100, abs=0.01)
            assert june_only["income_statement"]["by_period"][0]["depreciation"] == 100
            # Company-wide payroll, expenses and the loan apply to this scenario too; the carried
            # retained earnings are the same five months of results the full window shows.
            assert june_only["balance_sheet"]["opening"]["retained_earnings"] == pytest.approx(
                _row(full, "balance_sheet", "2026-05")["retained_earnings"], abs=0.01)
            assert only_june["retained_earnings"] == pytest.approx(full_june["retained_earnings"], abs=0.01)
            assert only_june["cash"] == pytest.approx(full_june["cash"], abs=0.01)
            assert abs(only_june["balance_check"]) < 0.01
        finally:
            c.execute("DELETE FROM financial_assumptions WHERE forecast_id = 'F-ASSET'")
            c.execute("DELETE FROM forecast WHERE forecast_id = 'F-ASSET'")
            conn.commit()
            conn.close()


# ---------------------------------------------------------------------------
# Cash flow aggregation
# ---------------------------------------------------------------------------

class TestCashAggregation:
    def test_totals_use_balances_not_sums_of_balances(self, statements):
        rows = statements["cash_flow"]["by_period"]
        totals = statements["cash_flow"]["totals"]
        assert totals["opening_cash"] == rows[0]["opening_cash"] == 5000
        assert totals["closing_cash"] == rows[-1]["closing_cash"]
        assert totals["closing_cash"] != pytest.approx(sum(r["closing_cash"] for r in rows), abs=0.01)
        # Flows are summed.
        assert totals["net_cash_flow"] == pytest.approx(sum(r["net_cash_flow"] for r in rows), abs=0.01)
        assert totals["operating_cash_flow"] == pytest.approx(sum(r["operating_cash_flow"] for r in rows), abs=0.01)

    def test_opening_plus_movements_reconciles_to_closing(self, statements, engine_db):
        for stmt in (statements, _build(engine_db, [FORECAST], "2026-02", "2026-03")):
            rec = stmt["cash_flow"]["reconciliation"]
            assert rec["opening_cash"] == stmt["balance_sheet"]["opening"]["cash"]
            assert rec["closing_cash"] == stmt["balance_sheet"]["closing"]["cash"]
            # Each figure is rounded to cents independently, so allow a cent of display rounding;
            # the engine's own difference is computed before rounding and must be zero.
            assert rec["opening_cash"] + rec["net_cash_flow"] == pytest.approx(rec["closing_cash"], abs=0.02)
            assert rec["difference"] == 0
            assert rec["net_cash_flow"] == stmt["cash_flow"]["totals"]["net_cash_flow"]

    def test_csv_export_total_column_carries_closing_balance(self, client, statements):
        r = client.get("/reporting/statements/export", params={"forecast_ids": FORECAST, "start_period": "2026-01", "end_period": "2026-03"})
        assert r.status_code == 200
        rows = {line.split(",")[0]: line.split(",") for line in r.text.splitlines() if line}
        closing = statements["cash_flow"]["by_period"][-1]["closing_cash"]
        assert float(rows["closing_cash"][-1]) == pytest.approx(closing, abs=0.01)
        assert float(rows["opening_cash"][-1]) == pytest.approx(5000, abs=0.01)
        assert float(rows["net_cash_flow"][-1]) == pytest.approx(closing - 5000, abs=0.01)


# ---------------------------------------------------------------------------
# Incomplete actuals
# ---------------------------------------------------------------------------

class TestVarianceCoverage:
    @pytest.fixture
    def partial_actuals(self, client):
        for p in ("2026-01", "2026-02", "2026-03"):
            client.delete("/reporting/actuals", params={"period": p})
        entries = [
            {"period": "2026-01", "line_item": "revenue", "amount": 1100},        # January revenue only
            {"period": "2026-01", "line_item": "admin_expense", "amount": 0},     # confirmed zero, not missing
            {"period": "2026-02", "line_item": "payroll", "amount": 5000},        # February payroll only
        ]
        assert client.post("/reporting/actuals", json={"entries": entries}).status_code == 200
        yield
        for p in ("2026-01", "2026-02", "2026-03"):
            client.delete("/reporting/actuals", params={"period": p})

    def _line(self, data, key):
        return next(l for l in data["line_items"] if l["line_item"] == key)

    def test_missing_months_are_not_zero(self, client, partial_actuals):
        data = client.get("/reporting/variance", params={"forecast_ids": FORECAST, "start_period": "2026-01", "end_period": "2026-03"}).json()["data"]
        assert data["periods_with_actuals"] == ["2026-01", "2026-02"]
        assert data["actuals_through"] == "2026-02"

        revenue = self._line(data, "revenue")
        assert revenue["coverage"] == "partial"
        assert revenue["by_period"][0]["actual"] == 1100 and revenue["by_period"][1]["actual"] is None
        assert revenue["by_period"][1]["variance"] is None and revenue["by_period"][1]["favorable"] is None
        # To date compares January only, never Jan+Feb budget against a Jan-only actual.
        assert revenue["totals"]["periods_compared"] == ["2026-01"]
        assert revenue["totals"]["missing_periods"] == ["2026-02"]
        assert revenue["totals"]["budget_to_date"] == 1000
        assert revenue["totals"]["actual_to_date"] == 1100
        assert revenue["totals"]["variance_to_date"] == 100
        assert revenue["totals"]["budget_through_latest_actual"] == 3000

        payroll = self._line(data, "payroll")
        assert payroll["totals"]["periods_compared"] == ["2026-02"]
        assert payroll["totals"]["missing_periods"] == ["2026-01"]
        assert payroll["totals"]["budget_to_date"] == 5200 and payroll["totals"]["actual_to_date"] == 5000
        assert payroll["totals"]["variance_to_date"] == -200 and payroll["totals"]["favorable"] is True
        assert payroll["by_period"][0]["actual"] is None

    def test_confirmed_zero_is_compared(self, client, partial_actuals):
        data = client.get("/reporting/variance", params={"forecast_ids": FORECAST, "start_period": "2026-01", "end_period": "2026-03"}).json()["data"]
        admin = self._line(data, "admin_expense")
        jan = admin["by_period"][0]
        assert jan["actual"] == 0 and jan["variance"] == -100 and jan["favorable"] is True
        assert admin["totals"]["actual_to_date"] == 0 and admin["totals"]["coverage"] == "partial"

    def test_lines_without_actuals_and_period_coverage(self, client, partial_actuals):
        data = client.get("/reporting/variance", params={"forecast_ids": FORECAST, "start_period": "2026-01", "end_period": "2026-03"}).json()["data"]
        capex = self._line(data, "capex")
        assert capex["coverage"] == "none" and capex["totals"]["actual_to_date"] is None and capex["totals"]["variance_to_date"] is None
        assert "capex" in data["lines_without_actuals"]
        coverage = {c["period"]: c for c in data["period_coverage"]}
        assert list(coverage) == ["2026-01", "2026-02"]  # March is after the latest actual: not judged
        assert coverage["2026-01"]["lines_entered"] == 2 and "payroll" in coverage["2026-01"]["lines_missing"]
        assert coverage["2026-02"]["lines_entered"] == 1 and "revenue" in coverage["2026-02"]["lines_missing"]
        assert not coverage["2026-01"]["complete"]
        incomplete = {l["line_item"]: l["missing_periods"] for l in data["incomplete_lines"]}
        assert incomplete == {"revenue": ["2026-02"], "admin_expense": ["2026-02"], "payroll": ["2026-01"]}
        codes = [w["code"] for w in data["warnings"]]
        assert "incomplete_actuals" in codes and "lines_without_actuals" in codes

    def test_complete_coverage(self, client, partial_actuals):
        client.post("/reporting/actuals", json={"entries": [
            {"period": "2026-02", "line_item": "revenue", "amount": 1900},
            {"period": "2026-01", "line_item": "payroll", "amount": 0},
            {"period": "2026-02", "line_item": "admin_expense", "amount": 100},
        ]})
        data = client.get("/reporting/variance", params={"forecast_ids": FORECAST, "start_period": "2026-01", "end_period": "2026-03"}).json()["data"]
        revenue = self._line(data, "revenue")
        assert revenue["coverage"] == "complete" and revenue["totals"]["missing_periods"] == []
        assert revenue["totals"]["budget_to_date"] == 3000 and revenue["totals"]["actual_to_date"] == 3000
        assert not any(w["code"] == "incomplete_actuals" for w in data["warnings"])


# ---------------------------------------------------------------------------
# Calendars: payroll and debt
# ---------------------------------------------------------------------------

from datetime import date  # noqa: E402


class TestPayCalendar:
    def test_biweekly_runs_are_fridays_fourteen_days_apart(self):
        runs = fs.pay_run_dates("biweekly", date(2026, 1, 1), 26)
        assert runs[0] == date(2026, 1, 2)
        assert all(d.weekday() == 4 for d in runs)
        assert all((b - a).days == 14 for a, b in zip(runs, runs[1:]))
        assert runs[-1] == date(2026, 1, 2) + __import__("datetime").timedelta(days=350)

    def test_weekly_runs(self):
        runs = fs.pay_run_dates("weekly", date(2026, 10, 9), 3)  # a Friday
        assert runs == [date(2026, 10, 9), date(2026, 10, 16), date(2026, 10, 23)]

    def test_semimonthly_runs_hit_the_15th_and_month_end(self):
        assert fs.pay_run_dates("semimonthly", date(2027, 2, 1), 4) == [date(2027, 2, 15), date(2027, 2, 28), date(2027, 3, 15), date(2027, 3, 31)]
        # Leap year, starting after the 15th.
        assert fs.pay_run_dates("semimonthly", date(2028, 2, 16), 2) == [date(2028, 2, 29), date(2028, 3, 15)]

    def test_monthly_runs_are_month_ends(self):
        assert fs.pay_run_dates("monthly", date(2026, 1, 31), 3) == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31)]
        assert fs.pay_run_dates("monthly", date(2028, 2, 1), 2) == [date(2028, 2, 29), date(2028, 3, 31)]
        assert fs.pay_run_dates("monthly", date(2026, 12, 31), 2) == [date(2026, 12, 31), date(2027, 1, 31)]

    def test_add_months_clamps_to_month_end(self):
        assert fs.add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
        assert fs.add_months(date(2028, 1, 31), 1) == date(2028, 2, 29)
        assert fs.add_months(date(2026, 1, 31), 3) == date(2026, 4, 30)
        assert fs.add_months(date(2025, 11, 30), 3) == date(2026, 2, 28)
        assert fs.add_months(date(2026, 3, 15), -1) == date(2026, 2, 15)
        assert fs.add_months(date(2026, 12, 31), 12) == date(2027, 12, 31)

    def test_active_fraction_uses_real_calendar_days(self):
        assert fs._active_fraction("2028-02", date(2028, 2, 15), None) == pytest.approx(15 / 29)
        assert fs._active_fraction("2027-02", date(2027, 2, 15), None) == pytest.approx(14 / 28)
        assert fs._active_fraction("2026-03", None, date(2026, 3, 10)) == pytest.approx(10 / 31)
        assert fs._active_fraction("2026-03", date(2026, 4, 1), None) == 0.0
        assert fs._active_fraction("2026-03", date(2026, 3, 1), date(2026, 3, 31)) == 1.0

    def test_monthly_accrual_reconciles_to_annual_cost_and_pay_runs(self, client, engine_db):
        # E1: $30/h x 40h x 52 = $62,400/yr with zero burden in the fixture config.
        conn = engine_db.get_connection()
        try:
            months = fs.period_range("2026-02", "2027-01")
            accrual = fs.payroll_by_period(conn.cursor(), [FORECAST], months)
            cfg = fs.load_payroll_config(conn.cursor())
        finally:
            conn.close()
        emp = {"rate_type": "hourly", "hourly_rate": 30, "weekly_hours": 40}
        annual_overview = fs._employee_annual_gross(emp, 30) * fs._burden_multiplier(cfg, False)
        assert sum(accrual["total"].values()) == pytest.approx(annual_overview, abs=0.01) == pytest.approx(62400, abs=0.01)

        # 26 biweekly pay runs cover 52 weeks and sum to the same annual cost.
        r = client.post("/payroll/config", json={"pay_frequency": "biweekly", "federal_tax_rate": 0, "state_tax_rate": 0,
                                                 "social_security_rate": 0, "medicare_rate": 0, "unemployment_rate": 0,
                                                 "benefits_rate": 0, "workers_comp_rate": 0})
        assert r.status_code == 200, r.text
        try:
            r = client.get("/payroll/forecast", params={"periods": 26, "forecast_id": FORECAST, "include_raises": "false"})
            assert r.status_code == 200, r.text
            runs = r.json()["data"]["forecast"]
            assert len(runs) == 26
            assert sum(run["total_cost"] for run in runs) == pytest.approx(annual_overview, abs=0.01)
            dates = [date.fromisoformat(run["date"]) for run in runs]
            assert all(d.weekday() == 4 for d in dates)
            assert all((b - a).days == 14 for a, b in zip(dates, dates[1:]))
            assert all(run["month"] == run["date"][:7] for run in runs)
        finally:
            r = client.post("/payroll/config", json={"pay_frequency": "monthly", "federal_tax_rate": 0, "state_tax_rate": 0,
                                                     "social_security_rate": 0, "medicare_rate": 0, "unemployment_rate": 0,
                                                     "benefits_rate": 0, "workers_comp_rate": 0})
            assert r.status_code == 200, r.text

    def test_monthly_pay_runs_land_on_month_ends(self, client):
        r = client.get("/payroll/forecast", params={"periods": 4, "forecast_id": FORECAST})
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["pay_frequency"] == "monthly"
        dates = [date.fromisoformat(run["date"]) for run in data["forecast"]]
        assert all(d == fs.month_end(d) for d in dates)
        assert [fs.months_between(dates[0].strftime("%Y-%m"), d.strftime("%Y-%m")) for d in dates] == [0, 1, 2, 3]


class TestLoanCalendar:
    @pytest.fixture(scope="class")
    def loan_client(self, engine_db):
        import db.database as dbmod_short
        original = dbmod_short.db_manager
        dbmod_short.db_manager = engine_db
        from api import loan_routes
        app = FastAPI()
        app.include_router(loan_routes.router)
        yield TestClient(app)
        dbmod_short.db_manager = original

    def test_schedule_uses_calendar_months_and_clamps_day(self):
        from api.loan_routes import generate_amortization_schedule
        sched = generate_amortization_schedule("L1", 12000, 0.0, 12, "2026-01-31")
        dates = [p.payment_date for p in sched]
        assert dates == ["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31",
                         "2026-08-31", "2026-09-30", "2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31"]
        assert len({d[:7] for d in dates}) == 12  # one payment per month, no skipped or doubled month
        assert sched[-1].remaining_balance == 0

    def test_quarterly_and_leap_year_dates(self):
        from api.loan_routes import generate_amortization_schedule, payment_date_for
        sched = generate_amortization_schedule("L2", 1000, 0.08, 12, "2025-11-30", payment_frequency="quarterly")
        assert [p.payment_date for p in sched] == ["2026-02-28", "2026-05-30", "2026-08-30", "2026-11-30"]
        assert payment_date_for("2028-01-31", 1) == "2028-02-29"
        assert payment_date_for("2027-01-31", 1) == "2027-02-28"
        assert payment_date_for("2026-03-15", 1) == "2026-04-15"

    def test_created_loan_schedule_feeds_every_statement_month(self, loan_client, engine_db):
        r = loan_client.post("/loans/", json={
            "loan_name": "Month-end loan", "lender": "Bank", "loan_type": "term_loan", "principal_amount": 2400,
            "interest_rate": 0, "loan_term_months": 24, "start_date": "2026-01-31", "payment_type": "amortizing",
        })
        assert r.status_code == 200, r.text
        loan_id = r.json()["data"]["loan_id"]
        try:
            conn = engine_db.get_connection()
            try:
                c = conn.cursor()
                c.execute("SELECT next_payment_date FROM loans WHERE loan_id = ?", (loan_id,))
                assert c.fetchone()[0] == "2026-02-28"
                stmt = fs.build_statements(c, [FORECAST], "2026-01", "2027-01")
            finally:
                conn.close()
            principal = {r_["period"]: -r_["principal_payments"] for r_ in stmt["cash_flow"]["by_period"]}
            assert principal["2026-01"] == 500 + 0           # fixture loan only; new loan's first payment is Feb 28
            assert principal["2026-02"] == 500 + 100
            assert all(principal[p] == 100 for p in fs.period_range("2026-04", "2027-01"))  # fixture loan ends Mar
            detail = stmt["detail"]["loans"][loan_id]
            assert detail["opening_balance"] == 0  # originated inside the window: proceeds in Jan, not opening debt
            assert detail["proceeds"]["2026-01"] == 2400
            assert stmt["cash_flow"]["by_period"][0]["loan_proceeds"] == 2400
            # A later window opens with the drawn balance less the principal paid in the carried months.
            conn = engine_db.get_connection()
            try:
                later = fs.build_statements(conn.cursor(), [FORECAST], "2026-04", "2026-04")
            finally:
                conn.close()
            new_loan = later["detail"]["loans"][loan_id]
            assert new_loan["opening_balance"] == pytest.approx(2400 - 200, abs=0.01)
            assert new_loan["opening_balance"] + later["detail"]["loans"]["LN1"]["opening_balance"] == pytest.approx(later["balance_sheet"]["opening"]["debt"], abs=0.01)
        finally:
            conn = engine_db.get_connection()
            conn.execute("DELETE FROM loan_payments WHERE loan_id = ?", (loan_id,))
            conn.execute("DELETE FROM loans WHERE loan_id = ?", (loan_id,))
            conn.commit()
            conn.close()
