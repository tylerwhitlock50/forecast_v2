import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import BalanceSheet, { normalizeOpening } from '../components/BalanceSheet';

const balanceRow = (period, cash, extra = {}) => ({
  period, cash, accounts_receivable: 0, inventory: 0, total_current_assets: cash,
  fixed_assets_gross: 1200, accumulated_depreciation: 100, fixed_assets_net: 1100, total_assets: cash + 1100,
  accounts_payable: 0, other_liabilities: 0, total_current_liabilities: 0, debt: 8000, total_liabilities: 8000,
  opening_equity: -3000, retained_earnings: cash + 1100 - 8000 + 3000, total_equity: cash + 1100 - 8000,
  total_liabilities_and_equity: cash + 1100, balance_check: 0, working_capital: cash, ...extra
});

describe('BalanceSheet carry-forward', () => {
  it('explains that the opening column was rolled forward from the opening balances', () => {
    const data = {
      opening: balanceRow('2026-02', 4200, { equity: -3700, equity_plugged: true }),
      by_period: [balanceRow('2026-03', 3900)],
      closing: balanceRow('2026-03', 3900)
    };
    render(<BalanceSheet data={data} carryForward={{ opening_period: '2025-12', balances_as_of: '2026-02', rolled_forward_periods: ['2026-01', '2026-02'], months_rolled_forward: 2 }} />);
    expect(screen.getByText('Opening (Feb 2026)')).toBeInTheDocument();
    expect(screen.getByTestId('carry-forward-note')).toHaveTextContent('carried forward 2 month(s) from the opening balances at Dec 2025');
    expect(screen.getByTestId('balance-badge')).toHaveTextContent('Balanced');
  });

  it('shows no carry-forward note when the window starts at the opening balances', () => {
    const data = { opening: balanceRow('2025-12', 5000, { equity: -1900, equity_plugged: true }), by_period: [balanceRow('2026-01', 4800)], closing: balanceRow('2026-01', 4800) };
    render(<BalanceSheet data={data} carryForward={{ opening_period: '2025-12', balances_as_of: '2025-12', rolled_forward_periods: [], months_rolled_forward: 0 }} />);
    expect(screen.queryByTestId('carry-forward-note')).not.toBeInTheDocument();
  });
});

describe('BalanceSheet excise tax payable', () => {
  it('lists excise tax payable under accounts payable and counts it in the opening liabilities', () => {
    const data = {
      opening: { period: '2026-12', cash: 1000, accounts_receivable: 0, inventory: 0, fixed_assets_net: 0, accounts_payable: 100, other_liabilities: 0, debt: 0, equity: 900 },
      by_period: [balanceRow('2027-01', 3900, { accounts_payable: 0, excise_tax_payable: 250 })],
      closing: balanceRow('2027-01', 3900)
    };
    render(<BalanceSheet data={data} />);
    const labels = screen.getAllByRole('rowheader').map(th => th.textContent);
    expect(labels.indexOf('Excise tax payable')).toBe(labels.indexOf('Accounts payable') + 1);
    const row = screen.getAllByRole('row').find(r => r.textContent.startsWith('Excise tax payable'));
    expect(row.textContent).toContain('250');
    const opening = normalizeOpening({ ...data.opening, excise_tax_payable: 40 });
    expect(opening.total_current_liabilities).toBe(140);
    expect(opening.working_capital).toBe(860);
  });
});

