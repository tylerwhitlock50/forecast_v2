from fastapi import APIRouter, HTTPException, Query, Request
from typing import Optional

from db import get_table_data


router = APIRouter(prefix="/data", tags=["data"])


@router.get("/{table_name}")
async def get_table_data_endpoint(
    request: Request,
    table_name: str,
    forecast_id: Optional[str] = Query(None),
    limit: Optional[int] = Query(None, ge=0),
    offset: Optional[int] = Query(None, ge=0),
):
    """Get data from a specific table with optional filtering"""
    filters = dict(request.query_params)
    filters.pop("forecast_id", None)
    filters.pop("limit", None)
    filters.pop("offset", None)

    result = get_table_data(
        table_name,
        forecast_id=forecast_id,
        filters=filters or None,
        limit=limit,
        offset=offset,
    )
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["error"])
    return result

