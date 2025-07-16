#!/usr/bin/env python3
"""
Test script to verify forecast scenarios are working correctly
"""
import requests
import json

def test_scenarios():
    print("Testing Forecast Scenarios")
    print("=" * 40)
    
    # Test backend scenarios endpoint
    try:
        response = requests.get('http://localhost:8000/forecast/scenarios')
        if response.status_code == 200:
            data = response.json()
            print("✅ Backend scenarios endpoint working")
            print(f"   Status: {data.get('status')}")
            
            scenarios = data.get('data', {}).get('scenarios', [])
            print(f"   Found {len(scenarios)} scenarios:")
            
            for scenario in scenarios:
                print(f"   - {scenario.get('forecast_id')} | {scenario.get('name')} ({scenario.get('description')})")
        else:
            print(f"❌ Backend scenarios endpoint failed: {response.status_code}")
    except Exception as e:
        print(f"❌ Error testing backend scenarios: {e}")
    
    print("\n" + "=" * 40)
    print("Expected Frontend Display:")
    print("=" * 40)
    
    # Show what the frontend should display
    scenarios = [
        {"forecast_id": "F001", "name": "Karl", "description": "Karl model 7.16.25"},
        {"forecast_id": "F002", "name": "Justin", "description": "Justin Model"},
        {"forecast_id": "F003", "name": "tyler", "description": "Tyler Forecast"}
    ]
    
    print("Forecast Scenario dropdown should show:")
    for scenario in scenarios:
        print(f"   {scenario['forecast_id']} | {scenario['name']}")
    
    print("\nIf the frontend is still showing 'F002 |' without the name,")
    print("the issue is likely in the frontend scenario loading or mapping.")

if __name__ == "__main__":
    test_scenarios() 