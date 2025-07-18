#!/usr/bin/env python3
"""
Simple test script to debug the bom_definitions endpoint
"""

import requests
import json

def test_endpoint():
    """Test the endpoint with detailed error handling"""
    try:
        url = "http://localhost:8000/forecast/bom_definitions"
        print(f"Testing: {url}")
        
        response = requests.get(url)
        print(f"Status: {response.status_code}")
        print(f"Headers: {dict(response.headers)}")
        
        if response.status_code == 200:
            print("Success!")
            data = response.json()
            print(json.dumps(data, indent=2))
        else:
            print(f"Error response: {response.text}")
            
    except requests.exceptions.ConnectionError:
        print("Connection error - server might not be running")
    except Exception as e:
        print(f"Exception: {type(e).__name__}: {str(e)}")

if __name__ == "__main__":
    test_endpoint() 