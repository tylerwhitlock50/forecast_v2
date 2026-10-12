"""
Costing endpoints: scenario scoping, period windows, BOM versions and
material cost, labor / machine utilization per month.

Covers /products/cost-summary, /products/materials/usage,
/products/machines/utilization, /products/labor/utilization,
/products/unit-cost, /source-data/sales-forecast, /source-data/cost-breakdown
and /source-data/revenue-summary on an isolated database seeded with:

  * three scenarios: F-BASE (is_base = 1), F-ALT (another 100 rifles) and
    F-AAA (lowest id, no sales) - an unscoped call must use F-BASE only;
  * rifle sales in 2026-12 (before the 2027 window), Jan / Feb 2027, a
    December row stored as '2027-12-01' and a junk '11/1/2027' row;
  * B-RIF with versions 1.0 and 2.0 (the rifle uses 2.0);
  * B-PST stored as version '1' with qty x unit_price and no material_cost
    (the pistol points at '1.0');
  * B-NOV with only version 'A' (the product has no bom_version);
  * a product pointing at B-RIF version 3.0, which does not exist;
  * a routing step with labor minutes and no labor type;
  * a machine with no capacity;
  * an 11% embedded excise rule on rifles, so net sales differ from gross.

Expected numbers are worked out by hand in the comments.
"""
import os
import shutil
import sqlite3
import sys
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

_APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir, "app"))
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from app.db.database import DatabaseManager  # noqa: E402
from services.operations_forecast import build_cogs_forecast, build_labor_forecast  # noqa: E402
from utils.cost_rollup import (  # noqa: E402
    bom_line_cost,
    calculate_unit_costs,
    resolve_bom_version,
    resolve_forecast_id,
    version_key,
)

BASE = "F-BASE"
Y2027 = {"start_period": "2027-01", "end_period": "2027-12"}
EXCISE = 0.11 / 1.11


def _seed(path: str) -> None:
    conn = sqlite3.connect(path)
    c = conn.cursor()
    c.executemany("INSERT INTO forecast (forecast_id, name, is_base) VALUES (?, ?, ?)", [
        ("F-AAA", "Old draft", 0), (BASE, "Budget 2027", 1), ("F-ALT", "Upside", 0),
    ])
    c.executemany("INSERT INTO customers (customer_id, customer_name, customer_type) VALUES (?, ?, ?)", [
        ("C-DLR", "Main Street Guns", "Dealer"),
        ("C-DST", "Big Distributor", "Distributor"),
        ("C-GOV", "Agency", None),
    ])
    c.executemany("""INSERT INTO units (unit_id, unit_name, base_price, unit_type, bom_id, bom_version, router_id)
                     VALUES (?, ?, ?, ?, ?, ?, ?)""", [
        ("RIF", "Hunter Rifle", 1500, "Rifle", "B-RIF", "2.0", "R-RIF"),
        ("PST", "Compact Pistol", 600, "Pistol", "B-PST", "1.0", "R-PST"),
        ("NOV", "No-version Rifle", 1400, "Rifle", "B-NOV", None, "R-RIF"),
        ("BAD", "Bad-version Rifle", 1500, "Rifle", "B-RIF", "3.0", "R-RIF"),
        ("NOLT", "Sling", 40, "Accessory", None, None, "R-NOLT"),
        ("IDLE", "Never sold", 10, "Accessory", None, None, None),
    ])
    c.executemany("""INSERT INTO bom (bom_id, version, bom_line, material_description, qty, unit, unit_price, material_cost)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)""", [
        # Old rifle BOM: must never be counted (205 / unit).
        ("B-RIF", "1.0", 1, "Receiver", 1, "ea", 85, 85),
        ("B-RIF", "1.0", 2, "Barrel", 1, "ea", 120, 120),
        # Current rifle BOM: 92 + 130 + 4 x 0.5 (no stored material_cost) = 224 / unit.
        ("B-RIF", "2.0", 1, "Receiver", 1, "ea", 92, 92),
        ("B-RIF", "2.0", 2, "Barrel", 1, "ea", 130, 130),
        ("B-RIF", "2.0", 3, "Screw", 4, "ea", 0.5, None),
        # Pistol BOM imported as version '1' with qty x unit price only: 85 + 2 x 60 = 205 / unit.
        ("B-PST", "1", 1, "Slide", 1, "ea", 85, None),
        ("B-PST", "1", 2, "Magazine", 2, "ea", 60, None),
        # Only version 'A'; line has a stored cost and no unit price: 300 / unit.
        ("B-NOV", "A", 1, "Kit", 1, "kit", None, 300),
    ])
    c.executemany("INSERT INTO machines (machine_id, machine_name, machine_rate, available_minutes_per_month) VALUES (?, ?, ?, ?)", [
        ("CNC", "CNC Mill", 120, 600),     # 10 hours a month
        ("NOCAP", "Bench", 0, 0),          # capacity not set
    ])
    c.execute("INSERT INTO labor_rates (rate_id, rate_name, rate_amount) VALUES ('MACH', 'Machinist', 40)")
    c.executemany("INSERT INTO router_definitions (router_id, router_name) VALUES (?, ?)", [
        ("R-RIF", "Rifle"), ("R-PST", "Pistol"), ("R-NOLT", "Sling"),
    ])
    c.executemany("""INSERT INTO router_operations (router_id, sequence, machine_id, machine_minutes, labor_minutes,
                     labor_type_id, operation_description) VALUES (?, ?, ?, ?, ?, ?, ?)""", [
        ("R-RIF", 10, "CNC", 30, 20, "MACH", "Machine receiver"),   # machine 60, labor 13.33 / unit
        ("R-PST", 10, "CNC", 12, 6, "MACH", "Machine slide"),       # machine 24, labor 4 / unit
        ("R-NOLT", 10, "NOCAP", 5, 30, None, "Sew sling"),         # 30 labor minutes, no labor type
    ])
    sales = [
        # id, forecast, customer, unit, period, qty, price
        ("S1", BASE, "C-DLR", "RIF", "2026-12", 3, 1000),
        ("S2", BASE, "C-DLR", "RIF", "2027-01", 10, 1100),
        ("S3", BASE, "C-DST", "RIF", "2027-02", 25, 1000),
        ("S4", BASE, "C-DST", "RIF", "2027-12-01", 5, 1000),
        ("S5", BASE, "C-DLR", "PST", "2027-03", 4, 500),
        ("S6", BASE, "C-GOV", "NOLT", "2027-03", 10, 40),
        ("S7", BASE, "C-DLR", "NOV", "2027-04", 2, 1400),
        ("S8", BASE, "C-DLR", "BAD", "2027-05", 1, 1500),
        ("S9", BASE, "C-DLR", "RIF", "11/1/2027", 7, 1000),
        ("A1", "F-ALT", "C-DLR", "RIF", "2027-01", 100, 1100),
    ]
    for sid, fid, cust, unit, period, qty, price in sales:
        c.execute("""INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)""", (sid, cust, unit, period, qty, price, qty * price, fid))
    c.execute("""INSERT INTO sales_deduction_rules (rule_id, deduction_type, method, rate, unit_type, is_active, name)
                 VALUES ('DED-FET', 'excise_tax', 'embedded_tax', 0.11, 'Rifle', 1, 'FET rifles')""")
    conn.commit()
    conn.close()


@pytest.fixture(scope="module")
def db_path():
    tmp = tempfile.mkdtemp()
    path = os.path.join(tmp, "costing.db")
    mgr = DatabaseManager(database_path=path, data_dir=tmp)
    mgr.initialize()
    _seed(path)
    yield path, mgr
    shutil.rmtree(tmp, ignore_errors=True)


@pytest.fixture(scope="module")
def client(db_path):
    _, mgr = db_path
    import app.db.database as dbmod
    import db.database as dbmod_short
    from api import cost_routes, source_data_routes
    saved = (dbmod.db_manager, dbmod_short.db_manager, source_data_routes.db_manager)
    dbmod.db_manager = mgr
    dbmod_short.db_manager = mgr
    source_data_routes.db_manager = mgr
    app = FastAPI()
    app.include_router(cost_routes.router)
    app.include_router(source_data_routes.router)
    yield TestClient(app)
    dbmod.db_manager, dbmod_short.db_manager, source_data_routes.db_manager = saved


@pytest.fixture
def cursor(db_path):
    conn = sqlite3.connect(db_path[0])
    yield conn.cursor()
    conn.rollback()
    conn.close()


def _get(client, path, **params):
    r = client.get(path, params=params)
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _products(data):
    return {p["product_id"]: p for p in data["products"]}


# ---------------------------------------------------------------------------
# utils.cost_rollup: BOM versions and material cost (read side)
# ---------------------------------------------------------------------------

class TestBomReadSide:
    def test_line_cost_prefers_qty_times_price(self):
        assert bom_line_cost(2, 60, None) == pytest.approx(120)
        assert bom_line_cost(2, 60, 999) == pytest.approx(120)      # stale stored cost is ignored
        assert bom_line_cost(1, None, 300) == pytest.approx(300)     # no price -> stored cost
        assert bom_line_cost(1, 0, 300) == pytest.approx(300)        # zero price -> stored cost
        assert bom_line_cost(None, 50, 75) == pytest.approx(75)      # no qty -> stored cost
        assert bom_line_cost(None, None, None) == 0.0
        assert bom_line_cost("3", "2.5", "") == pytest.approx(7.5)   # text from a CSV load

    def test_version_key(self):
        assert version_key("1") == version_key("1.0") == version_key("1.00") == version_key(1) == "1.0"
        assert version_key("v2") == version_key(2.0) == "2.0"
        assert version_key("1.1") == "1.1" and version_key("1.10") != version_key("1.1")
        assert version_key(" A ") == version_key("a")

    def test_resolve_version_exact_normalised_and_single_fallback(self, cursor):
        assert resolve_bom_version(cursor, "B-RIF", "2.0") == (True, "2.0", ["1.0", "2.0"])
        assert resolve_bom_version(cursor, "B-PST", "1.0") == (True, "1", ["1"])
        assert resolve_bom_version(cursor, "B-NOV", None) == (True, "A", ["A"])
        assert resolve_bom_version(cursor, "B-NOV", "") == (True, "A", ["A"])
        assert resolve_bom_version(cursor, "B-RIF", "3.0") == (False, None, ["1.0", "2.0"])
        assert resolve_bom_version(cursor, "B-RIF", None) == (True, "1.0", ["1.0", "2.0"])   # blank = default 1.0
        assert resolve_bom_version(cursor, "NOPE", "1.0") == (False, None, [])

    def test_null_material_cost_lines_are_costed(self, cursor):
        uc = calculate_unit_costs(cursor, "B-PST", "1.0", "R-PST")
        assert uc["material_per_unit"] == pytest.approx(205.0)
        assert uc["bom_version_used"] == "1"
        assert uc["warnings"] == []

    def test_only_the_products_version_counts(self, cursor):
        uc = calculate_unit_costs(cursor, "B-RIF", "2.0", "R-RIF")
        assert uc["material_per_unit"] == pytest.approx(224.0)
        assert uc["labor_per_unit"] == pytest.approx(20 / 60 * 40)
        assert uc["machine_per_unit"] == pytest.approx(60.0)

    def test_blank_version_uses_the_only_version(self, cursor):
        uc = calculate_unit_costs(cursor, "B-NOV", None, "R-RIF")
        assert uc["material_per_unit"] == pytest.approx(300.0)
        assert uc["bom_version_used"] == "A"
        assert "missing_bom" not in uc["warnings"]

    def test_version_not_found_warns_with_versions(self, cursor):
        uc = calculate_unit_costs(cursor, "B-RIF", "3.0", "R-RIF")
        assert uc["material_per_unit"] == 0.0
        assert "bom_version_not_found" in uc["warnings"]
        assert "missing_bom" not in uc["warnings"]
        assert uc["bom_versions_available"] == ["1.0", "2.0"]

    def test_missing_bom_kept_for_no_bom(self, cursor):
        assert "missing_bom" in calculate_unit_costs(cursor, None, None, "R-RIF")["warnings"]
        assert "missing_bom" in calculate_unit_costs(cursor, "NOPE", "1.0", "R-RIF")["warnings"]

    def test_unit_cost_route_uses_the_same_rules(self, client):
        d = _get(client, "/products/unit-cost", bom_id="B-PST", bom_version="1.0", router_id="R-PST")
        assert d["material_per_unit"] == pytest.approx(205.0)
        assert d["total_per_unit"] == pytest.approx(205 + 4 + 24)
        assert d["warnings"] == []
        d = _get(client, "/products/unit-cost", bom_id="B-RIF", bom_version="3.0", router_id="R-RIF")
        assert d["warnings"] == ["bom_version_not_found"]
        assert d["bom_versions_available"] == ["1.0", "2.0"]


# ---------------------------------------------------------------------------
# Scenario scoping
# ---------------------------------------------------------------------------

class TestScenarioScoping:
    def test_resolve_forecast_id(self, cursor):
        assert resolve_forecast_id(cursor, "F-ALT") == ("F-ALT", "requested")
        assert resolve_forecast_id(cursor, None) == (BASE, "base")
        assert resolve_forecast_id(cursor, "") == (BASE, "base")
        cursor.execute("UPDATE forecast SET is_base = 0")
        assert resolve_forecast_id(cursor, None) == ("F-AAA", "first")

    def test_cost_summary_without_forecast_id_uses_base_only(self, client):
        data = _get(client, "/products/cost-summary")
        assert data["forecast_id"] == BASE
        assert data["forecast_id_source"] == "base"
        # 3 + 10 + 25 + 5 rifles in F-BASE; never F-ALT's 100 nor the junk-period row.
        assert _products(data)["RIF"]["forecast_quantity"] == pytest.approx(43)

    @pytest.mark.parametrize("path", [
        "/products/materials/usage", "/products/machines/utilization", "/products/labor/utilization",
        "/source-data/cost-breakdown", "/source-data/revenue-summary", "/source-data/sales-forecast",
    ])
    def test_every_endpoint_echoes_the_base_scenario(self, client, path):
        data = _get(client, path)
        scope = data.get("metadata", data)
        assert scope["forecast_id"] == BASE

    def test_labor_utilization_unscoped_matches_base(self, client):
        unscoped = _get(client, "/products/labor/utilization", **Y2027)
        scoped = _get(client, "/products/labor/utilization", forecast_id=BASE, **Y2027)
        assert unscoped["labor"] == scoped["labor"]


# ---------------------------------------------------------------------------
# Period windows
# ---------------------------------------------------------------------------

class TestPeriodWindows:
    def test_default_window_is_the_whole_scenario(self, client):
        data = _get(client, "/products/cost-summary", forecast_id=BASE)
        assert (data["start_period"], data["end_period"]) == ("2026-12", "2027-12")
        assert data["summary"]["months_in_window"] == 13
        assert any(w["code"] == "non_monthly_sales_periods" for w in data["warnings"])

    def test_cost_summary_window_ties_to_the_cogs_forecast(self, client, cursor):
        data = _get(client, "/products/cost-summary", forecast_id=BASE, **Y2027)
        rif = _products(data)["RIF"]
        assert rif["forecast_quantity"] == pytest.approx(40)            # 10 + 25 + 5 (Dec stored as 2027-12-01)
        assert rif["gross_sales"] == pytest.approx(41000)
        assert rif["total_sales_deductions"] == pytest.approx(41000 * EXCISE)
        assert rif["forecasted_revenue"] == pytest.approx(41000 * (1 - EXCISE))   # net sales, like the statements
        assert rif["net_sales"] == pytest.approx(rif["forecasted_revenue"])
        assert rif["material_cost"] == pytest.approx(40 * 224)
        assert rif["gross_margin"] == pytest.approx(rif["net_sales"] - rif["total_cogs"])
        assert _products(data)["IDLE"]["forecast_quantity"] == 0       # products with no sales are still listed

        cogs = build_cogs_forecast(cursor, [BASE], "2027-01", "2027-12")["summary"]["totals"]
        totals = data["summary"]["totals"]
        assert totals["net_sales"] == pytest.approx(cogs["net_sales"], abs=0.01)
        assert totals["gross_sales"] == pytest.approx(cogs["gross_sales"], abs=0.01)
        assert totals["material_cost"] == pytest.approx(cogs["materials"], abs=0.01)
        assert totals["labor_cost"] == pytest.approx(cogs["labor"], abs=0.01)
        assert totals["machine_cost"] == pytest.approx(cogs["machine"], abs=0.01)
        assert totals["total_cogs"] == pytest.approx(cogs["product_cogs"], abs=0.01)

    def test_sales_forecast_keeps_date_form_rows_in_the_last_month(self, client):
        data = _get(client, "/source-data/sales-forecast", forecast_id=BASE, **Y2027)
        ids = {r["sale_id"] for r in data["sales_forecast"]}
        assert "S4" in ids                     # stored as '2027-12-01'
        assert "S1" not in ids and "S9" not in ids
        assert data["metadata"]["start_period"] == "2027-01"
        assert data["metadata"]["end_period"] == "2027-12"

    def test_sales_forecast_without_window_lists_every_row(self, client):
        data = _get(client, "/source-data/sales-forecast", forecast_id=BASE)
        assert {r["sale_id"] for r in data["sales_forecast"]} == {f"S{i}" for i in range(1, 10)}
        assert data["metadata"]["start_period"] == "2026-12"
        assert data["metadata"]["non_monthly_rows"] == 1

    def test_open_ended_window(self, client):
        data = _get(client, "/products/cost-summary", forecast_id=BASE, start_period="2027-02")
        assert (data["start_period"], data["end_period"]) == ("2027-02", "2027-12")
        assert _products(data)["RIF"]["forecast_quantity"] == pytest.approx(30)

    def test_loose_month_formats_are_accepted(self, client):
        data = _get(client, "/products/cost-summary", forecast_id=BASE, start_period="2027-1", end_period="Dec 2027")
        assert (data["start_period"], data["end_period"]) == ("2027-01", "2027-12")

    @pytest.mark.parametrize("params", [
        {"start_period": "2027-Q1"}, {"end_period": "junk"}, {"start_period": "2027-06", "end_period": "2027-01"},
    ])
    @pytest.mark.parametrize("path", [
        "/products/cost-summary", "/products/materials/usage", "/products/machines/utilization",
        "/products/labor/utilization", "/source-data/cost-breakdown", "/source-data/revenue-summary",
        "/source-data/sales-forecast",
    ])
    def test_bad_window_is_a_400(self, client, path, params):
        r = client.get(path, params={"forecast_id": BASE, **params})
        assert r.status_code == 400, r.text

    def test_scenario_without_sales_is_empty_not_an_error(self, client):
        data = _get(client, "/products/machines/utilization", forecast_id="F-AAA")
        assert data["machines"] == [] and data["months_in_window"] == 0
        data = _get(client, "/products/cost-summary", forecast_id="F-AAA")
        assert all(p["forecast_quantity"] == 0 for p in data["products"])


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------

class TestMaterialsUsage:
    def test_only_the_products_bom_version_and_derived_costs(self, client, cursor):
        data = _get(client, "/products/materials/usage", forecast_id=BASE, **Y2027)
        mats = {(m["material_description"], m["unit_price"]): m for m in data["materials"]}
        # Old rifle BOM (Receiver @ 85, Barrel @ 120) never appears.
        assert ("Receiver", 85) not in mats and ("Barrel", 120) not in mats
        assert mats[("Receiver", 92)]["total_quantity_needed"] == pytest.approx(40)
        assert mats[("Receiver", 92)]["total_cost"] == pytest.approx(40 * 92)
        assert mats[("Screw", 0.5)]["total_cost"] == pytest.approx(160 * 0.5)
        assert mats[("Magazine", 60)]["total_quantity_needed"] == pytest.approx(8)    # PST BOM stored as '1'
        assert mats[("Magazine", 60)]["total_cost"] == pytest.approx(480)
        assert mats[("Kit", None)]["total_cost"] == pytest.approx(600)
        assert mats[("Receiver", 92)]["by_period"]["2027-02"] == {"quantity": 25, "cost": 2300}
        assert mats[("Receiver", 92)]["products_using"] == ["Hunter Rifle"]
        cogs = build_cogs_forecast(cursor, [BASE], "2027-01", "2027-12")["summary"]["totals"]
        assert data["totals"]["total_cost"] == pytest.approx(cogs["materials"], abs=0.01)
        assert data["totals"]["total_cost"] == pytest.approx(3680 + 5200 + 80 + 340 + 480 + 600)


# ---------------------------------------------------------------------------
# Machine utilization
# ---------------------------------------------------------------------------

class TestMachineUtilization:
    def test_average_and_peak_month_not_annual_vs_monthly(self, client):
        data = _get(client, "/products/machines/utilization", forecast_id=BASE, **Y2027)
        assert data["months_in_window"] == 12
        cnc = {m["machine_id"]: m for m in data["machines"]}["CNC"]
        # Jan 300, Feb 750, Mar 48, Apr 60, May 30, Dec 150 minutes = 1,338 in 12 months.
        assert cnc["total_minutes_required"] == pytest.approx(1338)
        assert cnc["average_monthly_minutes"] == pytest.approx(1338 / 12)
        assert cnc["utilization_percent"] == pytest.approx(1338 / 12 / 600 * 100, abs=0.01)
        assert cnc["peak_period"] == "2027-02"
        assert cnc["peak_utilization_percent"] == pytest.approx(125.0)
        assert cnc["capacity_exceeded"] is True
        assert cnc["over_capacity_periods"] == ["2027-02"]
        assert cnc["total_cost"] == pytest.approx(1338 / 60 * 120)
        months = {m["period"]: m for m in cnc["monthly"]}
        assert len(months) == 12
        assert months["2027-12"]["minutes_required"] == pytest.approx(150)
        assert months["2027-02"]["over_capacity"] is True and months["2027-01"]["over_capacity"] is False

    def test_zero_capacity_is_not_set_not_exceeded(self, client):
        data = _get(client, "/products/machines/utilization", forecast_id=BASE, **Y2027)
        bench = {m["machine_id"]: m for m in data["machines"]}["NOCAP"]
        assert bench["total_minutes_required"] == pytest.approx(50)
        assert bench["utilization_percent"] is None
        assert bench["peak_utilization_percent"] is None
        assert bench["capacity_exceeded"] is False
        assert "capacity_not_set" in bench["warnings"]
        assert any(w["code"] == "capacity_not_set" for w in data["warnings"])

    def test_machine_cost_ties_to_cogs(self, client, cursor):
        data = _get(client, "/products/machines/utilization", forecast_id=BASE, **Y2027)
        cogs = build_cogs_forecast(cursor, [BASE], "2027-01", "2027-12")["summary"]["totals"]
        assert sum(m["total_cost"] for m in data["machines"]) == pytest.approx(cogs["machine"], abs=0.01)


# ---------------------------------------------------------------------------
# Labor utilization
# ---------------------------------------------------------------------------

class TestLaborUtilization:
    def test_unassigned_labor_is_reported(self, client):
        data = _get(client, "/products/labor/utilization", forecast_id=BASE, **Y2027)
        labor = {l["labor_type_id"]: l for l in data["labor"]}
        assert labor["unassigned"]["total_minutes_required"] == pytest.approx(300)    # 10 slings x 30 min
        assert labor["unassigned"]["total_cost"] == 0
        assert labor["unassigned"]["products_involved"] == ["Sling"]
        assert any(w["code"] == "labor_without_type" for w in data["warnings"])

    def test_monthly_average_and_peak(self, client, cursor):
        data = _get(client, "/products/labor/utilization", forecast_id=BASE, **Y2027)
        mach = {l["labor_type_id"]: l for l in data["labor"]}["MACH"]
        # Jan 200, Feb 500, Mar 24, Apr 40, May 20, Dec 100 = 884 minutes.
        assert mach["total_minutes_required"] == pytest.approx(884)
        assert mach["total_cost"] == pytest.approx(884 / 60 * 40, abs=0.01)
        assert mach["months_in_window"] == 12
        assert mach["average_monthly_hours"] == pytest.approx(884 / 60 / 12, abs=0.01)
        assert mach["peak_period"] == "2027-02"
        assert mach["peak_monthly_hours"] == pytest.approx(500 / 60, abs=0.01)
        assert mach["peak_fte"] == pytest.approx(500 / 60 / data["hours_per_fte"], abs=0.001)
        assert sorted(mach["products_involved"]) == ["Bad-version Rifle", "Compact Pistol", "Hunter Rifle",
                                                     "No-version Rifle"]
        assert len(mach["monthly"]) == 12
        labor = build_labor_forecast(cursor, [BASE], "2027-01", "2027-12")
        assert sum(l["total_cost"] for l in data["labor"]) == pytest.approx(labor["totals"]["cost"], abs=0.01)


# ---------------------------------------------------------------------------
# Cost breakdown
# ---------------------------------------------------------------------------

class TestCostBreakdown:
    def test_uses_the_products_version_and_no_invented_rate(self, client, cursor):
        data = _get(client, "/source-data/cost-breakdown", forecast_id=BASE, **Y2027)
        units = {u["unit_id"]: u for u in data["cost_breakdown"]}
        rif = units["RIF"]
        assert rif["material_cost"] == pytest.approx(224)                 # v2.0 only (not 205 + 224)
        assert len(rif["bom_items"]) == 3
        assert sum(i["total_cost"] for i in rif["bom_items"]) == pytest.approx(224)
        assert rif["bom_version_used"] == "2.0"
        uc = calculate_unit_costs(cursor, "B-RIF", "2.0", "R-RIF")
        assert rif["labor_cost"] == pytest.approx(uc["labor_per_unit"])
        assert rif["machine_cost"] == pytest.approx(uc["machine_per_unit"])
        assert rif["forecast_quantity"] == pytest.approx(40)

        nolt = units["NOLT"]
        assert nolt["labor_cost"] == 0                                     # not 30/60 x $35
        assert nolt["router_operations"][0]["labor_rate"] == 0
        assert "router_labor_without_type" in nolt["warnings"]
        assert units["PST"]["material_cost"] == pytest.approx(205)
        assert "bom_version_not_found" in units["BAD"]["warnings"]
        assert set(units) == {"RIF", "PST", "NOV", "BAD", "NOLT"}         # sold in the window; IDLE is not

    def test_single_unit_without_sales_in_window(self, client):
        data = _get(client, "/source-data/cost-breakdown", forecast_id=BASE, unit_id="IDLE")
        assert [u["unit_id"] for u in data["cost_breakdown"]] == ["IDLE"]
        assert data["cost_breakdown"][0]["forecast_quantity"] == 0


# ---------------------------------------------------------------------------
# Revenue summary
# ---------------------------------------------------------------------------

class TestRevenueSummary:
    def test_weighted_price_cogs_and_net_sales(self, client):
        data = _get(client, "/source-data/revenue-summary", forecast_id=BASE, group_by="unit", **Y2027)
        rif = {r["unit_id"]: r for r in data["revenue_summary"]}["RIF"]
        assert rif["total_quantity"] == pytest.approx(40)
        assert rif["total_revenue"] == pytest.approx(41000)
        assert rif["avg_unit_price"] == pytest.approx(41000 / 40)          # 1,025, not the row average 1,033.33
        assert rif["gross_sales"] == pytest.approx(41000)
        assert rif["total_sales_deductions"] == pytest.approx(41000 * EXCISE, abs=0.01)
        assert rif["net_sales"] == pytest.approx(41000 * (1 - EXCISE), abs=0.01)
        assert rif["product_cogs"] == pytest.approx(40 * (224 + 20 / 60 * 40 + 60), abs=0.01)
        assert rif["gross_margin"] == pytest.approx(rif["net_sales"] - rif["product_cogs"], abs=0.01)
        assert data["start_period"] == "2027-01" and data["end_period"] == "2027-12"

    def test_group_by_customer_type_and_product_type(self, client):
        data = _get(client, "/source-data/revenue-summary", forecast_id=BASE, group_by="customer_type", **Y2027)
        rows = {r["customer_type"]: r for r in data["revenue_summary"]}
        assert set(rows) == {"Dealer", "Distributor", "Unassigned"}
        assert rows["Distributor"]["total_quantity"] == pytest.approx(30)
        assert rows["Distributor"]["gross_sales"] == pytest.approx(30000)
        data = _get(client, "/source-data/revenue-summary", forecast_id=BASE, group_by="product_type", **Y2027)
        rows = {r["unit_type"]: r for r in data["revenue_summary"]}
        assert set(rows) == {"Rifle", "Pistol", "Accessory"}
        assert rows["Pistol"]["product_cogs"] == pytest.approx(4 * (205 + 4 + 24), abs=0.01)

    def test_totals_tie_to_the_cogs_forecast(self, client, cursor):
        data = _get(client, "/source-data/revenue-summary", forecast_id=BASE, **Y2027)
        cogs = build_cogs_forecast(cursor, [BASE], "2027-01", "2027-12")["summary"]["totals"]
        t = data["totals"]
        assert t["net_sales"] == pytest.approx(cogs["net_sales"], abs=0.01)
        assert t["product_cogs"] == pytest.approx(cogs["product_cogs"], abs=0.01)
        assert t["total_records"] == 7
        assert sum(r["total_quantity"] for r in data["revenue_summary"]) == pytest.approx(t["total_quantity"])

    def test_bad_group_by_is_a_400(self, client):
        r = client.get("/source-data/revenue-summary", params={"forecast_id": BASE, "group_by": "region"})
        assert r.status_code == 400
