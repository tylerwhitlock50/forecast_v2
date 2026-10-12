import React from 'react';
import { formatDateOnly } from '../../../lib/dates';
import { PAY_FREQUENCY_LABELS } from './payrollView';

// Statement payroll vs payroll cash (GET /payroll/statement-bridge, shaped by
// payrollView.bridgeToView). The income statement accrues payroll evenly by
// calendar month; cash goes out on pay dates. The difference is timing, and
// its running total is the payroll owed but not yet paid at month end.

const money = (value) => {
  const n = Number(value) || 0;
  const rounded = Math.round(Math.abs(n));
  const text = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(rounded);
  return n < -0.5 ? `(${text})` : text;
};

const monthLabel = (period) => formatDateOnly(period, { month: 'short', year: 'numeric' }, period);

const PayrollBridge = ({ bridge, loading = false, window, onWindowChange, payFrequency }) => {
  const frequency = (PAY_FREQUENCY_LABELS[bridge?.frequency || payFrequency] || '').toLowerCase();
  const start = window?.start || bridge?.start || '';
  const end = window?.end || bridge?.end || '';

  const change = (which, value) => {
    if (!onWindowChange || !/^\d{4}-\d{2}$/.test(value || '')) return;
    const next = { start, end, [which]: value };
    if (next.start > next.end) {
      if (which === 'start') next.end = value;
      else next.start = value;
    }
    onWindowChange(next);
  };

  return (
    <section
      className="mb-8 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-8"
      data-testid="payroll-bridge"
      aria-labelledby="payroll-bridge-title"
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="payroll-bridge-title" className="mb-1 text-xl font-semibold text-slate-800">Statement vs pay dates</h3>
          <p className="text-sm text-gray-600">
            The income statement spreads payroll evenly over each month. Cash goes out on {frequency || 'the'} pay dates, so a
            month with an extra payday pays more than it shows. The last column is pay earned but not yet paid at month end.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-700">
          <label className="flex items-center gap-1.5">
            From
            <input
              type="month"
              aria-label="Bridge from month"
              value={start}
              onChange={(e) => change('start', e.target.value)}
              className="h-9 rounded-md border border-gray-300 px-2 text-sm"
            />
          </label>
          <label className="flex items-center gap-1.5">
            to
            <input
              type="month"
              aria-label="Bridge to month"
              value={end}
              onChange={(e) => change('end', e.target.value)}
              className="h-9 rounded-md border border-gray-300 px-2 text-sm"
            />
          </label>
        </div>
      </div>

      {!bridge ? (
        <p className="py-6 text-center text-sm text-gray-500">{loading ? 'Loading…' : 'No payroll to compare for these months.'}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-gray-200">
          <table className="min-w-full text-sm tabular-nums" data-testid="payroll-bridge-table">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                <th scope="col" className="px-3 py-2 text-left font-medium">Month</th>
                <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap" title="Payroll on the income statement: annual cost / 12, prorated for start and end dates">Income statement</th>
                <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">Paid on pay dates</th>
                <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">Pay runs</th>
                <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap" title="Income statement less paid">Difference</th>
                <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap" title="Pay earned but not yet paid at month end (accrued payroll)">Owed at month end</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-gray-100 text-gray-500">
                <td className="px-3 py-1.5 whitespace-nowrap" title={`Pay for days worked before ${monthLabel(bridge.start)} that falls on a pay date in the window`}>
                  Earned before {monthLabel(bridge.start)}
                </td>
                <td colSpan={4} />
                <td className="px-3 py-1.5 text-right">{money(bridge.opening)}</td>
              </tr>
              {bridge.rows.map(row => (
                <tr key={row.period} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-1.5 text-left text-gray-900 whitespace-nowrap">{monthLabel(row.period)}</td>
                  <td className="px-3 py-1.5 text-right">{money(row.accrued)}</td>
                  <td className="px-3 py-1.5 text-right">{money(row.paid)}</td>
                  <td className="px-3 py-1.5 text-right">{row.payRuns}</td>
                  <td className={`px-3 py-1.5 text-right ${row.difference < -0.5 ? 'text-gray-900' : ''}`}>{money(row.difference)}</td>
                  <td className="px-3 py-1.5 text-right font-medium">{money(row.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                <td className="px-3 py-1.5 text-left">Total</td>
                <td className="px-3 py-1.5 text-right">{money(bridge.totals.accrued)}</td>
                <td className="px-3 py-1.5 text-right">{money(bridge.totals.paid)}</td>
                <td className="px-3 py-1.5 text-right">{bridge.totals.payRuns}</td>
                <td className="px-3 py-1.5 text-right">{money(bridge.totals.difference)}</td>
                <td className="px-3 py-1.5 text-right">{money(bridge.closing)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {bridge && bridge.rows.some(r => r.balance < -0.5) && (
        <p className="mt-2 text-xs text-gray-600" data-testid="paid-ahead-note">
          A negative amount owed means the pay dates have paid more than the income statement has recorded so far.
        </p>
      )}
      {bridge && bridge.rows.length === 12 && bridge.runsPerYear && bridge.totals.payRuns > bridge.runsPerYear && (
        <p className="mt-2 text-xs text-gray-600" data-testid="extra-payday-note">
          These 12 months have {bridge.totals.payRuns} pay dates, one more than a usual year ({bridge.runsPerYear}). The extra run is
          cash out that the income statement spreads evenly, so budget the cash for it.
        </p>
      )}
    </section>
  );
};

export default PayrollBridge;
