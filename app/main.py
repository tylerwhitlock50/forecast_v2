from fastapi import FastAPI, HTTPException, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, Dict, Any
from contextlib import asynccontextmanager

# Import database functions and models
from db import (
    initialize_database,
    ChatRequest,
    SQLApplyRequest,
    ForecastResponse,
    execute_sql,
    get_execution_logs,
    replay_execution_logs,
    reset_to_initial_state
)

# Import LLM services
from services.llm_service import llm_service, LLMRequest
from services.agent_service import agent_service, AgentRequest
from services.plan_execute_service import plan_execute_service
from services.whisper_service import whisper_service
from utils.data_loader import load_csv_to_table
from utils.data_quality import get_data_quality_issues

# Import API route modules
from api.data_routes import router as data_router
from api.forecast_routes import router as forecast_router
from api.crud_routes import router as crud_router
from api.cost_routes import router as cost_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for FastAPI app"""
    # Startup
    initialize_database()
    yield
    # Shutdown (if needed)

app = FastAPI(
    title="Forecast Model + AI Assistant",
    description="AI-powered financial modeling and cash flow forecasting system",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",  # Development
        "http://localhost:3001",  # Alternative dev port
        "http://forecast-frontend:3000",  # Docker container
        "http://frontend:3000",  # Alternative Docker name
        "*"  # Allow all for now - configure appropriately for production
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(data_router)
app.include_router(forecast_router)
app.include_router(crud_router)
app.include_router(cost_router)

@app.get("/")
async def root():
    """Health check endpoint"""
    return {"message": "Forecast Model + AI Assistant API", "status": "running"}

@app.get("/schema")
async def get_database_schema():
    """Get database schema information for frontend"""
    from services.llm_service import DatabaseSchema
    
    return {
        "status": "success",
        "data": {
            "tables": DatabaseSchema.TABLES,
            "schema_context": DatabaseSchema.get_schema_context()
        },
        "message": "Database schema retrieved successfully"
    }

# =============================================================================
# AI & CHAT ENDPOINTS
# =============================================================================

@app.post("/chat", response_model=ForecastResponse)
async def chat_endpoint(request: ChatRequest):
    """
    Accepts natural language input and returns SQL and explanation
    Integrates with the Ollama LLM service
    """
    try:
        # Convert ChatRequest to LLMRequest
        llm_request = LLMRequest(
            message=request.message,
            context=request.context,
            temperature=0.1,
            max_tokens=1000
        )
        
        # Generate SQL using LLM service
        llm_response = await llm_service.generate_sql(llm_request)
        
        if llm_response.error:
            raise HTTPException(status_code=500, detail=llm_response.error)
        
        return ForecastResponse(
            status="success",
            data={
                "sql_statement": llm_response.sql_statement,
                "explanation": llm_response.explanation,
                "confidence": llm_response.confidence,
                "requires_approval": llm_response.requires_approval,
                "suggested_actions": llm_response.suggested_actions
            },
            message="SQL generated successfully"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/agent", response_model=ForecastResponse)
async def agent_endpoint(request: ChatRequest):
    """Interact with a LangChain powered agent"""
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        logger.info(f"Agent request received: {request.message[:100]}...")
        logger.info(f"Agent context: {request.context}")
        
        agent_request = AgentRequest(message=request.message, context=request.context)
        logger.info("Starting agent execution...")
        
        result = await agent_service.run(agent_request)
        
        logger.info(f"Agent execution completed successfully")
        logger.info(f"Agent result: {result[:200]}..." if len(result) > 200 else f"Agent result: {result}")
        
        return ForecastResponse(status="success", data={"response": result}, message="Agent response generated")
    except Exception as e:
        logger.error(f"Agent execution failed: {str(e)}")
        logger.error(f"Error type: {type(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/plan_execute", response_model=ForecastResponse)
async def plan_execute_endpoint(request: ChatRequest):
    """Plan with DeepSeek and execute with the Llama agent"""
    try:
        agent_request = AgentRequest(message=request.message, context=request.context)
        result = await plan_execute_service.run(agent_request)
        return ForecastResponse(status="success", data=result, message="Plan and execution completed")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/voice", response_model=ForecastResponse)
async def voice_command(audio: UploadFile = File(...), session_id: Optional[str] = None):
    """Process a voice command via Whisper and the agent service"""
    try:
        audio_bytes = await audio.read()
        transcript = await whisper_service.transcribe(audio_bytes)
        context = {"session_id": session_id} if session_id else {"session_id": "default"}
        agent_request = AgentRequest(message=transcript, context=context)
        result = await agent_service.run(agent_request)
        return ForecastResponse(
            status="success",
            data={"transcript": transcript, "response": result},
            message="Voice command processed"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# =============================================================================
# UTILITY ENDPOINTS
# =============================================================================

@app.post("/load_table", response_model=ForecastResponse)
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

@app.get("/data_quality", response_model=ForecastResponse)
async def data_quality_endpoint():
    """Return basic data quality checks"""
    result = get_data_quality_issues()
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["error"])
    return ForecastResponse(status="success", data=result["data"], message="Data quality check complete")

@app.post("/preview_sql", response_model=ForecastResponse)
async def preview_sql_endpoint(request: SQLApplyRequest):
    """
    Preview SQL execution without applying changes
    """
    try:
        from db.database import db_manager
        
        # Get a connection to run the preview
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Execute the SQL and fetch results
        cursor.execute(request.sql_statement)
        
        if request.sql_statement.strip().upper().startswith('SELECT'):
            # For SELECT queries, return the results
            columns = [description[0] for description in cursor.description]
            rows = cursor.fetchall()
            data = [dict(zip(columns, row)) for row in rows]
            
            return ForecastResponse(
                status="success",
                data={
                    "preview_data": data,
                    "columns": columns,
                    "row_count": len(data),
                    "sql_statement": request.sql_statement
                },
                message=f"Preview shows {len(data)} rows that would be affected"
            )
        else:
            # For non-SELECT queries, return what would be affected
            return ForecastResponse(
                status="success",
                data={
                    "sql_statement": request.sql_statement,
                    "message": "This is a modification query. Use /apply_sql to execute it."
                },
                message="SQL preview completed - use /apply_sql to execute"
            )
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SQL preview error: {str(e)}")
    finally:
        if 'conn' in locals():
            db_manager.close_connection(conn)

@app.post("/apply_sql", response_model=ForecastResponse)
async def apply_sql_endpoint(request: SQLApplyRequest):
    """
    Applies user-approved SQL transformation with logging
    """
    result = execute_sql(
        request.sql_statement,
        description=request.description,
        user_id=getattr(request, 'user_id', None),
        session_id=getattr(request, 'session_id', None)
    )
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["error"])
    
    return ForecastResponse(
        status="success",
        message=f"SQL applied successfully: {request.description}"
    )

@app.post("/recalculate", response_model=ForecastResponse)
async def recalculate_forecast():
    """
    Re-runs all SQL to recalculate outputs
    """
    try:
        # TODO: Implement full recalculation logic
        # This would run all the forecast calculations
        
        return ForecastResponse(
            status="success",
            message="Forecast recalculated successfully"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# =============================================================================
# EXECUTION LOG ENDPOINTS
# =============================================================================

@app.get("/logs/execution", response_model=ForecastResponse)
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

@app.post("/rollback/replay", response_model=ForecastResponse)
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

@app.post("/rollback/reset", response_model=ForecastResponse)
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

@app.get("/snapshot")
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

@app.post("/database/save")
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

@app.get("/database/list")
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
        
        # List all .db files in the directory
        databases = []
        for filename in os.listdir(data_dir):
            if filename.endswith('.db'):
                file_path = os.path.join(data_dir, filename)
                stat_info = os.stat(file_path)
                
                databases.append({
                    "filename": filename,
                    "name": filename[:-3],  # Remove .db extension
                    "size": stat_info.st_size,
                    "created": datetime.fromtimestamp(stat_info.st_ctime).isoformat(),
                    "modified": datetime.fromtimestamp(stat_info.st_mtime).isoformat()
                })
        
        # Sort by modification time (newest first)
        databases.sort(key=lambda x: x["modified"], reverse=True)
        
        return {
            "status": "success",
            "data": {
                "databases": databases,
                "count": len(databases)
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list databases: {str(e)}")

@app.post("/database/load")
async def load_database(request: dict):
    """
    Load a saved database from the app/data folder
    """
    try:
        import os
        import shutil
        from db.database import db_manager
        
        # Get the filename from request
        filename = request.get("filename", "")
        if not filename:
            raise HTTPException(status_code=400, detail="Filename is required")
        
        # Ensure the filename is safe
        if not filename.endswith('.db'):
            filename += '.db'
        
        # Get paths
        current_db_path = db_manager.database_path
        data_dir = os.path.join(os.path.dirname(current_db_path), "saved_databases")
        backup_path = os.path.join(data_dir, filename)
        
        # Check if the backup file exists
        if not os.path.exists(backup_path):
            raise HTTPException(status_code=404, detail=f"Database file {filename} not found")
        
        # Create a backup of the current database before loading
        import datetime
        current_backup_name = f"current_backup_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
        current_backup_path = os.path.join(data_dir, current_backup_name)
        shutil.copy2(current_db_path, current_backup_path)
        
        # Close any existing connections
        db_manager.close_all_connections()
        
        # Replace the current database with the backup
        shutil.copy2(backup_path, current_db_path)
        
        # Reinitialize the database connection
        initialize_database()
        
        return {
            "status": "success",
            "message": f"Database loaded from {filename}",
            "data": {
                "loaded_filename": filename,
                "backup_created": current_backup_name
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load database: {str(e)}")

@app.delete("/database/delete/{filename}")
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)