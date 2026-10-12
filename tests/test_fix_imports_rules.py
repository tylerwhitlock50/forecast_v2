"""
Price and deduction import fixes (F4 / RM-2 / API-6, F1 / RM-1, F7, F13,
API-7): rates are read per file column, implausible rates and discounts are
flagged, other-allowance programs with different names are both kept, a
repeated scope in one file is a row error, replace is all-or-nothing, and a
product x customer-type price matrix imports one rule per filled cell.
"""
import pytest

from tests.test_import_routes import F, env, post, q, snapshot  # noqa: F401  (env is a fixture)


def _rates(mgr):
    return {r[0]: r[1] for r in q(mgr, "SELECT COALESCE(name, deduction_type), rate FROM sales_deduction_rules")}


# ---------------------------------------------------------------------------
# Rates: percent vs fraction is decided per column
# ---------------------------------------------------------------------------

def test_bare_rates_in_a_percent_column_are_all_percents(env):
    client, mgr = env
    data = post(client, "/import/deductions", {"rows": [
        {"Name": "terms", "Type": "terms", "Percent": 2},
        {"Name": "cb dealer", "Type": "chargebacks", "Customer Type": "Dealer", "Percent": 0.5},
        {"Name": "cb dist", "Type": "chargebacks", "Customer Type": "Distributor", "Percent": "1.5"},
        {"Name": "fet", "Type": "FET", "Percent": 11},
        {"Name": "coop", "Type": "other", "Rate": "0.5%"},                  # '%' strings are always percents
    ]})
    assert data["errors"] == [] and data["created"] == 5
    rates = _rates(mgr)
    assert rates["terms"] == pytest.approx(0.02)
    assert rates["cb dealer"] == pytest.approx(0.005)                       # 0.5 in a percent column = 0.5%
    assert rates["cb dist"] == pytest.approx(0.015)
    assert rates["fet"] == pytest.approx(0.11)
    assert rates["coop"] == pytest.approx(0.005)
    assert not any("unusually high" in w for w in data["warnings"])
    assert [r["rate"] for r in data["records"]] == pytest.approx([0.02, 0.005, 0.015, 0.11, 0.005])  # echoed


def test_bare_rates_below_one_are_fractions_and_high_rates_warn(env):
    client, mgr = env
    data = post(client, "/import/deductions", {"rows": [
        {"Name": "terms", "Type": "terms", "Rate": 0.02},
        {"Name": "coop", "Type": "other", "Rate": 0.005},
        {"Name": "comm", "Type": "commission", "Customer Type": "Dealer", "Rate": "0.5"},
        {"Name": "fet ok", "Type": "FET", "Rate": 0.15, "Product Type": "Rifle"},
        {"Name": "fet high", "Type": "FET", "Rate": 0.21, "Product Type": "Pistol"},
    ]})
    assert data["errors"] == []
    rates = _rates(mgr)
    assert rates["terms"] == pytest.approx(0.02) and rates["coop"] == pytest.approx(0.005)
    assert rates["comm"] == pytest.approx(0.5)
    high = [w for w in data["warnings"] if "unusually high" in w]
    assert len(high) == 2, data["warnings"]
    assert any("Row 3" in w and "50%" in w and "0.5%" in w for w in high)  # hint: write 0.5% for half a percent
    assert any("Row 5" in w and "21%" in w and "20%" in w for w in high)   # excise warns above 20%


def test_price_discounts_are_read_per_column_and_high_discounts_warn(env):
    client, mgr = env
    data = post(client, "/import/prices", {"rows": [
        {"Product": "RFL-308", "Customer Type": "Dealer", "Discount": 40},
        {"Product": "PST-9C", "Customer Type": "Dealer", "Discount": 0.5},           # same column: 0.5%
        {"Product": "PST-9C", "Customer Type": "Distributor", "Discount": "40% off list"},
        {"Customer": "CUST-001", "Discount": "85%"},
    ]})
    assert data["errors"] == [], data["errors"]
    stored = {(r[0], r[1], r[2]): r[3] for r in q(
        mgr, "SELECT unit_id, customer_id, customer_type, discount_pct FROM price_list")}
    assert stored[("RFL-308", None, "Dealer")] == pytest.approx(0.40)
    assert stored[("PST-9C", None, "Dealer")] == pytest.approx(0.005)
    assert stored[("PST-9C", None, "Distributor")] == pytest.approx(0.40)
    assert stored[(None, "CUST-001", None)] == pytest.approx(0.85)
    assert any("Row 4" in w and "85%" in w and "unusually high" in w for w in data["warnings"])


# ---------------------------------------------------------------------------
# Friendly methods and id aliases (F7)
# ---------------------------------------------------------------------------

def test_percent_sign_methods_and_customer_number_columns(env):
    client, mgr = env
    data = post(client, "/import/deductions", {"rows": [
        {"Description": "Dealer terms", "Deduction Type": "Terms", "Calculation": "% of gross", "Rate": "2.00%",
         "Customer No": "cust-001", "Customer Name": "Somebody Else"},
        {"Description": "Dist commission", "Deduction Type": "Commission", "Calculation": "% of net sales",
         "Rate": "3%", "Customer Type": "Distributor"},
        {"Description": "Freight", "Deduction Type": "Other allowance", "Calculation": "$ per unit",
         "Per Unit": "$3.00", "Customer Type": "Distributor"},
    ]})
    assert data["errors"] == [], data["errors"]
    stored = {r[0]: r[1:] for r in q(mgr, "SELECT name, method, customer_id FROM sales_deduction_rules")}
    assert stored["Dealer terms"] == ("percent_of_gross", "CUST-001")
    assert stored["Dist commission"][0] == "percent_of_net"
    assert stored["Freight"][0] == "per_unit"
    assert not any("Customer No" in w for w in data["warnings"])


# ---------------------------------------------------------------------------
# Repeated deduction types (F1 / RM-1)
# ---------------------------------------------------------------------------

def test_other_allowance_programs_with_different_names_are_both_kept(env):
    client, mgr = env
    rows = [
        {"Description": "Distributor co-op allowance", "Deduction Type": "Other allowance",
         "Calculation": "% of gross", "Rate": "0.50%", "Customer Type": "Distributor"},
        {"Description": "Distributor freight allowance", "Deduction Type": "Other allowance",
         "Calculation": "Per unit", "Per Unit": "$3.00", "Customer Type": "Distributor"},
    ]
    data = post(client, "/import/deductions", {"rows": rows})
    assert (data["created"], data["updated"], data["errors"]) == (2, 0, [])
    assert q(mgr, "SELECT COUNT(*) FROM sales_deduction_rules WHERE deduction_type = 'other_allowance'") == [(2,)]
    again = post(client, "/import/deductions", {"rows": rows})                 # re-import is idempotent
    assert (again["created"], again["updated"]) == (0, 2)
    assert q(mgr, "SELECT COUNT(*) FROM sales_deduction_rules") == [(2,)]


def test_unnamed_other_allowance_reimport_updates_instead_of_stacking(env):
    client, mgr = env
    post(client, "/import/deductions", {"rows": [{"Type": "other", "Rate": "1%", "Customer Type": "Dealer"}]})
    again = post(client, "/import/deductions", {"rows": [{"Type": "other", "Rate": "2%", "Customer Type": "Dealer"}]})
    assert (again["created"], again["updated"]) == (0, 1)
    assert q(mgr, "SELECT rate FROM sales_deduction_rules") == [(0.02,)]


def test_same_scope_twice_in_one_file_is_a_row_error(env):
    client, mgr = env
    data = post(client, "/import/deductions", {"rows": [
        {"Type": "terms", "Rate": "2%", "Customer Type": "Dealer"},
        {"Type": "terms", "Rate": "1%", "Customer Type": "dealer"},
        {"Type": "other", "Rate": "1%"},
        {"Type": "other", "Rate": "2%"},                                        # two unnamed programs
        {"Type": "other", "Name": "Co-op", "Rate": "1%"},
        {"Type": "other", "Name": "co-op ", "Rate": "2%"},                      # the same program twice
    ]})
    errors = {e["row"]: e["error"] for e in data["errors"]}
    assert set(errors) == {2, 4, 6}, data["errors"]
    assert "rows 1 and 2" in errors[2] and "terms_allowance" in errors[2]
    assert "rows 3 and 4" in errors[4] and "name" in errors[4]
    assert "rows 5 and 6" in errors[6]
    assert q(mgr, "SELECT rate FROM sales_deduction_rules WHERE deduction_type = 'terms_allowance'") == [(0.02,)]

    prices = post(client, "/import/prices", {"rows": [
        {"Product": "RFL-308", "Customer Type": "Dealer", "Price": 1199},
        {"Product": "RFL-308", "Customer Type": "Dealer", "Price": 1149},
    ]})
    assert [e["row"] for e in prices["errors"]] == [2] and "rows 1 and 2" in prices["errors"][0]["error"]


def test_append_mode_refuses_a_rule_that_could_never_apply(env):
    client, mgr = env
    post(client, "/import/deductions", {"rows": [{"Type": "terms", "Rate": "2%"}]})
    data = post(client, "/import/deductions", {"mode": "append", "rows": [
        {"Type": "terms", "Rate": "1%"},                                       # same slot as the stored rule
        {"Type": "other", "Name": "Freight", "Rate": "1%"},                    # a new program: fine
    ]})
    assert data["created"] == 1 and [e["row"] for e in data["errors"]] == [1]
    assert "already exists" in data["errors"][0]["error"] and "upsert" in data["errors"][0]["error"]
    assert q(mgr, "SELECT COUNT(*) FROM sales_deduction_rules") == [(2,)]


# ---------------------------------------------------------------------------
# Replace is all-or-nothing (API-7)
# ---------------------------------------------------------------------------

def test_rule_replace_with_a_bad_row_changes_nothing(env):
    client, mgr = env
    post(client, "/import/prices", {"rows": [
        {"Product": "RFL-308", "Customer Type": "Dealer", "Price": 1199},
        {"Product": "PST-9C", "Customer Type": "Dealer", "Price": 450},
    ]})
    before = snapshot(mgr)
    data = post(client, "/import/prices", {"mode": "replace", "rows": [
        {"Product": "RFL-308", "Customer Type": "Dealer", "Price": 1249},
        {"Product": "PST-9C", "Customer Type": "Dealer", "Price": "4OO"},
    ]})
    assert data["replace_blocked"] is True and len(data["errors"]) == 1
    assert "Nothing was changed" in client.post("/import/prices", json={"mode": "replace", "rows": [
        {"Product": "PST-9C", "Customer Type": "Dealer", "Price": "4OO"}]}).json()["message"]
    assert snapshot(mgr) == before

    deductions = post(client, "/import/deductions", {"mode": "replace", "rows": [
        {"Type": "terms", "Rate": "2%"}, {"Type": "nonsense", "Rate": "1%"}]})
    assert deductions["replace_blocked"] is True
    assert snapshot(mgr) == before

    ok = post(client, "/import/prices", {"mode": "replace", "rows": [
        {"Product": "RFL-308", "Customer Type": "Dealer", "Price": 1249}]})
    assert ok["replace_blocked"] is False and ok["replaced"] == 2
    assert q(mgr, "SELECT unit_id, unit_price FROM price_list") == [("RFL-308", 1249.0)]


# ---------------------------------------------------------------------------
# Product-type prices and the price matrix (F13 part 1)
# ---------------------------------------------------------------------------

def test_price_import_takes_a_product_type_column(env):
    client, mgr = env
    from api import pricing_routes
    data = post(client, "/import/prices", {"rows": [
        {"Product Type": "Rifle", "Customer Type": "Distributor", "Discount": "40%"}]})
    if "unit_type" in pricing_routes.PRICE_FIELDS:
        assert data["errors"] == [] and data["created"] == 1
        assert q(mgr, "SELECT unit_type, customer_type, discount_pct FROM price_list") == [("Rifle", "Distributor", 0.4)]
    else:   # the price list has no product-type scope yet: never widen the rule to every product
        assert data["created"] == 0 and "product type" in data["errors"][0]["error"]
    assert not any("Product Type" in w for w in data["warnings"])


def test_wide_price_matrix_imports_one_rule_per_filled_cell(env):
    client, mgr = env
    data = post(client, "/import/prices", {"rows": [
        {"Item Number": "RFL-308", "Description": "Ridgeline", "List Price": 1499, "Dealer": 1199,
         "Distributor": "1,049.00"},
        {"Item Number": "PST-9C", "Description": "Compact", "List Price": 599, "Dealer": 450,
         "Distributor": "40% off list"},
        {"Item Number": "PST-9C", "Description": "dup?", "Dealer": "", "Distributor": " - "},   # nothing to import
    ]})
    assert [e["row"] for e in data["errors"]] == [3]                         # a row with no price at all
    assert data["created"] == 4
    stored = {(r[0], r[1]): r[2:] for r in q(
        mgr, "SELECT unit_id, customer_type, method, unit_price, discount_pct FROM price_list")}
    assert stored == {
        ("RFL-308", "Dealer"): ("fixed", 1199.0, None),
        ("RFL-308", "Distributor"): ("fixed", 1049.0, None),
        ("PST-9C", "Dealer"): ("fixed", 450.0, None),
        ("PST-9C", "Distributor"): ("discount_from_base", None, 0.4),
    }
    text = " | ".join(data["warnings"])
    assert "Dealer" in text and "customer type" in text                       # the layout is reported
    assert "List Price" in text and "product" in text                        # list price lives on the product
    assert all(r.get("column") in ("Dealer", "Distributor") for r in data["records"])


def test_price_matrix_with_unknown_customer_types_explains_the_layout(env):
    client, _ = env
    data = post(client, "/import/prices", {"rows": [
        {"Item Number": "RFL-308", "Export": 910, "Direct": 1299},
        {"Item Number": "PST-9C", "Export": 455, "Direct": 649},
    ]})
    assert data["created"] == 0 and len(data["errors"]) == 2
    error = data["errors"][0]["error"]
    assert "Export" in error and "Direct" in error and "customer type" in error


def test_price_template_has_a_product_type_column_and_rectangular_rows(env):
    client, _ = env
    from api.import_routes import TEMPLATES
    for kind, spec in TEMPLATES.items():
        assert all(len(row) == len(spec["columns"]) for row in spec["rows"]), kind
    assert "unit_type" in client.get("/import/templates/prices").text.splitlines()[0]
