import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { StatsCard } from '../../../ui/stats-card';
import StatementTable, { periodColumns } from './StatementTable';
import { formatCurrency, formatPct, formatPeriod, formatAccounting } from '../utils/formatters';
import { DEDUCTION_HELP } from '../utils/lineHelp';

export { DEDUCTION_HELP };

export const INCOME_STATEMENT_ROWS = [
  { key: 'gross_sales', label: 'Gross sales', kind: 'subtotal', help: 'Invoice value of the sales forecast (quantity × price), including any excise tax embedded in the price.' },
  { key: 'terms_allowance', label: 'Terms allowance', kind: 'line', indent: 1, deduction: true, help: DEDUCTION_HELP.terms_allowance },
  { key: 'chargebacks', label: 'Chargebacks allowance', kind: 'line', indent: 1, deduction: true, help: DEDUCTION_HELP.chargebacks },
  { key: 'other_allowances', label: 'Other discounts & allowances', kind: 'line', indent: 1, deduction: true, help: DEDUCTION_HELP.other_allowances },
  { key: 'excise_tax', label: 'Excise tax (FET)', kind: 'line', indent: 1, deduction: true, help: DEDUCTION_HELP.excise_tax },
  { key: 'total_sales_deductions', label: 'Total sales deductions', kind: 'line', deduction: true },
  { key: 'revenue', label: 'Net sales', kind: 'subtotal', help: 'Gross sales less sales deductions. Every margin % on this page is a share of net sales.' },
  { key: 'units_sold', label: 'Units sold', kind: 'line', indent: 1, format: 'number' },
  { key: 'cogs_header', label: 'Cost of goods sold', kind: 'header' },
  { key: 'cogs_materials', label: 'Materials', kind: 'line', indent: 1, help: 'BOM material cost per unit × units sold.' },
  { key: 'cogs_labor', label: 'Direct labor', kind: 'line', indent: 1, help: 'Routing labor minutes × labor rates × units sold.' },
  { key: 'cogs_manufacturing', label: 'Machine / manufacturing', kind: 'line', indent: 1, help: 'Routing machine minutes × machine rates × units sold.' },
  { key: 'factory_overhead', label: 'Factory overhead', kind: 'line', indent: 1, help: 'Expenses categorised as factory overhead.' },
  { key: 'other_cogs', label: 'Other COGS', kind: 'line', indent: 1 },
  { key: 'total_cogs', label: 'Total COGS', kind: 'subtotal' },
  { key: 'gross_profit', label: 'Gross profit', kind: 'subtotal', help: 'Net sales less total COGS.' },
  { key: 'gross_margin_pct', label: 'Gross margin %', kind: 'pct', indent: 1 },
  { key: 'opex_header', label: 'Operating expenses', kind: 'header' },
  { key: 'commissions', label: 'Sales commissions', kind: 'line', indent: 1, help: 'Commission rules from Pricing & Deductions; a selling expense, not a sales deduction.' },
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

const money0 = (v) => formatCurrency(v, { maximumFractionDigits: 0, minimumFractionDigits: 0 });
const pctOf = (part, whole) => (whole ? (part / whole) * 100 : null);

const sortedValues = (map, key) =>
  Object.values(map || {}).sort((a, b) => (b[key] || 0) - (a[key] || 0));

/** Units, gross sales, deductions, net sales, COGS and gross profit of a detail entry (API: revenue = net sales). */
export const detailFigures = (entry = {}) => {
  const net = entry.revenue ?? 0;
  const gross = entry.gross_sales ?? net;
  const deductions = entry.total_sales_deductions ?? gross - net;
  const cogs = entry.cogs ?? 0;
  return { units: entry.quantity ?? 0, gross, deductions, net, cogs, gp: net - cogs, gpPct: pctOf(net - cogs, net) };
};

const sumFigures = (list) => list.reduce((acc, e) => {
  const f = detailFigures(e);
  ['units', 'gross', 'deductions', 'net', 'cogs', 'gp'].forEach(k => { acc[k] += f[k] || 0; });
  return acc;
}, { units: 0, gross: 0, deductions: 0, net: 0, cogs: 0, gp: 0 });

// Deductions read as amounts taken off gross sales: (1,234).
const ded = (v) => formatAccounting(v ? -v : 0);

const DetailTable = ({ title, subtitle, headers, rows, footer, testId, textCols = 1 }) => (
  <div>
    <div className="mb-2">
      <h4 className="text-sm font-semibold text-gray-800">{title}</h4>
      {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
    </div>
    {rows.length === 0 ? (
      <p className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-500">No data in this window.</p>
    ) : (
      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table data-testid={testId} className="min-w-full text-xs tabular-nums">
          <thead>
            <tr className="bg-gray-100 text-gray-600">
              {headers.map((h, i) => (
                <th key={h} className={`px-3 py-2 font-medium whitespace-nowrap ${i < textCols ? 'text-left' : 'text-right'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-t border-gray-100 hover:bg-gray-50">
                {r.cells.map((c, i) => (
                  <td key={i} className={`px-3 py-1.5 whitespace-nowrap ${i === 0 ? 'text-left text-gray-800' : i < textCols ? 'text-left' : 'text-right'}`}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && (
            <tfoot>
              <tr className="border-t border-gray-300 bg-gray-50 font-semibold">
                {footer.map((c, i) => (
                  <td key={i} className={`px-3 py-1.5 whitespace-nowrap ${i < textCols ? 'text-left' : 'text-right'}`}>{c}</td>
                ))}
              </tr>
            </tfoot>
          )}
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

  const grossSales = totals.gross_sales ?? totals.revenue;
  const deductionPct = pctOf(totals.total_sales_deductions || 0, grossSales);
  const netTotal = totals.revenue || 0;
  const ruleCount = detail?.sales_deductions?.rule_count;

  const byProduct = sortedValues(detail?.revenue_by_product, 'revenue');
  const byCustomer = sortedValues(detail?.revenue_by_customer, 'revenue');
  const byCustomerType = sortedValues(detail?.revenue_by_customer_type, 'revenue');
  const byCategory = Object.entries(detail?.expenses_by_category || {})
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => (b.total || 0) - (a.total || 0));

  const productTotals = sumFigures(byProduct);
  const typeTotals = sumFigures(byCustomerType);
  const customerTotals = sumFigures(byCustomer);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Gross sales" value={money0(grossSales)} subtitle={periodLabel} variant="primary" />
        <StatsCard
          title="Net sales"
          value={money0(totals.revenue)}
          subtitle={deductionPct === null ? 'No sales in this window' : `Deductions ${formatPct(deductionPct)} of gross`}
          variant="primary"
        />
        <StatsCard title="Gross margin" value={formatPct(totals.gross_margin_pct)} subtitle={`Gross profit ${money0(totals.gross_profit)}`} variant="success" />
        <StatsCard title="Net income" value={money0(totals.net_income)} subtitle={`Margin ${formatPct(totals.net_margin_pct)}`} variant={(totals.net_income || 0) >= 0 ? 'success' : 'danger'} />
      </div>

      {ruleCount === 0 && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="no-deduction-rules-note">
          No discount, allowance or excise tax rules are set up, so net sales equal gross sales.{' '}
          <Link to="/pricing" className="font-medium text-orange-700 hover:underline">Set them up under Pricing &amp; Deductions</Link>.
        </p>
      )}

      <StatementTable rows={INCOME_STATEMENT_ROWS} columns={columns} firstColumnLabel="Income statement" testId="income-statement-table" />
      <p className="text-xs text-gray-500">
        Sales deductions are shown in parentheses; they take gross sales down to net sales. Hover a dotted label to see how a line is calculated.
      </p>

      {detail && (
        <div className="border border-gray-200 rounded-md">
          <button
            type="button"
            onClick={() => setShowDetail(s => !s)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            aria-expanded={showDetail}
          >
            <span>Breakdowns: sales by product, customer type and customer; expenses by category</span>
            <span className="text-gray-400">{showDetail ? '▲' : '▼'}</span>
          </button>
          {showDetail && (
            <div className="p-4 grid grid-cols-1 gap-6 border-t border-gray-200">
              <div>
                <DetailTable
                  title="Sales by product"
                  subtitle="Gross profit here is before factory overhead and other COGS, which are period costs on the statement."
                  testId="revenue-by-product"
                  headers={['Product', 'Units', 'Gross sales', 'Deductions', 'Net sales', 'Product COGS', 'Gross profit', 'GP %']}
                  rows={byProduct.map(p => {
                    const f = detailFigures(p);
                    return {
                      key: p.unit_id || p.unit_name,
                      cells: [
                        p.unit_name || p.unit_id,
                        formatAccounting(f.units),
                        formatAccounting(f.gross),
                        ded(f.deductions),
                        formatAccounting(f.net),
                        formatAccounting(f.cogs),
                        formatAccounting(f.gp),
                        formatPct(f.gpPct)
                      ]
                    };
                  })}
                  footer={['Total', formatAccounting(productTotals.units), formatAccounting(productTotals.gross), ded(productTotals.deductions),
                    formatAccounting(productTotals.net), formatAccounting(productTotals.cogs), formatAccounting(productTotals.gp),
                    formatPct(pctOf(productTotals.gp, productTotals.net))]}
                />
              </div>
              <DetailTable
                title="Sales by customer type"
                testId="revenue-by-customer-type"
                headers={['Customer type', 'Gross sales', 'Deductions', 'Net sales', 'Gross profit', '% of net']}
                rows={byCustomerType.map(t => {
                  const f = detailFigures(t);
                  return {
                    key: t.customer_type || 'Unassigned',
                    cells: [
                      t.customer_type || 'Unassigned',
                      formatAccounting(f.gross),
                      ded(f.deductions),
                      formatAccounting(f.net),
                      formatAccounting(f.gp),
                      formatPct(pctOf(f.net, netTotal))
                    ]
                  };
                })}
                footer={['Total', formatAccounting(typeTotals.gross), ded(typeTotals.deductions), formatAccounting(typeTotals.net),
                  formatAccounting(typeTotals.gp), formatPct(pctOf(typeTotals.net, netTotal))]}
              />
              <DetailTable
                title="Sales by customer"
                testId="revenue-by-customer"
                textCols={2}
                headers={['Customer', 'Type', 'Gross sales', 'Deductions', 'Net sales', '% of net']}
                rows={byCustomer.map(c => {
                  const f = detailFigures(c);
                  return {
                    key: c.customer_id || c.customer_name,
                    cells: [
                      c.customer_name || c.customer_id,
                      <span className="text-gray-600">{c.customer_type || '—'}</span>,
                      formatAccounting(f.gross),
                      ded(f.deductions),
                      formatAccounting(f.net),
                      formatPct(pctOf(f.net, netTotal))
                    ]
                  };
                })}
                footer={['Total', '', formatAccounting(customerTotals.gross), ded(customerTotals.deductions), formatAccounting(customerTotals.net),
                  formatPct(pctOf(customerTotals.net, netTotal))]}
              />
              <div>
                <DetailTable
                  title="Expenses by category"
                  testId="expenses-by-category"
                  textCols={3}
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
