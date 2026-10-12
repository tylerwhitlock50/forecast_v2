# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a financial modeling, budgeting and cash flow forecasting system for a manufacturing business, with a FastAPI backend, a SQLite database and a React frontend. It covers revenue forecasting by customer and product, product costing from BOMs and routings, payroll, operating expenses, loans, capital expenditures, and a period-by-period income statement, balance sheet, cash flow statement and budget-vs-actual report.

## Common Development Commands

### Docker (Recommended)
```bash
# Start all services
docker-compose up --build

# Start specific service
docker-compose up fastapi
docker-compose up frontend

# View logs
docker-compose logs
docker-compose logs fastapi

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
python scripts/run_local.py        # or: uvicorn app.main:app --reload

# Frontend setup
cd frontend && npm install && npm start

# Backend tests
pytest tests/ -v
pytest tests/test_financial_statements.py -v   # statements engine + reporting routes
pytest tests/test_mcp_server.py -v             # MCP server over JSON-RPC + bulk adjusters

# Frontend tests and production build
cd frontend && CI=true npx react-scripts test --watchAll=false
cd frontend && CI=true npm run build
```

### Service URLs
- React Frontend: http://localhost:3000
- FastAPI Backend: http://localhost:8000
- API Documentation: http://localhost:8000/docs
- MCP endpoint (Claude Code / Codex): http://localhost:8000/mcp (`claude mcp add --transport http forecast http://localhost:8000/mcp`; `.mcp.json` in the repo root does this for Claude Code automatically)

## Application Architecture

### Backend (FastAPI)
- **Entry Point**: `app/main.py` - Main FastAPI application with CORS middleware
- **Database**: SQLite accessed with raw `sqlite3` through `app/db/database.py` (`DatabaseManager`); Pydantic request/response models in `app/db/models.py`
- **API Routes**: Modular structure in `app/api/` directory, one file per domain
  - `data_routes.py` - Generic table reads
  - `forecast_routes.py` / `crud_routes.py` - Scenarios, sales forecast CRUD, bulk imports, scenario comparison
  - `cost_routes.py` / `source_data_routes.py` - Product cost rollups from BOM + routing
  - `payroll_routes.py` - Employees, payroll config (burden rates, pay frequency), payroll forecast (monthly or per pay run)
  - `expense_routes.py` - Expense categories, expenses, per-period allocations
  - `loan_routes.py` - Loans and amortization schedules
  - `reporting_routes.py` - Financial statements, CSV export, budget-vs-actual, assumptions, capex, actuals
- **Services**: Business logic in `app/services/`
  - `financial_statements.py` - The statements engine. Single source of truth for the income statement, cash flow and balance sheet. Every number on the reporting screens, the payroll monthly forecast and the scenario comparison comes from here.
  - `model_adjustments.py` - Bulk what-if adjustments (re-price / re-volume sales rows by period, customer, product; re-price BOM lines by material). Keeps `total_revenue` and `material_cost` consistent. Used by the MCP server.
- **MCP server**: `app/mcp_server/` - Model Context Protocol server mounted at `/mcp` (streamable HTTP, stateless JSON) so Claude Code / Codex can manage the model. `core.py` holds the `MCPServer` instance and an in-process ASGI client; `tools/*.py` register one tool module per domain. Tools call the REST endpoints in-process (no duplicated business logic); only the bulk adjusters and the read-only SQL tool touch the database directly. Package is named `mcp_server` so it does not shadow the SDK's `mcp` package. Guide: `documentation/mcp_server_guide.md`. Tests: `tests/test_mcp_server.py`.
- **Utilities**: `app/utils/cost_rollup.py` (per-unit material / labor / machine cost with data-quality warnings), `data_loader.py`, `period_normalizer.py`

### Frontend (React)
- **Entry Point**: `frontend/src/App.js` - Main application with routing
- **Context**: `frontend/src/context/ForecastContext.js` - Global state management with React Context
- **Components**: Modular structure in `frontend/src/components/`
  - `Modules/` - Feature-specific modules (Revenue, Cost, Customer, etc.)
  - `Common/` - Reusable components (ForecastGrid: the editable spreadsheet-style table used by the revenue matrix and expense grid; ValidationIndicator; ConfirmDialog)
  - `Modules/Scenarios/` - Scenarios page (create, branch, rename, mark base, delete) and the per-screen scope map used by the scenario bar
  - `Navigation/ScenarioBar.js` - Persistent bar above every screen: active scenario switcher and the screen's scope badge
  - `Navigation/` - Navigation and scenario management
- **API Integration**: Uses Axios with proxy configuration pointing to backend

### Data Flow
1. **Frontend** sends requests to `/api/*` endpoints (proxied to backend)
2. **Backend** processes requests through route handlers
3. **Database** operations use SQLAlchemy models and raw SQL for complex queries
4. **Reporting** calls `services/financial_statements.build_statements`, which reads sales, BOM/routing, payroll, expenses, loans, capex and assumptions and returns period-by-period statements

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
- `expense_categories`, `expenses`, `expense_allocations` - Operating expenses by period
- `loans`, `loan_payments` - Debt and amortization schedules
- `financial_assumptions` - Per-scenario opening balances, DSO/DIO/DPO days, income tax rate, minimum cash
- `capital_expenditures` - Planned asset purchases, depreciated straight-line
- `actuals` - Actual results by period and statement line, for budget vs actual

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

### Financial Statements Engine (`app/services/financial_statements.py`)
- Periods are `YYYY-MM`; a reporting window is inclusive on both ends.
- Scenario scoping: rows with `forecast_id` in the selected set OR `NULL` are included. `NULL` means company-wide (payroll, expenses, capex). Sales are always scenario-specific. The payroll / expense list endpoints and the generic `/data/{table}` read apply the same rule, so the module screens show what the statements use.
- Scenario lifecycle (`forecast_routes.py`): `GET /forecast/scenarios` is enriched with counts and the sales window; branching (`POST /forecast/scenario/{id}/duplicate`) copies sales, scenario-specific expenses / payroll / capex, assumptions and notes in one transaction and applies price / quantity multipliers and period extension server-side; delete cascades the same tables. Exactly one scenario has `is_base = 1`. Tests: `tests/test_scenarios.py`. Workflow: `documentation/scenario_workflow_guide.md`.
- Payroll is prorated to each calendar month from `start_date` / `end_date`, with raises applied from `next_review_date`. Never annualize payroll in reporting code; call `payroll_by_period`.
- Working capital uses days assumptions: AR = revenue x DSO / 30.4, inventory = product COGS x DIO / 30.4, AP = purchases x DPO / 30.4.
- Cash rolls forward from `opening_cash`: net income + depreciation - working capital change - capex + loan proceeds - principal.
- Debt rolls forward from the opening balance in the loan schedules, so the balance sheet identity holds exactly; opening equity is plugged unless supplied.
- Income tax applies only to positive pre-tax income (no loss carry-forward).
- Add a new statement line by extending `build_statements` and, if actuals should be tracked for it, `VARIANCE_LINE_ITEMS`.
- Tests for the engine live in `tests/test_financial_statements.py`; keep the balance-check and cash roll-forward tests passing when changing the maths.

## File Mappings

### Backend Key Files
- `app/main.py` - FastAPI application entry point
- `app/db/database.py` - Database connection and management
- `app/db/models.py` - Pydantic models for API requests/responses
- `app/services/financial_statements.py` - Statements engine (see above)
- `app/api/reporting_routes.py` - Reporting endpoints that wrap the engine

### Frontend Key Files
- `frontend/src/App.js` - React application entry point
- `frontend/src/context/ForecastContext.js` - Global state management
- `frontend/src/components/Modules/RevenueForecasting/RevenueForecastingNew.js` - Main forecasting interface
- `frontend/src/components/Modules/ReportingAnalysis/` - Statements, budget vs actual, assumptions and capex screens (all data comes from `/api/reporting/*`)

### Configuration Files
- `docker-compose.yml` - Service orchestration
- `app/requirements.txt` - Python dependencies
- `frontend/package.json` - Node.js dependencies
- `pytest.ini` - Test configuration

## Data Import/Export

The application supports CSV data loading through the `/load_table` endpoint. Sample data files are in the `data/` directory and are automatically loaded on startup.

## Environment Considerations

- Development uses the CRA proxy (`frontend/package.json` "proxy") so the UI calls `/api/*` and reaches the backend on port 8000
- Production deployment uses Docker containers (nginx serves the built frontend and proxies `/api` to FastAPI)
- There is no authentication; the app is intended to run on a trusted network or a single machine