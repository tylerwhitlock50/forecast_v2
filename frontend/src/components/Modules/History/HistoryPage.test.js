import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import HistoryPage from './HistoryPage';
import { fetchAuditLog, fetchLegacyChecks } from '../Scenarios/governanceApi';
import { auditQuery, localDayToUtc, resultOf } from './historyFormat';

jest.mock('../Scenarios/governanceApi', () => ({
  fetchAuditLog: jest.fn(),
  fetchLegacyChecks: jest.fn(),
}));
const mockForecast = { scenarios: { F001: { id: 'F001', name: '2027 Budget' }, F002: { id: 'F002', name: 'Upside' } } };
jest.mock('../../../context/ForecastContext', () => ({ useForecast: () => mockForecast }));

const entries = [
  { log_id: 3, created_at: '2026-10-12T16:00:00Z', client: 'mcp', actor: null, method: 'TOOL',
    path: '/mcp/tools/forecast_adjust_sales', status: 409, forecast_id: 'F001',
    summary: "MCP tool forecast_adjust_sales refused (409)", body_excerpt: '{"forecast_id": "F001"}', duration_ms: 12 },
  { log_id: 2, created_at: '2026-10-12T15:21:51Z', client: 'web', actor: 'Dana CFO', method: 'POST',
    path: '/forecast/scenario/F001/approve', status: 200, forecast_id: 'F001',
    summary: "Approved and locked scenario '2027 Budget' (F001)", body_excerpt: '{"approved_by": "Dana CFO"}', duration_ms: 900 },
  { log_id: 1, created_at: '2026-10-12T15:00:00Z', client: 'api', actor: null, method: 'PUT',
    path: '/expenses/EXP-1', query: '', status: 200, forecast_id: null, summary: 'Expense updated', duration_ms: 5 },
];

const renderAt = (path = '/history') => render(<MemoryRouter initialEntries={[path]}><HistoryPage /></MemoryRouter>);

describe('historyFormat', () => {
  it('labels results and builds the query', () => {
    expect(resultOf(200).label).toBe('Saved');
    expect(resultOf(409).label).toBe('Refused');
    expect(resultOf(500).label).toBe('Failed');
    expect(localDayToUtc('2026-10-12')).toBe(new Date('2026-10-12T00:00:00').toISOString().slice(0, 19));
    expect(localDayToUtc('2026-10-12', true)).toBe(new Date('2026-10-12T23:59:59').toISOString().slice(0, 19));
    expect(auditQuery({ forecastId: 'F001', client: 'web', status: 'refused', text: ' payroll ', from: '', to: '', since: '2026-10-12T15:21:51Z' }))
      .toEqual({ limit: 50, offset: 0, forecast_id: 'F001', client: 'web', status: 'refused', path_contains: 'payroll',
        since: '2026-10-12T15:21:51Z' });
  });
});

describe('HistoryPage', () => {
  beforeEach(() => {
    fetchAuditLog.mockReset();
    fetchLegacyChecks.mockReset();
    fetchAuditLog.mockResolvedValue({ entries, total_count: 3, has_more: false, clients: ['api', 'mcp', 'web'] });
    fetchLegacyChecks.mockResolvedValue({
      issues: [{ code: 'sales_non_monthly_periods', severity: 'error', title: 'Sales rows that are not in a month',
        detail: 'These rows are left out of every statement.', action: 'Re-import the forecast by month.',
        count: 7, examples: ["F002: 'Q1-2027' x 7"], link: null }],
      counts: { error: 1, warning: 0, info: 0 },
      skipped: [{ code: 'loan_schedules_drifted', reason: 'The loan schedule audit is not available in this version.' }],
    });
  });

  it('lists every change with who, where, scenario, summary and result', async () => {
    renderAt();
    const table = await screen.findByTestId('history-table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('AI assistant (MCP)');
    expect(rows[0]).toHaveTextContent('Refused');
    expect(rows[1]).toHaveTextContent('Dana CFO');
    expect(rows[1]).toHaveTextContent("Approved and locked scenario '2027 Budget' (F001)");
    expect(rows[1]).toHaveTextContent('2027 Budget');
    expect(rows[2]).toHaveTextContent('Company-wide');
    expect(rows[2]).toHaveTextContent('Script / API');
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Details' }));
    expect(within(rows[1]).getByText('POST /forecast/scenario/F001/approve')).toBeInTheDocument();
    expect(screen.getByText('Showing 1–3 of 3 changes')).toBeInTheDocument();
  });

  it('filters by scenario, source and result', async () => {
    renderAt();
    await screen.findByTestId('history-table');
    fireEvent.change(screen.getByLabelText('Scenario'), { target: { value: 'F002' } });
    await waitFor(() => expect(fetchAuditLog).toHaveBeenLastCalledWith({ limit: 50, offset: 0, forecast_id: 'F002' }));
    fireEvent.change(screen.getByLabelText('Made in'), { target: { value: 'mcp' } });
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'refused' } });
    await waitFor(() => expect(fetchAuditLog).toHaveBeenLastCalledWith({
      limit: 50, offset: 0, forecast_id: 'F002', client: 'mcp', status: 'refused' }));
  });

  it('searches after a pause', async () => {
    jest.useFakeTimers();
    try {
      renderAt();
      await act(async () => { await Promise.resolve(); });
      fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'payroll' } });
      await act(async () => { jest.advanceTimersByTime(400); });
      await waitFor(() => expect(fetchAuditLog).toHaveBeenLastCalledWith({ limit: 50, offset: 0, path_contains: 'payroll' }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('starts from ?since= (from a drift warning) and can drop it', async () => {
    renderAt('/history?since=2026-10-12T15:21:51Z');
    await waitFor(() => expect(fetchAuditLog).toHaveBeenCalledWith({ limit: 50, offset: 0, since: '2026-10-12T15:21:51Z' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove the since filter' }));
    await waitFor(() => expect(fetchAuditLog).toHaveBeenLastCalledWith({ limit: 50, offset: 0 }));
  });

  it('shows the legacy data checks with what to do, and checks that were skipped', async () => {
    renderAt();
    const issue = await screen.findByTestId('legacy-issue-sales_non_monthly_periods');
    expect(issue).toHaveTextContent('Error');
    expect(issue).toHaveTextContent('Sales rows that are not in a month');
    expect(issue).toHaveTextContent('What to do: Re-import the forecast by month.');
    expect(issue).toHaveTextContent("F002: 'Q1-2027' x 7");
    expect(issue).toHaveTextContent('and 6 more');
    expect(screen.getByText(/Not checked: The loan schedule audit/)).toBeInTheDocument();
  });

  it('says so when nothing has been recorded yet', async () => {
    fetchAuditLog.mockResolvedValue({ entries: [], total_count: 0, has_more: false });
    renderAt();
    expect(await screen.findByText(/No changes recorded yet/)).toBeInTheDocument();
  });
});
