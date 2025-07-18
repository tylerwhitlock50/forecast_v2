#!/usr/bin/env python3
"""
Test script to check if the bom_definitions endpoint works correctly
"""

import requests
import json

def test_bom_definitions_endpoint():
    """Test the bom_definitions endpoint"""
    try:
        # Test the endpoint
        url = "http://localhost:8000/forecast/bom_definitions"
        print(f"Testing endpoint: {url}")
        
        response = requests.get(url)
        print(f"Status code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print("Response:")
            print(json.dumps(data, indent=2))
            
            if data.get('status') == 'success':
                bom_definitions = data.get('data', [])
                print(f"\nFound {len(bom_definitions)} BOM definitions:")
                for bom in bom_definitions:
                    print(f"  - {bom.get('bom_id')}: {bom.get('bom_name')}")
            else:
                print(f"Error: {data.get('message', 'Unknown error')}")
        else:
            print(f"Error: {response.text}")
            
    except Exception as e:
        print(f"Exception: {str(e)}")

if __name__ == "__main__":
    test_bom_definitions_endpoint() 