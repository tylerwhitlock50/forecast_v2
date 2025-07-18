# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an AI-powered financial modeling and cash flow forecasting system with a FastAPI backend, React frontend, and integrated LLM services. The application provides comprehensive revenue forecasting, cost management, and financial planning capabilities.

## Common Development Commands

### Docker (Recommended)
```bash
# Start all services
docker-compose up --build

# Start specific service
docker-compose up ollama
docker-compose up fastapi
docker-compose up frontend

# View logs
docker-compose logs
docker-compose logs fastapi
docker-compose logs ollama

# Reset everything
docker-compose down -v
docker-compose up --build
```

### Local Development
```bash
# Backend setup
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r app/requirements.txt
python run_local.py

# Frontend setup
./setup_frontend.sh
cd frontend && npm start

# Run tests
python run_tests.py
python run_tests.py tests/test_specific.py  # Run specific test
pytest tests/ -v
```

### Service URLs
- React Frontend: http://localhost:3000
- FastAPI Backend: http://localhost:8000
- API Documentation: http://localhost:8000/docs
- Ollama LLM Service: http://localhost:11434
- Whisper ASR Service: http://localhost:9000

## Application Architecture

### Backend (FastAPI)
- **Entry Point**: `app/main.py` - Main FastAPI application with CORS middleware
- **Database**: SQLite with SQLAlchemy models in `app/db/models.py`
- **API Routes**: Modular structure in `app/api/` directory
  - `data_routes.py` - CRUD operations for all data tables
  - `forecast_routes.py` - Forecasting and scenario management
  - `crud_routes.py` - Generic CRUD operations
  - `cost_routes.py` - Cost management and analysis
- **Services**: Business logic in `app/services/`
  - `llm_service.py` - Ollama LLM integration for natural language to SQL
  - `agent_service.py` - LangChain agent for complex operations
  - `plan_execute_service.py` - DeepSeek planning with Llama execution
  - `whisper_service.py` - Speech-to-text transcription

### Frontend (React)
- **Entry Point**: `frontend/src/App.js` - Main application with routing
- **Context**: `frontend/src/context/ForecastContext.js` - Global state management with React Context
- **Components**: Modular structure in `frontend/src/components/`
  - `Modules/` - Feature-specific modules (Revenue, Cost, Customer, etc.)
  - `Common/` - Reusable components (EditableGrid, ValidationIndicator)
  - `Navigation/` - Navigation and scenario management
- **API Integration**: Uses Axios with proxy configuration pointing to backend

### Data Flow
1. **Frontend** sends requests to `/api/*` endpoints (proxied to backend)
2. **Backend** processes requests through route handlers
3. **Database** operations use SQLAlchemy models and raw SQL for complex queries
4. **LLM Services** integrate for natural language processing and AI assistance

### Key Data Models
- **Sales/Forecasts**: Revenue forecasting data with customer/product relationships
- **BOM**: Bill of Materials with versioning support
- **Routers**: Manufacturing routing with operations and machine assignments
- **Customers/Units**: Master data for forecasting entities
- **Machines/Labor**: Resource planning and cost allocation

## Database Schema

The application uses SQLite with the following key tables:
- `sales` - Revenue forecast data
- `customers` - Customer master data
- `units` - Product/unit definitions
- `bom` - Bill of materials with versioning
- `router_definitions` - Manufacturing routers
- `router_operations` - Router operation steps
- `machines` - Manufacturing equipment
- `payroll` - Employee and labor data
- `labor_rates` - Labor rate definitions
- `forecast` - Forecast scenario definitions

## Development Patterns

### API Response Format
All API responses follow this pattern:
```json
{
  "status": "success|error",
  "data": {},
  "message": "Description"
}
```

### Frontend State Management
- Uses React Context for global state
- Data is fetched and cached in context
- Components subscribe to context updates
- CRUD operations trigger automatic data refresh

### Testing Structure
- Tests are in `tests/` directory using pytest
- Test configuration in `pytest.ini`
- Run tests with `python run_tests.py`
- Integration tests for API endpoints and database operations

### LLM Integration
- Natural language to SQL conversion via Ollama
- LangChain agents for complex multi-step operations
- Plan & Execute pattern with different models for planning vs execution
- Human approval required for destructive SQL operations

## File Mappings

### Backend Key Files
- `app/main.py` - FastAPI application entry point
- `app/db/database.py` - Database connection and management
- `app/db/models.py` - Pydantic models for API requests/responses
- `app/services/llm_service.py` - Core LLM integration

### Frontend Key Files
- `frontend/src/App.js` - React application entry point
- `frontend/src/context/ForecastContext.js` - Global state management
- `frontend/src/components/Modules/RevenueForecasting/RevenueForecasting.js` - Main forecasting interface

### Configuration Files
- `docker-compose.yml` - Service orchestration
- `app/requirements.txt` - Python dependencies
- `frontend/package.json` - Node.js dependencies
- `pytest.ini` - Test configuration

## Data Import/Export

The application supports CSV data loading through the `/load_table` endpoint. Sample data files are in the `data/` directory and are automatically loaded on startup.

## Environment Considerations

- Development uses proxy configuration for API calls
- Production deployment uses Docker containers
- LLM services require significant RAM (4GB+ recommended)
- GPU acceleration available for Ollama service