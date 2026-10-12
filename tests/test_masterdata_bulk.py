"""
Bulk sales edits (/forecast/bulk_update, used by the revenue matrix and the
MCP forecast_upsert_sales tool) and the bulk customer / product imports
(/forecast/bulk_create_customers, /forecast/bulk_create_products).

Covers: a failed row never leaves the database write-locked, new rows get
total_revenue = quantity x unit_price, non-monthly periods are rejected with
a clear error, update mode only changes the columns the file fills in (and
never blanks BOM / routing links), blanks are stored as NULL, currency text
is parsed, and create_new generates ids that never collide.
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
    c.executemany(
        "INSERT INTO units (unit_id, unit_name, base_price, unit_type, bom_id, bom_version, router_id, router_version) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, '1.0')", [
            ("RFL-100", "Ridgeline", 1899, "Rifle", "BOM-RFL-100", "1.0", "RTG-BOLT"),
            ("RFL-400", "Summit", 2499, "Rifle", "BOM-RFL-400", "2.0", "RTG-BOLT"),
            ("AR-10", "AR-10 rifle", 1599, "Rifle", "BOM-AR-10", "1.0", "RTG-AR"),
        ])
    conn.commit()
    conn.close()


@pytest.fixture()
def env():
    tmp = tempfile.mkdtemp()
    db_path = os.path.join(tmp, "bulk.db")
    mgr = DatabaseManager(database_path=db_path, data_dir=tmp)
    mgr.initialize()
    _seed(db_path)

    import app.db.database as dbmod
    import db.database as dbmod_short
    from api import crud_routes, forecast_routes
    originals = (dbmod.db_manager, dbmod_short.db_manager)
    dbmod.db_manager = dbmod_short.db_manager = mgr
    app = FastAPI()
    for module in (forecast_routes, crud_routes):
        app.include_router(module.router)
    try:
        yield TestClient(app), mgr, db_path
    finally:
        dbmod.db_manager, dbmod_short.db_manager = originals
        shutil.rmtree(tmp, ignore_errors=True)


def q(mgr, sql, params=()):
    conn = mgr.get_connection()
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        mgr.close_connection(conn)


def row(customer="C-1001", unit="RFL-100", period="2027-01", **extra):
    return {"forecast_id": "F001", "customer_id": customer, "unit_id": unit, "period": period, **extra}


def bulk(client, forecasts, operation="replace", status=200):
    res = client.post("/forecast/bulk_update", json={"forecasts": forecasts, "operation": operation})
    assert res.status_code == status, res.text
    return res.json()


def assert_writable(db_path):
    """A separate connection can take the write lock right away."""
    conn = sqlite3.connect(db_path, timeout=0.5)
    try:
        conn.execute("INSERT INTO forecast (forecast_id, name) VALUES ('F999', 'after error')")
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# db-lock-after-bulk-update-error
# ---------------------------------------------------------------------------

def test_unknown_ids_are_a_422_listing_them_and_nothing_is_written(env):
    client, mgr, db_path = env
    res = bulk(client, [row(quantity=1, unit_price=10), row(customer="C-TYPO", quantity=2, unit_price=10),
                        row(unit="R-100", period="2027-02", quantity=2, unit_price=10)], status=422)
    assert "C-TYPO" in res["detail"] and "R-100" in res["detail"]
    assert q(mgr, "SELECT COUNT(*) FROM sales") == [(0,)]
    assert_writable(db_path)
    # and the API keeps working
    assert client.post("/forecast/scenario", json={"name": "after lock"}).status_code == 200


def test_unknown_scenario_and_bad_numbers_are_422(env):
    client, mgr, db_path = env
    res = bulk(client, [{**row(quantity=1, unit_price=1), "forecast_id": "F404"}], status=422)
    assert "F404" in res["detail"]
    res = bulk(client, [row(quantity="lots", unit_price=1)], status=422)
    assert "quantity" in res["detail"]
    assert_writable(db_path)


def test_database_error_mid_batch_rolls_back_and_releases_the_lock(env, monkeypatch):
    client, mgr, db_path = env
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TRIGGER boom BEFORE INSERT ON sales WHEN NEW.period = '2027-02' "
                 "BEGIN SELECT RAISE(ABORT, 'boom'); END")
    conn.commit()
    conn.close()
    res = client.post("/forecast/bulk_update", json={"forecasts": [
        row(quantity=1, unit_price=10), row(period="2027-02", quantity=1, unit_price=10)]})
    assert res.status_code == 500
    assert q(mgr, "SELECT COUNT(*) FROM sales") == [(0,)]
    assert_writable(db_path)


# ---------------------------------------------------------------------------
# bulk-update-revenue-zero
# ---------------------------------------------------------------------------

def test_new_rows_get_revenue_from_quantity_and_price(env):
    client, mgr, _ = env
    body = bulk(client, [row(period="2027-10", quantity=10, unit_price=368.18)])
    assert body["data"]["updated_count"] == 1
    assert q(mgr, "SELECT quantity, unit_price, total_revenue FROM sales") == [(10, 368.18, 3681.8)]


def test_given_revenue_is_kept_and_updates_recompute(env):
    client, mgr, _ = env
    bulk(client, [row(quantity=2, unit_price=100, total_revenue=190)])
    assert q(mgr, "SELECT total_revenue FROM sales") == [(190.0,)]
    bulk(client, [row(quantity=3, unit_price=100)])
    assert q(mgr, "SELECT quantity, total_revenue FROM sales") == [(3, 300.0)]
    bulk(client, [row(quantity=2)], operation="add")
    assert q(mgr, "SELECT quantity, unit_price, total_revenue FROM sales") == [(5, 100.0, 500.0)]


def test_currency_text_is_parsed(env):
    client, mgr, _ = env
    bulk(client, [row(quantity="1,200", unit_price="$1,050.50")])
    assert q(mgr, "SELECT quantity, unit_price, total_revenue FROM sales") == [(1200, 1050.5, 1260600.0)]


# ---------------------------------------------------------------------------
# weekly-quarterly-periods-break-scenario
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("period", ["2027-Q4", "2027-W05", "2027-Q4-01", "not a month", ""])
def test_non_monthly_periods_are_rejected(env, period):
    client, mgr, _ = env
    res = bulk(client, [row(quantity=1, unit_price=1), row(period=period, quantity=1, unit_price=1)], status=422)
    assert "YYYY-MM" in res["detail"] or "period is required" in res["detail"]
    assert q(mgr, "SELECT COUNT(*) FROM sales") == [(0,)]


def test_ui_and_spreadsheet_month_forms_are_accepted(env):
    client, mgr, _ = env
    bulk(client, [row(period="2027-01-01", quantity=1, unit_price=1), row(period="10/1/2027", quantity=1, unit_price=1),
                  row(period="Mar-27", quantity=1, unit_price=1)])
    assert [p for (p,) in q(mgr, "SELECT period FROM sales ORDER BY period")] == ["2027-01", "2027-03", "2027-10"]


def test_subtract_on_a_missing_row_is_reported_not_inserted(env):
    client, mgr, _ = env
    body = bulk(client, [row(quantity=5)], operation="subtract")
    assert body["data"]["updated_count"] == 0
    assert body["data"]["skipped"][0]["row"] == 1
    assert q(mgr, "SELECT COUNT(*) FROM sales") == [(0,)]


# ---------------------------------------------------------------------------
# bulk-update-wipes-links / no-numeric-validation / create-new-id-collision
# ---------------------------------------------------------------------------

def unit(mgr, unit_id):
    return q(mgr, "SELECT unit_name, base_price, unit_type, bom_id, bom_version, router_id, unit_description "
                  "FROM units WHERE unit_id = ?", (unit_id,))[0]


def test_product_update_only_changes_supplied_columns(env):
    client, mgr, _ = env
    res = client.post("/forecast/bulk_create_products", json={
        "products": [{"unit_id": "RFL-100", "unit_name": "Ridgeline", "base_price": "$1,949.00",
                      "bom_id": "", "router_id": None}],
        "options": {"merge_strategy": "update"}})
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["updated"] == 1 and data["errors"] == []
    assert data["records"][0]["fields"] == ["base_price"]
    assert unit(mgr, "RFL-100") == ("Ridgeline", 1949.0, "Rifle", "BOM-RFL-100", "1.0", "RTG-BOLT", None)


def test_product_update_normalizes_versions_and_reports_unchanged(env):
    client, mgr, _ = env
    res = client.post("/forecast/bulk_create_products", json={
        "products": [{"product_id": "RFL-400", "product_name": "Summit", "bom_version": 3},
                     {"unit_id": "AR-10", "unit_name": "AR-10 rifle"}],
        "options": {"merge_strategy": "update"}})
    data = res.json()["data"]
    assert data["updated"] == 1 and data["unchanged"] == 1
    assert unit(mgr, "RFL-400")[4] == "3.0"


def test_customer_update_keeps_type_and_region(env):
    client, mgr, _ = env
    res = client.post("/forecast/bulk_create_customers", json={
        "customers": [{"customer_id": "C-2001", "customer_name": "RSR Group"}],
        "options": {"merge_strategy": "update"}})
    assert res.json()["data"]["updated"] == 1
    assert q(mgr, "SELECT * FROM customers WHERE customer_id = 'C-2001'") == [
        ("C-2001", "RSR Group", "Distributor", "South")]


def test_inserts_store_null_not_empty_strings(env):
    client, mgr, _ = env
    client.post("/forecast/bulk_create_products", json={"products": [{"unit_id": "NEW-1", "unit_name": "New"}]})
    assert q(mgr, "SELECT bom_id, router_id, unit_type, unit_description FROM units WHERE unit_id = 'NEW-1'") == [
        (None, None, None, None)]
    client.post("/forecast/bulk_create_customers", json={"customers": [
        {"customer_id": "C-3001", "customer_name": "Gunsmith", "customer_type": " ", "region": ""}]})
    assert q(mgr, "SELECT customer_type, region FROM customers WHERE customer_id = 'C-3001'") == [(None, None)]


def test_non_numeric_base_price_is_a_row_error(env):
    client, mgr, _ = env
    res = client.post("/forecast/bulk_create_products", json={"products": [
        {"unit_id": "NEW-1", "unit_name": "New", "base_price": "call us"},
        {"unit_id": "NEW-2", "unit_name": "New 2", "base_price": "$1,299.00"}]})
    data = res.json()["data"]
    assert data["created"] == 1
    assert data["errors"][0]["row"] == 1 and "base_price" in data["errors"][0]["error"]
    assert q(mgr, "SELECT base_price, typeof(base_price) FROM units WHERE unit_id = 'NEW-2'") == [(1299.0, "real")]


def test_create_new_ids_never_collide(env):
    client, mgr, _ = env
    for name in ("Copy A", "Copy B"):
        res = client.post("/forecast/bulk_create_products", json={
            "products": [{"unit_id": "AR-10", "unit_name": name}], "options": {"merge_strategy": "create_new"}})
        data = res.json()["data"]
        assert data["created"] == 1 and data["errors"] == [], data
    assert [u for (u,) in q(mgr, "SELECT unit_id FROM units WHERE unit_id LIKE 'PROD-%' ORDER BY unit_id")] == [
        "PROD-001", "PROD-002"]
    for name in ("Clone A", "Clone B"):
        res = client.post("/forecast/bulk_create_customers", json={
            "customers": [{"customer_id": "C-1001", "customer_name": name}], "options": {"merge_strategy": "create_new"}})
        assert res.json()["data"]["errors"] == []
    assert [c for (c,) in q(mgr, "SELECT customer_id FROM customers WHERE customer_id LIKE 'CUST-%' "
                                 "ORDER BY customer_id")] == ["CUST-001", "CUST-002"]
