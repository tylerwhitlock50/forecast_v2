"""
Governance hardening (review round 12): the controls of an approved scenario
and the change history hold on every write path, not only on the dedicated
endpoints.

* LOCK-1 / REST-CRUD-GOV-BYPASS / HIST-1 / ACT-2: the generic writers
  (/forecast/create, /forecast/update, /forecast/delete/{table}/{id},
  /database/load_table) refuse the governance records (change history,
  approvals, actuals and their batches / periods) and the forecast columns
  locked / status / approved_*, naming the endpoint to use; SQLite triggers
  back the forecast rule up for any other writer.
* LOCK-2: moving an expense allocation INTO a locked scenario's expense is
  refused like any other change to it.
* HIST-2 / AUDIT-FORECAST-FILTER / UI-4: writes addressed by a row id, bulk
  bodies with the scenario inside each row and refused writes are recorded
  with the scenario they touched.
* HIST-3 / ADJUST-DRYRUN-LOCK / HIST-4: MCP dry runs are not history; an
  adjuster dry run on a locked scenario says the real run will be refused;
  a refused MCP write that only got as far as its preview is recorded.
* SNAP-2 / UI-3: only the app's own approval copies count as approval
  snapshots; reserved snapshot names are refused for user saves.
* UPDATE-SCENARIO-DRIFT-NULL: the scenario update / approve responses carry
  the same drift as GET.
* LAB-6: labor_class is validated on every bulk path and the legacy check
  lists invalid stored values.
"""
import os
import sqlite3
import time

import pytest

from tests.test_governance_api import BROWSER, approve, env, log, q  # noqa: F401  (env is a fixture)
from tests.test_governance_mcp import call_tool, ok, rows


def csv_upload(client, table, text, mode="append"):
    return client.post("/database/load_table", params={"table_name": table, "mode": mode},
                       files={"csv_file": (f"{table}.csv", text.encode(), "text/csv")})


def raw(mgr, sql, params=()):
    conn = sqlite3.connect(mgr.database_path, timeout=30)
    try:
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# LOCK-1 / REST-CRUD-GOV-BYPASS: the generic writers cannot unlock, rename or fake-approve
# ---------------------------------------------------------------------------

def test_generic_update_cannot_unlock_or_rename_a_locked_scenario(env):
    client, mgr = env
    approve(client)
    res = client.post("/forecast/update", json={"table": "forecast", "id": "F001",
                                                "updates": {"locked": 0, "status": "draft"}})
    assert res.status_code == 409, res.text
    assert "/forecast/scenario/F001/unlock" in res.json()["detail"]
    assert q(mgr, "SELECT status, locked FROM forecast WHERE forecast_id = 'F001'") == [("approved", 1)]
    # The lock still holds, and no unlock was recorded behind the history's back.
    assert client.post("/forecast/update", json={"table": "sales", "id": "S1",
                                                 "updates": {"quantity": 999}}).status_code == 409
    assert q(mgr, "SELECT action FROM scenario_approvals WHERE forecast_id = 'F001'") == [("approve",)]

    for updates in ({"name": "Renamed via CRUD"}, {"description": "edited"}, {"notes": "edited"}):
        res = client.post("/forecast/update", json={"table": "forecast", "id": "F001", "updates": updates})
        assert res.status_code == 409, (updates, res.text)
        assert "is approved and locked" in res.json()["detail"]
    assert q(mgr, "SELECT name, description, notes FROM forecast WHERE forecast_id = 'F001'") == [
        ("2027 Budget", "plan", "n")]
    for updates in ({"approved_by": "Someone else"}, {"approval_note": "rewritten"}, {"approved_at": "2020-01-01"}):
        assert client.post("/forecast/update", json={"table": "forecast", "id": "F001",
                                                     "updates": updates}).status_code == 409, updates

    # Sending the stored values (a form that posts the whole row) changes nothing and is fine.
    res = client.post("/forecast/update", json={"table": "forecast", "id": "F001",
                                                "updates": {"name": "2027 Budget", "status": "approved", "locked": 1}})
    assert res.status_code == 200, res.text
    # The approve / unlock endpoints keep working exactly as before.
    res = client.post("/forecast/scenario/F001/unlock", json={"actor": "Dana", "reason": "reforecast"})
    assert res.status_code == 200, res.text
    assert q(mgr, "SELECT status, locked FROM forecast WHERE forecast_id = 'F001'") == [("draft", 0)]
    approve(client, note="again")
    assert q(mgr, "SELECT status, locked FROM forecast WHERE forecast_id = 'F001'") == [("approved", 1)]


def test_generic_writers_cannot_fake_an_approval(env):
    client, mgr = env
    res = client.post("/forecast/update", json={"table": "forecast", "id": "F002",
                                                "updates": {"status": "approved", "approved_by": "Dana CFO"}})
    assert res.status_code == 409, res.text
    assert "/forecast/scenario/F002/approve" in res.json()["detail"]
    res = client.post("/forecast/create", json={"table": "forecast", "data": {
        "forecast_id": "F009", "name": "Fake", "status": "approved", "locked": 1, "approved_by": "Nobody"}})
    assert res.status_code == 409, res.text
    assert q(mgr, "SELECT COUNT(*) FROM forecast WHERE forecast_id = 'F009'") == [(0,)]
    # A draft scenario row (and an unlocked scenario's own fields) can still be written generically.
    res = client.post("/forecast/create", json={"table": "forecast", "data": {
        "forecast_id": "F010", "name": "Plain", "status": "draft", "locked": 0}})
    assert res.status_code == 200, res.text
    res = client.post("/forecast/update", json={"table": "forecast", "id": "F002", "updates": {"name": "Upside v2"}})
    assert res.status_code == 200, res.text
    assert q(mgr, "SELECT name, status, locked FROM forecast WHERE forecast_id = 'F002'") == [("Upside v2", "draft", 0)]


def test_load_table_cannot_unlock_or_approve_a_scenario(env):
    client, mgr = env
    approve(client)
    res = csv_upload(client, "forecast", "forecast_id,locked,status\nF001,0,draft\n", mode="upsert")
    assert res.status_code == 409, res.text
    assert "unlock" in res.json()["detail"]
    assert q(mgr, "SELECT status, locked FROM forecast WHERE forecast_id = 'F001'") == [("approved", 1)]
    res = csv_upload(client, "forecast", "forecast_id,name\nF001,Renamed\n", mode="upsert")
    assert res.status_code == 409, res.text
    assert q(mgr, "SELECT name FROM forecast WHERE forecast_id = 'F001'") == [("2027 Budget",)]
    res = csv_upload(client, "forecast", "forecast_id,name,status,locked\nF011,Fake,approved,1\n")
    assert res.status_code == 409, res.text
    assert q(mgr, "SELECT COUNT(*) FROM forecast WHERE forecast_id = 'F011'") == [(0,)]
    # Re-uploading a scenario list as exported (values unchanged) still works.
    res = csv_upload(client, "forecast", "forecast_id,name,status,locked\nF001,2027 Budget,approved,1\n"
                                         "F002,Upside renamed,draft,0\n", mode="upsert")
    assert res.status_code == 200, res.text
    assert q(mgr, "SELECT forecast_id, name, status, locked FROM forecast ORDER BY forecast_id") == [
        ("F001", "2027 Budget", "approved", 1), ("F002", "Upside renamed", "draft", 0)]


def test_triggers_back_the_rule_up_for_any_other_writer(env):
    client, mgr = env
    approve(client)
    for sql in ("UPDATE forecast SET locked = 0 WHERE forecast_id = 'F001'",
                "UPDATE forecast SET status = 'draft' WHERE forecast_id = 'F001'",
                "UPDATE forecast SET approved_by = 'x' WHERE forecast_id = 'F001'",
                "UPDATE forecast SET status = 'approved', locked = 1 WHERE forecast_id = 'F002'",
                "INSERT INTO forecast (forecast_id, name, status, locked) VALUES ('F012', 'Fake', 'approved', 1)"):
        with pytest.raises(sqlite3.IntegrityError, match="SCENARIO_GOVERNED"):
            raw(mgr, sql)
    for sql in ("UPDATE forecast SET name = 'x' WHERE forecast_id = 'F001'",
                "UPDATE forecast SET description = 'x' WHERE forecast_id = 'F001'"):
        with pytest.raises(sqlite3.IntegrityError, match="SCENARIO_LOCKED"):
            raw(mgr, sql)
    # What stays allowed: the base flag of a locked scenario, and anything on a draft's own fields.
    raw(mgr, "UPDATE forecast SET is_base = 0 WHERE forecast_id = 'F001'")
    raw(mgr, "UPDATE forecast SET is_base = 1 WHERE forecast_id = 'F001'")
    raw(mgr, "UPDATE forecast SET name = 'Upside 2', notes = 'x' WHERE forecast_id = 'F002'")
    # Marking a locked scenario as the base through the scenario endpoint still works.
    assert client.put("/forecast/scenario/F002", json={"is_base": True}).status_code == 200
    assert client.put("/forecast/scenario/F001", json={"is_base": True}).status_code == 200
    # The guard is never left behind by the approve / unlock paths.
    assert q(mgr, "SELECT COUNT(*) FROM governance_guard") == [(0,)]


def test_an_older_database_gets_the_guard_and_a_stale_guard_row_is_cleared(env):
    client, mgr = env
    conn = sqlite3.connect(mgr.database_path)
    for trigger in ("trg_guard_forecast_governance", "trg_guard_forecast_insert", "trg_lock_forecast_update"):
        conn.execute(f"DROP TRIGGER {trigger}")
    conn.execute("DROP TABLE governance_guard")          # a database from before this version
    conn.commit()
    conn.close()
    mgr.initialize_schema()
    approve(client)
    with pytest.raises(sqlite3.IntegrityError, match="SCENARIO_GOVERNED"):
        raw(mgr, "UPDATE forecast SET locked = 0 WHERE forecast_id = 'F001'")
    # A guard row can never outlive a restart (it only ever exists inside an approve / unlock transaction).
    raw(mgr, "INSERT INTO governance_guard (active) VALUES (1)")
    mgr.initialize_schema()
    assert q(mgr, "SELECT COUNT(*) FROM governance_guard") == [(0,)]
    with pytest.raises(sqlite3.IntegrityError, match="SCENARIO_GOVERNED"):
        raw(mgr, "UPDATE forecast SET locked = 0 WHERE forecast_id = 'F001'")


def test_start_clean_snapshots_and_restores_still_work_with_a_locked_scenario(env):
    client, mgr = env
    approve(client)
    assert client.post("/database/save", json={"name": "with approval"}).status_code == 200
    assert client.post("/forecast/scenario/F001/unlock",
                       json={"actor": "Dana", "reason": "test"}).status_code == 200
    res = client.post("/database/load", json={"filename": "with approval.db"})
    assert res.status_code == 200, res.text
    assert q(mgr, "SELECT status, locked FROM forecast WHERE forecast_id = 'F001'") == [("approved", 1)]
    res = client.post("/database/start-clean", json={"confirm": True, "snapshot_first": False})
    assert res.status_code == 200, res.text
    assert q(mgr, "SELECT COUNT(*) FROM forecast") == [(0,)]
    assert q(mgr, "SELECT COUNT(*) FROM governance_guard") == [(0,)]


# ---------------------------------------------------------------------------
# HIST-1 / ACT-2: governance records are written only by their own endpoints
# ---------------------------------------------------------------------------

def test_history_and_approval_records_cannot_be_edited_deleted_or_forged(env):
    client, mgr = env
    apr = approve(client)["approval"]["approval_id"]
    client.post("/forecast/scenario", json={"name": "Downside"})
    history = q(mgr, "SELECT * FROM audit_log ORDER BY log_id")
    approvals = q(mgr, "SELECT * FROM scenario_approvals")
    assert history

    refused = [
        client.post("/forecast/update", json={"table": "scenario_approvals", "id": apr,
                                              "updates": {"actor": "Someone Else", "note": "tampered"}}),
        client.post("/forecast/update", json={"table": "scenario_approvals", "id": apr,
                                              "updates": {"totals_json": "{}"}}),
        client.delete(f"/forecast/delete/scenario_approvals/{apr}"),
        client.post("/forecast/create", json={"table": "scenario_approvals", "data": {
            "approval_id": "APR-FAKE", "forecast_id": "F002", "action": "approve", "actor": "Mallory"}}),
        client.delete("/forecast/delete/audit_log/1"),
        client.post("/forecast/update", json={"table": "audit_log", "id": 2, "updates": {"actor": "nobody"}}),
        client.post("/forecast/create", json={"table": "audit_log", "data": {
            "created_at": "2020-01-01T00:00:00Z", "path": "/forecast/scenario/F001/approve", "actor": "CFO"}}),
        csv_upload(client, "audit_log", "created_at,method,path,status\n2026-01-01T00:00:00Z,GET,/x,200\n",
                   mode="replace"),
        csv_upload(client, "scenario_approvals", "approval_id,forecast_id,action,actor\nAPR-FAKE,F002,approve,M\n"),
    ]
    for res in refused:
        assert res.status_code == 409, res.text
    assert "approve" in refused[0].json()["detail"] and "unlock" in refused[0].json()["detail"]
    assert "change history" in refused[4].json()["detail"]
    assert q(mgr, "SELECT * FROM scenario_approvals") == approvals
    # The history only grew (the refusals themselves are recorded); nothing was changed or removed.
    assert q(mgr, f"SELECT * FROM audit_log ORDER BY log_id LIMIT {len(history)}") == history
    assert q(mgr, "SELECT COUNT(*) FROM audit_log WHERE status = 409") == [(len(refused),)]


def test_actuals_and_month_end_close_records_go_through_the_actuals_endpoints(env):
    client, mgr = env
    res = client.post("/reporting/actuals", json={"entries": [{"period": "2027-01", "line_item": "revenue",
                                                              "amount": 500000}]})
    assert res.status_code == 200, res.text
    assert client.post("/reporting/actuals/periods/2027-01/close", json={"closed_by": "cfo"}).status_code == 200
    actual_id, batch_id = q(mgr, "SELECT actual_id, batch_id FROM actuals")[0]
    refused = {
        "actuals update": client.post("/forecast/update", json={"table": "actuals", "id": actual_id,
                                                                "updates": {"amount": 1}}),
        "actuals create": client.post("/forecast/create", json={"table": "actuals", "data": {
            "actual_id": "X1", "period": "2027-01", "line_item": "payroll", "amount": 99999}}),
        "actuals delete": client.delete(f"/forecast/delete/actuals/{actual_id}"),
        "actuals load": csv_upload(client, "actuals", "actual_id,period,line_item,amount\nLT1,2027-01,payroll,4242\n"),
        "period reopen": client.post("/forecast/update", json={"table": "actuals_periods", "id": "2027-01",
                                                               "updates": {"status": "open"}}),
        "batch status": client.post("/forecast/update", json={"table": "actuals_batches", "id": batch_id,
                                                               "updates": {"status": "undone"}}),
        "batch changes": client.delete(f"/forecast/delete/actuals_batch_changes/{batch_id}"),
    }
    for what, res in refused.items():
        assert res.status_code == 409, (what, res.text)
    assert "/reporting/actuals" in refused["actuals update"].json()["detail"]
    assert "/reporting/actuals/periods/2027-01/reopen" in refused["period reopen"].json()["detail"] or \
        "/reopen" in refused["period reopen"].json()["detail"]
    assert q(mgr, "SELECT amount FROM actuals") == [(500000.0,)]
    assert q(mgr, "SELECT status FROM actuals_periods WHERE period = '2027-01'") == [("closed",)]
    # The loader does not offer the governance records either.
    res = csv_upload(client, "no_such_table", "a\n1\n")
    assert res.status_code == 400
    offered = res.json()["detail"].split("Tables you can load:")[1]
    assert "customers" in offered
    for table in ("audit_log", "scenario_approvals", "actuals", "governance_guard"):
        assert table not in offered, table


def test_the_internal_guard_table_is_not_writable_through_the_api(env):
    client, mgr = env
    assert client.post("/forecast/create", json={"table": "governance_guard",
                                                 "data": {"active": 1}}).status_code == 409
    assert csv_upload(client, "governance_guard", "active\n1\n").status_code == 409
    assert q(mgr, "SELECT COUNT(*) FROM governance_guard") == [(0,)]


# ---------------------------------------------------------------------------
# LOCK-2: an allocation cannot be moved INTO a locked scenario's expense
# ---------------------------------------------------------------------------

def _expense(client, fid):
    res = client.post("/expenses/", json={"expense_name": f"Rent {fid}", "category_id": "CAT1", "amount": 12000,
                                          "frequency": "monthly", "start_date": "2027-01-01",
                                          "end_date": "2027-12-31", "forecast_id": fid})
    assert res.status_code == 200, res.text
    return q(mgr_of(client), "SELECT expense_id FROM expenses WHERE forecast_id = ?", (fid,))[0][0]


def mgr_of(_client):
    import db.database as dbmod
    return dbmod.db_manager


def test_moving_an_allocation_into_a_locked_expense_is_refused(env):
    client, mgr = env
    raw(mgr, "INSERT INTO expense_categories (category_id, category_name, category_type) "
             "VALUES ('CAT1', 'Rent', 'admin_expense')")
    locked_exp, draft_exp = _expense(client, "F001"), _expense(client, "F002")
    before = q(mgr, "SELECT COUNT(*), SUM(allocated_amount) FROM expense_allocations WHERE expense_id = ?",
               (locked_exp,))
    assert before[0][0] == 12
    approve(client)
    alloc = q(mgr, "SELECT allocation_id FROM expense_allocations WHERE expense_id = ? LIMIT 1", (draft_exp,))[0][0]
    res = client.post("/forecast/update", json={"table": "expense_allocations", "id": alloc,
                                                "updates": {"expense_id": locked_exp, "period": "2027-02"}})
    assert res.status_code == 409, res.text
    assert res.json().get("code") == "SCENARIO_LOCKED"
    assert q(mgr, "SELECT COUNT(*), SUM(allocated_amount) FROM expense_allocations WHERE expense_id = ?",
             (locked_exp,)) == before
    with pytest.raises(sqlite3.IntegrityError, match="SCENARIO_LOCKED"):
        raw(mgr, "UPDATE expense_allocations SET expense_id = ? WHERE allocation_id = ?", (locked_exp, alloc))
    # The draft's own allocations stay editable.
    raw(mgr, "UPDATE expense_allocations SET allocated_amount = 1 WHERE allocation_id = ?", (alloc,))


def test_the_migration_replaces_the_old_only_allocation_trigger(env):
    _client, mgr = env
    conn = sqlite3.connect(mgr.database_path)
    conn.execute("DROP TRIGGER trg_lock_expense_allocations_update")
    conn.execute("""CREATE TRIGGER trg_lock_expense_allocations_update BEFORE UPDATE ON expense_allocations
                    WHEN EXISTS (SELECT 1 FROM expenses e JOIN forecast f ON f.forecast_id = e.forecast_id
                                 WHERE e.expense_id = OLD.expense_id AND f.locked = 1)
                    BEGIN SELECT RAISE(ABORT, 'SCENARIO_LOCKED'); END""")
    conn.commit()
    conn.close()
    mgr.initialize_schema()
    mgr.initialize_schema()   # idempotent
    sql = q(mgr, "SELECT sql FROM sqlite_master WHERE type = 'trigger' "
                 "AND name = 'trg_lock_expense_allocations_update'")[0][0]
    assert "OLD.expense_id" in sql and "NEW.expense_id" in sql


# ---------------------------------------------------------------------------
# HIST-2 / AUDIT-FORECAST-FILTER / UI-4: the history records the scenario a write touched
# ---------------------------------------------------------------------------

def _latest(client):
    return log(client, limit=1)["entries"][0]


def test_writes_by_row_id_are_recorded_with_the_rows_scenario(env):
    client, mgr = env
    raw(mgr, "INSERT INTO price_list (price_id, unit_id, customer_id, unit_price, forecast_id) "
             "VALUES ('PRX1', 'P1', 'C1', 900, 'F001')")
    capex = client.post("/reporting/capex", json={"forecast_id": "F001", "asset_name": "Lathe", "amount": 5000,
                                                  "purchase_period": "2027-02", "useful_life_months": 60})
    assert capex.status_code == 200, capex.text
    capex_id = capex.json()["data"]["capex_id"]

    assert client.put(f"/reporting/capex/{capex_id}", json={"amount": 6000}).status_code == 200
    assert _latest(client)["forecast_id"] == "F001"
    assert client.put("/pricing/prices/PRX1", json={"unit_price": 999}).status_code == 200
    assert _latest(client)["forecast_id"] == "F001"
    assert client.post("/forecast/update", json={"table": "sales", "id": "S2",
                                                 "updates": {"quantity": 5}}).status_code == 200
    assert _latest(client)["forecast_id"] == "F001"
    assert client.delete("/forecast/delete/sales/S3").status_code == 200
    assert _latest(client)["forecast_id"] == "F001"
    # The sales grid sends the scenario inside each row.
    res = client.post("/forecast/bulk_update", headers=BROWSER, json={"forecasts": [
        {"unit_id": "P1", "customer_id": "C1", "period": "2027-01-01", "quantity": 13, "unit_price": 1000,
         "forecast_id": "F001"}], "operation": "replace"})
    assert res.status_code == 200, res.text
    assert _latest(client)["forecast_id"] == "F001"
    # A company-wide write stays company-wide.
    assert client.post("/forecast/create", json={"table": "customers",
                                                 "data": {"customer_id": "C9", "customer_name": "New"}}).status_code == 200
    assert _latest(client)["forecast_id"] is None

    approve(client)
    res = client.put(f"/reporting/capex/{capex_id}", json={"amount": 1}, headers={"X-Forecast-User": "qa"})
    assert res.status_code == 409 and res.json()["forecast_id"] == "F001"
    assert _latest(client)["forecast_id"] == "F001"
    assert client.delete("/payroll/employees/E1").status_code == 409
    assert _latest(client)["forecast_id"] == "F001"
    assert client.delete("/forecast/delete/sales/S1").status_code == 409
    assert _latest(client)["forecast_id"] == "F001"
    assert client.delete("/pricing/prices/PRX1").status_code == 409
    assert _latest(client)["forecast_id"] == "F001"

    refused = log(client, forecast_id="F001", status="refused")["entries"]
    assert {e["path"] for e in refused} >= {f"/reporting/capex/{capex_id}", "/payroll/employees/E1",
                                            "/forecast/delete/sales/S1", "/pricing/prices/PRX1"}
    paths = {e["path"] for e in log(client, forecast_id="F001", status="ok")["entries"]}
    assert {"/pricing/prices/PRX1", "/forecast/delete/sales/S3", "/forecast/bulk_update",
            "/forecast/update"} <= paths


def test_the_409_names_the_scenario_that_was_hit_when_several_are_locked(env):
    client, mgr = env
    capex = client.post("/reporting/capex", json={"forecast_id": "F002", "asset_name": "Mill", "amount": 5000,
                                                  "purchase_period": "2027-02", "useful_life_months": 60})
    capex_id = capex.json()["data"]["capex_id"]
    approve(client, "F001")
    approve(client, "F002")
    res = client.put(f"/reporting/capex/{capex_id}", json={"amount": 1})
    assert res.status_code == 409
    assert res.json()["forecast_id"] == "F002" and "Scenario 'Upside'" in res.json()["detail"]
    assert _latest(client)["forecast_id"] == "F002"


# ---------------------------------------------------------------------------
# HIST-3 / ADJUST-DRYRUN-LOCK / HIST-4: MCP dry runs and refusals
# ---------------------------------------------------------------------------

def _mcp_entries(client):
    return rows(ok(client, "forecast_audit_log", {"client": "mcp", "limit": 50})["entries"])


def test_mcp_adjuster_dry_runs_are_not_history(env):
    client, mgr = env
    preview = ok(client, "forecast_adjust_sales", {"forecast_id": "F002", "all_rows": True,
                                                   "price_multiplier": 0.9, "dry_run": True})
    assert preview["dry_run"] is True and preview["matched_rows"] == 3
    ok(client, "forecast_adjust_material_costs", {"bom_ids": ["B1"], "price_multiplier": 1.05, "dry_run": True})
    assert _mcp_entries(client) == []
    ok(client, "forecast_adjust_sales", {"forecast_id": "F002", "all_rows": True, "price_multiplier": 0.9})
    entries = _mcp_entries(client)
    assert [(e["path"], e["status"]) for e in entries] == [("/mcp/tools/forecast_adjust_sales", 200)]
    assert not entries[0]["summary"].startswith("Dry run")


def test_an_adjuster_dry_run_on_a_locked_scenario_says_the_real_run_will_be_refused(env):
    client, mgr = env
    ok(client, "forecast_approve_scenario", {"forecast_id": "F001", "approved_by": "Dana"})
    preview = ok(client, "forecast_adjust_sales", {"forecast_id": "F001", "all_rows": True,
                                                   "price_multiplier": 0.9, "dry_run": True})
    assert preview["locked"] is True
    assert "Scenario '2027 Budget' is approved and locked" in preview["warning"]
    assert "will be refused" in preview["warning"]
    assert q(mgr, "SELECT SUM(unit_price) FROM sales WHERE forecast_id = 'F001'") == [(3000.0,)]
    # Unlocked scenarios carry no warning.
    other = ok(client, "forecast_adjust_sales", {"forecast_id": "F002", "all_rows": True,
                                                 "price_multiplier": 0.9, "dry_run": True})
    assert "locked" not in other and "warning" not in other
    assert [e["path"] for e in _mcp_entries(client)] == ["/forecast/scenario/F001/approve"]


def test_a_refused_mcp_write_that_only_previewed_is_recorded(env):
    client, mgr = env
    ok(client, "forecast_approve_scenario", {"forecast_id": "F001", "approved_by": "Dana"})
    row = {"customer_id": "C1", "unit_id": "P1", "period": "2027-01", "quantity": 1, "unit_price": 1}

    # A dry run that is refused is still not history.
    text, is_error = call_tool(client, "forecast_upsert_sales", {"forecast_id": "F001", "rows": [row],
                                                                 "dry_run": True})
    assert is_error and "approved and locked" in text
    assert len(_mcp_entries(client)) == 1

    text, is_error = call_tool(client, "forecast_upsert_sales", {"forecast_id": "F001", "rows": [row]})
    assert is_error and "approved and locked" in text
    entries = _mcp_entries(client)
    assert len(entries) == 2
    newest = entries[0]
    assert (newest["method"], newest["path"], newest["status"], newest["forecast_id"]) == (
        "TOOL", "/mcp/tools/forecast_upsert_sales", 409, "F001")
    assert newest["summary"].startswith("MCP tool forecast_upsert_sales refused (409)")
    assert "approved and locked" in newest["summary"]

    text, is_error = call_tool(client, "forecast_import_sales", {"forecast_id": "F001", "rows": [row]})
    assert is_error
    assert _mcp_entries(client)[0]["path"] == "/mcp/tools/forecast_import_sales"
    assert _mcp_entries(client)[0]["status"] == 409

    # A successful replace is recorded once, by its real REST write, never twice.
    ok(client, "forecast_upsert_sales", {"forecast_id": "F002", "rows": [row]})
    entries = _mcp_entries(client)
    assert len(entries) == 4
    assert (entries[0]["path"], entries[0]["status"], entries[0]["forecast_id"]) == (
        "/forecast/smart_import_sales", 200, "F002")
    # The loan schedule repair preview (dry run by default) is still not history.
    assert q(mgr, "SELECT sale_id FROM sales WHERE forecast_id = 'F001' AND quantity = 1") == []


# ---------------------------------------------------------------------------
# SNAP-2 / UI-3: approval snapshots are recognised by their exact name
# ---------------------------------------------------------------------------

def _set_price(mgr, value):
    raw(mgr, "UPDATE units SET base_price = ? WHERE unit_id = 'P2'", (value,))


def _price(mgr):
    return q(mgr, "SELECT base_price FROM units WHERE unit_id = 'P2'")[0][0]


def test_a_save_named_approved_something_is_a_normal_save(env):
    client, mgr = env
    assert client.post("/database/save", json={"name": "qa_before_replay"}).status_code == 200
    time.sleep(1.1)
    _set_price(mgr, 150)
    res = client.post("/database/save", json={"name": "approved_2027_final"})
    assert res.status_code == 200, res.text
    body = client.get("/database/list").json()
    flat = _snapshots(body)
    assert flat["approved_2027_final.db"]["type"] == "manual_save"
    assert flat["approved_2027_final.db"]["kind"] == "manual_save"
    assert "approved_2027_final.db" in [s["filename"] for s in body["data"]["manual_saves"]]
    _set_price(mgr, 175)
    res = client.post("/database/revert-to-last-save")
    assert res.status_code == 200, res.text
    assert res.json()["data"]["reverted_from"] == "approved_2027_final.db"
    assert _price(mgr) == 150


def _snapshots(body):
    """filename -> entry, whichever list shape /database/list answers with."""
    found = {}

    def walk(value):
        if isinstance(value, dict):
            if "filename" in value and "type" in value:
                found[value["filename"]] = value
            for v in value.values():
                walk(v)
        elif isinstance(value, list):
            for v in value:
                walk(v)
    walk(body)
    return found


def test_real_approval_snapshots_stay_approval_evidence_and_are_never_reverted_to(env):
    client, mgr = env
    snap = approve(client)["approval"]["snapshot_filename"]
    entry = _snapshots(client.get("/database/list").json())[snap]
    assert (entry["type"], entry["kind"]) == ("system_backup", "approval_snapshot")
    res = client.post("/database/revert-to-last-save")
    assert res.status_code == 404


@pytest.mark.parametrize("name", ["autosave_mine", "current_backup_x", "pre_revert_backup_x", "reset_backup_x",
                                  "start_clean_backup_x", "clear_data_backup_x", "force_reload_backup_x",
                                  "Autosave_Mine", "approved_F001_20261012_152151", "approved_F001_20261012_152151_2"])
def test_reserved_snapshot_names_are_refused_for_user_saves(env, name):
    client, mgr = env
    res = client.post("/database/save", json={"name": name, "overwrite": True})
    assert res.status_code == 400, res.text
    assert "reserved" in res.json()["detail"]
    assert not os.path.exists(os.path.join(mgr.snapshot_dir, f"{name}.db"))


def test_the_snapshot_classification_helpers():
    from db.database import is_approval_snapshot, snapshot_detail_kind, snapshot_kind
    assert is_approval_snapshot("approved_F001_20261012_152151.db")
    assert is_approval_snapshot("approved_F-001_x_20261012_152151_3.db")
    assert not is_approval_snapshot("approved_budget.db")
    assert not is_approval_snapshot("approved_2027_final.db")
    assert snapshot_kind("approved_budget.db") == "manual_save"
    assert snapshot_detail_kind("approved_budget.db") == "manual_save"
    assert snapshot_kind("approved_F001_20261012_152151.db") == "system_backup"
    assert snapshot_detail_kind("approved_F001_20261012_152151.db") == "approval_snapshot"
    assert snapshot_kind("reset_backup_20261012_152151.db") == "system_backup"


# ---------------------------------------------------------------------------
# UPDATE-SCENARIO-DRIFT-NULL
# ---------------------------------------------------------------------------

def test_update_and_approve_responses_carry_the_drift(env):
    client, mgr = env
    res = client.post("/forecast/scenario/F001/approve", json={"approved_by": "Dana"})
    assert res.status_code == 200
    assert res.json()["data"]["drift"]["changed"] is False
    raw(mgr, "UPDATE bom SET unit_price = 400, material_cost = 400 WHERE bom_id = 'B1'")
    got = client.get("/forecast/scenario/F001").json()["data"]
    assert got["drift"]["changed"] is True
    upd = client.put("/forecast/scenario/F001", json={"is_base": True})
    assert upd.status_code == 200, upd.text
    assert upd.json()["data"]["drift"] == got["drift"]
    upd = ok(client, "forecast_update_scenario", {"forecast_id": "F001", "is_base": True})
    assert upd["drift"]["changed"] is True


# ---------------------------------------------------------------------------
# LAB-6: labor_class on the bulk paths and in the legacy check
# ---------------------------------------------------------------------------

PAYROLL_HEAD = "employee_id,employee_name,department,weekly_hours,hourly_rate,rate_type,start_date,forecast_id,labor_class\n"


def test_load_table_validates_and_normalises_labor_class(env):
    client, mgr = env
    res = csv_upload(client, "payroll", PAYROLL_HEAD + "E2,Sam,Prod,40,25,hourly,2027-01-01,F002,Production\n"
                                                       "E3,Lee,Prod,40,25,hourly,2027-01-01,F002,direct\n")
    assert res.status_code == 422, res.text
    assert "row 1" in res.json()["detail"] and "labor_class" in res.json()["detail"]
    assert q(mgr, "SELECT COUNT(*) FROM payroll WHERE employee_id IN ('E2', 'E3')") == [(0,)]
    res = csv_upload(client, "payroll", PAYROLL_HEAD + "E2,Sam,Prod,40,25,hourly,2027-01-01,F002,Direct Labor\n"
                                                       "E3,Lee,Prod,40,25,hourly,2027-01-01,F002,INDIRECT\n"
                                                       "E4,Kim,Office,40,25,hourly,2027-01-01,F002,\n")
    assert res.status_code == 200, res.text
    assert q(mgr, "SELECT employee_id, labor_class FROM payroll WHERE employee_id IN ('E2','E3','E4') "
                  "ORDER BY employee_id") == [("E2", "direct"), ("E3", "indirect"), ("E4", None)]
    # The generic record writers apply the same rule.
    res = client.post("/forecast/create", json={"table": "payroll", "data": {
        "employee_id": "E5", "employee_name": "Ann", "hourly_rate": 20, "labor_class": "Production"}})
    assert res.status_code == 422 and "labor_class" in res.json()["detail"]
    res = client.post("/forecast/update", json={"table": "payroll", "id": "E4", "updates": {"labor_class": "Admin"}})
    assert res.status_code == 200, res.text
    assert q(mgr, "SELECT labor_class FROM payroll WHERE employee_id = 'E4'") == [("admin",)]
    assert client.post("/forecast/update", json={"table": "payroll", "id": "E4",
                                                 "updates": {"labor_class": "boss"}}).status_code == 422


def test_legacy_check_lists_employees_with_an_unrecognised_stored_class(env):
    client, mgr = env
    raw(mgr, """INSERT INTO payroll (employee_id, employee_name, department, weekly_hours, hourly_rate, rate_type,
                start_date, forecast_id, labor_class)
                VALUES ('E7', 'Sam', 'Prod', 40, 25, 'hourly', '2027-01-01', 'F001', 'Production'),
                       ('E8', 'Lee', 'Prod', 40, 25, 'hourly', '2027-01-01', NULL, 'Direct'),
                       ('E9', 'Kim', 'Prod', 40, 25, 'hourly', '2027-01-01', NULL, 'direct')""")
    issues = {i["code"]: i for i in client.get("/audit/legacy-checks").json()["data"]["issues"]}
    issue = issues["employees_without_labor_class"]
    assert issue["count"] == 2          # Pat (NULL) and Sam ('Production'); 'Direct' reads as direct
    assert "Pat (F001)" in issue["examples"]
    assert any(e.startswith("Sam (F001)") and "'Production'" in e for e in issue["examples"])
