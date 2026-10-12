import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import PayrollManagement from './PayrollManagementNew';
import api from '../../../lib/apiClient';

jest.mock('../../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('react-hot-toast', () => {
  const toast = jest.fn();
  toast.error = jest.fn();
  toast.success = jest.fn();
  return { toast };
});
jest.mock('../../Common/ConfirmDialog', () => ({ useConfirm: () => () => Promise.resolve(true) }));

const mockUpdateEmployee = jest.fn(() => Promise.resolve({ employee_id: 'S1' }));
// Rows as /data/payroll returns them: allocations are JSON TEXT.
const mockPayroll = [
  { employee_id: 'S1', employee_name: 'Plant Manager', department: 'Admin', weekly_hours: 40, hourly_rate: 120000,
    rate_type: 'salary', labor_type: 'Mgmt', start_date: '2026-01-01', end_date: null, next_review_date: '2027-01-01',
    expected_raise: 0, benefits_eligible: 1, allocations: '{"Customer-Centric Brands": 0.7, "Other Projects": 0.3}',
    forecast_id: 'F1' },
  { employee_id: 'H1', employee_name: 'Operator', department: 'Production', weekly_hours: 40, hourly_rate: 30,
    rate_type: 'hourly', labor_type: 'Ops', start_date: '2026-01-01', end_date: null, next_review_date: '2027-01-01',
    expected_raise: 0, benefits_eligible: 1, allocations: '{"OEM Work": 100}', forecast_id: null }
];
jest.mock('../../../context/ForecastContext', () => ({
  useForecast: () => ({
    data: { payroll: mockPayroll },
    actions: { updateEmployee: mockUpdateEmployee, createEmployee: jest.fn(), deleteEmployee: jest.fn() },
    activeScenario: 'F1',
    scenarios: { F1: { name: 'Budget' } }
  })
}));

const responses = {
  '/payroll/config': { data: { config: { federal_tax_rate: 0.22, state_tax_rate: 0.06, social_security_rate: 0.062,
    medicare_rate: 0.0145, unemployment_rate: 0.006, benefits_rate: 0.25, workers_comp_rate: 0.015, pay_frequency: 'biweekly' } } },
  '/payroll/employees': { data: { employees: [
    { employee_id: 'S1', annual_gross: 120000, annual_cost: 161700, rate_basis: 'annual_salary',
      allocations: { 'Customer-Centric Brands': 70, 'Other Projects': 30 } },
    { employee_id: 'H1', annual_gross: 62400, annual_cost: 84084, rate_basis: 'hourly', allocations: { 'OEM Work': 100 } }
  ] } },
  '/payroll/reports/summary': { data: { summary: {
    total_annual_cost: 245784, avg_hourly_rate: 43.85, runs_per_year: 26,
    departments: [
      { department: 'Admin', employee_count: 1, total_annual_cost: 161700, total_annual_gross: 120000, avg_hourly_rate: 57.69 },
      { department: 'Production', employee_count: 1, total_annual_cost: 84084, total_annual_gross: 62400, avg_hourly_rate: 30 }
    ],
    business_units: [
      { business_unit: 'Customer-Centric Brands', fte_allocation: 0.7, total_annual_cost: 113190, employee_count: 1 },
      { business_unit: 'OEM Work', fte_allocation: 1, total_annual_cost: 84084, employee_count: 1 },
      { business_unit: 'Other Projects', fte_allocation: 0.3, total_annual_cost: 48510, employee_count: 1 },
      { business_unit: 'Internal Operations', fte_allocation: 0, total_annual_cost: 0, employee_count: 0 }
    ]
  } } },
  '/payroll/forecast': { data: { forecast: [] } }
};

beforeEach(() => {
  api.get.mockImplementation((url) => {
    const path = url.split('?')[0];
    return Promise.resolve(responses[path] || { data: {} });
  });
  mockUpdateEmployee.mockClear();
});

describe('PayrollManagement screen', () => {
  it('shows API costs: annual salary, employer annual cost and the summary total', async () => {
    render(<PayrollManagement />);
    expect(await screen.findByText('$245,784')).toBeInTheDocument();          // Total Annual Cost card
    expect(screen.getByText('$120,000/yr')).toBeInTheDocument();             // not 120000 x 40 x 52
    expect(screen.getByText('$161,700')).toBeInTheDocument();                // S1 annual employer cost
    expect(screen.getByText('$84,084')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/payroll/employees?forecast_id=F1', expect.anything());
    expect(api.get).toHaveBeenCalledWith('/payroll/reports/summary?include_employees=false&forecast_id=F1', expect.anything());
  });

  it('shows business-unit costs from the API and saves allocations as an object in percent', async () => {
    render(<PayrollManagement />);
    await screen.findByText('$245,784');
    fireEvent.click(screen.getByText('Business Units'));
    expect(screen.getAllByText('$113,190.00').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Allocation Issues/)).not.toBeInTheDocument(); // JSON text parsed, fractions -> percent
    fireEvent.click(screen.getByText('By Employee'));
    expect(screen.getByText('70%')).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('Edit')[0]);
    fireEvent.click(await screen.findByText('Save Allocation'));
    await waitFor(() => expect(mockUpdateEmployee).toHaveBeenCalled());
    const [id, payload] = mockUpdateEmployee.mock.calls[0];
    expect(id).toBe('S1');
    expect(payload.allocations).toEqual({ 'Customer-Centric Brands': 70, 'Other Projects': 30 });
    expect(payload).not.toHaveProperty('annual_cost');
  });
});
