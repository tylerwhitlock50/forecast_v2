import React, { useState } from 'react';
import { StatsCard } from '../../../ui/stats-card';
import StatementTable, { periodColumns } from './StatementTable';
import { formatCurrency, formatPct, formatPeriod, formatAccounting } from '../utils/formatters';

export const INCOME_STATEMENT_ROWS = [
  { key: 'revenue', label: 'Revenue', kind: 'subtotal' },
  { key: 'units_sold', label: 'Units sold', kind: 'line', indent: 1, format: 'number' },
  { key: 'cogs_header', label: 'Cost of goods sold', kind: 'header' },
  { key: 'cogs_materials', label: 'Materials', kind: 'line', indent: 1 },
  { key: 'cogs_labor', label: 'Direct labor', kind: 'line', indent: 1 },
  { key: 'cogs_manufacturing', label: 'Machine / manufacturing', kind: 'line', indent: 1 },
  { key: 'factory_overhead', label: 'Factory overhead', kind: 'line', indent: 1 },
  { key: 'other_cogs', label: 'Other COGS', kind: 'line', indent: 1 },
  { key: 'total_cogs', label: 'Total COGS', kind: 'subtotal' },
  { key: 'gross_profit', label: 'Gross profit', kind: 'subtotal' },
  { key: 'gross_margin_pct', label: 'Gross margin %', kind: 'pct', indent: 1 },
  { key: 'opex_header', label: 'Operating expenses', kind: 'header' },
  { key: 'payroll', label: 'Payroll', kind: 'line', indent: 1 },
  { key: 'admin_expense', label: 'Admin expenses', kind: 'line', indent: 1 },
  { key: 'operating_expense', label: 'Operating expenses', kind: 'line', indent: 1 },
  { key: 'depreciation', label: 'Depreciation', kind: 'line', indent: 1 },
  { key: 'total_operating_expenses', label: 'Total operating expenses', kind: 'subtotal' },
  { key: 'operating_income', label: 'Operating income', kind: 'subtotal' },
  { key: 'operating_margin_pct', label: 'Operating margin %', kind: 'pct', indent: 1 },
  { key: 'interest_expense', label: 'Interest expense', kind: 'line', indent: 1 },
  { key: 'pre_tax_income', label: 'Pre-tax income', kind: 'subtotal' },
  { key: 'income_tax', label: 'Income tax', kind: 'line', indent: 1 },
  { key: 'net_income', label: 'Net income', kind: 'total' },
  { key: 'net_margin_pct', label: 'Net margin %', kind: 'pct', indent: 1 }
];

const sortedValues = (map, key) =>
  Object.values(map || {}).sort((a, b) => (b[key] || 0) - (a[key] || 0));

const DetailTable = ({ title, headers, rows, testId }) => (
  <div>
    <h4 className="text-sm font-semibold text-gray-700 mb-2">{title}</h4>
    {rows.length === 0 ? (
      <p className="text-xs text-gray-500">No data in this period.</p>
    ) : (
      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table data-testid={testId} className="min-w-full text-xs tabular-nums">
          <thead>
            <tr className="bg-gray-100 text-gray-600">
              {headers.map((h, i) => (
                <th key={h} className={`px-3 py-2 font-medium ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-t border-gray-100">
                {r.cells.map((c, i) => (
                  <td key={i} className={`px-3 py-1 whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'}`}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

const IncomeStatement = ({ data, periods = [], detail }) => {
  const [showDetail, setShowDetail] = useState(false);

  if (!data || !data.by_period) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>No income statement data available</p>
      </div>
    );
  }

  const totals = data.totals || {};
  const columns = periodColumns(data.by_period, totals);
  const firstPeriod = periods[0] || data.by_period[0]?.period;
  const lastPeriod = periods[periods.length - 1] || data.by_period[data.by_period.length - 1]?.period;
  const periodLabel = firstPeriod && lastPeriod ? `${formatPeriod(firstPeriod)} – ${formatPeriod(lastPeriod)}` : '';

  const byProduct = sortedValues(detail?.revenue_by_product, 'revenue');
  const byCustomer = sortedValues(detail?.revenue_by_customer, 'revenue');
  const byCategory = Object.entries(detail?.expenses_by_category || {})
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => (b.total || 0) - (a.total || 0));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Total revenue" value={formatCurrency(totals.revenue, { maximumFractionDigits: 0, minimumFractionDigits: 0 })} subtitle={periodLabel} variant="primary" />
        <StatsCard title="Gross margin" value={formatPct(totals.gross_margin_pct)} subtitle={`Gross profit ${formatCurrency(totals.gross_profit, { maximumFractionDigits: 0, minimumFractionDigits: 0 })}`} variant="success" />
        <StatsCard title="Operating income" value={formatCurrency(totals.operating_income, { maximumFractionDigits: 0, minimumFractionDigits: 0 })} subtitle={`Margin ${formatPct(totals.operating_margin_pct)}`} variant={(totals.operating_income || 0) >= 0 ? 'default' : 'danger'} />
        <StatsCard title="Net income" value={formatCurrency(totals.net_income, { maximumFractionDigits: 0, minimumFractionDigits: 0 })} subtitle={`Margin ${formatPct(totals.net_margin_pct)}`} variant={(totals.net_income || 0) >= 0 ? 'success' : 'danger'} />
      </div>

      <StatementTable rows={INCOME_STATEMENT_ROWS} columns={columns} firstColumnLabel="Income statement" testId="income-statement-table" />

      {detail && (
        <div className="border border-gray-200 rounded-md">
          <button
            type="button"
            onClick={() => setShowDetail(s => !s)}
            className="w-full flex items-center justify-between px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            aria-expanded={showDetail}
          >
            <span>Detail: revenue by product &amp; customer, expenses by category</span>
            <span className="text-gray-400">{showDetail ? '▲' : '▼'}</span>
          </button>
          {showDetail && (
            <div className="p-4 grid grid-cols-1 xl:grid-cols-2 gap-6 border-t border-gray-200">
              <DetailTable
                title="Revenue by product"
                testId="revenue-by-product"
                headers={['Product', 'Quantity', 'Revenue', 'COGS', 'Gross profit']}
                rows={byProduct.map(p => ({
                  key: p.unit_id,
                  cells: [
                    p.unit_name || p.unit_id,
                    formatAccounting(p.quantity),
                    formatAccounting(p.revenue),
                    formatAccounting(p.cogs),
                    formatAccounting((p.revenue || 0) - (p.cogs || 0))
                  ]
                }))}
              />
              <DetailTable
                title="Revenue by customer"
                testId="revenue-by-customer"
                headers={['Customer', 'Revenue', '% of total']}
                rows={byCustomer.map(c => ({
                  key: c.customer_id,
                  cells: [
                    c.customer_name || c.customer_id,
                    formatAccounting(c.revenue),
                    totals.revenue ? formatPct((c.revenue / totals.revenue) * 100) : '—'
                  ]
                }))}
              />
              <div className="xl:col-span-2">
                <DetailTable
                  title="Expenses by category"
                  testId="expenses-by-category"
                  headers={['Category', 'Type', 'Statement line', 'Total']}
                  rows={byCategory.map(c => ({
                    key: c.name,
                    cells: [c.name, c.category_type || '—', c.bucket || '—', formatAccounting(c.total)]
                  }))}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default IncomeStatement;
