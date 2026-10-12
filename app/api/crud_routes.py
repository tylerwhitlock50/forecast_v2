from fastapi import APIRouter, HTTPException, Query
from typing import Optional, Dict, Any, List, Tuple
from db import get_forecast_data, get_saved_forecast_results
from db.models import ForecastResponse, SQLApplyRequest
from db import execute_sql
from api.import_routes import normalize_version
from utils.period_normalizer import normalize_month
from utils.data_loader import (
    ColumnValueError,
    coerce_numeric,
    derive_bom_costs,
    describe_references,
    is_blank,
    missing_references,
    next_bom_line,
    parse_number,
    referencing_rows,
    sales_period_error,
    summarize_errors,
    sync_bom_header,
    table_exists,
    table_info,
    version_sort_key,
)
import uuid
import sqlite3
from datetime import datetime

router = APIRouter(prefix="/forecast", tags=["forecast"])

# Tables whose rows are addressed by more than one column. Record ids are
# 'bom_id-version-bom_line' and 'router_id-sequence', parsed from the right
# so ids containing '-' work; a {key: {...}} object in the body (or the key
# columns as query parameters on delete) is always unambiguous.
COMPOSITE_KEYS: Dict[str, Tuple[str, ...]] = {
    "bom": ("bom_id", "version", "bom_line"),
    "router_operations": ("router_id", "sequence"),
}
# Key column for tables created without a declared primary key.
_FALLBACK_KEYS = {
    "sales": "sale_id", "customers": "customer_id", "units": "unit_id", "machines": "machine_id",
    "payroll": "employee_id", "labor_rates": "rate_id", "routers": "router_id",
    "router_definitions": "router_id", "router_operations": "operation_id",
}
_BULK_OPERATIONS = ("add", "subtract", "replace")


@router.get("", response_model=ForecastResponse)
async def get_forecast(forecast_id: Optional[str] = Query(None, description="Filter by forecast ID")):
    """
    Legacy read-only forecast view: sales joined with customers / products
    and a per-row cost estimate from utils.cost_rollup (forecast_results).
    Nothing is written. The statements engine (/reporting/*) is the source of
    truth for reporting.
    """
    result = get_forecast_data(forecast_id=forecast_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["error"])

    return ForecastResponse(
        status="success",
        data=result["data"]
    )

@router.get("/scenarios", response_model=ForecastResponse)
async def get_forecast_scenarios():
    """
    Get all available forecast scenarios
    """
    conn = None
    try:
        from db.database import db_manager

        conn = db_manager.get_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM forecast ORDER BY name")
        forecasts = cursor.fetchall()

        # Convert to dictionaries
        columns = [description[0] for description in cursor.description]
        forecast_list = [dict(zip(columns, row)) for row in forecasts]

        db_manager.close_connection(conn)

        return ForecastResponse(
            status="success",
            data={"scenarios": forecast_list},
            message=f"Retrieved {len(forecast_list)} forecast scenarios"
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving forecast scenarios: {str(e)}")
    finally:
        if conn is not None:
            conn.close()

@router.post("/scenario", response_model=ForecastResponse)
async def create_forecast_scenario(scenario_data: Dict[str, Any]):
    """
    Create a new forecast scenario with auto-generated FXXX ID
    """
    conn = None
    try:
        from db.database import db_manager

        conn = db_manager.get_connection()
        cursor = conn.cursor()

        # Get the next available FXXX ID
        cursor.execute("SELECT forecast_id FROM forecast WHERE forecast_id LIKE 'F%' ORDER BY forecast_id DESC LIMIT 1")
        last_forecast = cursor.fetchone()

        if last_forecast:
            # Extract the number from the last forecast_id (e.g., "F003" -> 3)
            last_number = int(last_forecast[0][1:])
            next_number = last_number + 1
        else:
            next_number = 1

        # Generate new forecast_id with FXXX format
        forecast_id = f"F{next_number:03d}"  # F001, F002, F003, etc.

        name = scenario_data.get('name', 'New Scenario')
        description = scenario_data.get('description', '')

        cursor.execute("""
            INSERT INTO forecast (forecast_id, name, description)
            VALUES (?, ?, ?)
        """, (forecast_id, name, description))

        conn.commit()
        db_manager.close_connection(conn)

        return ForecastResponse(
            status="success",
            data={"forecast_id": forecast_id, "name": name, "description": description},
            message=f"Forecast scenario {forecast_id} created successfully"
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating forecast scenario: {str(e)}")
    finally:
        if conn is not None:
            conn.close()


def _text(value: Any) -> Optional[str]:
    if is_blank(value):
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip()


def _validate_bulk_rows(cursor, forecasts: List[Any]) -> Tuple[List[Tuple[int, Dict[str, Any]]], List[Dict[str, Any]]]:
    """
    Check every bulk_update row before anything is written: ids present and
    known, period a month, numbers numeric. Returns (rows, errors) with
    1-based row numbers.
    """
    rows: List[Tuple[int, Dict[str, Any]]] = []
    errors: List[Dict[str, Any]] = []
    known: Dict[str, set] = {}
    for table, column in (("forecast", "forecast_id"), ("customers", "customer_id"), ("units", "unit_id")):
        cursor.execute(f"SELECT {column} FROM {table}")
        known[column] = {r[0] for r in cursor.fetchall()}
    for index, item in enumerate(forecasts, start=1):
        if not isinstance(item, dict):
            errors.append({"row": index, "error": "each forecast must be an object"})
            continue
        problems: List[str] = []
        values: Dict[str, Any] = {}
        for column, label in (("forecast_id", "scenario"), ("customer_id", "customer"), ("unit_id", "product")):
            value = _text(item.get(column))
            if value is None:
                problems.append(f"{column} is required")
            elif value not in known[column]:
                problems.append(f"unknown {label} {column} '{value}'")
            values[column] = value
        period_problem = sales_period_error(item.get("period"))
        if period_problem:
            problems.append(period_problem)
        else:
            values["period"] = normalize_month(item.get("period"))
        for column in ("quantity", "unit_price", "total_revenue"):
            try:
                values[column] = parse_number(item.get(column), column)
            except ColumnValueError as exc:
                problems.append(str(exc))
        if problems:
            errors.append({"row": index, "error": "; ".join(problems)})
        else:
            rows.append((index, values))
    return rows, errors


@router.post("/bulk_update", response_model=ForecastResponse)
async def bulk_update_forecast(bulk_data: Dict[str, Any]):
    """
    Bulk edit sales rows (revenue matrix, MCP forecast_upsert_sales).

    Body: ``{forecasts: [{forecast_id, customer_id, unit_id, period, quantity,
    unit_price, total_revenue?}], operation: 'replace'|'add'|'subtract'}``.
    A row matching (scenario, customer, product, period) is updated
    (``replace`` sets quantity and price, ``add`` / ``subtract`` change the
    quantity; a missing quantity or price keeps the stored one) and its
    total_revenue becomes quantity x unit_price. A new row is inserted with
    total_revenue as given, else quantity x unit_price; ``subtract`` never
    creates a row (such rows are listed in ``skipped``,
    which is present only when not empty).

    Periods must be months: YYYY-MM, YYYY-MM-DD, 1/2027, Jan-27 ... are
    accepted; quarters / weeks are rejected. Every row is validated first
    (known scenario / customer / product ids, numeric values); any problem is
    a 422 listing each bad row and nothing is written. The whole batch is one
    transaction.
    """
    forecasts = bulk_data.get('forecasts', [])
    operation = bulk_data.get('operation', 'replace')  # Default to replace
    if not forecasts or not isinstance(forecasts, list):
        raise HTTPException(status_code=400, detail="No forecast data provided")
    if operation not in _BULK_OPERATIONS:
        raise HTTPException(status_code=422, detail=f"operation must be one of {', '.join(_BULK_OPERATIONS)}")

    from db.database import db_manager
    conn = None
    try:
        conn = db_manager.get_connection()
        cursor = conn.cursor()

        rows, errors = _validate_bulk_rows(cursor, forecasts)
        if errors:
            raise HTTPException(
                status_code=422,
                detail=f"{len(errors)} of {len(forecasts)} row(s) rejected, nothing saved: {summarize_errors(errors)}",
            )

        created = updated = 0
        skipped: List[Dict[str, Any]] = []
        for index, row in rows:
            key = (row['customer_id'], row['unit_id'], row['period'], row['forecast_id'])
            quantity, price = row['quantity'], row['unit_price']
            cursor.execute("""
                SELECT quantity, unit_price
                FROM sales
                WHERE customer_id = ? AND unit_id = ? AND period = ? AND forecast_id = ?
            """, key)
            existing_record = cursor.fetchone()

            if existing_record:
                existing_quantity = existing_record[0] or 0
                existing_price = existing_record[1] or 0
                if operation == 'add':
                    new_quantity = existing_quantity + (quantity or 0)
                    new_price = existing_price if price is None else price
                elif operation == 'subtract':
                    new_quantity = max(0, existing_quantity - (quantity or 0))
                    new_price = existing_price
                else:  # replace
                    new_quantity = existing_quantity if quantity is None else quantity
                    new_price = existing_price if price is None else price
                cursor.execute("""
                    UPDATE sales SET quantity = ?, unit_price = ?, total_revenue = ?
                    WHERE customer_id = ? AND unit_id = ? AND period = ? AND forecast_id = ?
                """, (new_quantity, new_price, new_quantity * new_price, *key))
                updated += 1
            elif operation == 'subtract':
                skipped.append({"row": index, "customer_id": key[0], "unit_id": key[1], "period": key[2],
                                "reason": "no existing row to subtract from"})
            else:
                quantity = quantity or 0
                price = price or 0
                revenue = row['total_revenue'] if row['total_revenue'] is not None else quantity * price
                cursor.execute("""
                    INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (str(uuid.uuid4()), key[0], key[1], key[2], quantity, price, revenue, key[3]))
                created += 1

        conn.commit()
        updated_count = created + updated
        message = f"Bulk updated {updated_count} forecast records using {operation} operation"
        if skipped:
            message += f" ({len(skipped)} skipped: nothing to subtract from)"
        data = {"updated_count": updated_count, "created": created, "updated": updated}
        if skipped:
            data["skipped"] = skipped
        return ForecastResponse(status="success", data=data, message=message)

    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error bulk updating forecast: {str(e)}")
    finally:
        if conn:
            db_manager.close_connection(conn)

@router.get("/results", response_model=ForecastResponse)
async def get_saved_forecast_results_endpoint(
    period: Optional[str] = Query(None, description="Filter by period (e.g., '2024-01')"),
    limit: Optional[int] = Query(None, description="Limit number of results"),
    forecast_id: Optional[str] = Query(None, description="Limit to one scenario"),
):
    """
    Per-sales-row cost and margin estimate, computed on request (read-only).
    """
    result = get_saved_forecast_results(period=period, limit=limit, forecast_id=forecast_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["error"])

    return ForecastResponse(
        status="success",
        data={
            "results": result["data"],
            "columns": result.get("columns"),
            "summary": result.get("summary"),
        },
        message=f"Retrieved {len(result['data'])} forecast results"
    )


# ---------------------------------------------------------------------------
# Generic record create / update / delete helpers
# ---------------------------------------------------------------------------

def _table_columns(cursor, table_name: Any) -> List[Tuple]:
    """PRAGMA table_info rows of an existing table; 400 for any other name (names are interpolated into SQL)."""
    if not isinstance(table_name, str) or not table_name or not table_exists(cursor, table_name):
        raise HTTPException(status_code=400, detail=f"Unknown table '{table_name}'")
    return table_info(cursor, table_name)


def _primary_key(table_name: str, columns: List[Tuple]) -> str:
    pk = [col[1] for col in sorted(columns, key=lambda c: c[5]) if col[5]]
    if pk:
        return pk[0]
    return _FALLBACK_KEYS.get(table_name, "id")


def _describe_key(key: Dict[str, Any]) -> str:
    return ", ".join(f"{k}={v!r}" for k, v in key.items())


def _resolve_key(cursor, table_name: str, columns: List[Tuple], record_id: Any,
                 key_fields: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    WHERE columns that address one row. Composite keys come from
    ``key_fields`` when given, else from the record id parsed from the right
    (the sequence / bom_line is the last segment; for a BOM the bom_id /
    version split that matches an existing line wins, so ids and versions
    containing '-' work). A numeric router_operations id is the operation_id.
    """
    names = COMPOSITE_KEYS.get(table_name)
    if names:
        if key_fields:
            missing = [n for n in names if is_blank(key_fields.get(n))]
            if missing:
                raise HTTPException(status_code=400, detail=f"key for {table_name} needs {', '.join(names)}; "
                                                            f"missing {', '.join(missing)}")
            key = {n: key_fields[n] for n in names}
            if table_name == "router_operations":
                key["sequence"] = _whole(key["sequence"], "sequence")
                return key
            key["bom_line"] = _whole(key["bom_line"], "bom_line")
            return _match_bom_line(cursor, [(str(key["bom_id"]), str(key["version"]))], key["bom_line"]) or key
        text = str(record_id if record_id is not None else "").strip()
        if table_name == "router_operations":
            if text.isdigit():
                return {"operation_id": int(text)}
            router_id, sep, sequence = text.rpartition("-")
            if not sep or not router_id or not sequence.isdigit():
                raise HTTPException(status_code=400, detail=(
                    f"Invalid router_operations record id '{text}'. Use router_id-sequence (e.g. RTG-BOLT-40), "
                    f"the operation_id, or key: {{router_id, sequence}}"))
            return {"router_id": router_id, "sequence": int(sequence)}
        prefix, sep, line = text.rpartition("-")
        splits = [(prefix[:i], prefix[i + 1:]) for i, ch in enumerate(prefix) if ch == "-"]
        splits = [(b, v) for b, v in splits if b and v]
        if not sep or not line.isdigit() or not splits:
            raise HTTPException(status_code=400, detail=(
                f"Invalid BOM line id '{text}'. Use bom_id-version-bom_line (e.g. BOM-001-1.0-1) or "
                f"key: {{bom_id, version, bom_line}}. To delete a whole BOM delete its bom_definitions "
                f"header with ?cascade=true"))
        match = _match_bom_line(cursor, list(reversed(splits)), int(line), text)
        if match:
            return match
        bom_id, version = splits[-1]  # conventional split; the caller reports 404 with it
        return {"bom_id": bom_id, "version": version, "bom_line": int(line)}
    if is_blank(record_id):
        raise HTTPException(status_code=400, detail="Record ID is required")
    return {_primary_key(table_name, columns): record_id}


def _match_bom_line(cursor, splits: List[Tuple[str, str]], bom_line: int,
                    record_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    The existing BOM line among candidate (bom_id, version) splits: exact
    versions first, then normalized ones ('1' finds '1.0'). 400 when two
    different lines match; None when none does.
    """
    for exact in (True, False):
        matches = []
        for bom_id, version in splits:
            wanted = version if exact else normalize_version(version)
            cursor.execute("SELECT version FROM bom WHERE bom_id = ? AND bom_line = ?", (bom_id, bom_line))
            matches += [{"bom_id": bom_id, "version": stored, "bom_line": bom_line}
                        for (stored,) in cursor.fetchall()
                        if (stored if exact else normalize_version(stored)) == wanted]
        if len(matches) > 1:
            raise HTTPException(status_code=400, detail=(
                f"BOM line id '{record_id or ''}' is ambiguous ({'; '.join(_describe_key(m) for m in matches)}); "
                f"pass key: {{bom_id, version, bom_line}}"))
        if matches:
            return matches[0]
    return None


def _whole(value: Any, column: str) -> int:
    try:
        number = parse_number(value, column)
    except ColumnValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if number is None or not float(number).is_integer():
        raise HTTPException(status_code=400, detail=f"{column} must be a whole number, got {value!r}")
    return int(number)


def _clean_values(table_name: str, columns: List[Tuple], values: Dict[str, Any]) -> Dict[str, Any]:
    """
    Values ready to store: numeric columns parsed ('$1,050.00', '19,200',
    '(5)', '5%'), BOM / product versions normalized ('1' -> '1.0'), blank
    product links stored as NULL, sales periods checked to be months.
    Raises ColumnValueError (-> 422 naming the column).
    """
    values = coerce_numeric(values, columns)
    if table_name in ("bom", "bom_definitions") and "version" in values:
        values["version"] = normalize_version(values["version"])
    if table_name == "units":
        for column in ("bom_version", "router_version"):
            if not is_blank(values.get(column)):
                values[column] = normalize_version(values[column])
        for column in ("bom_id", "router_id"):
            if column in values and is_blank(values[column]):
                values[column] = None
    if table_name == "sales" and "period" in values:
        problem = sales_period_error(values["period"])
        if problem:
            raise ColumnValueError("period", problem)
        values["period"] = normalize_month(values["period"])
    return values


def _prepare_sale(values: Dict[str, Any]) -> Dict[str, Any]:
    """A new sales row: ids and period required, total_revenue = quantity x unit_price when not given."""
    missing = [c for c in ("customer_id", "unit_id", "period") if is_blank(values.get(c))]
    if missing:
        raise HTTPException(status_code=422, detail=f"{', '.join(missing)} is required for a sales row")
    values = dict(values)
    values["sale_id"] = values.get("sale_id") or str(uuid.uuid4())
    if values.get("total_revenue") is None and values.get("quantity") is not None \
            and values.get("unit_price") is not None:
        values["total_revenue"] = values["quantity"] * values["unit_price"]
    return values


def _check_references(cursor, table_name: str, values: Dict[str, Any]) -> None:
    problems = missing_references(cursor, table_name, values)
    if problems:
        raise HTTPException(status_code=422, detail=f"Cannot save the {table_name} record: {'; '.join(problems)}")


def _integrity_error(table_name: str, values: Dict[str, Any], exc: sqlite3.IntegrityError) -> HTTPException:
    text = str(exc)
    if text.startswith("UNIQUE"):
        cols = [part.split(".", 1)[-1].strip() for part in text.split(":", 1)[-1].split(",")]
        key = ", ".join(f"{c}={values.get(c)!r}" for c in cols if c in values)
        return HTTPException(status_code=409, detail=f"A {table_name} record with {key or text} already exists")
    if text.startswith("NOT NULL"):
        return HTTPException(status_code=422, detail=f"{text.split('.', 1)[-1]} is required")
    return HTTPException(status_code=409, detail=f"Cannot save the {table_name} record: {text}")


def _insert(cursor, table_name: str, values: Dict[str, Any]) -> None:
    columns_str = ", ".join(values.keys())
    placeholders = ", ".join(["?" for _ in values])
    try:
        cursor.execute(f"INSERT INTO {table_name} ({columns_str}) VALUES ({placeholders})", list(values.values()))
    except sqlite3.IntegrityError as exc:
        raise _integrity_error(table_name, values, exc)


def _create_bom_header(cursor, values: Dict[str, Any]) -> Optional[str]:
    """
    A bom_definitions row for an existing bom_id is a new version of that BOM:
    the header moves to it when it is newer (the header shows one version;
    lines of every version stay in the bom table). Returns a message when it
    handled the request, None when the caller should insert.
    """
    bom_id = values.get("bom_id")
    if is_blank(bom_id):
        raise HTTPException(status_code=422, detail="bom_id is required")
    values["version"] = values.get("version") or "1.0"
    cursor.execute("SELECT version FROM bom_definitions WHERE bom_id = ?", (bom_id,))
    row = cursor.fetchone()
    if row is None:
        return None
    if version_sort_key(values["version"]) <= version_sort_key(row[0]):
        raise HTTPException(status_code=409, detail=(
            f"BOM {bom_id} already exists at version {row[0]}. Add lines of version {values['version']} to the "
            f"bom table, or create a newer version"))
    updates = {k: values[k] for k in ("bom_name", "bom_description") if not is_blank(values.get(k))}
    updates["version"] = values["version"]
    cursor.execute(
        f"UPDATE bom_definitions SET {', '.join(f'{k} = ?' for k in updates)}, updated_at = CURRENT_TIMESTAMP "
        f"WHERE bom_id = ?", [*updates.values(), bom_id])
    return f"BOM {bom_id} now shows version {values['version']} (was {row[0]}); lines of every version are kept"


@router.post("/create", response_model=ForecastResponse)
async def create_forecast_endpoint(forecast_data: Dict[str, Any]):
    """
    Create one record.

    * ``{sales: {...}}`` - a sales row; the period must be a month (YYYY-MM,
      2027-01-01, Jan-27 ...; quarters / weeks are rejected) and
      total_revenue defaults to quantity x unit_price.
    * ``{table, data}`` - any table. Unknown columns are ignored; numeric
      columns accept '$1,050.00' style text (422 naming the column when not a
      number); unknown references are a 422 naming them. BOM lines get
      material_cost = qty x unit_price, a normalized version ('1' -> '1.0'),
      the next bom_line when none is given and a bom_definitions header (moved
      to the newest version). A bom_definitions row for an existing BOM with
      a newer version moves the header to that version.

    Responds with ``data.record`` (the values stored).
    """
    conn = None
    try:
        from db.database import db_manager

        conn = db_manager.get_connection()
        cursor = conn.cursor()

        # Handle direct sales data from frontend
        if forecast_data.get('sales'):
            sales = forecast_data['sales']
            if not isinstance(sales, dict):
                raise HTTPException(status_code=400, detail="sales must be an object")
            columns = table_info(cursor, "sales")
            column_names = [col[1] for col in columns]
            values = {k: v for k, v in sales.items() if k in column_names}
            if is_blank(values.get('period')):
                raise HTTPException(status_code=422, detail="period is required (YYYY-MM)")
            try:
                values = _clean_values("sales", columns, values)
            except ColumnValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc))
            values = _prepare_sale(values)
            _check_references(cursor, "sales", values)
            _insert(cursor, "sales", values)
            conn.commit()

            return ForecastResponse(
                status="success",
                data={"table": "sales", "record": values},
                message="Sales data created successfully"
            )

        # Handle general table creation
        elif forecast_data.get('table') and forecast_data.get('data'):
            table_name = forecast_data['table']
            data = forecast_data['data']
            if not isinstance(data, dict):
                raise HTTPException(status_code=400, detail="data must be an object of column: value")

            columns = _table_columns(cursor, table_name)
            column_names = [col[1] for col in columns]

            # Filter data to only include valid columns
            valid_data = {k: v for k, v in data.items() if k in column_names}

            if not valid_data:
                raise HTTPException(status_code=400, detail=f"No valid columns found for table {table_name}")

            try:
                valid_data = _clean_values(table_name, columns, valid_data)
            except ColumnValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc))

            notes: List[str] = []
            if table_name == "bom":
                if is_blank(valid_data.get("bom_id")):
                    raise HTTPException(status_code=422, detail="bom_id is required")
                valid_data["version"] = valid_data.get("version") or "1.0"
                if valid_data.get("bom_line") is None:
                    valid_data["bom_line"] = next_bom_line(cursor, valid_data["bom_id"], valid_data["version"])
                if valid_data.get("qty") is None:
                    valid_data["qty"] = 1.0
                    notes.append("qty defaulted to 1")
                valid_data = derive_bom_costs(valid_data)
            elif table_name == "bom_definitions":
                handled = _create_bom_header(cursor, valid_data)
                if handled:
                    conn.commit()
                    return ForecastResponse(status="success", data={"table": table_name, "record": valid_data},
                                            message=handled)
            elif table_name == "sales":
                valid_data = _prepare_sale(valid_data)

            _check_references(cursor, table_name, valid_data)
            _insert(cursor, table_name, valid_data)
            if table_name == "bom":
                sync_bom_header(cursor, valid_data["bom_id"], valid_data["version"])

            conn.commit()

            return ForecastResponse(
                status="success",
                data={"table": table_name, "record": valid_data},
                message=f"Record created successfully in {table_name}" + (f" ({'; '.join(notes)})" if notes else "")
            )

        else:
            raise HTTPException(status_code=400, detail="Invalid or missing data structure")

    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error creating forecast: {str(e)}")
    finally:
        if conn:
            try:
                db_manager.close_connection(conn)
            except NameError:
                # db_manager import failed earlier; nothing to close
                pass

@router.post("/update", response_model=ForecastResponse)
async def update_forecast_endpoint(update_data: Dict[str, Any]):
    """
    Update one record: ``{table, id, updates}`` (or ``{table, key: {...},
    updates}`` for composite keys).

    Record ids: the primary key; ``bom_id-version-bom_line`` for BOM lines and
    ``router_id-sequence`` (or the numeric operation_id) for routing
    operations, parsed from the right so ids containing '-' work. A
    ``key`` object ({bom_id, version, bom_line} / {router_id, sequence}) is
    always unambiguous. 404 when no record matches. Only the given columns
    change; unknown columns are ignored and named in the message; numeric
    columns accept '$1,050.00' style text (422 naming the column otherwise).
    BOM lines keep material_cost = qty x unit_price; sales rows keep
    total_revenue = quantity x unit_price unless it is given.
    """
    conn = None
    try:
        from db.database import db_manager

        conn = db_manager.get_connection()
        cursor = conn.cursor()

        table_name = update_data.get('table')
        record_id = update_data.get('id')
        key_fields = update_data.get('key')
        updates = update_data.get('updates', {})

        if not table_name or (is_blank(record_id) and not key_fields):
            raise HTTPException(status_code=400, detail="Table name and record ID are required")
        if not isinstance(updates, dict):
            raise HTTPException(status_code=400, detail="updates must be an object of column: value")
        if key_fields is not None and not isinstance(key_fields, dict):
            raise HTTPException(status_code=400, detail="key must be an object of key column: value")

        columns = _table_columns(cursor, table_name)

        # Validate update columns and filter out unknown keys (be forgiving)
        column_names = [col[1] for col in columns]
        invalid_columns = [col for col in updates.keys() if col not in column_names]
        # Only keep valid columns in the update set
        updates = {k: v for k, v in updates.items() if k in column_names}
        if not updates:
            # No valid fields to update
            raise HTTPException(status_code=400, detail=f"No valid columns to update for table {table_name}. Valid columns: {column_names}")

        try:
            updates = _clean_values(table_name, columns, updates)
        except ColumnValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))

        key = _resolve_key(cursor, table_name, columns, record_id, key_fields)
        where = " AND ".join(f"{k} = ?" for k in key)
        cursor.execute(f"SELECT * FROM {table_name} WHERE {where}", list(key.values()))
        found = cursor.fetchone()
        if found is None:
            raise HTTPException(status_code=404, detail=f"No {table_name} record matches {_describe_key(key)}")
        current = dict(zip([d[0] for d in cursor.description], found))

        if table_name == "bom":
            if "version" in updates and normalize_version(current.get("version")) == updates["version"]:
                updates["version"] = current.get("version")  # same version written differently ('1' vs '1.0')
            if {"qty", "unit_price", "material_cost"} & set(updates):
                line = derive_bom_costs({**current, **updates})
                updates["unit_price"], updates["material_cost"] = line.get("unit_price"), line.get("material_cost")
        elif table_name == "sales" and {"quantity", "unit_price"} & set(updates) and "total_revenue" not in updates:
            merged = {**current, **updates}
            if merged.get("quantity") is not None and merged.get("unit_price") is not None:
                updates["total_revenue"] = merged["quantity"] * merged["unit_price"]

        merged = {**current, **updates}
        _check_references(cursor, table_name, {k: merged.get(k) for k in updates})
        set_clause = ", ".join([f"{k} = ?" for k in updates.keys()])
        try:
            cursor.execute(f"UPDATE {table_name} SET {set_clause} WHERE {where}",
                           list(updates.values()) + list(key.values()))
        except sqlite3.IntegrityError as exc:
            raise _integrity_error(table_name, merged, exc)
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"No {table_name} record matches {_describe_key(key)}")
        if table_name == "bom":
            sync_bom_header(cursor, merged["bom_id"], merged["version"])

        conn.commit()

        # Build a helpful message including ignored columns if any
        extra = f" (ignored unknown: {invalid_columns})" if invalid_columns else ""
        return ForecastResponse(
            status="success",
            data={"table": table_name, "key": key, "updated": cursor.rowcount, "changes": updates},
            message=f"Record updated successfully in {table_name}{extra}"
        )

    except HTTPException:
        # Preserve explicit HTTP errors (e.g., 400s) instead of masking as 500
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error updating forecast: {str(e)}")
    finally:
        if conn:
            db_manager.close_connection(conn)


def _list(items: List[Any], limit: int = 20) -> str:
    shown = ", ".join(str(i) for i in items[:limit])
    return shown + (f" and {len(items) - limit} more" if len(items) > limit else "")


def _delete_router_dependents(cursor, router_id: str, cascade: bool) -> Dict[str, Any]:
    """A routing's operations and the products using it: 409 naming them, or (cascade) delete / unlink them."""
    cursor.execute("SELECT sequence FROM router_operations WHERE router_id = ? ORDER BY sequence", (router_id,))
    sequences = [r[0] for r in cursor.fetchall()]
    cursor.execute("SELECT unit_id FROM units WHERE router_id = ? ORDER BY unit_id", (router_id,))
    products = [r[0] for r in cursor.fetchall()]
    if (sequences or products) and not cascade:
        parts = []
        if sequences:
            parts.append(f"has {len(sequences)} operation(s) (sequence {_list(sequences)})")
        if products:
            parts.append(f"is used by product(s) {_list(products)}")
        raise HTTPException(status_code=409, detail=(
            f"Routing {router_id} {' and '.join(parts)}. Delete with ?cascade=true to delete its operations"
            + (" and unlink those products (their labor and machine cost becomes $0)" if products else "")))
    if cascade:
        cursor.execute("DELETE FROM router_operations WHERE router_id = ?", (router_id,))
        cursor.execute("UPDATE units SET router_id = NULL WHERE router_id = ?", (router_id,))
    return {"deleted_operations": len(sequences) if cascade else 0, "unlinked_products": products if cascade else []}


def _delete_bom_dependents(cursor, bom_id: str, cascade: bool) -> Dict[str, Any]:
    """A BOM header's lines (every version) and the products using it: 409 naming the products, or cascade."""
    cursor.execute("SELECT unit_id FROM units WHERE bom_id = ? ORDER BY unit_id", (bom_id,))
    products = [r[0] for r in cursor.fetchall()]
    cursor.execute("SELECT COUNT(*) FROM bom WHERE bom_id = ?", (bom_id,))
    lines = cursor.fetchone()[0]
    if products and not cascade:
        raise HTTPException(status_code=409, detail=(
            f"BOM {bom_id} is used by product(s) {_list(products)}. Delete with ?cascade=true to delete its "
            f"{lines} line(s) (every version) and unlink those products (their material cost becomes $0)"))
    deleted = 0
    if cascade:
        cursor.execute("DELETE FROM bom WHERE bom_id = ?", (bom_id,))
        deleted = cursor.rowcount
        cursor.execute("UPDATE units SET bom_id = NULL WHERE bom_id = ?", (bom_id,))
    return {"deleted_lines": deleted, "unlinked_products": products if cascade else [],
            "remaining_lines": lines - deleted}


@router.delete("/delete/{table_name}/{record_id}", response_model=ForecastResponse)
async def delete_forecast_record(
    table_name: str,
    record_id: str,
    cascade: bool = Query(False, description="customers / units: also delete their sales (of forecast_id only, "
                                             "when given); router_definitions: delete its operations and unlink "
                                             "products; bom_definitions: delete its lines and unlink products"),
    forecast_id: Optional[str] = Query(None),
    bom_id: Optional[str] = Query(None, description="bom: key column (with version and bom_line)"),
    version: Optional[str] = Query(None, description="bom: key column"),
    bom_line: Optional[int] = Query(None, description="bom: key column"),
    router_id: Optional[str] = Query(None, description="router_operations: key column (with sequence)"),
    sequence: Optional[int] = Query(None, description="router_operations: key column"),
):
    """
    Delete a specific record.

    Composite ids as for /forecast/update (or pass the key columns as query
    parameters). A record still used elsewhere is a 409 naming what uses it
    (machines / labor rates: the routing operations; routings: operations and
    products; BOM headers: products) unless ``cascade`` applies.
    """
    if table_name == "forecast":
        # A scenario owns sales, rules, prices, assumptions and more; delete it
        # exactly as the Scenarios page does so nothing is orphaned and a base
        # scenario always remains.
        from api.forecast_routes import delete_forecast_scenario
        return await delete_forecast_scenario(record_id)

    conn = None
    try:
        from db.database import db_manager

        conn = db_manager.get_connection()
        cursor = conn.cursor()

        columns = _table_columns(cursor, table_name)
        query_key = {k: v for k, v in (("bom_id", bom_id), ("version", version), ("bom_line", bom_line),
                                       ("router_id", router_id), ("sequence", sequence)) if v is not None}
        key = _resolve_key(cursor, table_name, columns, record_id, query_key or None)
        where = " AND ".join(f"{k} = ?" for k in key)
        cursor.execute(f"SELECT COUNT(*) FROM {table_name} WHERE {where}", list(key.values()))
        if cursor.fetchone()[0] == 0:
            raise HTTPException(status_code=404, detail=f"No {table_name} record matches {_describe_key(key)}")

        details: Dict[str, Any] = {}
        if table_name == "router_definitions":
            details = _delete_router_dependents(cursor, record_id, cascade)
        elif table_name == "bom_definitions":
            details = _delete_bom_dependents(cursor, record_id, cascade)
        elif table_name in ("customers", "units"):
            # forecast_results is a derived cache; stale rows must not block the delete
            column = "customer_id" if table_name == "customers" else "unit_id"
            cursor.execute(f"DELETE FROM forecast_results WHERE {column} = ?", (record_id,))
            if cascade:
                if forecast_id:
                    cursor.execute(f"DELETE FROM sales WHERE {column} = ? AND forecast_id = ?", (record_id, forecast_id))
                else:
                    cursor.execute(f"DELETE FROM sales WHERE {column} = ?", (record_id,))
                details["deleted_sales"] = cursor.rowcount

        if table_name not in COMPOSITE_KEYS:
            refs = referencing_rows(cursor, table_name, record_id, next(iter(key)))
            if refs:
                detail = f"Cannot delete {table_name} '{record_id}': it is still used by {describe_references(refs)}."
                if table_name in ("customers", "units") and cascade and forecast_id:
                    detail += (f" Its sales in scenarios other than {forecast_id} remain; use ?cascade=true without "
                               f"forecast_id to delete its sales in every scenario.")
                elif table_name in ("customers", "units"):
                    detail += (" Use ?cascade=true to delete its sales (add &forecast_id=FXXX to limit that to one "
                               "scenario).")
                elif table_name in ("machines", "labor_rates"):
                    detail += " Point those routing operations at another one, or delete them, first."
                raise HTTPException(status_code=409, detail=detail)

        try:
            cursor.execute(f"DELETE FROM {table_name} WHERE {where}", list(key.values()))
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail=f"Cannot delete from {table_name}: dependent rows exist ({exc})")
        rows_affected = cursor.rowcount
        if rows_affected == 0:
            raise HTTPException(status_code=404, detail=f"No {table_name} record matches {_describe_key(key)}")

        conn.commit()

        message = f"Record deleted successfully from {table_name}"
        if details.get("remaining_lines"):
            message += (f"; {details['remaining_lines']} line(s) of BOM {record_id} are still in the bom table "
                        f"(delete them, or use ?cascade=true)")
        return ForecastResponse(
            status="success",
            data={"table": table_name, "key": key, "deleted": rows_affected, **details},
            message=message
        )

    except HTTPException:
        if conn:
            conn.rollback()
        raise
    except Exception as e:
        if conn:
            conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error deleting record: {str(e)}")
    finally:
        if conn:
            db_manager.close_connection(conn)

@router.get("/bom_definitions", response_model=ForecastResponse)
async def get_bom_definitions():
    """Get all BOM definitions for the frontend"""
    conn = None
    try:
        from db.database import db_manager

        conn = db_manager.get_connection()
        cursor = conn.cursor()

        # Check if bom_definitions table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='bom_definitions'")
        if cursor.fetchone():
            cursor.execute("""
                SELECT bom_id, bom_name, bom_description, version, created_at
                FROM bom_definitions
                ORDER BY bom_id
            """)
            bom_data = cursor.fetchall()
            columns = [description[0] for description in cursor.description]
            bom_list = [dict(zip(columns, row)) for row in bom_data]
        else:
            # Return empty list if table doesn't exist
            bom_list = []

        return ForecastResponse(
            status="success",
            data={"bom_definitions": bom_list},
            message=f"Retrieved {len(bom_list)} BOM definitions"
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving BOM definitions: {str(e)}")
    finally:
        if conn:
            db_manager.close_connection(conn)
