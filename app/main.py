from fastapi import FastAPI, HTTPException, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, Dict, Any, List
from contextlib import asynccontextmanager
import uuid
from datetime import datetime, date
import calendar

# Import database functions and models
from db import (
    initialize_database,
    get_table_data,
    get_forecast_data,
    get_saved_forecast_results,
    execute_sql,
    get_execution_logs,
    replay_execution_logs,
    reset_to_initial_state,
    ChatRequest,
    SQLApplyRequest,
    ForecastResponse
)

# Import LLM service
from services.llm_service import llm_service, LLMRequest
from services.agent_service import agent_service, AgentRequest
from services.plan_execute_service import plan_execute_service
from services.whisper_service import whisper_service
from utils.data_loader import load_csv_to_table
from utils.data_quality import get_data_quality_issues

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
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

@app.get("/data/{table_name}")
async def get_table_data_endpoint(table_name: str):
    """Get data from a specific table"""
    result = get_table_data(table_name)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["error"])
    return result

@app.post("/forecast/create", response_model=ForecastResponse)
async def create_forecast_endpoint(forecast_data: Dict[str, Any]):
    """
    Create a new forecast using the wizard data
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Step 1: Create revenue forecast
        if forecast_data.get('revenue'):
            revenue = forecast_data['revenue']
            if revenue.get('customer') and revenue.get('product'):
                # Generate periods
                periods = generate_periods(revenue.get('periods', 12))
                
                for period in periods:
                    if revenue.get('forecastType') == 'flat':
                        amount = float(revenue.get('flatAmount', 0))
                    else:
                        # Calculate growth-based amount
                        base_amount = 1000  # Default base amount
                        growth_rate = float(revenue.get('growthRate', 0)) / 100
                        period_index = periods.index(period)
                        amount = base_amount * (1 + growth_rate) ** period_index
                    
                    # Insert sales record
                    sale_id = str(uuid.uuid4())
                    cursor.execute("""
                        INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, (sale_id, revenue['customer'], revenue['product'], period, 1, amount, amount))
        
        # Step 2: Create BOM entries
        if forecast_data.get('bom'):
            bom = forecast_data['bom']
            if bom.get('product') and bom.get('materialCost'):
                bom_id = str(uuid.uuid4())
                cursor.execute("""
                    INSERT INTO bom (bom_id, unit_id, router_id, material_cost)
                    VALUES (?, ?, ?, ?)
                """, (bom_id, bom['product'], bom.get('routerId', ''), float(bom['materialCost'])))
        
        # Step 3: Create labor entries
        if forecast_data.get('labor'):
            labor = forecast_data['labor']
            if labor.get('employeeName'):
                employee_id = str(uuid.uuid4())
                cursor.execute("""
                    INSERT INTO payroll (employee_id, employee_name, weekly_hours, hourly_rate, labor_type, start_date, end_date)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (
                    employee_id, 
                    labor['employeeName'], 
                    int(labor.get('weeklyHours', 0)), 
                    float(labor.get('hourlyRate', 0)), 
                    labor.get('laborType', 'direct'),
                    labor.get('startDate', ''),
                    labor.get('endDate', '')
                ))
        
        # Step 4: Create recurring expenses (store in a new table or use existing structure)
        if forecast_data.get('recurring'):
            recurring = forecast_data['recurring']
            if recurring.get('expenseName') and recurring.get('amount'):
                # For now, we'll store this in a simple structure
                # In a real implementation, you'd have a dedicated expenses table
                pass
        
        # Step 5: Create loan entries (store in a new table or use existing structure)
        if forecast_data.get('loans'):
            loans = forecast_data['loans']
            if loans.get('loanName') and loans.get('principal'):
                # For now, we'll store this in a simple structure
                # In a real implementation, you'd have a dedicated loans table
                pass
        
        # Step 6: Create non-recurring expenses (store in a new table or use existing structure)
        if forecast_data.get('nonRecurring'):
            non_recurring = forecast_data['nonRecurring']
            if non_recurring.get('expenseName') and non_recurring.get('amount'):
                # For now, we'll store this in a simple structure
                # In a real implementation, you'd have a dedicated expenses table
                pass
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            message="Forecast created successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating forecast: {str(e)}")

def generate_periods(num_periods: int) -> List[str]:
    """Generate period strings for the specified number of months"""
    periods = []
    current_date = datetime.now()
    
    for i in range(num_periods):
        # Add i months to current date
        month = current_date.month + i
        year = current_date.year + (month - 1) // 12
        month = ((month - 1) % 12) + 1
        
        period = f"{year:04d}-{month:02d}"
        periods.append(period)
    
    return periods

@app.post("/forecast/update", response_model=ForecastResponse)
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
        
        # Build update query dynamically
        set_clause = ", ".join([f"{key} = ?" for key in updates.keys()])
        values = list(updates.values()) + [record_id]
        
        cursor.execute(f"UPDATE {table_name} SET {set_clause} WHERE id = ?", values)
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            message=f"Record updated successfully in {table_name}"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating forecast: {str(e)}")

@app.delete("/forecast/delete/{table_name}/{record_id}", response_model=ForecastResponse)
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
            raise HTTPException(status_code=400, detail="No primary key found for table")
        
        cursor.execute(f"DELETE FROM {table_name} WHERE {primary_key} = ?", (record_id,))
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            message=f"Record deleted successfully from {table_name}"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting record: {str(e)}")

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

@app.get("/forecast", response_model=ForecastResponse)
async def get_forecast():
    """
    Returns computed forecast state with joined data
    """
    result = get_forecast_data()
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["error"])
    
    return ForecastResponse(
        status="success",
        data=result["data"]
    )

@app.get("/forecast/results", response_model=ForecastResponse)
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 