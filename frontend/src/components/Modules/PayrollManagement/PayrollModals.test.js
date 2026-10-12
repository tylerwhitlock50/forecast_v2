import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ConfigurationModal, EmployeeModal, validatePayRate } from './PayrollModals';

jest.mock('react-hot-toast', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const config = {
  federalTaxRate: 0.22, stateTaxRate: 0.06, socialSecurityRate: 0.062, medicareRate: 0.0145,
  unemploymentRate: 0.006, benefitsRate: 0.25, workersCompRate: 0.015, payFrequency: 'biweekly'
};

describe('ConfigurationModal', () => {
  it('labels federal / state income tax as employee withholding, not an employer cost', () => {
    render(<ConfigurationModal config={config} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByLabelText(/Federal Income Tax Rate - employee withholding \(not an employer cost\)/)).toHaveValue(0.22);
    expect(screen.getByLabelText(/State Income Tax Rate - employee withholding \(not an employer cost\)/)).toHaveValue(0.06);
    expect(screen.getByText('Employer Payroll Taxes (added to payroll cost)')).toBeInTheDocument();
    // Burden = 1 + 0.062 + 0.0145 + 0.006 + 0.015 (+ 0.25 benefits); withholding is not in it.
    expect(screen.getByTestId('burden-preview')).toHaveTextContent('gross pay x 1.3475 for');
    expect(screen.getByTestId('burden-preview')).toHaveTextContent('(1.0975 otherwise)');
  });

  it('saves the edited rates', () => {
    const onSave = jest.fn();
    render(<ConfigurationModal config={config} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Federal Income Tax Rate/), { target: { value: '0.3' } });
    fireEvent.click(screen.getByText('Save Configuration'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ federalTaxRate: 0.3, benefitsRate: 0.25 }));
  });
});

describe('EmployeeModal pay rate', () => {
  const employee = {
    employee_name: 'Pat', department: 'Admin', hourly_rate: 45, rate_type: 'salary', weekly_hours: 40,
    start_date: '2026-01-01', end_date: null, next_review_date: null, expected_raise: 0, benefits_eligible: true,
    allocations: { 'OEM Work': 100 }, forecast_id: null
  };

  it('asks for the annual salary and rejects an hourly-looking salary', () => {
    const onSave = jest.fn();
    render(<EmployeeModal employee={employee} departments={['Admin']} businessUnits={['OEM Work']} onSave={onSave} onCancel={() => {}} />);
    expect(screen.getByLabelText('Annual Salary *')).toHaveValue(45);
    fireEvent.click(screen.getByText('Add Employee'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter the annual salary \(e\.g\. 85000\)/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Annual Salary *'), { target: { value: '120000' } });
    fireEvent.click(screen.getByText('Add Employee'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ hourly_rate: 120000, rate_type: 'salary' }));
  });

  it('validates rates the same way as the API', () => {
    expect(validatePayRate('salary', 85000)).toBeNull();
    expect(validatePayRate('salary', 45)).toMatch(/annual salary/);
    expect(validatePayRate('hourly', 30)).toBeNull();
    expect(validatePayRate('hourly', 95000)).toMatch(/Salary/);
    expect(validatePayRate('hourly', 0)).toMatch(/greater than 0/);
  });
});

describe('EmployeeModal labor class', () => {
  const employee = {
    employee_name: 'Dana', department: 'Production', hourly_rate: 25, rate_type: 'hourly', weekly_hours: 40,
    start_date: '2027-01-01', end_date: null, next_review_date: null, expected_raise: 0, benefits_eligible: true,
    allocations: { 'OEM Work': 100 }, forecast_id: null, labor_class: 'Direct'
  };

  it('shows the stored class (any case), explains it and saves the choice', () => {
    const onSave = jest.fn();
    render(<EmployeeModal employee={employee} departments={['Production']} businessUnits={['OEM Work']} onSave={onSave} onCancel={() => {}} />);
    const select = screen.getByLabelText('Labor class');
    expect(select).toHaveValue('direct');
    expect(screen.getByTestId('labor-class-help')).toHaveTextContent('never counted twice');
    fireEvent.change(select, { target: { value: 'indirect' } });
    expect(screen.getByTestId('labor-class-help')).toHaveTextContent('Indirect labor');
    fireEvent.click(screen.getByText('Add Employee'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ labor_class: 'indirect' }));
  });

  it('offers Not classified and explains it counts as Admin', () => {
    render(<EmployeeModal employee={{ ...employee, labor_class: null }} departments={['Production']} businessUnits={['OEM Work']} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByLabelText('Labor class')).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Not classified (counted as Admin)' })).toBeInTheDocument();
    expect(screen.getByTestId('labor-class-help')).toHaveTextContent('treated as Admin');
  });
});
