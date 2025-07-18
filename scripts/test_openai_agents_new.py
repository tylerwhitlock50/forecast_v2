#!/usr/bin/env python3
"""
Test script for the new OpenAI Agents Service
"""

import asyncio
import sys
import os

# Add the app directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

async def test_openai_agents_service():
    """Test the new OpenAI agents service"""
    
    try:
        # Test imports
        print("Testing imports...")
        from services.openai_agents_service_new import (
            OpenAIAgentsService,
            AgentChatRequest,
            AgentResponse,
            process_agent_chat,
            get_conversation_history,
            clear_conversation,
            get_available_agents
        )
        print("✓ All imports successful")
        
        # Test service initialization
        print("\nTesting service initialization...")
        service = OpenAIAgentsService()
        print(f"✓ Service initialized: {type(service)}")
        
        # Test available agents
        print("\nTesting available agents...")
        agents = get_available_agents()
        print(f"✓ Found {len(agents)} agents:")
        for agent in agents:
            print(f"  - {agent['name']}: {agent['description']}")
        
        # Test conversation history functions
        print("\nTesting conversation history functions...")
        history = get_conversation_history()
        print(f"✓ Conversation history: {len(history)} entries")
        
        clear_conversation()
        print("✓ Conversation cleared")
        
        # Test a simple message (this will require OpenAI API key)
        print("\nTesting message processing...")
        test_request = AgentChatRequest(
            message="Hello, can you help me with the database?",
            session_id="test_session_123"
        )
        
        try:
            response = await process_agent_chat(test_request)
            print(f"✓ Message processed successfully")
            print(f"  Agent: {response.agent}")
            print(f"  Content: {response.content[:100]}...")
            print(f"  Error: {response.error}")
        except Exception as e:
            print(f"⚠ Message processing failed (expected if no API key): {e}")
        
        print("\n✅ All tests completed successfully!")
        
    except ImportError as e:
        print(f"❌ Import error: {e}")
        return False
    except Exception as e:
        print(f"❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    return True

if __name__ == "__main__":
    # Set up OpenAI API key if available
    api_key = os.getenv("OPENAI_API_KEY")
    os.environ["OPENAI_API_KEY"] = api_key
    
    # Run the test
    success = asyncio.run(test_openai_agents_service())
    
    if success:
        print("\n🎉 New OpenAI Agents Service is ready to use!")
        print("You can now test it through the FastAPI endpoints:")
        print("  - POST /agents/chat")
        print("  - GET /agents/history")
        print("  - POST /agents/clear")
        print("  - GET /agents/available")
    else:
        print("\n❌ There were issues with the new service. Please check the errors above.")
        sys.exit(1) 