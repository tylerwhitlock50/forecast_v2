"""
/import routes (BOMs, routings, master records, prices, deductions,
templates), the sales import (/forecast/smart_import_sales) and the period
normalizer.

Every write endpoint is checked for the happy path, header aliases,
validation errors with 1-based row numbers, and that dry_run leaves the
database unchanged. The template round-trip test imports every CSV template
in setup order and gets a priced, costed 2027 forecast out of it.
"""
import csv
import io
import os
import shutil
import sqlite3
import sys
import tempfile
from datetime import date, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

_APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir, "app"))
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from app.db.database import DatabaseManager  # noqa: E402
from utils.period_normalizer import normalize_month, normalize_period, period_kind  # noqa: E402

F = "F001"


def _seed(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("INSERT INTO forecast (forecast_id, name, is_base) VALUES ('F001', 'Plan 2027', 1)")
    c.executemany("INSERT INTO customers (customer_id, customer_name, customer_type, region) VALUES (?, ?, ?, ?)", [
        ("CUST-001", "Main Street Guns", "Dealer", "Midwest"),
        ("CUST-002", "Big Sky Sporting", "Distributor", "Mountain"),
    ])
    c.executemany("INSERT INTO units (unit_id, unit_name, base_price, unit_type) VALUES (?, ?, ?, ?)", [
        ("RFL-308", "Ridgeline .308", 1499, "Rifle"),
        ("PST-9C", "Compact 9mm", 599, "Pistol"),
    ])
    c.executemany("INSERT INTO machines (machine_id, machine_name, machine_rate, available_minutes_per_month) VALUES (?, ?, ?, ?)", [
        ("CNC-01", "Haas CNC Mill", 85, 19200),
        ("LATHE-01", "Barrel Lathe", 70, 19200),
    ])
    c.executemany("INSERT INTO labor_rates (rate_id, rate_name, rate_amount, rate_type) VALUES (?, ?, ?, 'hourly')", [
        ("MACHINIST", "CNC Machinist", 30),
        ("ASSEMBLER", "Assembler", 24),
    ])
    conn.commit()
    conn.close()


@pytest.fixture()
def env():
    tmp = tempfile.mkdtemp()
    db_path = os.path.join(tmp, "import.db")
    mgr = DatabaseManager(database_path=db_path, data_dir=tmp)
    mgr.initialize()
    _seed(db_path)

    import app.db.database as dbmod
    import db.database as dbmod_short
    from api import forecast_routes, import_routes, pricing_routes
    originals = (dbmod.db_manager, dbmod_short.db_manager, pricing_routes.db_manager, import_routes.db_manager)
    dbmod.db_manager = dbmod_short.db_manager = pricing_routes.db_manager = import_routes.db_manager = mgr
    app = FastAPI()
    for module in (import_routes, pricing_routes, forecast_routes):
        app.include_router(module.router)
    try:
        yield TestClient(app), mgr
    finally:
        (dbmod.db_manager, dbmod_short.db_manager, pricing_routes.db_manager, import_routes.db_manager) = originals
        mgr.close_all_connections()
        shutil.rmtree(tmp, ignore_errors=True)


def q(mgr, sql, params=()):
    conn = mgr.get_connection()
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        mgr.close_connection(conn)


def post(client, path, body, status=200):
    res = client.post(path, json=body)
    assert res.status_code == status, res.text
    return res.json()["data"] if status == 200 else res.json()


def snapshot(mgr):
    """Every row of every table touched by imports (for dry-run checks)."""
    out = {}
    for table in ("bom", "bom_definitions", "router_definitions", "router_operations", "units", "customers",
                  "machines", "labor_rates", "price_list", "sales_deduction_rules", "sales"):
        out[table] = sorted(q(mgr, f"SELECT * FROM {table}"), key=repr)
    return out


# ---------------------------------------------------------------------------
# Period normalizer
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw", [
    "2027-01", "2027-1", "2027/01", "2027/1", "2027.01", "1/2027", "01/2027", "1-2027", "1/15/2027", "01/15/2027",
    "1/15/27", "2027-01-15", "2027/01/15", "2027-01-15T00:00:00", "2027-01-15 00:00:00", "1/15/2027 0:00",
    "Jan-27", "Jan 2027", "January 2027", "Jan-2027", "jan-2027", "JAN 27", "2027 Jan", "2027-Jan", "Jan. 2027",
    46388, 46388.0, "46388", "46418", date(2027, 1, 15), datetime(2027, 1, 31, 23, 59), "  2027-01  ",
])
def test_normalize_period_monthly_forms(raw):
    assert normalize_period(raw) == "2027-01"
    assert normalize_month(raw) == "2027-01"


@pytest.mark.parametrize("raw, expected", [
    ("Sept 2027", "2027-09"), ("Dec-27", "2027-12"), ("12/2027", "2027-12"), ("2027-12-31", "2027-12"),
    ("May 2027", "2027-05"), ("March 2027", "2027-03"), (46752, "2027-12"),
])
def test_normalize_period_other_months(raw, expected):
    assert normalize_period(raw) == expected


def test_normalize_period_keeps_quarters_and_weeks():
    assert normalize_period("2027-Q1") == "2027-Q1"
    assert normalize_period("2027-q3") == "2027-Q3"
    assert normalize_period("2027-W05") == "2027-W05"
    assert normalize_period("2027-W05-02") == "2027-W05"
    assert period_kind(normalize_period("2027-Q1")) == "quarter"
    assert period_kind(normalize_period("2027-W05")) == "week"
    assert period_kind("2027-01") == "month"
    assert normalize_month("2027-Q1") is None and normalize_month("2027-W05") is None


def test_month_name_helpers():
    from utils.period_normalizer import month_from_name, month_in_year
    assert [month_from_name(v) for v in ("Jan", "september", "Sept.", "DEC")] == [1, 9, 9, 12]
    assert month_from_name("Jan-27") is None and month_from_name("Total") is None and month_from_name(1) is None
    assert month_in_year(3, 2027) == "2027-03" and month_in_year(3, "2027.0") == "2027-03"
    assert month_in_year(3, "27") == "2027-03" and month_in_year(3, None) is None and month_in_year(3, "x") is None


@pytest.mark.parametrize("raw", [
    None, "", "  ", "2027-13", "2027-00", "13/2027", "13/15/2027", "1/32/2027", "Foo 2027", "Total",
    "2027", 2027, 12345, 99999, True, float("nan"), "2027-01-45",
])
def test_normalize_period_rejects_junk(raw):
    assert normalize_period(raw) is None


# ---------------------------------------------------------------------------
# Header aliases
# ---------------------------------------------------------------------------

def test_no_alias_maps_to_two_fields():
    from api import import_routes as ir
    maps = [ir.BOM_FIELDS, ir.ROUTING_FIELDS, ir.SALES_FIELDS, ir.PRICE_IMPORT_FIELDS, ir.DEDUCTION_IMPORT_FIELDS]
    maps += [spec["fields"] for spec in ir.RECORD_TABLES.values()]
    for field_map in maps:
        owner = {}
        for canonical, aliases in field_map.fields.items():
            for alias in (canonical, *aliases):
                key = ir.header_key(alias)
                assert owner.setdefault(key, canonical) == canonical, (alias, owner[key], canonical)


def test_header_matching_ignores_case_and_punctuation():
    from api.import_routes import BOM_FIELDS
    data, unknown = BOM_FIELDS.map_row({"BOM_Number": "B1", "qty-per": "2", " Unit Cost ($) ": "3", "Color": "red",
                                        "Material": "  Steel  ", "Description": ""})
    assert data == {"bom_id": "B1", "qty": "2", "unit_price": "3", "material_description": "Steel"}
    assert unknown == ["Color"]


# ---------------------------------------------------------------------------
# BOMs
# ---------------------------------------------------------------------------

def test_bom_import_with_alias_headers_links_products(env):
    client, mgr = env
    data = post(client, "/import/boms", {"rows": [
        {"BOM Number": "BOM-RFL", "Rev": "1", "Part #": "BRL-22", "Component": "Barrel blank", "Qty Per": "1",
         "UOM": "ea", "Unit Cost": "$185.00", "SKU": "RFL-308"},
        {"BOM Number": "BOM-RFL", "Rev": "1", "Component": "Receiver", "Qty Per": 1, "Std Cost": "140"},
        {"BOM Number": "BOM-RFL", "Rev": "1", "Component": "Screws", "Qty Per": 4, "Extended Cost": "2.00"},
        {"BOM Number": "", "Rev": "", "Component": "", "Qty Per": ""},                       # blank row
        {"bom_id": "BOM-PST", "material_description": "Slide", "qty": 1, "unit_price": 80, "unit_id": "GHOST"},
    ]})
    assert data["created"] == 4 and data["errors"] == [] and data["summary"]["blank_rows"] == 1
    assert data["mode"] == "replace" and data["dry_run"] is False
    boms = {b["bom_id"]: b for b in data["boms"]}
    rfl = boms["BOM-RFL"]
    assert rfl["version"] == "1.0" and rfl["lines"] == 3 and rfl["action"] == "created"
    assert rfl["material_cost_per_unit"] == 327.0
    assert rfl["linked_products"] == ["RFL-308"] and rfl["used_by_products"] == ["RFL-308"]
    lines = q(mgr, "SELECT bom_line, material_description, qty, unit_price, material_cost FROM bom "
                   "WHERE bom_id = 'BOM-RFL' ORDER BY bom_line")
    assert lines == [(1, "BRL-22 - Barrel blank", 1.0, 185.0, 185.0), (2, "Receiver", 1.0, 140.0, 140.0),
                     (3, "Screws", 4.0, 0.5, 2.0)]                   # unit_price derived from extended cost
    assert q(mgr, "SELECT bom_id, bom_version FROM units WHERE unit_id = 'RFL-308'") == [("BOM-RFL", "1.0")]
    assert q(mgr, "SELECT bom_name, version FROM bom_definitions WHERE bom_id = 'BOM-RFL'") == [("BOM-RFL", "1.0")]
    text = " | ".join(data["warnings"])
    assert "GHOST" in text and "Part #" not in text                 # unknown product = warning, not error
    assert "BOM-PST v1.0 is not used by any product" in text


def test_bom_component_and_description_columns(env):
    client, mgr = env
    data = post(client, "/import/boms", {"rows": [
        {"Assembly": "B-ERP", "Component": "SPR-01", "Description": "Firing pin spring", "Qty": 1, "Cost": 0.4},
        {"Assembly": "B-ERP", "Component": "Trigger group", "Qty": 1, "Cost": 30},
    ]})
    assert data["errors"] == []
    assert q(mgr, "SELECT material_description FROM bom WHERE bom_id = 'B-ERP' ORDER BY bom_line") == \
        [("SPR-01 - Firing pin spring",), ("Trigger group",)]


def test_bom_replace_and_append(env):
    client, mgr = env
    post(client, "/import/boms", {"rows": [
        {"bom_id": "B1", "material_description": m, "qty": 1, "unit_price": p, "unit_id": "RFL-308"}
        for m, p in (("A", 10), ("B", 20), ("C", 30))
    ]})
    data = post(client, "/import/boms", {"rows": [
        {"bom_id": "B1", "material_description": "A2", "qty": 2, "unit_price": 10},
        {"bom_id": "B1", "material_description": "D", "qty": 1, "unit_price": 5},
    ]})
    assert data["replaced"] == 1 and data["created"] == 2 and data["summary"]["lines_deleted"] == 3
    assert data["boms"][0]["action"] == "replaced" and data["boms"][0]["material_cost_per_unit"] == 25.0
    assert q(mgr, "SELECT bom_line, material_description FROM bom WHERE bom_id = 'B1' ORDER BY bom_line") == \
        [(1, "A2"), (2, "D")]
    assert data["boms"][0]["used_by_products"] == ["RFL-308"]       # existing link kept

    appended = post(client, "/import/boms", {"mode": "append", "rows": [
        {"bom_id": "B1", "bom_line": 2, "material_description": "D (new price)", "qty": 1, "unit_price": 6},
        {"bom_id": "B1", "material_description": "E", "qty": 1, "unit_price": 1},
    ]})
    assert appended["updated"] == 1 and appended["created"] == 1 and appended["replaced"] == 0
    assert q(mgr, "SELECT bom_line, material_description, material_cost FROM bom WHERE bom_id = 'B1' ORDER BY bom_line") == \
        [(1, "A2", 20.0), (2, "D (new price)", 6.0), (3, "E", 1.0)]


def test_bom_errors_skip_the_whole_bom(env):
    client, mgr = env
    data = post(client, "/import/boms", {"rows": [
        {"bom_id": "BAD", "material_description": "ok", "qty": 1, "unit_price": 1},
        {"bom_id": "BAD", "material_description": "neg", "qty": -1, "unit_price": 1},
        {"bom_id": "GOOD", "material_description": "x", "qty": "two", "unit_price": 1},
        {"bom_id": "GOOD2", "material_description": "fine", "qty": 1, "unit_price": 3},
        {"material_description": "orphan", "qty": 1},
        {"bom_id": "DUP", "bom_line": 1, "material_description": "a", "unit_price": 1},
        {"bom_id": "DUP", "bom_line": 1, "material_description": "b", "unit_price": 1},
        {"bom_id": "ZERO", "material_description": "z", "qty": 0, "material_cost": 5},
        {"bom_id": "MIS", "material_description": "m", "qty": 2, "unit_price": 5, "material_cost": 20},
    ]})
    errors = {e["row"]: e["error"] for e in data["errors"]}
    assert set(errors) == {2, 3, 5, 7, 8}
    assert "negative" in errors[2] and "number" in errors[3] and "bom_id is required" in errors[5]
    assert "repeats row 6" in errors[7] and "qty is 0" in errors[8]
    assert data["skipped"] == 2                                     # row 1 (BAD) and row 6 (DUP)
    assert data["created"] == 2                                     # GOOD2 and MIS
    assert q(mgr, "SELECT DISTINCT bom_id FROM bom ORDER BY bom_id") == [("GOOD2",), ("MIS",)]
    text = " | ".join(data["warnings"])
    assert "BOM BAD v1.0 was not imported" in text and "differs from qty x unit_price" in text
    qty_default = post(client, "/import/boms", {"rows": [{"bom_id": "Q", "material_description": "label"}]})
    assert any("imported as 1" in w for w in qty_default["warnings"])
    assert any("cost $0" in w for w in qty_default["warnings"])


def test_bom_dry_run_changes_nothing(env):
    client, mgr = env
    post(client, "/import/boms", {"rows": [{"bom_id": "B1", "material_description": "A", "qty": 1, "unit_price": 10}]})
    before = snapshot(mgr)
    data = post(client, "/import/boms", {"dry_run": True, "rows": [
        {"bom_id": "B1", "version": 1, "material_description": "Z", "qty": 3, "unit_price": 7, "unit_id": "PST-9C"},
        {"bom_id": "B2", "version": "v2", "material_description": "Y", "qty": 1, "unit_price": 1},
    ]})
    assert data["dry_run"] is True and data["replaced"] == 1 and data["created"] == 2
    assert {b["bom_id"]: b["material_cost_per_unit"] for b in data["boms"]} == {"B1": 21.0, "B2": 1.0}
    assert data["boms"][1]["version"] == "2.0"
    assert snapshot(mgr) == before


def test_bom_version_mismatch_warning(env):
    client, mgr = env
    post(client, "/import/boms", {"rows": [{"bom_id": "B9", "material_description": "A", "qty": 1, "unit_price": 1,
                                            "unit_id": "PST-9C"}]})
    data = post(client, "/import/boms", {"rows": [{"bom_id": "B9", "version": "2", "material_description": "A",
                                                   "qty": 1, "unit_price": 2}], "mode": "replace"})
    # PST-9C still points at version 1.0, which still has lines: no warning; the 2.0 BOM is unused.
    assert any("B9 v2.0 is not used" in w for w in data["warnings"])
    conn = mgr.get_connection()
    conn.execute("DELETE FROM bom WHERE bom_id = 'B9' AND version = '1.0'")
    conn.commit()
    mgr.close_connection(conn)
    data = post(client, "/import/boms", {"rows": [{"bom_id": "B9", "version": "2", "material_description": "A",
                                                   "qty": 1, "unit_price": 2}]})
    assert any("PST-9C points at BOM B9 version 1.0" in w for w in data["warnings"])


def test_import_request_validation(env):
    client, _ = env
    assert client.post("/import/boms", json={"rows": []}).status_code == 422
    assert client.post("/import/boms", json={"rows": [1, 2]}).status_code == 422
    assert client.post("/import/boms", json={"rows": [{"bom_id": "x"}], "mode": "merge"}).status_code == 422
    assert client.post("/import/routings", json={}).status_code == 422
    assert client.post("/import/records", json={"table": "sales", "rows": [{"a": 1}]}).status_code == 422
    assert client.post("/import/prices", json={"rows": [{"a": 1}], "forecast_id": "F999"}).status_code == 404


# ---------------------------------------------------------------------------
# Routings
# ---------------------------------------------------------------------------

def test_routing_import_aliases_names_and_costs(env):
    client, mgr = env
    data = post(client, "/import/routings", {"rows": [
        {"Routing": "R-RFL", "Routing Name": "Rifle", "Work Center": "LATHE-01", "Run Minutes": 45, "Labor Min": 15,
         "Labor Type": "CNC Machinist", "Description": "Turn barrel", "SKU": "RFL-308"},
        {"Routing": "R-RFL", "Work Center": "haas cnc mill", "Run Minutes": "60", "Labor Min": "30",
         "Labor Type": "MACHINIST"},
        {"Routing": "R-RFL", "Work Center": "CNC-01", "Machine Hours": "0.5", "Labor Hours": 1, "Labor Type": "assembler"},
    ]})
    assert data["errors"] == [] and data["created"] == 3
    ops = q(mgr, "SELECT sequence, machine_id, machine_minutes, labor_minutes, labor_type_id, operation_description "
                 "FROM router_operations WHERE router_id = 'R-RFL' ORDER BY sequence")
    assert ops == [(10, "LATHE-01", 45.0, 15.0, "MACHINIST", "Turn barrel"),
                   (20, "CNC-01", 60.0, 30.0, "MACHINIST", None),
                   (30, "CNC-01", 30.0, 60.0, "ASSEMBLER", None)]
    routing = data["routings"][0]
    assert routing["operations"] == 3 and routing["linked_products"] == ["RFL-308"]
    assert routing["labor_minutes_per_unit"] == 105
    assert routing["labor_cost_per_unit"] == round(45 / 60 * 30 + 24, 4)
    assert routing["machine_cost_per_unit"] == round(45 / 60 * 70 + 90 / 60 * 85, 4)
    assert q(mgr, "SELECT router_id, router_version FROM units WHERE unit_id = 'RFL-308'") == [("R-RFL", "1.0")]
    assert q(mgr, "SELECT router_name FROM router_definitions WHERE router_id = 'R-RFL'") == [("Rifle",)]


def test_routing_unknown_resources_and_auto_create(env):
    client, mgr = env
    rows = [
        {"router_id": "R-NEW", "sequence": 10, "machine_id": "LASER-01", "machine_minutes": 5, "labor_minutes": 5,
         "labor_type_id": "ENGRAVER"},
        {"router_id": "R-NEW", "sequence": 20, "machine_id": "", "labor_minutes": 20, "labor_type_id": "ASSEMBLER"},
        {"router_id": "R-NEW", "sequence": 30, "machine_id": "CNC-01", "labor_minutes": 5},
    ]
    data = post(client, "/import/routings", {"rows": rows})
    errors = {e["row"]: e["error"] for e in data["errors"]}
    assert "Unknown machine 'LASER-01'" in errors[1] and "machine_id is required" in errors[2]
    assert data["created"] == 0 and data["skipped"] == 1          # row 3 skipped with its routing
    assert q(mgr, "SELECT COUNT(*) FROM router_operations WHERE router_id = 'R-NEW'") == [(0,)]

    before = snapshot(mgr)
    dry = post(client, "/import/routings", {"rows": rows, "auto_create": True, "dry_run": True})
    assert dry["errors"] == [] and dry["created"] == 3
    assert sorted(dry["created_machines"]) == ["LASER-01", "MANUAL"] and dry["created_labor_types"] == ["ENGRAVER"]
    assert snapshot(mgr) == before

    data = post(client, "/import/routings", {"rows": rows, "auto_create": True})
    assert q(mgr, "SELECT machine_rate FROM machines WHERE machine_id = 'LASER-01'") == [(0.0,)]
    assert q(mgr, "SELECT rate_amount FROM labor_rates WHERE rate_id = 'ENGRAVER'") == [(0.0,)]
    text = " | ".join(data["warnings"])
    assert "placeholder machines" in text and "placeholder labor types" in text
    assert "labor minutes but no labor type" in text
    assert "router_labor_without_type" in data["routings"][0]["cost_warnings"]


def test_routing_replace_append_and_duplicates(env):
    client, mgr = env
    base = [{"router_id": "R1", "machine_id": "CNC-01", "machine_minutes": m} for m in (1, 2, 3)]
    post(client, "/import/routings", {"rows": base})
    data = post(client, "/import/routings", {"rows": [{"router_id": "R1", "machine_id": "CNC-01", "machine_minutes": 9}]})
    assert data["replaced"] == 1 and data["summary"]["operations_deleted"] == 3
    assert q(mgr, "SELECT sequence, machine_minutes FROM router_operations WHERE router_id = 'R1'") == [(10, 9.0)]
    data = post(client, "/import/routings", {"mode": "append", "rows": [
        {"router_id": "R1", "sequence": 10, "machine_id": "CNC-01", "machine_minutes": 8},
        {"router_id": "R1", "machine_id": "LATHE-01", "machine_minutes": 4},
    ]})
    assert data["updated"] == 1 and data["created"] == 1
    assert q(mgr, "SELECT sequence, machine_id, machine_minutes FROM router_operations WHERE router_id = 'R1' ORDER BY sequence") == \
        [(10, "CNC-01", 8.0), (20, "LATHE-01", 4.0)]
    dup = post(client, "/import/routings", {"rows": [
        {"router_id": "R2", "sequence": 10, "machine_id": "CNC-01"},
        {"router_id": "R2", "sequence": 10, "machine_id": "CNC-01"},
    ]})
    assert dup["errors"][0]["row"] == 2 and "repeats row 1" in dup["errors"][0]["error"]


# ---------------------------------------------------------------------------
# Master records
# ---------------------------------------------------------------------------

def test_customer_records_upsert_by_id_and_name(env):
    client, mgr = env
    data = post(client, "/import/records", {"table": "customers", "rows": [
        {"Customer ID": "CUST-001", "Name": "Main Street Guns LLC", "Channel": "Dealer", "Region": ""},
        {"Account Name": "big sky sporting", "Class": "Distributor"},          # matched by name: unchanged
        {"Name": "Lone Star Outdoors", "Type": "Dealer"},
        {"Name": "Federal Agency", "Type": "Government"},
        {"Customer ID": "CUST-002", "Territory": "Northwest"},
        {"Type": "Dealer"},
    ]})
    assert data["table"] == "customers"
    assert (data["created"], data["updated"]) == (2, 2)
    assert data["summary"]["unchanged"] == 1
    assert data["errors"] == [{"row": 6, "error": "customer_id or customer_name is required"}]
    rows = dict(q(mgr, "SELECT customer_id, customer_name || '|' || customer_type || '|' || COALESCE(region, '') FROM customers"))
    assert rows["CUST-001"] == "Main Street Guns LLC|Dealer|Midwest"          # blank region did not erase
    assert rows["CUST-002"] == "Big Sky Sporting|Distributor|Northwest"      # name kept as stored
    assert rows["CUST-003"] == "Lone Star Outdoors|Dealer|"                    # generated in the existing style
    assert rows["CUST-004"] == "Federal Agency|Government|"
    skipped = post(client, "/import/records", {"table": "customers", "mode": "skip",
                                               "rows": [{"customer_id": "CUST-001", "customer_name": "X"}]})
    assert skipped["skipped"] == 1 and q(mgr, "SELECT customer_name FROM customers WHERE customer_id = 'CUST-001'") == \
        [("Main Street Guns LLC",)]


def test_product_machine_and_labor_records(env):
    client, mgr = env
    products = post(client, "/import/records", {"table": "products", "rows": [
        {"SKU": "SHG-12", "Product Name": "12ga Field Shotgun", "MSRP": "$899.00", "Category": "Shotgun",
         "BOM": "BOM-SHG", "BOM Rev": 1, "Routing": "R-SHG"},
        {"SKU": "RFL-308", "MSRP": "1,549"},
        {"SKU": "BAD", "Product Name": "Bad", "MSRP": "cheap"},
        {"SKU": "NEG", "Product Name": "Negative", "MSRP": -5},
    ]})
    assert (products["created"], products["updated"]) == (1, 1)
    assert [e["row"] for e in products["errors"]] == [3, 4]
    assert q(mgr, "SELECT unit_name, base_price, unit_type, bom_id, bom_version, router_id, router_version FROM units "
                  "WHERE unit_id = 'SHG-12'") == [("12ga Field Shotgun", 899.0, "Shotgun", "BOM-SHG", "1.0", "R-SHG", "1.0")]
    assert q(mgr, "SELECT unit_name, base_price FROM units WHERE unit_id = 'RFL-308'") == [("Ridgeline .308", 1549.0)]
    text = " | ".join(products["warnings"])
    assert "BOM BOM-SHG v1.0 has no lines" in text and "routing R-SHG has no operations" in text

    machines = post(client, "/import/records", {"table": "machines", "rows": [
        {"Work Center": "LASER-01", "Name": "Fiber Laser", "Hourly Rate": "45", "Capacity Hours": 160},
        {"Work Center": "CNC-01", "Capacity Minutes": 9600},
        {"Name": "Bench"},
    ]})
    assert (machines["created"], machines["updated"]) == (2, 1)
    assert q(mgr, "SELECT machine_rate, available_minutes_per_month FROM machines WHERE machine_id = 'LASER-01'") == [(45.0, 9600)]
    assert q(mgr, "SELECT machine_rate, available_minutes_per_month FROM machines WHERE machine_id = 'CNC-01'") == [(85.0, 9600)]
    assert q(mgr, "SELECT machine_id FROM machines WHERE machine_name = 'Bench'") == [("M0001",)]

    labor = post(client, "/import/records", {"table": "labor_rates", "rows": [
        {"Labor Type": "QC", "Title": "Inspector", "Hourly Rate": 28},
        {"Name": "Packer", "Wage": "18.50"},
    ]})
    assert labor["created"] == 2
    assert q(mgr, "SELECT rate_name, rate_amount, rate_type FROM labor_rates WHERE rate_id = 'QC'") == [("Inspector", 28.0, "hourly")]
    assert q(mgr, "SELECT rate_id FROM labor_rates WHERE rate_name = 'Packer'") == [("RATE-001",)]


def test_records_dry_run_changes_nothing(env):
    client, mgr = env
    before = snapshot(mgr)
    data = post(client, "/import/records", {"table": "units", "dry_run": True, "rows": [
        {"unit_id": "NEW-1", "unit_name": "New"}, {"unit_id": "RFL-308", "base_price": 1}]})
    assert data["dry_run"] is True and (data["created"], data["updated"]) == (1, 1)
    assert snapshot(mgr) == before


# ---------------------------------------------------------------------------
# Prices and deductions
# ---------------------------------------------------------------------------

def test_price_import_aliases_percent_and_upsert(env):
    client, mgr = env
    rows = [
        {"Product": "RFL-308", "Customer Type": "Dealer", "Price": "$1,199.00", "Start": "Jan-2027", "End": "12/2027"},
        {"Product": "Ridgeline .308", "Channel": "Distributor", "Net Price": 1049},           # product by name
        {"Customer": "Main Street Guns", "Discount": "20%"},                                  # customer by name
        {"Product": "PST-9C", "Customer Type": "Dealer", "Discount": 15},                     # 15 -> 15%
        {"Product": "PST-9C", "Price": "abc"},
        {"Product": "PST-9C", "Customer Type": "Dealer", "Discount": 150},
        {"Customer Type": "Dealer", "Price": 100},
    ]
    data = post(client, "/import/prices", {"rows": rows})
    assert data["created"] == 4
    errors = {e["row"]: e["error"] for e in data["errors"]}
    assert set(errors) == {5, 6, 7}
    assert "number" in errors[5] and "out of range" in errors[6] and "unit_id is required" in errors[7]
    stored = {(r[0], r[1], r[2]): r[3:] for r in q(
        mgr, "SELECT unit_id, customer_id, customer_type, method, unit_price, discount_pct, start_period, end_period "
             "FROM price_list")}
    assert stored[("RFL-308", None, "Dealer")] == ("fixed", 1199.0, None, "2027-01", "2027-12")
    assert stored[("RFL-308", None, "Distributor")] == ("fixed", 1049.0, None, None, None)
    assert stored[(None, "CUST-001", None)] == ("discount_from_base", None, 0.2, None, None)
    assert stored[("PST-9C", None, "Dealer")][:3] == ("discount_from_base", None, 0.15)

    again = post(client, "/import/prices", {"rows": rows[:4]})
    assert (again["created"], again["updated"]) == (0, 4)                                 # same scope -> update
    assert q(mgr, "SELECT COUNT(*) FROM price_list") == [(4,)]
    appended = post(client, "/import/prices", {"rows": rows[:1], "mode": "append"})
    assert appended["created"] == 1 and q(mgr, "SELECT COUNT(*) FROM price_list") == [(5,)]

    scenario = post(client, "/import/prices", {"rows": [{"Product": "RFL-308", "Price": 1300}], "forecast_id": F})
    assert scenario["created"] == 1
    assert q(mgr, "SELECT forecast_id FROM price_list WHERE unit_price = 1300") == [(F,)]
    replaced = post(client, "/import/prices", {"rows": [{"Product": "PST-9C", "Price": 500}], "mode": "replace"})
    assert replaced["replaced"] == 5 and replaced["created"] == 1
    assert sorted(q(mgr, "SELECT unit_price, forecast_id FROM price_list")) == [(500.0, None), (1300.0, F)]


def test_price_import_dry_run_and_warnings(env):
    client, mgr = env
    before = snapshot(mgr)
    data = post(client, "/import/prices", {"dry_run": True, "rows": [
        {"Product": "GHOST", "Price": 10}, {"Customer": "Nobody Inc", "Discount": "5%"}]})
    assert data["dry_run"] is True and data["created"] == 2 and data["errors"] == []
    text = " | ".join(data["warnings"])
    assert "product 'GHOST' does not exist yet" in text and "customer 'Nobody Inc' does not exist yet" in text
    assert snapshot(mgr) == before


def test_deduction_import_friendly_values(env):
    client, mgr = env
    data = post(client, "/import/deductions", {"rows": [
        {"Type": "Terms", "Rate": "2%", "Channel": "Dealer", "Description": "2% 10 net 30"},
        {"Type": "chargebacks", "Percent": 1},
        {"Type": "FET", "Rate": "11%"},
        {"Type": "Excise Tax", "Rate": 0.10, "Product Type": "Pistol"},
        {"Type": "excise", "Rate": 0, "Channel": "Government"},
        {"Type": "Commission", "Method": "net", "Rate": 3, "Channel": "Distributor"},
        {"Type": "Co-op", "Method": "per unit", "Amount": "$5.00", "Product": "RFL-308"},
        {"Type": "Freight", "Rate": "1%"},
        {"Type": "terms", "Rate": 150},
        {"Type": "terms", "Rate": "2%", "Start": "2027-Q1"},
    ]})
    assert data["created"] == 7
    errors = {e["row"]: e["error"] for e in data["errors"]}
    assert set(errors) == {8, 9, 10}
    assert "Freight" in errors[8] and "out of range" in errors[9] and "quarter" in errors[10]
    stored = {r[0]: r[1:] for r in q(
        mgr, "SELECT name, deduction_type, method, rate, amount_per_unit, customer_type, unit_type, unit_id "
             "FROM sales_deduction_rules")}
    assert stored["2% 10 net 30"] == ("terms_allowance", "percent_of_gross", 0.02, 0.0, "Dealer", None, None)
    by_type = sorted(r for r in stored.values() if r[0] == "excise_tax")
    assert [(r[1], r[2], r[4], r[5]) for r in by_type] == [
        ("embedded_tax", 0.0, "Government", None), ("embedded_tax", 0.1, None, "Pistol"), ("embedded_tax", 0.11, None, None)]
    commission = next(r for r in stored.values() if r[0] == "commission")
    assert commission[1:3] == ("percent_of_net", 0.03)
    coop = next(r for r in stored.values() if r[0] == "other_allowance")
    assert coop[1] == "per_unit" and coop[3] == 5.0 and coop[6] == "RFL-308"
    chargebacks = next(r for r in stored.values() if r[0] == "chargebacks")
    assert chargebacks[2] == 0.01

    again = post(client, "/import/deductions", {"rows": [{"Type": "Terms", "Rate": "1.5%", "Channel": "dealer"}]})
    assert (again["created"], again["updated"]) == (0, 1)                                  # same scope, case-insensitive
    assert q(mgr, "SELECT rate FROM sales_deduction_rules WHERE deduction_type = 'terms_allowance'") == [(0.015,)]
    before = snapshot(mgr)
    dry = post(client, "/import/deductions", {"dry_run": True, "rows": [{"Type": "chargebacks", "Rate": "4%"}]})
    assert dry["updated"] == 1 and snapshot(mgr) == before


# ---------------------------------------------------------------------------
# Sales import
# ---------------------------------------------------------------------------

def _sales(mgr):
    return {(r[0], r[1], r[2]): (r[3], r[4], r[5]) for r in q(
        mgr, "SELECT customer_id, unit_id, period, quantity, unit_price, total_revenue FROM sales WHERE forecast_id = ?", (F,))}


def test_sales_import_resolves_prices_and_formats(env):
    client, mgr = env
    post(client, "/import/prices", {"rows": [{"Product": "RFL-308", "Customer Type": "Dealer", "Price": 1199}]})
    data = post(client, "/forecast/smart_import_sales", {"forecast_id": F, "sales": [
        {"Customer": "CUST-001", "SKU": "RFL-308", "Month": "Jan-27", "Qty": "12"},             # price list
        {"Customer": "CUST-002", "SKU": "RFL-308", "Month": "2/2027", "Qty": 40, "Price": 1049},  # explicit
        {"Customer": "CUST-002", "SKU": "PST-9C", "Month": "2027-03-15", "Qty": 2.5},           # base price, decimals
        {"customer_id": "CUST-001", "product_id": "PST-9C", "period": 46447, "quantity": 1, "price": 0},  # 0 = no price
        {"customer_id": "CUST-001", "unit_id": "RFL-308", "period": "2027-Q2", "quantity": 1},
        {"customer_id": "CUST-001", "unit_id": "RFL-308", "period": "sometime", "quantity": 1},
        {"customer_id": "CUST-001", "unit_id": "RFL-308", "period": "2027-05", "quantity": "lots"},
        {"Customer": "CUST-002", "SKU": "PST-9C", "Month": "June 2027", "Units": 10, "Revenue": "$5,000"},
    ]})
    assert data["imported"] == 5 and data["inserted"] == 5 and data["updated"] == 0
    assert data["price_sources"] == {"type_product": 1, "explicit": 2, "base_price": 2}
    assert _sales(mgr)[("CUST-002", "PST-9C", "2027-06")] == (10, 500.0, 5000.0)      # price = revenue / qty
    errors = {e["row"]: e["error"] for e in data["errors"]}
    assert "quarter" in errors[5] and "monthly" in errors[5]
    assert "Invalid period 'sometime'" in errors[6] and "number" in errors[7]
    sales = _sales(mgr)
    assert sales[("CUST-001", "RFL-308", "2027-01")] == (12, 1199.0, 14388.0)
    assert sales[("CUST-002", "RFL-308", "2027-02")] == (40, 1049.0, 41960.0)
    assert sales[("CUST-002", "PST-9C", "2027-03")] == (2.5, 599.0, 1497.5)
    assert ("CUST-001", "PST-9C", "2027-03") in sales                         # Excel serial 46447 = 2027-03-01
    assert (data["start_period"], data["end_period"]) == ("2027-01", "2027-06")


def test_sales_import_zero_price_rules_and_auto_create(env):
    client, mgr = env
    rows = [
        {"customer_id": "CUST-900", "customer_name": "Gun Barn", "customer_type": "Dealer", "unit_id": "ACC-1",
         "unit_name": "Sling", "period": "2027-01", "quantity": 5},
        {"customer_name": "Main Street Guns", "unit_name": "Compact 9mm", "period": "2027-01", "quantity": 3},
    ]
    data = post(client, "/forecast/smart_import_sales", {"forecast_id": F, "sales": rows})
    assert data["created_customers"] == ["CUST-900"] and data["created_products"] == ["ACC-1"]
    assert data["imported"] == 1 and data["errors"][0]["row"] == 1 and "No price for ACC-1" in data["errors"][0]["error"]
    assert q(mgr, "SELECT customer_name, customer_type FROM customers WHERE customer_id = 'CUST-900'") == [("Gun Barn", "Dealer")]
    assert q(mgr, "SELECT unit_name FROM units WHERE unit_id = 'ACC-1'") == [("Sling",)]
    assert _sales(mgr)[("CUST-001", "PST-9C", "2027-01")] == (3, 599.0, 1797.0)   # names resolved to ids

    data = post(client, "/forecast/smart_import_sales", {"forecast_id": F, "sales": rows,
                                                         "options": {"allowZeroPrice": True}})
    assert data["imported"] == 2 and data["updated"] == 1 and data["price_sources"]["zero_price"] == 1
    assert _sales(mgr)[("CUST-900", "ACC-1", "2027-01")] == (5, 0.0, 0.0)

    no_create = post(client, "/forecast/smart_import_sales", {"forecast_id": F, "options": {"autoCreate": False}, "sales": [
        {"customer_id": "NEW-CUST", "unit_id": "RFL-308", "period": "2027-01", "quantity": 1, "unit_price": 5}]})
    assert no_create["imported"] == 0 and "does not exist" in no_create["errors"][0]["error"]


def test_sales_import_wide_format_dry_run_and_validation(env):
    client, mgr = env
    before = snapshot(mgr)
    res = client.post("/forecast/smart_import_sales", json={"forecast_id": F, "dry_run": True, "sales": [
        {"Customer": "CUST-001", "Product": "RFL-308", "Price": 1100, "Jan-27": 10, "Feb-27": "", "Mar-27": 12,
         "Notes": "x"},
        {"Customer": "CUST-002", "Product": "PST-9C", "2027-01": 5, "2027-02": 6},
        {"Customer": "CUST-001", "Product": "RFL-308", "Jan-27": 3},
    ]})
    assert res.status_code == 200, res.text
    assert res.json()["message"].startswith("Dry run")
    data = res.json()["data"]
    assert data["dry_run"] is True and data["wide_format"] is True
    assert data["records"] == 5 and data["imported"] == 5 and data["inserted"] == 4 and data["updated"] == 1
    assert any("repeats CUST-001 / RFL-308 / 2027-01 from row 1" in w for w in data["warnings"])
    assert any("Notes" in w for w in data["warnings"])
    assert snapshot(mgr) == before

    assert client.post("/forecast/smart_import_sales", json={"forecast_id": F, "sales": []}).status_code == 400
    assert client.post("/forecast/smart_import_sales", json={"sales": [{"a": 1}]}).status_code == 400
    assert client.post("/forecast/smart_import_sales",
                       json={"forecast_id": "F999", "sales": [{"customer_id": "CUST-001"}]}).status_code == 404


def test_sales_import_month_name_columns_take_a_year(env):
    client, mgr = env
    data = post(client, "/forecast/smart_import_sales", {"forecast_id": F, "sales": [
        {"Customer": "CUST-001", "SKU": "RFL-308", "Year": 2027, "Jan": 4, "Feb": 5, "Dec": 6},
        {"Customer": "CUST-002", "SKU": "RFL-308", "Jan": 7},                       # no year on row or request
        {"Customer": "CUST-002", "SKU": "PST-9C", "Month": "Mar", "Year": "2027", "Qty": 2},
        {"Customer": "CUST-002", "SKU": "PST-9C", "Month": "Apr", "Qty": 2},
    ]})
    assert data["imported"] == 4
    assert [e["row"] for e in data["errors"]] == [2, 4]
    assert "no year" in data["errors"][0]["error"] and "no year" in data["errors"][1]["error"]
    sales = _sales(mgr)
    assert sales[("CUST-001", "RFL-308", "2027-12")][0] == 6 and ("CUST-002", "PST-9C", "2027-03") in sales

    with_year = post(client, "/forecast/smart_import_sales", {"forecast_id": F, "year": 2027, "sales": [
        {"Customer": "CUST-002", "SKU": "RFL-308", "Jan": 7}]})
    assert with_year["imported"] == 1 and _sales(mgr)[("CUST-002", "RFL-308", "2027-01")][0] == 7


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

def test_template_listing(env):
    client, _ = env
    data = client.get("/import/templates").json()["data"]
    kinds = [t["kind"] for t in data["templates"]]
    assert kinds == ["customers", "products", "machines", "labor_rates", "routings", "boms", "prices", "deductions",
                     "sales"]
    boms = next(t for t in data["templates"] if t["kind"] == "boms")
    qty = next(c for c in boms["columns"] if c["name"] == "qty")
    assert qty["required"] and "qty_per" in qty["aliases"]
    assert boms["download_url"] == "/import/templates/boms"


def _template_rows(client, kind):
    res = client.get(f"/import/templates/{kind}")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    assert f'filename="{kind}_template.csv"' in res.headers["content-disposition"]
    return list(csv.DictReader(io.StringIO(res.text)))


def test_template_downloads_and_aliases(env):
    client, _ = env
    for kind in ("customers", "products", "machines", "labor_rates", "routings", "boms", "prices", "deductions", "sales"):
        rows = _template_rows(client, kind)
        assert len(rows) >= 2
        assert all(None not in r for r in rows)                                    # no ragged rows
    assert any("2027-01" in (r.get("period") or "") for r in _template_rows(client, "sales"))
    assert client.get("/import/templates/units").status_code == 200
    assert client.get("/import/templates/labor-rates").status_code == 200
    assert client.get("/import/templates/nope").status_code == 404


def test_templates_round_trip_into_a_costed_forecast(env):
    """Import every template in setup order; the sample forecast is priced and costed."""
    client, mgr = env
    for kind, table in (("customers", "customers"), ("products", "units"), ("machines", "machines"),
                        ("labor_rates", "labor_rates")):
        data = post(client, "/import/records", {"table": table, "rows": _template_rows(client, kind)})
        assert data["errors"] == [], (kind, data["errors"])
    for kind in ("routings", "boms"):
        data = post(client, f"/import/{kind}", {"rows": _template_rows(client, kind)})
        assert data["errors"] == [], (kind, data["errors"])
    for kind in ("prices", "deductions"):
        data = post(client, f"/import/{kind}", {"rows": _template_rows(client, kind)})
        assert data["errors"] == [], (kind, data["errors"])
    sales = post(client, "/forecast/smart_import_sales", {"forecast_id": F, "sales": _template_rows(client, "sales")})
    assert sales["errors"] == [] and sales["imported"] == 3
    assert sales["price_sources"] == {"type_product": 1, "explicit": 1, "customer_all": 1}
    assert _sales(mgr)[("CUST-001", "RFL-308", "2027-01")] == (12, 1199.0, 14388.0)
    qty, price, total = _sales(mgr)[("CUST-003", "PST-9C", "2027-02")]
    assert (qty, price) == (25, 479.2) and total == pytest.approx(11980.0)          # 20% off 599 list

    assert q(mgr, "SELECT bom_id, router_id FROM units WHERE unit_id = 'RFL-308'") == [("BOM-RFL308", "R-RFL308")]
    from services.financial_statements import build_statements
    conn = mgr.get_connection()
    try:
        income = build_statements(conn.cursor(), [F], "2027-01", "2027-02")["income_statement"]["totals"]
    finally:
        mgr.close_connection(conn)
    assert income["cogs_materials"] == pytest.approx((185 + 140 + 95) * 52)
    assert income["excise_tax"] > 0 and income["terms_allowance"] > 0
    assert income["revenue"] == pytest.approx(income["gross_sales"] - income["total_sales_deductions"])


def test_sales_import_replace_modes(env):
    client, mgr = env
    base = [
        {"customer_id": "CUST-001", "unit_id": "RFL-308", "period": "2027-01", "quantity": 5, "price": 1000},
        {"customer_id": "CUST-002", "unit_id": "RFL-308", "period": "2027-01", "quantity": 7, "price": 1000},
        {"customer_id": "CUST-001", "unit_id": "RFL-308", "period": "2028-01", "quantity": 9, "price": 1000},
    ]
    post(client, "/forecast/smart_import_sales", {"forecast_id": F, "sales": base})
    revised = [{"customer_id": "CUST-001", "unit_id": "RFL-308", "period": "2027-01", "quantity": 6, "price": 1000}]

    # A replace with an invalid row changes nothing.
    blocked = post(client, "/forecast/smart_import_sales", {"forecast_id": F, "mode": "replace", "sales": revised + [
        {"customer_id": "CUST-001", "unit_id": "RFL-308", "period": "2027-Q1", "quantity": 1, "price": 1}]})
    assert blocked["replace_blocked"] and blocked["deleted"] == 0
    assert _sales(mgr)[("CUST-001", "RFL-308", "2027-01")][0] == 5

    dry = post(client, "/forecast/smart_import_sales", {"forecast_id": F, "mode": "replace", "dry_run": True, "sales": revised})
    assert dry["deleted"] == 1 and len(_sales(mgr)) == 3

    done = post(client, "/forecast/smart_import_sales", {"forecast_id": F, "mode": "replace", "sales": revised})
    assert done["deleted"] == 1
    sales = _sales(mgr)
    assert ("CUST-002", "RFL-308", "2027-01") not in sales            # stale 2027 line removed
    assert sales[("CUST-001", "RFL-308", "2027-01")][0] == 6
    assert ("CUST-001", "RFL-308", "2028-01") in sales                # other months untouched

    all_rows = post(client, "/forecast/smart_import_sales", {"forecast_id": F, "mode": "replace_all", "sales": revised})
    assert all_rows["deleted"] == 1 and list(_sales(mgr)) == [("CUST-001", "RFL-308", "2027-01")]


def test_record_import_keeps_one_spelling_per_customer_type(env):
    client, mgr = env
    post(client, "/import/records", {"table": "customers", "rows": [
        {"customer_id": "CUST-T1", "customer_name": "Type One", "customer_type": "Distributor"}]})
    post(client, "/import/records", {"table": "customers", "rows": [
        {"customer_id": "CUST-T2", "customer_name": "Type Two", "customer_type": "distributor "},
        {"customer_id": "CUST-T3", "customer_name": "Type Three", "customer_type": "Export"},
        {"customer_id": "CUST-T4", "customer_name": "Type Four", "customer_type": "EXPORT"}]})
    types = dict(q(mgr, "SELECT customer_id, customer_type FROM customers WHERE customer_id LIKE 'CUST-T%'"))
    assert types == {"CUST-T1": "Distributor", "CUST-T2": "Distributor", "CUST-T3": "Export", "CUST-T4": "Export"}
