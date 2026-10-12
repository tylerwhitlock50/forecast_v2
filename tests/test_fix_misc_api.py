"""
HTTP fixes found by the end-to-end MCP run and the API review:

* API-1  revert-to-last-save restores the newest USER snapshot (named save or
         autosave), never a system backup taken before a load / revert /
         reset / start-clean, and says which file it restored.
* API-10 /forecast/comparison answers unknown scenario ids with 404 naming
         them (no 500, no fake zero row).
* API-11 GET /data/{table} answers an unknown table with 404 (not 500).
* F11    the data-quality validation does not flag a missing optional
         product description (or customer region) as an issue.
* MCP-12 report period filters that are not YYYY-MM months are 422.

Drives the real FastAPI app against an isolated database in a temp folder.
"""
import os
import shutil
import sqlite3
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


def _seed(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F001', '2027 Budget', 1)")
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F002', 'Upside', 0)")
    c.execute("INSERT INTO customers (customer_id, customer_name, customer_type) VALUES ('C1', 'Dealer One', 'dealer')")
    c.execute("INSERT INTO units (unit_id, unit_name, base_price, unit_type) VALUES ('P1', 'Rifle', 100, 'Rifle')")
    c.execute("INSERT INTO sales VALUES ('S1', 'C1', 'P1', '2027-06', 10, 100, 1000, 'F001')")
    c.execute("INSERT INTO sales VALUES ('S2', 'C1', 'P1', '2027-07', 5, 100, 500, 'F001')")
    c.execute("INSERT INTO sales VALUES ('S3', 'C1', 'P1', '2027-06', 20, 110, 2200, 'F002')")
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
            yield client, mgr
    finally:
        _restore_patch(originals)
        shutil.rmtree(tmp, ignore_errors=True)


def _write(path, sql, params=()):
    conn = sqlite3.connect(path, timeout=30)
    try:
        conn.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def _customers(client):
    rows = client.get("/data/customers").json()["data"]
    return sorted(r["customer_id"] for r in rows)


def _add_customer(mgr, customer_id):
    _write(mgr.database_path, "INSERT INTO customers (customer_id, customer_name) VALUES (?, ?)",
           (customer_id, customer_id))
    time.sleep(0.01)   # snapshots are ordered by modification time


# ---------------------------------------------------------------------------
# API-1 revert-to-last-save
# ---------------------------------------------------------------------------

class TestRevertToLastSave:
    def test_after_a_load_revert_restores_the_users_save_not_the_pre_load_backup(self, env):
        client, mgr = env
        assert client.post("/database/save", json={"name": "A"}).status_code == 200
        time.sleep(0.01)
        _add_customer(mgr, "ZZZ-ABANDONED")
        res = client.post("/database/load", json={"filename": "A.db"})
        assert res.status_code == 200, res.text
        assert res.json()["data"]["backup_created"].startswith("current_backup_")
        time.sleep(0.01)
        _add_customer(mgr, "QQQ-NEW")

        res = client.post("/database/revert-to-last-save")
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["data"]["reverted_from"] == "A.db"
        assert body["data"]["snapshot_type"] == "manual_save"
        assert "A.db" in body["message"]
        assert _customers(client) == ["C1"]

        # A second revert does not toggle back through the pre_revert backup.
        time.sleep(0.01)
        res = client.post("/database/revert-to-last-save")
        assert res.status_code == 200, res.text
        assert res.json()["data"]["reverted_from"] == "A.db"
        assert _customers(client) == ["C1"]

    def test_repeated_bad_imports_each_revert_to_the_autosave(self, env):
        client, mgr = env
        res = client.post("/database/save-current")
        assert res.status_code == 200
        autosave = res.json()["data"]["filename"]
        time.sleep(0.01)

        _add_customer(mgr, "BAD-IMPORT-1")
        res = client.post("/database/revert-to-last-save")
        assert res.json()["data"]["reverted_from"] == autosave
        assert _customers(client) == ["C1"]
        time.sleep(0.01)

        _add_customer(mgr, "BAD-IMPORT-2")
        res = client.post("/database/revert-to-last-save")
        assert res.status_code == 200, res.text
        assert res.json()["data"]["reverted_from"] == autosave
        assert res.json()["data"]["snapshot_type"] == "autosave"
        assert _customers(client) == ["C1"]

    def test_only_system_backups_is_404_and_nothing_changes(self, env):
        client, mgr = env
        mgr.backup_to(os.path.join(mgr.snapshot_dir, "current_backup_20270101_000000_000.db"))
        mgr.backup_to(os.path.join(mgr.snapshot_dir, "pre_revert_backup_20270101_000001_000.db"))
        _add_customer(mgr, "KEEP-ME")
        res = client.post("/database/revert-to-last-save")
        assert res.status_code == 404
        assert "save" in res.json()["detail"].lower()
        assert "KEEP-ME" in _customers(client)

    def test_newest_of_manual_and_autosave_wins(self, env):
        client, mgr = env
        assert client.post("/database/save-current").status_code == 200
        time.sleep(0.01)
        _add_customer(mgr, "AFTER-AUTOSAVE")
        assert client.post("/database/save", json={"name": "named-later"}).status_code == 200
        time.sleep(0.01)
        _add_customer(mgr, "UNSAVED")
        res = client.post("/database/revert-to-last-save")
        assert res.json()["data"]["reverted_from"] == "named-later.db"
        assert _customers(client) == ["AFTER-AUTOSAVE", "C1"]


# ---------------------------------------------------------------------------
# API-10 /forecast/comparison with unknown ids
# ---------------------------------------------------------------------------

class TestComparisonUnknownIds:
    def test_unknown_id_next_to_a_known_one_is_404_naming_it(self, env):
        client, _ = env
        res = client.get("/forecast/comparison", params=[("forecast_ids", "F001"), ("forecast_ids", "NOPE")])
        assert res.status_code == 404, res.text
        assert "NOPE" in res.json()["detail"]
        assert "F001" not in res.json()["detail"]

    def test_only_unknown_ids_is_404_not_a_zero_row(self, env):
        client, _ = env
        res = client.get("/forecast/comparison", params={"forecast_ids": "NOPE,NADA"})
        assert res.status_code == 404, res.text
        assert "NOPE" in res.json()["detail"] and "NADA" in res.json()["detail"]

    def test_known_ids_still_compare(self, env):
        client, _ = env
        res = client.get("/forecast/comparison", params={"forecast_ids": "F001,F002"})
        assert res.status_code == 200, res.text
        rows = {r["forecast_id"]: r for r in res.json()["data"]["comparison"]}
        assert rows["F001"]["gross_sales"] == pytest.approx(1500)
        assert rows["F002"]["gross_sales"] == pytest.approx(2200)

    def test_bad_window_is_422(self, env):
        client, _ = env
        res = client.get("/forecast/comparison",
                         params={"forecast_ids": "F001", "start_period": "Jan 2027", "end_period": "2027-12"})
        assert res.status_code == 422


# ---------------------------------------------------------------------------
# API-11 GET /data/{table}
# ---------------------------------------------------------------------------

class TestDataTableRead:
    @pytest.mark.parametrize("name", ["nonexistent_table", "customers; DROP TABLE sales", "sqlite_master"])
    def test_unknown_table_is_404(self, env, name):
        client, _ = env
        res = client.get(f"/data/{name}")
        assert res.status_code == 404, res.text
        assert "Unknown table" in res.json()["detail"]

    def test_known_table_still_reads(self, env):
        client, _ = env
        res = client.get("/data/sales", params={"forecast_id": "F001"})
        assert res.status_code == 200
        assert {r["sale_id"] for r in res.json()["data"]} == {"S1", "S2"}


# ---------------------------------------------------------------------------
# F11 validation issues
# ---------------------------------------------------------------------------

class TestValidationIssues:
    def test_missing_description_or_region_is_not_an_issue(self, env):
        client, mgr = env
        _write(mgr.database_path, "INSERT INTO units (unit_id, unit_name, base_price, unit_type) "
                                  "VALUES ('P2', 'Pistol', 600, 'Pistol')")
        res = client.get("/data/validation/issues")
        assert res.status_code == 200, res.text
        data = res.json()["data"]
        assert data["incomplete_products"] == []
        assert data["incomplete_customers"] == []   # C1 has a type; no region is fine
        assert data["summary"]["total_issues"] == 0

    def test_missing_price_name_or_customer_type_is_flagged(self, env):
        client, mgr = env
        _write(mgr.database_path, "INSERT INTO units (unit_id, unit_name, base_price) VALUES ('P0', 'Free', 0)")
        _write(mgr.database_path, "INSERT INTO units (unit_id, unit_name, base_price) VALUES ('PN', '', 50)")
        _write(mgr.database_path, "INSERT INTO customers (customer_id, customer_name) VALUES ('C9', 'No Type')")
        data = client.get("/data/validation/issues").json()["data"]
        products = {p["unit_id"]: p for p in data["incomplete_products"]}
        assert set(products) == {"P0", "PN"}
        assert products["P0"]["missing"] == ["base_price"]
        assert products["PN"]["missing"] == ["unit_name"]
        customers = {c["customer_id"]: c for c in data["incomplete_customers"]}
        assert set(customers) == {"C9"}
        assert customers["C9"]["missing"] == ["customer_type"]
        assert data["summary"]["total_issues"] == 3


# ---------------------------------------------------------------------------
# MCP-12 report period filters
# ---------------------------------------------------------------------------

WINDOW = {"forecast_ids": "F001", "start_period": "2027-01", "end_period": "2027-12"}


class TestReportPeriodFilters:
    @pytest.mark.parametrize("period", ["Jan 2027", "2027-1", "2027-13", "2027-Q1", "202701"])
    def test_sales_detail_non_month_period_filter_is_422(self, env, period):
        client, _ = env
        res = client.get("/reporting/sales-detail", params={**WINDOW, "period": period})
        assert res.status_code == 422, res.text
        assert period in res.json()["detail"]

    def test_sales_detail_period_outside_the_window_is_422(self, env):
        client, _ = env
        res = client.get("/reporting/sales-detail", params={**WINDOW, "period": "2028-01"})
        assert res.status_code == 422
        assert "2028-01" in res.json()["detail"]

    def test_sales_detail_filters_rows_and_totals(self, env):
        client, _ = env
        res = client.get("/reporting/sales-detail", params={**WINDOW, "period": "2027-06"})
        assert res.status_code == 200, res.text
        data = res.json()["data"]
        assert [r["sale_id"] for r in data["rows"]] == ["S1"]
        assert data["total_count"] == 1
        assert data["totals"]["gross_sales"] == pytest.approx(1000)
        assert data["filters"] == {"period": "2027-06"}
        res = client.get("/reporting/sales-detail", params={**WINDOW, "customer_type": " DEALER ", "unit_id": "P1"})
        assert res.json()["data"]["total_count"] == 2

    @pytest.mark.parametrize("period", ["Jan 2027", "2027-13"])
    def test_delete_actuals_bad_period_is_422(self, env, period):
        client, _ = env
        res = client.delete("/reporting/actuals", params={"period": period})
        assert res.status_code == 422, res.text
