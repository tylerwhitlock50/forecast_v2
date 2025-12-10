"""
Database Management API Routes
Provides endpoints for database reset and cleaning operations
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from typing import Dict, Any
import os
import sqlite3
import shutil
from datetime import datetime
from pathlib import Path

router = APIRouter()


def get_database_paths():
    """Get the database paths for both environments"""
    if os.path.exists('/data'):
        return {
            'database_path': '/data/forecast.db',
            'data_dir': '/data',
            'saved_databases_dir': '/data/saved_databases'
        }
    else:
        return {
            'database_path': './data/forecast.db',
            'data_dir': './data',
            'saved_databases_dir': './data/saved_databases'
        }


@router.post("/database/reset-clean")
async def reset_database_clean():
    """Reset the database to a completely clean state (all tables, no data)"""
    try:
        # Import here to avoid circular imports
        from db.database import db_manager
        
        paths = get_database_paths()
        database_path = paths['database_path']
        saved_databases_dir = paths['saved_databases_dir']
        
        # Ensure directories exist
        Path(saved_databases_dir).mkdir(parents=True, exist_ok=True)
        Path(database_path).parent.mkdir(parents=True, exist_ok=True)
        
        # Close all existing connections
        db_manager.close_all_connections()
        
        # Create backup
        backup_path = None
        if os.path.exists(database_path):
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_filename = f"reset_backup_{timestamp}.db"
            backup_path = os.path.join(saved_databases_dir, backup_filename)
            shutil.copy2(database_path, backup_path)
        
        # Close any remaining connections and remove database files
        try:
            temp_conn = sqlite3.connect(database_path, timeout=1.0)
            temp_conn.execute("PRAGMA journal_mode=DELETE")
            temp_conn.close()
        except:
            pass  # Ignore connection issues
        
        # Remove database files
        for file_path in [database_path, f"{database_path}-wal", f"{database_path}-shm"]:
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except:
                    pass  # Ignore if files are locked
        
        # Recreate the database using the existing database manager
        db_manager.create_tables()
        
        # Count tables to verify creation
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
        table_count = cursor.fetchone()[0]
        db_manager.close_connection(conn)
        
        return JSONResponse(
            status_code=200,
            content={
                "status": "success",
                "message": f"Database reset successfully. Created {table_count} tables with no data.",
                "database_path": database_path,
                "backup_path": backup_path,
                "table_count": table_count
            }
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to reset database: {str(e)}"
        )


@router.post("/database/clear-data")
async def clear_database_data():
    """Clear all data from existing tables while keeping the structure"""
    try:
        # Import here to avoid circular imports
        from db.database import db_manager
        
        # Use the existing reset_to_initial_state method but modify it
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Get all table names
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [row[0] for row in cursor.fetchall()]
        
        # Tables in dependency order (children first)
        ordered_tables = [
            'sales', 'bom', 'router_operations', 'routers', 'expense_allocations', 
            'expenses', 'loan_payments', 'payroll', 'forecast_results', 'execution_log',
            'customers', 'units', 'bom_definitions', 'router_definitions', 
            'machines', 'labor_rates', 'payroll_config', 'expense_categories', 
            'loans', 'forecast'
        ]
        
        # Only clear tables that exist
        tables_to_clear = [table for table in ordered_tables if table in tables]
        
        # Use a transaction to ensure atomicity
        cursor.execute("BEGIN IMMEDIATE TRANSACTION")
        cursor.execute("PRAGMA foreign_keys = OFF")
        
        cleared_count = 0
        for table_name in tables_to_clear:
            try:
                cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
                row_count = cursor.fetchone()[0]
                
                if row_count > 0:
                    cursor.execute(f"DELETE FROM {table_name}")
                    cleared_count += row_count
            except sqlite3.Error:
                continue  # Skip tables that can't be cleared
        
        # Reset auto-increment sequences
        try:
            cursor.execute("DELETE FROM sqlite_sequence")
        except sqlite3.Error:
            pass  # sqlite_sequence might not exist
        
        cursor.execute("PRAGMA foreign_keys = ON")
        conn.commit()
        db_manager.close_connection(conn)
        
        return JSONResponse(
            status_code=200,
            content={
                "status": "success",
                "message": f"Cleared {cleared_count} rows from {len(tables_to_clear)} tables. Structure preserved.",
                "tables_cleared": len(tables_to_clear),
                "rows_cleared": cleared_count
            }
        )
        
    except Exception as e:
        # If transaction fails, try to rollback
        try:
            if 'conn' in locals():
                conn.rollback()
                db_manager.close_connection(conn)
        except:
            pass
            
        raise HTTPException(
            status_code=500,
            detail=f"Failed to clear database: {str(e)}"
        )


@router.post("/database/verify-empty")
async def verify_database_empty():
    """Verify that all tables are empty"""
    try:
        # Import here to avoid circular imports
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Get all table names
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = cursor.fetchall()
        
        table_info = []
        total_rows = 0
        
        for (table_name,) in tables:
            cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
            count = cursor.fetchone()[0]
            total_rows += count
            
            table_info.append({
                "table_name": table_name,
                "row_count": count,
                "is_empty": count == 0
            })
        
        db_manager.close_connection(conn)
        
        all_empty = total_rows == 0
        
        return JSONResponse(
            status_code=200,
            content={
                "status": "success",
                "all_empty": all_empty,
                "total_rows": total_rows,
                "table_count": len(tables),
                "tables": table_info
            }
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to verify database: {str(e)}"
        )


@router.get("/database/info")
async def get_database_info():
    """Get information about the current database"""
    try:
        # Import here to avoid circular imports
        from db.database import db_manager
        
        paths = get_database_paths()
        database_path = paths['database_path']
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Get table count and names
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        tables = cursor.fetchall()
        
        # Get total row count across all tables
        total_rows = 0
        table_details = []
        
        for (table_name,) in tables:
            cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
            count = cursor.fetchone()[0]
            total_rows += count
            table_details.append({
                "name": table_name,
                "row_count": count
            })
        
        # Get database file info
        db_size = 0
        if os.path.exists(database_path):
            db_size = os.path.getsize(database_path)
        
        db_manager.close_connection(conn)
        
        return JSONResponse(
            status_code=200,
            content={
                "status": "success",
                "database_path": database_path,
                "database_size_bytes": db_size,
                "table_count": len(tables),
                "total_rows": total_rows,
                "tables": table_details
            }
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get database info: {str(e)}"
        )