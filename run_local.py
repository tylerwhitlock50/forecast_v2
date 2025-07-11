#!/usr/bin/env python3
"""
Local development runner for the Forecast API
This script sets up the correct Python path and runs the application locally.
"""

import sys
import os
import subprocess

def main():
    """Run the application locally"""
    
    # Add the app directory to Python path
    app_dir = os.path.join(os.path.dirname(__file__), 'app')
    sys.path.insert(0, app_dir)
    
    print("🚀 Starting Forecast API locally...")
    print(f"📁 App directory: {app_dir}")
    print(f"🐍 Python path: {sys.path[0]}")
    print()
    
    # Change to app directory
    os.chdir(app_dir)
    
    # Run uvicorn
    cmd = [
        sys.executable, "-m", "uvicorn",
        "main:app",
        "--host", "0.0.0.0",
        "--port", "8000",
        "--reload"
    ]
    
    print(f"🔧 Running: {' '.join(cmd)}")
    print()
    
    try:
        subprocess.run(cmd, check=True)
    except KeyboardInterrupt:
        print("\n👋 Shutting down...")
    except subprocess.CalledProcessError as e:
        print(f"❌ Error running application: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main() 