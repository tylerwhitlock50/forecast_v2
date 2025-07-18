#!/usr/bin/env python3
"""
Debug script to test API and database functions
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'app'))

from db.database import DatabaseManager

def test_database():
    print("Testing database...")
    db = DatabaseManager()
    conn = db.get_connection()
    cursor = conn.cursor()
    
    # Check tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = cursor.fetchall()
    print("Tables:", [t[0] for t in tables])
    
    # Test get_all_data
    try:
        data = db.get_all_data()
        print("get_all_data type:", type(data))
        print("get_all_data keys:", list(data.keys()) if isinstance(data, dict) else "Not a dict")
        print("BOM Definitions count:", len(data.get('bom_definitions', [])) if isinstance(data, dict) else "N/A")
        return data
    except Exception as e:
        print("Error in get_all_data:", e)
        return None
    finally:
        conn.close()

def test_api():
    print("\nTesting API...")
    import requests
    try:
        response = requests.get('http://localhost:8000/data/all')
        print("Status:", response.status_code)
        print("Response:", response.text[:500])
        return response
    except Exception as e:
        print("Error testing API:", e)
        return None

if __name__ == "__main__":
    data = test_database()
    response = test_api() 