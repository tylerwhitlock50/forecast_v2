"""
Cost rollup regression tests.

Covers the two live backend cost sources:
  - /products/cost-summary  (app/api/cost_routes.py)
  - /source-data/sales-forecast  (app/api/source_data_routes.py)

Goals:
  * Pin down the arithmetic on a happy-path product + forecast.
  * Document (and guard against) silent-zero behaviour when a product is
    missing BOM, missing router, or references an unknown labor rate.
  * Document the two known divergences between the endpoints so any fix
    surfaces as a failing test that must be updated:
      1. /source-data/sales-forecast ignores bom_version  -> overcounts when
         a bom_id has >1 version.
      2. /source-data/sales-forecast falls back to average payroll rate
         when a router op references an unknown labor rate;
         /products/cost-summary falls back to zero.
"""
import os
import sys
import tempfile
import shutil

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

# Make `from db.database import db_manager` (used by the real route modules)
# resolvable when running under pytest from the repo root.
_APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir, "app"))
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from app.db.database import DatabaseManager  # noqa: E402


# ---------- fixture: isolated DB seeded with edge-case rows ----------

def _write_csvs(data_dir):
    """
    Seed via CSV only the tables whose load order in database.load_csv_data
    is safe (no upstream FKs violated). sales, router_operations, and
    payroll are inserted post-initialize via direct SQL to sidestep the
    pre-existing load-order issue.
    """
    def w(name, header, rows):
        with open(os.path.join(data_dir, name), "w") as f:
            f.write(header + "\n")
            for r in rows:
                f.write(r + "\n")

    w("customers.csv",
      "customer_id,customer_name,customer_type,region",
      ["CUST-001,Happy Corp,Manufacturing,North"])

    # Products:
    #   PROD-001 -> happy path: BOM-001 v1.0, R0001
    #   PROD-002 -> no BOM, has router R0002
    #   PROD-003 -> has BOM-003, no router
    #   PROD-004 -> references router op with an unknown labor_type_id
    w("units.csv",
      "unit_id,unit_name,unit_description,base_price,unit_type,bom_id,bom_version,router_id,router_version",
      [
          "PROD-001,Happy,desc,100.00,Component,BOM-001,1.0,R0001,1.0",
          "PROD-002,NoBom,desc,100.00,Component,,1.0,R0002,1.0",
          "PROD-003,NoRouter,desc,100.00,Component,BOM-003,1.0,,1.0",
          "PROD-004,BadLabor,desc,100.00,Component,BOM-001,1.0,R0004,1.0",
      ])

    w("forecast.csv",
      "forecast_id,name,description",
      ["F1,Base,base scenario"])

    # BOM-001 has TWO versions. Units points at v1.0; cost-summary filters
    # by version, source-data does not -> divergence test.
    w("bom.csv",
      "bom_id,version,bom_line,material_description,qty,unit,unit_price,material_cost,target_cost",
      [
          "BOM-001,1.0,1,Steel,1,EA,25.00,25.00,25.00",
          "BOM-001,2.0,1,Steel,1,EA,99.00,99.00,99.00",
          "BOM-003,1.0,1,Plastic,1,EA,10.00,10.00,10.00",
      ])

    w("machines.csv",
      "machine_id,machine_name,machine_description,machine_rate,labor_type",
      [
          "M0001,Mill,,120.00,Heavy",
          "M0002,Lathe,,60.00,Light",
      ])

    w("routers.csv",
      "router_id,router_name,router_description,version",
      [
          "R0001,Happy Router,,1.0",
          "R0002,NoBomProduct Router,,1.0",
          "R0004,BadLabor Router,,1.0",
      ])

    w("labor_rates.csv",
      "rate_id,rate_name,rate_description,rate_amount,rate_type",
      ["RATE-001,Heavy,Heavy op,40.00,Hourly"])


def _seed_post_init(db):
    """
    Insert rows whose CSV load order is broken upstream, plus one
    deliberately-orphaned labor_type_id to simulate data drift (a labor
    rate deleted after a router op referenced it). FK enforcement is
    disabled on this seed connection only; the route handlers open their
    own connections and still run with FK on.
    """
    conn = db.get_connection()
    conn.execute("PRAGMA foreign_keys=OFF")
    cur = conn.cursor()

    cur.executemany(
        "INSERT INTO sales "
        "(sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            ("SALE-001", "CUST-001", "PROD-001", "2024-01", 10, 100.0, 1000.0, "F1"),
            ("SALE-002", "CUST-001", "PROD-002", "2024-01", 10, 100.0, 1000.0, "F1"),
            ("SALE-003", "CUST-001", "PROD-003", "2024-01", 10, 100.0, 1000.0, "F1"),
            ("SALE-004", "CUST-001", "PROD-004", "2024-01", 10, 100.0, 1000.0, "F1"),
        ],
    )

    cur.executemany(
        "INSERT INTO router_operations "
        "(router_id, sequence, machine_id, machine_minutes, labor_minutes, labor_type_id, operation_description) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            ("R0001", 1, "M0001", 30, 15, "RATE-001", "Mill op"),
            ("R0002", 1, "M0002", 30, 15, "RATE-001", "Lathe op"),
            ("R0004", 1, "M0001", 30, 15, "RATE-DOES-NOT-EXIST", "Bad op"),
        ],
    )

    cur.execute(
        "INSERT INTO payroll "
        "(employee_id, employee_name, weekly_hours, hourly_rate, labor_type, "
        " start_date, end_date, forecast_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ("EMP-001", "Emp", 40, 50.0, "Heavy", "2024-01-01", "2024-12-31", "F1"),
    )

    conn.commit()
    db.close_connection(conn)


@pytest.fixture(scope="module")
def cost_client():
    """
    Spin up a FastAPI app with the real cost and source-data routers, wired
    to a freshly-seeded isolated DB.
    """
    tmp = tempfile.mkdtemp()
    try:
        _write_csvs(tmp)
        db = DatabaseManager(
            database_path=os.path.join(tmp, "rollup.db"),
            data_dir=tmp,
        )
        db.initialize()
        _seed_post_init(db)

        # Route modules use `from db.database import db_manager` at the top,
        # so patching the attribute on the imported module is what takes
        # effect at request time.
        import db.database as db_mod  # noqa: WPS433 - deliberately late
        original = db_mod.db_manager
        db_mod.db_manager = db

        import api.cost_routes as cost_routes  # noqa: WPS433
        import api.source_data_routes as source_data_routes  # noqa: WPS433
        cost_routes.db_manager = db  # lazy import uses this too via db.database
        source_data_routes.db_manager = db

        app = FastAPI()
        app.include_router(cost_routes.router)
        app.include_router(source_data_routes.router)

        with TestClient(app) as client:
            yield client

        db_mod.db_manager = original
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ---------- helpers ----------

def _cost_summary(client, forecast_id=None):
    params = {"forecast_id": forecast_id} if forecast_id else {}
    r = client.get("/products/cost-summary", params=params)
    assert r.status_code == 200, r.text
    return {p["product_id"]: p for p in r.json()["data"]["products"]}


def _source_forecast(client, forecast_id=None):
    params = {"forecast_id": forecast_id} if forecast_id else {}
    r = client.get("/source-data/sales-forecast", params=params)
    assert r.status_code == 200, r.text
    # Aggregate by unit_id the way reporting would.
    out = {}
    for row in r.json()["data"]["sales_forecast"]:
        uid = row["unit_id"]
        bucket = out.setdefault(uid, {
            "material_cost": 0.0,
            "labor_cost": 0.0,
            "machine_cost": 0.0,
            "total_cogs": 0.0,
            "total_revenue": 0.0,
        })
        bucket["material_cost"] += row["material_cost"]
        bucket["labor_cost"] += row["labor_cost"]
        bucket["machine_cost"] += row["machine_cost"]
        bucket["total_cogs"] += row["total_cogs"]
        bucket["total_revenue"] += row["total_revenue"]
    return out


# ---------- happy path ----------

class TestHappyPath:
    """
    PROD-001 / F1:
      qty=10, revenue=1000
      material = 25 * 10 = 250
      machine  = 120 * (30/60) * 10 = 600
      labor    =  40 * (15/60) * 10 = 100
      total_cogs = 950, margin = 50
    """

    def test_cost_summary_numbers(self, cost_client):
        rows = _cost_summary(cost_client, forecast_id="F1")
        p = rows["PROD-001"]
        assert p["forecasted_revenue"] == pytest.approx(1000.0)
        assert p["material_cost"] == pytest.approx(250.0)
        assert p["machine_cost"] == pytest.approx(600.0)
        assert p["labor_cost"] == pytest.approx(100.0)
        assert p["total_cogs"] == pytest.approx(950.0)
        assert p["gross_margin"] == pytest.approx(50.0)
        assert p["gross_margin_percent"] == pytest.approx(5.0)

    def test_source_forecast_numbers(self, cost_client):
        rows = _source_forecast(cost_client, forecast_id="F1")
        p = rows["PROD-001"]
        assert p["material_cost"] == pytest.approx(250.0)
        assert p["machine_cost"] == pytest.approx(600.0)
        assert p["labor_cost"] == pytest.approx(100.0)
        assert p["total_cogs"] == pytest.approx(950.0)


# ---------- silent-zero regressions ----------

class TestSilentZeros:
    """
    These document the current behaviour: missing data yields $0 with no
    signal to the caller. The /surface missing-BOM/router as data quality
    warnings/ task (#8) will add a visible warning path; when that lands,
    these tests stay green but additional assertions may be added.
    """

    def test_missing_bom_yields_zero_material_cost(self, cost_client):
        rows = _cost_summary(cost_client, forecast_id="F1")
        assert rows["PROD-002"]["material_cost"] == 0.0
        assert rows["PROD-002"]["machine_cost"] > 0.0  # router still works

    def test_missing_router_yields_zero_conversion_cost(self, cost_client):
        rows = _cost_summary(cost_client, forecast_id="F1")
        p = rows["PROD-003"]
        assert p["labor_cost"] == 0.0
        assert p["machine_cost"] == 0.0
        assert p["material_cost"] > 0.0  # BOM still applies


# ---------- known divergences between endpoints ----------

class TestWarnings:
    """
    /products/cost-summary tags each product with `warnings` codes for the
    data-quality issues that would otherwise silently understate cost.
    """

    def test_happy_path_has_no_warnings(self, cost_client):
        p = _cost_summary(cost_client, forecast_id="F1")["PROD-001"]
        assert p["warnings"] == []

    def test_missing_bom_flagged(self, cost_client):
        p = _cost_summary(cost_client, forecast_id="F1")["PROD-002"]
        assert "missing_bom" in p["warnings"]

    def test_missing_router_flagged(self, cost_client):
        p = _cost_summary(cost_client, forecast_id="F1")["PROD-003"]
        assert "missing_router" in p["warnings"]

    def test_missing_labor_rate_flagged(self, cost_client):
        p = _cost_summary(cost_client, forecast_id="F1")["PROD-004"]
        assert "router_missing_labor_rate" in p["warnings"]

    def test_summary_counts_products_with_warnings(self, cost_client):
        r = cost_client.get("/products/cost-summary", params={"forecast_id": "F1"})
        summary = r.json()["data"]["summary"]
        # PROD-002 (no BOM), PROD-003 (no router), PROD-004 (bad labor rate)
        assert summary["product_count"] == 4
        assert summary["products_with_warnings"] == 3


class TestUnitCostPreview:
    """
    /products/unit-cost returns the shared per-unit math for a BOM+router
    pairing. It's what the Product/BOM/Router modals call to show a live
    "≈ $X/unit" preview.
    """

    def test_happy_pairing(self, cost_client):
        r = cost_client.get(
            "/products/unit-cost",
            params={"bom_id": "BOM-001", "bom_version": "1.0", "router_id": "R0001"},
        )
        assert r.status_code == 200
        d = r.json()["data"]
        # Same per-unit values the happy-path rollup uses (25 + 10 + 60 = 95).
        assert d["material_per_unit"] == pytest.approx(25.0)
        assert d["labor_per_unit"] == pytest.approx(10.0)
        assert d["machine_per_unit"] == pytest.approx(60.0)
        assert d["total_per_unit"] == pytest.approx(95.0)
        assert d["warnings"] == []

    def test_no_selection_flags_missing_everything(self, cost_client):
        r = cost_client.get("/products/unit-cost")
        d = r.json()["data"]
        assert d["total_per_unit"] == 0.0
        assert "missing_bom" in d["warnings"]
        assert "missing_router" in d["warnings"]

    def test_bad_labor_rate_produces_warning(self, cost_client):
        r = cost_client.get(
            "/products/unit-cost",
            params={"bom_id": "BOM-001", "bom_version": "1.0", "router_id": "R0004"},
        )
        d = r.json()["data"]
        assert d["labor_per_unit"] == pytest.approx(0.0)
        assert "router_missing_labor_rate" in d["warnings"]


class TestEndpointParity:
    """
    Both endpoints now share `utils.cost_rollup.calculate_unit_costs` so
    they agree by construction. These tests pin that parity in place so
    any future divergence is immediately visible.
    """

    @pytest.mark.parametrize("product_id", ["PROD-001", "PROD-002", "PROD-003", "PROD-004"])
    def test_endpoints_agree_on_product_costs(self, cost_client, product_id):
        cs = _cost_summary(cost_client, forecast_id="F1")[product_id]
        sd = _source_forecast(cost_client, forecast_id="F1")[product_id]
        assert cs["material_cost"] == pytest.approx(sd["material_cost"])
        assert cs["labor_cost"] == pytest.approx(sd["labor_cost"])
        assert cs["machine_cost"] == pytest.approx(sd["machine_cost"])
        assert cs["total_cogs"] == pytest.approx(sd["total_cogs"])

    def test_bom_versioning_respected_everywhere(self, cost_client):
        """
        BOM-001 has versions 1.0 (=25) and 2.0 (=99). units.bom_version is
        1.0. Both endpoints must use version 1.0 only -> material=250.
        """
        cs = _cost_summary(cost_client, forecast_id="F1")["PROD-001"]
        sd = _source_forecast(cost_client, forecast_id="F1")["PROD-001"]
        assert cs["material_cost"] == pytest.approx(250.0)
        assert sd["material_cost"] == pytest.approx(250.0)

    def test_unknown_labor_rate_treated_as_zero_everywhere(self, cost_client):
        """
        PROD-004 has a router op with an unknown labor_type_id. Both
        endpoints must treat the missing rate as $0 (and flag it via
        `warnings`) instead of silently falling back to an average.
        """
        cs = _cost_summary(cost_client, forecast_id="F1")["PROD-004"]
        sd = _source_forecast(cost_client, forecast_id="F1")["PROD-004"]
        assert cs["labor_cost"] == pytest.approx(0.0)
        assert sd["labor_cost"] == pytest.approx(0.0)
