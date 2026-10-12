"""
Scenario lifecycle tests: enriched listing, create / update / mark base,
server-side branching with overrides, cascading delete, comparison over a
shared window, and NULL-inclusive scoping on the module screens' reads.
"""
import os
import sys
import tempfile
import shutil
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
import sqlite3 as _sqlite3

_APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir, "app"))
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from app.db.database import DatabaseManager  # noqa: E402


def _seed(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("INSERT INTO forecast (forecast_id, name, description, notes, is_base) VALUES ('F001', 'Base', 'desc', 'some notes', 1)")
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F002', 'Other', 0)")
    c.execute("INSERT INTO customers (customer_id, customer_name) VALUES ('C1', 'Acme')")
    c.execute("INSERT INTO units (unit_id, unit_name, base_price) VALUES ('P1', 'Widget', 100)")
    c.execute("INSERT INTO units (unit_id, unit_name, base_price) VALUES ('P2', 'Gadget', 50)")
    # Two lines in the base scenario, Jan-Feb 2026; P2 only in Feb.
    c.execute("INSERT INTO sales VALUES ('S1','C1','P1','2026-01',10,100,1000,'F001')")
    c.execute("INSERT INTO sales VALUES ('S2','C1','P1','2026-02',20,100,2000,'F001')")
    c.execute("INSERT INTO sales VALUES ('S3','C1','P2','2026-02',4,50,200,'F001')")
    c.execute("INSERT INTO sales VALUES ('S4','C1','P1','2026-03',5,100,500,'F002')")
    c.execute("INSERT INTO expense_categories (category_id, category_name, category_type) VALUES ('AD', 'Software', 'admin_expense')")
    c.execute("""INSERT INTO expenses (expense_id, expense_name, category_id, amount, frequency, start_date, is_active, forecast_id)
                 VALUES ('X1', 'Scenario tool', 'AD', 100, 'monthly', '2026-01-01', 1, 'F001')""")
    c.execute("""INSERT INTO expenses (expense_id, expense_name, category_id, amount, frequency, start_date, is_active, forecast_id)
                 VALUES ('X2', 'Rent', 'AD', 300, 'monthly', '2026-01-01', 1, NULL)""")
    c.execute("""INSERT INTO expense_allocations (allocation_id, expense_id, period, allocated_amount, allocation_type, payment_status, payment_date, actual_amount)
                 VALUES ('A1', 'X1', '2026-01', 100, 'scheduled', 'paid', '2026-01-15', 98.5)""")
    c.execute("""INSERT INTO payroll (employee_id, employee_name, department, weekly_hours, hourly_rate, rate_type, start_date, benefits_eligible, forecast_id)
                 VALUES ('E1', 'Pat', 'Ops', 40, 30, 'hourly', '2026-01-01', 0, 'F001')""")
    c.execute("""INSERT INTO payroll (employee_id, employee_name, department, weekly_hours, hourly_rate, rate_type, start_date, benefits_eligible, forecast_id)
                 VALUES ('E2', 'Sam', 'Ops', 40, 30, 'hourly', '2026-01-01', 0, NULL)""")
    c.execute("""INSERT INTO payroll (employee_id, employee_name, department, weekly_hours, hourly_rate, rate_type, start_date, benefits_eligible, forecast_id)
                 VALUES ('E3', 'Lee', 'Ops', 40, 30, 'hourly', '2026-01-01', 0, 'F002')""")
    c.execute("""INSERT INTO capital_expenditures (capex_id, forecast_id, asset_name, amount, purchase_period, useful_life_months)
                 VALUES ('CX1', 'F001', 'Lathe', 1200, '2026-02', 12)""")
    c.execute("""INSERT INTO financial_assumptions (forecast_id, opening_cash, dso_days, dio_days, dpo_days, income_tax_rate)
                 VALUES ('F001', 5000, 45, 30, 30, 0.2)""")
    conn.commit()
    conn.close()


@pytest.fixture()
def client():
    tmp = tempfile.mkdtemp()
    db_path = os.path.join(tmp, "scenarios.db")
    mgr = DatabaseManager(database_path=db_path, data_dir=tmp)
    mgr.initialize()
    _seed(db_path)

    import app.db.database as dbmod
    import db.database as dbmod_short
    originals = (dbmod.db_manager, dbmod_short.db_manager)
    dbmod.db_manager = mgr
    dbmod_short.db_manager = mgr
    from api import forecast_routes, payroll_routes, expense_routes, data_routes
    payroll_routes.db_manager = mgr
    expense_routes.db_manager = mgr
    app = FastAPI()
    for module in (forecast_routes, payroll_routes, expense_routes, data_routes):
        app.include_router(module.router)
    yield TestClient(app)
    dbmod.db_manager, dbmod_short.db_manager = originals
    mgr.close_all_connections()
    shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------------------
# Listing / create / update
# ---------------------------------------------------------------------------

def test_list_is_enriched_and_base_first(client):
    res = client.get("/forecast/scenarios")
    assert res.status_code == 200
    scenarios = res.json()["data"]["scenarios"]
    assert [s["forecast_id"] for s in scenarios] == ["F001", "F002"]
    base = scenarios[0]
    assert base["is_base"] is True
    assert base["sales_rows"] == 3
    assert base["sales_lines"] == 2
    assert base["start_period"] == "2026-01" and base["end_period"] == "2026-02"
    assert base["revenue_total"] == 3200
    assert base["expense_count"] == 1          # company-wide Rent is not counted as scenario-specific
    assert base["employee_count"] == 1
    assert base["capex_count"] == 1
    assert base["has_assumptions"] is True
    other = scenarios[1]
    assert other["has_assumptions"] is False and other["sales_lines"] == 1


def test_create_update_and_mark_base(client):
    created = client.post("/forecast/scenario", json={"name": "  Upside ", "description": "d"}).json()["data"]
    assert created["forecast_id"] == "F003"
    assert created["name"] == "Upside"
    assert created["is_base"] is False

    res = client.put("/forecast/scenario/F003", json={"name": "Upside 2", "notes": "n", "is_base": True})
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["name"] == "Upside 2" and data["notes"] == "n" and data["is_base"] is True
    # exactly one base
    scenarios = client.get("/forecast/scenarios").json()["data"]["scenarios"]
    assert [s["forecast_id"] for s in scenarios if s["is_base"]] == ["F003"]

    assert client.put("/forecast/scenario/F003", json={"name": "  "}).status_code == 422
    assert client.put("/forecast/scenario/NOPE", json={"name": "x"}).status_code == 404


def test_first_scenario_in_empty_database_becomes_base(client):
    for fid in ("F001", "F002"):
        client.delete(f"/forecast/scenario/{fid}")
    created = client.post("/forecast/scenario", json={"name": "Fresh"}).json()["data"]
    assert created["is_base"] is True
    assert created["forecast_id"] == "F001"


# ---------------------------------------------------------------------------
# Branching
# ---------------------------------------------------------------------------

def test_duplicate_copies_everything_and_applies_overrides(client):
    res = client.post(
        "/forecast/scenario/F001/duplicate",
        json={"name": "Branch", "price_multiplier": 1.1, "quantity_multiplier": 2, "extend_periods": 2},
    )
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    new_id = data["forecast_id"]
    assert new_id == "F003"
    assert data["source_forecast_id"] == "F001"
    assert data["notes"] == "some notes"
    assert data["is_base"] is False
    # 3 copied rows + 2 lines x 2 extended months
    assert data["copied"] == {"sales": 3, "sales_extended": 4, "expenses": 1, "employees": 1, "capex": 1, "assumptions": True}
    assert data["sales_rows"] == 7
    assert data["start_period"] == "2026-01" and data["end_period"] == "2026-04"

    sales = client.get("/data/sales", params={"forecast_id": new_id}).json()["data"]
    by_key = {(s["unit_id"], s["period"]): s for s in sales}
    jan = by_key[("P1", "2026-01")]
    assert jan["quantity"] == 20 and abs(jan["unit_price"] - 110) < 1e-9 and abs(jan["total_revenue"] - 2200) < 1e-9
    # extension repeats the last month's lines (after multipliers)
    assert by_key[("P1", "2026-04")]["quantity"] == 40
    assert by_key[("P2", "2026-03")]["quantity"] == 8
    # source untouched
    src = client.get("/data/sales", params={"forecast_id": "F001"}).json()["data"]
    assert sorted(s["quantity"] for s in src) == [4, 10, 20]

    # assumptions, capex and expenses (with allocations) exist on the branch
    assert client.get("/forecast/scenario/" + new_id).json()["data"]["has_assumptions"] is True
    expenses = client.get("/expenses/", params={"forecast_id": new_id}).json()["data"]["expenses"]
    names = sorted(e["expense_name"] for e in expenses)
    assert names == ["Rent", "Scenario tool"]      # own copy + company-wide
    branch_expense = next(e for e in expenses if e["expense_name"] == "Scenario tool")
    assert branch_expense["expense_id"] != "X1"
    allocs = client.get("/expenses/allocations", params={"expense_id": branch_expense["expense_id"]}).json()["data"]["allocations"]
    assert len(allocs) == 1
    # payment details travel with the allocation
    assert allocs[0]["payment_status"] == "paid"
    assert allocs[0]["payment_date"] == "2026-01-15"
    assert allocs[0]["actual_amount"] == 98.5


def test_duplicate_defaults_and_validation(client):
    res = client.post("/forecast/scenario/F001/duplicate", json={})
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["name"] == "Base Copy"
    assert data["copied"]["sales_extended"] == 0
    assert data["overrides"] == {"price_multiplier": 1.0, "quantity_multiplier": 1.0, "extend_periods": 0}
    assert client.post("/forecast/scenario/F001/duplicate", json={"price_multiplier": 0}).status_code == 422
    assert client.post("/forecast/scenario/F001/duplicate", json={"extend_periods": -1}).status_code == 422
    assert client.post("/forecast/scenario/NOPE/duplicate", json={}).status_code == 404


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

def test_delete_cascades_scenario_rows_only(client):
    res = client.delete("/forecast/scenario/F001")
    assert res.status_code == 200
    assert res.json()["data"]["deleted"] == {"sales": 3, "expenses": 1, "employees": 1, "capex": 1, "assumptions": True}

    ids = [s["forecast_id"] for s in client.get("/forecast/scenarios").json()["data"]["scenarios"]]
    assert ids == ["F002"]
    assert client.get("/data/sales", params={"forecast_id": "F001"}).json()["data"] == []
    # company-wide rows survive
    employees = client.get("/payroll/employees").json()["data"]["employees"]
    assert sorted(e["employee_name"] for e in employees) == ["Lee", "Sam"]
    expenses = client.get("/expenses/").json()["data"]["expenses"]
    assert [e["expense_name"] for e in expenses] == ["Rent"]
    assert client.get("/expenses/allocations", params={"expense_id": "X1"}).json()["data"]["allocations"] == []
    assert client.get("/forecast/scenario/F001").status_code == 404
    assert client.delete("/forecast/scenario/F001").status_code == 404


# ---------------------------------------------------------------------------
# Scoping: module screens must show what the statements engine uses
# ---------------------------------------------------------------------------

def test_scoped_reads_include_company_wide_rows(client):
    employees = client.get("/payroll/employees", params={"forecast_id": "F001"}).json()["data"]["employees"]
    assert sorted(e["employee_name"] for e in employees) == ["Pat", "Sam"]
    generic = client.get("/data/payroll", params={"forecast_id": "F001"}).json()["data"]
    assert sorted(e["employee_name"] for e in generic) == ["Pat", "Sam"]
    expenses = client.get("/expenses/", params={"forecast_id": "F002"}).json()["data"]["expenses"]
    assert [e["expense_name"] for e in expenses] == ["Rent"]
    # sales never include NULL rows
    sales = client.get("/data/sales", params={"forecast_id": "F002"}).json()["data"]
    assert [s["sale_id"] for s in sales] == ["S4"]


def test_expense_summary_is_scoped(client):
    data = client.get("/expenses/summary", params={"forecast_id": "F001"}).json()["data"]
    assert data["expense_count"] == 2 and data["company_wide_count"] == 1
    assert data["total_annual"] == 4800 and data["total_monthly"] == 400
    data = client.get("/expenses/summary", params={"forecast_id": "F002"}).json()["data"]
    assert data["expense_count"] == 1 and data["total_annual"] == 3600


def test_scope_can_be_changed_on_update(client):
    # employee: pin company-wide Sam to F002
    emp = client.get("/payroll/employees/E2").json()["data"]["employee"]
    payload = {k: emp[k] for k in ("employee_name", "department", "weekly_hours", "hourly_rate", "rate_type",
                                   "start_date", "end_date", "next_review_date", "expected_raise", "benefits_eligible", "allocations")}
    payload["labor_type"] = emp.get("labor_type") or "Ops"
    payload["forecast_id"] = "F002"
    assert client.put("/payroll/employees/E2", json=payload).status_code == 200
    names = sorted(e["employee_name"] for e in client.get("/payroll/employees", params={"forecast_id": "F001"}).json()["data"]["employees"])
    assert names == ["Pat"]

    # expense: make the scenario tool company-wide with an explicit null
    assert client.put("/expenses/X1", json={"forecast_id": None}).status_code == 200
    names = sorted(e["expense_name"] for e in client.get("/expenses/", params={"forecast_id": "F002"}).json()["data"]["expenses"])
    assert names == ["Rent", "Scenario tool"]


# ---------------------------------------------------------------------------
# Comparison
# ---------------------------------------------------------------------------

def test_comparison_uses_one_shared_window(client):
    res = client.get("/forecast/comparison", params={"forecast_ids": "F001,F002"})
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["window"] == {"start_period": "2026-01", "end_period": "2026-03"}
    rows = {r["forecast_id"]: r for r in data["comparison"]}
    assert rows["F001"]["start_period"] == "2026-01" and rows["F001"]["end_period"] == "2026-03"
    assert rows["F002"]["start_period"] == "2026-01" and rows["F002"]["end_period"] == "2026-03"
    assert rows["F001"]["is_base"] is True and rows["F002"]["is_base"] is False
    assert rows["F001"]["revenue"] == 3200
    assert rows["F002"]["revenue"] == 500

    explicit = client.get("/forecast/comparison", params={"forecast_ids": "F001", "start_period": "2026-02", "end_period": "2026-02"}).json()["data"]
    assert explicit["comparison"][0]["revenue"] == 2200
    assert client.get("/forecast/comparison", params={"forecast_ids": "F001", "start_period": "2026-02"}).status_code == 422


# ---------------------------------------------------------------------------
# Single-base invariant
# ---------------------------------------------------------------------------

def test_cannot_clear_the_only_base(client):
    res = client.put("/forecast/scenario/F001", json={"is_base": False})
    assert res.status_code == 422
    bases = [s["forecast_id"] for s in client.get("/forecast/scenarios").json()["data"]["scenarios"] if s["is_base"]]
    assert bases == ["F001"]
    # moving the flag is the way to change it
    assert client.put("/forecast/scenario/F002", json={"is_base": True}).status_code == 200
    bases = [s["forecast_id"] for s in client.get("/forecast/scenarios").json()["data"]["scenarios"] if s["is_base"]]
    assert bases == ["F002"]
    # unsetting a non-base scenario is a harmless no-op
    assert client.put("/forecast/scenario/F001", json={"is_base": False, "name": "Base"}).status_code == 200


def test_deleting_the_base_promotes_another(client):
    res = client.delete("/forecast/scenario/F001")
    assert res.status_code == 200
    assert res.json()["data"]["promoted_base"] == "F002"
    scenarios = client.get("/forecast/scenarios").json()["data"]["scenarios"]
    assert [(s["forecast_id"], s["is_base"]) for s in scenarios] == [("F002", True)]


def test_migration_backfills_a_base_on_upgraded_databases():
    tmp = tempfile.mkdtemp()
    db_path = os.path.join(tmp, "legacy.db")
    conn = _sqlite3.connect(db_path)
    # A pre-is_base schema with two scenarios, as an existing install would have.
    conn.execute("CREATE TABLE forecast (forecast_id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, notes TEXT)")
    conn.execute("INSERT INTO forecast (forecast_id, name) VALUES ('F007', 'Later')")
    conn.execute("INSERT INTO forecast (forecast_id, name) VALUES ('F002', 'Earlier')")
    conn.commit()
    conn.close()
    try:
        mgr = DatabaseManager(database_path=db_path, data_dir=tmp)
        mgr.initialize()
        conn = _sqlite3.connect(db_path)
        rows = conn.execute("SELECT forecast_id, is_base FROM forecast ORDER BY forecast_id").fetchall()
        conn.close()
        assert rows == [("F002", 1), ("F007", 0)]
        # idempotent: running again keeps the same base
        mgr.migrate_forecast_table()
        conn = _sqlite3.connect(db_path)
        assert conn.execute("SELECT forecast_id FROM forecast WHERE is_base = 1").fetchall() == [("F002",)]
        conn.close()
        mgr.close_all_connections()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------------------
# Expense update clears optional fields with explicit nulls
# ---------------------------------------------------------------------------

def test_expense_update_clears_optional_fields_with_null(client):
    assert client.put("/expenses/X1", json={"vendor": "Acme", "end_date": "2026-06-30"}).status_code == 200
    row = next(e for e in client.get("/expenses/").json()["data"]["expenses"] if e["expense_id"] == "X1")
    assert row["vendor"] == "Acme" and row["end_date"] == "2026-06-30"
    allocs = client.get("/expenses/allocations", params={"expense_id": "X1"}).json()["data"]["allocations"]
    assert len(allocs) == 6   # Jan-Jun

    assert client.put("/expenses/X1", json={"vendor": None, "end_date": None}).status_code == 200
    row = next(e for e in client.get("/expenses/").json()["data"]["expenses"] if e["expense_id"] == "X1")
    assert row["vendor"] is None and row["end_date"] is None
    allocs = client.get("/expenses/allocations", params={"expense_id": "X1"}).json()["data"]["allocations"]
    assert len(allocs) > 6    # open-ended again, allocations regenerated

    # required columns are never blanked by a null
    assert client.put("/expenses/X1", json={"expense_name": None, "amount": 150}).status_code == 200
    row = next(e for e in client.get("/expenses/").json()["data"]["expenses"] if e["expense_id"] == "X1")
    assert row["expense_name"] == "Scenario tool" and row["amount"] == 150
