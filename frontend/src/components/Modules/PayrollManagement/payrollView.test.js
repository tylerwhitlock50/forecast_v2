import {
  parseAllocations,
  summaryToDepartmentCosts,
  summaryToBusinessUnitCosts,
  serverForecastToView,
  formatRate,
  mergeBusinessUnits,
  runTotal,
  normalizeLaborClass,
  laborClassLabel,
  defaultHorizonFor,
  payRunQuery,
  bridgeToView
} from './payrollView';

const money = (v) => `$${Math.round(v).toLocaleString('en-US')}`;

describe('payroll view helpers', () => {
  it('parses allocations from the JSON text /data/payroll returns and converts fractions to percent', () => {
    expect(parseAllocations('{"OEM Work": 60, "Internal Operations": 40}')).toEqual({ 'OEM Work': 60, 'Internal Operations': 40 });
    expect(parseAllocations('{"OEM Work": 0.7, "Other Projects": 0.3}')).toEqual({ 'OEM Work': 70, 'Other Projects': 30 });
    expect(parseAllocations({ 'OEM Work': 0.5 })).toEqual({ 'OEM Work': 0.5 }); // half of one percent stays as given
    expect(parseAllocations('not json')).toEqual({});
    expect(parseAllocations(null)).toEqual({});
    expect(parseAllocations({ A: -5, B: 'x', C: 100 })).toEqual({ C: 100 });
  });

  it('shows a salary as the annual salary, never rate x 40 x 52', () => {
    expect(formatRate({ rate_type: 'salary', hourly_rate: 120000 }, money)).toBe('$120,000/yr');
    expect(formatRate({ rate_type: 'salary', hourly_rate: 120000, annual_gross: 120000 }, money)).toBe('$120,000/yr');
    expect(formatRate({ rate_type: 'salary', hourly_rate: 45 }, money)).toBe('$93,600/yr'); // legacy hourly equivalent
    expect(formatRate({ rate_type: 'hourly', hourly_rate: 30 }, money)).toBe('$30/hr');
  });

  it('maps the payroll summary into department and business-unit costs without re-deriving them', () => {
    const summary = {
      departments: [{ department: 'Admin', employee_count: 1, total_annual_cost: 161700, total_annual_gross: 120000, avg_hourly_rate: 57.69 }],
      business_units: [
        { business_unit: 'OEM Work', fte_allocation: 0.6, total_annual_cost: 50450.4, employee_count: 1 },
        { business_unit: 'Unallocated', fte_allocation: 0.5, total_annual_cost: 1000, employee_count: 1 }
      ]
    };
    expect(summaryToDepartmentCosts(summary).Admin).toMatchObject({ employees: 1, totalCost: 161700, totalGross: 120000 });
    const units = summaryToBusinessUnitCosts(summary);
    expect(units['OEM Work']).toMatchObject({ employees: 0.6, totalCost: 50450.4 });
    expect(mergeBusinessUnits(['OEM Work', 'Other Projects'], units)).toEqual(['OEM Work', 'Other Projects', 'Unallocated']);
    expect(summaryToDepartmentCosts(null)).toEqual({});
  });

  it('keeps the server pay-run breakdown: employer cost excludes withholding', () => {
    const [run] = serverForecastToView([{
      period: 1, date: '2026-03-13', month: '2026-03', total_cost: 6219.23, gross_pay: 4615.38,
      employer_taxes: 447.69, benefits: 1153.85, withholding: 1645.38, net_pay: 2970.0, employee_count: 1,
      employee_details: [{ employee_id: 'S1', employee_name: 'Pat', department: 'Admin', gross_pay: 4615.38,
        employer_taxes: 447.69, benefits: 1153.85, total_cost: 6219.23, withholding: 1645.38, net_pay: 2970.0 }]
    }]);
    expect(run.totalCost).toBe(6219.23);
    expect(runTotal(run, 'withholding')).toBe(1645.38);
    expect(run.employeeDetails[0].compensation).toEqual({
      grossPay: 4615.38, employerTaxes: 447.69, benefits: 1153.85, withholding: 1645.38, netPay: 2970.0, totalCost: 6219.23
    });
    // Older payloads without run totals fall back to the employee rows.
    expect(runTotal({ employeeDetails: run.employeeDetails }, 'grossPay')).toBe(4615.38);
  });
});

describe('labor class, horizon and bridge helpers', () => {
  it('normalises labor classes and labels them plainly', () => {
    expect(normalizeLaborClass('Direct')).toBe('direct');
    expect(normalizeLaborClass(' INDIRECT ')).toBe('indirect');
    expect(normalizeLaborClass(null)).toBe('');
    expect(normalizeLaborClass('supervisor')).toBe('');
    expect(laborClassLabel('indirect')).toBe('Indirect (factory)');
    expect(laborClassLabel(null)).toBe('Not classified');
  });

  it('defaults the pay-run horizon to one year of runs and only sends periods when chosen', () => {
    expect(defaultHorizonFor('monthly')).toBe(12);
    expect(defaultHorizonFor('semimonthly')).toBe(24);
    expect(defaultHorizonFor('biweekly')).toBe(26);
    expect(defaultHorizonFor('weekly')).toBe(52);
    expect(payRunQuery(null, 'F 1')).toBe('forecast_id=F%201');
    expect(payRunQuery(6, null)).toBe('periods=6');
  });

  it('shapes the statement bridge', () => {
    const view = bridgeToView({
      pay_frequency: 'biweekly', runs_per_year: 26, start_period: '2027-01', end_period: '2027-02',
      opening_accrued_payroll: 1931.43, closing_accrued_payroll: 544.76,
      by_period: [{ period: '2027-01', accrued: 4506.67, paid: 6240, pay_runs: 3, difference: -1733.33, accrued_payroll_balance: 198.1 }],
      totals: { accrued: 9013.33, paid: 10400, pay_runs: 5, difference: -1386.67 }
    });
    expect(view.rows[0]).toEqual({ period: '2027-01', accrued: 4506.67, paid: 6240, payRuns: 3, difference: -1733.33, balance: 198.1 });
    expect(view.opening).toBe(1931.43);
    expect(view.totals.payRuns).toBe(5);
    expect(bridgeToView(null)).toBeNull();
  });
});
