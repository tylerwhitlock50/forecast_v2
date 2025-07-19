from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

# Import database functions and models
from db import (
    initialize_database,
    ForecastResponse
)

# Import API route modules
from api.data_routes import router as data_router
from api.forecast_routes import router as forecast_router
from api.crud_routes import router as crud_router
from api.cost_routes import router as cost_router
from api.chat_routes import router as chat_router
from api.database_routes import router as database_router
from api.payroll_routes import router as payroll_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for FastAPI app"""
    # Startup
    initialize_database()
    yield
    # Shutdown (if needed)

app = FastAPI(
    title="Forecast Model + AI Assistant",
    description="AI-powered financial modeling and cash flow forecasting system",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",  # Development
        "http://localhost:3001",  # Alternative dev port
        "http://forecast-frontend:3000",  # Docker container
        "http://frontend:3000",  # Alternative Docker name
        "*"  # Allow all for now - configure appropriately for production
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(data_router)
app.include_router(forecast_router)
app.include_router(crud_router)
app.include_router(cost_router)
app.include_router(chat_router)
app.include_router(database_router)
app.include_router(payroll_router)

@app.get("/")
async def root():
    """Health check endpoint"""
    return {"message": "Forecast Model + AI Assistant API", "status": "running"}

@app.get("/schema")
async def get_database_schema():
    """Get database schema information for frontend"""
    from services.llm_service import DatabaseSchema
    
    return {
        "status": "success",
        "data": {
            "tables": DatabaseSchema.TABLES,
            "schema_context": DatabaseSchema.get_schema_context()
        },
        "message": "Database schema retrieved successfully"
    }











if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)