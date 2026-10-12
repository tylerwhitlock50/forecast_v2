"""
Sales deductions, customer pricing, and the COGS / labor forecasts.

Seeds an isolated database: two customers of different types (Dealer,
Distributor), two products (a rifle and a pistol) with BOM + routing, and a
Jan-Mar 2027 forecast. Deduction rules cover a terms allowance by customer
type with a customer override, a chargebacks allowance, embedded 11% / 10%
excise by product type with a government exemption, and a commission on
net. The tests check the rule maths by hand and that the statements, the
COGS forecast and the labor forecast agree with each other.
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
from services import operations_forecast as ops  # noqa: E402
from services import pricing  # noqa: E402

F = "F-DED"
WINDOW = ("2027-01", "2027-03")


def _seed(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES (?, 'Plan 2027', 1)", (F,))
    c.execute("INSERT INTO forecast (forecast_id, name) VALUES ('F-ALT', 'Alt')")
    c.executemany("INSERT INTO customers (customer_id, customer_name, customer_type) VALUES (?, ?, ?)", [
        ("C-DLR", "Main Street Guns", "Dealer"),
        ("C-DST", "Big Distributor", "Distributor"),
        ("C-GOV", "County Sheriff", "Government"),
    ])
    c.executemany("""INSERT INTO units (unit_id, unit_name, base_price, unit_type, bom_id, bom_version, router_id)
                     VALUES (?, ?, ?, ?, ?, '1.0', ?)""", [
        ("RIF", "Hunter Rifle", 1500, "Rifle", "B-RIF", "R-RIF"),
        ("PST", "Compact Pistol", 600, "Pistol", "B-PST", "R-PST"),
    ])
    c.executemany("INSERT INTO bom (bom_id, version, bom_line, material_description, qty, unit, unit_price, material_cost) VALUES (?, '1.0', ?, ?, ?, 'ea', ?, ?)", [
        ("B-RIF", 1, "Barrel", 1, 200, 200),
        ("B-RIF", 2, "Stock", 1, 100, 100),
        ("B-PST", 1, "Slide", 1, 80, 80),
    ])
    c.executemany("INSERT INTO machines (machine_id, machine_name, machine_rate, available_minutes_per_month) VALUES (?, ?, ?, ?)", [
        ("CNC", "CNC Mill", 120, 600),   # 10 hours available a month
        ("ASM", "Assembly Bench", 0, 0),
    ])
    c.executemany("INSERT INTO labor_rates (rate_id, rate_name, rate_amount) VALUES (?, ?, ?)", [
        ("MACH", "Machinist", 36), ("ASSY", "Assembler", 24),
    ])
    c.executemany("""INSERT INTO router_operations (router_id, sequence, machine_id, machine_minutes, labor_minutes, labor_type_id)
                     VALUES (?, ?, ?, ?, ?, ?)""", [
        ("R-RIF", 10, "CNC", 30, 30, "MACH"),   # $18 labor + $60 machine
        ("R-RIF", 20, "ASM", 0, 60, "ASSY"),    # $24 labor
        ("R-PST", 10, "CNC", 15, 20, "MACH"),   # $12 labor + $30 machine
    ])
    sales = [
        # id, customer, unit, period, qty, price
        ("S1", "C-DLR", "RIF", "2027-01", 10, 1110.0),
        ("S2", "C-DST", "RIF", "2027-01", 20, 999.0),
        ("S3", "C-DLR", "PST", "2027-02", 5, 550.0),
        ("S4", "C-GOV", "RIF", "2027-02", 4, 1000.0),
        ("S5", "C-DST", "PST", "2027-03", 10, 440.0),
    ]
    for sid, cust, unit, period, qty, price in sales:
        c.execute("""INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)""", (sid, cust, unit, period, qty, price, qty * price, F))
    # Another scenario's row must not count.
    c.execute("""INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id)
                 VALUES ('SX', 'C-DLR', 'RIF', '2027-01', 99, 1000, 99000, 'F-ALT')""")

    rules = [
        # rule_id, forecast_id, type, method, rate, per_unit, customer_id, customer_type, unit_id, unit_type, start, end
        ("D-TERMS-ALL", None, "terms_allowance", "percent_of_gross", 0.02, 0, None, None, None, None, None, None),
        ("D-TERMS-DST", None, "terms_allowance", "percent_of_gross", 0.01, 0, None, "distributor", None, None, None, None),
        ("D-CB-DLR", None, "chargebacks", "percent_of_gross", 0.01, 0, None, "Dealer", None, None, None, None),
        ("D-FET-RIF", None, "excise_tax", "embedded_tax", 0.11, 0, None, None, None, "Rifle", None, None),
        ("D-FET-PST", None, "excise_tax", "embedded_tax", 0.10, 0, None, None, None, "Pistol", None, None),
        ("D-FET-GOV", None, "excise_tax", "embedded_tax", 0.0, 0, None, "Government", None, None, None, None),
        ("D-COM", None, "commission", "percent_of_net", 0.05, 0, None, None, None, None, None, None),
        # Scenario-specific per-unit freight allowance on distributors from March only.
        ("D-FRT", F, "other_allowance", "per_unit", 0, 3.0, None, "Distributor", None, None, "2027-03", None),
        # Belongs to the other scenario: never applies here.
        ("D-ALT", "F-ALT", "other_allowance", "percent_of_gross", 0.5, 0, None, None, None, None, None, None),
        # Inactive rule never applies.
        ("D-OFF", None, "chargebacks", "percent_of_gross", 0.9, 0, None, None, None, None, None, None),
    ]
    for r in rules:
        c.execute("""INSERT INTO sales_deduction_rules (rule_id, forecast_id, deduction_type, method, rate, amount_per_unit,
                     customer_id, customer_type, unit_id, unit_type, start_period, end_period, is_active)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", (*r, 0 if r[0] == "D-OFF" else 1))
    c.execute("""INSERT INTO financial_assumptions (forecast_id, opening_period, opening_cash, dso_days, dio_days, dpo_days,
                 income_tax_rate, excise_payable_days) VALUES (?, '2026-12', 10000, 30, 30, 30, 0.25, 15)""", (F,))
    conn.commit()
    conn.close()


@pytest.fixture(scope="module")
def db():
    tmp = tempfile.mkdtemp()
    path = os.path.join(tmp, "ded.db")
    mgr = DatabaseManager(database_path=path, data_dir=tmp)
    mgr.initialize()
    _seed(path)
    yield mgr
    shutil.rmtree(tmp, ignore_errors=True)


@pytest.fixture(scope="module")
def statements(db):
    conn = db.get_connection()
    try:
        return fs.build_statements(conn.cursor(), [F], *WINDOW)
    finally:
        conn.close()


def _row(stmt, section, period):
    return next(r for r in stmt[section]["by_period"] if r["period"] == period)


# Hand-computed expectations per sales row --------------------------------------------------

def _expected():
    rows = {
        # S1 dealer rifle 10 x 1110 = 11,100: terms 2% 222, chargebacks 1% 111, FET 11/111 = 1,100
        "S1": dict(period="2027-01", gross=11100.0, terms=222.0, cb=111.0, other=0.0, fet=1100.0),
        # S2 distributor rifle 20 x 999 = 19,980: terms 1% (type override) 199.8, no chargebacks, FET 1,980
        "S2": dict(period="2027-01", gross=19980.0, terms=199.8, cb=0.0, other=0.0, fet=19980 * 0.11 / 1.11),
        # S3 dealer pistol 5 x 550 = 2,750: terms 55, chargebacks 27.5, FET 10% embedded = 250
        "S3": dict(period="2027-02", gross=2750.0, terms=55.0, cb=27.5, other=0.0, fet=250.0),
        # S4 government rifle 4 x 1000 = 4,000: terms 2% 80, FET exempt (rate 0 rule is more specific)
        "S4": dict(period="2027-02", gross=4000.0, terms=80.0, cb=0.0, other=0.0, fet=0.0),
        # S5 distributor pistol 10 x 440 = 4,400: terms 44, freight $3 x 10 = 30 (March, scenario rule), FET 400
        "S5": dict(period="2027-03", gross=4400.0, terms=44.0, cb=0.0, other=30.0, fet=400.0),
    }
    for r in rows.values():
        r["total"] = r["terms"] + r["cb"] + r["other"] + r["fet"]
        r["net"] = r["gross"] - r["total"]
        r["commission"] = 0.05 * r["net"]
    return rows


class TestRuleMaths:
    def test_embedded_tax_formula(self):
        rule = {"method": "embedded_tax", "rate": 0.11}
        assert pricing.rule_amount(rule, 1110.0, 1) == pytest.approx(110.0)

    def test_percent_of_net_uses_gross_less_contra_deductions(self):
        winners = {
            "terms_allowance": {"rule_id": "a", "method": "percent_of_gross", "rate": 0.02},
            "excise_tax": {"rule_id": "b", "method": "embedded_tax", "rate": 0.11},
            "commission": {"rule_id": "c", "method": "percent_of_net", "rate": 0.10},
        }
        out = pricing.compute_row_deductions(winners, {"gross_sales": 1110.0, "quantity": 1})
        assert out["terms_allowance"] == pytest.approx(22.2)
        assert out["excise_tax"] == pytest.approx(110.0)
        assert out["net_sales"] == pytest.approx(1110 - 22.2 - 110)
        assert out["commission"] == pytest.approx(0.10 * (1110 - 22.2 - 110))
        # Commission is a selling expense, not a sales deduction.
        assert out["total_sales_deductions"] == pytest.approx(132.2)

    def test_most_specific_rule_wins_and_types_stack(self, db):
        conn = db.get_connection()
        try:
            resolver = pricing.DeductionResolver(pricing.load_deduction_rules(conn.cursor(), [F]))
        finally:
            conn.close()
        row = {"forecast_id": F, "customer_id": "C-DST", "customer_type": "Distributor", "unit_id": "RIF",
               "unit_type": "Rifle", "period": "2027-01"}
        winners = resolver.winners(row)
        assert winners["terms_allowance"]["rule_id"] == "D-TERMS-DST"  # type rule beats company-wide default
        assert winners["excise_tax"]["rule_id"] == "D-FET-RIF"
        assert "chargebacks" not in winners  # dealer-only rule; inactive catch-all ignored
        assert "other_allowance" not in winners  # freight starts in March; F-ALT rule is another scenario's
        march = resolver.winners({**row, "period": "2027-03"})
        assert march["other_allowance"]["rule_id"] == "D-FRT"

    def test_zero_rate_rule_is_an_exemption(self, db):
        conn = db.get_connection()
        try:
            resolver = pricing.DeductionResolver(pricing.load_deduction_rules(conn.cursor(), [F]))
        finally:
            conn.close()
        out = resolver.compute({"forecast_id": F, "customer_id": "C-GOV", "customer_type": "Government",
                                "unit_id": "RIF", "unit_type": "Rifle", "period": "2027-02",
                                "gross_sales": 1000.0, "quantity": 1})
        assert out["excise_tax"] == 0.0
        assert out["applied_rules"]["excise_tax"] == "D-FET-GOV"


class TestStatementsWithDeductions:
    def test_monthly_lines_match_hand_calculation(self, statements):
        exp = _expected()
        for period in ("2027-01", "2027-02", "2027-03"):
            rows = [r for r in exp.values() if r["period"] == period]
            inc = _row(statements, "income_statement", period)
            assert inc["gross_sales"] == pytest.approx(sum(r["gross"] for r in rows), abs=0.01)
            assert inc["terms_allowance"] == pytest.approx(sum(r["terms"] for r in rows), abs=0.01)
            assert inc["chargebacks"] == pytest.approx(sum(r["cb"] for r in rows), abs=0.01)
            assert inc["other_allowances"] == pytest.approx(sum(r["other"] for r in rows), abs=0.01)
            assert inc["excise_tax"] == pytest.approx(sum(r["fet"] for r in rows), abs=0.01)
            assert inc["total_sales_deductions"] == pytest.approx(sum(r["total"] for r in rows), abs=0.01)
            assert inc["revenue"] == pytest.approx(sum(r["net"] for r in rows), abs=0.01)
            assert inc["commissions"] == pytest.approx(sum(r["commission"] for r in rows), abs=0.01)

    def test_gross_margin_is_on_net_sales_and_commission_is_opex(self, statements):
        inc = _row(statements, "income_statement", "2027-01")
        assert inc["gross_profit"] == pytest.approx(inc["revenue"] - inc["total_cogs"], abs=0.01)
        assert inc["gross_margin_pct"] == pytest.approx(inc["gross_profit"] / inc["revenue"] * 100, abs=0.01)
        assert inc["total_operating_expenses"] == pytest.approx(
            inc["commissions"] + inc["payroll"] + inc["admin_expense"] + inc["operating_expense"] + inc["depreciation"], abs=0.01)

    def test_other_scenario_sales_excluded(self, statements):
        jan = _row(statements, "income_statement", "2027-01")
        assert jan["gross_sales"] == pytest.approx(11100 + 19980)

    def test_balance_sheet_balances_with_excise_payable(self, statements):
        for row in statements["balance_sheet"]["by_period"]:
            assert abs(row["balance_check"]) < 0.01
        assert set(statements["balance_sheet"]["opening"].keys()) >= set(statements["balance_sheet"]["by_period"][0].keys())

    def test_excise_payable_and_ar_basis(self, statements):
        inc = _row(statements, "income_statement", "2027-01")
        bs = _row(statements, "balance_sheet", "2027-01")
        assert bs["excise_tax_payable"] == pytest.approx(inc["excise_tax"] * 15 / fs.AVG_DAYS_PER_MONTH, abs=0.01)
        assert bs["accounts_receivable"] == pytest.approx(
            (inc["revenue"] + inc["excise_tax"]) * 30 / fs.AVG_DAYS_PER_MONTH, abs=0.01)
        cf = _row(statements, "cash_flow", "2027-01")
        assert cf["change_in_excise_tax_payable"] == pytest.approx(bs["excise_tax_payable"], abs=0.01)

    def test_cash_reconciles(self, statements):
        rec = statements["cash_flow"]["reconciliation"]
        assert abs(rec["difference"]) < 0.01

    def test_detail_by_customer_type(self, statements):
        types = statements["detail"]["revenue_by_customer_type"]
        assert set(types) == {"Dealer", "Distributor", "Government"}
        exp = _expected()
        assert types["Government"]["revenue"] == pytest.approx(exp["S4"]["net"], abs=0.01)
        assert statements["detail"]["sales_deductions"]["by_type"]["excise_tax"]["total"] == pytest.approx(
            sum(r["fet"] for r in exp.values()), abs=0.01)

    def test_no_rules_means_net_equals_gross(self, db):
        conn = db.get_connection()
        try:
            cur = conn.cursor()
            lines = fs.load_sales_lines(cur, [F], ["2027-01"], deduction_rules=[])
        finally:
            conn.close()
        for line in lines["lines"]:
            assert line["net_sales"] == line["gross_sales"]
            assert line["total_sales_deductions"] == 0

    def test_variance_has_new_lines(self, db, statements):
        conn = db.get_connection()
        try:
            variance = fs.build_variance(conn.cursor(), [F], *WINDOW, statements=statements)
        finally:
            conn.close()
        keys = {l["line_item"] for l in variance["line_items"]}
        assert {"gross_sales", "total_sales_deductions", "revenue", "commissions"} <= keys


class TestCogsForecast:
    @pytest.fixture(scope="class")
    def report(self, db):
        conn = db.get_connection()
        try:
            return ops.build_cogs_forecast(conn.cursor(), [F], *WINDOW)
        finally:
            conn.close()

    def test_summary_ties_to_income_statement(self, report, statements):
        for row in report["summary"]["by_period"]:
            inc = _row(statements, "income_statement", row["period"])
            assert row["net_sales"] == pytest.approx(inc["revenue"], abs=0.02)
            assert row["gross_sales"] == pytest.approx(inc["gross_sales"], abs=0.02)
            assert row["total_cogs"] == pytest.approx(inc["total_cogs"], abs=0.02)
            assert row["gross_profit"] == pytest.approx(inc["gross_profit"], abs=0.02)
            assert row["labor"] == pytest.approx(inc["cogs_labor"], abs=0.02)

    def test_unit_costs(self, report):
        rifle = next(u for u in report["unit_costs"] if u["unit_id"] == "RIF")
        assert rifle["material_per_unit"] == pytest.approx(300)
        assert rifle["labor_per_unit"] == pytest.approx(18 + 24)
        assert rifle["machine_per_unit"] == pytest.approx(60)

    def test_dimensions_sum_to_summary(self, report):
        total = report["summary"]["totals"]["net_sales"]
        for dim in ("by_product", "by_customer", "by_customer_type", "by_product_type"):
            assert sum(g["totals"]["net_sales"] for g in report[dim]) == pytest.approx(total, abs=0.05)

    def test_customer_type_groups(self, report):
        dist = next(g for g in report["by_customer_type"] if g["customer_type"] == "Distributor")
        assert dist["totals"]["units"] == 30
        assert dist["by_period"]["2027-01"]["units"] == 20


class TestLaborForecast:
    @pytest.fixture(scope="class")
    def report(self, db):
        conn = db.get_connection()
        try:
            return ops.build_labor_forecast(conn.cursor(), [F], *WINDOW, hours_per_fte=160)
        finally:
            conn.close()

    def test_hours_by_labor_type(self, report):
        mach = next(t for t in report["by_labor_type"] if t["labor_type_id"] == "MACH")
        # Jan: 30 rifles x 30 min = 15 h; Feb: 4 rifles x 30 + 5 pistols x 20 = 220 min; Mar: 10 pistols x 20 = 200 min
        assert mach["by_period"]["2027-01"]["hours"] == pytest.approx(15.0)
        assert mach["by_period"]["2027-02"]["hours"] == pytest.approx(220 / 60, abs=0.01)
        assert mach["by_period"]["2027-03"]["hours"] == pytest.approx(200 / 60, abs=0.01)
        assert mach["by_period"]["2027-01"]["fte"] == pytest.approx(15 / 160, abs=0.001)
        assy = next(t for t in report["by_labor_type"] if t["labor_type_id"] == "ASSY")
        assert assy["totals"]["hours"] == pytest.approx(34.0)  # 34 rifles x 1 h

    def test_labor_cost_ties_to_statement(self, report, statements):
        assert report["totals"]["cost"] == pytest.approx(statements["income_statement"]["totals"]["cogs_labor"], abs=0.05)

    def test_machine_capacity_warning(self, report):
        cnc = next(m for m in report["by_machine"] if m["machine_id"] == "CNC")
        assert cnc["available_hours_per_month"] == pytest.approx(10)
        assert cnc["by_period"]["2027-01"]["hours"] == pytest.approx(15)
        assert cnc["over_capacity_periods"] == ["2027-01"]
        assert any(w["code"] == "machine_over_capacity" for w in report["warnings"])


class TestPriceResolution:
    RULES = [
        {"price_id": "P-LIST", "unit_id": "RIF", "method": "fixed", "unit_price": 1400},
        {"price_id": "P-DST-ALL", "customer_type": "Distributor", "method": "discount_from_base", "discount_pct": 0.40},
        {"price_id": "P-DST-RIF", "customer_type": "Distributor", "unit_id": "RIF", "method": "fixed", "unit_price": 950},
        {"price_id": "P-ACME", "customer_id": "C-ACME", "method": "discount_from_base", "discount_pct": 0.45},
        {"price_id": "P-2027H2", "customer_type": "Dealer", "unit_id": "RIF", "method": "fixed", "unit_price": 1150,
         "start_period": "2027-07"},
        {"price_id": "P-ALT", "forecast_id": "F-ALT", "unit_id": "RIF", "method": "fixed", "unit_price": 1},
    ]

    def resolve(self, **row):
        base = row.pop("base", 1500)
        return pricing.resolve_price(self.RULES, {"forecast_id": F, "period": "2027-01", **row}, base_price=base)

    def test_precedence(self):
        assert self.resolve(unit_id="RIF", customer_id="C-ACME", customer_type="Distributor")["price_id"] == "P-ACME"
        assert self.resolve(unit_id="RIF", customer_id="C-X", customer_type="Distributor")["price"] == 950
        assert self.resolve(unit_id="PST", customer_id="C-X", customer_type="distributor", base=600)["price"] == pytest.approx(360)
        assert self.resolve(unit_id="RIF", customer_id="C-Y", customer_type="Dealer")["source"] == "product"
        assert self.resolve(unit_id="RIF", customer_id="C-Y", customer_type="Dealer", period="2027-08")["price"] == 1150
        out = self.resolve(unit_id="PST", customer_id="C-Y", customer_type="Dealer", base=600)
        assert out == {"price": 600.0, "source": "base_price", "price_id": None}

    def test_no_price(self):
        assert self.resolve(unit_id="ZZZ", customer_id="C-Y", customer_type="Dealer", base=None)["source"] == "none"

    def test_discount_without_base_price_falls_through(self):
        out = self.resolve(unit_id="PST", customer_id="C-ACME", customer_type="Distributor", base=0)
        assert out["source"] == "none"
