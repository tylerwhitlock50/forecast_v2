"""
Data lifecycle: snapshots, restore, start clean, reset, switch, the startup
CSV loader, connection hygiene and the documented start commands.

Drives the real FastAPI app (every router, MCP mounted) against an isolated
database in a temp folder, the way the owner will use it: snapshot before a
bulk change, change data, restore, restart.
"""
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time

import pytest
from fastapi.testclient import TestClient

_REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
_APP_DIR = os.path.join(_REPO, "app")
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from app.db.database import DatabaseManager  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures and helpers
# ---------------------------------------------------------------------------

def _seed(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F001', '2027 Budget', 1)")
    c.execute("INSERT INTO customers (customer_id, customer_name, customer_type) VALUES ('C1', 'Dealer One', 'dealer')")
    c.execute("INSERT INTO units (unit_id, unit_name, base_price) VALUES ('P1', 'Rifle', 100)")
    c.execute("INSERT INTO sales VALUES ('S1', 'C1', 'P1', '2027-06', 10, 100, 1000, 'F001')")
    conn.commit()
    conn.close()


def _patch_db_manager(mgr):
    """Point every module-level db_manager at the test database."""
    originals = {}
    for name, module in list(sys.modules.items()):
        if module is None:
            continue
        if name in ("db.database", "app.db.database") or name.startswith(("api.", "app.api.", "utils.")):
            if hasattr(module, "db_manager"):
                originals[name] = module.db_manager
                module.db_manager = mgr
    return originals


def _restore_patch(originals):
    for name, original in originals.items():
        sys.modules[name].db_manager = original


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
            yield client, mgr, fastapi_app
    finally:
        _restore_patch(originals)
        shutil.rmtree(tmp, ignore_errors=True)


def _open(path):
    conn = sqlite3.connect(path, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def q(path, sql, params=()):
    conn = sqlite3.connect(path, timeout=30)
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def price(path):
    return q(path, "SELECT unit_price FROM sales WHERE sale_id = 'S1'")[0][0]


def set_price(path, value):
    conn = _open(path)
    conn.execute("UPDATE sales SET unit_price = ?, total_revenue = quantity * ? WHERE sale_id = 'S1'", (value, value))
    conn.commit()
    conn.close()


STATEMENTS_2027 = {"forecast_ids": "F001", "start_period": "2027-01", "end_period": "2027-12"}


def api_price(client):
    rows = client.get("/data/sales", params={"forecast_id": "F001"}).json()["data"]
    return [r for r in rows if r["sale_id"] == "S1"][0]["unit_price"]


# ---------------------------------------------------------------------------
# snapshot-restore-wal-unsafe
# ---------------------------------------------------------------------------

def test_save_then_load_restores_with_open_connections_and_survives_restart(env):
    client, mgr, fastapi_app = env
    db_path = mgr.database_path
    # A connection that stays open the whole time (what a leaked route
    # connection did): it keeps the WAL from being checkpointed.
    leak = _open(db_path)
    leak.execute("SELECT COUNT(*) FROM sales").fetchone()

    set_price(db_path, 120)                          # write A, sits in the WAL
    main_only = os.path.join(os.path.dirname(db_path), "main_only_copy.db")
    shutil.copyfile(db_path, main_only)             # what the old file copy saw
    assert q(main_only, "SELECT unit_price FROM sales WHERE sale_id = 'S1'") == [(100.0,)]

    res = client.post("/database/save", json={"name": "before-cut"})
    assert res.status_code == 200, res.text
    snapshot = res.json()["data"]["path"]
    assert os.path.dirname(snapshot) == mgr.snapshot_dir
    assert price(snapshot) == 120                    # the snapshot has write A
    assert not os.path.exists(snapshot + "-wal")     # a self-contained file
    with open(snapshot, "rb") as handle:
        assert handle.read(20)[18:20] == b"\x01\x01"  # rollback-journal mode

    set_price(db_path, 65)                           # write B (the bulk cut)
    assert price(db_path) == 65                      # writes after a save are kept
    assert price(snapshot) == 120

    res = client.post("/database/load", json={"filename": "before-cut.db"})
    assert res.status_code == 200, res.text
    assert res.json()["data"]["backup_created"].startswith("current_backup_")
    assert api_price(client) == 120
    assert leak.execute("SELECT unit_price FROM sales WHERE sale_id = 'S1'").fetchone() == (120.0,)
    # The pre-load state was kept as a system backup.
    backup = os.path.join(mgr.snapshot_dir, res.json()["data"]["backup_created"])
    assert price(backup) == 65
    leak.close()

    # Restart: a new manager on the same file, then the app again.
    fresh = DatabaseManager(database_path=db_path, data_dir=mgr.data_dir)
    fresh.initialize()
    assert price(db_path) == 120
    _patch_db_manager(fresh)
    try:
        with TestClient(fastapi_app) as client2:
            assert api_price(client2) == 120
    finally:
        _patch_db_manager(mgr)          # the fixture restores the real managers


def test_save_refuses_to_overwrite_a_name_unless_asked(env):
    client, mgr, _ = env
    assert client.post("/database/save", json={"name": "plan"}).status_code == 200
    set_price(mgr.database_path, 77)
    res = client.post("/database/save", json={"name": "plan"})
    assert res.status_code == 409
    assert "overwrite" in res.json()["detail"]
    snapshot = os.path.join(mgr.snapshot_dir, "plan.db")
    assert price(snapshot) == 100                    # untouched
    res = client.post("/database/save", json={"name": "plan", "overwrite": True})
    assert res.status_code == 200
    assert res.json()["data"]["overwritten"] is True
    assert price(snapshot) == 77


def test_autosaves_and_backups_get_unique_names(env):
    client, mgr, _ = env
    names = {client.post("/database/save-current").json()["data"]["filename"] for _ in range(3)}
    assert len(names) == 3 and all(n.startswith("autosave_") for n in names)
    listing = client.get("/database/list").json()["data"]
    assert listing["autosave_count"] == 3
    assert {d["type"] for d in listing["autosaves"]} == {"autosave"}
    assert listing["latest"]["filename"] in names


def test_revert_to_last_save_uses_the_newest_snapshot_of_any_kind(env):
    client, mgr, _ = env
    assert client.post("/database/revert-to-last-save").status_code == 404   # nothing saved yet

    assert client.post("/database/save", json={"name": "manual"}).status_code == 200   # 100
    time.sleep(0.01)
    set_price(mgr.database_path, 90)
    assert client.post("/database/save-current").status_code == 200                    # 90
    time.sleep(0.01)
    set_price(mgr.database_path, 50)

    res = client.post("/database/revert-to-last-save")
    assert res.status_code == 200, res.text
    body = res.json()["data"]
    assert body["reverted_from"].startswith("autosave_")
    assert body["snapshot_type"] == "autosave"
    assert api_price(client) == 90

    time.sleep(0.01)
    assert client.post("/database/save", json={"name": "named-later"}).status_code == 200  # 90
    time.sleep(0.01)
    set_price(mgr.database_path, 10)
    res = client.post("/database/revert-to-last-save")
    assert res.json()["data"]["reverted_from"] == "named-later.db"
    assert api_price(client) == 90
    # The revert itself saved a pre_revert backup (newest), so it can be undone.
    res = client.post("/database/revert-to-last-save")
    assert res.json()["data"]["reverted_from"].startswith("pre_revert_backup_")
    assert api_price(client) == 10


def test_snapshot_export_downloads_a_consistent_database_file(env):
    client, mgr, _ = env
    leak = _open(mgr.database_path)
    leak.execute("SELECT 1").fetchone()
    set_price(mgr.database_path, 133)
    res = client.get("/database/snapshot")
    assert res.status_code == 200
    assert "attachment" in res.headers["content-disposition"]
    assert res.content[:16] == b"SQLite format 3\x00"
    out = os.path.join(mgr.data_dir, "download.db")
    with open(out, "wb") as handle:
        handle.write(res.content)
    assert price(out) == 133
    leak.close()

    client.post("/database/save", json={"name": "keep"})
    res = client.get("/database/snapshot", params={"filename": "keep.db"})
    assert res.status_code == 200 and res.content[:16] == b"SQLite format 3\x00"
    assert client.get("/database/snapshot", params={"filename": "nope"}).status_code == 404


def test_load_refuses_bad_files_and_paths_without_touching_the_live_database(env):
    client, mgr, _ = env
    os.makedirs(mgr.snapshot_dir, exist_ok=True)
    with open(os.path.join(mgr.snapshot_dir, "junk.db"), "wb") as handle:
        handle.write(b"not a database at all" * 10)
    res = client.post("/database/load", json={"filename": "junk"})
    assert res.status_code == 422
    assert api_price(client) == 100
    assert client.post("/database/load", json={"filename": "../forecast"}).status_code == 400
    assert client.post("/database/load", json={"filename": "missing"}).status_code == 404
    assert client.post("/database/load", json={}).status_code == 400


# ---------------------------------------------------------------------------
# load-snapshot-not-migrated
# ---------------------------------------------------------------------------

def _old_schema_snapshot(path):
    """A database from an older version: forecast without notes / is_base,
    payroll_config without pay_frequency, expenses without forecast_id, no
    reporting / pricing tables, 1 KiB pages."""
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA page_size=1024")
    conn.executescript("""
        CREATE TABLE customers (customer_id TEXT PRIMARY KEY, customer_name TEXT NOT NULL, customer_type TEXT, region TEXT);
        CREATE TABLE units (unit_id TEXT PRIMARY KEY, unit_name TEXT NOT NULL, unit_description TEXT, base_price REAL,
                            unit_type TEXT, bom_id TEXT, bom_version TEXT DEFAULT '1.0', router_id TEXT,
                            router_version TEXT DEFAULT '1.0');
        CREATE TABLE forecast (forecast_id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT);
        CREATE TABLE sales (sale_id TEXT PRIMARY KEY, customer_id TEXT, unit_id TEXT, period TEXT, quantity INTEGER,
                            unit_price REAL, total_revenue REAL, forecast_id TEXT,
                            FOREIGN KEY (customer_id) REFERENCES customers (customer_id),
                            FOREIGN KEY (unit_id) REFERENCES units (unit_id),
                            FOREIGN KEY (forecast_id) REFERENCES forecast (forecast_id));
        CREATE TABLE payroll_config (config_id TEXT PRIMARY KEY, federal_tax_rate REAL DEFAULT 0.22,
                            state_tax_rate REAL DEFAULT 0.06, social_security_rate REAL DEFAULT 0.062,
                            medicare_rate REAL DEFAULT 0.0145, unemployment_rate REAL DEFAULT 0.006,
                            benefits_rate REAL DEFAULT 0.25, workers_comp_rate REAL DEFAULT 0.015,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE expenses (expense_id TEXT PRIMARY KEY, expense_name TEXT NOT NULL, category_id TEXT NOT NULL,
                            amount REAL NOT NULL, frequency TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT,
                            vendor TEXT, description TEXT, payment_method TEXT, approval_required BOOLEAN DEFAULT 0,
                            approved_by TEXT, approval_date TEXT, expense_allocation TEXT DEFAULT 'immediate',
                            amortization_months INTEGER, department TEXT, cost_center TEXT,
                            is_active BOOLEAN DEFAULT 1, created_date TEXT, updated_date TEXT);
        INSERT INTO forecast VALUES ('F001', 'Old plan', '');
        INSERT INTO customers (customer_id, customer_name) VALUES ('C7', 'Old customer');
        INSERT INTO units (unit_id, unit_name, base_price) VALUES ('P7', 'Old product', 70);
        INSERT INTO sales VALUES ('S7', 'C7', 'P7', '2026-03', 3, 70, 210, 'F001');
    """)
    conn.commit()
    conn.close()


def test_loading_an_older_schema_snapshot_migrates_it(env):
    client, mgr, _ = env
    os.makedirs(mgr.snapshot_dir, exist_ok=True)
    _old_schema_snapshot(os.path.join(mgr.snapshot_dir, "old-schema.db"))

    res = client.post("/database/load", json={"filename": "old-schema"})
    assert res.status_code == 200, res.text

    res = client.get("/forecast/scenarios")
    assert res.status_code == 200, res.text
    scenarios = res.json()["data"]["scenarios"]
    assert [(s["forecast_id"], s["is_base"]) for s in scenarios] == [("F001", 1)]
    assert client.post("/forecast/scenario", json={"name": "New plan"}).status_code == 200
    columns = {r[1] for r in q(mgr.database_path, "PRAGMA table_info(payroll_config)")}
    assert "pay_frequency" in columns
    assert "forecast_id" in {r[1] for r in q(mgr.database_path, "PRAGMA table_info(expenses)")}
    tables = {r[0] for r in q(mgr.database_path, "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"financial_assumptions", "capital_expenditures", "actuals", "price_list"} <= tables
    assert q(mgr.database_path, "SELECT sale_id, unit_price FROM sales") == [("S7", 70.0)]
    assert client.get("/reporting/statements", params=STATEMENTS_2027).status_code == 200


# ---------------------------------------------------------------------------
# clear-and-reset-leave-orphans / documented-reset-and-clean-start /
# reset-clean-wrong-db-and-no-migrations
# ---------------------------------------------------------------------------

def _seed_everything(path):
    conn = sqlite3.connect(path)
    c = conn.cursor()
    c.execute("INSERT INTO financial_assumptions (forecast_id, opening_cash) VALUES ('F001', 250000)")
    c.execute("INSERT INTO capital_expenditures (capex_id, forecast_id, asset_name, amount, purchase_period) "
              "VALUES ('CX1', 'F001', 'New CNC', 180000, '2027-03')")
    c.execute("INSERT INTO actuals (actual_id, period, line_item, amount) VALUES ('A1', '2027-01', 'revenue', 5)")
    c.execute("INSERT INTO price_list (price_id, forecast_id, unit_id, customer_type, method, unit_price) "
              "VALUES ('PL1', 'F001', 'P1', 'dealer', 'fixed', 95)")
    c.execute("INSERT INTO sales_deduction_rules (rule_id, forecast_id, deduction_type, rate) "
              "VALUES ('R1', 'F001', 'commission', 0.05)")
    c.execute("INSERT INTO expense_categories (category_id, category_name, category_type) VALUES ('EC1', 'Rent', 'admin_expense')")
    c.execute("INSERT INTO expenses (expense_id, expense_name, category_id, amount, frequency, start_date, forecast_id) "
              "VALUES ('E1', 'Rent', 'EC1', 1000, 'monthly', '2027-01-01', 'F001')")
    c.execute("INSERT INTO expense_allocations (allocation_id, expense_id, period, allocated_amount, allocation_type) "
              "VALUES ('EA1', 'E1', '2027-01', 1000, 'scheduled')")
    c.execute("""INSERT INTO loans (loan_id, loan_name, lender, loan_type, principal_amount, interest_rate,
                 loan_term_months, start_date, payment_type, current_balance, next_payment_date, monthly_payment_amount)
                 VALUES ('L1', 'Line', 'Bank', 'term_loan', 1000, 5, 12, '2027-01-01', 'amortizing', 1000, '2027-02-01', 90)""")
    c.execute("""INSERT INTO loan_payments (payment_id, loan_id, payment_number, payment_date, payment_amount,
                 principal_payment, interest_payment, remaining_balance) VALUES ('LP1', 'L1', 1, '2027-02-01', 90, 85, 5, 915)""")
    c.execute("INSERT INTO machines (machine_id, machine_name, machine_rate) VALUES ('M1', 'CNC', 60)")
    c.execute("INSERT INTO labor_rates (rate_id, rate_name, rate_amount) VALUES ('LR1', 'Machinist', 30)")
    c.execute("INSERT INTO router_definitions (router_id, router_name) VALUES ('RT1', 'Bolt')")
    c.execute("INSERT INTO router_operations (router_id, sequence, machine_id, labor_type_id) VALUES ('RT1', 10, 'M1', 'LR1')")
    c.execute("INSERT INTO bom_definitions (bom_id, bom_name) VALUES ('B1', 'Rifle BOM')")
    c.execute("INSERT INTO bom (bom_id, version, bom_line, qty, unit_price, material_cost) VALUES ('B1', '1.0', 1, 1, 10, 10)")
    c.execute("INSERT INTO payroll (employee_id, employee_name, forecast_id) VALUES ('EMP1', 'Pat', 'F001')")
    c.execute("INSERT INTO payroll_config (config_id) VALUES ('default')")
    c.execute("INSERT INTO execution_log (execution_date, sql_statement) VALUES ('2027-01-01', 'SELECT 1')")
    conn.commit()
    conn.close()


def _row_total(path):
    names = [r[0] for r in q(path, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    return {n: q(path, f'SELECT COUNT(*) FROM "{n}"')[0][0] for n in names}


def test_start_clean_snapshots_then_empties_every_table_and_keeps_the_schema(env):
    client, mgr, _ = env
    _seed_everything(mgr.database_path)
    before = _row_total(mgr.database_path)

    assert client.post("/database/start-clean", json={}).status_code == 400
    assert client.post("/database/start-clean", json={"confirm": "yes"}).status_code == 400
    assert _row_total(mgr.database_path) == before          # nothing deleted

    res = client.post("/database/start-clean", json={"confirm": True, "snapshot_first": True})
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["verify"]["all_empty"] is True
    assert data["database_path"] == mgr.database_path
    assert data["backup"]["filename"].startswith("start_clean_backup_")
    assert data["rows_deleted"] == sum(before.values())
    for table in ("financial_assumptions", "capital_expenditures", "actuals", "price_list",
                  "sales_deduction_rules", "expense_allocations", "loan_payments", "forecast", "sales"):
        assert data["tables"][table] == before[table] >= 1, table
    assert all(n == 0 for n in _row_total(mgr.database_path).values())
    assert q(mgr.database_path, "PRAGMA foreign_key_check") == []
    assert set(_row_total(mgr.database_path)) == set(before)  # every table kept
    assert "pay_frequency" in {r[1] for r in q(mgr.database_path, "PRAGMA table_info(payroll_config)")}
    assert client.post("/database/verify-empty").json()["all_empty"] is True

    # A new F001 starts from defaults, not the deleted assumptions / capex.
    res = client.post("/forecast/scenario", json={"name": "2027 Budget"})
    assert res.status_code == 200 and res.json()["data"]["forecast_id"] == "F001"
    assumptions = client.get("/reporting/assumptions", params={"forecast_id": "F001"}).json()["data"]["assumptions"]
    assert assumptions["found"] is False and assumptions["opening_cash"] == 0
    assert client.get("/reporting/capex", params={"forecast_id": "F001"}).json()["data"]["capex"] == []

    # The snapshot restores the previous model.
    res = client.post("/database/load", json={"filename": data["backup"]["filename"]})
    assert res.status_code == 200
    assert _row_total(mgr.database_path)["capital_expenditures"] == 1
    assert q(mgr.database_path, "SELECT opening_cash FROM financial_assumptions") == [(250000.0,)]


def test_start_clean_can_create_an_empty_base_scenario(env):
    client, mgr, _ = env
    res = client.post("/database/start-clean", json={"confirm": True, "snapshot_first": False,
                                                     "scenario_name": "2027 Budget"})
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["backup"] is None
    assert data["scenario"] == {"forecast_id": "F001", "name": "2027 Budget", "is_base": 1}
    assert data["verify"]["non_empty_tables"] == {"forecast": 1}


def test_clear_data_and_resets_leave_nothing_behind(env):
    client, mgr, _ = env
    _seed_everything(mgr.database_path)
    res = client.post("/database/clear-data")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["verify"]["all_empty"] is True
    assert body["tables"]["financial_assumptions"] == 1 and body["tables"]["capital_expenditures"] == 1
    assert os.path.basename(body["backup_path"]).startswith("clear_data_backup_")

    _seed(mgr.database_path)
    _seed_everything(mgr.database_path)
    res = client.post("/database/rollback/reset")          # no seed CSVs in data_dir
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["backup_created"].startswith("reset_backup_")
    assert data["cleared"]["tables"]["actuals"] == 1
    assert all(n == 0 for n in _row_total(mgr.database_path).values())
    assert q(mgr.database_path, "PRAGMA foreign_key_check") == []

    _seed(mgr.database_path)
    res = client.post("/database/reset-clean")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["database_path"] == mgr.database_path
    assert os.path.dirname(body["backup_path"]) == mgr.snapshot_dir
    assert body["verify"]["all_empty"] is True
    assert "pay_frequency" in {r[1] for r in q(mgr.database_path, "PRAGMA table_info(payroll_config)")}
    info = client.get("/database/info").json()
    assert info["database_path"] == mgr.database_path and info["total_rows"] == 0
    listing = client.get("/database/list").json()["data"]
    assert {d["type"] for d in listing["autosaves"]} == {"system_backup"}


def test_reset_with_seed_csvs_reloads_them_after_clearing_everything(env):
    client, mgr, _ = env
    _seed_everything(mgr.database_path)
    with open(os.path.join(mgr.data_dir, "customers.csv"), "w") as handle:
        handle.write("customer_id,customer_name\nC-CSV,From CSV\n")
    res = client.post("/database/rollback/reset")
    assert res.status_code == 200, res.text
    counts = _row_total(mgr.database_path)
    assert counts["customers"] == 1 and counts["financial_assumptions"] == 0 and counts["forecast"] == 0


# ---------------------------------------------------------------------------
# switch-endpoint-stale-db-manager
# ---------------------------------------------------------------------------

def test_switch_repoints_the_one_shared_manager(env):
    client, mgr, _ = env
    import db.database as dbmod
    import api.reporting_routes as reporting_routes
    assert client.post("/database/save", json={"name": "alt"}).status_code == 200
    original_path = mgr.database_path
    snapshot_dir = mgr.snapshot_dir
    alt = os.path.join(snapshot_dir, "alt.db")

    res = client.post("/database/switch", json={"filename": "alt.db"})
    assert res.status_code == 200, res.text
    assert dbmod.db_manager is mgr and reporting_routes.db_manager is mgr
    assert mgr.database_path == alt and mgr.snapshot_dir == snapshot_dir
    assert client.get("/database/current").json()["data"]["database_path"] == alt

    res = client.put("/reporting/assumptions", params={"forecast_id": "F001"}, json={"opening_cash": 777777})
    assert res.status_code == 200, res.text
    assert q(alt, "SELECT opening_cash FROM financial_assumptions") == [(777777.0,)]
    assert q(original_path, "SELECT COUNT(*) FROM financial_assumptions") == [(0,)]
    set_price(alt, 55)
    assert api_price(client) == 55
    assert client.delete("/database/delete/alt.db").status_code == 409   # the live file


# ---------------------------------------------------------------------------
# force-reload-and-csv-startup-loader
# ---------------------------------------------------------------------------

def _write(folder, name, text):
    with open(os.path.join(folder, name), "w") as handle:
        handle.write(text)


@pytest.fixture()
def csv_env(monkeypatch):
    monkeypatch.delenv("FORCE_DB_RELOAD", raising=False)
    tmp = tempfile.mkdtemp()
    _write(tmp, "customers.csv", "customer_id,customer_name\nC1,Dealer One\nC2,Distributor\n")
    _write(tmp, "units.csv", "unit_id,unit_name,base_price\nP1,Rifle,100\n")
    _write(tmp, "forecast.csv", "forecast_id,name\nF001,2027 Budget\n")
    _write(tmp, "sales.csv", "customer_id,unit_id,period,quantity,unit_price,forecast_id\n"
                             "C1,P1,2027-01,10,100,F001\nC2,P1,2027-02,4,90,F001\n")
    mgr = DatabaseManager(database_path=os.path.join(tmp, "forecast.db"), data_dir=tmp)
    yield mgr, tmp
    shutil.rmtree(tmp, ignore_errors=True)


def test_startup_loader_generates_sale_ids_and_revenue(csv_env):
    mgr, _ = csv_env
    mgr.initialize()
    rows = q(mgr.database_path, "SELECT sale_id, customer_id, total_revenue FROM sales ORDER BY customer_id")
    assert [(r[1], r[2]) for r in rows] == [("C1", 1000.0), ("C2", 360.0)]
    assert all(r[0] and len(r[0]) == 36 for r in rows) and rows[0][0] != rows[1][0]
    assert q(mgr.database_path, "SELECT forecast_id, is_base FROM forecast") == [("F001", 1)]


def test_force_reload_replaces_parents_and_children_together(csv_env, monkeypatch):
    mgr, tmp = csv_env
    mgr.initialize()
    conn = sqlite3.connect(mgr.database_path)
    conn.execute("INSERT INTO customers (customer_id, customer_name) VALUES ('C9', 'Added by MCP')")
    conn.execute("INSERT INTO sales VALUES ('S9', 'C9', 'P1', '2027-03', 1, 100, 100, 'F001')")
    conn.commit()
    conn.close()

    monkeypatch.setenv("FORCE_DB_RELOAD", "true")
    mgr.initialize()
    assert q(mgr.database_path, "SELECT customer_id FROM customers ORDER BY 1") == [("C1",), ("C2",)]
    assert q(mgr.database_path, "SELECT COUNT(*) FROM sales") == [(2,)]
    assert q(mgr.database_path, "PRAGMA foreign_key_check") == []
    assert any(f.startswith("force_reload_backup_") for f in os.listdir(mgr.snapshot_dir))


def test_force_reload_that_would_orphan_rows_is_refused_and_changes_nothing(csv_env, monkeypatch):
    mgr, tmp = csv_env
    mgr.initialize()
    conn = sqlite3.connect(mgr.database_path)
    conn.execute("INSERT INTO forecast (forecast_id, name) VALUES ('F002', 'Upside')")
    conn.execute("INSERT INTO financial_assumptions (forecast_id, opening_cash) VALUES ('F002', 5)")
    conn.execute("INSERT INTO customers (customer_id, customer_name) VALUES ('C9', 'Added by MCP')")
    conn.commit()
    conn.close()
    before = _row_total(mgr.database_path)

    monkeypatch.setenv("FORCE_DB_RELOAD", "true")
    result = mgr.load_csv_data()
    assert result["status"] == "refused"
    assert "financial_assumptions" in result["refused"] and "forecast" in result["refused"]
    assert _row_total(mgr.database_path) == before
    assert q(mgr.database_path, "PRAGMA foreign_key_check") == []


def test_a_csv_with_unknown_references_is_skipped_and_named(csv_env):
    mgr, tmp = csv_env
    _write(tmp, "sales.csv", "sale_id,customer_id,unit_id,period,quantity,unit_price,forecast_id\n"
                             "S1,C1,NOPE,2027-01,1,1,F001\n")
    mgr.initialize()
    assert q(mgr.database_path, "SELECT COUNT(*) FROM sales") == [(0,)]
    assert q(mgr.database_path, "SELECT COUNT(*) FROM customers") == [(2,)]
    result = mgr.load_csv_data()
    assert "units" in result["errors"]["sales.csv"]


# ---------------------------------------------------------------------------
# connection-leaks
# ---------------------------------------------------------------------------

def test_endpoints_close_every_connection(env, monkeypatch):
    client, mgr, _ = env
    opened = []
    real_get_connection = mgr.get_connection

    def tracking_get_connection():
        conn = real_get_connection()
        opened.append(conn)
        return conn

    monkeypatch.setattr(mgr, "get_connection", tracking_get_connection)

    def still_open():
        alive = []
        for conn in opened:
            try:
                conn.total_changes
                alive.append(conn)
            except sqlite3.ProgrammingError:
                pass
        return alive

    loan = {"loan_name": "Line", "lender": "Bank", "loan_type": "term_loan", "principal_amount": 12000,
            "interest_rate": 6, "loan_term_months": 12, "start_date": "2027-01-01", "payment_type": "amortizing"}
    calls = [
        ("GET", "/loans/", None, 200),                    # no loans: used to leak
        ("GET", "/loans/summary", None, 200),
        ("GET", "/loans/cash-flow?start_period=2027-01&end_period=2027-12", None, 200),
        ("GET", "/loans/NOPE/schedule", None, 404),
        ("PUT", "/loans/NOPE", {"loan_name": "x"}, 404),
        ("DELETE", "/loans/NOPE", None, 404),
        ("POST", "/loans/", loan, 200),
        ("GET", "/loans/", None, 200),
        ("GET", "/expenses/summary", None, 200),
        ("GET", "/expenses/", None, 200),
        ("GET", "/expenses/categories", None, 200),
        ("GET", "/data/health", None, 200),
        ("GET", "/data/sales", None, 200),
        ("GET", "/products/unit-cost", None, 200),
        ("GET", "/forecast/scenarios", None, 200),
        ("GET", "/reporting/statements?forecast_ids=F001&start_period=2027-01&end_period=2027-12", None, 200),
        ("GET", "/database/info", None, 200),
        ("POST", "/database/verify-empty", None, 200),
        ("POST", "/database/save-current", None, 200),
    ]
    for method, path, body, status in calls:
        res = client.request(method, path, json=body)
        assert res.status_code == status, (path, res.status_code, res.text)
        assert still_open() == [], f"{method} {path} left a connection open"
    assert len(opened) >= len(calls)


# ---------------------------------------------------------------------------
# load-table-replace-destroys-schema (regression for the data_loader fix)
# ---------------------------------------------------------------------------

def _upload(client, table, mode, text):
    return client.post("/database/load_table", params={"table_name": table, "mode": mode},
                       files={"csv_file": (f"{table}.csv", text.encode(), "text/csv")})


def test_load_table_replace_keeps_schema_so_imports_and_statements_still_work(env):
    client, mgr, _ = env
    schema = {t: q(mgr.database_path, f"PRAGMA table_info({t})") for t in ("customers", "units", "bom")}

    assert _upload(client, "customers", "replace", "customer_id,customer_name,customer_type\nC1,Dealer One,dealer\n"
                   "C2,Distributor,distributor\n").status_code == 200
    assert _upload(client, "units", "replace", "unit_id,unit_name,base_price,bom_id,bom_version\n"
                   "P1,Rifle,100,B1,1.0\n").status_code == 200
    assert _upload(client, "bom", "replace", "bom_id,version,bom_line,material_description,qty,unit_price\n"
                   "B1,1,1,Barrel,1,40\n").status_code == 200
    for table, info in schema.items():
        assert q(mgr.database_path, f"PRAGMA table_info({table})") == info, table
    assert q(mgr.database_path, "PRAGMA foreign_key_list(sales)")

    res = client.post("/forecast/create", json={"sales": {
        "customer_id": "C2", "unit_id": "P1", "period": "2027-01", "quantity": 5, "unit_price": 90, "forecast_id": "F001"}})
    assert res.status_code == 200, res.text
    res = client.get("/reporting/statements", params=STATEMENTS_2027)
    assert res.status_code == 200, res.text
    assert q(mgr.database_path, "SELECT version, material_cost FROM bom") == [("1.0", 40.0)]


# ---------------------------------------------------------------------------
# local-run-commands-broken: every documented start command answers GET /
# ---------------------------------------------------------------------------

def _free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _wait_for_root(port, proc, timeout=60):
    import urllib.request
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            return None
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=2) as res:
                return res.status, res.read().decode()
        except OSError:
            time.sleep(0.3)
    return None


@pytest.mark.slow
@pytest.mark.parametrize("command", [
    "python scripts/run_local.py --no-reload --port {port}",
    "python main.py",
    "uvicorn main:app --app-dir app --port {port}",
    "uvicorn main:app --port {port}",
])
def test_documented_start_commands_answer_root(command):
    port = _free_port()
    tmp = tempfile.mkdtemp()
    env = {**os.environ, "DATABASE_PATH": os.path.join(tmp, "forecast.db"), "PORT": str(port),
           "HOST": "127.0.0.1", "FORCE_DB_RELOAD": "false"}
    argv = command.format(port=port).split()
    argv = [sys.executable] + argv[1:] if argv[0] == "python" else [sys.executable, "-m"] + argv
    if "uvicorn" in argv:
        argv += ["--host", "127.0.0.1"]
    proc = subprocess.Popen(argv, cwd=_REPO, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            start_new_session=True)
    try:
        answer = _wait_for_root(port, proc)
        if answer is None:
            proc.kill()
            output = proc.communicate(timeout=10)[0].decode(errors="replace")
            pytest.fail(f"{command} did not answer GET /:\n{output[-3000:]}")
        status, body = answer
        assert status == 200 and '"running"' in body
        assert os.path.exists(os.path.join(tmp, "forecast.db"))   # used DATABASE_PATH, not the repo DB
    finally:
        if proc.poll() is None:
            os.killpg(proc.pid, 15)
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, 9)
        shutil.rmtree(tmp, ignore_errors=True)
