"""Generic table access and master-data CRUD (customers, products, BOMs,
routers, machines, labor rates) plus a read-only SQL escape hatch."""
from __future__ import annotations

import re
from typing import Annotated, Any, Dict, List, Literal, Optional, Tuple

from pydantic import Field
from mcp.server.mcpserver.exceptions import ToolError

import db.database as dbmod
from mcp_server.core import (
    DESTRUCTIVE, READ, UPSERT, WRITE, as_table, call, check_row_keys, error_list, format_row_errors, mcp, require,
)

Layout = Annotated[Literal["table", "records"], Field(description=(
    "table: `columns` once plus one array per row (default, about half the size); records: one object per row"))]

# Tables the generic tools may touch, with the id format the CRUD routes expect.
TABLES: Dict[str, Dict[str, str]] = {
    "forecast": {"key": "forecast_id", "about": "Scenarios. Prefer the forecast_*_scenario tools."},
    "customers": {"key": "customer_id", "about": "Customer master data: customer_name, customer_type (drives customer-type prices and deductions), region."},
    "units": {"key": "unit_id", "about": "Products: unit_name, unit_description, base_price, unit_type, bom_id, bom_version, router_id, router_version."},
    "sales": {"key": "sale_id", "about": "Sales forecast rows per customer / product / period / scenario. Prefer the forecast_*_sales tools."},
    "bom_definitions": {"key": "bom_id", "about": "BOM headers: bom_name, bom_description, version."},
    "bom": {"key": "bom_id-version-bom_line", "about": "BOM lines: material_description, qty, unit, unit_price, material_cost (= qty x unit_price), target_cost."},
    "router_definitions": {"key": "router_id", "about": "Routing headers: router_name, router_description, version."},
    "router_operations": {"key": "router_id-sequence", "about": "Routing steps: sequence, machine_id (required), machine_minutes, labor_minutes, labor_type_id (a labor_rates.rate_id), operation_description."},
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

#: Tables forecast_create_record / update_record / delete_record may write.
#: The rest have dedicated tools that keep derived data (allocations, loan
#: schedules, revenue, scenario cascades) consistent.
WRITABLE = ("customers", "units", "bom_definitions", "bom", "router_definitions", "router_operations",
            "machines", "labor_rates", "expense_categories")
DEDICATED_TOOLS = {
    "forecast": "forecast_create_scenario / forecast_update_scenario / forecast_delete_scenario",
    "sales": "forecast_upsert_sales / forecast_import_sales / forecast_adjust_sales / forecast_delete_sale",
    "payroll": "forecast_create_employee / forecast_update_employee / forecast_delete_employee",
    "payroll_config": "forecast_update_payroll_config",
    "expenses": "forecast_create_expense / forecast_update_expense / forecast_delete_expense",
    "expense_allocations": "forecast_update_expense (allocations are generated from the expense)",
    "loans": "forecast_create_loan / forecast_update_loan / forecast_delete_loan",
    "loan_payments": "forecast_update_loan (the schedule is generated from the loan)",
    "financial_assumptions": "forecast_update_assumptions",
    "capital_expenditures": "forecast_create_capex / forecast_update_capex / forecast_delete_capex",
    "actuals": "forecast_upsert_actuals / forecast_delete_actuals",
}
#: Composite keys: table -> key columns, in record_id order.
COMPOSITE_KEYS = {"bom": ("bom_id", "version", "bom_line"), "router_operations": ("router_id", "sequence")}

Table = Annotated[str, Field(description="Table name (see forecast_list_tables)")]
RecordId = Annotated[Optional[str], Field(description=(
    "Primary key value. Composite keys: bom => 'bom_id-version-bom_line' (e.g. 'BOM-R15-1.0-3'), "
    "router_operations => 'router_id-sequence' (e.g. 'RT-R15-40'). Or pass key instead."))]
Key = Annotated[Optional[Dict[str, Any]], Field(description=(
    "Structured key instead of record_id (safer for ids that contain '-'): bom => {bom_id, version, bom_line}, "
    "router_operations => {router_id, sequence}, other tables => {<primary key column>: value}."))]


def _check_table(table: str) -> str:
    table = require(table, "table")
    if table not in TABLES:
        raise ToolError(f"Unknown table '{table}'. Known tables: {', '.join(TABLES)}")
    return table


def _check_writable(table: str) -> str:
    table = _check_table(table)
    if table not in WRITABLE:
        raise ToolError(f"Table '{table}' is not written with the generic record tools; use "
                        f"{DEDICATED_TOOLS.get(table, 'its dedicated tools')} so derived data stays consistent")
    return table


def _db_read(sql: str, params: Tuple[Any, ...] = ()) -> List[Tuple[Any, ...]]:
    conn = dbmod.db_manager.get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(sql, params)
        return cursor.fetchall()
    finally:
        dbmod.db_manager.close_connection(conn)


def _columns(table: str) -> List[str]:
    return [row[1] for row in _db_read(f"PRAGMA table_info({table})")]


def _unknown_columns(table: str, data: Dict[str, Any]) -> None:
    columns = _columns(table)
    unknown = [k for k in data if k not in columns]
    if unknown:
        raise ToolError(f"Unknown column(s) for {table}: {', '.join(unknown)}. Columns: {', '.join(columns)}. "
                        f"Nothing was written.")


def _is_int(value: Any) -> bool:
    try:
        return float(str(value).strip()).is_integer()
    except (TypeError, ValueError):
        return False


def _resolve_key(table: str, record_id: Optional[str], key: Optional[Dict[str, Any]]) -> Tuple[str, Dict[str, Any]]:
    """(record_id the API expects, {key column: value}) for one row."""
    if key and record_id:
        raise ToolError("Give record_id or key, not both")
    if table in COMPOSITE_KEYS:
        cols = COMPOSITE_KEYS[table]
        fmt = "-".join(cols)
        if key:
            missing = [c for c in cols if key.get(c) in (None, "")]
            extra = [c for c in key if c not in cols]
            if missing or extra:
                raise ToolError(f"key for {table} must be {{{', '.join(cols)}}}" +
                                (f"; missing {', '.join(missing)}" if missing else "") +
                                (f"; unexpected {', '.join(extra)}" if extra else ""))
            where = {c: key[c] for c in cols}
        else:
            rid = require(record_id, "record_id or key")
            parts = rid.rsplit("-", len(cols) - 1)
            if len(parts) != len(cols) or not all(p.strip() for p in parts):
                hint = (" To change every line of a BOM use forecast_adjust_material_costs (bom_ids=[...]) or "
                        "re-import it." if table == "bom" else "")
                raise ToolError(f"record_id '{rid}' is not a full {table} key '{fmt}' (or pass key={{...}}). "
                                f"Nothing was changed.{hint}")
            where = dict(zip(cols, parts))
        last = cols[-1]
        if not _is_int(where[last]):
            raise ToolError(f"{last} must be a whole number, got '{where[last]}' (key format '{fmt}')")
        where[last] = int(float(str(where[last]).strip()))
        api_id = "-".join(str(where[c]) for c in cols)
        return api_id, where
    pk = TABLES[table]["key"]
    if key:
        if list(key) != [pk]:
            raise ToolError(f"key for {table} must be {{'{pk}': value}}")
        value = key[pk]
    else:
        value = require(record_id, "record_id or key")
    value = require(None if value is None else str(value), pk)
    return value, {pk: value}


def _fetch_row(table: str, where: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    clause = " AND ".join(f"{c} = ?" for c in where)
    conn = dbmod.db_manager.get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(f"SELECT * FROM {table} WHERE {clause}", tuple(where.values()))
        row = cursor.fetchone()
        if row is None:
            return None
        return dict(zip([d[0] for d in cursor.description], row))
    finally:
        dbmod.db_manager.close_connection(conn)


def _as_number(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip().replace(",", "").replace("$", ""))
        except ValueError:
            return None
    return None


def _same(a: Any, b: Any) -> bool:
    """Equal as stored values: 1 == 1.0 == '1' == '$1.00'; text compared trimmed."""
    if a == b:
        return True
    na, nb = _as_number(a), _as_number(b)
    if na is not None and nb is not None:
        return abs(na - nb) <= 1e-9 * max(1.0, abs(na))
    return str(a).strip() == str(b).strip()


def _derive_material_cost(values: Dict[str, Any], current: Optional[Dict[str, Any]] = None) -> Optional[float]:
    """material_cost = qty x unit_price for a BOM line whose qty or price is set."""
    if "material_cost" in values or not ({"qty", "unit_price"} & set(values)):
        return None
    merged = {**(current or {}), **values}
    try:
        return round(float(merged.get("qty")) * float(merged.get("unit_price")), 4)
    except (TypeError, ValueError):
        return None


@mcp.tool(name="forecast_list_tables", annotations=READ)
async def list_tables() -> Dict[str, Any]:
    """Catalog of the model's tables with their row counts, primary key format
    (needed by forecast_update_record / forecast_delete_record), whether the
    generic record tools may write them, and what each holds. Use
    forecast_query_table or forecast_sql_query to read them."""
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
            entry = {"table": name, "rows": count, "record_id_format": info["key"], "columns": columns,
                     "about": info["about"]}
            if name not in WRITABLE:
                entry["write_with"] = DEDICATED_TOOLS.get(name)
            tables.append(entry)
    finally:
        dbmod.db_manager.close_connection(conn)
    return {"tables": tables}


@mcp.tool(name="forecast_query_table", annotations=READ)
async def query_table(
    table: Table,
    forecast_id: Annotated[Optional[str], Field(description="Scenario scope: sales rows of this scenario; other tables include company-wide (NULL) rows too")] = None,
    filters: Annotated[Optional[Dict[str, Any]], Field(description="Equality filters, e.g. {\"customer_id\": \"C001\"}")] = None,
    limit: Annotated[int, Field(ge=1, le=2000)] = 100,
    offset: Annotated[int, Field(ge=0)] = 0,
    layout: Layout = "table",
) -> Dict[str, Any]:
    """Read rows from any model table with optional scenario scope and equality
    filters. For ranges, joins or aggregates use forecast_sql_query."""
    table = _check_table(table)
    if filters:
        _unknown_columns(table, filters)
    params: Dict[str, Any] = {"forecast_id": forecast_id, "limit": limit, "offset": offset}
    for key, value in (filters or {}).items():
        if value is not None:
            params[key] = value
    body = await call("GET", f"/data/{table}", params=params)
    rows = body.get("items") if "items" in body else body.get("data", [])
    rows = rows or []
    columns = body.get("columns") or (list(rows[0]) if rows else _columns(table))
    out = {
        "table": table,
        "columns": columns,
        "rows": as_table(rows, columns)["rows"] if layout == "table" else rows,
        "returned": len(rows),
        "offset": offset,
        "has_more": len(rows) == limit,
        "next_offset": offset + limit if len(rows) == limit else None,
    }
    if layout != "table":
        out.pop("columns")
    return out


@mcp.tool(name="forecast_create_record", annotations=WRITE)
async def create_record(
    table: Annotated[str, Field(description="One of " + ", ".join(WRITABLE))],
    data: Annotated[Dict[str, Any], Field(description="Column values including the primary key, e.g. {\"customer_id\": \"C010\", \"customer_name\": \"Acme\"}")],
) -> Dict[str, Any]:
    """Insert one row into a master-data table (customers, units, bom,
    bom_definitions, router_definitions, router_operations, machines,
    labor_rates, expense_categories). The primary key is required (bom:
    bom_id + version + bom_line; router_operations: router_id + sequence +
    machine_id); unknown columns are an error. For a bom line given qty and
    unit_price, material_cost is set to qty x unit_price. Load order matters
    (foreign keys): labor_rates and machines before router_operations,
    router_definitions before router_operations, bom_definitions before bom.
    For many rows use the bulk import tools instead of one call per row."""
    table = _check_writable(table)
    if not data:
        raise ToolError("data must contain at least one column")
    _unknown_columns(table, data)
    required = list(COMPOSITE_KEYS.get(table, (TABLES[table]["key"],)))
    if table == "router_operations":
        required.append("machine_id")
    missing = [c for c in required if data.get(c) in (None, "") or (isinstance(data.get(c), str) and not data[c].strip())]
    if missing:
        raise ToolError(f"{table} rows need {', '.join(required)}; missing {', '.join(missing)}. Nothing was written.")
    data = dict(data)
    derived = _derive_material_cost(data) if table == "bom" else None
    if derived is not None:
        data["material_cost"] = derived
    result = await call("POST", "/forecast/create", json={"table": table, "data": data})
    if derived is not None:
        result["derived"] = {"material_cost": derived}
    return result


@mcp.tool(name="forecast_update_record", annotations=UPSERT)
async def update_record(
    table: Annotated[str, Field(description="One of " + ", ".join(WRITABLE))],
    updates: Annotated[Dict[str, Any], Field(description="Columns to change, e.g. {\"base_price\": 120}")],
    record_id: RecordId = None,
    key: Key = None,
) -> Dict[str, Any]:
    """Update columns of ONE row in a master-data table, identified by
    record_id or key. The row must exist, unknown columns are an error, and
    the change is read back: if the row did not change the tool fails
    instead of reporting success. A bom record_id must be the full
    'bom_id-version-bom_line' (an id without the line is refused, never
    applied to every line). Changing a bom line's qty or unit_price also
    sets material_cost = qty x unit_price. To re-price many BOM lines use
    forecast_adjust_material_costs."""
    table = _check_writable(table)
    if not updates:
        raise ToolError("updates must contain at least one column")
    _unknown_columns(table, updates)
    api_id, where = _resolve_key(table, record_id, key)
    current = _fetch_row(table, where)
    if current is None:
        raise ToolError(f"No {table} row with {where}; nothing was changed. Find ids with forecast_query_table.")
    updates = dict(updates)
    derived = _derive_material_cost(updates, current) if table == "bom" else None
    if derived is not None:
        updates["material_cost"] = derived
    result = await call("POST", "/forecast/update", json={"table": table, "id": api_id, "updates": updates})
    after = _fetch_row(table, {c: updates.get(c, v) for c, v in where.items()}) or _fetch_row(table, where)
    if after is None:
        result["note"] = "The row could not be read back (its key changed); check it with forecast_query_table"
        return result
    # Read back the columns the caller set. A column counts as NOT applied only when it still
    # holds its old value and that is not the requested one (the API may normalise '1' -> '1.0'
    # or '$1,050' -> 1050, and rounds a derived material_cost).
    unchanged = [c for c, v in updates.items()
                 if not (derived is not None and c == "material_cost")
                 and not _same(after.get(c), v) and _same(after.get(c), current.get(c))]
    if unchanged:
        raise ToolError(f"The API answered '{result.get('message')}' but {table} row {where} does not show the new "
                        f"value(s) for {', '.join(unchanged)}. Treat the update as NOT applied"
                        + (" (router ids containing '-' are not editable through this API yet; re-import the "
                           "routing instead)" if table == "router_operations" and "-" in str(where.get("router_id")) else "")
                        + ".")
    result["row"] = {c: after.get(c) for c in (*where, *updates)}
    if derived is not None:
        result["derived"] = {"material_cost": derived}
    return result


@mcp.tool(name="forecast_delete_record", annotations=DESTRUCTIVE)
async def delete_record(
    table: Annotated[str, Field(description="One of " + ", ".join(WRITABLE))],
    record_id: RecordId = None,
    key: Key = None,
    cascade: Annotated[bool, Field(description="For customers / units: also delete their sales rows")] = False,
    forecast_id: Annotated[Optional[str], Field(description="With cascade, limit the sales deletion to this scenario")] = None,
) -> Dict[str, Any]:
    """Delete ONE row from a master-data table, identified by record_id or
    key (a bom row needs the full 'bom_id-version-bom_line'). Deleting a
    customer or product that still has sales rows fails unless cascade is
    true."""
    table = _check_writable(table)
    api_id, where = _resolve_key(table, record_id, key)
    if _fetch_row(table, where) is None:
        raise ToolError(f"No {table} row with {where}; nothing was deleted. Find ids with forecast_query_table.")
    return await call("DELETE", f"/forecast/delete/{table}/{api_id}",
                      params={"cascade": cascade, "forecast_id": forecast_id})


async def _import_records(table: str, rows: List[Dict[str, Any]], merge_strategy: str, dry_run: bool,
                          allow_partial: bool) -> Dict[str, Any]:
    """Shared body of the customer / product imports: POST /import/records,
    validated with a dry run first so a bad row means nothing is written."""
    from api.import_routes import RECORD_TABLES

    if merge_strategy == "create_new":
        raise ToolError("merge_strategy 'create_new' is no longer supported: omit the id column to get a generated "
                        "id, or use 'update' to change an existing record")
    if merge_strategy not in ("skip", "update"):
        raise ToolError("merge_strategy must be skip (leave existing ids alone) or update (change only the "
                        "fields given)")
    fields = tuple(RECORD_TABLES[table]["fields"].fields)
    check_row_keys(rows, fields)
    mode = "upsert" if merge_strategy == "update" else "skip"
    payload = {"table": table, "rows": rows, "mode": mode}
    preview = await call("POST", "/import/records", json={**payload, "dry_run": True})
    errors = preview.get("errors") or []
    if errors and not (dry_run or allow_partial):
        raise ToolError(f"{len(errors)} row(s) failed validation, nothing written (rows are 1-based): "
                        f"{format_row_errors(errors)}")
    result = preview if dry_run else await call("POST", "/import/records", json={**payload, "dry_run": False})
    records = result.get("records") or []
    key = RECORD_TABLES[table]["key"]
    out = {k: v for k, v in result.items() if k not in ("records", "errors", "kind")}
    out["merge_strategy"] = merge_strategy
    created = [r.get(key) for r in records if r.get("action") == "created"]
    updated = [{"id": r.get(key), "fields": r.get("fields")} for r in records if r.get("action") == "updated"]
    out["created_ids"] = created[:100]
    out["updated_records"] = updated[:100]
    out.update(error_list(result.get("errors") or []))
    return out


@mcp.tool(name="forecast_import_customers", annotations=WRITE)
async def import_customers(
    customers: Annotated[List[Dict[str, Any]], Field(description=(
        "Rows of {customer_id?, customer_name, customer_type?, region?}. customer_type (e.g. Dealer, Distributor, "
        "Direct, Retail Chain) drives customer-type prices and deductions. A row without customer_id gets the next "
        "CUST-### id, or matches an existing customer by name."), min_length=1)],
    merge_strategy: Annotated[str, Field(description="skip: leave existing customers alone; update: change ONLY the fields "
                                                     "given on existing customers (omitted fields keep their values)")] = "skip",
    dry_run: Annotated[bool, Field(description="Validate and report without writing")] = False,
    allow_partial: Annotated[bool, Field(description="Write the valid rows even when some rows fail (default: all-or-nothing)")] = False,
) -> Dict[str, Any]:
    """Bulk create or update customers. All-or-nothing by default: a row
    error (e.g. no name for a new customer) means nothing is written.
    Returns created / updated / skipped counts, the new ids and, for
    updates, which fields changed."""
    return await _import_records("customers", customers, merge_strategy, dry_run, allow_partial)


@mcp.tool(name="forecast_import_products", annotations=WRITE)
async def import_products(
    products: Annotated[List[Dict[str, Any]], Field(description=(
        "Rows of {unit_id?, unit_name, unit_description?, base_price? (list price / MSRP), unit_type?, bom_id?, "
        "bom_version?, router_id?, router_version?}. bom_version / router_version are version strings such as "
        "'1.0' ('1' is stored as '1.0'); new products default to '1.0'. A row without unit_id gets the next "
        "PROD-### id, or matches an existing product by name."), min_length=1)],
    merge_strategy: Annotated[str, Field(description="skip: leave existing products alone; update: change ONLY the fields "
                                                     "given (an update without bom_id keeps the product's BOM link)")] = "skip",
    dry_run: Annotated[bool, Field(description="Validate and report without writing")] = False,
    allow_partial: Annotated[bool, Field(description="Write the valid rows even when some rows fail (default: all-or-nothing)")] = False,
) -> Dict[str, Any]:
    """Bulk create or update products (units) with their BOM and routing
    links. All-or-nothing by default. Warnings name products whose BOM or
    routing has no lines yet (load them next, then check costs with
    forecast_unit_cost_preview)."""
    return await _import_records("units", products, merge_strategy, dry_run, allow_partial)


_FORBIDDEN = re.compile(r"\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex)\b", re.I)


@mcp.tool(name="forecast_sql_query", annotations=READ)
async def sql_query(
    sql: Annotated[str, Field(description="A single SELECT (or WITH ... SELECT) statement over the model tables")],
    limit: Annotated[int, Field(description="Max rows returned", ge=1, le=5000)] = 200,
    layout: Layout = "table",
) -> Dict[str, Any]:
    """Run a read-only SQL query against the model database (SQLite). Use it
    for joins, ranges and aggregates the typed tools do not offer. Prefer
    GROUP BY aggregates over raw rows to keep the result small. Writes are
    rejected; use the write tools."""
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
        dbmod.db_manager.close_connection(conn)  # a fresh connection per call, so query_only ends here
    truncated = len(rows) > limit
    rows = rows[:limit]
    return {
        "columns": columns,
        "rows": [list(row) for row in rows] if layout == "table" else [dict(zip(columns, row)) for row in rows],
        "returned": len(rows),
        "truncated": truncated,
    }
