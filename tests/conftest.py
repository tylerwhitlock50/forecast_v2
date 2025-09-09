import pytest
import os
import tempfile
import shutil
from fastapi.testclient import TestClient
from fastapi import FastAPI, UploadFile, File, Query, Request
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
    async def get_table_data_endpoint(
        request: Request,
        table_name: str,
        forecast_id: Optional[str] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ):
        """Get data from a specific table"""
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
    @test_app.post("/plan_execute", response_model=ForecastResponse)
    async def plan_execute_endpoint(request: ChatRequest):
        """Plan and execute endpoint for testing"""
        return ForecastResponse(
            status="success",
            data={"plan": ["step 1"], "results": [{"step": "step 1", "result": "done"}]},
            message="Plan executed",
        )

 
    @test_app.post("/voice", response_model=ForecastResponse)
    async def voice_endpoint(audio: UploadFile = File(...), session_id: Optional[str] = None):
        """Voice endpoint for testing"""
        await audio.read()
        return ForecastResponse(
            status="success",
            data={"transcript": "test transcript", "response": "Agent processed: test transcript"},
            message="Voice command processed",
        )

    @test_app.post("/load_table", response_model=ForecastResponse)
    async def load_table_endpoint(table_name: str = Query(...), mode: str = Query("append"), csv_file: UploadFile = File(...)):
        await csv_file.read()
        return ForecastResponse(status="success", data={"rows_loaded": 2}, message="Loaded data")

    @test_app.get("/data_quality", response_model=ForecastResponse)
    async def data_quality_endpoint():
        return ForecastResponse(status="success", data={"sales_missing_bom": [], "routers_missing_machine": [], "employees_missing_labor_rate": []}, message="Data quality check complete")

    
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
        f.write(
            "unit_id,unit_name,unit_description,base_price,unit_type,bom_id,bom_version,router_id,router_version\n"
        )
        f.write(
            "PROD-001,Test Product 1,Test description 1,50.00,Component,BOM-001,1.0,R0001,1.0\n"
        )
        f.write(
            "PROD-002,Test Product 2,Test description 2,75.00,Assembly,BOM-002,1.0,R0002,1.0\n"
        )

    # Sales
    sales_csv = os.path.join(data_dir, "sales.csv")
    with open(sales_csv, 'w') as f:
        f.write(
            "sale_id,customer_id,unit_id,period,quantity,unit_price,total_revenue,forecast_id\n"
        )
        f.write("SALE-001,CUST-001,PROD-001,2024-01,10,50.00,500.00,F1\n")
        f.write("SALE-002,CUST-002,PROD-002,2024-01,5,75.00,375.00,F2\n")
    
    # Forecast scenarios
    forecast_csv = os.path.join(data_dir, "forecast.csv")
    with open(forecast_csv, 'w') as f:
        f.write("forecast_id,name,description\n")
        f.write("F1,Base Case,Base scenario\n")
        f.write("F2,Alt Case,Alternate scenario\n")

    # BOM
    bom_csv = os.path.join(data_dir, "bom.csv")
    with open(bom_csv, 'w') as f:
        f.write(
            "bom_id,version,bom_line,material_description,qty,unit,unit_price,material_cost,target_cost\n"
        )
        f.write("BOM-001,1.0,1,Steel,1,EA,25.00,25.00,25.00\n")
        f.write("BOM-002,1.0,1,Aluminum,1,EA,35.00,35.00,35.00\n")

    # Machines
    machines_csv = os.path.join(data_dir, "machines.csv")
    with open(machines_csv, 'w') as f:
        f.write("machine_id,machine_name,machine_description,machine_rate,labor_type\n")
        f.write("M0001,Test Machine 1,Test machine description,100.00,Heavy Equipment\n")
        f.write("M0002,Test Machine 2,Test machine description,80.00,Light Equipment\n")
    
    # Router definitions
    routers_csv = os.path.join(data_dir, "routers.csv")
    with open(routers_csv, 'w') as f:
        f.write("router_id,router_name,router_description,version\n")
        f.write("R0001,Router 1,Test router 1,1.0\n")
        f.write("R0002,Router 2,Test router 2,1.0\n")

    # Router operations
    router_ops_csv = os.path.join(data_dir, "router_operations.csv")
    with open(router_ops_csv, 'w') as f:
        f.write(
            "router_id,sequence,machine_id,machine_minutes,labor_minutes,labor_type_id,operation_description\n"
        )
        f.write("R0001,1,M0001,30,15,RATE-001,Op1\n")
        f.write("R0002,1,M0002,45,20,RATE-002,Op1\n")

    # Legacy routers table for backward compatibility
    routers_legacy_csv = os.path.join(data_dir, "routers_legacy.csv")
    with open(routers_legacy_csv, 'w') as f:
        f.write("router_id,version,unit_id,machine_id,machine_minutes,labor_minutes,labor_type_id,sequence\n")
        f.write("R0001,1.0,PROD-001,M0001,30,15,RATE-001,1\n")
        f.write("R0002,1.0,PROD-002,M0002,45,20,RATE-002,1\n")
    
    # Labor Rates
    labor_rates_csv = os.path.join(data_dir, "labor_rates.csv")
    with open(labor_rates_csv, 'w') as f:
        f.write("rate_id,rate_name,rate_description,rate_amount,rate_type\n")
        f.write("RATE-001,Heavy Equipment,Heavy equipment operator,35.00,Hourly\n")
        f.write("RATE-002,Light Equipment,Light equipment operator,28.00,Hourly\n")
    
    # Payroll
    payroll_csv = os.path.join(data_dir, "payroll.csv")
    with open(payroll_csv, 'w') as f:
        f.write(
            "employee_id,employee_name,weekly_hours,hourly_rate,labor_type,start_date,end_date,forecast_id\n"
        )
        f.write(
            "EMP-001,Test Employee 1,40,35.00,Heavy Equipment,2024-01-01,2024-12-31,F1\n"
        )
        f.write(
            "EMP-002,Test Employee 2,40,28.00,Light Equipment,2024-01-01,2024-12-31,F2\n"
        )