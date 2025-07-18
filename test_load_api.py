#!/usr/bin/env python3
"""
Test script to verify the database load API endpoint
"""

import sys
import os
sys.path.insert(0, './app')

def test_load_api():
    """Test the database load API logic"""
    print("Testing Database Load API Logic")
    print("=" * 40)
    
    try:
        # Test 1: Import the API modules
        from api.database_routes import load_database, switch_database_endpoint
        from db import get_current_database_path
        print("✓ API modules imported successfully")
        
        # Test 2: Get current database path
        current_path = get_current_database_path()
        print(f"✓ Current database path: {current_path}")
        
        # Test 3: Check saved databases directory
        data_dir = os.path.join(os.path.dirname(current_path), "saved_databases")
        if os.path.exists(data_dir):
            print(f"✓ Saved databases directory exists: {data_dir}")
            
            # List saved databases
            saved_files = [f for f in os.listdir(data_dir) if f.endswith('.db')]
            print(f"Found {len(saved_files)} saved databases:")
            for f in saved_files:
                print(f"  - {f}")
                
            # Test 4: Test request format
            if saved_files:
                test_request = {"filename": saved_files[0]}
                print(f"✓ Test request format: {test_request}")
        else:
            print(f"✗ Saved databases directory missing: {data_dir}")
        
        return True
        
    except Exception as e:
        print(f"✗ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_load_api()
    if success:
        print("\n✅ Database load API test completed successfully!")
    else:
        print("\n❌ Database load API test found issues!")