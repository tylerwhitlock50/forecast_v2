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


def records(columns, rows):
    """{columns, rows} table -> list of dicts."""
    return [dict(zip(columns, row)) for row in rows]


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
    assert overview["master_data"]["customers"] == 2 and overview["master_data"]["products"] == 2
    one = ok(client, "forecast_get_scenario", {"forecast_id": "F001"})
    assert one["sales_rows"] == 4 and one["start_period"] == "2026-01"


def test_list_sales_filters_and_totals(mcp_client):
    client, _ = mcp_client
    out = ok(client, "forecast_list_sales", {"forecast_id": "F001", "start_period": "2026-02", "end_period": "2026-02"})
    assert out["total_count"] == 2 and out["totals"]["gross_sales"] == 2200 and out["totals"]["net_sales"] == 2200
    only = ok(client, "forecast_list_sales", {"forecast_id": "F001", "unit_id": "P2", "fields": ["sale_id", "customer_name"]})
    assert only["columns"] == ["sale_id", "customer_name"] and only["rows"] == [["S3", "Globex"]]
    as_records = ok(client, "forecast_list_sales", {"forecast_id": "F001", "unit_id": "P2", "fields": ["sale_id", "customer_name"],
                                                   "layout": "records"})
    assert as_records["rows"] == [{"sale_id": "S3", "customer_name": "Globex"}] and "columns" not in as_records
    assert only["totals"]["gross_sales"] == 200 and only["totals"]["rows"] == 1


def test_query_table_and_sql_query(mcp_client):
    client, _ = mcp_client
    tables = ok(client, "forecast_list_tables")["tables"]
    sales = next(t for t in tables if t["table"] == "sales")
    assert sales["rows"] == 5 and sales["record_id_format"] == "sale_id"

    rows = ok(client, "forecast_query_table", {"table": "sales", "forecast_id": "F002"})
    assert [r["sale_id"] for r in records(rows["columns"], rows["rows"])] == ["S5"]
    rows = ok(client, "forecast_query_table", {"table": "sales", "forecast_id": "F002", "layout": "records"})
    assert [r["sale_id"] for r in rows["rows"]] == ["S5"]
    text, is_error = call_tool(client, "forecast_query_table", {"table": "sales", "filters": {"customer": "C1"}})
    assert is_error and "Unknown column" in text

    q = ok(client, "forecast_sql_query", {
        "sql": "SELECT period, SUM(total_revenue) AS revenue FROM sales WHERE forecast_id = 'F001' GROUP BY period ORDER BY period"})
    assert q["columns"] == ["period", "revenue"]
    assert q["rows"] == [["2026-01", 1000], ["2026-02", 2200], ["2026-03", 500]]

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
    by_period = stmts["income_statement"]["by_period"]
    assert records(by_period["columns"], by_period["rows"])[0]["revenue"] == 1430


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
        "forecast_id": "F001", "periods": ["2026-02"], "price_multiplier": 0.9, "price_delta": -1})
    assert is_error and "only one" in text
    text, is_error = call_tool(client, "forecast_adjust_sales", {"forecast_id": "NOPE", "all_rows": True, "price_multiplier": 0.9})
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
    assert rows["total_count"] == 4 and rows["totals"]["gross_sales"] == pytest.approx(3700 * 0.8)
    comparison = ok(client, "forecast_compare_scenarios", {"forecast_ids": ["F001", new_id]})
    assert comparison
    assert ok(client, "forecast_adjust_sales", {"forecast_id": "F001", "all_rows": True, "price_multiplier": 1.0,
                                                "dry_run": True})["before"]["revenue"] == 3700


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


def test_upsert_sales_relative_operations_respect_missing_rows(mcp_client):
    client, mgr = mcp_client
    # subtract from a row that does not exist: skipped, nothing created
    out = ok(client, "forecast_upsert_sales", {"forecast_id": "F001", "operation": "subtract", "rows": [
        {"customer_id": "C2", "unit_id": "P1", "period": "2026-05", "quantity": 3},
        {"customer_id": "C1", "unit_id": "P1", "period": "2026-01", "quantity": 4},
    ]})
    assert out["updated_count"] == 1 and len(out["skipped"]) == 1
    assert out["skipped"][0]["reason"] == "no existing row to subtract from"
    assert db_rows(mgr, "SELECT COUNT(*) FROM sales WHERE period = '2026-05'") == [(0,)]
    assert db_rows(mgr, "SELECT quantity, unit_price, total_revenue FROM sales WHERE sale_id = 'S1'") == [(6, 100, 600)]
    # add to a row that does not exist without a price: refused, nothing created
    text, is_error = call_tool(client, "forecast_upsert_sales", {"forecast_id": "F001", "operation": "add", "rows": [
        {"customer_id": "C2", "unit_id": "P1", "period": "2026-05", "quantity": 3}]})
    assert is_error and "unit_price" in text
    assert db_rows(mgr, "SELECT COUNT(*) FROM sales WHERE period = '2026-05'") == [(0,)]
    # add to a missing row with a price creates it; add to an existing row keeps its price
    out = ok(client, "forecast_upsert_sales", {"forecast_id": "F001", "operation": "add", "rows": [
        {"customer_id": "C2", "unit_id": "P1", "period": "2026-05", "quantity": 3, "unit_price": 120},
        {"customer_id": "C1", "unit_id": "P1", "period": "2026-01", "quantity": 4},
    ]})
    assert out["updated_count"] == 2 and "skipped" not in out
    assert db_rows(mgr, "SELECT quantity, unit_price, total_revenue FROM sales WHERE period = '2026-05'") == [(3, 120, 360)]
    assert db_rows(mgr, "SELECT quantity, unit_price, total_revenue FROM sales WHERE sale_id = 'S1'") == [(10, 100, 1000)]
    # all rows skipped: no API call, clear message
    out = ok(client, "forecast_upsert_sales", {"forecast_id": "F001", "operation": "subtract", "rows": [
        {"customer_id": "C2", "unit_id": "P1", "period": "2026-06", "quantity": 1}]})
    assert out["updated_count"] == 0 and out["message"] == "No rows changed"
    # unknown ids are an error, not a silent skip
    text, is_error = call_tool(client, "forecast_upsert_sales", {"forecast_id": "F001", "operation": "subtract", "rows": [
        {"customer_id": "C9", "unit_id": "P9", "period": "2026-01", "quantity": 1}]})
    assert is_error and "customer 'C9' does not exist" in text


def test_generic_record_crud(mcp_client):
    client, mgr = mcp_client
    ok(client, "forecast_create_record", {"table": "customers", "data": {"customer_id": "C9", "customer_name": "Initech", "region": "West"}})
    assert db_rows(mgr, "SELECT customer_name, region FROM customers WHERE customer_id = 'C9'") == [("Initech", "West")]
    text, is_error = call_tool(client, "forecast_update_record", {"table": "customers", "record_id": "C9",
                                                                  "updates": {"region": "East", "bogus": 1}})
    assert is_error and "bogus" in text
    assert db_rows(mgr, "SELECT region FROM customers WHERE customer_id = 'C9'") == [("West",)]
    ok(client, "forecast_update_record", {"table": "customers", "record_id": "C9", "updates": {"region": "East"}})
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
# Hardening: result format, strict arguments, response sizes
# ---------------------------------------------------------------------------

def raw_call(client, name, arguments=None):
    """(text of the single content block, is_error, full result) for size / format checks."""
    res = rpc(client, "tools/call", {"name": name, "arguments": arguments or {}})
    assert res.status_code == 200, res.text
    result = res.json()["result"]
    text = "".join(block.get("text", "") for block in result.get("content", []) if block.get("type") == "text")
    return text, bool(result.get("isError")), result


def _set_types(mgr):
    conn = mgr.get_connection()
    conn.execute("UPDATE customers SET customer_type = 'Dealer' WHERE customer_id = 'C1'")
    conn.execute("UPDATE customers SET customer_type = 'Distributor' WHERE customer_id = 'C2'")
    conn.commit()
    mgr.close_connection(conn)


def _seed_500_rows(mgr):
    """Scenario F003: 7 customers x 6 products x 12 months of 2027 = 504 sales rows."""
    conn = mgr.get_connection()
    c = conn.cursor()
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F003', '2027 Budget', 0)")
    for i in range(7):
        c.execute("INSERT INTO customers (customer_id, customer_name, customer_type, region) VALUES (?, ?, ?, 'West')",
                  (f"CB{i}", f"Customer {i} Outdoor Supply LLC", ("Dealer", "Distributor", "Direct")[i % 3]))
    for p in range(6):
        c.execute("""INSERT INTO units (unit_id, unit_name, base_price, unit_type, bom_id, bom_version, router_id, router_version)
                     VALUES (?, ?, ?, 'Rifle', 'BOM1', '1.0', 'R1', '1.0')""", (f"PB{p}", f"Rifle model {p}", 1200 + p * 100))
    n = 0
    for i in range(7):
        for p in range(6):
            for m in range(1, 13):
                qty, price = 5 + (i * 7 + p * 3 + m) % 40, round((1200 + p * 100) * (0.7 + 0.01 * ((i + m) % 30)), 2)
                c.execute("INSERT INTO sales VALUES (?, ?, ?, ?, ?, ?, ?, 'F003')",
                          (f"SB{n:04d}", f"CB{i}", f"PB{p}", f"2027-{m:02d}", qty, price, round(qty * price, 2)))
                n += 1
    conn.commit()
    mgr.close_connection(conn)
    return n


def test_results_are_one_compact_text_block_without_structured_duplicate(mcp_client):
    client, _ = mcp_client
    tools = rpc(client, "tools/list").json()["result"]["tools"]
    for tool in tools:
        assert "outputSchema" not in tool, tool["name"]
        assert tool["inputSchema"].get("additionalProperties") is False, tool["name"]
        assert "\n    " not in tool["description"], tool["name"]  # docstring indentation is cleaned
    text, is_error, result = raw_call(client, "forecast_financial_statements", {
        "forecast_ids": ["F001"], "start_period": "2026-01", "end_period": "2026-03", "sections": ["income_statement"]})
    assert not is_error
    assert "structuredContent" not in result and len(result["content"]) == 1
    assert "\n" not in text and ": " not in text  # compact separators, no indentation
    assert json.loads(text)["income_statement"]["totals"]["revenue"] == 3700


def test_compact_json_trims_float_noise():
    from mcp_server.core import to_json_text
    text = to_json_text({"a": 30.500000000000004, "b": 2005668.0000000002, "c": -0.0, "d": 1329.3349999999998,
                         "e": float("nan"), "f": 0.0145, "g": [1.0, 2.5]})
    assert json.loads(text) == {"a": 30.5, "b": 2005668, "c": 0, "d": 1329.335, "e": None, "f": 0.0145, "g": [1, 2.5]}
    assert '"b":2005668,' in text


def test_unknown_arguments_are_rejected_not_ignored(mcp_client):
    client, mgr = mcp_client
    _set_types(mgr)
    # The audit's case: a guessed filter name used to be dropped, re-pricing the whole scenario.
    text, is_error = call_tool(client, "forecast_adjust_sales", {
        "forecast_id": "F001", "customer_type": ["Distributor"], "price_multiplier": 0.97})
    assert is_error and "customer_type" in text and "customer_types" in text and "Valid arguments" in text
    assert db_rows(mgr, "SELECT COUNT(*) FROM sales WHERE unit_price != 100 AND unit_price != 50") == [(0,)]
    text, is_error = call_tool(client, "forecast_list_sales", {"forecast_id": "F001", "customer": "C1"})
    assert is_error and "unknown argument" in text and "customer_id" in text
    # a rejected call does not echo the arguments back
    text, is_error = call_tool(client, "forecast_upsert_sales", {"forecast_id": "F001", "rows": [{"customer_id": "SECRET-ROW"}] * 50, "bogus": 1})
    assert is_error and "SECRET-ROW" not in text


def test_adjust_sales_requires_a_filter_and_supports_customer_types(mcp_client):
    client, mgr = mcp_client
    _set_types(mgr)
    text, is_error = call_tool(client, "forecast_adjust_sales", {"forecast_id": "F001", "price_multiplier": 0.97})
    assert is_error and "No filter given" in text and "all_rows=true" in text
    assert db_rows(mgr, "SELECT unit_price FROM sales WHERE sale_id = 'S1'") == [(100,)]
    out = ok(client, "forecast_adjust_sales", {"forecast_id": "F001", "customer_types": ["distributor"], "price_multiplier": 0.5})
    assert out["matched_rows"] == 1  # only C2's S3
    assert db_rows(mgr, "SELECT unit_price FROM sales WHERE sale_id = 'S3'") == [(25,)]
    assert db_rows(mgr, "SELECT unit_price FROM sales WHERE sale_id = 'S1'") == [(100,)]
    text, is_error = call_tool(client, "forecast_adjust_sales", {"forecast_id": "F001", "customer_types": ["OEM"], "price_multiplier": 0.5})
    assert is_error and "Known customer_type values: Dealer, Distributor" in text
    out = ok(client, "forecast_adjust_sales", {"forecast_id": "F001", "all_rows": True, "quantity_multiplier": 2, "dry_run": True})
    assert out["matched_rows"] == 4


def test_bad_upsert_row_is_an_error_and_the_next_write_succeeds(mcp_client):
    """Regression for the audit's blocker: one bad row locked every later write."""
    import time
    client, mgr = mcp_client
    text, is_error = call_tool(client, "forecast_upsert_sales", {"forecast_id": "F001", "rows": [
        {"customer_id": "C1", "unit_id": "P1", "period": "2026-04", "quantity": 3, "unit_price": 100},
        {"customer_id": "C-TYPO", "unit_id": "P1", "period": "2026-04", "quantity": 3, "unit_price": 100},
    ]})
    assert is_error and "C-TYPO" in text and "nothing written" in text
    assert db_rows(mgr, "SELECT COUNT(*) FROM sales WHERE period = '2026-04'") == [(0,)]
    started = time.monotonic()
    ok(client, "forecast_update_scenario", {"forecast_id": "F001", "notes": "after a failed upsert"})
    ok(client, "forecast_upsert_sales", {"forecast_id": "F001", "rows": [
        {"customer_id": "C1", "unit_id": "P1", "period": "2026-04", "quantity": 3, "unit_price": 100}]})
    assert time.monotonic() - started < 5
    assert db_rows(mgr, "SELECT notes FROM forecast WHERE forecast_id = 'F001'") == [("after a failed upsert",)]
    # unknown scenario: refused before anything is sent
    text, is_error = call_tool(client, "forecast_upsert_sales", {"forecast_id": "F999", "rows": [
        {"customer_id": "C1", "unit_id": "P1", "period": "2026-04", "quantity": 3, "unit_price": 100}]})
    assert is_error and "F999" in text


def test_bulk_update_api_failure_releases_the_database(mcp_client):
    """The API side of the same blocker (crud_routes.bulk_update): a foreign-key
    failure must roll back and close its connection, so another connection can
    write at once."""
    client, mgr = mcp_client
    res = client.post("/forecast/bulk_update", json={"operation": "replace", "forecasts": [
        {"forecast_id": "F001", "customer_id": "C1", "unit_id": "P1", "period": "2026-04", "quantity": 1, "unit_price": 1, "total_revenue": 1},
        {"forecast_id": "F001", "customer_id": "C-TYPO", "unit_id": "P1", "period": "2026-04", "quantity": 1, "unit_price": 1, "total_revenue": 1},
    ]})
    assert res.status_code >= 400
    other = sqlite3.connect(mgr.database_path, timeout=1)
    try:
        other.execute("UPDATE forecast SET notes = 'writable' WHERE forecast_id = 'F002'")
        other.commit()
    finally:
        other.close()
    assert db_rows(mgr, "SELECT COUNT(*) FROM sales WHERE period = '2026-04'") == [(0,)]


def test_upsert_sales_validates_rows_and_resolves_missing_price(mcp_client):
    client, mgr = mcp_client
    base = {"customer_id": "C2", "unit_id": "P2", "period": "2026-05"}
    for row, needle in (({**base, "quantity": -5, "unit_price": 50}, "zero or more"),
                        ({**base, "period": "2026-Q2", "quantity": 5, "unit_price": 50}, "invalid period"),
                        ({**base, "period": "2026-13", "quantity": 5, "unit_price": 50}, "invalid period"),
                        ({**base, "quantity": 5, "price": 50}, "unknown field"),
                        ({**base, "quantity": 5, "unit_price": -1}, "cannot be negative")):
        text, is_error = call_tool(client, "forecast_upsert_sales", {"forecast_id": "F001", "rows": [row]})
        assert is_error and needle in text, (row, text)
    assert db_rows(mgr, "SELECT COUNT(*) FROM sales WHERE period = '2026-05'") == [(0,)]
    preview = ok(client, "forecast_upsert_sales", {"forecast_id": "F001", "dry_run": True, "rows": [{**base, "quantity": 5}]})
    assert preview["dry_run"] is True and preview["total_revenue"] == 250
    assert db_rows(mgr, "SELECT COUNT(*) FROM sales WHERE period = '2026-05'") == [(0,)]
    out = ok(client, "forecast_upsert_sales", {"forecast_id": "F001", "rows": [{**base, "quantity": 5}]})
    assert out["price_sources"] == {"base_price": 1} and out["inserted"] == 1
    assert db_rows(mgr, "SELECT quantity, unit_price, total_revenue FROM sales WHERE period = '2026-05'") == [(5, 50, 250)]


def test_import_sales_is_all_or_nothing_and_reconciles(mcp_client):
    client, mgr = mcp_client
    good = {"customer_id": "C2", "unit_id": "P2", "period": "Jun 2026", "quantity": 4, "unit_price": 55}
    count_june = "SELECT COUNT(*) FROM sales WHERE period = '2026-06'"
    for bad, needle in (({**good, "customer_id": "C1", "quantity": -3}, "negative"),
                        ({**good, "customer_id": "C1", "period": "2026-Q2"}, "quarter"),
                        ({**good, "customer_id": "C-NEW"}, "C-NEW does not exist")):
        text, is_error = call_tool(client, "forecast_import_sales", {"forecast_id": "F001", "rows": [good, bad]})
        assert is_error and needle in text and "nothing written" in text, text
        assert db_rows(mgr, count_june) == [(0,)]
    preview = ok(client, "forecast_import_sales", {"forecast_id": "F001", "dry_run": True,
                                                    "rows": [good, {**good, "customer_id": "C1", "quantity": 6}]})
    assert preview["status"] == "dry_run" and preview["total_quantity"] == 10 and preview["total_revenue"] == 550
    assert db_rows(mgr, count_june) == [(0,)]
    partial = ok(client, "forecast_import_sales", {"forecast_id": "F001", "allow_partial": True,
                                                    "rows": [good, {**good, "customer_id": "C1", "quantity": -3}]})
    assert partial["status"] == "partial" and partial["error_count"] == 1 and partial["errors"][0]["row"] == 2
    assert partial["imported"] == 1 and db_rows(mgr, count_june) == [(1,)]
    created = ok(client, "forecast_import_sales", {"forecast_id": "F001", "auto_create": True, "rows": [
        {"customer_id": "C-NEW", "customer_name": "New Distributor LLC", "customer_type": "Distributor",
         "unit_id": "P2", "period": "2026-07", "quantity": 2}]})
    assert created["created_customers"] == ["C-NEW"] and created["price_sources"] == {"base_price": 1}
    assert db_rows(mgr, "SELECT customer_name, customer_type FROM customers WHERE customer_id = 'C-NEW'") == [
        ("New Distributor LLC", "Distributor")]


def test_import_sales_replace_mode_removes_stale_lines_in_the_files_months(mcp_client):
    client, mgr = mcp_client
    # F001 has Feb 2026: C1/P1 and C2/P2. A revised February without C2/P2 replaces it; March is untouched.
    out = ok(client, "forecast_import_sales", {"forecast_id": "F001", "mode": "replace", "rows": [
        {"customer_id": "C1", "unit_id": "P1", "period": "2026-02", "quantity": 25, "unit_price": 100}]})
    assert out["deleted"] == 1 and out["status"] == "imported"
    assert db_rows(mgr, "SELECT customer_id, unit_id, quantity FROM sales WHERE forecast_id = 'F001' "
                        "AND period = '2026-02'") == [("C1", "P1", 25)]
    assert db_rows(mgr, "SELECT COUNT(*) FROM sales WHERE forecast_id = 'F001' AND period = '2026-03'") == [(1,)]
    text, is_error = call_tool(client, "forecast_import_sales", {"forecast_id": "F001", "mode": "replace",
                                                                 "allow_partial": True, "rows": [{"customer_id": "C1"}]})
    assert is_error and "allow_partial" in text


def test_import_sales_reads_a_file_from_the_data_folder(mcp_client):
    client, mgr = mcp_client
    with open(os.path.join(mgr.data_dir, "sales_upload.csv"), "w", newline="") as fh:
        fh.write("Customer,SKU,Month,Qty,Price\nC1,P1,2026-08,3,101\nC2,P2,2026-08,2,\n")
    out = ok(client, "forecast_import_sales", {"forecast_id": "F001", "file_path": "sales_upload.csv"})
    assert out["imported"] == 2 and out["total_revenue"] == 403 and out["source"]["row_count"] == 2
    assert db_rows(mgr, "SELECT unit_id, unit_price FROM sales WHERE period = '2026-08' ORDER BY unit_id") == [("P1", 101), ("P2", 50)]


def test_list_sales_defaults_are_compact_and_totals_cover_everything(mcp_client):
    client, mgr = mcp_client
    n = _seed_500_rows(mgr)
    text, is_error, _ = raw_call(client, "forecast_list_sales", {"forecast_id": "F003"})
    assert not is_error
    out = json.loads(text)
    assert out["returned"] == 50 and out["total_count"] == n == 504 and out["has_more"] and out["next_offset"] == 50
    assert set(out["columns"]) == {"sale_id", "period", "customer_id", "unit_id", "quantity", "unit_price", "gross_sales",
                                   "total_sales_deductions", "net_sales", "product_cogs", "contribution_margin"}
    assert len(out["rows"]) == 50 and len(out["rows"][0]) == len(out["columns"])
    assert out["totals"]["rows"] == 504
    expected = db_rows(mgr, "SELECT ROUND(SUM(quantity * unit_price), 2) FROM sales WHERE forecast_id = 'F003'")[0][0]
    assert out["totals"]["gross_sales"] == pytest.approx(expected, abs=0.05)
    assert len(text) < 10_000, len(text)  # was ~190 KB for 200 rows before
    stmt = ok(client, "forecast_financial_statements", {"forecast_ids": ["F003"], "start_period": "2027-01",
                                                        "end_period": "2027-12", "sections": ["income_statement"]})
    assert out["totals"]["net_sales"] == pytest.approx(stmt["income_statement"]["totals"]["revenue"], abs=1)
    only_totals = ok(client, "forecast_list_sales", {"forecast_id": "F003", "limit": 0, "customer_type": "dealer"})
    assert only_totals["rows"] == [] and only_totals["totals"]["rows"] == 3 * 6 * 12
    everything = ok(client, "forecast_list_sales", {"forecast_id": "F003", "limit": 1, "fields": ["all"]})
    assert {"customer_name", "unit_type", "materials", "labor_hours"} <= set(everything["columns"])
    text, is_error = call_tool(client, "forecast_list_sales", {"forecast_id": "F003", "fields": ["revenue"]})
    assert is_error and "Unknown fields: revenue" in text
    empty = ok(client, "forecast_list_sales", {"forecast_id": "F002", "start_period": "2027-01", "end_period": "2027-02"})
    assert empty["total_count"] == 0


def test_response_sizes_on_a_500_row_forecast(mcp_client):
    client, mgr = mcp_client
    _seed_500_rows(mgr)
    window = {"forecast_ids": ["F003"], "start_period": "2027-01", "end_period": "2027-12"}
    sizes = {}
    for label, name, args in (
        ("statements_12m_all", "forecast_financial_statements", window),
        ("statements_12m_is", "forecast_financial_statements", {**window, "sections": ["income_statement"]}),
        ("statements_36m_default", "forecast_financial_statements", {**window, "start_period": "2026-01", "end_period": "2028-12"}),
        ("overview", "forecast_get_overview", {}),
        ("revenue_by_customer_unit", "forecast_revenue_summary", {"forecast_id": "F003", "group_by": "customer_unit"}),
        ("machines", "forecast_machine_utilization", {"forecast_id": "F003"}),
        ("query_table_sales", "forecast_query_table", {"table": "sales"}),
    ):
        text, is_error, _ = raw_call(client, name, args)
        assert not is_error, (label, text)
        sizes[label] = len(text)
    assert sizes["statements_12m_all"] < 30_000, sizes
    assert sizes["statements_12m_is"] < 6_000, sizes
    assert sizes["statements_36m_default"] < 15_000, sizes
    assert sizes["overview"] < 6_000, sizes
    assert sizes["revenue_by_customer_unit"] < 20_000, sizes
    assert sizes["machines"] < 5_000, sizes
    assert sizes["query_table_sales"] < 12_000, sizes


def test_oversized_result_becomes_an_actionable_error(mcp_client, monkeypatch):
    import mcp_server.core as core
    client, _ = mcp_client
    monkeypatch.setattr(core, "MAX_RESPONSE_CHARS", 300)
    text, is_error = call_tool(client, "forecast_list_tables")
    assert is_error and "response budget" in text and "limit" in text


def test_statements_unknown_scenario_detail_sections_and_long_window_default(mcp_client):
    client, _ = mcp_client
    text, is_error = call_tool(client, "forecast_financial_statements", {
        "forecast_ids": ["F999"], "start_period": "2026-01", "end_period": "2026-03"})
    assert is_error and "Unknown scenario" in text and "F999" in text
    detail = ok(client, "forecast_financial_statements", {
        "forecast_ids": ["F001"], "start_period": "2026-01", "end_period": "2026-03",
        "sections": ["detail.revenue_by_product", "detail.sales_deductions"]})
    assert set(detail["detail"]) == {"revenue_by_product", "sales_deductions"}
    assert "income_statement" not in detail and detail["income_statement_totals"]["revenue"] == 3700
    text, is_error = call_tool(client, "forecast_financial_statements", {
        "forecast_ids": ["F001"], "start_period": "2026-01", "end_period": "2026-03", "sections": ["detail.nope"]})
    assert is_error and "revenue_by_product" in text
    long = ok(client, "forecast_financial_statements", {"forecast_ids": ["F001"], "start_period": "2025-01", "end_period": "2026-12"})
    assert long["months"] == 24 and "note" in long
    assert "income_statement" in long and "balance_sheet" not in long and "detail" not in long
    assert long["cash_flow_totals"]["closing_cash"] is not None and long["balance_sheet_closing"] is not None
    assert len(long["income_statement"]["by_period"]["rows"]) == 24
    assert long["income_statement"]["by_period"]["columns"][0] == "period"
    rows_layout = ok(client, "forecast_financial_statements", {"forecast_ids": ["F001"], "start_period": "2026-01",
                                                               "end_period": "2026-02", "layout": "records"})
    assert rows_layout["income_statement"]["by_period"][1]["period"] == "2026-02"
    short = ok(client, "forecast_financial_statements", {"forecast_ids": ["F001"], "start_period": "2026-01", "end_period": "2026-12"})
    assert {"income_statement", "cash_flow", "balance_sheet", "detail"} <= set(short)


def test_update_assumptions_accepts_excise_payable_days(mcp_client):
    client, _ = mcp_client
    out = ok(client, "forecast_update_assumptions", {"forecast_id": "F001", "updates": {"excise_payable_days": 45}})
    assert out["assumptions"]["excise_payable_days"] == 45 and out["assumptions"]["opening_cash"] == 5000
    out = ok(client, "forecast_update_assumptions", {"forecast_id": "F001", "updates": {"dso_days": 40}})
    assert out["assumptions"]["excise_payable_days"] == 45  # untouched fields keep their value


def test_overview_reports_readiness_per_scenario(mcp_client):
    client, _ = mcp_client
    overview = ok(client, "forecast_get_overview")
    master = overview["master_data"]
    assert master["boms"] == 1 and master["routings"] == 1 and master["machines"] == 1 and master["price_rules"] == 0
    f1 = overview["scenarios"][0]
    assert f1["sales_window"] == "2026-01..2026-03" and f1["sales_rows"] == 4
    assert f1["financials"]["gross_sales"] == 3700 and f1["financials"]["net_sales"] == 3700
    assert f1["price_rules"] == 0 and f1["deduction_rules"] == 0
    assert f1["cost_warning_products"] == 1 and f1["cost_warning_examples"] == ["P2"]
    assert f1["products_sold"] == 2 and f1["customers_sold"] == 2
    assert any("incomplete BOM" in issue for issue in f1["issues"])
    f2 = overview["scenarios"][1]
    assert f2["sales_window"] == "2026-03..2026-03" and any("assumptions" in issue for issue in f2["issues"])
    light = ok(client, "forecast_get_overview", {"include_financials": False})
    assert "financials" not in light["scenarios"][0]


def test_bom_and_routing_keys_are_never_partial(mcp_client):
    client, mgr = mcp_client
    # A BOM id without version and line used to edit / delete every line of the BOM.
    for tool, args in (("forecast_update_record", {"table": "bom", "record_id": "BOM1", "updates": {"unit_price": 99}}),
                       ("forecast_delete_record", {"table": "bom", "record_id": "BOM1"}),
                       ("forecast_update_record", {"table": "bom", "record_id": "BOM1-1.0", "updates": {"unit_price": 99}})):
        text, is_error = call_tool(client, tool, args)
        assert is_error and "not a full bom key" in text, text
    assert db_rows(mgr, "SELECT bom_line, unit_price FROM bom ORDER BY bom_line") == [(1, 10), (2, 5)]
    out = ok(client, "forecast_update_record", {"table": "bom", "key": {"bom_id": "BOM1", "version": "1.0", "bom_line": 2},
                                                "updates": {"unit_price": 7}})
    assert out["derived"] == {"material_cost": 7}
    assert db_rows(mgr, "SELECT unit_price, material_cost FROM bom WHERE bom_line = 2") == [(7, 7)]
    assert db_rows(mgr, "SELECT unit_price FROM bom WHERE bom_line = 1") == [(10,)]
    text, is_error = call_tool(client, "forecast_update_record", {"table": "customers", "record_id": "C-NOPE", "updates": {"region": "X"}})
    assert is_error and "No customers row" in text
    # Routing ids with '-': the change is either applied or reported as NOT applied, never a silent no-op.
    ok(client, "forecast_create_record", {"table": "router_definitions", "data": {"router_id": "RT-X1", "router_name": "Hyphen", "version": "1.0"}})
    ok(client, "forecast_create_record", {"table": "router_operations", "data": {
        "router_id": "RT-X1", "sequence": 10, "machine_id": "M1", "machine_minutes": 5, "labor_minutes": 35, "labor_type_id": "L1"}})
    text, is_error = call_tool(client, "forecast_update_record", {"table": "router_operations",
                                                                  "key": {"router_id": "RT-X1", "sequence": 10},
                                                                  "updates": {"labor_minutes": 36}})
    stored = db_rows(mgr, "SELECT labor_minutes FROM router_operations WHERE router_id = 'RT-X1'")[0][0]
    if is_error:
        assert "NOT applied" in text and stored == 35
    else:
        assert stored == 36
    text, is_error = call_tool(client, "forecast_update_record", {"table": "router_operations", "record_id": "RT-X1-ten",
                                                                  "updates": {"labor_minutes": 36}})
    assert is_error and "whole number" in text


def test_create_record_requires_keys_and_points_to_dedicated_tools(mcp_client):
    client, mgr = mcp_client
    text, is_error = call_tool(client, "forecast_create_record", {"table": "machines", "data": {"machine_name": "No id", "machine_rate": 10}})
    assert is_error and "machine_id" in text
    assert db_rows(mgr, "SELECT COUNT(*) FROM machines WHERE machine_id IS NULL") == [(0,)]
    text, is_error = call_tool(client, "forecast_create_record", {"table": "sales", "data": {"sale_id": "X", "quantity": 1}})
    assert is_error and "forecast_upsert_sales" in text
    text, is_error = call_tool(client, "forecast_create_record", {"table": "customers", "data": {"customer_id": "C7", "customer_name": "X", "colour": "red"}})
    assert is_error and "colour" in text
    out = ok(client, "forecast_create_record", {"table": "bom", "data": {"bom_id": "BOM1", "version": "1.0", "bom_line": 3,
                                                                     "material_description": "Screw", "qty": 4, "unit_price": 0.25}})
    assert out["derived"] == {"material_cost": 1}
    assert db_rows(mgr, "SELECT material_cost FROM bom WHERE bom_line = 3") == [(1,)]


def test_customer_and_product_imports_change_only_given_fields(mcp_client):
    client, mgr = mcp_client
    out = ok(client, "forecast_import_products", {"merge_strategy": "update", "products": [
        {"unit_id": "P1", "unit_name": "Widget v2", "base_price": 120},
        {"unit_id": "P9", "unit_name": "Versioned", "bom_id": "BOM1", "bom_version": "2", "router_id": "R1", "router_version": 1}]})
    assert out["created"] == 1 and out["updated"] == 1 and out["created_ids"] == ["P9"]
    assert db_rows(mgr, "SELECT unit_name, base_price, bom_id, bom_version, router_id FROM units WHERE unit_id = 'P1'") == [
        ("Widget v2", 120, "BOM1", "1.0", "R1")]
    assert db_rows(mgr, "SELECT bom_version, router_version FROM units WHERE unit_id = 'P9'") == [("2.0", "1.0")]
    ok(client, "forecast_update_record", {"table": "customers", "record_id": "C1", "updates": {"customer_type": "Dealer", "region": "West"}})
    ok(client, "forecast_import_customers", {"merge_strategy": "update", "customers": [{"customer_id": "C1", "customer_name": "Acme Inc"}]})
    assert db_rows(mgr, "SELECT customer_name, customer_type, region FROM customers WHERE customer_id = 'C1'") == [("Acme Inc", "Dealer", "West")]
    new = ok(client, "forecast_import_customers", {"customers": [{"customer_name": "Initech", "customer_type": "Distributor"}]})
    assert new["created_ids"] == ["CUST-001"]
    text, is_error = call_tool(client, "forecast_import_customers", {"merge_strategy": "create_new", "customers": [{"customer_name": "X"}]})
    assert is_error and "create_new" in text
    text, is_error = call_tool(client, "forecast_import_customers", {"customers": [{"customer_name": "Y", "segment_code": "Z"}]})
    assert is_error and "segment_code" in text
    text, is_error = call_tool(client, "forecast_import_customers", {"customers": [{"customer_name": "Good"}, {"region": "West"}]})
    assert is_error and "nothing written" in text
    assert db_rows(mgr, "SELECT COUNT(*) FROM customers WHERE customer_name = 'Good'") == [(0,)]


def test_salary_allocations_and_withholding_semantics(mcp_client):
    client, mgr = mcp_client
    tools = {t["name"]: t for t in rpc(client, "tools/list").json()["result"]["tools"]}
    rate_help = tools["forecast_create_employee"]["inputSchema"]["properties"]["hourly_rate"]["description"]
    assert "ANNUAL salary" in rate_help and "1,000" in rate_help
    assert "PERCENT" in tools["forecast_create_employee"]["inputSchema"]["properties"]["allocations"]["description"]
    assert "WITHHOLDING" in tools["forecast_get_payroll_config"]["description"]
    assert "withholding" in tools["forecast_update_payroll_config"]["inputSchema"]["properties"]["federal_tax_rate"]["description"]
    created = ok(client, "forecast_create_employee", {
        "employee_name": "Plant Manager", "department": "Ops", "weekly_hours": 40, "hourly_rate": 85000, "rate_type": "salary",
        "labor_type": "Manager", "start_date": "2026-01-01", "forecast_id": "F001",
        "allocations": {"Manufacturing": 0.7, "Admin": 0.3}})
    assert created["notes"] == ["allocations were given as fractions and were converted to percent"]
    stored = json.loads(db_rows(mgr, "SELECT allocations FROM payroll WHERE employee_id = ?", (created["employee_id"],))[0][0])
    assert stored == {"Manufacturing": 70, "Admin": 30}
    forecast = ok(client, "forecast_payroll_forecast", {"forecast_id": "F001", "start_period": "2026-01", "end_period": "2026-01"})
    assert forecast["forecast"][0]["gross_pay"] == pytest.approx(85000 / 12, abs=0.01)
    assert forecast["forecast"][0]["by_business_unit"]["Manufacturing"] == pytest.approx(85000 / 12 * 0.7, abs=0.01)
    text, is_error = call_tool(client, "forecast_create_employee", {
        "employee_name": "Typo", "department": "Ops", "weekly_hours": 40, "hourly_rate": 85000,
        "labor_type": "Operator", "start_date": "2026-01-01"})
    assert is_error and "rate_type='salary'" in text


def test_costing_tools_take_a_window_and_trim_monthly_arrays(mcp_client):
    client, _ = mcp_client
    default = ok(client, "forecast_machine_utilization", {"forecast_id": "F001", "start_period": "2026-02", "end_period": "2026-02"})
    assert '"monthly"' not in json.dumps(default) and default.get("start_period") == "2026-02"
    full = ok(client, "forecast_machine_utilization", {"forecast_id": "F001", "include_monthly": True})
    assert "monthly" in json.dumps(full)
    tools = {t["name"]: t for t in rpc(client, "tools/list").json()["result"]["tools"]}
    assert "peak_utilization_percent" in tools["forecast_machine_utilization"]["description"]
    assert "LIST price" in tools["forecast_cost_breakdown"]["description"]
    summary = ok(client, "forecast_cost_breakdown", {"forecast_id": "F001"})
    first = summary["cost_breakdown"][0]
    assert "bom_items" not in first and "bom_line_count" in first
    lines = ok(client, "forecast_cost_breakdown", {"forecast_id": "F001", "unit_id": "P1"})
    assert lines["cost_breakdown"][0].get("bom_items")
    bom = ok(client, "forecast_list_bom", {"bom_id": "BOM1", "limit": 1})
    assert bom["count"] == 2 and len(bom["lines"]) == 1 and bom["lines"][0]["record_id"] == "BOM1-1.0-1"
    assert bom["material_cost_total"] == 25 and bom["lines_truncated"] is True


def test_revenue_summary_limits_groups_and_data_quality_never_crashes(mcp_client):
    client, _ = mcp_client
    out = ok(client, "forecast_revenue_summary", {"forecast_id": "F001", "group_by": "customer", "limit": 1})
    assert out["group_count"] == 2 and len(out["groups"]["rows"]) == 1 and out["groups_truncated"] is True
    assert "customer_id" in out["groups"]["columns"]
    tools = {t["name"]: t for t in rpc(client, "tools/list").json()["result"]["tools"]}
    assert "net sales" in tools["forecast_revenue_summary"]["description"]
    quality = ok(client, "forecast_data_quality")
    assert set(quality) >= {"quality", "validation"}


def test_host_headers_and_proxy_config(mcp_client):
    client, _ = mcp_client
    for host in ("localhost", "127.0.0.1", "localhost:3000", "127.0.0.1:8000"):
        assert rpc(client, "tools/list", headers={"host": host}).status_code == 200, host
    for host in ("host.docker.internal:8000", "192.168.1.20:8000", "evil.example"):
        assert rpc(client, "tools/list", headers={"host": host}).status_code == 421, host
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
    nginx = open(os.path.join(root, "frontend", "nginx.conf")).read()
    assert "proxy_set_header Host $host;" not in nginx
    assert nginx.count("proxy_set_header Host $http_host;") == 3
    assert "location = /mcp {" in nginx and "proxy_pass $api/mcp;" in nginx
    # The upstream is resolved per request (resolver + variable) so nginx
    # starts even when the API container is not up yet.
    assert "resolver 127.0.0.11" in nginx and "set $api http://fastapi:8000;" in nginx
    assert "proxy_pass http://fastapi" not in nginx
    compose = open(os.path.join(root, "docker-compose.yml")).read()
    assert "host.docker.internal:*" in compose and "MCP_ALLOWED_ORIGINS" in compose
    mcp_json = json.load(open(os.path.join(root, ".mcp.json")))
    assert mcp_json["mcpServers"]["forecast"]["url"] == "http://localhost:8000/mcp"


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


def test_start_clean_requires_confirm_and_snapshots_first(mcp_client):
    client, mgr = mcp_client
    text, is_error = call_tool(client, "forecast_start_clean", {"confirm": False})
    assert is_error and "confirm=true" in text
    assert db_rows(mgr, "SELECT COUNT(*) FROM sales")[0][0] > 0
    out = ok(client, "forecast_start_clean", {"confirm": True, "scenario_name": "2027 Budget"})
    assert out["backup"] and out["backup"]["filename"]
    assert db_rows(mgr, "SELECT COUNT(*) FROM sales") == [(0,)]
    assert db_rows(mgr, "SELECT name FROM forecast") == [("2027 Budget",)]
