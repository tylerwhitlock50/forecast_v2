#!/usr/bin/env python3
"""
Test the database management endpoints
"""

import requests
import json

# Base URL for the API
BASE_URL = "http://localhost:8000"

def test_endpoint(method, endpoint, data=None):
    """Test an API endpoint"""
    url = f"{BASE_URL}{endpoint}"
    print(f"\n🔍 Testing {method} {endpoint}")
    
    try:
        if method == "GET":
            response = requests.get(url, timeout=30)
        elif method == "POST":
            response = requests.post(url, json=data, timeout=30)
        else:
            print(f"❌ Unsupported method: {method}")
            return
        
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"✅ Success: {result.get('message', 'No message')}")
            if 'table_count' in result:
                print(f"   Tables: {result['table_count']}")
            if 'total_rows' in result:
                print(f"   Total rows: {result['total_rows']}")
        else:
            print(f"❌ Error: {response.text}")
            
    except requests.exceptions.RequestException as e:
        print(f"❌ Request failed: {e}")
    except json.JSONDecodeError as e:
        print(f"❌ JSON decode error: {e}")
        print(f"Response text: {response.text}")

def main():
    print("🧪 Testing Database Management Endpoints")
    print("=" * 50)
    
    # Test if API is running
    test_endpoint("GET", "/")
    
    # Test database info endpoint
    test_endpoint("GET", "/database/info")
    
    # Test verify empty endpoint
    test_endpoint("POST", "/database/verify-empty")
    
    # Test clear data endpoint
    test_endpoint("POST", "/database/clear-data")
    
    # Test verify empty again after clearing
    test_endpoint("POST", "/database/verify-empty")
    
    # Test reset clean endpoint
    test_endpoint("POST", "/database/reset-clean")
    
    # Final verification
    test_endpoint("GET", "/database/info")

if __name__ == "__main__":
    main()