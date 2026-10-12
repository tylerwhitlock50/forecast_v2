# Scenario Workflow Guide

A scenario is a self-contained forecast. This guide covers how scenarios are
scoped, where they are managed, and how to compare them.

## How scoping works

Every screen shows a scope badge in the scenario bar at the top of the page.

| Scope | Screens | Rule |
| --- | --- | --- |
| Scenario-specific | Sales Forecasting | Sales lines belong to exactly one scenario. |
| Company-wide + this scenario | Payroll, Expenses, Capex | Each row is either company-wide (`forecast_id` NULL, included in every scenario) or pinned to one scenario. The screens list both, exactly as the statements engine uses them. |
| Company-wide | Customers, Products, BOMs, Routings, Machines, Labor Rates, Loans | Shared by every scenario. |
| Chosen on the page | Statements, Compare | Reporting uses the scenarios you pick on the page. Statements default to the active scenario. |

Financial assumptions (opening balances, DSO/DIO/DPO, tax rate) are stored per scenario.

## 1. Manage scenarios

Open **Scenarios** in the sidebar (or "Manage scenarios" in the scenario bar).

- **New scenario** creates an empty scenario. The first scenario in a database becomes the base automatically.
- **Branch** copies a scenario on the server in one transaction: sales lines, scenario-specific expenses, employees and capex, financial assumptions and notes. Optional overrides apply to the copy only: a price multiplier, a quantity multiplier, and "extend by N periods", which repeats the last month's lines for N more months. The copy becomes the active scenario.
- **Edit** renames a scenario or changes its description, notes or base flag.
- **Set as base** marks the scenario that Compare shows deltas against. Exactly one scenario is the base.
- **Delete** removes the scenario and every row that belongs only to it (sales, scenario-specific expenses with their allocations, employees, capex, assumptions). Company-wide rows are kept. The confirmation lists the counts.

The list shows each scenario's sales window, number of lines, total revenue, scenario-only row counts and whether assumptions are set.

## 2. Switch the active scenario

Use the select in the scenario bar. The choice is remembered in the browser. The Sales Forecasting, Payroll and Expenses screens reload for the active scenario.

## 3. Enter assumptions

- **Sales Forecasting**: the matrix shows one measure at a time (quantity, unit price or revenue) per month. Quantity and price are edited inline in the monthly view and saved per cell when you press Enter or leave the cell. Revenue is always derived. The quarterly view shows totals and is read-only.
- **Payroll / Expenses**: every row has a Scope column. The add and edit forms have a Scope field: *Company-wide* or *This scenario only*. Scenario-only rows are copied when the scenario is branched.

## 4. Compare scenarios

Open **Reporting & Analysis → Compare Scenarios**. Pick two to four scenarios. Every column is totalled over one shared window (by default the union of the selected scenarios' sales months, or a window you choose) using the statements engine, so the figures match the Statements screen. Non-base columns show the delta against the base scenario.

## 5. Statements

Open **Reporting & Analysis → Statements**. Statements follow the active scenario. Tick "Consolidate several scenarios" to sum two or more scenarios into one set of statements; assumptions then come from the first selected scenario.

## API summary

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/forecast/scenarios` | All scenarios with counts, sales window, `is_base`, `has_assumptions` |
| GET | `/forecast/scenario/{id}` | One scenario with counts |
| POST | `/forecast/scenario` | Create (`name`, `description`, `notes`, `is_base`) |
| PUT | `/forecast/scenario/{id}` | Rename / edit / mark base |
| POST | `/forecast/scenario/{id}/duplicate` | Branch with `price_multiplier`, `quantity_multiplier`, `extend_periods` |
| DELETE | `/forecast/scenario/{id}` | Delete with cascade; returns the counts removed |
| GET | `/forecast/comparison?forecast_ids=A,B` | Side-by-side totals over one shared window |
