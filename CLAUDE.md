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

# Start clean (empty database, schema kept; the old data is snapshotted first)
curl -X POST http://localhost:8000/database/start-clean \
     -H 'content-type: application/json' -d '{"confirm": true, "snapshot_first": true}'
# or, with the stack stopped: delete data/forecast.db, data/forecast.db-wal and
# data/forecast.db-shm (data/saved_databases/ keeps the snapshots). Note that
# `docker-compose down -v` does NOT reset the database: ./data is a bind mount.
```

### Local Development
```bash
# Backend setup
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r app/requirements.txt
python scripts/run_local.py        # API on :8000 with auto-reload (--port N, --no-reload)
python main.py                     # same app and database, no reload
uvicorn main:app --app-dir app --reload --reload-dir app   # plain uvicorn, run from the repo root
# All three use ./data/forecast.db (the file Docker mounts at /data) unless DATABASE_PATH / DATA_DIR is set.

# Frontend setup
cd frontend && npm install && npm start

# Backend tests
pytest tests/ -v
pytest tests/test_financial_statements.py -v   # statements engine + reporting routes
pytest tests/test_mcp_server.py -v             # MCP server over JSON-RPC + bulk adjusters
pytest tests/test_data_lifecycle.py -v         # snapshots / restore / start clean / reset / start commands

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
  - `reporting_routes.py` - Financial statements, CSV export, budget-vs-actual, assumptions, capex, actuals, COGS forecast, labor forecast, sales detail, Excel workbook (`/reporting/workbook`)
  - `pricing_routes.py` - Customer / customer-type price list and sales deduction rules (terms allowance, chargebacks, other allowances, embedded excise tax, commissions): CRUD, simulate, preview, resolve, apply prices to the forecast
  - `governance_routes.py` - Change history (`/audit/log`), read-only legacy data checks (`/audit/legacy-checks`) and the middleware that records every write and turns a scenario-lock trigger error into HTTP 409 (`install_governance(app)` in `main.py`). Approve / unlock live in `forecast_routes.py`.
  - `import_routes.py` - Bulk imports with header aliases and dry runs: BOMs, routings, customers / products / machines / labor rates, prices, deduction rules; CSV templates (`/import/templates/{kind}`)
- **Services**: Business logic in `app/services/`
  - `financial_statements.py` - The statements engine. Single source of truth for the income statement, cash flow and balance sheet. Every number on the reporting screens, the payroll monthly forecast and the scenario comparison comes from here.
  - `pricing.py` - Price-list and deduction-rule resolution (most specific rule wins; see the module docstring). Used by the engine and the pricing / import routes.
  - `operations_forecast.py` - COGS forecast (gross sales -> deductions -> net sales -> COGS -> gross profit by month, product, customer, customer type) and labor forecast (hours / cost / FTE by labor type by month, machine hours vs capacity). Aggregates the engine's `load_sales_lines`, so it ties to the statements.
  - `workbook_export.py` - The Excel export (Read Me, gross margin, statements, by product / customer / customer type, labor, machines, unit costs, sales detail, rules, price list).
  - `governance.py` - Scenario approval (totals, workbook and snapshot as evidence), unlock, drift, the change history and legacy checks (see the module docstring).
  - `actuals.py` - The one pipeline for actuals: read, map, validate, duplicates, compare, controls (control total, closed months), write in one transaction; batches, undo, month-end close (see the module docstring).
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
- `price_list` - Prices by product x customer / customer type (fixed or % off base price), company-wide or per scenario
- `sales_deduction_rules` - Terms allowance, chargebacks, other allowances, excise tax and commissions by customer / customer type / product / product type, company-wide or per scenario
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
- `DatabaseManager(database_path=..., data_dir=...)` arguments always win over `DATABASE_PATH` / `DATA_DIR`, so a test that names its own database can never touch the real one; path auto-detection tests patch `os.path.isdir('/data')` so they pass both locally and inside the container
- The production build is `CI=true npm run build`; it treats ESLint warnings as errors, so keep the tree warning-free instead of disabling the plugin
- Test configuration in `pytest.ini`
- Run tests with `python run_tests.py`
- Integration tests for API endpoints and database operations

### Financial Statements Engine (`app/services/financial_statements.py`)
- Periods are `YYYY-MM`; a reporting window is inclusive on both ends.
- Opening balances in `financial_assumptions` are stated as at the END of `opening_period`; the model starts the month after. When a report window starts later, `build_statements` rolls every month in between forward (cash, working capital, capex, depreciation, debt, retained earnings) and slices the window out, so a March-only report shows the same March as a full-year report. The response carries `carry_forward` (months rolled forward) and warns with `opening_period_unset` / `window_before_opening` when it cannot roll forward. Detail breakdowns (`detail.*`) cover the window only.
- Cash flow `totals` sum the flows; `opening_cash` / `closing_cash` in `totals` are the window's balances, never sums of monthly balances. `cash_flow.reconciliation` proves opening + net cash flow = closing.
- Scenario scoping: rows with `forecast_id` in the selected set OR `NULL` are included. `NULL` means company-wide (payroll, expenses, capex). Sales are always scenario-specific. The payroll / expense list endpoints and the generic `/data/{table}` read apply the same rule, so the module screens show what the statements use.
- Scenario lifecycle (`forecast_routes.py`): `GET /forecast/scenarios` is enriched with counts and the sales window; branching (`POST /forecast/scenario/{id}/duplicate`) copies sales, scenario-specific expenses / payroll / capex, assumptions and notes in one transaction and applies price / quantity multipliers and period extension server-side; delete cascades the same tables. Exactly one scenario has `is_base = 1`. Tests: `tests/test_scenarios.py`. Workflow: `documentation/scenario_workflow_guide.md`.
- Revenue: every sales row is enriched once by `load_sales_lines` (gross = quantity x unit_price, deductions from `sales_deduction_rules`, BOM/routing cost, labor and machine minutes). The income statement's `revenue` is NET sales: gross sales - terms allowance - chargebacks - other allowances - excise tax. Commissions are an operating expense. Terms allowance, chargebacks, excise tax and commissions apply ONE rule per row (most specific match by 8 x customer + 4 x customer type + 2 x product + 1 x product type, then scenario-specific over company-wide, then later start month; a 0% rule is an exemption); other allowances are independent programs keyed by rule name (each program applies and they add up; within a program the most specific rule wins). Types stack. Embedded excise = gross x rate / (1 + rate). Creating a rule (or price) with exactly the same scope as an active one is refused with 409 naming the existing id. Prices resolve the same way (8/4/2/1 with `unit_type` = product type), then the product's base price; % off list prices round to cents.
- Payroll is prorated to each calendar month from `start_date` / `end_date`, with raises applied from `next_review_date`. Never annualize payroll in reporting code; call `payroll_by_period`. Salaried employees store their annual salary (`annual_base_pay`; values under 1,000 are read as a legacy hourly equivalent). Burden is employer cost only (`EMPLOYER_BURDEN_KEYS` + benefits); federal / state income tax rates are employee withholding.
- Labor and payroll: every employee has a `labor_class` (`direct` / `indirect` / `admin`; NULL = not classified, treated as admin and listed by the labor forecast and the legacy checks). Direct labor in COGS is the routing standard (routings x labor rates) plus `labor_variance` = pay of employees classed direct - standard, in months with direct pay (0 otherwise), so COGS direct labor equals direct payroll and nobody is counted twice. Indirect pay is `indirect_labor` in COGS (factory overhead); admin and unclassified pay is the operating expense `payroll`. `labor_lines_by_period` builds these lines; the labor forecast's `standard_vs_payroll` compares standard and paid hours (utilization) and cost. The statements accrue payroll evenly by month; `GET /payroll/statement-bridge` compares that with pay on pay dates (`pay_run_dates`) and gives the implied accrued payroll.
- Working capital uses days assumptions with `AVG_DAYS_PER_MONTH` = 365.25 / 12 (30.4375): AR = (net sales + excise) x DSO / 30.4375, inventory = product COGS x DIO / 30.4375, AP = purchases x DPO / 30.4375 where purchases = materials + factory overhead + other COGS + admin + operating expenses + commissions (payroll and direct labor are paid in the month), excise tax payable = excise x `excise_payable_days` / 30.4375.
- Cash rolls forward from `opening_cash`: net income + depreciation - working capital change (incl. excise payable) - capex + loan proceeds - principal.
- Debt rolls forward from the opening balance in the loan schedules, so the balance sheet identity holds exactly; opening equity is plugged unless supplied.
- Income tax accrues on year-to-date pre-tax income within each calendar year (a loss month reverses tax booked earlier that year); the year's tax is never negative and nothing carries across years.
- Add a new statement line by extending `build_statements` and, if actuals should be tracked for it, `VARIANCE_LINE_ITEMS`.
- Actuals (`services/actuals.py`): every write path (CSV / XLSX upload, JSON entries, MCP) is validated first and written in ONE transaction. Atomic by default: any rejected row, duplicate (same period + line + reference, unless `combine_duplicates`), control-total mismatch or a row touching a closed month (`POST /reporting/actuals/periods/{YYYY-MM}/close`, `/reopen`) means nothing is written (422, or 409 for a closed month) with the full report in `data`; `allow_partial` writes the valid rows; `dry_run` writes nothing. A blank amount is rejected, never stored as 0. Each write is an `actuals_batches` row (`ACT-xxxxxxxx`); `DELETE /reporting/actuals/batches/{id}` (`?dry_run=true` to preview) removes the rows a batch added, puts back the rows it replaced and returns the rows it overwrote (`actuals_batch_changes`) to the value of the latest earlier batch that is NOT undone (an undone batch's value never comes back; undoing a set of batches in any order gives the same rows), only for rows no later batch changed. Amounts are keyed by period + line + reference and ADDED UP: every report carries `line_totals` (each month + line's stored total before / request / after, with the rows under other references, which a warning names) and `stored_after_total` / `control_matches_after` (`control_total` still means "the file adds up to this"); `replace_lines` removes the other references of every month + line in the request in the same transaction (undo puts them back). The Budget vs Actual hand-entry form shows each line's month total (imports included) and saves only changed lines with `replace_lines`, so a typed amount sets the total and never double counts. Amounts are read in US format; a decimal comma or misplaced commas ('12.500,00', '1,23') are refused. `read_table` returns JSON-safe cells (Excel dates -> `YYYY-MM-DD`). With several candidate line-item columns ('Account' = GL number, 'Account Name') the one whose values are statement lines is used and the report says so.
- Budget vs actual (`build_variance`): a line/month with no stored actual is MISSING (`actual: null`, no variance); a stored 0 is a confirmed zero and is compared. To-date totals compare each line only over the months that line has actuals for; every line reports `coverage` (`complete` / `partial` / `none`), `periods_compared` and `missing_periods` up to `actuals_through`, and the report carries `period_coverage`, `incomplete_lines` and an `incomplete_actuals` warning.
- Loans: payment history is never rewritten. A schedule row is history when its status is paid / skipped or it carries an actual date, actual amount or note. Editing a loan's terms rebuilds only the installments after the last history row (`PUT /loans/{id}?preview=true` shows before / after first). Legacy schedules (saved with 30.44-day dates) are listed by `GET /loans/schedule-audit` and repaired only on request (`POST /loans/{id}/repair-schedule`, dry run unless `{"dry_run": false}`). The engine still books every scheduled row on its scheduled date and amount. Rebuilt / re-dated installments continue a payment period apart from where the kept history ends (`_history_anchor`: on its calendar date, or the first calendar date after it, with a warning naming the old and new payoff) and run to maturity; after recorded payments a frequency change continues one new period after the last kept one, a principal change adds the difference to the balance (422 below what is repaid), and a start date after the kept history is refused (422). Terms are whole payment periods; the last installment always clears the balance (`balloon_date` on either payment type, `balloon_payment` sizes amortizing installments, interest-only without a balloon repays at maturity); `payoff_date` is null while money is still owed. `GET /loans/cash-flow` balances roll forward like the balance sheet's debt (`loans_by_period`); inactive loans never count as affecting the statements in the audit.
- Calendars: pay runs come from `pay_run_dates` (Fridays for weekly/biweekly, 15th + month end for semimonthly, month end for monthly) and loan schedules from `add_months` (calendar months, day clamped to month end). Never use average-day increments (30.44 days, 365.25 / runs) for dates. The API sends dates as `YYYY-MM-DD` strings; the frontend parses them with `src/lib/dates.js` (`parseLocalDate`, `monthKey`) so a month-end date never shifts into the previous month in a US timezone.
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

- **Import Data screen (`/import`)** and the `/import/*` endpoints are the way in: customers, products, machines, labor rates, routings, BOMs, prices, deduction rules and the sales forecast (`/forecast/smart_import_sales`). Every import accepts common ERP header aliases, runs as a dry run first (`dry_run: true`) and reports row-level errors; CSV templates come from `GET /import/templates/{kind}`. The MCP server exposes the same imports (`forecast_import_*`).
- **Exports:** `GET /reporting/workbook` (Excel: gross margin bridge, statements, by product / customer / customer type, labor, machines, unit costs, sales detail, rules), `GET /reporting/statements/export` (CSV), and per-table CSV downloads on the COGS & Labor Forecast screen.
- `/database/load_table` (append / upsert / replace into one table) still exists for raw table loads. Seed CSVs in `data/` load only into an empty database (or with `FORCE_DB_RELOAD=true`); the repo ships none.

## Environment Considerations

- Development uses the CRA proxy (`frontend/package.json` "proxy") so the UI calls `/api/*` and reaches the backend on port 8000
- Production deployment uses Docker containers (nginx serves the built frontend and proxies `/api` to FastAPI)
- There is no authentication; the app is intended to run on a trusted network or a single machine. Docker publishes both ports on `127.0.0.1` (`FORECAST_BIND=0.0.0.0` to open them); `main.py` and `scripts/run_local.py` listen on 127.0.0.1 unless `HOST` / `--host` says otherwise.
- Approved scenarios (`services/governance.py`): `POST /forecast/scenario/{id}/approve {"approved_by", "note"}` stores the statement totals, saves the workbook to `<data>/exports/approved/` and an `approved_<id>_<ts>.db` snapshot (kind `approval_snapshot`; revert-to-last-save never picks it), then sets `locked = 1`. SQLite triggers (`migrate_governance_and_controls`) refuse every insert / update / delete of a locked scenario's rows in `LOCKED_SCENARIO_TABLES` (+ `expense_allocations` via its expense) and its deletion with `SCENARIO_LOCKED`, which the API answers as 409. Code never bypasses the lock; `clear_all_data` unlocks first. Company-wide inputs can still move a locked scenario: `drift` on `GET /forecast/scenarios` compares current with approved totals. `POST /forecast/scenario/{id}/unlock {"actor", "reason"}` (reason required) reopens it.
- Change history: the middleware writes one `audit_log` row per non-GET request (client `web` / `mcp` / `api`, actor from `X-Forecast-User` or the body, scenario, summary, short body excerpt without file contents, status; refused writes included; dry runs, previews and /simulate are left out). `audit_log` is not model data (`NON_DATA_TABLES`), survives Start clean (`KEEP_ON_CLEAR`) and is carried across a snapshot restore. The MCP server's in-process calls send `X-Forecast-Client: mcp`.
- One database file: `./data/forecast.db` locally and in Docker (`./data` is mounted at `/data`); `DATABASE_PATH` / `DATA_DIR` override it. It runs in WAL mode, so never copy or replace `forecast.db` by hand while the app runs.
- Snapshots live in `saved_databases/` next to the database and are always made with the SQLite backup API: `POST /database/save {"name", "overwrite": false}` (409 if the name is taken), `POST /database/save-current` (`autosave_<ts>.db`), `GET /database/list`, `GET /database/snapshot[?filename=]` (download a `.db`). `POST /database/load {"filename"}` and `POST /database/revert-to-last-save` (newest named save or autosave, never a system backup) restore INTO the live database, save the previous state as a `current_backup_` / `pre_revert_backup_` snapshot, then run `DatabaseManager.initialize_schema()` so an older snapshot is migrated. `POST /database/switch` repoints the one shared `db_manager` in place (never rebind it).
- Start clean: `POST /database/start-clean {"confirm": true, "snapshot_first": true, "scenario_name": null}` snapshots, then empties every table in one FK-safe transaction (schema kept). `/database/clear-data`, `/database/reset-clean` and `/database/rollback/reset` (also reloads seed CSVs) use the same routine; `/database/verify-empty` and `/database/info` report row counts of the live file.
- Seed CSVs: `data/` ships none. At startup CSVs in `DATA_DIR` load only into an empty database; `FORCE_DB_RELOAD=true` reloads them on every start (snapshot first, one FK-safe transaction, refused with nothing changed if it would orphan rows), so set it back to false afterwards. Sales rows without `sale_id` get a generated one.
- Schema changes: add the column to `create_tables` AND an idempotent `migrate_*` step called from `initialize_schema`, so databases and snapshots from older versions keep loading.