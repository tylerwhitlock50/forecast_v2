#!/usr/bin/env python3
"""
Simple test script for the plan_execute service
"""

import asyncio
import logging
import sys
import os

# Add the app directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

async def test_plan_execute():
    """Test the plan_execute service"""
    try:
        from services.plan_execute_service import plan_execute_service
        from services.agent_service import AgentRequest
        
        print("Testing plan_execute service...")
        
        # Test with a simple query
        request = AgentRequest("Who is our top customer?")
        
        print(f"Sending request: {request.message}")
        result = await plan_execute_service.run(request)
        
        print("\n=== PLAN ===")
        for i, step in enumerate(result['plan']):
            print(f"{i+1}. {step}")
        
        print("\n=== RESULTS ===")
        for i, step_result in enumerate(result['results']):
            print(f"Step {i+1}: {step_result['step']}")
            print(f"Result: {step_result['result'][:200]}...")
            print()
        
        print("Test completed successfully!")
        
    except Exception as e:
        print(f"Test failed with error: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_plan_execute()) 