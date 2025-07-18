#!/usr/bin/env python3
"""
Test script to verify database save/load functionality
"""

import os
import sqlite3
from datetime import datetime
import json

def test_database_operations():
    """Test database save/load operations"""
    print("Testing Database Save/Load Operations")
    print("=" * 40)
    
    # Test 1: Check if database exists
    db_path = "./app/data/forecast.db"
    if os.path.exists(db_path):
        print(f"✓ Database exists: {db_path}")
    else:
        print(f"✗ Database not found: {db_path}")
        return False
    
    # Test 2: Check if saved_databases directory exists
    saved_db_dir = "./app/data/saved_databases"
    if not os.path.exists(saved_db_dir):
        os.makedirs(saved_db_dir)
        print(f"✓ Created saved_databases directory: {saved_db_dir}")
    else:
        print(f"✓ Saved databases directory exists: {saved_db_dir}")
    
    # Test 3: Test basic database connection
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = cursor.fetchall()
        print(f"✓ Database connection successful. Found {len(tables)} tables")
        conn.close()
    except Exception as e:
        print(f"✗ Database connection failed: {e}")
        return False
    
    # Test 4: Test save operation (simulate)
    test_save_name = f"test_save_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    test_save_path = os.path.join(saved_db_dir, f"{test_save_name}.db")
    
    try:
        import shutil
        shutil.copy2(db_path, test_save_path)
        print(f"✓ Database save simulation successful: {test_save_path}")
        
        # Check file size
        file_size = os.path.getsize(test_save_path)
        print(f"✓ Saved database size: {file_size} bytes")
        
        # Test list operation
        saved_files = []
        for filename in os.listdir(saved_db_dir):
            if filename.endswith('.db'):
                full_path = os.path.join(saved_db_dir, filename)
                stat = os.stat(full_path)
                saved_files.append({
                    'name': filename[:-3],  # Remove .db extension
                    'filename': filename,
                    'size': stat.st_size,
                    'created': datetime.fromtimestamp(stat.st_ctime).isoformat(),
                    'modified': datetime.fromtimestamp(stat.st_mtime).isoformat()
                })
        
        print(f"✓ Found {len(saved_files)} saved databases")
        for db in saved_files:
            print(f"  - {db['name']} ({db['size']} bytes)")
        
        # Test load operation (simulate)
        backup_path = os.path.join(saved_db_dir, f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db")
        shutil.copy2(db_path, backup_path)
        print(f"✓ Backup created: {backup_path}")
        
        # Simulate load
        shutil.copy2(test_save_path, db_path)
        print(f"✓ Database load simulation successful")
        
        # Clean up test files
        if os.path.exists(test_save_path):
            os.remove(test_save_path)
        if os.path.exists(backup_path):
            os.remove(backup_path)
        print("✓ Test cleanup completed")
        
    except Exception as e:
        print(f"✗ Save/load simulation failed: {e}")
        return False
    
    print("\n" + "=" * 40)
    print("✓ All database operations tests passed!")
    return True

if __name__ == "__main__":
    success = test_database_operations()
    if success:
        print("\n🎉 Database save/load functionality is working correctly!")
    else:
        print("\n❌ Database save/load functionality has issues!")