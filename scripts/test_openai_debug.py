#!/usr/bin/env python3
"""
Debug script for OpenAI Agents Service
"""

import os
import sys

# Add the app directory to the path
sys.path.insert(0, 'app')

# Test OpenAI import
print("Testing OpenAI import...")
try:
    import openai
    from openai import OpenAI
    print("✓ OpenAI SDK imported successfully")
except ImportError as e:
    print(f"✗ Failed to import OpenAI SDK: {e}")
    openai = None
    OpenAI = None

# Test API key
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
print(f"\nAPI Key Analysis:")
print(f"Length: {len(OPENAI_API_KEY) if OPENAI_API_KEY else 0}")
print(f"Starts with 'sk-': {OPENAI_API_KEY.startswith('sk-') if OPENAI_API_KEY else False}")
print(f"Is dummy key: {OPENAI_API_KEY == 'sk-dummy-key-replace-with-real-key'}")
print(f"First 10 chars: {OPENAI_API_KEY[:10] if OPENAI_API_KEY else 'None'}...")

# Test client initialization
print(f"\nTesting client initialization...")
if OpenAI and OPENAI_API_KEY and OPENAI_API_KEY != "sk-dummy-key-replace-with-real-key":
    try:
        client = OpenAI(api_key=OPENAI_API_KEY)
        print("✓ OpenAI client initialized successfully")
        
        # Test a simple API call
        print("Testing API call...")
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": "Hello"}],
            max_tokens=10
        )
        print("✓ API call successful")
        print(f"Response: {response.choices[0].message.content}")
        
    except Exception as e:
        print(f"✗ Failed to initialize OpenAI client: {e}")
        client = None
else:
    print("✗ OpenAI client not initialized - missing requirements")
    print(f"  OpenAI available: {OpenAI is not None}")
    print(f"  API key present: {bool(OPENAI_API_KEY)}")
    print(f"  API key not dummy: {OPENAI_API_KEY != 'sk-dummy-key-replace-with-real-key'}") 