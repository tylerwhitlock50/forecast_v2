"""
Governance through the MCP server (review follow-up W3): approve / unlock /
approval history / change history / legacy checks tools, scenario tools that
surface status and drift, the X-Forecast-Client: mcp header on the tools'
in-process REST calls, and the bulk adjusters (which write without a REST
call) recorded in the change history and refused plainly on a locked
scenario.
"""
import json
import os
import shutil
import sqlite3
import sys
import tempfile

import pytest
from fastapi.testclient import TestClient

_REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
_APP_DIR = os.path.join(_REPO, "app")
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from app.db.database import DatabaseManager  # noqa: E402
from tests.test_governance_api import _patch_db_manager, _seed  # noqa: E402

HEADERS = {"host": "localhost:8000", "accept": "application/json, text/event-stream",
           "content-type": "application/json"}


@pytest.fixture()
def env():
    tmp = tempfile.mkdtemp()
    db_path = os.path.join(tmp, "forecast.db")
    mgr = DatabaseManager(database_path=db_path, data_dir=tmp)
    mgr.initialize()
    _seed(db_path)
    from app.main import app as fastapi_app
    originals = _patch_db_manager(mgr)
    try:
        with TestClient(fastapi_app) as client:
            yield client, mgr
    finally:
        for name, original in originals.items():
            sys.modules[name].db_manager = original
        shutil.rmtree(tmp, ignore_errors=True)


def call_tool(client, name, arguments=None):
    res = client.post("/mcp", headers=HEADERS, json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                                     "params": {"name": name, "arguments": arguments or {}}})
    assert res.status_code == 200, res.text
    result = res.json()["result"]
    text = "".join(b.get("text", "") for b in result.get("content", []) if b.get("type") == "text")
    if result.get("isError"):
        return text, True
    return json.loads(text), False


def ok(client, name, arguments=None):
    payload, is_error = call_tool(client, name, arguments)
    assert not is_error, payload
    return payload


def rows(table):
    return [dict(zip(table["columns"], row)) for row in table["rows"]]


def test_tools_are_listed_with_the_right_hints(env):
    client, _ = env
    res = client.post("/mcp", headers=HEADERS, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}})
    tools = {t["name"]: t for t in res.json()["result"]["tools"]}
    for name in ("forecast_list_approvals", "forecast_audit_log", "forecast_legacy_checks"):
        assert tools[name]["annotations"]["readOnlyHint"] is True, name
    for name in ("forecast_approve_scenario", "forecast_unlock_scenario"):
        assert tools[name]["annotations"]["readOnlyHint"] is False, name
    assert "reason" in tools["forecast_unlock_scenario"]["inputSchema"]["required"]
    assert "approved_by" in tools["forecast_approve_scenario"]["inputSchema"]["required"]
    init = client.post("/mcp", headers=HEADERS, json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
        "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}})
    assert "Approved = locked: branch to change." in init.json()["result"]["instructions"]


def test_approve_unlock_and_history_through_mcp(env):
    client, mgr = env
    approved = ok(client, "forecast_approve_scenario", {"forecast_id": "F001", "approved_by": "Dana CFO",
                                                         "note": "Board approved"})
    assert approved["status"] == "approved" and approved["locked"] is True
    assert approved["approval"]["totals"]["gross_sales"] == 30000
    assert approved["approval"]["snapshot_filename"].startswith("approved_F001_")

    listed = {s["forecast_id"]: s for s in ok(client, "forecast_list_scenarios")["scenarios"]}
    assert listed["F001"]["status"] == "approved" and listed["F001"]["drift"]["changed"] is False
    overview = {s["forecast_id"]: s for s in ok(client, "forecast_get_overview", {"include_financials": False})["scenarios"]}
    assert overview["F001"]["locked"] is True and overview["F001"]["approved"]["by"] == "Dana CFO"
    assert overview["F002"]["status"] == "draft"

    # A REST write on the locked scenario: the tool error explains the lock.
    text, is_error = call_tool(client, "forecast_update_scenario", {"forecast_id": "F001", "name": "Changed"})
    assert is_error and "HTTP 409" in text and "is approved and locked" in text

    text, is_error = call_tool(client, "forecast_unlock_scenario", {"forecast_id": "F001"})
    assert is_error and "reason" in text
    unlocked = ok(client, "forecast_unlock_scenario", {"forecast_id": "F001", "reason": "Q2 reforecast",
                                                        "actor": "Dana"})
    assert unlocked["status"] == "draft" and unlocked["locked"] is False
    history = ok(client, "forecast_list_approvals", {"forecast_id": "F001"})["approvals"]
    assert [h["action"] for h in history] == ["unlock", "approve"]

    log = ok(client, "forecast_audit_log", {"forecast_id": "F001"})
    entries = rows(log["entries"])
    assert {e["client"] for e in entries} == {"mcp"}
    assert [e["path"] for e in entries] == ["/forecast/scenario/F001/unlock", "/forecast/scenario/F001",
                                             "/forecast/scenario/F001/approve"]
    assert entries[1]["status"] == 409
    assert "body_excerpt" not in log["entries"]["columns"]
    with_body = ok(client, "forecast_audit_log", {"forecast_id": "F001", "include_body": True, "limit": 1})
    assert "body_excerpt" in with_body["entries"]["columns"] and with_body["has_more"] is True


def test_bulk_adjuster_on_a_locked_scenario_is_refused_plainly_and_others_are_recorded(env):
    client, mgr = env
    ok(client, "forecast_approve_scenario", {"forecast_id": "F001", "approved_by": "Dana"})
    text, is_error = call_tool(client, "forecast_adjust_sales", {"forecast_id": "F001", "all_rows": True,
                                                                  "price_multiplier": 0.9})
    assert is_error
    assert "Scenario '2027 Budget' is approved and locked" in text and "forecast_branch_scenario" in text
    conn = sqlite3.connect(mgr.database_path)
    assert conn.execute("SELECT SUM(unit_price) FROM sales WHERE forecast_id = 'F001'").fetchone()[0] == 3000
    conn.close()

    # The adjusters write without a REST call: the history records the tool call itself.
    result = ok(client, "forecast_adjust_sales", {"forecast_id": "F002", "all_rows": True, "price_multiplier": 0.9})
    assert result["matched_rows"] == 3
    entries = rows(ok(client, "forecast_audit_log", {"path_contains": "forecast_adjust_sales"})["entries"])
    assert [(e["method"], e["status"], e["forecast_id"], e["client"]) for e in entries] == [
        ("TOOL", 200, "F002", "mcp"), ("TOOL", 409, "F001", "mcp")]
    assert entries[0]["summary"].startswith("Sales of F002: 3 row(s) changed, revenue -$")
    assert entries[1]["summary"] == "MCP tool forecast_adjust_sales refused (409)"
    # Read-only tools are never recorded.
    assert ok(client, "forecast_audit_log", {"path_contains": "forecast_list"})["total_count"] == 0


def test_legacy_checks_tool(env):
    client, _ = env
    data = ok(client, "forecast_legacy_checks")
    codes = {i["code"] for i in data["issues"]}
    assert {"bom_versions_without_lines", "employees_without_labor_class"} <= codes
    assert all(i["action"] and i["severity"] in ("error", "warning", "info") for i in data["issues"])
