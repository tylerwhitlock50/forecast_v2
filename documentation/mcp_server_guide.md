# MCP server: managing the model from Claude Code or Codex

The backend exposes a [Model Context Protocol](https://modelcontextprotocol.io) server at
`http://localhost:8000/mcp`. Any MCP client (Claude Code, Codex, Claude Desktop, Cursor, ...)
can connect to it and build, read or change the model: customers, products, machines, labor
rates, routings and BOMs (bulk imports from your CSV / Excel files), the price list and sales
deductions (terms, chargebacks, allowances, excise tax, commissions), scenarios, the sales
forecast, payroll, expenses, loans, capex, assumptions, actuals, snapshots, the COGS and labor
forecasts, the financial statements and an Excel export. Every write goes through the same API
the React UI uses, so after the assistant makes a change you refresh the page and see it.

Typical requests it can carry out end to end:

* "Build the 2027 budget from the files in `./data/imports`." → the setup order in
  [section 4](#4-build-a-2027-budget-from-your-files): customers, products, machines, labor
  rates, routings, BOMs, prices, deduction rules, the sales forecast, then the COGS / labor
  forecast and `forecast_export_workbook`.
* "In June, August and September we are running big discounts. Reduce the ASP by 35% in those
  months and show me the effect on cash." → `forecast_adjust_sales` with
  `periods=[2026-06, 2026-08, 2026-09]`, `price_multiplier=0.65`, then
  `forecast_financial_statements`.
* "Steel is going up 12%." → `forecast_save_database`, `forecast_financial_statements` for the
  baseline, then `forecast_adjust_material_costs` with `material_contains="steel"`,
  `price_multiplier=1.12`, then the statements again for the delta. A rise that starts in a
  given month is not something the model can express yet (see *Material costs* below).
* "Add a second-shift operator from October and a $45k CNC purchase in November." →
  `forecast_create_employee`, `forecast_create_capex`.
* "Dealers get 2% terms, FET is 11% embedded in the price, government sales are exempt. What
  does a $1,110 dealer invoice net?" → `forecast_upsert_deduction_rules`, then
  `forecast_simulate_deductions` (FET $110, terms $22.20, net $977.80 before other rules).

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

The Docker frontend (nginx) also proxies the endpoint, so `http://localhost:3000/mcp` works
as well as `http://localhost:8000/mcp`. When Claude Code itself runs inside a container (for
example a dev container) and reaches the host as `host.docker.internal`, allow that host:
`MCP_ALLOWED_HOSTS="host.docker.internal:*"` (see `docker-compose.yml`).

There is no authentication, same as the rest of the API: run it on a trusted network only.

### Response size and argument checks

* Every tool returns one compact JSON block. Tables (`forecast_list_sales`,
  `forecast_query_table`, `forecast_sql_query`, statement months) come as
  `{columns, rows}`; pass `layout="records"` for one object per row.
* A result larger than `MCP_MAX_RESPONSE_CHARS` (default 60,000 characters) is returned as an
  error that says how to narrow the request (a shorter window, `group_by`, `limit`, fewer
  sections) instead of flooding the conversation.
* Unknown or misspelled arguments are rejected with the list of valid ones, so a guessed
  filter can never silently widen a change. `forecast_adjust_sales` refuses to run without a
  filter unless `all_rows=true`.
* `forecast_import_sales` takes rows or a `file_path` (one row per month, or one column per
  month with `year=`), runs all-or-nothing, and does **not** create unknown customers or
  products unless `auto_create=true` (so a typo cannot add junk master data). Missing prices
  are filled from the price list, then the product's base price.

### Files: where the server reads imports and writes exports

The import tools can read a CSV / XLSX file themselves (`file_path`), and
`forecast_export_workbook` saves an Excel file. Both use the API's **data folder**:

| How the API runs | Data folder seen by the API | Same folder on your machine |
|---|---|---|
| `docker-compose up` | `/data` (a volume) | `./data` next to `docker-compose.yml` |
| `python scripts/run_local.py` | `./data` (or `DATA_DIR`) | the same folder |

* Put input files in `./data` (for example `./data/imports/boms_2027.xlsx`) and refer to them
  relative to the data folder: `file_path="imports/boms_2027.xlsx"` (a leading `data/` or
  `./data/` is accepted too). A relative path may not leave the data folder.
* An absolute path (`/home/me/Downloads/boms.xlsx`) works only when the API process can read
  it, i.e. a local, non-Docker run. Inside Docker the container cannot see your Downloads
  folder: copy the file into `./data` first.
* Exports land in `<data folder>/exports/`. In Docker the tool result carries
  `host_path_hint: "./data/exports/<file>.xlsx"`, which is where you open it on the host.
* Supported: `.csv` / `.tsv` / `.txt` (delimiter sniffed, UTF-8 or Windows-1252) and
  `.xlsx` / `.xlsm` (first or named sheet; cached formula values; Excel dates become
  `YYYY-MM-DD`, date headers `YYYY-MM`, so one-column-per-month sheets keep their months).
  The header row is the first row with two or more filled cells, or `header_row=N`.
  Save `.xls` files as `.xlsx` first.
* Alternatively the assistant reads the file itself and passes the rows as JSON objects
  (`rows=[{...}, ...]`); the result is the same.

## 3. How the assistant works with the model

The server's instructions (sent on connect, under 4,000 characters) tell the assistant to:

1. Start with `forecast_get_overview`: scenarios, the base scenario, the sales window, and the
   conventions (periods are `YYYY-MM`; sales belong to exactly one scenario; prices, deduction
   rules, payroll, expenses and capex rows with `forecast_id` NULL are company-wide; products,
   BOMs, routings, machines and labor rates are always company-wide).
2. When building a model, follow the setup order in section 4.
3. Optionally `forecast_branch_scenario` so a change can be compared against the original.
4. Run every tool that has a `dry_run` parameter (imports, `forecast_import_sales`,
   `forecast_apply_price_list`, the bulk adjusters) with `dry_run=true` first and show you the
   counts and errors, then apply.
5. Show the effect with `forecast_cogs_forecast`, `forecast_labor_forecast`,
   `forecast_financial_statements` (use `sections`) or `forecast_compare_scenarios`.
6. Take a `forecast_save_database` snapshot before sweeping changes (a `replace` import
   deletes the BOM lines, routing operations or rules it replaces). Snapshots appear on the
   Database screen, where you can restore them, and `forecast_revert_to_last_save` undoes to
   the latest autosave.

Every tool carries MCP annotations (`readOnlyHint`, `destructiveHint`), so clients that ask
before destructive calls will prompt for deletes, `replace`-mode imports and snapshot restores.

Responses are kept small for the assistant's context: one compact JSON text block per call,
summaries by default and detail behind flags (`group_by`, `include_periods`, `top_n`, `limit`,
`detail`, `sections`). Tables come as `{columns, rows}`; per-month series as arrays aligned
with `periods`. Unknown or misspelled arguments are rejected with the list of valid ones (a
guessed filter never silently widens a write to the whole scenario).

## 4. Build a 2027 budget from your files

Tomorrow's workflow, one prompt per step. Put the files in `./data/imports/` first (see
*Files* above) or let the assistant read them and pass the rows.

| Step | What you say | What the assistant calls |
|---|---|---|
| 0 | "Snapshot the database as before-2027-build, then show me what's in ./data/imports." | `forecast_save_database`, `forecast_preview_file` (folder listing; then each file: header row, columns, first rows, the template it matches) |
| 1 | "Create a base scenario 'Budget 2027'." | `forecast_create_scenario(is_base=true)` |
| 2 | "Import customers.xlsx. customer_type is the Channel column." | `forecast_import_records(table="customers", file_path=..., dry_run=true)`, then without `dry_run` |
| 3 | "Import products.csv with list prices and product types." | `forecast_import_records(table="units", ...)` (`base_price` = MSRP alias, `unit_type` Rifle / Pistol) |
| 4 | "Load machines and labor rates." | `forecast_import_records(table="machines")`, `(table="labor_rates")` |
| 5 | "Import routings.csv." | `forecast_import_routings` (unknown machines / labor types are errors unless `auto_create=true`; result shows labor and machine minutes and cost per unit) |
| 6 | "Import the BOM export." | `forecast_import_boms` (`replace` per BOM + version; a product column links products; result shows material cost per unit) |
| 7 | "Dealers pay 80% of list, distributors 70%, Big Sky has a contract price of $1,049 on RFL-308 for 2027." | `forecast_import_prices` / `forecast_upsert_prices`, check with `forecast_resolve_price` |
| 8 | "Terms 2% for dealers, 1% chargebacks on everything, FET 11% embedded (10% on pistols), government exempt, 3% commission to distributor reps." | `forecast_upsert_deduction_rules`, then `forecast_simulate_deductions` for a sample invoice |
| 9 | "Import the Jan-Dec 2027 forecast; prices come from the price list." | `forecast_import_sales(forecast_id, rows, dry_run=true)` (price sources counted per row), then for real |
| 10 | "Anything missing?" | warnings from the steps above, `forecast_data_quality`, `forecast_cogs_forecast(group_by="unit_costs")` (missing BOM / routing / rate = understated COGS), `forecast_deduction_preview` (rules that apply to nothing) |
| 11 | "Show me gross to net to gross margin by month, then by customer type." | `forecast_cogs_forecast` (summary), `forecast_cogs_forecast(group_by="customer_type")` |
| 12 | "Labor hours and FTEs by labor type by month; are machines over capacity?" | `forecast_labor_forecast` |
| 13 | "Show the 2027 income statement and cash." | `forecast_financial_statements(sections=["income_statement", "cash_flow"])` |
| 14 | "Export it to Excel." | `forecast_export_workbook` → `./data/exports/forecast_F001_2027-01_2027-12.xlsx` |

Column names are matched ignoring case, spaces and punctuation, plus aliases ("Qty Per",
"Std Cost", "Work Center", "MSRP", "Channel", ...); `forecast_list_import_templates` lists each
template's columns, aliases and an example CSV. Rows with errors are reported by 1-based data
row; a BOM or routing with any bad row is skipped as a whole so it is never half-replaced.

Sales periods: `2027-01`, `2027-1`, `2027/01`, `1/2027`, `1/15/2027`, `Jan-27`, `Jan 2027`,
`January 2027`, Excel dates, or one column per month. Quarters and weeks are rejected (the
model is monthly).

### Gross to net: prices and deductions

* **Price of a sales row**: the row's own price, else the most specific price-list rule:
  customer + product > customer (all products) > customer type + product > customer type (all
  products) > product (all customers) > the product's `base_price`. Discount rules take a
  fraction off `base_price` (`discount_pct=0.20` = 20% off).
* **Net sales** = gross sales (quantity x price) - terms allowance - chargebacks - other
  allowances - excise tax. The income statement's `revenue` is net sales; commissions are a
  selling expense below gross profit.
* **Rates are fractions**: 2% = `0.02` (the import tools also accept `"2%"` or `2`).
  Methods: `percent_of_gross`; `embedded_tax` = gross x rate / (1 + rate), so federal excise
  tax included in the price at 11% is `deduction_type="excise_tax", method="embedded_tax",
  rate=0.11` and a $1,110 invoice carries $110 of FET; `percent_of_net` (after the
  contra-revenue deductions, e.g. commission on net); `per_unit` (`amount_per_unit`).
* **Precedence**: exactly one rule per deduction type applies to a sale, the most specific
  match (customer 8 + customer type 4 + product 2 + product type 1; ties: scenario-specific
  beats company-wide, then the later start). Types stack. A rule with rate 0 is an exemption
  ("Government exempt from FET" overrides "FET 11%" and "FET 10% pistols").
* `forecast_simulate_deductions` shows the winning rule per type, the overridden ones and the
  arithmetic for one invoice; `forecast_deduction_preview` shows what the rules do to a whole
  scenario (by type, by customer type, by month, per rule, unused rules).

## 5. Tool catalog

All tools are prefixed `forecast_`. Reads return the same data the UI screens show; writes
return the API's confirmation.

| Area | Tools |
|------|-------|
| Orientation | `get_overview`, `list_tables`, `query_table`, `sql_query` (read-only SELECT) |
| Build / import | `list_import_templates` (columns, aliases, example CSV), `preview_file` (a file's sheets, header, first rows, matching template; or a folder listing), `import_records` (customers, units / products, machines, labor_rates), `import_routings`, `import_boms`, `import_prices`, `import_deductions` (rows or `file_path`, `dry_run`, `mode`) |
| Prices & deductions | `list_prices`, `upsert_prices`, `delete_price`, `resolve_price`, **`apply_price_list`** (re-price a scenario's sales rows, `dry_run`), `list_deduction_rules`, `upsert_deduction_rules` (create without `rule_id`, partial update with it), `delete_deduction_rule`, `simulate_deductions`, `deduction_preview` |
| Operating forecasts | **`cogs_forecast`** (`group_by` summary / product / customer / customer_type / product_type / unit_costs, `include_periods`, `top_n`), **`labor_forecast`** (hours / cost / FTE by labor type by month, machine hours vs capacity, `hours_per_fte`, `include_machines`, `include_products`), `sales_detail` (every line, paged, `columns`, filters), **`export_workbook`** (Excel into `<data folder>/exports/`) |
| Scenarios | `list_scenarios`, `get_scenario`, `create_scenario`, `update_scenario` (rename, notes, mark base), `branch_scenario` (copy with multipliers / period extension), `delete_scenario`, `compare_scenarios` |
| Sales forecast | `list_sales`, `upsert_sales`, `delete_sale`, `import_sales` (price optional: resolved from the price list; `dry_run`, `year`), `revenue_summary`, **`adjust_sales`** (bulk price / volume change by months, customers, products) |
| Master data | `create_record`, `update_record`, `delete_record` (customers, units, bom, bom_definitions, router_definitions, router_operations, machines, labor_rates, expense_categories, ...), `import_customers`, `import_products` |
| Costing | `product_cost_summary`, `unit_cost_preview`, `cost_breakdown`, `materials_usage`, `machine_utilization`, `labor_utilization`, `list_bom`, **`adjust_material_costs`** (bulk BOM repricing by material name) |
| Payroll | `list_employees`, `get_employee`, `create_employee`, `update_employee`, `delete_employee`, `get_payroll_config`, `update_payroll_config`, `payroll_forecast`, `payroll_summary` |
| Expenses | `list_expense_categories`, `create_expense_category`, `list_expenses`, `create_expense`, `update_expense`, `delete_expense`, `expense_forecast`, `expense_summary` |
| Loans | `list_loans`, `create_loan`, `update_loan`, `delete_loan`, `loan_schedule`, `loan_summary`, `loan_cash_flow` |
| Reporting | `financial_statements`, `variance`, `actual_line_items`, `list_actuals`, `upsert_actuals`, `delete_actuals`, `get_assumptions`, `update_assumptions`, `list_capex`, `create_capex`, `update_capex`, `delete_capex` |
| Safety | `save_database`, `list_saved_databases`, `load_database`, `revert_to_last_save`, `data_quality` |

### Reports at a glance

* `forecast_cogs_forecast(forecast_ids, start_period?, end_period?)`: the window defaults to the
  scenarios' sales window. Always returns `totals` (gross sales, each deduction, net sales,
  materials / labor / machine, product COGS, overhead, total COGS, gross profit, margins;
  `*_pct` fields are percentages) and the warnings. `group_by="summary"` adds the monthly
  bridge as a `{columns, rows}` table that ties to the income statement; the dimension
  groups show contribution margin before factory overhead, largest first, `top_n` of them
  with the rest summed in `others`.
* `forecast_labor_forecast`: `periods` plus arrays per labor type (`hours`, `cost`, `fte`),
  per machine (`hours`, `utilization_pct`, `over_capacity_periods`). Labor cost equals the
  income statement's direct labor; `payroll_note` warns when production workers are also in
  payroll (counted twice).
* `forecast_sales_detail`: 50 rows per page by default; `totals` cover every matching row.
* `forecast_export_workbook`: sheets Read Me, Gross Margin, Income Statement, By Product, By
  Customer, By Customer Type, Labor Forecast, Machine Hours, Unit Costs, Sales Detail,
  Deduction Rules, Price List, Cash Flow, Balance Sheet. The web UI's "Export Excel workbook"
  button produces the same file (`GET /reporting/workbook`).

Measured on a 12-month, 500-row forecast (7 customers x 6 products): COGS summary 3 KB, by
customer 2 KB (7 KB with monthly arrays), labor forecast 4 KB, a 50-row sales-detail page
4 KB, deduction preview 2.5 KB, all import results under 2 KB.

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

### Material costs are company-wide

BOMs, products, routings and machines are master data shared by every scenario: a BOM line has
one `unit_price`, used for every scenario and every period. Two consequences for the assistant:

* **Branching does not isolate a material change.** `forecast_branch_scenario` copies sales,
  scenario-specific expenses / payroll / capex and assumptions, not BOMs. A
  `forecast_adjust_material_costs` call changes the base scenario and every branch at once, so
  comparing scenarios cannot show its effect. To see the effect, run the statements before and
  after (the tool also reports the per-unit material cost change per product). To be able to
  undo it, `forecast_save_database` first.
* **"Steel goes up 12% in August" cannot be expressed as one edit.** The nearest the model
  gets today is a BOM version switch: create version `2.0` of the affected BOMs with the new
  prices and point the products at it (`units.bom_version`) when that month arrives. That is
  still a company-wide change.

A dated, scenario-scoped material price adjustment inside the statements engine
(effective-from period per BOM line, applied in `revenue_and_cogs_by_period`) would make both
cases a one-step change; it is a contained follow-up in `app/services/financial_statements.py`.

## 6. Implementation notes

* Code: `app/mcp_server/` (`core.py` holds the server, its instructions and the in-process API
  client; one module per domain under `tools/`: the build workflow lives in `imports.py`
  (bulk imports, templates, file preview / parsing), `pricing.py` (price list and deduction
  rules) and `forecasts.py` (COGS / labor forecasts, sales detail, workbook export), with shared
  output helpers in `_common.py`). Mounted from `app/main.py` by `mount_mcp(app)`; the app
  lifespan runs `mcp_lifespan()`.
* Transport: streamable HTTP, stateless, JSON responses (no SSE needed). `/mcp` and `/mcp/`
  both work. Stdio via `scripts/run_mcp_stdio.py`.
* Tools call the REST endpoints in-process through an ASGI transport, so they cannot drift
  from what the UI does. The exceptions are the bulk adjusters and the read-only SQL tool,
  which use the database directly, and `forecast_export_workbook`, which calls
  `services.workbook_export.write_workbook` (the REST endpoint streams the same workbook to a
  browser; the tool saves it under `<data folder>/exports/`). Import tools given a `file_path`
  parse the file (csv module / openpyxl) and send the rows to the same `/import/*` endpoint
  the Data Import screen uses.
* Dependency: the `mcp` Python SDK (2.x, pinned in `app/requirements.txt`). The package is
  named `mcp_server` so it does not shadow the SDK's `mcp` package on the `app/` path.
* Tests: `pytest tests/test_mcp_server.py -v` drives the real app over JSON-RPC against a
  seeded temporary database. `pytest tests/test_mcp_workflow.py -v` builds a small firearms
  model from nothing only through MCP tools (records, a routing CSV, a BOM workbook, prices,
  deduction rules, the 2027 sales forecast) and checks that the COGS forecast, labor forecast
  and statements agree, the 11% embedded FET and precedence maths, that dry runs write
  nothing, that unknown arguments are rejected and that the workbook lands in
  `<data folder>/exports/`.
