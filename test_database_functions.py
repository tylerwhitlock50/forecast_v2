#!/usr/bin/env python3
"""
Test the database management functions directly
"""

import sys
import os

# Add the app directory to sys.path
sys.path.append(os.path.join(os.path.dirname(__file__), 'app'))

def test_database_functions():
    """Test the database management functions directly"""
    print("🧪 Testing Database Management Functions")
    print("=" * 50)
    
    try:
        # Import the database management functions
        from api.database_management_routes import get_database_paths
        from db.database import db_manager
        
        print("✅ Successfully imported database modules")
        
        # Test getting database paths
        paths = get_database_paths()
        print(f"📁 Database paths: {paths}")
        
        # Test database connection
        try:
            conn = db_manager.get_connection()
            cursor = conn.cursor()
            
            # Get table count
            cursor.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
            table_count = cursor.fetchone()[0]
            print(f"📊 Found {table_count} tables in database")
            
            # Get total row count
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = cursor.fetchall()
            
            total_rows = 0
            for (table_name,) in tables:
                cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
                count = cursor.fetchone()[0]
                total_rows += count
                print(f"   {table_name}: {count} rows")
            
            print(f"📈 Total rows across all tables: {total_rows}")
            
            db_manager.close_connection(conn)
            
            return True
            
        except Exception as e:
            print(f"❌ Database connection error: {e}")
            return False
            
    except ImportError as e:
        print(f"❌ Import error: {e}")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False

def test_clear_data_function():
    """Test the clear data functionality"""
    print("\n🗑️  Testing Clear Data Function")
    print("-" * 30)
    
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Get current row counts
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = cursor.fetchall()
        
        print("📊 Current table status:")
        tables_with_data = []
        
        for (table_name,) in tables:
            cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
            count = cursor.fetchone()[0]
            if count > 0:
                tables_with_data.append((table_name, count))
                print(f"   {table_name}: {count} rows")
        
        if not tables_with_data:
            print("   All tables are already empty")
            db_manager.close_connection(conn)
            return True
        
        # Try to clear the data
        print("\n🧹 Attempting to clear data...")
        
        # Tables in dependency order (children first)
        ordered_tables = [
            'sales', 'bom', 'router_operations', 'routers', 'expense_allocations', 
            'expenses', 'loan_payments', 'payroll', 'forecast_results', 'execution_log',
            'customers', 'units', 'bom_definitions', 'router_definitions', 
            'machines', 'labor_rates', 'payroll_config', 'expense_categories', 
            'loans', 'forecast'
        ]
        
        # Only clear tables that exist and have data
        table_names = [t[0] for t in tables]
        tables_to_clear = [table for table in ordered_tables if table in table_names]
        
        cursor.execute("PRAGMA foreign_keys = OFF")
        cursor.execute("BEGIN TRANSACTION")
        
        cleared_count = 0
        for table_name in tables_to_clear:
            try:
                cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
                row_count = cursor.fetchone()[0]
                
                if row_count > 0:
                    cursor.execute(f"DELETE FROM {table_name}")
                    print(f"   ✅ Cleared {row_count} rows from {table_name}")
                    cleared_count += row_count
            except Exception as e:
                print(f"   ⚠️  Could not clear {table_name}: {e}")
        
        # Reset auto-increment sequences
        try:
            cursor.execute("DELETE FROM sqlite_sequence")
            print("   ✅ Reset auto-increment sequences")
        except:
            pass
        
        cursor.execute("PRAGMA foreign_keys = ON")
        conn.commit()
        
        print(f"\n🎉 Successfully cleared {cleared_count} total rows from database")
        
        # Verify tables are empty
        print("\n✅ Verification - final table status:")
        all_empty = True
        for (table_name,) in tables:
            cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
            count = cursor.fetchone()[0]
            if count > 0:
                print(f"   ⚠️  {table_name}: {count} rows")
                all_empty = False
            else:
                print(f"   ✅ {table_name}: empty")
        
        if all_empty:
            print("\n🎯 All tables are now empty!")
        
        db_manager.close_connection(conn)
        return True
        
    except Exception as e:
        try:
            if 'conn' in locals():
                conn.rollback()
                db_manager.close_connection(conn)
        except:
            pass
        print(f"❌ Error clearing data: {e}")
        return False

if __name__ == "__main__":
    success = test_database_functions()
    
    if success:
        user_input = input("\n🤔 Would you like to test clearing all data? (y/N): ")
        if user_input.lower() in ['y', 'yes']:
            test_clear_data_function()
    else:
        print("\n❌ Database function tests failed")