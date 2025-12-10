#!/usr/bin/env python3
"""
Clean Database Creation Script - Docker Compatible
Creates a completely fresh database with all tables but no data
Works both locally and in Docker containers
"""

import os
import sys
import sqlite3
import shutil
from datetime import datetime
from pathlib import Path


def get_database_paths():
    """Get the database paths for both environments"""
    # Docker environment
    if os.path.exists('/data'):
        return {
            'database_path': '/data/forecast.db',
            'data_dir': '/data',
            'saved_databases_dir': '/data/saved_databases'
        }
    # Local development
    else:
        return {
            'database_path': './data/forecast.db',
            'data_dir': './data',
            'saved_databases_dir': './data/saved_databases'
        }


def ensure_directories_exist(paths):
    """Ensure all necessary directories exist"""
    for path_key, path_value in paths.items():
        if path_key.endswith('_dir'):
            Path(path_value).mkdir(parents=True, exist_ok=True)
            print(f"✓ Directory ready: {path_value}")


def backup_existing_database(database_path, backup_dir):
    """Create a backup of the existing database"""
    if os.path.exists(database_path):
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_filename = f"clean_backup_{timestamp}.db"
        backup_path = os.path.join(backup_dir, backup_filename)
        
        try:
            # Ensure backup directory exists
            Path(backup_dir).mkdir(parents=True, exist_ok=True)
            
            shutil.copy2(database_path, backup_path)
            print(f"✓ Created backup: {backup_path}")
            return backup_path
        except Exception as e:
            print(f"⚠️  Could not create backup: {e}")
            return None
    return None


def close_database_connections(database_path):
    """Try to close any existing database connections"""
    try:
        # Try to connect and immediately close to flush any pending operations
        temp_conn = sqlite3.connect(database_path, timeout=1.0)
        temp_conn.execute("PRAGMA journal_mode=DELETE")  # Switch out of WAL mode
        temp_conn.close()
        print("✓ Closed existing database connections")
    except Exception as e:
        print(f"⚠️  Could not close connections cleanly: {e}")


def create_clean_database(database_path, backup_dir):
    """Create a completely clean database with all table structures"""
    
    # Backup existing database
    backup_path = backup_existing_database(database_path, backup_dir)
    
    # Try to close existing connections
    close_database_connections(database_path)
    
    # Remove existing database files
    files_to_remove = [database_path, f"{database_path}-wal", f"{database_path}-shm"]
    
    for file_path in files_to_remove:
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
                print(f"✓ Removed: {file_path}")
            except Exception as e:
                print(f"⚠️  Could not remove {file_path}: {e}")
    
    # Create fresh database
    print(f"🆕 Creating fresh database: {database_path}")
    
    try:
        # Ensure the database directory exists
        Path(database_path).parent.mkdir(parents=True, exist_ok=True)
        
        conn = sqlite3.connect(database_path)
        cursor = conn.cursor()
        
        # Set optimal settings for new database
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA cache_size=10000")
        cursor.execute("PRAGMA temp_store=MEMORY")
        cursor.execute("PRAGMA foreign_keys=ON")
        
        print("📋 Creating database tables...")
        
        # Create all tables (comprehensive schema)
        create_table_sql = """
        -- Create customers table
        CREATE TABLE customers (
            customer_id TEXT PRIMARY KEY,
            customer_name TEXT NOT NULL,
            customer_type TEXT,
            region TEXT
        );

        -- Create units table
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

        -- Create forecast table
        CREATE TABLE forecast (
            forecast_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT
        );

        -- Create sales table
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

        -- Create BOM definitions table
        CREATE TABLE bom_definitions (
            bom_id TEXT PRIMARY KEY,
            bom_name TEXT NOT NULL,
            bom_description TEXT,
            version TEXT DEFAULT '1.0',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Create BOM table
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

        -- Create router_definitions table
        CREATE TABLE router_definitions (
            router_id TEXT PRIMARY KEY,
            router_name TEXT NOT NULL,
            router_description TEXT,
            version TEXT DEFAULT '1.0',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Create router_operations table
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

        -- Create routers table (legacy compatibility)
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

        -- Create machines table
        CREATE TABLE machines (
            machine_id TEXT PRIMARY KEY,
            machine_name TEXT NOT NULL,
            machine_description TEXT,
            machine_rate REAL,
            labor_type TEXT,
            available_minutes_per_month INTEGER DEFAULT 0
        );

        -- Create labor_rates table
        CREATE TABLE labor_rates (
            rate_id TEXT PRIMARY KEY,
            rate_name TEXT NOT NULL,
            rate_description TEXT,
            rate_amount REAL,
            rate_type TEXT
        );

        -- Create enhanced payroll table
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

        -- Create payroll configuration table
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

        -- Create forecast_results table
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

        -- Create execution_log table
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

        -- Create expense_categories table
        CREATE TABLE expense_categories (
            category_id TEXT PRIMARY KEY,
            category_name TEXT NOT NULL,
            category_type TEXT NOT NULL CHECK (category_type IN ('factory_overhead', 'admin_expense', 'cogs')),
            parent_category_id TEXT,
            account_code TEXT,
            description TEXT,
            FOREIGN KEY (parent_category_id) REFERENCES expense_categories (category_id)
        );

        -- Create expenses table
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

        -- Create expense_allocations table
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

        -- Create loans table
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

        -- Create loan_payments table
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
        """
        
        # Execute all CREATE TABLE statements
        cursor.executescript(create_table_sql)
        
        conn.commit()
        print("✅ All database tables created successfully")
        
        # Verify tables exist and show counts
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        tables = cursor.fetchall()
        
        print(f"\n📊 Created {len(tables)} tables:")
        for (table_name,) in tables:
            cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
            count = cursor.fetchone()[0]
            print(f"  ✓ {table_name}: {count} rows")
        
        conn.close()
        
        print(f"\n🎉 Clean database created successfully!")
        print(f"📁 Database location: {database_path}")
        if backup_path:
            print(f"💾 Backup saved at: {backup_path}")
        print("💡 You now have a completely clean database with all table structures")
        
        return True
        
    except Exception as e:
        print(f"❌ Error creating clean database: {e}")
        import traceback
        traceback.print_exc()
        return False


def create_saved_database_copy(database_path, saved_databases_dir, name):
    """Create a named copy in the saved databases directory"""
    if not name.endswith('.db'):
        name += '.db'
    
    saved_path = os.path.join(saved_databases_dir, name)
    
    try:
        Path(saved_databases_dir).mkdir(parents=True, exist_ok=True)
        shutil.copy2(database_path, saved_path)
        print(f"✅ Created saved database: {saved_path}")
        return saved_path
    except Exception as e:
        print(f"❌ Could not create saved database: {e}")
        return None


if __name__ == "__main__":
    print("🗃️  Clean Database Creation Script (Docker Compatible)")
    print("=" * 60)
    
    # Get environment-appropriate paths
    paths = get_database_paths()
    database_path = paths['database_path']
    saved_databases_dir = paths['saved_databases_dir']
    
    # Ensure directories exist
    ensure_directories_exist(paths)
    
    print(f"📁 Database location: {database_path}")
    print(f"💾 Backups location: {saved_databases_dir}")
    
    if os.path.exists(database_path):
        response = input("⚠️  This will replace the existing database with a clean one. Continue? (y/N): ")
        
        if response.lower() not in ['y', 'yes']:
            print("❌ Operation cancelled")
            sys.exit(0)
    else:
        print("📁 No existing database found. Creating new clean database.")
    
    # Create clean database
    success = create_clean_database(database_path, saved_databases_dir)
    
    if success:
        # Ask if user wants to create a named copy
        response = input("\n💾 Would you like to save this clean database with a name? (y/N): ")
        if response.lower() in ['y', 'yes']:
            name = input("Enter a name for this clean database (without .db extension): ")
            if name.strip():
                create_saved_database_copy(database_path, saved_databases_dir, name.strip())
        
        print("\n✨ Clean database setup complete!")
    else:
        print("\n❌ Clean database creation failed")
        sys.exit(1)