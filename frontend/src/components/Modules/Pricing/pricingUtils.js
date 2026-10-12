// Pure helpers for the Pricing & Deductions screens. The API stores rates
// as fractions (0.02 = 2%); people type percents. Rule precedence mirrors
// app/services/pricing.py so the screen shows what the engine will do.

export const DEDUCTION_TYPES = [
  {
    type: 'terms_allowance',
    label: 'Terms allowance',
    short: 'Terms',
    treatment: 'contra_revenue',
    description: 'Early-payment and dating discounts customers take (for example 2% 10, net 30).',
  },
  {
    type: 'chargebacks',
    label: 'Chargebacks allowance',
    short: 'Chargebacks',
    treatment: 'contra_revenue',
    description: 'Miscellaneous customer chargebacks and deductions taken from payments.',
  },
  {
    type: 'other_allowance',
    label: 'Other discounts & allowances',
    short: 'Other allowances',
    treatment: 'contra_revenue',
    description: 'Volume rebates, co-op advertising, freight or returns allowances.',
  },
  {
    type: 'excise_tax',
    label: 'Excise tax (FET)',
    short: 'Excise tax',
    treatment: 'contra_revenue',
    description: 'Federal excise tax already included in your selling price and paid to the government.',
  },
  {
    type: 'commission',
    label: 'Sales commissions',
    short: 'Commissions',
    treatment: 'selling_expense',
    description: 'Paid to reps and agents. An operating expense below gross profit, not a sales deduction.',
  },
];

export const DEDUCTION_TYPE_MAP = DEDUCTION_TYPES.reduce((acc, t) => ({ ...acc, [t.type]: t }), {});

export const METHODS = [
  {
    value: 'percent_of_gross',
    label: '% of gross sales',
    help: 'Rate × the invoice amount. The usual choice for terms, chargebacks and commissions.',
  },
  {
    value: 'embedded_tax',
    label: 'Tax included in the price',
    help: 'The price already contains the tax: amount = price × rate ÷ (1 + rate). At 11%, a $1,110 invoice carries $110.',
  },
  {
    value: 'percent_of_net',
    label: '% of net sales',
    help: 'Rate × (invoice − the other allowances and excise on the same line).',
  },
  {
    value: 'per_unit',
    label: '$ per unit',
    help: 'A fixed dollar amount for every unit sold.',
  },
];

export const METHOD_MAP = METHODS.reduce((acc, m) => ({ ...acc, [m.value]: m }), {});

// ---------------------------------------------------------------------------
// Percent <-> fraction
// ---------------------------------------------------------------------------

const roundTo = (value, digits) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

/** 0.02 -> 2 (for an input box). Null/blank -> ''. */
export const fractionToPercent = (fraction) => {
  if (fraction === null || fraction === undefined || fraction === '') return '';
  const n = Number(fraction);
  if (!Number.isFinite(n)) return '';
  return roundTo(n * 100, 6);
};

/** '2', '2%', 2 -> 0.02. Blank or not a number -> null. */
export const percentToFraction = (percent) => {
  if (percent === null || percent === undefined) return null;
  const text = String(percent).replace('%', '').trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  return roundTo(n / 100, 8);
};

/** 0.0991 -> '9.91%'; trims trailing zeros (0.02 -> '2%', 0.115 -> '11.5%'). */
export const formatRatePct = (fraction, maxDecimals = 2) => {
  if (fraction === null || fraction === undefined || fraction === '') return '—';
  const n = Number(fraction);
  if (!Number.isFinite(n)) return '—';
  return `${roundTo(n * 100, maxDecimals).toLocaleString('en-US', { maximumFractionDigits: maxDecimals })}%`;
};

export const formatMoney = (value, decimals = 2) => {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

/** Embedded tax on an invoice that already includes it: 1110 at 0.11 -> 110. */
export const embeddedTax = (gross, rate) => {
  const g = Number(gross) || 0;
  const r = Number(rate) || 0;
  if (r <= -1) return 0;
  return (g * r) / (1 + r);
};

/** How a rule's rate reads in a table: '2%', '11% (in price)', '$4.50 / unit'. */
export const describeRate = (rule) => {
  if (!rule) return '—';
  if (rule.method === 'per_unit') return `${formatMoney(rule.amount_per_unit)} / unit`;
  const pct = formatRatePct(rule.rate);
  if (rule.method === 'embedded_tax') return `${pct} in price`;
  if (rule.method === 'percent_of_net') return `${pct} of net`;
  return pct;
};

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

const clean = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
};

const sameCi = (a, b) => clean(a)?.toLowerCase() === clean(b)?.toLowerCase();

/** Distinct, trimmed, non-empty values of `field`, sorted case-insensitively (first spelling wins). */
export const distinctValues = (rows, field) => {
  const seen = new Map();
  (rows || []).forEach((row) => {
    const v = clean(row?.[field]);
    if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  });
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
};

/**
 * Scope chips for a rule: [{kind, label, value}]. A rule with no scope
 * applies to everyone.
 */
export const scopeChips = (rule, { customers = [], products = [] } = {}) => {
  const chips = [];
  const customerId = clean(rule?.customer_id);
  const unitId = clean(rule?.unit_id);
  if (customerId) {
    const c = customers.find((x) => x.customer_id === customerId);
    chips.push({ kind: 'customer', label: c?.customer_name ? `${c.customer_name}` : customerId, value: customerId });
  }
  if (clean(rule?.customer_type)) chips.push({ kind: 'customer_type', label: clean(rule.customer_type), value: clean(rule.customer_type) });
  if (unitId) {
    const p = products.find((x) => x.unit_id === unitId);
    chips.push({ kind: 'product', label: p?.unit_name || unitId, value: unitId });
  }
  if (clean(rule?.unit_type)) chips.push({ kind: 'product_type', label: clean(rule.unit_type), value: clean(rule.unit_type) });
  if (chips.length === 0) chips.push({ kind: 'everyone', label: 'Everyone', value: null });
  return chips;
};

export const deductionSpecificity = (rule) => (
  8 * (clean(rule?.customer_id) ? 1 : 0)
  + 4 * (clean(rule?.customer_type) ? 1 : 0)
  + 2 * (clean(rule?.unit_id) ? 1 : 0)
  + 1 * (clean(rule?.unit_type) ? 1 : 0)
);

export const priceSpecificity = (rule) => (
  4 * (clean(rule?.customer_id) ? 1 : 0)
  + 2 * (clean(rule?.customer_type) ? 1 : 0)
  + 1 * (clean(rule?.unit_id) ? 1 : 0)
);

const isActive = (rule) => {
  const flag = rule?.is_active;
  if (flag === null || flag === undefined) return true;
  if (typeof flag === 'boolean') return flag;
  return !['0', 'false', 'no', 'off'].includes(String(flag).trim().toLowerCase());
};

export const ruleIsActive = isActive;

/**
 * Rules grouped by deduction type in statement order:
 * [{type, label, description, treatment, rules: [...]}], every type present
 * (empty groups included). Within a group: most specific first, then name.
 */
export const groupRulesByType = (rules) => {
  const groups = DEDUCTION_TYPES.map((t) => ({ ...t, rules: [] }));
  const byType = groups.reduce((acc, g) => ({ ...acc, [g.type]: g }), {});
  (rules || []).forEach((rule) => {
    const group = byType[rule?.deduction_type];
    if (group) group.rules.push(rule);
  });
  groups.forEach((g) => {
    g.rules.sort((a, b) => (
      deductionSpecificity(a) - deductionSpecificity(b)
      || String(a.name || '').localeCompare(String(b.name || ''))
      || String(a.rule_id || '').localeCompare(String(b.rule_id || ''))
    ));
  });
  return groups;
};

/** Rule list from any API payload shape: a list, {rules}, {data: {rules}}. */
export const extractList = (payload, keys = ['rules', 'prices', 'items']) => {
  const data = payload?.data ?? payload;
  if (Array.isArray(data)) return data;
  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
};

// ---------------------------------------------------------------------------
// Deduction rule form <-> API
// ---------------------------------------------------------------------------

export const emptyRuleForm = (overrides = {}) => ({
  rule_id: null,
  deduction_type: 'terms_allowance',
  name: '',
  method: 'percent_of_gross',
  ratePct: '',
  amount_per_unit: '',
  customer_id: '',
  customer_type: '',
  unit_id: '',
  unit_type: '',
  start_period: '',
  end_period: '',
  scenarioOnly: false,
  is_active: true,
  notes: '',
  ...overrides,
});

export const ruleToForm = (rule) => emptyRuleForm({
  rule_id: rule.rule_id || null,
  deduction_type: rule.deduction_type || 'terms_allowance',
  name: rule.name || '',
  method: rule.method || 'percent_of_gross',
  ratePct: fractionToPercent(rule.rate),
  amount_per_unit: rule.amount_per_unit ?? '',
  customer_id: rule.customer_id || '',
  customer_type: rule.customer_type || '',
  unit_id: rule.unit_id || '',
  unit_type: rule.unit_type || '',
  start_period: rule.start_period || '',
  end_period: rule.end_period || '',
  scenarioOnly: Boolean(rule.forecast_id),
  is_active: isActive(rule),
  notes: rule.notes || '',
});

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Problems with a deduction form, keyed by field ({} when valid). */
export const validateRuleForm = (form) => {
  const errors = {};
  if (!DEDUCTION_TYPE_MAP[form.deduction_type]) errors.deduction_type = 'Choose what kind of deduction this is.';
  if (!METHOD_MAP[form.method]) errors.method = 'Choose how it is calculated.';
  if (form.method === 'per_unit') {
    const amount = Number(form.amount_per_unit);
    if (String(form.amount_per_unit).trim() === '' || !Number.isFinite(amount) || amount < 0) {
      errors.amount_per_unit = 'Enter a dollar amount per unit (0 or more).';
    }
  } else {
    const fraction = percentToFraction(form.ratePct);
    if (fraction === null) errors.ratePct = 'Enter a rate in percent, for example 2 for 2%.';
    else if (fraction < 0 || fraction >= 1) errors.ratePct = 'The rate must be at least 0% and below 100%.';
  }
  if (form.start_period && !PERIOD_RE.test(form.start_period)) errors.start_period = 'Use a month like 2027-01.';
  if (form.end_period && !PERIOD_RE.test(form.end_period)) errors.end_period = 'Use a month like 2027-12.';
  if (form.start_period && form.end_period && PERIOD_RE.test(form.start_period) && PERIOD_RE.test(form.end_period)
      && form.start_period > form.end_period) {
    errors.end_period = 'The end month is before the start month.';
  }
  return errors;
};

/**
 * Form -> API payload (rates as fractions, blanks as null). A blank name is
 * sent as null so the server writes its standard name ("Terms allowance 2%").
 */
export const formToRule = (form, activeScenarioId) => {
  const perUnit = form.method === 'per_unit';
  return {
    deduction_type: form.deduction_type,
    name: clean(form.name),
    method: form.method,
    rate: perUnit ? 0 : percentToFraction(form.ratePct),
    amount_per_unit: perUnit ? Number(form.amount_per_unit) || 0 : 0,
    customer_id: clean(form.customer_id),
    customer_type: clean(form.customer_type),
    unit_id: clean(form.unit_id),
    unit_type: clean(form.unit_type),
    start_period: clean(form.start_period),
    end_period: clean(form.end_period),
    forecast_id: form.scenarioOnly && activeScenarioId ? activeScenarioId : null,
    is_active: form.is_active ? 1 : 0,
    notes: clean(form.notes),
  };
};

/**
 * Starter rules for a firearms maker: 2% terms and 1% chargebacks for
 * everyone, FET embedded at 11% on long guns and 10% on handguns. Product
 * types are matched against the ones already in use (case-insensitive).
 */
export const standardRules = (productTypes = []) => {
  const findType = (candidates, fallback) => {
    const hit = (productTypes || []).find((t) => candidates.some((c) => sameCi(t, c)));
    return { value: hit || fallback, found: Boolean(hit) };
  };
  const rifle = findType(['Rifle', 'Rifles', 'Long gun', 'Long guns', 'Shotgun'], 'Rifle');
  const pistol = findType(['Pistol', 'Pistols', 'Handgun', 'Handguns', 'Revolver'], 'Pistol');
  return [
    {
      key: 'terms',
      deduction_type: 'terms_allowance',
      name: 'Terms – all customers',
      method: 'percent_of_gross',
      ratePct: 2,
      unit_type: null,
      note: 'Applies to every customer and product.',
    },
    {
      key: 'chargebacks',
      deduction_type: 'chargebacks',
      name: 'Chargebacks – all customers',
      method: 'percent_of_gross',
      ratePct: 1,
      unit_type: null,
      note: 'Applies to every customer and product.',
    },
    {
      key: 'fet_rifle',
      deduction_type: 'excise_tax',
      name: `FET – ${rifle.value}`,
      method: 'embedded_tax',
      ratePct: 11,
      unit_type: rifle.value,
      note: rifle.found ? `Products with type "${rifle.value}".` : `No products have type "${rifle.value}" yet.`,
      typeFound: rifle.found,
    },
    {
      key: 'fet_pistol',
      deduction_type: 'excise_tax',
      name: `FET – ${pistol.value}`,
      method: 'embedded_tax',
      ratePct: 10,
      unit_type: pistol.value,
      note: pistol.found ? `Products with type "${pistol.value}".` : `No products have type "${pistol.value}" yet.`,
      typeFound: pistol.found,
    },
  ];
};

// ---------------------------------------------------------------------------
// Price list
// ---------------------------------------------------------------------------

export const PRICE_SOURCE_LABELS = {
  customer_product: 'Customer price',
  customer_all: 'Customer discount (all products)',
  type_product: 'Customer-type price',
  type_all: 'Customer-type discount (all products)',
  product: 'Price for all customers',
  all: 'All customers, all products',
  base_price: 'List price',
  none: 'No price',
};

/** The price a rule gives for a product with this list price, or null when it cannot price it. */
export const rulePrice = (rule, basePrice) => {
  if (!rule) return null;
  if ((rule.method || 'fixed') === 'discount_from_base') {
    const base = Number(basePrice) || 0;
    if (base <= 0 || rule.discount_pct === null || rule.discount_pct === undefined) return null;
    return base * (1 - Number(rule.discount_pct || 0));
  }
  if (rule.unit_price === null || rule.unit_price === undefined || rule.unit_price === '') return null;
  return Number(rule.unit_price);
};

const priceRuleMatches = (rule, { unitId, customerId, customerType, forecastId }) => {
  if (!isActive(rule)) return false;
  if (clean(rule.forecast_id) && clean(rule.forecast_id) !== clean(forecastId)) return false;
  if (clean(rule.unit_id) && clean(rule.unit_id) !== clean(unitId)) return false;
  if (clean(rule.customer_id) && clean(rule.customer_id) !== clean(customerId)) return false;
  if (clean(rule.customer_type) && !sameCi(rule.customer_type, customerType)) return false;
  return true;
};

/**
 * The price a product would get for a customer type (no specific customer),
 * ignoring date ranges: {price, source, rule}. Mirrors the engine's order:
 * type+product > type+all products > all customers+product > list price.
 */
export const resolveCellPrice = (rules, { unitId, basePrice, customerType = null, forecastId = null }) => {
  const candidates = (rules || [])
    .filter((r) => !clean(r.customer_id))
    .filter((r) => priceRuleMatches(r, { unitId, customerType, forecastId }))
    .map((r) => ({ r, key: [priceSpecificity(r), clean(r.forecast_id) ? 1 : 0, clean(r.start_period) || '', String(r.price_id || '')] }))
    .sort((a, b) => {
      for (let i = 0; i < a.key.length; i += 1) {
        if (a.key[i] > b.key[i]) return -1;
        if (a.key[i] < b.key[i]) return 1;
      }
      return 0;
    });
  for (const { r } of candidates) {
    const price = rulePrice(r, basePrice);
    if (price !== null) {
      const source = clean(r.customer_type) ? (clean(r.unit_id) ? 'type_product' : 'type_all') : (clean(r.unit_id) ? 'product' : 'all');
      return { price, source, rule: r };
    }
  }
  if (Number(basePrice) > 0) return { price: Number(basePrice), source: 'base_price', rule: null };
  return { price: null, source: 'none', rule: null };
};

/**
 * Rules that sit exactly in a matrix cell: this product, this customer type
 * (null = all customers), no specific customer.
 */
export const cellRules = (rules, unitId, customerType) => (rules || []).filter((r) => (
  !clean(r.customer_id)
  && clean(r.unit_id) === clean(unitId)
  && (customerType ? sameCi(r.customer_type, customerType) : !clean(r.customer_type))
));

/**
 * Split price rules for the screen: matrix cells (product x customer type or
 * all customers), customer-specific rules, and discounts that apply to all
 * products (no unit_id, no customer).
 */
export const partitionPriceRules = (rules) => {
  const matrix = [];
  const customer = [];
  const allProducts = [];
  (rules || []).forEach((r) => {
    if (clean(r.customer_id)) customer.push(r);
    else if (!clean(r.unit_id)) allProducts.push(r);
    else matrix.push(r);
  });
  return { matrix, customer, allProducts };
};

export const emptyPriceForm = (overrides = {}) => ({
  price_id: null,
  unit_id: '',
  customer_id: '',
  customer_type: '',
  method: 'fixed',
  unit_price: '',
  discountPct: '',
  start_period: '',
  end_period: '',
  scenarioOnly: false,
  is_active: true,
  notes: '',
  ...overrides,
});

export const priceToForm = (rule) => emptyPriceForm({
  price_id: rule.price_id || null,
  unit_id: rule.unit_id || '',
  customer_id: rule.customer_id || '',
  customer_type: rule.customer_type || '',
  method: rule.method || 'fixed',
  unit_price: rule.unit_price ?? '',
  discountPct: fractionToPercent(rule.discount_pct),
  start_period: rule.start_period || '',
  end_period: rule.end_period || '',
  scenarioOnly: Boolean(rule.forecast_id),
  is_active: isActive(rule),
  notes: rule.notes || '',
});

export const validatePriceForm = (form) => {
  const errors = {};
  if (form.method === 'fixed') {
    if (!clean(form.unit_id)) errors.unit_id = 'A fixed price needs a product.';
    const price = Number(form.unit_price);
    if (String(form.unit_price).trim() === '' || !Number.isFinite(price) || price < 0) errors.unit_price = 'Enter a price (0 or more).';
  } else {
    const fraction = percentToFraction(form.discountPct);
    if (fraction === null) errors.discountPct = 'Enter the discount in percent, for example 40 for 40% off.';
    else if (fraction < 0 || fraction >= 1) errors.discountPct = 'The discount must be at least 0% and below 100%.';
  }
  if (form.start_period && !PERIOD_RE.test(form.start_period)) errors.start_period = 'Use a month like 2027-01.';
  if (form.end_period && !PERIOD_RE.test(form.end_period)) errors.end_period = 'Use a month like 2027-12.';
  if (form.start_period && form.end_period && !errors.start_period && !errors.end_period && form.start_period > form.end_period) {
    errors.end_period = 'The end month is before the start month.';
  }
  return errors;
};

export const formToPrice = (form, activeScenarioId) => {
  const fixed = form.method === 'fixed';
  return {
    unit_id: clean(form.unit_id),
    customer_id: clean(form.customer_id),
    customer_type: clean(form.customer_type),
    method: form.method,
    unit_price: fixed ? Number(form.unit_price) : null,
    discount_pct: fixed ? null : percentToFraction(form.discountPct),
    start_period: clean(form.start_period),
    end_period: clean(form.end_period),
    forecast_id: form.scenarioOnly && activeScenarioId ? activeScenarioId : null,
    is_active: form.is_active ? 1 : 0,
    notes: clean(form.notes),
  };
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Short month range for tight cells: 'Jan–Dec 2027', 'Nov 2027–Feb 2028', 'from Mar 2027', '' when open. */
export const compactPeriodRange = (start, end) => {
  const parse = (p) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(p || ''));
    return m ? { y: m[1], m: MONTH_NAMES[Number(m[2]) - 1] } : null;
  };
  const a = parse(start);
  const b = parse(end);
  if (a && b) return a.y === b.y ? `${a.m}–${b.m} ${a.y}` : `${a.m} ${a.y}–${b.m} ${b.y}`;
  if (a) return `from ${a.m} ${a.y}`;
  if (b) return `until ${b.m} ${b.y}`;
  return '';
};

/** A rule's name, plus its rate when the name does not already say it. */
export const ruleLabel = (rule) => {
  if (!rule) return '';
  const name = rule.name || rule.rule_id || '';
  const rate = rule.method === 'per_unit' ? formatMoney(rule.amount_per_unit) : formatRatePct(rule.rate);
  return name.includes(rate) ? name : `${name} · ${describeRate(rule)}`;
};

/** 'Jan 2027 – Dec 2027', 'From Mar 2027', 'Until Jun 2027', or 'All months'. */
export const describePeriodRange = (start, end) => {
  const fmt = (p) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(p || ''));
    if (!m) return p;
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${names[Number(m[2]) - 1]} ${m[1]}`;
  };
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  if (end) return `Until ${fmt(end)}`;
  return 'All months';
};

// ---------------------------------------------------------------------------
// API response readers (tolerant of the exact nesting)
// ---------------------------------------------------------------------------

const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'object') return numOrNull(v.amount ?? v.total ?? v.value);
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const firstNum = (...values) => {
  for (const v of values) {
    const n = numOrNull(v);
    if (n !== null) return n;
  }
  return null;
};

const typeEntry = (container, type) => {
  if (!container) return undefined;
  if (Array.isArray(container)) return container.find((e) => e?.deduction_type === type || e?.type === type);
  return container[type];
};

/**
 * POST /pricing/deductions/simulate -> {gross, quantity, net, totalDeductions,
 * commission, lines: [{type, label, treatment, amount, rule}]}. `rules` is the
 * loaded rule list, used to name a winning rule the response only gives by id.
 */
export const normalizeSimulation = (payload, rules = []) => {
  const data = payload?.data ?? payload ?? {};
  const result = data.result && typeof data.result === 'object' ? data.result : data;
  const ruleById = (id) => (rules || []).find((r) => r.rule_id === id) || null;
  const lines = DEDUCTION_TYPES.map((t) => {
    const fromDeductions = typeEntry(result.deductions, t.type) ?? typeEntry(result.by_type, t.type) ?? typeEntry(result.lines, t.type);
    const amount = firstNum(
      fromDeductions,
      typeEntry(result.amounts, t.type),
      result[t.type],
      t.type === 'other_allowance' ? result.other_allowances : undefined,
      t.type === 'commission' ? result.commissions : undefined,
    );
    let rule = null;
    if (fromDeductions && typeof fromDeductions === 'object') {
      rule = fromDeductions.rule || (fromDeductions.rule_id ? (ruleById(fromDeductions.rule_id) || { rule_id: fromDeductions.rule_id, name: fromDeductions.name || fromDeductions.rule_name, method: fromDeductions.method, rate: fromDeductions.rate, amount_per_unit: fromDeductions.amount_per_unit }) : null);
    }
    if (!rule) {
      const winner = typeEntry(result.winners, t.type) ?? typeEntry(result.rules, t.type) ?? typeEntry(result.applied, t.type);
      if (winner && typeof winner === 'object') rule = winner;
      const appliedId = typeEntry(result.applied_rules, t.type);
      if (!rule && typeof appliedId === 'string') rule = ruleById(appliedId) || { rule_id: appliedId };
    }
    const overridden = fromDeductions && typeof fromDeductions === 'object' && Array.isArray(fromDeductions.overridden_rules)
      ? fromDeductions.overridden_rules : [];
    return { type: t.type, label: t.label, treatment: t.treatment, amount: amount || 0, rule, overridden };
  });
  const gross = firstNum(result.gross, result.gross_sales, data.gross);
  const totalDeductions = firstNum(result.total_sales_deductions, result.total_deductions)
    ?? lines.filter((l) => l.treatment === 'contra_revenue').reduce((s, l) => s + l.amount, 0);
  const net = firstNum(result.net_sales, result.net) ?? (gross !== null ? gross - totalDeductions : null);
  const commission = lines.find((l) => l.type === 'commission')?.amount || 0;
  return {
    gross,
    quantity: firstNum(result.quantity, result.input?.quantity),
    net,
    totalDeductions,
    commission,
    lines,
    notes: Array.isArray(result.notes) ? result.notes : [],
    input: result.input || null,
  };
};

/**
 * GET /pricing/deductions/preview -> {gross, net, totalDeductions, commission,
 * byType: {type: amount}, byCustomerType: [{customer_type, gross, deductions, net}]}.
 */
export const normalizePreview = (payload) => {
  const data = payload?.data ?? payload ?? {};
  const totals = data.totals && typeof data.totals === 'object' ? data.totals : data;
  const byType = {};
  DEDUCTION_TYPES.forEach((t) => {
    byType[t.type] = firstNum(
      typeEntry(data.by_type, t.type),
      typeEntry(data.deductions, t.type),
      typeEntry(totals.by_type, t.type),
      totals[t.type],
      t.type === 'other_allowance' ? totals.other_allowances : undefined,
      t.type === 'commission' ? totals.commissions : undefined,
    ) || 0;
  });
  const contra = DEDUCTION_TYPES.filter((t) => t.treatment === 'contra_revenue').reduce((s, t) => s + byType[t.type], 0);
  const gross = firstNum(totals.gross_sales, totals.gross, data.gross_sales) || 0;
  const totalDeductions = firstNum(totals.total_sales_deductions, totals.total_deductions) ?? contra;
  const net = firstNum(totals.net_sales, totals.net, totals.revenue) ?? gross - totalDeductions;
  let rawTypes = data.by_customer_type || totals.by_customer_type || [];
  if (rawTypes && !Array.isArray(rawTypes) && typeof rawTypes === 'object') {
    rawTypes = Object.entries(rawTypes).map(([customerType, v]) => ({ customer_type: customerType, ...(v || {}) }));
  }
  const byCustomerType = (rawTypes || []).map((r) => {
    const g = firstNum(r.gross_sales, r.gross) || 0;
    const d = firstNum(r.total_sales_deductions, r.total_deductions, r.deductions) ?? 0;
    return {
      customer_type: r.customer_type || 'Unassigned',
      gross: g,
      deductions: d,
      net: firstNum(r.net_sales, r.net) ?? g - d,
      commission: firstNum(r.commission, r.commissions) || 0,
    };
  });
  const ruleUsage = {};
  (Array.isArray(data.rules) ? data.rules : []).forEach((r) => {
    if (r?.rule_id) ruleUsage[r.rule_id] = { rows: numOrNull(r.rows_applied) || 0, amount: numOrNull(r.amount) || 0 };
  });
  return {
    gross,
    net,
    totalDeductions,
    commission: byType.commission,
    byType,
    byCustomerType,
    ruleUsage,
    startPeriod: data.start_period || null,
    endPeriod: data.end_period || null,
    rowCount: firstNum(data.rows, data.row_count, data.sales_rows, totals.rows),
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
  };
};

/**
 * POST /pricing/apply -> {matched, changed, unchanged, unpriced, revenueBefore,
 * revenueAfter, bySource: [{source, count}], samples: [...]}.
 */
export const normalizeApplyResult = (payload) => {
  const data = payload?.data ?? payload ?? {};
  const count = (v) => (Array.isArray(v) ? v.length : (numOrNull(v) || 0));
  const matched = count(data.matched ?? data.matched_rows ?? data.rows_matched);
  const changed = count(data.changed ?? data.changed_rows ?? data.rows_changed ?? data.updated);
  const unpriced = count(data.unpriced ?? data.no_price ?? data.left_alone ?? data.skipped_no_price ?? data.not_priced);
  const unchanged = data.unchanged !== undefined ? count(data.unchanged) : Math.max(matched - changed - unpriced, 0);
  let bySource = data.by_source || data.price_sources || {};
  if (!Array.isArray(bySource)) bySource = Object.entries(bySource).map(([source, v]) => ({ source, count: typeof v === 'object' ? count(v.rows ?? v.count) : count(v) }));
  const samples = data.sample_changes || data.samples || data.changes || data.sample || [];
  return {
    matched,
    changed,
    unchanged,
    unpriced,
    revenueBefore: firstNum(data.revenue_before, data.before?.revenue, data.total_revenue_before) ?? 0,
    revenueAfter: firstNum(data.revenue_after, data.after?.revenue, data.total_revenue_after) ?? 0,
    bySource: bySource.filter((s) => s.count > 0).sort((a, b) => b.count - a.count),
    samples: Array.isArray(samples) ? samples : [],
    unpricedRows: Array.isArray(data.unpriced_rows) ? data.unpriced_rows : [],
    dryRun: Boolean(data.dry_run),
  };
};
