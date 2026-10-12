"""
Other allowances are independent programs (F1 / RM-1), the simulate
explanation shows the engine's net base (RM-5), and the statements warn
when deduction rules exist but none applies in the window (RM-8).

* other_allowance rules are keyed by their normalised name: every matching
  program applies and they add up; within one program the most specific
  rule wins. A rule with no name is its own program.
* terms_allowance, chargebacks, excise_tax and commission keep one rule per
  row (the most specific).
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
        ("C-DST", "Big Distributor", "Distributor"),
        ("C-DST2", "Small Distributor", "Distributor"),
        ("C-DLR", "Main Street Guns", "Dealer"),
    ])
    c.executemany("INSERT INTO units (unit_id, unit_name, base_price, unit_type) VALUES (?, ?, ?, ?)", [
        ("RIF", "Hunter Rifle", 1500, "Rifle"),
    ])
    c.executemany(
        "INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
            ("S1", "C-DST", "RIF", "2027-01", 10, 1000, 10000, F),
            ("S2", "C-DST2", "RIF", "2027-01", 5, 1000, 5000, F),
            ("S3", "C-DLR", "RIF", "2027-02", 4, 1000, 4000, F),
        ])
    conn.commit()
    conn.close()


@pytest.fixture()
def env():
    tmp = tempfile.mkdtemp()
    db_path = os.path.join(tmp, "programs.db")
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


def create(client, body):
    res = client.post("/pricing/deductions", json=body)
    assert res.status_code == 200, res.text
    return res.json()["data"]["rules"]


def statements(mgr, start="2027-01", end="2027-02"):
    from services.financial_statements import build_statements
    conn = mgr.get_connection()
    try:
        return build_statements(conn.cursor(), [F], start, end)
    finally:
        mgr.close_connection(conn)


# ---------------------------------------------------------------------------
# Service: programs stack, most specific wins inside a program
# ---------------------------------------------------------------------------

def _rule(rule_id, dtype="other_allowance", **kw):
    return {"rule_id": rule_id, "deduction_type": dtype, "method": kw.pop("method", "percent_of_gross"),
            "rate": kw.pop("rate", 0.0), "amount_per_unit": kw.pop("amount_per_unit", 0.0), "is_active": 1, **kw}


ROW = {"forecast_id": F, "customer_id": "C-DST", "customer_type": "Distributor", "unit_id": "RIF",
       "unit_type": "Rifle", "period": "2027-01", "gross_sales": 10000.0, "quantity": 10.0}


def test_other_allowance_programs_add_up():
    rules = [
        _rule("D-COOP", name="Distributor co-op", rate=0.005, customer_type="Distributor"),
        _rule("D-FRT", name="Distributor freight", method="per_unit", amount_per_unit=3.0, customer_type="Distributor"),
        _rule("D-TERMS", "terms_allowance", name="Terms", rate=0.02),
    ]
    out = pricing.DeductionResolver(rules).compute(ROW)
    assert out["other_allowance"] == pytest.approx(50.0 + 30.0)
    assert out["terms_allowance"] == pytest.approx(200.0)
    assert out["total_sales_deductions"] == pytest.approx(280.0)
    assert out["net_sales"] == pytest.approx(10000.0 - 280.0)
    assert sorted(out["applied_rules"]["other_allowance"].split(",")) == ["D-COOP", "D-FRT"]
    assert out["applied_rules"]["terms_allowance"] == "D-TERMS"
    assert out["rule_amounts"] == pytest.approx({"D-COOP": 50.0, "D-FRT": 30.0, "D-TERMS": 200.0})


def test_most_specific_rule_wins_within_a_program_and_names_are_normalised():
    rules = [
        _rule("D-COOP-TYPE", name="Co-op Advertising", rate=0.005, customer_type="Distributor"),
        _rule("D-COOP-ACME", name="  co-op   advertising ", rate=0.01, customer_id="C-DST"),
        _rule("D-REBATE", name="Volume rebate", rate=0.02),
    ]
    resolver = pricing.DeductionResolver(rules)
    big = resolver.compute(ROW)
    # C-DST: its own co-op rate replaces the Distributor co-op; the rebate is a separate program and adds.
    assert big["other_allowance"] == pytest.approx(100.0 + 200.0)
    assert sorted(big["applied_rules"]["other_allowance"].split(",")) == ["D-COOP-ACME", "D-REBATE"]
    small = resolver.compute({**ROW, "customer_id": "C-DST2", "gross_sales": 5000.0, "quantity": 5})
    assert small["other_allowance"] == pytest.approx(25.0 + 100.0)
    applicable = resolver.applicable(ROW)
    assert [r["rule_id"] for r in applicable["other_allowance"]] == ["D-COOP-ACME", "D-REBATE"]


def test_unnamed_other_allowance_rules_are_their_own_programs():
    rules = [_rule("D-A", rate=0.01), _rule("D-B", rate=0.02, name="  ")]
    out = pricing.DeductionResolver(rules).compute(ROW)
    assert out["other_allowance"] == pytest.approx(300.0)


def test_rules_with_the_automatic_name_are_unnamed_programs():
    rules = [
        _rule("D-TYPE", name="Other discounts & allowances 1% (Distributor)", rate=0.01, customer_type="Distributor"),
        _rule("D-CUST", name="Other discounts & allowances 0.5% (C-DST)", rate=0.005, customer_id="C-DST"),
    ]
    assert pricing.program_name(rules[0]) is None
    assert pricing.program_name({**rules[0], "name": "Co-op"}) == "co-op"
    out = pricing.DeductionResolver(rules).compute(ROW)
    assert out["other_allowance"] == pytest.approx(150.0)


def test_one_rule_per_row_still_holds_for_the_other_types():
    rules = [
        _rule("D-T1", "terms_allowance", name="Terms A", rate=0.02),
        _rule("D-T2", "terms_allowance", name="Terms B", rate=0.01, customer_type="Distributor"),
        _rule("D-CB1", "chargebacks", name="CB all", rate=0.01),
        _rule("D-CB2", "chargebacks", name="CB dist", rate=0.015, customer_type="Distributor"),
    ]
    out = pricing.DeductionResolver(rules).compute(ROW)
    assert out["terms_allowance"] == pytest.approx(100.0)
    assert out["chargebacks"] == pytest.approx(150.0)
    assert out["applied_rules"] == {"terms_allowance": "D-T2", "chargebacks": "D-CB2"}


def test_percent_of_net_program_uses_the_net_of_the_other_programs():
    rules = [
        _rule("D-COOP", name="Co-op", rate=0.01),
        _rule("D-REB", name="Rebate on net", method="percent_of_net", rate=0.05),
        _rule("D-FET", "excise_tax", name="FET", method="embedded_tax", rate=0.11),
    ]
    out = pricing.DeductionResolver(rules).compute({**ROW, "gross_sales": 1110.0, "quantity": 1})
    net_base = 1110 - 11.1 - 110
    assert out["net_base"] == pytest.approx(net_base)
    assert out["other_allowance"] == pytest.approx(11.1 + 0.05 * net_base)
    assert out["rule_amounts"]["D-REB"] == pytest.approx(0.05 * net_base)


def test_compute_row_deductions_still_takes_one_rule_per_type():
    winners = {"terms_allowance": {"rule_id": "a", "method": "percent_of_gross", "rate": 0.02},
               "other_allowance": {"rule_id": "b", "method": "per_unit", "amount_per_unit": 2}}
    out = pricing.compute_row_deductions(winners, {"gross_sales": 1000.0, "quantity": 3})
    assert out["terms_allowance"] == pytest.approx(20.0) and out["other_allowance"] == pytest.approx(6.0)
    assert out["applied_rules"] == {"terms_allowance": "a", "other_allowance": "b"}


# ---------------------------------------------------------------------------
# API + statements: the e2e repro (co-op 0.5% of gross + freight $3/unit)
# ---------------------------------------------------------------------------

def test_two_allowance_programs_both_reach_the_statements(env):
    client, mgr = env
    create(client, {"rules": [
        {"deduction_type": "other_allowance", "name": "Distributor co-op allowance", "rate": 0.005,
         "customer_type": "Distributor"},
        {"deduction_type": "other_allowance", "name": "Distributor freight allowance", "method": "per_unit",
         "amount_per_unit": 3, "customer_type": "Distributor"},
    ]})
    jan = next(r for r in statements(mgr)["income_statement"]["by_period"] if r["period"] == "2027-01")
    # Distributor gross 15,000 x 0.5% = 75 plus 15 units x $3 = 45
    assert jan["other_allowances"] == pytest.approx(120.0)
    assert jan["revenue"] == pytest.approx(15000 - 120.0)


def test_company_wide_programs_at_one_and_two_percent_give_three_percent(env):
    client, mgr = env
    create(client, {"rules": [
        {"deduction_type": "other_allowance", "name": "Co-op", "rate": 0.01},
        {"deduction_type": "other_allowance", "name": "Rebate", "rate": 0.02},
    ]})
    totals = statements(mgr)["income_statement"]["totals"]
    assert totals["other_allowances"] == pytest.approx(0.03 * 19000)


def test_simulate_lists_every_program_applied(env):
    client, _ = env
    coop, freight = create(client, {"rules": [
        {"deduction_type": "other_allowance", "name": "Co-op", "rate": 0.005, "customer_type": "Distributor"},
        {"deduction_type": "other_allowance", "name": "Freight", "method": "per_unit", "amount_per_unit": 3,
         "customer_type": "Distributor"},
    ]})
    data = client.post("/pricing/deductions/simulate",
                       json={"gross": 10000, "quantity": 10, "customer_id": "C-DST"}).json()["data"]
    line = next(x for x in data["lines"] if x["deduction_type"] == "other_allowance")
    assert line["amount"] == 80.0
    assert sorted(r["rule_id"] for r in line["rules"]) == sorted([coop["rule_id"], freight["rule_id"]])
    assert {r["rule_id"]: r["amount"] for r in line["rules"]} == {coop["rule_id"]: 50.0, freight["rule_id"]: 30.0}
    assert line["rule"]["rule_id"] in (coop["rule_id"], freight["rule_id"])     # kept for older clients
    assert line["overridden_rules"] == []
    other_text = [e for e in data["explanation"] if e.startswith("Other discounts")]
    assert len(other_text) == 2
    assert data["total_sales_deductions"] == 80.0 and data["net_sales"] == 9920.0


def test_preview_reports_usage_per_program_rule(env):
    client, _ = env
    coop, freight = create(client, {"rules": [
        {"deduction_type": "other_allowance", "name": "Co-op", "rate": 0.005, "customer_type": "Distributor"},
        {"deduction_type": "other_allowance", "name": "Freight", "method": "per_unit", "amount_per_unit": 3,
         "customer_type": "Distributor"},
    ]})
    data = client.get("/pricing/deductions/preview", params={"forecast_id": F}).json()["data"]
    usage = {r["rule_id"]: (r["rows_applied"], r["amount"]) for r in data["rules"]}
    assert usage[coop["rule_id"]] == (2, 75.0)
    assert usage[freight["rule_id"]] == (2, 45.0)
    by_type = {t["deduction_type"]: t for t in data["by_type"]}
    assert by_type["other_allowance"]["amount"] == 120.0
    assert by_type["other_allowance"]["rules_applied"] == sorted([coop["rule_id"], freight["rule_id"]])
    assert "rule_unused" not in [w["code"] for w in data["warnings"]]


def test_catalog_explains_programs(env):
    client, _ = env
    data = client.get("/pricing/deduction-types").json()["data"]
    assert "program" in data["precedence"].lower()
    other = next(t for t in data["deduction_types"] if t["deduction_type"] == "other_allowance")
    assert other["stacks"] is True
    terms = next(t for t in data["deduction_types"] if t["deduction_type"] == "terms_allowance")
    assert terms["stacks"] is False
    assert data["stacking_types"] == ["other_allowance"]


# ---------------------------------------------------------------------------
# RM-5: the explanation shows the base the engine uses for percent_of_net
# ---------------------------------------------------------------------------

def test_simulate_explains_percent_of_net_on_the_engine_base(env):
    client, _ = env
    create(client, {"rules": [
        {"deduction_type": "terms_allowance", "rate": 0.02, "name": "Terms"},
        {"deduction_type": "chargebacks", "rate": 0.015, "name": "Chargebacks"},
        {"deduction_type": "excise_tax", "method": "embedded_tax", "rate": 0.11, "name": "FET"},
        {"deduction_type": "other_allowance", "method": "percent_of_net", "rate": 0.05, "name": "Rebate on net"},
        {"deduction_type": "commission", "method": "percent_of_net", "rate": 0.05, "name": "Commission"},
    ]})
    data = client.post("/pricing/deductions/simulate", json={"gross": 1000, "customer_id": "C-DST"}).json()["data"]
    base = 1000 - 20 - 15 - 1000 * 0.11 / 1.11                    # 865.90: pass-1 contra-revenue only
    amount = round(base * 0.05, 2)
    other = next(e for e in data["explanation"] if "Rebate on net" in e)
    assert f"{base:,.2f} net x 0.05 = {amount:,.2f}" in other
    commission = next(e for e in data["explanation"] if e.startswith("Sales commissions"))
    assert f"{base:,.2f} net x 0.05" in commission
    assert data["net_base"] == round(base, 2)


# ---------------------------------------------------------------------------
# RM-8: rules exist but none applies in the window
# ---------------------------------------------------------------------------

def _no_rule_warning(warnings):
    return [w for w in warnings if w.get("code") == "no_deduction_rules"]


def test_no_rules_at_all_keeps_the_original_warning(env):
    _, mgr = env
    found = _no_rule_warning(statements(mgr)["warnings"])
    assert len(found) == 1 and found[0]["level"] == "info"
    assert "No discount, allowance, excise or commission rules are set up" in found[0]["message"]


def test_rules_that_match_no_sales_row_in_the_window_warn(env):
    client, mgr = env
    create(client, {"rules": [
        {"deduction_type": "excise_tax", "method": "embedded_tax", "rate": 0.11, "unit_type": "Rifles"},
        {"deduction_type": "terms_allowance", "rate": 0.02, "customer_type": "Dealers"},
    ]})
    stmt = statements(mgr)
    assert stmt["income_statement"]["totals"]["total_sales_deductions"] == 0
    found = _no_rule_warning(stmt["warnings"])
    assert len(found) == 1 and found[0]["level"] == "info"
    assert "2 deduction rules" in found[0]["message"] and "none applies" in found[0]["message"]
    assert found[0]["rule_count"] == 2

    preview = client.get("/pricing/deductions/preview", params={"forecast_id": F}).json()["data"]
    found = _no_rule_warning(preview["warnings"])
    assert len(found) == 1 and "none applies" in found[0]["message"]


def test_rules_applying_outside_the_window_only_warn(env):
    client, mgr = env
    create(client, {"deduction_type": "terms_allowance", "rate": 0.02, "customer_type": "Dealer"})
    assert _no_rule_warning(statements(mgr, "2027-02", "2027-02")["warnings"]) == []     # S3 dealer row in Feb
    jan = _no_rule_warning(statements(mgr, "2027-01", "2027-01")["warnings"])
    assert len(jan) == 1 and "none applies" in jan[0]["message"]


def test_a_rule_that_applies_means_no_warning(env):
    client, mgr = env
    create(client, {"deduction_type": "terms_allowance", "rate": 0.0, "customer_type": "Distributor"})
    # a 0% exemption still applies to the rows it matches
    assert _no_rule_warning(statements(mgr, "2027-01", "2027-01")["warnings"]) == []
