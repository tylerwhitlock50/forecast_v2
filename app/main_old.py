from fastapi import FastAPI, HTTPException, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, Dict, Any, List
from contextlib import asynccontextmanager
import uuid
import sqlite3
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
from db.models import (
    BOMClone,
    RouterClone,
    ProductCostSummary,
    MaterialUsage,
    MachineUtilization,
    LaborUtilization,
    COGSBreakdown
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
async def get_table_data_endpoint(table_name: str, forecast_id: Optional[str] = Query(None)):
    """Get data from a specific table"""
    result = get_table_data(table_name, forecast_id=forecast_id)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["error"])
    return result

@app.post("/forecast/create", response_model=ForecastResponse)
async def create_forecast_endpoint(forecast_data: Dict[str, Any]):
    """
    Create a new forecast using the wizard data or direct sales data
    - This is probably wrong
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
        
        # Handle wizard-style forecast data
        elif forecast_data.get('revenue'):
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
        
        # Handle legacy BOM entries for backwards compatibility
        elif forecast_data.get('bom'):
            bom = forecast_data['bom']
            if bom.get('product') and bom.get('materialCost'):
                bom_id = str(uuid.uuid4())
                cursor.execute("""
                    INSERT INTO bom (bom_id, unit_id, router_id, material_cost)
                    VALUES (?, ?, ?, ?)
                """, (bom_id, bom['product'], bom.get('routerId', ''), float(bom['materialCost'])))
        
        # Handle labor entries
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
        
        # Handle recurring expenses (store in a new table or use existing structure)
        if forecast_data.get('recurring'):
            recurring = forecast_data['recurring']
            if recurring.get('expenseName') and recurring.get('amount'):
                # For now, we'll store this in a simple structure
                # In a real implementation, you'd have a dedicated expenses table
                pass
        
        # Handle loan entries (store in a new table or use existing structure)
        if forecast_data.get('loans'):
            loans = forecast_data['loans']
            if loans.get('loanName') and loans.get('principal'):
                # For now, we'll store this in a simple structure
                # In a real implementation, you'd have a dedicated loans table
                pass
        
        # Handle non-recurring expenses (store in a new table or use existing structure)
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

@app.get("/forecast/scenarios", response_model=ForecastResponse)
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

@app.post("/forecast/scenario", response_model=ForecastResponse)
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

@app.post("/forecast/bulk_update", response_model=ForecastResponse)
async def bulk_update_forecast(bulk_data: Dict[str, Any]):
    """
    Bulk update forecast data
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        forecasts = bulk_data.get('forecasts', [])
        operation = bulk_data.get('operation', 'add')  # add, subtract, replace
        updated_count = 0
        
        for forecast in forecasts:
            # Check if record exists
            cursor.execute("""
                SELECT quantity, unit_price, total_revenue FROM sales 
                WHERE customer_id = ? AND unit_id = ? AND period = ? AND forecast_id = ?
            """, (
                forecast.get('customer_id'),
                forecast.get('unit_id'),
                forecast.get('period'),
                forecast.get('forecast_id')
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
                    forecast.get('forecast_id')
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
                    forecast.get('forecast_id')
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

# =============================================================================
# COST MANAGEMENT API ENDPOINTS
# =============================================================================

@app.get("/products/cost-summary", response_model=ForecastResponse)
async def get_products_cost_summary(forecast_id: Optional[str] = Query(None)):
    """
    Get cost summary for all products including COGS calculation
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Get products with their BOM and routing versions
        cursor.execute("""
            SELECT u.unit_id, u.unit_name, u.bom_id, u.bom_version, u.router_id, u.router_version, u.base_price
            FROM units u
        """)
        products = cursor.fetchall()
        
        cost_summaries = []
        for product in products:
            unit_id, unit_name, bom_id, bom_version, router_id, router_version, base_price = product
            
            # Calculate forecasted revenue
            revenue_query = """
                SELECT SUM(total_revenue) as total_revenue, SUM(quantity) as total_quantity
                FROM sales 
                WHERE unit_id = ?
            """
            params = [unit_id]
            if forecast_id:
                revenue_query += " AND forecast_id = ?"
                params.append(forecast_id)
            
            cursor.execute(revenue_query, params)
            revenue_data = cursor.fetchone()
            forecasted_revenue = revenue_data[0] if revenue_data[0] else 0
            forecasted_quantity = revenue_data[1] if revenue_data[1] else 0
            
            # Calculate material costs from BOM
            material_cost = 0
            if bom_id:
                cursor.execute("""
                    SELECT SUM(material_cost) as total_material_cost
                    FROM bom 
                    WHERE bom_id = ? AND version = ?
                """, (bom_id, bom_version))
                bom_data = cursor.fetchone()
                material_cost = (bom_data[0] if bom_data[0] else 0) * forecasted_quantity
            
            # Calculate labor and machine costs from routing
            labor_cost = 0
            machine_cost = 0
            if router_id:
                cursor.execute("""
                    SELECT r.labor_minutes, r.machine_minutes, m.machine_rate, lr.rate_amount
                    FROM routers r
                    JOIN machines m ON r.machine_id = m.machine_id
                    LEFT JOIN labor_rates lr ON r.labor_type_id = lr.rate_id
                    WHERE r.router_id = ? AND r.version = ?
                """, (router_id, router_version))
                routing_data = cursor.fetchall()
                
                for route in routing_data:
                    labor_minutes, machine_minutes, machine_rate, hourly_rate = route
                    labor_cost += (labor_minutes / 60) * (hourly_rate if hourly_rate else 0) * forecasted_quantity
                    machine_cost += (machine_minutes / 60) * (machine_rate if machine_rate else 0) * forecasted_quantity
            
            total_cogs = material_cost + labor_cost + machine_cost
            gross_margin = forecasted_revenue - total_cogs
            gross_margin_percent = (gross_margin / forecasted_revenue * 100) if forecasted_revenue > 0 else 0
            
            cost_summaries.append({
                "product_id": unit_id,
                "product_name": unit_name,
                "forecasted_revenue": forecasted_revenue,
                "material_cost": material_cost,
                "labor_cost": labor_cost,
                "machine_cost": machine_cost,
                "total_cogs": total_cogs,
                "gross_margin": gross_margin,
                "gross_margin_percent": gross_margin_percent
            })
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"products": cost_summaries},
            message=f"Retrieved cost summary for {len(cost_summaries)} products"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving cost summary: {str(e)}")

@app.get("/bom/{bom_id}", response_model=ForecastResponse)
async def get_bom_details(bom_id: str, version: str = "1.0"):
    """
    Get detailed BOM information for a specific BOM and version
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT bom_id, version, bom_line, material_description, qty, unit, unit_price, material_cost, target_cost
            FROM bom 
            WHERE bom_id = ? AND version = ?
            ORDER BY bom_line
        """, (bom_id, version))
        
        bom_data = cursor.fetchall()
        columns = [description[0] for description in cursor.description]
        bom_list = [dict(zip(columns, row)) for row in bom_data]
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"bom": bom_list},
            message=f"Retrieved BOM {bom_id} version {version}"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving BOM: {str(e)}")

@app.get("/routing/{router_id}", response_model=ForecastResponse)
async def get_routing_details(router_id: str, version: str = "1.0"):
    """
    Get detailed routing information for a specific router and version
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT r.router_id, r.version, r.unit_id, r.machine_id, r.machine_minutes, 
                   r.labor_minutes, r.labor_type_id, r.sequence, m.machine_name, lr.rate_name
            FROM routers r
            JOIN machines m ON r.machine_id = m.machine_id
            LEFT JOIN labor_rates lr ON r.labor_type_id = lr.rate_id
            WHERE r.router_id = ? AND r.version = ?
            ORDER BY r.sequence
        """, (router_id, version))
        
        routing_data = cursor.fetchall()
        columns = [description[0] for description in cursor.description]
        routing_list = [dict(zip(columns, row)) for row in routing_data]
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"routing": routing_list},
            message=f"Retrieved routing {router_id} version {version}"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving routing: {str(e)}")

@app.get("/materials/usage", response_model=ForecastResponse)
async def get_materials_usage(forecast_id: Optional[str] = Query(None)):
    """
    Get material usage forecast for purchasing decisions
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Get material usage by joining sales forecast with BOM
        usage_query = """
            SELECT b.material_description, b.unit, b.unit_price, 
                   SUM(s.quantity * b.qty) as total_quantity_needed,
                   SUM(s.quantity * b.material_cost) as total_cost,
                   GROUP_CONCAT(DISTINCT u.unit_name) as products_using
            FROM sales s
            JOIN units u ON s.unit_id = u.unit_id
            JOIN bom b ON u.bom_id = b.bom_id AND u.bom_version = b.version
        """
        
        params = []
        if forecast_id:
            usage_query += " WHERE s.forecast_id = ?"
            params.append(forecast_id)
        
        usage_query += " GROUP BY b.material_description, b.unit, b.unit_price"
        
        cursor.execute(usage_query, params)
        material_data = cursor.fetchall()
        
        materials_usage = []
        for material in material_data:
            materials_usage.append({
                "material_description": material[0],
                "unit": material[1],
                "unit_price": material[2],
                "total_quantity_needed": material[3],
                "total_cost": material[4],
                "products_using": material[5].split(',') if material[5] else []
            })
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"materials": materials_usage},
            message=f"Retrieved material usage for {len(materials_usage)} materials"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving material usage: {str(e)}")

@app.get("/machines/utilization", response_model=ForecastResponse)
async def get_machines_utilization(forecast_id: Optional[str] = Query(None)):
    """
    Get machine utilization forecast and capacity analysis
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Get machine utilization by joining sales forecast with routing
        utilization_query = """
            SELECT m.machine_id, m.machine_name, m.available_minutes_per_month, m.machine_rate,
                   SUM(s.quantity * r.machine_minutes) as total_minutes_required,
                   SUM(s.quantity * r.machine_minutes * m.machine_rate / 60) as total_cost
            FROM sales s
            JOIN units u ON s.unit_id = u.unit_id
            JOIN routers r ON u.router_id = r.router_id AND u.router_version = r.version
            JOIN machines m ON r.machine_id = m.machine_id
        """
        
        params = []
        if forecast_id:
            utilization_query += " WHERE s.forecast_id = ?"
            params.append(forecast_id)
        
        utilization_query += " GROUP BY m.machine_id, m.machine_name, m.available_minutes_per_month, m.machine_rate"
        
        cursor.execute(utilization_query, params)
        machine_data = cursor.fetchall()
        
        machines_utilization = []
        for machine in machine_data:
            machine_id, machine_name, available_minutes, machine_rate, total_minutes, total_cost = machine
            utilization_percent = (total_minutes / available_minutes * 100) if available_minutes > 0 else 0
            capacity_exceeded = total_minutes > available_minutes
            
            machines_utilization.append({
                "machine_id": machine_id,
                "machine_name": machine_name,
                "total_minutes_required": total_minutes,
                "available_minutes_per_month": available_minutes,
                "utilization_percent": utilization_percent,
                "total_cost": total_cost,
                "capacity_exceeded": capacity_exceeded
            })
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"machines": machines_utilization},
            message=f"Retrieved utilization for {len(machines_utilization)} machines"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving machine utilization: {str(e)}")

@app.get("/labor/utilization", response_model=ForecastResponse)
async def get_labor_utilization(forecast_id: Optional[str] = Query(None)):
    """
    Get labor utilization forecast and cost analysis
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Get labor utilization by joining sales forecast with routing and labor rates
        utilization_query = """
            SELECT lr.rate_id, lr.rate_name, lr.rate_amount,
                   SUM(s.quantity * r.labor_minutes) as total_minutes_required,
                   SUM(s.quantity * r.labor_minutes * lr.rate_amount / 60) as total_cost,
                   GROUP_CONCAT(DISTINCT u.unit_name) as products_involved
            FROM sales s
            JOIN units u ON s.unit_id = u.unit_id
            JOIN routers r ON u.router_id = r.router_id AND u.router_version = r.version
            JOIN labor_rates lr ON r.labor_type_id = lr.rate_id
        """
        
        params = []
        if forecast_id:
            utilization_query += " WHERE s.forecast_id = ?"
            params.append(forecast_id)
        
        utilization_query += " GROUP BY lr.rate_id, lr.rate_name, lr.rate_amount"
        
        cursor.execute(utilization_query, params)
        labor_data = cursor.fetchall()
        
        labor_utilization = []
        for labor in labor_data:
            labor_utilization.append({
                "labor_type_id": labor[0],
                "labor_type_name": labor[1],
                "hourly_rate": labor[2],
                "total_minutes_required": labor[3],
                "total_cost": labor[4],
                "products_involved": labor[5].split(',') if labor[5] else []
            })
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"labor": labor_utilization},
            message=f"Retrieved utilization for {len(labor_utilization)} labor types"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving labor utilization: {str(e)}")

@app.post("/bom/clone", response_model=ForecastResponse)
async def clone_bom(clone_request: BOMClone):
    """
    Clone a BOM to a new version
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Copy BOM to new version
        cursor.execute("""
            INSERT INTO bom (bom_id, version, bom_line, material_description, qty, unit, unit_price, material_cost, target_cost)
            SELECT bom_id, ?, bom_line, material_description, qty, unit, unit_price, material_cost, target_cost
            FROM bom
            WHERE bom_id = ? AND version = ?
        """, (clone_request.to_version, clone_request.bom_id, clone_request.from_version))
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            message=f"BOM {clone_request.bom_id} cloned from {clone_request.from_version} to {clone_request.to_version}"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error cloning BOM: {str(e)}")

@app.post("/routing/clone", response_model=ForecastResponse)
async def clone_routing(clone_request: RouterClone):
    """
    Clone a routing to a new version
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Copy routing to new version
        cursor.execute("""
            INSERT INTO routers (router_id, version, unit_id, machine_id, machine_minutes, labor_minutes, labor_type_id, sequence)
            SELECT router_id, ?, unit_id, machine_id, machine_minutes, labor_minutes, labor_type_id, sequence
            FROM routers
            WHERE router_id = ? AND version = ?
        """, (clone_request.to_version, clone_request.router_id, clone_request.from_version))
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            message=f"Routing {clone_request.router_id} cloned from {clone_request.from_version} to {clone_request.to_version}"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error cloning routing: {str(e)}")

@app.patch("/products/{product_id}/bom-version", response_model=ForecastResponse)
async def update_product_bom_version(product_id: str, bom_version: str):
    """
    Update a product's BOM version
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE units SET bom_version = ? WHERE unit_id = ?
        """, (bom_version, product_id))
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            message=f"Product {product_id} BOM version updated to {bom_version}"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating BOM version: {str(e)}")

@app.patch("/products/{product_id}/routing-version", response_model=ForecastResponse)
async def update_product_routing_version(product_id: str, routing_version: str):
    """
    Update a product's routing version
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE units SET router_version = ? WHERE unit_id = ?
        """, (routing_version, product_id))
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            message=f"Product {product_id} routing version updated to {routing_version}"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating routing version: {str(e)}")

# =============================================================================
# BOM MANAGEMENT API ENDPOINTS
# =============================================================================

@app.get("/api/bom", response_model=ForecastResponse)
async def get_all_bom_items():
    """Get all BOM items for the frontend"""
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT bom_id, version, bom_line, material_description, qty, unit, 
                   unit_price, material_cost, target_cost, created_at
            FROM bom 
            ORDER BY bom_id, version, bom_line
        """)
        
        bom_data = cursor.fetchall()
        columns = [description[0] for description in cursor.description]
        bom_list = [dict(zip(columns, row)) for row in bom_data]
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data=bom_list,
            message=f"Retrieved {len(bom_list)} BOM items"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving BOM items: {str(e)}")

@app.post("/api/bom", response_model=ForecastResponse)
async def create_bom_item(bom_data: Dict[str, Any]):
    """Create a new BOM item"""
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Validate required fields
        bom_id = bom_data.get('bom_id')
        if not bom_id:
            raise HTTPException(status_code=400, detail="BOM ID is required")
        
        # Insert BOM item
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
        raise HTTPException(status_code=400, detail=f"BOM item already exists: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating BOM item: {str(e)}")

@app.put("/api/bom/{record_id}", response_model=ForecastResponse)
async def update_bom_item(record_id: str, bom_data: Dict[str, Any]):
    """Update an existing BOM item using composite key"""
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Parse composite key: bom_id-version-bom_line
        parts = record_id.split('-')
        if len(parts) < 3:
            raise HTTPException(status_code=400, detail="Invalid BOM record ID format. Expected: bom_id-version-bom_line")
        
        bom_id = parts[0]
        version = parts[1]
        bom_line = parts[2]
        
        # Build update query
        update_fields = []
        values = []
        
        for key, value in bom_data.items():
            if key not in ['bom_id', 'version', 'bom_line']:  # Don't update key fields
                update_fields.append(f"{key} = ?")
                values.append(value)
        
        if not update_fields:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        set_clause = ", ".join(update_fields)
        values.extend([bom_id, version, bom_line])
        
        cursor.execute(f"UPDATE bom SET {set_clause} WHERE bom_id = ? AND version = ? AND bom_line = ?", values)
        
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail=f"BOM item '{record_id}' not found")
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            message="BOM item updated successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating BOM item: {str(e)}")

@app.delete("/api/bom/{record_id}", response_model=ForecastResponse)
async def delete_bom_item(record_id: str):
    """Delete a BOM item using composite key"""
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Parse composite key: bom_id-version-bom_line
        parts = record_id.split('-')
        if len(parts) < 3:
            raise HTTPException(status_code=400, detail="Invalid BOM record ID format. Expected: bom_id-version-bom_line")
        
        bom_id = parts[0]
        version = parts[1]
        bom_line = parts[2]
        
        # Check if record exists
        cursor.execute("SELECT COUNT(*) FROM bom WHERE bom_id = ? AND version = ? AND bom_line = ?", (bom_id, version, bom_line))
        if cursor.fetchone()[0] == 0:
            raise HTTPException(status_code=404, detail=f"BOM item '{record_id}' not found")
        
        # Delete the record
        cursor.execute("DELETE FROM bom WHERE bom_id = ? AND version = ? AND bom_line = ?", (bom_id, version, bom_line))
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            message="BOM item deleted successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting BOM item: {str(e)}")

@app.get("/api/machines", response_model=ForecastResponse)
async def get_all_machines():
    """Get all machines for the frontend"""
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT machine_id, machine_name, machine_description, machine_rate, 
                   labor_type, available_minutes_per_month, created_at
            FROM machines 
            ORDER BY machine_id
        """)
        
        machine_data = cursor.fetchall()
        columns = [description[0] for description in cursor.description]
        machine_list = [dict(zip(columns, row)) for row in machine_data]
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data=machine_list,
            message=f"Retrieved {len(machine_list)} machines"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving machines: {str(e)}")

@app.get("/api/routers", response_model=ForecastResponse)
async def get_all_routers():
    """Get all router operations for the frontend"""
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Get router operations if they exist
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='router_operations'")
        if cursor.fetchone():
            cursor.execute("""
                SELECT router_id, sequence, machine_id, machine_minutes, labor_minutes, 
                       labor_type_id, operation_description, created_at
                FROM router_operations 
                ORDER BY router_id, sequence
            """)
            router_data = cursor.fetchall()
            columns = [description[0] for description in cursor.description]
            router_list = [dict(zip(columns, row)) for row in router_data]
        else:
            # Fallback to legacy routers table
            cursor.execute("""
                SELECT router_id, version, unit_id, machine_id, machine_minutes, 
                       labor_minutes, labor_type_id, sequence
                FROM routers 
                ORDER BY router_id, sequence
            """)
            router_data = cursor.fetchall()
            columns = [description[0] for description in cursor.description]
            router_list = [dict(zip(columns, row)) for row in router_data]
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data=router_list,
            message=f"Retrieved {len(router_list)} router operations"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving routers: {str(e)}")

@app.get("/api/router_definitions", response_model=ForecastResponse)
async def get_router_definitions():
    """Get all router definitions for the frontend"""
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Check if router_definitions table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='router_definitions'")
        if cursor.fetchone():
            cursor.execute("""
                SELECT router_id, router_name, router_description, version, created_at
                FROM router_definitions 
                ORDER BY router_id
            """)
            router_data = cursor.fetchall()
            columns = [description[0] for description in cursor.description]
            router_list = [dict(zip(columns, row)) for row in router_data]
        else:
            # Return empty list if table doesn't exist
            router_list = []
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data=router_list,
            message=f"Retrieved {len(router_list)} router definitions"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving router definitions: {str(e)}")

@app.get("/api/labor_rates", response_model=ForecastResponse)
async def get_all_labor_rates():
    """Get all labor rates for the frontend"""
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT rate_id, rate_name, rate_description, rate_amount, created_at
            FROM labor_rates 
            ORDER BY rate_id
        """)
        
        labor_data = cursor.fetchall()
        columns = [description[0] for description in cursor.description]
        labor_list = [dict(zip(columns, row)) for row in labor_data]
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data=labor_list,
            message=f"Retrieved {len(labor_list)} labor rates"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving labor rates: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 