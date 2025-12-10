#!/usr/bin/env python3
"""
Database Table Clearing Script
Clear all data from database tables while preserving table structure
"""

import os
import sys
import sqlite3


def get_database_path():
    """Get the database path"""
    # Check if we're in Docker environment
    if os.path.exists('/data'):
        return '/data/forecast.db'
    else:
        return './data/forecast.db'


def clear_all_tables():
    """Clear all data from database tables while preserving structure"""
    
    database_path = get_database_path()
    
    if not os.path.exists(database_path):
        print(f"❌ Database file not found: {database_path}")
        return False
    
    # List of tables to clear (in order to respect foreign key constraints)
    tables_to_clear = [
        # Clear child tables first (those with foreign keys)
        'sales',
        'bom',
        'router_operations', 
        'routers',
        'expense_allocations',
        'expenses',
        'loan_payments',
        'payroll',
        'forecast_results',
        'execution_log',
        
        # Clear parent tables last
        'customers',
        'units',
        'bom_definitions',
        'router_definitions',
        'machines',
        'labor_rates',
        'payroll_config',
        'expense_categories',
        'loans',
        'forecast'
    ]
    
    try:
        # Connect directly to SQLite with exclusive access
        conn = sqlite3.connect(database_path, timeout=30.0)
        
        # First, try to switch to DELETE mode to avoid WAL issues
        try:
            conn.execute("PRAGMA journal_mode=DELETE")
        except:
            pass  # If this fails, continue anyway
            
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA cache_size=10000")
        cursor = conn.cursor()
        
        # Disable foreign key constraints temporarily
        cursor.execute("PRAGMA foreign_keys = OFF")
        
        # Begin transaction
        cursor.execute("BEGIN IMMEDIATE TRANSACTION")
        
        print("Clearing database tables...")
        cleared_count = 0
        
        for table_name in tables_to_clear:
            try:
                # Check if table exists first
                cursor.execute("""
                    SELECT name FROM sqlite_master 
                    WHERE type='table' AND name=?
                """, (table_name,))
                
                if cursor.fetchone():
                    # Get count before clearing
                    cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
                    row_count = cursor.fetchone()[0]
                    
                    if row_count > 0:
                        # Clear the table
                        cursor.execute(f"DELETE FROM {table_name}")
                        print(f"✓ Cleared {row_count} rows from {table_name}")
                        cleared_count += row_count
                    else:
                        print(f"- {table_name} was already empty")
                else:
                    print(f"- {table_name} table does not exist")
                    
            except sqlite3.Error as e:
                print(f"✗ Error clearing {table_name}: {e}")
        
        # Re-enable foreign key constraints
        cursor.execute("PRAGMA foreign_keys = ON")
        
        # Commit the changes
        conn.commit()
        
        print(f"\n✅ Successfully cleared {cleared_count} total rows from database tables")
        print("📋 Database structure preserved - all tables remain intact")
        
        # Optionally reset auto-increment counters
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = cursor.fetchall()
        
        print("\n🔄 Resetting auto-increment sequences...")
        for (table_name,) in tables:
            try:
                cursor.execute(f"DELETE FROM sqlite_sequence WHERE name='{table_name}'")
            except sqlite3.Error:
                pass  # Table might not have auto-increment
        
        conn.commit()
        print("✓ Auto-increment sequences reset")
        
    except Exception as e:
        print(f"❌ Error during database clearing: {e}")
        if 'conn' in locals():
            conn.rollback()
        return False
    
    finally:
        if 'conn' in locals():
            conn.close()
    
    return True


def verify_tables_empty():
    """Verify that all tables are empty"""
    database_path = get_database_path()
    
    if not os.path.exists(database_path):
        print(f"❌ Database file not found: {database_path}")
        return False
    
    try:
        conn = sqlite3.connect(database_path, timeout=30.0)
        cursor = conn.cursor()
        
        # Get all table names
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = cursor.fetchall()
        
        print("\n📊 Verifying tables are empty:")
        all_empty = True
        
        for (table_name,) in tables:
            cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
            count = cursor.fetchone()[0]
            
            if count > 0:
                print(f"⚠️  {table_name}: {count} rows")
                all_empty = False
            else:
                print(f"✓ {table_name}: empty")
        
        if all_empty:
            print("\n✅ All tables are empty!")
        else:
            print("\n⚠️  Some tables still have data")
        
        return all_empty
        
    except Exception as e:
        print(f"❌ Error verifying tables: {e}")
        return False
    
    finally:
        if 'conn' in locals():
            conn.close()


if __name__ == "__main__":
    print("🗃️  Database Table Clearing Script")
    print("=" * 50)
    
    # Confirm before proceeding
    response = input("⚠️  This will clear ALL data from database tables. Continue? (y/N): ")
    
    if response.lower() not in ['y', 'yes']:
        print("❌ Operation cancelled")
        sys.exit(0)
    
    # Clear tables
    success = clear_all_tables()
    
    if success:
        # Verify tables are empty
        verify_tables_empty()
        print("\n🎉 Database clearing completed successfully!")
        print("💡 You now have a clean database with all table structures intact")
    else:
        print("\n❌ Database clearing failed")
        sys.exit(1)