"""
Last-round fixes:

(a) The MCP file reader (read_table_file / load_rows) finds the header row
    with the import API's alias-aware guess_header_row, so a report title
    above the header is skipped even when it fills two cells, and keeps a
    column whose header cell is blank but holds data as 'column_<n>' (the
    import then reports it as ignored instead of the values vanishing).
(b) JSON create / update of deduction rules and prices returns
    non-blocking plausibility warnings (deduction rate over 25%, excise tax
    over 20%, discount over 80% off list): the import path's thresholds.
"""
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from datetime import datetime

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


def _seed(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F001', 'Base', 1)")
    for cid, name, ctype in (("C-DLR", "Main Street Guns", "Dealer"), ("C-DST", "Big Sky", "Distributor")):
        c.execute("INSERT INTO customers (customer_id, customer_name, customer_type) VALUES (?, ?, ?)",
                  (cid, name, ctype))
    for uid, name, utype, price in (("RFL-301", "Rifle 301", "Rifle", 1000), ("RFL-302", "Rifle 302", "Rifle", 1100)):
        c.execute("INSERT INTO units (unit_id, unit_name, unit_type, base_price) VALUES (?, ?, ?, ?)",
                  (uid, name, utype, price))
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
    os.makedirs(os.path.join(data_dir, "imports"))
    mgr = DatabaseManager(database_path=os.path.join(data_dir, "last_round.db"), data_dir=data_dir)
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


def ok(client, name, arguments=None):
    res = client.post("/mcp", headers=HEADERS, follow_redirects=False, json={
        "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments or {}},
    })
    assert res.status_code == 200, res.text
    result = res.json()["result"]
    text = "".join(b.get("text", "") for b in result.get("content", []) if b.get("type") == "text")
    assert not result.get("isError"), text
    return json.loads(text)


def scalar(mgr, sql, params=()):
    conn = mgr.get_connection()
    try:
        return conn.execute(sql, params).fetchone()[0]
    finally:
        mgr.close_connection(conn)


def _write_csv(data_dir: str, name: str, text: str) -> str:
    with open(os.path.join(data_dir, "imports", name), "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    return f"imports/{name}"


# ---------------------------------------------------------------------------
# (a) Header row detection in the MCP file reader
# ---------------------------------------------------------------------------

def test_xlsx_with_a_two_cell_title_row_above_the_header(env):
    client, mgr, data_dir = env
    from openpyxl import Workbook
    from mcp_server.tools.imports import read_table_file

    wb = Workbook()
    ws = wb.active
    ws.title = "Costed BOM"
    ws.append(["Costed Bill of Material", None, None, None, "Run date: 10/12/2026"])   # two filled cells
    ws.append([None] * 5)
    ws.append(["Parent Item", "Item Number", "Component Description", "Qty Per", "Std Cost"])
    ws.append(["BOM-301", "BBL-1", "Barrel", 1, 100])
    ws.append(["BOM-301", "STK-1", "Stock", 1, 60])
    wb.save(os.path.join(data_dir, "imports", "costed_bom.xlsx"))

    rows, info = read_table_file("imports/costed_bom.xlsx")
    assert info["header_row"] == 3, info
    assert info["columns"] == ["Parent Item", "Item Number", "Component Description", "Qty Per", "Std Cost"]
    assert info["row_count"] == 2 and rows[0]["Item Number"] == "BBL-1" and "unnamed_columns" not in info

    preview = ok(client, "forecast_preview_file", {"file_path": "imports/costed_bom.xlsx"})
    assert preview["header_row"] == 3 and preview["likely_imports"][0]["kind"] == "boms", preview

    dry = ok(client, "forecast_import_boms", {"file_path": "imports/costed_bom.xlsx", "dry_run": True})
    assert dry["status"] == "ok" and dry["created"] == 2 and dry["source"]["header_row"] == 3, dry
    assert scalar(mgr, "SELECT COUNT(*) FROM bom") == 0

    # An explicit header_row still wins over the detection.
    _rows, info = read_table_file("imports/costed_bom.xlsx", header_row=1)
    assert info["header_row"] == 1 and info["columns"][0] == "Costed Bill of Material"


def test_xlsx_month_headers_as_excel_dates_below_a_title_are_detected(env):
    _client, _mgr, data_dir = env
    from openpyxl import Workbook
    from mcp_server.tools.imports import read_table_file

    wb = Workbook()
    ws = wb.active
    ws.append(["Sales Forecast 2027", "Prepared by: Finance"])
    ws.append(["Customer", "SKU"] + [datetime(2027, m, 1) for m in (1, 2, 3, 4)])
    ws.append(["C-DLR", "RFL-301", 10, 12, 14, 16])
    wb.save(os.path.join(data_dir, "imports", "wide_titled.xlsx"))

    rows, info = read_table_file("imports/wide_titled.xlsx")
    assert info["header_row"] == 2, info
    assert info["columns"] == ["Customer", "SKU", "2027-01", "2027-02", "2027-03", "2027-04"]
    assert rows == [{"Customer": "C-DLR", "SKU": "RFL-301", "2027-01": 10, "2027-02": 12, "2027-03": 14,
                     "2027-04": 16}]


def test_csv_with_a_report_line_above_the_header(env):
    client, mgr, data_dir = env
    from mcp_server.tools.imports import load_rows

    path = _write_csv(data_dir, "price_list.csv",
                      "Acme Firearms Price List - Run date 10/12/2026,Page 1 of 1\n"
                      "Product,Customer Type,Price\n"
                      "RFL-301,Dealer,850\n"
                      'RFL-302,Distributor,"1,020.00"\n')
    rows, source = load_rows(None, path)
    assert source["header_row"] == 2, source
    assert rows == [{"Product": "RFL-301", "Customer Type": "Dealer", "Price": "850"},
                    {"Product": "RFL-302", "Customer Type": "Distributor", "Price": "1,020.00"}]

    res = ok(client, "forecast_import_prices", {"file_path": path})
    assert res["status"] == "ok" and res["created"] == 2 and res["source"]["header_row"] == 2, res
    assert scalar(mgr, "SELECT unit_price FROM price_list WHERE unit_id = 'RFL-302' "
                       "AND customer_type = 'Distributor'") == 1020

    # A one-cell report line (no delimiter in it) is skipped too.
    path = _write_csv(data_dir, "customers.csv", "Customer master as of 10/12/2026\n"
                                                 "Customer ID,Customer Name,Customer Type\nC-NEW,Range Co,Dealer\n")
    rows, source = load_rows(None, path)
    assert source["header_row"] == 2 and rows[0]["Customer ID"] == "C-NEW"


# ---------------------------------------------------------------------------
# (a) Columns with a blank header
# ---------------------------------------------------------------------------

def test_blank_header_column_with_data_is_kept_and_reported_as_ignored(env):
    client, mgr, data_dir = env
    from mcp_server.tools.imports import read_table_file

    path = _write_csv(data_dir, "customers_notes.csv",
                      "Customer ID,Customer Name,,Customer Type,\n"
                      "C-NEW,Range Co,call before shipping,Dealer,\n"
                      "C-NEW2,Ridge Co,,Distributor,\n")
    rows, info = read_table_file(path)
    assert info["columns"] == ["Customer ID", "Customer Name", "column_3", "Customer Type"], info
    assert info["unnamed_columns"] == ["column_3"]          # column 5 has no header and no data: dropped
    assert rows[0]["column_3"] == "call before shipping" and rows[1]["column_3"] == ""

    res = ok(client, "forecast_import_records", {"table": "customers", "file_path": path, "dry_run": True})
    assert res["status"] == "ok" and res["created"] == 2, res
    assert res["source"]["unnamed_columns"] == ["column_3"]
    assert any("Ignored columns" in w and "column_3" in w for w in res["warnings"]), res["warnings"]
    assert scalar(mgr, "SELECT COUNT(*) FROM customers") == 2

    preview = ok(client, "forecast_preview_file", {"file_path": path})
    assert preview["unnamed_columns"] == ["column_3"] and "column_3" in preview["columns"]


def test_xlsx_data_past_the_last_header_cell_is_kept(env):
    _client, _mgr, data_dir = env
    from openpyxl import Workbook
    from mcp_server.tools.imports import read_table_file

    wb = Workbook()
    ws = wb.active
    ws.append([None, "Product", "Customer Type", "Price"])        # column A unlabelled (row numbers)
    ws.append([1, "RFL-301", "Dealer", 850, "per 10/1 memo"])     # column E: data, no header
    ws.append([2, "RFL-302", "Dealer", 900])
    wb.save(os.path.join(data_dir, "imports", "prices_extra.xlsx"))

    rows, info = read_table_file("imports/prices_extra.xlsx")
    assert info["header_row"] == 1
    assert info["columns"] == ["column_1", "Product", "Customer Type", "Price", "column_5"], info
    assert info["unnamed_columns"] == ["column_1", "column_5"]
    assert rows[0]["column_5"] == "per 10/1 memo" and rows[1]["column_1"] == 2 and rows[1].get("column_5") is None


def test_generated_name_never_collides_with_a_real_header(env):
    _client, _mgr, data_dir = env
    from mcp_server.tools.imports import read_table_file

    path = _write_csv(data_dir, "collide.csv", "Customer ID,,column_2\nC1,x,y\n")
    rows, info = read_table_file(path)
    assert info["columns"] == ["Customer ID", "column_2", "column_2 (2)"]
    assert rows[0] == {"Customer ID": "C1", "column_2": "x", "column_2 (2)": "y"}


# ---------------------------------------------------------------------------
# (b) Plausibility warnings on JSON create / update
# ---------------------------------------------------------------------------

def _data(res):
    assert res.status_code == 200, res.text
    return res.json()["data"]


def test_deduction_rule_create_and_update_warn_on_implausible_rates(env):
    client, mgr, _data_dir = env
    created = _data(client.post("/pricing/deductions", json={"deduction_type": "terms_allowance", "rate": 0.5,
                                                             "customer_type": "Dealer"}))
    assert created["created"] == 1
    high = [w for w in created["warnings"] if "unusually high" in w]
    assert len(high) == 1 and "50%" in high[0] and "over 25%" in high[0] and "0.005" in high[0], created["warnings"]
    rule_id = created["rules"][0]["rule_id"]
    assert scalar(mgr, "SELECT rate FROM sales_deduction_rules WHERE rule_id = ?", (rule_id,)) == 0.5  # not blocked

    fixed = _data(client.put(f"/pricing/deductions/{rule_id}", json={"rate": 0.02}))
    assert not any("unusually high" in w for w in fixed["warnings"]), fixed["warnings"]
    again = _data(client.put(f"/pricing/deductions/{rule_id}", json={"rate": 0.3}))
    assert any("unusually high" in w and "30%" in w for w in again["warnings"]), again["warnings"]

    # Excise tax: 11% FET is fine, over 20% warns; 25% is fine for other types.
    bulk = _data(client.post("/pricing/deductions", json={"rules": [
        {"deduction_type": "excise_tax", "method": "embedded_tax", "rate": 0.11},
        {"deduction_type": "excise_tax", "method": "embedded_tax", "rate": 0.21, "customer_type": "Distributor"},
        {"deduction_type": "commission", "rate": 0.25},
        {"deduction_type": "chargebacks", "method": "per_unit", "amount_per_unit": 400},
    ]}))
    assert bulk["created"] == 4
    high = [w for w in bulk["warnings"] if "unusually high" in w]
    assert len(high) == 1 and high[0].startswith("rule 2:") and "over 20%" in high[0], bulk["warnings"]


def test_price_create_and_update_warn_on_discounts_over_80_percent(env):
    client, mgr, _data_dir = env
    created = _data(client.post("/pricing/prices", json={"prices": [
        {"customer_type": "Dealer", "discount_pct": 0.85},
        {"customer_type": "Distributor", "discount_pct": 0.40},
        {"unit_id": "RFL-301", "customer_id": "C-DLR", "unit_price": 900},
    ]}))
    assert created["created"] == 3
    high = [w for w in created["warnings"] if "unusually high" in w]
    assert len(high) == 1 and high[0].startswith("price 1:") and "85%" in high[0], created["warnings"]
    price_id = created["prices"][1]["price_id"]
    assert scalar(mgr, "SELECT COUNT(*) FROM price_list") == 3                           # not blocked

    updated = _data(client.put(f"/pricing/prices/{price_id}", json={"discount_pct": 0.9}))
    assert any("unusually high" in w and "90%" in w for w in updated["warnings"]), updated["warnings"]
    fine = _data(client.put(f"/pricing/prices/{price_id}", json={"discount_pct": 0.8}))
    assert not any("unusually high" in w for w in fine["warnings"]), fine["warnings"]


def test_json_and_import_paths_share_the_thresholds():
    from api import import_routes, pricing_routes

    rule = {"deduction_type": "terms_allowance", "method": "percent_of_gross", "rate": 0.26}
    assert pricing_routes._plausibility_warnings(rule, "rule", is_price=False)
    assert import_routes._plausibility_warnings(rule, {}, "Row 1", is_price=False)
    for rate in (0.25, 0.0):
        assert not pricing_routes._plausibility_warnings({**rule, "rate": rate}, "rule", is_price=False)
    assert not pricing_routes._plausibility_warnings(
        {"deduction_type": "excise_tax", "method": "embedded_tax", "rate": 0.2}, "rule", is_price=False)
    assert pricing_routes._plausibility_warnings(
        {"deduction_type": "excise_tax", "method": "embedded_tax", "rate": 0.2001}, "rule", is_price=False)
    assert pricing_routes._plausibility_warnings({"discount_pct": 0.81}, "price", is_price=True)
    assert not pricing_routes._plausibility_warnings({"discount_pct": None, "unit_price": 5}, "price", is_price=True)
