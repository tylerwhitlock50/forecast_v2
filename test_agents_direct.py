#!/usr/bin/env python3
"""
Direct test for OpenAI Agents Service - bypassing __init__.py
"""

import asyncio
import sys
import os

# Add the app directory to the path
sys.path.insert(0, 'app')

# Import the module directly
try:
    import services.openai_agents_service as agents_module
    print("✓ Successfully imported OpenAI agents service module")
except Exception as e:
    print(f"✗ Failed to import OpenAI agents service module: {e}")
    sys.exit(1)

async def test_agent_chat():
    """Test the agent chat functionality"""
    print("\nTesting agent chat...")
    
    # Check if client is initialized
    print(f"Client initialized: {agents_module.openai_agents_service.client is not None}")
    
    if not agents_module.openai_agents_service.client:
        print("Client not initialized - checking why...")
        return
    
    # Test a simple message
    request = agents_module.AgentChatRequest(message="Hello, can you help me with forecasting?")
    
    try:
        response = await agents_module.process_agent_chat(request)
        print(f"✓ Agent response received")
        print(f"Agent: {response.agent}")
        print(f"Content: {response.content}")
        print(f"Error: {response.error}")
    except Exception as e:
        print(f"✗ Error processing chat: {e}")

if __name__ == "__main__":
    asyncio.run(test_agent_chat()) 