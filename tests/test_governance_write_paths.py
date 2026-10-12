"""
Governance on the remaining write paths (review round 13).

* GOV-REPLAY-BYPASS / NEW-1 / REST-CRUD-GOV-BYPASS: the generic writers
  refuse the internal tables (execution_log, forecast_results, sqlite_*),
  and POST /database/rollback/replay runs logged SQL under an authorizer:
  a replay that would write the governance records, a scenario's approval
  columns, the approve / unlock switch or rows of an approved scenario, or
  change the schema, is refused whole (409) and nothing changes.
* NEW-2: a successful /database/load_table is filed under the scenario its
  rows share, never under the CSV header 'forecast_id'.
* NEW-3 / LAB7-AUDIT: a refused /payroll/bulk-update answers the shared lock
  body {detail, code, forecast_id} and is filed under the locked scenario.
* NEW-4: refusals by row id (POST /forecast/update included) are filed under
  the addressed row's scenario, and the 409s of the generic writers and the
  loader name the scenario they refused.
* LAB9-LOADER: the raw payroll writers apply the employee endpoints' pay,
  hours and date rules.
"""
import sqlite3

import pytest

from tests.test_governance_api import approve, env, log, q  # noqa: F401  (env is a fixture)
from tests.test_governance_hardening import csv_upload, raw


def latest(client):
    return log(client, limit=1)["entries"][0]


def log_sql(mgr, *statements, when="2020-01-01 00:00:00"):
    """Rows as an older version's execute_sql left them in execution_log (the API no longer writes it)."""
    for sql in statements:
        raw(mgr, "INSERT INTO execution_log (execution_date, sql_statement, execution_status) "
                 "VALUES (?, ?, 'success')", (when, sql))


def governance_state(mgr):
    return {
        "forecast": q(mgr, "SELECT forecast_id, status, locked, approved_by FROM forecast ORDER BY forecast_id"),
        "approvals": q(mgr, "SELECT * FROM scenario_approvals ORDER BY approval_id"),
        "periods": q(mgr, "SELECT period, status FROM actuals_periods ORDER BY period"),
        "actuals": q(mgr, "SELECT actual_id, amount FROM actuals ORDER BY actual_id"),
        "guard": q(mgr, "SELECT COUNT(*) FROM governance_guard"),
        "sales": q(mgr, "SELECT sale_id, quantity FROM sales ORDER BY sale_id"),
        "customers": q(mgr, "SELECT customer_id FROM customers ORDER BY customer_id"),
    }


# ---------------------------------------------------------------------------
# GOV-REPLAY-BYPASS / NEW-1: no generic writer reaches the internal tables
# ---------------------------------------------------------------------------

def test_generic_writers_refuse_the_internal_tables(env):
    client, mgr = env
    log_sql(mgr, "SELECT 1")
    refused = {
        "create execution_log": client.post("/forecast/create", json={"table": "execution_log", "data": {
            "execution_date": "2020-01-01 00:00:00", "sql_statement": "DELETE FROM audit_log",
            "execution_status": "success"}}),
        "update execution_log": client.post("/forecast/update", json={
            "table": "execution_log", "id": 1, "updates": {"sql_statement": "DELETE FROM audit_log"}}),
        "delete execution_log": client.delete("/forecast/delete/execution_log/1"),
        "load execution_log": csv_upload(client, "execution_log",
                                         "execution_date,sql_statement,execution_status\n"
                                         "2020-01-01,DELETE FROM audit_log,success\n"),
        "create forecast_results": client.post("/forecast/create", json={"table": "forecast_results", "data": {
            "forecast_date": "x", "period": "2027-01", "total_revenue": 1}}),
        "update sqlite_sequence": client.post("/forecast/update", json={
            "table": "sqlite_sequence", "id": "audit_log", "updates": {"seq": 0}}),
    }
    for what, res in refused.items():
        assert res.status_code == 409, (what, res.text)
    assert "internal log" in refused["create execution_log"].json()["detail"]
    assert "bookkeeping" in refused["update sqlite_sequence"].json()["detail"]
    assert q(mgr, "SELECT sql_statement FROM execution_log") == [("SELECT 1",)]
    assert q(mgr, "SELECT COUNT(*) FROM forecast_results") == [(0,)]


# ---------------------------------------------------------------------------
# GOV-REPLAY-BYPASS / NEW-1: a replay never touches governance or the schema
# ---------------------------------------------------------------------------

def test_replay_cannot_unlock_rewrite_or_delete_the_governance_records(env):
    client, mgr = env
    approve(client)
    assert client.post("/reporting/actuals", json={"entries": [{"period": "2027-01", "line_item": "revenue",
                                                              "amount": 500000}]}).status_code == 200
    assert client.post("/reporting/actuals/periods/2027-01/close", json={"closed_by": "cfo"}).status_code == 200
    history = q(mgr, "SELECT * FROM audit_log ORDER BY log_id")
    before = governance_state(mgr)
    # The reviewer's sequence: switch the guard on, unlock, switch it off, rewrite the approver, delete history.
    log_sql(mgr,
            "INSERT INTO customers (customer_id, customer_name) VALUES ('C-REPLAY', 'Plain data change')",
            "INSERT INTO governance_guard (active) VALUES (1)",
            "UPDATE forecast SET locked = 0, status = 'draft' WHERE forecast_id = 'F001'",
            "DELETE FROM governance_guard",
            "UPDATE actuals_periods SET status = 'open' WHERE period = '2027-01'",
            "UPDATE scenario_approvals SET actor = 'Mallory via replay' WHERE forecast_id = 'F001'",
            "DELETE FROM audit_log WHERE log_id <= 3",
            "UPDATE actuals SET amount = 1")
    res = client.post("/database/rollback/replay")
    assert res.status_code == 409, res.text
    detail = res.json()["detail"]
    assert detail.startswith("Nothing replayed") and "Nothing was changed" in detail
    assert "insert into governance_guard" in detail and "change forecast.locked" in detail
    assert "SCENARIO_LOCKED" not in detail
    # Nothing changed at all: the plain insert in the same replay was rolled back too.
    assert governance_state(mgr) == before
    assert q(mgr, f"SELECT * FROM audit_log ORDER BY log_id LIMIT {len(history)}") == history
    assert client.post("/forecast/update", json={"table": "sales", "id": "S1",
                                                 "updates": {"quantity": 999}}).status_code == 409
    entry = latest(client)
    assert entry["path"] == "/forecast/update" and entry["forecast_id"] == "F001"


@pytest.mark.parametrize("statement", [
    "UPDATE forecast SET approved_by = 'Someone else' WHERE forecast_id = 'F001'",
    "UPDATE forecast SET status = 'approved', locked = 1 WHERE forecast_id = 'F002'",
    "INSERT INTO forecast (forecast_id, name, status, locked) VALUES ('F099', 'Fake', 'approved', 1)",
    "UPDATE sales SET quantity = 999 WHERE sale_id = 'S1'",
    "DELETE FROM sales WHERE forecast_id = 'F001'",
    "DELETE FROM forecast WHERE forecast_id = 'F001'",
    # REPLACE deletes the old row without the delete triggers unless recursive triggers are on.
    "INSERT OR REPLACE INTO forecast (forecast_id, name, is_base, locked, status) "
    "VALUES ('F001', '2027 Budget', 1, 0, 'draft')",
    "REPLACE INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id) "
    "VALUES ('S1', 'C1', 'P1', '2027-01', 1, 1, 1, 'F002')",
    "INSERT INTO forecast (forecast_id, name, approved_by, approved_at) VALUES ('F098', 'Fake', 'CFO', '2027-01-01')",
    "INSERT INTO forecast (forecast_id, name, approved_by, approved_at) "
    "VALUES ('F098', 'Fake', 'CFO', '2027-01-01') ON CONFLICT DO NOTHING",
    "INSERT INTO audit_log (path, actor) VALUES ('/forecast/scenario/F001/approve', 'CFO')",
    "INSERT INTO scenario_approvals (approval_id, forecast_id, action, actor) VALUES ('APR-X', 'F002', 'approve', 'M')",
    "DELETE FROM actuals_batches",
    "INSERT INTO execution_log (execution_date, sql_statement, execution_status) "
    "VALUES ('2020-01-02', 'DELETE FROM sales', 'success')",
    "DROP TRIGGER trg_lock_sales_update",
    "DROP TRIGGER trg_guard_forecast_governance",
    "CREATE TRIGGER t_evil AFTER INSERT ON customers BEGIN DELETE FROM sales; END",
    "CREATE TABLE evil (a)",
    "DROP TABLE expense_categories",
    "ALTER TABLE customers ADD COLUMN evil TEXT",
    "PRAGMA foreign_keys = OFF",
    "ATTACH DATABASE ':memory:' AS other",
    "COMMIT",
    "UPDATE sqlite_sequence SET seq = 0",
])
def test_replay_refuses_each_kind_of_governance_or_schema_change(env, statement):
    client, mgr = env
    approve(client)
    before = governance_state(mgr)
    schema = q(mgr, "SELECT type, name, sql FROM sqlite_master ORDER BY type, name")
    log_sql(mgr, "INSERT INTO customers (customer_id, customer_name) VALUES ('C-REPLAY', 'Plain')", statement)
    res = client.post("/database/rollback/replay")
    assert res.status_code == 409, (statement, res.text)
    assert governance_state(mgr) == before
    assert q(mgr, "SELECT type, name, sql FROM sqlite_master ORDER BY type, name") == schema


def test_replay_still_reapplies_plain_data_changes(env):
    client, mgr = env
    log_sql(mgr,
            "INSERT INTO customers (customer_id, customer_name) VALUES ('C-R1', 'Replayed One')",
            "UPDATE customers SET customer_name = 'Replayed Two' WHERE customer_id = 'C-R1'",
            "UPDATE forecast SET name = 'Upside renamed' WHERE forecast_id = 'F002'",
            "UPDATE sales SET quantity = 11 WHERE sale_id = 'U1'",
            "INSERT INTO no_such_table VALUES (1)",
            "SELECT * FROM customers")
    res = client.post("/database/rollback/replay")
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["replayed_count"] == 4 and data["failed_count"] == 1
    assert "no_such_table" in data["errors"][0]["error"]
    assert q(mgr, "SELECT customer_name FROM customers WHERE customer_id = 'C-R1'") == [("Replayed Two",)]
    assert q(mgr, "SELECT name FROM forecast WHERE forecast_id = 'F002'") == [("Upside renamed",)]
    assert q(mgr, "SELECT quantity FROM sales WHERE sale_id = 'U1'") == [(11,)]
    assert q(mgr, "SELECT COUNT(*) FROM governance_guard") == [(0,)]


def test_the_replay_guard_covers_every_governed_table():
    from db.database import REPLAY_PROTECTED_FORECAST_COLUMNS, REPLAY_PROTECTED_TABLES
    from services.governance import GOVERNED_FORECAST_COLUMNS, GOVERNED_TABLES

    assert set(GOVERNED_TABLES) <= set(REPLAY_PROTECTED_TABLES)
    assert tuple(REPLAY_PROTECTED_FORECAST_COLUMNS) == tuple(GOVERNED_FORECAST_COLUMNS)


# ---------------------------------------------------------------------------
# NEW-2: a load is filed under the scenario of its rows, never a header name
# ---------------------------------------------------------------------------

def test_load_table_is_filed_under_the_scenario_its_rows_share(env):
    client, mgr = env
    res = csv_upload(client, "sales", "forecast_id,customer_id,unit_id,period,quantity,unit_price\n"
                                      "F002,C1,P1,2028-01,1,1\nF002,C1,P1,2028-02,1,1\n")
    assert res.status_code == 200, res.text
    assert res.json()["data"]["forecast_id"] == "F002"
    assert latest(client)["forecast_id"] == "F002"

    res = csv_upload(client, "sales", "forecast_id,customer_id,unit_id,period,quantity,unit_price\n"
                                      "F001,C1,P1,2028-03,1,1\nF002,C1,P1,2028-03,1,1\n")
    assert res.status_code == 200, res.text
    assert res.json()["data"]["forecast_id"] is None
    assert latest(client)["forecast_id"] is None

    res = csv_upload(client, "forecast", "forecast_id,name\nF001,2027 Budget\nF002,Upside\n", mode="upsert")
    assert res.status_code == 200, res.text
    assert latest(client)["forecast_id"] is None
    assert csv_upload(client, "customers", "customer_id,customer_name\nC7,Dealer Seven\n").status_code == 200
    assert latest(client)["forecast_id"] is None
    assert q(mgr, "SELECT COUNT(*) FROM audit_log WHERE forecast_id = 'forecast_id'") == [(0,)]


def test_a_column_map_or_an_unknown_id_is_never_a_scenario(env):
    from services.governance import extract_forecast_id

    column_map = {"status": "success", "data": {"table": "sales", "rows_loaded": 1, "ignored_columns": [],
                                                "column_map": {"forecast_id": "forecast_id", "unit_id": "unit_id"}}}
    assert extract_forecast_id("/database/load_table", {"table_name": ["sales"]}, None, b"", column_map) is None
    # A record nested one level down still counts when its scenario exists.
    record = {"status": "success", "data": {"record": {"sale_id": "S9", "forecast_id": "F002"}}}
    assert extract_forecast_id("/forecast/create", {}, None, b"", record) == "F002"
    unknown = {"status": "success", "data": {"record": {"sale_id": "S9", "forecast_id": "F404"}}}
    assert extract_forecast_id("/forecast/create", {}, None, b"", unknown) is None
    assert extract_forecast_id("/forecast/bulk_update", {}, {"forecasts": [{"forecast_id": "F404"}]}) is None
    assert extract_forecast_id("/forecast/bulk_update", {}, {"forecasts": [{"forecast_id": "F001"}]}) == "F001"


# ---------------------------------------------------------------------------
# NEW-3 / LAB7-AUDIT: refused bulk payroll updates name and file the scenario
# ---------------------------------------------------------------------------

def _company_wide_employee(mgr, employee_id="E9"):
    raw(mgr, "INSERT INTO payroll (employee_id, employee_name, department, weekly_hours, hourly_rate, rate_type, "
             "start_date, benefits_eligible) VALUES (?, 'Kim', 'Office', 40, 25, 'hourly', '2027-01-01', 0)",
        (employee_id,))
    return employee_id


def test_a_refused_bulk_update_answers_the_lock_body_and_is_filed_under_the_scenario(env):
    client, mgr = env
    kim = _company_wide_employee(mgr)
    approve(client)
    attempts = [
        [{"employee_id": "E1", "weekly_hours": 20}],                        # edit the locked scenario's employee
        [{"employee_id": "E1", "forecast_id": "F002"}],                     # move it out (F002 is not locked)
        [{"employee_id": kim, "weekly_hours": 30}, {"employee_id": "E1", "labor_class": "admin"}],
        [{"employee_id": kim, "forecast_id": "F001"}],                      # move a company-wide one in
    ]
    for body in attempts:
        res = client.post("/payroll/bulk-update", json=body)
        assert res.status_code == 409, (body, res.text)
        payload = res.json()
        assert payload["code"] == "SCENARIO_LOCKED" and payload["forecast_id"] == "F001", payload
        assert payload["detail"].startswith("Scenario '2027 Budget' is approved and locked")
        assert "refused; nothing was changed." in payload["detail"]
        assert latest(client)["forecast_id"] == "F001", body
    refused = log(client, forecast_id="F001", status="refused", path_contains="bulk-update")
    assert refused["total_count"] == len(attempts)
    assert q(mgr, "SELECT employee_id, weekly_hours, forecast_id FROM payroll ORDER BY employee_id") == [
        ("E1", 40, "F001"), (kim, 40, None)]


def test_a_lock_the_bulk_pre_check_missed_still_answers_the_lock_body(env, monkeypatch):
    import api.payroll_routes as payroll_routes

    client, mgr = env
    approve(client)
    monkeypatch.setattr(payroll_routes, "_refuse_locked_employee_updates", lambda cursor, updates: None)
    res = client.post("/payroll/bulk-update", json=[{"employee_id": "E1", "weekly_hours": 20}])
    assert res.status_code == 409, res.text
    payload = res.json()
    assert payload["code"] == "SCENARIO_LOCKED" and payload["forecast_id"] == "F001"
    assert "Updating employee E1 refused" in payload["detail"]
    assert latest(client)["forecast_id"] == "F001"
    assert q(mgr, "SELECT weekly_hours FROM payroll WHERE employee_id = 'E1'") == [(40,)]


# ---------------------------------------------------------------------------
# NEW-4: refusals are filed under the scenario of the row they addressed
# ---------------------------------------------------------------------------

def test_a_refused_update_by_row_id_is_filed_under_the_rows_scenario(env):
    client, mgr = env
    approve(client)
    res = client.post("/forecast/update", json={"table": "forecast", "id": "F001",
                                                "updates": {"forecast_id": "F099"}})
    assert res.status_code == 409, res.text
    assert res.json()["forecast_id"] == "F001" and "forecast_id cannot change" in res.json()["detail"]
    assert latest(client)["forecast_id"] == "F001"
    res = client.post("/forecast/update", json={"table": "forecast", "id": "F001",
                                                "updates": {"locked": 0, "status": "draft"}})
    assert res.status_code == 409 and res.json()["forecast_id"] == "F001"
    assert latest(client)["forecast_id"] == "F001"
    # Moving a locked scenario's sales row to another scenario: filed under the row's own scenario.
    res = client.post("/forecast/update", json={"table": "sales", "id": "S1", "updates": {"forecast_id": "F002"}})
    assert res.status_code == 409
    assert res.json()["forecast_id"] == "F001" and latest(client)["forecast_id"] == "F001"
    # A successful update of an unlocked row is still filed under that row's scenario.
    res = client.post("/forecast/update", json={"table": "sales", "id": "U1", "updates": {"quantity": 3}})
    assert res.status_code == 200
    assert latest(client)["forecast_id"] == "F002"
    assert q(mgr, "SELECT COUNT(*) FROM audit_log WHERE forecast_id = 'F099'") == [(0,)]


def test_refused_scenario_loads_name_the_scenario(env):
    client, mgr = env
    approve(client)
    for text, mode in (("forecast_id,name\nF001,Renamed\n", "upsert"),
                       ("forecast_id,locked,status\nF001,0,draft\n", "upsert"),
                       ("forecast_id,name\nF001,Renamed\nF002,Upside\n", "replace"),
                       ("forecast_id,name\nF002,Upside\n", "replace")):
        res = csv_upload(client, "forecast", text, mode=mode)
        assert res.status_code == 409, (text, mode, res.text)
        assert res.json()["forecast_id"] == "F001", (text, mode, res.json())
        assert latest(client)["forecast_id"] == "F001", (text, mode)
    assert q(mgr, "SELECT forecast_id, name, status, locked FROM forecast ORDER BY forecast_id") == [
        ("F001", "2027 Budget", "approved", 1), ("F002", "Upside", "draft", 0)]
    # A refused NEW scenario row is not a scenario: nothing is named.
    res = csv_upload(client, "forecast", "forecast_id,name,status,locked\nF011,Fake,approved,1\n")
    assert res.status_code == 409 and "forecast_id" not in res.json()
    assert latest(client)["forecast_id"] is None


def test_refused_loads_name_the_locked_scenario_when_several_are_locked(env):
    client, mgr = env
    capex = client.post("/reporting/capex", json={"forecast_id": "F002", "asset_name": "Mill", "amount": 5000,
                                                  "purchase_period": "2027-02", "useful_life_months": 60})
    assert capex.status_code == 200, capex.text
    capex_id = capex.json()["data"]["capex_id"]
    approve(client, "F001")
    approve(client, "F002")
    attempts = [
        ("sales", "sale_id,customer_id,unit_id,period,quantity,unit_price,total_revenue,forecast_id\n"
                  "Z2,C1,P1,2027-04,1,1000,1000,F002\n", "append"),
        ("capital_expenditures", "capex_id,asset_name,amount,purchase_period,useful_life_months,forecast_id\n"
                                 f"{capex_id},Lathe,60000,2027-02,60,F002\n", "upsert"),
        ("capital_expenditures", f"capex_id,amount\n{capex_id},1\n", "upsert"),   # scenario from the stored row
        ("sales", "sale_id,customer_id,unit_id,period,quantity,unit_price,total_revenue,forecast_id\n"
                  "U1,C1,P1,2027-01,99,1000,99000,F002\n", "upsert"),
    ]
    for table, text, mode in attempts:
        res = csv_upload(client, table, text, mode=mode)
        assert res.status_code == 409, (table, mode, res.text)
        payload = res.json()
        assert payload["code"] == "SCENARIO_LOCKED" and payload["forecast_id"] == "F002", (table, mode, payload)
        assert "Scenario 'Upside'" in payload["detail"]
        assert latest(client)["forecast_id"] == "F002", (table, mode)
    res = csv_upload(client, "sales", "sale_id,customer_id,unit_id,period,quantity,unit_price,total_revenue,"
                                      "forecast_id\nZ3,C1,P1,2027-04,1,1000,1000,\n", mode="replace")
    assert res.status_code == 409 and res.json()["forecast_id"] == "F001"
    assert latest(client)["forecast_id"] == "F001"
    assert q(mgr, "SELECT COUNT(*) FROM sales WHERE sale_id IN ('Z2', 'Z3')") == [(0,)]
    assert q(mgr, "SELECT quantity FROM sales WHERE sale_id = 'U1'") == [(12,)]
    assert q(mgr, "SELECT amount FROM capital_expenditures WHERE capex_id = ?", (capex_id,)) == [(5000,)]


# ---------------------------------------------------------------------------
# LAB9-LOADER: the raw payroll writers apply the employee endpoints' rules
# ---------------------------------------------------------------------------

PAYROLL_CSV_HEAD = "employee_id,employee_name,department,hourly_rate,weekly_hours,start_date,end_date,labor_class\n"


def _bulk_error(client, **fields):
    """The message /payroll/bulk-update gives for one bad field of company-wide employee E9."""
    res = client.post("/payroll/bulk-update", json=[{"employee_id": "E9", **fields}])
    assert res.status_code == 200, res.text
    errors = res.json()["data"]["errors"]
    assert len(errors) == 1, errors
    return errors[0].split(": ", 1)[1]


def test_load_table_refuses_negative_pay_hours_and_reversed_dates(env):
    client, mgr = env
    _company_wide_employee(mgr)
    res = csv_upload(client, "payroll", PAYROLL_CSV_HEAD + "G1,Neg,Production,-25,40,2027-01-01,,direct\n"
                                                           "G2,Rev,Production,25,40,2027-06-01,2027-01-31,direct\n"
                                                           "G3,Hrs,Production,25,-10,2027-01-01,,direct\n"
                                                           "G4,Long,Production,25,200,2027-01-01,,direct\n"
                                                           "G5,Date,Production,25,40,someday,,direct\n"
                                                           "G6,Fine,Production,25,37.5,2027-01-01,2027-12-31,direct\n")
    assert res.status_code == 422, res.text
    detail = res.json()["detail"]
    assert detail.startswith("5 row(s) rejected, nothing loaded")
    expected = {
        1: _bulk_error(client, hourly_rate=-25),
        2: _bulk_error(client, start_date="2027-06-01", end_date="2027-01-31"),
        3: _bulk_error(client, weekly_hours=-10),
        4: _bulk_error(client, weekly_hours=200),
        5: _bulk_error(client, start_date="someday"),
    }
    for row, message in expected.items():
        assert f"row {row}: {message}" in detail, (row, message, detail)
    assert "hourly_rate must be 0 or more, got -25" in detail
    assert "end_date 2027-01-31 is before start_date 2027-06-01" in detail
    assert q(mgr, "SELECT COUNT(*) FROM payroll WHERE employee_id LIKE 'G%'") == [(0,)]

    # An upsert that only moves the end date is checked against the stored start date.
    res = csv_upload(client, "payroll", "employee_id,end_date\nE1,2026-06-30\n", mode="upsert")
    assert res.status_code == 422 and "end_date 2026-06-30 is before start_date 2027-01-01" in res.json()["detail"]
    res = csv_upload(client, "payroll", "employee_id,end_date,weekly_hours\nE1,2027-09-30,37.5\n", mode="upsert")
    assert res.status_code == 200, res.text
    assert q(mgr, "SELECT end_date, weekly_hours FROM payroll WHERE employee_id = 'E1'") == [("2027-09-30", 37.5)]


def test_the_generic_writers_refuse_negative_pay_hours_and_reversed_dates(env):
    client, mgr = env
    base = {"employee_name": "N", "department": "P", "hourly_rate": 20, "weekly_hours": 40,
            "start_date": "2027-01-01", "labor_class": "direct"}
    for fields, message in (({"hourly_rate": -20}, "hourly_rate must be 0 or more, got -20"),
                            ({"weekly_hours": -1}, "weekly_hours must be between 0 and 168, got -1"),
                            ({"end_date": "2026-12-31"}, "end_date 2026-12-31 is before start_date 2027-01-01"),
                            ({"next_review_date": "soon"}, "next_review_date 'soon' is not a date")):
        res = client.post("/forecast/create", json={"table": "payroll",
                                                    "data": {"employee_id": "G4", **base, **fields}})
        assert res.status_code == 422, (fields, res.text)
        assert message in res.json()["detail"], (fields, res.json())
    assert q(mgr, "SELECT COUNT(*) FROM payroll WHERE employee_id = 'G4'") == [(0,)]

    for updates, message in (({"hourly_rate": "(5)"}, "hourly_rate must be 0 or more, got -5"),
                             ({"end_date": "2026-06-30"}, "end_date 2026-06-30 is before start_date 2027-01-01"),
                             ({"start_date": "2028-01-01", "end_date": "2027-12-31"}, "is before start_date")):
        res = client.post("/forecast/update", json={"table": "payroll", "id": "E1", "updates": updates})
        assert res.status_code == 422, (updates, res.text)
        assert message in res.json()["detail"], (updates, res.json())
    res = client.post("/forecast/update", json={"table": "payroll", "id": "E1",
                                                "updates": {"end_date": "2027-12-31", "weekly_hours": 30}})
    assert res.status_code == 200, res.text
    assert q(mgr, "SELECT end_date, weekly_hours, hourly_rate FROM payroll WHERE employee_id = 'E1'") == [
        ("2027-12-31", 30, 30.0)]


def test_moving_a_row_into_a_locked_scenario_is_filed_under_that_scenario_when_several_are_locked(env):
    client, mgr = env
    draft = client.post("/forecast/scenario", json={"name": "Draft C"}).json()["data"]["forecast_id"]
    conn = sqlite3.connect(mgr.database_path)
    conn.execute("INSERT INTO sales VALUES ('W1', 'C1', 'P1', '2027-01', 1, 1000, 1000, ?)", (draft,))
    conn.commit()
    conn.close()
    approve(client, "F001")
    approve(client, "F002", note="Upside approved")
    res = client.post("/forecast/update", json={"table": "sales", "id": "W1", "updates": {"forecast_id": "F002"}})
    assert res.status_code == 409, res.text
    assert res.json()["forecast_id"] == "F002" and "Upside" in res.json()["detail"]
    assert latest(client)["forecast_id"] == "F002"
    assert q(mgr, "SELECT forecast_id FROM sales WHERE sale_id = 'W1'") == [(draft,)]
