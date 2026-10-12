import {
  BRIDGE_ROWS, bridgeColumns, statementCsvRows, hasSalesInWindow, groupRows, groupTotals, sortRows,
  groupCsvRows, laborMatrix, laborCsvRows, laborChartData, machineCsvRows, unitCostCsvRows, headline, isOverCapacity
} from '../utils/cogsLabor';
import { toCsv, csvCell, slug, filenameFromDisposition } from '../utils/csv';
import { formatPeriodRanges } from '../utils/formatters';

const periods = ['2027-01', '2027-02'];

const summaryRow = (period, gross) => ({
  period, units: 1, gross_sales: gross, terms_allowance: gross * 0.02, chargebacks: 0, other_allowances: 0,
  excise_tax: gross * 0.11 / 1.11, total_sales_deductions: gross * 0.02 + gross * 0.11 / 1.11,
  net_sales: gross - (gross * 0.02 + gross * 0.11 / 1.11), materials: 300, labor: 50, machine: 20, product_cogs: 370,
  factory_overhead: 10, other_cogs: 0, total_cogs: 380, gross_profit: 0, gross_margin_pct: 0
});

const cogs = {
  periods,
  line_count: 3,
  summary: {
    by_period: [summaryRow('2027-01', 1110), summaryRow('2027-02', 2220)],
    totals: { units: 2, gross_sales: 3330, total_sales_deductions: 396.6, net_sales: 2933.4, total_cogs: 760, gross_profit: 2173.4, gross_margin_pct: 74.09 }
  },
  by_product: [
    {
      unit_id: 'RFL-100', unit_name: 'Ridgeline', unit_type: 'Rifle',
      totals: { units: 3, gross_sales: 3000, total_sales_deductions: 300, net_sales: 2700, product_cogs: 1200, contribution_margin: 1500, contribution_margin_pct: 55.56, avg_net_price: 900, cost_per_unit: 400 },
      by_period: { '2027-01': { units: 1, net_sales: 900, contribution_margin: 500 }, '2027-02': { units: 2, net_sales: 1800, contribution_margin: 1000 } }
    },
    {
      unit_id: 'PST-9', unit_name: 'Ranger 9mm', unit_type: 'Pistol',
      totals: { units: 1, gross_sales: 330, total_sales_deductions: 30, net_sales: 300, product_cogs: 350, contribution_margin: -50 },
      by_period: { '2027-02': { units: 1, net_sales: 300, contribution_margin: -50 } }
    }
  ],
  unit_costs: [{ unit_id: 'PST-9', unit_name: 'Ranger, 9mm', bom_id: null, router_id: 'RTG', material_per_unit: 0, labor_per_unit: 10, machine_per_unit: 5, total_per_unit: 15, warnings: ['missing_bom'] }]
};

describe('gross margin bridge', () => {
  it('walks gross sales through each deduction to net sales, COGS and gross profit', () => {
    const keys = BRIDGE_ROWS.map(r => r.key);
    expect(keys).toEqual([
      'gross_sales', 'terms_allowance', 'chargebacks', 'other_allowances', 'excise_tax', 'total_sales_deductions', 'net_sales', 'units',
      'cogs_header', 'materials', 'labor', 'machine', 'factory_overhead', 'other_cogs', 'total_cogs', 'gross_profit', 'gross_margin_pct'
    ]);
    expect(BRIDGE_ROWS.filter(r => r.deduction).map(r => r.key)).toEqual(['terms_allowance', 'chargebacks', 'other_allowances', 'excise_tax', 'total_sales_deductions']);
  });

  it('builds month columns plus a Total and exports deductions as negatives', () => {
    const columns = bridgeColumns(cogs.summary);
    expect(columns.map(c => c.key)).toEqual(['2027-01', '2027-02', 'total']);
    const rows = statementCsvRows(BRIDGE_ROWS, columns);
    expect(rows[0]).toEqual(['Line', 'Jan 2027', 'Feb 2027', 'Total']);
    const excise = rows.find(r => r[0] === 'Excise tax (FET)');
    expect(excise[1]).toBeCloseTo(-110, 6); // $1,110 invoice with 11% embedded FET carries $110
    expect(rows.find(r => r[0] === 'Gross sales').slice(1)).toEqual([1110, 2220, 3330]);
    expect(rows.find(r => r[0] === 'Cost of goods sold')).toEqual(['Cost of goods sold', '', '', '']);
  });

  it('knows when the window has no sales', () => {
    expect(hasSalesInWindow(cogs)).toBe(true);
    expect(hasSalesInWindow({ line_count: 0, by_product: [], summary: { totals: { gross_sales: 0 } } })).toBe(false);
    expect(hasSalesInWindow(null)).toBe(false);
  });
});

describe('dimension tables', () => {
  it('flattens group entries, computing missing ratios', () => {
    const rows = groupRows(cogs, 'product');
    expect(rows.map(r => r.key)).toEqual(['RFL-100', 'PST-9']);
    expect(rows[0]).toMatchObject({ name: 'Ridgeline', sub: 'RFL-100', type: 'Rifle', avg_net_price: 900, cost_per_unit: 400 });
    expect(rows[1]).toMatchObject({ avg_net_price: 300, cost_per_unit: 350 });
    expect(rows[1].contribution_margin_pct).toBeCloseTo(-16.67, 2);
  });

  it('totals recompute ratios instead of summing them', () => {
    const t = groupTotals(groupRows(cogs, 'product'));
    expect(t.units).toBe(4);
    expect(t.net_sales).toBe(3000);
    expect(t.avg_net_price).toBe(750);
    expect(t.contribution_margin_pct).toBeCloseTo(48.33, 2);
  });

  it('sorts by numbers and by name', () => {
    const rows = groupRows(cogs, 'product');
    expect(sortRows(rows, 'contribution_margin', 'asc').map(r => r.key)).toEqual(['PST-9', 'RFL-100']);
    expect(sortRows(rows, 'name', 'asc').map(r => r.name)).toEqual(['Ranger 9mm', 'Ridgeline']);
  });

  it('exports the summary and the by-month view as CSV rows', () => {
    const rows = groupRows(cogs, 'product');
    const summary = groupCsvRows(rows, 'product');
    expect(summary[0].slice(0, 4)).toEqual(['Product', 'ID', 'Product type', 'Units']);
    expect(summary[1].slice(0, 5)).toEqual(['Ridgeline', 'RFL-100', 'Rifle', 3, 3000]);
    expect(summary[1][5]).toBe(-300); // deductions exported as a negative, as shown
    expect(summary[summary.length - 1][0]).toBe('Total');

    const monthly = groupCsvRows(rows, 'product', { view: 'monthly', periods, metric: 'units' });
    expect(monthly[0]).toEqual(['Product', 'ID', 'Product type', 'Jan 2027', 'Feb 2027', 'Total units']);
    expect(monthly[2]).toEqual(['Ranger 9mm', 'PST-9', 'Pistol', 0, 1, 1]);
    expect(monthly[3]).toEqual(['Total', '', '', 1, 3, 4]);
  });
});

const labor = {
  periods,
  hours_per_fte: 100,
  by_labor_type: [
    { labor_type_id: 'LR-ASSY', labor_type_name: 'Assembler', hourly_rate: 24.5,
      by_period: { '2027-01': { hours: 100, cost: 2450, fte: 1 }, '2027-02': { hours: 300, cost: 7350, fte: 3 } },
      totals: { hours: 400, cost: 9800, avg_fte: 2, peak_fte: 3 } },
    { labor_type_id: 'LR-MACH', labor_type_name: 'Machinist', hourly_rate: 34,
      by_period: { '2027-01': { hours: 50, cost: 1700, fte: 0.5 }, '2027-02': { hours: 50, cost: 1700, fte: 0.5 } },
      totals: { hours: 100, cost: 3400, avg_fte: 0.5, peak_fte: 0.5 } }
  ],
  totals_by_period: [{ period: '2027-01', hours: 150, cost: 4150, fte: 1.5 }, { period: '2027-02', hours: 350, cost: 9050, fte: 3.5 }],
  totals: { hours: 500, cost: 13200, avg_fte: 2.5, peak_fte: 3.5 },
  by_machine: [
    { machine_id: 'CNC-01', machine_name: 'CNC', available_hours_per_month: 160,
      by_period: { '2027-01': { hours: 120, utilization_pct: 75 }, '2027-02': { hours: 200, utilization_pct: 125 } },
      totals: { hours: 320, peak_utilization_pct: 125 } }
  ]
};

describe('labor and machines', () => {
  it('sums hours and cost but averages FTE', () => {
    const hours = laborMatrix(labor, 'hours');
    expect(hours.totalLabel).toBe('Total');
    expect(hours.rows[0]).toMatchObject({ name: 'Assembler', total: 400 });
    expect(hours.totalsRow.values).toEqual({ '2027-01': 150, '2027-02': 350 });
    const fte = laborMatrix(labor, 'fte');
    expect(fte.totalLabel).toBe('Average');
    expect(fte.rows[0]).toMatchObject({ total: 2, peak: 3 });
    expect(fte.totalsRow).toMatchObject({ total: 2.5, peak: 3.5 });
  });

  it('exports the labor table and chart data', () => {
    const rows = laborCsvRows(labor, 'fte');
    expect(rows[0]).toEqual(['Labor type', 'Hourly rate', 'Jan 2027', 'Feb 2027', 'Average', 'Peak']);
    expect(rows[3]).toEqual(['Total', '', 1.5, 3.5, 2.5, 3.5]);
    expect(laborChartData(labor)[1]).toEqual({ period: '2027-02', label: 'Feb 2027', 'LR-ASSY': 300, 'LR-MACH': 50 });
  });

  it('flags machines over 100% utilization', () => {
    expect(isOverCapacity(125)).toBe(true);
    expect(isOverCapacity(100)).toBe(false);
    expect(isOverCapacity(null)).toBe(false);
    const rows = machineCsvRows(labor);
    expect(rows[1]).toEqual(['CNC', 'Hours needed', 160, 120, 200, 320]);
    expect(rows[2]).toEqual(['CNC', 'Utilization %', 160, 75, 125, 125]);
  });
});

describe('headline and unit costs', () => {
  it('derives the KPI figures', () => {
    const h = headline(cogs, labor);
    expect(h.deductionPct).toBeCloseTo(11.91, 2);
    expect(h.avgNetPrice).toBeCloseTo(1466.7, 1);
    expect(h).toMatchObject({ gross: 3330, grossProfit: 2173.4, laborHours: 500, avgFte: 2.5, peakFte: 3.5 });
    expect(headline(cogs, null).laborHours).toBeNull();
  });

  it('exports unit costs with warnings', () => {
    const rows = unitCostCsvRows(cogs.unit_costs);
    expect(rows[1]).toEqual(['PST-9', 'Ranger, 9mm', '', '', 'RTG', 0, 10, 5, 15, 0, 0, 'missing_bom']);
    expect(toCsv(rows).split('\n')[1]).toBe('PST-9,"Ranger, 9mm",,,RTG,0,10,5,15,0,0,missing_bom');
  });
});

describe('csv helpers', () => {
  it('quotes text only when needed and keeps numbers raw', () => {
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell(1234567.891234)).toBe('1234567.8912');
    expect(csvCell(null)).toBe('');
    expect(toCsv([['a', 'b'], [1, 'x,y']])).toBe('a,b\n1,"x,y"\n');
    expect(slug('2027 Budget / v2')).toBe('2027_Budget_v2');
    expect(filenameFromDisposition('attachment; filename="forecast_F001_2027-01_2027-12.xlsx"')).toBe('forecast_F001_2027-01_2027-12.xlsx');
    expect(filenameFromDisposition(null)).toBeNull();
  });

  it('collapses consecutive months into ranges', () => {
    expect(formatPeriodRanges(['2027-01', '2027-02', '2027-03', '2027-05'])).toBe('Jan – Mar 2027, May 2027');
    expect(formatPeriodRanges(['2026-11', '2026-12', '2027-01'])).toBe('Nov 2026 – Jan 2027');
    expect(formatPeriodRanges([])).toBe('');
  });
});
