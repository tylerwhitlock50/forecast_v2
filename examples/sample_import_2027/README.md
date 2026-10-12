# Sample import set: a 2027 budget for a fictional rifle and pistol maker

These files are made up ("Ridgeline Precision Arms"). Use them to rehearse the whole
workflow before you load your own data: import, pricing and deductions, COGS and labor
forecast, statements and the Excel export. They are laid out the way ERP and spreadsheet
exports usually are (an Excel title row above the header, `$1,234.50` values, `Qty Per`,
`Run Time`, `Class`, one column per month), so they also show what the importer understands.

| Order | File | What it loads | Import step / MCP tool |
|---|---|---|---|
| 1 | `customers.csv` | 12 customers; `Class` is the customer type (Dealer, Distributor, Direct, Government, Export) | Customers / `forecast_import_records` (table `customers`) |
| 2 | `products.csv` | 8 products with list price, product type (Rifle, Pistol, Accessory) and their BOM and routing ids | Products / `forecast_import_records` (table `units`) |
| 3 | `machines.csv` | 5 work centers with $/hour and capacity in hours per month | Machines / `forecast_import_records` (table `machines`) |
| 4 | `labor_rates.csv` | 4 labor types with $/hour | Labor rates / `forecast_import_records` (table `labor_rates`) |
| 5 | `routings.csv` | 8 routings, 35 operations (run minutes, labor minutes, labor class; setup time is ignored) | Routings / `forecast_import_routings` |
| 6 | `boms.xlsx` | 8 BOMs, 64 lines (title row above the header, costs as `$1,234.50`) | BOMs / `forecast_import_boms` |
| 7 | `price_list.csv` | Dealer and Government price sheets, Distributor 22% and Export 18% off list, two customer deals | Prices / `forecast_import_prices` |
| 8 | `deduction_rules.csv` | Terms 2% (Distributor 1%), Dealer chargebacks 1%, FET 11% / 10% embedded in the price (Government and Export exempt), 5% commission on net for Dealers | Deductions / `forecast_import_deductions` |
| 9 | `sales_forecast_2027.csv` | Jan-Dec 2027 units by customer and item, one column per month, no prices (prices come from the price list) | Sales forecast / `forecast_import_sales` |

## In the web app

1. Create a scenario (Scenarios -> New scenario, e.g. "2027 Budget").
2. Open **Get Started -> Import Data** and upload the files in the order above. Each upload is
   checked first (nothing is saved until you press Import), so you can see how the columns
   were read.
3. Open **Pricing & Deductions** and try an invoice: a $1,110.00 rifle to a Dealer carries
   $110.00 of excise ($1,110 x 11% / 1.11).
4. Open **Reporting -> COGS & Labor Forecast** for Jan-Dec 2027 and press
   **Export Excel workbook**.

## From Claude Code (MCP)

Copy the folder into the API's data folder (`./data/imports/` next to `docker-compose.yml`),
then ask, for example: *"Import the files in imports/sample_import_2027 into a new scenario
'2027 Budget' in the order of the README, dry run first, then show me the COGS forecast by
customer type and the labor forecast for 2027, and export the workbook."*

## Starting clean afterwards

The sample data mixes with anything else in the database. To start fresh before loading
your real files, open **Load Database** (bottom of the sidebar) and press **Start clean…**, or
ask Claude to "start clean" (`forecast_start_clean`). Either way the current data is saved as a
snapshot first, so the rehearsal can be loaded back from the same Load Database list.
