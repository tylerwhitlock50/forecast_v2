# Forecast Model

A financial modeling and cash flow forecasting application built with FastAPI, SQLite, and React.

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
| `/reporting`    | `api/reporting_routes.py`       | Combined forecast, financial statements  |
| `/source-data`  | `api/source_data_routes.py`     | Sales / cost / revenue source data       |
| `/database`     | `api/database_routes.py`, `api/database_management_routes.py` | DB load/save/snapshot/reset |

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
- **ReportingAnalysis** — combined financial reports and scenario comparison

Global state lives in `frontend/src/context/ForecastContext.js`.

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
