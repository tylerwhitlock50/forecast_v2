import React from 'react';
import { StatsCard } from '../../../ui/stats-card';
import { Badge } from '../../../ui/badge';
import StatementTable from './StatementTable';
import { formatCurrency, formatPeriod } from '../utils/formatters';

export const BALANCE_SHEET_ROWS = [
  { key: 'assets_header', label: 'Assets', kind: 'header' },
  { key: 'cash', label: 'Cash', kind: 'line', indent: 1 },
  { key: 'accounts_receivable', label: 'Accounts receivable', kind: 'line', indent: 1 },
  { key: 'inventory', label: 'Inventory', kind: 'line', indent: 1 },
  { key: 'total_current_assets', label: 'Total current assets', kind: 'subtotal' },
  { key: 'fixed_assets_gross', label: 'Fixed assets, gross', kind: 'line', indent: 1 },
  { key: 'accumulated_depreciation', label: 'Accumulated depreciation', kind: 'line', indent: 1, negate: true },
  { key: 'fixed_assets_net', label: 'Fixed assets, net', kind: 'subtotal' },
  { key: 'total_assets', label: 'Total assets', kind: 'total' },
  { key: 'liabilities_header', label: 'Liabilities', kind: 'header' },
  { key: 'accounts_payable', label: 'Accounts payable', kind: 'line', indent: 1 },
  { key: 'other_liabilities', label: 'Other liabilities', kind: 'line', indent: 1 },
  { key: 'total_current_liabilities', label: 'Total current liabilities', kind: 'subtotal' },
  { key: 'debt', label: 'Debt', kind: 'line', indent: 1 },
  { key: 'total_liabilities', label: 'Total liabilities', kind: 'subtotal' },
  { key: 'equity_header', label: 'Equity', kind: 'header' },
  { key: 'opening_equity', label: 'Opening equity', kind: 'line', indent: 1 },
  { key: 'retained_earnings', label: 'Retained earnings', kind: 'line', indent: 1 },
  { key: 'total_equity', label: 'Total equity', kind: 'subtotal' },
  { key: 'total_liabilities_and_equity', label: 'Total liabilities & equity', kind: 'total' },
  { key: 'balance_check', label: 'Balance check (assets − L&E)', kind: 'line' },
  { key: 'working_capital', label: 'Working capital', kind: 'line' }
];

const num = (v) => (typeof v === 'number' ? v : parseFloat(v) || 0);

// The opening row from the API carries base balances plus `equity`; derive
// the subtotal keys so it lines up with the period rows.
export const normalizeOpening = (opening) => {
  if (!opening) return null;
  const cash = num(opening.cash);
  const ar = num(opening.accounts_receivable);
  const inv = num(opening.inventory);
  const ap = num(opening.accounts_payable);
  const other = num(opening.other_liabilities);
  const equity = opening.equity !== undefined ? num(opening.equity) : num(opening.total_equity);
  const totalAssets = opening.total_assets !== undefined ? num(opening.total_assets) : cash + ar + inv + num(opening.fixed_assets_net);
  const totalLiab = opening.total_liabilities !== undefined ? num(opening.total_liabilities) : ap + other + num(opening.debt);
  return {
    ...opening,
    total_current_assets: opening.total_current_assets ?? cash + ar + inv,
    total_current_liabilities: opening.total_current_liabilities ?? ap + other,
    opening_equity: opening.opening_equity ?? equity,
    retained_earnings: opening.retained_earnings ?? 0,
    total_equity: opening.total_equity ?? equity,
    total_liabilities_and_equity: opening.total_liabilities_and_equity ?? totalLiab + equity,
    balance_check: opening.balance_check ?? totalAssets - totalLiab - equity,
    working_capital: opening.working_capital ?? (cash + ar + inv) - (ap + other)
  };
};

export const isBalanced = (rows, tolerance = 0.01) =>
  rows.length > 0 && rows.every(r => Math.abs(num(r.balance_check)) < tolerance);

const fmt = (v) => formatCurrency(v, { maximumFractionDigits: 0, minimumFractionDigits: 0 });

const BalanceSheet = ({ data }) => {
  if (!data || !data.by_period) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>No balance sheet data available</p>
      </div>
    );
  }

  const opening = normalizeOpening(data.opening);
  const columns = [];
  if (opening) {
    columns.push({ key: 'opening', label: `Opening${opening.period ? ` (${formatPeriod(opening.period)})` : ''}`, values: opening, emphasis: true });
  }
  data.by_period.forEach(row => columns.push({ key: row.period, values: row }));

  const closing = data.closing || data.by_period[data.by_period.length - 1] || {};
  const allRows = [...(opening ? [opening] : []), ...data.by_period];
  const balanced = isBalanced(allRows);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Closing cash" value={fmt(closing.cash)} subtitle={closing.period ? formatPeriod(closing.period) : ''} variant={(closing.cash || 0) >= 0 ? 'primary' : 'danger'} />
        <StatsCard title="Total assets" value={fmt(closing.total_assets)} subtitle={`Net fixed assets ${fmt(closing.fixed_assets_net)}`} />
        <StatsCard title="Debt" value={fmt(closing.debt)} subtitle={`Total liabilities ${fmt(closing.total_liabilities)}`} variant="warning" />
        <StatsCard title="Working capital" value={fmt(closing.working_capital)} subtitle={`Equity ${fmt(closing.total_equity)}`} variant={(closing.working_capital || 0) >= 0 ? 'success' : 'danger'} />
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-gray-600">
          {opening?.equity_plugged && (
            <span>Opening equity was plugged so the opening balance sheet balances. </span>
          )}
        </div>
        {balanced ? (
          <Badge variant="success" data-testid="balance-badge">Balanced — every period checks to within $0.01</Badge>
        ) : (
          <Badge variant="destructive" data-testid="balance-badge">Out of balance — see the balance check row</Badge>
        )}
      </div>

      <StatementTable rows={BALANCE_SHEET_ROWS} columns={columns} firstColumnLabel="Balance sheet" testId="balance-sheet-table" />
    </div>
  );
};

export default BalanceSheet;
