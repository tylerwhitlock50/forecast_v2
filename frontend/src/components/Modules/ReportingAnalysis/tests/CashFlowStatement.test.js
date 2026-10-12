import React from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import CashFlowStatement from '../components/CashFlowStatement';

const row = (period, opening, net) => ({
  period,
  net_income: net,
  depreciation: 0,
  change_in_accounts_receivable: 0,
  change_in_inventory: 0,
  change_in_accounts_payable: 0,
  operating_cash_flow: net,
  capex: 0,
  investing_cash_flow: 0,
  loan_proceeds: 0,
  principal_payments: 0,
  financing_cash_flow: 0,
  net_cash_flow: net,
  opening_cash: opening,
  closing_cash: opening + net,
  interest_paid: 0,
  taxes_paid: 0
});

const byPeriod = [row('2026-01', 5000, 1000), row('2026-02', 6000, -500), row('2026-03', 5500, 2000)];
// What the API sends: flows summed, balances carried (never a sum of monthly balances).
const data = {
  by_period: byPeriod,
  totals: { net_income: 2500, operating_cash_flow: 2500, net_cash_flow: 2500, capex: 0, financing_cash_flow: 0, opening_cash: 5000, closing_cash: 7500 },
  reconciliation: { opening_cash: 5000, net_cash_flow: 2500, closing_cash: 7500, difference: 0 }
};

const rowByLabel = (label) => screen.getAllByRole('row').find(r => within(r).queryByRole('rowheader', { name: label }));
const cells = (label) => within(rowByLabel(label)).getAllByRole('cell').map(c => c.textContent);

describe('CashFlowStatement aggregation', () => {
  it('sums movements but shows the final closing balance in the Total column', () => {
    render(<CashFlowStatement data={data} />);
    expect(cells('Net change in cash')).toEqual(['1,000', '(500)', '2,000', '2,500']);
    expect(cells('Opening cash')).toEqual(['5,000', '6,000', '5,500', '5,000']);
    // 7,500 is March's closing cash; 19,000 would be the (wrong) sum of monthly closing balances.
    expect(cells('Closing cash')).toEqual(['6,000', '5,500', '7,500', '7,500']);
    expect(screen.getByTestId('cash-reconciliation')).toHaveTextContent('Opening cash $5,000 + net change $2,500 = closing cash $7,500 (reconciles)');
  });

  it('falls back to the rows when the API sends summed balances and flags a mismatch', () => {
    const bad = { by_period: byPeriod, totals: { ...data.totals, opening_cash: 16500, closing_cash: 19000, net_cash_flow: 2000 } };
    render(<CashFlowStatement data={bad} />);
    expect(cells('Closing cash')[3]).toBe('7,500');
    expect(cells('Opening cash')[3]).toBe('5,000');
    expect(screen.getByTestId('cash-reconciliation')).toHaveTextContent('does not reconcile by -$500');
    expect(screen.getByTestId('cash-reconciliation')).toHaveClass('text-red-600');
  });
});

describe('CashFlowStatement excise tax payable', () => {
  it('shows the change in excise tax payable inside operating activities', () => {
    const withExcise = { ...data, by_period: byPeriod.map(r => ({ ...r, change_in_excise_tax_payable: 150 })), totals: { ...data.totals, change_in_excise_tax_payable: 450 } };
    render(<CashFlowStatement data={withExcise} />);
    expect(cells('Change in excise tax payable')).toEqual(['150', '150', '150', '450']);
    const labels = screen.getAllByRole('rowheader').map(th => th.textContent);
    expect(labels.indexOf('Change in excise tax payable')).toBeLessThan(labels.indexOf('Cash from operations'));
  });
});

