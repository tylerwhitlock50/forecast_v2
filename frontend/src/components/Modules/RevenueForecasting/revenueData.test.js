import Papa from 'papaparse';
import {
  buildLines,
  buildMatrixRows,
  buildPeriods,
  carriedPrice,
  defaultRevenueWindow,
  describeWindow,
  formatMoneyCompact,
  formatQty,
  monthsBetween,
  NO_TYPE,
  SALES_EXPORT_COLUMNS,
  salesExportRows,
  shortWindowLabel,
  summarizeBySegment,
  summarizeLines,
  totalsByPeriod,
  windowCovers,
  yearsInWindow,
} from './revenueData';

const customers = [
  { customer_id: 'C-1', customer_name: 'Smith, Jones & Co', customer_type: 'Dealer' },
  { customer_id: 'C-2', customer_name: 'RSR Group', customer_type: 'Distributor' },
  { customer_id: 'C-3', customer_name: 'No Type LLC', customer_type: '' },
  { customer_id: 'C-9', customer_name: 'Never buys', customer_type: 'Dealer' },
];
const products = [
  { unit_id: 'RFL-1', unit_name: 'Ridgeline 6.5' },
  { unit_id: 'PST-9', unit_name: 'Ranger 9mm' },
  { unit_id: 'UNSOLD', unit_name: 'Not sold' },
];
const sale = (customer_id, unit_id, period, quantity, unit_price, forecast_id = 'F001') => ({
  customer_id, unit_id, period, quantity, unit_price, forecast_id,
});
const sales = [
  sale('C-1', 'RFL-1', '2027-01', 10, 1500),
  sale('C-1', 'RFL-1', '2027-02', 12, 1500),
  sale('C-1', 'RFL-1', '2027-04', 8, 1550),
  sale('C-2', 'RFL-1', '2027-01', 100, 1200),
  sale('C-2', 'PST-9', '2027-03', 50, 400),
  sale('C-3', 'PST-9', '2027-02', 5, 600),
  sale('C-2', 'PST-9', '2027-03', 999, 1, 'F002'), // another scenario
  sale('C-1', 'PST-9', '2027-05', 0, 0), // zero row
];
const lines = buildLines({ sales, products, customers, scenarioId: 'F001' });
const months2027 = monthsBetween('2027-01', '2027-12');

describe('windows and periods', () => {
  test('monthsBetween is inclusive and crosses years', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(monthsBetween('2027-03', '2027-01')).toEqual([]);
    expect(monthsBetween('bad', '2027-01')).toEqual([]);
  });

  test('quarterly columns hold only the window months of each quarter', () => {
    const q = buildPeriods({ start: '2027-02', end: '2027-07' }, 'quarterly');
    expect(q.map(p => p.key)).toEqual(['2027-Q1', '2027-Q2', '2027-Q3']);
    expect(q[0].months).toEqual(['2027-02', '2027-03']);
    expect(q[2].months).toEqual(['2027-07']);
    const m = buildPeriods({ start: '2027-01', end: '2027-12' }, 'monthly');
    expect(m).toHaveLength(12);
    expect(m[0]).toMatchObject({ key: '2027-01', label: 'Jan 2027', short: 'Jan 27' });
  });

  test('default window: the scenario sales window widened to whole years; empty scenario -> next year', () => {
    const now = new Date(2026, 9, 12);
    expect(defaultRevenueWindow({ start_period: '2027-03', end_period: '2027-10' }, now)).toEqual({ start: '2027-01', end: '2027-12' });
    expect(defaultRevenueWindow({ start_period: '2027-01', end_period: '2028-06' }, now)).toEqual({ start: '2027-01', end: '2028-06' });
    expect(defaultRevenueWindow({}, now)).toEqual({ start: '2027-01', end: '2027-12' });
    expect(defaultRevenueWindow(null, now)).toEqual({ start: '2027-01', end: '2027-12' });
  });

  test('yearsInWindow, windowCovers, describeWindow', () => {
    expect(yearsInWindow({ start: '2027-01', end: '2028-06' })).toEqual(['2027', '2028']);
    expect(windowCovers({ start: '2027-01', end: '2027-12' }, ['2027-01', '2027-12'])).toBe(true);
    expect(windowCovers({ start: '2027-01', end: '2027-06' }, ['2027-07'])).toBe(false);
    expect(describeWindow({ start: '2027-01', end: '2027-12' })).toBe('Jan 2027 – Dec 2027 · 12 months');
    expect(shortWindowLabel({ start: '2027-01', end: '2027-12' })).toBe('Jan–Dec 2027');
    expect(shortWindowLabel({ start: '2027-07', end: '2028-06' })).toBe('Jul 2027 – Jun 2028');
    expect(shortWindowLabel({ start: '2027-03', end: '2027-03' })).toBe('Mar 2027');
  });
});

describe('aggregation', () => {
  test('one line per customer x product of the scenario, sorted by customer then product', () => {
    expect(lines.map(l => l.id)).toEqual(['PST-9|C-3', 'PST-9|C-2', 'RFL-1|C-2', 'PST-9|C-1', 'RFL-1|C-1']);
    const c3 = lines.find(l => l.customer_id === 'C-3');
    expect(c3.segment).toBe(NO_TYPE);
  });

  test('summary counts only customers and products with units', () => {
    const s = summarizeLines(lines, months2027);
    expect(s.quantity).toBe(10 + 12 + 8 + 100 + 50 + 5);
    expect(s.revenue).toBe(10 * 1500 + 12 * 1500 + 8 * 1550 + 100 * 1200 + 50 * 400 + 5 * 600);
    expect(s.customers).toBe(3);
    expect(s.products).toBe(2);
    expect(s.lines).toBe(4); // the all-zero C-1 / PST-9 line is not counted
  });

  test('quarter columns sum their months (the quarterly view is never $0)', () => {
    const quarters = buildPeriods({ start: '2027-01', end: '2027-12' }, 'quarterly');
    const byQuarter = totalsByPeriod(lines, quarters);
    const monthly = totalsByPeriod(lines, buildPeriods({ start: '2027-01', end: '2027-12' }, 'monthly'));
    const sum = (rows) => rows.reduce((s, r) => s + r.revenue, 0);
    expect(sum(byQuarter)).toBeCloseTo(sum(monthly));
    expect(byQuarter[0].revenue).toBe(10 * 1500 + 12 * 1500 + 100 * 1200 + 50 * 400 + 5 * 600);
    const rows = buildMatrixRows(lines, quarters);
    const smith = rows.find(r => r.id === 'RFL-1|C-1');
    expect(smith['quantity_2027-Q1']).toBe(22);
    expect(smith['price_2027-Q1']).toBe(1500);
    expect(smith['quantity_2027-Q2']).toBe(8);
    expect(smith.total_revenue).toBe(22 * 1500 + 8 * 1550);
  });

  test('segment summary: sold customers / products only, shares add to 1', () => {
    const segs = summarizeBySegment(lines, months2027);
    expect(segs.map(s => s.name)).toEqual(['Distributor', 'Dealer', NO_TYPE]);
    const dealer = segs.find(s => s.name === 'Dealer');
    expect(dealer.customers).toBe(1); // 'Never buys' is not counted
    expect(dealer.products).toBe(1); // the zero PST-9 line is not counted
    expect(segs.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
  });

  test('a large scenario aggregates quickly (no products x customers x months scan)', () => {
    const big = [];
    for (let c = 0; c < 100; c += 1) {
      for (let p = 0; p < 60; p += 1) {
        for (let m = 1; m <= 12; m += 1) big.push(sale(`C${c}`, `P${p}`, `2027-${String(m).padStart(2, '0')}`, 1, 10));
      }
    }
    const t0 = Date.now();
    const bigLines = buildLines({ sales: big, products: [], customers: [], scenarioId: 'F001' });
    summarizeLines(bigLines, months2027);
    summarizeBySegment(bigLines, months2027);
    buildMatrixRows(bigLines, buildPeriods({ start: '2027-01', end: '2027-12' }, 'quarterly'));
    expect(bigLines).toHaveLength(6000);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('editing helpers', () => {
  test('carriedPrice takes the nearest earlier priced month, else the next one', () => {
    const smith = lines.find(l => l.id === 'RFL-1|C-1');
    expect(carriedPrice(smith, '2027-03')).toEqual({ price: 1500, from: '2027-02' });
    expect(carriedPrice(smith, '2027-06')).toEqual({ price: 1550, from: '2027-04' });
    const rsrPistol = lines.find(l => l.id === 'PST-9|C-2');
    expect(carriedPrice(rsrPistol, '2027-01')).toEqual({ price: 400, from: '2027-03' });
    const zero = lines.find(l => l.id === 'PST-9|C-1');
    expect(carriedPrice(zero, '2027-06')).toBeNull();
  });
});

describe('export', () => {
  test('long-format rows with ids, quoted safely, round-trip through a CSV parser', () => {
    const rows = salesExportRows(lines, months2027);
    expect(rows[0]).toEqual(expect.objectContaining({ customer_id: 'C-3', unit_id: 'PST-9', period: '2027-02', quantity: 5, unit_price: 600, revenue: 3000 }));
    const csv = Papa.unparse({ fields: SALES_EXPORT_COLUMNS, data: rows.map(r => SALES_EXPORT_COLUMNS.map(c => r[c])) });
    const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
    expect(parsed.errors).toEqual([]);
    const smith = parsed.data.filter(r => r.customer_id === 'C-1');
    expect(smith[0].customer_name).toBe('Smith, Jones & Co');
    expect(Object.keys(parsed.data[0])).toEqual(SALES_EXPORT_COLUMNS);
  });

  test('segment filter and float noise', () => {
    const noisy = buildLines({ sales: [sale('C-2', 'RFL-1', '2027-01', 3, 0.1 + 0.2)], products, customers, scenarioId: 'F001' });
    const [row] = salesExportRows(noisy, months2027);
    expect(row.unit_price).toBe(0.3);
    expect(row.revenue).toBe(0.9);
    expect(salesExportRows(lines, months2027, 'Dealer').every(r => r.customer_type === 'Dealer')).toBe(true);
  });
});

describe('formatting', () => {
  test('compact money ticks', () => {
    expect(formatMoneyCompact(12000000)).toBe('$12M');
    expect(formatMoneyCompact(1250000)).toBe('$1.3M');
    expect(formatMoneyCompact(850000)).toBe('$850K');
    expect(formatMoneyCompact(0)).toBe('$0');
  });

  test('quantities keep up to two decimals', () => {
    expect(formatQty(12.5)).toBe('12.5');
    expect(formatQty(1200)).toBe('1,200');
  });
});
