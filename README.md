# Forecast Model

A budgeting and cash flow forecasting application for a manufacturing business, built with FastAPI, SQLite, and React.

It forecasts revenue by customer and product, rolls product cost up from bills of materials and routings, schedules payroll, operating expenses, loans and capital purchases, and produces a period-by-period income statement, balance sheet and cash flow statement plus a budget-vs-actual report.

## Quick Start

### Prerequisites
- Docker and Docker Compose, or
- Python 3.12+ and Node.js 18+ for local development

### Run with Docker
```bash
docker-compose up --build
```

- Frontend: http://localhost:3000
- API: http://localhost:8000
- API docs: http://localhost:8000/docs

To force-reload CSV seed data over the existing database, set `FORCE_DB_RELOAD=true` in `docker-compose.yml`.

### Run locally
Backend:
```bash
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS/Linux
pip install -r app/requirements.txt
python scripts/run_local.py
```

Frontend:
```bash
cd frontend
npm install
npm start
```

## Project Structure

```
forecast_v2/
├── app/                  # FastAPI backend
│   ├── main.py           # App entry, router registration, CORS
│   ├── api/              # Route handlers (one file per domain)
│   ├── db/               # SQLAlchemy models, connection, init
│   ├── services/         # Business logic
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/             # React (CRA) frontend
│   └── src/components/Modules/   # Feature modules (see below)
├── data/                 # CSV seed data, SQLite database
├── scripts/              # Dev and maintenance scripts
├── tests/                # pytest suite
├── documentation/        # Schema and design docs
├── docker-compose.yml
└── main.py               # Re-exports app.main for `python main.py`
```

## API Endpoints

Routes are grouped by domain. See http://localhost:8000/docs for the full interactive list.

| Prefix          | Source                          | Purpose                                  |
|-----------------|---------------------------------|------------------------------------------|
| `/`             | `app/main.py`                   | Health check                             |
| `/data`         | `api/data_routes.py`            | Generic table reads                      |
| `/forecast`     | `api/forecast_routes.py`, `api/crud_routes.py` | Forecasts, scenarios, CRUD     |
| `/products`     | `api/cost_routes.py`            | Cost summaries, materials/machine/labor utilization |
| `/payroll`      | `api/payroll_routes.py`         | Employees, allocations, payroll forecast |
| `/expenses`     | `api/expense_routes.py`         | Expense categories, allocations, reports |
| `/loans`        | `api/loan_routes.py`            | Loans, amortization, cash flow           |
| `/reporting`    | `api/reporting_routes.py`       | Financial statements, CSV export, budget vs actual, assumptions, capex, actuals |
| `/source-data`  | `api/source_data_routes.py`     | Sales / cost / revenue source data       |
| `/database`     | `api/database_routes.py`, `api/database_management_routes.py` | DB load/save/snapshot/reset |
| `/mcp`          | `mcp_server/`                   | MCP server for AI assistants (Claude Code, Codex) |

## MCP Server (AI assistants)

The backend serves a [Model Context Protocol](https://modelcontextprotocol.io) endpoint at
`http://localhost:8000/mcp`. Connect Claude Code or Codex to it and ask for model changes in
plain language ("cut the ASP 35% in June, August and September", "steel goes up 12%"); the
assistant reads and updates the model through the same API the UI uses, and you refresh the
page to see the result.

```bash
claude mcp add --transport http forecast http://localhost:8000/mcp   # Claude Code
codex mcp add forecast --url http://localhost:8000/mcp               # Codex
```

Opening this repository in Claude Code picks the server up from `.mcp.json` automatically.
Setup, the tool catalog and the planning workflow are in `documentation/mcp_server_guide.md`.

## Frontend Modules

Located in `frontend/src/components/Modules/`:

- **RevenueForecasting** — scenario-based revenue forecasting matrix
- **CostManagement** — product cost rollups, materials/machine/labor utilization
- **BOMManagement** — bill of materials with versioning
- **RouterManagement** — manufacturing router definitions and operations
- **MachineManagement** — equipment master data
- **LaborRateManagement** — labor rate definitions
- **PayrollManagement** — employees, business unit allocations, payroll forecast
- **ExpenseManagement** — recurring and one-time expenses
- **LoanManagement** — loans and amortization schedules
- **CustomerManagement** — customer master data
- **ProductManagement** — product/unit master data
- **ReportingAnalysis** — income statement, balance sheet, cash flow, budget vs actual, assumptions and capex, scenario comparison

Global state lives in `frontend/src/context/ForecastContext.js`.

## Reporting Engine

All statements are built server-side by `app/services/financial_statements.py` from the data in the other modules:

| Statement line | Source |
|----------------|--------|
| Revenue, units | `sales` for the selected scenario(s) |
| Materials, direct labor, machine cost | BOM and routing attached to each product (`utils/cost_rollup.py`) |
| Factory overhead, admin, operating expenses | `expense_allocations` by period (`category_type` decides the bucket) |
| Payroll | `payroll` prorated to each month, burdened with `payroll_config` rates |
| Depreciation, capex | `capital_expenditures` (straight-line) plus opening fixed assets |
| Interest, principal, loan proceeds | `loan_payments` schedules |
| Income tax, working capital, opening balances | `financial_assumptions` per scenario (DSO / DIO / DPO days, tax rate, opening cash, AR, inventory, AP, fixed assets) |

The Reporting screen's Assumptions tab edits the assumptions and capex; the Budget vs Actual tab records actuals by period and line (manual entry or CSV with columns `period, line_item, amount`). Statements can be downloaded as CSV.

## Data

Sample CSVs in `data/` are loaded into SQLite (`data/forecast.db`) on startup. The schema is preserved on subsequent boots; set `FORCE_DB_RELOAD=true` to overwrite from CSV.

## Testing

```bash
pytest -v
pytest -m unit
pytest -m "not slow"
```

Test config is in `pytest.ini`. Markers: `unit`, `integration`, `slow`.

## Docker Services

| Service    | Port | Purpose                |
|------------|------|------------------------|
| `fastapi`  | 8000 | API backend            |
| `frontend` | 3000 | React UI               |

## Troubleshooting

- **Port conflicts**: ensure 3000 and 8000 are free.
- **Stale data**: `docker-compose down -v && docker-compose up --build`.
- **Schema out of sync after CSV change**: set `FORCE_DB_RELOAD=true` and restart.
- **Logs**: `docker-compose logs fastapi` or `docker-compose logs frontend`.
