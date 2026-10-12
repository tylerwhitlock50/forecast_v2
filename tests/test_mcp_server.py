"""
MCP server tests.

Drives the real FastAPI app (with the MCP server mounted at /mcp) over
JSON-RPC through the streamable-HTTP endpoint, against an isolated seeded
SQLite database, and checks that tool calls change exactly what the web UI
would then show. Also unit-tests the bulk adjustment service.
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
from services.model_adjustments import AdjustmentError, adjust_material_costs, adjust_sales  # noqa: E402

HEADERS = {
    "host": "localhost:8000",
    "accept": "application/json, text/event-stream",
    "content-type": "application/json",
}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _seed(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("INSERT INTO forecast (forecast_id, name, description, is_base) VALUES ('F001', 'Base', 'desc', 1)")
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F002', 'Other', 0)")
    c.execute("INSERT INTO customers (customer_id, customer_name) VALUES ('C1', 'Acme')")
    c.execute("INSERT INTO customers (customer_id, customer_name) VALUES ('C2', 'Globex')")
    c.execute("""INSERT INTO units (unit_id, unit_name, base_price, bom_id, bom_version, router_id, router_version)
                 VALUES ('P1', 'Widget', 100, 'BOM1', '1.0', 'R1', '1.0')""")
    c.execute("INSERT INTO units (unit_id, unit_name, base_price) VALUES ('P2', 'Gadget', 50)")
    c.execute("INSERT INTO bom_definitions (bom_id, bom_name, version) VALUES ('BOM1', 'Widget BOM', '1.0')")
    c.execute("""INSERT INTO bom (bom_id, version, bom_line, material_description, qty, unit, unit_price, material_cost, target_cost)
                 VALUES ('BOM1', '1.0', 1, 'Steel plate', 2, 'ea', 10, 20, 20)""")
    c.execute("""INSERT INTO bom (bom_id, version, bom_line, material_description, qty, unit, unit_price, material_cost, target_cost)
                 VALUES ('BOM1', '1.0', 2, 'Paint', 1, 'ea', 5, 5, 5)""")
    c.execute("INSERT INTO router_definitions (router_id, router_name, version) VALUES ('R1', 'Widget Router', '1.0')")
    c.execute("INSERT INTO machines (machine_id, machine_name, machine_rate) VALUES ('M1', 'Press', 60)")
    c.execute("INSERT INTO labor_rates (rate_id, rate_name, rate_amount, rate_type) VALUES ('L1', 'Operator', 40, 'hourly')")
    c.execute("""INSERT INTO router_operations (router_id, sequence, machine_id, machine_minutes, labor_minutes, labor_type_id, operation_description)
                 VALUES ('R1', 1, 'M1', 15, 30, 'L1', 'Form')""")
    # F001: Jan P1 10 @ 100; Feb P1 20 @ 100; Feb P2 4 @ 50 (to C2); Mar P1 5 @ 100.
    c.execute("INSERT INTO sales VALUES ('S1','C1','P1','2026-01',10,100,1000,'F001')")
    c.execute("INSERT INTO sales VALUES ('S2','C1','P1','2026-02',20,100,2000,'F001')")
    c.execute("INSERT INTO sales VALUES ('S3','C2','P2','2026-02',4,50,200,'F001')")
    c.execute("INSERT INTO sales VALUES ('S4','C1','P1','2026-03',5,100,500,'F001')")
    c.execute("INSERT INTO sales VALUES ('S5','C1','P1','2026-03',7,100,700,'F002')")
    c.execute("""INSERT INTO financial_assumptions (forecast_id, opening_cash, dso_days, dio_days, dpo_days, income_tax_rate)
                 VALUES ('F001', 5000, 30, 30, 30, 0.25)""")
    c.execute("""INSERT INTO payroll_config (config_id, federal_tax_rate, state_tax_rate, social_security_rate, medicare_rate,
                 unemployment_rate, benefits_rate, workers_comp_rate, pay_frequency)
                 VALUES ('default', 0, 0, 0, 0, 0, 0, 0, 'monthly')""")
    conn.commit()
    conn.close()


def _patch_db_manager(mgr):
    """Point every module-level db_manager at the test database."""
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
def mcp_client():
    tmp = tempfile.mkdtemp()
    db_path = os.path.join(tmp, "mcp.db")
    mgr = DatabaseManager(database_path=db_path, data_dir=tmp)
    mgr.initialize()
    _seed(db_path)

    from app.main import app as fastapi_app  # real app, MCP mounted
    originals = _patch_db_manager(mgr)
    try:
        with TestClient(fastapi_app) as client:
            yield client, mgr
    finally:
        for name, original in originals.items():
            sys.modules[name].db_manager = original
        mgr.close_all_connections()
        shutil.rmtree(tmp, ignore_errors=True)


def rpc(client, method, params=None, id_=1, headers=None):
    res = client.post("/mcp", headers={**HEADERS, **(headers or {})},
                      json={"jsonrpc": "2.0", "id": id_, "method": method, "params": params or {}},
                      follow_redirects=False)
    return res


def call_tool(client, name, arguments=None):
    """Call a tool; return (parsed JSON payload or error text, is_error)."""
    res = rpc(client, "tools/call", {"name": name, "arguments": arguments or {}})
    assert res.status_code == 200, res.text
    result = res.json()["result"]
    text = "".join(block.get("text", "") for block in result.get("content", []) if block.get("type") == "text")
    if result.get("isError"):
        return text, True
    if result.get("structuredContent"):
        payload = result["structuredContent"]
        return payload.get("result", payload), False
    return json.loads(text), False


def ok(client, name, arguments=None):
    payload, is_error = call_tool(client, name, arguments)
    assert not is_error, payload
    return payload


def db_rows(mgr, sql, params=()):
    conn = mgr.get_connection()
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        mgr.close_connection(conn)


# ---------------------------------------------------------------------------
# Transport and catalog
# ---------------------------------------------------------------------------

def test_endpoint_serves_exact_and_trailing_slash_paths(mcp_client):
    client, _ = mcp_client
    for path in ("/mcp", "/mcp/"):
        res = client.post(path, headers=HEADERS, follow_redirects=False,
                          json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}})
        assert res.status_code == 200, (path, res.status_code, res.text)
        assert len(res.json()["result"]["tools"]) > 50
    # The rest of the API still answers.
    assert client.get("/forecast/scenarios").status_code == 200
    assert client.get("/no-such-route").json() == {"detail": "Not Found"}


def test_initialize_reports_server_and_instructions(mcp_client):
    client, _ = mcp_client
    res = rpc(client, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                     "clientInfo": {"name": "test", "version": "0"}})
    assert res.status_code == 200
    result = res.json()["result"]
    assert result["serverInfo"]["name"] == "forecast"
    assert "forecast_get_overview" in result["instructions"]


def test_foreign_host_is_rejected(mcp_client):
    client, _ = mcp_client
    res = rpc(client, "tools/list", headers={"host": "attacker.example:80"})
    assert res.status_code == 421


def test_tool_catalog_is_consistent(mcp_client):
    client, _ = mcp_client
    tools = rpc(client, "tools/list").json()["result"]["tools"]
    names = [t["name"] for t in tools]
    assert len(names) == len(set(names))
    for tool in tools:
        assert tool["name"].startswith("forecast_"), tool["name"]
        assert tool.get("description"), tool["name"]
        assert "readOnlyHint" in tool.get("annotations", {}), tool["name"]
    read_only = {t["name"] for t in tools if t["annotations"]["readOnlyHint"]}
    assert "forecast_sql_query" in read_only and "forecast_financial_statements" in read_only
    assert "forecast_adjust_sales" not in read_only and "forecast_delete_scenario" not in read_only
    destructive = {t["name"] for t in tools if t["annotations"].get("destructiveHint")}
    assert {"forecast_delete_scenario", "forecast_delete_record", "forecast_load_database"} <= destructive
    # Every domain the app covers has tools.
    for prefix in ("forecast_list_scenarios", "forecast_list_sales", "forecast_list_employees",
                   "forecast_list_expenses", "forecast_list_loans", "forecast_list_capex",
                   "forecast_financial_statements", "forecast_save_database", "forecast_query_table"):
        assert prefix in names


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

def test_overview_and_scenarios(mcp_client):
    client, _ = mcp_client
    overview = ok(client, "forecast_get_overview")
    assert overview["base_scenario_id"] == "F001"
    assert [s["forecast_id"] for s in overview["scenarios"]] == ["F001", "F002"]
    assert overview["health"]["has_data"] is True
    one = ok(client, "forecast_get_scenario", {"forecast_id": "F001"})
    assert one["sales_rows"] == 4 and one["start_period"] == "2026-01"


def test_list_sales_filters_and_totals(mcp_client):
    client, _ = mcp_client
    out = ok(client, "forecast_list_sales", {"forecast_id": "F001", "start_period": "2026-02", "end_period": "2026-02"})
    assert out["total_count"] == 2 and out["totals"]["revenue"] == 2200
    only = ok(client, "forecast_list_sales", {"forecast_id": "F001", "unit_id": "P2"})
    assert [r["sale_id"] for r in only["rows"]] == ["S3"]
    assert only["rows"][0]["customer_name"] == "Globex"


def test_query_table_and_sql_query(mcp_client):
    client, _ = mcp_client
    tables = ok(client, "forecast_list_tables")["tables"]
    sales = next(t for t in tables if t["table"] == "sales")
    assert sales["rows"] == 5 and sales["record_id_format"] == "sale_id"

    rows = ok(client, "forecast_query_table", {"table": "sales", "forecast_id": "F002"})
    assert [r["sale_id"] for r in rows["rows"]] == ["S5"]

    q = ok(client, "forecast_sql_query", {
        "sql": "SELECT period, SUM(total_revenue) AS revenue FROM sales WHERE forecast_id = 'F001' GROUP BY period ORDER BY period"})
    assert [(r["period"], r["revenue"]) for r in q["rows"]] == [("2026-01", 1000), ("2026-02", 2200), ("2026-03", 500)]

    text, is_error = call_tool(client, "forecast_sql_query", {"sql": "DELETE FROM sales"})
    assert is_error and "SELECT" in text
    text, is_error = call_tool(client, "forecast_sql_query", {"sql": "SELECT 1; DROP TABLE sales"})
    assert is_error
    text, is_error = call_tool(client, "forecast_query_table", {"table": "sqlite_master"})
    assert is_error and "Unknown table" in text


def test_statements_sections_trim_response(mcp_client):
    client, _ = mcp_client
    full = ok(client, "forecast_financial_statements", {
        "forecast_ids": ["F001"], "start_period": "2026-01", "end_period": "2026-03"})
    assert {"income_statement", "cash_flow", "balance_sheet", "detail"} <= set(full)
    trimmed = ok(client, "forecast_financial_statements", {
        "forecast_ids": ["F001"], "start_period": "2026-01", "end_period": "2026-03", "sections": ["income_statement"]})
    assert "income_statement" in trimmed and "balance_sheet" not in trimmed
    assert trimmed["cash_flow_totals"]["closing_cash"] == full["cash_flow"]["totals"]["closing_cash"]
    assert trimmed["income_statement"]["totals"]["revenue"] == 3700


# ---------------------------------------------------------------------------
# Writes: the planning workflows
# ---------------------------------------------------------------------------

def test_adjust_sales_dry_run_then_apply_shows_in_statements(mcp_client):
    client, mgr = mcp_client
    args = {"forecast_id": "F001", "periods": ["2026-02"], "price_multiplier": 0.65}
    preview = ok(client, "forecast_adjust_sales", {**args, "dry_run": True})
    assert preview["dry_run"] is True and preview["matched_rows"] == 2 and preview["updated_rows"] == 0
    assert preview["before"]["revenue"] == 2200 and preview["after"]["revenue"] == 1430
    assert db_rows(mgr, "SELECT unit_price FROM sales WHERE sale_id = 'S2'") == [(100,)]

    applied = ok(client, "forecast_adjust_sales", args)
    assert applied["updated_rows"] == 2 and applied["revenue_change"] == -770
    assert db_rows(mgr, "SELECT unit_price, total_revenue FROM sales WHERE sale_id = 'S2'") == [(65, 1300)]
    assert db_rows(mgr, "SELECT unit_price, total_revenue FROM sales WHERE sale_id = 'S3'") == [(32.5, 130)]
    # Other months and scenarios untouched.
    assert db_rows(mgr, "SELECT unit_price FROM sales WHERE sale_id IN ('S1', 'S4', 'S5')") == [(100,), (100,), (100,)]

    stmts = ok(client, "forecast_financial_statements", {
        "forecast_ids": ["F001"], "start_period": "2026-02", "end_period": "2026-02", "sections": ["income_statement"]})
    assert stmts["income_statement"]["by_period"][0]["revenue"] == 1430


def test_adjust_sales_window_customer_and_quantity(mcp_client):
    client, mgr = mcp_client
    out = ok(client, "forecast_adjust_sales", {
        "forecast_id": "F001", "start_period": "2026-01", "end_period": "2026-03",
        "customer_ids": ["C1"], "quantity_multiplier": 1.1, "price_delta": -10})
    assert out["matched_rows"] == 3  # S1, S2, S4 (C2's S3 excluded)
    assert db_rows(mgr, "SELECT quantity, unit_price, total_revenue FROM sales WHERE sale_id = 'S1'") == [(11, 90, 990)]
    assert db_rows(mgr, "SELECT quantity FROM sales WHERE sale_id = 'S3'") == [(4,)]


def test_adjust_sales_rejects_bad_input(mcp_client):
    client, _ = mcp_client
    text, is_error = call_tool(client, "forecast_adjust_sales", {"forecast_id": "F001", "periods": ["2026-02"]})
    assert is_error and "Nothing to do" in text
    text, is_error = call_tool(client, "forecast_adjust_sales", {
        "forecast_id": "F001", "price_multiplier": 0.9, "price_delta": -1})
    assert is_error and "only one" in text
    text, is_error = call_tool(client, "forecast_adjust_sales", {"forecast_id": "NOPE", "price_multiplier": 0.9})
    assert is_error and "not found" in text
    out = ok(client, "forecast_adjust_sales", {"forecast_id": "F001", "periods": ["2027-01"], "price_multiplier": 0.9})
    assert out["matched_rows"] == 0 and "hint" in out


def test_adjust_material_costs_updates_bom_and_product_cost(mcp_client):
    client, mgr = mcp_client
    preview = ok(client, "forecast_adjust_material_costs", {"material_contains": "steel", "price_multiplier": 1.12, "dry_run": True})
    assert preview["matched_lines"] == 1 and preview["updated_lines"] == 0
    assert preview["products_affected"][0]["material_per_unit"] == {"before": 25, "after": 27.4}
    assert db_rows(mgr, "SELECT unit_price FROM bom WHERE bom_line = 1") == [(10,)]

    applied = ok(client, "forecast_adjust_material_costs", {"material_contains": "STEEL", "price_multiplier": 1.12})
    assert applied["updated_lines"] == 1
    assert applied["material_cost_total"] == {"before": 20, "after": 22.4}
    assert applied["products_affected"][0]["material_per_unit"] == {"before": 25, "after": 27.4}
    assert db_rows(mgr, "SELECT unit_price, material_cost FROM bom WHERE bom_line = 1") == [(11.2, 22.4)]
    assert db_rows(mgr, "SELECT unit_price, material_cost FROM bom WHERE bom_line = 2") == [(5, 5)]

    bom = ok(client, "forecast_list_bom", {"bom_id": "BOM1"})
    assert bom["material_cost_total"] == 27.4 and bom["lines"][0]["used_by"] == ["P1"]
    # Costing endpoints see the new price.
    cost = ok(client, "forecast_unit_cost_preview", {"bom_id": "BOM1", "bom_version": "1.0", "router_id": "R1"})
    assert json.dumps(cost).find("27.4") >= 0


def test_branch_scenario_and_compare(mcp_client):
    client, _ = mcp_client
    branch = ok(client, "forecast_branch_scenario", {"forecast_id": "F001", "name": "Discount case", "price_multiplier": 0.8})
    new_id = branch.get("forecast_id") or branch.get("scenario", {}).get("forecast_id")
    assert new_id and new_id != "F001"
    rows = ok(client, "forecast_list_sales", {"forecast_id": new_id})
    assert rows["total_count"] == 4 and rows["totals"]["revenue"] == pytest.approx(3700 * 0.8)
    comparison = ok(client, "forecast_compare_scenarios", {"forecast_ids": ["F001", new_id]})
    assert comparison
    assert ok(client, "forecast_adjust_sales", {"forecast_id": "F001", "price_multiplier": 1.0, "dry_run": True})["before"]["revenue"] == 3700


def test_upsert_sales_and_delete_sale(mcp_client):
    client, mgr = mcp_client
    out = ok(client, "forecast_upsert_sales", {"forecast_id": "F001", "rows": [
        {"customer_id": "C2", "unit_id": "P1", "period": "2026-04", "quantity": 3, "unit_price": 120},
        {"customer_id": "C1", "unit_id": "P1", "period": "2026-01", "quantity": 12, "unit_price": 100},
    ]})
    assert out["updated_count"] == 2
    assert db_rows(mgr, "SELECT quantity, total_revenue FROM sales WHERE sale_id = 'S1'") == [(12, 1200)]
    new = db_rows(mgr, "SELECT sale_id, total_revenue FROM sales WHERE period = '2026-04' AND forecast_id = 'F001'")
    assert len(new) == 1 and new[0][1] == 360
    ok(client, "forecast_delete_sale", {"sale_id": new[0][0]})
    assert db_rows(mgr, "SELECT COUNT(*) FROM sales WHERE period = '2026-04'") == [(0,)]
    text, is_error = call_tool(client, "forecast_upsert_sales", {"forecast_id": "F001", "rows": [{"customer_id": "C1"}]})
    assert is_error and "unit_id" in text


def test_generic_record_crud(mcp_client):
    client, mgr = mcp_client
    ok(client, "forecast_create_record", {"table": "customers", "data": {"customer_id": "C9", "customer_name": "Initech", "region": "West"}})
    assert db_rows(mgr, "SELECT customer_name, region FROM customers WHERE customer_id = 'C9'") == [("Initech", "West")]
    ok(client, "forecast_update_record", {"table": "customers", "record_id": "C9", "updates": {"region": "East", "bogus": 1}})
    assert db_rows(mgr, "SELECT region FROM customers WHERE customer_id = 'C9'") == [("East",)]
    ok(client, "forecast_update_record", {"table": "bom", "record_id": "BOM1-1.0-2", "updates": {"unit_price": 6, "material_cost": 6}})
    assert db_rows(mgr, "SELECT unit_price FROM bom WHERE bom_line = 2") == [(6,)]
    ok(client, "forecast_delete_record", {"table": "customers", "record_id": "C9"})
    assert db_rows(mgr, "SELECT COUNT(*) FROM customers WHERE customer_id = 'C9'") == [(0,)]
    text, is_error = call_tool(client, "forecast_delete_record", {"table": "customers", "record_id": "C2"})
    assert is_error  # still has sales rows and cascade is off


def test_assumptions_update_merges(mcp_client):
    client, _ = mcp_client
    out = ok(client, "forecast_update_assumptions", {"forecast_id": "F001", "updates": {"dso_days": 45, "minimum_cash_balance": 1000}})
    assumptions = out["assumptions"]
    assert assumptions["dso_days"] == 45 and assumptions["minimum_cash_balance"] == 1000
    assert assumptions["income_tax_rate"] == 0.25 and assumptions["opening_cash"] == 5000
    text, is_error = call_tool(client, "forecast_update_assumptions", {"forecast_id": "F001", "updates": {"nope": 1}})
    assert is_error and "Unknown assumption fields" in text


def test_employee_create_update_and_payroll_forecast(mcp_client):
    client, mgr = mcp_client
    created = ok(client, "forecast_create_employee", {
        "employee_name": "Pat", "department": "Ops", "weekly_hours": 40, "hourly_rate": 30,
        "labor_type": "Operator", "start_date": "2026-02-01", "forecast_id": "F001"})
    employee_id = created["employee_id"]
    ok(client, "forecast_update_employee", {"employee_id": employee_id, "updates": {"end_date": "2026-02-28", "hourly_rate": 32}})
    assert db_rows(mgr, "SELECT hourly_rate, end_date, department FROM payroll WHERE employee_id = ?", (employee_id,)) == [(32, "2026-02-28", "Ops")]
    forecast = ok(client, "forecast_payroll_forecast", {"forecast_id": "F001", "start_period": "2026-01", "end_period": "2026-03"})
    assert forecast
    text, is_error = call_tool(client, "forecast_update_employee", {"employee_id": employee_id, "updates": {"salary": 1}})
    assert is_error and "Unknown employee fields" in text


def test_expense_capex_and_loan_lifecycle(mcp_client):
    client, mgr = mcp_client
    cat = ok(client, "forecast_create_expense_category", {"category_name": "Software", "category_type": "admin_expense"})
    exp = ok(client, "forecast_create_expense", {
        "expense_name": "CRM", "category_id": cat["category_id"], "amount": 100, "frequency": "monthly",
        "start_date": "2026-01-01", "forecast_id": "F001"})
    ok(client, "forecast_update_expense", {"expense_id": exp["expense_id"], "updates": {"amount": 150}})
    assert db_rows(mgr, "SELECT amount FROM expenses WHERE expense_id = ?", (exp["expense_id"],)) == [(150,)]
    listed = ok(client, "forecast_list_expenses", {"forecast_id": "F001"})
    assert any(e["expense_id"] == exp["expense_id"] for e in listed["expenses"])

    capex = ok(client, "forecast_create_capex", {"asset_name": "Lathe", "amount": 1200, "purchase_period": "2026-02",
                                                 "useful_life_months": 12, "forecast_id": "F001"})
    capex_id = capex.get("capex_id") or capex.get("item", {}).get("capex_id")
    assert capex_id
    ok(client, "forecast_update_capex", {"capex_id": capex_id, "updates": {"amount": 1500}})
    assert db_rows(mgr, "SELECT amount FROM capital_expenditures WHERE capex_id = ?", (capex_id,)) == [(1500,)]

    loan = ok(client, "forecast_create_loan", {
        "loan_name": "Equipment", "lender": "Bank", "loan_type": "equipment_loan", "principal_amount": 10000,
        "interest_rate": 6.0, "loan_term_months": 12, "start_date": "2026-01-15"})
    schedule = ok(client, "forecast_loan_schedule", {"loan_id": loan["loan_id"]})
    assert schedule
    stmts = ok(client, "forecast_financial_statements", {
        "forecast_ids": ["F001"], "start_period": "2026-01", "end_period": "2026-03", "sections": ["cash_flow"]})
    assert stmts["cash_flow"]["totals"]["capex"] == -1500
    assert stmts["cash_flow"]["totals"]["loan_proceeds"] == 10000
    ok(client, "forecast_delete_loan", {"loan_id": loan["loan_id"]})
    ok(client, "forecast_delete_capex", {"capex_id": capex_id})
    ok(client, "forecast_delete_expense", {"expense_id": exp["expense_id"]})


def test_scenario_create_update_delete(mcp_client):
    client, mgr = mcp_client
    created = ok(client, "forecast_create_scenario", {"name": "Upside", "notes": "steel +12%"})
    fid = created["forecast_id"]
    ok(client, "forecast_update_scenario", {"forecast_id": fid, "name": "Upside v2", "is_base": True})
    assert db_rows(mgr, "SELECT name, is_base FROM forecast WHERE forecast_id = ?", (fid,)) == [("Upside v2", 1)]
    assert db_rows(mgr, "SELECT is_base FROM forecast WHERE forecast_id = 'F001'") == [(0,)]
    ok(client, "forecast_update_scenario", {"forecast_id": "F001", "is_base": True})
    ok(client, "forecast_delete_scenario", {"forecast_id": fid})
    assert db_rows(mgr, "SELECT COUNT(*) FROM forecast WHERE forecast_id = ?", (fid,)) == [(0,)]


def test_save_and_list_database_snapshots(mcp_client):
    client, mgr = mcp_client
    saved = ok(client, "forecast_save_database", {"name": "before-discounts"})
    assert saved
    listed = ok(client, "forecast_list_saved_databases")
    assert listed["current"]["filename"] == "mcp.db"
    assert "before-discounts" in json.dumps(listed)


# ---------------------------------------------------------------------------
# Service-level unit tests
# ---------------------------------------------------------------------------

@pytest.fixture()
def cursor():
    tmp = tempfile.mkdtemp()
    db_path = os.path.join(tmp, "svc.db")
    mgr = DatabaseManager(database_path=db_path, data_dir=tmp)
    mgr.initialize()
    _seed(db_path)
    conn = mgr.get_connection()
    yield conn.cursor()
    conn.close()
    mgr.close_all_connections()
    shutil.rmtree(tmp, ignore_errors=True)


def test_service_adjust_sales_rounds_quantity_and_recomputes_revenue(cursor):
    out = adjust_sales(cursor, "F001", unit_ids=["P2"], quantity_multiplier=1.6, price=60)
    assert out["matched_rows"] == 1
    assert cursor.execute("SELECT quantity, unit_price, total_revenue FROM sales WHERE sale_id = 'S3'").fetchone() == (6, 60, 360)


def test_service_adjust_sales_validation(cursor):
    with pytest.raises(AdjustmentError):
        adjust_sales(cursor, "", price_multiplier=0.9)
    with pytest.raises(AdjustmentError):
        adjust_sales(cursor, "F001", periods=["June"], price_multiplier=0.9)
    with pytest.raises(AdjustmentError):
        adjust_sales(cursor, "F001", start_period="2026-03", end_period="2026-01", price_multiplier=0.9)
    with pytest.raises(AdjustmentError):
        adjust_sales(cursor, "F001", price_multiplier=-1)


def test_service_adjust_material_costs_validation_and_delta(cursor):
    with pytest.raises(AdjustmentError):
        adjust_material_costs(cursor, price_multiplier=1.1)  # untargeted
    with pytest.raises(AdjustmentError):
        adjust_material_costs(cursor, material_contains="steel")  # no op
    out = adjust_material_costs(cursor, bom_ids=["BOM1"], price_delta=1)
    assert out["matched_lines"] == 2
    assert cursor.execute("SELECT unit_price, material_cost FROM bom WHERE bom_line = 1").fetchone() == (11, 22)
    assert cursor.execute("SELECT unit_price, material_cost FROM bom WHERE bom_line = 2").fetchone() == (6, 6)
    assert out["products_affected"][0]["material_per_unit"] == {"before": 25, "after": 28}
