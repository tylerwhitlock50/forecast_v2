"""
Generic master-data CRUD (/forecast/create, /forecast/update,
/forecast/delete/{table}/{id}) as used by the BOM, routing, machine,
labor-rate, product and customer screens and by the MCP record tools.

Covers the audit findings: BOM material_cost derived from qty x unit_price,
currency-formatted numbers, composite keys whose ids contain '-', 404 when
nothing matched, router / BOM header deletes (cascade and 409 listing what
uses them), machine / labor-rate delete conflicts, BOM header versions and
sales period validation.
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
    c.executemany("INSERT INTO customers VALUES (?, ?, ?, ?)", [
        ("C-1001", "Main Street Guns", "Dealer", "Midwest"),
        ("C-2001", "RSR Group Inc.", "Distributor", "South"),
    ])
    c.executemany("INSERT INTO machines (machine_id, machine_name, machine_rate, available_minutes_per_month) "
                  "VALUES (?, ?, ?, ?)", [("CNC-01", "Haas CNC", 85, 19200), ("CERA-01", "Cerakote booth", 40, 9600)])
    c.executemany("INSERT INTO labor_rates (rate_id, rate_name, rate_amount, rate_type) VALUES (?, ?, ?, 'hourly')",
                  [("LR-MACH", "Machinist", 30), ("LR-FIN", "Finisher", 24)])
    c.executemany("INSERT INTO router_definitions (router_id, router_name, version) VALUES (?, ?, '1.0')",
                  [("RTG-BOLT", "Bolt action"), ("RTG-AR", "AR platform"), ("RTG-CUSTOM", "Custom shop")])
    c.executemany(
        "INSERT INTO router_operations (router_id, sequence, machine_id, machine_minutes, labor_minutes, labor_type_id, "
        "operation_description) VALUES (?, ?, ?, ?, ?, ?, ?)", [
            ("RTG-BOLT", 10, "CNC-01", 30, 30, "LR-MACH", "Machine receiver"),
            ("RTG-BOLT", 40, "CNC-01", 0, 45, "LR-MACH", "Fit bolt"),
            ("RTG-BOLT", 50, "CERA-01", 20, 15, "LR-FIN", "Cerakote"),
            ("RTG-AR", 10, "CNC-01", 20, 20, "LR-MACH", "Machine upper"),
            ("RTG-CUSTOM", 10, "CERA-01", 60, 60, "LR-FIN", "Custom finish"),
        ])
    c.executemany("INSERT INTO bom_definitions (bom_id, bom_name, version) VALUES (?, ?, '1.0')",
                  [("BOM-RFL-100", "Ridgeline rifle"), ("BOM-AR-10", "AR-10"), ("BOM-CUST-01", "Custom build")])
    c.executemany(
        "INSERT INTO bom (bom_id, version, bom_line, material_description, qty, unit, unit_price, material_cost) "
        "VALUES (?, ?, ?, ?, ?, 'EA', ?, ?)", [
            ("BOM-RFL-100", "1.0", 1, "Barrel blank 416R", 1, 145, 145),
            ("BOM-RFL-100", "1.0", 2, "Stock", 1, 210, 210),
            ("BOM-AR-10", "1.0", 1, "Upper receiver", 1, 120, 120),
            ("BOM-AR-10", "2027-A", 1, "Upper receiver (2027)", 1, 59, 59),
            ("BOM-CUST-01", "1.0", 1, "Exotic wood stock", 1, 900, 900),
            ("BOM-CUST-01", "1.0", 2, "Engraving", 1, 9, 9),
        ])
    c.executemany(
        "INSERT INTO units (unit_id, unit_name, base_price, unit_type, bom_id, bom_version, router_id, router_version) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, '1.0')", [
            ("RFL-100", "Ridgeline", 1899, "Rifle", "BOM-RFL-100", "1.0", "RTG-BOLT"),
            ("AR-10", "AR-10 rifle", 1599, "Rifle", "BOM-AR-10", "1.0", "RTG-AR"),
            ("CUST-HNT", "Custom hunter", 4999, "Rifle", "BOM-CUST-01", "1.0", "RTG-CUSTOM"),
        ])
    conn.commit()
    conn.close()


@pytest.fixture()
def env():
    tmp = tempfile.mkdtemp()
    db_path = os.path.join(tmp, "crud.db")
    mgr = DatabaseManager(database_path=db_path, data_dir=tmp)
    mgr.initialize()
    _seed(db_path)

    import app.db.database as dbmod
    import db.database as dbmod_short
    from api import crud_routes, data_routes, forecast_routes
    originals = (dbmod.db_manager, dbmod_short.db_manager)
    dbmod.db_manager = dbmod_short.db_manager = mgr
    app = FastAPI()
    for module in (forecast_routes, crud_routes, data_routes):
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


def create(client, table, data, status=200):
    res = client.post("/forecast/create", json={"table": table, "data": data})
    assert res.status_code == status, res.text
    return res.json()


def update(client, table, record_id, updates, status=200, **extra):
    res = client.post("/forecast/update", json={"table": table, "id": record_id, "updates": updates, **extra})
    assert res.status_code == status, res.text
    return res.json()


def delete(client, table, record_id, status=200, **params):
    res = client.delete(f"/forecast/delete/{table}/{record_id}", params=params)
    assert res.status_code == status, res.text
    return res.json()


def bom_line(mgr, bom_id, version, line):
    return q(mgr, "SELECT qty, unit_price, material_cost FROM bom WHERE bom_id = ? AND version = ? AND bom_line = ?",
             (bom_id, version, line))[0]


# ---------------------------------------------------------------------------
# bom-material-cost-not-derived / no-numeric-validation
# ---------------------------------------------------------------------------

def test_create_bom_line_derives_material_cost(env):
    client, mgr = env
    create(client, "bom", {"bom_id": "BOM-RFL-100", "version": "1.0", "bom_line": 3,
                           "material_description": "Spring", "qty": 1, "unit_price": 14})
    assert bom_line(mgr, "BOM-RFL-100", "1.0", 3) == (1.0, 14.0, 14.0)


def test_create_bom_line_parses_currency_text(env):
    client, mgr = env
    create(client, "bom", {"bom_id": "BOM-RFL-100", "version": "1.0", "bom_line": 4, "material_description": "Scope",
                           "qty": "2", "unit_price": "$1,050.00", "material_cost": "$2,100.00"})
    assert bom_line(mgr, "BOM-RFL-100", "1.0", 4) == (2.0, 1050.0, 2100.0)
    assert q(mgr, "SELECT typeof(unit_price), typeof(material_cost) FROM bom WHERE bom_line = 4")[0] == ("real", "real")


def test_create_bom_line_without_line_number_or_version(env):
    client, mgr = env
    body = create(client, "bom", {"bom_id": "BOM-RFL-100", "version": 1, "material_description": "Trigger",
                                  "qty": 1, "unit_price": "$89.50"})
    assert body["data"]["record"]["bom_line"] == 3
    assert bom_line(mgr, "BOM-RFL-100", "1.0", 3) == (1.0, 89.5, 89.5)


def test_update_bom_qty_and_price_recompute_material_cost(env):
    client, mgr = env
    update(client, "bom", "BOM-RFL-100-1.0-1", {"qty": 2})
    assert bom_line(mgr, "BOM-RFL-100", "1.0", 1) == (2.0, 145.0, 290.0)
    update(client, "bom", "BOM-RFL-100-1.0-2", {"unit_price": "$260"})
    assert bom_line(mgr, "BOM-RFL-100", "1.0", 2) == (1.0, 260.0, 260.0)


def test_update_bom_extended_cost_only_derives_unit_price(env):
    client, mgr = env
    update(client, "bom", "BOM-RFL-100-1.0-1", {"qty": 2, "unit_price": 0, "material_cost": 300})
    assert bom_line(mgr, "BOM-RFL-100", "1.0", 1) == (2.0, 150.0, 300.0)


def test_numeric_columns_reject_text_with_422_naming_the_column(env):
    client, mgr = env
    res = create(client, "machines", {"machine_id": "LATHE-9", "machine_name": "Lathe", "machine_rate": "eighty"}, 422)
    assert "machine_rate" in res["detail"]
    assert q(mgr, "SELECT COUNT(*) FROM machines WHERE machine_id = 'LATHE-9'") == [(0,)]
    res = update(client, "units", "RFL-100", {"base_price": "n/a"}, 422)
    assert "base_price" in res["detail"]


def test_numeric_columns_accept_currency_and_percent_text(env):
    client, mgr = env
    update(client, "units", "RFL-100", {"base_price": " $1,299.00 "})
    assert q(mgr, "SELECT base_price, typeof(base_price) FROM units WHERE unit_id = 'RFL-100'") == [(1299.0, "real")]
    update(client, "labor_rates", "LR-FIN", {"rate_amount": "(5)"})
    assert q(mgr, "SELECT rate_amount FROM labor_rates WHERE rate_id = 'LR-FIN'") == [(-5.0,)]
    update(client, "machines", "CNC-01", {"available_minutes_per_month": "19,200"})
    assert q(mgr, "SELECT available_minutes_per_month, typeof(available_minutes_per_month) FROM machines "
                  "WHERE machine_id = 'CNC-01'") == [(19200, "integer")]


# ---------------------------------------------------------------------------
# router-op-key-hyphen / update-success-on-zero-rows
# ---------------------------------------------------------------------------

def ops(mgr, router_id):
    return q(mgr, "SELECT sequence, labor_minutes FROM router_operations WHERE router_id = ? ORDER BY sequence",
             (router_id,))


def test_update_router_operation_whose_router_id_has_hyphens(env):
    client, mgr = env
    update(client, "router_operations", "RTG-BOLT-40", {"labor_minutes": 60})
    assert (40, 60.0) in ops(mgr, "RTG-BOLT")


def test_update_router_operation_from_ui_payload_changing_sequence(env):
    client, mgr = env
    payload = {"router_id": "RTG-BOLT", "sequence": 45, "machine_id": "CNC-01", "machine_minutes": 0,
               "labor_minutes": 50, "labor_type_id": "LR-MACH", "operation_description": "Fit bolt"}
    update(client, "router_operations", "RTG-BOLT-40", payload)
    assert ops(mgr, "RTG-BOLT") == [(10, 30.0), (45, 50.0), (50, 15.0)]


def test_update_router_operation_by_operation_id_and_by_key_in_body(env):
    client, mgr = env
    (op_id,) = q(mgr, "SELECT operation_id FROM router_operations WHERE router_id = 'RTG-AR' AND sequence = 10")[0]
    update(client, "router_operations", str(op_id), {"labor_minutes": 25})
    assert ops(mgr, "RTG-AR") == [(10, 25.0)]
    res = client.post("/forecast/update", json={"table": "router_operations",
                                                "key": {"router_id": "RTG-AR", "sequence": 10},
                                                "updates": {"labor_minutes": 26}})
    assert res.status_code == 200, res.text
    assert ops(mgr, "RTG-AR") == [(10, 26.0)]


def test_delete_router_operation_whose_router_id_has_hyphens(env):
    client, mgr = env
    delete(client, "router_operations", "RTG-BOLT-50")
    assert [s for s, _ in ops(mgr, "RTG-BOLT")] == [10, 40]
    delete(client, "router_operations", "RTG-BOLT-50", status=404)


def test_bom_line_with_hyphenated_version_can_be_updated_and_deleted(env):
    client, mgr = env
    update(client, "bom", "BOM-AR-10-2027-A-1", {"unit_price": 61})
    assert bom_line(mgr, "BOM-AR-10", "2027-A", 1) == (1.0, 61.0, 61.0)
    assert bom_line(mgr, "BOM-AR-10", "1.0", 1) == (1.0, 120.0, 120.0)
    res = client.post("/forecast/update", json={"table": "bom", "key": {"bom_id": "BOM-AR-10", "version": "1.0",
                                                                        "bom_line": 1}, "updates": {"qty": 2}})
    assert res.status_code == 200, res.text
    assert bom_line(mgr, "BOM-AR-10", "1.0", 1) == (2.0, 120.0, 240.0)
    delete(client, "bom", "BOM-AR-10-2027-A-1")
    assert q(mgr, "SELECT COUNT(*) FROM bom WHERE bom_id = 'BOM-AR-10'") == [(1,)]


def test_update_returns_404_when_nothing_matches(env):
    client, mgr = env
    res = update(client, "customers", "C-9999", {"region": "East"}, status=404)
    assert "C-9999" in res["detail"]
    update(client, "router_operations", "RTG-BOLT-99", {"labor_minutes": 1}, status=404)
    update(client, "bom", "BOM-RFL-100-1.0-77", {"qty": 3}, status=404)


def test_update_bom_with_partial_key_never_touches_lines(env):
    client, mgr = env
    before = q(mgr, "SELECT * FROM bom ORDER BY bom_id, version, bom_line")
    res = client.post("/forecast/update", json={"table": "bom", "id": "BOM-RFL-100", "updates": {"qty": 9}})
    assert res.status_code in (400, 404), res.text
    res = client.post("/forecast/update", json={"table": "bom", "id": "BOM1", "updates": {"qty": 9}})
    assert res.status_code in (400, 404), res.text
    assert q(mgr, "SELECT * FROM bom ORDER BY bom_id, version, bom_line") == before


def test_unknown_table_is_rejected(env):
    client, _ = env
    res = client.post("/forecast/update", json={"table": "bom_lines", "id": "x", "updates": {"qty": 1}})
    assert res.status_code == 400
    res = client.delete("/forecast/delete/bom_lines/x")
    assert res.status_code == 400


# ---------------------------------------------------------------------------
# router-delete-blocked
# ---------------------------------------------------------------------------

def test_router_delete_without_cascade_names_operations_and_products(env):
    client, mgr = env
    res = delete(client, "router_definitions", "RTG-CUSTOM", status=409)
    assert "CUST-HNT" in res["detail"] and "cascade=true" in res["detail"]
    assert q(mgr, "SELECT COUNT(*) FROM router_definitions WHERE router_id = 'RTG-CUSTOM'") == [(1,)]


def test_router_delete_with_cascade_removes_operations_and_unlinks_products(env):
    client, mgr = env
    body = delete(client, "router_definitions", "RTG-BOLT", cascade="true")
    assert body["data"]["deleted_operations"] == 3
    assert body["data"]["unlinked_products"] == ["RFL-100"]
    assert q(mgr, "SELECT COUNT(*) FROM router_operations WHERE router_id = 'RTG-BOLT'") == [(0,)]
    assert q(mgr, "SELECT COUNT(*) FROM router_definitions WHERE router_id = 'RTG-BOLT'") == [(0,)]
    assert q(mgr, "SELECT router_id FROM units WHERE unit_id = 'RFL-100'") == [(None,)]
    assert q(mgr, "SELECT router_id FROM units WHERE unit_id = 'AR-10'") == [("RTG-AR",)]


def test_unused_router_without_operations_deletes_without_cascade(env):
    client, mgr = env
    create(client, "router_definitions", {"router_id": "RTG-NEW", "router_name": "New"})
    delete(client, "router_definitions", "RTG-NEW")
    assert q(mgr, "SELECT COUNT(*) FROM router_definitions WHERE router_id = 'RTG-NEW'") == [(0,)]


def test_machine_and_labor_rate_delete_conflicts_name_the_routings(env):
    client, mgr = env
    res = delete(client, "machines", "CERA-01", status=409)
    assert "RTG-BOLT" in res["detail"] and "50" in res["detail"] and "RTG-CUSTOM" in res["detail"]
    res = delete(client, "labor_rates", "LR-FIN", status=409)
    assert "RTG-BOLT" in res["detail"] and "RTG-CUSTOM" in res["detail"]
    create(client, "machines", {"machine_id": "SPARE", "machine_name": "Spare"})
    delete(client, "machines", "SPARE")


# ---------------------------------------------------------------------------
# bom-delete-orphans / bom-header-single-version
# ---------------------------------------------------------------------------

def test_bom_header_delete_without_cascade_lists_products(env):
    client, mgr = env
    res = delete(client, "bom_definitions", "BOM-CUST-01", status=409)
    assert "CUST-HNT" in res["detail"] and "cascade=true" in res["detail"]
    assert q(mgr, "SELECT COUNT(*) FROM bom WHERE bom_id = 'BOM-CUST-01'") == [(2,)]


def test_bom_header_delete_with_cascade_removes_lines_and_unlinks_products(env):
    client, mgr = env
    body = delete(client, "bom_definitions", "BOM-AR-10", cascade="true")
    assert body["data"]["deleted_lines"] == 2
    assert body["data"]["unlinked_products"] == ["AR-10"]
    assert q(mgr, "SELECT COUNT(*) FROM bom WHERE bom_id = 'BOM-AR-10'") == [(0,)]
    assert q(mgr, "SELECT bom_id FROM units WHERE unit_id = 'AR-10'") == [(None,)]


def test_unused_bom_header_delete_keeps_old_ui_flow_working(env):
    client, mgr = env
    create(client, "bom_definitions", {"bom_id": "BOM-NEW", "bom_name": "New"})
    create(client, "bom", {"bom_id": "BOM-NEW", "version": "1.0", "bom_line": 1, "material_description": "x",
                           "qty": 1, "unit_price": 5})
    delete(client, "bom_definitions", "BOM-NEW")
    delete(client, "bom", "BOM-NEW-1.0-1")
    assert q(mgr, "SELECT COUNT(*) FROM bom WHERE bom_id = 'BOM-NEW'") == [(0,)]


def test_bom_header_tracks_newest_version(env):
    client, mgr = env
    body = create(client, "bom_definitions", {"bom_id": "BOM-RFL-100", "bom_name": "Ridgeline rifle", "version": "2.0"})
    assert body["status"] == "success"
    assert q(mgr, "SELECT version FROM bom_definitions WHERE bom_id = 'BOM-RFL-100'") == [("2.0",)]
    create(client, "bom", {"bom_id": "BOM-RFL-100", "version": "3", "bom_line": 1, "material_description": "Barrel",
                           "qty": 1, "unit_price": 150})
    assert q(mgr, "SELECT version FROM bom_definitions WHERE bom_id = 'BOM-RFL-100'") == [("3.0",)]
    # an older version's line never moves the header back
    create(client, "bom", {"bom_id": "BOM-RFL-100", "version": "1.0", "bom_line": 9, "material_description": "Pin",
                           "qty": 1, "unit_price": 1})
    assert q(mgr, "SELECT version FROM bom_definitions WHERE bom_id = 'BOM-RFL-100'") == [("3.0",)]
    # every version's lines stay reachable through /data/bom
    rows = client.get("/data/bom", params={"bom_id": "BOM-RFL-100"}).json()["data"]
    assert sorted({r["version"] for r in rows}) == ["1.0", "3.0"]
    # a duplicate header is a clear conflict, not a 500
    create(client, "bom_definitions", {"bom_id": "BOM-RFL-100", "bom_name": "dup", "version": "3.0"}, 409)


def test_bom_line_for_unknown_bom_creates_its_header(env):
    client, mgr = env
    create(client, "bom", {"bom_id": "BOM-NEW-2", "material_description": "x", "qty": 1, "unit_price": 5})
    assert q(mgr, "SELECT bom_name, version FROM bom_definitions WHERE bom_id = 'BOM-NEW-2'") == [("BOM-NEW-2", "1.0")]


# ---------------------------------------------------------------------------
# weekly-quarterly-periods-break-scenario (/forecast/create sales)
# ---------------------------------------------------------------------------

def test_create_sales_rejects_non_monthly_periods(env):
    client, mgr = env
    for period in ("2027-Q4", "2027-W05", "someday"):
        res = client.post("/forecast/create", json={"sales": {
            "customer_id": "C-1001", "unit_id": "RFL-100", "period": period, "quantity": 5, "unit_price": 1500,
            "total_revenue": 7500, "forecast_id": "F001"}})
        assert res.status_code == 422, res.text
        assert "YYYY-MM" in res.json()["detail"]
    res = create(client, "sales", {"customer_id": "C-1001", "unit_id": "RFL-100", "period": "2027-Q1",
                                   "quantity": 1, "unit_price": 1, "forecast_id": "F001", "sale_id": "S-1"}, 422)
    assert q(mgr, "SELECT COUNT(*) FROM sales") == [(0,)]


def test_create_sales_normalizes_period_and_derives_revenue(env):
    client, mgr = env
    res = client.post("/forecast/create", json={"sales": {
        "customer_id": "C-1001", "unit_id": "RFL-100", "period": "2027-03-01", "quantity": 5, "unit_price": "$1,500",
        "forecast_id": "F001"}})
    assert res.status_code == 200, res.text
    assert q(mgr, "SELECT period, quantity, unit_price, total_revenue FROM sales") == [("2027-03", 5, 1500.0, 7500.0)]


def test_create_sales_with_unknown_customer_is_a_clear_422(env):
    client, mgr = env
    res = client.post("/forecast/create", json={"sales": {
        "customer_id": "C-TYPO", "unit_id": "RFL-100", "period": "2027-03", "quantity": 5, "unit_price": 1,
        "forecast_id": "F001"}})
    assert res.status_code == 422, res.text
    assert "C-TYPO" in res.json()["detail"]


def test_bom_keys_tolerate_version_spelling_and_query_parameters(env):
    client, mgr = env
    update(client, "bom", "BOM-RFL-100-1-2", {"qty": 3})  # '1' finds version '1.0'
    assert bom_line(mgr, "BOM-RFL-100", "1.0", 2) == (3.0, 210.0, 630.0)
    res = client.delete("/forecast/delete/bom/line", params={"bom_id": "BOM-AR-10", "version": "2027-A", "bom_line": 1})
    assert res.status_code == 200, res.text
    assert q(mgr, "SELECT version FROM bom WHERE bom_id = 'BOM-AR-10'") == [("1.0",)]
    res = client.delete("/forecast/delete/router_operations/op", params={"router_id": "RTG-BOLT", "sequence": 10})
    assert res.status_code == 200, res.text
    assert [s for s, _ in ops(mgr, "RTG-BOLT")] == [40, 50]


def test_update_conflicts_are_409_and_unknown_references_422(env):
    client, mgr = env
    res = update(client, "router_operations", "RTG-BOLT-40", {"sequence": 50}, status=409)
    assert "already exists" in res["detail"]
    res = update(client, "router_operations", "RTG-BOLT-40", {"machine_id": "NOPE-1"}, status=422)
    assert "NOPE-1" in res["detail"]
    assert ops(mgr, "RTG-BOLT") == [(10, 30.0), (40, 45.0), (50, 15.0)]
