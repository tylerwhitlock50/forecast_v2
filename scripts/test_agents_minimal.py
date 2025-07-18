#!/usr/bin/env python3
"""
Minimal test for OpenAI Agents Service
"""

import asyncio
import sys
import os

# Add the app directory to the path
sys.path.insert(0, 'app')

# Import only the necessary modules
try:
    from services.openai_agents_service import openai_agents_service, process_agent_chat, AgentChatRequest
    print("✓ Successfully imported OpenAI agents service")
except Exception as e:
    print(f"✗ Failed to import OpenAI agents service: {e}")
    sys.exit(1)

async def test_agent_chat():
    """Test the agent chat functionality"""
    print("\nTesting agent chat...")
    
    # Check if client is initialized
    print(f"Client initialized: {openai_agents_service.client is not None}")
    
    if not openai_agents_service.client:
        print("Client not initialized - checking why...")
        return
    
    # Test a simple message
    request = AgentChatRequest(message="Hello, can you help me with forecasting?")
    
    try:
        response = await process_agent_chat(request)
        print(f"✓ Agent response received")
        print(f"Agent: {response.agent}")
        print(f"Content: {response.content}")
        print(f"Error: {response.error}")
    except Exception as e:
        print(f"✗ Error processing chat: {e}")

if __name__ == "__main__":
    asyncio.run(test_agent_chat()) 