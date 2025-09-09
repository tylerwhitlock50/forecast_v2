import pytest
import os
import tempfile
import shutil
from app.db.database import DatabaseManager

class TestDatabaseManager:
    """Test database manager functionality"""
    
    @pytest.fixture
    def temp_db_manager(self):
        """Create a temporary database manager for testing"""
        temp_dir = tempfile.mkdtemp()
        
        # Create test CSV files
        self.create_test_csv_files(temp_dir)
        
        db_manager = DatabaseManager(
            database_path=os.path.join(temp_dir, "test.db"),
            data_dir=temp_dir
        )
        
        yield db_manager
        
        # Cleanup - no need to close connection since we create new ones each time
        shutil.rmtree(temp_dir)
    
    def create_test_csv_files(self, data_dir):
        """Create minimal test CSV files"""
        # Customers
        customers_csv = os.path.join(data_dir, "customers.csv")
        with open(customers_csv, 'w') as f:
            f.write("customer_id,customer_name,customer_type,region\n")
            f.write("CUST-001,Test Corp,Manufacturing,North\n")
        
        # Units
        units_csv = os.path.join(data_dir, "units.csv")
        with open(units_csv, 'w') as f:
            f.write(
                "unit_id,unit_name,unit_description,base_price,unit_type,bom_id,bom_version,router_id,router_version\n"
            )
            f.write(
                "PROD-001,Test Product,Test description,50.00,Component,BOM-001,1.0,R0001,1.0\n"
            )

        # Sales
        sales_csv = os.path.join(data_dir, "sales.csv")
        with open(sales_csv, 'w') as f:
            f.write(
                "sale_id,customer_id,unit_id,period,quantity,unit_price,total_revenue,forecast_id\n"
            )
            f.write("SALE-001,CUST-001,PROD-001,2024-01,10,50.00,500.00,F1\n")
        
        # Forecast scenarios
        forecast_csv = os.path.join(data_dir, "forecast.csv")
        with open(forecast_csv, 'w') as f:
            f.write("forecast_id,name,description\n")
            f.write("F1,Base Case,Base scenario\n")

        # BOM
        bom_csv = os.path.join(data_dir, "bom.csv")
        with open(bom_csv, 'w') as f:
            f.write(
                "bom_id,version,bom_line,material_description,qty,unit,unit_price,material_cost,target_cost\n"
            )
            f.write("BOM-001,1.0,1,Steel,1,EA,25.00,25.00,25.00\n")

        # Machines
        machines_csv = os.path.join(data_dir, "machines.csv")
        with open(machines_csv, 'w') as f:
            f.write("machine_id,machine_name,machine_description,machine_rate,labor_type\n")
            f.write("M0001,Test Machine,Test description,100.00,Heavy Equipment\n")
        
        # Router definitions
        routers_csv = os.path.join(data_dir, "routers.csv")
        with open(routers_csv, 'w') as f:
            f.write("router_id,router_name,router_description,version\n")
            f.write("R0001,Router 1,Test router,1.0\n")

        # Router operations
        router_ops_csv = os.path.join(data_dir, "router_operations.csv")
        with open(router_ops_csv, 'w') as f:
            f.write(
                "router_id,sequence,machine_id,machine_minutes,labor_minutes,labor_type_id,operation_description\n"
            )
            f.write("R0001,1,M0001,30,15,RATE-001,Op1\n")

        # Legacy routers table for backward compatibility
        routers_legacy_csv = os.path.join(data_dir, "routers_legacy.csv")
        with open(routers_legacy_csv, 'w') as f:
            f.write("router_id,version,unit_id,machine_id,machine_minutes,labor_minutes,labor_type_id,sequence\n")
            f.write("R0001,1.0,PROD-001,M0001,30,15,RATE-001,1\n")
        
        # Labor Rates
        labor_rates_csv = os.path.join(data_dir, "labor_rates.csv")
        with open(labor_rates_csv, 'w') as f:
            f.write("rate_id,rate_name,rate_description,rate_amount,rate_type\n")
            f.write("RATE-001,Heavy Equipment,Heavy equipment operator,35.00,Hourly\n")
        
        # Payroll
        payroll_csv = os.path.join(data_dir, "payroll.csv")
        with open(payroll_csv, 'w') as f:
            f.write(
                "employee_id,employee_name,weekly_hours,hourly_rate,labor_type,start_date,end_date,forecast_id\n"
            )
            f.write(
                "EMP-001,Test Employee,40,35.00,Heavy Equipment,2024-01-01,2024-12-31,F1\n"
            )
    
    def test_database_initialization(self, temp_db_manager):
        """Test database initialization"""
        temp_db_manager.initialize()
        
        # Check that database file was created
        assert os.path.exists(temp_db_manager.database_path)
        
        # Check that tables were created
        conn = temp_db_manager.get_connection()
        cursor = conn.cursor()
        
        # Get list of tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [row[0] for row in cursor.fetchall()]
        
        expected_tables = [
            'customers', 'units', 'sales', 'bom', 
            'routers', 'machines', 'labor_rates', 'payroll'
        ]
        
        for table in expected_tables:
            assert table in tables
        
        conn.close()
    
    def test_csv_data_loading(self, temp_db_manager):
        """Test that CSV data is loaded correctly"""
        temp_db_manager.initialize()
        
        # Check customers table
        result = temp_db_manager.get_table_data('customers')
        assert result["status"] == "success"
        assert len(result["data"]) == 1
        assert result["data"][0]["customer_id"] == "CUST-001"
        assert result["data"][0]["customer_name"] == "Test Corp"
        
        # Check units table
        result = temp_db_manager.get_table_data('units')
        assert result["status"] == "success"
        assert len(result["data"]) == 1
        assert result["data"][0]["unit_id"] == "PROD-001"
        assert result["data"][0]["unit_name"] == "Test Product"
        
        # Check sales table
        result = temp_db_manager.get_table_data('sales')
        assert result["status"] == "success"
        assert len(result["data"]) == 1
        assert result["data"][0]["sale_id"] == "SALE-001"
        assert result["data"][0]["total_revenue"] == 500.00

    def test_get_table_data_with_filters(self, temp_db_manager):
        """Test filtering table data using manager helper"""
        temp_db_manager.initialize()
        result = temp_db_manager.get_table_data('customers', filters={'customer_id': 'CUST-001'})
        assert result["status"] == "success"
        assert len(result["data"]) == 1
        assert result["data"][0]["customer_id"] == 'CUST-001'

    def test_get_table_data_with_pagination(self, temp_db_manager):
        """Test limiting and offsetting results"""
        temp_db_manager.initialize()
        conn = temp_db_manager.get_connection()
        conn.execute(
            "INSERT INTO customers (customer_id, customer_name, customer_type, region) VALUES (?,?,?,?)",
            ("CUST-002", "Another Corp", "Manufacturing", "South"),
        )
        conn.commit()
        conn.close()

        result = temp_db_manager.get_table_data('customers', limit=1, offset=1)
        assert result["status"] == "success"
        assert len(result["data"]) == 1
        assert result["data"][0]["customer_id"] == 'CUST-002'
    
    def test_get_forecast_data(self, temp_db_manager):
        """Test getting forecast data with joins"""
        temp_db_manager.initialize()
        
        result = temp_db_manager.get_forecast_data()
        assert result["status"] == "success"
        assert "data" in result
        
        forecast_data = result["data"]
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
        
        # Check forecast results structure
        forecast_result = forecast_data["forecast_results"][0]
        expected_fields = [
            "forecast_id", "forecast_date", "period", "customer_id", "customer_name",
            "unit_id", "unit_name", "quantity", "unit_price", "total_revenue",
            "material_cost", "labor_cost", "machine_cost", "total_cost",
            "gross_margin", "margin_percentage"
        ]
        for field in expected_fields:
            assert field in forecast_result
    
    def test_get_saved_forecast_results(self, temp_db_manager):
        """Test retrieving saved forecast results"""
        temp_db_manager.initialize()
        
        # First generate forecast data
        temp_db_manager.get_forecast_data()
        
        # Test getting all results
        result = temp_db_manager.get_saved_forecast_results()
        assert result["status"] == "success"
        assert "data" in result
        assert "columns" in result
        assert "summary" in result
        assert len(result["data"]) > 0
        
        # Test filtering by period
        result = temp_db_manager.get_saved_forecast_results(period="2024-01")
        assert result["status"] == "success"
        assert len(result["data"]) > 0
        
        # Test with limit
        result = temp_db_manager.get_saved_forecast_results(limit=1)
        assert result["status"] == "success"
        assert len(result["data"]) <= 1
        
        # Test summary statistics
        summary = result["summary"]
        assert "total_records" in summary
        assert "total_revenue" in summary
        assert "total_cost" in summary
        assert "total_margin" in summary
        assert "avg_margin_percentage" in summary
    
    def test_execute_sql_select(self, temp_db_manager):
        """Test executing SELECT SQL statements"""
        temp_db_manager.initialize()
        
        result = temp_db_manager.execute_sql("SELECT * FROM customers")
        assert result["status"] == "success"
        assert "data" in result
        assert "columns" in result
        assert len(result["data"]) == 1
        assert "customer_id" in result["columns"]
    
    def test_execute_sql_insert(self, temp_db_manager):
        """Test executing INSERT SQL statements"""
        temp_db_manager.initialize()
        
        # Insert a new customer
        result = temp_db_manager.execute_sql(
            "INSERT INTO customers (customer_id, customer_name) VALUES ('CUST-002', 'Test Customer 2')",
            description="Test insert",
            user_id="test_user",
            session_id="test_session"
        )
        assert result["status"] == "success"
        assert "message" in result
        
        # Verify the insert worked
        result = temp_db_manager.get_table_data('customers')
        assert len(result["data"]) == 2
    
    def test_execute_sql_update(self, temp_db_manager):
        """Test executing UPDATE SQL statements"""
        temp_db_manager.initialize()
        
        # Update a customer name
        result = temp_db_manager.execute_sql(
            "UPDATE customers SET customer_name = 'Updated Corp' WHERE customer_id = 'CUST-001'",
            description="Test update",
            user_id="test_user",
            session_id="test_session"
        )
        assert result["status"] == "success"
        assert "message" in result
        
        # Verify the update worked
        result = temp_db_manager.get_table_data('customers')
        assert result["data"][0]["customer_name"] == "Updated Corp"
    
    def test_execute_sql_invalid(self, temp_db_manager):
        """Test executing invalid SQL statements"""
        temp_db_manager.initialize()
        
        result = temp_db_manager.execute_sql("INVALID SQL STATEMENT")
        assert result["status"] == "error"
        assert "error" in result
    
    def test_execution_logging(self, temp_db_manager):
        """Test that SQL executions are logged"""
        temp_db_manager.initialize()
        
        # Execute some SQL statements
        temp_db_manager.execute_sql(
            "INSERT INTO customers (customer_id, customer_name) VALUES ('CUST-003', 'Test Customer 3')",
            description="Test insert for logging",
            user_id="test_user",
            session_id="test_session"
        )
        
        temp_db_manager.execute_sql(
            "UPDATE customers SET customer_name = 'Updated Name' WHERE customer_id = 'CUST-003'",
            description="Test update for logging",
            user_id="test_user",
            session_id="test_session"
        )
        
        # Get execution logs
        result = temp_db_manager.get_execution_logs()
        assert result["status"] == "success"
        assert len(result["data"]) >= 2
        
        # Check log structure
        log_entry = result["data"][0]
        expected_fields = [
            "log_id", "execution_date", "sql_statement", "description", 
            "user_id", "session_id", "execution_status", "error_message", 
            "rows_affected", "execution_time_ms"
        ]
        for field in expected_fields:
            assert field in log_entry
        
        # Check that our test entries are logged
        test_logs = [log for log in result["data"] if log.get("user_id") == "test_user"]
        assert len(test_logs) >= 2
        
        # Check summary statistics
        summary = result["summary"]
        assert "total_executions" in summary
        assert "successful_executions" in summary
        assert "failed_executions" in summary
        assert "avg_execution_time_ms" in summary
        assert "total_rows_affected" in summary
    
    def test_execution_log_filtering(self, temp_db_manager):
        """Test execution log filtering"""
        temp_db_manager.initialize()
        
        # Execute SQL with different users
        temp_db_manager.execute_sql(
            "INSERT INTO customers (customer_id, customer_name) VALUES ('CUST-004', 'User 1 Customer')",
            description="User 1 insert",
            user_id="user1",
            session_id="session1"
        )
        
        temp_db_manager.execute_sql(
            "INSERT INTO customers (customer_id, customer_name) VALUES ('CUST-005', 'User 2 Customer')",
            description="User 2 insert",
            user_id="user2",
            session_id="session2"
        )
        
        # Test filtering by user
        result = temp_db_manager.get_execution_logs(user_id="user1")
        assert result["status"] == "success"
        assert len(result["data"]) >= 1
        assert all(log["user_id"] == "user1" for log in result["data"])
        
        # Test filtering by session
        result = temp_db_manager.get_execution_logs(session_id="session2")
        assert result["status"] == "success"
        assert len(result["data"]) >= 1
        assert all(log["session_id"] == "session2" for log in result["data"])
        
        # Test filtering by status
        result = temp_db_manager.get_execution_logs(status="success")
        assert result["status"] == "success"
        assert all(log["execution_status"] == "success" for log in result["data"])
    
    def test_replay_execution_logs(self, temp_db_manager):
        """Test replaying execution logs"""
        temp_db_manager.initialize()
        
        # Execute some SQL statements
        temp_db_manager.execute_sql(
            "INSERT INTO customers (customer_id, customer_name) VALUES ('CUST-006', 'Replay Test 1')",
            description="First insert for replay test",
            user_id="replay_user",
            session_id="replay_session"
        )
        
        temp_db_manager.execute_sql(
            "INSERT INTO customers (customer_id, customer_name) VALUES ('CUST-007', 'Replay Test 2')",
            description="Second insert for replay test",
            user_id="replay_user",
            session_id="replay_session"
        )
        
        # Get the current state
        result = temp_db_manager.get_table_data('customers')
        initial_count = len(result["data"])
        
        # Clear the customers table
        temp_db_manager.execute_sql("DELETE FROM customers")
        
        # Verify table is empty
        result = temp_db_manager.get_table_data('customers')
        assert len(result["data"]) == 0
        
        # Replay the execution logs
        result = temp_db_manager.replay_execution_logs(user_id="replay_user")
        assert result["status"] == "success"
        assert result["replayed_count"] >= 2
        
        # Verify the data was restored
        result = temp_db_manager.get_table_data('customers')
        assert len(result["data"]) >= 2
    
    def test_reset_to_initial_state(self, temp_db_manager):
        """Test resetting database to initial state"""
        temp_db_manager.initialize()
        
        # Add some data
        temp_db_manager.execute_sql(
            "INSERT INTO customers (customer_id, customer_name) VALUES ('CUST-008', 'Reset Test')",
            description="Test insert for reset"
        )
        
        # Verify data was added
        result = temp_db_manager.get_table_data('customers')
        initial_count = len(result["data"])
        assert initial_count > 1  # Should have original + new data
        
        # Reset to initial state
        result = temp_db_manager.reset_to_initial_state()
        assert result["status"] == "success"
        
        # Verify data was reset to CSV state
        result = temp_db_manager.get_table_data('customers')
        assert len(result["data"]) == 1  # Back to original CSV data
    
    def test_get_table_data_invalid_table(self, temp_db_manager):
        """Test getting data from non-existent table"""
        temp_db_manager.initialize()
        
        result = temp_db_manager.get_table_data('nonexistent_table')
        assert result["status"] == "error"
        assert "error" in result
    
    def test_connection_management(self, temp_db_manager):
        """Test database connection management"""
        # Test getting connection
        conn1 = temp_db_manager.get_connection()
        assert conn1 is not None
        
        # Test that new connections are created each time (not reused)
        conn2 = temp_db_manager.get_connection()
        assert conn1 is not conn2  # Should be different connections
        
        # Test closing connections
        temp_db_manager.close_connection(conn1)
        temp_db_manager.close_connection(conn2)
    
    def test_path_detection(self):
        """Test automatic path detection"""
        db_manager = DatabaseManager()
        
        # Should use local paths in development
        assert './data' in db_manager.data_dir
        assert './data/forecast.db' == db_manager.database_path
    
    def test_custom_paths(self):
        """Test custom path configuration"""
        custom_db_path = "/tmp/test.db"
        custom_data_dir = "/tmp/data"
        
        db_manager = DatabaseManager(
            database_path=custom_db_path,
            data_dir=custom_data_dir
        )

        assert db_manager.database_path == custom_db_path
        assert db_manager.data_dir == custom_data_dir


def test_payroll_schema_preserved(test_db_manager):
    """Ensure payroll table retains extended columns after CSV loading"""
    conn = test_db_manager.get_connection()
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(payroll)")
    columns = [col[1] for col in cursor.fetchall()]
    test_db_manager.close_connection(conn)
    assert "department" in columns
    assert "rate_type" in columns