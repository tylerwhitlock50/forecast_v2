import React from 'react';
import { render, screen } from '@testing-library/react';
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
