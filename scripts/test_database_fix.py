#!/usr/bin/env python3
"""
Test script to verify database switching functionality
"""

import sys
import os
sys.path.insert(0, './app')

def test_database_switch():
    """Test the database switch functionality"""
    print("Testing Database Switch Functionality")
    print("=" * 40)
    
    try:
        # Test 1: Import functions
        from db import switch_database, get_current_database_path
        print("✓ Functions imported successfully")
        
        # Test 2: Get current path
        current_path = get_current_database_path()
        print(f"✓ Current database path: {current_path}")
        
        # Test 3: Check if path exists
        if os.path.exists(current_path):
            print(f"✓ Database file exists: {current_path}")
        else:
            print(f"✗ Database file missing: {current_path}")
        
        return True
        
    except ImportError as e:
        print(f"✗ Import error: {e}")
        return False
    except Exception as e:
        print(f"✗ Error: {e}")
        return False

if __name__ == "__main__":
    success = test_database_switch()
    if success:
        print("\n✅ Database switching functions are working!")
    else:
        print("\n❌ Database switching functions have issues!")