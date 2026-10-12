import React from 'react';
import { render, screen, within, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import PayrollForecast from './PayrollForecast';

// Pay runs as the API returns them (date-only strings), shaped like PayrollManagementNew does.
const forecast = [
  { period: 1, date: '2026-01-30', month: '2026-01', totalCost: 1000, employeeCount: 2, employeeDetails: [] },
  { period: 2, date: '2026-02-28', month: '2026-02', totalCost: 1000, employeeCount: 2, employeeDetails: [] },
  { period: 3, date: '2026-03-31', totalCost: 1000, employeeCount: 2, employeeDetails: [] } // no server month: derive from the string
];

describe('PayrollForecast calendar handling', () => {
  it('shows pay dates on the day they name and groups month-end runs into their own month', () => {
    render(<PayrollForecast forecast={forecast} forecastHorizon={13} onHorizonChange={() => {}} />);

    // Table dates: a month-end pay date must never render as the day before.
    expect(screen.getAllByText('Mar 31, 2026').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Feb 28, 2026').length).toBeGreaterThan(0);
    expect(screen.queryByText('Mar 30, 2026')).not.toBeInTheDocument();
    expect(screen.queryByText('Feb 27, 2026')).not.toBeInTheDocument();

    // Monthly summary: one run in each of Jan, Feb and Mar; nothing leaks into the prior month.
    expect(screen.getByText('January 2026')).toBeInTheDocument();
    expect(screen.getByText('February 2026')).toBeInTheDocument();
    expect(screen.getByText('March 2026')).toBeInTheDocument();
    expect(screen.queryByText('December 2025')).not.toBeInTheDocument();
    expect(screen.getAllByText('1 payrolls • 2 avg employees')).toHaveLength(3);
    expect(screen.getByText(/Cash basis: pay runs are grouped by pay date/)).toBeInTheDocument();
  });
});

describe('PayrollForecast horizon and statement bridge', () => {
  const bridge = {
    frequency: 'biweekly', runsPerYear: 26, start: '2027-01', end: '2027-12', opening: 1931.43, closing: -148.57, note: '',
    rows: Array.from({ length: 12 }, (_, i) => ({
      period: `2027-${String(i + 1).padStart(2, '0')}`, accrued: 4506.67, paid: i === 0 ? 6240 : 4160,
      payRuns: i === 0 ? 3 : 2, difference: i === 0 ? -1733.33 : 346.67, balance: 198.1 + i
    })),
    totals: { accrued: 54080, paid: 56160, payRuns: 27, difference: -2080 }
  };

  it('offers 6 months / 1 year / 2 years of runs for the pay frequency, 1 year selected', () => {
    const onHorizonChange = jest.fn();
    render(<PayrollForecast forecast={forecast} forecastHorizon={12} runsPerYear={12} payFrequency="monthly" onHorizonChange={onHorizonChange} />);
    const select = screen.getByLabelText('Forecast horizon');
    expect(select).toHaveValue('12');
    expect(screen.getByRole('option', { name: '1 year (12 pay runs)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '6 months (6 pay runs)' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: '24' } });
    expect(onHorizonChange).toHaveBeenCalledWith(24);
  });

  it('shows statement payroll against pay dates, the amount owed at month end and the extra payday', () => {
    const onBridgeWindowChange = jest.fn();
    render(<PayrollForecast forecast={forecast} forecastHorizon={26} runsPerYear={26} payFrequency="biweekly" onHorizonChange={() => {}}
      bridge={bridge} bridgeWindow={{ start: '2027-01', end: '2027-12' }} onBridgeWindowChange={onBridgeWindowChange} />);
    const table = screen.getByTestId('payroll-bridge-table');
    const rows = within(table).getAllByRole('row');
    expect(rows[1].textContent).toContain('Earned before Jan 2027');
    expect(rows[1].textContent).toContain('$1,931');
    expect(rows[2].textContent).toContain('Jan 2027');
    expect(rows[2].textContent).toContain('$4,507');
    expect(rows[2].textContent).toContain('$6,240');
    expect(rows[2].textContent).toContain('($1,733)');
    expect(rows[rows.length - 1].textContent).toContain('27');
    expect(screen.getByTestId('extra-payday-note')).toHaveTextContent('27 pay dates, one more than a usual year (26)');
    fireEvent.change(screen.getByLabelText('Bridge from month'), { target: { value: '2027-03' } });
    expect(onBridgeWindowChange).toHaveBeenCalledWith({ start: '2027-03', end: '2027-12' });
  });
});
