"""
Final verification fixes:

1. /database/list items carry ``kind`` and ``contents`` (read read-only);
   load / revert take no backup when the live database is empty.
2. Prices / deduction rules: overlapping-month warnings; the MCP upserts
   update the one same-scope rule when no months are given and repeat the
   overlap warning in ``note``.
3. Sales / price / deduction imports report ``unchanged`` rows.
4. A wide sales file's month columns count as covered by mode=replace (a
   blank December column clears December) and the response lists the
   removed lines.
5. BOM / routing imports report boms_replaced / routings_replaced and the
   lines / operations deleted.
6. Workbook file names use the scenario name.
7. Scenario names are unique (create, rename, branch).
8. MCP sales listings carry report_totals; limit=0 has no next page.
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
MONTHS = ["Jan-27", "Feb-27", "Mar-27", "Apr-27", "May-27", "Jun-27",
          "Jul-27", "Aug-27", "Sep-27", "Oct-27", "Nov-27", "Dec-27"]


def _seed(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F001', 'Base', 1)")
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F002', 'Other', 0)")
    for cid, name, ctype in (("C-DLR", "Main Street Guns", "Dealer"), ("C-DST", "Big Sky", "Distributor")):
        c.execute("INSERT INTO customers (customer_id, customer_name, customer_type) VALUES (?, ?, ?)",
                  (cid, name, ctype))
    for uid, name, utype, price in (("RFL-301", "Rifle 301", "Rifle", 1000), ("RFL-302", "Rifle 302", "Rifle", 1100)):
        c.execute("INSERT INTO units (unit_id, unit_name, unit_type, base_price) VALUES (?, ?, ?, ?)",
                  (uid, name, utype, price))
    c.execute("INSERT INTO machines (machine_id, machine_name, machine_rate) VALUES ('CNC-01', 'CNC', 60)")
    c.execute("INSERT INTO labor_rates (rate_id, rate_name, rate_amount) VALUES ('MACHINIST', 'Machinist', 30)")
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
def env():
    tmp = tempfile.mkdtemp()
    data_dir = os.path.join(tmp, "data")
    os.makedirs(data_dir)
    mgr = DatabaseManager(database_path=os.path.join(data_dir, "final.db"), data_dir=data_dir)
    mgr.initialize()
    _seed(mgr.database_path)
    from app.main import app as fastapi_app
    originals = _patch_db_manager(mgr)
    try:
        with TestClient(fastapi_app) as client:
            yield client, mgr, data_dir
    finally:
        for name, original in originals.items():
            sys.modules[name].db_manager = original
        mgr.close_all_connections()
        shutil.rmtree(tmp, ignore_errors=True)


def mcp(client, name, arguments=None):
    """(parsed result, is_error, text) of one MCP tool call."""
    res = client.post("/mcp", headers=HEADERS, follow_redirects=False, json={
        "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments or {}},
    })
    assert res.status_code == 200, res.text
    result = res.json()["result"]
    text = "".join(b.get("text", "") for b in result.get("content", []) if b.get("type") == "text")
    if result.get("isError"):
        return None, True, text
    return json.loads(text), False, text


def ok(client, name, arguments=None):
    body, is_error, text = mcp(client, name, arguments)
    assert not is_error, text
    return body


def err(client, name, arguments=None):
    _body, is_error, text = mcp(client, name, arguments)
    assert is_error, text
    return text


def post(client, path, body):
    res = client.post(path, json=body)
    assert res.status_code == 200, res.text
    return res.json()["data"]


def rows(mgr, sql, params=()):
    conn = mgr.get_connection()
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        mgr.close_connection(conn)


def snapshot_files(mgr, prefix=""):
    folder = mgr.snapshot_dir
    if not os.path.isdir(folder):
        return []
    return sorted(f for f in os.listdir(folder) if f.endswith(".db") and f.startswith(prefix))


def wide_row(customer_id, unit_id, quantities):
    row = {"Customer": customer_id, "Product": unit_id}
    row.update({m: q for m, q in zip(MONTHS, quantities)})
    return row


# ---------------------------------------------------------------------------
# 1. Snapshots: kind, contents, no backup of an empty database
# ---------------------------------------------------------------------------

def test_snapshot_list_has_kind_and_contents(env):
    client, mgr, _ = env
    post(client, "/forecast/smart_import_sales", {
        "forecast_id": "F001", "sales": [wide_row("C-DLR", "RFL-301", [1] * 12)]})
    assert client.post("/database/save", json={"name": "before-x"}).status_code == 200
    assert client.post("/database/save-current").status_code == 200
    loaded = client.post("/database/load", json={"filename": "before-x"}).json()["data"]
    assert loaded["backup_created"].startswith("current_backup_") and loaded["backup_skipped"] is False
    started = client.post("/database/start-clean", json={"confirm": True}).json()["data"]
    assert started["backup"]["filename"].startswith("start_clean_backup_")

    # Other system backups and files the list must tolerate.
    folder = mgr.snapshot_dir
    shutil.copy(os.path.join(folder, "before-x.db"), os.path.join(folder, "reset_backup_20260101_000000_000.db"))
    shutil.copy(os.path.join(folder, "before-x.db"), os.path.join(folder, "pre_revert_backup_20260101_000000_000.db"))
    old = sqlite3.connect(os.path.join(folder, "old-schema.db"))
    old.execute("CREATE TABLE customers (customer_id TEXT)")
    old.execute("INSERT INTO customers VALUES ('C1')")
    old.commit()
    old.close()
    with open(os.path.join(folder, "junk.db"), "w") as fh:
        fh.write("not a database")

    listing = client.get("/database/list").json()["data"]
    by_name = {d["filename"]: d for d in listing["databases"]}
    kinds = {name: d["kind"] for name, d in by_name.items()}
    assert kinds["before-x.db"] == "manual_save"
    assert [k for n, k in kinds.items() if n.startswith("autosave_")] == ["autosave"]
    assert [k for n, k in kinds.items() if n.startswith("current_backup_")] == ["before_load_backup"]
    assert [k for n, k in kinds.items() if n.startswith("start_clean_backup_")] == ["start_clean_backup"]
    assert kinds["pre_revert_backup_20260101_000000_000.db"] == "before_revert_backup"
    assert kinds["reset_backup_20260101_000000_000.db"] == "system_backup"
    assert by_name["reset_backup_20260101_000000_000.db"]["type"] == "system_backup"   # unchanged field
    assert all(d.get("kind_label") for d in by_name.values())

    saved = by_name["before-x.db"]["contents"]
    assert saved["scenarios"] == ["Base", "Other"] and saved["scenario_count"] == 2
    assert saved["customers"] == 2 and saved["products"] == 2 and saved["sales_rows"] == 12
    assert saved["empty"] is False
    assert by_name["old-schema.db"]["contents"] == {
        "scenarios": [], "scenario_count": 0, "customers": 1, "products": 0, "sales_rows": 0, "total_rows": 1,
        "empty": False}
    assert by_name["junk.db"]["contents"] is None and "not a SQLite database" in by_name["junk.db"]["contents_error"]
    # Read-only: no -wal / -shm / -journal files appear next to the snapshots.
    assert not [f for f in os.listdir(folder) if f.endswith(("-wal", "-shm", "-journal"))]


def test_contents_of_a_wal_mode_snapshot_and_an_empty_database(env):
    client, mgr, _ = env
    folder = mgr.snapshot_dir
    os.makedirs(folder, exist_ok=True)
    wal_path = os.path.join(folder, "wal-copy.db")
    conn = sqlite3.connect(wal_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE forecast (forecast_id TEXT, name TEXT, is_base INTEGER)")
    conn.execute("INSERT INTO forecast VALUES ('F001', '2027 Budget', 1)")
    conn.commit()
    conn.close()
    assert not os.path.exists(wal_path + "-wal")
    listing = client.get("/database/list").json()["data"]
    item = next(d for d in listing["databases"] if d["filename"] == "wal-copy.db")
    assert item["contents"]["scenarios"] == ["2027 Budget"]
    assert item["contents"]["empty"] is True                 # a scenario name alone is no data
    assert not os.path.exists(wal_path + "-wal") and not os.path.exists(wal_path + "-shm")


def test_load_and_revert_take_no_backup_when_the_live_database_is_empty(env):
    client, mgr, _ = env
    assert client.post("/database/save", json={"name": "rehearsal"}).status_code == 200
    started = client.post("/database/start-clean", json={"confirm": True, "scenario_name": "2027 Budget"})
    assert started.status_code == 200
    before = snapshot_files(mgr)

    res = client.post("/database/load", json={"filename": "rehearsal.db"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["data"]["backup_created"] is None and body["data"]["backup_skipped"] is True
    assert "empty" in body["data"]["backup_skipped_reason"]
    assert "No backup was taken" in body["message"] and "empty" in body["message"]
    assert snapshot_files(mgr) == before                      # no current_backup_ of an empty database
    assert rows(mgr, "SELECT COUNT(*) FROM customers") == [(2,)]

    # A non-empty live database is still protected.
    res = client.post("/database/load", json={"filename": "rehearsal.db"}).json()
    assert res["data"]["backup_created"].startswith("current_backup_") and res["data"]["backup_skipped"] is False
    assert "kept as current_backup_" in res["message"]

    # Revert over an empty database: no pre_revert_backup_.
    client.post("/database/start-clean", json={"confirm": True, "snapshot_first": False})
    res = client.post("/database/revert-to-last-save")
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["reverted_from"] == "rehearsal.db" and data["backup_created"] is None and data["backup_skipped"]
    assert snapshot_files(mgr, "pre_revert_backup_") == []
    assert "No backup was taken" in res.json()["message"]


def test_mcp_snapshot_listing_is_compact(env):
    client, _mgr, _ = env
    ok(client, "forecast_save_database", {"name": "before-discounts"})
    listed = ok(client, "forecast_list_saved_databases")
    entry = next(d for d in listed["databases"] if d["filename"] == "before-discounts.db")
    assert entry["kind"] == "manual_save" and entry["contents"]["customers"] == 2
    assert set(entry) <= {"filename", "kind", "saved_at", "size", "contents", "contents_error"}
    assert listed["count"] == 1 and listed["current"]["filename"] == "final.db"


# ---------------------------------------------------------------------------
# 2. Overlapping prices / deduction rules
# ---------------------------------------------------------------------------

def test_price_with_overlapping_months_is_created_with_a_warning(env):
    client, _mgr, _ = env
    first = post(client, "/pricing/prices", {"unit_id": "RFL-301", "customer_type": "Dealer", "unit_price": 900,
                                             "start_period": "2027-01"})
    assert first["warnings"] == []
    first_id = first["prices"][0]["price_id"]
    second = post(client, "/pricing/prices", {"unit_id": "RFL-301", "customer_type": "Dealer", "unit_price": 850,
                                              "start_period": "2027-04", "end_period": "2027-06"})
    text = " | ".join(second["warnings"])
    assert f"overlaps {first_id} (2027-01..open)" in text
    assert "the later start month wins" in text and "this price applies in 2027-04..2027-06" in text

    # Same months as an earlier start: the stored rule wins in the overlap.
    third = post(client, "/pricing/prices", {"unit_id": "RFL-301", "customer_type": "Dealer", "unit_price": 870,
                                             "start_period": "2026-10", "end_period": "2027-02"})
    assert any(f"so {first_id} applies in 2027-01..2027-02" in w for w in third["warnings"]), third["warnings"]

    # Another scope, or months that do not overlap: no warning.
    other = post(client, "/pricing/prices", {"unit_id": "RFL-301", "customer_type": "Distributor", "unit_price": 800,
                                             "start_period": "2027-03"})
    assert not any("overlaps" in w for w in other["warnings"])
    before = post(client, "/pricing/prices", {"unit_id": "RFL-301", "customer_type": "Distributor",
                                              "unit_price": 780, "start_period": "2026-01", "end_period": "2026-12"})
    assert not any("overlaps" in w for w in before["warnings"])

    # Two overlapping items of one request.
    bulk = post(client, "/pricing/prices", {"prices": [
        {"unit_id": "RFL-302", "customer_type": "Dealer", "unit_price": 990, "start_period": "2027-01"},
        {"unit_id": "RFL-302", "customer_type": "Dealer", "unit_price": 950, "start_period": "2027-07"}]})
    assert any(w.startswith("price 2: overlaps price 1 of this request") for w in bulk["warnings"]), bulk["warnings"]


def test_deduction_overlap_warning_respects_program_names(env):
    client, _mgr, _ = env
    coop = post(client, "/pricing/deductions", {"deduction_type": "other_allowance", "name": "Co-op",
                                                "customer_type": "Dealer", "rate": 0.02, "start_period": "2027-01"})
    coop_id = coop["rules"][0]["rule_id"]
    later = post(client, "/pricing/deductions", {"deduction_type": "other_allowance", "name": "Co-op",
                                                 "customer_type": "Dealer", "rate": 0.03,
                                                 "start_period": "2027-07", "end_period": "2027-12"})
    assert any(f"overlaps {coop_id} (2027-01..open)" in w and "the later start month wins" in w
               for w in later["warnings"]), later["warnings"]
    freight = post(client, "/pricing/deductions", {"deduction_type": "other_allowance", "name": "Freight",
                                                   "customer_type": "Dealer", "rate": 0.01,
                                                   "start_period": "2027-07"})
    assert not any("overlaps" in w for w in freight["warnings"])

    # PUT that makes a rule overlap another warns too.
    later_id = later["rules"][0]["rule_id"]
    res = client.put(f"/pricing/deductions/{later_id}", json={"start_period": "2026-12"})
    assert res.status_code == 200
    assert any(f"overlaps {coop_id}" in w for w in res.json()["data"]["warnings"])


def test_mcp_upsert_without_months_updates_the_one_same_scope_rule(env):
    client, mgr, _ = env
    created = post(client, "/pricing/prices", {"unit_id": "RFL-302", "customer_type": "Dealer", "unit_price": 990,
                                               "start_period": "2027-01", "end_period": "2027-12"})
    price_id = created["prices"][0]["price_id"]
    result = ok(client, "forecast_upsert_prices", {"prices": [
        {"unit_id": "RFL-302", "customer_type": "Dealer", "unit_price": 1010}]})
    assert result["created_count"] == 0 and result["updated_count"] == 1
    assert result["kept_months"] == [{"index": 0, "price_id": price_id, "months": "2027-01..2027-12"}]
    assert "kept its months" in result["note"]
    assert rows(mgr, "SELECT unit_price, start_period, end_period FROM price_list") == [(1010.0, "2027-01", "2027-12")]

    # Months given that overlap: created, and the note says so.
    result = ok(client, "forecast_upsert_prices", {"prices": [
        {"unit_id": "RFL-302", "customer_type": "Dealer", "unit_price": 960, "start_period": "2027-07"}]})
    assert result["created_count"] == 1
    assert "IMPORTANT" in result["note"] and f"overlaps {price_id}" in result["note"]
    assert result["overlaps"]

    # Two same-scope rules and no months: refused, nothing written.
    text = err(client, "forecast_upsert_prices", {"prices": [
        {"unit_id": "RFL-302", "customer_type": "Dealer", "unit_price": 1}]})
    assert "Nothing was written" in text and price_id in text
    assert rows(mgr, "SELECT COUNT(*) FROM price_list WHERE unit_price = 1") == [(0,)]


def test_mcp_deduction_upsert_without_months(env):
    client, mgr, _ = env
    post(client, "/pricing/deductions", {"deduction_type": "terms_allowance", "customer_type": "Dealer",
                                         "rate": 0.02, "start_period": "2027-01"})
    result = ok(client, "forecast_upsert_deduction_rules", {"rules": [
        {"deduction_type": "terms_allowance", "customer_type": "Dealer", "rate": 0.03}]})
    assert result["created_count"] == 0 and result["updated_count"] == 1 and result["kept_months"]
    assert rows(mgr, "SELECT rate, start_period, end_period FROM sales_deduction_rules") == [(0.03, "2027-01", None)]
    # No same-scope rule: created as before.
    result = ok(client, "forecast_upsert_deduction_rules", {"rules": [
        {"deduction_type": "terms_allowance", "customer_type": "Distributor", "rate": 0.01}]})
    assert result["created_count"] == 1 and "kept_months" not in result


# ---------------------------------------------------------------------------
# 3. Unchanged rows in imports
# ---------------------------------------------------------------------------

def test_sales_reimport_reports_unchanged_rows(env):
    client, _mgr, _ = env
    sales = [wide_row("C-DLR", "RFL-301", [5] * 12), wide_row("C-DST", "RFL-302", [3] * 12)]
    first = post(client, "/forecast/smart_import_sales", {"forecast_id": "F001", "sales": sales})
    assert (first["inserted"], first["updated"], first["unchanged"]) == (24, 0, 0)
    dry = post(client, "/forecast/smart_import_sales", {"forecast_id": "F001", "sales": sales, "dry_run": True})
    assert (dry["inserted"], dry["updated"], dry["unchanged"]) == (0, 0, 24)
    sales[0]["Mar-27"] = 7
    res = client.post("/forecast/smart_import_sales", json={"forecast_id": "F001", "sales": sales}).json()
    again = res["data"]
    assert (again["inserted"], again["updated"], again["unchanged"]) == (0, 1, 23)
    assert again["imported"] == 24 and "(0 new, 1 updated, 23 unchanged)" in res["message"]


def test_price_and_deduction_reimports_report_unchanged_rows(env):
    client, _mgr, _ = env
    prices = [{"unit_id": "RFL-301", "customer_type": "Dealer", "unit_price": 900},
              {"unit_id": "RFL-302", "customer_type": "Dealer", "discount_pct": "40%"}]
    first = post(client, "/import/prices", {"rows": prices})
    assert (first["created"], first["updated"], first["unchanged"]) == (2, 0, 0)
    dry = post(client, "/import/prices", {"rows": prices, "dry_run": True})
    assert (dry["created"], dry["updated"], dry["unchanged"]) == (0, 0, 2)
    assert [r["action"] for r in dry["records"]] == ["unchanged", "unchanged"]
    assert dry["summary"]["unchanged"] == 2 and dry["summary"]["rules_written"] == 0
    prices[0]["unit_price"] = 905
    again = post(client, "/import/prices", {"rows": prices})
    assert (again["created"], again["updated"], again["unchanged"]) == (0, 1, 1)
    assert "1 unchanged" in client.post("/import/prices", json={"rows": prices[1:]}).json()["message"]

    rules = [{"deduction_type": "terms", "customer_type": "Dealer", "rate": "2%"},
             {"deduction_type": "FET", "rate": "11%"}]
    first = post(client, "/import/deductions", {"rows": rules})
    assert (first["created"], first["unchanged"]) == (2, 0)
    second = post(client, "/import/deductions", {"rows": rules})
    assert (second["created"], second["updated"], second["unchanged"]) == (0, 0, 2)


# ---------------------------------------------------------------------------
# 4. Replace with a wide file: blank month columns are covered
# ---------------------------------------------------------------------------

def test_replace_with_a_blank_december_column_clears_december(env):
    client, mgr, _ = env
    post(client, "/forecast/smart_import_sales", {"forecast_id": "F001", "sales": [
        wide_row("C-DLR", "RFL-301", [5] * 12), wide_row("C-DST", "RFL-302", [3] * 12),
        wide_row("C-DLR", "RFL-302", [2] * 12)]})
    revised = [wide_row("C-DLR", "RFL-301", [5] * 11 + [None]), wide_row("C-DST", "RFL-302", [3] * 11 + [""])]
    preview = post(client, "/forecast/smart_import_sales", {
        "forecast_id": "F001", "sales": revised, "mode": "replace", "dry_run": True})
    assert preview["deleted"] == 2 + 12                     # two stale December rows + the dropped line
    assert preview["removed_line_count"] == 3
    removed = {(r["customer_id"], r["unit_id"]): r for r in preview["removed_lines"]}
    assert removed[("C-DLR", "RFL-301")]["months"] == ["2027-12"]
    assert removed[("C-DLR", "RFL-301")]["customer_name"] == "Main Street Guns"
    assert removed[("C-DLR", "RFL-301")]["unit_name"] == "Rifle 301"
    assert len(removed[("C-DLR", "RFL-302")]["months"]) == 12
    assert "2027-12" in preview["covered_months"] and len(preview["covered_months"]) == 12
    assert rows(mgr, "SELECT COUNT(*) FROM sales WHERE forecast_id = 'F001'") == [(36,)]   # dry run

    res = client.post("/forecast/smart_import_sales", json={"forecast_id": "F001", "sales": revised, "mode": "replace"})
    result = res.json()["data"]
    assert result["deleted"] == 14 and result["removed_line_count"] == 3
    assert "Removed 14 monthly rows (3 customer x product lines)" in res.json()["message"]
    assert rows(mgr, "SELECT COUNT(*) FROM sales WHERE forecast_id = 'F001' AND period = '2027-12'") == [(0,)]
    assert rows(mgr, "SELECT COUNT(*) FROM sales WHERE forecast_id = 'F001'") == [(22,)]


def test_upsert_keeps_rows_in_blank_columns(env):
    client, mgr, _ = env
    post(client, "/forecast/smart_import_sales", {"forecast_id": "F001", "sales": [
        wide_row("C-DLR", "RFL-301", [5] * 12)]})
    result = post(client, "/forecast/smart_import_sales", {"forecast_id": "F001", "sales": [
        wide_row("C-DLR", "RFL-301", [6] * 11 + [None])]})
    assert result["deleted"] == 0 and result["removed_lines"] == [] and result["covered_months"] == []
    assert rows(mgr, "SELECT quantity FROM sales WHERE period = '2027-12'") == [(5.0,)]


# ---------------------------------------------------------------------------
# 5. BOM / routing replace counts
# ---------------------------------------------------------------------------

def test_bom_and_routing_replace_counts(env):
    client, _mgr, _ = env
    bom = [{"bom_id": "BOM-1", "version": "1", "material_description": f"Part {i}", "qty": 1, "unit_price": 5}
           for i in range(3)]
    first = post(client, "/import/boms", {"rows": bom})
    assert (first["boms_replaced"], first["lines_deleted"]) == (0, 0)
    second = post(client, "/import/boms", {"rows": bom[:2]})
    assert second["boms_replaced"] == 1 and second["lines_deleted"] == 3 and second["replaced"] == 1
    assert second["summary"]["boms_replaced"] == 1 and second["summary"]["lines_deleted"] == 3
    message = client.post("/import/boms", json={"rows": bom[:2]}).json()["message"]
    assert "1 existing BOM replaced as a whole (2 old lines deleted)" in message

    ops = [{"router_id": "R-1", "machine_id": "CNC-01", "machine_minutes": 10, "labor_minutes": 5,
            "labor_type_id": "MACHINIST"} for _ in range(2)]
    first = post(client, "/import/routings", {"rows": ops})
    assert (first["routings_replaced"], first["operations_deleted"]) == (0, 0)
    second = post(client, "/import/routings", {"rows": ops[:1]})
    assert second["routings_replaced"] == 1 and second["operations_deleted"] == 2
    assert second["summary"]["routings_replaced"] == 1 and second["summary"]["operations_deleted"] == 2

    summary = ok(client, "forecast_import_boms", {"rows": bom, "dry_run": True})
    assert summary["boms_replaced"] == 1 and summary["lines_deleted"] == 2


# ---------------------------------------------------------------------------
# 6. Workbook file name
# ---------------------------------------------------------------------------

def test_workbook_filename_uses_the_scenario_name(env):
    client, mgr, data_dir = env
    from services.workbook_export import workbook_filename

    assert workbook_filename(["F001"], "2027-01", "2027-12", {"F001": "2027 Budget (v2)"}) == \
        "forecast_2027-budget-v2_2027-01_2027-12.xlsx"
    assert workbook_filename(["F001"], "2027-01", "2027-12", {}) == "forecast_F001_2027-01_2027-12.xlsx"
    assert workbook_filename(["F001", "F002"], "2027-01", "2027-03", {"F001": "Base", "F002": "Other"}) == \
        "forecast_base+other_2027-01_2027-03.xlsx"

    client.put("/forecast/scenario/F001", json={"name": "2027 Budget"})
    post(client, "/forecast/smart_import_sales", {"forecast_id": "F001", "sales": [
        wide_row("C-DLR", "RFL-301", [1] * 3)]})
    res = client.get("/reporting/workbook", params={"forecast_ids": "F001", "start_period": "2027-01",
                                                    "end_period": "2027-03"})
    assert res.status_code == 200
    assert 'filename="forecast_2027-budget_2027-01_2027-03.xlsx"' in res.headers["content-disposition"]

    saved = ok(client, "forecast_export_workbook", {"forecast_ids": ["F001"]})
    assert saved["filename"] == "forecast_2027-budget_2027-01_2027-03.xlsx"

    # A scenario without a usable name falls back to its id.
    conn = mgr.get_connection()
    conn.execute("UPDATE forecast SET name = '***' WHERE forecast_id = 'F001'")
    conn.commit()
    mgr.close_connection(conn)
    res = client.get("/reporting/workbook", params={"forecast_ids": "F001", "start_period": "2027-01",
                                                    "end_period": "2027-03"})
    assert 'filename="forecast_F001_2027-01_2027-03.xlsx"' in res.headers["content-disposition"]


# ---------------------------------------------------------------------------
# 7. Unique scenario names
# ---------------------------------------------------------------------------

def test_scenario_names_are_unique(env):
    client, _mgr, _ = env
    res = client.post("/forecast/scenario", json={"name": "  base "})
    assert res.status_code == 409 and "F001" in res.json()["detail"]
    created = client.post("/forecast/scenario", json={"name": "Upside"})
    assert created.status_code == 200
    upside = created.json()["data"]["forecast_id"]

    res = client.put(f"/forecast/scenario/{upside}", json={"name": "OTHER"})
    assert res.status_code == 409 and "F002" in res.json()["detail"]
    assert client.put("/forecast/scenario/F001", json={"name": "BASE "}).status_code == 200   # its own name
    assert client.get("/forecast/scenario/F001").json()["data"]["name"] == "BASE"

    first = client.post("/forecast/scenario/F001/duplicate", json={}).json()["data"]
    second = client.post("/forecast/scenario/F001/duplicate", json={}).json()["data"]
    assert (first["name"], second["name"]) == ("BASE Copy", "BASE Copy 2")
    res = client.post("/forecast/scenario/F001/duplicate", json={"name": "upside"})
    assert res.status_code == 409 and upside in res.json()["detail"]

    names = [client.post("/forecast/scenario", json={}).json()["data"]["name"] for _ in range(2)]
    assert names == ["New Scenario", "New Scenario 2"]

    assert upside in err(client, "forecast_create_scenario", {"name": "Upside"})


# ---------------------------------------------------------------------------
# 8. MCP sales listings: report_totals, limit=0
# ---------------------------------------------------------------------------

def test_mcp_sales_listings_carry_report_totals(env):
    client, _mgr, _ = env
    sales = [{"customer_id": "C-DLR", "unit_id": "RFL-301", "period": f"2027-0{m}", "quantity": 3,
              "unit_price": 333.3333} for m in range(1, 4)]
    sales += [{"customer_id": "C-DST", "unit_id": "RFL-302", "period": "2027-01", "quantity": 7, "unit_price": 99.995}]
    post(client, "/forecast/smart_import_sales", {"forecast_id": "F001", "sales": sales})
    api = client.get("/reporting/sales-detail", params={"forecast_ids": "F001", "start_period": "2027-01",
                                                        "end_period": "2027-03"}).json()["data"]

    listed = ok(client, "forecast_list_sales", {"forecast_id": "F001", "limit": 0})
    assert listed["has_more"] is False and "next_offset" not in listed and listed["returned"] == 0
    assert listed["report_totals"] == api["report_totals"]
    assert "report_totals" in listed["rounding_note"]
    assert listed["rounding"] == {k: v for k, v in api["rounding"].items() if v}

    filtered = ok(client, "forecast_list_sales", {"forecast_id": "F001", "customer_type": "dealer", "limit": 1})
    api_dealer = client.get("/reporting/sales-detail", params={
        "forecast_ids": "F001", "start_period": "2027-01", "end_period": "2027-03",
        "customer_type": "Dealer"}).json()["data"]
    assert filtered["report_totals"] == api_dealer["report_totals"]
    assert filtered["has_more"] is True and filtered["next_offset"] == 1

    detail = ok(client, "forecast_sales_detail", {"forecast_ids": ["F001"]})
    assert detail["report_totals"] == api["report_totals"] and "rounding_note" in detail
    by_customer = ok(client, "forecast_sales_detail", {"forecast_ids": ["F001"], "customer_id": "c-dst"})
    assert by_customer["total_count"] == 1
    assert by_customer["report_totals"]["gross_sales"] == pytest.approx(7 * 99.995, abs=0.01)
