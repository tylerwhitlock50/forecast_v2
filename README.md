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

The database is `data/forecast.db` on the host (`./data` is mounted at `/data`), so it survives
`docker-compose down`, `down -v` and rebuilds. See [Snapshots and starting clean](#snapshots-and-starting-clean).

### Run locally
Backend:
```bash
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS/Linux
pip install -r app/requirements.txt
python scripts/run_local.py        # http://localhost:8000, auto-reload (--port N, --no-reload)
```

`python main.py` (no reload) and `uvicorn main:app --app-dir app --reload --reload-dir app` from the
repository root start the same app. All of them use `data/forecast.db` in the repository (the same file
Docker uses) unless `DATABASE_PATH` or `DATA_DIR` is set.

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
├── data/                 # SQLite database (forecast.db) and saved_databases/ snapshots
├── scripts/              # Dev and maintenance scripts
├── tests/                # pytest suite
├── documentation/        # Schema and design docs
├── docker-compose.yml
└── main.py               # `python main.py` / `uvicorn main:app` from the repo root
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

Everything lives in one SQLite file, `data/forecast.db` (`DATABASE_PATH` / `DATA_DIR` override it).
It starts empty: the repository ships no sample data. Import BOMs, routings, products, customers and the
sales forecast through the Data Import screen, the `/import/*` endpoints, the MCP import tools or
`POST /database/load_table` (which never drops a table). The schema is created and migrated at every start.

Seed CSVs: if CSV files named after the tables (`customers.csv`, `units.csv`, `sales.csv`, `bom.csv`, ...)
are in the data folder when the database is empty, they are loaded at startup. `FORCE_DB_RELOAD=true`
reloads them over existing data on every start: the database is snapshotted first, the reload is one
transaction, and it is refused with nothing changed if it would orphan rows (for example assumptions of a
scenario that `forecast.csv` drops). Set it back to `false` afterwards.

## Snapshots and starting clean

The database runs in WAL mode, so do not copy `forecast.db` by hand while the app is running; use these
endpoints (all copies go through SQLite's backup API). Snapshots are kept in `data/saved_databases/`.

| What | How |
|------|-----|
| Snapshot before a bulk change | `POST /database/save {"name": "before-june-cut"}` (409 if the name exists; add `"overwrite": true` to replace it), or `POST /database/save-current` for a timestamped `autosave_*.db`. Sidebar "Save Database" in the UI, `forecast_save_database` over MCP |
| List snapshots | `GET /database/list` (newest first; `manual_save` / `autosave` / `system_backup`) |
| Restore a snapshot | `POST /database/load {"filename": "before-june-cut.db"}`: restores into the live database, keeps the previous state as `current_backup_<time>.db`, and upgrades an older snapshot's schema |
| Undo to the newest snapshot | `POST /database/revert-to-last-save` (any kind; the state it replaces is kept as `pre_revert_backup_<time>.db`) |
| Download a `.db` file | `GET /database/snapshot` (live database) or `GET /database/snapshot?filename=before-june-cut.db` |
| Start clean | `POST /database/start-clean {"confirm": true, "snapshot_first": true}`: snapshots (`start_clean_backup_<time>.db`), then empties every table and keeps the schema. Optional `"scenario_name": "2027 Budget"` creates an empty base scenario |
| Check | `GET /database/info` (live file, row counts), `POST /database/verify-empty` |

To start clean by hand instead: stop the app (`docker-compose down`), delete `data/forecast.db`,
`data/forecast.db-wal` and `data/forecast.db-shm`, and start it again. `docker-compose down -v` alone does
not reset anything, because `./data` is a bind mount, not a volume.

Typical workflow: start clean, import BOMs / routings / products / customers and the forecast,
`POST /database/save {"name": "after-import"}`, run the MCP bulk changes, and `POST /database/load
{"filename": "after-import.db"}` if something goes wrong.

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
- **Stale or old sample data**: `POST /database/start-clean {"confirm": true}` (snapshots first), or stop the app and delete `data/forecast.db*`. `docker-compose down -v` does not touch the database.
- **A restore looked like it did nothing**: use `POST /database/load` (or the UI's Load Database), never a file copy over `forecast.db`; check `GET /database/info` for the file the app is using.
- **Schema out of date**: the schema is migrated at every start and after every load, so a restart is enough.
- **Logs**: `docker-compose logs fastapi` or `docker-compose logs frontend`.
