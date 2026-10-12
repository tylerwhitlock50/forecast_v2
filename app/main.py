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
from api.database_routes import router as database_router
from api.payroll_routes import router as payroll_router
from api.expense_routes import router as expense_router
from api.loan_routes import router as loan_router
from api.reporting_routes import router as reporting_router
from api.source_data_routes import router as source_data_router
from api.database_management_routes import router as database_management_router
from api.pricing_routes import router as pricing_router
from api.import_routes import router as import_router

# MCP server (AI assistants manage the model through the same API)
from mcp_server import mcp_lifespan, mount_mcp

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for FastAPI app"""
    # Startup
    initialize_database()
    # The MCP streamable-HTTP session manager must run for the life of the app
    async with mcp_lifespan():
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
        "http://localhost:3000",
        "http://localhost:3001",
        "http://forecast-frontend:3000",
        "http://frontend:3000",
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
app.include_router(database_router)
app.include_router(payroll_router)
app.include_router(expense_router)
app.include_router(loan_router)
app.include_router(reporting_router)
app.include_router(source_data_router)
app.include_router(database_management_router)
app.include_router(pricing_router)
app.include_router(import_router)

# MCP endpoint for Claude Code / Codex: http://localhost:8000/mcp
mount_mcp(app)

@app.get("/")
async def root():
    """Health check endpoint"""
    return {"message": "Forecast Model API", "status": "running"}









if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)