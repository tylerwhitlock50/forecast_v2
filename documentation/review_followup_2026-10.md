# Repeat-review follow-up (October 2026)

Reviewed commit: `1ab5f1d` (after PRs #14 and #15). Main at the time of this
work also carried PR #16 (`01f2bc1`), whose fixes (one base scenario,
optional expense fields cleared, payment details copied on branch) were left
as they are.

This document records what was fixed, how it was verified, what is still
open, and the accounting-policy questions that need an owner decision.

## 1. Findings matrix

| # | Finding | Status | Where | Regression test |
|---|---------|--------|-------|-----------------|
| 1 | Reporting window changed the balances it reported: a March-only report applied the opening balances at March, so cash, debt, fixed assets, depreciation and retained earnings from January and February were missing (screenshot: "Opening (Feb 2026)" showing the Dec-2025 opening balances). | **Fixed** | `app/services/financial_statements.py` `resolve_carry_forward`, `build_statements` | `tests/test_financial_statements.py::TestCarryForward` (7 tests) |
| 1a | Opening-asset depreciation restarted at the window start instead of continuing from the opening period. | **Fixed** (same change: depreciation is computed from the first modelled month) | engine | `test_opening_assets_depreciate_through_the_carried_months` |
| 1b | Detail tables (revenue by product/customer, expenses by category, payroll detail) leaked rolled-forward months into a shorter window. | **Fixed** (`detail_periods` on the loaders, slices at assembly) | engine | `test_detail_is_limited_to_the_window` |
| 1c | Cash-below-minimum warning could name months outside the window. | **Fixed** | engine | `test_warnings_only_for_the_window` |
| 1d | Assumptions without an `opening_period` silently behaved as if the balances were "as at the window start". | **Fixed: now explicit** (warning `opening_period_unset`, or hint on `default_assumptions`); see policy question P1 | engine | `test_unset_opening_period_warns` |
| 1e | Window starting before the opening period. | **Fixed: now explicit** (warning `window_before_opening`, balances applied at window start); see P2 | engine | `test_window_before_opening_period_warns` |
| 2 | Incomplete actuals: YTD budget summed every month that had *any* actual, so January revenue + February payroll produced a Jan+Feb budget against a one-month actual for both lines. Missing months were indistinguishable from zero in the totals. | **Fixed** | `build_variance` | `TestVarianceCoverage` (4 tests) |
| 2a | Confirmed zero vs missing. | **Fixed** (stored `0` is compared; absent is `null`) | engine + `VarianceReport.js` | `test_confirmed_zero_is_compared`; `VarianceReport.test.js` |
| 2b | UI gave no signal that coverage was partial. | **Fixed** (Coverage column, incomplete-actuals note, per-period "n of m lines" note) | `VarianceReport.js` | `VarianceReport.test.js` "distinguishes a missing month from a confirmed zero" |
| 3 | Cash aggregation: Total column / comparison / export must carry the final closing balance, not a sum of monthly balances. | **Verified correct in the engine and UI; hardened** with a `cash_flow.reconciliation` block (opening + net flow = closing, difference computed before rounding), a visible reconciliation line in the UI, and a UI fallback that re-derives balances from the rows if a payload ever carries summed balances. | engine, `CashFlowStatement.js`, export | `TestCashAggregation` (3 tests); `CashFlowStatement.test.js` |
| 4 | Pay-period dates used `365.25 / runs` day increments (drift, month ends and February wrong). | **Fixed**: `pay_run_dates` gives real Fridays (weekly/biweekly), 15th + month end (semimonthly), month end (monthly); the API also returns each run's `month`. | `pay_run_dates`, `payroll_routes.py` | `TestPayCalendar` (7 tests) |
| 4a | Loan schedules used `30.44 * n` day increments (drift, skipped/doubled months). | **Fixed**: calendar months with the day clamped to month end (`add_months`, `payment_date_for`); `next_payment_date` is one calendar month after start. | `loan_routes.py` | `TestLoanCalendar` (3 tests) |
| 4b | Date-only strings parsed with `new Date('YYYY-MM-DD')` rendered as the previous day in US timezones and bucketed month-end pay runs into the prior month. | **Fixed** (`frontend/src/lib/dates.js`; payroll forecast, payroll reports, loan table/summary/schedule) | frontend | `dates.test.js`, `PayrollForecast.test.js` (suite also run with `TZ=America/Los_Angeles`) |
| 4c | Payroll overview vs forecast vs statement totals. | **Reconciled**: 12 months of statement accrual = overview annual burdened cost = 26 biweekly runs (fixture: 62,400). Month-by-month, pay runs (cash basis, by pay date) and the statement (accrual, even per month) differ by design; the forecast screen now says so. See P3. | tests + UI note | `test_monthly_accrual_reconciles_to_annual_cost_and_pay_runs` |
| 4d | February / leap year / partial months. | **Covered** by tests on `_active_fraction`, `pay_run_dates`, `add_months`. | engine | `TestPayCalendar`, `TestLoanCalendar` |
| 5 | `CI=true npm run build` failed on ESLint warnings (60 warnings in 29 files), so the build only worked with lint disabled. | **Fixed**: warnings removed (unused imports/vars/dead handlers, two headings made screen-reader visible, two memo fixes). Seven `react-hooks/exhaustive-deps` cases where adding the dependency would change behaviour carry a one-line `eslint-disable-next-line` with the reason, matching existing practice in the tree. The ESLint plugin stays on. | frontend | `CI=true npm run build` passes |
| 5a | Backend container-path test: `test_path_detection` asserted `./data/forecast.db` but fails wherever `/data` exists (the Docker image) or `DATABASE_PATH` is set. | **Fixed**: tests patch `os.path.isdir('/data')` and the env; a container case and an env case were added. | `tests/test_database.py` | 5 tests |
| 5b | `DatabaseManager` let `DATABASE_PATH` override an explicit `database_path` argument, so a test or script naming its own DB could be redirected to the real one. | **Fixed**: explicit arguments > environment > auto-detect. | `app/db/database.py` | `test_explicit_paths_beat_environment` |
| 6 | Scenario copies keep allocations, assumptions, capex; revenue exports reconcile; comparison gives separate values; profit includes the overhead shown in COGS. | **Preserved** (re-verified end to end, see §3) | | `tests/test_scenarios.py`, e2e checks |
| 7 | Loan schedules already stored by older code still carry drifted dates. | **Open – data** | | Re-save the loan (any schedule-affecting field) to regenerate; no migration was written (see P4) |
| 8 | Other workflow / UI gaps listed in the repeat-review report. | **Untested** – the report itself was not attached to this task (only the balance-sheet screenshot was), so only the five numbered priorities and the screenshot were worked. | | |
| 9 | Normal Docker build. | **Untested here** – the Docker daemon is not available in this environment. The frontend image runs the same `npm run build` that now passes; the API image's import smoke test is covered by the test suite importing every router. | | |

## 2. Test and build results

| Suite | Result |
|-------|--------|
| Backend `pytest tests/` | 141 passed (was 112; +29 regression tests) |
| Frontend `CI=true react-scripts test --watchAll=false` | 39 passed in 7 suites (was 28); also run with `TZ=America/Los_Angeles` |
| Frontend `CI=true npm run build` | passes with zero ESLint warnings (was failing) |
| Docker | not run (no daemon in this environment) |

## 3. End-to-end verification (disposable fixture)

A throw-away SQLite database was seeded in the session scratchpad (never the
repo's `data/`): two products with BOM + routing, two customers, 12 months of
sales, four employees (one mid-month hire, one leaver, one July raise),
monthly/quarterly/one-off expenses, two capex items, a term loan from
31 Jul 2025 and an equipment loan drawn in April, opening balances as at
Dec 2025, and partial actuals (January revenue/COGS, January admin = 0,
February payroll). Loans and a "Price +10%" branch were created through the
API. Fifty-four reconciliation checks passed, including:

- source inputs → statements: revenue and units = sales rows; materials /
  labour / machine COGS = BOM + routing × quantity; overhead, admin (quarterly
  and one-off in the right months), freight = allocations; payroll monthly
  endpoint = statement line; interest and principal = loan schedule by month;
  one payment per calendar month; capex and depreciation in the right months;
- identities: balance sheet balances every month; net income identity; gross
  profit includes factory overhead and other COGS; cash rolls forward;
  retained earnings = cumulative net income; opening + net cash flow =
  closing;
- windows: every single-month report equals that month inside the full-year
  report; a Q3 report opens with June's closing balances and its detail
  covers only Q3;
- totals, comparison and exports: income-statement totals = sum of months;
  cash totals sum flows and carry balances; comparison rows = each scenario's
  statement totals; branch revenue = base × 1.10; wide and long CSV exports
  match the statements and the sales rows;
- actuals: coverage reported per line; to-date compares only each line's
  own months; confirmed zero compared, missing shown as missing.

Screenshots of the rendered production build (served the way nginx serves
it, `/api` proxied to the fixture API) are attached to the session:

1. income statement, full year (nonzero revenue, COGS incl. overhead, payroll, expenses, depreciation, interest);
2. balance sheet, March only: "Opening (Feb 2026)" is the carried-forward balance (cash, debt, accumulated depreciation, retained earnings all moved from the Dec-2025 opening) with the carry-forward note;
3. cash flow, March only;
4. cash flow, Q3: Total column sums flows, opening/closing are balances, reconciliation line;
5. budget vs actual: incomplete-actuals note, per-period "1 of 18 lines" note, confirmed-zero admin line compared, Coverage column;
6. payroll pay-period forecast: real Fridays 14 days apart, month-end dates shown on their own day, cash-basis note (April 2027 correctly shows three runs);
7. loans list with month-end upcoming payment dates (Oct 30 / Oct 31);
8. scenario comparison with separate base / branch values.

## 4. Accounting-policy decisions needed

- **P1 – No opening period set.** Today the balances are applied at the start
  of whatever window is requested (and a warning says so). Alternatives:
  treat the earliest sales month of the scenario as the first modelled
  month, or refuse to build statements until an opening period is set.
- **P2 – Window before the opening period.** The engine cannot model months
  before the opening balance date; it applies the balances at the window
  start and warns. The alternative is to reject the request.
- **P3 – Payroll cash vs accrual.** Statements accrue payroll evenly by
  calendar month (annual ÷ 12, prorated by active days). The pay-period
  forecast is cash-basis by pay date, so a month with three Fridays shows
  three biweekly runs and a calendar year can hold 27. If the cash flow
  statement should follow pay dates instead of accrual, that is a modelling
  change to the engine, not a bug fix.
- **P4 – Existing loan schedules.** Schedules generated before this change
  keep their drifted dates until the loan is re-saved. A one-off migration
  that regenerates every schedule would change stored data; it was not done
  without sign-off.
- **P6 – Payroll overview "Total Annual Cost" vs forecast "Annual projection".**
  The overview card prices active employees at their current rates; the
  pay-period forecast and the statements apply scheduled raises from
  `next_review_date`. In the fixture the two differ by exactly one employee's
  3% raise (417,937 vs 421,843). Either the card should say "at current
  rates" or it should include scheduled raises; it was left as a current
  run rate pending a decision.
- **P5 – Working-capital days.** AR/inventory/AP still use the
  `AVG_DAYS_PER_MONTH` (30.4375) convention from the original design. It is
  a convention, not a calendar error, and was left unchanged.
