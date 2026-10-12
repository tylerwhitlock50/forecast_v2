import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import IncomeStatement, { INCOME_STATEMENT_ROWS, detailFigures } from '../components/IncomeStatement';

const month = (period, extra = {}) => ({
  period,
  gross_sales: 1110,
  terms_allowance: 22.2,
  chargebacks: 11.1,
  other_allowances: 0,
  excise_tax: 110,
  total_sales_deductions: 143.3,
  revenue: 966.7,
  units_sold: 1,
  cogs_materials: 400,
  cogs_labor: 50,
  cogs_manufacturing: 30,
  factory_overhead: 0,
  other_cogs: 0,
  total_cogs: 480,
  gross_profit: 486.7,
  gross_margin_pct: 50.35,
  commissions: 38.67,
  payroll: 100,
  admin_expense: 0,
  operating_expense: 0,
  depreciation: 0,
  total_operating_expenses: 138.67,
  operating_income: 348.03,
  operating_margin_pct: 36,
  interest_expense: 0,
  pre_tax_income: 348.03,
  income_tax: 73.09,
  net_income: 274.94,
  net_margin_pct: 28.44,
  ...extra
});

const data = {
  by_period: [month('2027-01'), month('2027-02')],
  totals: {
    gross_sales: 2220, terms_allowance: 44.4, chargebacks: 22.2, other_allowances: 0, excise_tax: 220,
    total_sales_deductions: 286.6, revenue: 1933.4, units_sold: 2, total_cogs: 960, gross_profit: 973.4,
    gross_margin_pct: 50.35, commissions: 77.34, net_income: 549.88, net_margin_pct: 28.44
  }
};

const detail = {
  sales_deductions: { rule_count: 3 },
  revenue_by_product: {
    'RFL-100': { unit_id: 'RFL-100', unit_name: 'Ridgeline', gross_sales: 2220, total_sales_deductions: 286.6, revenue: 1933.4, cogs: 960, quantity: 2 }
  },
  revenue_by_customer: {
    'C-1': { customer_id: 'C-1', customer_name: 'Scheels', customer_type: 'Dealer', gross_sales: 2220, total_sales_deductions: 286.6, revenue: 1933.4, cogs: 960, quantity: 2 }
  },
  revenue_by_customer_type: {
    Dealer: { customer_type: 'Dealer', gross_sales: 2220, total_sales_deductions: 286.6, revenue: 1933.4, cogs: 960, quantity: 2 }
  },
  expenses_by_category: {}
};

const renderIS = (props = {}) => render(
  <MemoryRouter>
    <IncomeStatement data={data} periods={['2027-01', '2027-02']} detail={detail} {...props} />
  </MemoryRouter>
);

const rowByLabel = (label) => screen.getAllByRole('row').find(r => within(r).queryByRole('rowheader', { name: label }));
const cells = (label) => within(rowByLabel(label)).getAllByRole('cell');

describe('IncomeStatement rows', () => {
  it('runs gross sales -> deductions -> net sales before COGS, with commissions first in opex', () => {
    const keys = INCOME_STATEMENT_ROWS.map(r => r.key);
    expect(keys.slice(0, 7)).toEqual(['gross_sales', 'terms_allowance', 'chargebacks', 'other_allowances', 'excise_tax', 'total_sales_deductions', 'revenue']);
    expect(keys.indexOf('revenue')).toBeLessThan(keys.indexOf('cogs_header'));
    expect(keys[keys.indexOf('opex_header') + 1]).toBe('commissions');
    expect(INCOME_STATEMENT_ROWS.find(r => r.key === 'revenue').label).toBe('Net sales');
  });

  it('shows deductions in parentheses without the red loss styling', () => {
    renderIS();
    const excise = cells('Excise tax (FET)');
    expect(excise.map(c => c.textContent)).toEqual(['(110)', '(110)', '(220)']);
    expect(excise[0]).not.toHaveClass('text-red-600');
    expect(cells('Total sales deductions').map(c => c.textContent)).toEqual(['(143)', '(143)', '(287)']);
    expect(cells('Net sales').map(c => c.textContent)).toEqual(['967', '967', '1,933']);
    expect(cells('Sales commissions').map(c => c.textContent)).toEqual(['39', '39', '77']);
    // Zero rows stay visible.
    expect(cells('Other discounts & allowances').map(c => c.textContent)).toEqual(['0', '0', '0']);
  });

  it('headlines gross sales, net sales with the deduction rate, gross margin and net income', () => {
    renderIS();
    expect(screen.getByText('$2,220')).toBeInTheDocument();
    expect(screen.getByText('$1,933')).toBeInTheDocument();
    expect(screen.getByText('Deductions 12.9% of gross')).toBeInTheDocument();
    expect(screen.getByText('Gross profit $973')).toBeInTheDocument();
    expect(screen.getByText('$550')).toBeInTheDocument();
  });

  it('points to Pricing & Deductions only when no deduction rules exist', () => {
    renderIS();
    expect(screen.queryByTestId('no-deduction-rules-note')).not.toBeInTheDocument();
  });

  it('shows a note linking to /pricing when no rules are set up', () => {
    renderIS({ detail: { ...detail, sales_deductions: { rule_count: 0 } } });
    const note = screen.getByTestId('no-deduction-rules-note');
    expect(note).toHaveTextContent('net sales equal gross sales');
    expect(within(note).getByRole('link')).toHaveAttribute('href', '/pricing');
  });

  it('breaks sales down by product, customer type and customer with gross, deductions and net', () => {
    renderIS();
    fireEvent.click(screen.getByRole('button', { name: /Breakdowns/ }));
    const byType = screen.getByTestId('revenue-by-customer-type');
    expect(within(byType).getAllByRole('row')[1].textContent).toContain('Dealer');
    expect(within(byType).getAllByRole('row')[1].textContent).toContain('(287)');
    const byCustomer = screen.getByTestId('revenue-by-customer');
    expect(within(byCustomer).getByText('Scheels')).toBeInTheDocument();
    const byProduct = screen.getByTestId('revenue-by-product');
    expect(within(byProduct).getAllByRole('row')[1].textContent).toContain('973'); // gross profit = net - COGS
  });
});

describe('IncomeStatement labor lines', () => {
  const withLabor = {
    by_period: [
      month('2027-01', { cogs_labor: 3000, labor_variance: 1333.33, indirect_labor: 5000, payroll: 9000 }),
      month('2027-02', { cogs_labor: 6000, labor_variance: -1666.67, indirect_labor: 5000, payroll: 9000 })
    ],
    totals: { ...data.totals, cogs_labor: 9000, labor_variance: -333.34, indirect_labor: 10000, payroll: 18000 }
  };

  it('lists the routing standard, the payroll variance and indirect labor inside COGS', () => {
    const keys = INCOME_STATEMENT_ROWS.map(r => r.key);
    expect(keys.indexOf('cogs_labor')).toBeLessThan(keys.indexOf('labor_variance'));
    expect(keys.indexOf('labor_variance')).toBeLessThan(keys.indexOf('total_cogs'));
    expect(keys.indexOf('indirect_labor')).toBeLessThan(keys.indexOf('total_cogs'));
    expect(keys.indexOf('payroll')).toBeGreaterThan(keys.indexOf('opex_header'));
    const help = Object.fromEntries(INCOME_STATEMENT_ROWS.map(r => [r.key, r.help]));
    expect(help.labor_variance).toMatch(/classed Direct/);
    expect(help.indirect_labor).toMatch(/classed Indirect/);
    expect(help.payroll).toMatch(/Admin or not classified/);
  });

  it('shows the new lines with a negative variance in parentheses', () => {
    renderIS({ data: withLabor });
    expect(cells('Direct labor (standard)').map(c => c.textContent)).toEqual(['3,000', '6,000', '9,000']);
    expect(cells('Direct labor variance (payroll vs standard)').map(c => c.textContent)).toEqual(['1,333', '(1,667)', '(333)']);
    expect(cells('Indirect labor (factory)').map(c => c.textContent)).toEqual(['5,000', '5,000', '10,000']);
    expect(cells('Payroll').map(c => c.textContent)).toEqual(['9,000', '9,000', '18,000']);
  });
});

describe('detailFigures', () => {
  it('treats revenue as net sales and falls back when gross is missing (older API)', () => {
    expect(detailFigures({ revenue: 100, cogs: 40, quantity: 2 })).toEqual({ units: 2, gross: 100, deductions: 0, net: 100, cogs: 40, gp: 60, gpPct: 60 });
    expect(detailFigures({ gross_sales: 111, revenue: 100, cogs: 0 }).deductions).toBe(11);
  });
});
