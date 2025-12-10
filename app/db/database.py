import sqlite3
import os
import pandas as pd
from typing import Dict, Any

class DatabaseManager:
    def __init__(self, database_path: str = None, data_dir: str = None):
        # Allow environment overrides first
        env_db_path = os.getenv('DATABASE_PATH')
        env_data_dir = os.getenv('DATA_DIR')

        if env_db_path:
            # Full explicit path provided
            self.database_path = env_db_path
            self.data_dir = env_data_dir if env_data_dir else os.path.dirname(env_db_path)
        elif env_data_dir and not database_path:
            # Data directory provided; place DB inside it
            self.data_dir = env_data_dir
            self.database_path = os.path.join(self.data_dir, 'forecast.db')
        else:
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
                self.data_dir = data_dir if data_dir is not None else os.path.dirname(database_path)
        
        # Ensure data directory exists
        os.makedirs(os.path.dirname(self.database_path), exist_ok=True)
        os.makedirs(self.data_dir, exist_ok=True)
    
    def get_connection(self):
        """Get a new database connection with timeout and proper settings"""
        import time
        max_retries = 3
        retry_delay = 1.0
        
        for attempt in range(max_retries):
            try:
                conn = sqlite3.connect(self.database_path, timeout=30.0)
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("PRAGMA synchronous=NORMAL")
                conn.execute("PRAGMA cache_size=10000")
                conn.execute("PRAGMA temp_store=MEMORY")
                # Enforce FK constraints for data integrity
                conn.execute("PRAGMA foreign_keys=ON")
                return conn
            except sqlite3.OperationalError as e:
                if "database is locked" in str(e) and attempt < max_retries - 1:
                    time.sleep(retry_delay)
                    retry_delay *= 2  # Exponential backoff
                    continue
                else:
                    raise
    
    def close_connection(self, conn):
        """Close a database connection"""
        if conn:
            conn.close()
    
    def close_all_connections(self):
        """Close all database connections - placeholder for SQLite"""
        # SQLite doesn't need explicit connection pooling management
        # This method is here for API compatibility
        # For SQLite, we can't force close all connections, but we can
        # ensure any cached connections are cleared
        pass
    
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
        
        # Create units table (updated - added bom and router columns with versioning)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS units (
                unit_id TEXT PRIMARY KEY,
                unit_name TEXT NOT NULL,
                unit_description TEXT,
                base_price REAL,
                unit_type TEXT,
                bom_id TEXT,
                bom_version TEXT DEFAULT '1.0',
                router_id TEXT,
                router_version TEXT DEFAULT '1.0'
            )
        ''')
        
        # Create forecast table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS forecast (
                forecast_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT
            )
        ''')
        
        # Create sales table (updated - with forecast_id FK)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS sales (
                sale_id TEXT PRIMARY KEY,
                customer_id TEXT,
                unit_id TEXT,
                period TEXT,
                quantity INTEGER,
                unit_price REAL,
                total_revenue REAL,
                forecast_id TEXT,
                FOREIGN KEY (customer_id) REFERENCES customers (customer_id),
                FOREIGN KEY (unit_id) REFERENCES units (unit_id),
                FOREIGN KEY (forecast_id) REFERENCES forecast (forecast_id)
            )
        ''')
        
        # Create BOM definitions table for BOM metadata
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS bom_definitions (
                bom_id TEXT PRIMARY KEY,
                bom_name TEXT NOT NULL,
                bom_description TEXT,
                version TEXT DEFAULT '1.0',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Create BOM table (updated - new structure with versioning)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS bom (
                bom_id TEXT,
                version TEXT DEFAULT '1.0',
                bom_line INTEGER,
                material_description TEXT,
                qty REAL,
                unit TEXT,
                unit_price REAL,
                material_cost REAL,
                target_cost REAL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (bom_id, version, bom_line)
            )
        ''')
        
        # Create routers table (updated - new structure with versioning)
        # Create router_definitions table for router metadata
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS router_definitions (
                router_id TEXT PRIMARY KEY,
                router_name TEXT NOT NULL,
                router_description TEXT,
                version TEXT DEFAULT '1.0',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Create router_operations table for individual operations
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS router_operations (
                operation_id INTEGER PRIMARY KEY AUTOINCREMENT,
                router_id TEXT NOT NULL,
                sequence INTEGER NOT NULL,
                machine_id TEXT NOT NULL,
                machine_minutes REAL DEFAULT 0,
                labor_minutes REAL DEFAULT 0,
                labor_type_id TEXT,
                operation_description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (router_id) REFERENCES router_definitions (router_id),
                FOREIGN KEY (machine_id) REFERENCES machines (machine_id),
                FOREIGN KEY (labor_type_id) REFERENCES labor_rates (rate_id),
                UNIQUE(router_id, sequence)
            )
        ''')
        
        # Keep the old routers table for backward compatibility during migration
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS routers (
                router_id TEXT,
                version TEXT DEFAULT '1.0',
                unit_id TEXT,
                machine_id TEXT,
                machine_minutes REAL,
                labor_minutes REAL,
                labor_type_id TEXT,
                sequence INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (router_id, version, sequence),
                FOREIGN KEY (unit_id) REFERENCES units (unit_id),
                FOREIGN KEY (machine_id) REFERENCES machines (machine_id),
                FOREIGN KEY (labor_type_id) REFERENCES labor_rates (rate_id)
            )
        ''')
        
        # Create machines table (updated - renamed from work_centers, added capacity)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS machines (
                machine_id TEXT PRIMARY KEY,
                machine_name TEXT NOT NULL,
                machine_description TEXT,
                machine_rate REAL,
                labor_type TEXT,
                available_minutes_per_month INTEGER DEFAULT 0
            )
        ''')
        
        # Create labor_rates table (updated)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS labor_rates (
                rate_id TEXT PRIMARY KEY,
                rate_name TEXT NOT NULL,
                rate_description TEXT,
                rate_amount REAL,
                rate_type TEXT
            )
        ''')
        
        # Create enhanced payroll table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS payroll (
                employee_id TEXT PRIMARY KEY,
                employee_name TEXT NOT NULL,
                department TEXT,
                weekly_hours INTEGER,
                hourly_rate REAL,
                rate_type TEXT DEFAULT 'hourly',
                labor_type TEXT,
                start_date TEXT,
                end_date TEXT,
                next_review_date TEXT,
                expected_raise REAL DEFAULT 0.0,
                benefits_eligible BOOLEAN DEFAULT 1,
                allocations TEXT,  -- JSON string for business unit allocations
                forecast_id TEXT,
                FOREIGN KEY (forecast_id) REFERENCES forecast (forecast_id)
            )
        ''')
        
        # Create payroll configuration table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS payroll_config (
                config_id TEXT PRIMARY KEY,
                federal_tax_rate REAL DEFAULT 0.22,
                state_tax_rate REAL DEFAULT 0.06,
                social_security_rate REAL DEFAULT 0.062,
                medicare_rate REAL DEFAULT 0.0145,
                unemployment_rate REAL DEFAULT 0.006,
                benefits_rate REAL DEFAULT 0.25,
                workers_comp_rate REAL DEFAULT 0.015,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        
        # Create expense_categories table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS expense_categories (
                category_id TEXT PRIMARY KEY,
                category_name TEXT NOT NULL,
                category_type TEXT NOT NULL CHECK (category_type IN ('factory_overhead', 'admin_expense', 'cogs')),
                parent_category_id TEXT,
                account_code TEXT,
                description TEXT,
                FOREIGN KEY (parent_category_id) REFERENCES expense_categories (category_id)
            )
        ''')
        
        # Create expenses table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS expenses (
                expense_id TEXT PRIMARY KEY,
                expense_name TEXT NOT NULL,
                category_id TEXT NOT NULL,
                amount REAL NOT NULL,
                frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'biannually', 'annually', 'one_time')),
                start_date TEXT NOT NULL,
                end_date TEXT,
                vendor TEXT,
                description TEXT,
                payment_method TEXT,
                approval_required BOOLEAN DEFAULT 0,
                approved_by TEXT,
                approval_date TEXT,
                expense_allocation TEXT DEFAULT 'immediate' CHECK (expense_allocation IN ('immediate', 'amortized')),
                amortization_months INTEGER,
                department TEXT,
                cost_center TEXT,
                is_active BOOLEAN DEFAULT 1,
                forecast_id TEXT,
                created_date TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_date TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (category_id) REFERENCES expense_categories (category_id),
                FOREIGN KEY (forecast_id) REFERENCES forecast (forecast_id)
            )
        ''')
        
        # Create expense_allocations table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS expense_allocations (
                allocation_id TEXT PRIMARY KEY,
                expense_id TEXT NOT NULL,
                period TEXT NOT NULL,
                allocated_amount REAL NOT NULL,
                allocation_type TEXT NOT NULL CHECK (allocation_type IN ('scheduled', 'amortized', 'one_time')),
                payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'scheduled', 'paid', 'overdue')),
                payment_date TEXT,
                actual_amount REAL,
                notes TEXT,
                FOREIGN KEY (expense_id) REFERENCES expenses (expense_id)
            )
        ''')
        
        # Create loans table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS loans (
                loan_id TEXT PRIMARY KEY,
                loan_name TEXT NOT NULL,
                lender TEXT NOT NULL,
                loan_type TEXT NOT NULL CHECK (loan_type IN ('term_loan', 'line_of_credit', 'sba_loan', 'equipment_loan', 'real_estate_loan')),
                principal_amount REAL NOT NULL,
                interest_rate REAL NOT NULL,
                loan_term_months INTEGER NOT NULL,
                start_date TEXT NOT NULL,
                payment_type TEXT NOT NULL CHECK (payment_type IN ('amortizing', 'interest_only')),
                payment_frequency TEXT DEFAULT 'monthly' CHECK (payment_frequency IN ('monthly', 'quarterly', 'annually')),
                balloon_payment REAL,
                balloon_date TEXT,
                description TEXT,
                collateral_description TEXT,
                guarantor TEXT,
                loan_officer TEXT,
                account_number TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_date TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_date TEXT DEFAULT CURRENT_TIMESTAMP,
                current_balance REAL NOT NULL,
                next_payment_date TEXT NOT NULL,
                monthly_payment_amount REAL NOT NULL
            )
        ''')
        
        # Create loan_payments table for amortization schedules
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS loan_payments (
                payment_id TEXT PRIMARY KEY,
                loan_id TEXT NOT NULL,
                payment_number INTEGER NOT NULL,
                payment_date TEXT NOT NULL,
                payment_amount REAL NOT NULL,
                principal_payment REAL NOT NULL,
                interest_payment REAL NOT NULL,
                remaining_balance REAL NOT NULL,
                payment_status TEXT DEFAULT 'scheduled' CHECK (payment_status IN ('scheduled', 'paid', 'overdue', 'skipped')),
                actual_payment_date TEXT,
                actual_payment_amount REAL,
                notes TEXT,
                FOREIGN KEY (loan_id) REFERENCES loans (loan_id),
                UNIQUE(loan_id, payment_number)
            )
        ''')
        
        conn.commit()
        conn.close()
    
    def migrate_payroll_table(self):
        """Migrate existing payroll table to new schema"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        try:
            # Check if new columns exist
            cursor.execute("PRAGMA table_info(payroll)")
            columns = [col[1] for col in cursor.fetchall()]
            
            # Add missing columns
            if 'department' not in columns:
                cursor.execute('ALTER TABLE payroll ADD COLUMN department TEXT')
            if 'rate_type' not in columns:
                cursor.execute('ALTER TABLE payroll ADD COLUMN rate_type TEXT DEFAULT "hourly"')
            if 'next_review_date' not in columns:
                cursor.execute('ALTER TABLE payroll ADD COLUMN next_review_date TEXT')
            if 'expected_raise' not in columns:
                cursor.execute('ALTER TABLE payroll ADD COLUMN expected_raise REAL DEFAULT 0.0')
            if 'benefits_eligible' not in columns:
                cursor.execute('ALTER TABLE payroll ADD COLUMN benefits_eligible BOOLEAN DEFAULT 1')
            if 'allocations' not in columns:
                cursor.execute('ALTER TABLE payroll ADD COLUMN allocations TEXT')
            if 'forecast_id' not in columns:
                cursor.execute('ALTER TABLE payroll ADD COLUMN forecast_id TEXT')
            
            # Update department field with labor_type if empty
            cursor.execute('''
                UPDATE payroll 
                SET department = labor_type 
                WHERE department IS NULL OR department = ""
            ''')
            
            # Set default allocations for existing employees
            cursor.execute('''
                UPDATE payroll 
                SET allocations = '{"Customer-Centric Brands": 100}' 
                WHERE allocations IS NULL OR allocations = ""
            ''')
            
            conn.commit()
            print("Payroll table migration completed successfully")
            
        except Exception as e:
            print(f"Error migrating payroll table: {e}")
            conn.rollback()
        finally:
            self.close_connection(conn)

    def migrate_expenses_table(self):
        """Add forecast_id column to expenses table if missing"""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("PRAGMA table_info(expenses)")
            columns = [col[1] for col in cursor.fetchall()]
            if 'forecast_id' not in columns:
                cursor.execute('ALTER TABLE expenses ADD COLUMN forecast_id TEXT')
            conn.commit()
            print("Expenses table migration completed successfully")
        except Exception as e:
            print(f"Error migrating expenses table: {e}")
            conn.rollback()
        finally:
            self.close_connection(conn)

    def load_csv_data(self):
        """Load data from CSV files into the database using staging + transaction per table"""
        conn = self.get_connection()
        cursor = conn.cursor()

        # Define CSV file mappings
        csv_mappings = {
            'customers.csv': 'customers',
            'units.csv': 'units',
            'sales.csv': 'sales',
            'bom.csv': 'bom',
            'bom_definitions.csv': 'bom_definitions',
            'routers.csv': 'router_definitions',
            'router_operations.csv': 'router_operations',
            'routers_legacy.csv': 'routers',
            'machines.csv': 'machines',
            'labor_rates.csv': 'labor_rates',
            'payroll.csv': 'payroll',
            'payroll_config.csv': 'payroll_config',
            'forecast.csv': 'forecast',
            'expense_categories.csv': 'expense_categories',
            'expenses.csv': 'expenses',
            'expense_allocations.csv': 'expense_allocations',
            'loans.csv': 'loans',
            'loan_payments.csv': 'loan_payments'
        }
        
        for csv_file, table_name in csv_mappings.items():
            csv_path = os.path.join(self.data_dir, csv_file)
            if os.path.exists(csv_path):
                try:
                    df = pd.read_csv(csv_path)
                    
                    # Handle versioning for BOM and routing tables
                    if table_name == 'bom':
                        if 'version' not in df.columns:
                            df['version'] = '1.0'
                        if 'labor_type_id' not in df.columns:
                            df['labor_type_id'] = 'RATE-001'  # Default to general rate
                    elif table_name == 'routers':
                        if 'version' not in df.columns:
                            df['version'] = '1.0'
                        if 'labor_type_id' not in df.columns:
                            df['labor_type_id'] = 'RATE-001'  # Default to general rate
                    elif table_name == 'loans':
                        # Normalize critical fields to avoid NULLs breaking API models
                        if 'payment_frequency' not in df.columns:
                            df['payment_frequency'] = 'monthly'
                        else:
                            df['payment_frequency'] = df['payment_frequency'].fillna('monthly')
                        if 'payment_type' not in df.columns:
                            df['payment_type'] = 'amortizing'
                        else:
                            df['payment_type'] = df['payment_type'].fillna('amortizing')
                        if 'is_active' in df.columns:
                            df['is_active'] = df['is_active'].fillna(1).astype(int)
                        if 'current_balance' in df.columns and 'principal_amount' in df.columns:
                            df['current_balance'] = df['current_balance'].fillna(df['principal_amount'])
                        if 'monthly_payment_amount' in df.columns:
                            df['monthly_payment_amount'] = df['monthly_payment_amount'].fillna(0)
                        if 'next_payment_date' in df.columns and 'start_date' in df.columns:
                            # If next_payment_date missing, leave it null here; app will compute fallback
                            df['next_payment_date'] = df['next_payment_date']
                    elif table_name == 'units':
                        # Update units table to support versioning
                        if 'bom_id' not in df.columns and 'bom' in df.columns:
                            df['bom_id'] = df['bom']
                        if 'router_id' not in df.columns and 'router' in df.columns:
                            df['router_id'] = df['router']
                        if 'bom_version' not in df.columns:
                            df['bom_version'] = '1.0'
                        if 'router_version' not in df.columns:
                            df['router_version'] = '1.0'
                    elif table_name == 'machines':
                        # Add available_minutes_per_month if not present
                        if 'available_minutes_per_month' not in df.columns:
                            df['available_minutes_per_month'] = 10000  # Default capacity

                    # Align DataFrame with existing table schema
                    cursor.execute(f"PRAGMA table_info({table_name})")
                    existing_cols = [col[1] for col in cursor.fetchall()]
                    dropped_cols = [c for c in df.columns if c not in existing_cols]
                    if dropped_cols:
                        print(f"Warning: The following columns in {csv_file} are not present in the {table_name} table schema and will be dropped: {dropped_cols}")
                    df = df[[c for c in df.columns if c in existing_cols]]

                    # Use a staging table to ensure atomic replace
                    staging = f"{table_name}__staging"
                    # Replace staging with DataFrame schema and data
                    df.to_sql(staging, conn, if_exists='replace', index=False)

                    # Build column list for deterministic insert order
                    cols_csv = ', '.join(df.columns)
                    try:
                        cursor.execute("BEGIN")
                        cursor.execute(f"DELETE FROM {table_name}")
                        cursor.execute(f"INSERT INTO {table_name} ({cols_csv}) SELECT {cols_csv} FROM {staging}")
                        cursor.execute(f"DROP TABLE IF EXISTS {staging}")
                        conn.commit()
                        print(f"Loaded {csv_file} into {table_name} table (transactional)")
                    except Exception as tx_err:
                        conn.rollback()
                        # Drop staging to avoid clutter, ignore errors
                        try:
                            cursor.execute(f"DROP TABLE IF EXISTS {staging}")
                            conn.commit()
                        except Exception:
                            pass
                        raise tx_err
                except Exception as e:
                    print(f"Error loading {csv_file}: {str(e)}")
            else:
                print(f"CSV file not found: {csv_path}")
        
        # Create BOM definitions from existing BOM data
        try:
            cursor = conn.cursor()
            
            # Get unique BOM IDs from the bom table
            cursor.execute("SELECT DISTINCT bom_id, version FROM bom ORDER BY bom_id")
            bom_entries = cursor.fetchall()
            
            for bom_id, version in bom_entries:
                # Check if BOM definition already exists
                cursor.execute("SELECT COUNT(*) FROM bom_definitions WHERE bom_id = ?", (bom_id,))
                if cursor.fetchone()[0] == 0:
                    # Get the header entry (bom_line = 1) to extract the name
                    cursor.execute("""
                        SELECT material_description 
                        FROM bom 
                        WHERE bom_id = ? AND bom_line = 1
                    """, (bom_id,))
                    header_result = cursor.fetchone()
                    
                    bom_name = "BOM Header"
                    if header_result and header_result[0] and header_result[0] != 'BOM Header':
                        bom_name = header_result[0]
                    
                    # Insert BOM definition
                    cursor.execute("""
                        INSERT INTO bom_definitions (bom_id, bom_name, bom_description, version)
                        VALUES (?, ?, ?, ?)
                    """, (bom_id, bom_name, f"Bill of Materials for {bom_id}", version or '1.0'))
            
            conn.commit()
            print("Created BOM definitions from existing BOM data")
        except Exception as e:
            print(f"Error creating BOM definitions: {str(e)}")
        
        conn.close()
    
    def get_table_data(
        self,
        table_name: str,
        forecast_id: str = None,
        filters: Dict[str, Any] = None,
        limit: int = None,
        offset: int = None,
    ) -> Dict[str, Any]:
        """Get data from a specific table with optional filtering"""
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            # Get column names
            cursor.execute(f"PRAGMA table_info({table_name})")
            columns = [col[1] for col in cursor.fetchall()]

            # Build base query
            query = f"SELECT * FROM {table_name}"
            params = []
            where_clauses = []

            # Apply forecast filtering when column exists
            if forecast_id and "forecast_id" in columns:
                where_clauses.append("forecast_id = ?")
                params.append(forecast_id)

            # Apply column filters
            if filters:
                for col, val in filters.items():
                    if col in columns:
                        where_clauses.append(f"{col} = ?")
                        params.append(val)

            if where_clauses:
                query += " WHERE " + " AND ".join(where_clauses)

            # Add pagination
            if limit is not None:
                query += " LIMIT ?"
                params.append(limit)
                if offset:
                    query += " OFFSET ?"
                    params.append(offset)
            elif offset is not None:
                query += " LIMIT -1 OFFSET ?"
                params.append(offset)

            # Get data
            cursor.execute(query, params)
            rows = cursor.fetchall()

            # Convert to list of dictionaries
            data = [dict(zip(columns, row)) for row in rows]

            result = {
                "status": "success",
                "data": data,
                "columns": columns,
            }
        except Exception as e:
            result = {
                "status": "error",
                "error": str(e),
            }
        finally:
            conn.close()

        return result
    
    def get_forecast_data(self) -> Dict[str, Any]:
        """Get comprehensive forecast data with joins and append computed results to forecast_results"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        try:
            # Ensure forecast_results table exists
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
            cursor.execute("DELETE FROM forecast_results")
            
            # Get sales with customer and unit information
            cursor.execute('''
                SELECT s.sale_id, s.customer_id, s.unit_id, s.period, s.quantity,
                       s.unit_price, s.total_revenue, s.forecast_id,
                       c.customer_name, u.unit_name, u.base_price, u.bom_id, u.router_id
                FROM sales s
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                LEFT JOIN units u ON s.unit_id = u.unit_id
                ORDER BY s.period, s.customer_id
            ''')
            sales_rows = cursor.fetchall()
            
            # Convert sales data to list of dictionaries
            sales_columns = ['sale_id', 'customer_id', 'unit_id', 'period', 'quantity',
                           'unit_price', 'total_revenue', 'forecast_id', 'customer_name',
                           'unit_name', 'base_price', 'bom_id', 'router_id']
            sales_data = [dict(zip(sales_columns, row)) for row in sales_rows]
            
            # Get BOM data with total cost per BOM and full BOM details
            cursor.execute('''
                SELECT bom_id, SUM(material_cost) as total_bom_cost
                FROM bom
                GROUP BY bom_id
            ''')
            bom_costs = {row[0]: row[1] for row in cursor.fetchall()}

            cursor.execute('SELECT * FROM bom ORDER BY bom_id, bom_line')
            bom_rows = cursor.fetchall()
            cursor.execute('PRAGMA table_info(bom)')
            bom_columns = [col[1] for col in cursor.fetchall()]
            bom_data = [dict(zip(bom_columns, row)) for row in bom_rows]
            
            # Get routing information with machine costs - handle shared router_id and machine ID mapping
            cursor.execute('''
                SELECT r.router_id, r.unit_id, r.machine_id, r.machine_minutes, r.labor_minutes, r.sequence,
                       u.unit_name, m.machine_name, m.machine_rate,
                       (r.machine_minutes * m.machine_rate / 60.0) as machine_cost_per_unit,
                       r.labor_minutes
                FROM routers r
                LEFT JOIN units u ON r.unit_id = u.unit_id
                LEFT JOIN machines m ON ('WC000' || SUBSTR(r.machine_id, 3)) = m.machine_id
                ORDER BY r.unit_id, r.sequence
            ''')
            router_rows = cursor.fetchall()
            
            # Convert router data to list of dictionaries
            router_columns = ['router_id', 'unit_id', 'machine_id', 'machine_minutes', 'labor_minutes', 
                             'sequence', 'unit_name', 'machine_name', 'machine_rate', 
                             'machine_cost_per_unit', 'labor_minutes_raw']
            router_data = [dict(zip(router_columns, row)) for row in router_rows]
            
            # Get labor rates for better calculation
            cursor.execute('SELECT rate_type, AVG(rate_amount) as avg_rate FROM labor_rates GROUP BY rate_type')
            labor_rates = {row[0]: row[1] for row in cursor.fetchall()}
            
            # Get payroll data for labor rate calculation
            cursor.execute('SELECT * FROM payroll ORDER BY employee_id')
            payroll_rows = cursor.fetchall()
            
            # Convert payroll data to list of dictionaries
            cursor.execute("PRAGMA table_info(payroll)")
            payroll_columns = [col[1] for col in cursor.fetchall()]
            payroll_data = [dict(zip(payroll_columns, row)) for row in payroll_rows]
            
            # Calculate average labor rate from payroll data or use default
            avg_labor_rate = 35.0  # Default fallback
            if payroll_data:
                total_rate = sum(row['hourly_rate'] for row in payroll_data)
                avg_labor_rate = total_rate / len(payroll_data)
            elif 'Hourly' in labor_rates:
                avg_labor_rate = labor_rates['Hourly']
            
            # Compute and save forecast results
            from datetime import datetime
            forecast_date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            
            # Process each sale and compute forecast
            for sale in sales_data:
                # Extract values from dictionary
                sale_id = sale['sale_id']
                customer_id = sale['customer_id']
                unit_id = sale['unit_id']
                period = sale['period']
                quantity = sale['quantity']
                unit_price = sale['unit_price']
                total_revenue = sale['total_revenue']
                forecast_id = sale['forecast_id']
                customer_name = sale['customer_name']
                unit_name = sale['unit_name']
                base_price = sale['base_price']
                bom_id = sale['bom_id']
                router_id = sale['router_id']
                
                # Get BOM cost for this unit
                bom_cost = bom_costs.get(bom_id, 0.0)
                
                # Get routing costs for this unit (sum all operations for this unit)
                machine_cost_per_unit = 0.0
                labor_cost_per_unit = 0.0
                for router in router_data:
                    if router['unit_id'] == unit_id:  # router.unit_id matches sale.unit_id
                        machine_cost_per_unit += router['machine_cost_per_unit'] or 0.0
                        labor_cost_per_unit += (router['labor_minutes_raw'] or 0.0) * avg_labor_rate / 60.0  # labor_minutes * rate / 60
                
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
                    "bom_costs": bom_costs,
                    "router_data": router_data,
                    "payroll_data": payroll_data,
                    "labor_rates": labor_rates,
                    "forecast_results": forecast_data_list,
                    "forecast_columns": forecast_columns,
                    "forecast_date": forecast_date,
                    "avg_labor_rate": avg_labor_rate
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
        
        # Check if database already exists and has data
        database_exists = os.path.exists(self.database_path)
        has_existing_data = False
        
        if database_exists:
            try:
                conn = self.get_connection()
                cursor = conn.cursor()
                # Check if key tables have data
                for table in ['customers', 'units', 'sales', 'bom']:
                    try:
                        cursor.execute(f"SELECT COUNT(*) FROM {table}")
                        count = cursor.fetchone()[0]
                        if count > 0:
                            has_existing_data = True
                            break
                    except:
                        continue  # Table might not exist yet
                conn.close()
            except:
                pass  # Database might be corrupted or inaccessible
        
        self.create_tables()
        print("Tables created successfully")
        self.migrate_payroll_table()
        print("Payroll table migration completed")
        self.migrate_expenses_table()
        print("Expenses table migration completed")
        
        # Check for force reload environment variable
        force_reload = os.getenv('FORCE_DB_RELOAD', 'false').lower() == 'true'
        
        if has_existing_data and not force_reload:
            print("Database already contains data - skipping CSV data loading")
            print("Database initialization complete (existing data preserved)")
            print("Note: Set FORCE_DB_RELOAD=true environment variable to force reload CSV data")
        else:
            if force_reload:
                print("Force reload requested - loading CSV data over existing data")
            else:
                print("Loading fresh data from CSV files")
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
            
            tables_to_clear = [
                'customers', 'units', 'sales', 'bom', 'routers', 'machines', 'labor_rates',
                'payroll', 'forecast',
                'router_definitions', 'router_operations',
                'expense_categories', 'expenses', 'expense_allocations',
                'loans', 'loan_payments',
                'forecast_results'  # optional: clear computed results
            ]
            
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

def switch_database(new_database_path: str):
    """Switch to a different database file"""
    global db_manager
    
    # Close all existing connections
    db_manager.close_all_connections()
    
    # Determine appropriate data directory
    # For saved databases, we don't want to look for CSV files
    # Use the original data directory (where CSV files are located)
    if db_manager.data_dir and os.path.exists(db_manager.data_dir):
        data_dir = db_manager.data_dir
    else:
        # Default to the directory containing the database file
        data_dir = os.path.dirname(new_database_path)
    
    # Create new database manager with new path
    db_manager = DatabaseManager(database_path=new_database_path, data_dir=data_dir)
    
    # Only create tables if the database doesn't exist
    if not os.path.exists(new_database_path):
        db_manager.create_tables()
        print(f"Created new database: {new_database_path}")
    else:
        # Just ensure we can connect to the existing database
        db_manager.create_tables()  # This will create tables if they don't exist
        print(f"Switched to existing database: {new_database_path}")

def get_current_database_path() -> str:
    """Get the current database path"""
    return db_manager.database_path

def get_table_data(
    table_name: str,
    forecast_id: str = None,
    filters: Dict[str, Any] = None,
    limit: int = None,
    offset: int = None,
) -> Dict[str, Any]:
    """Get data from a specific table"""
    return db_manager.get_table_data(table_name, forecast_id, filters, limit, offset)

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
