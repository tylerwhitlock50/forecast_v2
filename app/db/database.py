import sqlite3
import os
import pandas as pd
from typing import Dict, Any

class DatabaseManager:
    def __init__(self, database_path: str = None, data_dir: str = None):
        # Use local paths for development, Docker paths for production
        if database_path is None:
            if os.path.exists('/data'):  # Docker environment
                self.database_path = '/data/forecast.db'
                self.data_dir = '/data'
            else:  # Local development
                self.database_path = './data/forecast.db'
                self.data_dir = './data'
        else:
            self.database_path = database_path
            self.data_dir = data_dir
        
        # Ensure data directory exists
        os.makedirs(os.path.dirname(self.database_path), exist_ok=True)
        os.makedirs(self.data_dir, exist_ok=True)
    
    def get_connection(self):
        """Get a new database connection"""
        return sqlite3.connect(self.database_path)
    
    def close_connection(self, conn):
        """Close a database connection"""
        if conn:
            conn.close()
    
    def create_tables(self):
        """Create database tables"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        # Create customers table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS customers (
                customer_id TEXT PRIMARY KEY,
                customer_name TEXT NOT NULL,
                customer_type TEXT,
                region TEXT
            )
        ''')
        
        # Create units table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS units (
                unit_id TEXT PRIMARY KEY,
                unit_name TEXT NOT NULL,
                unit_description TEXT,
                base_price REAL,
                unit_type TEXT
            )
        ''')
        
        # Create sales table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS sales (
                sale_id TEXT PRIMARY KEY,
                customer_id TEXT,
                unit_id TEXT,
                period TEXT,
                quantity INTEGER,
                unit_price REAL,
                total_revenue REAL,
                FOREIGN KEY (customer_id) REFERENCES customers (customer_id),
                FOREIGN KEY (unit_id) REFERENCES units (unit_id)
            )
        ''')
        
        # Create BOM table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS bom (
                bom_id TEXT PRIMARY KEY,
                unit_id TEXT,
                router_id TEXT,
                material_cost REAL,
                FOREIGN KEY (unit_id) REFERENCES units (unit_id)
            )
        ''')
        
        # Create routers table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS routers (
                router_id TEXT PRIMARY KEY,
                unit_id TEXT,
                machine_id TEXT,
                machine_minutes INTEGER,
                labor_minutes INTEGER,
                sequence INTEGER,
                FOREIGN KEY (unit_id) REFERENCES units (unit_id),
                FOREIGN KEY (machine_id) REFERENCES machines (machine_id)
            )
        ''')
        
        # Create machines table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS machines (
                machine_id TEXT PRIMARY KEY,
                machine_name TEXT NOT NULL,
                machine_description TEXT,
                machine_rate REAL,
                labor_type TEXT
            )
        ''')
        
        # Create labor_rates table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS labor_rates (
                rate_id TEXT PRIMARY KEY,
                rate_name TEXT NOT NULL,
                rate_description TEXT,
                rate_amount REAL,
                rate_type TEXT
            )
        ''')
        
        # Create payroll table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS payroll (
                employee_id TEXT PRIMARY KEY,
                employee_name TEXT NOT NULL,
                weekly_hours INTEGER,
                hourly_rate REAL,
                labor_type TEXT,
                start_date TEXT,
                end_date TEXT
            )
        ''')
        
        # Create forecast_results table to store computed forecasts
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS forecast_results (
                forecast_id INTEGER PRIMARY KEY AUTOINCREMENT,
                forecast_date TEXT NOT NULL,
                period TEXT NOT NULL,
                customer_id TEXT,
                customer_name TEXT,
                unit_id TEXT,
                unit_name TEXT,
                quantity INTEGER,
                unit_price REAL,
                total_revenue REAL,
                material_cost REAL,
                labor_cost REAL,
                machine_cost REAL,
                total_cost REAL,
                gross_margin REAL,
                margin_percentage REAL,
                FOREIGN KEY (customer_id) REFERENCES customers (customer_id),
                FOREIGN KEY (unit_id) REFERENCES units (unit_id)
            )
        ''')
        
        # Create execution_log table to track SQL statements for audit and rollback
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS execution_log (
                log_id INTEGER PRIMARY KEY AUTOINCREMENT,
                execution_date TEXT NOT NULL,
                sql_statement TEXT NOT NULL,
                description TEXT,
                user_id TEXT,
                session_id TEXT,
                execution_status TEXT DEFAULT 'success',
                error_message TEXT,
                rows_affected INTEGER,
                execution_time_ms INTEGER
            )
        ''')
        
        conn.commit()
        conn.close()
    
    def load_csv_data(self):
        """Load data from CSV files into the database"""
        conn = self.get_connection()
        
        # Define CSV file mappings
        csv_mappings = {
            'customers.csv': 'customers',
            'units.csv': 'units',
            'sales.csv': 'sales',
            'bom.csv': 'bom',
            'routers.csv': 'routers',
            'machines.csv': 'machines',
            'labor_rates.csv': 'labor_rates',
            'payroll.csv': 'payroll'
        }
        
        for csv_file, table_name in csv_mappings.items():
            csv_path = os.path.join(self.data_dir, csv_file)
            if os.path.exists(csv_path):
                try:
                    df = pd.read_csv(csv_path)
                    df.to_sql(table_name, conn, if_exists='replace', index=False)
                    print(f"Loaded {csv_file} into {table_name} table")
                except Exception as e:
                    print(f"Error loading {csv_file}: {str(e)}")
            else:
                print(f"CSV file not found: {csv_path}")
        
        conn.close()
    
    def get_table_data(self, table_name: str) -> Dict[str, Any]:
        """Get data from a specific table"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        try:
            # Get column names
            cursor.execute(f"PRAGMA table_info({table_name})")
            columns = [col[1] for col in cursor.fetchall()]
            
            # Get data
            cursor.execute(f"SELECT * FROM {table_name}")
            rows = cursor.fetchall()
            
            # Convert to list of dictionaries
            data = []
            for row in rows:
                data.append(dict(zip(columns, row)))
            
            result = {
                "status": "success",
                "data": data,
                "columns": columns
            }
        except Exception as e:
            result = {
                "status": "error",
                "error": str(e)
            }
        finally:
            conn.close()
        
        return result
    
    def get_forecast_data(self) -> Dict[str, Any]:
        """Get comprehensive forecast data with joins and save results to database"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        try:
            # Clear previous forecast results
            cursor.execute("DELETE FROM forecast_results")
            
            # Get sales with customer and unit information
            cursor.execute('''
                SELECT s.*, c.customer_name, u.unit_name, u.base_price
                FROM sales s
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                LEFT JOIN units u ON s.unit_id = u.unit_id
                ORDER BY s.period, s.customer_id
            ''')
            sales_data = cursor.fetchall()
            
            # Get BOM with unit information
            cursor.execute('''
                SELECT b.*, u.unit_name
                FROM bom b
                LEFT JOIN units u ON b.unit_id = u.unit_id
            ''')
            bom_data = cursor.fetchall()
            
            # Get routing information with machine costs
            cursor.execute('''
                SELECT r.*, u.unit_name, m.machine_name, m.machine_rate,
                       (r.machine_minutes * m.machine_rate / 60.0) as machine_cost_per_unit,
                       (r.labor_minutes * 35.0 / 60.0) as labor_cost_per_unit
                FROM routers r
                LEFT JOIN units u ON r.unit_id = u.unit_id
                LEFT JOIN machines m ON r.machine_id = m.machine_id
                ORDER BY r.unit_id, r.sequence
            ''')
            router_data = cursor.fetchall()
            
            # Get payroll data
            cursor.execute('SELECT * FROM payroll ORDER BY employee_id')
            payroll_data = cursor.fetchall()
            
            # Compute and save forecast results
            from datetime import datetime
            forecast_date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            
            # Process each sale and compute forecast
            for sale in sales_data:
                sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, customer_name, unit_name, base_price = sale
                
                # Get BOM cost for this unit
                bom_cost = 0.0
                for bom in bom_data:
                    if bom[1] == unit_id:  # bom.unit_id matches sale.unit_id
                        bom_cost = bom[3] or 0.0  # material_cost
                        break
                
                # Get routing costs for this unit
                machine_cost_per_unit = 0.0
                labor_cost_per_unit = 0.0
                for router in router_data:
                    if router[1] == unit_id:  # router.unit_id matches sale.unit_id
                        machine_cost_per_unit += router[8] or 0.0  # machine_cost_per_unit
                        labor_cost_per_unit += router[9] or 0.0    # labor_cost_per_unit
                
                # Calculate total costs
                material_cost = bom_cost * quantity
                labor_cost = labor_cost_per_unit * quantity
                machine_cost = machine_cost_per_unit * quantity
                total_cost = material_cost + labor_cost + machine_cost
                
                # Calculate margins
                gross_margin = total_revenue - total_cost
                margin_percentage = (gross_margin / total_revenue * 100) if total_revenue > 0 else 0
                
                # Insert forecast result
                cursor.execute('''
                    INSERT INTO forecast_results (
                        forecast_date, period, customer_id, customer_name, unit_id, unit_name,
                        quantity, unit_price, total_revenue, material_cost, labor_cost,
                        machine_cost, total_cost, gross_margin, margin_percentage
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    forecast_date, period, customer_id, customer_name, unit_id, unit_name,
                    quantity, unit_price, total_revenue, material_cost, labor_cost,
                    machine_cost, total_cost, gross_margin, margin_percentage
                ))
            
            # Commit the forecast results
            conn.commit()
            
            # Get the saved forecast results
            cursor.execute('''
                SELECT * FROM forecast_results 
                ORDER BY period, customer_id, unit_id
            ''')
            forecast_results = cursor.fetchall()
            
            # Get column names for forecast results
            cursor.execute("PRAGMA table_info(forecast_results)")
            forecast_columns = [col[1] for col in cursor.fetchall()]
            
            # Convert forecast results to list of dictionaries
            forecast_data_list = []
            for row in forecast_results:
                forecast_data_list.append(dict(zip(forecast_columns, row)))
            
            result = {
                "status": "success",
                "data": {
                    "sales_forecast": sales_data,
                    "bom_data": bom_data,
                    "router_data": router_data,
                    "payroll_data": payroll_data,
                    "forecast_results": forecast_data_list,
                    "forecast_columns": forecast_columns,
                    "forecast_date": forecast_date
                }
            }
        except Exception as e:
            result = {
                "status": "error",
                "error": str(e)
            }
        finally:
            conn.close()
        
        return result
    
    def get_saved_forecast_results(self, period: str = None, limit: int = None) -> Dict[str, Any]:
        """Get saved forecast results from the database"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        try:
            # Build query with optional filters
            query = "SELECT * FROM forecast_results"
            params = []
            
            if period:
                query += " WHERE period = ?"
                params.append(period)
            
            query += " ORDER BY forecast_date DESC, period, customer_id, unit_id"
            
            if limit:
                query += f" LIMIT {limit}"
            
            cursor.execute(query, params)
            forecast_results = cursor.fetchall()
            
            # Get column names
            cursor.execute("PRAGMA table_info(forecast_results)")
            columns = [col[1] for col in cursor.fetchall()]
            
            # Convert to list of dictionaries
            data = []
            for row in forecast_results:
                data.append(dict(zip(columns, row)))
            
            # Get summary statistics
            cursor.execute('''
                SELECT 
                    COUNT(*) as total_records,
                    SUM(total_revenue) as total_revenue,
                    SUM(total_cost) as total_cost,
                    SUM(gross_margin) as total_margin,
                    AVG(margin_percentage) as avg_margin_percentage
                FROM forecast_results
            ''')
            summary = cursor.fetchone()
            summary_data = {
                "total_records": summary[0],
                "total_revenue": summary[1],
                "total_cost": summary[2],
                "total_margin": summary[3],
                "avg_margin_percentage": summary[4]
            }
            
            result = {
                "status": "success",
                "data": data,
                "columns": columns,
                "summary": summary_data
            }
        except Exception as e:
            result = {
                "status": "error",
                "error": str(e)
            }
        finally:
            conn.close()
        
        return result
    
    def execute_sql(self, sql_statement: str, description: str = None, user_id: str = None, session_id: str = None) -> Dict[str, Any]:
        """Execute SQL statement and return results"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        # Record execution start time
        import time
        start_time = time.time()
        
        try:
            cursor.execute(sql_statement)
            
            # Calculate execution time
            execution_time_ms = int((time.time() - start_time) * 1000)
            
            # Check if it's a SELECT statement
            if sql_statement.strip().upper().startswith('SELECT'):
                columns = [description[0] for description in cursor.description]
                rows = cursor.fetchall()
                data = [dict(zip(columns, row)) for row in rows]
                rows_affected = len(data)
                result = {
                    "status": "success",
                    "data": data,
                    "columns": columns
                }
            else:
                # For INSERT, UPDATE, DELETE statements
                conn.commit()
                rows_affected = cursor.rowcount
                result = {
                    "status": "success",
                    "message": f"SQL executed successfully. Rows affected: {rows_affected}"
                }
            
            # Log the successful execution
            self._log_sql_execution(
                conn, sql_statement, description, user_id, session_id,
                "success", None, rows_affected, execution_time_ms
            )
            
        except Exception as e:
            # Calculate execution time for failed queries
            execution_time_ms = int((time.time() - start_time) * 1000)
            
            # Log the failed execution
            self._log_sql_execution(
                conn, sql_statement, description, user_id, session_id,
                "error", str(e), 0, execution_time_ms
            )
            
            result = {
                "status": "error",
                "error": str(e)
            }
        finally:
            conn.close()
        
        return result
    
    def _log_sql_execution(self, conn, sql_statement: str, description: str, user_id: str, 
                          session_id: str, status: str, error_message: str, 
                          rows_affected: int, execution_time_ms: int):
        """Log SQL execution to the execution_log table"""
        from datetime import datetime
        
        cursor = conn.cursor()
        execution_date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        cursor.execute('''
            INSERT INTO execution_log (
                execution_date, sql_statement, description, user_id, session_id,
                execution_status, error_message, rows_affected, execution_time_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            execution_date, sql_statement, description, user_id, session_id,
            status, error_message, rows_affected, execution_time_ms
        ))
        
        conn.commit()
    
    def initialize(self):
        """Initialize database - create tables and load data"""
        print(f"Initializing database at: {self.database_path}")
        print(f"Data directory: {self.data_dir}")
        self.create_tables()
        print("Tables created successfully")
        self.load_csv_data()
        print("Database initialization complete")

    def get_execution_logs(self, limit: int = None, user_id: str = None, 
                          session_id: str = None, status: str = None) -> Dict[str, Any]:
        """Get execution logs with optional filtering"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        try:
            # Build query with optional filters
            query = "SELECT * FROM execution_log"
            params = []
            conditions = []
            
            if user_id:
                conditions.append("user_id = ?")
                params.append(user_id)
            
            if session_id:
                conditions.append("session_id = ?")
                params.append(session_id)
            
            if status:
                conditions.append("execution_status = ?")
                params.append(status)
            
            if conditions:
                query += " WHERE " + " AND ".join(conditions)
            
            query += " ORDER BY execution_date DESC, log_id DESC"
            
            if limit:
                query += f" LIMIT {limit}"
            
            cursor.execute(query, params)
            logs = cursor.fetchall()
            
            # Get column names
            cursor.execute("PRAGMA table_info(execution_log)")
            columns = [col[1] for col in cursor.fetchall()]
            
            # Convert to list of dictionaries
            data = []
            for row in logs:
                data.append(dict(zip(columns, row)))
            
            # Get summary statistics
            cursor.execute('''
                SELECT 
                    COUNT(*) as total_executions,
                    COUNT(CASE WHEN execution_status = 'success' THEN 1 END) as successful_executions,
                    COUNT(CASE WHEN execution_status = 'error' THEN 1 END) as failed_executions,
                    AVG(execution_time_ms) as avg_execution_time_ms,
                    SUM(rows_affected) as total_rows_affected
                FROM execution_log
            ''')
            summary = cursor.fetchone()
            summary_data = {
                "total_executions": summary[0],
                "successful_executions": summary[1],
                "failed_executions": summary[2],
                "avg_execution_time_ms": summary[3],
                "total_rows_affected": summary[4]
            }
            
            result = {
                "status": "success",
                "data": data,
                "columns": columns,
                "summary": summary_data
            }
        except Exception as e:
            result = {
                "status": "error",
                "error": str(e)
            }
        finally:
            conn.close()
        
        return result
    
    def replay_execution_logs(self, target_date: str = None, max_log_id: int = None, 
                             user_id: str = None, session_id: str = None) -> Dict[str, Any]:
        """Replay SQL statements from execution log up to a specific point in time"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        try:
            # Build query to get logs to replay
            query = "SELECT * FROM execution_log WHERE execution_status = 'success'"
            params = []
            
            if target_date:
                query += " AND execution_date <= ?"
                params.append(target_date)
            
            if max_log_id:
                query += " AND log_id <= ?"
                params.append(max_log_id)
            
            if user_id:
                query += " AND user_id = ?"
                params.append(user_id)
            
            if session_id:
                query += " AND session_id = ?"
                params.append(session_id)
            
            query += " ORDER BY execution_date ASC, log_id ASC"
            
            cursor.execute(query, params)
            logs_to_replay = cursor.fetchall()
            
            # Get column names
            cursor.execute("PRAGMA table_info(execution_log)")
            columns = [col[1] for col in cursor.fetchall()]
            
            # Replay each SQL statement
            replayed_count = 0
            failed_count = 0
            errors = []
            
            for log_row in logs_to_replay:
                log_entry = dict(zip(columns, log_row))
                sql_statement = log_entry["sql_statement"]
                
                try:
                    # Skip SELECT statements as they don't modify data
                    if not sql_statement.strip().upper().startswith('SELECT'):
                        cursor.execute(sql_statement)
                        replayed_count += 1
                except Exception as e:
                    failed_count += 1
                    errors.append({
                        "log_id": log_entry["log_id"],
                        "sql_statement": sql_statement,
                        "error": str(e)
                    })
            
            # Commit all changes
            conn.commit()
            
            result = {
                "status": "success",
                "message": f"Replayed {replayed_count} SQL statements successfully",
                "replayed_count": replayed_count,
                "failed_count": failed_count,
                "errors": errors
            }
        except Exception as e:
            result = {
                "status": "error",
                "error": str(e)
            }
        finally:
            conn.close()
        
        return result
    
    def reset_to_initial_state(self) -> Dict[str, Any]:
        """Reset database to initial state by reloading CSV data"""
        try:
            # Clear all data tables (but keep execution_log and forecast_results)
            conn = self.get_connection()
            cursor = conn.cursor()
            
            tables_to_clear = ['customers', 'units', 'sales', 'bom', 'routers', 'machines', 'labor_rates', 'payroll']
            
            for table in tables_to_clear:
                cursor.execute(f"DELETE FROM {table}")
            
            conn.commit()
            conn.close()
            
            # Reload CSV data
            self.load_csv_data()
            
            result = {
                "status": "success",
                "message": "Database reset to initial state with CSV data reloaded"
            }
        except Exception as e:
            result = {
                "status": "error",
                "error": str(e)
            }
        
        return result

# Global database manager instance
db_manager = DatabaseManager()

def initialize_database():
    """Initialize the database"""
    db_manager.initialize()

def get_table_data(table_name: str) -> Dict[str, Any]:
    """Get data from a specific table"""
    return db_manager.get_table_data(table_name)

def get_forecast_data() -> Dict[str, Any]:
    """Get comprehensive forecast data"""
    return db_manager.get_forecast_data()

def get_saved_forecast_results(period: str = None, limit: int = None) -> Dict[str, Any]:
    """Get saved forecast results from the database"""
    return db_manager.get_saved_forecast_results(period, limit)

def execute_sql(sql_statement: str, description: str = None, user_id: str = None, session_id: str = None) -> Dict[str, Any]:
    """Execute SQL statement with logging"""
    return db_manager.execute_sql(sql_statement, description, user_id, session_id)

def get_execution_logs(limit: int = None, user_id: str = None, session_id: str = None, status: str = None) -> Dict[str, Any]:
    """Get execution logs with optional filtering"""
    return db_manager.get_execution_logs(limit, user_id, session_id, status)

def replay_execution_logs(target_date: str = None, max_log_id: int = None, user_id: str = None, session_id: str = None) -> Dict[str, Any]:
    """Replay SQL statements from execution log up to a specific point in time"""
    return db_manager.replay_execution_logs(target_date, max_log_id, user_id, session_id)

def reset_to_initial_state() -> Dict[str, Any]:
    """Reset database to initial state by reloading CSV data"""
    return db_manager.reset_to_initial_state() 