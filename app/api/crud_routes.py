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

@router.post("/bulk_update", response_model=ForecastResponse)
async def bulk_update_forecast(bulk_data: Dict[str, Any]):
    """
    Bulk update forecast data with operations: add, subtract, replace
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        forecasts = bulk_data.get('forecasts', [])
        operation = bulk_data.get('operation', 'replace')  # Default to replace
        
        if not forecasts:
            raise HTTPException(status_code=400, detail="No forecast data provided")
        
        updated_count = 0
        
        for forecast in forecasts:
            # Check if record exists
            cursor.execute("""
                SELECT quantity, unit_price, total_revenue
                FROM sales 
                WHERE customer_id = ? AND unit_id = ? AND period = ? AND forecast_id = ?
            """, (
                forecast.get('customer_id'),
                forecast.get('unit_id'),
                forecast.get('period'),
                forecast.get('forecast_id', 'F001')
            ))
            
            existing_record = cursor.fetchone()
            
            if existing_record:
                # Record exists - apply operation
                existing_quantity, existing_price, existing_revenue = existing_record
                new_quantity = existing_quantity
                new_price = existing_price
                
                if operation == 'add':
                    new_quantity = existing_quantity + forecast.get('quantity', 0)
                    new_price = forecast.get('unit_price', existing_price)  # Use new price if provided
                elif operation == 'subtract':
                    new_quantity = max(0, existing_quantity - forecast.get('quantity', 0))
                    new_price = existing_price  # Keep existing price
                elif operation == 'replace':
                    new_quantity = forecast.get('quantity', 0)
                    new_price = forecast.get('unit_price', 0)
                
                new_revenue = new_quantity * new_price
                
                cursor.execute("""
                    UPDATE sales SET quantity = ?, unit_price = ?, total_revenue = ?
                    WHERE customer_id = ? AND unit_id = ? AND period = ? AND forecast_id = ?
                """, (
                    new_quantity,
                    new_price,
                    new_revenue,
                    forecast.get('customer_id'),
                    forecast.get('unit_id'),
                    forecast.get('period'),
                    forecast.get('forecast_id', 'F001')
                ))
            else:
                # Record doesn't exist - insert new one
                sale_id = str(uuid.uuid4())
                cursor.execute("""
                    INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    sale_id,
                    forecast.get('customer_id'),
                    forecast.get('unit_id'),
                    forecast.get('period'),
                    forecast.get('quantity', 0),
                    forecast.get('unit_price', 0),
                    forecast.get('total_revenue', 0),
                    forecast.get('forecast_id', 'F001')
                ))
            
            updated_count += 1
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"updated_count": updated_count},
            message=f"Bulk updated {updated_count} forecast records using {operation} operation"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error bulk updating forecast: {str(e)}")

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

@router.post("/create", response_model=ForecastResponse)
async def create_forecast_endpoint(forecast_data: Dict[str, Any]):
    """
    Create new forecast data
    """
    conn = None
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Handle direct sales data from frontend
        if forecast_data.get('sales'):
            sales = forecast_data['sales']
            sale_id = str(uuid.uuid4())
            cursor.execute("""
                INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                sale_id, 
                sales['customer_id'], 
                sales['unit_id'], 
                sales['period'], 
                sales['quantity'], 
                sales['unit_price'], 
                sales['total_revenue'],
                sales.get('forecast_id')
            ))
            
            conn.commit()
            
            return ForecastResponse(
                status="success",
                message="Sales data created successfully"
            )
        
        # Handle general table creation
        elif forecast_data.get('table') and forecast_data.get('data'):
            table_name = forecast_data['table']
            data = forecast_data['data']
            
            # Get table columns
            cursor.execute(f"PRAGMA table_info({table_name})")
            columns = cursor.fetchall()
            column_names = [col[1] for col in columns]
            
            # Filter data to only include valid columns
            valid_data = {k: v for k, v in data.items() if k in column_names}
            
            if not valid_data:
                raise HTTPException(status_code=400, detail=f"No valid columns found for table {table_name}")
            
            # Build INSERT query
            columns_str = ", ".join(valid_data.keys())
            placeholders = ", ".join(["?" for _ in valid_data])
            values = list(valid_data.values())
            
            cursor.execute(f"INSERT INTO {table_name} ({columns_str}) VALUES ({placeholders})", values)
            
            conn.commit()
            
            return ForecastResponse(
                status="success",
                message=f"Record created successfully in {table_name}"
            )
        
        else:
            raise HTTPException(status_code=400, detail="Invalid or missing data structure")
        
    except HTTPException:
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
    Update existing forecast data
    """
    conn = None
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        table_name = update_data.get('table')
        record_id = update_data.get('id')
        updates = update_data.get('updates', {})
        
        if not table_name or not record_id:
            raise HTTPException(status_code=400, detail="Table name and record ID are required")
        
        # Handle router_operations compound key (router_id + sequence)
        if table_name == 'router_operations' and record_id:
            # For router_operations, record_id should be in format "router_id-sequence"
            if '-' not in str(record_id):
                raise HTTPException(status_code=400, detail=f"Invalid router_operations record_id: {record_id}. Expected format: router_id-sequence")
        
        # Get the primary key column name for the table
        cursor.execute(f"PRAGMA table_info({table_name})")
        columns = cursor.fetchall()
        primary_key = None
        
        for col in columns:
            if col[5] == 1:  # Primary key flag
                primary_key = col[1]
                break
        
        if not primary_key:
            # If no primary key found, use common naming conventions
            if table_name == 'sales':
                primary_key = 'sale_id'
            elif table_name == 'customers':
                primary_key = 'customer_id'
            elif table_name == 'units':
                primary_key = 'unit_id'
            elif table_name == 'machines':
                primary_key = 'machine_id'
            elif table_name == 'payroll':
                primary_key = 'employee_id'
            elif table_name == 'labor_rates':
                primary_key = 'rate_id'
            elif table_name == 'router_definitions':
                primary_key = 'router_id'
            elif table_name == 'router_operations':
                primary_key = 'operation_id'
            else:
                primary_key = 'id'
        
        # Validate update columns and filter out unknown keys (be forgiving)
        column_names = [col[1] for col in columns]
        invalid_columns = [col for col in updates.keys() if col not in column_names]
        # Only keep valid columns in the update set
        updates = {k: v for k, v in updates.items() if k in column_names}
        if not updates:
            # No valid fields to update
            raise HTTPException(status_code=400, detail=f"No valid columns to update for table {table_name}. Valid columns: {column_names}")
        
        # Special handling for BOM table with composite keys
        if table_name == 'bom' and '-' in record_id:
            # Handle composite key format: bom_id-version-bom_line
            # For BOM-001-1.0-1, we need to parse more carefully
            parts = record_id.split('-')
            if len(parts) >= 3:
                # Handle cases where BOM ID contains hyphens (e.g., BOM-001)
                # Last part is bom_line, second to last is version
                bom_line = parts[-1]
                version = parts[-2]
                bom_id = '-'.join(parts[:-2])
                
                # Build update query for composite key
                set_clause = ", ".join([f"{key} = ?" for key in updates.keys()])
                values = list(updates.values()) + [bom_id, version, bom_line]
                
                cursor.execute(f"UPDATE {table_name} SET {set_clause} WHERE bom_id = ? AND version = ? AND bom_line = ?", values)
            else:
                raise HTTPException(status_code=400, detail="Invalid BOM record ID format. Expected: bom_id-version-bom_line")
        # Special handling for router_operations table with compound key (router_id + sequence)
        elif table_name == 'router_operations' and '-' in str(record_id):
            # Handle compound key format: router_id-sequence
            parts = str(record_id).split('-')
            if len(parts) >= 2:
                router_id = parts[0]
                sequence = parts[1]
                
                # Build update query for compound key
                set_clause = ", ".join([f"{key} = ?" for key in updates.keys()])
                values = list(updates.values()) + [router_id, sequence]
                
                cursor.execute(f"UPDATE {table_name} SET {set_clause} WHERE router_id = ? AND sequence = ?", values)
            else:
                raise HTTPException(status_code=400, detail="Invalid router_operations record ID format. Expected: router_id-sequence")
        else:
            # Standard single-key update
            # Build update query dynamically
            set_clause = ", ".join([f"{key} = ?" for key in updates.keys()])
            values = list(updates.values()) + [record_id]
            
            cursor.execute(f"UPDATE {table_name} SET {set_clause} WHERE {primary_key} = ?", values)
        
        conn.commit()
        
        # Build a helpful message including ignored columns if any
        extra = f" (ignored unknown: {invalid_columns})" if invalid_columns else ""
        return ForecastResponse(
            status="success",
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

@router.delete("/delete/{table_name}/{record_id}", response_model=ForecastResponse)
async def delete_forecast_record(
    table_name: str,
    record_id: str,
    cascade: bool = Query(False),
    forecast_id: Optional[str] = Query(None)
):
    """
    Delete a specific record from a table
    """
    conn = None
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Get the primary key column name
        cursor.execute(f"PRAGMA table_info({table_name})")
        columns = cursor.fetchall()
        primary_key = None
        
        for col in columns:
            if col[5] == 1:  # Primary key flag
                primary_key = col[1]
                break
        
        if not primary_key:
            # If no primary key found, use common naming conventions
            if table_name == 'sales':
                primary_key = 'sale_id'
            elif table_name == 'customers':
                primary_key = 'customer_id'
            elif table_name == 'units':
                primary_key = 'unit_id'
            elif table_name == 'machines':
                primary_key = 'machine_id'
            elif table_name == 'payroll':
                primary_key = 'employee_id'
            elif table_name == 'labor_rates':
                primary_key = 'rate_id'
            elif table_name == 'bom':
                # BOM uses composite key handling
                primary_key = 'bom_id'
            elif table_name == 'routers':
                primary_key = 'router_id'
            elif table_name == 'router_definitions':
                primary_key = 'router_id'
            elif table_name == 'router_operations':
                primary_key = 'operation_id'
            else:
                primary_key = 'id'
        
        # Special handling for BOM table with composite keys
        if table_name == 'bom' and '-' in record_id:
            # Handle composite key format: bom_id-version-bom_line
            # For BOM-001-1.0-1, we need to parse more carefully
            parts = record_id.split('-')
            if len(parts) >= 3:
                # Handle cases where BOM ID contains hyphens (e.g., BOM-001)
                # Last part is bom_line, second to last is version
                bom_line = parts[-1]
                version = parts[-2]
                bom_id = '-'.join(parts[:-2])
                
                # Check if the record exists
                cursor.execute("SELECT COUNT(*) FROM bom WHERE bom_id = ? AND version = ? AND bom_line = ?", (bom_id, version, bom_line))
                count = cursor.fetchone()[0]
                
                if count == 0:
                    raise HTTPException(status_code=404, detail=f"BOM record '{record_id}' not found")
                
                # Delete the record
                cursor.execute("DELETE FROM bom WHERE bom_id = ? AND version = ? AND bom_line = ?", (bom_id, version, bom_line))
                rows_affected = cursor.rowcount
            else:
                raise HTTPException(status_code=400, detail="Invalid BOM record ID format. Expected: bom_id-version-bom_line")
        # Special handling for router_operations table with compound key (router_id + sequence)
        elif table_name == 'router_operations' and '-' in str(record_id):
            # Handle compound key format: router_id-sequence
            parts = str(record_id).split('-')
            if len(parts) >= 2:
                router_id = parts[0]
                sequence = parts[1]
                
                # Check if the record exists
                cursor.execute("SELECT COUNT(*) FROM router_operations WHERE router_id = ? AND sequence = ?", (router_id, sequence))
                count = cursor.fetchone()[0]
                
                if count == 0:
                    raise HTTPException(status_code=404, detail=f"Router operation '{record_id}' not found")
                
                # Delete the record
                cursor.execute("DELETE FROM router_operations WHERE router_id = ? AND sequence = ?", (router_id, sequence))
                rows_affected = cursor.rowcount
            else:
                raise HTTPException(status_code=400, detail="Invalid router_operations record ID format. Expected: router_id-sequence")
        else:
            # Standard single-key deletion
            # Check if the record exists before deleting
            cursor.execute(f"SELECT COUNT(*) FROM {table_name} WHERE {primary_key} = ?", (record_id,))
            count = cursor.fetchone()[0]
            
            if count == 0:
                raise HTTPException(status_code=404, detail=f"Record with {primary_key} '{record_id}' not found in {table_name}")
            
            # Optional cascade for known relationships to avoid FK errors
            if cascade:
                try:
                    if table_name == 'customers':
                        if forecast_id:
                            cursor.execute("DELETE FROM sales WHERE customer_id = ? AND forecast_id = ?", (record_id, forecast_id))
                        else:
                            cursor.execute("DELETE FROM sales WHERE customer_id = ?", (record_id,))
                    elif table_name == 'units':
                        if forecast_id:
                            cursor.execute("DELETE FROM sales WHERE unit_id = ? AND forecast_id = ?", (record_id, forecast_id))
                        else:
                            cursor.execute("DELETE FROM sales WHERE unit_id = ?", (record_id,))
                except Exception:
                    # Best-effort; let the main delete surface any remaining FK issues
                    pass

            # Delete the record
            try:
                cursor.execute(f"DELETE FROM {table_name} WHERE {primary_key} = ?", (record_id,))
            except sqlite3.IntegrityError as ie:
                # Likely FK constraint; return a helpful message
                deps = []
                if table_name == 'customers':
                    deps.append('sales')
                if table_name == 'units':
                    deps.append('sales')
                detail = f"Cannot delete from {table_name}: dependent rows exist"
                if deps:
                    detail += f" in {', '.join(deps)}. Use ?cascade=true{'&forecast_id=FXXX' if table_name in ('customers','units') else ''} to remove dependents first."
                raise HTTPException(status_code=409, detail=detail)
            rows_affected = cursor.rowcount
        
        if rows_affected == 0:
            raise HTTPException(status_code=404, detail=f"Record with {primary_key} '{record_id}' not found in {table_name}")
        
        conn.commit()
        
        return ForecastResponse(
            status="success",
            message=f"Record deleted successfully from {table_name}"
        )
        
    except HTTPException:
        # Re-raise HTTP exceptions
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
