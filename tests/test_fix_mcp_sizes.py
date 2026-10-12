"""
MCP response sizes on realistic data (review finding MCP-3).

Builds a model the size of the owner's (20 customers x 20 products x 12
months = 4,800 sales lines, 500 BOM lines with long material descriptions,
120 routing operations, 100 price rules, deduction rules, 40 employees,
expenses, loans, capex) through the REST import endpoints, then calls EVERY
read-only tool with only its required arguments and checks that none trips
the response-size guard. A tool that needs a narrower request on a model
this size is a tool that fails the first time an assistant uses it.

Run with ``-s`` to print each tool's size (the report in the fix notes).
"""
import json
import os
import shutil
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
YEAR = [f"2027-{m:02d}" for m in range(1, 13)]
TYPES = ["Dealer", "Distributor", "Government", "Export", "Direct"]
CALIBERS = ["6.5 Creedmoor", ".308 Winchester", "7mm PRC", ".300 Win Mag", "9mm Luger", ".45 ACP", "6.5 PRC",
            ".223 Remington"]
SHARED_PARTS = ["Trigger pin, hardened 4140", "Hammer spring, music wire", "Grip screw 8-32 x 3/8 black oxide",
                "Scope base screw 6-48", "Sling swivel stud", "Extractor spring", "Ejector plunger",
                "Firing pin spring", "Bolt release lever", "Safety detent ball"]


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


def _post(client, path, payload):
    res = client.post(path, json=payload)
    assert res.status_code < 400, (path, res.status_code, res.text[:500])
    return res.json()


def build_realistic_model(client):
    """The owner-sized model, loaded through the REST endpoints the UI uses."""
    customers = [{"customer_id": f"C{i:02d}", "customer_name": f"Customer {i:02d} Outdoor Supply Co",
                  "customer_type": TYPES[i % 5], "region": ["West", "East", "South", "North"][i % 4]}
                 for i in range(1, 21)]
    products = []
    for i in range(1, 21):
        pistol = i % 4 == 0
        products.append({
            "unit_id": f"{'PST' if pistol else 'RFL'}-{300 + i}",
            "unit_name": f"{'Compact' if pistol else 'Ridgeline Long Range'} {CALIBERS[i % 8]} {16 + i % 10}in "
                         f"{'Pistol' if pistol else 'Rifle'}",
            "unit_type": "Pistol" if pistol else "Rifle", "base_price": 900 + 25 * i,
        })
    machines = [{"machine_id": f"WC-{i:02d}", "machine_name": f"Haas VF-{i} CNC machining center",
                 "machine_rate": 60 + 5 * i, "available_hours_per_month": 320} for i in range(1, 7)]
    labor = [{"rate_id": rid, "rate_name": name, "rate_amount": rate}
             for rid, name, rate in (("MACH", "CNC machinist", 32), ("ASSY", "Assembler", 24),
                                     ("FIN", "Finisher", 26), ("QC", "Quality inspector", 28))]
    for table, rows in (("customers", customers), ("units", products), ("machines", machines),
                        ("labor_rates", labor)):
        body = _post(client, "/import/records", {"table": table, "rows": rows})
        assert not (body.get("data") or {}).get("errors"), body

    routing, bom = [], []
    for p in products:
        for s in range(1, 7):
            routing.append({"router_id": f"RT-{p['unit_id']}", "sequence": s * 10,
                            "machine_id": f"WC-{(s % 6) + 1:02d}", "machine_minutes": 8 + s, "labor_minutes": 10 + s,
                            "labor_type_id": labor[s % 4]["rate_id"],
                            "operation_description": f"Operation {s}: machine, deburr and inspect",
                            "unit_id": p["unit_id"]})
        for line in range(1, 26):
            if line <= len(SHARED_PARTS):
                desc, price = SHARED_PARTS[line - 1], round(0.5 + line * 0.3, 2)
            else:
                desc = (f"{p['unit_id']} component {line}: 416R stainless, machined to print rev C, "
                        f"cerakote finish")
                price = round(2 + line * 1.1, 2)
            bom.append({"bom_id": f"BOM-{p['unit_id']}", "version": "1", "bom_line": line,
                        "material_description": desc, "qty": 1 + (line % 2), "unit": "EA", "unit_price": price,
                        "unit_id": p["unit_id"]})
    assert len(routing) == 120 and len(bom) == 500
    _post(client, "/import/routings", {"rows": routing})
    _post(client, "/import/boms", {"rows": bom})

    _post(client, "/forecast/scenario", {"name": "Budget 2027", "is_base": True})
    prices = [{"unit_id": p["unit_id"], "customer_type": t, "unit_price": round(p["base_price"] * f, 2),
               "start_period": "2027-01", "end_period": "2027-12"}
              for p in products for t, f in (("Dealer", 0.8), ("Distributor", 0.7), ("Government", 0.75),
                                             ("Export", 0.78))]
    prices += [{"unit_id": p["unit_id"], "customer_id": customers[i]["customer_id"],
                "unit_price": round(p["base_price"] * 0.72, 2)} for i, p in enumerate(products)]
    assert len(prices) == 100
    _post(client, "/import/prices", {"rows": prices})
    rules = [
        {"deduction_type": "terms_allowance", "customer_type": "Dealer", "rate": 0.02, "name": "Dealer terms"},
        {"deduction_type": "chargebacks", "rate": 0.01, "name": "Chargebacks"},
        {"deduction_type": "other_allowance", "customer_type": "Distributor", "rate": 0.005, "name": "Co-op"},
        {"deduction_type": "excise_tax", "method": "embedded_tax", "rate": 0.11, "name": "FET rifles",
         "unit_type": "Rifle"},
        {"deduction_type": "excise_tax", "method": "embedded_tax", "rate": 0.10, "name": "FET pistols",
         "unit_type": "Pistol"},
        {"deduction_type": "excise_tax", "customer_type": "Government", "rate": 0, "name": "Gov exempt"},
        {"deduction_type": "commission", "method": "percent_of_net", "customer_type": "Distributor", "rate": 0.03,
         "name": "Rep commission"},
    ]
    _post(client, "/import/deductions", {"rows": rules})

    wide = []
    for c in customers:
        for p in products:
            row = {"customer_id": c["customer_id"], "unit_id": p["unit_id"]}
            for m, period in enumerate(YEAR):
                row[period] = 5 + (m + len(c["customer_id"]) + int(p["unit_id"][-2:])) % 30
            wide.append(row)
    body = _post(client, "/forecast/smart_import_sales", {"forecast_id": "F001", "sales": wide})
    assert (body.get("data") or body).get("imported", 0) >= 4800 or "4800" in json.dumps(body), str(body)[:400]

    for i in range(1, 41):
        _post(client, "/payroll/employees", {
            "employee_name": f"Employee {i:02d} Lastname", "department": ["Production", "Engineering", "Sales",
                                                                          "Admin", "Quality"][i % 5],
            "weekly_hours": 40, "hourly_rate": 25 + i, "labor_type": "Staff", "start_date": "2026-01-01",
            "allocations": {"Rifles": 60, "Pistols": 40},
        })
    return {"customers": customers, "products": products}


def _add_finance(client):
    """Expenses, loans (one a 30-year mortgage) and capex, through the MCP tools."""
    category = None
    for name, ctype in (("Factory overhead", "factory_overhead"), ("Admin", "admin_expense")):
        res, text = raw_call(client, "forecast_create_expense_category", {"category_name": name, "category_type": ctype})
        assert not res.get("isError"), text
        body = json.loads(text)
        category = category or body.get("category_id") or (body.get("category") or {}).get("category_id")
    assert category
    for i in range(1, 21):
        res, text = raw_call(client, "forecast_create_expense", {
            "expense_name": f"Expense {i:02d} facility and services", "category_id": category,
            "amount": 1000 + 50 * i, "frequency": "monthly", "start_date": "2026-01-01",
            "vendor": f"Vendor {i:02d} Industrial Services LLC"})
        assert not res.get("isError"), text
    for name, ltype, term in (("Equipment loan", "equipment_loan", 60), ("Building mortgage", "real_estate_loan", 360)):
        res, text = raw_call(client, "forecast_create_loan", {
            "loan_name": name, "lender": "First Bank", "loan_type": ltype, "principal_amount": 500000,
            "interest_rate": 7.0, "loan_term_months": term, "start_date": "2026-01-15"})
        assert not res.get("isError"), text
    for i in range(1, 6):
        res, text = raw_call(client, "forecast_create_capex", {
            "asset_name": f"CNC machine {i}", "amount": 150000, "purchase_period": f"2027-0{i}"})
        assert not res.get("isError"), text


@pytest.fixture(scope="module")
def big_model():
    tmp = tempfile.mkdtemp()
    data_dir = os.path.join(tmp, "data")
    os.makedirs(os.path.join(data_dir, "imports"))
    mgr = DatabaseManager(database_path=os.path.join(data_dir, "big.db"), data_dir=data_dir)
    mgr.initialize()
    from app.main import app as fastapi_app
    originals = _patch_db_manager(mgr)
    try:
        with TestClient(fastapi_app) as client:
            model = build_realistic_model(client)
            _add_finance(client)
            with open(os.path.join(data_dir, "imports", "sales_wide.csv"), "w", encoding="utf-8") as fh:
                fh.write("customer_id,unit_id," + ",".join(YEAR) + "\n")
                for c in model["customers"][:5]:
                    fh.write(f"{c['customer_id']},RFL-301," + ",".join("10" for _ in YEAR) + "\n")
            yield client, mgr, model
    finally:
        for name, original in originals.items():
            sys.modules[name].db_manager = original
        mgr.close_all_connections()
        shutil.rmtree(tmp, ignore_errors=True)


def raw_call(client, name, arguments=None):
    res = client.post("/mcp", headers=HEADERS, follow_redirects=False, json={
        "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments or {}},
    })
    assert res.status_code == 200, res.text
    result = res.json()["result"]
    text = "".join(b.get("text", "") for b in result.get("content", []) if b.get("type") == "text")
    return result, text


#: Required arguments per tool (everything else left at its default).
REQUIRED_ARGS = {
    "forecast_get_employee": None,          # needs an id from a listing; filled in by the test
    "forecast_loan_schedule": None,
    "forecast_deduction_preview": {"forecast_id": "F001"},
    "forecast_get_assumptions": {"forecast_id": "F001"},
    "forecast_get_scenario": {"forecast_id": "F001"},
    "forecast_list_sales": {"forecast_id": "F001"},
    "forecast_revenue_summary": {"forecast_id": "F001"},
    "forecast_financial_statements": {"forecast_ids": ["F001"], "start_period": "2027-01", "end_period": "2027-12"},
    "forecast_variance": {"forecast_ids": ["F001"], "start_period": "2027-01", "end_period": "2027-12"},
    "forecast_cogs_forecast": {"forecast_ids": ["F001"]},
    "forecast_compare_scenarios": {"forecast_ids": ["F001"]},
    "forecast_labor_forecast": {"forecast_ids": ["F001"]},
    "forecast_sales_detail": {"forecast_ids": ["F001"]},
    "forecast_sql_query": {"sql": "SELECT * FROM sales"},
    "forecast_expense_forecast": {"start_period": "2027-01", "end_period": "2027-12"},
    "forecast_list_actuals": {"start_period": "2027-01", "end_period": "2027-12"},
    "forecast_loan_cash_flow": {"start_period": "2027-01", "end_period": "2027-12"},
    "forecast_query_table": {"table": "bom"},
    "forecast_resolve_price": {"unit_id": "RFL-301"},
    "forecast_preview_file": {"file_path": "imports/sales_wide.csv"},
    "forecast_simulate_deductions": {"gross": 1110, "customer_type": "Dealer"},
}


def test_every_read_tool_fits_the_guard_with_default_arguments(big_model):
    client, _mgr, _model = big_model
    from mcp_server.core import MAX_RESPONSE_CHARS, mcp

    sizes = {}
    failures = []
    employee_id = json.loads(raw_call(client, "forecast_list_employees", {"limit": 1})[1])["employees"][0]["employee_id"]
    loans = json.loads(raw_call(client, "forecast_list_loans", {})[1])
    loan_list = loans.get("loans") or loans.get("items") or []
    mortgage = next(l["loan_id"] for l in loan_list if l.get("loan_term_months") == 360)
    ids = {"forecast_get_employee": {"employee_id": employee_id}, "forecast_loan_schedule": {"loan_id": mortgage}}
    for tool in mcp._tool_manager.list_tools():
        if not (tool.annotations and tool.annotations.read_only_hint):
            continue
        args = REQUIRED_ARGS.get(tool.name, {})
        if args is None:
            args = ids[tool.name]
        result, text = raw_call(client, tool.name, args)
        sizes[tool.name] = len(text)
        if result.get("isError"):
            failures.append(f"{tool.name}: {text[:200]}")
    print("\nResponse sizes (chars, default arguments, realistic model):")
    for name, size in sorted(sizes.items(), key=lambda kv: -kv[1]):
        print(f"  {size:7d}  {name}")
    assert not failures, "\n".join(failures)
    assert max(sizes.values()) <= MAX_RESPONSE_CHARS


def _ok(client, name, args):
    result, text = raw_call(client, name, args)
    assert not result.get("isError"), text
    return json.loads(text)


def test_the_new_narrowing_arguments_on_the_big_model(big_model):
    client, _mgr, _model = big_model
    usage = _ok(client, "forecast_materials_usage", {"forecast_id": "F001"})
    costs = [m["total_cost"] for m in usage["materials"]]
    assert len(costs) == 50 and costs == sorted(costs, reverse=True)
    assert usage["materials_total_count"] == 310 and usage["materials_omitted"] == 260
    assert usage["totals"]["material_count"] == 310          # totals still cover every material
    assert all(len(m["products_using"]) <= 3 and m["products_using_count"] >= 1 for m in usage["materials"])
    shared = _ok(client, "forecast_materials_usage", {"forecast_id": "F001", "material_contains": "trigger"})
    assert shared["materials"][0]["products_using_count"] == 20 and len(shared["materials"][0]["products_using"]) == 3
    trig = _ok(client, "forecast_materials_usage", {"forecast_id": "F001", "material_contains": "trigger",
                                                    "include_products": True})
    assert trig["materials_total_count"] == 1 and len(trig["materials"][0]["products_using"]) == 20
    assert trig["filtered_totals"]["total_cost"] == trig["materials"][0]["total_cost"]
    one_bom = _ok(client, "forecast_materials_usage", {"forecast_id": "F001", "bom_id": "BOM-RFL-301", "top_n": 100})
    assert one_bom["materials_total_count"] == 25

    stmts = _ok(client, "forecast_financial_statements", {"forecast_ids": ["F001"], "start_period": "2027-01",
                                                           "end_period": "2027-12"})
    assert stmts["detail_omitted"]["revenue_by_product"] == 20 and stmts["detail_omitted"]["payroll_employees"] == 40
    assert "revenue_by_product" not in stmts["detail"] and "revenue_by_customer_type" in stmts["detail"]
    assert {"income_statement", "cash_flow", "balance_sheet"} <= set(stmts)
    by_product = _ok(client, "forecast_financial_statements", {"forecast_ids": ["F001"], "start_period": "2027-01",
                                                               "end_period": "2027-12",
                                                               "sections": ["detail.revenue_by_product"]})
    assert len(by_product["detail"]["revenue_by_product"]) == 20

    summary = _ok(client, "forecast_product_cost_summary", {"forecast_id": "F001", "top_n": 5})
    assert len(summary["products"]) == 5 and summary["products_omitted"] == 15
    sales = [p["net_sales"] for p in summary["products"]]
    assert sales == sorted(sales, reverse=True)
    assert _ok(client, "forecast_product_cost_summary", {"forecast_id": "F001", "unit_id": "PST-304"})["products"][0][
        "product_id"] == "PST-304"

    loans = _ok(client, "forecast_list_loans", {})
    mortgage = next(l["loan_id"] for l in (loans.get("loans") or loans.get("items")) if l.get("loan_term_months") == 360)
    sched = _ok(client, "forecast_loan_schedule", {"loan_id": mortgage})
    assert sched["payment_count"] == 360 and sched["returned"] == 120 and sched["next_offset"] == 120
    year = _ok(client, "forecast_loan_schedule", {"loan_id": mortgage, "start_period": "2027-01",
                                                  "end_period": "2027-12", "layout": "records"})
    assert year["payment_count"] == 12 and year["payment_schedule"][0]["payment_date"].startswith("2027-01")

    employees = _ok(client, "forecast_list_employees", {"limit": 10, "offset": 35})
    assert employees["total_count"] == 40 and len(employees["employees"]) == 5 and employees["next_offset"] is None
    wide = _ok(client, "forecast_sql_query", {"sql": "SELECT * FROM bom", "limit": 2000})
    assert wide["truncated"] is True and "note" in wide and wide["returned"] < 500
