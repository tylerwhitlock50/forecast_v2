from fastapi import APIRouter, HTTPException, Query, Request
from typing import Optional

from db import get_table_data


router = APIRouter(prefix="/data", tags=["data"])


@router.get("/health")
async def data_health_check():
    """Quick health check for data endpoints - returns database status"""
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Get table count and total rows quickly
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
        table_count = cursor.fetchone()[0]
        
        # Check key tables for data
        key_tables = ['customers', 'units', 'sales', 'forecast']
        table_status = {}
        total_rows = 0
        
        for table in key_tables:
            try:
                cursor.execute(f"SELECT COUNT(*) FROM {table}")
                count = cursor.fetchone()[0]
                table_status[table] = count
                total_rows += count
            except:
                table_status[table] = 0
        
        db_manager.close_connection(conn)
        
        return {
            "status": "success",
            "database_healthy": True,
            "table_count": table_count,
            "total_rows": total_rows,
            "has_data": total_rows > 0,
            "key_tables": table_status
        }
        
    except Exception as e:
        return {
            "status": "error", 
            "database_healthy": False,
            "error": str(e)
        }


@router.get("/{table_name}")
async def get_table_data_endpoint(
    request: Request,
    table_name: str,
    forecast_id: Optional[str] = Query(None),
    limit: Optional[int] = Query(None, ge=0),
    offset: Optional[int] = Query(None, ge=0),
):
    """Get data from a specific table with optional filtering"""
    try:
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
        
        # Enhance response with metadata for better frontend handling
        enhanced_result = {
            "status": result["status"],
            "data": result.get("data", []),
            "columns": result.get("columns", []),
            "metadata": {
                "table_name": table_name,
                "row_count": len(result.get("data", [])),
                "has_data": len(result.get("data", [])) > 0,
                "forecast_id": forecast_id,
                "filters_applied": bool(filters),
                "limit": limit,
                "offset": offset
            }
        }
        
        return enhanced_result
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Error fetching data from table '{table_name}': {str(e)}"
        )

