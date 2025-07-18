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