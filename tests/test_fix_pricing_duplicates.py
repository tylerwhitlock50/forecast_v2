"""
MCP-1: POST / PUT on /pricing/deductions and /pricing/prices refuse a rule
that duplicates an existing ACTIVE rule's scope (HTTP 409, string detail
naming the existing id), and the resolver's tie-break is deterministic:
later start_period, then earlier end_period (a bounded window beats an open
one), then the newer rule (created_at), then the rule id.
"""
import os
import re
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
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F002', 'Alt', 0)")
    c.executemany("INSERT INTO customers (customer_id, customer_name, customer_type) VALUES (?, ?, ?)", [
        ("C-DLR", "Main Street Guns", "Dealer"),
        ("C-DST", "Big Distributor", "Distributor"),
    ])
    c.executemany("INSERT INTO units (unit_id, unit_name, base_price, unit_type) VALUES (?, ?, ?, ?)", [
        ("RIF", "Hunter Rifle", 1500, "Rifle"),
        ("ACC", "Sling", 50, "Accessory"),
    ])
    conn.commit()
    conn.close()


@pytest.fixture()
def env():
    tmp = tempfile.mkdtemp()
    db_path = os.path.join(tmp, "dups.db")
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


def count(mgr, table):
    conn = mgr.get_connection()
    try:
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    finally:
        mgr.close_connection(conn)


def post_rule(client, body):
    res = client.post("/pricing/deductions", json=body)
    assert res.status_code == 200, res.text
    return res.json()["data"]["rules"][0]


def post_price(client, body):
    res = client.post("/pricing/prices", json=body)
    assert res.status_code == 200, res.text
    return res.json()["data"]["prices"][0]


def assert_conflict(res, existing_id, dtype=None):
    assert res.status_code == 409, res.text
    detail = res.json()["detail"]
    assert isinstance(detail, str)
    assert f"({existing_id})" in detail
    assert "already exists" in detail and "update it instead" in detail
    if dtype:
        assert f"A {dtype} rule with this scope already exists ({existing_id}); update it instead" in detail
    # an MCP client can pull the id back out of the message
    assert re.search(r"already exists \(([^)]+)\)", detail).group(1) == existing_id


# ---------------------------------------------------------------------------
# Deduction rules
# ---------------------------------------------------------------------------

def test_post_same_scope_deduction_is_refused_with_the_existing_id(env):
    client, mgr = env
    first = post_rule(client, {"deduction_type": "terms_allowance", "rate": 0.02, "customer_type": "Dealer"})
    res = client.post("/pricing/deductions", json={"deduction_type": "terms_allowance", "rate": 0.03,
                                                   "customer_type": " dealer ", "name": "Other name"})
    assert_conflict(res, first["rule_id"], "terms_allowance")
    assert count(mgr, "sales_deduction_rules") == 1


@pytest.mark.parametrize("change", [
    {"start_period": "2027-01"},
    {"end_period": "2027-06"},
    {"forecast_id": F},
    {"customer_type": "Distributor"},
    {"unit_type": "Rifle"},
    {"deduction_type": "chargebacks"},
])
def test_a_different_scope_or_period_is_not_a_duplicate(client, change):
    base = {"deduction_type": "terms_allowance", "rate": 0.02, "customer_type": "Dealer"}
    post_rule(client, base)
    post_rule(client, {**base, **change})


def test_other_allowance_duplicates_need_the_same_program_name(env):
    client, mgr = env
    coop = post_rule(client, {"deduction_type": "other_allowance", "rate": 0.005, "name": "Co-op advertising",
                              "customer_type": "Distributor"})
    post_rule(client, {"deduction_type": "other_allowance", "method": "per_unit", "amount_per_unit": 3,
                       "name": "Freight allowance", "customer_type": "Distributor"})
    res = client.post("/pricing/deductions", json={"deduction_type": "other_allowance", "rate": 0.01,
                                                   "name": "  CO-OP   Advertising", "customer_type": "Distributor"})
    assert_conflict(res, coop["rule_id"])
    assert res.json()["detail"].startswith(
        f"An other_allowance rule with this scope and program name 'CO-OP   Advertising' already exists "
        f"({coop['rule_id']}); update it instead")
    assert count(mgr, "sales_deduction_rules") == 2


def test_unnamed_other_allowances_share_one_slot_per_scope(env):
    client, mgr = env
    first = post_rule(client, {"deduction_type": "other_allowance", "rate": 0.01, "customer_type": "Dealer"})
    res = client.post("/pricing/deductions", json={"deduction_type": "other_allowance", "rate": 0.02,
                                                   "customer_type": "Dealer"})
    assert_conflict(res, first["rule_id"])
    assert "no program name" in res.json()["detail"]
    post_rule(client, {"deduction_type": "other_allowance", "rate": 0.02, "customer_type": "Dealer",
                       "name": "Freight allowance"})
    assert count(mgr, "sales_deduction_rules") == 2


def test_an_inactive_rule_does_not_block_a_new_one(client):
    old = post_rule(client, {"deduction_type": "chargebacks", "rate": 0.01, "is_active": 0})
    new = post_rule(client, {"deduction_type": "chargebacks", "rate": 0.02})
    assert new["rule_id"] != old["rule_id"]
    # switching the old one back on would create the duplicate
    res = client.put(f"/pricing/deductions/{old['rule_id']}", json={"is_active": 1})
    assert_conflict(res, new["rule_id"], "chargebacks")


def test_an_inactive_copy_of_an_active_rule_is_refused_too(client):
    # upsert clients send is_active=0 to switch a rule off: that must update the rule, not add a copy
    active = post_rule(client, {"deduction_type": "chargebacks", "rate": 0.01, "customer_type": "Dealer"})
    res = client.post("/pricing/deductions", json={"deduction_type": "chargebacks", "rate": 0.01,
                                                   "customer_type": "Dealer", "is_active": 0})
    assert_conflict(res, active["rule_id"], "chargebacks")


def test_bulk_post_is_all_or_nothing_on_conflicts(env):
    client, mgr = env
    first = post_rule(client, {"deduction_type": "terms_allowance", "rate": 0.02})
    res = client.post("/pricing/deductions", json={"rules": [
        {"deduction_type": "chargebacks", "rate": 0.01},
        {"deduction_type": "terms_allowance", "rate": 0.025, "name": "New terms"},
    ]})
    assert_conflict(res, first["rule_id"])
    assert "rule 2:" in res.json()["detail"]
    assert count(mgr, "sales_deduction_rules") == 1


def test_bulk_post_with_two_identical_scopes_is_refused(env):
    client, mgr = env
    res = client.post("/pricing/deductions", json={"rules": [
        {"deduction_type": "excise_tax", "rate": 0.11, "unit_type": "Rifle"},
        {"deduction_type": "excise_tax", "rate": 0.10, "unit_type": "rifle"},
    ]})
    assert res.status_code == 422, res.text
    detail = res.json()["detail"]
    assert isinstance(detail, str) and "rules 1 and 2" in detail
    assert count(mgr, "sales_deduction_rules") == 0


def test_put_that_would_create_a_duplicate_is_refused(client):
    dealer = post_rule(client, {"deduction_type": "terms_allowance", "rate": 0.02, "customer_type": "Dealer"})
    dist = post_rule(client, {"deduction_type": "terms_allowance", "rate": 0.01, "customer_type": "Distributor"})
    res = client.put(f"/pricing/deductions/{dist['rule_id']}", json={"customer_type": "Dealer"})
    assert_conflict(res, dealer["rule_id"], "terms_allowance")
    # editing a rule in place (same scope) is fine
    ok = client.put(f"/pricing/deductions/{dealer['rule_id']}", json={"rate": 0.025})
    assert ok.status_code == 200, ok.text


def test_switching_off_one_of_two_legacy_duplicates_is_allowed(env):
    client, mgr = env
    conn = mgr.get_connection()
    try:
        for rid in ("DED-OLD1", "DED-OLD2"):
            conn.execute("INSERT INTO sales_deduction_rules (rule_id, deduction_type, method, rate, is_active) "
                         "VALUES (?, 'terms_allowance', 'percent_of_gross', 0.02, 1)", (rid,))
        conn.commit()
    finally:
        mgr.close_connection(conn)
    res = client.put("/pricing/deductions/DED-OLD1", json={"is_active": 0})
    assert res.status_code == 200, res.text


# ---------------------------------------------------------------------------
# Prices
# ---------------------------------------------------------------------------

def test_post_same_scope_price_is_refused_with_the_existing_id(env):
    client, mgr = env
    first = post_price(client, {"unit_id": "RIF", "customer_type": "Dealer", "unit_price": 920})
    res = client.post("/pricing/prices", json={"unit_id": "RIF", "customer_type": "Dealer", "unit_price": 777})
    assert_conflict(res, first["price_id"])
    assert res.json()["detail"].startswith("A price rule with this scope already exists")
    # the old price still applies, and there is still one rule
    resolved = client.get("/pricing/resolve", params={"unit_id": "RIF", "customer_type": "Dealer"}).json()["data"]
    assert resolved["price"] == 920 and count(mgr, "price_list") == 1
    # a different method on the same scope is still the same scope
    res = client.post("/pricing/prices", json={"unit_id": "RIF", "customer_type": "dealer", "discount_pct": 0.3})
    assert_conflict(res, first["price_id"])


def test_price_put_that_would_create_a_duplicate_is_refused(client):
    dealer = post_price(client, {"unit_id": "RIF", "customer_type": "Dealer", "unit_price": 920})
    dist = post_price(client, {"unit_id": "RIF", "customer_type": "Distributor", "unit_price": 900})
    res = client.put(f"/pricing/prices/{dist['price_id']}", json={"customer_type": "Dealer"})
    assert_conflict(res, dealer["price_id"])
    assert client.put(f"/pricing/prices/{dealer['price_id']}", json={"unit_price": 930}).status_code == 200


def test_price_scope_includes_product_type(client):
    post_price(client, {"customer_type": "Distributor", "discount_pct": 0.3})
    acc = post_price(client, {"customer_type": "Distributor", "unit_type": "Accessory", "discount_pct": 0.4})
    res = client.post("/pricing/prices", json={"customer_type": "Distributor", "unit_type": "accessory",
                                               "discount_pct": 0.45})
    assert_conflict(res, acc["price_id"])


def test_bulk_prices_with_two_identical_scopes_are_refused(env):
    client, mgr = env
    res = client.post("/pricing/prices", json={"prices": [
        {"unit_id": "RIF", "customer_type": "Dealer", "unit_price": 920},
        {"unit_id": "RIF", "customer_type": "Dealer", "unit_price": 777},
    ]})
    assert res.status_code == 422 and "prices 1 and 2" in res.json()["detail"]
    assert count(mgr, "price_list") == 0


# ---------------------------------------------------------------------------
# Deterministic tie-break
# ---------------------------------------------------------------------------

def test_tie_break_bounded_window_then_newer_rule_then_id():
    open_ended = {"rule_id": "DED-ZZZ", "deduction_type": "terms_allowance", "rate": 0.02,
                  "start_period": "2027-01", "end_period": None, "created_at": "2026-10-12 09:00:00"}
    promo = {"rule_id": "DED-AAA", "deduction_type": "terms_allowance", "rate": 0.03,
             "start_period": "2027-01", "end_period": "2027-06", "created_at": "2026-01-01 09:00:00"}
    row = {"period": "2027-03"}
    assert pricing.DeductionResolver([open_ended, promo]).winners(row)["terms_allowance"]["rule_id"] == "DED-AAA"
    assert pricing.DeductionResolver([promo, open_ended]).winners(row)["terms_allowance"]["rule_id"] == "DED-AAA"

    older = {"rule_id": "DED-ZZZ", "deduction_type": "chargebacks", "rate": 0.01, "created_at": "2026-10-01 08:00:00"}
    newer = {"rule_id": "DED-AAA", "deduction_type": "chargebacks", "rate": 0.02, "created_at": "2026-10-02T08:00:00"}
    for order in ([older, newer], [newer, older]):
        assert pricing.DeductionResolver(order).winners(row)["chargebacks"]["rule_id"] == "DED-AAA"
    same_time = [dict(older, rule_id="DED-B", created_at="2026-10-01 08:00:00"),
                 dict(older, rule_id="DED-A", created_at="2026-10-01T08:00:00")]
    assert pricing.DeductionResolver(same_time).winners(row)["chargebacks"]["rule_id"] == "DED-B"


def test_price_tie_break_matches_the_deduction_one():
    rules = [
        {"price_id": "PRC-ZZZ", "unit_id": "RIF", "unit_price": 900, "created_at": "2026-01-01 00:00:00"},
        {"price_id": "PRC-AAA", "unit_id": "RIF", "unit_price": 950, "created_at": "2026-06-01 00:00:00"},
    ]
    out = pricing.resolve_price(rules, {"unit_id": "RIF"}, base_price=1000)
    assert (out["price"], out["price_id"]) == (950, "PRC-AAA")


def test_rule_keys_are_exported_for_imports():
    a = {"forecast_id": None, "deduction_type": "other_allowance", "customer_type": "Dealer ", "name": "Co-op  Ads"}
    b = {"forecast_id": None, "deduction_type": "other_allowance", "customer_type": "dealer", "name": "co-op ads"}
    c = dict(b, name="Freight")
    assert pricing.deduction_rule_key(a) == pricing.deduction_rule_key(b)
    assert pricing.deduction_rule_key(a) != pricing.deduction_rule_key(c)
    unnamed_1 = {"deduction_type": "other_allowance", "rate": 0.01, "name": "Other discounts & allowances 1%"}
    unnamed_2 = {"deduction_type": "other_allowance", "rate": 0.02, "name": None}
    assert pricing.deduction_rule_key(unnamed_1) == pricing.deduction_rule_key(unnamed_2)
    t1 = {"deduction_type": "terms_allowance", "name": "A"}
    t2 = {"deduction_type": "terms_allowance", "name": "B"}
    assert pricing.deduction_rule_key(t1) == pricing.deduction_rule_key(t2)
    p1 = {"unit_id": "RIF", "customer_type": "Dealer", "unit_type": None}
    p2 = {"unit_id": "RIF", "customer_type": "DEALER", "method": "discount_from_base"}
    assert pricing.price_rule_key(p1) == pricing.price_rule_key(p2)
