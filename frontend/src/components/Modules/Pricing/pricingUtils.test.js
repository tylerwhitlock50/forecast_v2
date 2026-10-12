import {
  PRECEDENCE_TEXT,
  STACKING_TYPES,
  cellRules,
  describeRate,
  distinctValues,
  embeddedTax,
  emptyRuleForm,
  formToPrice,
  formToRule,
  formatRatePct,
  fractionToPercent,
  groupRulesByType,
  normalizeApplyResult,
  normalizePreview,
  normalizeSimulation,
  partitionPriceRules,
  percentToFraction,
  priceSource,
  priceSpecificity,
  priceToForm,
  programKey,
  resolveCellPrice,
  ruleToForm,
  scopeChips,
  standardRules,
  validatePriceForm,
  validateRuleForm,
} from './pricingUtils';

describe('percent <-> fraction', () => {
  it('converts typed percents to API fractions', () => {
    expect(percentToFraction('2')).toBe(0.02);
    expect(percentToFraction('11%')).toBe(0.11);
    expect(percentToFraction(10)).toBe(0.1);
    expect(percentToFraction('0')).toBe(0);
    expect(percentToFraction('')).toBeNull();
    expect(percentToFraction('abc')).toBeNull();
  });

  it('converts API fractions back without float noise', () => {
    expect(fractionToPercent(0.07)).toBe(7);
    expect(fractionToPercent(0.115)).toBe(11.5);
    expect(fractionToPercent(null)).toBe('');
    expect(formatRatePct(0.02)).toBe('2%');
    expect(formatRatePct(0.0991)).toBe('9.91%');
  });

  it('computes tax included in the price', () => {
    expect(embeddedTax(1110, 0.11)).toBeCloseTo(110, 10);
    expect(embeddedTax(1100, 0.1)).toBeCloseTo(100, 10);
  });

  it('describes a rate the way the table shows it', () => {
    expect(describeRate({ method: 'percent_of_gross', rate: 0.02 })).toBe('2%');
    expect(describeRate({ method: 'embedded_tax', rate: 0.11 })).toBe('11% in price');
    expect(describeRate({ method: 'per_unit', amount_per_unit: 4.5 })).toBe('$4.50 / unit');
  });
});

describe('deduction rule form', () => {
  it('round-trips a rule through the form with the rate in percent', () => {
    const rule = { rule_id: 'DED-1', deduction_type: 'excise_tax', method: 'embedded_tax', rate: 0.11, unit_type: 'Rifle', forecast_id: 'F1', is_active: true, name: 'FET' };
    const form = ruleToForm(rule);
    expect(form.ratePct).toBe(11);
    expect(form.scenarioOnly).toBe(true);
    const payload = formToRule(form, 'F1');
    expect(payload).toMatchObject({ deduction_type: 'excise_tax', method: 'embedded_tax', rate: 0.11, unit_type: 'Rifle', forecast_id: 'F1', is_active: 1, customer_id: null, name: 'FET' });
  });

  it('sends a blank name as null and company-wide when not scenario-only', () => {
    const payload = formToRule(emptyRuleForm({ ratePct: '2' }), 'F1');
    expect(payload.name).toBeNull();
    expect(payload.forecast_id).toBeNull();
    expect(payload.rate).toBe(0.02);
  });

  it('validates rate range, per-unit amount and months', () => {
    expect(validateRuleForm(emptyRuleForm({ ratePct: '2' }))).toEqual({});
    expect(validateRuleForm(emptyRuleForm({ ratePct: '' })).ratePct).toBeTruthy();
    expect(validateRuleForm(emptyRuleForm({ ratePct: '100' })).ratePct).toBeTruthy();
    expect(validateRuleForm(emptyRuleForm({ method: 'per_unit', amount_per_unit: '' })).amount_per_unit).toBeTruthy();
    expect(validateRuleForm(emptyRuleForm({ ratePct: '1', start_period: '2027-06', end_period: '2027-01' })).end_period).toBeTruthy();
  });
});

describe('rules grouping and scope', () => {
  const rules = [
    { rule_id: 'A', deduction_type: 'terms_allowance', name: 'Dealer 2%', customer_type: 'Dealer' },
    { rule_id: 'B', deduction_type: 'terms_allowance', name: 'All 1%' },
    { rule_id: 'C', deduction_type: 'excise_tax', name: 'FET rifles', unit_type: 'Rifle' },
    { rule_id: 'D', deduction_type: 'terms_allowance', name: 'ACME', customer_id: 'C1' },
    { rule_id: 'X', deduction_type: 'unknown' },
  ];

  it('groups by type in statement order, every type present, broadest first', () => {
    const groups = groupRulesByType(rules);
    expect(groups.map((g) => g.type)).toEqual(['terms_allowance', 'chargebacks', 'other_allowance', 'excise_tax', 'commission']);
    expect(groups[0].rules.map((r) => r.rule_id)).toEqual(['B', 'A', 'D']);
    expect(groups[1].rules).toEqual([]);
    expect(groups[3].rules.map((r) => r.rule_id)).toEqual(['C']);
  });

  it('builds scope chips, Everyone when unscoped', () => {
    expect(scopeChips({})).toEqual([{ kind: 'everyone', label: 'Everyone', value: null }]);
    const chips = scopeChips({ customer_id: 'C1', unit_type: 'Rifle' }, { customers: [{ customer_id: 'C1', customer_name: 'Acme Guns' }] });
    expect(chips.map((c) => [c.kind, c.label])).toEqual([['customer', 'Acme Guns'], ['product_type', 'Rifle']]);
  });

  it('lists distinct values case-insensitively', () => {
    expect(distinctValues([{ t: 'Dealer' }, { t: 'dealer ' }, { t: 'Distributor' }, { t: '' }, {}], 't')).toEqual(['Dealer', 'Distributor']);
  });

  it('offers standard rules using the product types in use', () => {
    const list = standardRules(['Pistols', 'rifle']);
    expect(list.map((r) => r.key)).toEqual(['terms', 'chargebacks', 'fet_rifle', 'fet_pistol']);
    expect(list.find((r) => r.key === 'fet_rifle')).toMatchObject({ unit_type: 'rifle', ratePct: 11, method: 'embedded_tax', typeFound: true });
    expect(list.find((r) => r.key === 'fet_pistol')).toMatchObject({ unit_type: 'Pistols', ratePct: 10 });
    expect(standardRules([]).find((r) => r.key === 'fet_rifle').typeFound).toBe(false);
  });
});

describe('price list', () => {
  const rules = [
    { price_id: 'P1', unit_id: 'R1', customer_type: 'Dealer', method: 'fixed', unit_price: 900 },
    { price_id: 'P2', unit_id: null, customer_type: 'Distributor', method: 'discount_from_base', discount_pct: 0.4 },
    { price_id: 'P3', unit_id: 'R1', method: 'fixed', unit_price: 1050 },
    { price_id: 'P4', unit_id: 'R1', customer_id: 'C1', method: 'fixed', unit_price: 850 },
    { price_id: 'P5', unit_id: 'R1', customer_type: 'Government', method: 'fixed', unit_price: 800, forecast_id: 'F2' },
  ];

  it('splits matrix, customer and all-product rules', () => {
    const parts = partitionPriceRules(rules);
    expect(parts.matrix.map((r) => r.price_id)).toEqual(['P1', 'P3', 'P5']);
    expect(parts.customer.map((r) => r.price_id)).toEqual(['P4']);
    expect(parts.allProducts.map((r) => r.price_id)).toEqual(['P2']);
  });

  it('finds the rules that sit in a cell', () => {
    expect(cellRules(rules, 'R1', 'dealer').map((r) => r.price_id)).toEqual(['P1']);
    expect(cellRules(rules, 'R1', null).map((r) => r.price_id)).toEqual(['P3']);
  });

  it('resolves a cell like the engine: type+product > type discount > all customers > list price', () => {
    const base = { unitId: 'R1', basePrice: 1200, forecastId: 'F1' };
    expect(resolveCellPrice(rules, { ...base, customerType: 'Dealer' })).toMatchObject({ price: 900, source: 'type_product' });
    expect(resolveCellPrice(rules, { ...base, customerType: 'Distributor' })).toMatchObject({ price: 720, source: 'type_all' });
    expect(resolveCellPrice(rules, { ...base, customerType: 'Direct' })).toMatchObject({ price: 1050, source: 'product' });
    // P5 belongs to another scenario, so Government falls through.
    expect(resolveCellPrice(rules, { ...base, customerType: 'Government' })).toMatchObject({ price: 1050, source: 'product' });
    expect(resolveCellPrice([], { unitId: 'X', basePrice: 500 })).toMatchObject({ price: 500, source: 'base_price' });
    expect(resolveCellPrice([], { unitId: 'X', basePrice: 0 })).toMatchObject({ price: null, source: 'none' });
  });

  it('validates and converts the price form', () => {
    expect(validatePriceForm({ method: 'fixed', unit_id: '', unit_price: '10' }).unit_id).toBeTruthy();
    expect(validatePriceForm({ method: 'discount_from_base', discountPct: '140' }).discountPct).toBeTruthy();
    expect(formToPrice({ method: 'discount_from_base', discountPct: '40', unit_id: '', customer_type: 'Distributor', is_active: true }, 'F1'))
      .toMatchObject({ method: 'discount_from_base', discount_pct: 0.4, unit_price: null, unit_id: null, customer_type: 'Distributor', forecast_id: null });
  });
});

describe('API readers', () => {
  it('reads the simulate response', () => {
    const sim = normalizeSimulation({
      data: {
        gross_sales: 1110,
        lines: [
          { deduction_type: 'terms_allowance', amount: 22.2, rule: { rule_id: 'A', name: 'Terms 2%', method: 'percent_of_gross', rate: 0.02 }, overridden_rules: ['B'] },
          { deduction_type: 'excise_tax', amount: 110, rule: { rule_id: 'C', name: 'FET', method: 'embedded_tax', rate: 0.11 } },
          { deduction_type: 'commission', amount: 0, rule: null },
        ],
        total_sales_deductions: 132.2,
        net_sales: 977.8,
        commission: 0,
      },
    });
    expect(sim.gross).toBe(1110);
    expect(sim.net).toBe(977.8);
    expect(sim.lines.find((l) => l.type === 'excise_tax')).toMatchObject({ amount: 110, rule: { name: 'FET' } });
    expect(sim.lines.find((l) => l.type === 'terms_allowance').overridden).toEqual(['B']);
    expect(sim.lines.find((l) => l.type === 'chargebacks')).toMatchObject({ amount: 0, rule: null });
  });

  it('reads the preview response', () => {
    const p = normalizePreview({
      data: {
        start_period: '2027-01', end_period: '2027-12', rows: 360,
        totals: { gross_sales: 1000000, terms_allowance: 20000, chargebacks: 10000, other_allowance: 0, excise_tax: 99099.1, commission: 30000, total_sales_deductions: 129099.1, net_sales: 870900.9 },
        by_type: [{ deduction_type: 'terms_allowance', amount: 20000 }, { deduction_type: 'excise_tax', amount: 99099.1 }],
        by_customer_type: [{ customer_type: 'Dealer', gross_sales: 600000, total_sales_deductions: 80000, net_sales: 520000, commission: 18000 }],
        rules: [{ rule_id: 'A', rows_applied: 360, amount: 20000 }],
      },
    });
    expect(p).toMatchObject({ gross: 1000000, net: 870900.9, totalDeductions: 129099.1, commission: 30000, rowCount: 360, startPeriod: '2027-01' });
    expect(p.byType.chargebacks).toBe(10000);
    expect(p.byCustomerType[0]).toMatchObject({ customer_type: 'Dealer', deductions: 80000, net: 520000 });
    expect(p.ruleUsage.A).toEqual({ rows: 360, amount: 20000 });
  });

  it('reads the apply response', () => {
    const a = normalizeApplyResult({ data: { matched: 360, changed: 300, unchanged: 50, unpriced: 10, revenue_before: 100, revenue_after: 120, by_source: { type_product: 280, base_price: 70, none: 10 }, sample_changes: [{ sale_id: 'S1' }] } });
    expect(a).toMatchObject({ matched: 360, changed: 300, unchanged: 50, unpriced: 10, revenueBefore: 100, revenueAfter: 120 });
    expect(a.bySource[0]).toEqual({ source: 'type_product', count: 280 });
    expect(a.samples).toHaveLength(1);
  });
});

describe('other allowances are programs', () => {
  it('explains and flags the stacking type', () => {
    expect(STACKING_TYPES).toEqual(['other_allowance']);
    expect(PRECEDENCE_TEXT).toMatch(/programs/);
    expect(programKey('  Co-op   Advertising ')).toBe('co-op advertising');
    expect(programKey(null)).toBe('');
  });

  it('keeps each program together, broadest rule first', () => {
    const groups = groupRulesByType([
      { rule_id: 'F2', deduction_type: 'other_allowance', name: 'Freight', customer_id: 'C1' },
      { rule_id: 'C1', deduction_type: 'other_allowance', name: 'Co-op', customer_type: 'Distributor' },
      { rule_id: 'F1', deduction_type: 'other_allowance', name: 'freight' },
      { rule_id: 'C2', deduction_type: 'other_allowance', name: 'co-op', customer_id: 'C1' },
    ]);
    expect(groups.find((g) => g.type === 'other_allowance').rules.map((r) => r.rule_id)).toEqual(['C1', 'C2', 'F1', 'F2']);
  });

  it('reads every program the simulation applied', () => {
    const sim = normalizeSimulation({
      data: {
        gross_sales: 10000,
        lines: [{
          deduction_type: 'other_allowance',
          amount: 80,
          rule: { rule_id: 'C', name: 'Co-op', method: 'percent_of_gross', rate: 0.005 },
          rules: [
            { rule_id: 'C', name: 'Co-op', method: 'percent_of_gross', rate: 0.005, amount: 50 },
            { rule_id: 'F', name: 'Freight', method: 'per_unit', amount_per_unit: 3, amount: 30 },
          ],
          overridden_rules: [],
        }],
        total_sales_deductions: 80,
        net_sales: 9920,
      },
    });
    const other = sim.lines.find((l) => l.type === 'other_allowance');
    expect(other.amount).toBe(80);
    expect(other.rules.map((r) => [r.rule_id, r.amount])).toEqual([['C', 50], ['F', 30]]);
    // an older response without "rules" still gives the one rule
    const old = normalizeSimulation({ data: { lines: [{ deduction_type: 'terms_allowance', amount: 20, rule: { rule_id: 'T' } }] } });
    expect(old.lines.find((l) => l.type === 'terms_allowance').rules).toEqual([{ rule_id: 'T', amount: 20 }]);
  });
});

describe('product-type prices', () => {
  const rules = [
    { price_id: 'P-ALL', customer_type: 'Distributor', method: 'discount_from_base', discount_pct: 0.3 },
    { price_id: 'P-ACC', customer_type: 'Distributor', unit_type: 'Accessory', method: 'discount_from_base', discount_pct: 0.4 },
    { price_id: 'P-MAG', customer_type: 'Distributor', unit_id: 'MAG', method: 'fixed', unit_price: 20 },
    { price_id: 'P-PST', unit_type: 'Pistol', method: 'discount_from_base', discount_pct: 0.1 },
  ];

  it('scores and names sources like the engine', () => {
    expect(priceSpecificity({ customer_id: 'C', unit_id: 'U' })).toBe(10);
    expect(priceSpecificity({ customer_type: 'T', unit_type: 'Accessory' })).toBe(5);
    expect(priceSource({ customer_type: 'T', unit_type: 'X' })).toBe('type_product_type');
    expect(priceSource({ customer_id: 'C', unit_type: 'X' })).toBe('customer_product_type');
    expect(priceSource({ unit_type: 'X' })).toBe('product_type');
    expect(priceSource({ customer_type: 'T', unit_id: 'U', unit_type: 'X' })).toBe('type_product');
  });

  it('resolves cells with the product type', () => {
    const dist = { customerType: 'Distributor', forecastId: null };
    expect(resolveCellPrice(rules, { ...dist, unitId: 'ACC', unitType: 'accessory', basePrice: 50 })).toMatchObject({ price: 30, source: 'type_product_type' });
    expect(resolveCellPrice(rules, { ...dist, unitId: 'MAG', unitType: 'Accessory', basePrice: 40 })).toMatchObject({ price: 20, source: 'type_product' });
    expect(resolveCellPrice(rules, { ...dist, unitId: 'RIF', unitType: 'Rifle', basePrice: 1500 })).toMatchObject({ price: 1050, source: 'type_all' });
    expect(resolveCellPrice(rules, { unitId: 'PST', unitType: 'Pistol', basePrice: 800, customerType: 'Retail' })).toMatchObject({ price: 720, source: 'product_type' });
    expect(resolveCellPrice(rules, { ...dist, unitId: 'PST', unitType: 'Pistol', basePrice: 800 })).toMatchObject({ price: 560, source: 'type_all' });
  });

  it('breaks ties like the engine: bounded window, then newer, then id', () => {
    const tie = [
      { price_id: 'P-Z', unit_id: 'R', method: 'fixed', unit_price: 900, start_period: '2027-01', created_at: '2026-10-12 09:00:00' },
      { price_id: 'P-A', unit_id: 'R', method: 'fixed', unit_price: 950, start_period: '2027-01', end_period: '2027-06', created_at: '2026-01-01 09:00:00' },
    ];
    expect(resolveCellPrice(tie, { unitId: 'R', basePrice: 1000 }).rule.price_id).toBe('P-A');
    const newer = [
      { price_id: 'P-Z', unit_id: 'R', method: 'fixed', unit_price: 900, created_at: '2026-01-01 09:00:00' },
      { price_id: 'P-A', unit_id: 'R', method: 'fixed', unit_price: 950, created_at: '2026-06-01T09:00:00' },
    ];
    expect(resolveCellPrice(newer, { unitId: 'R', basePrice: 1000 }).price).toBe(950);
  });

  it('lists product-type rules with the every-product ones', () => {
    expect(partitionPriceRules(rules).allProducts.map((r) => r.price_id)).toEqual(['P-ALL', 'P-ACC', 'P-PST']);
  });

  it('round-trips the product type through the form', () => {
    const form = priceToForm(rules[1]);
    expect(form.unit_type).toBe('Accessory');
    expect(formToPrice(form, null)).toMatchObject({ unit_id: null, unit_type: 'Accessory', discount_pct: 0.4, customer_type: 'Distributor' });
    expect(formToPrice({ ...form, unit_id: 'ACC' }, null).unit_type).toBeNull();     // a product beats its type
    expect(validatePriceForm({ method: 'fixed', unit_id: '', unit_type: 'Accessory', unit_price: '35' })).toEqual({});
    expect(validatePriceForm({ method: 'fixed', unit_id: '', unit_type: '', unit_price: '35' }).unit_id).toBeTruthy();
  });
});
