"""
MCP actuals tools (review follow-up W2): imports from a file or rows with
dry run / allow_partial / combine_duplicates / control_total, the batch
history with undo, and month-end close / reopen. Driven over JSON-RPC
against the real app and an isolated database.
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


def _patch_db_manager(mgr):
    originals = {}
    for name, module in list(sys.modules.items()):
        if module is None:
            continue
        if name in ("db.database", "app.db.database") or name.startswith(("api.", "app.api.")):
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
    conn = sqlite3.connect(db_path)
    conn.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F001', 'Base', 1)")
    conn.commit()
    conn.close()
    from app.main import app as fastapi_app
    originals = _patch_db_manager(mgr)
    try:
        with TestClient(fastapi_app) as client:
            yield client, mgr, tmp
    finally:
        for name, original in originals.items():
            sys.modules[name].db_manager = original
        mgr.close_all_connections()
        shutil.rmtree(tmp, ignore_errors=True)


def call_tool(client, name, arguments=None):
    res = client.post("/mcp", headers=HEADERS, follow_redirects=False, json={
        "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments or {}}})
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


def count(mgr, sql="SELECT COUNT(*) FROM actuals"):
    conn = mgr.get_connection()
    try:
        return conn.execute(sql).fetchone()[0]
    finally:
        mgr.close_connection(conn)


def write(folder, name, text):
    path = os.path.join(folder, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    return name


def test_import_from_file_dry_run_then_write_with_control_total(mcp_env):
    client, mgr, data_dir = mcp_env
    name = write(data_dir, "imports/april.csv",
                 "April TB mapped to statement lines\n\nMonth,Account,Actual,Memo\n"
                 "Apr 2026,Net Sales,\"12,500.00\",\nApr 2026,Payroll,4000,\n")
    dry = ok(client, "forecast_import_actuals", {"file_path": name, "dry_run": True, "control_total": 16500})
    assert dry["outcome"] == "imported" and dry["written"] is False and dry["inserted"] == 2
    assert dry["control_matches"] is True and dry["totals"]["grand_total"] == 16500
    assert dry["file"]["header_row"] == 3 and "Dry run" in dry["next"]
    assert count(mgr) == 0

    done = ok(client, "forecast_import_actuals", {"file_path": name, "control_total": 16500, "note": "April TB"})
    assert done["status"] == "ok" and done["written"] is True and done["batch_id"].startswith("ACT-")
    assert count(mgr) == 2
    assert count(mgr, "SELECT COUNT(*) FROM actuals_batches WHERE filename = 'april.csv' AND note = 'April TB'") == 1


def test_a_refused_write_reports_every_row_and_writes_nothing(mcp_env):
    client, mgr, data_dir = mcp_env
    name = write(data_dir, "bad.csv", "period,line_item,amount,reference_id\n2026-04,revenue,1000,\n"
                                      "2026-04,payroll,oops,\n2026-04,revenue,5,INV-1\n2026-04,revenue,6,INV-1\n")
    out = ok(client, "forecast_import_actuals", {"file_path": name})
    assert out["status"] == "rejected" and out["nothing_written"] is True and out["written"] is False
    rows = {e["row"] for e in out["errors"]}
    assert rows == {3, 4, 5}                       # spreadsheet rows: the bad amount and both duplicates
    assert out["duplicates"][0]["rows"] == [4, 5]
    assert "Nothing imported" in out["message"]
    assert count(mgr) == 0

    partial = ok(client, "forecast_import_actuals", {"file_path": name, "allow_partial": True})
    assert partial["status"] == "partial" and partial["inserted"] == 1 and partial["rejected"] == 3
    combined = ok(client, "forecast_import_actuals", {"file_path": name, "allow_partial": True,
                                                       "combine_duplicates": True})
    assert combined["inserted"] == 1 and combined["unchanged"] == 1 and combined["rejected"] == 1
    assert count(mgr, "SELECT amount FROM actuals WHERE reference_id = 'INV-1'") == 11

    mismatch = ok(client, "forecast_upsert_actuals", {"entries": [{"period": "2026-05", "line_item": "Net Sales",
                                                                   "amount": "$100"}], "control_total": 99})
    assert mismatch["status"] == "rejected" and "control total" in mismatch["message"]


def test_rows_upsert_batches_undo_and_close(mcp_env):
    client, mgr, _ = mcp_env
    first = ok(client, "forecast_upsert_actuals", {"entries": [
        {"period": "2026-04", "line_item": "revenue", "amount": 1000},
        {"period": "2026-04", "line_item": "payroll", "amount": 300}]})
    assert first["inserted"] == 2
    second = ok(client, "forecast_import_actuals", {"rows": [
        {"Month": "2026-04", "Line": "Payroll", "Actual": 320}]})
    assert second["updated"] == 1 and second["changed_rows"][0]["previous_amount"] == 300

    batches = ok(client, "forecast_list_actuals_batches")
    table = [dict(zip(batches["batches"]["columns"], r)) for r in batches["batches"]["rows"]]
    assert [b["batch_id"] for b in table] == [second["batch_id"], first["batch_id"]]

    preview = ok(client, "forecast_undo_actuals_batch", {"batch_id": first["batch_id"]})
    assert preview["dry_run"] is True and preview["rows_to_remove"] == 1 and count(mgr) == 2
    done = ok(client, "forecast_undo_actuals_batch", {"batch_id": first["batch_id"], "dry_run": False})
    assert done["removed"] == 1 and count(mgr) == 1

    closed = ok(client, "forecast_close_actuals_period", {"period": "2026-04", "closed_by": "Dana"})
    assert closed["status"] == "closed"
    periods = ok(client, "forecast_actuals_periods")
    assert periods["closed_periods"] == ["2026-04"]
    refused = ok(client, "forecast_upsert_actuals", {"entries": [{"period": "2026-04", "line_item": "payroll",
                                                                  "amount": 999}]})
    assert refused["status"] == "rejected" and refused["closed_periods"][0]["period"] == "2026-04"
    text, is_error = call_tool(client, "forecast_delete_actuals", {"period": "2026-04"})
    assert is_error and "closed" in text
    text, is_error = call_tool(client, "forecast_undo_actuals_batch", {"batch_id": second["batch_id"], "dry_run": False})
    assert is_error and "closed" in text

    text, is_error = call_tool(client, "forecast_reopen_actuals_period", {"period": "2026-04", "reason": ""})
    assert is_error
    reopened = ok(client, "forecast_reopen_actuals_period", {"period": "2026-04", "reason": "Accrual correction"})
    assert reopened["status"] == "open"
    assert ok(client, "forecast_upsert_actuals", {"entries": [{"period": "2026-04", "line_item": "payroll",
                                                               "amount": 999}]})["updated"] == 1


def test_file_errors_and_argument_checks(mcp_env):
    client, _, data_dir = mcp_env
    text, is_error = call_tool(client, "forecast_import_actuals", {})
    assert is_error and "rows" in text
    text, is_error = call_tool(client, "forecast_import_actuals", {"file_path": "../etc/passwd.csv"})
    assert is_error
    name = write(data_dir, "wide.csv", "Account,Jan 2026,Feb 2026\nNet Sales,1,2\n")
    text, is_error = call_tool(client, "forecast_import_actuals", {"file_path": name})
    assert is_error and "No period" in text
