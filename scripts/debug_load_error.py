#!/usr/bin/env python3
"""
Debug script for database load error
"""

import sys
import os
sys.path.insert(0, './app')

def debug_load_function():
    """Debug the database load functionality"""
    print("Debugging Database Load Function")
    print("=" * 40)
    
    try:
        # Test the load logic step by step
        from db.database import db_manager
        
        # Test 1: Current database path
        current_db_path = db_manager.database_path
        print(f"Current database path: {current_db_path}")
        
        # Test 2: Check if current database exists
        if os.path.exists(current_db_path):
            print(f"✓ Current database exists: {current_db_path}")
        else:
            print(f"✗ Current database missing: {current_db_path}")
        
        # Test 3: Check saved databases directory
        data_dir = os.path.join(os.path.dirname(current_db_path), "saved_databases")
        if os.path.exists(data_dir):
            print(f"✓ Saved databases directory exists: {data_dir}")
            
            # List saved databases
            saved_files = [f for f in os.listdir(data_dir) if f.endswith('.db')]
            print(f"Found {len(saved_files)} saved databases:")
            for f in saved_files:
                print(f"  - {f}")
        else:
            print(f"✗ Saved databases directory missing: {data_dir}")
        
        # Test 4: Try importing the new functions
        from db import switch_database, get_current_database_path
        print("✓ New functions imported successfully")
        
        # Test 5: Try calling the functions
        path = get_current_database_path()
        print(f"✓ get_current_database_path() returned: {path}")
        
        return True
        
    except Exception as e:
        print(f"✗ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = debug_load_function()
    if success:
        print("\n✅ Debug completed successfully!")
    else:
        print("\n❌ Debug found issues!")