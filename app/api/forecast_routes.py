from fastapi import APIRouter, HTTPException, Query
from typing import Optional, Dict, Any, List
from db import get_forecast_data, get_saved_forecast_results
from db.models import ForecastResponse, SQLApplyRequest
from db import execute_sql
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

@router.get("/scenarios", response_model=ForecastResponse)
async def get_forecast_scenarios():
    """
    Get all available forecast scenarios
    """
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
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving forecast scenarios: {str(e)}")

@router.post("/scenario", response_model=ForecastResponse)
async def create_forecast_scenario(scenario_data: Dict[str, Any]):
    """
    Create a new forecast scenario with auto-generated FXXX ID
    """
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
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating forecast scenario: {str(e)}")

@router.post("/scenario/{forecast_id}/duplicate", response_model=ForecastResponse)
async def duplicate_forecast_scenario(forecast_id: str, scenario_data: Dict[str, Any] = None):
    """Duplicate an existing forecast scenario and its related data"""
    try:
        from db.database import db_manager

        conn = db_manager.get_connection()
        cursor = conn.cursor()

        # Verify source scenario exists
        cursor.execute("SELECT name, description FROM forecast WHERE forecast_id = ?", (forecast_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Forecast scenario not found")

        original_name, original_description = row

        # Generate new forecast ID
        cursor.execute("SELECT forecast_id FROM forecast WHERE forecast_id LIKE 'F%' ORDER BY forecast_id DESC LIMIT 1")
        last_forecast = cursor.fetchone()
        next_number = int(last_forecast[0][1:]) + 1 if last_forecast else 1
        new_forecast_id = f"F{next_number:03d}"

        name = (scenario_data or {}).get('name', f"{original_name} Copy")
        description = (scenario_data or {}).get('description', original_description)

        cursor.execute(
            "INSERT INTO forecast (forecast_id, name, description) VALUES (?, ?, ?)",
            (new_forecast_id, name, description)
        )

        # Duplicate sales
        cursor.execute("SELECT customer_id, unit_id, period, quantity, unit_price, total_revenue FROM sales WHERE forecast_id = ?", (forecast_id,))
        for s in cursor.fetchall():
            cursor.execute(
                """
                INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (f"SAL-{uuid.uuid4().hex[:8].upper()}", s[0], s[1], s[2], s[3], s[4], s[5], new_forecast_id)
            )

        # Duplicate expenses
        cursor.execute("SELECT expense_name, category_id, amount, frequency, start_date, end_date, vendor, description, payment_method, approval_required, approved_by, approval_date, expense_allocation, amortization_months, department, cost_center, is_active FROM expenses WHERE forecast_id = ?", (forecast_id,))
        for e in cursor.fetchall():
            cursor.execute(
                """
                INSERT INTO expenses (expense_id, expense_name, category_id, amount, frequency, start_date, end_date, vendor, description, payment_method, approval_required, approved_by, approval_date, expense_allocation, amortization_months, department, cost_center, is_active, forecast_id, created_date, updated_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"EXP-{uuid.uuid4().hex[:8].upper()}", e[0], e[1], e[2], e[3], e[4], e[5], e[6], e[7], e[8], e[9], e[10], e[11], e[12], e[13], e[14], e[15], e[16], new_forecast_id, datetime.now().isoformat(), datetime.now().isoformat()
                )
            )

        # Duplicate payroll
        cursor.execute("SELECT employee_name, department, weekly_hours, hourly_rate, rate_type, labor_type, start_date, end_date, next_review_date, expected_raise, benefits_eligible, allocations FROM payroll WHERE forecast_id = ?", (forecast_id,))
        for p in cursor.fetchall():
            cursor.execute(
                """
                INSERT INTO payroll (employee_id, employee_name, department, weekly_hours, hourly_rate, rate_type, labor_type, start_date, end_date, next_review_date, expected_raise, benefits_eligible, allocations, forecast_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"EMP-{int(datetime.now().timestamp())}{uuid.uuid4().hex[:4]}", p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], new_forecast_id
                )
            )

        conn.commit()
        db_manager.close_connection(conn)

        return ForecastResponse(
            status="success",
            data={"forecast_id": new_forecast_id, "name": name, "description": description},
            message=f"Forecast scenario {forecast_id} duplicated as {new_forecast_id}"
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error duplicating forecast scenario: {str(e)}")

@router.delete("/scenario/{forecast_id}", response_model=ForecastResponse)
async def delete_forecast_scenario(forecast_id: str):
    """Delete a forecast scenario and its related data"""
    try:
        from db.database import db_manager

        conn = db_manager.get_connection()
        cursor = conn.cursor()

        # Delete related data
        for table in ["sales", "expenses", "payroll"]:
            cursor.execute(f"DELETE FROM {table} WHERE forecast_id = ?", (forecast_id,))

        # Delete scenario
        cursor.execute("DELETE FROM forecast WHERE forecast_id = ?", (forecast_id,))

        conn.commit()
        db_manager.close_connection(conn)

        return ForecastResponse(
            status="success",
            message=f"Forecast scenario {forecast_id} deleted successfully"
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting forecast scenario: {str(e)}")

@router.get("/comparison", response_model=ForecastResponse)
async def compare_forecast_scenarios(
    forecast_ids: List[str] = Query(..., description="Forecast IDs to compare")
):
    """Return aggregate metrics for multiple forecast scenarios"""
    try:
        from db.database import db_manager

        conn = db_manager.get_connection()
        cursor = conn.cursor()

        placeholders = ",".join("?" for _ in forecast_ids)

        cursor.execute(
            f"SELECT forecast_id, SUM(total_revenue) FROM sales WHERE forecast_id IN ({placeholders}) GROUP BY forecast_id",
            forecast_ids,
        )
        sales = {row[0]: row[1] or 0 for row in cursor.fetchall()}

        cursor.execute(
            f"SELECT forecast_id, SUM(amount) FROM expenses WHERE forecast_id IN ({placeholders}) GROUP BY forecast_id",
            forecast_ids,
        )
        expenses = {row[0]: row[1] or 0 for row in cursor.fetchall()}

        cursor.execute(
            f"SELECT forecast_id, SUM(weekly_hours * hourly_rate * 52) FROM payroll WHERE forecast_id IN ({placeholders}) GROUP BY forecast_id",
            forecast_ids,
        )
        payroll = {row[0]: row[1] or 0 for row in cursor.fetchall()}

        db_manager.close_connection(conn)

        comparison = [
            {
                "forecast_id": fid,
                "revenue": float(sales.get(fid, 0) or 0),
                "expenses": float(expenses.get(fid, 0) or 0),
                "payroll": float(payroll.get(fid, 0) or 0),
            }
            for fid in forecast_ids
        ]

        return ForecastResponse(
            status="success",
            data={"comparison": comparison},
            message=f"Compared {len(comparison)} forecast scenarios",
        )
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