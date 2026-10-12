import React from 'react';
import { StatsCard } from '../../../ui/stats-card';
import StatementTable, { periodColumns } from './StatementTable';
import { formatCurrency, formatPeriod } from '../utils/formatters';

export const CASH_FLOW_ROWS = [
  { key: 'operating_header', label: 'Operating activities', kind: 'header' },
  { key: 'net_income', label: 'Net income', kind: 'line', indent: 1 },
  { key: 'depreciation', label: 'Depreciation', kind: 'line', indent: 1 },
  { key: 'change_in_accounts_receivable', label: 'Change in accounts receivable', kind: 'line', indent: 1 },
  { key: 'change_in_inventory', label: 'Change in inventory', kind: 'line', indent: 1 },
  { key: 'change_in_accounts_payable', label: 'Change in accounts payable', kind: 'line', indent: 1 },
  { key: 'operating_cash_flow', label: 'Cash from operations', kind: 'subtotal' },
  { key: 'investing_header', label: 'Investing activities', kind: 'header' },
  { key: 'capex', label: 'Capital expenditures', kind: 'line', indent: 1 },
  { key: 'investing_cash_flow', label: 'Cash from investing', kind: 'subtotal' },
  { key: 'financing_header', label: 'Financing activities', kind: 'header' },
  { key: 'loan_proceeds', label: 'Loan proceeds', kind: 'line', indent: 1 },
  { key: 'principal_payments', label: 'Principal payments', kind: 'line', indent: 1 },
  { key: 'financing_cash_flow', label: 'Cash from financing', kind: 'subtotal' },
  { key: 'net_cash_flow', label: 'Net change in cash', kind: 'total' },
  { key: 'opening_cash', label: 'Opening cash', kind: 'line' },
  { key: 'closing_cash', label: 'Closing cash', kind: 'total' },
  { key: 'memo_header', label: 'Supplemental', kind: 'header' },
  { key: 'interest_paid', label: 'Interest paid', kind: 'line', indent: 1 },
  { key: 'taxes_paid', label: 'Taxes paid', kind: 'line', indent: 1 }
];

const fmt = (v) => formatCurrency(v, { maximumFractionDigits: 0, minimumFractionDigits: 0 });

const CashFlowStatement = ({ data }) => {
  if (!data || !data.by_period) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>No cash flow data available</p>
      </div>
    );
  }

  const rows = data.by_period;
  const totals = { ...(data.totals || {}) };
  const first = rows[0] || {};
  const last = rows[rows.length - 1] || {};
  // Opening/closing cash are balances, not flows: show window opening and closing in the Total column.
  if (rows.length > 0) {
    totals.opening_cash = first.opening_cash;
    totals.closing_cash = last.closing_cash;
  }

  const columns = periodColumns(rows, totals);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Cash from operations" value={fmt(totals.operating_cash_flow)} variant={(totals.operating_cash_flow || 0) >= 0 ? 'success' : 'danger'} />
        <StatsCard title="Capital expenditures" value={fmt(totals.capex)} subtitle={`Financing ${fmt(totals.financing_cash_flow)}`} variant="warning" />
        <StatsCard title="Net change in cash" value={fmt(totals.net_cash_flow)} subtitle={`Opening cash ${fmt(first.opening_cash)}`} variant={(totals.net_cash_flow || 0) >= 0 ? 'default' : 'danger'} />
        <StatsCard title="Closing cash" value={fmt(last.closing_cash)} subtitle={last.period ? formatPeriod(last.period) : ''} variant={(last.closing_cash || 0) >= 0 ? 'primary' : 'danger'} />
      </div>

      <StatementTable rows={CASH_FLOW_ROWS} columns={columns} firstColumnLabel="Cash flow statement" testId="cash-flow-table" />
    </div>
  );
};

export default CashFlowStatement;
