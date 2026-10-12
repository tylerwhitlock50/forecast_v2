// Pure helpers for the COGS & Labor Forecast screen: table rows, sorting,
// monthly matrices and the CSV of whatever table is on screen.
import { formatPeriod } from './formatters';
import { DEDUCTION_HELP, LABOR_HELP } from './lineHelp';

// ---------------------------------------------------------------------------
// Gross margin bridge (GET /reporting/cogs-forecast -> summary)
// ---------------------------------------------------------------------------

// Gross profit as the income statement computes it; the per-group figures stop at contribution margin.
export const GROSS_PROFIT_HELP = 'Net sales less total COGS: product COGS (materials, direct labor at standard, machine) '
  + '+ direct labor variance + indirect labor + factory overhead + other COGS. Ties to the income statement.';
export const PERIOD_COSTS_NOTE = 'The direct labor variance, indirect labor, factory overhead and other COGS are period '
  + 'costs: they are in gross profit but appear only in the gross margin bridge, not per product or customer.';

export const BRIDGE_ROWS = [
  { key: 'gross_sales', label: 'Gross sales', kind: 'subtotal', help: 'Invoice value of the sales forecast (quantity × price), including any excise tax embedded in the price.' },
  { key: 'terms_allowance', label: 'Terms allowance', kind: 'line', indent: 1, deduction: true, help: DEDUCTION_HELP.terms_allowance },
  { key: 'chargebacks', label: 'Chargebacks allowance', kind: 'line', indent: 1, deduction: true, help: DEDUCTION_HELP.chargebacks },
  { key: 'other_allowances', label: 'Other discounts & allowances', kind: 'line', indent: 1, deduction: true, help: DEDUCTION_HELP.other_allowances },
  { key: 'excise_tax', label: 'Excise tax (FET)', kind: 'line', indent: 1, deduction: true, help: DEDUCTION_HELP.excise_tax },
  { key: 'total_sales_deductions', label: 'Total sales deductions', kind: 'line', deduction: true },
  { key: 'net_sales', label: 'Net sales', kind: 'subtotal', help: 'Gross sales less sales deductions.' },
  { key: 'units', label: 'Units sold', kind: 'line', indent: 1, format: 'number' },
  { key: 'cogs_header', label: 'Cost of goods sold', kind: 'header' },
  { key: 'materials', label: 'Materials', kind: 'line', indent: 1, help: 'BOM material cost per unit × units sold.' },
  { key: 'labor', label: 'Direct labor (standard)', kind: 'line', indent: 1, help: LABOR_HELP.cogs_labor },
  { key: 'labor_variance', label: 'Direct labor variance (payroll vs standard)', kind: 'line', indent: 1, help: LABOR_HELP.labor_variance },
  { key: 'machine', label: 'Machine / manufacturing', kind: 'line', indent: 1, help: 'Routing machine minutes × machine rates × units sold.' },
  { key: 'indirect_labor', label: 'Indirect labor (factory)', kind: 'line', indent: 1, help: LABOR_HELP.indirect_labor },
  { key: 'factory_overhead', label: 'Factory overhead', kind: 'line', indent: 1, help: 'Expenses categorised as factory overhead (a period cost, not per unit).' },
  { key: 'other_cogs', label: 'Other COGS', kind: 'line', indent: 1 },
  { key: 'total_cogs', label: 'Total COGS', kind: 'subtotal' },
  { key: 'gross_profit', label: 'Gross profit', kind: 'total', help: GROSS_PROFIT_HELP },
  { key: 'gross_margin_pct', label: 'Gross margin %', kind: 'pct', indent: 1 }
];

/** StatementTable columns for the bridge: one per month plus Total. */
export const bridgeColumns = (summary) => {
  const cols = (summary?.by_period || []).map(row => ({ key: row.period, values: row }));
  if (summary?.totals) cols.push({ key: 'total', label: 'Total', values: summary.totals, emphasis: true });
  return cols;
};

/** CSV rows (header first) for a StatementTable layout. Deduction rows are exported as negatives, as shown. */
export const statementCsvRows = (rows, columns, firstHeader = 'Line') => {
  const header = [firstHeader, ...columns.map(c => (c.label !== undefined ? c.label : formatPeriod(c.key)))];
  const body = rows.map(row => {
    if (row.kind === 'header') return [row.label, ...columns.map(() => '')];
    return [row.label, ...columns.map(c => {
      const v = c.values ? c.values[row.key] : undefined;
      if (typeof v !== 'number') return '';
      return row.deduction || row.negate ? -v : v;
    })];
  });
  return [header, ...body];
};

export const hasSalesInWindow = (cogs) =>
  Boolean(cogs) && ((cogs.line_count || 0) > 0 || (cogs.by_product || []).length > 0 || (cogs.summary?.totals?.gross_sales || 0) !== 0);

// ---------------------------------------------------------------------------
// By product / customer / customer type / product type
// ---------------------------------------------------------------------------

export const GROUPINGS = {
  product: {
    source: 'by_product',
    nameHeader: 'Product',
    name: e => e.unit_name || e.unit_id || 'Unknown product',
    sub: e => (e.unit_name && e.unit_id && e.unit_name !== e.unit_id ? e.unit_id : null),
    typeHeader: 'Product type',
    type: e => e.unit_type || null,
    key: e => e.unit_id || e.unit_name || 'unknown'
  },
  product_type: {
    source: 'by_product_type',
    nameHeader: 'Product type',
    name: e => e.unit_type || 'Unassigned',
    key: e => e.unit_type || 'Unassigned'
  },
  customer: {
    source: 'by_customer',
    nameHeader: 'Customer',
    name: e => e.customer_name || e.customer_id || 'Unknown customer',
    sub: e => (e.customer_name && e.customer_id && e.customer_name !== e.customer_id ? e.customer_id : null),
    typeHeader: 'Customer type',
    type: e => e.customer_type || null,
    key: e => e.customer_id || e.customer_name || 'unknown'
  },
  customer_type: {
    source: 'by_customer_type',
    nameHeader: 'Customer type',
    name: e => e.customer_type || 'Unassigned',
    key: e => e.customer_type || 'Unassigned'
  }
};

// Summary columns of the dimension tables (and of their CSV). Columns marked
// `inline` are shown on screen as the small per-unit figure under the column
// named by `perUnit`, so the table fits without scrolling.
export const GROUP_COLUMNS = [
  { key: 'units', label: 'Units', format: 'number' },
  { key: 'gross_sales', label: 'Gross sales', format: 'money' },
  { key: 'total_sales_deductions', label: 'Deductions', format: 'deduction', help: 'Terms, chargebacks, other allowances and excise tax taken off gross sales.' },
  { key: 'net_sales', label: 'Net sales', format: 'money', perUnit: 'avg_net_price', help: 'Gross sales less deductions; the small figure is the average net price per unit.' },
  { key: 'avg_net_price', label: 'Avg net price', format: 'money2', help: 'Net sales ÷ units.', inline: true },
  { key: 'product_cogs', label: 'Product COGS', format: 'money', perUnit: 'cost_per_unit', help: 'Materials + direct labor + machine cost from the BOM and routing; the small figure is the cost per unit.' },
  { key: 'cost_per_unit', label: 'Cost / unit', format: 'money2', help: 'Product COGS ÷ units.', inline: true },
  { key: 'contribution_margin', label: 'Contribution', format: 'money', help: 'Net sales − product COGS, before the direct labor variance, indirect labor, factory overhead and other COGS (period costs, shown only in the bridge).' },
  { key: 'contribution_margin_pct', label: 'CM %', format: 'pct', nowrap: true, help: 'Contribution ÷ net sales.' },
  {
    key: 'commissions',
    label: 'Commissions',
    format: 'money',
    only: ['customer', 'customer_type'],
    help: 'Sales commissions on these sales. They are an operating expense on the income statement, so they are not taken off net sales or contribution.'
  }
];

/** Summary columns for one grouping (commissions only for customers and customer types). */
export const groupColumns = (grouping) => GROUP_COLUMNS.filter(c => !c.only || c.only.includes(grouping));

/** On-screen summary columns for one grouping (per-unit figures shown inline). */
export const displayGroupColumns = (grouping) => groupColumns(grouping).filter(c => !c.inline);

export const DISPLAY_GROUP_COLUMNS = GROUP_COLUMNS.filter(c => !c.inline && !c.only);

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : parseFloat(v) || 0);
const ratio = (a, b) => (b ? a / b : 0);

/** Flatten API group entries into table rows with every summary metric. */
export const groupRows = (cogs, grouping) => {
  const g = GROUPINGS[grouping];
  if (!g) return [];
  return (cogs?.[g.source] || []).map(e => {
    const t = e.totals || {};
    const units = n(t.units);
    const gross = n(t.gross_sales);
    const net = n(t.net_sales);
    const cogsAmt = n(t.product_cogs);
    const cm = t.contribution_margin !== undefined ? n(t.contribution_margin) : net - cogsAmt;
    return {
      key: g.key(e),
      name: g.name(e),
      sub: g.sub ? g.sub(e) : null,
      type: g.type ? g.type(e) : null,
      units,
      gross_sales: gross,
      total_sales_deductions: t.total_sales_deductions !== undefined ? n(t.total_sales_deductions) : gross - net,
      net_sales: net,
      avg_net_price: t.avg_net_price !== undefined ? n(t.avg_net_price) : ratio(net, units),
      product_cogs: cogsAmt,
      cost_per_unit: t.cost_per_unit !== undefined ? n(t.cost_per_unit) : ratio(cogsAmt, units),
      contribution_margin: cm,
      contribution_margin_pct: t.contribution_margin_pct !== undefined ? n(t.contribution_margin_pct) : ratio(cm, net) * 100,
      commissions: n(t.commissions),
      by_period: e.by_period || {}
    };
  });
};

/** Totals row for group rows (ratios recomputed, never summed). */
export const groupTotals = (rows) => {
  const t = rows.reduce((acc, r) => {
    ['units', 'gross_sales', 'total_sales_deductions', 'net_sales', 'product_cogs', 'contribution_margin', 'commissions'].forEach(k => { acc[k] += r[k] || 0; });
    return acc;
  }, { units: 0, gross_sales: 0, total_sales_deductions: 0, net_sales: 0, product_cogs: 0, contribution_margin: 0, commissions: 0 });
  t.avg_net_price = ratio(t.net_sales, t.units);
  t.cost_per_unit = ratio(t.product_cogs, t.units);
  t.contribution_margin_pct = ratio(t.contribution_margin, t.net_sales) * 100;
  return t;
};

/** Stable sort by a column key; text columns compare case-insensitively. */
export const sortRows = (rows, key, direction = 'desc') => {
  const dir = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === 'string' || typeof bv === 'string') {
      return String(av || '').localeCompare(String(bv || ''), undefined, { sensitivity: 'base' }) * dir;
    }
    return ((av || 0) - (bv || 0)) * dir;
  });
};

export const MONTHLY_METRICS = [
  { key: 'units', label: 'Units', format: 'number' },
  { key: 'gross_sales', label: 'Gross sales', format: 'money' },
  { key: 'net_sales', label: 'Net sales', format: 'money' },
  { key: 'product_cogs', label: 'Product COGS', format: 'money' },
  { key: 'contribution_margin', label: 'Contribution', format: 'money' }
];

/** Value of one metric for one month of a group row (0 when the month has no sales). */
export const monthValue = (row, period, metric) => n(row.by_period?.[period]?.[metric]);

/** Month totals across rows for one metric. */
export const monthTotals = (rows, periods, metric) =>
  Object.fromEntries(periods.map(p => [p, rows.reduce((s, r) => s + monthValue(r, p, metric), 0)]));

const summaryValue = (row, col) => (col.format === 'deduction' ? -row[col.key] : row[col.key]);

/** CSV rows for a dimension table in summary or monthly view. */
export const groupCsvRows = (rows, grouping, { view = 'summary', periods = [], metric = 'net_sales' } = {}) => {
  const g = GROUPINGS[grouping];
  const lead = [g.nameHeader, ...(g.sub ? ['ID'] : []), ...(g.type ? [g.typeHeader] : [])];
  const leadCells = (r) => [r.name, ...(g.sub ? [r.key] : []), ...(g.type ? [r.type || ''] : [])];
  const blanks = lead.slice(1).map(() => '');
  if (view === 'monthly') {
    const metricLabel = (MONTHLY_METRICS.find(m => m.key === metric) || {}).label || metric;
    const totals = monthTotals(rows, periods, metric);
    return [
      [...lead, ...periods.map(formatPeriod), `Total ${metricLabel.toLowerCase()}`],
      ...rows.map(r => {
        const values = periods.map(p => monthValue(r, p, metric));
        return [...leadCells(r), ...values, values.reduce((a, b) => a + b, 0)];
      }),
      ['Total', ...blanks, ...periods.map(p => totals[p]), periods.reduce((s, p) => s + totals[p], 0)]
    ];
  }
  const totals = groupTotals(rows);
  const columns = groupColumns(grouping);
  return [
    [...lead, ...columns.map(c => c.label)],
    ...rows.map(r => [...leadCells(r), ...columns.map(c => summaryValue(r, c))]),
    ['Total', ...blanks, ...columns.map(c => summaryValue(totals, c))]
  ];
};

// ---------------------------------------------------------------------------
// Labor (GET /reporting/labor-forecast)
// ---------------------------------------------------------------------------

export const LABOR_METRICS = [
  { key: 'hours', label: 'Hours', decimals: 0, unit: 'hrs' },
  { key: 'cost', label: 'Cost', decimals: 0, unit: '$' },
  { key: 'fte', label: 'FTE', decimals: 1, unit: 'FTE' }
];

/**
 * Labor matrix for one metric: a row per labor type with a value per month,
 * plus the total column (sum for hours / cost, average for FTE) and a totals row.
 */
export const laborMatrix = (labor, metric = 'hours') => {
  const periods = labor?.periods || [];
  const isFte = metric === 'fte';
  const rows = (labor?.by_labor_type || []).map(t => {
    const values = Object.fromEntries(periods.map(p => [p, n(t.by_period?.[p]?.[metric])]));
    const total = isFte ? n(t.totals?.avg_fte) : n(t.totals?.[metric]);
    return {
      key: t.labor_type_id,
      name: t.labor_type_name || t.labor_type_id,
      rate: t.hourly_rate,
      values,
      total,
      peak: isFte ? n(t.totals?.peak_fte) : null
    };
  });
  const byPeriod = Object.fromEntries((labor?.totals_by_period || []).map(r => [r.period, r]));
  const totalValues = Object.fromEntries(periods.map(p => [p, byPeriod[p] ? n(byPeriod[p][metric]) : rows.reduce((s, r) => s + r.values[p], 0)]));
  const totalsRow = {
    key: 'total',
    name: 'Total',
    values: totalValues,
    total: isFte ? n(labor?.totals?.avg_fte) : n(labor?.totals?.[metric]),
    peak: isFte ? n(labor?.totals?.peak_fte) : null
  };
  return { periods, rows, totalsRow, totalLabel: isFte ? 'Average' : 'Total' };
};

/**
 * Standard (routings) vs payroll (employees classed Direct) by month, from
 * GET /reporting/labor-forecast -> standard_vs_payroll. One row per measure,
 * a value per month plus the window total (utilization = standard hours /
 * paid hours, recomputed for the total, never summed).
 */
export const LABOR_COMPARISON_ROWS = [
  { key: 'standard_hours', label: 'Standard hours (routings)', format: 'number' },
  { key: 'paid_hours', label: 'Paid hours (Direct employees)', format: 'number' },
  { key: 'utilization_pct', label: 'Utilization', format: 'pct', help: 'Standard hours ÷ paid hours of employees classed Direct.' },
  { key: 'standard_cost', label: 'Direct labor (standard)', format: 'money' },
  { key: 'direct_payroll_cost', label: 'Direct payroll', format: 'money' },
  { key: 'labor_variance', label: 'Direct labor variance', format: 'money', help: 'Direct payroll − standard: the variance line on the income statement.' },
  { key: 'indirect_payroll_cost', label: 'Indirect labor (factory)', format: 'money' }
];

export const laborComparison = (labor) => {
  const block = labor?.standard_vs_payroll;
  if (!block || !Array.isArray(block.by_period)) return null;
  const periods = labor?.periods || block.by_period.map(r => r.period);
  const byPeriod = Object.fromEntries(block.by_period.map(r => [r.period, r]));
  const totals = block.totals || {};
  const rows = LABOR_COMPARISON_ROWS.map(def => ({
    ...def,
    values: Object.fromEntries(periods.map(p => {
      const v = byPeriod[p]?.[def.key];
      return [p, typeof v === 'number' ? v : (def.format === 'pct' ? null : 0)];
    })),
    total: typeof totals[def.key] === 'number' ? totals[def.key] : (def.format === 'pct' ? null : 0)
  }));
  const hasPayroll = n(totals.direct_payroll_cost) > 0 || n(totals.indirect_payroll_cost) > 0;
  return { periods, rows, hasPayroll, hasDirect: n(totals.direct_payroll_cost) > 0 };
};

export const laborCsvRows = (labor, metric) => {
  const { periods, rows, totalsRow, totalLabel } = laborMatrix(labor, metric);
  const isFte = metric === 'fte';
  const header = ['Labor type', 'Hourly rate', ...periods.map(formatPeriod), totalLabel, ...(isFte ? ['Peak'] : [])];
  const line = (r) => [r.name, r.rate ?? '', ...periods.map(p => r.values[p]), r.total, ...(isFte ? [r.peak] : [])];
  return [header, ...rows.map(line), line({ ...totalsRow, rate: '' })];
};

/** Rows for the stacked hours chart: one object per month, a key per labor type. */
export const laborChartData = (labor) => {
  const periods = labor?.periods || [];
  return periods.map(p => {
    const row = { period: p, label: formatPeriod(p) };
    (labor?.by_labor_type || []).forEach(t => {
      row[t.labor_type_id] = Math.round(n(t.by_period?.[p]?.hours) * 10) / 10;
    });
    return row;
  });
};

// ---------------------------------------------------------------------------
// Machines
// ---------------------------------------------------------------------------

export const isOverCapacity = (utilizationPct) => typeof utilizationPct === 'number' && utilizationPct > 100;

export const machineCsvRows = (labor) => {
  const periods = labor?.periods || [];
  const header = ['Machine', 'Measure', 'Available hours / month', ...periods.map(formatPeriod), 'Total / peak'];
  const out = [header];
  (labor?.by_machine || []).forEach(m => {
    const avail = m.available_hours_per_month ?? '';
    out.push([m.machine_name || m.machine_id, 'Hours needed', avail, ...periods.map(p => n(m.by_period?.[p]?.hours)), n(m.totals?.hours)]);
    out.push([m.machine_name || m.machine_id, 'Utilization %', avail,
      ...periods.map(p => {
        const u = m.by_period?.[p]?.utilization_pct;
        return typeof u === 'number' ? u : '';
      }),
      typeof m.totals?.peak_utilization_pct === 'number' ? m.totals.peak_utilization_pct : '']);
  });
  return out;
};

// ---------------------------------------------------------------------------
// Unit costs
// ---------------------------------------------------------------------------

export const unitCostCsvRows = (unitCosts) => [
  ['Product ID', 'Product', 'BOM', 'BOM version', 'Routing', 'Material / unit', 'Labor / unit', 'Machine / unit', 'Total / unit',
    'Labor minutes / unit', 'Machine minutes / unit', 'Warnings'],
  ...(unitCosts || []).map(u => [
    u.unit_id, u.unit_name, u.bom_id || '', u.bom_version || '', u.router_id || '',
    n(u.material_per_unit), n(u.labor_per_unit), n(u.machine_per_unit), n(u.total_per_unit),
    n(u.labor_minutes_per_unit), n(u.machine_minutes_per_unit), (u.warnings || []).join('; ')
  ])
];

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

/** Busiest month of a labor-forecast machine entry: { period, pct } or null. */
export const machinePeak = (machine) => {
  let best = null;
  Object.entries(machine?.by_period || {}).forEach(([period, b]) => {
    const u = b?.utilization_pct;
    if (typeof u === 'number' && (!best || u > best.pct)) best = { period, pct: u };
  });
  if (!best && typeof machine?.totals?.peak_utilization_pct === 'number') {
    best = { period: null, pct: machine.totals.peak_utilization_pct };
  }
  return best;
};

/**
 * Warnings for the page: the COGS forecast's, then the labor forecast's.
 * A labor warning is dropped only when the COGS forecast already raised the
 * same code (both report incomplete product costs); per-machine warnings
 * (one per machine, same code) are all kept, and each machine warning gets
 * the machine's name and busiest month from by_machine.
 */
export const mergeReportWarnings = (cogs, labor) => {
  const cogsWarnings = cogs?.warnings || [];
  const cogsCodes = new Set(cogsWarnings.map(w => w?.code));
  const machines = Object.fromEntries((labor?.by_machine || []).map(m => [m.machine_id, m]));
  const seen = new Set();
  const out = [];
  const add = (w) => {
    if (!w) return;
    const key = [w.code, w.machine_id || '', w.message || ''].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(w);
  };
  cogsWarnings.forEach(add);
  (labor?.warnings || []).forEach(w => {
    if (!w || cogsCodes.has(w.code)) return;
    if (w.code === 'machine_over_capacity' && w.machine_id && machines[w.machine_id]) {
      const m = machines[w.machine_id];
      const peak = machinePeak(m);
      add({
        ...w,
        machine_name: w.machine_name || m.machine_name || w.machine_id,
        peak_utilization_pct: peak ? peak.pct : undefined,
        peak_period: peak ? peak.period : undefined
      });
    } else {
      add(w);
    }
  });
  return out;
};

// ---------------------------------------------------------------------------
// Headline figures
// ---------------------------------------------------------------------------

export const headline = (cogs, labor) => {
  const t = cogs?.summary?.totals || {};
  const gross = n(t.gross_sales);
  const deductions = n(t.total_sales_deductions);
  const net = n(t.net_sales);
  const units = n(t.units);
  return {
    gross,
    units,
    deductions,
    deductionPct: gross ? (deductions / gross) * 100 : null,
    net,
    avgNetPrice: units ? net / units : null,
    totalCogs: n(t.total_cogs),
    grossProfit: n(t.gross_profit),
    grossMarginPct: t.gross_margin_pct !== undefined ? n(t.gross_margin_pct) : (net ? (n(t.gross_profit) / net) * 100 : null),
    laborHours: labor ? n(labor.totals?.hours) : null,
    laborCost: labor ? n(labor.totals?.cost) : null,
    avgFte: labor ? n(labor.totals?.avg_fte) : null,
    peakFte: labor ? n(labor.totals?.peak_fte) : null
  };
};
