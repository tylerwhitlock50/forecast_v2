import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import ScenariosPage from './ScenariosPage';

jest.mock('./governanceApi', () => ({
  approveScenario: jest.fn(),
  unlockScenario: jest.fn(),
  fetchApprovals: jest.fn(() => Promise.resolve([])),
}));
jest.mock('../../Common/ConfirmDialog', () => ({ useConfirm: () => jest.fn() }));

const mockForecast = {
  scenarios: {
    F001: {
      id: 'F001', name: '2027 Budget', is_base: true, locked: true, status: 'approved',
      approved_by: 'Dana CFO', approved_at: '2026-10-12T15:21:51Z', start_period: '2027-01', end_period: '2027-12',
      sales_rows: 744, revenue_total: 1000000,
      drift: { changed: true, items: [{ line: 'gross_profit', label: 'Gross profit', approved: 100000, current: 97000, delta: -3000 }] },
    },
    F002: { id: 'F002', name: 'Upside', is_base: false, locked: false, status: 'draft', start_period: '2027-01', end_period: '2027-12', revenue_total: 1200000 },
  },
  activeScenario: 'F001',
  actions: { switchScenario: jest.fn(), fetchScenarios: jest.fn() },
  lastUpdated: new Date(),
  error: null,
};
jest.mock('../../../context/ForecastContext', () => ({ useForecast: () => mockForecast }));

const renderPage = () => render(<MemoryRouter><ScenariosPage /></MemoryRouter>);

describe('ScenariosPage approvals', () => {
  it('shows status badges, the approver and the drift warning', () => {
    renderPage();
    const table = screen.getByTestId('scenario-table');
    const statuses = within(table).getAllByTestId('scenario-status').map((el) => el.textContent);
    expect(statuses).toEqual(['Approved & locked', 'Draft']);
    expect(within(table).getByText(/^Approved by Dana CFO on Oct 1[23], 2026$/)).toBeInTheDocument();
    const drift = within(table).getByTestId('drift-warning');
    expect(drift).toHaveTextContent('The numbers have moved since this scenario was approved');
    expect(drift).toHaveTextContent('Gross profit');
    expect(drift).toHaveTextContent('(−$3,000)');
  });

  it('offers Unlock and Approvals instead of Edit and Delete on a locked scenario', () => {
    renderPage();
    const table = screen.getByTestId('scenario-table');
    const [lockedRows, draftRows] = within(table).getAllByRole('rowgroup').slice(1);
    expect(within(lockedRows).getByRole('button', { name: 'Unlock…' })).toBeInTheDocument();
    expect(within(lockedRows).getByRole('button', { name: 'Approvals' })).toBeInTheDocument();
    expect(within(lockedRows).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(within(lockedRows).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(within(draftRows).getByRole('button', { name: 'Approve & lock' })).toBeInTheDocument();
    expect(within(draftRows).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('opens the approve dialog for a draft', () => {
    renderPage();
    const table = screen.getByTestId('scenario-table');
    const draftRows = within(table).getAllByRole('rowgroup')[2];
    fireEvent.click(within(draftRows).getByRole('button', { name: 'Approve & lock' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Approve & lock “Upside”');
  });

  it('renders cards (no wide table) for narrow screens with the same information', () => {
    renderPage();
    const cards = screen.getByTestId('scenario-cards');
    expect(cards).toHaveClass('md:hidden');
    expect(within(cards).getAllByTestId('scenario-status')).toHaveLength(2);
    expect(within(cards).getByTestId('drift-warning')).toBeInTheDocument();
    expect(screen.getByTestId('scenario-table').closest('.hidden')).toHaveClass('md:block');
  });
});

describe('ScenariosPage while loading', () => {
  it('shows a placeholder instead of "No scenarios yet" until the first load finishes', () => {
    const saved = { scenarios: mockForecast.scenarios, lastUpdated: mockForecast.lastUpdated };
    mockForecast.scenarios = {};
    mockForecast.lastUpdated = null;
    try {
      renderPage();
      expect(screen.getByTestId('scenarios-loading')).toBeInTheDocument();
      expect(screen.queryByText('No scenarios yet')).not.toBeInTheDocument();
    } finally {
      Object.assign(mockForecast, saved);
    }
  });
});
