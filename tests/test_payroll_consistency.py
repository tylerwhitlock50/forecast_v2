"""
Payroll consistency: every payroll route reconciles with the statements.

One hourly employee ($30/h x 40h) and one salaried employee (annual salary
120,000), both benefits-eligible, with non-zero employer burden AND non-zero
federal / state withholding rates. Checks, through the REST API and through
the MCP JSON-RPC transport:

* annual cost per employee == gross x the engine's burden multiplier
  (withholding never adds to cost)
* 12 months of the statements' payroll accrual == annual cost
* runs_per_year x per-run cost == annual cost, for every pay frequency
* monthly pay runs == the statements' month-by-month accrual, even with a
  mid-month hire, a leaver and a raise
* department and business-unit totals == the total payroll (allocations in
  percent; fractions are converted, a shortfall is 'Unallocated')
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
from services import financial_statements as fs  # noqa: E402

BASE = "F-PAY"
ALT = "F-ALT"
HIRE = "F-HIRE"

CONFIG = {
    "federal_tax_rate": 0.22, "state_tax_rate": 0.06,
    "social_security_rate": 0.062, "medicare_rate": 0.0145, "unemployment_rate": 0.006,
    "benefits_rate": 0.25, "workers_comp_rate": 0.015, "pay_frequency": "biweekly",
}
EMPLOYER = 0.062 + 0.0145 + 0.006 + 0.015
MULT = 1 + EMPLOYER + 0.25                       # benefits-eligible burden multiplier, 1.3475
WITHHOLDING = 0.22 + 0.06 + 0.062 + 0.0145       # income tax + the employee's matching FICA
HOURLY_GROSS = 30 * 40 * 52                      # 62,400
SALARY_GROSS = 120000.0
HOURLY_COST = HOURLY_GROSS * MULT                # 84,084
SALARY_COST = SALARY_GROSS * MULT                # 161,700
TOTAL_COST = HOURLY_COST + SALARY_COST
RUNS = {"weekly": 52, "biweekly": 26, "semimonthly": 24, "monthly": 12}

HEADERS = {
    "host": "localhost:8000",
    "accept": "application/json, text/event-stream",
    "content-type": "application/json",
}


def _seed(path: str) -> None:
    conn = sqlite3.connect(path)
    c = conn.cursor()
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES (?, 'Budget', 1)", (BASE,))
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES (?, 'Alt', 0)", (ALT,))
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES (?, 'Hiring plan', 0)", (HIRE,))
    c.execute("""INSERT INTO payroll_config (config_id, federal_tax_rate, state_tax_rate, social_security_rate, medicare_rate,
                 unemployment_rate, benefits_rate, workers_comp_rate, pay_frequency)
                 VALUES ('CFG', 0.22, 0.06, 0.062, 0.0145, 0.006, 0.25, 0.015, 'biweekly')""")
    rows = [
        # Company-wide hourly operator, 60/40 between two units.
        ("H1", "Hourly Operator", "Production", 40, 30, "hourly", "2026-01-01", None, None, 0,
         json.dumps({"OEM Work": 60, "Internal Operations": 40}), None),
        # Base-scenario salaried manager; allocations stored as FRACTIONS (legacy MCP input).
        ("S1", "Plant Manager", "Admin", 40, 120000, "salary", "2026-01-01", None, None, 0,
         json.dumps({"Customer-Centric Brands": 0.7, "Other Projects": 0.3}), BASE),
        # Another scenario's hire must never leak into BASE.
        ("X1", "Alt Hire", "Production", 40, 99, "hourly", "2026-01-01", None, None, 0, "{}", ALT),
        # Hiring plan: mid-month hire, a leaver, a raise.
        ("N1", "Mid-month Hire", "Production", 40, 25, "hourly", "2026-03-15", None, None, 0,
         json.dumps({"OEM Work": 50}), HIRE),
        ("N2", "Leaver", "Sales", 32, 90000, "salary", "2026-01-01", "2026-06-20", None, 0,
         json.dumps({"Customer-Centric Brands": 100}), HIRE),
        ("N3", "Raise", "Admin", 40, 80000, "salary", "2026-01-01", None, "2026-07-01", 0.05,
         json.dumps({"Other Projects": 100}), HIRE),
    ]
    for r in rows:
        c.execute("""INSERT INTO payroll (employee_id, employee_name, department, weekly_hours, hourly_rate, rate_type,
                     start_date, end_date, next_review_date, expected_raise, allocations, forecast_id, benefits_eligible)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)""", r)
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


@pytest.fixture(scope="module")
def env():
    tmp = tempfile.mkdtemp()
    path = os.path.join(tmp, "payroll.db")
    mgr = DatabaseManager(database_path=path, data_dir=tmp)
    mgr.initialize()
    _seed(path)
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


def _data(res):
    assert res.status_code == 200, res.text
    return res.json()["data"]


def _set_config(client, **changes):
    assert client.post("/payroll/config", json={**CONFIG, **changes}).status_code == 200


def _statements(mgr, forecast_id, start="2026-01", end="2026-12"):
    conn = mgr.get_connection()
    try:
        return fs.build_statements(conn.cursor(), [forecast_id], start, end)
    finally:
        conn.close()


def _call_tool(client, name, arguments):
    res = client.post("/mcp", headers=HEADERS, follow_redirects=False, json={
        "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments}})
    assert res.status_code == 200, res.text
    result = res.json()["result"]
    text = "".join(b.get("text", "") for b in result.get("content", []) if b.get("type") == "text")
    assert not result.get("isError"), text
    if result.get("structuredContent"):
        payload = result["structuredContent"]
        return payload.get("result", payload)
    return json.loads(text)


# ---------------------------------------------------------------------------
# Per-employee annual cost
# ---------------------------------------------------------------------------

def test_employee_annual_cost_uses_engine_rules(env):
    client, _ = env
    employees = {e["employee_id"]: e for e in _data(client.get(
        "/payroll/employees", params={"forecast_id": BASE, "include_costs": "true"}))["employees"]}
    assert set(employees) == {"H1", "S1"}

    h1, s1 = employees["H1"], employees["S1"]
    assert h1["annual_gross"] == pytest.approx(HOURLY_GROSS)
    assert h1["annual_cost"] == pytest.approx(HOURLY_COST, abs=0.01)
    assert s1["annual_gross"] == pytest.approx(SALARY_GROSS)          # the salary, not salary x 2,080
    assert s1["annual_cost"] == pytest.approx(SALARY_COST, abs=0.01)
    assert s1["rate_basis"] == "annual_salary" and h1["rate_basis"] == "hourly"
    for emp, gross in ((h1, HOURLY_GROSS), (s1, SALARY_GROSS)):
        b = emp["cost_breakdown"]
        assert emp["annual_cost"] == pytest.approx(gross + b["employer_taxes"] + b["benefits"], abs=0.01)
        assert b["withholding"] == pytest.approx(gross * WITHHOLDING, abs=0.01)
        assert b["net_pay"] == pytest.approx(gross * (1 - WITHHOLDING), abs=0.01)
        assert b["burden_multiplier"] == pytest.approx(MULT)
    # Engine helpers give the same figure.
    assert fs.annual_base_pay("salary", 120000, 40) * fs._burden_multiplier(CONFIG, True) == pytest.approx(SALARY_COST)
    # Fractional allocations are reported in percent.
    assert s1["allocations"] == pytest.approx({"Customer-Centric Brands": 70, "Other Projects": 30})


def test_withholding_rates_never_change_employer_cost(env):
    client, mgr = env
    before = _statements(mgr, BASE)["income_statement"]["totals"]["payroll"]
    _set_config(client, federal_tax_rate=0.35, state_tax_rate=0.10)
    try:
        s1 = _data(client.get("/payroll/employees/S1"))["employee"]
        assert s1["annual_cost"] == pytest.approx(SALARY_COST, abs=0.01)
        calc = _data(client.get("/payroll/calculations/S1"))["calculation"]
        assert calc["federal_tax"] == pytest.approx(SALARY_GROSS / 26 * 0.35, abs=0.01)
        assert calc["total_cost"] == pytest.approx(SALARY_COST / 26, abs=0.01)
        assert _statements(mgr, BASE)["income_statement"]["totals"]["payroll"] == pytest.approx(before)
    finally:
        _set_config(client)


# ---------------------------------------------------------------------------
# Statements accrual == annual cost == pay runs
# ---------------------------------------------------------------------------

def test_twelve_months_of_statement_accrual_equal_annual_cost(env):
    client, mgr = env
    stmt = _statements(mgr, BASE)
    assert stmt["income_statement"]["totals"]["payroll"] == pytest.approx(TOTAL_COST, abs=0.05)

    monthly = _data(client.get("/payroll/forecast", params={
        "forecast_id": BASE, "start_period": "2026-01", "end_period": "2026-12"}))
    assert monthly["mode"] == "monthly"
    assert monthly["total_cost"] == pytest.approx(TOTAL_COST, abs=0.05)
    per_employee = {e["employee_id"]: e["total"] for e in monthly["employees"]}
    assert per_employee == pytest.approx({"H1": HOURLY_COST, "S1": SALARY_COST}, abs=0.05)
    jan = monthly["forecast"][0]
    assert jan["gross_pay"] == pytest.approx((HOURLY_GROSS + SALARY_GROSS) / 12, abs=0.01)
    assert jan["total_cost"] == pytest.approx(jan["gross_pay"] + jan["employer_taxes"] + jan["benefits"], abs=0.02)
    assert jan["withholding"] == pytest.approx(jan["gross_pay"] * WITHHOLDING, abs=0.02)
    # Business units split the whole month (fractions converted, never 100x too small).
    assert sum(jan["by_business_unit"].values()) == pytest.approx(jan["total_cost"], abs=0.05)
    assert jan["by_business_unit"]["Customer-Centric Brands"] == pytest.approx(SALARY_COST / 12 * 0.7, abs=0.01)


@pytest.mark.parametrize("frequency", ["weekly", "biweekly", "semimonthly", "monthly"])
def test_pay_runs_per_year_times_run_cost_equal_annual_cost(env, frequency):
    client, _ = env
    runs = RUNS[frequency]
    _set_config(client, pay_frequency=frequency)
    try:
        data = _data(client.get("/payroll/forecast", params={
            "forecast_id": BASE, "periods": runs, "start_date": "2026-03-01", "include_raises": "false"}))
        assert data["pay_frequency"] == frequency and data["runs_per_year"] == runs
        assert len(data["forecast"]) == runs
        tolerance = runs * 0.01  # each run is paid in cents
        assert sum(r["total_cost"] for r in data["forecast"]) == pytest.approx(TOTAL_COST, abs=tolerance)
        assert data["totals"]["total_cost"] == pytest.approx(TOTAL_COST, abs=tolerance)
        first = {d["employee_id"]: d for d in data["forecast"][0]["employee_details"]}
        assert first["S1"]["gross_pay"] * runs == pytest.approx(SALARY_GROSS, abs=tolerance)
        assert first["S1"]["total_cost"] * runs == pytest.approx(SALARY_COST, abs=tolerance)
        assert first["H1"]["total_cost"] * runs == pytest.approx(HOURLY_COST, abs=tolerance)
        assert first["S1"]["withholding"] == pytest.approx(first["S1"]["gross_pay"] * WITHHOLDING, abs=0.02)

        for emp_id, annual in (("S1", SALARY_COST), ("H1", HOURLY_COST)):
            one = _data(client.get(f"/payroll/calculations/{emp_id}"))["calculation"]
            assert one["runs_per_year"] == runs
            assert one["total_cost"] * runs == pytest.approx(annual, abs=tolerance)
            assert one["annual_cost"] == pytest.approx(annual, abs=0.01)
            year = _data(client.get(f"/payroll/calculations/{emp_id}", params={"pay_periods": runs}))["calculation"]
            assert year["total_cost"] == pytest.approx(annual, abs=0.01)
    finally:
        _set_config(client)


def test_monthly_pay_runs_match_statement_accrual_with_hire_leaver_and_raise(env):
    client, mgr = env
    _set_config(client, pay_frequency="monthly")
    try:
        runs = _data(client.get("/payroll/forecast", params={
            "forecast_id": HIRE, "periods": 12, "start_date": "2026-01-01", "include_employees": "false"}))
        assert "employee_details" not in runs["forecast"][0]
        by_month = {r["month"]: r["total_cost"] for r in runs["forecast"]}
        stmt = _statements(mgr, HIRE)
        accrual = {row["period"]: row["payroll"] for row in stmt["income_statement"]["by_period"]}
        assert by_month == pytest.approx(accrual, abs=0.02)
        monthly = _data(client.get("/payroll/forecast", params={
            "forecast_id": HIRE, "start_period": "2026-01", "end_period": "2026-12", "include_employees": "false"}))
        assert "employees" not in monthly
        assert {m["period"]: m["total_cost"] for m in monthly["forecast"]} == pytest.approx(accrual, abs=0.02)
        # The hire is prorated (March 15-31 of 31 days), the raise lands in July.
        n1_march = 25 * 40 * 52 / 12 * 17 / 31 * MULT
        h1_month = HOURLY_COST / 12
        n2_march = 90000 / 12 * MULT
        n3_march = 80000 / 12 * MULT
        assert by_month["2026-03"] == pytest.approx(h1_month + n1_march + n2_march + n3_march, abs=0.05)
        # The leaver is prorated to June 20 (20 of 30 days) and gone in July.
        assert by_month["2026-06"] - by_month["2026-07"] == pytest.approx(
            n2_march * 20 / 30 - 80000 * 0.05 / 12 * MULT, abs=0.05)
        detail = _data(client.get("/payroll/forecast", params={
            "forecast_id": HIRE, "start_period": "2026-06", "end_period": "2026-07"}))
        n3 = next(e for e in detail["employees"] if e["employee_id"] == "N3")["by_period"]
        assert n3["2026-07"] - n3["2026-06"] == pytest.approx(80000 * 0.05 / 12 * MULT, abs=0.01)
    finally:
        _set_config(client)


# ---------------------------------------------------------------------------
# Departments, business units, summary
# ---------------------------------------------------------------------------

def test_departments_reconcile_with_statements(env):
    client, mgr = env
    data = _data(client.get("/payroll/departments", params={
        "forecast_id": BASE, "start_period": "2026-01", "end_period": "2026-12"}))
    depts = {d["department"]: d for d in data["departments"]}
    assert set(depts) == {"Production", "Admin"}
    assert depts["Production"]["total_annual_cost"] == pytest.approx(HOURLY_COST, abs=0.01)
    assert depts["Admin"]["total_annual_cost"] == pytest.approx(SALARY_COST, abs=0.01)
    assert depts["Admin"]["total_annual_gross"] == pytest.approx(SALARY_GROSS)
    assert depts["Admin"]["avg_hourly_rate"] == pytest.approx(SALARY_GROSS / 2080, abs=0.01)
    payroll = _statements(mgr, BASE)["income_statement"]["totals"]["payroll"]
    assert data["window"]["total_cost"] == pytest.approx(payroll, abs=0.05)
    assert sum(d["window_cost"] for d in depts.values()) == pytest.approx(payroll, abs=0.05)
    assert sum(d["total_annual_cost"] for d in depts.values()) == pytest.approx(payroll, abs=0.05)


def test_business_units_reconcile_and_are_not_scaled_down(env):
    client, mgr = env
    data = _data(client.get("/payroll/business-units", params={
        "forecast_id": BASE, "start_period": "2026-01", "end_period": "2026-12"}))
    units = {u["business_unit"]: u for u in data["business_units"]}
    assert units["OEM Work"]["total_annual_cost"] == pytest.approx(HOURLY_COST * 0.6, abs=0.01)
    assert units["Internal Operations"]["total_annual_cost"] == pytest.approx(HOURLY_COST * 0.4, abs=0.01)
    assert units["Customer-Centric Brands"]["total_annual_cost"] == pytest.approx(SALARY_COST * 0.7, abs=0.01)
    assert units["Other Projects"]["total_annual_cost"] == pytest.approx(SALARY_COST * 0.3, abs=0.01)
    assert sum(u["total_annual_cost"] for u in units.values()) == pytest.approx(TOTAL_COST, abs=0.05)
    assert data["total_annual_cost"] == pytest.approx(TOTAL_COST, abs=0.01)
    payroll = _statements(mgr, BASE)["income_statement"]["totals"]["payroll"]
    assert sum(u["window_cost"] for u in units.values()) == pytest.approx(payroll, abs=0.05)
    assert data["allocation_issues"] == []
    assert units["Customer-Centric Brands"]["employees"][0]["allocation_percentage"] == pytest.approx(70)


def test_partial_allocations_go_to_unallocated(env):
    client, _ = env
    data = _data(client.get("/payroll/business-units", params={"forecast_id": HIRE, "include_employees": "false"}))
    units = {u["business_unit"]: u for u in data["business_units"]}
    assert "employees" not in units["OEM Work"]
    n1 = 25 * 40 * 52 * MULT
    assert units["Unallocated"]["total_annual_cost"] == pytest.approx(n1 * 0.5, abs=0.01)
    assert sum(u["total_annual_cost"] for u in units.values()) == pytest.approx(data["total_annual_cost"], abs=0.05)
    assert [i["employee_id"] for i in data["allocation_issues"]] == ["N1"]


def test_summary_defaults_to_base_and_reconciles(env):
    client, mgr = env
    summary = _data(client.get("/payroll/reports/summary", params={
        "start_period": "2026-01", "end_period": "2026-12", "include_employees": "false"}))["summary"]
    assert summary["scope"] == {"forecast_id": BASE, "defaulted": True,
                                "note": "forecast_id omitted: the base scenario (plus company-wide staff) is used"}
    assert summary["total_employees"] == 2                    # the ALT and HIRE staff are not in the base
    assert summary["total_annual_cost"] == pytest.approx(TOTAL_COST, abs=0.01)
    assert summary["total_annual_gross"] + summary["total_employer_taxes"] + summary["total_benefits"] == \
        pytest.approx(summary["total_annual_cost"], abs=0.02)
    assert summary["per_run_cost"] * summary["runs_per_year"] == pytest.approx(TOTAL_COST, abs=0.26)
    assert summary["monthly_cost"] * 12 == pytest.approx(TOTAL_COST, abs=0.06)
    assert summary["total_withholding"] == pytest.approx((HOURLY_GROSS + SALARY_GROSS) * WITHHOLDING, abs=0.02)
    assert summary["window"]["total_cost"] == pytest.approx(
        _statements(mgr, BASE)["income_statement"]["totals"]["payroll"], abs=0.05)
    assert summary["top_department"] == "Admin"
    assert sum(d["total_annual_cost"] for d in summary["departments"]) == pytest.approx(TOTAL_COST, abs=0.02)
    assert "employees" not in summary["departments"][0]


def test_unknown_scenario_is_rejected(env):
    client, _ = env
    for path in ("/payroll/forecast", "/payroll/departments", "/payroll/business-units", "/payroll/reports/summary"):
        res = client.get(path, params={"forecast_id": "NOPE"})
        assert res.status_code == 404 and "NOPE" in res.json()["detail"], path


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------

def _employee(**changes):
    body = {"employee_name": "New", "department": "Ops", "weekly_hours": 40, "hourly_rate": 85000,
            "rate_type": "salary", "labor_type": "Mgmt", "start_date": "2026-01-31", "forecast_id": ALT,
            "allocations": {"OEM Work": 0.25, "Other Projects": 0.75}}
    body.update(changes)
    return body


def test_writes_normalize_allocations_and_validate(env):
    client, mgr = env
    first = _data(client.post("/payroll/employees", json=_employee()))
    second = _data(client.post("/payroll/employees", json=_employee(employee_name="Same second")))
    assert first["employee_id"] != second["employee_id"]
    assert "warnings" not in first
    conn = mgr.get_connection()
    try:
        stored, review = conn.execute("SELECT allocations, next_review_date FROM payroll WHERE employee_id = ?",
                                      (first["employee_id"],)).fetchone()
    finally:
        conn.close()
    assert json.loads(stored) == {"OEM Work": 25.0, "Other Projects": 75.0}
    assert review == "2027-01-31"  # calendar year, not +365 days

    low = _data(client.post("/payroll/employees", json=_employee(hourly_rate=45)))
    assert "hourly equivalent" in low["warnings"][0]
    high = _data(client.post("/payroll/employees", json=_employee(rate_type="hourly", hourly_rate=95000)))
    assert "rate_type 'salary'" in high["warnings"][0]

    assert client.post("/payroll/employees", json=_employee(rate_type="weekly")).status_code == 422
    res = client.post("/payroll/employees", json=_employee(forecast_id="NOPE"))
    assert res.status_code == 422 and "NOPE" in res.json()["detail"]
    assert client.post("/payroll/employees", json=_employee(start_date="next week")).status_code == 422

    res = client.put(f"/payroll/employees/{first['employee_id']}/allocations", json={"OEM Work": 0.5, "Other Projects": 0.5})
    assert _data(res)["allocations"] == {"OEM Work": 50.0, "Other Projects": 50.0}
    assert client.put(f"/payroll/employees/{first['employee_id']}/allocations", json={"OEM Work": 40}).status_code == 400

    bulk = _data(client.post("/payroll/bulk-update", json=[
        {"employee_id": first["employee_id"], "weekly_hours": 35},
        {"employee_id": first["employee_id"], "hourly_rate = 0; --": 1},
        {"employee_id": "missing", "weekly_hours": 1},
    ]))
    assert bulk["updated_count"] == 1
    assert len(bulk["errors"]) == 2 and "unknown field" in bulk["errors"][0]

    for emp_id in (first["employee_id"], second["employee_id"], low["employee_id"], high["employee_id"]):
        assert client.delete(f"/payroll/employees/{emp_id}").status_code == 200


def test_config_reports_burden_and_withholding(env):
    client, _ = env
    data = _data(client.get("/payroll/config"))
    assert data["config"]["federal_tax_rate"] == 0.22
    assert data["burden"]["multiplier_benefits_eligible"] == pytest.approx(MULT)
    assert data["burden"]["multiplier_not_eligible"] == pytest.approx(1 + EMPLOYER)
    assert "federal_tax_rate" in data["burden"]["withholding_keys"]
    assert "not an employer cost" in data["burden"]["note"]


# ---------------------------------------------------------------------------
# The same numbers over the MCP transport
# ---------------------------------------------------------------------------

def test_mcp_payroll_tools_reconcile(env):
    client, mgr = env
    payroll = _statements(mgr, BASE)["income_statement"]["totals"]["payroll"]
    monthly = _call_tool(client, "forecast_payroll_forecast", {
        "forecast_id": BASE, "start_period": "2026-01", "end_period": "2026-12"})
    assert monthly["total_cost"] == pytest.approx(payroll, abs=0.05)
    summary = _call_tool(client, "forecast_payroll_summary", {})["summary"]
    assert summary["total_annual_cost"] == pytest.approx(TOTAL_COST, abs=0.01)
    assert summary["scope"]["forecast_id"] == BASE
