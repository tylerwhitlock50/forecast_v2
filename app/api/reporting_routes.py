"""
Reporting API: financial statements, budget-vs-actual, and the planning
inputs that feed them (assumptions, capex, actuals).

All statement maths lives in services.financial_statements; this module
only handles HTTP concerns and persistence of the planning inputs.
"""
import csv
import io
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from db.database import db_manager
from db.models import (
    ActualsUpsertRequest,
    CapitalExpenditureCreate,
    CapitalExpenditureUpdate,
    FinancialAssumptionsUpdate,
    ForecastResponse,
)
from services.financial_statements import (
    DEFAULT_ASSUMPTIONS,
    VARIANCE_LINE_ITEMS,
    build_statements,
    build_variance,
    load_actuals,
    load_assumptions,
    period_range,
    statements_to_rows,
    validate_period,
)

router = APIRouter(prefix="/reporting", tags=["reporting"])
logger = logging.getLogger(__name__)


def _parse_forecast_ids(forecast_ids: List[str]) -> List[str]:
    """Accept both repeated query params and a single comma-separated value."""
    out: List[str] = []
    for value in forecast_ids or []:
        out.extend(v.strip() for v in str(value).split(",") if v.strip())
    if not out:
        raise HTTPException(status_code=422, detail="At least one forecast_id is required")
    return out


def _check_window(start_period: str, end_period: str) -> None:
    try:
        period_range(start_period, end_period)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


# ---------------------------------------------------------------------------
# Statements
# ---------------------------------------------------------------------------

@router.get("/statements", response_model=ForecastResponse)
async def get_financial_statements(
    forecast_ids: List[str] = Query(..., description="Forecast IDs (repeat or comma-separate)"),
    start_period: str = Query(..., description="Start period (YYYY-MM)"),
    end_period: str = Query(..., description="End period (YYYY-MM)"),
    include_raises: bool = Query(True, description="Apply scheduled payroll raises"),
):
    """Period-by-period income statement, cash flow and balance sheet."""
    ids = _parse_forecast_ids(forecast_ids)
    _check_window(start_period, end_period)
    conn = db_manager.get_connection()
    try:
        statements = build_statements(conn.cursor(), ids, start_period, end_period, include_raises=include_raises)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.exception("Error building financial statements")
        raise HTTPException(status_code=500, detail=f"Error building financial statements: {exc}")
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(
        status="success",
        data=statements,
        message=f"Built statements for {len(statements['periods'])} period(s)",
    )


# Backward-compatible alias for callers of the old endpoint name.
@router.get("/financial-statements", response_model=ForecastResponse, include_in_schema=False)
async def get_financial_statements_legacy(
    forecast_ids: List[str] = Query(...),
    start_period: str = Query(...),
    end_period: str = Query(...),
):
    return await get_financial_statements(forecast_ids, start_period, end_period, True)


@router.get("/statements/export")
async def export_financial_statements(
    forecast_ids: List[str] = Query(...),
    start_period: str = Query(...),
    end_period: str = Query(...),
    layout: str = Query("wide", description="'wide' (one column per period) or 'long'"),
):
    """Download the statements as CSV."""
    ids = _parse_forecast_ids(forecast_ids)
    _check_window(start_period, end_period)
    conn = db_manager.get_connection()
    try:
        statements = build_statements(conn.cursor(), ids, start_period, end_period)
    finally:
        db_manager.close_connection(conn)

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    if layout == "long":
        writer.writerow(["statement", "period", "line_item", "amount"])
        for row in statements_to_rows(statements):
            writer.writerow([row["statement"], row["period"], row["line_item"], row["amount"]])
    else:
        periods = statements["periods"]
        for key, label in (("income_statement", "Income Statement"),
                           ("cash_flow", "Cash Flow"),
                           ("balance_sheet", "Balance Sheet")):
            rows = statements[key]["by_period"]
            writer.writerow([label] + periods + (["Total"] if key != "balance_sheet" else []))
            line_keys = [k for k in rows[0].keys() if k != "period"] if rows else []
            totals = statements[key].get("totals", {})
            for line in line_keys:
                values = [r.get(line, "") for r in rows]
                extra = [totals.get(line, "")] if key != "balance_sheet" else []
                writer.writerow([line] + values + extra)
            writer.writerow([])

    filename = f"financial_statements_{start_period}_{end_period}.csv"
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Budget vs actual
# ---------------------------------------------------------------------------

@router.get("/variance", response_model=ForecastResponse)
async def get_variance(
    forecast_ids: List[str] = Query(...),
    start_period: str = Query(...),
    end_period: str = Query(...),
):
    """Budget (from the statements) versus recorded actuals, by line and period."""
    ids = _parse_forecast_ids(forecast_ids)
    _check_window(start_period, end_period)
    conn = db_manager.get_connection()
    try:
        variance = build_variance(conn.cursor(), ids, start_period, end_period)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        logger.exception("Error building variance report")
        raise HTTPException(status_code=500, detail=f"Error building variance report: {exc}")
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data=variance, message="Variance report built")


@router.get("/actuals/line-items", response_model=ForecastResponse)
async def get_actual_line_items():
    """The statement lines actuals can be recorded against."""
    items = [{"line_item": k, **v} for k, v in VARIANCE_LINE_ITEMS.items()]
    return ForecastResponse(status="success", data={"line_items": items}, message="Line items")


@router.get("/actuals", response_model=ForecastResponse)
async def get_actuals(
    start_period: str = Query(...),
    end_period: str = Query(...),
):
    _check_window(start_period, end_period)
    conn = db_manager.get_connection()
    try:
        rows = load_actuals(conn.cursor(), start_period, end_period)
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data={"actuals": rows}, message=f"Retrieved {len(rows)} actuals")


def _upsert_actuals(cursor, entries: List[Dict[str, Any]]) -> int:
    count = 0
    for entry in entries:
        period = validate_period(entry["period"])
        line_item = str(entry["line_item"]).strip()
        if line_item not in VARIANCE_LINE_ITEMS:
            raise ValueError(f"Unknown line_item '{line_item}'")
        reference_id = entry.get("reference_id") or ""
        cursor.execute(
            """
            INSERT INTO actuals (actual_id, period, line_item, amount, reference_id, source, notes, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(period, line_item, reference_id) DO UPDATE SET
                amount = excluded.amount,
                source = excluded.source,
                notes = excluded.notes,
                updated_at = CURRENT_TIMESTAMP
            """,
            (f"ACT-{uuid.uuid4().hex[:10]}", period, line_item, float(entry["amount"]),
             reference_id, entry.get("source"), entry.get("notes")),
        )
        count += 1
    return count


@router.post("/actuals", response_model=ForecastResponse)
async def upsert_actuals(request: ActualsUpsertRequest):
    """Create or update actuals; (period, line_item, reference_id) is the key."""
    conn = db_manager.get_connection()
    try:
        count = _upsert_actuals(conn.cursor(), [e.dict() for e in request.entries])
        conn.commit()
    except ValueError as exc:
        conn.rollback()
        raise HTTPException(status_code=422, detail=str(exc))
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data={"saved": count}, message=f"Saved {count} actual(s)")


@router.post("/actuals/import", response_model=ForecastResponse)
async def import_actuals(file: UploadFile = File(...), source: Optional[str] = Query(None)):
    """
    Import actuals from CSV with columns: period, line_item, amount
    (optional: reference_id, notes).
    """
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=422, detail="File must be UTF-8 encoded CSV")
    reader = csv.DictReader(io.StringIO(text))
    required = {"period", "line_item", "amount"}
    if not reader.fieldnames or not required.issubset({f.strip().lower() for f in reader.fieldnames}):
        raise HTTPException(status_code=422, detail="CSV must have columns: period, line_item, amount")

    entries: List[Dict[str, Any]] = []
    errors: List[str] = []
    for i, row in enumerate(reader, start=2):
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
        if not row.get("period") and not row.get("line_item"):
            continue
        try:
            amount = float(str(row.get("amount", "")).replace(",", "").replace("$", ""))
        except ValueError:
            errors.append(f"Row {i}: invalid amount '{row.get('amount')}'")
            continue
        entries.append({
            "period": row.get("period"),
            "line_item": row.get("line_item"),
            "amount": amount,
            "reference_id": row.get("reference_id", ""),
            "notes": row.get("notes"),
            "source": source or file.filename,
        })

    conn = db_manager.get_connection()
    try:
        count = _upsert_actuals(conn.cursor(), entries)
        conn.commit()
    except ValueError as exc:
        conn.rollback()
        raise HTTPException(status_code=422, detail=str(exc))
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(
        status="success",
        data={"imported": count, "errors": errors},
        message=f"Imported {count} actual(s)" + (f", {len(errors)} row(s) skipped" if errors else ""),
    )


@router.delete("/actuals", response_model=ForecastResponse)
async def delete_actuals(
    period: Optional[str] = Query(None, description="Delete all actuals for this period"),
    line_item: Optional[str] = Query(None),
    actual_id: Optional[str] = Query(None),
):
    if not any([period, line_item, actual_id]):
        raise HTTPException(status_code=422, detail="Provide actual_id, period and/or line_item")
    clauses, params = [], []
    if actual_id:
        clauses.append("actual_id = ?"); params.append(actual_id)
    if period:
        clauses.append("period = ?"); params.append(validate_period(period))
    if line_item:
        clauses.append("line_item = ?"); params.append(line_item)
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(f"DELETE FROM actuals WHERE {' AND '.join(clauses)}", params)
        deleted = cursor.rowcount
        conn.commit()
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data={"deleted": deleted}, message=f"Deleted {deleted} actual(s)")


# ---------------------------------------------------------------------------
# Assumptions
# ---------------------------------------------------------------------------

@router.get("/assumptions", response_model=ForecastResponse)
async def get_assumptions(forecast_id: str = Query(...)):
    conn = db_manager.get_connection()
    try:
        assumptions, found = load_assumptions(conn.cursor(), forecast_id)
    finally:
        db_manager.close_connection(conn)
    assumptions = {**assumptions, "forecast_id": forecast_id, "found": found}
    return ForecastResponse(
        status="success",
        data={"assumptions": assumptions, "defaults": DEFAULT_ASSUMPTIONS},
        message="Assumptions retrieved" if found else "No saved assumptions; defaults returned",
    )


@router.put("/assumptions", response_model=ForecastResponse)
async def save_assumptions(forecast_id: str = Query(...), payload: FinancialAssumptionsUpdate = None):
    if payload is None:
        raise HTTPException(status_code=422, detail="Request body required")
    if payload.opening_period:
        try:
            validate_period(payload.opening_period)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
    data = payload.dict()
    # Optional newer fields: leaving them out keeps the stored value, so an
    # older client that does not know the field cannot reset it.
    for optional_key in ("excise_payable_days",):
        if data.get(optional_key) is None:
            data.pop(optional_key, None)
        elif float(data[optional_key]) < 0:
            raise HTTPException(status_code=422, detail=f"{optional_key} must be zero or more")
    columns = list(data.keys())
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM forecast WHERE forecast_id = ?", (forecast_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail=f"Forecast '{forecast_id}' not found")
        placeholders = ", ".join("?" for _ in columns)
        updates = ", ".join(f"{c} = excluded.{c}" for c in columns)
        cursor.execute(
            f"""
            INSERT INTO financial_assumptions (forecast_id, {', '.join(columns)}, updated_at)
            VALUES (?, {placeholders}, CURRENT_TIMESTAMP)
            ON CONFLICT(forecast_id) DO UPDATE SET {updates}, updated_at = CURRENT_TIMESTAMP
            """,
            [forecast_id] + [data[c] for c in columns],
        )
        conn.commit()
        assumptions, _ = load_assumptions(cursor, forecast_id)
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data={"assumptions": assumptions}, message="Assumptions saved")


# ---------------------------------------------------------------------------
# Capital expenditures
# ---------------------------------------------------------------------------

def _capex_rows(cursor, forecast_id: Optional[str]) -> List[Dict[str, Any]]:
    if forecast_id:
        cursor.execute(
            "SELECT * FROM capital_expenditures WHERE forecast_id = ? OR forecast_id IS NULL ORDER BY purchase_period, asset_name",
            (forecast_id,),
        )
    else:
        cursor.execute("SELECT * FROM capital_expenditures ORDER BY purchase_period, asset_name")
    columns = [d[0] for d in cursor.description]
    rows = []
    for row in cursor.fetchall():
        item = dict(zip(columns, row))
        item["is_active"] = bool(item.get("is_active", 1))
        rows.append(item)
    return rows


@router.get("/capex", response_model=ForecastResponse)
async def list_capex(forecast_id: Optional[str] = Query(None)):
    conn = db_manager.get_connection()
    try:
        rows = _capex_rows(conn.cursor(), forecast_id)
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data={"capex": rows}, message=f"Retrieved {len(rows)} capital item(s)")


@router.post("/capex", response_model=ForecastResponse)
async def create_capex(item: CapitalExpenditureCreate):
    try:
        validate_period(item.purchase_period)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if item.useful_life_months < 0 or item.amount < 0:
        raise HTTPException(status_code=422, detail="amount and useful_life_months must be non-negative")
    capex_id = f"CAPEX-{uuid.uuid4().hex[:8].upper()}"
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO capital_expenditures (
                capex_id, forecast_id, asset_name, category, amount, purchase_period,
                useful_life_months, salvage_value, depreciation_method, description, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (capex_id, item.forecast_id, item.asset_name, item.category, item.amount, item.purchase_period,
             item.useful_life_months, item.salvage_value, item.depreciation_method, item.description,
             1 if item.is_active else 0),
        )
        conn.commit()
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data={"capex_id": capex_id}, message="Capital item created")


@router.put("/capex/{capex_id}", response_model=ForecastResponse)
async def update_capex(capex_id: str, item: CapitalExpenditureUpdate):
    updates = item.dict(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")
    if "purchase_period" in updates and updates["purchase_period"]:
        try:
            validate_period(updates["purchase_period"])
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
    if "is_active" in updates and updates["is_active"] is not None:
        updates["is_active"] = 1 if updates["is_active"] else 0
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM capital_expenditures WHERE capex_id = ?", (capex_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Capital item not found")
        assignments = ", ".join(f"{k} = ?" for k in updates)
        cursor.execute(
            f"UPDATE capital_expenditures SET {assignments}, updated_at = CURRENT_TIMESTAMP WHERE capex_id = ?",
            list(updates.values()) + [capex_id],
        )
        conn.commit()
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data={"capex_id": capex_id}, message="Capital item updated")


@router.delete("/capex/{capex_id}", response_model=ForecastResponse)
async def delete_capex(capex_id: str):
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM capital_expenditures WHERE capex_id = ?", (capex_id,))
        deleted = cursor.rowcount
        conn.commit()
    finally:
        db_manager.close_connection(conn)
    if not deleted:
        raise HTTPException(status_code=404, detail="Capital item not found")
    return ForecastResponse(status="success", data={"capex_id": capex_id}, message="Capital item deleted")
