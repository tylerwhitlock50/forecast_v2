"""
CSV table loader (/database/load_table), the data-quality report
(/database/quality, MCP forecast_data_quality), the startup CSV loader's BOM
headers and the legacy GET /forecast + /forecast/results views.

Covers: replace deletes rows instead of dropping / recreating the table (PKs,
columns and foreign keys survive), append reports row-level errors and
writes nothing, ids keep leading zeros, ERP headers map to columns, BOM lines
get material_cost and a header; data quality flags products the statements
engine would warn about; GET /forecast no longer rewrites forecast_results
and costs with the BOM version and routing operations.
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


def _seed(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F001', 'Plan 2027', 1)")
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F002', 'Upside', 0)")
    c.executemany("INSERT INTO customers VALUES (?, ?, ?, ?)", [
        ("C-1001", "Main Street Guns", "Dealer", "Midwest"),
        ("C-2001", "RSR Group Inc.", "Distributor", "South"),
    ])
    c.executemany("INSERT INTO machines (machine_id, machine_name, machine_rate, available_minutes_per_month) "
                  "VALUES (?, ?, ?, ?)", [("CNC-01", "Haas CNC", 60, 19200), ("CERA-01", "Cerakote booth", 30, 9600)])
    c.executemany("INSERT INTO labor_rates (rate_id, rate_name, rate_amount, rate_type) VALUES (?, ?, ?, 'hourly')",
                  [("LR-MACH", "Machinist", 30), ("LR-FIN", "Finisher", 24)])
    c.execute("INSERT INTO router_definitions (router_id, router_name) VALUES ('RTG-BOLT', 'Bolt action')")
    c.executemany(
        "INSERT INTO router_operations (router_id, sequence, machine_id, machine_minutes, labor_minutes, labor_type_id) "
        "VALUES (?, ?, ?, ?, ?, ?)", [("RTG-BOLT", 10, "CNC-01", 30, 60, "LR-MACH"),
                                      ("RTG-BOLT", 20, "CERA-01", 60, 30, "LR-FIN")])
    c.execute("INSERT INTO bom_definitions (bom_id, bom_name, version) VALUES ('BOM-RFL-100', 'Ridgeline', '2.0')")
    c.executemany(
        "INSERT INTO bom (bom_id, version, bom_line, material_description, qty, unit_price, material_cost) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)", [
            ("BOM-RFL-100", "1.0", 1, "Barrel", 1, 100, 100),
            ("BOM-RFL-100", "2.0", 1, "Barrel v2", 1, 300, 300),
            ("BOM-RFL-100", "2.0", 2, "Stock v2", 2, 50, 100),
        ])
    c.executemany(
        "INSERT INTO units (unit_id, unit_name, base_price, unit_type, bom_id, bom_version, router_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)", [
            ("RFL-100", "Ridgeline", 1899, "Rifle", "BOM-RFL-100", "2.0", "RTG-BOLT"),
            ("RFL-200", "No BOM rifle", 999, "Rifle", "", "1.0", ""),
            ("PST-1", "Pistol wrong version", 499, "Pistol", "BOM-RFL-100", "9.0", "RTG-BOLT"),
        ])
    c.executemany(
        "INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
            ("S1", "C-1001", "RFL-100", "2027-01", 10, 1500, 15000, "F001"),
            ("S2", "C-2001", "RFL-200", "2027-01", 5, 900, 4500, "F001"),
            ("S3", "C-1001", "RFL-100", "2027-02", 2, 1500, 3000, "F002"),
        ])
    conn.commit()
    conn.close()


@pytest.fixture()
def env():
    tmp = tempfile.mkdtemp()
    db_path = os.path.join(tmp, "loader.db")
    mgr = DatabaseManager(database_path=db_path, data_dir=tmp)
    mgr.initialize()
    _seed(db_path)

    import app.db.database as dbmod
    import db.database as dbmod_short
    from api import crud_routes, database_routes, forecast_routes
    originals = (dbmod.db_manager, dbmod_short.db_manager)
    dbmod.db_manager = dbmod_short.db_manager = mgr
    app = FastAPI()
    for module in (forecast_routes, crud_routes, database_routes):
        app.include_router(module.router)
    try:
        yield TestClient(app), mgr
    finally:
        dbmod.db_manager, dbmod_short.db_manager = originals
        shutil.rmtree(tmp, ignore_errors=True)


def q(mgr, sql, params=()):
    conn = mgr.get_connection()
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        mgr.close_connection(conn)


def schema(mgr, table):
    return q(mgr, "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", (table,))[0][0]


def load(client, table, csv_text, mode="append", status=200):
    res = client.post("/database/load_table", params={"table_name": table, "mode": mode},
                      files={"csv_file": ("upload.csv", csv_text.encode("utf-8"), "text/csv")})
    assert res.status_code == status, res.text
    return res.json()


# ---------------------------------------------------------------------------
# load-table-destructive-and-unvalidated
# ---------------------------------------------------------------------------

def test_replace_deletes_rows_and_keeps_schema(env):
    client, mgr = env
    before = schema(mgr, "bom")
    body = load(client, "bom", "bom_id,version,bom_line,material_description,qty,unit_price\n"
                               "BOM-RFL-200,1.0,1,Barrel,1,99\n", mode="replace")
    assert body["data"]["rows_loaded"] == 1
    assert schema(mgr, "bom") == before
    assert q(mgr, "SELECT bom_id, version, bom_line, qty, unit_price, material_cost FROM bom") == [
        ("BOM-RFL-200", "1.0", 1, 1.0, 99.0, 99.0)]
    # the primary key still holds: appending the same line is a row error, not a duplicate
    res = load(client, "bom", "bom_id,version,bom_line,material_description,qty,unit_price\n"
                              "BOM-RFL-200,1.0,1,Barrel,1,99\n", status=422)
    assert "row 1" in res["detail"].lower() and "upsert" in res["detail"]
    assert q(mgr, "SELECT COUNT(*) FROM bom") == [(1,)]


def test_replace_units_keeps_primary_key_and_sales_foreign_key(env):
    client, mgr = env
    before = schema(mgr, "units")
    load(client, "units", "unit_id,unit_name,base_price,bom_id,router_id\n"
                          "RFL-100,Ridgeline,1899,BOM-RFL-100,RTG-BOLT\n"
                          "RFL-200,No BOM rifle,999,,\n"
                          "PST-1,Pistol,499,,\n", mode="replace")
    assert schema(mgr, "units") == before
    assert q(mgr, "SELECT unit_id, bom_id, bom_version FROM units ORDER BY unit_id")[0] == ("PST-1", None, "1.0")
    conn = mgr.get_connection()
    try:
        conn.execute("INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, "
                     "forecast_id) VALUES ('S9', 'C-1001', 'RFL-200', '2027-03', 1, 1, 1, 'F001')")
        conn.commit()
    finally:
        mgr.close_connection(conn)


def test_replace_that_would_orphan_rows_is_refused_with_names(env):
    client, mgr = env
    # same machine ids: allowed (foreign keys are checked after the reload)
    load(client, "machines", "machine_id,machine_name,machine_rate\nCNC-01,Haas CNC,65\nCERA-01,Booth,35\n",
         mode="replace")
    assert q(mgr, "SELECT machine_rate FROM machines ORDER BY machine_id") == [(35.0,), (65.0,)]
    res = load(client, "machines", "machine_id,machine_name,machine_rate\nCNC-01,Haas CNC,65\n", mode="replace",
               status=409)
    assert "router_operations" in res["detail"] and "CERA-01" in res["detail"]
    assert q(mgr, "SELECT COUNT(*) FROM machines") == [(2,)]


def test_append_reports_every_bad_row_and_writes_nothing(env):
    client, mgr = env
    res = load(client, "customers", "customer_id,customer_name\nC-3001,New\nC-1001,Dup\n,Nameless id\n", status=422)
    detail = res["detail"]
    assert "row 2" in detail and "C-1001" in detail
    assert "row 3" in detail and "customer_id" in detail
    assert q(mgr, "SELECT COUNT(*) FROM customers") == [(2,)]


def test_append_rejects_non_numeric_values_naming_the_column(env):
    client, mgr = env
    res = load(client, "machines", "machine_id,machine_name,machine_rate\nM-9,Saw,cheap\n", status=422)
    assert "machine_rate" in res["detail"] and "row 1" in res["detail"].lower()
    body = load(client, "machines", "machine_id,machine_name,machine_rate\nM-9,Saw,\"$1,050.00\"\n")
    assert body["data"]["rows_loaded"] == 1
    assert q(mgr, "SELECT machine_rate FROM machines WHERE machine_id = 'M-9'") == [(1050.0,)]


def test_unknown_table_is_400_and_creates_nothing(env):
    client, mgr = env
    load(client, "bom_lines", "bom_id,qty\nX,1\n", status=400)
    assert q(mgr, "SELECT COUNT(*) FROM sqlite_master WHERE name = 'bom_lines'") == [(0,)]
    load(client, "bom", "bom_id,qty\nX,1\n", mode="drop", status=400)


def test_ids_keep_leading_zeros(env):
    client, mgr = env
    load(client, "customers", "customer_id,customer_name,customer_type\n000123,Zero Padded,Dealer\n")
    assert q(mgr, "SELECT customer_id FROM customers WHERE customer_name = 'Zero Padded'") == [("000123",)]


def test_erp_headers_map_and_bom_lines_get_cost_and_header(env):
    client, mgr = env
    body = load(client, "bom", "Parent Item,Rev,Line,Description,Qty Per,UOM,Unit Cost\n"
                               "BOM-AR-15,1,1,Upper receiver,1,EA,$120.00\n"
                               "BOM-AR-15,1,,Buffer spring,2,EA,4.50\n")
    assert body["data"]["rows_loaded"] == 2
    assert q(mgr, "SELECT version, bom_line, material_description, qty, unit, unit_price, material_cost FROM bom "
                  "WHERE bom_id = 'BOM-AR-15' ORDER BY bom_line") == [
        ("1.0", 1, "Upper receiver", 1.0, "EA", 120.0, 120.0),
        ("1.0", 2, "Buffer spring", 2.0, "EA", 4.5, 9.0)]
    assert q(mgr, "SELECT bom_name, version FROM bom_definitions WHERE bom_id = 'BOM-AR-15'") == [("BOM-AR-15", "1.0")]


def test_upsert_updates_supplied_columns_only(env):
    client, mgr = env
    body = load(client, "units", "unit_id,unit_name,base_price\nRFL-100,Ridgeline,1949\nNEW-1,New rifle,999\n",
                mode="upsert")
    assert body["data"]["inserted"] == 1 and body["data"]["updated"] == 1
    assert q(mgr, "SELECT base_price, bom_id, router_id FROM units WHERE unit_id = 'RFL-100'") == [
        (1949.0, "BOM-RFL-100", "RTG-BOLT")]
    body = load(client, "router_operations", "router_id,sequence,machine_id,labor_minutes\nRTG-BOLT,20,CERA-01,45\n",
                mode="upsert")
    assert body["data"]["updated"] == 1
    assert q(mgr, "SELECT labor_minutes, machine_minutes FROM router_operations WHERE sequence = 20") == [(45.0, 60.0)]


def test_sales_load_rejects_quarterly_periods(env):
    client, mgr = env
    res = load(client, "sales", "sale_id,customer_id,unit_id,period,quantity,unit_price,forecast_id\n"
                                "S10,C-1001,RFL-100,2027-Q1,1,10,F001\n", status=422)
    assert "YYYY-MM" in res["detail"]
    load(client, "sales", "sale_id,customer_id,unit_id,period,quantity,unit_price,forecast_id\n"
                          "S10,C-1001,RFL-100,Jan-2027,3,10,F001\n")
    assert q(mgr, "SELECT period, total_revenue FROM sales WHERE sale_id = 'S10'") == [("2027-01", 30.0)]


# ---------------------------------------------------------------------------
# data-quality-check-broken
# ---------------------------------------------------------------------------

def test_quality_flags_products_and_routings_the_engine_warns_about(env):
    client, mgr = env
    conn = mgr.get_connection()
    try:
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute("INSERT INTO router_operations (router_id, sequence, machine_id, labor_minutes, labor_type_id) "
                     "VALUES ('RTG-BOLT', 30, 'GONE-01', 10, 'LR-GONE')")
        conn.execute("INSERT INTO router_definitions (router_id, router_name) VALUES ('RTG-EMPTY', 'Empty')")
        conn.execute("INSERT INTO bom (bom_id, version, bom_line, material_description, qty, unit_price, material_cost) "
                     "VALUES ('BOM-ORPHAN', '1.0', 1, 'x', 2, 10, 5)")
        conn.commit()
    finally:
        mgr.close_connection(conn)

    res = client.get("/database/quality")
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert [s["sale_id"] for s in data["sales_missing_bom"]] == ["S2"]
    missing_bom = {p["unit_id"]: p for p in data["products_missing_bom"]}
    assert missing_bom["RFL-200"]["reason"] == "no_bom_assigned" and missing_bom["RFL-200"]["sales_rows"] == 1
    assert missing_bom["PST-1"]["reason"] == "bom_version_has_no_lines"
    assert missing_bom["PST-1"]["available_versions"] == ["1.0", "2.0"]
    assert "RFL-100" not in missing_bom
    assert {p["unit_id"] for p in data["products_missing_router"]} == {"RFL-200"}
    assert [(o["router_id"], o["sequence"], o["machine_id"]) for o in data["routers_missing_machine"]] == [
        ("RTG-BOLT", 30, "GONE-01")]
    assert [o["labor_type_id"] for o in data["operations_missing_labor_rate"]] == ["LR-GONE"]
    assert [r["router_id"] for r in data["routers_without_operations"]] == ["RTG-EMPTY"]
    assert [b["bom_id"] for b in data["bom_lines_without_header"]] == ["BOM-ORPHAN"]
    assert [(b["bom_id"], b["issue"]) for b in data["bom_line_issues"]] == [("BOM-ORPHAN", "material_cost_mismatch")]
    assert data["summary"]["total_issues"] > 0
    assert "employees_missing_labor_rate" in data


# ---------------------------------------------------------------------------
# legacy-forecast-get-wrong-cogs
# ---------------------------------------------------------------------------

def test_get_forecast_is_read_only_and_uses_the_cost_rollup(env):
    client, mgr = env
    conn = mgr.get_connection()
    try:
        conn.execute("INSERT INTO forecast_results (forecast_date, period, total_revenue) VALUES ('x', 'sentinel', 1)")
        conn.commit()
    finally:
        mgr.close_connection(conn)

    res = client.get("/forecast", params={"forecast_id": "F001"})
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert q(mgr, "SELECT period FROM forecast_results") == [("sentinel",)]
    results = {r["unit_id"]: r for r in data["forecast_results"]}
    assert set(results) == {"RFL-100", "RFL-200"}  # scenario F001 only
    rfl = results["RFL-100"]
    # BOM v2.0 (300 + 100) x 10 units; labor 60 min x $30 + 30 min x $24 = $42/unit; machine 30 min x $60 + 60 min x $30
    assert rfl["material_cost"] == pytest.approx(4000.0)
    assert rfl["labor_cost"] == pytest.approx(420.0)
    assert rfl["machine_cost"] == pytest.approx(600.0)
    assert rfl["gross_margin"] == pytest.approx(15000 - 5020.0)
    assert [s["forecast_id"] for s in data["sales_forecast"]] == ["F001", "F001"]

    res = client.get("/forecast/results", params={"period": "2027-02"})
    assert res.status_code == 200
    rows = res.json()["data"]["results"]
    assert [(r["unit_id"], r["material_cost"]) for r in rows] == [("RFL-100", pytest.approx(800.0))]


# ---------------------------------------------------------------------------
# router-version-unused-and-startup-bom-name (startup BOM headers)
# ---------------------------------------------------------------------------

def test_startup_loader_names_headers_after_the_bom_and_uses_the_newest_version():
    tmp = tempfile.mkdtemp()
    try:
        with open(os.path.join(tmp, "bom.csv"), "w") as f:
            f.write("bom_id,version,bom_line,material_description,qty,unit_price\n"
                    "BOM-RFL-100,1,1,Barrel blank 416R,1,145\n"
                    "BOM-RFL-100,2,1,Barrel blank 416R v2,1,150\n"
                    "BOM-AR-10,1,1,Upper receiver,2,60\n")
        mgr = DatabaseManager(database_path=os.path.join(tmp, "startup.db"), data_dir=tmp)
        mgr.initialize()
        assert q(mgr, "SELECT bom_id, bom_name, version FROM bom_definitions ORDER BY bom_id") == [
            ("BOM-AR-10", "BOM-AR-10", "1.0"), ("BOM-RFL-100", "BOM-RFL-100", "2.0")]
        assert q(mgr, "SELECT version, material_cost FROM bom WHERE bom_id = 'BOM-AR-10'") == [("1.0", 120.0)]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_startup_loader_uses_a_bom_name_column_when_present():
    tmp = tempfile.mkdtemp()
    try:
        with open(os.path.join(tmp, "bom.csv"), "w") as f:
            f.write("bom_id,bom_name,version,bom_line,material_description,qty,unit_price,material_cost\n"
                    "BOM-RFL-100,Ridgeline rifle,1.0,1,Barrel blank 416R,1,145,145\n")
        mgr = DatabaseManager(database_path=os.path.join(tmp, "startup.db"), data_dir=tmp)
        mgr.initialize()
        assert q(mgr, "SELECT bom_name FROM bom_definitions") == [("Ridgeline rifle",)]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_bom_upsert_without_version_column_and_qty_default(env):
    client, mgr = env
    body = load(client, "bom", "bom_id,bom_line,material_description,unit_price\nBOM-NEW,1,Spring,4\n")
    assert any("loaded as 1" in w for w in body["data"]["warnings"])
    assert q(mgr, "SELECT version, qty, material_cost FROM bom WHERE bom_id = 'BOM-NEW'") == [("1.0", 1.0, 4.0)]
    body = load(client, "bom", "bom_id,bom_line,unit_price\nBOM-NEW,1,5\n", mode="upsert")
    assert body["data"]["updated"] == 1
    assert q(mgr, "SELECT qty, unit_price, material_cost FROM bom WHERE bom_id = 'BOM-NEW'") == [(1.0, 5.0, 5.0)]
