"""
Payroll API for W4: labor_class on employees, the statement-vs-pay-dates
bridge, and the pay-run forecast horizon.

Reviewer's evidence reproduced here:
* there was no way to class an employee as direct / indirect / admin;
* statement payroll is accrued by month while payroll cash goes out on pay
  dates, and nothing reconciled the two;
* the pay-run view defaulted to 26 runs even for monthly pay (26 months).
"""
import json
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
from services import financial_statements as fs  # noqa: E402

BASE = "F-BR"
OTHER = "F-OTHER"
ZERO_BURDEN = {
    "federal_tax_rate": 0, "state_tax_rate": 0, "social_security_rate": 0, "medicare_rate": 0,
    "unemployment_rate": 0, "benefits_rate": 0, "workers_comp_rate": 0,
}
ANNUAL = 26 * 40 * 52            # 54,080 a year for E1 ($26/h x 40 h)
PER_BIWEEKLY_RUN = ANNUAL / 26   # 2,080
MONTHLY_ACCRUAL = ANNUAL / 12    # 4,506.67


def _seed(path: str) -> None:
    conn = sqlite3.connect(path)
    c = conn.cursor()
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES (?, 'Budget', 1)", (BASE,))
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES (?, 'Other', 0)", (OTHER,))
    c.execute("""INSERT INTO payroll_config (config_id, federal_tax_rate, state_tax_rate, social_security_rate, medicare_rate,
                 unemployment_rate, benefits_rate, workers_comp_rate, pay_frequency)
                 VALUES ('CFG', 0, 0, 0, 0, 0, 0, 0, 'biweekly')""")
    c.execute("""INSERT INTO payroll (employee_id, employee_name, department, weekly_hours, hourly_rate, rate_type, labor_type,
                 start_date, benefits_eligible, labor_class, forecast_id)
                 VALUES ('E1', 'Erin Assembler', 'Production', 40, 26, 'hourly', 'Production', '2020-01-01', 0, 'direct', NULL)""")
    c.execute("""INSERT INTO payroll (employee_id, employee_name, department, weekly_hours, hourly_rate, rate_type, labor_type,
                 start_date, benefits_eligible, labor_class, forecast_id)
                 VALUES ('X1', 'Other Scenario', 'Admin', 40, 99, 'hourly', 'Admin', '2020-01-01', 0, NULL, ?)""", (OTHER,))
    conn.commit()
    conn.close()


@pytest.fixture(scope="module")
def api():
    tmp = tempfile.mkdtemp()
    path = os.path.join(tmp, "payroll_api.db")
    mgr = DatabaseManager(database_path=path, data_dir=tmp)
    mgr.initialize()
    _seed(path)
    from api import payroll_routes
    original = payroll_routes.db_manager
    payroll_routes.db_manager = mgr
    app = FastAPI()
    app.include_router(payroll_routes.router)
    try:
        yield TestClient(app), mgr
    finally:
        payroll_routes.db_manager = original
        mgr.close_all_connections()
        shutil.rmtree(tmp, ignore_errors=True)


def _data(res):
    assert res.status_code == 200, res.text
    return res.json()["data"]


def _frequency(client, frequency):
    assert client.post("/payroll/config", json={**ZERO_BURDEN, "pay_frequency": frequency}).status_code == 200


def _employee(**overrides):
    body = {"employee_name": "New Hire", "department": "Production", "weekly_hours": 40, "hourly_rate": 20,
            "rate_type": "hourly", "labor_type": "Production", "start_date": "2027-01-01", "benefits_eligible": False,
            "forecast_id": BASE}
    body.update(overrides)
    return body


# ---------------------------------------------------------------------------
# labor_class on create / update / list
# ---------------------------------------------------------------------------

def test_create_validates_and_normalises_labor_class(api):
    client, _mgr = api
    created = _data(client.post("/payroll/employees", json=_employee(labor_class="Indirect")))
    emp = _data(client.get(f"/payroll/employees/{created['employee_id']}"))["employee"]
    assert emp["labor_class"] == "indirect"

    bad = client.post("/payroll/employees", json=_employee(labor_class="supervisor"))
    assert bad.status_code == 422
    assert "direct, indirect or admin" in bad.json()["detail"]

    blank = _data(client.post("/payroll/employees", json=_employee(employee_name="No Class", labor_class="")))
    assert _data(client.get(f"/payroll/employees/{blank['employee_id']}"))["employee"]["labor_class"] is None


def test_update_keeps_labor_class_unless_it_is_sent(api):
    client, _mgr = api
    emp_id = _data(client.post("/payroll/employees", json=_employee(employee_name="Keeper", labor_class="direct")))["employee_id"]
    body = _employee(employee_name="Keeper", hourly_rate=22)        # an older client that knows nothing of labor_class
    assert client.put(f"/payroll/employees/{emp_id}", json=body).status_code == 200
    assert _data(client.get(f"/payroll/employees/{emp_id}"))["employee"]["labor_class"] == "direct"

    assert client.put(f"/payroll/employees/{emp_id}", json={**body, "labor_class": "ADMIN"}).status_code == 200
    assert _data(client.get(f"/payroll/employees/{emp_id}"))["employee"]["labor_class"] == "admin"

    assert client.put(f"/payroll/employees/{emp_id}", json={**body, "labor_class": None}).status_code == 200
    assert _data(client.get(f"/payroll/employees/{emp_id}"))["employee"]["labor_class"] is None

    bad = client.put(f"/payroll/employees/{emp_id}", json={**body, "labor_class": "factory"})
    assert bad.status_code == 422


def test_list_shows_and_filters_labor_class(api):
    client, _mgr = api
    employees = _data(client.get("/payroll/employees", params={"forecast_id": BASE}))["employees"]
    assert all("labor_class" in e for e in employees)
    direct = _data(client.get("/payroll/employees", params={"forecast_id": BASE, "labor_class": "direct"}))["employees"]
    assert direct and all(e["labor_class"] == "direct" for e in direct)
    unclassified = _data(client.get("/payroll/employees", params={"labor_class": "unclassified"}))["employees"]
    assert unclassified and all(e["labor_class"] is None for e in unclassified)
    assert client.get("/payroll/employees", params={"labor_class": "bogus"}).status_code == 422


def test_bulk_update_validates_labor_class(api):
    client, _mgr = api
    res = _data(client.post("/payroll/bulk-update", json=[
        {"employee_id": "E1", "labor_class": "nonsense"},
    ]))
    assert res["updated_count"] == 0 and "direct, indirect or admin" in res["errors"][0]
    res = _data(client.post("/payroll/bulk-update", json=[{"employee_id": "E1", "labor_class": "Direct"}]))
    assert res["updated_count"] == 1
    assert _data(client.get("/payroll/employees/E1"))["employee"]["labor_class"] == "direct"


def test_monthly_forecast_and_summary_split_by_class(api):
    client, _mgr = api
    _frequency(client, "monthly")
    data = _data(client.get("/payroll/forecast", params={"forecast_id": BASE, "start_period": "2027-01",
                                                          "end_period": "2027-02", "include_employees": "false"}))
    jan = data["forecast"][0]
    assert set(jan["by_labor_class"]) == {"direct", "indirect", "admin", "unclassified"}
    assert sum(jan["by_labor_class"].values()) == pytest.approx(jan["total_cost"], abs=0.02)
    summary = _data(client.get("/payroll/reports/summary", params={"forecast_id": BASE,
                                                                    "include_employees": "false"}))["summary"]
    classes = summary["labor_classes"]
    assert classes["direct"]["employee_count"] >= 1
    assert sum(c["total_annual_cost"] for c in classes.values()) == pytest.approx(summary["total_annual_cost"], abs=0.05)


# ---------------------------------------------------------------------------
# Pay-run horizon
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("frequency, runs", [("monthly", 12), ("semimonthly", 24), ("biweekly", 26), ("weekly", 52)])
def test_pay_run_forecast_defaults_to_one_year_of_runs(api, frequency, runs):
    client, _mgr = api
    _frequency(client, frequency)
    data = _data(client.get("/payroll/forecast", params={"forecast_id": BASE, "start_date": "2027-01-01",
                                                          "include_employees": "false"}))
    assert data["runs_per_year"] == runs
    assert len(data["forecast"]) == runs
    assert data["periods"] == runs and data["horizon_default"] is True
    explicit = _data(client.get("/payroll/forecast", params={"forecast_id": BASE, "start_date": "2027-01-01",
                                                              "periods": 5, "include_employees": "false"}))
    assert len(explicit["forecast"]) == 5 and explicit["horizon_default"] is False


# ---------------------------------------------------------------------------
# Statement vs pay dates bridge
# ---------------------------------------------------------------------------

def _e1_only(api):
    """Remove every employee except E1 and X1 (other scenario) so the bridge arithmetic is E1's."""
    _client, mgr = api
    conn = mgr.get_connection()
    try:
        conn.execute("DELETE FROM payroll WHERE employee_id NOT IN ('E1', 'X1')")
        conn.commit()
    finally:
        conn.close()


def test_bridge_monthly_pay_matches_the_accrual(api):
    client, _mgr = api
    _e1_only(api)
    _frequency(client, "monthly")
    data = _data(client.get("/payroll/statement-bridge", params={"forecast_id": BASE, "start_period": "2027-01",
                                                                  "end_period": "2027-03"}))
    assert data["pay_frequency"] == "monthly"
    assert data["opening_accrued_payroll"] == 0
    for row in data["by_period"]:
        assert row["accrued"] == pytest.approx(MONTHLY_ACCRUAL, abs=0.01)
        assert row["paid"] == pytest.approx(MONTHLY_ACCRUAL, abs=0.01)
        assert row["difference"] == pytest.approx(0, abs=0.01)
        assert row["pay_runs"] == 1
    assert "evenly" in data["note"]


def test_bridge_biweekly_shows_the_timing_difference(api):
    client, mgr = api
    _e1_only(api)
    _frequency(client, "biweekly")
    data = _data(client.get("/payroll/statement-bridge", params={"forecast_id": BASE, "start_period": "2027-01",
                                                                  "end_period": "2027-03"}))
    rows = {r["period"]: r for r in data["by_period"]}
    # Fridays from 1 Jan 2027: Jan 1, 15, 29 / Feb 12, 26 / Mar 12, 26.
    assert [rows[p]["pay_runs"] for p in ("2027-01", "2027-02", "2027-03")] == [3, 2, 2]
    assert rows["2027-01"]["pay_dates"] == ["2027-01-01", "2027-01-15", "2027-01-29"]
    assert rows["2027-01"]["paid"] == pytest.approx(3 * PER_BIWEEKLY_RUN, abs=0.01)
    assert rows["2027-01"]["accrued"] == pytest.approx(MONTHLY_ACCRUAL, abs=0.01)
    assert rows["2027-01"]["difference"] == pytest.approx(MONTHLY_ACCRUAL - 3 * PER_BIWEEKLY_RUN, abs=0.01)
    # The 1 Jan run pays 19 Dec - 1 Jan: 13 of its 14 days were worked before the window.
    assert data["opening_accrued_payroll"] == pytest.approx(13 / 14 * PER_BIWEEKLY_RUN, abs=0.01)
    running = 0.0
    for p in ("2027-01", "2027-02", "2027-03"):
        r = rows[p]
        running += r["accrued"] - r["paid"]
        assert r["difference"] == pytest.approx(r["accrued"] - r["paid"], abs=0.01)
        assert r["cumulative_difference"] == pytest.approx(running, abs=0.02)
        assert r["accrued_payroll_balance"] == pytest.approx(data["opening_accrued_payroll"] + running, abs=0.02)
    totals = data["totals"]
    assert totals["accrued"] == pytest.approx(3 * MONTHLY_ACCRUAL, abs=0.02)
    assert totals["paid"] == pytest.approx(7 * PER_BIWEEKLY_RUN, abs=0.02)
    # Accrued ties to the statements' payroll for the same scope (company-wide E1 only).
    conn = mgr.get_connection()
    try:
        result = fs.payroll_by_period(conn.cursor(), [BASE], ["2027-01", "2027-02", "2027-03"])
    finally:
        conn.close()
    assert totals["accrued"] == pytest.approx(sum(result["total"].values()), abs=0.02)
    assert rows["2027-01"]["accrued_by_class"]["direct"] == pytest.approx(MONTHLY_ACCRUAL, abs=0.01)


def test_bridge_full_year_with_27_fridays(api):
    """2027 has 27 biweekly Fridays from 1 Jan: a year of pay dates pays one run more than the accrual."""
    client, _mgr = api
    _e1_only(api)
    _frequency(client, "biweekly")
    data = _data(client.get("/payroll/statement-bridge", params={"forecast_id": BASE, "start_period": "2027-01",
                                                                  "end_period": "2027-12"}))
    assert sum(r["pay_runs"] for r in data["by_period"]) == 27
    assert data["totals"]["paid"] - data["totals"]["accrued"] == pytest.approx(PER_BIWEEKLY_RUN, abs=0.05)


def test_bridge_validates_its_inputs(api):
    client, _mgr = api
    # No window: the scenario's sales years, else the current calendar year (no sales here).
    data = _data(client.get("/payroll/statement-bridge", params={"forecast_id": BASE}))
    assert data["window_default"] is True and len(data["by_period"]) == 12
    assert data["start_period"].endswith("-01") and data["end_period"].endswith("-12")
    assert client.get("/payroll/statement-bridge", params={"forecast_id": BASE, "start_period": "2027-01"}).status_code == 422
    assert client.get("/payroll/statement-bridge", params={"forecast_id": BASE, "start_period": "2027-05",
                                                           "end_period": "2027-01"}).status_code == 422
    assert client.get("/payroll/statement-bridge", params={"forecast_id": "NOPE", "start_period": "2027-01",
                                                           "end_period": "2027-02"}).status_code == 404


# ---------------------------------------------------------------------------
# MCP tools
# ---------------------------------------------------------------------------

HEADERS = {"host": "localhost:8000", "accept": "application/json, text/event-stream",
           "content-type": "application/json"}


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


@pytest.fixture(scope="module")
def mcp():
    tmp = tempfile.mkdtemp()
    path = os.path.join(tmp, "payroll_mcp.db")
    mgr = DatabaseManager(database_path=path, data_dir=tmp)
    mgr.initialize()
    _seed(path)
    from app.main import app as fastapi_app
    originals = _patch_db_manager(mgr)
    try:
        with TestClient(fastapi_app) as client:
            yield client
    finally:
        for name, original in originals.items():
            sys.modules[name].db_manager = original
        mgr.close_all_connections()
        shutil.rmtree(tmp, ignore_errors=True)


def _tool(client, name, arguments):
    res = client.post("/mcp", headers=HEADERS, follow_redirects=False, json={
        "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments}})
    assert res.status_code == 200, res.text
    result = res.json()["result"]
    text = "".join(b.get("text", "") for b in result.get("content", []) if b.get("type") == "text")
    if result.get("isError"):
        return text, True
    return json.loads(text), False


def _ok(client, name, arguments):
    payload, is_error = _tool(client, name, arguments)
    assert not is_error, payload
    return payload


def test_mcp_employee_tools_carry_labor_class(mcp):
    created = _ok(mcp, "forecast_create_employee", {
        "employee_name": "Mo Maintenance", "department": "Maintenance", "weekly_hours": 40, "hourly_rate": 31,
        "labor_type": "Maintenance", "start_date": "2027-01-01", "labor_class": "indirect", "forecast_id": BASE})
    emp_id = created["employee_id"]
    assert _ok(mcp, "forecast_get_employee", {"employee_id": emp_id})["employee"]["labor_class"] == "indirect"
    _ok(mcp, "forecast_update_employee", {"employee_id": emp_id, "updates": {"hourly_rate": 32}})
    assert _ok(mcp, "forecast_get_employee", {"employee_id": emp_id})["employee"]["labor_class"] == "indirect"
    _ok(mcp, "forecast_update_employee", {"employee_id": emp_id, "updates": {"labor_class": "direct"}})
    assert _ok(mcp, "forecast_get_employee", {"employee_id": emp_id})["employee"]["labor_class"] == "direct"
    text, is_error = _tool(mcp, "forecast_create_employee", {
        "employee_name": "Bad", "department": "X", "weekly_hours": 40, "hourly_rate": 20, "labor_type": "X",
        "start_date": "2027-01-01", "labor_class": "supervisor"})
    assert is_error and "direct, indirect or admin" in text
    listed = _ok(mcp, "forecast_list_employees", {"forecast_id": BASE, "labor_class": "direct"})
    assert listed["employees"] and all(e["labor_class"] == "direct" for e in listed["employees"])


def test_mcp_bridge_and_default_horizon(mcp):
    bridge = _ok(mcp, "forecast_payroll_statement_bridge", {"forecast_id": BASE, "start_period": "2027-01",
                                                            "end_period": "2027-03"})
    assert len(bridge["by_period"]) == 3 and "accrued_payroll_balance" in bridge["by_period"][0]
    runs = _ok(mcp, "forecast_payroll_forecast", {"forecast_id": BASE, "start_date": "2027-01-01"})
    assert len(runs["forecast"]) == runs["runs_per_year"]
