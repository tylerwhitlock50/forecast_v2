# MCP server: managing the model from Claude Code or Codex

The backend exposes a [Model Context Protocol](https://modelcontextprotocol.io) server at
`http://localhost:8000/mcp`. Any MCP client (Claude Code, Codex, Claude Desktop, Cursor, ...)
can connect to it and read or change the model: scenarios, the sales forecast, BOMs and
routings, payroll, expenses, loans, capex, assumptions, actuals, snapshots, and the
financial statements. Every write goes through the same API the React UI uses, so after the
assistant makes a change you refresh the page and see it.

Typical requests it can carry out end to end:

* "In June, August and September we are running big discounts. Reduce the ASP by 35% in those
  months and show me the effect on cash." → `forecast_adjust_sales` with
  `periods=[2026-06, 2026-08, 2026-09]`, `price_multiplier=0.65`, then
  `forecast_financial_statements`.
* "Steel is going up 12% from August." → branch the base scenario, then
  `forecast_adjust_material_costs` with `material_contains="steel"`, `price_multiplier=1.12`
  in the branch, then `forecast_compare_scenarios` (see *Time-phased costs* below).
* "Add a second-shift operator from October and a $45k CNC purchase in November." →
  `forecast_create_employee`, `forecast_create_capex`.

## 1. Start the backend

The MCP endpoint is part of the FastAPI process, nothing extra to run:

```bash
docker-compose up --build          # API on http://localhost:8000, MCP at /mcp
# or locally
python scripts/run_local.py
```

Check it answers (the `Accept` header is required by the protocol):

```bash
curl -s http://localhost:8000/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | head -c 400
```

## 2. Connect a client

### Claude Code

The repository ships a project-level `.mcp.json`, so opening the repo in Claude Code offers
the `forecast` server automatically. To add it anywhere else:

```bash
claude mcp add --transport http forecast http://localhost:8000/mcp
claude mcp list        # should show forecast: connected
```

Then just talk to it: *"Use the forecast tools to cut the ASP 35% in June, August and
September in scenario F001 and tell me what happens to closing cash."*

### Codex (OpenAI)

```bash
codex mcp add forecast --url http://localhost:8000/mcp
```

or in `~/.codex/config.toml`:

```toml
[mcp_servers.forecast]
url = "http://localhost:8000/mcp"
```

### Other clients / stdio

Any client that speaks streamable HTTP can use the URL above. For a client that only supports
stdio servers, run the server in-process against the same database the web app uses:

```json
{
  "mcpServers": {
    "forecast": {
      "command": "python",
      "args": ["scripts/run_mcp_stdio.py"],
      "env": { "DATABASE_PATH": "./data/forecast.db" }
    }
  }
}
```

Prefer HTTP when the app runs in Docker: the database lives in the container's `/data` volume.

### Reaching the server from another machine

DNS-rebinding protection only accepts `Host: localhost` / `127.0.0.1`. To connect by LAN
address, allow it explicitly when starting the API:

```bash
MCP_ALLOWED_HOSTS="192.168.1.20:*" docker-compose up
```

There is no authentication, same as the rest of the API: run it on a trusted network only.

## 3. How the assistant works with the model

The server's instructions (sent on connect) tell the assistant to:

1. Start with `forecast_get_overview`: scenarios, the base scenario, the sales window, and the
   conventions (periods are `YYYY-MM`; sales belong to exactly one scenario; payroll, expenses
   and capex rows with `forecast_id` NULL are company-wide).
2. Optionally `forecast_branch_scenario` so the change can be compared against the original.
3. Preview bulk changes with `dry_run=true`, then apply.
4. Show the effect with `forecast_financial_statements` (use `sections` to keep responses
   small) or `forecast_compare_scenarios`.
5. Take a `forecast_save_database` snapshot before sweeping changes. Snapshots appear on the
   Database screen, where you can restore them, and `forecast_revert_to_last_save` undoes to
   the latest autosave.

Every tool carries MCP annotations (`readOnlyHint`, `destructiveHint`), so clients that ask
before destructive calls will prompt for deletes and snapshot restores.

## 4. Tool catalog

All tools are prefixed `forecast_`. Reads return the same data the UI screens show; writes
return the API's confirmation.

| Area | Tools |
|------|-------|
| Orientation | `get_overview`, `list_tables`, `query_table`, `sql_query` (read-only SELECT) |
| Scenarios | `list_scenarios`, `get_scenario`, `create_scenario`, `update_scenario` (rename, notes, mark base), `branch_scenario` (copy with multipliers / period extension), `delete_scenario`, `compare_scenarios` |
| Sales forecast | `list_sales`, `upsert_sales`, `delete_sale`, `import_sales`, `revenue_summary`, **`adjust_sales`** (bulk price / volume change by months, customers, products) |
| Master data | `create_record`, `update_record`, `delete_record` (customers, units, bom, bom_definitions, router_definitions, router_operations, machines, labor_rates, expense_categories, ...), `import_customers`, `import_products` |
| Costing | `product_cost_summary`, `unit_cost_preview`, `cost_breakdown`, `materials_usage`, `machine_utilization`, `labor_utilization`, `list_bom`, **`adjust_material_costs`** (bulk BOM repricing by material name) |
| Payroll | `list_employees`, `get_employee`, `create_employee`, `update_employee`, `delete_employee`, `get_payroll_config`, `update_payroll_config`, `payroll_forecast`, `payroll_summary` |
| Expenses | `list_expense_categories`, `create_expense_category`, `list_expenses`, `create_expense`, `update_expense`, `delete_expense`, `expense_forecast`, `expense_summary` |
| Loans | `list_loans`, `create_loan`, `update_loan`, `delete_loan`, `loan_schedule`, `loan_summary`, `loan_cash_flow` |
| Reporting | `financial_statements`, `variance`, `actual_line_items`, `list_actuals`, `upsert_actuals`, `delete_actuals`, `get_assumptions`, `update_assumptions`, `list_capex`, `create_capex`, `update_capex`, `delete_capex` |
| Safety | `save_database`, `list_saved_databases`, `load_database`, `revert_to_last_save`, `data_quality` |

### The two bulk adjusters

`forecast_adjust_sales(forecast_id, periods | start_period+end_period, customer_ids, unit_ids,
price_multiplier | price_delta | price, quantity_multiplier | quantity_delta | quantity, dry_run)`
re-prices and/or re-volumes the matching sales rows of one scenario and recomputes
`total_revenue`. The result lists before / after revenue and quantity plus a preview of the
changed rows.

`forecast_adjust_material_costs(material_contains, bom_ids, bom_version,
price_multiplier | price_delta | unit_price, dry_run)` re-prices matching BOM lines, keeps
`material_cost = qty x unit_price`, and reports the per-unit material cost change for every
product that uses the touched BOMs.

Both live in `app/services/model_adjustments.py` and are covered by `tests/test_mcp_server.py`.

### Time-phased costs

BOM prices are not dated in this model: a BOM line has one `unit_price`, used for every
period. "Steel goes up 12% in August" therefore cannot be expressed as a single edit to the
base scenario. Two ways to model it today:

* **Branch for the horizon.** Branch the base scenario, apply the material change in the
  branch, and compare: the branch answers "what does the year look like if steel is 12% more
  expensive", which is usually the planning question.
* **Switch BOM versions.** Create version `2.0` of the affected BOMs with the new prices and
  point the products at it from the month the change lands (edit `units.bom_version` when
  that month arrives, or keep a scenario per BOM version).

A dated material price adjustment inside the statements engine (effective-from period per
BOM line, applied in `revenue_and_cogs_by_period`) would make this a one-step change; it is
a contained follow-up in `app/services/financial_statements.py`.

## 5. Implementation notes

* Code: `app/mcp_server/` (`core.py` holds the server and the in-process API client; one
  module per domain under `tools/`). Mounted from `app/main.py` by `mount_mcp(app)`; the app
  lifespan runs `mcp_lifespan()`.
* Transport: streamable HTTP, stateless, JSON responses (no SSE needed). `/mcp` and `/mcp/`
  both work. Stdio via `scripts/run_mcp_stdio.py`.
* Tools call the REST endpoints in-process through an ASGI transport, so they cannot drift
  from what the UI does. The exceptions are the bulk adjusters and the read-only SQL tool,
  which use the database directly.
* Dependency: `mcp==1.30.0` (pinned in `app/requirements.txt`). The package is named
  `mcp_server` so it does not shadow the SDK's `mcp` package on the `app/` path.
* Tests: `pytest tests/test_mcp_server.py -v` drives the real app over JSON-RPC against a
  seeded temporary database.
