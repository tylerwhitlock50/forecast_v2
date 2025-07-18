from fastapi import APIRouter, HTTPException
from typing import Dict, Any
from db.models import ForecastResponse
import uuid
import sqlite3

router = APIRouter(prefix="/forecast", tags=["crud"])

@router.post("/create", response_model=ForecastResponse)
async def create_forecast_endpoint(forecast_data: Dict[str, Any]):
    """
    Create a new forecast using the wizard data or direct sales data
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Handle customer creation
        if forecast_data.get('table') == 'customers':
            customer_data = forecast_data.get('data', {})
            customer_id = customer_data.get('customer_id')
            
            if not customer_id:
                raise HTTPException(status_code=400, detail="Customer ID is required")
            
            try:
                cursor.execute("""
                    INSERT INTO customers (customer_id, customer_name, customer_type, region)
                    VALUES (?, ?, ?, ?)
                """, (
                    customer_id,
                    customer_data.get('customer_name', ''),
                    customer_data.get('customer_type', ''),
                    customer_data.get('region', '')
                ))
                
                conn.commit()
                db_manager.close_connection(conn)
                
                return ForecastResponse(
                    status="success",
                    message="Customer created successfully"
                )
            except sqlite3.IntegrityError as e:
                db_manager.close_connection(conn)
                raise HTTPException(status_code=400, detail=f"Customer ID '{customer_id}' already exists")
            except Exception as e:
                db_manager.close_connection(conn)
                raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
        
        # Handle machine creation
        elif forecast_data.get('table') == 'machines':
            machine_data = forecast_data.get('data', {})
            machine_id = machine_data.get('machine_id')
            
            if not machine_id:
                raise HTTPException(status_code=400, detail="Machine ID is required")
            
            try:
                cursor.execute("""
                    INSERT INTO machines (machine_id, machine_name, machine_description, machine_rate, labor_type, available_minutes_per_month)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    machine_id,
                    machine_data.get('machine_name', ''),
                    machine_data.get('machine_description', ''),
                    machine_data.get('machine_rate', 0),
                    machine_data.get('labor_type', ''),
                    machine_data.get('available_minutes_per_month', 0)
                ))
                
                conn.commit()
                db_manager.close_connection(conn)
                
                return ForecastResponse(
                    status="success",
                    message="Machine created successfully"
                )
            except sqlite3.IntegrityError as e:
                db_manager.close_connection(conn)
                raise HTTPException(status_code=400, detail=f"Machine ID '{machine_id}' already exists")
            except Exception as e:
                db_manager.close_connection(conn)
                raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
        
        # Handle router definition creation
        elif forecast_data.get('table') == 'router_definitions':
            router_data = forecast_data.get('data', {})
            router_id = router_data.get('router_id')
            
            if not router_id:
                raise HTTPException(status_code=400, detail="Router ID is required")
            
            try:
                cursor.execute("""
                    INSERT INTO router_definitions (router_id, router_name, router_description, version)
                    VALUES (?, ?, ?, ?)
                """, (
                    router_id,
                    router_data.get('router_name', ''),
                    router_data.get('router_description', ''),
                    router_data.get('version', '1.0')
                ))
                
                conn.commit()
                db_manager.close_connection(conn)
                
                return ForecastResponse(
                    status="success",
                    message="Router created successfully"
                )
            except sqlite3.IntegrityError as e:
                db_manager.close_connection(conn)
                raise HTTPException(status_code=400, detail=f"Router ID '{router_id}' already exists")
            except Exception as e:
                db_manager.close_connection(conn)
                raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
        
        # Handle router operation creation
        elif forecast_data.get('table') == 'router_operations':
            operation_data = forecast_data.get('data', {})
            router_id = operation_data.get('router_id')
            sequence = operation_data.get('sequence')
            
            if not router_id or not sequence:
                raise HTTPException(status_code=400, detail="Router ID and sequence are required")
            
            try:
                cursor.execute("""
                    INSERT INTO router_operations (router_id, sequence, machine_id, machine_minutes, labor_minutes, labor_type_id, operation_description)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    router_id,
                    sequence,
                    operation_data.get('machine_id', ''),
                    operation_data.get('machine_minutes', 0),
                    operation_data.get('labor_minutes', 0),
                    operation_data.get('labor_type_id', ''),
                    operation_data.get('operation_description', '')
                ))
                
                conn.commit()
                db_manager.close_connection(conn)
                
                return ForecastResponse(
                    status="success",
                    message="Router operation created successfully"
                )
            except sqlite3.IntegrityError as e:
                db_manager.close_connection(conn)
                raise HTTPException(status_code=400, detail=f"Router operation with sequence '{sequence}' already exists for router '{router_id}'")
            except Exception as e:
                db_manager.close_connection(conn)
                raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
        
        # Handle BOM creation
        elif forecast_data.get('table') == 'bom':
            bom_data = forecast_data.get('data', {})
            bom_id = bom_data.get('bom_id')
            
            if not bom_id:
                raise HTTPException(status_code=400, detail="BOM ID is required")
            
            try:
                cursor.execute("""
                    INSERT INTO bom (bom_id, version, bom_line, material_description, qty, unit, unit_price, material_cost, target_cost)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    bom_id,
                    bom_data.get('version', '1.0'),
                    bom_data.get('bom_line', 1),
                    bom_data.get('material_description', ''),
                    bom_data.get('qty', 0),
                    bom_data.get('unit', 'each'),
                    bom_data.get('unit_price', 0),
                    bom_data.get('material_cost', 0),
                    bom_data.get('target_cost', 0)
                ))
                
                conn.commit()
                db_manager.close_connection(conn)
                
                return ForecastResponse(
                    status="success",
                    message="BOM item created successfully"
                )
            except sqlite3.IntegrityError as e:
                db_manager.close_connection(conn)
                raise HTTPException(status_code=400, detail=f"BOM item already exists: {str(e)}")
            except Exception as e:
                db_manager.close_connection(conn)
                raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
        
        # Handle direct sales data from frontend
        elif forecast_data.get('sales'):
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
            db_manager.close_connection(conn)
            
            return ForecastResponse(
                status="success",
                message="Sales data created successfully"
            )
        
        else:
            raise HTTPException(status_code=400, detail="Invalid or missing data structure")
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating forecast: {str(e)}")

@router.post("/update", response_model=ForecastResponse)
async def update_forecast_endpoint(update_data: Dict[str, Any]):
    """
    Update existing forecast data
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        table_name = update_data.get('table')
        record_id = update_data.get('id')
        updates = update_data.get('updates', {})
        
        if not table_name or not record_id:
            raise HTTPException(status_code=400, detail="Table name and record ID are required")
        
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
            else:
                primary_key = 'id'
        
        # Special handling for BOM table with composite keys
        if table_name == 'bom' and '-' in record_id:
            # Handle composite key format: bom_id-version-bom_line
            parts = record_id.split('-')
            if len(parts) >= 3:
                bom_id = parts[0]
                version = parts[1] 
                bom_line = parts[2]
                
                # Build update query for composite key
                set_clause = ", ".join([f"{key} = ?" for key in updates.keys()])
                values = list(updates.values()) + [bom_id, version, bom_line]
                
                cursor.execute(f"UPDATE {table_name} SET {set_clause} WHERE bom_id = ? AND version = ? AND bom_line = ?", values)
            else:
                raise HTTPException(status_code=400, detail="Invalid BOM record ID format. Expected: bom_id-version-bom_line")
        else:
            # Standard single-key update
            # Build update query dynamically
            set_clause = ", ".join([f"{key} = ?" for key in updates.keys()])
            values = list(updates.values()) + [record_id]
            
            cursor.execute(f"UPDATE {table_name} SET {set_clause} WHERE {primary_key} = ?", values)
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            message=f"Record updated successfully in {table_name}"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating forecast: {str(e)}")

@router.delete("/delete/{table_name}/{record_id}", response_model=ForecastResponse)
async def delete_forecast_record(table_name: str, record_id: str):
    """
    Delete a specific record from a table
    """
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
            parts = record_id.split('-')
            if len(parts) >= 3:
                bom_id = parts[0]
                version = parts[1]
                bom_line = parts[2]
                
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
        else:
            # Standard single-key deletion
            # Check if the record exists before deleting
            cursor.execute(f"SELECT COUNT(*) FROM {table_name} WHERE {primary_key} = ?", (record_id,))
            count = cursor.fetchone()[0]
            
            if count == 0:
                raise HTTPException(status_code=404, detail=f"Record with {primary_key} '{record_id}' not found in {table_name}")
            
            # Delete the record
            cursor.execute(f"DELETE FROM {table_name} WHERE {primary_key} = ?", (record_id,))
            rows_affected = cursor.rowcount
        
        if rows_affected == 0:
            raise HTTPException(status_code=404, detail=f"Record with {primary_key} '{record_id}' not found in {table_name}")
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            message=f"Record deleted successfully from {table_name}"
        )
        
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting record: {str(e)}")