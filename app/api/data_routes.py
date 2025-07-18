from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from db import get_table_data
from db.models import ForecastResponse

router = APIRouter(prefix="/data", tags=["data"])

@router.get("/{table_name}")
async def get_table_data_endpoint(table_name: str, forecast_id: Optional[str] = Query(None)):
    """Get data from a specific table"""
    result = get_table_data(table_name, forecast_id=forecast_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["error"])
    return result