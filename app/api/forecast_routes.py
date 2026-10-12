from fastapi import APIRouter, HTTPException, Query
from typing import Optional, Dict, Any, List, Sequence, Tuple
from db import get_forecast_data, get_saved_forecast_results
from db.models import ForecastResponse, SQLApplyRequest
from db import execute_sql
from utils.period_normalizer import normalize_period
import re
import uuid
import sqlite3
from datetime import datetime

router = APIRouter(prefix="/forecast", tags=["forecast"])

@router.get("", response_model=ForecastResponse)
async def get_forecast(forecast_id: Optional[str] = Query(None, description="Filter by forecast ID")):
    """
    Legacy read-only forecast view: sales joined with customers / products and
    a per-row cost estimate from utils.cost_rollup (forecast_results), limited
    to forecast_id when given. Nothing is written.
    """
    result = get_forecast_data(forecast_id=forecast_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["error"])
    
    return ForecastResponse(
        status="success",
        data=result["data"]
    )

# ---------------------------------------------------------------------------
# Scenarios
#
# A scenario is a row in `forecast`. Sales always belong to exactly one
# scenario. Payroll, expenses and capex rows carry a forecast_id or NULL;
# NULL means company-wide and is included in every scenario by the
# statements engine (see services.financial_statements._scope_clause).
# ---------------------------------------------------------------------------

SCENARIO_TABLES = (
    "sales", "expenses", "payroll", "capital_expenditures", "financial_assumptions",
    "sales_deduction_rules", "price_list",
)


def _next_forecast_id(cursor) -> str:
    """Next FXXX id. Non-F ids (e.g. test fixtures) are ignored for numbering."""
    cursor.execute("SELECT forecast_id FROM forecast WHERE forecast_id LIKE 'F%'")
    numbers = []
    for (fid,) in cursor.fetchall():
        try:
            numbers.append(int(str(fid)[1:]))
        except ValueError:
            continue
    return f"F{(max(numbers) + 1) if numbers else 1:03d}"


def _forecast_columns(cursor) -> List[str]:
    cursor.execute("PRAGMA table_info(forecast)")
    return [row[1] for row in cursor.fetchall()]


def _scenario_summary(cursor, forecast_id: str) -> Dict[str, Any]:
    """Row counts and the sales window for one scenario (used by the list and by delete confirmations)."""
    cursor.execute(
        """SELECT COUNT(*), COUNT(DISTINCT customer_id || '|' || unit_id), MIN(period), MAX(period),
                  COALESCE(SUM(total_revenue), 0)
           FROM sales WHERE forecast_id = ? AND period IS NOT NULL""",
        (forecast_id,),
    )
    rows, lines, lo, hi, revenue = cursor.fetchone()
    counts = {"sales_rows": rows or 0, "sales_lines": lines or 0, "revenue_total": float(revenue or 0)}
    for table, key in (("expenses", "expense_count"), ("payroll", "employee_count"), ("capital_expenditures", "capex_count")):
        cursor.execute(f"SELECT COUNT(*) FROM {table} WHERE forecast_id = ?", (forecast_id,))
        counts[key] = cursor.fetchone()[0]
    for table, key in (("sales_deduction_rules", "deduction_rule_count"), ("price_list", "price_count")):
        try:
            cursor.execute(f"SELECT COUNT(*) FROM {table} WHERE forecast_id = ?", (forecast_id,))
            counts[key] = cursor.fetchone()[0]
        except sqlite3.OperationalError:  # table missing on a database not yet migrated
            counts[key] = 0
    cursor.execute("SELECT 1 FROM financial_assumptions WHERE forecast_id = ?", (forecast_id,))
    counts["has_assumptions"] = cursor.fetchone() is not None
    counts["start_period"] = str(lo)[:7] if lo else None
    counts["end_period"] = str(hi)[:7] if hi else None
    return counts


def _scenario_row(cursor, forecast_id: str) -> Optional[Dict[str, Any]]:
    cursor.execute("SELECT * FROM forecast WHERE forecast_id = ?", (forecast_id,))
    row = cursor.fetchone()
    if not row:
        return None
    record = dict(zip([d[0] for d in cursor.description], row))
    record["is_base"] = bool(record.get("is_base"))
    record.update(_scenario_summary(cursor, forecast_id))
    return record


def _add_months(period: str, months: int) -> str:
    year, month = (int(x) for x in period.split("-"))
    month += months
    year += (month - 1) // 12
    month = (month - 1) % 12 + 1
    return f"{year:04d}-{month:02d}"


def _name_key(name: Any) -> str:
    """Scenario names compare trimmed and case-insensitively ('2027 Budget' == ' 2027 budget ')."""
    return " ".join(str(name or "").split()).casefold()


def _scenario_with_name(cursor, name: Any, exclude_id: Optional[str] = None) -> Optional[str]:
    """The id of another scenario already called ``name`` (trimmed, case-insensitive), or None."""
    wanted = _name_key(name)
    cursor.execute("SELECT forecast_id, name FROM forecast ORDER BY forecast_id")
    for fid, existing in cursor.fetchall():
        if fid != exclude_id and _name_key(existing) == wanted:
            return fid
    return None


def _refuse_taken_name(cursor, name: str, exclude_id: Optional[str] = None) -> None:
    """409 naming the scenario that already has this name."""
    existing = _scenario_with_name(cursor, name, exclude_id)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"A scenario named '{name}' already exists ({existing}). Choose another name, or open {existing} "
                   f"instead.",
        )


def _unique_name(cursor, stem: str) -> str:
    """``stem``, or ``stem 2``, ``stem 3`` ... - the first name no scenario has yet."""
    if not _scenario_with_name(cursor, stem):
        return stem
    n = 2
    while _scenario_with_name(cursor, f"{stem} {n}"):
        n += 1
    return f"{stem} {n}"


def _set_base(cursor, forecast_id: str) -> None:
    cursor.execute("UPDATE forecast SET is_base = 0")
    cursor.execute("UPDATE forecast SET is_base = 1 WHERE forecast_id = ?", (forecast_id,))


def _ensure_base(cursor) -> Optional[str]:
    """If scenarios exist and none is the base, promote the lowest forecast_id. Returns the promoted id, if any."""
    cursor.execute("SELECT COUNT(*) FROM forecast WHERE is_base = 1")
    if cursor.fetchone()[0] > 0:
        return None
    cursor.execute("SELECT forecast_id FROM forecast ORDER BY forecast_id LIMIT 1")
    row = cursor.fetchone()
    if not row:
        return None
    cursor.execute("UPDATE forecast SET is_base = 1 WHERE forecast_id = ?", (row[0],))
    return row[0]


@router.get("/scenarios", response_model=ForecastResponse)
async def get_forecast_scenarios():
    """All scenarios with row counts, sales window and whether assumptions are set."""
    try:
        from db.database import db_manager

        conn = db_manager.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT forecast_id FROM forecast ORDER BY is_base DESC, name")
            ids = [row[0] for row in cursor.fetchall()]
            scenarios = [_scenario_row(cursor, fid) for fid in ids]
        finally:
            db_manager.close_connection(conn)

        return ForecastResponse(
            status="success",
            data={"scenarios": scenarios},
            message=f"Retrieved {len(scenarios)} forecast scenarios",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving forecast scenarios: {str(e)}")


@router.get("/scenario/{forecast_id}", response_model=ForecastResponse)
async def get_forecast_scenario(forecast_id: str):
    """One scenario with its counts."""
    from db.database import db_manager

    conn = db_manager.get_connection()
    try:
        record = _scenario_row(conn.cursor(), forecast_id)
    finally:
        db_manager.close_connection(conn)
    if not record:
        raise HTTPException(status_code=404, detail="Forecast scenario not found")
    return ForecastResponse(status="success", data=record)


@router.post("/scenario", response_model=ForecastResponse)
async def create_forecast_scenario(scenario_data: Dict[str, Any]):
    """
    Create an empty scenario with an auto-generated FXXX id. A name another
    scenario already has (trimmed, case-insensitive) is refused with 409
    naming that scenario's id; without a name the scenario is called 'New
    Scenario' ('New Scenario 2', ... when taken).
    """
    try:
        from db.database import db_manager

        name = str(scenario_data.get('name') or '').strip()
        description = scenario_data.get('description') or ''
        notes = scenario_data.get('notes') or ''
        make_base = bool(scenario_data.get('is_base'))

        conn = db_manager.get_connection()
        cursor = conn.cursor()
        try:
            if name:
                _refuse_taken_name(cursor, name)
            else:
                name = _unique_name(cursor, 'New Scenario')
            forecast_id = _next_forecast_id(cursor)
            # First scenario in an empty database becomes the base automatically.
            cursor.execute("SELECT COUNT(*) FROM forecast")
            if cursor.fetchone()[0] == 0:
                make_base = True
            cursor.execute(
                "INSERT INTO forecast (forecast_id, name, description, notes, is_base) VALUES (?, ?, ?, ?, 0)",
                (forecast_id, name, description, notes),
            )
            if make_base:
                _set_base(cursor, forecast_id)
            conn.commit()
            record = _scenario_row(cursor, forecast_id)
        finally:
            db_manager.close_connection(conn)

        return ForecastResponse(status="success", data=record, message=f"Forecast scenario {forecast_id} created successfully")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating forecast scenario: {str(e)}")


@router.put("/scenario/{forecast_id}", response_model=ForecastResponse)
async def update_forecast_scenario(forecast_id: str, scenario_data: Dict[str, Any]):
    """
    Rename, edit description / notes, or mark as the base scenario. A new
    name another scenario already has (trimmed, case-insensitive) is refused
    with 409 naming that scenario's id.
    """
    from db.database import db_manager

    conn = db_manager.get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT 1 FROM forecast WHERE forecast_id = ?", (forecast_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Forecast scenario not found")

        updates, params = [], []
        for field in ("name", "description", "notes"):
            if field in scenario_data:
                value = scenario_data[field]
                if field == "name":
                    if not str(value or '').strip():
                        raise HTTPException(status_code=422, detail="name cannot be empty")
                    value = str(value).strip()
                    _refuse_taken_name(cursor, value, exclude_id=forecast_id)
                updates.append(f"{field} = ?")
                params.append(value)
        if updates:
            cursor.execute(f"UPDATE forecast SET {', '.join(updates)} WHERE forecast_id = ?", params + [forecast_id])
        if scenario_data.get("is_base"):
            _set_base(cursor, forecast_id)
        elif "is_base" in scenario_data:
            # There is always exactly one base: the flag moves to another
            # scenario (set is_base on it), it cannot simply be cleared.
            cursor.execute("SELECT is_base FROM forecast WHERE forecast_id = ?", (forecast_id,))
            if cursor.fetchone()[0]:
                raise HTTPException(
                    status_code=422,
                    detail="This is the base scenario. Mark another scenario as the base instead of clearing this one.",
                )
        conn.commit()
        record = _scenario_row(cursor, forecast_id)
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error updating forecast scenario: {str(e)}")
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data=record, message=f"Forecast scenario {forecast_id} updated")


@router.post("/scenario/{forecast_id}/duplicate", response_model=ForecastResponse)
async def duplicate_forecast_scenario(forecast_id: str, scenario_data: Optional[Dict[str, Any]] = None):
    """
    Branch a scenario in a single transaction.

    Copies sales, scenario-specific expenses / payroll / capex, the financial
    assumptions, the scenario's own price-list and sales deduction rules
    (company-wide rules already apply to every scenario) and the notes.
    Optional overrides (applied to the copy only):

    * price_multiplier     - scales unit_price on every copied sales row
    * quantity_multiplier  - scales quantity on every copied sales row
    * extend_periods       - adds N monthly periods after the last sales
                             month, repeating each customer/product line from
                             that month (after the multipliers)

    An explicit ``name`` another scenario already has (trimmed,
    case-insensitive) is refused with 409 naming that scenario's id; without
    a name the copy is called '<name> Copy' ('<name> Copy 2', ... when taken).
    """
    try:
        from db.database import db_manager

        body = scenario_data or {}

        def _multiplier(key: str) -> float:
            raw = body.get(key)
            if raw is None or raw == "":
                return 1.0
            try:
                value = float(raw)
            except (TypeError, ValueError):
                raise HTTPException(status_code=422, detail=f"{key} must be a positive number")
            if value <= 0:
                raise HTTPException(status_code=422, detail=f"{key} must be a positive number")
            return value

        price_multiplier = _multiplier("price_multiplier")
        quantity_multiplier = _multiplier("quantity_multiplier")
        try:
            extend_periods = int(body.get("extend_periods", 0) or 0)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="extend_periods must be a non-negative integer")
        if extend_periods < 0:
            raise HTTPException(status_code=422, detail="extend_periods must be a non-negative integer")
        copy_expenses = body.get("copy_expenses", True)
        copy_payroll = body.get("copy_payroll", True)
        copy_capex = body.get("copy_capex", True)
        copy_assumptions = body.get("copy_assumptions", True)

        conn = db_manager.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("SELECT name, description, notes FROM forecast WHERE forecast_id = ?", (forecast_id,))
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Forecast scenario not found")
            original_name, original_description, original_notes = row

            name = str(body.get('name') or '').strip()
            if name:
                _refuse_taken_name(cursor, name)
            else:
                name = _unique_name(cursor, f"{original_name} Copy")
            new_forecast_id = _next_forecast_id(cursor)
            description = body.get('description') or original_description
            notes = body.get('notes') or original_notes

            cursor.execute(
                "INSERT INTO forecast (forecast_id, name, description, notes, is_base) VALUES (?, ?, ?, ?, 0)",
                (new_forecast_id, name, description, notes),
            )

            # --- Sales -------------------------------------------------------
            cursor.execute(
                "SELECT customer_id, unit_id, period, quantity, unit_price FROM sales WHERE forecast_id = ?",
                (forecast_id,),
            )
            copied_sales = 0
            last_period = None
            last_period_lines: Dict[Tuple[str, str], Tuple[float, float]] = {}
            for customer_id, unit_id, period, quantity, unit_price in cursor.fetchall():
                period = normalize_period(period) or period
                qty = float(quantity or 0) * quantity_multiplier
                price = float(unit_price or 0) * price_multiplier
                cursor.execute(
                    """INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (f"SAL-{uuid.uuid4().hex[:8].upper()}", customer_id, unit_id, period, qty, price, qty * price, new_forecast_id),
                )
                copied_sales += 1
                if period and re.match(r"^\d{4}-\d{2}$", period):
                    if last_period is None or period > last_period:
                        last_period = period
                        last_period_lines = {}
                    if period == last_period:
                        last_period_lines[(customer_id, unit_id)] = (qty, price)

            extended_rows = 0
            if extend_periods and last_period:
                for offset in range(1, extend_periods + 1):
                    new_period = _add_months(last_period, offset)
                    for (customer_id, unit_id), (qty, price) in last_period_lines.items():
                        cursor.execute(
                            """INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                            (f"SAL-{uuid.uuid4().hex[:8].upper()}", customer_id, unit_id, new_period, qty, price, qty * price, new_forecast_id),
                        )
                        extended_rows += 1

            # --- Expenses (with their period allocations) ----------------------
            copied_expenses = 0
            if copy_expenses:
                cursor.execute(
                    """SELECT expense_id, expense_name, category_id, amount, frequency, start_date, end_date, vendor, description,
                              payment_method, approval_required, approved_by, approval_date, expense_allocation, amortization_months,
                              department, cost_center, is_active
                       FROM expenses WHERE forecast_id = ?""",
                    (forecast_id,),
                )
                now = datetime.now().isoformat()
                for e in cursor.fetchall():
                    old_expense_id, fields = e[0], e[1:]
                    new_expense_id = f"EXP-{uuid.uuid4().hex[:8].upper()}"
                    cursor.execute(
                        """INSERT INTO expenses (expense_id, expense_name, category_id, amount, frequency, start_date, end_date, vendor,
                                                 description, payment_method, approval_required, approved_by, approval_date,
                                                 expense_allocation, amortization_months, department, cost_center, is_active,
                                                 forecast_id, created_date, updated_date)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (new_expense_id, *fields, new_forecast_id, now, now),
                    )
                    cursor.execute(
                        """SELECT period, allocated_amount, allocation_type, payment_status, payment_date, actual_amount, notes
                           FROM expense_allocations WHERE expense_id = ?""",
                        (old_expense_id,),
                    )
                    for alloc in cursor.fetchall():
                        cursor.execute(
                            """INSERT INTO expense_allocations (allocation_id, expense_id, period, allocated_amount, allocation_type,
                                                                payment_status, payment_date, actual_amount, notes)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                            (f"ALLOC-{uuid.uuid4().hex[:8].upper()}", new_expense_id, *alloc),
                        )
                    copied_expenses += 1

            # --- Payroll -----------------------------------------------------------
            copied_employees = 0
            if copy_payroll:
                cursor.execute(
                    """SELECT employee_name, department, weekly_hours, hourly_rate, rate_type, labor_type, start_date, end_date,
                              next_review_date, expected_raise, benefits_eligible, allocations
                       FROM payroll WHERE forecast_id = ?""",
                    (forecast_id,),
                )
                for p in cursor.fetchall():
                    cursor.execute(
                        """INSERT INTO payroll (employee_id, employee_name, department, weekly_hours, hourly_rate, rate_type, labor_type,
                                                start_date, end_date, next_review_date, expected_raise, benefits_eligible, allocations, forecast_id)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (f"EMP-{uuid.uuid4().hex[:10].upper()}", *p, new_forecast_id),
                    )
                    copied_employees += 1

            # --- Capex -------------------------------------------------------------
            copied_capex = 0
            if copy_capex:
                cursor.execute(
                    """SELECT asset_name, category, amount, purchase_period, useful_life_months, salvage_value, depreciation_method,
                              description, is_active
                       FROM capital_expenditures WHERE forecast_id = ?""",
                    (forecast_id,),
                )
                for c in cursor.fetchall():
                    cursor.execute(
                        """INSERT INTO capital_expenditures (capex_id, forecast_id, asset_name, category, amount, purchase_period,
                                                             useful_life_months, salvage_value, depreciation_method, description, is_active)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (f"CAPEX-{uuid.uuid4().hex[:8].upper()}", new_forecast_id, *c),
                    )
                    copied_capex += 1

            # --- Assumptions -------------------------------------------------------
            copied_assumptions = False
            if copy_assumptions:
                cursor.execute("SELECT * FROM financial_assumptions WHERE forecast_id = ?", (forecast_id,))
                row = cursor.fetchone()
                if row:
                    columns = [d[0] for d in cursor.description]
                    values = dict(zip(columns, row))
                    values["forecast_id"] = new_forecast_id
                    values.pop("updated_at", None)
                    cols = list(values.keys())
                    cursor.execute(
                        f"INSERT INTO financial_assumptions ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})",
                        [values[c] for c in cols],
                    )
                    copied_assumptions = True

            # --- Price list and sales deduction rules (scenario-specific rows) ----
            copied_rules = {}
            for table, id_col, prefix in (("sales_deduction_rules", "rule_id", "DED"), ("price_list", "price_id", "PRC")):
                cursor.execute(f"SELECT * FROM {table} WHERE forecast_id = ?", (forecast_id,))
                columns = [d[0] for d in cursor.description]
                now = datetime.now().isoformat(timespec="seconds")
                count = 0
                for values in [dict(zip(columns, r)) for r in cursor.fetchall()]:
                    values[id_col] = f"{prefix}-{uuid.uuid4().hex[:8].upper()}"
                    values["forecast_id"] = new_forecast_id
                    values["created_at"] = now
                    values["updated_at"] = now
                    cols = list(values.keys())
                    cursor.execute(
                        f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})",
                        [values[c] for c in cols],
                    )
                    count += 1
                copied_rules[table] = count

            conn.commit()
            record = _scenario_row(cursor, new_forecast_id)
        except HTTPException:
            conn.rollback()
            raise
        except Exception:
            conn.rollback()
            raise
        finally:
            db_manager.close_connection(conn)

        record["source_forecast_id"] = forecast_id
        record["copied"] = {
            "sales": copied_sales,
            "sales_extended": extended_rows,
            "expenses": copied_expenses,
            "employees": copied_employees,
            "capex": copied_capex,
            "assumptions": copied_assumptions,
            "deduction_rules": copied_rules["sales_deduction_rules"],
            "prices": copied_rules["price_list"],
        }
        record["overrides"] = {
            "price_multiplier": price_multiplier,
            "quantity_multiplier": quantity_multiplier,
            "extend_periods": extend_periods,
        }
        return ForecastResponse(
            status="success",
            data=record,
            message=f"Forecast scenario {forecast_id} duplicated as {new_forecast_id}",
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error duplicating forecast scenario: {str(e)}")


@router.delete("/scenario/{forecast_id}", response_model=ForecastResponse)
async def delete_forecast_scenario(forecast_id: str):
    """Delete a scenario and every row that belongs only to it (company-wide NULL rows are untouched)."""
    try:
        from db.database import db_manager

        conn = db_manager.get_connection()
        cursor = conn.cursor()
        try:
            record = _scenario_row(cursor, forecast_id)
            if not record:
                raise HTTPException(status_code=404, detail="Forecast scenario not found")

            cursor.execute(
                "DELETE FROM expense_allocations WHERE expense_id IN (SELECT expense_id FROM expenses WHERE forecast_id = ?)",
                (forecast_id,),
            )
            for table in SCENARIO_TABLES:
                cursor.execute(f"DELETE FROM {table} WHERE forecast_id = ?", (forecast_id,))
            cursor.execute("DELETE FROM forecast WHERE forecast_id = ?", (forecast_id,))
            # Deleting the base promotes another scenario so one base always remains.
            promoted = _ensure_base(cursor)
            conn.commit()
        except HTTPException:
            conn.rollback()
            raise
        finally:
            db_manager.close_connection(conn)

        return ForecastResponse(
            status="success",
            data={
                "forecast_id": forecast_id,
                "promoted_base": promoted,
                "deleted": {
                    "sales": record["sales_rows"],
                    "expenses": record["expense_count"],
                    "employees": record["employee_count"],
                    "capex": record["capex_count"],
                    "assumptions": record["has_assumptions"],
                },
            },
            message=f"Forecast scenario {forecast_id} deleted successfully",
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting forecast scenario: {str(e)}")


@router.get("/comparison", response_model=ForecastResponse)
async def compare_forecast_scenarios(
    forecast_ids: List[str] = Query(..., description="Forecast IDs to compare"),
    start_period: Optional[str] = Query(None, description="Start period (YYYY-MM); defaults to the earliest sales month across the selection"),
    end_period: Optional[str] = Query(None, description="End period (YYYY-MM); defaults to the latest sales month across the selection"),
):
    """
    Compare scenarios side by side using the statements engine, so the
    numbers match the income statement exactly.

    Every scenario is totalled over the SAME window. When no window is given
    it is the union of the selected scenarios' sales months, so a branch
    that was extended by N periods is still comparable to its source.

    Unknown scenario ids are a 404 naming them (never a row of zeros).
    """
    try:
        from db.database import db_manager
        from services.financial_statements import build_statements, period_range

        ids: List[str] = []
        for value in forecast_ids:
            ids.extend(v.strip() for v in str(value).split(",") if v.strip())
        if not ids:
            raise HTTPException(status_code=422, detail="At least one forecast_id is required")
        if (start_period or end_period) and not (start_period and end_period):
            raise HTTPException(status_code=422, detail="start_period and end_period must be supplied together")
        if start_period and end_period:
            try:
                period_range(start_period, end_period)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc))

        conn = db_manager.get_connection()
        cursor = conn.cursor()
        comparison = []
        try:
            cursor.execute(
                f"SELECT forecast_id FROM forecast WHERE forecast_id IN ({','.join('?' for _ in ids)})", ids)
            known = {row[0] for row in cursor.fetchall()}
            unknown = list(dict.fromkeys(fid for fid in ids if fid not in known))
            if unknown:
                raise HTTPException(status_code=404, detail=f"Unknown scenario id(s): {', '.join(unknown)}")
            if start_period and end_period:
                window = (start_period, end_period)
            else:
                placeholders = ",".join("?" for _ in ids)
                cursor.execute(
                    f"SELECT MIN(substr(period, 1, 7)), MAX(substr(period, 1, 7)) FROM sales "
                    f"WHERE forecast_id IN ({placeholders}) AND substr(period, 1, 7) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'",
                    ids,
                )
                lo, hi = cursor.fetchone()
                window = (str(lo)[:7], str(hi)[:7]) if lo and hi else None

            for fid in ids:
                cursor.execute("SELECT name, is_base FROM forecast WHERE forecast_id = ?", (fid,))
                meta = cursor.fetchone()
                row = {
                    "forecast_id": fid,
                    "name": meta[0] if meta else fid,
                    "is_base": bool(meta[1]) if meta else False,
                    "start_period": window[0] if window else None,
                    "end_period": window[1] if window else None,
                    "gross_sales": 0.0, "total_sales_deductions": 0.0,
                    "revenue": 0.0, "cogs": 0.0, "gross_profit": 0.0, "commissions": 0.0,
                    "payroll": 0.0, "expenses": 0.0, "operating_income": 0.0, "net_income": 0.0,
                    "closing_cash": None,
                }
                if window:
                    stmt = build_statements(cursor, [fid], window[0], window[1])
                    t = stmt["income_statement"]["totals"]
                    row.update({
                        "gross_sales": t.get("gross_sales", 0.0),
                        "total_sales_deductions": t.get("total_sales_deductions", 0.0),
                        "revenue": t.get("revenue", 0.0),
                        "cogs": t.get("total_cogs", 0.0),
                        "gross_profit": t.get("gross_profit", 0.0),
                        "commissions": t.get("commissions", 0.0),
                        "payroll": t.get("payroll", 0.0),
                        "expenses": t.get("admin_expense", 0.0) + t.get("operating_expense", 0.0) + t.get("depreciation", 0.0),
                        "operating_income": t.get("operating_income", 0.0),
                        "net_income": t.get("net_income", 0.0),
                        "closing_cash": stmt["cash_flow"]["totals"].get("closing_cash"),
                    })
                comparison.append(row)
        finally:
            db_manager.close_connection(conn)

        return ForecastResponse(
            status="success",
            data={
                "comparison": comparison,
                "window": {"start_period": window[0], "end_period": window[1]} if window else None,
            },
            message=f"Compared {len(comparison)} forecast scenarios",
        )
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error comparing forecast scenarios: {str(e)}"
        )


@router.get("/results", response_model=ForecastResponse)
async def get_saved_forecast_results_endpoint(
    period: Optional[str] = Query(None, description="Filter by period (e.g., '2024-01')"),
    limit: Optional[int] = Query(None, description="Limit number of results"),
    forecast_id: Optional[str] = Query(None, description="Limit to one scenario"),
):
    """
    Per-sales-row cost and margin estimate (utils.cost_rollup), computed on
    request; read-only. Reporting numbers come from /reporting/*.
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


# Columns the bulk customer / product imports write, with the extra names they accept.
_BULK_MASTER_SPECS: Dict[str, Dict[str, Any]] = {
    "customers": {
        "key": "customer_id", "name": "customer_name", "prefix": "CUST-", "label": "customers",
        "columns": {"customer_id": (), "customer_name": (), "customer_type": (), "region": ()},
    },
    "units": {
        "key": "unit_id", "name": "unit_name", "prefix": "PROD-", "label": "products",
        "columns": {"unit_id": ("product_id",), "unit_name": ("product_name",),
                    "unit_description": ("product_description",), "base_price": (),
                    "unit_type": ("product_type",), "bom_id": (), "bom_version": (), "router_id": (),
                    "router_version": ()},
    },
}
_MERGE_STRATEGIES = ("skip", "update", "create_new")


def _bulk_master_values(spec: Dict[str, Any], row: Dict[str, Any]) -> Dict[str, Any]:
    """
    The non-blank cells of one import row by column: aliases resolved,
    base_price parsed ('$1,299.00'; ColumnValueError when not a number),
    versions normalized ('1' -> '1.0'), everything else as trimmed text.
    Blank cells are left out, so they never overwrite or store ''.
    """
    from api.import_routes import normalize_version
    from utils.data_loader import is_blank, parse_number

    values: Dict[str, Any] = {}
    for column, aliases in spec["columns"].items():
        for name in (column, *aliases):
            value = row.get(name)
            if not is_blank(value):
                break
        else:
            continue
        if column == "base_price":
            values[column] = parse_number(value, column)
        elif column in ("bom_version", "router_version"):
            values[column] = normalize_version(value)
        else:
            if isinstance(value, float) and value.is_integer():
                value = int(value)
            values[column] = str(value).strip()
    return values


def _bulk_upsert_master(table: str, rows: List[Any], merge_strategy: str) -> Dict[str, Any]:
    """
    Shared body of bulk_create_customers / bulk_create_products.

    ``skip`` leaves existing ids alone; ``update`` changes only the columns a
    row fills in (blank or missing cells keep the stored value, so a price
    refresh never unlinks a product's BOM or routing); ``create_new`` inserts
    an existing id under the next free CUST-### / PROD-### id. New rows store
    NULL, not '', for blank cells. A row that fails is reported in ``errors``
    and the others are saved. Returns the counts plus per-row ``records``
    ({row, id, action, fields}).
    """
    from db.database import db_manager
    from api.import_routes import next_sequential_id
    from utils.data_loader import ColumnValueError

    spec = _BULK_MASTER_SPECS[table]
    key_col, name_col = spec["key"], spec["name"]
    created = updated = skipped = unchanged = 0
    errors: List[Dict[str, Any]] = []
    records: List[Dict[str, Any]] = []
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        for index, row in enumerate(rows, start=1):
            if not isinstance(row, dict):
                errors.append({"row": index, "error": "each row must be an object of column: value"})
                continue
            try:
                values = _bulk_master_values(spec, row)
            except ColumnValueError as exc:
                errors.append({"row": index, "error": str(exc)})
                continue
            record_id = values.get(key_col)
            if not record_id or not values.get(name_col):
                errors.append({"row": index, "error": f"Missing {key_col} or {name_col}"})
                continue
            cursor.execute(f"SELECT * FROM {table} WHERE {key_col} = ?", (record_id,))
            found = cursor.fetchone()
            try:
                if found is not None and merge_strategy == "skip":
                    skipped += 1
                    records.append({"row": index, key_col: record_id, "action": "skipped"})
                    continue
                if found is not None and merge_strategy == "update":
                    current = dict(zip([d[0] for d in cursor.description], found))
                    changed = {k: v for k, v in values.items() if k != key_col and current.get(k) != v}
                    if changed:
                        cursor.execute(f"UPDATE {table} SET {', '.join(f'{k} = ?' for k in changed)} "
                                       f"WHERE {key_col} = ?", [*changed.values(), record_id])
                        updated += 1
                        records.append({"row": index, key_col: record_id, "action": "updated",
                                        "fields": sorted(changed)})
                    else:
                        unchanged += 1
                        records.append({"row": index, key_col: record_id, "action": "unchanged"})
                    continue
                if found is not None:  # create_new
                    record_id = next_sequential_id(cursor, table, key_col, spec["prefix"], 3)
                    values[key_col] = record_id
                cols = list(values)
                cursor.execute(f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})",
                               [values[c] for c in cols])
                created += 1
                records.append({"row": index, key_col: record_id, "action": "created"})
            except sqlite3.Error as exc:
                errors.append({"row": index, "error": str(exc)})
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        db_manager.close_connection(conn)

    message = (f"Processed {len(rows)} {spec['label']}: {created} created, {updated} updated, {skipped} skipped"
               + (f", {unchanged} unchanged" if unchanged else "")
               + (f", {len(errors)} with errors" if errors else ""))
    return {"created": created, "updated": updated, "skipped": skipped, "unchanged": unchanged,
            "errors": errors, "records": records[:1000], "message": message}


@router.post("/bulk_create_customers", response_model=ForecastResponse)
async def bulk_create_customers(customers_data: Dict[str, Any]):
    """
    Bulk create customers from CSV import.

    Body: ``{customers: [{customer_id, customer_name, customer_type?,
    region?}], options: {merge_strategy: 'skip'|'update'|'create_new'}}``.
    ``update`` changes only the columns a row fills in. Responds with
    created / updated / skipped / unchanged counts, ``errors`` [{row, error}]
    and per-row ``records``.
    """
    customers = customers_data.get('customers', [])
    options = customers_data.get('options') or {}
    merge_strategy = options.get('merge_strategy', 'skip')
    if not customers or not isinstance(customers, list):
        raise HTTPException(status_code=400, detail="No customer data provided")
    if merge_strategy not in _MERGE_STRATEGIES:
        raise HTTPException(status_code=422, detail=f"merge_strategy must be one of {', '.join(_MERGE_STRATEGIES)}")
    try:
        result = _bulk_upsert_master("customers", customers, merge_strategy)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error bulk creating customers: {str(e)}")
    message = result.pop("message")
    return ForecastResponse(status="success", data=result, message=message)

@router.post("/bulk_create_products", response_model=ForecastResponse)
async def bulk_create_products(products_data: Dict[str, Any]):
    """
    Bulk create products (units) from CSV import.

    Body: ``{products: [{unit_id (or product_id), unit_name (or
    product_name), unit_description?, base_price? ('$1,299.00' accepted),
    unit_type?, bom_id?, bom_version?, router_id?, router_version?}],
    options: {merge_strategy}}``. ``update`` changes only the columns a row
    fills in, so refreshing prices never unlinks BOMs or routings. Same
    response as bulk_create_customers.
    """
    products = products_data.get('products', [])
    options = products_data.get('options') or {}
    merge_strategy = options.get('merge_strategy', 'skip')
    if not products or not isinstance(products, list):
        raise HTTPException(status_code=400, detail="No product data provided")
    if merge_strategy not in _MERGE_STRATEGIES:
        raise HTTPException(status_code=422, detail=f"merge_strategy must be one of {', '.join(_MERGE_STRATEGIES)}")
    try:
        result = _bulk_upsert_master("units", products, merge_strategy)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error bulk creating products: {str(e)}")
    message = result.pop("message")
    return ForecastResponse(status="success", data=result, message=message)

def _same_numbers(stored: Sequence[Any], new: Sequence[Any]) -> bool:
    """True when every stored number equals the new one (to a millionth, relative), so a re-import is a no-op."""
    for old, value in zip(stored, new):
        try:
            a, b = float(old if old is not None else 0.0), float(value if value is not None else 0.0)
        except (TypeError, ValueError):
            return False
        if abs(a - b) > 1e-6 * max(1.0, abs(a), abs(b)):
            return False
    return True


class _HeaderProblem(Exception):
    """No column of a sales file was recognised (smart_import_sales answers with one file-level error)."""

    def __init__(self, error: Dict[str, Any]):
        super().__init__(error["error"])
        self.error = error


@router.post("/smart_import_sales", response_model=ForecastResponse)
async def smart_import_sales(sales_data: Dict[str, Any]):
    """
    Import a monthly sales forecast into a scenario, creating missing
    customers / products on the fly.

    Body: ``{forecast_id, sales: [...] (or rows), options: {autoCreate = true,
    allowZeroPrice = false}, dry_run = false, year?}``.

    * Columns are matched through api.import_routes.SALES_FIELDS (case and
      punctuation ignored; Customer / Qty / Price / Month ... aliases). A row
      with no period column but month-named columns (Jan-27, 2027-02, ...)
      is a wide row: one sales row per filled month. Bare month names (Jan ..
      Dec, or a period of 'Jan') take the row's Year column or ``year`` from
      the request.
    * Periods: 2027-01, 2027-1, 2027/01, 1/2027, 1/15/2027, 2027-01-15,
      Jan-27, Jan 2027, January 2027, Excel serial dates. Quarters / weeks
      are rejected: the model is monthly.
    * Price: a row's own price (> 0, or revenue / quantity when the file
      has revenue instead of a price) is kept. A blank or 0 price is resolved
      from the price list, then the product's base_price; still unpriced rows
      are errors unless options.allowZeroPrice (then imported at 0).
      ``price_sources`` counts where each row's price came from.
    * Customers / products given by id (case and surrounding spaces
      ignored), by name, or by an id that is really a name, resolve to the
      existing record. Auto-created records take customer_name /
      customer_type / unit_name / unit_type / base_price from the rows.
    * A Month column of numbers (1 .. 12) takes the row's Year column (or
      ``year``). An accounting zero ('-') is a quantity of 0.
    * Rows of the file for the same customer + product + month (split
      ship-tos, mixed month spellings) are combined: quantities and revenue
      add up, price = revenue / quantity, with a warning naming the rows.
      Existing rows for the same customer + product + month are updated.
      ``imported`` / ``inserted`` / ``updated`` count the lines written and
      ``total_quantity`` / ``total_revenue`` equal what was written.
      Quantity decimals are kept. ``dry_run`` reports without writing.
    * ``mode``: ``upsert`` (default) keeps the scenario's other rows;
      ``replace`` also deletes the scenario's rows in the months the file
      covers that the file does not contain (re-importing a revised 2027
      forecast leaves no stale lines, other years are untouched);
      ``replace_all`` deletes every other row of the scenario. Replacing is
      all-or-nothing: if any row has an error nothing is written.
    """
    from db.database import db_manager
    from api.import_routes import SALES_FIELDS, next_sequential_id, note_or_total_row
    from api.import_routes import _header_problem, _skipped_rows_warning  # file-level checks shared with /import
    from api.import_routes import _blank, _number, _text  # shared cell parsing ('$1,234.50', NaN, blanks)
    from services.pricing import load_price_rules, resolve_price
    from utils.period_normalizer import month_from_name, month_in_year, month_number, normalize_month, period_kind

    sales = sales_data.get('sales') or sales_data.get('rows') or []
    options = sales_data.get('options') or {}
    auto_create = bool(options.get('autoCreate', options.get('auto_create', True)))
    allow_zero = bool(options.get('allowZeroPrice', options.get('allow_zero_price', False)))
    dry_run = bool(sales_data.get('dry_run', options.get('dryRun', options.get('dry_run', False))))
    forecast_id = sales_data.get('forecast_id')
    default_year = sales_data.get('year', options.get('year'))
    mode = str(sales_data.get('mode') or options.get('mode') or 'upsert').strip().lower()
    if mode not in ('upsert', 'replace', 'replace_all'):
        raise HTTPException(status_code=422, detail="mode must be upsert, replace or replace_all")

    if not sales:
        raise HTTPException(status_code=400, detail="No sales data provided")
    if not forecast_id:
        raise HTTPException(status_code=400, detail="forecast_id is required")
    if not isinstance(sales, list) or not all(isinstance(s, dict) for s in sales):
        raise HTTPException(status_code=422, detail="sales must be a list of row objects")

    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM forecast WHERE forecast_id = ?", (forecast_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail=f"Forecast scenario '{forecast_id}' not found; create it first")

        # --- 1. Map columns; unpivot wide (one column per month) rows ----------------
        entries: List[Tuple[int, Dict[str, Any]]] = []
        ignored_columns: List[str] = []
        wide_format = False
        any_column = False
        blank_rows = 0
        missing_year_rows: List[int] = []
        note_rows: List[Tuple[int, str]] = []
        # Every month COLUMN of a wide file, even one left blank on every row: mode=replace treats the
        # file as covering those months, so a blank December column clears December's stale rows.
        column_months: set = set()
        for row_no, raw in enumerate(sales, start=1):
            note = note_or_total_row(raw)
            if note is not None:                 # a 'Total' line or a footnote, not a customer
                note_rows.append((row_no, note))
                continue
            data, extra = SALES_FIELDS.map_row(raw)
            any_column = any_column or bool(data)
            year = data.get('year', default_year)
            month_columns = []
            for k in extra:
                month = normalize_month(k)
                if not month and month_from_name(k):
                    # "Jan" .. "Dec" columns take the row's Year column (or the request's year).
                    month = month_in_year(month_from_name(k), year)
                    if not month:
                        if row_no not in missing_year_rows:
                            missing_year_rows.append(row_no)
                        continue
                if month:
                    month_columns.append((k, month))
                    any_column = True
                elif k not in ignored_columns:
                    ignored_columns.append(k)
            if row_no in missing_year_rows and _blank(data.get('period')):
                continue
            if month_columns and _blank(data.get('period')):
                wide_format = True
                column_months.update(m for _k, m in month_columns)
                filled = [(k, m) for k, m in month_columns if not _blank(raw.get(k))]
                if not filled:
                    blank_rows += 1
                    continue
                for key, month in filled:
                    entries.append((row_no, {**data, 'period': month, 'quantity': raw[key]}))
                continue
            if not data and all(_blank(v) for v in raw.values()):
                blank_rows += 1
                continue
            entries.append((row_no, data))

        # A title row read as the header: nothing maps, so say which row looks like the header.
        if not any_column and not missing_year_rows and any(not _blank(v) for r in sales for v in r.values()):
            problem = _header_problem(sales, SALES_FIELDS, [], ("customer_id", "unit_id", "period", "quantity"))
            if problem:
                raise _HeaderProblem(problem)

        # --- 2. Customers and products (match by id, then by name) -----------------
        cursor.execute("SELECT customer_id, customer_name, customer_type FROM customers")
        customers = {r[0]: {"name": r[1], "type": r[2]} for r in cursor.fetchall()}
        cursor.execute("SELECT unit_id, unit_name, base_price, unit_type FROM units")
        products = {r[0]: {"name": r[1], "base_price": r[2], "type": r[3]} for r in cursor.fetchall()}

        def _by_name(records: Dict[str, Dict[str, Any]]) -> Dict[str, List[str]]:
            out: Dict[str, List[str]] = {}
            for rid, rec in records.items():
                if rec.get("name"):
                    out.setdefault(str(rec["name"]).strip().lower(), []).append(rid)
            return out

        def _by_id(records: Dict[str, Dict[str, Any]]) -> Dict[str, List[str]]:
            out: Dict[str, List[str]] = {}
            for rid in records:
                out.setdefault(str(rid).strip().lower(), []).append(rid)
            return out

        def _resolve(ref_id: Optional[str], ref_name: Optional[str], records, names, ids) -> Optional[str]:
            if ref_id and ref_id in records:
                return ref_id
            if ref_id and len(ids.get(ref_id.lower(), [])) == 1:      # 'cust-001' -> CUST-001
                return ids[ref_id.lower()][0]
            for candidate in (ref_id, ref_name):
                if candidate and len(names.get(candidate.lower(), [])) == 1:
                    return names[candidate.lower()][0]
            return None

        customer_names = _by_name(customers)
        product_names = _by_name(products)
        customer_ids = _by_id(customers)
        product_ids = _by_id(products)
        missing_customers: Dict[str, Dict[str, Any]] = {}
        missing_products: Dict[str, Dict[str, Any]] = {}
        for _row_no, data in entries:
            cid, cname = _text(data.get('customer_id')), _text(data.get('customer_name'))
            if (cid or cname) and not _resolve(cid, cname, customers, customer_names, customer_ids):
                key = cid.lower() if cid else f"~{cname.lower()}"
                entry = missing_customers.setdefault(key, {"id": cid, "name": None, "type": None})
                entry["name"] = entry["name"] or cname
                entry["type"] = entry["type"] or _text(data.get('customer_type'))
            uid, uname = _text(data.get('unit_id')), _text(data.get('unit_name'))
            if (uid or uname) and not _resolve(uid, uname, products, product_names, product_ids):
                key = uid.lower() if uid else f"~{uname.lower()}"
                entry = missing_products.setdefault(key, {"id": uid, "name": None, "type": None, "base_price": None})
                entry["name"] = entry["name"] or uname
                entry["type"] = entry["type"] or _text(data.get('unit_type'))
                if entry["base_price"] is None:
                    try:
                        entry["base_price"] = _number(data.get('base_price'), 'base_price')
                    except ValueError:
                        pass

        created_customers: List[str] = []
        created_products: List[str] = []
        if auto_create:
            for key, info in missing_customers.items():
                new_id = info["id"] or next_sequential_id(cursor, "customers", "customer_id", "CUST-", 3)
                cursor.execute(
                    "INSERT INTO customers (customer_id, customer_name, customer_type, region) VALUES (?, ?, ?, ?)",
                    (new_id, info["name"] or new_id, info["type"] or 'Unknown', 'Unknown'),
                )
                customers[new_id] = {"name": info["name"] or new_id, "type": info["type"] or 'Unknown'}
                customer_names.setdefault((info["name"] or new_id).lower(), []).append(new_id)
                customer_ids.setdefault(new_id.lower(), []).append(new_id)
                created_customers.append(new_id)
            for key, info in missing_products.items():
                new_id = info["id"] or next_sequential_id(cursor, "units", "unit_id", "PROD-", 3)
                base_price = info["base_price"] if info["base_price"] is not None else 0
                cursor.execute(
                    "INSERT INTO units (unit_id, unit_name, base_price, unit_type) VALUES (?, ?, ?, ?)",
                    (new_id, info["name"] or new_id, base_price, info["type"]),
                )
                products[new_id] = {"name": info["name"] or new_id, "base_price": base_price, "type": info["type"]}
                product_names.setdefault((info["name"] or new_id).lower(), []).append(new_id)
                product_ids.setdefault(new_id.lower(), []).append(new_id)
                created_products.append(new_id)

        # --- 3. Validate and price every row; combine repeats of one customer / product / month --------
        price_rules = load_price_rules(cursor, [forecast_id])
        imported_count = inserted = updated = unchanged = 0
        errors: List[Dict[str, Any]] = [
            {'row': r, 'error': "Month columns (Jan, Feb, ...) have no year: add a Year column or send year with the request"}
            for r in missing_year_rows
        ]
        warnings: List[str] = []
        price_sources: Dict[str, int] = {}
        planned: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
        no_quantity: List[int] = []
        months: List[str] = []
        total_quantity = total_revenue = 0.0

        for row_no, data in entries:
            def _fail(message: str, row_no: int = row_no) -> None:
                errors.append({'row': row_no, 'error': message})

            cid, cname = _text(data.get('customer_id')), _text(data.get('customer_name'))
            uid, uname = _text(data.get('unit_id')), _text(data.get('unit_name'))
            raw_period = data.get('period')
            if not (cid or cname):
                _fail('Missing customer_id')
                continue
            if not (uid or uname):
                _fail('Missing product_id / unit_id')
                continue
            if _blank(raw_period):
                _fail('Missing period (a month such as 2027-01)')
                continue
            customer_id = _resolve(cid, cname, customers, customer_names, customer_ids)
            if not customer_id:
                _fail(f'Customer {cid or cname} does not exist')
                continue
            product_id = _resolve(uid, uname, products, product_names, product_ids)
            if not product_id:
                _fail(f'Product {uid or uname} does not exist')
                continue

            period = normalize_month(raw_period)
            month = None if period else (month_from_name(raw_period) or month_number(raw_period))
            if month:
                # 'Jan' or a Month column of numbers (1 .. 12) with the row's Year column / the request's year.
                period = month_in_year(month, data.get('year', default_year))
                if not period:
                    _fail(f"Period '{raw_period}' has no year: add a Year column or send year with the request")
                    continue
            if not period:
                kind = period_kind(normalize_period(raw_period))
                if kind in ('quarter', 'week'):
                    _fail(f"Period '{raw_period}' is a {kind}; the forecast is monthly, so split it into months "
                          f"(YYYY-MM, e.g. 2027-01)")
                else:
                    _fail(f"Invalid period '{raw_period}': use a month such as 2027-01, 1/2027, Jan-2027 or 1/15/2027")
                continue

            try:
                quantity = _number(data.get('quantity'), 'quantity')
                price = _number(data.get('unit_price'), 'unit_price')
                revenue = _number(data.get('total_revenue'), 'total_revenue')
            except ValueError as exc:
                _fail(str(exc))
                continue
            if quantity is None:
                quantity = 0.0
                no_quantity.append(row_no)
            if not price and revenue and quantity:
                price = round(revenue / quantity, 4)   # a file with revenue but no price
            if price is not None and price < 0:
                _fail(f'unit_price cannot be negative ({price:g})')
                continue
            if price:
                source = 'explicit'
            else:
                product = products.get(product_id, {})
                resolved = resolve_price(
                    price_rules,
                    {"forecast_id": forecast_id, "unit_id": product_id, "unit_type": product.get("type"),
                     "customer_id": customer_id, "customer_type": customers.get(customer_id, {}).get("type"),
                     "period": period},
                    base_price=product.get("base_price"),
                )
                if resolved["price"] is not None:
                    price, source = round(float(resolved["price"]), 4), resolved["source"]
                elif allow_zero:
                    price, source = 0.0, 'zero_price'
                elif quantity == 0:
                    price, source = 0.0, None          # a zero (or '-') month needs no price
                else:
                    _fail(f'No price for {product_id} / {customer_id} in {period}: give unit_price, add a price-list '
                          f'entry or a base price for the product, or import with allowZeroPrice')
                    continue

            if source:
                price_sources[source] = price_sources.get(source, 0) + 1
            key = (customer_id, product_id, period)
            plan = planned.get(key)
            if plan is None:
                planned[key] = {"quantity": quantity, "revenue": quantity * price, "price": price, "rows": [row_no]}
            else:
                plan["quantity"] += quantity
                plan["revenue"] += quantity * price
                plan["price"] = price
                plan["rows"].append(row_no)

        # --- 4. Write one line per customer / product / month --------------------------------------
        combined: List[str] = []
        for (customer_id, product_id, period), plan in planned.items():
            quantity, total = plan["quantity"], plan["revenue"]
            price = plan["price"]
            if len(plan["rows"]) > 1:
                if quantity:
                    price = total / quantity          # revenue-weighted, so quantity x price = revenue
                rows_text = ", ".join(str(r) for r in plan["rows"][:-1]) + f" and {plan['rows'][-1]}"
                combined.append(f"Rows {rows_text} ({customer_id} / {product_id} / {period}) combined: "
                                f"{quantity:,.4g} units, {total:,.2f}")
            cursor.execute(
                "SELECT quantity, unit_price, total_revenue FROM sales "
                "WHERE customer_id = ? AND unit_id = ? AND period = ? AND forecast_id = ?",
                (customer_id, product_id, period, forecast_id),
            )
            stored = cursor.fetchall()
            if len(stored) == 1 and _same_numbers(stored[0], (quantity, price, total)):
                unchanged += 1                     # already stored with these values: nothing to write
            elif stored:
                cursor.execute(
                    """UPDATE sales SET quantity = ?, unit_price = ?, total_revenue = ?
                       WHERE customer_id = ? AND unit_id = ? AND period = ? AND forecast_id = ?""",
                    (quantity, price, total, customer_id, product_id, period, forecast_id),
                )
                updated += 1
            else:
                cursor.execute(
                    """INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (f"SAL-{uuid.uuid4().hex[:8].upper()}", customer_id, product_id, period, quantity, price, total,
                     forecast_id),
                )
                inserted += 1
            imported_count += 1
            months.append(period)
            total_quantity += quantity
            total_revenue += total
        if combined:
            shown = "; ".join(combined[:10]) + (f"; and {len(combined) - 10} more" if len(combined) > 10 else "")
            warnings.append(f"{len(combined)} customer / product / month lines appear on more than one row; their "
                            f"quantities and revenue were added up into one line each (price = revenue / quantity): "
                            f"{shown}")
        seen = set(planned)

        deleted = 0
        replace_blocked = False
        covered = set(months) | column_months
        removed: Dict[Tuple[str, str], List[str]] = {}
        if mode != 'upsert':
            if errors:
                # Never delete a scenario's rows on the strength of a file that did not fully import.
                replace_blocked = True
            else:
                cursor.execute(
                    "SELECT sale_id, customer_id, unit_id, substr(period, 1, 7) FROM sales WHERE forecast_id = ?",
                    (forecast_id,),
                )
                stale = []
                for sale_id, c, u, p in cursor.fetchall():
                    if (c, u, p) not in seen and (mode == 'replace_all' or p in covered):
                        stale.append(sale_id)
                        removed.setdefault((c, u), []).append(p)
                for i in range(0, len(stale), 500):
                    chunk = stale[i:i + 500]
                    cursor.execute(f"DELETE FROM sales WHERE sale_id IN ({','.join('?' for _ in chunk)})", chunk)
                deleted = len(stale)
        removed_lines = [
            {"customer_id": c, "customer_name": customers.get(c, {}).get("name"),
             "unit_id": u, "unit_name": products.get(u, {}).get("name"),
             "months": sorted({str(p) for p in ps if p is not None})}
            for (c, u), ps in sorted(removed.items(), key=lambda item: (str(item[0][0]), str(item[0][1])))
        ]

        warnings.extend(_skipped_rows_warning(note_rows))
        if no_quantity:
            warnings.append(f"{len(no_quantity)} rows had no quantity and were imported as 0")
        if ignored_columns:
            warnings.append(f"Ignored columns (not recognised): {', '.join(ignored_columns)}")
        if created_customers:
            warnings.append(f"Created {len(created_customers)} customers; check their customer_type (it drives "
                            f"customer-type prices and deductions)")
        if created_products:
            listed = ", ".join(created_products[:10]) + (" ..." if len(created_products) > 10 else "")
            warnings.append(f"Created {len(created_products)} products ({listed}); they have no BOM or routing yet, "
                            f"so their COGS is $0 until you import or link them")

        if dry_run or replace_blocked:
            conn.rollback()
        else:
            conn.commit()
    except _HeaderProblem as problem:
        conn.rollback()
        return ForecastResponse(
            status="success",
            data={'imported': 0, 'inserted': 0, 'updated': 0, 'unchanged': 0, 'created_customers': [],
                  'created_products': [], 'errors': [problem.error], 'warnings': [], 'price_sources': {},
                  'dry_run': dry_run, 'mode': mode, 'deleted': 0, 'removed_line_count': 0, 'removed_lines': [],
                  'covered_months': [], 'replace_blocked': mode != 'upsert', 'rows': len(sales), 'records': 0,
                  'blank_rows': 0, 'wide_format': False, 'start_period': None, 'end_period': None,
                  'total_quantity': 0, 'total_revenue': 0},
            message=f"Nothing imported: {problem.error['error']}",
        )
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Error smart importing sales: {str(e)}")
    finally:
        db_manager.close_connection(conn)

    message = (f"Imported {imported_count} sales records ({inserted} new, {updated} updated, {unchanged} "
               f"unchanged). Created {len(created_customers)} customers and {len(created_products)} products.")
    if errors:
        message += f" {len(errors)} rows had errors."
    if deleted:
        message += (f" Removed {deleted} monthly rows ({len(removed_lines)} customer x product lines) of the "
                    f"scenario that the file no longer contains.")
    if replace_blocked:
        message = (f"Nothing was changed: {len(errors)} rows had errors, and a replace import only runs when every "
                   f"row is valid. Fix the rows (or import with mode=upsert) and try again.")
    if dry_run:
        message = "Dry run, nothing written: " + message.replace("Imported", "would import", 1).replace(
            "Removed", "would remove", 1)
    return ForecastResponse(
        status="success",
        data={
            'imported': imported_count,
            'inserted': inserted,
            'updated': updated,
            'unchanged': unchanged,
            'created_customers': created_customers,
            'created_products': created_products,
            'errors': sorted(errors, key=lambda e: e['row']),
            'warnings': warnings,
            'price_sources': price_sources,
            'dry_run': dry_run,
            'mode': mode,
            'deleted': deleted,
            'removed_line_count': len(removed_lines),
            'removed_lines': removed_lines[:50],
            'covered_months': sorted(covered) if mode == 'replace' else [],
            'replace_blocked': replace_blocked,
            'rows': len(sales),
            'records': len(entries),
            'blank_rows': blank_rows,
            'wide_format': wide_format,
            'start_period': min(months) if months else None,
            'end_period': max(months) if months else None,
            'total_quantity': round(total_quantity, 4),
            'total_revenue': round(total_revenue, 2),
        },
        message=message,
    )
