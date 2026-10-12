"""
BOM and routing import fixes: ERP routing headers (F3), continuation rows
with a blank parent id (API-2), material cost stored and reported the way
costing computes it (RM-3 / API-3), the BOM header never moving back to an
older version (API-9), products linked by a parent id equal to their id or
by an 'Item Number' column (F8), title rows above the header (F9) and
accounting-format zeros (F10).
"""
import pytest

from tests.test_import_routes import env, post, q  # noqa: F401  (env is a fixture)


# ---------------------------------------------------------------------------
# Routings
# ---------------------------------------------------------------------------

ERP_ROUTING = [
    {"Routing No": "RT-RFL", "Item Number": "RFL-308", "Op Seq": 10, "Work Center": "CNC-01",
     "Operation Description": "Machine receiver", "Setup Min": 30, "Run Min": 22, "Labor Min": 8,
     "Labor Type": "MACHINIST"},
    {"Routing No": "RT-RFL", "Item Number": "RFL-308", "Op Seq": 20, "Work Center": "LATHE-01",
     "Operation Description": "Turn barrel", "Setup Min": 20, "Run Min": 18, "Labor Min": 6, "Labor Type": "MACHINIST"},
]


def test_erp_routing_headers_and_item_number_link(env):
    client, mgr = env
    data = post(client, "/import/routings", {"rows": ERP_ROUTING})
    assert data["errors"] == []
    routing = data["routings"][0]
    assert routing["machine_minutes_per_unit"] == 40
    assert routing["machine_cost_per_unit"] == pytest.approx(22 / 60 * 85 + 18 / 60 * 70, abs=1e-4)
    assert routing["linked_products"] == ["RFL-308"]
    assert q(mgr, "SELECT router_id FROM units WHERE unit_id = 'RFL-308'") == [("RT-RFL",)]
    text = " | ".join(data["warnings"])
    assert "Setup Min" in text and "setup" in text.lower()                  # ignored on purpose, with a reason
    assert "Run Min" not in text and "Item Number" not in text


@pytest.mark.parametrize("header", ["Run Minutes", "Run Time (min)", "Cycle Time", "Machine Min", "Run Mins"])
def test_machine_minute_aliases(env, header):
    client, mgr = env
    post(client, "/import/routings", {"rows": [
        {"Routing": "R-A", "Work Center": "CNC-01", header: 12, "Labor Minutes": 3, "Labor Type": "MACHINIST"}]})
    assert q(mgr, "SELECT machine_minutes, labor_minutes FROM router_operations WHERE router_id = 'R-A'") == [(12.0, 3.0)]


def test_unrecognised_minutes_column_gets_a_specific_warning(env):
    client, _ = env
    data = post(client, "/import/routings", {"rows": [
        {"Routing": "R-B", "Work Center": "CNC-01", "Spindle Time": 12, "Labor Min": 3, "Labor Type": "MACHINIST"}]})
    assert any("Spindle Time" in w and "machine cost is $0" in w for w in data["warnings"]), data["warnings"]


def test_routing_continuation_rows_take_the_routing_above(env):
    client, mgr = env
    post(client, "/import/routings", {"rows": [
        {"router_id": "R-A", "machine_id": "CNC-01", "machine_minutes": 10} for _ in range(4)]})
    data = post(client, "/import/routings", {"rows": [
        {"Routing": "R-A", "Routing Name": "Rifle", "Work Center": "CNC-01", "Run Minutes": 10},
        {"Routing": "", "Work Center": "CNC-01", "Run Minutes": 11},
        {"Work Center": "LATHE-01", "Run Minutes": 12},
        {"Routing": "R-B", "Work Center": "CNC-01", "Run Minutes": 5},
        {"Work Center": "", "Run Minutes": 6},                                  # an error inside R-B
    ]})
    assert q(mgr, "SELECT sequence, machine_id, machine_minutes FROM router_operations WHERE router_id = 'R-A' "
                  "ORDER BY sequence") == [(10, "CNC-01", 10.0), (20, "CNC-01", 11.0), (30, "LATHE-01", 12.0)]
    assert q(mgr, "SELECT COUNT(*) FROM router_operations WHERE router_id = 'R-B'") == [(0,)]   # never half-imported
    assert [e["row"] for e in data["errors"]] == [5]
    assert any("3 rows had no router_id" in w or "rows 2, 3, 5" in w for w in data["warnings"]), data["warnings"]


def test_routing_id_equal_to_a_product_links_it(env):
    client, mgr = env
    data = post(client, "/import/routings", {"rows": [
        {"Routing": "PST-9C", "Work Center": "CNC-01", "Run Minutes": 7}]})
    assert data["routings"][0]["linked_products"] == ["PST-9C"]
    assert q(mgr, "SELECT router_id FROM units WHERE unit_id = 'PST-9C'") == [("PST-9C",)]
    assert any("PST-9C" in w and "same id" in w for w in data["warnings"])


# ---------------------------------------------------------------------------
# BOMs
# ---------------------------------------------------------------------------

def test_bom_continuation_rows_take_the_bom_above(env):
    client, mgr = env
    post(client, "/import/boms", {"rows": [
        {"bom_id": "BOM-A", "material_description": f"P{i}", "qty": 1, "unit_price": 10} for i in range(4)]})
    data = post(client, "/import/boms", {"rows": [
        {"BOM": "BOM-A", "Rev": "1", "Component": "P1", "Qty": 1, "Cost": 10, "SKU": "RFL-308"},
        {"BOM": "", "Component": "P2", "Qty": 2, "Cost": 10},
        {"Component": "P3", "Qty": 1, "Cost": 15},
        {"BOM": "BOM-B", "Component": "Q1", "Qty": 1, "Cost": 1},
        {"Component": "Q2", "Qty": "two", "Cost": 1},                           # error inside BOM-B
    ]})
    lines = q(mgr, "SELECT material_description, qty, material_cost FROM bom WHERE bom_id = 'BOM-A' ORDER BY bom_line")
    assert lines == [("P1", 1.0, 10.0), ("P2", 2.0, 20.0), ("P3", 1.0, 15.0)]
    assert q(mgr, "SELECT COUNT(*) FROM bom WHERE bom_id = 'BOM-B'") == [(0,)]
    assert [e["row"] for e in data["errors"]] == [5]
    assert data["boms"][0]["material_cost_per_unit"] == 45.0
    assert q(mgr, "SELECT bom_id FROM units WHERE unit_id = 'RFL-308'") == [("BOM-A",)]
    assert any("had no bom_id" in w for w in data["warnings"]), data["warnings"]


def test_bom_cost_is_stored_and_reported_as_qty_times_unit_price(env):
    client, mgr = env
    data = post(client, "/import/boms", {"rows": [
        {"BOM": "B-X", "Component": "Barrel", "Qty": 1, "Std Cost": 120.50, "SKU": "RFL-308"},
        {"BOM": "B-X", "Component": "Screw", "Qty": 4, "Extended Cost": 2.00},
        {"BOM": "B-X", "Component": "Spring", "Qty": 2, "Std Cost": 1.25, "Extended Cost": 3.00},
        {"BOM": "B-X", "Component": "Pin", "Qty": 3, "Std Cost": 0.333, "Extended Cost": 1.00},    # within 1 cent
    ]})
    assert data["errors"] == []
    assert q(mgr, "SELECT material_cost FROM bom WHERE bom_id = 'B-X' AND bom_line = 3") == [(2.5,)]
    reported = data["boms"][0]["material_cost_per_unit"]
    expected = 120.5 + 2.0 + 2.5 + 0.999
    assert reported == pytest.approx(expected, abs=1e-4)
    assert data["summary"]["material_cost_by_bom"]["B-X v1.0"] == pytest.approx(expected, abs=1e-4)
    from utils.cost_rollup import calculate_unit_costs                     # what COGS uses
    conn = mgr.get_connection()
    try:
        costing = calculate_unit_costs(conn.cursor(), "B-X", "1.0", None)["material_per_unit"]
    finally:
        mgr.close_connection(conn)
    assert costing == pytest.approx(reported, abs=1e-4)
    mismatch = [w for w in data["warnings"] if "differs from qty x unit_price" in w]
    assert len(mismatch) == 1 and "row 3" in mismatch[0].lower() and "3.00" in mismatch[0]
    assert "row 4" not in mismatch[0].lower()


def test_bom_import_never_moves_the_header_back(env):
    client, mgr = env
    post(client, "/import/boms", {"rows": [{"bom_id": "B1", "version": 2, "material_description": "A", "qty": 1,
                                            "unit_price": 1, "unit_id": "RFL-308"}]})
    post(client, "/import/boms", {"rows": [{"bom_id": "B1", "version": 1, "bom_name": "Rifle BOM",
                                            "material_description": "A", "qty": 1, "unit_price": 1}]})
    assert q(mgr, "SELECT bom_name, version FROM bom_definitions WHERE bom_id = 'B1'") == [("Rifle BOM", "2.0")]
    post(client, "/import/boms", {"rows": [{"bom_id": "B1", "version": 3, "material_description": "A", "qty": 1,
                                            "unit_price": 1}]})
    assert q(mgr, "SELECT version FROM bom_definitions WHERE bom_id = 'B1'") == [("3.0",)]


def test_bom_parent_equal_to_a_product_links_it(env):
    client, mgr = env
    conn = mgr.get_connection()
    conn.execute("UPDATE units SET bom_id = 'OTHER', bom_version = '1.0' WHERE unit_id = 'PST-9C'")
    conn.commit()
    mgr.close_connection(conn)
    data = post(client, "/import/boms", {"rows": [
        {"Parent Item": "RFL-308", "Item Number": "BBL-1", "Component Description": "Barrel", "Qty Per": 1,
         "Std Cost": 100},
        {"Parent Item": "RFL-308", "Item Number": "RCV-1", "Component Description": "Receiver", "Qty Per": 1,
         "Std Cost": 50},
        {"Parent Item": "PST-9C", "Item Number": "SLD-1", "Component Description": "Slide", "Qty Per": 1,
         "Std Cost": 80},
    ]})
    boms = {b["bom_id"]: b for b in data["boms"]}
    assert boms["RFL-308"]["linked_products"] == ["RFL-308"]
    assert boms["PST-9C"]["linked_products"] == []                         # already has a BOM: left alone
    assert q(mgr, "SELECT unit_id, bom_id FROM units ORDER BY unit_id") == [("PST-9C", "OTHER"), ("RFL-308", "RFL-308")]
    assert q(mgr, "SELECT material_description FROM bom WHERE bom_id = 'RFL-308' ORDER BY bom_line") == \
        [("BBL-1 - Barrel",), ("RCV-1 - Receiver",)]                         # Item Number is the component here
    assert data["summary"]["products_linked"] == 1


def test_bom_item_number_column_constant_per_bom_links_the_product(env):
    client, mgr = env
    data = post(client, "/import/boms", {"rows": [
        {"BOM": "BOM-R", "Item Number": "RFL-308", "Component": "BBL-1", "Description": "Barrel", "Qty": 1, "Cost": 100},
        {"BOM": "BOM-R", "Item Number": "RFL-308", "Component": "RCV-1", "Description": "Receiver", "Qty": 1,
         "Cost": 50},
    ]})
    assert data["errors"] == []
    assert data["boms"][0]["linked_products"] == ["RFL-308"]
    assert q(mgr, "SELECT material_description FROM bom WHERE bom_id = 'BOM-R' ORDER BY bom_line") == \
        [("BBL-1 - Barrel",), ("RCV-1 - Receiver",)]


def test_accounting_dash_is_zero(env):
    client, mgr = env
    data = post(client, "/import/boms", {"rows": [
        {"bom_id": "B-D", "material_description": "Label", "qty": 1, "unit_price": " - "},
        {"bom_id": "B-D", "material_description": "Box", "qty": 1, "unit_price": "—", "material_cost": 2},
    ]})
    assert data["errors"] == []
    assert q(mgr, "SELECT material_description, unit_price, material_cost FROM bom WHERE bom_id = 'B-D' "
                  "ORDER BY bom_line") == [("Label", 0.0, 0.0), ("Box", 2.0, 2.0)]


# ---------------------------------------------------------------------------
# Header row detection (F9)
# ---------------------------------------------------------------------------

def test_title_row_taken_as_header_gets_a_header_row_hint(env):
    client, mgr = env
    data = post(client, "/import/boms", {"rows": [
        {"Costed Bill of Material": "Parent Item", "Run date: 10/12/2026": "Item Number"},
        {"Costed Bill of Material": "RFL-308", "Run date: 10/12/2026": "BBL-1"},
    ]})
    assert data["created"] == 0 and len(data["errors"]) == 1
    error = data["errors"][0]
    assert error["row"] == 1 and "header_row" in error["error"] and "Parent Item" in error["error"]
    assert q(mgr, "SELECT COUNT(*) FROM bom") == [(0,)]

    sales = post(client, "/forecast/smart_import_sales", {"forecast_id": "F001", "sales": [
        {"Sales Forecast 2027": "Customer", "Prepared by": "Product"}, {"Sales Forecast 2027": "CUST-001"}]})
    assert sales["imported"] == 0 and "header_row" in sales["errors"][0]["error"]


def test_guess_header_row_skips_title_rows():
    from api.import_routes import guess_header_row
    grid = [
        ["Costed Bill of Material", None, None, None, None, "Run date: 10/12/2026"],
        [None] * 6,
        ["Parent Item", "Rev", "Item Number", "Component Description", "Qty Per", "Std Cost"],
        ["RFL-308", 1, "BBL-1", "Barrel", 1, 100],
    ]
    assert guess_header_row(grid) == 2
    assert guess_header_row([["Customer", "Item", "Jan-27", "Feb-27"], ["C1", "P1", 1, 2]]) == 0
    assert guess_header_row([["just a title"], ["a", "b"], [1, 2]]) == 1          # fallback: first row with 2 cells
    assert guess_header_row([]) is None


def test_note_and_total_rows_are_skipped_not_imported(env):
    client, mgr = env
    data = post(client, "/import/boms", {"rows": [
        {"BOM": "B-T", "Component": "Barrel", "Qty": 1, "Cost": 100},
        {"Component": "Stock", "Qty": 1, "Cost": 50},
        {"Component": "Total", "Ext Cost": 150},                               # an ERP subtotal line
        {"BOM": "Note: costs are standard costs as of 10/2026"},
    ]})
    assert data["errors"] == []
    assert q(mgr, "SELECT material_description FROM bom WHERE bom_id = 'B-T' ORDER BY bom_line") == \
        [("Barrel",), ("Stock",)]
    assert any("notes or totals" in w and "3" in w and "4" in w for w in data["warnings"]), data["warnings"]

    prices = post(client, "/import/prices", {"rows": [
        {"Item Number": "RFL-308", "Dealer": 1199},
        {"Item Number": "Note: Distributor pricing on accessories is 40% off list price."},
    ]})
    assert prices["errors"] == [] and prices["created"] == 1

    sales = post(client, "/forecast/smart_import_sales", {"forecast_id": "F001", "sales": [
        {"Customer": "CUST-001", "Product": "RFL-308", "Jan-27": 5, "Feb-27": 6},
        {"Customer": "Total", "Jan-27": 5, "Feb-27": 6},
    ]})
    assert sales["errors"] == [] and sales["created_customers"] == [] and sales["total_quantity"] == 11
    assert any("notes or totals" in w for w in sales["warnings"])
