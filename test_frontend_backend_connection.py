#!/usr/bin/env python3
"""
Test script to verify frontend-backend connection
"""
import requests
import json
from typing import Dict, Any

API_BASE = "http://localhost:8000"

def test_api_endpoint(endpoint: str, method: str = "GET", data: Dict[str, Any] = None) -> Dict[str, Any]:
    """Test a specific API endpoint"""
    url = f"{API_BASE}{endpoint}"
    
    try:
        if method == "GET":
            response = requests.get(url)
        elif method == "POST":
            response = requests.post(url, json=data)
        elif method == "DELETE":
            response = requests.delete(url)
        else:
            return {"error": f"Unsupported method: {method}"}
        
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        return {"error": str(e)}

def main():
    print("Testing Frontend-Backend Connection")
    print("=" * 50)
    
    # Test basic endpoints
    endpoints_to_test = [
        ("/", "GET"),
        ("/schema", "GET"),
        ("/data/customers", "GET"),
        ("/data/units", "GET"),
        ("/data/sales", "GET"),
        ("/data/machines", "GET"),
        ("/data/payroll", "GET"),
        ("/data/bom", "GET"),
        ("/data/routers", "GET"),
        ("/forecast", "GET"),
    ]
    
    results = {}
    
    for endpoint, method in endpoints_to_test:
        print(f"\nTesting {method} {endpoint}...")
        result = test_api_endpoint(endpoint, method)
        
        if "error" in result:
            print(f"❌ Error: {result['error']}")
        else:
            print(f"✅ Success")
            if "data" in result:
                if isinstance(result["data"], list):
                    print(f"   Data count: {len(result['data'])}")
                    if result["data"]:
                        print(f"   Sample record keys: {list(result['data'][0].keys())}")
                        print(f"   Sample record: {result['data'][0]}")
                elif isinstance(result["data"], dict):
                    print(f"   Data type: dict with keys: {list(result['data'].keys())}")
                    if "sales_forecast" in result["data"]:
                        print(f"   Sales forecast count: {len(result['data']['sales_forecast'])}")
                else:
                    print(f"   Data type: {type(result['data'])}")
        
        results[endpoint] = result
    
    # Test forecast creation
    print(f"\nTesting POST /forecast/create...")
    test_forecast_data = {
        "sales": {
            "customer_id": "CUST001",
            "unit_id": "UNIT001", 
            "period": "2024-01",
            "quantity": 10,
            "unit_price": 100.0,
            "total_revenue": 1000.0
        }
    }
    
    create_result = test_api_endpoint("/forecast/create", "POST", test_forecast_data)
    if "error" in create_result:
        print(f"❌ Error creating forecast: {create_result['error']}")
    else:
        print(f"✅ Forecast created successfully")
    
    # Summary
    print("\n" + "=" * 50)
    print("SUMMARY")
    print("=" * 50)
    
    successful_endpoints = [ep for ep, result in results.items() if "error" not in result]
    failed_endpoints = [ep for ep, result in results.items() if "error" in result]
    
    print(f"Successful endpoints: {len(successful_endpoints)}")
    print(f"Failed endpoints: {len(failed_endpoints)}")
    
    if failed_endpoints:
        print("\nFailed endpoints:")
        for endpoint in failed_endpoints:
            print(f"  - {endpoint}: {results[endpoint]['error']}")
    
    # Check if we have the minimum required data for frontend
    required_data = ["customers", "units", "sales"]
    missing_data = []
    
    for data_type in required_data:
        endpoint = f"/data/{data_type}"
        if endpoint in results and "error" not in results[endpoint]:
            data_count = len(results[endpoint].get("data", []))
            if data_count == 0:
                missing_data.append(f"{data_type} (empty)")
        else:
            missing_data.append(data_type)
    
    if missing_data:
        print(f"\n⚠️  Missing or empty data: {', '.join(missing_data)}")
        print("   The frontend may not work properly without this data.")
    else:
        print(f"\n✅ All required data is available for frontend operation.")

if __name__ == "__main__":
    main() 