#!/usr/bin/env python3
"""
Test script to verify revenue forecasting fixes
"""

import requests
import json

def test_revenue_fixes():
    base_url = "http://localhost:8000"
    
    print("Testing Revenue Forecasting Fixes...")
    print("=" * 50)
    
    # Test 1: Get forecast data
    print("\n1. Testing GET /forecast endpoint...")
    try:
        response = requests.get(f"{base_url}/forecast")
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Success: Got forecast data")
            print(f"   - Products: {len(data.get('data', {}).get('products', []))}")
            print(f"   - Customers: {len(data.get('data', {}).get('customers', []))}")
            print(f"   - Sales Forecast: {len(data.get('data', {}).get('sales_forecast', []))}")
        else:
            print(f"❌ Failed: Status {response.status_code}")
    except Exception as e:
        print(f"❌ Error: {e}")
    
    # Test 2: Get scenarios
    print("\n2. Testing GET /forecast/scenarios endpoint...")
    try:
        response = requests.get(f"{base_url}/forecast/scenarios")
        if response.status_code == 200:
            data = response.json()
            scenarios = data.get('data', {}).get('scenarios', [])
            print(f"✅ Success: Found {len(scenarios)} scenarios")
            for scenario in scenarios:
                print(f"   - {scenario.get('forecast_id')}: {scenario.get('name')}")
        else:
            print(f"❌ Failed: Status {response.status_code}")
    except Exception as e:
        print(f"❌ Error: {e}")
    
    # Test 3: Test bulk update endpoint
    print("\n3. Testing POST /forecast/bulk_update endpoint...")
    try:
        test_data = {
            "forecasts": [
                {
                    "unit_id": "PROD-001",
                    "customer_id": "CUST-001", 
                    "period": "2025-08",
                    "quantity": 25,
                    "unit_price": 1000,
                    "total_revenue": 25000,
                    "forecast_id": "F002"
                }
            ],
            "operation": "replace"
        }
        
        response = requests.post(f"{base_url}/forecast/bulk_update", json=test_data)
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Success: Bulk update completed")
            print(f"   - Updated count: {data.get('data', {}).get('updated_count', 0)}")
        else:
            print(f"❌ Failed: Status {response.status_code}")
            print(f"   Response: {response.text}")
    except Exception as e:
        print(f"❌ Error: {e}")
    
    # Test 4: Get forecast data filtered by scenario
    print("\n4. Testing GET /forecast?forecast_id=F002 endpoint...")
    try:
        response = requests.get(f"{base_url}/forecast?forecast_id=F002")
        if response.status_code == 200:
            data = response.json()
            sales = data.get('data', {}).get('sales_forecast', [])
            print(f"✅ Success: Found {len(sales)} sales records for F002")
            for sale in sales:
                print(f"   - {sale.get('unit_id')} - {sale.get('customer_id')}: {sale.get('quantity')} @ ${sale.get('unit_price')}")
        else:
            print(f"❌ Failed: Status {response.status_code}")
    except Exception as e:
        print(f"❌ Error: {e}")
    
    print("\n" + "=" * 50)
    print("Test completed!")

if __name__ == "__main__":
    test_revenue_fixes() 