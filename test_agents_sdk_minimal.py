#!/usr/bin/env python3
"""
Minimal test for OpenAI Agents SDK syntax
"""

import asyncio
import sys
import os

# Add the app directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

async def test_agents_sdk():
    """Test basic OpenAI Agents SDK functionality"""
    
    try:
        from agents import Agent, Runner
        from agents.memory import Session
        
        print("✓ OpenAI Agents SDK imported successfully")
        
        # Test basic agent creation
        print("\nTesting basic agent creation...")
        
        # Try different parameter combinations
        try:
            agent1 = Agent(
                name="Test Agent",
                instructions="You are a test agent."
            )
            print("✓ Agent created with basic parameters")
        except Exception as e:
            print(f"✗ Basic agent creation failed: {e}")
        
        try:
            agent2 = Agent(
                name="Test Agent 2",
                instructions="You are a test agent.",
                handoff_description="Test handoff"
            )
            print("✓ Agent created with handoff_description")
        except Exception as e:
            print(f"✗ Agent with handoff_description failed: {e}")
        
        try:
            agent3 = Agent(
                name="Test Agent 3",
                instructions="You are a test agent.",
                tools=[]
            )
            print("✓ Agent created with empty tools")
        except Exception as e:
            print(f"✗ Agent with tools failed: {e}")
        
        # Test runner
        print("\nTesting runner...")
        try:
            runner = Runner()
            print("✓ Runner created successfully")
            
            # Test session
            session = Session("test_session")
            print("✓ Session created successfully")
            
            # Try to run the agent
            result = await runner.run(agent1, "Hello", session=session)
            print(f"✓ Agent run successful: {result.final_output[:100]}...")
            
        except Exception as e:
            print(f"✗ Runner test failed: {e}")
        
        print("\n✅ All tests completed!")
        
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
    # Set up OpenAI API key
    api_key = os.getenv("OPENAI_API_KEY")
    os.environ["OPENAI_API_KEY"] = api_key
    
    # Run the test
    success = asyncio.run(test_agents_sdk())
    
    if not success:
        sys.exit(1) 