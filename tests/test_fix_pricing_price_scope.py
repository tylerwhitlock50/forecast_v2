"""
Price list: product-type scope (F13 part 2) and apply without the
base-price fallback (RM-4).

* price_list gains an optional unit_type (product type) scope, added to old
  databases by an idempotent migration. Specificity is
  8*customer_id + 4*customer_type + 2*unit_id + 1*unit_type, so
  "Distributor 40% off list for Accessory" beats "Distributor 30% off list"
  on accessories and loses to a Distributor price for one product.
* POST /pricing/apply with fallback_to_base_price=false still prices rows
  from discount_from_base rules; only the final base-price fallback is
  skipped.
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
from services import pricing  # noqa: E402

F = "F001"


def _seed(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F001', 'Plan 2027', 1)")
    c.executemany("INSERT INTO customers (customer_id, customer_name, customer_type) VALUES (?, ?, ?)", [
        ("C-DLR", "Main Street Guns", "Dealer"),
        ("C-DST", "Big Distributor", "Distributor"),
        ("C-OTH", "Retail Walk-in", "Retail"),
    ])
    c.executemany("INSERT INTO units (unit_id, unit_name, base_price, unit_type) VALUES (?, ?, ?, ?)", [
        ("RIF", "Hunter Rifle", 1500, "Rifle"),
        ("PST", "Compact Pistol", 800, "Pistol"),
        ("ACC", "Sling", 50, "Accessory"),
        ("MAG", "Magazine", 40, "accessory"),
    ])
    c.executemany(
        "INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
            ("S1", "C-DLR", "RIF", "2027-01", 10, 1000, 10000, F),
            ("S2", "C-DST", "RIF", "2027-01", 20, 1000, 20000, F),
            ("S3", "C-DST", "PST", "2027-01", 5, 700, 3500, F),
            ("S4", "C-OTH", "RIF", "2027-01", 2, 1000, 2000, F),
            ("S5", "C-DST", "ACC", "2027-02", 100, 45, 4500, F),
            ("S6", "C-DST", "MAG", "2027-02", 50, 38, 1900, F),
        ])
    conn.commit()
    conn.close()


@pytest.fixture()
def env():
    tmp = tempfile.mkdtemp()
    db_path = os.path.join(tmp, "scope.db")
    mgr = DatabaseManager(database_path=db_path, data_dir=tmp)
    mgr.initialize()
    _seed(db_path)

    import app.db.database as dbmod
    import db.database as dbmod_short
    from api import pricing_routes
    originals = (dbmod.db_manager, dbmod_short.db_manager, pricing_routes.db_manager)
    dbmod.db_manager = dbmod_short.db_manager = pricing_routes.db_manager = mgr
    app = FastAPI()
    app.include_router(pricing_routes.router)
    try:
        yield TestClient(app), mgr
    finally:
        dbmod.db_manager, dbmod_short.db_manager, pricing_routes.db_manager = originals
        mgr.close_all_connections()
        shutil.rmtree(tmp, ignore_errors=True)


@pytest.fixture()
def client(env):
    return env[0]


def create(client, body):
    res = client.post("/pricing/prices", json=body)
    assert res.status_code == 200, res.text
    return res.json()["data"]


def resolve(client, **params):
    res = client.get("/pricing/resolve", params=params)
    assert res.status_code == 200, res.text
    return res.json()["data"]


# ---------------------------------------------------------------------------
# RM-4: fallback_to_base_price=false keeps discount rules
# ---------------------------------------------------------------------------

def test_service_skips_only_the_base_price_fallback():
    rules = [{"price_id": "P-DST", "customer_type": "Distributor", "method": "discount_from_base", "discount_pct": 0.4}]
    row = {"unit_id": "RIF", "customer_type": "Distributor"}
    out = pricing.resolve_price(rules, row, base_price=1500, fallback_to_base=False)
    assert (out["price"], out["source"]) == (900, "type_all")
    none = pricing.resolve_price(rules, {"unit_id": "RIF", "customer_type": "Dealer"}, base_price=1500,
                                 fallback_to_base=False)
    assert none == {"price": None, "source": "none", "price_id": None}
    assert pricing.resolve_price(rules, {"unit_id": "RIF"}, base_price=1500)["source"] == "base_price"


def test_apply_without_fallback_still_prices_discount_rows(client):
    create(client, {"prices": [
        {"unit_id": "RIF", "customer_type": "Dealer", "unit_price": 1199},
        {"customer_type": "Distributor", "discount_pct": 0.4},
    ]})
    data = client.post("/pricing/apply", json={"forecast_id": F, "dry_run": True,
                                               "fallback_to_base_price": False}).json()["data"]
    assert data["by_source"] == {"type_product": 1, "type_all": 4, "none": 1}
    assert data["unpriced"] == 1 and data["unpriced_rows"][0]["sale_id"] == "S4"
    with_fallback = client.post("/pricing/apply", json={"forecast_id": F, "dry_run": True}).json()["data"]
    assert with_fallback["by_source"] == {"type_product": 1, "type_all": 4, "base_price": 1}
    assert "base-price fallback" in " ".join(data["warnings"])


# ---------------------------------------------------------------------------
# F13: product-type scope on the price list
# ---------------------------------------------------------------------------

def test_migration_adds_unit_type_to_an_old_price_list(tmp_path):
    path = str(tmp_path / "old.db")
    conn = sqlite3.connect(path)
    conn.execute("""CREATE TABLE price_list (
        price_id TEXT PRIMARY KEY, forecast_id TEXT, unit_id TEXT, customer_id TEXT, customer_type TEXT,
        method TEXT NOT NULL DEFAULT 'fixed', unit_price REAL, discount_pct REAL, start_period TEXT,
        end_period TEXT, is_active INTEGER DEFAULT 1, notes TEXT, created_at TEXT, updated_at TEXT)""")
    conn.execute("INSERT INTO price_list (price_id, unit_id, unit_price) VALUES ('PRC-OLD', 'RIF', 999)")
    conn.commit()
    conn.close()
    mgr = DatabaseManager(database_path=path, data_dir=str(tmp_path))
    mgr.initialize_schema()
    mgr.initialize_schema()                      # idempotent
    conn = sqlite3.connect(path)
    try:
        columns = [r[1] for r in conn.execute("PRAGMA table_info(price_list)")]
        assert columns.count("unit_type") == 1
        assert conn.execute("SELECT unit_price, unit_type FROM price_list").fetchall() == [(999, None)]
    finally:
        conn.close()
    mgr.close_all_connections()


def test_new_database_has_unit_type_on_price_list(env):
    _, mgr = env
    conn = mgr.get_connection()
    try:
        assert "unit_type" in [r[1] for r in conn.execute("PRAGMA table_info(price_list)")]
    finally:
        mgr.close_connection(conn)


def test_create_and_describe_a_product_type_discount(client):
    data = create(client, {"customer_type": "Distributor", "unit_type": " Accessory ", "discount_pct": 0.4,
                           "notes": "Distributor 40% off list for accessories"})
    rule = data["prices"][0]
    assert rule["unit_type"] == "Accessory" and rule["unit_id"] is None
    assert rule["source"] == "type_product_type"
    assert rule["specificity"] == 5
    assert "product type Accessory" in rule["scope"]
    assert rule["effective_price"] is None
    assert data["warnings"] == []
    one = client.get(f"/pricing/prices/{rule['price_id']}").json()["data"]["price"]
    assert one["unit_type"] == "Accessory"
    updated = client.put(f"/pricing/prices/{rule['price_id']}", json={"unit_type": "Pistol"}).json()["data"]["price"]
    assert updated["unit_type"] == "Pistol"
    cleared = client.put(f"/pricing/prices/{rule['price_id']}", json={"unit_type": ""}).json()["data"]["price"]
    assert cleared["unit_type"] is None and cleared["source"] == "type_all"


def test_unknown_product_type_and_mismatched_product_warn(client):
    warnings = create(client, {"customer_type": "Distributor", "unit_type": "Optics", "discount_pct": 0.1})["warnings"]
    assert any("Optics" in w for w in warnings)
    warnings = create(client, {"unit_id": "RIF", "unit_type": "Accessory", "unit_price": 1000})["warnings"]
    assert any("RIF" in w and "Rifle" in w for w in warnings)


def test_fixed_price_for_a_product_type_is_allowed_but_needs_a_product_or_type(client):
    rule = create(client, {"customer_type": "Dealer", "unit_type": "Accessory", "unit_price": 35})["prices"][0]
    assert rule["method"] == "fixed" and rule["effective_price"] == 35
    res = client.post("/pricing/prices", json={"customer_type": "Dealer", "unit_price": 35})
    assert res.status_code == 422 and "unit_id is required" in res.json()["detail"]


def test_resolution_order_with_product_type(client):
    create(client, {"prices": [
        {"customer_type": "Distributor", "discount_pct": 0.3},                               # 4 type_all
        {"customer_type": "Distributor", "unit_type": "Accessory", "discount_pct": 0.4},     # 5 type_product_type
        {"customer_type": "Distributor", "unit_id": "MAG", "unit_price": 20},                # 6 type_product
        {"unit_type": "Pistol", "discount_pct": 0.1},                                        # 1 product_type
        {"customer_id": "C-DLR", "unit_type": "Accessory", "discount_pct": 0.5},             # 9 customer_product_type
    ]})
    acc = resolve(client, unit_id="ACC", customer_id="C-DST")
    assert (acc["price"], acc["source"]) == (30, "type_product_type")
    assert resolve(client, unit_id="MAG", customer_id="C-DST")["price"] == 20         # product beats product type
    assert resolve(client, unit_id="RIF", customer_id="C-DST")["price"] == 1050       # type discount on a rifle
    pistol_retail = resolve(client, unit_id="PST", customer_id="C-OTH")
    assert (pistol_retail["price"], pistol_retail["source"]) == (720, "product_type")
    assert resolve(client, unit_id="PST", customer_id="C-DST")["price"] == 560       # customer type beats product type
    dealer_acc = resolve(client, unit_id="ACC", customer_id="C-DLR")
    assert (dealer_acc["price"], dealer_acc["source"]) == (25, "customer_product_type")
    assert dealer_acc["source_label"]
    # product type matches case-insensitively ('accessory' on MAG)
    assert resolve(client, unit_id="MAG", customer_id="C-DLR")["source"] == "customer_product_type"


def test_specificity_and_sources():
    assert pricing.price_specificity({"customer_id": "C", "unit_id": "U"}) == 10
    assert pricing.price_specificity({"customer_type": "T", "unit_type": "Accessory"}) == 5
    assert pricing.price_specificity({"unit_type": "Accessory"}) == 1
    assert pricing.price_source({"customer_id": "C", "unit_type": "X"}) == "customer_product_type"
    assert pricing.price_source({"customer_type": "T", "unit_type": "X"}) == "type_product_type"
    assert pricing.price_source({"unit_type": "X"}) == "product_type"
    assert pricing.price_source({"customer_type": "T", "unit_id": "U", "unit_type": "X"}) == "type_product"


def test_apply_uses_the_product_type_scope(env):
    client, mgr = env
    create(client, {"prices": [
        {"customer_type": "Distributor", "discount_pct": 0.3},
        {"customer_type": "Distributor", "unit_type": "Accessory", "discount_pct": 0.4},
    ]})
    data = client.post("/pricing/apply", json={"forecast_id": F}).json()["data"]
    assert data["by_source"]["type_product_type"] == 2
    conn = mgr.get_connection()
    try:
        prices = dict(conn.execute("SELECT sale_id, unit_price FROM sales WHERE sale_id IN ('S5', 'S6')").fetchall())
    finally:
        mgr.close_connection(conn)
    assert prices == {"S5": 30.0, "S6": 24.0}


def test_list_prices_for_a_product_includes_matching_type_rules(client):
    created = create(client, {"prices": [
        {"customer_type": "Distributor", "discount_pct": 0.3},
        {"customer_type": "Distributor", "unit_type": "Accessory", "discount_pct": 0.4},
        {"customer_type": "Distributor", "unit_type": "Pistol", "discount_pct": 0.2},
    ]})["prices"]
    listed = client.get("/pricing/prices", params={"unit_id": "MAG"}).json()["data"]["prices"]
    assert sorted(p["price_id"] for p in listed) == sorted([created[0]["price_id"], created[1]["price_id"]])


def test_catalog_lists_the_new_sources(client):
    sources = {s["source"] for s in client.get("/pricing/deduction-types").json()["data"]["price_sources"]}
    assert {"customer_product_type", "type_product_type", "product_type"} <= sources
