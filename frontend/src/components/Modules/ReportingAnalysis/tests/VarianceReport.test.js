import React from 'react';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import VarianceReport, { buildActualsTemplate } from '../components/VarianceReport';
import api from '../../../../lib/apiClient';

jest.mock('../../../../lib/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    upload: jest.fn()
  }
}));

const variancePayload = {
  forecast_ids: ['F001'],
  periods: ['2026-01', '2026-02', '2026-03'],
  periods_with_actuals: ['2026-01', '2026-02'],
  warnings: [],
  line_items: [
    {
      line_item: 'revenue',
      label: 'Revenue',
      direction: 'income',
      statement: 'income',
      has_actuals: true,
      by_period: [
        { period: '2026-01', budget: 100000, actual: 110000, variance: 10000, variance_pct: 10, favorable: true },
        { period: '2026-02', budget: 100000, actual: 95000, variance: -5000, variance_pct: -5, favorable: false },
        { period: '2026-03', budget: 100000, actual: null, variance: null, variance_pct: null, favorable: null }
      ],
      totals: { budget_full_period: 300000, budget_to_date: 200000, actual_to_date: 205000, variance_to_date: 5000, variance_pct_to_date: 2.5, favorable: true }
    },
    {
      line_item: 'payroll',
      label: 'Payroll',
      direction: 'expense',
      statement: 'income',
      has_actuals: true,
      by_period: [
        { period: '2026-01', budget: 40000, actual: 38000, variance: -2000, variance_pct: -5, favorable: true },
        { period: '2026-02', budget: 40000, actual: 43000, variance: 3000, variance_pct: 7.5, favorable: false },
        { period: '2026-03', budget: 40000, actual: null, variance: null, variance_pct: null, favorable: null }
      ],
      totals: { budget_full_period: 120000, budget_to_date: 80000, actual_to_date: 81000, variance_to_date: 1000, variance_pct_to_date: 1.25, favorable: false }
    },
    {
      line_item: 'capex',
      label: 'Capital expenditures',
      direction: 'expense',
      statement: 'cash_flow',
      has_actuals: false,
      by_period: [
        { period: '2026-01', budget: 5000, actual: null, variance: null, variance_pct: null, favorable: null },
        { period: '2026-02', budget: 5000, actual: null, variance: null, variance_pct: null, favorable: null },
        { period: '2026-03', budget: 5000, actual: null, variance: null, variance_pct: null, favorable: null }
      ],
      totals: { budget_full_period: 15000, budget_to_date: 10000, actual_to_date: null, variance_to_date: null, variance_pct_to_date: null, favorable: null }
    }
  ]
};

const lineItemsPayload = {
  line_items: [
    { line_item: 'revenue', label: 'Revenue', direction: 'income', statement: 'income' },
    { line_item: 'payroll', label: 'Payroll', direction: 'expense', statement: 'income' },
    { line_item: 'capex', label: 'Capital expenditures', direction: 'expense', statement: 'cash_flow' }
  ]
};

const actualsFor = (period) => ({
  actuals: period === '2026-02'
    ? [
        { actual_id: 'ACT-1', period: '2026-02', line_item: 'revenue', amount: 95000, reference_id: '', source: 'manual' },
        { actual_id: 'ACT-2', period: '2026-02', line_item: 'payroll', amount: 43000, reference_id: '', source: 'manual' }
      ]
    : []
});

const mockGet = (url) => {
  if (url.startsWith('/reporting/variance')) return Promise.resolve({ status: 'success', data: variancePayload });
  if (url.startsWith('/reporting/actuals/line-items')) return Promise.resolve({ status: 'success', data: lineItemsPayload });
  if (url.startsWith('/reporting/actuals?')) {
    const period = new URLSearchParams(url.split('?')[1]).get('start_period');
    return Promise.resolve({ status: 'success', data: actualsFor(period) });
  }
  return Promise.reject(new Error(`unexpected GET ${url}`));
};

const rowFor = (lineItem) => screen.getByTestId(`variance-row-${lineItem}`);

describe('VarianceReport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.get.mockImplementation(mockGet);
    api.post.mockResolvedValue({ status: 'success', data: { saved: 2 }, message: 'Saved' });
    api.delete.mockResolvedValue({ status: 'success', data: { deleted: 2 }, message: 'Deleted' });
  });

  it('fetches variance for the forecasts and period, defaulting to the latest period with actuals', async () => {
    render(<VarianceReport forecastIds={['F001']} period={{ start: '2026-01', end: '2026-03' }} />);

    await screen.findByTestId('variance-table');
    expect(api.get).toHaveBeenCalledWith(
      expect.stringContaining('/reporting/variance?forecast_ids=F001&start_period=2026-01&end_period=2026-03'),
      expect.objectContaining({ suppressErrorToast: true })
    );

    await waitFor(() => expect(screen.getByLabelText('Period')).toHaveValue('2026-02'));
  });

  it('renders budget, actual, variance and favourable/unfavourable styling', async () => {
    render(<VarianceReport forecastIds={['F001']} period={{ start: '2026-01', end: '2026-03' }} />);
    await waitFor(() => expect(screen.getByLabelText('Period')).toHaveValue('2026-02'));

    const revenue = rowFor('revenue');
    const revenueCells = within(revenue).getAllByRole('cell').map(c => c.textContent);
    expect(revenueCells.slice(0, 6)).toEqual(['Revenue', 'Income statement', '100,000', '95,000', '(5,000)', '-5.0%']);
    expect(screen.getByTestId('variance-revenue')).toHaveClass('text-red-600');
    expect(within(revenue).getByText('Unfav')).toBeInTheDocument();

    // Switch to January: revenue favourable, shown in green
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '2026-01' } });
    const revenueJan = rowFor('revenue');
    const janCells = within(revenueJan).getAllByRole('cell').map(c => c.textContent);
    expect(janCells.slice(2, 6)).toEqual(['100,000', '110,000', '10,000', '10.0%']);
    expect(screen.getByTestId('variance-revenue')).toHaveClass('text-green-600');
    expect(within(revenueJan).getByText('Fav')).toBeInTheDocument();

    // Expense line: under budget is favourable
    const payroll = rowFor('payroll');
    expect(screen.getByTestId('variance-payroll')).toHaveClass('text-green-600');
    expect(within(payroll).getByText('Fav')).toBeInTheDocument();
  });

  it('shows dashes for line items without actuals and a to-date block', async () => {
    render(<VarianceReport forecastIds={['F001']} period={{ start: '2026-01', end: '2026-03' }} />);
    await waitFor(() => expect(screen.getByLabelText('Period')).toHaveValue('2026-02'));

    const capex = rowFor('capex');
    const cells = within(capex).getAllByRole('cell').map(c => c.textContent);
    expect(cells.slice(2, 6)).toEqual(['5,000', '—', '—', '—']);

    const revenueToDate = screen.getByTestId('variance-to-date-row-revenue');
    const tdCells = within(revenueToDate).getAllByRole('cell').map(c => c.textContent);
    expect(tdCells.slice(1, 6)).toEqual(['300,000', '200,000', '205,000', '5,000', '2.5%']);
  });

  it('prefills the entry form from existing actuals and posts entries on save', async () => {
    render(<VarianceReport forecastIds={['F001']} period={{ start: '2026-01', end: '2026-03' }} />);
    await waitFor(() => expect(screen.getByLabelText(/^Revenue/)).toHaveValue(95000));
    expect(screen.getByLabelText(/^Payroll/)).toHaveValue(43000);

    fireEvent.change(screen.getByLabelText(/^Revenue/), { target: { value: '99000' } });
    fireEvent.click(screen.getByText('Save actuals'));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe('/reporting/actuals');
    expect(body.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ period: '2026-02', line_item: 'revenue', amount: 99000 }),
        expect.objectContaining({ period: '2026-02', line_item: 'payroll', amount: 43000 })
      ])
    );
    expect(body.entries.find(e => e.line_item === 'capex')).toBeUndefined();
    await screen.findByText(/Saved 2 actual/);
  });

  it('clears a period after confirmation', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    render(<VarianceReport forecastIds={['F001']} period={{ start: '2026-01', end: '2026-03' }} />);
    await waitFor(() => expect(screen.getByLabelText('Period')).toHaveValue('2026-02'));

    fireEvent.click(screen.getByText('Clear period'));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/reporting/actuals?period=2026-02'));
    confirmSpy.mockRestore();
  });

  it('builds a CSV template with the line item keys', () => {
    const csv = buildActualsTemplate(lineItemsPayload.line_items, '2026-02');
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('period,line_item,amount,reference_id,notes');
    expect(lines).toContain('2026-02,revenue,,,');
    expect(lines).toContain('2026-02,capex,,,');
  });
});
