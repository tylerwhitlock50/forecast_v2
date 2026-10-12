"""Generic table access and master-data CRUD (customers, products, BOMs,
routers, machines, labor rates) plus a read-only SQL escape hatch."""
from __future__ import annotations

import re
from typing import Annotated, Any, Dict, List, Optional

from pydantic import Field
from mcp.server.fastmcp.exceptions import ToolError

import db.database as dbmod
from mcp_server.core import DESTRUCTIVE, READ, UPSERT, WRITE, call, mcp, require

# Tables the generic tools may touch, with the id format the CRUD routes expect.
TABLES: Dict[str, Dict[str, str]] = {
    "forecast": {"key": "forecast_id", "about": "Scenarios. Prefer the forecast_*_scenario tools."},
    "customers": {"key": "customer_id", "about": "Customer master data: customer_name, customer_type, region."},
    "units": {"key": "unit_id", "about": "Products: unit_name, unit_description, base_price, unit_type, bom_id, bom_version, router_id, router_version."},
    "sales": {"key": "sale_id", "about": "Sales forecast rows per customer / product / period / scenario. Prefer the forecast_*_sales tools."},
    "bom_definitions": {"key": "bom_id", "about": "BOM headers: bom_name, bom_description, version."},
    "bom": {"key": "bom_id-version-bom_line", "about": "BOM lines: material_description, qty, unit, unit_price, material_cost (= qty x unit_price), target_cost."},
    "router_definitions": {"key": "router_id", "about": "Routing headers: router_name, router_description, version."},
    "router_operations": {"key": "router_id-sequence", "about": "Routing steps: sequence, machine_id, machine_minutes, labor_minutes, labor_type_id, operation_description."},
    "machines": {"key": "machine_id", "about": "Machines: machine_name, machine_rate ($/hour), labor_type, available_minutes_per_month."},
    "labor_rates": {"key": "rate_id", "about": "Labor rates: rate_name, rate_amount ($/hour), rate_type."},
    "payroll": {"key": "employee_id", "about": "Employees. Prefer the forecast_*_employee tools."},
    "payroll_config": {"key": "config_id", "about": "Burden rates and pay frequency. Prefer forecast_get_payroll_config."},
    "expense_categories": {"key": "category_id", "about": "Expense categories: category_name, category_type (factory_overhead, admin_expense, cogs)."},
    "expenses": {"key": "expense_id", "about": "Operating expenses. Prefer the forecast_*_expense tools."},
    "expense_allocations": {"key": "allocation_id", "about": "Per-period expense allocations generated from expenses."},
    "loans": {"key": "loan_id", "about": "Loans. Prefer the forecast_*_loan tools."},
    "loan_payments": {"key": "payment_id", "about": "Amortization schedule rows."},
    "financial_assumptions": {"key": "forecast_id", "about": "Opening balances and working-capital / tax assumptions per scenario. Prefer forecast_get_assumptions."},
    "capital_expenditures": {"key": "capex_id", "about": "Planned asset purchases. Prefer the forecast_*_capex tools."},
    "actuals": {"key": "actual_id", "about": "Actual results by period and statement line for budget vs actual."},
}

Table = Annotated[str, Field(description="Table name (see forecast_list_tables)")]


def _check_table(table: str) -> str:
    table = require(table, "table")
    if table not in TABLES:
        raise ToolError(f"Unknown table '{table}'. Known tables: {', '.join(TABLES)}")
    return table


@mcp.tool(name="forecast_list_tables", annotations=READ)
async def list_tables() -> Dict[str, Any]:
    """Catalog of the model's tables with their row counts, primary key format
    (needed by forecast_update_record / forecast_delete_record) and what each
    holds. Use forecast_query_table or forecast_sql_query to read them."""
    conn = dbmod.db_manager.get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        existing = {row[0] for row in cursor.fetchall()}
        tables = []
        for name, info in TABLES.items():
            if name not in existing:
                continue
            cursor.execute(f"SELECT COUNT(*) FROM {name}")
            count = cursor.fetchone()[0]
            cursor.execute(f"PRAGMA table_info({name})")
            columns = [row[1] for row in cursor.fetchall()]
            tables.append({"table": name, "rows": count, "record_id_format": info["key"],
                           "columns": columns, "about": info["about"]})
    finally:
        dbmod.db_manager.close_connection(conn)
    return {"tables": tables}


@mcp.tool(name="forecast_query_table", annotations=READ)
async def query_table(
    table: Table,
    forecast_id: Annotated[Optional[str], Field(description="Scenario scope: sales rows of this scenario; other tables include company-wide (NULL) rows too")] = None,
    filters: Annotated[Optional[Dict[str, Any]], Field(description="Equality filters, e.g. {\"customer_id\": \"C001\"}")] = None,
    limit: Annotated[int, Field(ge=1, le=5000)] = 200,
    offset: Annotated[int, Field(ge=0)] = 0,
) -> Dict[str, Any]:
    """Read rows from any model table with optional scenario scope and equality
    filters. For ranges, joins or aggregates use forecast_sql_query."""
    table = _check_table(table)
    params: Dict[str, Any] = {"forecast_id": forecast_id, "limit": limit, "offset": offset}
    for key, value in (filters or {}).items():
        if value is not None:
            params[key] = value
    body = await call("GET", f"/data/{table}", params=params)
    rows = body.get("items") if "items" in body else body.get("data", [])
    rows = rows or []
    return {
        "table": table,
        "rows": rows,
        "columns": body.get("columns", []),
        "returned": len(rows),
        "offset": offset,
        "has_more": len(rows) == limit,
        "next_offset": offset + limit if len(rows) == limit else None,
    }


@mcp.tool(name="forecast_create_record", annotations=WRITE)
async def create_record(
    table: Table,
    data: Annotated[Dict[str, Any], Field(description="Column values including the primary key, e.g. {\"customer_id\": \"C010\", \"customer_name\": \"Acme\"}")],
) -> Dict[str, Any]:
    """Insert one row into a master-data table (customers, units, bom,
    bom_definitions, router_definitions, router_operations, machines,
    labor_rates, expense_categories, ...). Unknown columns are ignored. For
    bom rows set material_cost = qty x unit_price yourself."""
    table = _check_table(table)
    if not data:
        raise ToolError("data must contain at least one column")
    return await call("POST", "/forecast/create", json={"table": table, "data": data})


@mcp.tool(name="forecast_update_record", annotations=UPSERT)
async def update_record(
    table: Table,
    record_id: Annotated[str, Field(description="Primary key. Composite keys: bom => 'bom_id-version-bom_line', router_operations => 'router_id-sequence'")],
    updates: Annotated[Dict[str, Any], Field(description="Columns to change, e.g. {\"base_price\": 120}")],
) -> Dict[str, Any]:
    """Update columns of one row in a master-data table. Unknown columns are
    ignored and reported. For bom rows keep material_cost = qty x unit_price
    (or use forecast_adjust_material_costs, which does it for you)."""
    table = _check_table(table)
    if not updates:
        raise ToolError("updates must contain at least one column")
    return await call("POST", "/forecast/update", json={
        "table": table, "id": require(record_id, "record_id"), "updates": updates,
    })


@mcp.tool(name="forecast_delete_record", annotations=DESTRUCTIVE)
async def delete_record(
    table: Table,
    record_id: Annotated[str, Field(description="Primary key (composite formats as in forecast_update_record)")],
    cascade: Annotated[bool, Field(description="For customers / units: also delete their sales rows")] = False,
    forecast_id: Annotated[Optional[str], Field(description="With cascade, limit the sales deletion to this scenario")] = None,
) -> Dict[str, Any]:
    """Delete one row from a master-data table. Deleting a customer or product
    that still has sales rows fails unless cascade is true."""
    table = _check_table(table)
    return await call("DELETE", f"/forecast/delete/{table}/{require(record_id, 'record_id')}",
                      params={"cascade": cascade, "forecast_id": forecast_id})


@mcp.tool(name="forecast_import_customers", annotations=WRITE)
async def import_customers(
    customers: Annotated[List[Dict[str, Any]], Field(description="Rows of {customer_id?, customer_name, customer_type?, region?}", min_length=1)],
    merge_strategy: Annotated[str, Field(description="skip existing ids, update them, or create_new ids")] = "skip",
) -> Dict[str, Any]:
    """Bulk create customers; ids are generated when missing. Returns created,
    updated and skipped counts."""
    if merge_strategy not in ("skip", "update", "create_new"):
        raise ToolError("merge_strategy must be skip, update or create_new")
    return await call("POST", "/forecast/bulk_create_customers", json={
        "customers": customers, "options": {"merge_strategy": merge_strategy},
    })


@mcp.tool(name="forecast_import_products", annotations=WRITE)
async def import_products(
    products: Annotated[List[Dict[str, Any]], Field(description="Rows of {unit_id?, unit_name, unit_description?, base_price?, unit_type?, bom_id?, router_id?}", min_length=1)],
    merge_strategy: Annotated[str, Field(description="skip existing ids, update them, or create_new ids")] = "skip",
) -> Dict[str, Any]:
    """Bulk create products (units); ids are generated when missing."""
    if merge_strategy not in ("skip", "update", "create_new"):
        raise ToolError("merge_strategy must be skip, update or create_new")
    return await call("POST", "/forecast/bulk_create_products", json={
        "products": products, "options": {"merge_strategy": merge_strategy},
    })


_FORBIDDEN = re.compile(r"\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex)\b", re.I)


@mcp.tool(name="forecast_sql_query", annotations=READ)
async def sql_query(
    sql: Annotated[str, Field(description="A single SELECT (or WITH ... SELECT) statement over the model tables")],
    limit: Annotated[int, Field(description="Max rows returned", ge=1, le=5000)] = 500,
) -> Dict[str, Any]:
    """Run a read-only SQL query against the model database (SQLite). Use it
    for joins, ranges and aggregates the typed tools do not offer, e.g.
    revenue by product by month. Writes are rejected; use the write tools."""
    statement = require(sql, "sql").strip().rstrip(";").strip()
    if ";" in statement:
        raise ToolError("Only one statement is allowed")
    head = statement.lower()
    if not (head.startswith("select") or head.startswith("with")):
        raise ToolError("Only SELECT queries are allowed; use the write tools to change data")
    if _FORBIDDEN.search(statement):
        raise ToolError("Query contains a write keyword; only SELECT queries are allowed")
    conn = dbmod.db_manager.get_connection()
    try:
        conn.execute("PRAGMA query_only = 1")
        cursor = conn.cursor()
        try:
            cursor.execute(statement)
        except Exception as exc:  # sqlite3.Error, surfaced with the SQL error text
            raise ToolError(f"SQL error: {exc}")
        columns = [d[0] for d in cursor.description] if cursor.description else []
        rows = cursor.fetchmany(limit + 1)
    finally:
        dbmod.db_manager.close_connection(conn)
    truncated = len(rows) > limit
    rows = rows[:limit]
    return {
        "columns": columns,
        "rows": [dict(zip(columns, row)) for row in rows],
        "returned": len(rows),
        "truncated": truncated,
    }
