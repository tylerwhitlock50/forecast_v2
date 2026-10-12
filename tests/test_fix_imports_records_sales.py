"""
Master-data and sales import fixes: 'Customer #' / 'Product' id columns
(API-5), a product imported without a BOM version keeps NULL so the
single-version fallback works (RM-9), repeated customer + product + month
rows are combined (API-4), ids match case-insensitively, a numeric Month
column works with a Year column (API-8) and an accounting dash is zero (F10).
"""
import pytest

from tests.test_import_routes import F, _sales, env, post, q  # noqa: F401  (env is a fixture)


# ---------------------------------------------------------------------------
# Master data (API-5, RM-9)
# ---------------------------------------------------------------------------

def test_customer_number_columns_are_ids_when_a_name_column_exists(env):
    client, mgr = env
    data = post(client, "/import/records", {"table": "customers", "rows": [
        {"Customer #": "1001", "Customer Name": "Gun Barn", "Customer Type": "Dealer"},
        {"Customer #": "1002", "Customer Name": "Rod & Gun", "Customer Type": "Dealer"},
    ]})
    assert data["errors"] == [] and not data["warnings"]
    assert q(mgr, "SELECT customer_id, customer_name FROM customers WHERE customer_id IN ('1001', '1002') "
                  "ORDER BY customer_id") == [("1001", "Gun Barn"), ("1002", "Rod & Gun")]

    for header in ("Customer", "Customer No", "Customer Number", "Cust #", "Account", "Account #"):
        res = post(client, "/import/records", {"table": "customers", "rows": [
            {header: f"X-{len(header)}", "Name": f"Shop {header}", "Type": "Dealer"}]})
        assert res["errors"] == [] and res["records"][0]["customer_id"] == f"X-{len(header)}", (header, res)


def test_customer_column_holding_names_is_the_name(env):
    client, mgr = env
    data = post(client, "/import/records", {"table": "customers", "rows": [
        {"Customer": "Lone Pine Guns", "Type": "Dealer"},
        {"Customer": "Main Street Guns", "Type": "Dealer"},                 # existing, matched by name
    ]})
    assert data["errors"] == [] and (data["created"], data["updated"] + data["summary"]["unchanged"]) == (1, 1)
    assert q(mgr, "SELECT customer_name FROM customers WHERE customer_id = 'CUST-003'") == [("Lone Pine Guns",)]


def test_product_columns_map_to_unit_id(env):
    client, mgr = env
    for header in ("Product", "Product #", "Item", "Item #", "SKU", "Part Number"):
        res = post(client, "/import/records", {"table": "units", "rows": [
            {header: f"P-{len(header)}", "Description": f"Thing {header}", "List Price": 10}]})
        assert res["errors"] == [] and res["records"][0]["unit_id"] == f"P-{len(header)}", (header, res)
    named = post(client, "/import/records", {"table": "units", "rows": [{"Product": "Steel Magazine 10rd", "MSRP": 39}]})
    assert named["records"][0]["unit_id"].startswith("PROD-")
    assert q(mgr, "SELECT unit_name FROM units WHERE unit_id = ?", (named["records"][0]["unit_id"],)) == \
        [("Steel Magazine 10rd",)]


def test_machine_and_labor_rate_per_hour_headers(env):
    client, mgr = env
    post(client, "/import/records", {"table": "machines", "rows": [{"Work Center": "WC-9", "Rate/Hr": "85"}]})
    post(client, "/import/records", {"table": "labor_rates", "rows": [{"Labor Type": "PACK", "Rate/Hr": "19.5"}]})
    assert q(mgr, "SELECT machine_rate FROM machines WHERE machine_id = 'WC-9'") == [(85.0,)]
    assert q(mgr, "SELECT rate_amount FROM labor_rates WHERE rate_id = 'PACK'") == [(19.5,)]


def test_product_without_bom_version_uses_the_single_bom_version(env):
    client, mgr = env
    post(client, "/import/boms", {"rows": [{"bom_id": "B-REV", "version": "Rev A", "material_description": "Stock",
                                            "qty": 1, "unit_price": 250}]})
    data = post(client, "/import/records", {"table": "units", "rows": [
        {"unit_id": "CAR", "unit_name": "Carbine", "bom_id": "B-REV"},
        {"unit_id": "NEW", "unit_name": "No BOM yet", "bom_id": "B-NONE"},
    ]})
    assert q(mgr, "SELECT unit_id, bom_version FROM units WHERE unit_id IN ('CAR', 'NEW') ORDER BY unit_id") == \
        [("CAR", "Rev A"), ("NEW", None)]
    text = " | ".join(data["warnings"])
    assert "B-REV" not in text and "B-NONE" in text
    from utils.cost_rollup import calculate_unit_costs
    conn = mgr.get_connection()
    try:
        cursor = conn.cursor()
        assert calculate_unit_costs(cursor, "B-NONE", None, None)["material_per_unit"] == 0
        version = q(mgr, "SELECT bom_version FROM units WHERE unit_id = 'CAR'")[0][0]
        assert calculate_unit_costs(cursor, "B-REV", version, None)["material_per_unit"] == 250
    finally:
        mgr.close_connection(conn)


def test_changing_a_products_bom_without_a_version_drops_the_old_version(env):
    client, mgr = env
    post(client, "/import/boms", {"rows": [{"bom_id": "B-ONE", "material_description": "x", "qty": 1, "unit_price": 1}]})
    conn = mgr.get_connection()
    conn.execute("UPDATE units SET bom_id = 'B-OLD', bom_version = '7.0' WHERE unit_id = 'RFL-308'")
    conn.commit()
    mgr.close_connection(conn)
    post(client, "/import/records", {"table": "units", "rows": [{"unit_id": "RFL-308", "bom_id": "B-ONE"}]})
    assert q(mgr, "SELECT bom_id, bom_version FROM units WHERE unit_id = 'RFL-308'") == [("B-ONE", "1.0")]


# ---------------------------------------------------------------------------
# Sales (API-4, API-8, F10)
# ---------------------------------------------------------------------------

def test_repeated_customer_product_month_rows_are_combined(env):
    client, mgr = env
    body = {"forecast_id": F, "sales": [
        {"customer_id": "CUST-001", "unit_id": "RFL-308", "period": "2027-01", "quantity": 10, "unit_price": 1000},
        {"customer_id": "CUST-001", "unit_id": "RFL-308", "period": "Jan-27", "quantity": 5, "unit_price": 1300},
        {"customer_id": "CUST-002", "unit_id": "RFL-308", "period": "2027-01", "quantity": 2, "unit_price": 900},
    ]}
    dry = post(client, "/forecast/smart_import_sales", {**body, "dry_run": True})
    data = post(client, "/forecast/smart_import_sales", body)
    for result in (dry, data):
        assert (result["imported"], result["inserted"], result["updated"]) == (2, 2, 0)
        assert result["total_quantity"] == 17 and result["total_revenue"] == pytest.approx(10000 + 6500 + 1800)
        assert any("Rows 1 and 2" in w and "combined" in w for w in result["warnings"]), result["warnings"]
    qty, price, total = _sales(mgr)[("CUST-001", "RFL-308", "2027-01")]
    assert qty == 15 and total == pytest.approx(16500) and price == pytest.approx(1100)
    stored = q(mgr, "SELECT SUM(quantity), SUM(total_revenue) FROM sales WHERE forecast_id = ?", (F,))[0]
    assert stored[0] == data["total_quantity"] and stored[1] == pytest.approx(data["total_revenue"])

    again = post(client, "/forecast/smart_import_sales", body)                  # re-import: same totals, updated
    assert (again["inserted"], again["updated"]) == (0, 2)
    assert _sales(mgr)[("CUST-001", "RFL-308", "2027-01")][0] == 15


def test_sales_ids_match_case_insensitively_and_trimmed(env):
    client, mgr = env
    data = post(client, "/forecast/smart_import_sales", {"forecast_id": F, "sales": [
        {"customer_id": " cust-001 ", "unit_id": "rfl-308", "period": "2027-01", "quantity": 3, "unit_price": 1000}]})
    assert data["created_customers"] == [] and data["created_products"] == [] and data["imported"] == 1
    assert ("CUST-001", "RFL-308", "2027-01") in _sales(mgr)


def test_sales_warns_about_created_products_without_costing(env):
    client, _ = env
    data = post(client, "/forecast/smart_import_sales", {"forecast_id": F, "sales": [
        {"customer_id": "CUST-001", "unit_id": "NEW-1", "period": "2027-01", "quantity": 3, "unit_price": 10}]})
    assert data["created_products"] == ["NEW-1"]
    assert any("NEW-1" in w and "COGS" in w for w in data["warnings"]), data["warnings"]


def test_numeric_month_with_a_year_column(env):
    client, mgr = env
    data = post(client, "/forecast/smart_import_sales", {"forecast_id": F, "sales": [
        {"Customer": "CUST-001", "SKU": "RFL-308", "Year": 2027, "Month": 1, "Qty": 4},
        {"Customer": "CUST-001", "SKU": "RFL-308", "Year": "2027", "Month": "12", "Qty": 5},
        {"Customer": "CUST-001", "SKU": "PST-9C", "Month": 3, "Qty": 1},                 # no year
        {"Customer": "CUST-001", "SKU": "PST-9C", "Year": 2027, "Month": 13, "Qty": 1},
    ]})
    assert data["imported"] == 2
    sales = _sales(mgr)
    assert sales[("CUST-001", "RFL-308", "2027-01")][0] == 4 and sales[("CUST-001", "RFL-308", "2027-12")][0] == 5
    errors = {e["row"]: e["error"] for e in data["errors"]}
    assert set(errors) == {3, 4} and "year" in errors[3].lower()


def test_accounting_dash_in_a_wide_sales_row_is_zero(env):
    client, mgr = env
    data = post(client, "/forecast/smart_import_sales", {"forecast_id": F, "sales": [
        {"Customer": "CUST-001", "Product": "RFL-308", "Jan-27": "12", "Feb-27": " - ", "Mar-27": "1,250"}]})
    assert data["errors"] == [] and data["imported"] == 3
    sales = _sales(mgr)
    assert sales[("CUST-001", "RFL-308", "2027-02")][0] == 0 and sales[("CUST-001", "RFL-308", "2027-03")][0] == 1250
