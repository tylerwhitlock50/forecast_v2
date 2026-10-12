# 2027 budget: from your files to COGS and labor

This is the short path for the first real test: load bills of materials and a 2027
sales forecast, set prices and deductions by customer type, and read the gross margin
and labor forecast. Each step can be done in the web app or by asking Claude Code
through the MCP server.

## 0. Start the app

```bash
docker-compose up --build          # web app http://localhost:3000, API :8000
claude mcp add --transport http forecast http://localhost:8000/mcp   # once, for Claude Code
```

The repository's `.mcp.json` already points Claude Code at `http://localhost:8000/mcp`.

## 1. Rehearse with the sample files (optional, 10 minutes)

`examples/sample_import_2027/` holds a fictional rifle-and-pistol maker laid out like ERP
exports. Import it once to see every screen with data. Then go to **Load Database ->
Start clean…** (or ask Claude to "start clean"). That saves a snapshot and empties the
database for your real files.

## 2. Load your data (Get Started -> Import Data)

Import in this order. Every upload is checked first: you see the rows, the column mapping
and any errors, and nothing is saved until you press Import. Templates are on each card.

1. **Customers**: the *customer type* (Dealer, Distributor, Direct, Government, Export, ...)
   drives prices and deductions, so fill it in.
2. **Products**: list price, product type (Rifle, Pistol, Accessory, ...), and the
   BOM and routing ids if you have them.
3. **Machines / work centers**: $/hour and capacity in hours per month.
4. **Labor rates**: $/hour per labor type.
5. **Routings**: run minutes per machine and labor minutes per labor type for each
   operation. Setup time is ignored, because the model is per unit.
6. **BOMs**: quantity per unit and unit cost per component. A BOM whose number equals a
   product's item number links to that product automatically.
7. **Prices** by customer type, customer and product (fixed or % off list). A wide price
   sheet with one column per customer type also works.
8. **Deductions** (see section 3).
9. **Sales forecast** for 2027 into the active scenario. The file can have one row per
   month or one column per month. Rows with no price take it from the price list, then
   the list price. To re-load a revised file, choose *Replace this scenario's months in
   the file* so lines you dropped do not linger.

## 3. Discounts, allowances and excise (Pricing & Deductions)

Each rule has a type, a method and a scope (everyone, a customer type, a customer, a
product type or a product):

| Type | Typical setup | Effect |
|---|---|---|
| Terms allowance | 2% of gross, everyone; 1% for Distributors | off gross sales |
| Chargebacks allowance | 1% of gross, Dealers | off gross sales |
| Other discounts & allowances | co-op %, freight $/unit, rebates | off gross sales; each named program adds up |
| Excise tax (FET) | **embedded** 11% on Rifle, 10% on Pistol, 0% for Government / Export | off gross sales: tax = price x 11% / 1.11 (a $1,110 invoice carries $110) |
| Sales commissions | % of net, by customer type | operating expense below gross profit |

For terms, chargebacks, excise and commissions, the most specific rule wins (a customer
rule beats its customer type; a 0% rule is an exemption). Different types add up.
*Try an invoice* on the page shows which rule applies and the amounts.

Gross sales - deductions = **net sales**, which is "revenue" on every report.

## 4. Read the results

* **Reporting -> COGS & Labor Forecast** (defaults to the scenario's months, e.g.
  Jan-Dec 2027):
  * the gross margin bridge (gross sales -> each deduction -> net sales -> materials /
    labor / machine / overhead -> gross profit) by month;
  * sales and margin by product, customer and customer type;
  * labor hours, cost and FTEs by labor type by month; machine hours against capacity;
  * unit costs.

  **Export Excel workbook** puts all of it, plus the statements and every sales line, in
  one file.
* **Reporting -> Statements**: the income statement (gross to net at the top), balance
  sheet and cash flow. Opening balances and the excise payable days are under
  *Assumptions*.

## 5. Approve the budget

When the numbers are final, **Scenarios -> Approve & lock** (or ask Claude to approve it). The
statement totals, the Excel workbook and a database snapshot are saved as evidence, and the
scenario is locked: any change to its sales, prices, rules, payroll, expenses or assumptions is
refused until it is unlocked with a reason. Branch it to work on a revised version. **History**
shows who changed what and when, and runs read-only checks on older data.

## 6. With Claude Code

Put files under `./data/imports/` (the API's data folder), then for example:

> Import the files in imports/2027 into a new scenario "2027 Budget": customers, products,
> work centers, labor rates, routings, BOMs, the price list and deduction rules, then the
> sales forecast. Dry run each one first and show me any errors. Then give me the COGS
> forecast by customer type, the labor forecast by month and the income statement for
> 2027, and export the workbook.

Claude takes a snapshot before sweeping changes. "Restore my last save" undoes them.

## Things to know

* **Direct labor vs payroll.** COGS direct labor comes from routings x labor rates (the
  standard). Give every employee a labor class in Payroll: **Direct** (production workers),
  **Indirect** (supervisors, maintenance, quality: factory overhead in COGS) or **Admin**
  (operating expense). When Direct employees are entered, COGS direct labor becomes their pay:
  the standard plus a *direct labor variance* line, so nobody is counted twice. The COGS & Labor
  Forecast's labor tab compares standard hours with paid hours (utilization). Employees with no
  class are treated as Admin and listed until you class them.
* **Overhead and period costs.** Per-product and per-customer margins are contribution margins:
  net sales - product COGS, before the direct labor variance, indirect labor, factory overhead
  and other COGS. The monthly bridge and the income statement include them: gross profit = net
  sales - (product COGS + direct labor variance + indirect labor + factory overhead + other COGS).
* **Payroll.** Salaried employees are entered at their annual salary. Burden is the
  employer cost only (FICA, unemployment, workers comp, benefits); income-tax withholding
  is not a company cost. The statements spread pay evenly over each month; Payroll ->
  Forecast -> *Statement vs pay dates* shows when it is actually paid (a month with three
  biweekly Fridays) and the pay owed at each month end.
* **Income tax** accrues on year-to-date profit, so loss months offset profitable ones
  within the year.
