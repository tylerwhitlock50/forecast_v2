"""
/pricing routes: deduction catalog, deduction rule CRUD + validation,
preview (ties to the statements engine), simulate, price list CRUD +
validation, resolve and apply (with dry run).

Seeds an isolated database with a 2027 forecast for a dealer, a distributor
and a government customer buying a rifle and a pistol.
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

F = "F001"


def _seed(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F001', 'Plan 2027', 1)")
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F002', 'Alt', 0)")
    c.executemany("INSERT INTO customers (customer_id, customer_name, customer_type) VALUES (?, ?, ?)", [
        ("C-DLR", "Main Street Guns", "Dealer"),
        ("C-DLR2", "Second Dealer", "Dealer"),
        ("C-DST", "Big Distributor", "Distributor"),
        ("C-GOV", "County Sheriff", "Government"),
    ])
    c.executemany("INSERT INTO units (unit_id, unit_name, base_price, unit_type) VALUES (?, ?, ?, ?)", [
        ("RIF", "Hunter Rifle", 1500, "Rifle"),
        ("PST", "Compact Pistol", 600, "Pistol"),
        ("NOP", "Unpriced Widget", None, "Accessory"),
    ])
    c.executemany(
        "INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
            ("S1", "C-DLR", "RIF", "2027-01", 10, 1110, 11100, F),
            ("S2", "C-DST", "RIF", "2027-01", 20, 1000, 20000, F),
            ("S3", "C-GOV", "PST", "2027-02", 5, 500, 2500, F),
            ("S4", "C-DLR", "PST", "2027-03", 4, 555, 2220, F),
            ("S5", "C-DLR", "NOP", "2027-03", 3, 10, 30, F),
            ("S9", "C-DLR", "RIF", "2027-01", 1, 999, 999, "F002"),
        ])
    conn.commit()
    conn.close()


@pytest.fixture()
def env():
    tmp = tempfile.mkdtemp()
    db_path = os.path.join(tmp, "pricing.db")
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


def rows(mgr, sql, params=()):
    conn = mgr.get_connection()
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        mgr.close_connection(conn)


def create(client, path, body):
    res = client.post(path, json=body)
    assert res.status_code == 200, res.text
    return res.json()["data"]


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------

def test_deduction_types_catalog(client):
    data = client.get("/pricing/deduction-types").json()["data"]
    types = {t["deduction_type"]: t for t in data["deduction_types"]}
    assert list(types) == ["terms_allowance", "chargebacks", "other_allowance", "excise_tax", "commission"]
    assert types["commission"]["treatment"] == "selling_expense" and not types["commission"]["contra_revenue"]
    assert types["excise_tax"]["contra_revenue"] is True
    assert {m["method"] for m in data["methods"]} == {"percent_of_gross", "percent_of_net", "embedded_tax", "per_unit"}
    assert {m["method"] for m in data["price_methods"]} == {"fixed", "discount_from_base"}
    assert "110.00" in data["example"] and "966.70" in data["example"]
    assert data["contra_revenue_types"] == ["terms_allowance", "chargebacks", "other_allowance", "excise_tax"]


# ---------------------------------------------------------------------------
# Deduction rules CRUD + validation
# ---------------------------------------------------------------------------

def test_create_single_rule_and_list_scoping(env):
    client, mgr = env
    created = create(client, "/pricing/deductions",
                     {"deduction_type": "terms_allowance", "rate": 0.02, "customer_type": "Dealer"})
    rule = created["rules"][0]
    assert rule["rule_id"].startswith("DED-") and len(rule["rule_id"]) == 12
    assert rule["rate"] == 0.02 and rule["method"] == "percent_of_gross"
    assert rule["name"] == "Terms allowance 2% (Dealer)"
    assert rule["is_company_wide"] is True and rule["scope"] == "customer type Dealer"
    assert rule["forecast_id"] is None and rule["customer_id"] is None

    create(client, "/pricing/deductions", {"deduction_type": "chargebacks", "rate": 0.01, "forecast_id": "F002"})
    listed = client.get("/pricing/deductions", params={"forecast_id": F}).json()["data"]
    assert [r["deduction_type"] for r in listed["rules"]] == ["terms_allowance"]
    every = client.get("/pricing/deductions").json()["data"]
    assert every["count"] == 2
    one = client.get(f"/pricing/deductions/{rule['rule_id']}").json()["data"]["rule"]
    assert one["deduction_label"] == "Terms allowance"
    assert client.get("/pricing/deductions/DED-NOPE").status_code == 404


def test_bulk_create_and_defaults(env):
    client, mgr = env
    data = create(client, "/pricing/deductions", {"rules": [
        {"deduction_type": "excise_tax", "rate": 0.11},
        {"deduction_type": "excise_tax", "rate": 0, "customer_type": "Government", "name": "Gov exempt"},
        {"deduction_type": "other_allowance", "method": "per_unit", "amount_per_unit": 5, "unit_type": " Rifle ",
         "customer_id": "", "unit_id": "  "},
    ]})
    assert data["created"] == 3
    excise, exempt, per_unit = data["rules"]
    assert excise["method"] == "embedded_tax"                      # excise defaults to embedded tax
    assert exempt["name"] == "Gov exempt" and exempt["rate"] == 0
    assert per_unit["amount_per_unit"] == 5 and per_unit["unit_type"] == "Rifle"
    stored = rows(mgr, "SELECT customer_id, unit_id FROM sales_deduction_rules WHERE rule_id = ?", (per_unit["rule_id"],))
    assert stored == [(None, None)]                                 # blank scope strings stored as NULL


@pytest.mark.parametrize("body, fragment", [
    ({"deduction_type": "terms_allowance", "rate": 2}, "Did you mean 0.02"),
    ({"deduction_type": "terms_allowance", "rate": 1}, "out of range"),
    ({"deduction_type": "terms_allowance", "rate": "2%"}, "fraction"),
    ({"deduction_type": "terms_allowance", "rate": -0.01}, "negative"),
    ({"deduction_type": "terms_allowance"}, "rate is required"),
    ({"deduction_type": "rebate", "rate": 0.01}, "is not one of"),
    ({"deduction_type": "terms_allowance", "method": "flat", "rate": 0.01}, "method 'flat'"),
    ({"deduction_type": "other_allowance", "method": "per_unit"}, "amount_per_unit"),
    ({"deduction_type": "chargebacks", "rate": 0.01, "start_period": "2027-13"}, "not a month"),
    ({"deduction_type": "chargebacks", "rate": 0.01, "start_period": "2027-Q1"}, "quarter"),
    ({"deduction_type": "chargebacks", "rate": 0.01, "start_period": "2027-06", "end_period": "2027-01"}, "after"),
    ({"deduction_type": "chargebacks", "rate": 0.01, "forecast_id": "F999"}, "does not exist"),
    ({"rate": 0.01}, "deduction_type is required"),
])
def test_rule_validation_errors(client, body, fragment):
    res = client.post("/pricing/deductions", json=body)
    assert res.status_code == 422
    assert fragment in res.json()["detail"]


def test_bulk_is_all_or_nothing(env):
    client, mgr = env
    res = client.post("/pricing/deductions", json={"rules": [
        {"deduction_type": "terms_allowance", "rate": 0.02},
        {"deduction_type": "chargebacks", "rate": 5},
    ]})
    assert res.status_code == 422
    assert "rule 2:" in res.json()["detail"]
    assert rows(mgr, "SELECT COUNT(*) FROM sales_deduction_rules") == [(0,)]
    assert client.post("/pricing/deductions", json={"rules": []}).status_code == 422


def test_periods_are_normalised_and_warnings_flag_unknown_scope(client):
    data = create(client, "/pricing/deductions", {
        "deduction_type": "excise_tax", "method": "percent_of_gross", "rate": 0.11, "start_period": "Jan-2027",
        "end_period": "12/2027", "customer_id": "NOBODY", "customer_type": "Dealr", "bogus": 1,
    })
    rule = data["rules"][0]
    assert (rule["start_period"], rule["end_period"]) == ("2027-01", "2027-12")
    text = " | ".join(data["warnings"])
    assert "embedded_tax" in text            # excise on gross is probably a mistake
    assert "NOBODY" in text and "Dealr" in text and "bogus" in text


def test_update_and_delete_rule(env):
    client, mgr = env
    rule = create(client, "/pricing/deductions",
                  {"deduction_type": "terms_allowance", "rate": 0.02, "customer_type": "Dealer"})["rules"][0]
    rid = rule["rule_id"]
    res = client.put(f"/pricing/deductions/{rid}", json={"rate": 0.015})
    assert res.status_code == 200, res.text
    updated = res.json()["data"]["rule"]
    assert updated["rate"] == 0.015 and updated["customer_type"] == "Dealer"
    assert updated["name"] == "Terms allowance 1.5% (Dealer)"     # default name follows the rule
    # clear a scope field with an empty string, keep an explicit name
    updated = client.put(f"/pricing/deductions/{rid}", json={"customer_type": "", "name": "Terms"}).json()["data"]["rule"]
    assert updated["customer_type"] is None and updated["name"] == "Terms"
    updated = client.put(f"/pricing/deductions/{rid}", json={"is_active": False}).json()["data"]["rule"]
    assert updated["is_active"] is False
    assert client.get("/pricing/deductions", params={"include_inactive": False}).json()["data"]["count"] == 0

    assert client.put(f"/pricing/deductions/{rid}", json={"rate": 3}).status_code == 422
    assert client.put("/pricing/deductions/DED-NOPE", json={"rate": 0.01}).status_code == 404
    assert client.delete(f"/pricing/deductions/{rid}").status_code == 200
    assert client.delete(f"/pricing/deductions/{rid}").status_code == 404
    assert rows(mgr, "SELECT COUNT(*) FROM sales_deduction_rules") == [(0,)]


# ---------------------------------------------------------------------------
# Simulate
# ---------------------------------------------------------------------------

def _standard_rules(client):
    return create(client, "/pricing/deductions", {"rules": [
        {"deduction_type": "terms_allowance", "rate": 0.02, "customer_type": "Dealer", "name": "Dealer terms"},
        {"deduction_type": "chargebacks", "rate": 0.01, "name": "Chargebacks"},
        {"deduction_type": "excise_tax", "method": "embedded_tax", "rate": 0.11, "name": "FET 11%"},
        {"deduction_type": "excise_tax", "method": "embedded_tax", "rate": 0, "customer_type": "Government",
         "name": "Gov exempt"},
        {"deduction_type": "commission", "method": "percent_of_net", "rate": 0.05, "customer_type": "Distributor",
         "name": "Dist commission"},
    ]})["rules"]


def test_simulate_matches_the_worked_example(client):
    _standard_rules(client)
    data = client.post("/pricing/deductions/simulate",
                       json={"gross": 1110, "customer_id": "C-DLR", "unit_id": "RIF", "period": "2027-01"}).json()["data"]
    amounts = {line["deduction_type"]: line["amount"] for line in data["lines"]}
    assert amounts == {"terms_allowance": 22.2, "chargebacks": 11.1, "other_allowance": 0.0,
                       "excise_tax": 110.0, "commission": 0.0}
    assert data["input"]["customer_type"] == "Dealer" and data["input"]["unit_type"] == "Rifle"
    assert data["total_sales_deductions"] == 143.3 and data["net_sales"] == 966.7
    assert any("1,110.00 x 0.11 / 1.11" in e for e in data["explanation"])


def test_simulate_customer_override_and_exemption(client):
    rules = _standard_rules(client)
    dealer_terms = rules[0]["rule_id"]
    override = create(client, "/pricing/deductions",
                      {"deduction_type": "terms_allowance", "rate": 0.01, "customer_id": "C-DLR"})["rules"][0]
    data = client.post("/pricing/deductions/simulate", json={"gross": 1000, "customer_id": "C-DLR"}).json()["data"]
    terms = next(line for line in data["lines"] if line["deduction_type"] == "terms_allowance")
    assert terms["rule"]["rule_id"] == override["rule_id"] and terms["amount"] == 10.0
    assert terms["overridden_rules"] == [dealer_terms]

    gov = client.post("/pricing/deductions/simulate", json={"unit_price": 500, "quantity": 2,
                                                            "customer_type": "Government"}).json()["data"]
    excise = next(line for line in gov["lines"] if line["deduction_type"] == "excise_tax")
    assert gov["gross_sales"] == 1000 and excise["amount"] == 0.0 and excise["rule"]["name"] == "Gov exempt"

    dist = client.post("/pricing/deductions/simulate", json={"gross": 1110, "customer_id": "C-DST"}).json()["data"]
    # commission on net: (1110 - 11.10 chargebacks - 110 FET) x 5%
    assert dist["commission"] == round((1110 - 11.1 - 110) * 0.05, 2)
    assert dist["net_after_commission"] == round(dist["net_sales"] - dist["commission"], 2)


def test_simulate_validation(client):
    assert client.post("/pricing/deductions/simulate", json={}).status_code == 422
    assert client.post("/pricing/deductions/simulate", json={"gross": "abc"}).status_code == 422
    assert client.post("/pricing/deductions/simulate", json={"gross": 100, "forecast_id": "F999"}).status_code == 404
    notes = client.post("/pricing/deductions/simulate", json={"gross": 100, "customer_id": "GHOST"}).json()["data"]["notes"]
    assert "GHOST" in notes[0]


# ---------------------------------------------------------------------------
# Preview (numbers from the statements engine)
# ---------------------------------------------------------------------------

def test_preview_totals_tie_to_the_income_statement(env):
    client, mgr = env
    _standard_rules(client)
    create(client, "/pricing/deductions", {"deduction_type": "other_allowance", "rate": 0.03, "customer_id": "GHOST"})
    data = client.get("/pricing/deductions/preview", params={"forecast_id": F}).json()["data"]
    assert (data["start_period"], data["end_period"]) == ("2027-01", "2027-03")   # the scenario's sales window
    assert data["rows"] == 5 and data["totals"]["gross_sales"] == 35850.0

    # hand calculation per row
    s1 = 11100 * 0.02 + 11100 * 0.01 + 11100 * 0.11 / 1.11
    s2 = 20000 * 0.01 + 20000 * 0.11 / 1.11
    s3 = 2500 * 0.01                                  # government: FET exempt
    s4 = 2220 * 0.02 + 2220 * 0.01 + 2220 * 0.11 / 1.11
    s5 = 30 * 0.02 + 30 * 0.01 + 30 * 0.11 / 1.11
    assert data["totals"]["total_sales_deductions"] == round(s1 + s2 + s3 + s4 + s5, 2)
    by_type = {t["deduction_type"]: t for t in data["by_type"]}
    assert by_type["excise_tax"]["amount"] == round((11100 + 20000 + 2220 + 30) * 0.11 / 1.11, 2)
    assert by_type["commission"]["amount"] == round((20000 - s2) * 0.05, 2)
    ctypes = {c["customer_type"]: c for c in data["by_customer_type"]}
    assert ctypes["Government"]["excise_tax"] == 0 and ctypes["Government"]["gross_sales"] == 2500
    assert [p["period"] for p in data["by_period"]] == ["2027-01", "2027-02", "2027-03"]
    codes = [w["code"] for w in data["warnings"]]
    assert "rule_unused" in codes

    # ties exactly to the statements engine
    from services.financial_statements import build_statements
    conn = mgr.get_connection()
    try:
        totals = build_statements(conn.cursor(), [F], "2027-01", "2027-03")["income_statement"]["totals"]
    finally:
        mgr.close_connection(conn)
    assert round(totals["gross_sales"], 2) == data["totals"]["gross_sales"]
    assert round(totals["total_sales_deductions"], 2) == data["totals"]["total_sales_deductions"]
    assert round(totals["revenue"], 2) == data["totals"]["net_sales"]

    window = client.get("/pricing/deductions/preview",
                        params={"forecast_id": F, "start_period": "2027-02", "end_period": "2027-02"}).json()["data"]
    assert window["rows"] == 1 and window["totals"]["gross_sales"] == 2500


def test_preview_validation_and_empty_scenarios(client):
    assert client.get("/pricing/deductions/preview", params={"forecast_id": "F999"}).status_code == 404
    assert client.get("/pricing/deductions/preview",
                      params={"forecast_id": F, "start_period": "2027-05", "end_period": "2027-01"}).status_code == 422
    assert client.get("/pricing/deductions/preview",
                      params={"forecast_id": F, "start_period": "bad"}).status_code == 422
    no_rules = client.get("/pricing/deductions/preview", params={"forecast_id": F}).json()["data"]
    assert [w["code"] for w in no_rules["warnings"]] == ["no_deduction_rules"]
    assert no_rules["totals"]["net_sales"] == no_rules["totals"]["gross_sales"]
    empty = client.get("/pricing/deductions/preview", params={"forecast_id": "F002",
                                                              "start_period": "2028-01", "end_period": "2028-01"})
    assert empty.status_code == 200 and empty.json()["data"]["rows"] == 0


# ---------------------------------------------------------------------------
# Price list CRUD + validation
# ---------------------------------------------------------------------------

def test_price_crud_and_listing(env):
    client, mgr = env
    data = create(client, "/pricing/prices", {"prices": [
        {"unit_id": "RIF", "customer_type": "Dealer", "unit_price": 1199},
        {"unit_id": "RIF", "customer_id": "C-DLR", "unit_price": 1150, "start_period": "2027-01", "end_period": "2027-06"},
        {"customer_type": "Government", "discount_pct": 0.2},
    ]})
    assert data["created"] == 3
    dealer, customer, gov = data["prices"]
    assert dealer["price_id"].startswith("PRC-") and dealer["method"] == "fixed"
    assert dealer["source"] == "type_product" and dealer["effective_price"] == 1199
    assert customer["source"] == "customer_product" and customer["customer_name"] == "Main Street Guns"
    assert gov["method"] == "discount_from_base" and gov["unit_id"] is None and gov["source"] == "type_all"
    assert gov["unit_price"] is None and gov["discount_pct"] == 0.2

    listed = client.get("/pricing/prices", params={"unit_id": "PST"}).json()["data"]["prices"]
    assert [p["price_id"] for p in listed] == [gov["price_id"]]          # all-product discounts apply to PST
    assert client.get("/pricing/prices", params={"customer_type": "dealer"}).json()["data"]["count"] == 1

    res = client.put(f"/pricing/prices/{dealer['price_id']}", json={"method": "discount_from_base", "discount_pct": 0.3})
    assert res.status_code == 200, res.text
    switched = res.json()["data"]["price"]
    assert switched["unit_price"] is None and switched["effective_price"] == 1050
    assert client.put(f"/pricing/prices/{dealer['price_id']}", json={"discount_pct": 30}).status_code == 422
    assert client.get(f"/pricing/prices/{dealer['price_id']}").json()["data"]["price"]["discount_pct"] == 0.3
    assert client.delete(f"/pricing/prices/{dealer['price_id']}").status_code == 200
    assert client.get(f"/pricing/prices/{dealer['price_id']}").status_code == 404
    assert client.put("/pricing/prices/PRC-NOPE", json={"unit_price": 1}).status_code == 404


@pytest.mark.parametrize("body, fragment", [
    ({"customer_type": "Dealer", "unit_price": 100}, "unit_id is required"),
    ({"unit_id": "RIF", "unit_price": -1}, "negative"),
    ({"unit_id": "RIF"}, "needs unit_price"),
    ({"unit_id": "RIF", "method": "discount_from_base"}, "needs discount_pct"),
    ({"unit_id": "RIF", "discount_pct": 40}, "Did you mean 0.4"),
    ({"unit_id": "RIF", "discount_pct": 1}, "out of range"),
    ({"unit_id": "RIF", "unit_price": 10, "method": "markup"}, "method 'markup'"),
    ({"unit_id": "RIF", "unit_price": 10, "start_period": "2027/02/31x"}, "not a month"),
    ({"unit_id": "RIF", "unit_price": 10, "forecast_id": "F999"}, "does not exist"),
])
def test_price_validation_errors(client, body, fragment):
    res = client.post("/pricing/prices", json=body)
    assert res.status_code == 422
    assert fragment in res.json()["detail"]


def test_discount_on_product_without_base_price_warns(client):
    data = create(client, "/pricing/prices", {"unit_id": "NOP", "discount_pct": 0.1})
    assert any("no base_price" in w for w in data["warnings"])


# ---------------------------------------------------------------------------
# Resolve
# ---------------------------------------------------------------------------

def test_resolve_precedence(client):
    create(client, "/pricing/prices", {"prices": [
        {"unit_id": "RIF", "customer_type": "Dealer", "unit_price": 1199},
        {"unit_id": "RIF", "customer_id": "C-DLR", "unit_price": 1150, "start_period": "2027-01", "end_period": "2027-06"},
        {"unit_id": "RIF", "unit_price": 1400, "forecast_id": "F002"},
    ]})

    def resolve(**params):
        res = client.get("/pricing/resolve", params=params)
        assert res.status_code == 200, res.text
        return res.json()["data"]

    assert resolve(unit_id="RIF", customer_id="C-DLR", period="2027-03")["price"] == 1150
    later = resolve(unit_id="RIF", customer_id="C-DLR", period="2027-07")
    assert (later["price"], later["source"]) == (1199, "type_product")             # customer price expired
    assert resolve(unit_id="RIF", customer_id="C-DLR2")["source"] == "type_product"
    base = resolve(unit_id="RIF", customer_id="C-DST")
    assert (base["price"], base["source"], base["price_id"]) == (1500, "base_price", None)
    assert resolve(unit_id="RIF", customer_id="C-DST", forecast_id="F002")["price"] == 1400
    assert resolve(unit_id="RIF", customer_type="Dealer")["price"] == 1199
    none = resolve(unit_id="NOP", customer_id="C-DST")
    assert none["price"] is None and none["source"] == "none"

    assert client.get("/pricing/resolve", params={"unit_id": "GHOST"}).status_code == 404
    assert client.get("/pricing/resolve", params={"unit_id": "RIF", "customer_id": "GHOST"}).status_code == 404
    assert client.get("/pricing/resolve", params={"unit_id": "RIF", "period": "2027-Q1"}).status_code == 422
    assert client.get("/pricing/resolve", params={"unit_id": "RIF", "forecast_id": "F999"}).status_code == 404


# ---------------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------------

def _sales(mgr, forecast_id=F):
    return {r[0]: (r[1], r[2]) for r in rows(
        mgr, "SELECT sale_id, unit_price, total_revenue FROM sales WHERE forecast_id = ?", (forecast_id,))}


def test_apply_dry_run_then_apply(env):
    client, mgr = env
    create(client, "/pricing/prices", {"prices": [
        {"unit_id": "RIF", "customer_type": "Dealer", "unit_price": 1199},
        {"customer_type": "Government", "discount_pct": 0.2},
    ]})
    before = _sales(mgr)
    res = client.post("/pricing/apply", json={"forecast_id": F, "dry_run": True})
    assert res.status_code == 200, res.text
    dry = res.json()["data"]
    assert dry["dry_run"] is True and dry["matched"] == 5
    assert dry["unpriced"] == 1 and dry["unpriced_rows"][0]["sale_id"] == "S5"     # no rule, no base price
    assert dry["by_source"] == {"type_product": 1, "base_price": 2, "type_all": 1, "none": 1}
    assert _sales(mgr) == before                                                     # nothing written
    # S1 dealer rifle 1199, S2 distributor rifle -> base 1500, S3 gov pistol 600 x 0.8, S4 dealer pistol -> base 600
    expected_after = 10 * 1199 + 20 * 1500 + 5 * 480 + 4 * 600 + 30
    assert dry["revenue_before"] == 35850 and dry["revenue_after"] == expected_after
    assert dry["changed"] == 4 and dry["revenue_change"] == expected_after - 35850
    sample = {c["sale_id"]: c for c in dry["sample_changes"]}
    assert sample["S3"]["new_price"] == 480 and sample["S3"]["source"] == "type_all"

    applied = client.post("/pricing/apply", json={"forecast_id": F}).json()["data"]
    assert applied["changed"] == 4 and applied["dry_run"] is False
    after = _sales(mgr)
    assert after["S1"] == (1199, 11990) and after["S3"] == (480, 2400)
    assert after["S5"] == before["S5"]                                               # unpriced row left alone
    assert _sales(mgr, "F002") == {"S9": (999, 999)}                                 # other scenario untouched
    again = client.post("/pricing/apply", json={"forecast_id": F}).json()["data"]
    assert again["changed"] == 0 and again["unchanged"] == 4


def test_apply_filters(env):
    client, mgr = env
    create(client, "/pricing/prices", {"unit_id": "RIF", "customer_type": "Dealer", "unit_price": 1199})
    only_dealers = client.post("/pricing/apply", json={"forecast_id": F, "customer_types": ["dealer"],
                                                       "unit_ids": ["RIF"], "periods": ["Jan-2027"]}).json()["data"]
    assert only_dealers["matched"] == 1 and only_dealers["changed"] == 1
    no_fallback = client.post("/pricing/apply", json={"forecast_id": F, "fallback_to_base_price": False,
                                                      "dry_run": True}).json()["data"]
    assert no_fallback["by_source"].get("base_price") is None and no_fallback["unpriced"] == 4
    window = client.post("/pricing/apply", json={"forecast_id": F, "start_period": "2027-02", "end_period": "2027-03",
                                                 "dry_run": True}).json()["data"]
    assert window["matched"] == 3

    conn = mgr.get_connection()
    conn.execute("UPDATE sales SET unit_price = 0, total_revenue = 0 WHERE sale_id = 'S4'")
    conn.commit()
    mgr.close_connection(conn)
    missing = client.post("/pricing/apply", json={"forecast_id": F, "only_missing": True}).json()["data"]
    assert missing["matched"] == 1 and missing["changed"] == 1
    assert _sales(mgr)["S4"] == (600, 2400)


def test_apply_validation(client):
    assert client.post("/pricing/apply", json={}).status_code == 422
    assert client.post("/pricing/apply", json={"forecast_id": "F999"}).status_code == 404
    assert client.post("/pricing/apply", json={"forecast_id": F, "periods": ["2027-Q1"]}).status_code == 422
    assert client.post("/pricing/apply", json={"forecast_id": F, "start_period": "2027-05",
                                               "end_period": "2027-01"}).status_code == 422
