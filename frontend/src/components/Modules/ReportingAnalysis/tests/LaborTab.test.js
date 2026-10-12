import React from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import LaborTab from '../cogs/LaborTab';

// recharts' ResponsiveContainer needs a size; jsdom has none.
jest.mock('recharts', () => {
  const Original = jest.requireActual('recharts');
  return { ...Original, ResponsiveContainer: ({ children }) => <div style={{ width: 600, height: 300 }}>{children}</div> };
});

const labor = {
  periods: ['2027-01', '2027-02'],
  hours_per_fte: 173.33,
  by_labor_type: [{ labor_type_id: 'L1', labor_type_name: 'Assembler', hourly_rate: 30,
    by_period: { '2027-01': { hours: 100, cost: 3000, fte: 0.58 }, '2027-02': { hours: 200, cost: 6000, fte: 1.15 } },
    totals: { hours: 300, cost: 9000, avg_fte: 0.87, peak_fte: 1.15 } }],
  totals_by_period: [{ period: '2027-01', hours: 100, cost: 3000, fte: 0.58 }, { period: '2027-02', hours: 200, cost: 6000, fte: 1.15 }],
  totals: { hours: 300, cost: 9000, avg_fte: 0.87, peak_fte: 1.15 },
  by_machine: [],
  by_product: [],
  standard_vs_payroll: {
    by_period: [
      { period: '2027-01', standard_hours: 100, standard_cost: 3000, direct_payroll_cost: 4333.33, paid_hours: 173.33, labor_variance: 1333.33, indirect_payroll_cost: 5000, utilization_pct: 57.69 },
      { period: '2027-02', standard_hours: 200, standard_cost: 6000, direct_payroll_cost: 4333.33, paid_hours: 173.33, labor_variance: -1666.67, indirect_payroll_cost: 5000, utilization_pct: 115.38 }
    ],
    totals: { standard_hours: 300, standard_cost: 9000, direct_payroll_cost: 8666.66, paid_hours: 346.66, labor_variance: -333.34, indirect_payroll_cost: 10000, utilization_pct: 86.54 }
  },
  payroll_note: {
    direct_labor_cost: 9000, payroll_cost: 36666.66, direct_payroll_cost: 8666.66, indirect_payroll_cost: 10000,
    admin_payroll_cost: 18000, labor_variance: -333.34,
    unclassified_employees: [{ employee_id: 'U1', employee_name: 'Uma Unclassified' }],
    message: 'Direct labor in COGS is the routing standard plus a direct labor variance. Not classified (treated as Admin): Uma Unclassified.'
  }
};

const renderTab = (props = {}) => render(
  <MemoryRouter>
    <LaborTab labor={labor} loading={false} metric="hours" onMetricChange={() => {}} hoursPerFteInput="173.33"
      onHoursPerFteInput={() => {}} onHoursPerFteCommit={() => {}} hoursPerFteError={null} {...props} />
  </MemoryRouter>
);

describe('LaborTab standard vs payroll', () => {
  it('shows standard hours and cost against direct payroll, paid hours, utilization and the variance', () => {
    renderTab();
    const table = screen.getByTestId('labor-vs-payroll');
    const row = (label) => within(table).getAllByRole('row').find(r => r.textContent.startsWith(label));
    expect(row('Standard hours (routings)').textContent).toContain('300');
    expect(row('Paid hours (Direct employees)').textContent).toContain('347');
    expect(row('Utilization').textContent).toContain('57.7%');
    expect(row('Direct payroll').textContent).toContain('8,667');
    expect(row('Direct labor variance').textContent).toContain('(1,667)');
    expect(row('Indirect labor (factory)').textContent).toContain('10,000');
  });

  it('explains where payroll went and links to Payroll to classify people', () => {
    renderTab();
    const note = screen.getByTestId('payroll-note');
    expect(note).toHaveTextContent('Direct labor (standard): $9,000');
    expect(note).toHaveTextContent('Direct payroll: $8,667');
    expect(note).toHaveTextContent('Payroll (operating expense): $18,000');
    expect(note).toHaveTextContent('Uma Unclassified');
    expect(within(note).getByRole('link', { name: 'Payroll' })).toHaveAttribute('href', '/payroll');
  });

  it('hides the comparison when no employee is classed Direct or Indirect', () => {
    renderTab({ labor: { ...labor, standard_vs_payroll: { by_period: [], totals: { direct_payroll_cost: 0, indirect_payroll_cost: 0 } } } });
    expect(screen.queryByTestId('labor-vs-payroll')).not.toBeInTheDocument();
    expect(screen.getByTestId('payroll-note')).toBeInTheDocument();
  });
});
