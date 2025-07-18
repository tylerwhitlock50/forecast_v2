#!/usr/bin/env python3
"""
Test runner script for Forecast Model + AI Assistant
Run this script to execute all tests with proper output formatting.
"""

import subprocess
import sys
import os

def run_tests():
    """Run all tests using pytest"""
    print("🧪 Running Forecast Model + AI Assistant Tests")
    print("=" * 50)
    
    # Check if we're in the right directory
    if not os.path.exists("tests"):
        print("❌ Error: tests directory not found. Please run from the project root.")
        sys.exit(1)
    
    # Run pytest with verbose output
    cmd = [
        sys.executable, "-m", "pytest",
        "tests/",
        "-v",
        "--tb=short",
        "--color=yes"
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=False)
        
        if result.returncode == 0:
            print("\n✅ All tests passed!")
        else:
            print("\n❌ Some tests failed!")
            sys.exit(result.returncode)
            
    except KeyboardInterrupt:
        print("\n⚠️  Tests interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error running tests: {e}")
        sys.exit(1)

def run_specific_test(test_path):
    """Run a specific test file or test function"""
    print(f"🧪 Running specific test: {test_path}")
    print("=" * 50)
    
    cmd = [
        sys.executable, "-m", "pytest",
        test_path,
        "-v",
        "--tb=short",
        "--color=yes"
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=False)
        sys.exit(result.returncode)
    except KeyboardInterrupt:
        print("\n⚠️  Test interrupted by user")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        # Run specific test
        run_specific_test(sys.argv[1])
    else:
        # Run all tests
        run_tests() 