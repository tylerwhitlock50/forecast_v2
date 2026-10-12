"""
Fixes from the MCP review (MCP-1 .. MCP-12) and the end-to-end MCP run
(F12, import tool overlap): each test reproduces a finding through the real
JSON-RPC endpoint at /mcp against an isolated database.
"""
import json
import os
import shutil
import sqlite3
import sys
import tempfile

import pytest
from fastapi.testclient import TestClient

_APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir, "app"))
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from app.db.database import DatabaseManager  # noqa: E402

HEADERS = {
    "host": "localhost:8000",
    "accept": "application/json, text/event-stream",
    "content-type": "application/json",
}


def _seed(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F001', 'Base', 1)")
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F002', 'Downside', 0)")
    for cid, name, ctype in (("C-DLR", "Main Street Guns", "Dealer"), ("C-DST", "Big Sky", "Distributor"),
                             ("C-GOV", "County Sheriff", "Government")):
        c.execute("INSERT INTO customers (customer_id, customer_name, customer_type) VALUES (?, ?, ?)",
                  (cid, name, ctype))
    for uid, name, utype, price in (("RFL-301", "Rifle 301", "Rifle", 1000), ("RFL-302", "Rifle 302", "Rifle", 1100),
                                    ("RFL-303", "Rifle 303", "Rifle", 1200), ("PST-9", "Pistol 9", "Pistol", 600)):
        c.execute("INSERT INTO units (unit_id, unit_name, unit_type, base_price) VALUES (?, ?, ?, ?)",
                  (uid, name, utype, price))
    for i, (cid, uid) in enumerate((("C-DLR", "RFL-301"), ("C-DST", "RFL-302"), ("C-GOV", "PST-9"))):
        for m in (1, 2, 3):
            c.execute("INSERT INTO sales VALUES (?, ?, ?, ?, 10, 1000, 10000, 'F001')",
                      (f"S{i}{m}", cid, uid, f"2027-{m:02d}"))
    conn.commit()
    conn.close()


def _patch_db_manager(mgr):
    originals = {}
    for name, module in list(sys.modules.items()):
        if module is None:
            continue
        if name in ("db.database", "app.db.database") or name.startswith("api.") or name.startswith("app.api."):
            if hasattr(module, "db_manager"):
                originals[name] = module.db_manager
                module.db_manager = mgr
    return originals


@pytest.fixture()
def env():
    tmp = tempfile.mkdtemp()
    data_dir = os.path.join(tmp, "data")
    os.makedirs(os.path.join(data_dir, "imports"))
    mgr = DatabaseManager(database_path=os.path.join(data_dir, "fix.db"), data_dir=data_dir)
    mgr.initialize()
    _seed(mgr.database_path)
    from app.main import app as fastapi_app
    originals = _patch_db_manager(mgr)
    try:
        with TestClient(fastapi_app) as client:
            yield client, mgr, data_dir
    finally:
        for name, original in originals.items():
            sys.modules[name].db_manager = original
        mgr.close_all_connections()
        shutil.rmtree(tmp, ignore_errors=True)


def raw_call(client, name, arguments=None):
    res = client.post("/mcp", headers=HEADERS, follow_redirects=False, json={
        "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments or {}},
    })
    assert res.status_code == 200, res.text
    result = res.json()["result"]
    text = "".join(b.get("text", "") for b in result.get("content", []) if b.get("type") == "text")
    return result, text


def ok(client, name, arguments=None):
    result, text = raw_call(client, name, arguments)
    assert not result.get("isError"), text
    return json.loads(text)


def err(client, name, arguments=None):
    result, text = raw_call(client, name, arguments)
    assert result.get("isError"), text
    return text


def scalar(mgr, sql, params=()):
    conn = mgr.get_connection()
    try:
        return conn.execute(sql, params).fetchone()[0]
    finally:
        mgr.close_connection(conn)


def tools_list(client):
    res = client.post("/mcp", headers=HEADERS, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}})
    return {t["name"]: t for t in res.json()["result"]["tools"]}


# ---------------------------------------------------------------------------
# MCP-1: upserts without an id update the rule in the same slot
# ---------------------------------------------------------------------------

def test_upsert_prices_without_id_updates_the_same_scope_instead_of_duplicating(env):
    client, mgr, _ = env
    first = ok(client, "forecast_upsert_prices", {"prices": [
        {"unit_id": u, "customer_type": "Dealer", "unit_price": 920} for u in ("RFL-301", "RFL-302", "RFL-303")]})
    assert first["created_count"] == 3 and first["updated_count"] == 0
    again = ok(client, "forecast_upsert_prices", {"prices": [
        {"unit_id": u, "customer_type": "dealer ", "unit_price": 777} for u in ("RFL-301", "RFL-302", "RFL-303")]})
    assert again["created_count"] == 0 and again["updated_count"] == 3, again
    assert len(again["matched_existing"]) == 3 and "updated instead" in again["note"]
    assert scalar(mgr, "SELECT COUNT(*) FROM price_list WHERE customer_type IN ('Dealer', 'dealer')") == 3
    for unit in ("RFL-301", "RFL-302", "RFL-303"):
        resolved = ok(client, "forecast_resolve_price", {"unit_id": unit, "customer_type": "Dealer",
                                                         "period": "2027-03"})
        assert resolved["price"] == 777, resolved
    # A different month window is a different slot: a new rule.
    window = ok(client, "forecast_upsert_prices", {"prices": [
        {"unit_id": "RFL-301", "customer_type": "Dealer", "unit_price": 700, "start_period": "2027-7"}]})
    assert window["created_count"] == 1
    # A discount sent for a fixed-price slot switches the rule's method.
    switched = ok(client, "forecast_upsert_prices", {"prices": [
        {"unit_id": "RFL-302", "customer_type": "Dealer", "discount_pct": 0.4}]})
    assert switched["updated"][0]["method"] == "discount_from_base" and switched["updated"][0]["discount_pct"] == 0.4
    assert ok(client, "forecast_resolve_price", {"unit_id": "RFL-302", "customer_type": "Dealer",
                                                 "period": "2027-03"})["price"] == 660


def test_upsert_deduction_rules_match_slot_and_other_allowance_programs_by_name(env):
    client, mgr, _ = env
    ok(client, "forecast_upsert_deduction_rules", {"rules": [
        {"deduction_type": "chargebacks", "rate": 0.01, "name": "Chargebacks"},
        {"deduction_type": "terms_allowance", "customer_type": "Dealer", "rate": 0.02},
        {"deduction_type": "other_allowance", "customer_type": "Distributor", "rate": 0.005, "name": "Co-op"},
    ]})
    out = ok(client, "forecast_upsert_deduction_rules", {"rules": [
        {"deduction_type": "chargebacks", "rate": 0.03, "name": "Chargebacks v2"},
        {"deduction_type": "other_allowance", "customer_type": "Distributor", "method": "per_unit",
         "amount_per_unit": 3, "name": "Freight allowance"},
        {"deduction_type": "other_allowance", "customer_type": "Distributor", "rate": 0.01, "name": "  co-op "},
    ]})
    assert out["created_count"] == 1 and out["updated_count"] == 2, out
    assert scalar(mgr, "SELECT COUNT(*) FROM sales_deduction_rules WHERE deduction_type = 'chargebacks'") == 1
    assert scalar(mgr, "SELECT COUNT(*) FROM sales_deduction_rules WHERE deduction_type = 'other_allowance'") == 2
    sim = ok(client, "forecast_simulate_deductions", {"gross": 1000, "quantity": 10, "customer_type": "Distributor"})
    amounts = {d["deduction_type"]: d["amount"] for d in sim["deductions"]}
    assert amounts["chargebacks"] == 30
    assert amounts["other_allowance"] == pytest.approx(10 + 30)     # co-op 1% + freight $3 x 10 units stack
    # A rate sent for an unnamed per_unit rule's slot switches it back to a percentage.
    ok(client, "forecast_upsert_deduction_rules", {"rules": [
        {"deduction_type": "terms_allowance", "customer_type": "Dealer", "method": "per_unit", "amount_per_unit": 5}]})
    back = ok(client, "forecast_upsert_deduction_rules", {"rules": [
        {"deduction_type": "terms_allowance", "customer_type": "Dealer", "rate": 0.025}]})
    assert back["updated"][0]["method"] == "percent_of_gross" and back["updated"][0]["rate"] == 0.025
    assert scalar(mgr, "SELECT COUNT(*) FROM sales_deduction_rules WHERE deduction_type = 'terms_allowance'") == 1


def test_upsert_switches_to_update_when_the_api_answers_409(env, monkeypatch):
    client, mgr, _ = env
    ok(client, "forecast_upsert_deduction_rules", {"rules": [
        {"deduction_type": "chargebacks", "rate": 0.01}, {"deduction_type": "excise_tax", "rate": 0.11}]})
    ok(client, "forecast_upsert_prices", {"prices": [{"unit_id": "RFL-301", "customer_type": "Dealer",
                                                      "unit_price": 900}]})
    import mcp_server.tools.pricing as pricing_tools
    # Hide the existing rules from the up-front slot match, as if they were created after the listing.
    monkeypatch.setattr(pricing_tools, "_slot_view",
                        lambda item: {**item, "forecast_id": "unlisted-" + json.dumps(item, sort_keys=True)})
    out = ok(client, "forecast_upsert_deduction_rules", {"rules": [
        {"deduction_type": "commission", "rate": 0.03},
        {"deduction_type": "excise_tax", "rate": 0.10},
        {"deduction_type": "chargebacks", "rate": 0.02},
    ]})
    assert out["created_count"] == 1 and out["updated_count"] == 2, out
    assert {m["index"] for m in out["matched_existing"]} == {1, 2}
    assert scalar(mgr, "SELECT COUNT(*) FROM sales_deduction_rules") == 3
    assert scalar(mgr, "SELECT rate FROM sales_deduction_rules WHERE deduction_type = 'chargebacks'") == 0.02
    price = ok(client, "forecast_upsert_prices", {"prices": [{"unit_id": "RFL-301", "customer_type": "Dealer",
                                                              "unit_price": 850}]})
    assert price["updated_count"] == 1 and price["created_count"] == 0
    assert scalar(mgr, "SELECT COUNT(*) FROM price_list") == 1


def test_upsert_rejects_two_items_for_the_same_slot(env):
    client, mgr, _ = env
    text = err(client, "forecast_upsert_prices", {"prices": [
        {"unit_id": "RFL-301", "customer_type": "Dealer", "unit_price": 900},
        {"unit_id": "RFL-301", "customer_type": "DEALER", "unit_price": 950}]})
    assert "prices 0 and 1" in text and "Nothing was written" in text
    assert scalar(mgr, "SELECT COUNT(*) FROM price_list") == 0


# ---------------------------------------------------------------------------
# MCP-2: an oversized WRITE result is cut, never turned into an error
# ---------------------------------------------------------------------------

def test_oversized_write_result_is_trimmed_and_says_the_write_was_applied(env, monkeypatch):
    import mcp_server.core as core
    client, mgr, _ = env
    monkeypatch.setattr(core, "MAX_RESPONSE_CHARS", 900)
    prices = [{"unit_id": u, "customer_id": c, "unit_price": 500 + i}
              for i, (u, c) in enumerate((u, c) for u in ("RFL-301", "RFL-302", "RFL-303", "PST-9")
                                         for c in ("C-DLR", "C-DST", "C-GOV"))]
    result, text = raw_call(client, "forecast_upsert_prices", {"prices": prices})
    assert not result.get("isError"), text
    assert len(text) <= 900
    out = json.loads(text)
    assert out["created_count"] == 12
    assert "WAS applied" in out["result_truncated"]["note"] and "do not call it again" in out["result_truncated"]["note"]
    assert scalar(mgr, "SELECT COUNT(*) FROM price_list") == 12
    # Repeating the call (what an error used to invite) no longer stacks duplicates either.
    result, text = raw_call(client, "forecast_upsert_prices", {"prices": prices})
    assert not result.get("isError") and json.loads(text)["updated_count"] == 12
    assert scalar(mgr, "SELECT COUNT(*) FROM price_list") == 12
    # A dry run says nothing was written.
    result, text = raw_call(client, "forecast_apply_price_list", {"forecast_id": "F001", "dry_run": True,
                                                                  "sample_size": 50})
    assert not result.get("isError")
    note = json.loads(text).get("result_truncated", {}).get("note", "dry run")
    assert "dry run" in note
    # A read-only tool over budget is still an actionable error (nothing happened, asking again is safe).
    result, text = raw_call(client, "forecast_list_prices", {})
    assert result.get("isError") and "nothing was changed" in text


# ---------------------------------------------------------------------------
# MCP-4 .. MCP-12, F12, import tool overlap
# ---------------------------------------------------------------------------

def test_revenue_summary_group_by_values_match_the_api(env):
    client, _mgr, _ = env
    schema = tools_list(client)["forecast_revenue_summary"]["inputSchema"]["properties"]["group_by"]
    assert {"product_type", "customer_type", "unit_type", "customer_unit"} <= set(schema["enum"])
    by_type = ok(client, "forecast_revenue_summary", {"forecast_id": "F001", "group_by": "product_type"})
    alias = ok(client, "forecast_revenue_summary", {"forecast_id": "F001", "group_by": "unit_type"})
    assert alias["groups"] == by_type["groups"] and by_type["group_count"] == 2
    assert ok(client, "forecast_revenue_summary", {"forecast_id": "F001", "group_by": "product"})["group_count"] == 3
    assert "validation error" in err(client, "forecast_revenue_summary", {"forecast_id": "F001", "group_by": "sku"})


def test_preview_file_suggests_sales_for_a_wide_month_layout(env):
    client, _mgr, data_dir = env
    months = ["Jan-27", "Feb-27", "Mar-27", "Apr-27", "May-27", "Jun-27"]
    with open(os.path.join(data_dir, "imports", "forecast_wide.csv"), "w", encoding="utf-8") as fh:
        fh.write("Customer,SKU," + ",".join(months) + "\n")
        fh.write('C-DLR,RFL-301,' + ",".join('"1,250"' for _ in months) + "\n")
    preview = ok(client, "forecast_preview_file", {"file_path": "imports/forecast_wide.csv"})
    best = preview["likely_imports"][0]
    assert best["kind"] == "sales" and best["tool"] == "forecast_import_sales", preview["likely_imports"]
    assert best["missing_required"] == [] and "6 (Jan-27 .. Jun-27)" in best["month_columns"]
    assert all(m["kind"] not in ("prices", "deductions") for m in preview["likely_imports"])
    with open(os.path.join(data_dir, "imports", "customers.csv"), "w", encoding="utf-8") as fh:
        fh.write("Customer ID,Name,Channel\nC9,Range Co,Dealer\n")
    kinds = [m["kind"] for m in ok(client, "forecast_preview_file", {"file_path": "imports/customers.csv"})["likely_imports"]]
    assert kinds[0] == "customers" and "prices" not in kinds and "deductions" not in kinds


def test_query_table_rejects_a_list_filter_instead_of_using_its_last_value(env):
    client, _mgr, _ = env
    text = err(client, "forecast_query_table", {"table": "sales", "forecast_id": "F001",
                                                "filters": {"customer_id": ["C-DLR", "C-DST"]}})
    assert "one value per column" in text and "IN (" in text
    one = ok(client, "forecast_query_table", {"table": "sales", "forecast_id": "F001", "filters": {"customer_id": "C-DLR"}})
    assert one["returned"] == 3


def test_sql_query_allows_keywords_in_values_and_names_but_never_writes(env):
    client, mgr, _ = env
    ok(client, "forecast_create_record", {"table": "bom_definitions", "data": {"bom_id": "B1", "bom_name": "x", "version": "1.0"}})
    ok(client, "forecast_create_record", {"table": "bom", "data": {"bom_id": "B1", "version": "1.0", "bom_line": 1,
                                                                   "material_description": "Barrel insert; 416R",
                                                                   "qty": 1, "unit_price": 5}})
    like = ok(client, "forecast_sql_query", {"sql": "SELECT bom_id, material_description FROM bom "
                                                    "WHERE material_description LIKE '%insert;%'"})
    assert like["rows"] == [["B1", "Barrel insert; 416R"]]
    rep = ok(client, "forecast_sql_query", {"sql": "SELECT replace(customer_name, ' Guns', '') AS name, "
                                                   "'create' AS \"update\" FROM customers WHERE customer_id = 'C-DLR'"})
    assert rep["rows"] == [["Main Street", "create"]]
    ok(client, "forecast_sql_query", {"sql": "SELECT name FROM pragma_table_info('bom') -- drop table bom;"})
    for bad in ("SELECT 1; DELETE FROM bom", "WITH x AS (SELECT 1) DELETE FROM bom",
                "WITH x AS (SELECT 1) INSERT INTO bom_definitions (bom_id) VALUES ('Z')", "DELETE FROM bom"):
        text = err(client, "forecast_sql_query", {"sql": bad})
        assert "allowed" in text or "one statement" in text, (bad, text)
    assert scalar(mgr, "SELECT COUNT(*) FROM bom") == 1
    assert scalar(mgr, "SELECT COUNT(*) FROM bom_definitions WHERE bom_id = 'Z'") == 0


def test_instructions_state_specificity_before_scenario_and_the_engine_agrees(env):
    client, _mgr, _ = env
    res = client.post("/mcp", headers=HEADERS, json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}})
    instructions = res.json()["result"]["instructions"]
    assert "SPECIFICITY FIRST" in instructions and "Only on equal specificity" in instructions
    assert "scenario beats company-wide" not in instructions
    assert len(instructions) < 4000      # what the guide promises clients
    ok(client, "forecast_upsert_deduction_rules", {"rules": [
        {"deduction_type": "terms_allowance", "customer_type": "Dealer", "rate": 0.02, "name": "Dealer terms"},
        {"deduction_type": "terms_allowance", "forecast_id": "F002", "rate": 0.05, "name": "Downside terms"}]})
    sim = ok(client, "forecast_simulate_deductions", {"gross": 1000, "customer_type": "Dealer", "forecast_id": "F002"})
    terms = next(d for d in sim["deductions"] if d["deduction_type"] == "terms_allowance")
    assert terms["amount"] == 20      # the more specific company-wide Dealer rule wins, as documented
    same_scope = ok(client, "forecast_upsert_deduction_rules", {"rules": [
        {"deduction_type": "terms_allowance", "forecast_id": "F002", "customer_type": "Dealer", "rate": 0.05}]})
    assert same_scope["created_count"] == 1
    sim = ok(client, "forecast_simulate_deductions", {"gross": 1000, "customer_type": "Dealer", "forecast_id": "F002"})
    assert next(d for d in sim["deductions"] if d["deduction_type"] == "terms_allowance")["amount"] == 50


def test_statements_default_window_and_scenario_cascade_docs(env):
    client, mgr, _ = env
    stmts = ok(client, "forecast_financial_statements", {"forecast_ids": ["F001"],
                                                          "sections": ["income_statement", "cash_flow"]})
    assert (stmts["start_period"], stmts["end_period"]) == ("2027-01", "2027-03")
    assert stmts["income_statement"]["totals"]["gross_sales"] == 90000
    tools = tools_list(client)
    assert "deduction rules" in tools["forecast_branch_scenario"]["description"]
    assert "price-list rules" in tools["forecast_delete_scenario"]["description"]
    ok(client, "forecast_upsert_prices", {"prices": [{"forecast_id": "F002", "unit_id": "RFL-301", "unit_price": 1}]})
    ok(client, "forecast_upsert_deduction_rules", {"rules": [{"forecast_id": "F002", "deduction_type": "chargebacks",
                                                              "rate": 0.01}]})
    deleted = ok(client, "forecast_delete_scenario", {"forecast_id": "F002"})["deleted"]
    assert deleted["prices"] == 1 and deleted["deduction_rules"] == 1
    assert scalar(mgr, "SELECT COUNT(*) FROM price_list WHERE forecast_id = 'F002'") == 0


def test_bad_scenario_or_period_is_an_error_not_zeros(env):
    client, _mgr, _ = env
    assert "not found: F0002" in err(client, "forecast_compare_scenarios", {"forecast_ids": ["F0002"]})
    assert "not found: F0002" in err(client, "forecast_compare_scenarios", {"forecast_ids": ["F001", "F0002"]})
    assert ok(client, "forecast_compare_scenarios", {"forecast_ids": ["F001"]})
    assert "Scenario 'F0002' not found" in err(client, "forecast_product_cost_summary", {"forecast_id": "F0002"})
    assert "Scenario 'F0002' not found" in err(client, "forecast_cost_breakdown", {"forecast_id": "F0002"})
    jan = ok(client, "forecast_sales_detail", {"forecast_ids": ["F001"], "period": "Jan 2027"})
    assert jan["total_count"] == 3 and jan["filters"]["period"] == "2027-01"
    assert "not a month" in err(client, "forecast_sales_detail", {"forecast_ids": ["F001"], "period": "2027-Q1"})


def test_import_records_keeps_the_updated_count(env):
    client, _mgr, _ = env
    out = ok(client, "forecast_import_records", {"table": "units", "rows": [
        {"unit_id": "RFL-301", "base_price": 1050}, {"unit_id": "RFL-302", "base_price": 1150},
        {"unit_id": "NEW-1", "unit_name": "New rifle", "base_price": 900}]})
    assert out["updated"] == 2 and out["created"] == 1, out
    assert {r["unit_id"] for r in out["updated_records"]} == {"RFL-301", "RFL-302"}
    assert out["created_ids"] == ["NEW-1"]


def test_customer_and_product_import_tools_point_to_import_records(env):
    client, _mgr, _ = env
    tools = tools_list(client)
    assert "forecast_import_records(table= 'customers')" in tools["forecast_import_customers"]["description"] or \
        "forecast_import_records(table='customers')" in tools["forecast_import_customers"]["description"]
    assert "forecast_import_records(table='units')" in tools["forecast_import_products"]["description"]
    assert "file_path" in tools["forecast_import_records"]["description"]
