import pytest
import os
import tempfile
import shutil
from fastapi.testclient import TestClient
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from app.db.database import DatabaseManager
from app.db import (
    get_table_data,
    get_forecast_data,
    execute_sql,
    get_saved_forecast_results,
    get_execution_logs,
    replay_execution_logs,
    reset_to_initial_state,
    ChatRequest,
    SQLApplyRequest,
    ForecastResponse
)
from typing import Optional

@pytest.fixture(scope="session")
def test_data_dir():
    """Create a temporary directory for test data"""
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    shutil.rmtree(temp_dir)

@pytest.fixture(scope="session")
def test_db_manager(test_data_dir):
    """Create a test database manager with temporary paths"""
    # Create test CSV files
    create_test_csv_files(test_data_dir)
    
    # Create database manager with test paths
    db_manager = DatabaseManager(
        database_path=os.path.join(test_data_dir, "test_forecast.db"),
        data_dir=test_data_dir
    )
    
    # Initialize the test database
    db_manager.initialize()
    
    return db_manager

@pytest.fixture
def test_app(test_db_manager):
    """Create a test FastAPI app instance"""
    # Override the global database manager for testing
    from app.db.database import db_manager
    original_db_manager = db_manager
    
    # Replace with test database manager
    import app.db.database
    app.db.database.db_manager = test_db_manager
    
    # Create test app
    test_app = FastAPI(
        title="Test Forecast Model + AI Assistant",
        description="Test version of the forecasting API",
        version="1.0.0"
    )
    
    # Add CORS middleware
    test_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Add test endpoints
    @test_app.get("/")
    async def root():
        """Health check endpoint"""
        return {"message": "Forecast Model + AI Assistant API", "status": "running"}
    
    @test_app.get("/data/{table_name}")
    async def get_table_data_endpoint(table_name: str):
        """Get data from a specific table"""
        result = get_table_data(table_name)
        if result["status"] == "error":
            from fastapi import HTTPException
            raise HTTPException(status_code=500, detail=result["error"])
        return result
    
    @test_app.post("/chat", response_model=ForecastResponse)
    async def chat_endpoint(request: ChatRequest):
        """Chat endpoint for testing"""
        try:
            mock_sql = f"-- Generated SQL for: {request.message}\nSELECT * FROM sales WHERE period = '2024-01';"
            return ForecastResponse(
                status="success",
                data={
                    "sql_statement": mock_sql,
                    "explanation": f"Generated SQL query based on your request: {request.message}",
                    "requires_approval": True
                }
            )
        except Exception as e:
            from fastapi import HTTPException
            raise HTTPException(status_code=500, detail=str(e))

    @test_app.post("/agent", response_model=ForecastResponse)
    async def agent_endpoint(request: ChatRequest):
        """Agent endpoint for testing"""
        return ForecastResponse(
            status="success",
            data={"response": f"Agent processed: {request.message}"},
            message="Agent response generated"
        )

    @test_app.post("/voice", response_model=ForecastResponse)
    async def voice_endpoint(
        file: UploadFile = File(...),
        mode: str = Form("chat"),
    ):
        """Mock voice endpoint for testing"""
        transcription = "test transcription"
        if mode == "agent":
            return await agent_endpoint(ChatRequest(message=transcription))
        return await chat_endpoint(ChatRequest(message=transcription))

    
    @test_app.post("/apply_sql", response_model=ForecastResponse)
    async def apply_sql_endpoint(request: SQLApplyRequest):
        """Apply SQL endpoint for testing"""
        result = execute_sql(
            request.sql_statement,
            description=request.description,
            user_id=getattr(request, 'user_id', None),
            session_id=getattr(request, 'session_id', None)
        )
        if result["status"] == "error":
            from fastapi import HTTPException
            raise HTTPException(status_code=500, detail=result["error"])
        return ForecastResponse(
            status="success",
            message=f"SQL applied successfully: {request.description}"
        )
    
    @test_app.get("/logs/execution", response_model=ForecastResponse)
    async def get_execution_logs_endpoint(
        limit: Optional[int] = None,
        user_id: Optional[str] = None,
        session_id: Optional[str] = None,
        status: Optional[str] = None
    ):
        """Execution logs endpoint for testing"""
        result = get_execution_logs(limit=limit, user_id=user_id, session_id=session_id, status=status)
        if result["status"] == "error":
            from fastapi import HTTPException
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
    
    @test_app.post("/rollback/replay", response_model=ForecastResponse)
    async def replay_execution_logs_endpoint(
        target_date: Optional[str] = None,
        max_log_id: Optional[int] = None,
        user_id: Optional[str] = None,
        session_id: Optional[str] = None
    ):
        """Replay execution logs endpoint for testing"""
        result = replay_execution_logs(
            target_date=target_date,
            max_log_id=max_log_id,
            user_id=user_id,
            session_id=session_id
        )
        if result["status"] == "error":
            from fastapi import HTTPException
            raise HTTPException(status_code=500, detail=result["error"])
        return ForecastResponse(
            status="success",
            data=result,
            message=result["message"]
        )
    
    @test_app.post("/rollback/reset", response_model=ForecastResponse)
    async def reset_database_endpoint():
        """Reset database endpoint for testing"""
        result = reset_to_initial_state()
        if result["status"] == "error":
            from fastapi import HTTPException
            raise HTTPException(status_code=500, detail=result["error"])
        return ForecastResponse(
            status="success",
            message=result["message"]
        )
    
    @test_app.get("/forecast", response_model=ForecastResponse)
    async def get_forecast():
        """Forecast endpoint for testing"""
        result = get_forecast_data()
        if result["status"] == "error":
            from fastapi import HTTPException
            raise HTTPException(status_code=500, detail=result["error"])
        return ForecastResponse(
            status="success",
            data=result["data"]
        )
    
    @test_app.get("/forecast/results", response_model=ForecastResponse)
    async def get_saved_forecast_results_endpoint(
        period: Optional[str] = None,
        limit: Optional[int] = None
    ):
        """Forecast results endpoint for testing"""
        result = get_saved_forecast_results(period=period, limit=limit)
        if result["status"] == "error":
            from fastapi import HTTPException
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
    
    @test_app.post("/recalculate", response_model=ForecastResponse)
    async def recalculate_forecast():
        """Recalculate endpoint for testing"""
        try:
            return ForecastResponse(
                status="success",
                message="Forecast recalculated successfully"
            )
        except Exception as e:
            from fastapi import HTTPException
            raise HTTPException(status_code=500, detail=str(e))
    
    @test_app.get("/snapshot")
    async def export_snapshot():
        """Snapshot endpoint for testing"""
        try:
            database_path = test_db_manager.database_path
            if os.path.exists(database_path):
                return {"status": "success", "message": "Database snapshot ready for export"}
            else:
                from fastapi import HTTPException
                raise HTTPException(status_code=404, detail="Database not found")
        except Exception as e:
            from fastapi import HTTPException
            raise HTTPException(status_code=500, detail=str(e))
    
    @test_app.get("/docs")
    async def get_docs():
        """Docs endpoint for testing"""
        return {"message": "API Documentation"}
    
    @test_app.get("/openapi.json")
    async def get_openapi():
        """OpenAPI schema for testing"""
        return {"openapi": "3.0.0", "paths": {}, "components": {}}
    
    yield test_app
    
    # Restore original database manager
    app.db.database.db_manager = original_db_manager

@pytest.fixture
def client(test_app):
    """Create a test client with the test app"""
    with TestClient(test_app) as test_client:
        yield test_client

def create_test_csv_files(data_dir):
    """Create test CSV files for testing"""
    
    # Customers
    customers_csv = os.path.join(data_dir, "customers.csv")
    with open(customers_csv, 'w') as f:
        f.write("customer_id,customer_name,customer_type,region\n")
        f.write("CUST-001,Test Corp,Manufacturing,North\n")
        f.write("CUST-002,Test Tech,Technology,West\n")
    
    # Units
    units_csv = os.path.join(data_dir, "units.csv")
    with open(units_csv, 'w') as f:
        f.write("unit_id,unit_name,unit_description,base_price,unit_type\n")
        f.write("PROD-001,Test Product 1,Test description 1,50.00,Component\n")
        f.write("PROD-002,Test Product 2,Test description 2,75.00,Assembly\n")
    
    # Sales
    sales_csv = os.path.join(data_dir, "sales.csv")
    with open(sales_csv, 'w') as f:
        f.write("sale_id,customer_id,unit_id,period,quantity,unit_price,total_revenue\n")
        f.write("SALE-001,CUST-001,PROD-001,2024-01,10,50.00,500.00\n")
        f.write("SALE-002,CUST-002,PROD-002,2024-01,5,75.00,375.00\n")
    
    # BOM
    bom_csv = os.path.join(data_dir, "bom.csv")
    with open(bom_csv, 'w') as f:
        f.write("bom_id,unit_id,router_id,material_cost\n")
        f.write("BOM-001,PROD-001,R0001,25.00\n")
        f.write("BOM-002,PROD-002,R0002,35.00\n")
    
    # Machines
    machines_csv = os.path.join(data_dir, "machines.csv")
    with open(machines_csv, 'w') as f:
        f.write("machine_id,machine_name,machine_description,machine_rate,labor_type\n")
        f.write("M0001,Test Machine 1,Test machine description,100.00,Heavy Equipment\n")
        f.write("M0002,Test Machine 2,Test machine description,80.00,Light Equipment\n")
    
    # Routers
    routers_csv = os.path.join(data_dir, "routers.csv")
    with open(routers_csv, 'w') as f:
        f.write("router_id,unit_id,machine_id,machine_minutes,labor_minutes,sequence\n")
        f.write("R0001,PROD-001,M0001,30,15,1\n")
        f.write("R0002,PROD-002,M0002,45,20,1\n")
    
    # Labor Rates
    labor_rates_csv = os.path.join(data_dir, "labor_rates.csv")
    with open(labor_rates_csv, 'w') as f:
        f.write("rate_id,rate_name,rate_description,rate_amount,rate_type\n")
        f.write("RATE-001,Heavy Equipment,Heavy equipment operator,35.00,Hourly\n")
        f.write("RATE-002,Light Equipment,Light equipment operator,28.00,Hourly\n")
    
    # Payroll
    payroll_csv = os.path.join(data_dir, "payroll.csv")
    with open(payroll_csv, 'w') as f:
        f.write("employee_id,employee_name,weekly_hours,hourly_rate,labor_type,start_date,end_date\n")
        f.write("EMP-001,Test Employee 1,40,35.00,Heavy Equipment,2024-01-01,2024-12-31\n")
        f.write("EMP-002,Test Employee 2,40,28.00,Light Equipment,2024-01-01,2024-12-31\n") 