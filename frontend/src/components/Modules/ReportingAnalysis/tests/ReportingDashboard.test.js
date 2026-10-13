import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ReportingDashboard from '../ReportingDashboard';

jest.mock('../../../../lib/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

let mockScenarios = {};
jest.mock('../../../../context/ForecastContext', () => ({
  useForecast: () => ({
    state: { scenarios: mockScenarios },
    activeScenario: 'F001',
    actions: { switchScenario: jest.fn() },
  }),
}));

jest.mock('../hooks/useReporting', () => ({
  useReporting: () => ({ statements: null, loading: false, error: null, fetchStatements: jest.fn() }),
  buildExportUrl: () => '/api/reporting/statements/export',
}));
jest.mock('../hooks/useCogsLabor', () => ({ downloadWorkbook: jest.fn() }));
jest.mock('../components/ScenarioPicker', () => () => null);
jest.mock('../components/ReportingControls', () => () => null);
jest.mock('../components/VarianceReport', () => () => null);

// The panel itself is covered in AssumptionsPanel.test.js; here only what
// the dashboard hands it.
const mockPanelProps = jest.fn();
jest.mock('../components/AssumptionsPanel', () => (props) => {
  mockPanelProps(props);
  return <div data-testid="assumptions-panel" />;
});

const scenario = (overrides = {}) => ({
  id: 'F001', forecast_id: 'F001', name: '2027 Budget', start_period: '2027-01', end_period: '2027-12', ...overrides,
});

const renderDashboard = () => render(<MemoryRouter><ReportingDashboard /></MemoryRouter>);

beforeEach(() => {
  mockScenarios = { F001: scenario() };
  mockPanelProps.mockClear();
});

describe('ReportingDashboard tab strip (UI-1)', () => {
  it('wraps instead of squeezing five labels into fixed fifths', () => {
    renderDashboard();
    const tablist = screen.getByRole('tablist');
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual([
      'Income Statement', 'Balance Sheet', 'Cash Flow', 'Budget vs Actual', 'Assumptions',
    ]);
    // A fixed five-column grid let nowrap labels spill over each other at
    // phone width; the strip now wraps onto more rows and grows to fit.
    expect(tablist.className).not.toMatch(/(^|\s)grid-cols-5(\s|$)/);
    expect(tablist).toHaveClass('flex-wrap', 'h-auto');
    screen.getAllByRole('tab').forEach(tab => expect(tab).toHaveClass('flex-1'));
  });
});

describe('ReportingDashboard assumptions lock (UI-6)', () => {
  const openAssumptions = () => {
    renderDashboard();
    fireEvent.click(screen.getByRole('tab', { name: 'Assumptions' }));
    expect(screen.getByTestId('assumptions-panel')).toBeInTheDocument();
    return mockPanelProps.mock.calls[mockPanelProps.mock.calls.length - 1][0];
  };

  it('tells the panel the scenario is locked when it is approved and locked', () => {
    mockScenarios = { F001: scenario({ locked: true, approved_by: 'Dana CFO', approved_at: '2026-10-12T15:21:51Z' }) };
    const props = openAssumptions();
    expect(props.forecastId).toBe('F001');
    expect(props.locked).toBe(true);
  });

  it('leaves a draft scenario editable', () => {
    const props = openAssumptions();
    expect(props.locked).toBe(false);
  });
});
