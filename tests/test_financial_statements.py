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

    # Assumptions: opening cash 5,000, AR 1,000, AP 400, 30/30/30 days, 25% tax, equity plugged.
    c.execute("""INSERT INTO financial_assumptions (forecast_id, opening_cash, opening_accounts_receivable, opening_inventory,
                 opening_accounts_payable, dso_days, dio_days, dpo_days, income_tax_rate, minimum_cash_balance)
                 VALUES (?, 5000, 1000, 0, 400, 30, 30, 30, 0.25, 4000)""", (FORECAST,))

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
