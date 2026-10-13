import React from 'react';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import VarianceReport, { buildActualsTemplate, lineMonthTotals, saveMessage } from '../components/VarianceReport';
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
      coverage: 'complete',
      totals: { budget_full_period: 300000, budget_through_latest_actual: 200000, budget_to_date: 200000, actual_to_date: 205000, variance_to_date: 5000, variance_pct_to_date: 2.5, favorable: true, periods_compared: ['2026-01', '2026-02'], missing_periods: [], coverage: 'complete' }
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
      coverage: 'complete',
      totals: { budget_full_period: 120000, budget_through_latest_actual: 80000, budget_to_date: 80000, actual_to_date: 81000, variance_to_date: 1000, variance_pct_to_date: 1.25, favorable: false, periods_compared: ['2026-01', '2026-02'], missing_periods: [], coverage: 'complete' }
    },
    {
      line_item: 'admin_expense',
      label: 'Admin Expenses',
      direction: 'expense',
      statement: 'income',
      has_actuals: true,
      coverage: 'partial',
      by_period: [
        { period: '2026-01', budget: 1000, actual: null, variance: null, variance_pct: null, favorable: null },
        { period: '2026-02', budget: 1000, actual: 0, variance: -1000, variance_pct: -100, favorable: true },
        { period: '2026-03', budget: 1000, actual: null, variance: null, variance_pct: null, favorable: null }
      ],
      // February was a confirmed zero; January was never entered, so to date is February only.
      totals: { budget_full_period: 3000, budget_through_latest_actual: 2000, budget_to_date: 1000, actual_to_date: 0, variance_to_date: -1000, variance_pct_to_date: -100, favorable: true, periods_compared: ['2026-02'], missing_periods: ['2026-01'], coverage: 'partial' }
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
      coverage: 'none',
      totals: { budget_full_period: 15000, budget_through_latest_actual: 10000, budget_to_date: 0, actual_to_date: null, variance_to_date: null, variance_pct_to_date: null, favorable: null, periods_compared: [], missing_periods: ['2026-01', '2026-02'], coverage: 'none' }
    }
  ],
  actuals_through: '2026-02',
  incomplete_lines: [{ line_item: 'admin_expense', label: 'Admin Expenses', missing_periods: ['2026-01'] }],
  lines_without_actuals: ['capex'],
  period_coverage: [
    { period: '2026-01', lines_entered: 2, lines_total: 4, lines_missing: ['admin_expense', 'capex'], complete: false },
    { period: '2026-02', lines_entered: 3, lines_total: 4, lines_missing: ['capex'], complete: false }
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

let currentVariance = variancePayload;

const mockGet = (url) => {
  if (url.startsWith('/reporting/variance')) return Promise.resolve({ status: 'success', data: currentVariance });
  if (url.startsWith('/reporting/actuals/batches')) return Promise.resolve({ status: 'success', data: { batches: [], total_count: 0 } });
  if (url.startsWith('/reporting/actuals/periods')) return Promise.resolve({ status: 'success', data: { periods: [], closed_periods: [] } });
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
    currentVariance = variancePayload;
    api.get.mockImplementation(mockGet);
    api.post.mockResolvedValue({
      status: 'success',
      data: { outcome: 'imported', written: true, inserted: 0, updated: 2, unchanged: 0, rejected: 0, batch_id: 'ACT-1a2b3c4d' },
      message: 'Imported actuals'
    });
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
    expect(tdCells[7]).toBe('Complete through Feb 2026');

    // A line with no actuals has no budget-to-date comparison either: nothing is compared.
    const capexToDate = within(screen.getByTestId('variance-to-date-row-capex')).getAllByRole('cell').map(c => c.textContent);
    expect(capexToDate.slice(1, 6)).toEqual(['15,000', '—', '—', '—', '—']);
    expect(capexToDate[7]).toBe('No actuals');
  });

  it('distinguishes a missing month from a confirmed zero and shows coverage', async () => {
    render(<VarianceReport forecastIds={['F001']} period={{ start: '2026-01', end: '2026-03' }} />);
    await waitFor(() => expect(screen.getByLabelText('Period')).toHaveValue('2026-02'));

    // February: a confirmed zero actual is compared (variance of the whole budget, favourable).
    const adminFeb = within(rowFor('admin_expense')).getAllByRole('cell').map(c => c.textContent);
    expect(adminFeb.slice(2, 6)).toEqual(['1,000', '0', '(1,000)', '-100.0%']);
    expect(within(rowFor('admin_expense')).getByText('Fav')).toBeInTheDocument();

    // January: never entered, so no actual, no variance, no verdict.
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '2026-01' } });
    const adminJan = within(rowFor('admin_expense')).getAllByRole('cell').map(c => c.textContent);
    expect(adminJan.slice(2, 6)).toEqual(['1,000', '—', '—', '—']);
    expect(screen.getByTestId('period-coverage-note')).toHaveTextContent('Jan 2026: actuals entered for 2 of 4 lines');

    // To date: only February is compared and the gap is called out.
    const adminToDate = within(screen.getByTestId('variance-to-date-row-admin_expense')).getAllByRole('cell').map(c => c.textContent);
    expect(adminToDate.slice(1, 6)).toEqual(['3,000', '1,000', '0', '(1,000)', '-100.0%']);
    expect(adminToDate[7]).toBe('Partial — missing Jan 2026');
    expect(screen.getByTestId('incomplete-actuals-note')).toHaveTextContent('Admin Expenses missing Jan 2026');
    expect(screen.getByText(/latest Feb 2026/)).toBeInTheDocument();
  });

  it('prefills the entry form from existing actuals and posts only the changed lines on save', async () => {
    api.post.mockResolvedValue({
      status: 'success',
      data: { outcome: 'imported', written: true, inserted: 0, updated: 1, unchanged: 0, rejected: 0, replaced: 0, batch_id: 'ACT-1a2b3c4d' },
      message: 'Imported actuals'
    });
    render(<VarianceReport forecastIds={['F001']} period={{ start: '2026-01', end: '2026-03' }} />);
    await waitFor(() => expect(screen.getByLabelText(/^Revenue/)).toHaveValue(95000));
    expect(screen.getByLabelText(/^Payroll/)).toHaveValue(43000);

    fireEvent.change(screen.getByLabelText(/^Revenue/), { target: { value: '99000' } });
    fireEvent.click(screen.getByText('Save actuals'));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [url, body] = api.post.mock.calls[0];
    expect(url).toBe('/reporting/actuals');
    // Payroll is unchanged, so it is not sent; each sent line sets its month total (replace_lines).
    expect(body.entries).toEqual([expect.objectContaining({ period: '2026-02', line_item: 'revenue', amount: 99000 })]);
    expect(body.replace_lines).toBe(true);
    await screen.findByText(/Saved 1 month total for Feb 2026 \(1 changed\)/);
    expect(body.source).toBe('manual');
  });

  it('shows a line total that includes imported amounts and replaces them instead of adding (UI-1)', async () => {
    const imported = {
      actuals: [
        { actual_id: 'ACT-9-0001', period: '2026-02', line_item: 'revenue', amount: 1060000, reference_id: 'GL-JAN', source: 'file import' },
        { actual_id: 'ACT-2', period: '2026-02', line_item: 'payroll', amount: 43000, reference_id: '', source: 'manual' }
      ]
    };
    api.get.mockImplementation((url) => (url.startsWith('/reporting/actuals?')
      ? Promise.resolve({ status: 'success', data: imported })
      : mockGet(url)));
    api.post.mockResolvedValue({
      status: 'success',
      data: { outcome: 'imported', written: true, inserted: 1, updated: 0, unchanged: 0, rejected: 0, replaced: 1, batch_id: 'ACT-5e5e5e5e' },
      message: 'Imported actuals'
    });
    render(<VarianceReport forecastIds={['F001']} period={{ start: '2026-01', end: '2026-03' }} />);

    // The field holds the month total, imported amount included, and says where it comes from.
    await waitFor(() => expect(screen.getByLabelText(/^Revenue/)).toHaveValue(1060000));
    expect(screen.getByTestId('actual-revenue-imported')).toHaveTextContent('Includes imported GL-JAN 1,060,000.00');
    expect(screen.getByTestId('actuals-entry-help')).toHaveTextContent('imported amounts included');
    expect(screen.getByTestId('actuals-entry-help')).toHaveTextContent('replaced by it, not added to');

    fireEvent.change(screen.getByLabelText(/^Revenue/), { target: { value: '1070000' } });
    expect(screen.getByTestId('actual-revenue-imported')).toHaveTextContent('replaced by this total when you save');
    fireEvent.click(screen.getByText('Save actuals'));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = api.post.mock.calls[0];
    expect(body.entries).toEqual([expect.objectContaining({ period: '2026-02', line_item: 'revenue', amount: 1070000, source: 'manual' })]);
    expect(body.replace_lines).toBe(true);
    expect(await screen.findByTestId('actuals-entry-status')).toHaveTextContent('1 imported amount replaced');
    expect(screen.getByTestId('actuals-entry-status')).toHaveTextContent('Import history');
  });

  it('does not post when no line changed', async () => {
    render(<VarianceReport forecastIds={['F001']} period={{ start: '2026-01', end: '2026-03' }} />);
    await waitFor(() => expect(screen.getByLabelText(/^Revenue/)).toHaveValue(95000));
    fireEvent.click(screen.getByText('Save actuals'));
    expect(await screen.findByTestId('actuals-entry-status')).toHaveTextContent('Nothing changed for Feb 2026');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('adds up every reference into the month total', () => {
    expect(lineMonthTotals([
      { line_item: 'revenue', amount: 300000, reference_id: 'JE-101' },
      { line_item: 'revenue', amount: 200000, reference_id: 'JE-102' },
      { line_item: 'revenue', amount: 0.1, reference_id: '' },
      { line_item: 'payroll', amount: 43000, reference_id: '' }
    ])).toEqual({
      revenue: { total: 500000.1, referenced: [{ reference_id: 'JE-101', amount: 300000 }, { reference_id: 'JE-102', amount: 200000 }] },
      payroll: { total: 43000, referenced: [] }
    });
  });

  it('shows why nothing was saved when the save is refused', async () => {
    api.post.mockRejectedValue({
      response: {
        status: 409,
        data: {
          status: 'rejected',
          detail: 'Nothing imported. This would change closed months: Feb 2026 (1 row).',
          data: { outcome: 'rejected', message: 'Nothing imported. This would change closed months: Feb 2026 (1 row).', closed_periods: [{ period: '2026-02', rows: 1 }] }
        }
      }
    });
    render(<VarianceReport forecastIds={['F001']} period={{ start: '2026-01', end: '2026-03' }} />);
    await waitFor(() => expect(screen.getByLabelText(/^Revenue/)).toHaveValue(95000));
    fireEvent.change(screen.getByLabelText(/^Revenue/), { target: { value: '96000' } });
    fireEvent.click(screen.getByText('Save actuals'));
    expect(await screen.findByTestId('actuals-entry-status')).toHaveTextContent('closed months: Feb 2026');
  });

  it('locks a closed month: badge, "(closed)" in the pickers, entry form disabled', async () => {
    currentVariance = { ...variancePayload, closed_periods: ['2026-02'] };
    render(<VarianceReport forecastIds={['F001']} period={{ start: '2026-01', end: '2026-03' }} />);
    await waitFor(() => expect(screen.getByLabelText('Period')).toHaveValue('2026-02'));

    expect(screen.getByTestId('selected-period-closed')).toHaveTextContent('Feb 2026 is closed');
    expect(within(screen.getByLabelText('Period')).getByText(/Feb 2026 • \(closed\)/)).toBeInTheDocument();
    expect(screen.getByTestId('entry-period-closed')).toHaveTextContent('Feb 2026 is closed');
    await waitFor(() => expect(screen.getByLabelText(/^Revenue/)).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Save actuals' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear period' })).toBeDisabled();

    // January is open: the form works again.
    fireEvent.change(screen.getByLabelText('Entry period'), { target: { value: '2026-01' } });
    expect(screen.queryByTestId('entry-period-closed')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Revenue/)).not.toBeDisabled();
  });

  it('opens the import dialog and the close / history tabs', async () => {
    render(<VarianceReport forecastIds={['F001']} period={{ start: '2026-01', end: '2026-03' }} />);
    await screen.findByTestId('variance-table');
    fireEvent.click(screen.getByTestId('open-actuals-import'));
    expect(await screen.findByText('Choose file')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.queryByText('Choose file')).not.toBeInTheDocument());

    fireEvent.click(screen.getByText('Month-end close'));
    await screen.findByTestId('actuals-close-panel');
    expect(api.get).toHaveBeenCalledWith('/reporting/actuals/periods?start_period=2026-01&end_period=2026-03', expect.anything());
    fireEvent.click(screen.getByText('Import history'));
    expect(await screen.findByText(/No actuals have been imported/)).toBeInTheDocument();
  });

  it('describes a save in plain words', () => {
    expect(saveMessage({ outcome: 'imported', inserted: 1, updated: 2 }, '2026-02')).toBe('Saved 3 month totals for Feb 2026 (1 new, 2 changed).');
    expect(saveMessage({ outcome: 'unchanged', inserted: 0, updated: 0, unchanged: 3 }, '2026-02')).toMatch(/Nothing changed for Feb 2026/);
    expect(saveMessage({ outcome: 'imported', inserted: 1, updated: 0, replaced: 2 }, '2026-02'))
      .toBe('Saved 1 month total for Feb 2026 (1 new, 2 imported amounts replaced). Undo the save under Import history to put the imported amounts back.');
  });

  it('counts a month total set only by replacing imported amounts (UI13-2)', () => {
    // Net Sales held GL-JAN-V2 1,060,000 + EXTRA 5,000 + a manual 7,000; typing 7,000 keeps the manual row
    // (unchanged) and replaces the two imported amounts: the month total went from 1,072,000 to 7,000.
    const report = { outcome: 'imported', inserted: 0, updated: 0, unchanged: 1, replaced: 2,
      line_totals: [{ period: '2027-01', line_item: 'revenue', before: 1072000, file_amount: 7000, after: 7000, replaced: true }] };
    expect(saveMessage(report, '2027-01'))
      .toBe('Saved 1 month total for Jan 2027 (2 imported amounts replaced). Undo the save under Import history to put the imported amounts back.');
    expect(saveMessage({ outcome: 'imported', inserted: 1, updated: 1, replaced: 0, line_totals: [
      { before: 0, after: 5, replaced: false }, { before: 3, after: 4, replaced: false }, { before: 9, after: 9, replaced: false }] }, '2027-01'))
      .toBe('Saved 2 month totals for Jan 2027 (1 new, 1 changed).');
  });

  it('clears a period after confirmation', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    render(<VarianceReport forecastIds={['F001']} period={{ start: '2026-01', end: '2026-03' }} />);
    await waitFor(() => expect(screen.getByLabelText('Period')).toHaveValue('2026-02'));

    fireEvent.click(screen.getByText('Clear period'));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/reporting/actuals?period=2026-02', { suppressErrorToast: true }));
    confirmSpy.mockRestore();
  });

  it('builds a CSV template with the line item keys', () => {
    const csv = buildActualsTemplate(lineItemsPayload.line_items, '2026-02');
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('period,line_item,amount,reference_id,notes');
    expect(lines).toContain('2026-02,revenue,,,');
    expect(lines).toContain('2026-02,capex,,,');
  });

  it('puts the sales deductions total in the template, not the detail lines as well', () => {
    const items = [
      { line_item: 'gross_sales' }, { line_item: 'total_sales_deductions' }, { line_item: 'terms_allowance' },
      { line_item: 'chargebacks' }, { line_item: 'other_allowances' }, { line_item: 'excise_tax' },
      { line_item: 'revenue' },
    ];
    const lines = buildActualsTemplate(items, '2027-01').trim().split('\n').slice(1).map(l => l.split(',')[1]);
    expect(lines).toEqual(['gross_sales', 'total_sales_deductions', 'revenue']);
    // Without the total in the catalogue the detail lines stay.
    const detail = buildActualsTemplate(items.filter(i => i.line_item !== 'total_sales_deductions'), '2027-01');
    expect(detail).toContain('2027-01,excise_tax,,,');
  });
});
