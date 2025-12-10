#!/usr/bin/env python3
"""
Database Reset API Script
Provides functions that can be called programmatically to reset the database
"""

import os
import sys
import sqlite3
import shutil
from datetime import datetime
from pathlib import Path

# Add the parent directory to sys.path to import app modules if needed
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def get_database_paths():
    """Get the database paths for both environments"""
    if os.path.exists('/data'):
        return {
            'database_path': '/data/forecast.db',
            'data_dir': '/data',
            'saved_databases_dir': '/data/saved_databases'
        }
    else:
        return {
            'database_path': './data/forecast.db',
            'data_dir': './data',
            'saved_databases_dir': './data/saved_databases'
        }


def reset_database_to_clean_state():
    """
    Reset the database to a clean state (all tables, no data)
    Returns: dict with status and message
    """
    try:
        paths = get_database_paths()
        database_path = paths['database_path']
        saved_databases_dir = paths['saved_databases_dir']
        
        # Ensure directories exist
        Path(saved_databases_dir).mkdir(parents=True, exist_ok=True)
        Path(database_path).parent.mkdir(parents=True, exist_ok=True)
        
        # Create backup
        backup_path = None
        if os.path.exists(database_path):
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_filename = f"pre_reset_backup_{timestamp}.db"
            backup_path = os.path.join(saved_databases_dir, backup_filename)
            shutil.copy2(database_path, backup_path)
        
        # Close any existing connections and remove database files
        try:
            temp_conn = sqlite3.connect(database_path, timeout=1.0)
            temp_conn.execute("PRAGMA journal_mode=DELETE")
            temp_conn.close()
        except:
            pass  # Ignore connection issues
        
        # Remove database files
        for file_path in [database_path, f"{database_path}-wal", f"{database_path}-shm"]:
            if os.path.exists(file_path):
                os.remove(file_path)
        
        # Create fresh database with all tables
        conn = sqlite3.connect(database_path)
        cursor = conn.cursor()
        
        # Set optimal settings
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        
        # Create all tables (using the same schema as the main application)
        table_creation_sql = """
        -- Core tables
        CREATE TABLE customers (
            customer_id TEXT PRIMARY KEY,
            customer_name TEXT NOT NULL,
            customer_type TEXT,
            region TEXT
        );

        CREATE TABLE units (
            unit_id TEXT PRIMARY KEY,
            unit_name TEXT NOT NULL,
            unit_description TEXT,
            base_price REAL,
            unit_type TEXT,
            bom_id TEXT,
            bom_version TEXT DEFAULT '1.0',
            router_id TEXT,
            router_version TEXT DEFAULT '1.0'
        );

        CREATE TABLE forecast (
            forecast_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT
        );

        CREATE TABLE sales (
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
        );

        -- BOM tables
        CREATE TABLE bom_definitions (
            bom_id TEXT PRIMARY KEY,
            bom_name TEXT NOT NULL,
            bom_description TEXT,
            version TEXT DEFAULT '1.0',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE bom (
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
        );

        -- Router tables
        CREATE TABLE router_definitions (
            router_id TEXT PRIMARY KEY,
            router_name TEXT NOT NULL,
            router_description TEXT,
            version TEXT DEFAULT '1.0',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE router_operations (
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
        );

        CREATE TABLE routers (
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
        );

        -- Resource tables
        CREATE TABLE machines (
            machine_id TEXT PRIMARY KEY,
            machine_name TEXT NOT NULL,
            machine_description TEXT,
            machine_rate REAL,
            labor_type TEXT,
            available_minutes_per_month INTEGER DEFAULT 0
        );

        CREATE TABLE labor_rates (
            rate_id TEXT PRIMARY KEY,
            rate_name TEXT NOT NULL,
            rate_description TEXT,
            rate_amount REAL,
            rate_type TEXT
        );

        -- Payroll tables
        CREATE TABLE payroll (
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
            allocations TEXT,
            forecast_id TEXT,
            FOREIGN KEY (forecast_id) REFERENCES forecast (forecast_id)
        );

        CREATE TABLE payroll_config (
            config_id TEXT PRIMARY KEY,
            federal_tax_rate REAL DEFAULT 0.22,
            state_tax_rate REAL DEFAULT 0.06,
            social_security_rate REAL DEFAULT 0.062,
            medicare_rate REAL DEFAULT 0.0145,
            unemployment_rate REAL DEFAULT 0.006,
            benefits_rate REAL DEFAULT 0.25,
            workers_comp_rate REAL DEFAULT 0.015,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Expense tables
        CREATE TABLE expense_categories (
            category_id TEXT PRIMARY KEY,
            category_name TEXT NOT NULL,
            category_type TEXT NOT NULL CHECK (category_type IN ('factory_overhead', 'admin_expense', 'cogs')),
            parent_category_id TEXT,
            account_code TEXT,
            description TEXT,
            FOREIGN KEY (parent_category_id) REFERENCES expense_categories (category_id)
        );

        CREATE TABLE expenses (
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
        );

        CREATE TABLE expense_allocations (
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
        );

        -- Loan tables
        CREATE TABLE loans (
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
        );

        CREATE TABLE loan_payments (
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
        );

        -- Result tables
        CREATE TABLE forecast_results (
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
        );

        CREATE TABLE execution_log (
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
        );
        """
        
        # Execute all table creation
        cursor.executescript(table_creation_sql)
        conn.commit()
        
        # Count tables
        cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
        table_count = cursor.fetchone()[0]
        
        conn.close()
        
        return {
            "status": "success",
            "message": f"Database reset successfully. Created {table_count} tables with no data.",
            "database_path": database_path,
            "backup_path": backup_path
        }
        
    except Exception as e:
        return {
            "status": "error",
            "message": f"Failed to reset database: {str(e)}"
        }


def clear_all_data_keep_structure():
    """
    Clear all data from existing tables while keeping the structure
    Returns: dict with status and message
    """
    try:
        paths = get_database_paths()
        database_path = paths['database_path']
        
        if not os.path.exists(database_path):
            return {
                "status": "error",
                "message": "Database file not found"
            }
        
        conn = sqlite3.connect(database_path, timeout=30.0)
        cursor = conn.cursor()
        
        # Get all table names
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [row[0] for row in cursor.fetchall()]
        
        # Tables in dependency order (children first)
        ordered_tables = [
            'sales', 'bom', 'router_operations', 'routers', 'expense_allocations', 
            'expenses', 'loan_payments', 'payroll', 'forecast_results', 'execution_log',
            'customers', 'units', 'bom_definitions', 'router_definitions', 
            'machines', 'labor_rates', 'payroll_config', 'expense_categories', 
            'loans', 'forecast'
        ]
        
        # Only clear tables that exist
        tables_to_clear = [table for table in ordered_tables if table in tables]
        
        cursor.execute("PRAGMA foreign_keys = OFF")
        cursor.execute("BEGIN TRANSACTION")
        
        cleared_count = 0
        for table_name in tables_to_clear:
            cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
            row_count = cursor.fetchone()[0]
            
            if row_count > 0:
                cursor.execute(f"DELETE FROM {table_name}")
                cleared_count += row_count
        
        # Reset auto-increment sequences
        cursor.execute("DELETE FROM sqlite_sequence")
        
        cursor.execute("PRAGMA foreign_keys = ON")
        conn.commit()
        conn.close()
        
        return {
            "status": "success",
            "message": f"Cleared {cleared_count} rows from {len(tables_to_clear)} tables. Structure preserved.",
            "tables_cleared": len(tables_to_clear),
            "rows_cleared": cleared_count
        }
        
    except Exception as e:
        return {
            "status": "error",
            "message": f"Failed to clear database: {str(e)}"
        }


if __name__ == "__main__":
    print("🗃️  Database Reset API")
    print("=" * 40)
    
    print("Choose an option:")
    print("1. Reset to completely clean database (recreate all tables)")
    print("2. Clear all data but keep existing structure")
    
    choice = input("Enter choice (1 or 2): ").strip()
    
    if choice == "1":
        result = reset_database_to_clean_state()
    elif choice == "2":
        result = clear_all_data_keep_structure()
    else:
        print("Invalid choice")
        sys.exit(1)
    
    print(f"\nStatus: {result['status']}")
    print(f"Message: {result['message']}")
    
    if result['status'] == 'error':
        sys.exit(1)