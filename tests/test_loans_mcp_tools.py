"""
MCP loan tools for W1: update preview, schedule audit and repair (dry run
first), through the real app's /mcp endpoint against an isolated database.
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
COLS = ("payment_id, loan_id, payment_number, payment_date, payment_amount, principal_payment, interest_payment, "
        "remaining_balance, payment_status, actual_payment_date, actual_payment_amount, notes")


def _seed(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F001', 'Base', 1)")
    conn.execute("""INSERT INTO loans (loan_id, loan_name, lender, loan_type, principal_amount, interest_rate,
                    loan_term_months, start_date, payment_type, payment_frequency, is_active, current_balance,
                    next_payment_date, monthly_payment_amount)
                    VALUES ('LEGACY', 'Legacy term loan', 'Bank', 'term_loan', 300, 0, 3, '2026-01-01', 'amortizing',
                            'monthly', 1, 300, '2026-02-01', 100)""")
    for n, d, rem, status, adate, aamt, note in (
        (1, "2026-01-31", 200, "paid", "2026-02-02", 100, "Paid by ACH"),
        (2, "2026-03-02", 100, "scheduled", None, None, None),
        (3, "2026-04-02", 0, "scheduled", None, None, None),
    ):
        conn.execute(f"INSERT INTO loan_payments ({COLS}) VALUES (?, 'LEGACY', ?, ?, 100, 100, 0, ?, ?, ?, ?, ?)",
                     (f"LEG-{n}", n, d, rem, status, adate, aamt, note))
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
def mcp_env():
    tmp = tempfile.mkdtemp()
    db_path = os.path.join(tmp, "mcp.db")
    mgr = DatabaseManager(database_path=db_path, data_dir=tmp)
    mgr.initialize()
    _seed(db_path)
    from app.main import app as fastapi_app
    originals = _patch_db_manager(mgr)
    try:
        with TestClient(fastapi_app) as client:
            yield client, db_path
    finally:
        for name, original in originals.items():
            sys.modules[name].db_manager = original
        mgr.close_all_connections()
        shutil.rmtree(tmp, ignore_errors=True)


def tool(client, name, arguments=None):
    res = client.post("/mcp", headers=HEADERS, follow_redirects=False, json={
        "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments or {}}})
    assert res.status_code == 200, res.text
    result = res.json()["result"]
    text = "".join(b.get("text", "") for b in result.get("content", []) if b.get("type") == "text")
    assert not result.get("isError"), text
    return json.loads(text)


def rows(db_path):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(f"SELECT {COLS} FROM loan_payments WHERE loan_id = 'LEGACY' ORDER BY payment_number").fetchall()
    finally:
        conn.close()


def test_tools_are_registered_with_the_right_hints(mcp_env):
    client, _ = mcp_env
    res = client.post("/mcp", headers=HEADERS, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}})
    tools = {t["name"]: t for t in res.json()["result"]["tools"]}
    assert tools["forecast_loan_schedule_audit"]["annotations"]["readOnlyHint"] is True
    assert tools["forecast_repair_loan_schedule"]["annotations"]["readOnlyHint"] is False
    assert "preview" in tools["forecast_update_loan"]["inputSchema"]["properties"]
    assert tools["forecast_repair_loan_schedule"]["inputSchema"]["properties"]["dry_run"]["default"] is True


def test_update_preview_writes_nothing_and_unchanged_values_keep_history(mcp_env):
    client, db_path = mcp_env
    before = rows(db_path)
    out = tool(client, "forecast_update_loan", {"loan_id": "LEGACY", "updates": {"interest_rate": 6}, "preview": True})
    assert out["preview"] is True and out["schedule"]["regenerated"] is True
    assert out["schedule"]["kept_paid"] == 1 and out["kept_count"] == 1 and out["new_count"] == 2
    assert out["kept_rows"]["columns"][0] == "payment_id"
    assert out["after"]["total_interest"] > 0 and out["before"]["total_interest"] == 0
    assert rows(db_path) == before
    same = tool(client, "forecast_update_loan", {"loan_id": "LEGACY", "updates": {"interest_rate": 0.0}})
    assert same["schedule"]["regenerated"] is False and same["changed_fields"] == []
    assert rows(db_path) == before


def test_audit_then_repair_dry_run_first(mcp_env):
    client, db_path = mcp_env
    audit = tool(client, "forecast_loan_schedule_audit")
    assert audit["loans_with_issues"] == 1
    entry = audit["loans"][0]
    assert entry["loan_id"] == "LEGACY" and entry["proposed_action"] == "redate" and entry["drifted"] == 2
    before = rows(db_path)
    dry = tool(client, "forecast_repair_loan_schedule", {"loan_id": "LEGACY"})
    assert dry["dry_run"] is True and dry["schedule"]["redated"] == 2
    assert rows(db_path) == before
    done = tool(client, "forecast_repair_loan_schedule", {"loan_id": "LEGACY", "dry_run": False})
    assert done["dry_run"] is False and done["action"] == "redate"
    after = rows(db_path)
    assert after[0] == before[0] and [r[3] for r in after[1:]] == ["2026-03-01", "2026-04-01"]
    assert tool(client, "forecast_loan_schedule_audit")["loans_with_issues"] == 0


def test_long_preview_is_sampled_unless_include_rows(mcp_env):
    client, _ = mcp_env
    out = tool(client, "forecast_update_loan", {"loan_id": "LEGACY", "updates": {"loan_term_months": 120},
                                                "preview": True})
    assert out["new_count"] == 119 and len(out["new_rows"]["rows"]) == 6 and out["new_rows"]["omitted"] == 113
    full = tool(client, "forecast_update_loan", {"loan_id": "LEGACY", "updates": {"loan_term_months": 120},
                                                 "preview": True, "include_rows": True})
    assert len(full["new_rows"]["rows"]) == 119
