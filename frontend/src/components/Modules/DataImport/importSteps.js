// The import steps, in the order data depends on each other, plus pure
// helpers that read the /import responses. Column lists are a fallback for
// when GET /import/templates is unavailable; the server's list wins.

export const IMPORT_STEPS = [
  {
    kind: 'customers',
    rowNoun: ['customer', 'customers'],
    title: 'Customers',
    noun: ['customer', 'customers'],
    purpose: 'Who you sell to. The customer type (Dealer, Distributor, Direct, Government…) drives pricing, discounts and allowances.',
    endpoint: '/import/records',
    table: 'customers',
    modes: [
      { value: 'upsert', label: 'Add new and update existing', help: 'Customers already in the system are updated from the file; new ones are added.' },
      { value: 'skip', label: 'Add new only', help: 'Customers already in the system are left exactly as they are.' },
    ],
    required: ['customer_name'],
    optional: ['customer_id', 'customer_type', 'region'],
    manageLink: { to: '/customers', label: 'Open customers' },
  },
  {
    kind: 'products',
    rowNoun: ['product', 'products'],
    title: 'Products',
    noun: ['product', 'products'],
    purpose: 'What you sell. The list price (base_price) is the fallback price, and the product type (Rifle, Pistol…) drives excise tax.',
    endpoint: '/import/records',
    table: 'units',
    modes: [
      { value: 'upsert', label: 'Add new and update existing', help: 'Products already in the system are updated from the file; new ones are added.' },
      { value: 'skip', label: 'Add new only', help: 'Products already in the system are left exactly as they are.' },
    ],
    required: ['unit_id', 'unit_name'],
    optional: ['base_price', 'unit_type', 'unit_description', 'bom_id', 'router_id'],
    manageLink: { to: '/products', label: 'Open products' },
  },
  {
    kind: 'machines',
    rowNoun: ['machine', 'machines'],
    title: 'Machines',
    noun: ['machine', 'machines'],
    purpose: 'Work centers used in routings, with an hourly rate and monthly capacity for the machine-hours forecast.',
    endpoint: '/import/records',
    table: 'machines',
    modes: [
      { value: 'upsert', label: 'Add new and update existing', help: 'Machines already in the system are updated from the file; new ones are added.' },
      { value: 'skip', label: 'Add new only', help: 'Machines already in the system are left exactly as they are.' },
    ],
    required: ['machine_name'],
    optional: ['machine_id', 'machine_rate', 'available_minutes_per_month', 'machine_description'],
    manageLink: { to: '/machines', label: 'Open machines' },
  },
  {
    kind: 'labor_rates',
    rowNoun: ['labor rate', 'labor rates'],
    title: 'Labor rates',
    noun: ['labor rate', 'labor rates'],
    purpose: 'Hourly cost of each kind of labor (machinist, assembler…). Routings point at these to cost labor and build the labor forecast.',
    endpoint: '/import/records',
    table: 'labor_rates',
    modes: [
      { value: 'upsert', label: 'Add new and update existing', help: 'Rates already in the system are updated from the file; new ones are added.' },
      { value: 'skip', label: 'Add new only', help: 'Rates already in the system are left exactly as they are.' },
    ],
    required: ['rate_name', 'rate_amount'],
    optional: ['rate_id', 'rate_type', 'rate_description'],
    manageLink: { to: '/labor-rates', label: 'Open labor rates' },
  },
  {
    kind: 'routings',
    rowNoun: ['operation', 'operations'],
    title: 'Routings',
    noun: ['routing', 'routings'],
    purpose: 'The operations to build each product: machine minutes and labor minutes per unit, by labor type.',
    endpoint: '/import/routings',
    modes: [
      { value: 'replace', label: 'Replace routings in the file', help: 'Every routing named in the file is rebuilt from the file; routings not in the file are untouched.' },
      { value: 'append', label: 'Add or update operations', help: 'Operations are added or updated by routing and sequence; other operations are kept.' },
    ],
    options: [
      { key: 'auto_create', label: 'Create missing machines and labor types as placeholders ($0 rate)', default: false },
    ],
    required: ['router_id', 'machine_id'],
    optional: ['router_name', 'sequence', 'machine_minutes', 'labor_minutes', 'labor_type_id', 'operation_description', 'unit_id'],
    manageLink: { to: '/routing', label: 'Open routings' },
  },
  {
    kind: 'boms',
    rowNoun: ['BOM line', 'BOM lines'],
    title: 'Bills of materials',
    noun: ['BOM', 'BOMs'],
    purpose: 'The parts in each product with quantity and cost. Material cost per unit feeds COGS.',
    endpoint: '/import/boms',
    modes: [
      { value: 'replace', label: 'Replace BOMs in the file', help: 'Every BOM (and version) named in the file is rebuilt from the file; other BOMs are untouched.' },
      { value: 'append', label: 'Add or update lines', help: 'Lines are added or updated by BOM, version and line number; other lines are kept.' },
    ],
    options: [
      { key: 'link_products', label: 'Link products to their BOM when the file has a product column', default: true },
    ],
    required: ['bom_id', 'material_description', 'qty'],
    optional: ['bom_name', 'version', 'bom_line', 'part_number', 'unit', 'unit_price', 'material_cost', 'unit_id'],
    manageLink: { to: '/bom', label: 'Open BOMs' },
  },
  {
    kind: 'prices',
    rowNoun: ['price rule', 'price rules'],
    title: 'Prices',
    noun: ['price', 'prices'],
    purpose: 'What each customer or customer type pays: a fixed price per product or a discount off list price.',
    endpoint: '/import/prices',
    modes: [
      { value: 'upsert', label: 'Add new and update matching', help: 'A rule for the same customer, type, product and months is updated; anything else is added.' },
      { value: 'append', label: 'Add all as new', help: 'Every row becomes a new rule, even if a similar one exists.' },
      { value: 'replace', label: 'Replace all', help: 'Deletes every existing rule of the same scope (company-wide, or the scenario) first, then adds the file.' },
    ],
    options: [
      { key: 'scenarioOnly', label: 'Only for the active scenario (otherwise company-wide, unless a row has its own forecast_id)', default: false, needsScenario: true },
    ],
    required: ['price or discount'],
    optional: ['unit_id', 'customer_id', 'customer_type', 'start_period', 'end_period', 'notes'],
    manageLink: { to: '/pricing?tab=prices', label: 'Open price list' },
  },
  {
    kind: 'deductions',
    rowNoun: ['rule', 'rules'],
    title: 'Discounts & allowances',
    noun: ['rule', 'rules'],
    purpose: 'Terms allowance, chargebacks, other allowances, excise tax and commissions, by customer, customer type or product.',
    endpoint: '/import/deductions',
    modes: [
      { value: 'upsert', label: 'Add new and update matching', help: 'A rule for the same customer, type, product and months is updated; anything else is added.' },
      { value: 'append', label: 'Add all as new', help: 'Every row becomes a new rule, even if a similar one exists.' },
      { value: 'replace', label: 'Replace all', help: 'Deletes every existing rule of the same scope (company-wide, or the scenario) first, then adds the file.' },
    ],
    options: [
      { key: 'scenarioOnly', label: 'Only for the active scenario (otherwise company-wide, unless a row has its own forecast_id)', default: false, needsScenario: true },
    ],
    required: ['deduction_type', 'rate'],
    optional: ['name', 'method', 'customer_id', 'customer_type', 'unit_id', 'unit_type', 'start_period', 'end_period'],
    manageLink: { to: '/pricing', label: 'Open discounts & allowances' },
  },
  {
    kind: 'sales',
    rowNoun: ['sales row', 'sales rows'],
    title: 'Sales forecast',
    noun: ['sales row', 'sales rows'],
    purpose: 'Units by customer, product and month. Leave the price blank to use the price list.',
    endpoint: '/forecast/smart_import_sales',
    modes: null,
    options: [
      { key: 'autoCreate', label: 'Create customers and products that are not set up yet', default: false },
      { key: 'allowZeroPrice', label: 'Import rows that have no price at $0 (otherwise they are reported as errors)', default: false },
    ],
    required: ['customer_id', 'unit_id', 'period', 'quantity'],
    optional: ['unit_price', 'customer_name', 'customer_type', 'unit_name'],
    manageLink: { to: '/sales-forecast', label: 'Open sales forecast' },
  },
];

export const stepByKind = (kind) => IMPORT_STEPS.find((s) => s.kind === kind) || null;

export const plural = (n, [one, many]) => `${Number(n || 0).toLocaleString('en-US')} ${Number(n) === 1 ? one : many}`;

const asArray = (value) => (Array.isArray(value) ? value : []);

/**
 * GET /import/templates -> {kind: {required: [...], optional: [...], description}}.
 * Accepts a list of {kind, columns:[{name, required, description}]} or a map
 * keyed by kind; anything unrecognised is ignored.
 */
export const normalizeTemplateDocs = (payload) => {
  const out = {};
  const data = payload?.data ?? payload;
  let entries = [];
  if (Array.isArray(data)) entries = data;
  else if (Array.isArray(data?.templates)) entries = data.templates;
  else if (Array.isArray(data?.kinds)) entries = data.kinds;
  else if (data && typeof data === 'object') {
    const source = data.templates && typeof data.templates === 'object' ? data.templates : data;
    entries = Object.entries(source).map(([kind, value]) => ({ kind, ...(value && typeof value === 'object' ? value : {}) }));
  }
  entries.forEach((entry) => {
    const kind = entry?.kind || entry?.name;
    if (!kind) return;
    const required = [];
    const optional = [];
    const docs = {};
    const columns = asArray(entry.columns);
    if (columns.length > 0) {
      columns.forEach((col) => {
        const name = typeof col === 'string' ? col : (col?.name || col?.column);
        if (!name) return;
        const isRequired = typeof col === 'object' && (col.required === true || col.required === 'yes');
        (isRequired ? required : optional).push(name);
        const desc = typeof col === 'object' ? (col.description || col.doc || col.help) : null;
        if (desc) docs[name] = desc;
        if (typeof col === 'object' && Array.isArray(col.aliases) && col.aliases.length) {
          docs[name] = `${docs[name] ? `${docs[name]} ` : ''}Also accepted: ${col.aliases.join(', ')}.`;
        }
      });
    } else {
      asArray(entry.required).forEach((c) => required.push(typeof c === 'string' ? c : c?.name));
      asArray(entry.optional).forEach((c) => optional.push(typeof c === 'string' ? c : c?.name));
    }
    if (required.length || optional.length) {
      out[kind] = { required: required.filter(Boolean), optional: optional.filter(Boolean), docs, description: entry.description || null };
    }
  });
  return out;
};

const num = (value) => {
  if (Array.isArray(value)) return value.length;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const toWarning = (w) => {
  if (!w) return null;
  if (typeof w === 'string') return { message: w };
  const message = w.message || w.warning || w.detail || JSON.stringify(w);
  return { code: w.code || null, message, row: w.row ?? null };
};

const toError = (e) => {
  if (!e) return null;
  if (typeof e === 'string') return { row: null, error: e };
  return {
    row: e.row ?? e.index ?? e.line ?? null,
    error: e.error || e.message || e.detail || JSON.stringify(e),
    field: e.field || e.column || null,
  };
};

/**
 * Any /import response (or the sales import response) -> one summary shape:
 * {created, updated, replaced, skipped, imported, errors, warnings, boms,
 *  priceSources, createdCustomers, createdProducts, total}.
 */
export const summarizeImportResult = (payload) => {
  const data = payload?.data ?? payload ?? {};
  const summary = data.summary && typeof data.summary === 'object' ? data.summary : {};
  const pick = (key) => (data[key] !== undefined ? data[key] : summary[key]);

  const created = num(pick('created'));
  const updated = num(pick('updated'));
  const replaced = num(pick('replaced'));
  const skipped = num(pick('skipped'));
  const imported = pick('imported') !== undefined ? num(pick('imported')) : created + updated;

  const boms = asArray(pick('boms') || pick('per_bom') || pick('bom_summaries')).map((b) => ({
    bom_id: b.bom_id,
    version: b.version,
    lines: num(b.lines ?? b.line_count),
    material_cost_per_unit: b.material_cost_per_unit ?? b.material_cost ?? null,
    linked_products: asArray(b.linked_products),
    used_by_products: asArray(b.used_by_products),
    bom_name: b.bom_name || null,
  }));

  const sources = pick('price_sources');
  const priceSources = sources && typeof sources === 'object' && !Array.isArray(sources) ? sources : {};

  return {
    created,
    updated,
    replaced,
    skipped,
    imported,
    total: num(pick('total_rows') ?? pick('rows') ?? pick('total')),
    errors: asArray(pick('errors')).map(toError).filter(Boolean),
    warnings: asArray(pick('warnings')).map(toWarning).filter(Boolean),
    boms,
    routers: asArray(pick('routers') || pick('routings')),
    priceSources,
    createdCustomers: asArray(pick('created_customers')),
    createdProducts: asArray(pick('created_products')),
    createdMachines: asArray(pick('created_machines')),
    createdLaborTypes: asArray(pick('created_labor_types') || pick('created_labor_rates')),
    inserted: pick('inserted') !== undefined ? num(pick('inserted')) : null,
    unchanged: num(summary.unchanged),
    startPeriod: data.start_period || null,
    endPeriod: data.end_period || null,
    totalQuantity: data.total_quantity ?? null,
    totalRevenue: data.total_revenue ?? null,
    wideFormat: Boolean(data.wide_format),
    dryRun: Boolean(pick('dry_run')),
    message: payload?.message || null,
  };
};

// How each row of a sales import got its price (POST /forecast/smart_import_sales price_sources).
export const PRICE_SOURCE_LABELS = {
  explicit: 'kept the price in your file',
  file: 'kept the price in your file',
  provided: 'kept the price in your file',
  customer_product: "priced from the customer's own price",
  customer_all: "priced from the customer's discount off list",
  type_product: 'priced from the customer-type price list',
  type_all: 'priced from the customer-type discount off list',
  product: 'priced from the all-customers price',
  all: 'priced from the all-customers discount',
  base_price: "priced at the product's list price",
  zero_price: 'had no price and are imported at $0',
  none: 'have no price',
};

/** {source: count} -> [{source, count, label}] largest first. */
export const describePriceSources = (sources) => Object.entries(sources || {})
  .map(([source, count]) => ({ source, count: num(count), label: PRICE_SOURCE_LABELS[source] || `priced from: ${source.replace(/_/g, ' ')}` }))
  .filter((s) => s.count > 0)
  .sort((a, b) => b.count - a.count);

/** Readable message from an axios error (FastAPI detail strings and 422 arrays included). */
export const errorMessage = (err, fallback = 'Something went wrong') => {
  const data = err?.response?.data;
  const detail = data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail.map((d) => {
      const where = Array.isArray(d.loc) ? d.loc.filter((p) => p !== 'body').join('.') : '';
      return where ? `${where}: ${d.msg}` : d.msg;
    }).join('; ');
  }
  if (detail && typeof detail === 'object' && detail.message) return detail.message;
  if (typeof data?.message === 'string' && data.message) return data.message;
  if (err?.response?.status === 404) return 'This import is not available on the server yet (404).';
  return err?.userMessage || err?.message || fallback;
};
