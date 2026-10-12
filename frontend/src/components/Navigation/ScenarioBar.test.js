import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import ScenarioBar from './ScenarioBar';

jest.mock('../Modules/Scenarios/governanceApi', () => ({ unlockScenario: jest.fn() }));

let mockForecast;
jest.mock('../../context/ForecastContext', () => ({ useForecast: () => mockForecast }));

const lockedScenario = {
  id: 'F001', name: '2027 Budget', is_base: true, locked: true, status: 'approved',
  approved_by: 'Dana CFO', approved_at: '2026-10-12T15:21:51Z',
};

const renderAt = (path) => render(<MemoryRouter initialEntries={[path]}><ScenarioBar /></MemoryRouter>);

describe('ScenarioBar', () => {
  beforeEach(() => {
    mockForecast = {
      scenarios: { F001: lockedScenario, F002: { id: 'F002', name: 'Upside', locked: false } },
      activeScenario: 'F001',
      actions: { switchScenario: jest.fn(), fetchScenarios: jest.fn(), duplicateScenario: jest.fn() },
      lastUpdated: new Date(),
      error: null,
    };
  });

  it('marks an approved active scenario with a lock and shows the banner on editing screens', () => {
    renderAt('/sales-forecast');
    expect(screen.getByTestId('approved-badge')).toHaveTextContent('Approved');
    const banner = screen.getByTestId('locked-banner');
    expect(banner).toHaveTextContent('2027 Budget is approved and locked');
    expect(banner).toHaveTextContent('Its sales forecast cannot be changed.');
    expect(screen.getByRole('button', { name: 'Branch it to make changes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock…' })).toBeInTheDocument();
  });

  it('explains company-wide rows on mixed screens and stays quiet on reports', () => {
    const { unmount } = renderAt('/payroll');
    expect(screen.getByTestId('locked-banner')).toHaveTextContent('company-wide rows still can');
    unmount();
    renderAt('/reporting');
    expect(screen.queryByTestId('locked-banner')).not.toBeInTheDocument();
    expect(screen.getByTestId('approved-badge')).toBeInTheDocument();
  });

  it('lets its groups wrap instead of pushing the Approved badge off-screen or under "Manage scenarios"', () => {
    renderAt('/payroll');
    const row = screen.getByTestId('scenario-bar').firstElementChild;
    expect(row).toHaveClass('flex-wrap');
    expect(row.className).not.toMatch(/flex-nowrap/);
    // The scenario group may shrink and wrap (phone width): the badge goes to its own line, not past the edge.
    const group = screen.getByTestId('scenario-group');
    expect(group).toContainElement(screen.getByTestId('approved-badge'));
    expect(group).toHaveClass('flex-wrap', 'min-w-0', 'max-w-full');
    expect(group).not.toHaveClass('flex-none');
    // The link group keeps its own width, so it wraps to a new row rather than sliding under the scope badge.
    const actions = screen.getByTestId('scenario-bar-actions');
    expect(actions).toContainElement(screen.getByRole('link', { name: 'Manage scenarios' }));
    expect(actions).toHaveClass('flex-none', 'ml-auto');
    expect(actions.className).not.toMatch(/flex-1|min-w-0/);
  });

  it('shows no lock for a draft', () => {
    mockForecast.activeScenario = 'F002';
    renderAt('/sales-forecast');
    expect(screen.queryByTestId('approved-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('locked-banner')).not.toBeInTheDocument();
  });

  it('shows placeholders, not "No scenarios yet", while the first load runs', () => {
    mockForecast = { ...mockForecast, scenarios: {}, activeScenario: null, lastUpdated: null };
    renderAt('/sales-forecast');
    expect(screen.queryByText('No scenarios yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create a scenario' })).not.toBeInTheDocument();
  });

  it('says there are no scenarios once loading finished', () => {
    mockForecast = { ...mockForecast, scenarios: {}, activeScenario: null };
    renderAt('/sales-forecast');
    expect(screen.getByText('No scenarios yet')).toBeInTheDocument();
  });
});
