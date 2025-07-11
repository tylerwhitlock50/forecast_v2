#!/usr/bin/env python3
"""
Test script to verify imports work correctly in Docker environment
"""

def test_imports():
    """Test all the imports used in main.py"""
    
    print("🧪 Testing imports in Docker environment...")
    
    try:
        # Test database imports
        print("📦 Testing database imports...")
        from db import (
            initialize_database,
            get_table_data,
            get_forecast_data,
            get_saved_forecast_results,
            execute_sql,
            get_execution_logs,
            replay_execution_logs,
            reset_to_initial_state,
            ChatRequest,
            SQLApplyRequest,
            ForecastResponse
        )
        print("✅ Database imports successful")
        
        # Test LLM service imports
        print("🤖 Testing LLM service imports...")
        from services.llm_service import llm_service, LLMRequest, DatabaseSchema
        print("✅ LLM service imports successful")
        
        # Test FastAPI imports
        print("🚀 Testing FastAPI imports...")
        from fastapi import FastAPI, HTTPException, Query
        from fastapi.middleware.cors import CORSMiddleware
        from typing import Optional, Dict, Any
        from contextlib import asynccontextmanager
        print("✅ FastAPI imports successful")
        
        # Test database manager
        print("🗄️ Testing database manager...")
        from db.database import db_manager
        print(f"✅ Database manager initialized: {db_manager.database_path}")
        
        print("\n🎉 All imports successful! The application should work correctly.")
        return True
        
    except ImportError as e:
        print(f"❌ Import error: {e}")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False

if __name__ == "__main__":
    success = test_imports()
    exit(0 if success else 1) 