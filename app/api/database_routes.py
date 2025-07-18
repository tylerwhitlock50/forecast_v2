"""
Database management and utility API routes
"""

from fastapi import APIRouter, HTTPException, Query, UploadFile, File
from typing import Optional
from datetime import datetime

# Import database functions and models
from db import (
    ForecastResponse,
    get_execution_logs,
    replay_execution_logs,
    reset_to_initial_state,
    switch_database,
    get_current_database_path
)

# Import utilities
from utils.data_loader import load_csv_to_table
from utils.data_quality import get_data_quality_issues

router = APIRouter(prefix="/database", tags=["Database Management"])

# =============================================================================
# DATA LOADING AND QUALITY ENDPOINTS
# =============================================================================

@router.post("/load_table", response_model=ForecastResponse)
async def load_table_endpoint(
    table_name: str = Query(..., description="Destination table name"),
    mode: str = Query("append", description="append or replace"),
    csv_file: UploadFile = File(...),
):
    """Load CSV data into a database table"""
    try:
        csv_bytes = await csv_file.read()
        result = load_csv_to_table(table_name, csv_bytes, if_exists=mode)
        if result["status"] == "error":
            raise HTTPException(status_code=500, detail=result["error"])
        return ForecastResponse(
            status="success",
            data={"rows_loaded": result["rows_loaded"]},
            message=f"Loaded {result['rows_loaded']} rows into {table_name}"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/quality", response_model=ForecastResponse)
async def data_quality_endpoint():
    """Return basic data quality checks"""
    result = get_data_quality_issues()
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["error"])
    return ForecastResponse(status="success", data=result["data"], message="Data quality check complete")

# =============================================================================
# EXECUTION LOG ENDPOINTS
# =============================================================================

@router.get("/logs/execution", response_model=ForecastResponse)
async def get_execution_logs_endpoint(
    limit: Optional[int] = Query(None, description="Limit number of logs"),
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    session_id: Optional[str] = Query(None, description="Filter by session ID"),
    status: Optional[str] = Query(None, description="Filter by status (success/error)")
):
    """
    Get execution logs with optional filtering
    """
    result = get_execution_logs(limit=limit, user_id=user_id, session_id=session_id, status=status)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["error"])
    
    return ForecastResponse(
        status="success",
        data={
            "logs": result["data"],
            "columns": result.get("columns"),
            "summary": result.get("summary")
        },
        message=f"Retrieved {len(result['data'])} execution logs"
    )

@router.post("/rollback/replay", response_model=ForecastResponse)
async def replay_execution_logs_endpoint(
    target_date: Optional[str] = Query(None, description="Replay up to this date (YYYY-MM-DD HH:MM:SS)"),
    max_log_id: Optional[int] = Query(None, description="Replay up to this log ID"),
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    session_id: Optional[str] = Query(None, description="Filter by session ID")
):
    """
    Replay SQL statements from execution log up to a specific point in time
    """
    result = replay_execution_logs(
        target_date=target_date,
        max_log_id=max_log_id,
        user_id=user_id,
        session_id=session_id
    )
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["error"])
    
    return ForecastResponse(
        status="success",
        data=result,
        message=result["message"]
    )

@router.post("/rollback/reset", response_model=ForecastResponse)
async def reset_database_endpoint():
    """
    Reset database to initial state by reloading CSV data
    """
    result = reset_to_initial_state()
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["error"])
    
    return ForecastResponse(
        status="success",
        message=result["message"]
    )

@router.get("/snapshot")
async def export_snapshot():
    """
    Exports current SQLite DB file
    """
    try:
        import os
        from db.database import db_manager
        
        database_path = db_manager.database_path
        if os.path.exists(database_path):
            # In a real implementation, you'd want to copy the file
            # and return it as a download
            return {"status": "success", "message": "Database snapshot ready for export"}
        else:
            raise HTTPException(status_code=404, detail="Database not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# =============================================================================
# DATABASE SAVE/LOAD ENDPOINTS
# =============================================================================

@router.post("/save")
async def save_database(request: dict):
    """
    Save a copy of the current database to the app/data folder
    """
    try:
        import os
        import shutil
        from datetime import datetime
        from db.database import db_manager
        
        # Get the save name from request
        save_name = request.get("name", "")
        if not save_name:
            save_name = f"database_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        # Ensure the save name is safe (no path traversal)
        save_name = "".join(c for c in save_name if c.isalnum() or c in ('-', '_', ' ')).strip()
        if not save_name:
            save_name = f"database_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        # Get current database path
        current_db_path = db_manager.database_path
        
        # Create the data directory if it doesn't exist
        data_dir = os.path.join(os.path.dirname(current_db_path), "saved_databases")
        os.makedirs(data_dir, exist_ok=True)
        
        # Create the backup file path
        backup_filename = f"{save_name}.db"
        backup_path = os.path.join(data_dir, backup_filename)
        
        # Copy the current database
        shutil.copy2(current_db_path, backup_path)
        
        return {
            "status": "success",
            "message": f"Database saved as {backup_filename}",
            "data": {
                "filename": backup_filename,
                "path": backup_path,
                "size": os.path.getsize(backup_path)
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save database: {str(e)}")

@router.post("/save-current")
async def save_current_state():
    """
    Save the current database state with an automatic timestamp (no custom name required)
    """
    try:
        import os
        import shutil
        from datetime import datetime
        from db.database import db_manager
        
        # Get current database path
        current_db_path = db_manager.database_path
        
        # Create the data directory if it doesn't exist
        data_dir = os.path.join(os.path.dirname(current_db_path), "saved_databases")
        os.makedirs(data_dir, exist_ok=True)
        
        # Create automatic filename with timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        auto_filename = f"autosave_{timestamp}.db"
        backup_path = os.path.join(data_dir, auto_filename)
        
        # Copy the current database
        shutil.copy2(current_db_path, backup_path)
        
        # Get file size for confirmation
        file_size = os.path.getsize(backup_path)
        
        return {
            "status": "success",
            "message": f"Current state saved automatically as {auto_filename}",
            "data": {
                "filename": auto_filename,
                "path": backup_path,
                "size": file_size,
                "timestamp": timestamp,
                "readable_time": datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save current state: {str(e)}")

@router.get("/list")
async def list_saved_databases():
    """
    List all saved databases in the app/data folder
    """
    try:
        import os
        from datetime import datetime
        from db.database import db_manager
        
        # Get the saved databases directory
        current_db_path = db_manager.database_path
        data_dir = os.path.join(os.path.dirname(current_db_path), "saved_databases")
        
        if not os.path.exists(data_dir):
            return {
                "status": "success",
                "data": {
                    "databases": [],
                    "count": 0
                }
            }
        
        # List all .db files in the directory and categorize them
        manual_saves = []
        autosaves = []
        
        for filename in os.listdir(data_dir):
            if filename.endswith('.db'):
                file_path = os.path.join(data_dir, filename)
                stat_info = os.stat(file_path)
                
                db_info = {
                    "filename": filename,
                    "name": filename[:-3],  # Remove .db extension
                    "size": stat_info.st_size,
                    "created": datetime.fromtimestamp(stat_info.st_ctime).isoformat(),
                    "modified": datetime.fromtimestamp(stat_info.st_mtime).isoformat()
                }
                
                # Categorize based on filename pattern
                if filename.startswith('autosave_'):
                    db_info["type"] = "autosave"
                    autosaves.append(db_info)
                elif filename.startswith('current_backup_') or filename.startswith('pre_revert_backup_'):
                    db_info["type"] = "system_backup"
                    autosaves.append(db_info)
                else:
                    db_info["type"] = "manual_save"
                    manual_saves.append(db_info)
        
        # Sort each category by modification time (newest first)
        manual_saves.sort(key=lambda x: x["modified"], reverse=True)
        autosaves.sort(key=lambda x: x["modified"], reverse=True)
        
        # Combine all databases for backward compatibility
        all_databases = manual_saves + autosaves
        
        return {
            "status": "success",
            "data": {
                "databases": all_databases,
                "manual_saves": manual_saves,
                "autosaves": autosaves,
                "count": len(all_databases),
                "manual_count": len(manual_saves),
                "autosave_count": len(autosaves)
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list databases: {str(e)}")

@router.post("/load")
async def load_database(request: dict):
    """
    Load a saved database from the app/data folder
    """
    try:
        import os
        import shutil
        from db.database import db_manager
        
        print(f"Load database request: {request}")  # Debug logging
        
        # Get the filename from request
        filename = request.get("filename", "")
        if not filename:
            raise HTTPException(status_code=400, detail="Filename is required")
        
        # Ensure the filename is safe
        if not filename.endswith('.db'):
            filename += '.db'
        
        print(f"Loading database file: {filename}")  # Debug logging
        
        # Get paths
        current_db_path = db_manager.database_path
        data_dir = os.path.join(os.path.dirname(current_db_path), "saved_databases")
        backup_path = os.path.join(data_dir, filename)
        
        print(f"Current database path: {current_db_path}")  # Debug logging
        print(f"Backup path: {backup_path}")  # Debug logging
        
        # Check if the backup file exists
        if not os.path.exists(backup_path):
            raise HTTPException(status_code=404, detail=f"Database file {filename} not found at {backup_path}")
        
        # Create a backup of the current database before loading
        import datetime
        current_backup_name = f"current_backup_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
        current_backup_path = os.path.join(data_dir, current_backup_name)
        
        print(f"Creating backup: {current_backup_name}")  # Debug logging
        shutil.copy2(current_db_path, current_backup_path)
        
        # Close any existing connections
        db_manager.close_all_connections()
        
        # Replace the current database with the backup
        print(f"Replacing current database with backup")  # Debug logging
        shutil.copy2(backup_path, current_db_path)
        
        # Switch to the new database (this will update the global instance)
        print(f"Switching to new database")  # Debug logging
        switch_database(current_db_path)
        
        return {
            "status": "success",
            "message": f"Database loaded from {filename}",
            "data": {
                "loaded_filename": filename,
                "backup_created": current_backup_name,
                "current_db_path": current_db_path
            }
        }
    except HTTPException:
        raise  # Re-raise HTTP exceptions
    except Exception as e:
        print(f"Error loading database: {e}")  # Debug logging
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to load database: {str(e)}")

@router.post("/switch")
async def switch_database_endpoint(request: dict):
    """
    Switch to a different database file without copying (alternative method)
    """
    try:
        import os
        
        # Get the filename from request
        filename = request.get("filename", "")
        if not filename:
            raise HTTPException(status_code=400, detail="Filename is required")
        
        # Ensure the filename is safe
        if not filename.endswith('.db'):
            filename += '.db'
        
        # Get current database path to determine data directory
        current_db_path = get_current_database_path()
        data_dir = os.path.join(os.path.dirname(current_db_path), "saved_databases")
        target_db_path = os.path.join(data_dir, filename)
        
        # Check if the target database file exists
        if not os.path.exists(target_db_path):
            raise HTTPException(status_code=404, detail=f"Database file {filename} not found")
        
        # Switch to the target database directly (no copying)
        switch_database(target_db_path)
        
        return {
            "status": "success",
            "message": f"Switched to database {filename}",
            "data": {
                "previous_db_path": current_db_path,
                "new_db_path": target_db_path,
                "filename": filename
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to switch database: {str(e)}")

@router.delete("/delete/{filename}")
async def delete_saved_database(filename: str):
    """
    Delete a saved database file
    """
    try:
        import os
        from db.database import db_manager
        
        # Ensure the filename is safe
        if not filename.endswith('.db'):
            filename += '.db'
        
        # Get paths
        current_db_path = db_manager.database_path
        data_dir = os.path.join(os.path.dirname(current_db_path), "saved_databases")
        file_path = os.path.join(data_dir, filename)
        
        # Check if the file exists
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail=f"Database file {filename} not found")
        
        # Delete the file
        os.remove(file_path)
        
        return {
            "status": "success",
            "message": f"Database {filename} deleted successfully"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete database: {str(e)}")

@router.post("/revert-to-last-save")
async def revert_to_last_save():
    """
    Revert to the most recent autosave (find the latest autosave_*.db file)
    """
    try:
        import os
        import shutil
        from datetime import datetime
        from db.database import db_manager
        
        # Get current database path
        current_db_path = db_manager.database_path
        data_dir = os.path.join(os.path.dirname(current_db_path), "saved_databases")
        
        # Check if saved databases directory exists
        if not os.path.exists(data_dir):
            raise HTTPException(status_code=404, detail="No saved databases found")
        
        # Find all autosave files
        autosave_files = []
        for filename in os.listdir(data_dir):
            if filename.startswith('autosave_') and filename.endswith('.db'):
                file_path = os.path.join(data_dir, filename)
                stat_info = os.stat(file_path)
                autosave_files.append({
                    'filename': filename,
                    'path': file_path,
                    'modified': stat_info.st_mtime
                })
        
        if not autosave_files:
            raise HTTPException(status_code=404, detail="No autosave files found")
        
        # Sort by modification time (newest first)
        autosave_files.sort(key=lambda x: x['modified'], reverse=True)
        latest_autosave = autosave_files[0]
        
        # Create a backup of current state before reverting
        current_backup_name = f"pre_revert_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
        current_backup_path = os.path.join(data_dir, current_backup_name)
        shutil.copy2(current_db_path, current_backup_path)
        
        # Load the latest autosave
        print(f"Reverting to latest autosave: {latest_autosave['filename']}")
        
        # Close existing connections
        db_manager.close_all_connections()
        
        # Replace current database with the latest autosave
        shutil.copy2(latest_autosave['path'], current_db_path)
        
        # Switch to the reverted database
        switch_database(current_db_path)
        
        return {
            "status": "success",
            "message": f"Reverted to latest autosave: {latest_autosave['filename']}",
            "data": {
                "reverted_from": latest_autosave['filename'],
                "backup_created": current_backup_name,
                "reverted_time": datetime.fromtimestamp(latest_autosave['modified']).strftime('%Y-%m-%d %H:%M:%S')
            }
        }
    except HTTPException:
        raise  # Re-raise HTTP exceptions
    except Exception as e:
        print(f"Error reverting to last save: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to revert to last save: {str(e)}")

@router.get("/current")
async def get_current_database_info():
    """
    Get information about the currently active database
    """
    try:
        import os
        
        current_db_path = get_current_database_path()
        
        # Get file info if it exists
        if os.path.exists(current_db_path):
            stat_info = os.stat(current_db_path)
            from datetime import datetime
            
            return {
                "status": "success",
                "data": {
                    "database_path": current_db_path,
                    "filename": os.path.basename(current_db_path),
                    "size": stat_info.st_size,
                    "created": datetime.fromtimestamp(stat_info.st_ctime).isoformat(),
                    "modified": datetime.fromtimestamp(stat_info.st_mtime).isoformat(),
                    "exists": True
                }
            }
        else:
            return {
                "status": "success",
                "data": {
                    "database_path": current_db_path,
                    "filename": os.path.basename(current_db_path),
                    "exists": False
                }
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get current database info: {str(e)}") 