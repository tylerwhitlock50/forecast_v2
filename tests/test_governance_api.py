"""
Governance (review follow-up W3): approve & lock scenario baselines, unlock
with a reason, drift against the approved totals, the change history
(audit_log) and the read-only legacy data checks.

Reviewer evidence reproduced here: a named base and branches existed but
nothing could freeze an approved budget (every scenario row stayed
editable), no input change was recorded anywhere, and the standard compose
file published both ports on every interface.

Drives the real FastAPI app (every router, middleware, MCP mounted) against
an isolated database.
"""
import glob
import json
import os
import re
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

BROWSER = {"user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"}
LOCKED = "is approved and locked: branch it to make changes, or unlock it with a reason."


def _seed(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("INSERT INTO forecast (forecast_id, name, description, notes, is_base) VALUES ('F001', '2027 Budget', 'plan', 'n', 1)")
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F002', 'Upside', 0)")
    c.execute("INSERT INTO customers (customer_id, customer_name, customer_type) VALUES ('C1', 'Dealer One', 'Dealer')")
    c.execute("""INSERT INTO units (unit_id, unit_name, base_price, bom_id, bom_version, router_id, router_version)
                 VALUES ('P1', 'Rifle', 1000, 'B1', '1.0', 'R1', '1.0')""")
    c.execute("INSERT INTO units (unit_id, unit_name, base_price) VALUES ('P2', 'Scope', 200)")
    c.execute("INSERT INTO bom_definitions (bom_id, bom_name, version) VALUES ('B1', 'Rifle BOM', '1.0')")
    c.execute("INSERT INTO bom_definitions (bom_id, bom_name, version) VALUES ('B2', 'Empty BOM', '1.0')")
    c.execute("""INSERT INTO bom (bom_id, version, bom_line, material_description, qty, unit, unit_price, material_cost)
                 VALUES ('B1', '1.0', 1, 'Barrel steel', 1, 'ea', 300, 300)""")
    c.execute("INSERT INTO router_definitions (router_id, router_name, version) VALUES ('R1', 'Rifle route', '1.0')")
    c.execute("INSERT INTO machines (machine_id, machine_name, machine_rate) VALUES ('M1', 'Lathe', 60)")
    c.execute("INSERT INTO labor_rates (rate_id, rate_name, rate_amount, rate_type) VALUES ('L1', 'Machinist', 40, 'hourly')")
    c.execute("""INSERT INTO router_operations (router_id, sequence, machine_id, machine_minutes, labor_minutes, labor_type_id)
                 VALUES ('R1', 1, 'M1', 30, 30, 'L1')""")
    for i, month in enumerate(("2027-01", "2027-02", "2027-03"), start=1):
        c.execute("INSERT INTO sales VALUES (?, 'C1', 'P1', ?, 10, 1000, 10000, 'F001')", (f"S{i}", month))
        c.execute("INSERT INTO sales VALUES (?, 'C1', 'P1', ?, 12, 1000, 12000, 'F002')", (f"U{i}", month))
    c.execute("""INSERT INTO financial_assumptions (forecast_id, opening_period, opening_cash, dso_days, dio_days, dpo_days, income_tax_rate)
                 VALUES ('F001', '2026-12', 50000, 30, 30, 30, 0.21)""")
    c.execute("""INSERT INTO payroll (employee_id, employee_name, department, weekly_hours, hourly_rate, rate_type, start_date,
                                      benefits_eligible, forecast_id) VALUES ('E1', 'Pat', 'Ops', 40, 30, 'hourly', '2027-01-01', 0, 'F001')""")
    c.execute("""INSERT INTO payroll_config (config_id, federal_tax_rate, state_tax_rate, social_security_rate, medicare_rate,
                 unemployment_rate, benefits_rate, workers_comp_rate, pay_frequency)
                 VALUES ('default', 0, 0, 0, 0, 0, 0, 0, 'monthly')""")
    conn.commit()
    conn.close()


def _patch_db_manager(mgr):
    originals = {}
    for name, module in list(sys.modules.items()):
        if module is None:
            continue
        if name in ("db.database", "app.db.database") or name.startswith(("api.", "app.api.", "utils.")):
            if hasattr(module, "db_manager"):
                originals[name] = module.db_manager
                module.db_manager = mgr
    return originals


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


def q(mgr, sql, params=()):
    conn = sqlite3.connect(mgr.database_path, timeout=30)
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def approve(client, fid="F001", who="Dana CFO", note="Board approved 2027 budget"):
    res = client.post(f"/forecast/scenario/{fid}/approve", json={"approved_by": who, "note": note})
    assert res.status_code == 200, res.text
    return res.json()["data"]


def scenario(client, fid):
    return next(s for s in client.get("/forecast/scenarios").json()["data"]["scenarios"] if s["forecast_id"] == fid)


# ---------------------------------------------------------------------------
# Approve & lock
# ---------------------------------------------------------------------------

def test_approve_stores_totals_snapshot_and_workbook_and_locks(env):
    client, mgr = env
    before = client.get("/reporting/statements", params={"forecast_ids": "F001", "start_period": "2027-01",
                                                          "end_period": "2027-03"}).json()["data"]
    data = approve(client)
    assert data["status"] == "approved" and data["locked"] is True
    assert data["approved_by"] == "Dana CFO" and data["approval_note"] == "Board approved 2027 budget"
    approval = data["approval"]
    assert approval["action"] == "approve" and approval["actor"] == "Dana CFO"
    assert (approval["start_period"], approval["end_period"]) == ("2027-01", "2027-03")
    totals = approval["totals"]
    assert set(totals) == {"gross_sales", "net_sales", "total_cogs", "gross_profit", "operating_income",
                           "net_income", "closing_cash"}
    income = before["income_statement"]["totals"]
    assert totals["gross_sales"] == pytest.approx(30000)
    assert totals["net_sales"] == pytest.approx(income["revenue"], abs=0.01)
    assert totals["gross_profit"] == pytest.approx(income["gross_profit"], abs=0.01)
    assert totals["closing_cash"] == pytest.approx(before["cash_flow"]["totals"]["closing_cash"], abs=0.01)

    # Snapshot in saved_databases (approved_<id>_<YYYYMMDD_HHMMSS>.db) holding the approved, locked state.
    assert re.fullmatch(r"approved_F001_\d{8}_\d{6}\.db", approval["snapshot_filename"])
    snap = os.path.join(mgr.snapshot_dir, approval["snapshot_filename"])
    assert os.path.exists(snap) and approval["snapshot_available"] is True
    sconn = sqlite3.connect(snap)
    assert sconn.execute("SELECT status, locked FROM forecast WHERE forecast_id = 'F001'").fetchone() == ("approved", 1)
    assert sconn.execute("SELECT COUNT(*) FROM scenario_approvals").fetchone()[0] == 1
    sconn.close()
    # Workbook in <data_dir>/exports/approved/.
    book = os.path.join(mgr.data_dir, "exports", "approved", approval["workbook_filename"])
    assert os.path.exists(book) and approval["workbook_available"] is True
    res = client.get(f"/forecast/scenario/F001/approvals/{approval['approval_id']}/workbook")
    assert res.status_code == 200 and res.content[:2] == b"PK"

    stored = json.loads(q(mgr, "SELECT totals_json FROM scenario_approvals")[0][0])
    assert stored["totals"] == totals and stored["start_period"] == "2027-01"
    listed = scenario(client, "F001")
    assert listed["status"] == "approved" and listed["locked"] is True and listed["approved_by"] == "Dana CFO"
    assert listed["drift"]["changed"] is False and listed["drift"]["items"] == []
    other = scenario(client, "F002")
    assert other["status"] == "draft" and other["locked"] is False and other["drift"] is None


def test_approve_validations(env):
    client, _ = env
    res = client.post("/forecast/scenario/F001/approve", json={"note": "x"})
    assert res.status_code == 422 and "approved_by" in res.json()["detail"]
    assert client.post("/forecast/scenario/NOPE/approve", json={"approved_by": "a"}).status_code == 404
    res = client.post("/forecast/scenario", json={"name": "Empty"})
    fid = res.json()["data"]["forecast_id"]
    res = client.post(f"/forecast/scenario/{fid}/approve", json={"approved_by": "a"})
    assert res.status_code == 422 and "no monthly sales" in res.json()["detail"]
    approve(client)
    res = client.post("/forecast/scenario/F001/approve", json={"approved_by": "b"})
    assert res.status_code == 409 and "already approved and locked" in res.json()["detail"]


def test_a_locked_scenario_refuses_every_change_to_its_rows_with_409(env):
    """The reviewer's gap: an approved budget could still be edited by any screen or tool."""
    client, mgr = env
    approve(client)
    sales_before = q(mgr, "SELECT sale_id, quantity, unit_price FROM sales WHERE forecast_id = 'F001' ORDER BY sale_id")

    attempts = [
        ("POST", "/forecast/smart_import_sales", {"forecast_id": "F001", "sales": [
            {"customer_id": "C1", "unit_id": "P1", "period": "2027-04", "quantity": 5, "unit_price": 1000}]}),
        ("POST", "/payroll/employees", {"employee_name": "New hire", "department": "Ops", "weekly_hours": 40,
                                        "hourly_rate": 25, "rate_type": "hourly", "labor_type": "Machinist", "start_date": "2027-02-01",
                                        "forecast_id": "F001"}),
        ("DELETE", "/payroll/employees/E1", None),
        ("PUT", "/reporting/assumptions?forecast_id=F001", {"opening_cash": 1, "opening_period": "2026-12"}),
        ("POST", "/reporting/capex", {"forecast_id": "F001", "asset_name": "Mill", "amount": 5000,
                                      "purchase_period": "2027-02", "useful_life_months": 60}),
        ("POST", "/pricing/prices", {"forecast_id": "F001", "unit_id": "P1", "customer_type": "Dealer",
                                     "unit_price": 900}),
        ("DELETE", "/forecast/scenario/F001", None),
        ("PUT", "/forecast/scenario/F001", {"name": "Renamed"}),
        ("PUT", "/forecast/scenario/F001", {"notes": "changed"}),
    ]
    for method, path, body in attempts:
        res = client.request(method, path, json=body)
        assert res.status_code == 409, (method, path, res.status_code, res.text)
        detail = res.json()["detail"]
        assert detail.startswith("Scenario '2027 Budget' is approved and locked"), (path, detail)
        assert "SCENARIO_LOCKED" not in detail
    assert q(mgr, "SELECT sale_id, quantity, unit_price FROM sales WHERE forecast_id = 'F001' ORDER BY sale_id") == sales_before
    assert q(mgr, "SELECT COUNT(*) FROM payroll WHERE forecast_id = 'F001'") == [(1,)]
    assert q(mgr, "SELECT name, notes FROM forecast WHERE forecast_id = 'F001'") == [("2027 Budget", "n")]

    # Saving the same values (an edit dialog's untouched fields) and moving the base flag are fine.
    res = client.put("/forecast/scenario/F002", json={"is_base": True})
    assert res.status_code == 200
    res = client.put("/forecast/scenario/F001", json={"name": "2027 Budget", "notes": "n", "is_base": True})
    assert res.status_code == 200, res.text
    assert scenario(client, "F001")["is_base"] is True

    # Other scenarios and company-wide rows stay editable.
    res = client.post("/payroll/employees", json={"employee_name": "Shared", "department": "Admin", "weekly_hours": 40,
                                                   "hourly_rate": 50000, "rate_type": "salary", "labor_type": "Admin",
                                                   "start_date": "2027-01-01"})
    assert res.status_code == 200, res.text
    res = client.post("/forecast/smart_import_sales", json={"forecast_id": "F002", "sales": [
        {"customer_id": "C1", "unit_id": "P1", "period": "2027-04", "quantity": 5, "unit_price": 1000}]})
    assert res.status_code == 200, res.text


def test_branching_a_locked_scenario_gives_an_editable_draft(env):
    client, mgr = env
    approve(client)
    res = client.post("/forecast/scenario/F001/duplicate", json={"name": "2027 Budget rev 2"})
    assert res.status_code == 200, res.text
    copy = res.json()["data"]
    assert copy["status"] == "draft" and copy["locked"] is False and copy["drift"] is None
    assert copy["copied"]["sales"] == 3 and copy["copied"]["employees"] == 1
    res = client.post("/forecast/smart_import_sales", json={"forecast_id": copy["forecast_id"], "sales": [
        {"customer_id": "C1", "unit_id": "P1", "period": "2027-04", "quantity": 5, "unit_price": 1000}]})
    assert res.status_code == 200, res.text


def test_branch_copies_the_labor_class(env):
    client, mgr = env
    conn = sqlite3.connect(mgr.database_path)
    conn.execute("UPDATE payroll SET labor_class = 'direct' WHERE employee_id = 'E1'")
    conn.commit()
    conn.close()
    copy = client.post("/forecast/scenario/F001/duplicate", json={"name": "Copy"}).json()["data"]
    assert q(mgr, "SELECT labor_class FROM payroll WHERE forecast_id = ?", (copy["forecast_id"],)) == [("direct",)]


def test_unlock_requires_a_reason_and_is_recorded(env):
    client, mgr = env
    res = client.post("/forecast/scenario/F001/unlock", json={"actor": "Dana", "reason": "x"})
    assert res.status_code == 409 and "not locked" in res.json()["detail"]
    approve(client)
    res = client.post("/forecast/scenario/F001/unlock", json={"actor": "Dana"})
    assert res.status_code == 422 and "reason is required" in res.json()["detail"]
    res = client.post("/forecast/scenario/F001/unlock", json={"actor": "Dana", "reason": "   "})
    assert res.status_code == 422
    assert scenario(client, "F001")["locked"] is True

    res = client.post("/forecast/scenario/F001/unlock", json={"actor": "Dana", "reason": "Q2 reforecast"})
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["status"] == "draft" and data["locked"] is False and data["drift"] is None
    assert data["unlock"]["action"] == "unlock" and data["unlock"]["note"] == "Q2 reforecast"
    assert "Q2 reforecast" in res.json()["message"]

    history = client.get("/forecast/scenario/F001/approvals").json()["data"]["approvals"]
    assert [h["action"] for h in history] == ["unlock", "approve"]
    assert history[0]["actor"] == "Dana" and history[0]["note"] == "Q2 reforecast"
    assert history[1]["totals"]["gross_sales"] == pytest.approx(30000)
    assert client.get("/forecast/scenario/NOPE/approvals").status_code == 404

    # Editable again; a second approval works and the history keeps all three.
    res = client.put("/forecast/scenario/F001", json={"notes": "after unlock"})
    assert res.status_code == 200
    approve(client, who="Dana", note="v2")
    assert [h["action"] for h in client.get("/forecast/scenario/F001/approvals").json()["data"]["approvals"]] == [
        "approve", "unlock", "approve"]


def test_failed_snapshot_undoes_the_approval(env, monkeypatch):
    client, mgr = env

    def broken(path):
        raise OSError("disk full")

    monkeypatch.setattr(mgr, "backup_to", broken)
    res = client.post("/forecast/scenario/F001/approve", json={"approved_by": "Dana"})
    assert res.status_code == 500 and "NOT approved" in res.json()["detail"]
    assert q(mgr, "SELECT status, locked FROM forecast WHERE forecast_id = 'F001'") == [("draft", 0)]
    assert q(mgr, "SELECT COUNT(*) FROM scenario_approvals") == [(0,)]
    assert glob.glob(os.path.join(mgr.data_dir, "exports", "approved", "*.xlsx")) == []


def test_drift_shows_shared_inputs_moving_an_approved_scenario(env):
    """A locked scenario's numbers still move when company-wide inputs (a BOM cost) change."""
    client, mgr = env
    approval = approve(client)["approval"]
    # Steel goes up: a company-wide BOM change, allowed while F001 is locked.
    conn = sqlite3.connect(mgr.database_path)
    conn.execute("UPDATE bom SET unit_price = 400, material_cost = 400 WHERE bom_id = 'B1'")
    conn.commit()
    conn.close()
    drift = scenario(client, "F001")["drift"]
    assert drift["changed"] is True
    lines = {item["line"]: item for item in drift["items"]}
    assert "gross_sales" not in lines and "net_sales" not in lines
    assert lines["total_cogs"]["delta"] == pytest.approx(3000)          # 30 rifles x $100
    assert lines["gross_profit"]["approved"] == pytest.approx(approval["totals"]["gross_profit"])
    assert lines["gross_profit"]["delta"] == pytest.approx(-3000)
    assert drift["start_period"] == "2027-01" and drift["end_period"] == "2027-03"
    single = client.get("/forecast/scenario/F001").json()["data"]
    assert single["drift"]["changed"] is True


# ---------------------------------------------------------------------------
# Change history
# ---------------------------------------------------------------------------

def log(api, **params):
    res = api.get("/audit/log", params=params)
    assert res.status_code == 200, res.text
    return res.json()["data"]


def test_every_write_is_recorded_with_client_actor_scenario_and_summary(env):
    client, mgr = env
    assert log(client)["total_count"] == 0
    client.get("/forecast/scenarios")                      # reads are not recorded
    res = client.post("/forecast/scenario", json={"name": "Downside"}, headers=BROWSER)
    new_id = res.json()["data"]["forecast_id"]
    client.put(f"/forecast/scenario/{new_id}", json={"notes": "worse"},
               headers={"x-forecast-user": "pat@example.com", **BROWSER})
    client.post("/forecast/smart_import_sales", json={"forecast_id": "F002", "sales": [
        {"customer_id": "C1", "unit_id": "P1", "period": f"2027-{m:02d}", "quantity": 5, "unit_price": 1000}
        for m in range(4, 10)]})
    res = client.post("/forecast/scenario", json={"name": "Downside"})   # refused: name taken
    assert res.status_code == 409

    data = log(client)
    assert data["total_count"] == 4
    entries = data["entries"]                                            # newest first
    refused, imported, renamed, created = entries
    assert created["method"] == "POST" and created["path"] == "/forecast/scenario" and created["status"] == 200
    assert created["client"] == "web" and created["forecast_id"] == new_id
    assert created["summary"] == f"Forecast scenario {new_id} created successfully"
    assert json.loads(created["body_excerpt"]) == {"name": "Downside"}
    assert created["created_at"].endswith("Z") and created["duration_ms"] >= 0
    assert renamed["actor"] == "pat@example.com" and renamed["forecast_id"] == new_id
    assert imported["client"] == "api" and imported["forecast_id"] == "F002"
    assert imported["summary"].startswith("Imported 6 sales records")
    assert '"sales": "[6 items]"' in imported["body_excerpt"]           # rows are not copied into the history
    assert refused["status"] == 409 and refused["summary"].startswith("Refused (409): A scenario named 'Downside'")

    # Filters
    assert [e["forecast_id"] for e in log(client, forecast_id="F002")["entries"]] == ["F002"]
    assert {e["client"] for e in log(client, client="web")["entries"]} == {"web"}
    assert log(client, path_contains="smart_import")["total_count"] == 1
    assert log(client, status="refused")["total_count"] == 1
    assert log(client, since="2000-01-01")["total_count"] == 4
    assert log(client, since="2999-01-01")["total_count"] == 0
    assert log(client, until="2000-01-01")["total_count"] == 0
    page = log(client, limit=2, offset=1)
    assert page["returned"] == 2 and page["has_more"] is True and page["entries"][0]["log_id"] == imported["log_id"]
    assert set(data["clients"]) == {"web", "api"}
    assert client.get("/audit/log", params={"since": "yesterday"}).status_code == 422


def test_previews_and_dry_runs_are_not_history(env):
    client, mgr = env
    rows = [{"customer_id": "C1", "unit_id": "P1", "period": "2027-04", "quantity": 5, "unit_price": 1000}]
    assert client.post("/forecast/smart_import_sales",
                       json={"forecast_id": "F002", "sales": rows, "dry_run": True}).status_code == 200
    assert client.post("/import/records", json={"table": "customers", "dry_run": True,
                                                "rows": [{"customer_id": "C7", "customer_name": "New"}]}).status_code == 200
    client.post("/reporting/actuals", params={"dry_run": "true"},
                json={"rows": [{"period": "2027-01", "line_item": "revenue", "amount": 1}]})
    client.post("/pricing/deductions/simulate", json={"customer_id": "C1", "unit_id": "P1", "unit_price": 1000})
    assert log(client)["total_count"] == 0
    assert q(mgr, "SELECT COUNT(*) FROM sales WHERE forecast_id = 'F002'")[0][0] == 3   # nothing was written

    client.post("/forecast/smart_import_sales", json={"forecast_id": "F002", "sales": rows})
    assert log(client)["total_count"] == 1                                              # the real import is


def test_uploads_are_recorded_without_file_contents(env):
    client, mgr = env
    secret = "customer_id,customer_name\nC9,TOP SECRET CUSTOMER\n"
    client.post("/database/load_table", params={"table_name": "customers", "mode": "append"},
                files={"csv_file": ("customers.csv", secret.encode(), "text/csv")})
    entry = log(client)["entries"][0]
    assert entry["path"] == "/database/load_table" and "customers.csv" in entry["body_excerpt"]
    assert "TOP SECRET" not in entry["body_excerpt"]
    assert entry["query"] == "table_name=customers&mode=append"


def test_approvals_and_unlocks_appear_in_the_history_with_the_actor(env):
    client, _ = env
    approve(client)
    client.post("/forecast/scenario/F001/unlock", json={"actor": "Dana", "reason": "reforecast"})
    entries = log(client, forecast_id="F001")["entries"]
    assert [e["path"] for e in entries] == ["/forecast/scenario/F001/unlock", "/forecast/scenario/F001/approve"]
    assert entries[1]["actor"] == "Dana CFO" and entries[1]["summary"].startswith("Approved and locked scenario")
    assert entries[0]["actor"] == "Dana" and "reforecast" in entries[0]["summary"]


def test_a_history_failure_never_breaks_the_request(env, monkeypatch):
    client, mgr = env
    import services.governance as governance

    def boom(_entry):
        raise RuntimeError("history table gone")

    monkeypatch.setattr(governance, "record_audit", boom)
    import api.governance_routes as routes
    monkeypatch.setattr(routes, "record_audit", boom)
    res = client.post("/forecast/scenario", json={"name": "Still works"})
    assert res.status_code == 200, res.text
    monkeypatch.undo()
    # And with the table really gone the API keeps answering.
    conn = sqlite3.connect(mgr.database_path)
    conn.execute("DROP TABLE audit_log")
    conn.commit()
    conn.close()
    res = client.post("/forecast/scenario", json={"name": "Still works 2"})
    assert res.status_code == 200, res.text


def test_start_clean_keeps_the_history_and_verify_ignores_it(env):
    client, mgr = env
    client.post("/forecast/scenario", json={"name": "Before reset"})
    res = client.post("/database/start-clean", json={"confirm": True, "snapshot_first": False})
    assert res.status_code == 200, res.text
    verify = res.json()["data"]["verify"]
    assert verify["all_empty"] is True and verify["kept_tables"]["audit_log"] >= 1
    assert "audit_log" not in verify["non_empty_tables"]
    body = client.post("/database/verify-empty").json()
    assert body["all_empty"] is True and body["history_rows"] >= 2
    assert next(t for t in body["tables"] if t["table_name"] == "audit_log")["kept"] is True
    info = client.get("/database/info").json()
    assert info["total_rows"] == 0 and info["history_rows"] >= 2
    paths = [e["path"] for e in log(client)["entries"]]
    assert paths[:2] == ["/database/verify-empty", "/database/start-clean"] and "/forecast/scenario" in paths


def test_mcp_tool_calls_are_recorded_as_mcp_but_the_transport_is_not(env):
    client, mgr = env
    headers = {"host": "localhost:8000", "accept": "application/json, text/event-stream",
               "content-type": "application/json"}
    res = client.post("/mcp", headers=headers, json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
        "name": "forecast_create_scenario", "arguments": {"name": "From Claude"}}})
    assert res.status_code == 200 and not res.json()["result"].get("isError"), res.text
    entries = log(client)["entries"]
    assert len(entries) == 1
    assert entries[0]["client"] == "mcp" and entries[0]["path"] == "/forecast/scenario"
    assert all(not e["path"].startswith("/mcp") for e in entries)


# ---------------------------------------------------------------------------
# 409 mapping (exception handler + response rewrite) on a bare app
# ---------------------------------------------------------------------------

def test_lock_errors_from_any_route_shape_become_a_plain_409(env):
    _client, mgr = env
    from fastapi import FastAPI, HTTPException
    from api.governance_routes import install_governance

    app = FastAPI()
    install_governance(app)

    @app.post("/raw")
    async def raw():
        raise sqlite3.IntegrityError("SCENARIO_LOCKED")

    @app.post("/wrapped")
    async def wrapped():
        raise HTTPException(status_code=500, detail="Error creating employee: SCENARIO_LOCKED")

    @app.post("/other")
    async def other():
        raise HTTPException(status_code=400, detail="bad input")

    @app.post("/unhandled")
    async def unhandled():
        raise RuntimeError("wrapped: SCENARIO_LOCKED")

    approve(_client)
    with TestClient(app) as bare:
        for path in ("/raw", "/wrapped", "/unhandled"):
            res = bare.post(path, json={"forecast_id": "F001"})
            assert res.status_code == 409, (path, res.text)
            body = res.json()
            assert body["detail"] == f"Scenario '2027 Budget' {LOCKED}"
            assert body["code"] == "SCENARIO_LOCKED" and body["forecast_id"] == "F001"
        assert bare.post("/other").status_code == 400


# ---------------------------------------------------------------------------
# Legacy data checks
# ---------------------------------------------------------------------------

def test_legacy_checks_report_issues_without_changing_anything(env):
    client, mgr = env
    conn = sqlite3.connect(mgr.database_path)
    conn.execute("INSERT INTO sales VALUES ('Q1', 'C1', 'P1', 'Q1-2027', 1, 1000, 1000, 'F002')")
    conn.execute("INSERT INTO sales VALUES ('D1', 'C1', 'P2', '2027-01-15', 1, 200, 200, 'F002')")
    conn.execute("""INSERT INTO financial_assumptions (forecast_id, opening_cash) VALUES ('F002', 100)""")
    conn.commit()
    conn.close()
    before = {t: q(mgr, f'SELECT COUNT(*) FROM "{t}"')[0][0] for t in ("sales", "financial_assumptions", "payroll")}
    res = client.get("/audit/legacy-checks")
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    issues = {i["code"]: i for i in data["issues"]}
    assert issues["sales_non_monthly_periods"]["severity"] == "error"
    assert "F002: 'Q1-2027' x 1" in issues["sales_non_monthly_periods"]["examples"]
    assert issues["sales_dated_periods"]["count"] == 1
    assert issues["assumptions_without_opening_period"]["examples"] == ["Upside (F002)"]
    assert issues["bom_versions_without_lines"]["examples"] == ["B2 v1.0 (Empty BOM)"]
    assert any(e.startswith("P2 (Scope): no BOM, no routing") for e in issues["sold_products_without_cost"]["examples"])
    assert issues["employees_without_labor_class"]["examples"] == ["Pat (F001)"]
    for issue in data["issues"]:
        assert issue["action"] and issue["detail"] and issue["severity"] in ("error", "warning", "info")
    severities = [i["severity"] for i in data["issues"]]
    assert severities == sorted(severities, key=["error", "warning", "info"].index)
    assert data["counts"]["error"] == 1
    loan_check = [s for s in data["skipped"] if s["code"] == "loan_schedules_drifted"]
    loan_issue = issues.get("loan_schedules_drifted")
    assert loan_check or loan_issue is None          # either audited or explicitly skipped, never silently
    after = {t: q(mgr, f'SELECT COUNT(*) FROM "{t}"')[0][0] for t in before}
    assert after == before
    assert log(client)["total_count"] == 0           # a GET: nothing recorded


# ---------------------------------------------------------------------------
# Exposure defaults
# ---------------------------------------------------------------------------

def test_compose_publishes_ports_on_localhost_by_default():
    with open(os.path.join(_REPO, "docker-compose.yml")) as handle:
        text = handle.read()
    ports = re.findall(r'^\s*-\s*"([^"]+)"\s*$', text, flags=re.M)
    published = [p for p in ports if p.count(":") >= 2 or p.endswith(":8000") or p.endswith(":3000")]
    assert '"${FORECAST_BIND:-127.0.0.1}:8000:8000"' in text
    assert '"${FORECAST_BIND:-127.0.0.1}:3000:3000"' in text
    assert all(p.startswith("${FORECAST_BIND:-127.0.0.1}:") for p in published), published
    assert "FORECAST_BIND=0.0.0.0" in text


def test_legacy_checks_flag_drifted_loan_schedules(env):
    """A schedule saved by the old 30.44-day stepping (Jan 31 / Mar 2 / Apr 2) is reported, never repaired."""
    client, mgr = env
    conn = sqlite3.connect(mgr.database_path)
    conn.execute("""INSERT INTO loans (loan_id, loan_name, lender, loan_type, principal_amount, interest_rate,
                    loan_term_months, start_date, payment_type, current_balance, next_payment_date,
                    monthly_payment_amount)
                    VALUES ('LEGACY', 'Old term loan', 'Bank', 'term_loan', 300, 0, 3, '2026-01-01', 'amortizing', 300,
                            '2026-01-31', 100)""")
    for n, (day, balance) in enumerate((("2026-01-31", 200), ("2026-03-02", 100), ("2026-04-02", 0)), start=1):
        conn.execute("""INSERT INTO loan_payments (payment_id, loan_id, payment_number, payment_date, payment_amount,
                        principal_payment, interest_payment, remaining_balance) VALUES (?, 'LEGACY', ?, ?, 100, 100, 0, ?)""",
                     (f"LP{n}", n, day, balance))
    conn.commit()
    conn.close()
    before = q(mgr, "SELECT payment_number, payment_date FROM loan_payments ORDER BY payment_number")
    data = client.get("/audit/legacy-checks").json()["data"]
    issues = {i["code"]: i for i in data["issues"]}
    try:
        from api.loan_routes import schedule_audit  # noqa: F401  (W1 helper)
    except ImportError:
        assert [s["code"] for s in data["skipped"]] == ["loan_schedules_drifted"]
        return
    issue = issues["loan_schedules_drifted"]
    assert issue["count"] == 1 and issue["link"] == "/loans"
    assert issue["examples"][0].startswith("Old term loan (LEGACY)")
    assert "Review & repair" in issue["action"]
    assert data["skipped"] == []
    assert q(mgr, "SELECT payment_number, payment_date FROM loan_payments ORDER BY payment_number") == before


def test_restoring_a_snapshot_keeps_the_change_history(env):
    client, mgr = env
    client.post("/forecast/scenario", json={"name": "Before save"})
    assert client.post("/database/save", json={"name": "rehearsal"}).status_code == 200
    client.post("/forecast/scenario", json={"name": "After save"})
    res = client.post("/database/load", json={"filename": "rehearsal.db"})
    assert res.status_code == 200, res.text
    assert [r[0] for r in q(mgr, "SELECT name FROM forecast WHERE name LIKE '%save'")] == ["Before save"]
    paths = [e["path"] for e in log(client)["entries"]]
    assert paths == ["/database/load", "/forecast/scenario", "/database/save", "/forecast/scenario"]
    res = client.post("/database/revert-to-last-save")
    assert res.status_code == 200, res.text
    assert log(client)["total_count"] == 5          # nothing duplicated, the revert added
