# Wiring To-Do

This document summarizes current connections between the database, backend API endpoints, and frontend usage. It highlights mismatches and unused elements for future cleanup.

## Database Tables
Key tables defined in `create_tables` include customers, units, forecast, sales, bom_definitions, bom, router_definitions, router_operations, routers (legacy), machines, labor_rates, payroll, payroll_config, forecast_results, execution_log, expense_categories, expenses, expense_allocations, loans, and loan_payments.

## Backend API Endpoints
### Data (`/data`)
- `GET /data/{table_name}` — generic table fetch used for customers, units, machines, payroll, BOM, router_definitions, router_operations, labor_rates and forecast data.

### Forecast CRUD (`/forecast`)
- `GET /forecast` — return computed forecast.
- `GET /forecast/scenarios`
- `POST /forecast/scenario`
- `POST /forecast/bulk_update`
- `GET /forecast/results`
- `POST /forecast/create`
- `POST /forecast/update`
- `DELETE /forecast/delete/{table}/{record_id}`
- `GET /forecast/bom_definitions`

### Cost (`/products`)
- `GET /products/cost-summary`
- `GET /products/materials/usage`
- `GET /products/machines/utilization`
- `GET /products/labor/utilization`
*(not referenced by current frontend)*

### Expenses (`/expenses`)
- `GET /expenses/`
- `POST /expenses/`
- `PUT /expenses/{id}`
- `DELETE /expenses/{id}`
- `GET /expenses/categories`
- `POST /expenses/categories`
- `GET /expenses/allocations`
- `GET /expenses/summary`
- `GET /expenses/report`
- `GET /expenses/forecast`

### Loans (`/loans`)
- `POST /loans/`
- `GET /loans/`
- `GET /loans/{id}/schedule`
- `GET /loans/summary`
- `GET /loans/cash-flow`
- `PUT /loans/{id}`
- `DELETE /loans/{id}`

### Payroll (`/payroll`)
- `GET/POST/PUT/DELETE /payroll/employees`
- `GET /payroll/config`
- `POST /payroll/config`
- `GET /payroll/calculations/{employee_id}`
- `GET /payroll/forecast`
- `GET /payroll/departments`
- `GET /payroll/business-units`
- `PUT /payroll/employees/{employee_id}/allocations`
- `POST /payroll/bulk-update`
- `GET /payroll/reports/summary`
*(frontend currently uses only `/data/payroll` and `/payroll/forecast`)*

### Reporting (`/reporting`)
- `GET /reporting/combined-forecast`
- `GET /reporting/financial-statements`
*(not referenced by current frontend)*

### Source Data (`/source-data`)
- `GET /source-data/sales-forecast`
- `GET /source-data/cost-breakdown`
- `GET /source-data/revenue-summary`

### Chat & Agents (`/chat`)
- `POST /chat/agents`
- `GET /chat/agents/available`
- `POST /chat/agents/clear`
- Legacy endpoints: `/chat/llm`, `/chat/agent`, `/chat/plan_execute`, `/chat/voice`, `/chat/agents/history`, `/chat/preview_sql`, `/chat/apply_sql`, `/chat/recalculate` *(unused)*.

### Database Management (`/database`)
- `GET /database/list`
- `DELETE /database/delete/{filename}`
- Additional endpoints for load_table, quality checks, logs, rollback, reset, snapshot, save, save-current, load, switch, revert-to-last-save, current *(unused by frontend)*.

## Frontend Usage Highlights
- Initial data load uses `/data` endpoints for sales, units, customers, machines, payroll, BOM, router_definitions, router_operations, labor_rates, forecast.
- Forecast operations call `/forecast/create`, `/forecast/update`, `/forecast/delete`, `/forecast/bulk_update`, and `/forecast/bom_definitions`.
- Expenses module uses `/expenses/`, `/expenses/categories`, `/expenses/summary`, `/expenses/report`, `/expenses/forecast`.
- Loans module uses `/loans/`, `/loans/summary`, `/loans/{id}/schedule`, `/loans/cash-flow`.
- Reporting uses `/source-data/sales-forecast`, `/payroll/forecast`, `/expenses/forecast`, `/loans/cash-flow`.
- Chat panel uses `/chat/agents`, `/chat/agents/available`, `/chat/agents/clear`; options for `'chat'`, `'agent'`, `'plan_execute'` point to `/chat`, `/agent`, `/plan_execute` which have no matching backend routes.
- Database modal uses `/database/list` and `/database/delete/{filename}`.

## Mismatches & Unused Components
- ChatPanel's legacy options call `/chat`, `/agent`, `/plan_execute`; backend expects `/chat/llm`, `/chat/agent`, `/chat/plan_execute`.
- Frontend still fetches `/data/routers` (legacy table) alongside new `router_definitions` and `router_operations` tables.
- Cost (`/products/*`) and Reporting (`/reporting/*`) endpoints are not referenced by frontend.
- Several database management and chat endpoints (preview SQL, apply SQL, etc.) remain unused.
- Tables not currently surfaced in frontend: `forecast_results`, `execution_log`, `expense_allocations`, `payroll_config`, legacy `routers`.

## Next Steps
- Align ChatPanel legacy service endpoints with backend paths or remove unsupported options.
- Decide whether to deprecate legacy `routers` table or expose updated router_definitions/operations consistently.
- Implement frontend features for cost summary, reporting, and database management if needed or prune unused endpoints.
- Review unused tables (`forecast_results`, `execution_log`, etc.) for relevance.
 - Add `forecast_id` to expense, payroll and other operational tables so scenarios can be modeled beyond sales.

## Potential Enhancements
- Expose a quick export endpoint for tables or snapshots so users can download data (CSV/Excel) directly from the UI.
 - Support column filters and pagination on `/data` (default returns all rows) to avoid retrieving entire tables.
- Provide aggregate/analytics endpoints that combine forecast, expense, and loan data to reduce client-side joins.

