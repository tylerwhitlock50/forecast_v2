import React from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import ReportWarnings, { splitWarnings } from '../components/ReportWarnings';

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

  it('renders nothing without warnings', () => {
    const { container } = render(<MemoryRouter><ReportWarnings warnings={[]} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
