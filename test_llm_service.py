#!/usr/bin/env python3
"""
Test script for the LLM service
This script tests the LLM service with sample requests to ensure it's working correctly.
"""

import asyncio
import sys
import os

# Add the app directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

from app.services.llm_service import LLMService, LLMRequest

async def test_llm_service():
    """Test the LLM service with various requests"""
    
    # Initialize the LLM service
    llm_service = LLMService()
    
    # Test cases
    test_cases = [
        {
            "message": "Increase unit prices by 10% for all sales in 2024-01",
            "description": "Test price increase for specific period"
        },
        {
            "message": "Decrease sales quantity by 20% for customer CUST-001 in 2024-02",
            "description": "Test quantity decrease for specific customer and period"
        },
        {
            "message": "Set material cost to $50 for unit PROD-001",
            "description": "Test material cost update for specific unit"
        },
        {
            "message": "Update machine rate to $200 per hour for machine MACH-001",
            "description": "Test machine rate update"
        },
        {
            "message": "Increase labor minutes by 15 minutes for all router steps for unit PROD-002",
            "description": "Test labor time increase for specific unit"
        }
    ]
    
    print("🧠 Testing LLM Service with Ollama")
    print("=" * 50)
    
    for i, test_case in enumerate(test_cases, 1):
        print(f"\n📝 Test {i}: {test_case['description']}")
        print(f"Request: {test_case['message']}")
        print("-" * 40)
        
        try:
            # Create LLM request
            request = LLMRequest(
                message=test_case['message'],
                temperature=0.1,
                max_tokens=1000
            )
            
            # Generate SQL
            response = await llm_service.generate_sql(request)
            
            # Display results
            print(f"✅ Status: {'Success' if not response.error else 'Error'}")
            print(f"🔍 Confidence: {response.confidence:.2f}")
            print(f"⚠️  Requires Approval: {response.requires_approval}")
            print(f"\n📋 Generated SQL:")
            print(f"```sql")
            print(response.sql_statement)
            print(f"```")
            
            print(f"\n💡 Explanation:")
            print(response.explanation)
            
            if response.suggested_actions:
                print(f"\n💭 Suggested Actions:")
                for action in response.suggested_actions:
                    print(f"  • {action}")
            
            if response.error:
                print(f"\n❌ Error: {response.error}")
                
        except Exception as e:
            print(f"❌ Exception: {str(e)}")
        
        print("\n" + "=" * 50)

async def test_ollama_connection():
    """Test basic connection to Ollama"""
    print("🔌 Testing Ollama Connection")
    print("=" * 30)
    
    try:
        import httpx
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get("http://localhost:11434/api/tags")
            
            if response.status_code == 200:
                models = response.json()
                print("✅ Ollama is running!")
                print(f"📦 Available models: {[model['name'] for model in models.get('models', [])]}")
            else:
                print(f"❌ Ollama responded with status {response.status_code}")
                
    except Exception as e:
        print(f"❌ Cannot connect to Ollama: {str(e)}")
        print("💡 Make sure Ollama is running: docker-compose up ollama")

if __name__ == "__main__":
    print("🚀 Starting LLM Service Tests")
    print("Make sure Ollama is running: docker-compose up ollama")
    print()
    
    # Test Ollama connection first
    asyncio.run(test_ollama_connection())
    
    print()
    
    # Test LLM service
    asyncio.run(test_llm_service())
    
    print("\n✅ Testing completed!") 