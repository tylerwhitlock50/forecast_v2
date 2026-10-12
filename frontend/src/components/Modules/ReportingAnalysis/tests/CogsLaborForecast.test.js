import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import CogsLaborForecast from '../CogsLaborForecast';
import api from '../../../../lib/apiClient';

jest.mock('../../../../lib/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  apiClient: { get: jest.fn() }
}));

let mockForecast;
jest.mock('../../../../context/ForecastContext', () => ({
  useForecast: () => mockForecast
}));

// recharts' ResponsiveContainer measures its parent with ResizeObserver (absent in jsdom): render the chart at a fixed size.
jest.mock('recharts', () => {
  const Original = jest.requireActual('recharts');
  const { cloneElement } = jest.requireActual('react');
  return {
    ...Original,
    ResponsiveContainer: ({ children }) => cloneElement(children, { width: 800, height: 260 })
  };
});

const periods = ['2027-01', '2027-02'];
const month = (period, gross) => ({
  period, units: 1, gross_sales: gross, terms_allowance: 0, chargebacks: 0, other_allowances: 0, excise_tax: gross * 0.11 / 1.11,
  total_sales_deductions: gross * 0.11 / 1.11, net_sales: gross / 1.11, materials: 400, labor: 50, machine: 30, product_cogs: 480,
  factory_overhead: 0, other_cogs: 0, total_cogs: 480, gross_profit: gross / 1.11 - 480, gross_margin_pct: 52
});
const cogsPayload = {
  periods, start_period: '2027-01', end_period: '2027-12', generated_at: '2026-10-12T10:00:00', line_count: 2,
  summary: {
    by_period: [month('2027-01', 1110), month('2027-02', 1110)],
    totals: { units: 2, gross_sales: 2220, total_sales_deductions: 220, net_sales: 2000, total_cogs: 960, gross_profit: 1040, gross_margin_pct: 52 }
  },
  by_product: [{ unit_id: 'RFL-100', unit_name: 'Ridgeline', unit_type: 'Rifle', totals: { units: 2, gross_sales: 2220, total_sales_deductions: 220, net_sales: 2000, product_cogs: 960, contribution_margin: 1040 }, by_period: {} }],
  by_customer: [{ customer_id: 'C-1', customer_name: 'Scheels', customer_type: 'Dealer', totals: { units: 2, gross_sales: 2220, total_sales_deductions: 220, net_sales: 2000, product_cogs: 960, contribution_margin: 1040 }, by_period: {} }],
  by_customer_type: [{ customer_type: 'Dealer', totals: { units: 2, gross_sales: 2220, total_sales_deductions: 220, net_sales: 2000, product_cogs: 960, contribution_margin: 1040 }, by_period: {} }],
  by_product_type: [],
  unit_costs: [],
  warnings: [{ code: 'no_deduction_rules', level: 'info', message: 'No discount rules are set up, so net sales equal gross sales.' }]
};
const laborPayload = {
  periods, hours_per_fte: 173.33, generated_at: '2026-10-12T10:00:00',
  by_labor_type: [{ labor_type_id: 'LR-ASSY', labor_type_name: 'Assembler', hourly_rate: 24.5,
    by_period: { '2027-01': { hours: 173.33, cost: 4246, fte: 1 }, '2027-02': { hours: 346.66, cost: 8493, fte: 2 } },
    totals: { hours: 519.99, cost: 12739, avg_fte: 1.5, peak_fte: 2 } }],
  totals_by_period: [{ period: '2027-01', hours: 173.33, cost: 4246, fte: 1 }, { period: '2027-02', hours: 346.66, cost: 8493, fte: 2 }],
  totals: { hours: 519.99, cost: 12739, avg_fte: 1.5, peak_fte: 2 },
  by_machine: [],
  by_product: [],
  payroll_note: { direct_labor_cost: 12739, payroll_cost: 50000, message: 'Payroll is reported separately as an operating expense.' },
  warnings: []
};

const respond = (cogs = cogsPayload) => {
  api.get.mockImplementation((url) => {
    if (url.startsWith('/reporting/cogs-forecast')) return Promise.resolve({ status: 'success', data: cogs });
    if (url.startsWith('/reporting/labor-forecast')) return Promise.resolve({ status: 'success', data: laborPayload });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
};

const renderPage = () => render(<MemoryRouter><CogsLaborForecast /></MemoryRouter>);

beforeEach(() => {
  jest.clearAllMocks();
  mockForecast = {
    state: { scenarios: { F001: { id: 'F001', name: '2027 Budget', is_base: true, start_period: '2027-03', end_period: '2027-11' } } },
    activeScenario: 'F001'
  };
});

describe('COGS & Labor Forecast page', () => {
  it('opens on the scenario sales window widened to the calendar year', async () => {
    respond();
    renderPage();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/reporting/cogs-forecast?forecast_ids=F001&start_period=2027-01&end_period=2027-12'), expect.anything()));
    expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/reporting/labor-forecast?forecast_ids=F001&start_period=2027-01&end_period=2027-12&hours_per_fte=173.33'), expect.anything());
  });

  it('shows the headline figures, the info note and the gross margin bridge', async () => {
    respond();
    renderPage();
    const kpis = await screen.findByTestId('cogs-kpis');
    expect(within(kpis).getByText('$2,220')).toBeInTheDocument();
    expect(within(kpis).getByText('9.9% of gross sales')).toBeInTheDocument();
    expect(within(kpis).getByText('$1,040')).toBeInTheDocument();
    expect(within(kpis).getByText('520 h')).toBeInTheDocument();
    expect(within(kpis).getByText('1.5 avg FTE · 2.0 peak')).toBeInTheDocument();
    expect(screen.getByText(/net sales equal gross sales/).closest('[data-level="info"]')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const bridge = screen.getByTestId('bridge-table');
    const fet = within(bridge).getAllByRole('row').find(r => r.textContent.startsWith('Excise tax (FET)'));
    expect(fet.textContent).toContain('(110)');
  });

  it('switches to the labor tab with the payroll note', async () => {
    respond();
    renderPage();
    await screen.findByTestId('cogs-kpis');
    fireEvent.click(screen.getByRole('tab', { name: 'Labor' }));
    expect(screen.getByTestId('labor-table')).toHaveTextContent('Assembler');
    expect(screen.getByTestId('payroll-note')).toHaveTextContent('Payroll (operating expense): $50,000');
    fireEvent.click(screen.getByRole('button', { name: 'FTE' }));
    expect(screen.getByTestId('labor-table')).toHaveTextContent('Average');
  });

  it('explains what to do when the window has no sales', async () => {
    respond({ ...cogsPayload, line_count: 0, by_product: [], summary: { by_period: [], totals: { gross_sales: 0 } } });
    renderPage();
    const empty = await screen.findByTestId('cogs-empty');
    expect(empty).toHaveTextContent('No sales in Jan 2027 – Dec 2027');
    expect(within(empty).getByRole('link', { name: 'Import a sales forecast' })).toHaveAttribute('href', '/import');
    expect(within(empty).getByRole('link', { name: 'Open the sales forecast' })).toHaveAttribute('href', '/sales-forecast');
  });

  it('shows an error with a retry when the forecast cannot be built', async () => {
    api.get.mockRejectedValue(Object.assign(new Error('boom'), { userMessage: 'Server error - please try again later' }));
    renderPage();
    expect(await screen.findByText('Could not build the COGS forecast')).toBeInTheDocument();
    expect(screen.getByText('Server error - please try again later')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
