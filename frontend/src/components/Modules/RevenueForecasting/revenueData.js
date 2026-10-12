// Pure helpers for the sales forecast screen.
//
// Every tab (matrix, summary cards, customer types, charts, export) reads the
// same aggregation: the active scenario's sales rows indexed once per
// customer x product line and month. Nothing here walks the cartesian
// product of products x customers x months, so a large scenario stays fast,
// and a quarterly column always sums its three months.

import { calendarYearWindow, defaultWindowForScenario, toPeriod } from '../../../lib/scenarioWindow';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const NO_TYPE = 'No customer type';

const pad2 = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM' -> 'Jan 2027'. */
export const monthLabel = (period) => {
  const p = toPeriod(period);
  if (!p) return String(period || '');
  return `${MONTH_NAMES[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
};

/** Every 'YYYY-MM' from start to end inclusive ([] when invalid or reversed). */
export const monthsBetween = (start, end) => {
  const s = toPeriod(start);
  const e = toPeriod(end);
  if (!s || !e || s > e) return [];
  const out = [];
  let y = Number(s.slice(0, 4));
  let m = Number(s.slice(5, 7));
  const last = e;
  // Hard cap: 50 years of months is far beyond any real window.
  for (let i = 0; i < 600; i += 1) {
    const key = `${y}-${pad2(m)}`;
    if (key > last) break;
    out.push(key);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
};

/**
 * Columns for a window: one per month, or one per calendar quarter holding
 * only the window's months of that quarter.
 * -> [{ key, label, short, months: ['YYYY-MM', ...] }]
 */
export const buildPeriods = (window, mode = 'monthly') => {
  const months = monthsBetween(window?.start, window?.end);
  if (mode !== 'quarterly') {
    return months.map(m => ({
      key: m,
      label: monthLabel(m),
      short: `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`,
      months: [m],
    }));
  }
  const quarters = [];
  const byKey = new Map();
  months.forEach(m => {
    const q = Math.floor((Number(m.slice(5, 7)) - 1) / 3) + 1;
    const key = `${m.slice(0, 4)}-Q${q}`;
    if (!byKey.has(key)) {
      const entry = { key, label: `Q${q} ${m.slice(0, 4)}`, short: `Q${q} ${m.slice(2, 4)}`, months: [] };
      byKey.set(key, entry);
      quarters.push(entry);
    }
    byKey.get(key).months.push(m);
  });
  return quarters;
};

// ---------------------------------------------------------------------------
// Range (window) defaults
// ---------------------------------------------------------------------------

const hasSalesWindow = (scenario) => Boolean(toPeriod(scenario?.start_period) || toPeriod(scenario?.end_period));

/**
 * The window the sales screen opens on: the scenario's sales window widened
 * to whole calendar years (Jan-Dec 2027 for a 2027 budget). An empty
 * scenario opens on next calendar year, which is what a budget is built for.
 */
export const defaultRevenueWindow = (scenario, now = new Date()) => (
  hasSalesWindow(scenario)
    ? defaultWindowForScenario(scenario, now)
    : calendarYearWindow(now.getFullYear() + 1)
);

/** Calendar years a window touches, e.g. ['2027'] or ['2027', '2028']. */
export const yearsInWindow = (window) => {
  const s = toPeriod(window?.start);
  const e = toPeriod(window?.end);
  if (!s || !e) return [];
  const out = [];
  for (let y = Number(s.slice(0, 4)); y <= Number(e.slice(0, 4)); y += 1) out.push(String(y));
  return out;
};

/** True when every month in `months` is inside the window. */
export const windowCovers = (window, months) => {
  const s = toPeriod(window?.start);
  const e = toPeriod(window?.end);
  if (!s || !e) return false;
  return (months || []).every(m => {
    const p = toPeriod(m);
    return !p || (p >= s && p <= e);
  });
};

/** 'Jan–Dec 2027', or 'Jan 2027 – Jun 2028' across years. */
export const shortWindowLabel = (window) => {
  const s = toPeriod(window?.start);
  const e = toPeriod(window?.end);
  if (!s || !e) return '';
  if (s === e) return monthLabel(s);
  if (s.slice(0, 4) === e.slice(0, 4)) {
    return `${MONTH_NAMES[Number(s.slice(5, 7)) - 1]}–${MONTH_NAMES[Number(e.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
  }
  return `${monthLabel(s)} – ${monthLabel(e)}`;
};

/** 'Jan 2027 – Dec 2027 · 12 months' */
export const describeWindow = (window) => {
  const months = monthsBetween(window?.start, window?.end).length;
  if (!months) return 'No months selected';
  return `${monthLabel(window.start)} – ${monthLabel(window.end)} · ${months} month${months === 1 ? '' : 's'}`;
};

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Sales rows of one scenario -> one line per customer x product:
 *   { id, product_id, customer_id, product_name, customer_name, segment,
 *     months: Map('YYYY-MM' -> { quantity, unit_price, revenue }) }
 * sorted by customer name then product name. Revenue is quantity x unit
 * price, as in the statements engine.
 */
export const buildLines = ({ sales, products, customers, scenarioId }) => {
  const productById = new Map((products || []).map(p => [p.unit_id || p.id, p]));
  const customerById = new Map((customers || []).map(c => [c.customer_id, c]));
  const lines = new Map();
  (Array.isArray(sales) ? sales : []).forEach(sale => {
    if (!sale || (scenarioId && sale.forecast_id !== scenarioId)) return;
    const month = toPeriod(sale.period);
    if (!month) return;
    const id = `${sale.unit_id}|${sale.customer_id}`;
    let line = lines.get(id);
    if (!line) {
      const product = productById.get(sale.unit_id);
      const customer = customerById.get(sale.customer_id);
      line = {
        id,
        product_id: sale.unit_id,
        customer_id: sale.customer_id,
        product_name: product?.unit_name || product?.name || sale.unit_id,
        customer_name: customer?.customer_name || sale.customer_id,
        segment: (customer?.customer_type || '').trim() || NO_TYPE,
        months: new Map(),
      };
      lines.set(id, line);
    }
    const quantity = num(sale.quantity);
    const unitPrice = num(sale.unit_price);
    line.months.set(month, { quantity, unit_price: unitPrice, revenue: quantity * unitPrice });
  });
  return Array.from(lines.values()).sort((a, b) => (
    String(a.customer_name).localeCompare(String(b.customer_name))
    || String(a.product_name).localeCompare(String(b.product_name))
  ));
};

/** Quantity and revenue of one line over a list of months. */
export const lineTotals = (line, months) => {
  let quantity = 0;
  let revenue = 0;
  (months || []).forEach(m => {
    const cell = line.months.get(m);
    if (!cell) return;
    quantity += cell.quantity;
    revenue += cell.revenue;
  });
  return { quantity, revenue };
};

/**
 * Lines -> matrix rows for a set of period columns. Each row carries
 * quantity_<key>, price_<key>, revenue_<key> (a quarter's price is its
 * average) plus total_quantity / total_revenue for the visible columns.
 * `hasMonth_<key>` tells whether the month has a stored sales row.
 */
export const buildMatrixRows = (lines, periods) => (lines || []).map(line => {
  const row = {
    id: line.id,
    product_id: line.product_id,
    customer_id: line.customer_id,
    product_name: line.product_name,
    customer_name: line.customer_name,
    segment: line.segment,
    total_quantity: 0,
    total_revenue: 0,
  };
  (periods || []).forEach(period => {
    const { quantity, revenue } = lineTotals(line, period.months);
    let price = 0;
    if (period.months.length === 1) {
      price = line.months.get(period.months[0])?.unit_price || 0;
    } else if (quantity > 0) {
      price = revenue / quantity;
    }
    row[`quantity_${period.key}`] = quantity;
    row[`price_${period.key}`] = price;
    row[`revenue_${period.key}`] = revenue;
    row.total_quantity += quantity;
    row.total_revenue += revenue;
  });
  return row;
});

/** Headline numbers for the months shown: only lines that sell something count. */
export const summarizeLines = (lines, months) => {
  let quantity = 0;
  let revenue = 0;
  const products = new Set();
  const customers = new Set();
  let activeLines = 0;
  (lines || []).forEach(line => {
    const t = lineTotals(line, months);
    if (t.quantity === 0 && t.revenue === 0) return;
    quantity += t.quantity;
    revenue += t.revenue;
    activeLines += 1;
    if (t.quantity > 0) {
      products.add(line.product_id);
      customers.add(line.customer_id);
    }
  });
  return {
    quantity,
    revenue,
    averagePrice: quantity > 0 ? revenue / quantity : 0,
    products: products.size,
    customers: customers.size,
    lines: activeLines,
  };
};

const groupBy = (lines, months, keyOf, labelOf) => {
  const groups = new Map();
  (lines || []).forEach(line => {
    const t = lineTotals(line, months);
    if (t.quantity === 0 && t.revenue === 0) return;
    const key = keyOf(line);
    let g = groups.get(key);
    if (!g) {
      g = { key, name: labelOf(line), quantity: 0, revenue: 0, customers: new Set(), products: new Set(), lines: 0 };
      groups.set(key, g);
    }
    g.quantity += t.quantity;
    g.revenue += t.revenue;
    g.lines += 1;
    if (t.quantity > 0) {
      g.customers.add(line.customer_id);
      g.products.add(line.product_id);
    }
  });
  const total = Array.from(groups.values()).reduce((s, g) => s + g.revenue, 0);
  return Array.from(groups.values())
    .map(g => ({
      key: g.key,
      name: g.name,
      quantity: g.quantity,
      revenue: g.revenue,
      share: total > 0 ? g.revenue / total : 0,
      averagePrice: g.quantity > 0 ? g.revenue / g.quantity : 0,
      customers: g.customers.size,
      products: g.products.size,
      lines: g.lines,
    }))
    .sort((a, b) => b.revenue - a.revenue || String(a.name).localeCompare(String(b.name)));
};

/** Revenue, units, share, average price and buyer counts per customer type (sold lines only). */
export const summarizeBySegment = (lines, months) => groupBy(lines, months, l => l.segment, l => l.segment);

export const summarizeByProduct = (lines, months) => groupBy(lines, months, l => l.product_id, l => l.product_name);

export const summarizeByCustomer = (lines, months) => groupBy(lines, months, l => l.customer_id, l => l.customer_name);

/** Revenue and units per column (month or quarter). */
export const totalsByPeriod = (lines, periods) => (periods || []).map(period => {
  let quantity = 0;
  let revenue = 0;
  (lines || []).forEach(line => {
    const t = lineTotals(line, period.months);
    quantity += t.quantity;
    revenue += t.revenue;
  });
  return { key: period.key, name: period.label, short: period.short, quantity, revenue };
});

// ---------------------------------------------------------------------------
// Editing helpers
// ---------------------------------------------------------------------------

/**
 * Price to use when a quantity is typed into a month that has no price yet:
 * the nearest earlier month with a price, else the nearest later one.
 * -> { price, from: 'YYYY-MM' } or null.
 */
export const carriedPrice = (line, month) => {
  if (!line || !line.months) return null;
  const priced = Array.from(line.months.entries())
    .filter(([, cell]) => cell.unit_price > 0)
    .map(([m, cell]) => ({ month: m, price: cell.unit_price }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
  if (priced.length === 0) return null;
  const before = priced.filter(p => p.month < month);
  const pick = before.length ? before[before.length - 1] : priced.find(p => p.month > month) || priced[priced.length - 1];
  return { price: pick.price, from: pick.month };
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const round2 = (v) => Math.round(num(v) * 100) / 100;

export const SALES_EXPORT_COLUMNS = [
  'customer_id', 'customer_name', 'customer_type', 'unit_id', 'unit_name',
  'period', 'quantity', 'unit_price', 'revenue',
];

/**
 * One row per customer x product x month in the window, in the same columns
 * the sales import reads (customer_id, unit_id, period, quantity, unit_price),
 * so an exported file can be edited and imported back.
 */
export const salesExportRows = (lines, months, segment = 'all') => {
  const out = [];
  (lines || []).forEach(line => {
    if (segment !== 'all' && line.segment !== segment) return;
    (months || []).forEach(m => {
      const cell = line.months.get(m);
      if (!cell) return;
      out.push({
        customer_id: line.customer_id,
        customer_name: line.customer_name,
        customer_type: line.segment === NO_TYPE ? '' : line.segment,
        unit_id: line.product_id,
        unit_name: line.product_name,
        period: m,
        quantity: Math.round(cell.quantity * 10000) / 10000,
        unit_price: round2(cell.unit_price),
        revenue: round2(cell.revenue),
      });
    });
  });
  return out;
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const money0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export const formatMoney = (v) => money0.format(num(v));
export const formatPrice = (v) => money2.format(num(v));
export const formatQty = (v) => qtyFormat.format(num(v));

/** Axis ticks: $0, $850K, $1.2M, $12M. */
export const formatMoneyCompact = (v) => {
  const n = num(v);
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const trim = (x) => (x >= 100 ? x.toFixed(0) : x.toFixed(1).replace(/\.0$/, ''));
  if (abs >= 1e9) return `${sign}$${trim(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}$${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}$${trim(abs / 1e3)}K`;
  return `${sign}$${abs.toFixed(0)}`;
};

export const formatShare = (v) => `${(num(v) * 100).toFixed(1)}%`;
