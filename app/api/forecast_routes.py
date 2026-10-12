from fastapi import APIRouter, HTTPException, Query
from typing import Optional, Dict, Any, List, Tuple
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
    Returns computed forecast state with joined data
    """
    result = get_forecast_data()
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["error"])
    
    # If forecast_id is provided, filter the sales data
    if forecast_id and result["data"].get("sales_forecast"):
        result["data"]["sales_forecast"] = [
            sale for sale in result["data"]["sales_forecast"] 
            if sale.get("forecast_id") == forecast_id
        ]
    
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

SCENARIO_TABLES = ("sales", "expenses", "payroll", "capital_expenditures", "financial_assumptions")


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
    """Create an empty scenario with an auto-generated FXXX id."""
    try:
        from db.database import db_manager

        name = (scenario_data.get('name') or '').strip() or 'New Scenario'
        description = scenario_data.get('description') or ''
        notes = scenario_data.get('notes') or ''
        make_base = bool(scenario_data.get('is_base'))

        conn = db_manager.get_connection()
        cursor = conn.cursor()
        try:
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating forecast scenario: {str(e)}")


@router.put("/scenario/{forecast_id}", response_model=ForecastResponse)
async def update_forecast_scenario(forecast_id: str, scenario_data: Dict[str, Any]):
    """Rename, edit description / notes, or mark as the base scenario."""
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
                if field == "name" and not (value or '').strip():
                    raise HTTPException(status_code=422, detail="name cannot be empty")
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
    assumptions and the notes. Optional overrides (applied to the copy only):

    * price_multiplier     - scales unit_price on every copied sales row
    * quantity_multiplier  - scales quantity on every copied sales row
    * extend_periods       - adds N monthly periods after the last sales
                             month, repeating each customer/product line from
                             that month (after the multipliers)
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

            new_forecast_id = _next_forecast_id(cursor)
            name = (body.get('name') or '').strip() or f"{original_name} Copy"
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
            if start_period and end_period:
                window = (start_period, end_period)
            else:
                placeholders = ",".join("?" for _ in ids)
                cursor.execute(
                    f"SELECT MIN(period), MAX(period) FROM sales WHERE forecast_id IN ({placeholders}) AND period IS NOT NULL",
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
                    "revenue": 0.0, "cogs": 0.0, "gross_profit": 0.0,
                    "payroll": 0.0, "expenses": 0.0, "operating_income": 0.0, "net_income": 0.0,
                    "closing_cash": None,
                }
                if window:
                    stmt = build_statements(cursor, [fid], window[0], window[1])
                    t = stmt["income_statement"]["totals"]
                    row.update({
                        "revenue": t.get("revenue", 0.0),
                        "cogs": t.get("total_cogs", 0.0),
                        "gross_profit": t.get("gross_profit", 0.0),
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
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error comparing forecast scenarios: {str(e)}"
        )


@router.get("/results", response_model=ForecastResponse)
async def get_saved_forecast_results_endpoint(
    period: Optional[str] = Query(None, description="Filter by period (e.g., '2024-01')"),
    limit: Optional[int] = Query(None, description="Limit number of results")
):
    """
    Get saved forecast results from the database
    """
    result = get_saved_forecast_results(period=period, limit=limit)
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

@router.post("/bulk_create_customers", response_model=ForecastResponse)
async def bulk_create_customers(customers_data: Dict[str, Any]):
    """
    Bulk create customers from CSV import
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        customers = customers_data.get('customers', [])
        options = customers_data.get('options', {})
        merge_strategy = options.get('merge_strategy', 'skip')  # 'skip', 'update', 'create_new'
        
        if not customers:
            raise HTTPException(status_code=400, detail="No customer data provided")
        
        created_count = 0
        updated_count = 0
        skipped_count = 0
        errors = []
        
        for idx, customer in enumerate(customers):
            try:
                customer_id = customer.get('customer_id')
                customer_name = customer.get('customer_name', '')
                
                if not customer_id or not customer_name:
                    errors.append({
                        'row': idx + 1,
                        'error': 'Missing customer_id or customer_name'
                    })
                    continue
                
                # Check if customer exists
                cursor.execute("SELECT customer_id FROM customers WHERE customer_id = ?", (customer_id,))
                exists = cursor.fetchone()
                
                if exists:
                    if merge_strategy == 'skip':
                        skipped_count += 1
                        continue
                    elif merge_strategy == 'update':
                        cursor.execute("""
                            UPDATE customers 
                            SET customer_name = ?, customer_type = ?, region = ?
                            WHERE customer_id = ?
                        """, (
                            customer_name,
                            customer.get('customer_type', ''),
                            customer.get('region', ''),
                            customer_id
                        ))
                        updated_count += 1
                    elif merge_strategy == 'create_new':
                        # Generate new ID
                        cursor.execute("SELECT customer_id FROM customers ORDER BY customer_id DESC LIMIT 1")
                        last = cursor.fetchone()
                        if last and last[0].startswith('CUST-'):
                            num = int(last[0].split('-')[1]) + 1
                            customer_id = f"CUST-{num:03d}"
                        else:
                            customer_id = "CUST-001"
                        cursor.execute("""
                            INSERT INTO customers (customer_id, customer_name, customer_type, region)
                            VALUES (?, ?, ?, ?)
                        """, (
                            customer_id,
                            customer_name,
                            customer.get('customer_type', ''),
                            customer.get('region', '')
                        ))
                        created_count += 1
                else:
                    cursor.execute("""
                        INSERT INTO customers (customer_id, customer_name, customer_type, region)
                        VALUES (?, ?, ?, ?)
                    """, (
                        customer_id,
                        customer_name,
                        customer.get('customer_type', ''),
                        customer.get('region', '')
                    ))
                    created_count += 1
            except Exception as e:
                errors.append({
                    'row': idx + 1,
                    'error': str(e)
                })
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={
                'created': created_count,
                'updated': updated_count,
                'skipped': skipped_count,
                'errors': errors
            },
            message=f"Processed {len(customers)} customers: {created_count} created, {updated_count} updated, {skipped_count} skipped"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error bulk creating customers: {str(e)}")

@router.post("/bulk_create_products", response_model=ForecastResponse)
async def bulk_create_products(products_data: Dict[str, Any]):
    """
    Bulk create products from CSV import
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        products = products_data.get('products', [])
        options = products_data.get('options', {})
        merge_strategy = options.get('merge_strategy', 'skip')  # 'skip', 'update', 'create_new'
        
        if not products:
            raise HTTPException(status_code=400, detail="No product data provided")
        
        created_count = 0
        updated_count = 0
        skipped_count = 0
        errors = []
        
        for idx, product in enumerate(products):
            try:
                unit_id = product.get('unit_id') or product.get('product_id')
                unit_name = product.get('unit_name') or product.get('product_name', '')
                
                if not unit_id or not unit_name:
                    errors.append({
                        'row': idx + 1,
                        'error': 'Missing unit_id or unit_name'
                    })
                    continue
                
                # Check if product exists
                cursor.execute("SELECT unit_id FROM units WHERE unit_id = ?", (unit_id,))
                exists = cursor.fetchone()
                
                if exists:
                    if merge_strategy == 'skip':
                        skipped_count += 1
                        continue
                    elif merge_strategy == 'update':
                        cursor.execute("""
                            UPDATE units 
                            SET unit_name = ?, unit_description = ?, base_price = ?, unit_type = ?, bom_id = ?, router_id = ?
                            WHERE unit_id = ?
                        """, (
                            unit_name,
                            product.get('unit_description', ''),
                            product.get('base_price', 0) or 0,
                            product.get('unit_type', ''),
                            product.get('bom_id', ''),
                            product.get('router_id', ''),
                            unit_id
                        ))
                        updated_count += 1
                    elif merge_strategy == 'create_new':
                        # Generate new ID
                        cursor.execute("SELECT unit_id FROM units ORDER BY unit_id DESC LIMIT 1")
                        last = cursor.fetchone()
                        if last and last[0].startswith('PROD-'):
                            num = int(last[0].split('-')[1]) + 1
                            unit_id = f"PROD-{num:03d}"
                        else:
                            unit_id = "PROD-001"
                        cursor.execute("""
                            INSERT INTO units (unit_id, unit_name, unit_description, base_price, unit_type, bom_id, router_id)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, (
                            unit_id,
                            unit_name,
                            product.get('unit_description', ''),
                            product.get('base_price', 0) or 0,
                            product.get('unit_type', ''),
                            product.get('bom_id', ''),
                            product.get('router_id', '')
                        ))
                        created_count += 1
                else:
                    cursor.execute("""
                        INSERT INTO units (unit_id, unit_name, unit_description, base_price, unit_type, bom_id, router_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, (
                        unit_id,
                        unit_name,
                        product.get('unit_description', ''),
                        product.get('base_price', 0) or 0,
                        product.get('unit_type', ''),
                        product.get('bom_id', ''),
                        product.get('router_id', '')
                    ))
                    created_count += 1
            except Exception as e:
                errors.append({
                    'row': idx + 1,
                    'error': str(e)
                })
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={
                'created': created_count,
                'updated': updated_count,
                'skipped': skipped_count,
                'errors': errors
            },
            message=f"Processed {len(products)} products: {created_count} created, {updated_count} updated, {skipped_count} skipped"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error bulk creating products: {str(e)}")

@router.post("/smart_import_sales", response_model=ForecastResponse)
async def smart_import_sales(sales_data: Dict[str, Any]):
    """
    Smart import sales forecast with auto-creation of missing customers/products
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        sales = sales_data.get('sales', [])
        options = sales_data.get('options', {})
        auto_create = options.get('autoCreate', True)
        forecast_id = sales_data.get('forecast_id')

        if not sales:
            raise HTTPException(status_code=400, detail="No sales data provided")
        if not forecast_id:
            raise HTTPException(status_code=400, detail="forecast_id is required")
        
        # Get existing customers and products
        cursor.execute("SELECT customer_id, customer_name FROM customers")
        existing_customers = {row[0]: row[1] for row in cursor.fetchall()}
        
        cursor.execute("SELECT unit_id, unit_name FROM units")
        existing_products = {row[0]: row[1] for row in cursor.fetchall()}
        
        # Detect missing items
        missing_customers = {}
        missing_products = {}
        
        for sale in sales:
            customer_id = sale.get('customer_id')
            product_id = sale.get('product_id') or sale.get('unit_id')
            
            if customer_id and customer_id not in existing_customers:
                if customer_id not in missing_customers:
                    missing_customers[customer_id] = customer_id
            
            if product_id and product_id not in existing_products:
                if product_id not in missing_products:
                    missing_products[product_id] = product_id
        
        # Auto-create missing items if enabled
        created_customers = []
        created_products = []
        
        if auto_create and missing_customers:
            for customer_id in missing_customers.keys():
                try:
                    cursor.execute("""
                        INSERT INTO customers (customer_id, customer_name, customer_type, region)
                        VALUES (?, ?, ?, ?)
                    """, (customer_id, customer_id, 'Unknown', 'Unknown'))
                    created_customers.append(customer_id)
                    existing_customers[customer_id] = customer_id
                except sqlite3.IntegrityError:
                    pass  # Already exists
        
        if auto_create and missing_products:
            for product_id in missing_products.keys():
                try:
                    cursor.execute("""
                        INSERT INTO units (unit_id, unit_name, base_price)
                        VALUES (?, ?, ?)
                    """, (product_id, product_id, 0))
                    created_products.append(product_id)
                    existing_products[product_id] = product_id
                except sqlite3.IntegrityError:
                    pass  # Already exists
        
        # Import sales data
        imported_count = 0
        errors = []
        
        for idx, sale in enumerate(sales):
            try:
                customer_id = sale.get('customer_id')
                product_id = sale.get('product_id') or sale.get('unit_id')
                period = sale.get('period', '')
                quantity = float(sale.get('quantity', 0))
                price = float(sale.get('price') or sale.get('unit_price', 0))
                
                # Validate
                if not customer_id or not product_id or not period:
                    errors.append({
                        'row': idx + 1,
                        'error': 'Missing required fields'
                    })
                    continue
                
                if customer_id not in existing_customers:
                    errors.append({
                        'row': idx + 1,
                        'error': f'Customer {customer_id} does not exist'
                    })
                    continue
                
                if product_id not in existing_products:
                    errors.append({
                        'row': idx + 1,
                        'error': f'Product {product_id} does not exist'
                    })
                    continue
                
                # Normalize period to standard format (YYYY-MM, YYYY-QX, or YYYY-WXX)
                from utils.period_normalizer import normalize_period
                normalized_period = normalize_period(period)
                if normalized_period:
                    period = normalized_period
                else:
                    errors.append({
                        'row': idx + 1,
                        'error': f'Invalid period format: {period}'
                    })
                    continue
                
                sale_id = f"SAL-{uuid.uuid4().hex[:8].upper()}"
                total_revenue = quantity * price
                
                # Check if exists
                cursor.execute("""
                    SELECT sale_id FROM sales 
                    WHERE customer_id = ? AND unit_id = ? AND period = ? AND forecast_id = ?
                """, (customer_id, product_id, period, forecast_id))
                
                if cursor.fetchone():
                    # Update existing
                    cursor.execute("""
                        UPDATE sales 
                        SET quantity = ?, unit_price = ?, total_revenue = ?
                        WHERE customer_id = ? AND unit_id = ? AND period = ? AND forecast_id = ?
                    """, (quantity, price, total_revenue, customer_id, product_id, period, forecast_id))
                else:
                    # Insert new
                    cursor.execute("""
                        INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (sale_id, customer_id, product_id, period, quantity, price, total_revenue, forecast_id))
                
                imported_count += 1
            except Exception as e:
                errors.append({
                    'row': idx + 1,
                    'error': str(e)
                })
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={
                'imported': imported_count,
                'created_customers': created_customers,
                'created_products': created_products,
                'errors': errors
            },
            message=f"Imported {imported_count} sales records. Created {len(created_customers)} customers and {len(created_products)} products."
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error smart importing sales: {str(e)}")