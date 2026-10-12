// Pure helpers for the BOM screen (tested in bomHelpers.test.js).

export const versionOf = (value) => (value === null || value === undefined || value === '' ? '1.0' : String(value));

/** Next free id in the BOM-001 style (ids in other styles are ignored). */
export const nextBomId = (bomDefinitions = []) => {
  const taken = new Set(bomDefinitions.map(b => b.bom_id));
  let n = Math.max(
    0,
    ...bomDefinitions.map(b => {
      const m = /^BOM-(\d+)$/.exec(String(b.bom_id || ''));
      return m ? parseInt(m[1], 10) : 0;
    })
  ) + 1;
  while (taken.has(`BOM-${String(n).padStart(3, '0')}`)) n += 1;
  return `BOM-${String(n).padStart(3, '0')}`;
};

/** Lines of one BOM version, ordered by line number. */
export const linesOf = (bomItems = [], bomId, version) =>
  bomItems
    .filter(l => l.bom_id === bomId && versionOf(l.version) === versionOf(version))
    .sort((a, b) => (a.bom_line || 0) - (b.bom_line || 0));

/**
 * Rows for POST /import/boms that copy ONE BOM version (the one shown on the
 * row) to a new BOM id, keeping its version and line numbers.
 */
export const cloneRows = (bomItems, source, newBomId) => {
  const version = versionOf(source?.version);
  return linesOf(bomItems, source?.bom_id, version).map(line => ({
    bom_id: newBomId,
    bom_name: `${source.bom_name || source.bom_id} (copy)`,
    bom_description: source.bom_description || '',
    version,
    bom_line: line.bom_line,
    material_description: line.material_description,
    qty: line.qty,
    unit: line.unit,
    unit_price: line.unit_price,
    material_cost: line.material_cost,
    target_cost: line.target_cost,
  }));
};

/**
 * What deleting a BOM header removes: every line of every version (the
 * backend's cascade) and the products that point at it (they get unlinked).
 */
export const bomDeleteImpact = (bomId, bomItems = [], products = []) => {
  const lines = bomItems.filter(l => l.bom_id === bomId);
  const versions = [...new Set(lines.map(l => versionOf(l.version)))].sort();
  const users = products.filter(p => (p.bom ?? p.bom_id) === bomId);
  return {
    lineCount: lines.length,
    versions,
    products: users.map(p => p.unit_name || p.unit_id).filter(Boolean),
  };
};

const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);

const bomKey = (bomId, version) => `${bomId}|${versionOf(version)}`;

const lineLabel = (item) => `${item.bom_id} v${versionOf(item.version)} line ${item.bom_line ?? '?'}`;

const isBlank = (value) => value === null || value === undefined || String(value).trim() === '';

/**
 * Data checks for the BOM screen. Each BOM header (bom_id + version) is
 * checked against its own lines, so a BOM is never reported "without
 * items" because of how the lines are passed in. Only things that change
 * material cost or make it unreliable are reported; target costs are
 * optional and only compared when one is set.
 *
 * Returns {issues, warnings, checkedBoms, bomsWithProblems, totalLines,
 *          completeLines, problemLines}; each issue / warning is
 * {type, category, title, description, items, severity}.
 */
export const validateBoms = (boms = [], bomItems = []) => {
  const issues = [];
  const warnings = [];
  const problemBoms = new Set();
  const problemLines = new Set();
  const items = Array.isArray(bomItems) ? bomItems : [];
  const headers = Array.isArray(boms) ? boms : [];

  const flag = (list, entry, offenders, toBom = (o) => bomKey(o.bom_id, o.version)) => {
    if (offenders.length === 0) return;
    offenders.forEach((o) => {
      problemBoms.add(toBom(o));
      if (o.bom_line !== undefined) problemLines.add(`${bomKey(o.bom_id, o.version)}|${o.bom_line}`);
    });
    list.push(entry);
  };

  // 1. BOM versions with no lines: products on them get $0 material cost.
  const empty = headers.filter((bom) => linesOf(items, bom.bom_id, bom.version).length === 0);
  flag(issues, {
    type: 'error',
    category: 'Missing data',
    title: 'BOMs without lines',
    description: `${empty.length} BOM${empty.length === 1 ? ' has' : 's have'} no material lines, so products using ${empty.length === 1 ? 'it' : 'them'} get $0 material cost`,
    items: empty.map((bom) => `${bom.bom_id} v${versionOf(bom.version)}${bom.bom_name ? ` (${bom.bom_name})` : ''}`),
    severity: 'high',
  }, empty, (bom) => bomKey(bom.bom_id, bom.version));

  // 2. Lines without a description.
  const noDescription = items.filter((item) => isBlank(item.material_description));
  flag(issues, {
    type: 'error',
    category: 'Missing data',
    title: 'Lines without a description',
    description: `${noDescription.length} line${noDescription.length === 1 ? ' has' : 's have'} no material description`,
    items: noDescription.map(lineLabel),
    severity: 'high',
  }, noDescription);

  // 3. Duplicate line numbers within one BOM version.
  const groups = {};
  items.forEach((item) => {
    const key = bomKey(item.bom_id, item.version);
    (groups[key] = groups[key] || []).push(item);
  });
  const duplicates = [];
  Object.values(groups).forEach((lines) => {
    const seen = new Set();
    lines.forEach((line) => {
      if (line.bom_line === null || line.bom_line === undefined) return;
      if (seen.has(line.bom_line)) duplicates.push(line);
      seen.add(line.bom_line);
    });
  });
  flag(issues, {
    type: 'error',
    category: 'Data integrity',
    title: 'Duplicate line numbers',
    description: `${duplicates.length} line number${duplicates.length === 1 ? ' is' : 's are'} used twice in the same BOM version`,
    items: duplicates.map(lineLabel),
    severity: 'high',
  }, duplicates);

  // 4. Zero or negative quantities: the line adds nothing to material cost.
  const badQty = items.filter((item) => !(Number(item.qty) > 0));
  flag(warnings, {
    type: 'warning',
    category: 'Costing',
    title: 'Lines with a zero or negative quantity',
    description: `${badQty.length} line${badQty.length === 1 ? ' has' : 's have'} no positive quantity per unit`,
    items: badQty.map((item) => `${lineLabel(item)}: ${item.material_description || 'no description'}`),
    severity: 'medium',
  }, badQty);

  // 5. No unit cost: the line costs $0.
  const noPrice = items.filter((item) => !(Number(item.unit_price) > 0) && !(Number(item.material_cost) > 0));
  flag(warnings, {
    type: 'warning',
    category: 'Costing',
    title: 'Lines without a unit cost',
    description: `${noPrice.length} line${noPrice.length === 1 ? ' has' : 's have'} no unit cost, so ${noPrice.length === 1 ? 'it adds' : 'they add'} $0 to material cost`,
    items: noPrice.map((item) => `${lineLabel(item)}: ${item.material_description || 'no description'}`),
    severity: 'medium',
  }, noPrice);

  // 6. Extended cost that is not quantity x unit cost.
  const mismatched = items.filter((item) => {
    const qty = Number(item.qty);
    const price = Number(item.unit_price);
    const cost = Number(item.material_cost);
    if (!(qty > 0) || !(price > 0) || !(cost > 0)) return false;
    return Math.abs(qty * price - cost) > 0.01;
  });
  flag(warnings, {
    type: 'warning',
    category: 'Calculations',
    title: 'Extended cost is not quantity × unit cost',
    description: `${mismatched.length} line${mismatched.length === 1 ? '' : 's'} where the extended cost differs from quantity × unit cost`,
    items: mismatched.map((item) => `${lineLabel(item)}: expected ${money(Number(item.qty) * Number(item.unit_price))}, stored ${money(item.material_cost)}`),
    severity: 'medium',
  }, mismatched);

  // 7. Far off target (only where a target cost is set).
  const offTarget = items.filter((item) => {
    const target = Number(item.target_cost);
    const cost = Number(item.material_cost);
    return target > 0 && cost > 0 && Math.abs(cost - target) / target > 0.2;
  });
  flag(warnings, {
    type: 'warning',
    category: 'Costing',
    title: 'More than 20% off target cost',
    description: `${offTarget.length} line${offTarget.length === 1 ? ' is' : 's are'} more than 20% above or below the target cost`,
    items: offTarget.map((item) => {
      const pct = ((Number(item.material_cost) - Number(item.target_cost)) / Number(item.target_cost)) * 100;
      return `${lineLabel(item)}: ${pct > 0 ? '+' : ''}${pct.toFixed(1)}% (${money(item.material_cost)} vs ${money(item.target_cost)})`;
    }),
    severity: 'low',
  }, offTarget);

  const completeLines = items.filter((item) => !isBlank(item.material_description) && Number(item.qty) > 0
    && (Number(item.unit_price) > 0 || Number(item.material_cost) > 0)).length;

  return {
    issues,
    warnings,
    checkedBoms: headers.length,
    bomsWithProblems: headers.filter((bom) => problemBoms.has(bomKey(bom.bom_id, bom.version))).length,
    totalLines: items.length,
    completeLines,
    problemLines: problemLines.size,
  };
};
