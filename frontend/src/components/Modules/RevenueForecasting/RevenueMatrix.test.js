import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import RevenueMatrix from './RevenueMatrix';
import RevenueForecasting from './RevenueForecastingNew';
import { buildLines, buildPeriods } from './revenueData';

// UI-6: an approved and locked scenario's sales cannot change (the server
// answers 409 SCENARIO_LOCKED). The grid is read-only and 'Add forecast
// line' is disabled, with one note saying why, instead of inviting an edit
// the server refuses.
jest.mock('../../../lib/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(() => Promise.resolve({ data: {} })), post: jest.fn() },
  apiClient: { get: jest.fn() },
}));
jest.mock('react-hot-toast', () => {
  const toast = jest.fn();
  toast.error = jest.fn();
  toast.success = jest.fn();
  return { toast };
});
jest.mock('./GettingStartedCard', () => () => null);

const LOCKED_NOTE = 'Approved and locked: branch it to make changes';

const mockCustomers = [{ customer_id: 'C1', customer_name: 'Acme Dist', customer_type: 'Distributor' }];
const mockProducts = [{ unit_id: 'P1', unit_name: 'Widget', base_price: 50 }];
const mockSales = ['2027-01', '2027-02', '2027-03'].map(period => ({
  customer_id: 'C1', unit_id: 'P1', period, quantity: 12, unit_price: 50, total_revenue: 600, forecast_id: 'F001',
}));

const mockBulkUpdate = jest.fn(() => Promise.resolve());
let mockScenario = {};
jest.mock('../../../context/ForecastContext', () => ({
  useForecast: () => ({
    data: { sales_forecast: mockSales, products: mockProducts, customers: mockCustomers },
    actions: { bulkUpdateForecast: mockBulkUpdate, fetchAllData: jest.fn(), createScenario: jest.fn() },
    loading: false,
    error: null,
    activeScenario: 'F001',
    scenarios: { F001: mockScenario },
  }),
}));

const scenario = (overrides = {}) => ({
  id: 'F001', forecast_id: 'F001', name: '2027 Budget', start_period: '2027-01', end_period: '2027-12', ...overrides,
});
const lockedScenario = () => scenario({ locked: true, status: 'approved', approved_by: 'Dana CFO', approved_at: '2026-10-12T15:21:51Z' });

const lines = buildLines({ sales: mockSales, products: mockProducts, customers: mockCustomers, scenarioId: 'F001' });
const periods = buildPeriods({ start: '2027-01', end: '2027-03' }, 'monthly');
const renderMatrix = (props = {}) => render(
  <RevenueMatrix lines={lines} periods={periods} selectedSegment="all" periodType="monthly" onAddForecastLine={() => {}} {...props} />
);
const janCell = () => document.querySelector('td[data-cell$="::quantity_2027-01"]');

beforeAll(() => {
  // jsdom has no layout; the grid scrolls the selected cell into view.
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  mockBulkUpdate.mockClear();
  mockScenario = scenario();
});

describe('RevenueMatrix on a locked scenario (UI-6)', () => {
  it('is read-only and says why, once', () => {
    mockScenario = lockedScenario();
    renderMatrix();
    expect(screen.getAllByText(LOCKED_NOTE)).toHaveLength(1);
    const cell = janCell();
    expect(cell).toHaveClass('cursor-default');
    expect(cell).not.toHaveClass('cursor-cell');
    // Double-click and typing open no editor, so nothing is sent.
    fireEvent.doubleClick(cell);
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: '9' });
    expect(document.querySelector('td input')).toBeNull();
    expect(mockBulkUpdate).not.toHaveBeenCalled();
    // The "click a cell, type to edit" hint is hidden.
    expect(screen.getByText('Click a cell, type to edit, Enter to save').closest('.invisible, [class*="invisible"]')).not.toBeNull();
  });

  it('offers no "Add a forecast line" button on an empty locked scenario', () => {
    mockScenario = lockedScenario();
    renderMatrix({ lines: [] });
    expect(screen.queryByRole('button', { name: 'Add a forecast line' })).not.toBeInTheDocument();
  });

  it('stays editable on a draft scenario', () => {
    renderMatrix();
    expect(screen.queryByText(LOCKED_NOTE)).not.toBeInTheDocument();
    expect(janCell()).toHaveClass('cursor-cell');
    fireEvent.doubleClick(janCell());
    expect(document.querySelector('td input')).not.toBeNull();
  });
});

describe('Sales Forecast header on a locked scenario (UI-6)', () => {
  const renderPage = () => render(<MemoryRouter><RevenueForecasting /></MemoryRouter>);

  it('disables "Add forecast line" and explains why', () => {
    mockScenario = lockedScenario();
    renderPage();
    const add = screen.getByRole('button', { name: /Add forecast line/ });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute('title', LOCKED_NOTE);
    // One note on the page (the grid's), not one per control.
    expect(screen.getAllByText(LOCKED_NOTE)).toHaveLength(1);
    expect(screen.getByText('Viewing')).toBeInTheDocument();
  });

  it('keeps "Add forecast line" enabled on a draft scenario', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Add forecast line/ })).toBeEnabled();
    expect(screen.getByText('Editing')).toBeInTheDocument();
  });
});
