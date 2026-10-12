import { ALL, machineView, laborView, materialView, formatCompactCurrency, periodLabel } from './costViews';

const periods = ['2027-01', '2027-02', '2027-03'];

// Shapes as returned by /products/machines/utilization and /products/labor/utilization.
const machine = {
  machine_id: 'CNC-01',
  machine_name: 'Haas VF-2',
  available_minutes_per_month: 9600,
  total_minutes_required: 21600,
  months_in_window: 3,
  total_cost: 34200,
  monthly: [
    { period: '2027-01', minutes_required: 4800, utilization_percent: 50, cost: 7600 },
    { period: '2027-02', minutes_required: 6000, utilization_percent: 62.5, cost: 9500 },
    { period: '2027-03', minutes_required: 10800, utilization_percent: 112.5, cost: 17100 },
  ],
};

describe('machineView', () => {
  it('All months = average month against monthly capacity, never the window total (no 12x)', () => {
    const v = machineView(machine, ALL, periods);
    expect(v.minutes).toBe(7200); // 21,600 / 3 months
    expect(v.utilization).toBe(75); // 7,200 / 9,600, not 21,600 / 9,600 = 225%
    expect(v.peakPeriod).toBe('2027-03');
    expect(v.peakUtilization).toBe(112.5);
    expect(v.overPeriods).toEqual(['2027-03']);
    expect(v.overCapacity).toBe(true);
    expect(v.trend.map(t => Math.round(t.value * 10) / 10)).toEqual([50, 62.5, 112.5]);
  });

  it('prefers the backend average / peak fields when present', () => {
    const v = machineView({ ...machine, average_monthly_minutes: 7000, utilization_percent: 72.9, peak_utilization_percent: 110, peak_period: '2027-03', over_capacity_periods: ['2027-03'] }, ALL, periods);
    expect(v.minutes).toBe(7000);
    expect(v.utilization).toBe(72.9);
    expect(v.peakUtilization).toBe(110);
  });

  it('one month shows that month', () => {
    const v = machineView(machine, '2027-02', periods);
    expect(v).toEqual(expect.objectContaining({ mode: 'month', minutes: 6000, utilization: 62.5, overCapacity: false, cost: 9500 }));
  });

  it('a machine with no capacity has no utilization', () => {
    const v = machineView({ ...machine, available_minutes_per_month: null, monthly: machine.monthly.map(m => ({ ...m, utilization_percent: null })) }, ALL, periods);
    expect(v.utilization).toBeNull();
    expect(v.overCapacity).toBe(false);
  });
});

const labor = {
  labor_type_id: 'LR-ASSY',
  labor_type_name: 'Assembler',
  hourly_rate: 24.5,
  total_hours: 1040,
  total_cost: 25480,
  months_in_window: 3,
  monthly: [
    { period: '2027-01', hours: 260, fte: 1.5, cost: 6370 },
    { period: '2027-02', hours: 346.66, fte: 2, cost: 8493 },
    { period: '2027-03', hours: 433.34, fte: 2.5, cost: 10617 },
  ],
};

describe('laborView', () => {
  it('All months = average monthly FTE and the peak month, not annual hours / 173.33', () => {
    const v = laborView(labor, ALL, periods, 173.33);
    expect(v.hours).toBeCloseTo(346.67, 1);
    expect(v.fte).toBeCloseTo(2, 2); // 1,040 h / 3 months / 173.33, not 1,040 / 173.33 = 6
    expect(v.peakPeriod).toBe('2027-03');
    expect(v.peakFte).toBeCloseTo(2.5);
    expect(v.totalHours).toBe(1040);
  });

  it('uses avg_fte / peak_fte from the backend when given', () => {
    const v = laborView({ ...labor, avg_fte: 2.01, peak_fte: 2.6, peak_period: '2027-03', average_monthly_hours: 346.67 }, ALL, periods);
    expect(v.fte).toBe(2.01);
    expect(v.peakFte).toBe(2.6);
  });

  it('one month shows its hours and FTE', () => {
    const v = laborView(labor, '2027-01', periods);
    expect(v).toEqual(expect.objectContaining({ mode: 'month', hours: 260, fte: 1.5, cost: 6370 }));
  });
});

describe('materialView', () => {
  const material = {
    material_description: 'Receiver blank 416SS',
    total_quantity_needed: 30,
    total_cost: 2760,
    by_period: { '2027-02': { quantity: 20, cost: 1840 }, '2027-01': { quantity: 10, cost: 920 } },
  };
  it('window totals and a monthly trend in period order', () => {
    const v = materialView(material, ALL);
    expect(v).toEqual(expect.objectContaining({ quantity: 30, cost: 2760 }));
    expect(v.trend).toEqual([{ label: '2027-01', value: 10 }, { label: '2027-02', value: 20 }]);
  });
  it('one month', () => {
    expect(materialView(material, '2027-02')).toEqual(expect.objectContaining({ quantity: 20, cost: 1840 }));
    expect(materialView(material, '2027-03')).toEqual(expect.objectContaining({ quantity: 0, cost: 0 }));
  });
});

describe('formatting', () => {
  it('compact currency stays short', () => {
    expect(formatCompactCurrency(7956330.88)).toBe('$7.96M');
    expect(formatCompactCurrency(416264.17)).toBe('$416K');
    expect(formatCompactCurrency(9500)).toBe('$9,500');
    expect(formatCompactCurrency(-1250000)).toBe('-$1.25M');
    expect(formatCompactCurrency(null)).toBe('$0');
  });
  it('period labels', () => {
    expect(periodLabel('2027-10')).toBe('Oct 2027');
    expect(periodLabel('2027-10-01')).toBe('Oct 2027');
  });
});
