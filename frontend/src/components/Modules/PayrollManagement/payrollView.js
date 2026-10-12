// View helpers for the payroll screens.
//
// The money comes from the API (/payroll/*), which applies the statements
// engine's rules: salaried staff store their ANNUAL salary, employer cost =
// gross x (1 + social security + medicare + unemployment + workers comp
// [+ benefits]), and federal / state income tax is employee withholding,
// never an employer cost. These helpers only reshape API responses; they do
// not re-derive payroll in the browser.

export const PAY_RUNS_PER_YEAR = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

export const PAY_FREQUENCY_LABELS = {
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  semimonthly: 'Semi-monthly',
  monthly: 'Monthly'
};

export const runsPerYearFor = (frequency) => PAY_RUNS_PER_YEAR[frequency] || 26;

/** A salary at or above this is an annual salary (the engine's ANNUAL_SALARY_THRESHOLD). */
export const ANNUAL_SALARY_THRESHOLD = 1000;
/** An hourly rate above this is almost certainly an annual salary entered as hourly. */
export const MAX_PLAUSIBLE_HOURLY_RATE = 500;

/**
 * Business-unit allocations in percent. Accepts an object or the JSON text
 * /data/payroll returns; fractions that sum to 1 become percent (same rule as
 * the API).
 */
export const parseAllocations = (value) => {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = raw.trim() ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const clean = {};
  Object.entries(raw).forEach(([unit, pct]) => {
    const number = Number(pct);
    if (Number.isFinite(number) && number >= 0) clean[unit] = number;
  });
  const values = Object.values(clean);
  const total = values.reduce((sum, v) => sum + v, 0);
  if (values.length > 0 && values.every(v => v <= 1) && total >= 0.99 && total <= 1.01) {
    Object.keys(clean).forEach(unit => { clean[unit] = Math.round(clean[unit] * 100 * 1e6) / 1e6; });
  }
  return clean;
};

export const allocationTotal = (allocations) =>
  Object.values(allocations || {}).reduce((sum, v) => sum + (Number(v) || 0), 0);

/** The pay rate as entered: $/hour, or the annual salary for salaried staff. */
export const formatRate = (employee, formatCurrency) => {
  if (!employee) return '';
  const rate = Number(employee.hourly_rate) || 0;
  if (employee.rate_type === 'salary') {
    const annual = employee.annual_gross ?? (rate >= ANNUAL_SALARY_THRESHOLD ? rate : rate * 2080);
    return `${formatCurrency(annual)}/yr`;
  }
  return `${formatCurrency(rate)}/hr`;
};

/** {employee_id: {annual_gross, annual_cost, rate_basis, allocations}} from GET /payroll/employees. */
export const indexEmployeeCosts = (employees) => {
  const index = {};
  (employees || []).forEach(emp => {
    if (!emp?.employee_id) return;
    index[emp.employee_id] = {
      annual_gross: emp.annual_gross,
      annual_cost: emp.annual_cost,
      rate_basis: emp.rate_basis,
      allocations: emp.allocations
    };
  });
  return index;
};

/** /payroll/reports/summary departments -> {name: {employees, totalCost, totalGross, avgRate}} */
export const summaryToDepartmentCosts = (summary) => {
  const out = {};
  (summary?.departments || []).forEach(dept => {
    out[dept.department] = {
      employees: dept.employee_count || 0,
      totalCost: dept.total_annual_cost || 0,
      totalGross: dept.total_annual_gross || 0,
      employerTaxes: dept.total_employer_taxes || 0,
      benefits: dept.total_benefits || 0,
      avgRate: dept.avg_hourly_rate || 0
    };
  });
  return out;
};

/** /payroll/reports/summary business_units -> {unit: {employees (FTE share), totalCost}} */
export const summaryToBusinessUnitCosts = (summary) => {
  const out = {};
  (summary?.business_units || []).forEach(unit => {
    out[unit.business_unit] = {
      employees: unit.fte_allocation || 0,
      totalCost: unit.total_annual_cost || 0,
      headcount: unit.employee_count || 0
    };
  });
  return out;
};

/** Business units to show: the standard ones plus any the API reports (e.g. 'Unallocated'). */
export const mergeBusinessUnits = (standard, businessUnitCosts) => {
  const units = [...(standard || [])];
  Object.keys(businessUnitCosts || {}).forEach(unit => {
    if (!units.includes(unit)) units.push(unit);
  });
  return units;
};

const compensationFromServer = (row) => ({
  grossPay: row.gross_pay || 0,
  employerTaxes: row.employer_taxes || 0,
  benefits: row.benefits || 0,
  withholding: row.withholding || 0,
  netPay: row.net_pay || 0,
  totalCost: row.total_cost || 0
});

/** /payroll/forecast (pay-period mode) -> what PayrollForecast / PayrollReports render. */
export const serverForecastToView = (forecast) => (forecast || []).map((run) => ({
  period: run.period,
  date: run.date,
  month: run.month,
  totalCost: run.total_cost || 0,
  grossPay: run.gross_pay || 0,
  employerTaxes: run.employer_taxes || 0,
  benefits: run.benefits || 0,
  withholding: run.withholding || 0,
  netPay: run.net_pay || 0,
  employeeCount: run.employee_count || 0,
  employeeDetails: (run.employee_details || []).map((emp) => ({
    employee_id: emp.employee_id,
    employee_name: emp.employee_name,
    department: emp.department,
    compensation: compensationFromServer(emp)
  }))
}));

/** Sum a field over pay runs, falling back to the per-employee compensation. */
export const runTotal = (run, field) => {
  if (typeof run?.[field] === 'number') return run[field];
  return (run?.employeeDetails || []).reduce((sum, emp) => sum + (emp.compensation?.[field] || 0), 0);
};
