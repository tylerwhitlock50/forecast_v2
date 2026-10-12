import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import BusinessUnitAllocation from './BusinessUnitAllocation';
import PayrollReports from './PayrollReports';

// Employees as PayrollManagementNew builds them: allocations parsed to percent,
// annual_gross / annual_cost from GET /payroll/employees.
const employees = [
  { employee_id: 'S1', employee_name: 'Plant Manager', department: 'Admin', rate_type: 'salary', hourly_rate: 120000,
    weekly_hours: 40, status: 'active', annual_gross: 120000, annual_cost: 161700,
    allocations: { 'Customer-Centric Brands': 70, 'Other Projects': 30 } },
  { employee_id: 'H1', employee_name: 'Operator', department: 'Production', rate_type: 'hourly', hourly_rate: 30,
    weekly_hours: 40, status: 'active', annual_gross: 62400, annual_cost: 84084, allocations: { 'OEM Work': 50 } }
];
const businessUnits = ['Customer-Centric Brands', 'OEM Work', 'Internal Operations', 'Other Projects'];
// From /payroll/reports/summary business_units.
const businessUnitCosts = {
  'Customer-Centric Brands': { employees: 0.7, totalCost: 113190 },
  'Other Projects': { employees: 0.3, totalCost: 48510 },
  'OEM Work': { employees: 0.5, totalCost: 42042 },
  'Internal Operations': { employees: 0, totalCost: 0 },
  Unallocated: { employees: 0.5, totalCost: 42042 }
};

describe('BusinessUnitAllocation', () => {
  it('shows the API unit costs, including the unallocated share', () => {
    render(<BusinessUnitAllocation employees={employees} businessUnits={businessUnits} businessUnitCosts={businessUnitCosts} />);
    expect(screen.getAllByText('$113,190.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unallocated').length).toBeGreaterThan(0);
    expect(screen.getByText(/Allocation Issues \(1\)/)).toBeInTheDocument();
  });

  it("shows each employee's annual cost from the API, not a hard-coded burden", () => {
    const onEdit = jest.fn();
    render(<BusinessUnitAllocation employees={employees} businessUnits={businessUnits}
      businessUnitCosts={businessUnitCosts} onEditAllocations={onEdit} />);
    fireEvent.click(screen.getByText('By Employee'));
    expect(screen.getByText('$161,700.00')).toBeInTheDocument();
    expect(screen.getByText('$84,084.00')).toBeInTheDocument();
    // 120000 x 40 x 52 x 1.4 must never appear.
    expect(screen.queryByText('$349,440,000.00')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByText('Edit')[0]);
    expect(onEdit).toHaveBeenCalledWith(employees[0]);
  });
});

describe('PayrollReports employee report', () => {
  it('shows the annual salary and the API annual cost', () => {
    render(<PayrollReports employees={employees} forecast={[]} departmentCosts={{}} businessUnitCosts={businessUnitCosts}
      runsPerYear={24} payFrequency="semimonthly" />);
    expect(screen.getByText('Semi-monthly Payroll')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Employee Report'));
    expect(screen.getByText('$120,000.00/yr')).toBeInTheDocument();
    expect(screen.getByText('$161,700.00')).toBeInTheDocument();
    expect(screen.getByText('$30.00/hr')).toBeInTheDocument();
  });
});
