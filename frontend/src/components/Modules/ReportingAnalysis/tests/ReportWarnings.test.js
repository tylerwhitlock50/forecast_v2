import React from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import ReportWarnings, { splitWarnings, groupWarnings } from '../components/ReportWarnings';

const warnings = [
  { code: 'no_deduction_rules', level: 'info', message: 'No discount rules; net sales equal gross sales.' },
  { code: 'cost_warnings', message: '1 product(s) have incomplete BOM/routing data.', products: { 'PST-9': ['missing_bom'] } },
  { code: 'machine_over_capacity', message: 'CNC needs more hours than available.', periods: ['2027-01', '2027-02', '2027-03'] }
];

describe('ReportWarnings', () => {
  it('splits info notes from warnings and can hide codes', () => {
    const { info, warnings: real } = splitWarnings(warnings, ['machine_over_capacity']);
    expect(info.map(w => w.code)).toEqual(['no_deduction_rules']);
    expect(real.map(w => w.code)).toEqual(['cost_warnings']);
  });

  it('renders info as a quiet note and warnings in the amber alert with fix-it links', () => {
    render(<MemoryRouter><ReportWarnings warnings={warnings} onDismiss={() => {}} /></MemoryRouter>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('bg-amber-50');
    expect(within(alert).getByText('Incomplete product costs')).toBeInTheDocument();
    expect(within(alert).getByRole('link', { name: /Review BOMs/ })).toHaveAttribute('href', '/bom');
    expect(within(alert).getByRole('link', { name: /Review routings/ })).toHaveAttribute('href', '/routing');
    expect(within(alert).getByText('(Jan – Mar 2027)')).toBeInTheDocument();
    expect(within(alert).queryByText(/net sales equal gross sales/)).not.toBeInTheDocument();

    const note = screen.getByText(/net sales equal gross sales/).closest('[data-level="info"]');
    expect(note).toHaveClass('bg-slate-50');
    expect(within(note).getByRole('link', { name: /Pricing & Deductions/ })).toHaveAttribute('href', '/pricing');
  });

  it('lists every over-capacity machine, worst first, with months and peak %', () => {
    const machines = [
      { code: 'machine_over_capacity', machine_id: 'WC-LATH1', message: 'Okuma Lathe needs more hours than available in 2 month(s).', periods: ['2027-03', '2027-04'], machine_name: 'Okuma Lathe', peak_utilization_pct: 164.8, peak_period: '2027-10' },
      { code: 'machine_over_capacity', machine_id: 'WC-MILL1', message: 'Haas Mill needs more hours than available in 12 month(s).', periods: ['2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09', '2027-10', '2027-11', '2027-12'], machine_name: 'Haas Mill', peak_utilization_pct: 225.91, peak_period: '2027-10' },
      { code: 'machine_over_capacity', machine_id: 'WC-TEST', message: 'Test Range needs more hours than available in 1 month(s).', periods: ['2027-05'] }
    ];
    expect(groupWarnings(machines)).toHaveLength(1);
    render(<MemoryRouter><ReportWarnings warnings={[warnings[1], ...machines]} /></MemoryRouter>);
    const group = screen.getByTestId('warning-group-machine_over_capacity');
    expect(group).toHaveTextContent('Machines over capacity');
    expect(group).toHaveTextContent('3 machines need more hours than are available');
    const lines = within(group).getAllByRole('listitem').map(li => li.textContent);
    expect(lines).toEqual([
      'Haas Mill: 12 months over capacity (Jan – Dec 2027) · peak 225.9% in Oct 2027',
      'Okuma Lathe: 2 months over capacity (Mar – Apr 2027) · peak 164.8% in Oct 2027',
      'Test Range: 1 month over capacity (May 2027)'
    ]);
    expect(within(group).getByRole('link', { name: /Machines/ })).toHaveAttribute('href', '/machines');
    expect(screen.getByText('Incomplete product costs')).toBeInTheDocument();
  });

  it('shows a single over-capacity machine as one warning with its peak', () => {
    const one = [{ code: 'machine_over_capacity', message: 'CNC needs more hours than available.', periods: ['2027-01'], peak_utilization_pct: 120, peak_period: '2027-01' }];
    render(<MemoryRouter><ReportWarnings warnings={one} /></MemoryRouter>);
    expect(screen.getByText('Machine over capacity')).toBeInTheDocument();
    expect(screen.getByText('(Jan 2027 · peak 120.0% in Jan 2027)')).toBeInTheDocument();
  });

  it('renders nothing without warnings', () => {
    const { container } = render(<MemoryRouter><ReportWarnings warnings={[]} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
