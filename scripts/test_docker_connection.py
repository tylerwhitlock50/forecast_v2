#!/usr/bin/env python3
"""
Test script to verify Docker frontend-backend connection
"""
import requests
import json
from typing import Dict, Any

def test_api_endpoint(endpoint: str, method: str = "GET", data: Dict[str, Any] = None, base_url: str = "http://localhost:8000") -> Dict[str, Any]:
    """Test a specific API endpoint"""
    url = f"{base_url}{endpoint}"
    
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
    print("Testing Docker Frontend-Backend Connection")
    print("=" * 50)
    
    # Test both direct backend access and nginx proxy
    test_urls = [
        ("Direct Backend", "http://localhost:8000"),
        ("Nginx Proxy", "http://localhost:3000/api")
    ]
    
    for test_name, base_url in test_urls:
        print(f"\n{test_name} ({base_url})")
        print("-" * 30)
        
        # Test basic endpoints
        endpoints_to_test = [
            ("/", "GET"),
            ("/data/customers", "GET"),
            ("/data/units", "GET"),
            ("/data/sales", "GET"),
            ("/forecast", "GET"),
        ]
        
        for endpoint, method in endpoints_to_test:
            print(f"Testing {method} {endpoint}...")
            result = test_api_endpoint(endpoint, method, base_url=base_url)
            
            if "error" in result:
                print(f"❌ Error: {result['error']}")
            else:
                print(f"✅ Success")
                if "data" in result:
                    if isinstance(result["data"], list):
                        print(f"   Data count: {len(result['data'])}")
                        if result["data"]:
                            print(f"   Sample record keys: {list(result['data'][0].keys())}")
                    elif isinstance(result["data"], dict):
                        print(f"   Data type: dict with keys: {list(result['data'].keys())}")
                        if "sales_forecast" in result["data"]:
                            print(f"   Sales forecast count: {len(result['data']['sales_forecast'])}")
    
    print("\n" + "=" * 50)
    print("DOCKER SETUP VERIFICATION")
    print("=" * 50)
    
    # Check if containers are running
    import subprocess
    try:
        result = subprocess.run(['docker', 'ps'], capture_output=True, text=True)
        if result.returncode == 0:
            print("✅ Docker containers are running:")
            for line in result.stdout.split('\n'):
                if 'forecast' in line.lower():
                    print(f"   {line}")
        else:
            print("❌ Docker command failed")
    except FileNotFoundError:
        print("⚠️  Docker not found - make sure Docker is installed and running")
    
    print("\nNext steps:")
    print("1. If direct backend works but nginx proxy doesn't, check nginx configuration")
    print("2. If neither works, check if containers are running: docker-compose ps")
    print("3. If containers are running but API fails, check logs: docker-compose logs fastapi")
    print("4. If frontend can't connect, check logs: docker-compose logs frontend")

if __name__ == "__main__":
    main() 