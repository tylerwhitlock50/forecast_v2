#!/usr/bin/env python3
"""
Example usage of the LLM-powered API endpoints
This script demonstrates how to interact with the forecast API using natural language.
"""

import asyncio
import httpx
import json

# API base URL
BASE_URL = "http://localhost:8000"

async def test_api_endpoints():
    """Test the various API endpoints"""
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        
        print("🚀 Testing Forecast API with LLM Integration")
        print("=" * 60)
        
        # 1. Health check
        print("\n1️⃣ Health Check")
        print("-" * 20)
        response = await client.get(f"{BASE_URL}/")
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        # 2. Get database schema
        print("\n2️⃣ Database Schema")
        print("-" * 20)
        response = await client.get(f"{BASE_URL}/schema")
        if response.status_code == 200:
            schema_data = response.json()
            tables = schema_data.get("data", {}).get("tables", {})
            print(f"Available tables: {list(tables.keys())}")
        else:
            print(f"Error: {response.status_code}")
        
        # 3. Test natural language to SQL conversion
        print("\n3️⃣ Natural Language to SQL")
        print("-" * 20)
        
        test_requests = [
            {
                "message": "Increase unit prices by 10% for all sales in 2024-01",
                "description": "Price increase for specific period"
            },
            {
                "message": "Decrease sales quantity by 20% for customer CUST-001 in 2024-02",
                "description": "Quantity decrease for specific customer"
            },
            {
                "message": "Set material cost to $50 for unit PROD-001",
                "description": "Material cost update"
            }
        ]
        
        for i, test_request in enumerate(test_requests, 1):
            print(f"\n📝 Test {i}: {test_request['description']}")
            print(f"Request: {test_request['message']}")
            
            response = await client.post(
                f"{BASE_URL}/chat",
                json={"message": test_request['message']}
            )
            
            if response.status_code == 200:
                result = response.json()
                data = result.get("data", {})
                
                print(f"✅ Status: {result.get('status')}")
                print(f"🔍 Confidence: {data.get('confidence', 0):.2f}")
                print(f"⚠️  Requires Approval: {data.get('requires_approval', True)}")
                
                sql_statement = data.get('sql_statement', '')
                if sql_statement:
                    print(f"\n📋 Generated SQL:")
                    print(f"```sql")
                    print(sql_statement)
                    print(f"```")
                
                explanation = data.get('explanation', '')
                if explanation:
                    print(f"\n💡 Explanation:")
                    print(explanation)
                
                suggested_actions = data.get('suggested_actions', [])
                if suggested_actions:
                    print(f"\n💭 Suggested Actions:")
                    for action in suggested_actions:
                        print(f"  • {action}")
            else:
                print(f"❌ Error: {response.status_code} - {response.text}")
        
        # 4. Test SQL preview (if we have a valid SQL statement)
        print("\n4️⃣ SQL Preview")
        print("-" * 20)
        
        # Use a simple SELECT query for preview
        preview_request = {
            "sql_statement": "SELECT * FROM sales LIMIT 5",
            "description": "Preview sales data"
        }
        
        response = await client.post(
            f"{BASE_URL}/preview_sql",
            json=preview_request
        )
        
        if response.status_code == 200:
            result = response.json()
            data = result.get("data", {})
            
            print(f"✅ Status: {result.get('status')}")
            print(f"📊 Row Count: {data.get('row_count', 0)}")
            
            preview_data = data.get('preview_data', [])
            if preview_data:
                print(f"\n📋 Preview Data (first 3 rows):")
                for i, row in enumerate(preview_data[:3]):
                    print(f"Row {i+1}: {row}")
        else:
            print(f"❌ Error: {response.status_code} - {response.text}")
        
        # 5. Get current forecast data
        print("\n5️⃣ Current Forecast Data")
        print("-" * 20)
        
        response = await client.get(f"{BASE_URL}/forecast")
        if response.status_code == 200:
            result = response.json()
            data = result.get("data", {})
            
            print(f"✅ Status: {result.get('status')}")
            
            # Show summary of available data
            for key, value in data.items():
                if isinstance(value, list):
                    print(f"📊 {key}: {len(value)} records")
                else:
                    print(f"📊 {key}: {value}")
        else:
            print(f"❌ Error: {response.status_code} - {response.text}")

async def test_voice_integration():
    """Test voice integration with Whisper (if available)"""
    print("\n🎤 Voice Integration Test")
    print("-" * 30)
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get("http://localhost:9000/health")
            if response.status_code == 200:
                print("✅ Whisper service is running")
                print("💡 Voice integration is available")
            else:
                print("⚠️  Whisper service responded with unexpected status")
    except Exception as e:
        print(f"❌ Whisper service not available: {str(e)}")
        print("💡 Start Whisper with: docker-compose up whisper")

if __name__ == "__main__":
    print("🧠 Forecast API with LLM Integration - Example Usage")
    print("Make sure the services are running: docker-compose up")
    print()
    
    # Run the tests
    asyncio.run(test_api_endpoints())
    asyncio.run(test_voice_integration())
    
    print("\n✅ Example usage completed!")
    print("\n💡 Next steps:")
    print("  1. Start the services: docker-compose up")
    print("  2. Open the API docs: http://localhost:8000/docs")
    print("  3. Try the chat endpoint with your own requests")
    print("  4. Build a frontend to interact with the API") 