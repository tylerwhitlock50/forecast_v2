// The import steps, in the order data depends on each other, plus pure
// helpers that read the /import responses. Column lists are a fallback for
// when GET /import/templates is unavailable; the server's list wins.

export const IMPORT_STEPS = [
  {
    kind: 'customers',
    hint: 'Dealer, Distributor, Direct… drives prices and discounts.',
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
    hint: 'List price, product type, BOM and routing.',
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
    hint: 'Hourly rate and monthly capacity.',
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
    required: ['machine_id', 'machine_name', 'machine_rate'],
    optional: ['available_hours_per_month', 'machine_description'],
    manageLink: { to: '/machines', label: 'Open machines' },
  },
  {
    kind: 'labor_rates',
    hint: 'Hourly cost of each kind of labor.',
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
    hint: 'Machine and labor minutes per unit.',
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
    hint: 'Parts and material cost per unit.',
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
    hint: 'Price or discount by customer type or customer.',
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
    hint: 'Terms, chargebacks, excise tax, commissions.',
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
    hint: 'Units by customer, product and month.',
    rowNoun: ['sales row', 'sales rows'],
    title: 'Sales forecast',
    noun: ['sales row', 'sales rows'],
    purpose: 'Units by customer, product and month. Leave the price blank to use the price list.',
    endpoint: '/forecast/smart_import_sales',
    // Shown one per line with their help: two of them delete rows.
    modesLayout: 'stacked',
    modes: [
      {
        value: 'upsert',
        label: 'Add / update rows',
        help: 'Rows for the same customer, product and month get the new quantity and price; new rows are added. Nothing is removed.',
      },
      {
        value: 'replace',
        label: "Replace this scenario's months in the file",
        help: 'For each month that appears in the file, lines the file no longer has are removed (for example a customer or product dropped from the plan). Months that are not in the file are left exactly as they are.',
      },
      {
        value: 'replace_all',
        label: 'Replace the whole scenario forecast',
        help: 'Afterwards the scenario holds exactly this file: every line that is not in the file is removed, in every month.',
      },
    ],
    replaceNote: 'Replacing only runs when every row in the file is valid. If any row has a problem, nothing is changed.',
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
    const aliases = {};
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
          aliases[name] = col.aliases.filter((a) => typeof a === 'string');
          docs[name] = `${docs[name] ? `${docs[name]} ` : ''}Also accepted: ${col.aliases.join(', ')}.`;
        }
      });
    } else {
      asArray(entry.required).forEach((c) => required.push(typeof c === 'string' ? c : c?.name));
      asArray(entry.optional).forEach((c) => optional.push(typeof c === 'string' ? c : c?.name));
    }
    if (required.length || optional.length) {
      out[kind] = { required: required.filter(Boolean), optional: optional.filter(Boolean), docs, aliases, description: entry.description || null };
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
 * A column map from the server, if it sends one, -> [{column, field}].
 * Accepts {file column: field} or a list of {column|source|file, field|target}.
 */
export const normalizeColumnMap = (value) => {
  if (!value || typeof value !== 'object') return null;
  const out = [];
  if (Array.isArray(value)) {
    value.forEach((entry) => {
      const column = entry?.column ?? entry?.source ?? entry?.file_column ?? entry?.header;
      const field = entry?.field ?? entry?.target ?? entry?.canonical;
      if (column !== undefined && column !== null) out.push({ column: String(column), field: field ? String(field) : null });
    });
  } else {
    Object.entries(value).forEach(([column, field]) => out.push({ column, field: field ? String(field) : null }));
  }
  return out.length ? out : null;
};

/**
 * Any /import response (or the sales import response) -> one summary shape:
 * {created, updated, replaced, skipped, imported, errors, warnings, boms,
 *  priceSources, createdCustomers, createdProducts, total, mode, deleted,
 *  replaceBlocked}.
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
    // Sales import modes: rows removed (or that a dry run would remove), and
    // whether a replace was refused because some rows have errors.
    mode: pick('mode') || null,
    deleted: num(pick('deleted')),
    replaceBlocked: Boolean(pick('replace_blocked')),
    // How the server read the file's columns, when it says so.
    columnMap: normalizeColumnMap(pick('column_map') ?? pick('columns_used') ?? pick('mapped_columns') ?? pick('column_mapping')),
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

// ---------------------------------------------------------------------------
// Column mapping: which file column feeds which field
// ---------------------------------------------------------------------------

/** Comparable column name, as the server compares them: lower case, letters and digits only. */
export const headerKey = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const FIELD_LABELS = {
  customer_id: 'customer id',
  customer_name: 'customer name',
  customer_type: 'customer type',
  region: 'region',
  unit_id: 'product id',
  unit_name: 'product name',
  unit_type: 'product type',
  unit_description: 'product description',
  base_price: 'list price',
  bom_id: 'BOM id',
  bom_version: 'BOM version',
  router_id: 'routing id',
  machine_id: 'machine id',
  machine_name: 'machine name',
  machine_rate: 'hourly rate',
  machine_description: 'description',
  available_hours_per_month: 'capacity (hours / month)',
  available_minutes_per_month: 'capacity (minutes / month)',
  rate_id: 'labor type id',
  rate_name: 'labor type name',
  rate_amount: 'hourly rate',
  rate_type: 'pay type',
  router_name: 'routing name',
  sequence: 'operation number',
  machine_minutes: 'machine minutes / unit',
  labor_minutes: 'labor minutes / unit',
  labor_type_id: 'labor type',
  operation_description: 'operation description',
  bom_name: 'BOM name',
  version: 'BOM version',
  bom_line: 'line number',
  part_number: 'part number',
  material_description: 'material description',
  qty: 'quantity per unit',
  unit: 'unit of measure',
  material_cost: 'extended cost',
  unit_price: 'price',
  discount_pct: 'discount % off list',
  start_period: 'start month',
  end_period: 'end month',
  forecast_id: 'scenario',
  notes: 'notes',
  deduction_type: 'deduction type',
  name: 'rule name',
  method: 'method',
  rate: 'rate',
  amount_per_unit: 'amount per unit',
  period: 'month',
  quantity: 'quantity',
};

const KIND_FIELD_LABELS = {
  boms: { unit_price: 'unit cost', unit_id: 'product (links the BOM)' },
  routings: { unit_id: 'product (links the routing)' },
  sales: { unit_price: 'unit price' },
};

/** 'customer_type' -> 'customer type' (per import kind where the words differ). */
export const fieldLabel = (kind, field) => {
  if (!field) return '';
  return KIND_FIELD_LABELS[kind]?.[field] || FIELD_LABELS[field] || String(field).replace(/_/g, ' ');
};

/** Columns named in the server's "Ignored columns (not recognised): a, b" warning. */
export const ignoredColumnsFromWarnings = (warnings) => {
  const out = [];
  (warnings || []).forEach((w) => {
    const text = typeof w === 'string' ? w : w?.message;
    const m = /^Ignored columns[^:]*:\s*(.+)$/i.exec(String(text || ''));
    if (m) m[1].split(',').map((c) => c.trim()).filter(Boolean).forEach((c) => out.push(c));
  });
  return out;
};

/**
 * Template columns (from GET /import/templates) -> lookup of headerKey ->
 * {field, rank}. Like the server: the field's own name ranks first, then its
 * aliases in order; the first field to claim a spelling keeps it.
 */
const templateLookup = (columns, aliases) => {
  const lookup = {};
  (columns || []).forEach((field) => {
    [field, ...((aliases && aliases[field]) || [])].forEach((alias, rank) => {
      const key = headerKey(alias);
      if (key && !lookup[key]) lookup[key] = { field, rank };
    });
  });
  return lookup;
};

/**
 * Which file column went to which field, for the import preview.
 *
 * - `serverMap` (the import response's own column map) wins when present.
 * - Otherwise the columns are matched client-side the way the server does
 *   (case, spaces, underscores and dashes ignored; template aliases), with
 *   the same tie-break: when two columns feed one field, the field's own
 *   name wins, then the alias listed first; the other column is unused.
 * - Sales files are first read by the page itself (prepareSalesRows): month
 *   columns become monthly quantities and a row total is dropped.
 * - A column the client cannot place but the server did not report as
 *   ignored is shown as used ("read by the server").
 *
 * Returns {mapped: [{column, field, label}], months: {count, first, last} | null,
 *          dropped: [column], ignored: [column]}.
 */
export const describeColumnMapping = ({ kind, headers, template = null, serverMap = null, ignoredByServer = null, sales = null }) => {
  const list = (headers || []).filter((h) => h && !/^__EMPTY/.test(h));
  const mapped = [];
  const ignored = [];
  const dropped = [];
  let months = null;

  if (serverMap && serverMap.length) {
    serverMap.forEach(({ column, field }) => {
      if (field) mapped.push({ column, field, label: fieldLabel(kind, field) });
      else ignored.push(column);
    });
    return { mapped, months, dropped, ignored };
  }

  const columns = template ? [...(template.required || []), ...(template.optional || [])] : [];
  const lookup = templateLookup(columns, template?.aliases);
  const claimed = {}; // field -> {column, rank}
  const pending = [];

  let candidates = list;
  if (kind === 'sales' && sales) {
    const monthHeaders = new Set((sales.monthColumns || []).map((c) => c.header));
    if (monthHeaders.size) {
      const periods = sales.monthColumns.map((c) => c.period).sort();
      months = { count: monthHeaders.size, first: periods[0], last: periods[periods.length - 1], columns: sales.monthColumns.map((c) => c.header) };
    }
    candidates = list.filter((h) => !monthHeaders.has(h));
    if (sales.layout === 'wide') {
      const totals = candidates.filter((h) => sales.isTotal && sales.isTotal(h));
      totals.forEach((h) => dropped.push(h));
      candidates = candidates.filter((h) => !totals.includes(h));
    }
  }

  candidates.forEach((column) => {
    let hit = null;
    if (kind === 'sales' && sales && sales.fieldFor) {
      const field = sales.fieldFor(column);
      if (field) hit = { field, rank: -1 };
    }
    if (!hit) hit = lookup[headerKey(column)] || null;
    if (!hit) {
      pending.push(column);
      return;
    }
    const prior = claimed[hit.field];
    if (!prior || hit.rank < prior.rank) {
      if (prior) pending.push(prior.column);
      claimed[hit.field] = { column, rank: hit.rank };
    } else {
      pending.push(column);
    }
  });

  list.forEach((column) => {
    const entry = Object.entries(claimed).find(([, c]) => c.column === column);
    if (entry) mapped.push({ column, field: entry[0], label: fieldLabel(kind, entry[0]) });
  });

  const serverIgnored = ignoredByServer ? new Set(ignoredByServer.map(headerKey)) : null;
  pending.forEach((column) => {
    if (serverIgnored && !serverIgnored.has(headerKey(column))) {
      mapped.push({ column, field: null, label: 'read by the server' });
    } else {
      ignored.push(column);
    }
  });
  return { mapped, months, dropped, ignored };
};

// ---------------------------------------------------------------------------
// Setup progress: one list, used by the Import data page, the sidebar's
// "Get started" badge and the Sales Forecast checklist
// ---------------------------------------------------------------------------

const distinct = (rows, field) => new Set((rows || []).map((r) => r?.[field]).filter(Boolean)).size;

/**
 * Each import step (IMPORT_STEPS order) with what is already loaded:
 * [{kind, title, count, label, done, warning}], plus {done, total}.
 *
 * `data` is the forecast context's data, `scenario` the active scenario
 * (its sales_rows), `ruleCounts` {prices, deductions} from the pricing API
 * (null while unknown).
 */
export const setupProgress = ({ data = {}, scenario = null, ruleCounts = {} } = {}) => {
  const d = data || {};
  const list = (value) => (Array.isArray(value) ? value : []);
  const customers = list(d.customers);
  const products = list(d.products);
  const bomLines = list(d.bom).length;
  const bomCount = distinct(d.bom, 'bom_id');
  const routers = list(d.router_definitions).length;
  const ops = list(d.router_operations).length;
  const salesRows = scenario ? (scenario.sales_rows ?? list(d.sales_forecast).length) : null;
  const untyped = customers.filter((c) => !String(c?.customer_type || '').trim()).length;
  const unlinked = products.filter((p) => !(p?.bom ?? p?.bom_id) || !(p?.router ?? p?.router_id)).length;

  const facts = {
    customers: { count: customers.length, warning: untyped ? `${plural(untyped, ['customer has', 'customers have'])} no type` : null },
    products: { count: products.length, warning: unlinked ? `${plural(unlinked, ['product is', 'products are'])} missing a BOM or routing` : null },
    machines: { count: list(d.machines).length },
    labor_rates: { count: list(d.labor_rates).length },
    routings: { count: routers, label: routers ? `${plural(routers, ['routing', 'routings'])} · ${plural(ops, ['operation', 'operations'])}` : null },
    boms: { count: bomCount, label: bomCount ? `${plural(bomCount, ['BOM', 'BOMs'])} · ${plural(bomLines, ['line', 'lines'])}` : null },
    prices: { count: ruleCounts?.prices ?? null },
    deductions: { count: ruleCounts?.deductions ?? null },
    sales: { count: salesRows, label: salesRows ? `${plural(salesRows, ['sales row', 'sales rows'])}${scenario?.name ? ` in ${scenario.name}` : ''}` : null },
  };

  const steps = IMPORT_STEPS.map((step, index) => {
    const fact = facts[step.kind] || {};
    const count = typeof fact.count === 'number' ? fact.count : null;
    const done = (count || 0) > 0;
    return {
      kind: step.kind,
      number: index + 1,
      title: step.title,
      hint: step.hint,
      count,
      done,
      label: done ? (fact.label || plural(count, step.noun)) : null,
      warning: done ? fact.warning || null : null,
    };
  });
  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length, byKind: Object.fromEntries(steps.map((s) => [s.kind, s])) };
};
