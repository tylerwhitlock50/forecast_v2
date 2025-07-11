import pytest
from fastapi.testclient import TestClient

class TestAPIEndpoints:
    """Test all API endpoints"""
    
    def test_health_check(self, client: TestClient):
        """Test the root health check endpoint"""
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Forecast Model + AI Assistant API"
        assert data["status"] == "running"
    
    def test_get_table_data_customers(self, client: TestClient):
        """Test getting customers table data"""
        response = client.get("/data/customers")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "data" in data
        assert "columns" in data
        assert len(data["data"]) == 2  # We have 2 test customers
        assert "customer_id" in data["columns"]
        assert "customer_name" in data["columns"]
    
    def test_get_table_data_units(self, client: TestClient):
        """Test getting units table data"""
        response = client.get("/data/units")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert len(data["data"]) == 2  # We have 2 test units
    
    def test_get_table_data_sales(self, client: TestClient):
        """Test getting sales table data"""
        response = client.get("/data/sales")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert len(data["data"]) == 2  # We have 2 test sales
    
    def test_get_table_data_bom(self, client: TestClient):
        """Test getting BOM table data"""
        response = client.get("/data/bom")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert len(data["data"]) == 2  # We have 2 test BOMs
    
    def test_get_table_data_machines(self, client: TestClient):
        """Test getting machines table data"""
        response = client.get("/data/machines")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert len(data["data"]) == 2  # We have 2 test machines
    
    def test_get_table_data_routers(self, client: TestClient):
        """Test getting routers table data"""
        response = client.get("/data/routers")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert len(data["data"]) == 2  # We have 2 test routers
    
    def test_get_table_data_labor_rates(self, client: TestClient):
        """Test getting labor rates table data"""
        response = client.get("/data/labor_rates")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert len(data["data"]) == 2  # We have 2 test labor rates
    
    def test_get_table_data_payroll(self, client: TestClient):
        """Test getting payroll table data"""
        response = client.get("/data/payroll")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert len(data["data"]) == 2  # We have 2 test employees
    
    def test_get_table_data_invalid_table(self, client: TestClient):
        """Test getting data from non-existent table"""
        response = client.get("/data/nonexistent_table")
        assert response.status_code == 500
        data = response.json()
        assert "no such table" in data["detail"]
    
    def test_chat_endpoint(self, client: TestClient):
        """Test the chat endpoint"""
        chat_request = {
            "message": "Show me sales for January 2024",
            "context": {"period": "2024-01"}
        }
        response = client.post("/chat", json=chat_request)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "data" in data
        assert "sql_statement" in data["data"]
        assert "explanation" in data["data"]
        assert data["data"]["requires_approval"] == True
    
    def test_apply_sql_endpoint_select(self, client: TestClient):
        """Test applying a SELECT SQL statement"""
        sql_request = {
            "sql_statement": "SELECT * FROM customers LIMIT 1",
            "description": "Test SELECT query"
        }
        response = client.post("/apply_sql", json=sql_request)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "message" in data
    
    def test_apply_sql_endpoint_insert(self, client: TestClient):
        """Test applying an INSERT SQL statement"""
        sql_request = {
            "sql_statement": "INSERT INTO customers (customer_id, customer_name) VALUES ('CUST-003', 'Test Customer 3')",
            "description": "Test INSERT query",
            "user_id": "test_user",
            "session_id": "test_session"
        }
        response = client.post("/apply_sql", json=sql_request)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "message" in data
        
        # Verify the insert worked
        response = client.get("/data/customers")
        data = response.json()
        assert len(data["data"]) == 3  # Now we have 3 customers
    
    def test_get_execution_logs(self, client: TestClient):
        """Test getting execution logs"""
        # First execute some SQL to create logs
        sql_request = {
            "sql_statement": "INSERT INTO customers (customer_id, customer_name) VALUES ('CUST-004', 'Log Test')",
            "description": "Test for logging",
            "user_id": "log_user",
            "session_id": "log_session"
        }
        client.post("/apply_sql", json=sql_request)
        
        # Get execution logs
        response = client.get("/logs/execution")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "data" in data
        assert "logs" in data["data"]
        assert len(data["data"]["logs"]) > 0
        
        # Test filtering
        response = client.get("/logs/execution?user_id=log_user&limit=5")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert len(data["data"]["logs"]) > 0
    
    def test_replay_execution_logs(self, client: TestClient):
        """Test replaying execution logs"""
        # First execute some SQL to create logs
        sql_request = {
            "sql_statement": "INSERT INTO customers (customer_id, customer_name) VALUES ('CUST-005', 'Replay Test')",
            "description": "Test for replay",
            "user_id": "replay_user",
            "session_id": "replay_session"
        }
        client.post("/apply_sql", json=sql_request)
        
        # Get current customer count
        response = client.get("/data/customers")
        initial_count = len(response.json()["data"])
        
        # Clear customers table
        clear_request = {
            "sql_statement": "DELETE FROM customers",
            "description": "Clear for replay test"
        }
        client.post("/apply_sql", json=clear_request)
        
        # Verify table is empty
        response = client.get("/data/customers")
        assert len(response.json()["data"]) == 0
        
        # Replay execution logs
        response = client.post("/rollback/replay?user_id=replay_user")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "replayed_count" in data["data"]
        assert data["data"]["replayed_count"] >= 1
        
        # Verify data was restored
        response = client.get("/data/customers")
        assert len(response.json()["data"]) >= 1
    
    def test_reset_database(self, client: TestClient):
        """Test resetting database to initial state"""
        # Add some data first
        sql_request = {
            "sql_statement": "INSERT INTO customers (customer_id, customer_name) VALUES ('CUST-006', 'Reset Test')",
            "description": "Test for reset"
        }
        client.post("/apply_sql", json=sql_request)
        
        # Verify data was added
        response = client.get("/data/customers")
        initial_count = len(response.json()["data"])
        assert initial_count > 1
        
        # Reset database
        response = client.post("/rollback/reset")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        
        # Verify data was reset to CSV state
        response = client.get("/data/customers")
        data = response.json()
        assert len(data["data"]) == 1  # Back to original CSV data
    
    def test_apply_sql_endpoint_invalid_sql(self, client: TestClient):
        """Test applying invalid SQL statement"""
        sql_request = {
            "sql_statement": "INVALID SQL STATEMENT",
            "description": "Test invalid SQL"
        }
        response = client.post("/apply_sql", json=sql_request)
        assert response.status_code == 500
        data = response.json()
        assert "error" in data["detail"]
    
    def test_get_forecast(self, client: TestClient):
        """Test getting forecast data"""
        response = client.get("/forecast")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "data" in data
        
        forecast_data = data["data"]
        assert "sales_forecast" in forecast_data
        assert "bom_data" in forecast_data
        assert "router_data" in forecast_data
        assert "payroll_data" in forecast_data
        assert "forecast_results" in forecast_data
        assert "forecast_columns" in forecast_data
        assert "forecast_date" in forecast_data
        
        # Check that we have data in each section
        assert len(forecast_data["sales_forecast"]) > 0
        assert len(forecast_data["bom_data"]) > 0
        assert len(forecast_data["router_data"]) > 0
        assert len(forecast_data["payroll_data"]) > 0
        assert len(forecast_data["forecast_results"]) > 0
    
    def test_get_saved_forecast_results(self, client: TestClient):
        """Test getting saved forecast results"""
        # First generate forecast data
        client.get("/forecast")
        
        # Test getting all results
        response = client.get("/forecast/results")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "data" in data
        assert len(data["data"]["results"]) > 0
        
        # Test filtering by period
        response = client.get("/forecast/results?period=2024-01")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert len(data["data"]["results"]) > 0
        
        # Test with limit
        response = client.get("/forecast/results?limit=1")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert len(data["data"]["results"]) <= 1
    
    def test_recalculate_forecast(self, client: TestClient):
        """Test recalculating forecast"""
        response = client.post("/recalculate")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "message" in data
        assert "recalculated successfully" in data["message"]
    
    def test_snapshot_endpoint(self, client: TestClient):
        """Test the snapshot endpoint"""
        response = client.get("/snapshot")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert "message" in data
        assert "snapshot ready" in data["message"]
    
    def test_api_documentation(self, client: TestClient):
        """Test that API documentation is accessible"""
        response = client.get("/docs")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]
    
    def test_openapi_schema(self, client: TestClient):
        """Test that OpenAPI schema is accessible"""
        response = client.get("/openapi.json")
        assert response.status_code == 200
        data = response.json()
        assert "openapi" in data
        assert "paths" in data
        assert "components" in data 