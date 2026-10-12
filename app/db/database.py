import sqlite3
import os
import re
import pandas as pd
from typing import Dict, Any, Optional, Tuple


def _normalize_bom_version(value: Any) -> str:
    """BOM version as stored: 1 / '1' / 1.0 / 'v1' -> '1.0', '1.5' -> '1.5', blank -> '1.0'."""
    if value is None or (isinstance(value, float) and value != value) or not str(value).strip():
        return '1.0'
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f"{int(value)}.0" if float(value).is_integer() else str(value)
    text = str(value).strip()
    if re.match(r"^[vV]\d", text):
        text = text[1:]
    return f"{int(text)}.0" if text.isdigit() else text


def _bom_version_key(version: Any) -> Tuple:
    """Sort key so '10.0' > '9.0' > '2.0' > '1.0' (text parts sort after numbers)."""
    parts = re.split(r"[.\-_\s]+", str(version or "").strip().lstrip("vV"))
    return tuple((0, int(p), "") if p.isdigit() else (1, 0, p.lower()) for p in parts if p)


class DatabaseManager:
    def __init__(self, database_path: str = None, data_dir: str = None):
        """
        Resolve where the database and CSV data live.

        Precedence: explicit arguments, then the DATABASE_PATH / DATA_DIR
        environment variables, then auto-detection (/data inside the Docker
        container, ./data for local development). Explicit arguments always
        win so a test or script that names its own database can never be
        redirected to the production file by the environment.
        """
        env_db_path = os.getenv('DATABASE_PATH')
        env_data_dir = os.getenv('DATA_DIR')

        if database_path is not None:
            # Explicit path provided by the caller
            self.database_path = database_path
            self.data_dir = data_dir if data_dir is not None else os.path.dirname(database_path)
        elif env_db_path:
            # Full explicit path provided by the environment
            self.database_path = env_db_path
            self.data_dir = data_dir or env_data_dir or os.path.dirname(env_db_path)
        elif env_data_dir or data_dir:
            # Data directory provided; place DB inside it
            self.data_dir = data_dir or env_data_dir
            self.database_path = os.path.join(self.data_dir, 'forecast.db')
        elif os.path.isdir('/data'):  # Docker environment
            self.database_path = '/data/forecast.db'
            self.data_dir = '/data'
        else:  # Local development
            self.database_path = './data/forecast.db'
            self.data_dir = './data'
        
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
                description TEXT,
                notes TEXT,
                is_base INTEGER DEFAULT 0
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

        # ---- Financial planning tables (reporting engine) ----

        # Opening balances and working-capital / tax assumptions, one row per
        # forecast scenario. A missing row falls back to engine defaults.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS financial_assumptions (
                forecast_id TEXT PRIMARY KEY,
                opening_period TEXT,
                opening_cash REAL DEFAULT 0,
                opening_accounts_receivable REAL DEFAULT 0,
                opening_inventory REAL DEFAULT 0,
                opening_fixed_assets REAL DEFAULT 0,
                opening_accumulated_depreciation REAL DEFAULT 0,
                opening_fixed_assets_remaining_life_months INTEGER DEFAULT 0,
                opening_accounts_payable REAL DEFAULT 0,
                opening_other_liabilities REAL DEFAULT 0,
                opening_equity REAL,
                dso_days REAL DEFAULT 30,
                dio_days REAL DEFAULT 60,
                dpo_days REAL DEFAULT 30,
                income_tax_rate REAL DEFAULT 0.21,
                minimum_cash_balance REAL DEFAULT 0,
                excise_payable_days REAL DEFAULT 30,
                notes TEXT,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (forecast_id) REFERENCES forecast (forecast_id)
            )
        ''')

        # Planned capital purchases, depreciated straight-line from the
        # purchase period over useful_life_months.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS capital_expenditures (
                capex_id TEXT PRIMARY KEY,
                forecast_id TEXT,
                asset_name TEXT NOT NULL,
                category TEXT,
                amount REAL NOT NULL,
                purchase_period TEXT NOT NULL,
                useful_life_months INTEGER NOT NULL DEFAULT 60,
                salvage_value REAL DEFAULT 0,
                depreciation_method TEXT DEFAULT 'straight_line' CHECK (depreciation_method IN ('straight_line', 'none')),
                description TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (forecast_id) REFERENCES forecast (forecast_id)
            )
        ''')

        # Actual results by period and statement line, for budget-vs-actual.
        # line_item values are the keys of
        # services.financial_statements.VARIANCE_LINE_ITEMS.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS actuals (
                actual_id TEXT PRIMARY KEY,
                period TEXT NOT NULL,
                line_item TEXT NOT NULL,
                amount REAL NOT NULL,
                reference_id TEXT DEFAULT '',
                source TEXT,
                notes TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(period, line_item, reference_id)
            )
        ''')
        # Discounts and allowances off gross sales, embedded excise tax and
        # commissions (see services.pricing for matching and precedence).
        # forecast_id NULL = company-wide; NULL scope fields mean "any".
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS sales_deduction_rules (
                rule_id TEXT PRIMARY KEY,
                forecast_id TEXT,
                deduction_type TEXT NOT NULL CHECK (deduction_type IN
                    ('terms_allowance', 'chargebacks', 'other_allowance', 'excise_tax', 'commission')),
                name TEXT,
                method TEXT NOT NULL DEFAULT 'percent_of_gross' CHECK (method IN
                    ('percent_of_gross', 'percent_of_net', 'embedded_tax', 'per_unit')),
                rate REAL DEFAULT 0,
                amount_per_unit REAL DEFAULT 0,
                customer_id TEXT,
                customer_type TEXT,
                unit_id TEXT,
                unit_type TEXT,
                start_period TEXT,
                end_period TEXT,
                is_active INTEGER DEFAULT 1,
                notes TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (forecast_id) REFERENCES forecast (forecast_id)
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_deduction_rules_type ON sales_deduction_rules (deduction_type)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_deduction_rules_forecast ON sales_deduction_rules (forecast_id)')

        # Customer / customer-type price list: a fixed price or a discount off
        # the product's base_price. unit_id NULL = every product.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS price_list (
                price_id TEXT PRIMARY KEY,
                forecast_id TEXT,
                unit_id TEXT,
                customer_id TEXT,
                customer_type TEXT,
                method TEXT NOT NULL DEFAULT 'fixed' CHECK (method IN ('fixed', 'discount_from_base')),
                unit_price REAL,
                discount_pct REAL,
                start_period TEXT,
                end_period TEXT,
                is_active INTEGER DEFAULT 1,
                notes TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (forecast_id) REFERENCES forecast (forecast_id)
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_price_list_unit ON price_list (unit_id)')

        cursor.execute('CREATE INDEX IF NOT EXISTS idx_actuals_period ON actuals (period)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_sales_forecast_period ON sales (forecast_id, period)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_expense_alloc_period ON expense_allocations (period)')

        conn.commit()
        conn.close()

    def migrate_financial_assumptions_table(self):
        """Add excise_payable_days to financial_assumptions if missing (idempotent)."""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("PRAGMA table_info(financial_assumptions)")
            columns = [col[1] for col in cursor.fetchall()]
            if 'excise_payable_days' not in columns:
                try:
                    cursor.execute("ALTER TABLE financial_assumptions ADD COLUMN excise_payable_days REAL DEFAULT 30")
                except sqlite3.OperationalError as alter_err:
                    if 'duplicate column name' not in str(alter_err).lower():
                        raise
            conn.commit()
        except Exception as e:
            print(f"Error migrating financial_assumptions table: {e}")
            conn.rollback()
        finally:
            self.close_connection(conn)

    def migrate_payroll_config_table(self):
        """Add pay_frequency to payroll_config if missing (idempotent)."""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("PRAGMA table_info(payroll_config)")
            columns = [col[1] for col in cursor.fetchall()]
            if 'pay_frequency' not in columns:
                try:
                    cursor.execute("ALTER TABLE payroll_config ADD COLUMN pay_frequency TEXT DEFAULT 'biweekly'")
                except sqlite3.OperationalError as alter_err:
                    if 'duplicate column name' not in str(alter_err).lower():
                        raise
            conn.commit()
        except Exception as e:
            print(f"Error migrating payroll_config table: {e}")
            conn.rollback()
        finally:
            self.close_connection(conn)

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

    def migrate_forecast_table(self):
        """Add notes / is_base columns to the forecast table if missing (idempotent)"""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("PRAGMA table_info(forecast)")
            columns = [col[1] for col in cursor.fetchall()]
            for column, ddl in (
                ('notes', 'ALTER TABLE forecast ADD COLUMN notes TEXT'),
                # Exactly one scenario may be flagged as the base; the
                # comparison screen shows deltas against it.
                ('is_base', 'ALTER TABLE forecast ADD COLUMN is_base INTEGER DEFAULT 0'),
            ):
                if column not in columns:
                    try:
                        cursor.execute(ddl)
                    except sqlite3.OperationalError as alter_err:
                        # Column may already exist under a concurrent startup; ignore
                        if 'duplicate column name' not in str(alter_err).lower():
                            raise
            conn.commit()
            print("Forecast table migration completed successfully")
        except Exception as e:
            print(f"Error migrating forecast table: {e}")
            conn.rollback()
        finally:
            self.close_connection(conn)
        # Upgraded databases: scenarios may exist with none flagged as base.
        self.ensure_base_scenario()

    def ensure_base_scenario(self):
        """
        Keep the single-base invariant: if scenarios exist and none is flagged
        as the base, the lowest forecast_id becomes the base. Idempotent. Runs
        after the schema migration and after every CSV load, since a legacy
        forecast.csv has no is_base column.
        """
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM forecast WHERE is_base = 1")
            if cursor.fetchone()[0] == 0:
                cursor.execute(
                    "UPDATE forecast SET is_base = 1 WHERE forecast_id = "
                    "(SELECT forecast_id FROM forecast ORDER BY forecast_id LIMIT 1)"
                )
                conn.commit()
        except Exception as e:
            print(f"Error ensuring a base scenario: {e}")
            conn.rollback()
        finally:
            self.close_connection(conn)

    def load_csv_data(self):
        """Load data from CSV files into the database using staging + transaction per table"""
        conn = self.get_connection()
        cursor = conn.cursor()

        # CSV load order matters: parent tables must land before tables
        # that reference them via FOREIGN KEY. The previous ordering was
        # alphabetical-ish and caused sales/router_operations/payroll
        # loads to fail with FOREIGN KEY constraint errors.
        csv_mappings = {
            # 1. Root tables (no FK dependencies)
            'customers.csv': 'customers',
            'units.csv': 'units',
            'forecast.csv': 'forecast',
            'machines.csv': 'machines',
            'labor_rates.csv': 'labor_rates',
            'bom_definitions.csv': 'bom_definitions',
            'routers.csv': 'router_definitions',
            'expense_categories.csv': 'expense_categories',
            'loans.csv': 'loans',
            'payroll_config.csv': 'payroll_config',

            # 2. Tables that depend on the roots
            'bom.csv': 'bom',
            'router_operations.csv': 'router_operations',   # -> router_definitions, machines, labor_rates
            'routers_legacy.csv': 'routers',                # -> units, machines, labor_rates
            'sales.csv': 'sales',                           # -> customers, units, forecast
            'payroll.csv': 'payroll',                       # -> forecast
            'expenses.csv': 'expenses',                     # -> expense_categories
            'loan_payments.csv': 'loan_payments',           # -> loans

            # 3. Tables that depend on the layer above
            'expense_allocations.csv': 'expense_allocations',  # -> expenses
        }
        
        bom_names: Dict[str, str] = {}
        for csv_file, table_name in csv_mappings.items():
            csv_path = os.path.join(self.data_dir, csv_file)
            if os.path.exists(csv_path):
                try:
                    df = pd.read_csv(csv_path)

                    # Handle versioning for BOM and routing tables
                    if table_name == 'bom':
                        # '1' / 1 / 1.0 -> '1.0' so lines match units.bom_version
                        df['version'] = (df['version'].map(_normalize_bom_version)
                                         if 'version' in df.columns else '1.0')
                        # material_cost = qty x unit_price unless the file gives it
                        if {'qty', 'unit_price'} <= set(df.columns):
                            extended = (pd.to_numeric(df['qty'], errors='coerce')
                                        * pd.to_numeric(df['unit_price'], errors='coerce'))
                            df['material_cost'] = (pd.to_numeric(df['material_cost'], errors='coerce').fillna(extended)
                                                   if 'material_cost' in df.columns else extended)
                        # An optional bom_name column names the auto-created headers
                        if 'bom_name' in df.columns:
                            for bom_id, name in zip(df['bom_id'], df['bom_name']):
                                if isinstance(name, str) and name.strip() and bom_id not in bom_names:
                                    bom_names[bom_id] = name.strip()
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
        
        # Create BOM definitions from existing BOM data: one header per BOM,
        # named after the BOM (or a bom_name column), showing its newest version.
        try:
            cursor = conn.cursor()

            cursor.execute("SELECT DISTINCT bom_id, version FROM bom WHERE bom_id IS NOT NULL")
            newest: Dict[str, str] = {}
            for bom_id, version in cursor.fetchall():
                version = version or '1.0'
                if bom_id not in newest or _bom_version_key(version) > _bom_version_key(newest[bom_id]):
                    newest[bom_id] = version

            for bom_id, version in sorted(newest.items()):
                # Check if BOM definition already exists
                cursor.execute("SELECT COUNT(*) FROM bom_definitions WHERE bom_id = ?", (bom_id,))
                if cursor.fetchone()[0] == 0:
                    cursor.execute("""
                        INSERT INTO bom_definitions (bom_id, bom_name, bom_description, version)
                        VALUES (?, ?, ?, ?)
                    """, (bom_id, bom_names.get(bom_id, bom_id), f"Bill of Materials for {bom_id}", version))
            
            conn.commit()
            print("Created BOM definitions from existing BOM data")
        except Exception as e:
            print(f"Error creating BOM definitions: {str(e)}")
        
        conn.close()
        # A legacy forecast.csv has no is_base column; keep exactly one base.
        self.ensure_base_scenario()
    
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

            # Apply forecast filtering when column exists. Sales always belong
            # to one scenario; every other table treats NULL as company-wide
            # (included in every scenario), matching the statements engine.
            if forecast_id and "forecast_id" in columns:
                if table_name == "sales":
                    where_clauses.append("forecast_id = ?")
                else:
                    where_clauses.append("(forecast_id = ? OR forecast_id IS NULL)")
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
    
    # Columns of a legacy forecast result row (the old forecast_results table plus sale_id / warnings).
    FORECAST_RESULT_COLUMNS = [
        "forecast_id", "sale_id", "forecast_date", "period", "customer_id", "customer_name", "unit_id",
        "unit_name", "quantity", "unit_price", "total_revenue", "material_cost", "labor_cost",
        "machine_cost", "total_cost", "gross_margin", "margin_percentage", "cost_warnings",
    ]

    def _compute_forecast_results(self, cursor, forecast_id: Optional[str] = None,
                                  period: Optional[str] = None) -> Dict[str, Any]:
        """
        Per-sales-row cost and margin, computed on request with
        utils.cost_rollup.calculate_unit_costs (the BOM version the product
        uses, routing operations x machine and labor rates) - the same unit
        costs the statements engine uses. Read-only: nothing is stored.
        ``forecast_id`` in each result is the sale's scenario.
        """
        try:
            from utils.cost_rollup import calculate_unit_costs
        except ImportError:  # imported as app.db.database without app/ on sys.path
            from app.utils.cost_rollup import calculate_unit_costs
        from datetime import datetime

        where, params = [], []
        if forecast_id:
            where.append("s.forecast_id = ?")
            params.append(forecast_id)
        if period:
            where.append("s.period = ?")
            params.append(period)
        cursor.execute(f'''
            SELECT s.sale_id, s.customer_id, s.unit_id, s.period, s.quantity,
                   s.unit_price, s.total_revenue, s.forecast_id,
                   c.customer_name, u.unit_name, u.base_price, u.bom_id, u.router_id, u.bom_version
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.customer_id
            LEFT JOIN units u ON s.unit_id = u.unit_id
            {"WHERE " + " AND ".join(where) if where else ""}
            ORDER BY s.period, s.customer_id, s.unit_id
        ''', params)
        sales_columns = ['sale_id', 'customer_id', 'unit_id', 'period', 'quantity',
                         'unit_price', 'total_revenue', 'forecast_id', 'customer_name',
                         'unit_name', 'base_price', 'bom_id', 'router_id', 'bom_version']
        sales_data = [dict(zip(sales_columns, row)) for row in cursor.fetchall()]

        forecast_date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        unit_costs: Dict[Tuple, Dict[str, Any]] = {}
        results = []
        for sale in sales_data:
            key = (sale['bom_id'] or None, sale['bom_version'], sale['router_id'] or None)
            if key not in unit_costs:
                unit_costs[key] = calculate_unit_costs(cursor, *key)
            costs = unit_costs[key]
            quantity = sale['quantity'] or 0
            revenue = sale['total_revenue']
            if revenue is None:
                revenue = quantity * (sale['unit_price'] or 0)
            material_cost = costs['material_per_unit'] * quantity
            labor_cost = costs['labor_per_unit'] * quantity
            machine_cost = costs['machine_per_unit'] * quantity
            total_cost = material_cost + labor_cost + machine_cost
            gross_margin = revenue - total_cost
            results.append({
                "forecast_id": sale['forecast_id'], "sale_id": sale['sale_id'], "forecast_date": forecast_date,
                "period": sale['period'], "customer_id": sale['customer_id'],
                "customer_name": sale['customer_name'], "unit_id": sale['unit_id'], "unit_name": sale['unit_name'],
                "quantity": sale['quantity'], "unit_price": sale['unit_price'], "total_revenue": revenue,
                "material_cost": material_cost, "labor_cost": labor_cost, "machine_cost": machine_cost,
                "total_cost": total_cost, "gross_margin": gross_margin,
                "margin_percentage": (gross_margin / revenue * 100) if revenue > 0 else 0,
                "cost_warnings": list(costs['warnings']),
            })
        return {"sales": sales_data, "results": results, "forecast_date": forecast_date}

    def get_forecast_data(self, forecast_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Legacy forecast view (GET /forecast): sales joined with customers and
        products, BOM lines, routing operations, payroll, and per-sale cost /
        margin rows (``forecast_results``) from utils.cost_rollup.

        Read-only: the forecast_results table is no longer rewritten. Pass
        ``forecast_id`` to limit sales and results to one scenario. The
        statements engine (services.financial_statements) remains the source
        of truth for reporting.
        """
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            computed = self._compute_forecast_results(cursor, forecast_id=forecast_id)
            sales_data = [{k: v for k, v in sale.items() if k != 'bom_version'} for sale in computed["sales"]]

            # BOM lines of every version, and each BOM's material cost per unit for its header version
            cursor.execute('SELECT * FROM bom ORDER BY bom_id, version, bom_line')
            bom_columns = [d[0] for d in cursor.description]
            bom_data = [dict(zip(bom_columns, row)) for row in cursor.fetchall()]
            cursor.execute('''
                SELECT b.bom_id, SUM(b.material_cost)
                FROM bom b LEFT JOIN bom_definitions d ON d.bom_id = b.bom_id
                WHERE b.version = COALESCE(d.version, b.version)
                GROUP BY b.bom_id
            ''')
            bom_costs = {row[0]: row[1] for row in cursor.fetchall()}

            # Routing operations with their machine and labor cost per unit
            cursor.execute('''
                SELECT ro.router_id, ro.sequence, ro.machine_id, ro.machine_minutes, ro.labor_minutes,
                       ro.labor_type_id, ro.operation_description, m.machine_name, m.machine_rate,
                       COALESCE(ro.machine_minutes, 0) * COALESCE(m.machine_rate, 0) / 60.0,
                       lr.rate_amount,
                       COALESCE(ro.labor_minutes, 0) * COALESCE(lr.rate_amount, 0) / 60.0
                FROM router_operations ro
                LEFT JOIN machines m ON ro.machine_id = m.machine_id
                LEFT JOIN labor_rates lr ON ro.labor_type_id = lr.rate_id
                ORDER BY ro.router_id, ro.sequence
            ''')
            router_columns = ['router_id', 'sequence', 'machine_id', 'machine_minutes', 'labor_minutes',
                              'labor_type_id', 'operation_description', 'machine_name', 'machine_rate',
                              'machine_cost_per_unit', 'labor_rate', 'labor_cost_per_unit']
            router_data = [dict(zip(router_columns, row)) for row in cursor.fetchall()]

            cursor.execute('SELECT rate_type, AVG(rate_amount) as avg_rate FROM labor_rates GROUP BY rate_type')
            labor_rates = {row[0]: row[1] for row in cursor.fetchall()}

            cursor.execute('SELECT * FROM payroll ORDER BY employee_id')
            payroll_columns = [d[0] for d in cursor.description]
            payroll_data = [dict(zip(payroll_columns, row)) for row in cursor.fetchall()]

            # Informational only: product labor cost comes from routing labor rates.
            avg_labor_rate = 35.0
            rates = [row['hourly_rate'] for row in payroll_data if row.get('hourly_rate') is not None]
            if rates:
                avg_labor_rate = sum(rates) / len(rates)
            elif 'Hourly' in labor_rates:
                avg_labor_rate = labor_rates['Hourly']

            result = {
                "status": "success",
                "data": {
                    "sales_forecast": sales_data,
                    "bom_data": bom_data,
                    "bom_costs": bom_costs,
                    "router_data": router_data,
                    "payroll_data": payroll_data,
                    "labor_rates": labor_rates,
                    "forecast_results": computed["results"],
                    "forecast_columns": list(self.FORECAST_RESULT_COLUMNS),
                    "forecast_date": computed["forecast_date"],
                    "avg_labor_rate": avg_labor_rate,
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

    def get_saved_forecast_results(self, period: str = None, limit: int = None,
                                   forecast_id: str = None) -> Dict[str, Any]:
        """
        Per-sale cost / margin rows (GET /forecast/results), computed on
        request like get_forecast_data (read-only; always current). Optional
        filters: ``period`` (exact), ``forecast_id``, ``limit``. ``summary``
        covers the filtered rows before the limit.
        """
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            data = self._compute_forecast_results(cursor, forecast_id=forecast_id, period=period)["results"]
            total_revenue = sum(r["total_revenue"] or 0 for r in data)
            total_cost = sum(r["total_cost"] for r in data)
            summary_data = {
                "total_records": len(data),
                "total_revenue": total_revenue,
                "total_cost": total_cost,
                "total_margin": total_revenue - total_cost,
                "avg_margin_percentage": (sum(r["margin_percentage"] for r in data) / len(data)) if data else None,
            }
            if limit:
                data = data[:int(limit)]

            result = {
                "status": "success",
                "data": data,
                "columns": list(self.FORECAST_RESULT_COLUMNS),
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
        self.migrate_forecast_table()
        print("Forecast table migration completed")
        self.migrate_payroll_config_table()
        print("Payroll config migration completed")
        self.migrate_financial_assumptions_table()

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
        """
        Reset database to initial state by reloading CSV data.

        FK enforcement is suspended on the wipe connection so the bulk
        DELETEs can run in any order. The reload that follows uses the
        normal load_csv_data path (which is FK-aware via csv_mappings
        ordering) and connections it opens have FK back on.
        """
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            cursor.execute("PRAGMA foreign_keys=OFF")

            tables_to_clear = [
                'customers', 'units', 'sales', 'bom', 'routers', 'machines', 'labor_rates',
                'payroll', 'forecast',
                'router_definitions', 'router_operations',
                'expense_categories', 'expenses', 'expense_allocations',
                'loans', 'loan_payments',
                'forecast_results',
            ]

            for table in tables_to_clear:
                cursor.execute(f"DELETE FROM {table}")

            conn.commit()
            conn.close()

            self.load_csv_data()

            result = {
                "status": "success",
                "message": "Database reset to initial state with CSV data reloaded",
            }
        except Exception as e:
            result = {
                "status": "error",
                "error": str(e),
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

def get_forecast_data(forecast_id: str = None) -> Dict[str, Any]:
    """Legacy read-only forecast view (optionally one scenario)"""
    return db_manager.get_forecast_data(forecast_id)

def get_saved_forecast_results(period: str = None, limit: int = None, forecast_id: str = None) -> Dict[str, Any]:
    """Per-sale cost / margin rows, computed on request"""
    return db_manager.get_saved_forecast_results(period, limit, forecast_id)

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
