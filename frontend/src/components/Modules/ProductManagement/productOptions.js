// Pure helpers for the product form: product-type suggestions, the BOM
// versions a product can point at, and the payload written to `units`.

/**
 * Product form data -> `units` columns. The UI says `bom` / `router`; the
 * table has `bom_id` / `router_id` plus `*_version`. Versions default to 1.0
 * only when a product is created: an update that does not name a version
 * leaves the stored one alone, so editing a price can never move a product
 * from BOM version 2.0 back to 1.0.
 */
export const mapProductForBackend = (productData, { isCreate = false } = {}) => {
  const payload = { ...productData };
  if ('bom' in payload) {
    payload.bom_id = payload.bom || null;
    delete payload.bom;
  }
  if ('router' in payload) {
    payload.router_id = payload.router || null;
    delete payload.router;
  }
  if (isCreate) {
    if (payload.bom_id && !payload.bom_version) payload.bom_version = '1.0';
    if (payload.router_id && !payload.router_version) payload.router_version = '1.0';
  } else {
    // Blank versions in an update mean "unchanged", not "reset".
    if ('bom_version' in payload && !payload.bom_version && payload.bom_id) delete payload.bom_version;
    if ('router_version' in payload && !payload.router_version && payload.router_id) delete payload.router_version;
  }
  if (payload.bom_id === null && 'bom_version' in payload && !payload.bom_version) payload.bom_version = null;
  return payload;
};

export const DEFAULT_PRODUCT_TYPES = ['Rifle', 'Pistol', 'Shotgun', 'Suppressor', 'Component', 'Accessory'];

const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());

/**
 * Distinct suggestions: the values already in use first (so the spelling the
 * data uses wins, compared case-insensitively), then the defaults not yet
 * present, each group sorted.
 */
export const suggestionList = (existing, defaults = []) => {
  const seen = new Map();
  (existing || []).map(clean).filter(Boolean).forEach((v) => {
    if (!seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  });
  const used = Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  const extra = (defaults || []).filter(d => !seen.has(clean(d).toLowerCase())).sort((a, b) => a.localeCompare(b));
  return [...used, ...extra];
};

/** Existing product types plus the firearm defaults. */
export const productTypeOptions = (products) => suggestionList((products || []).map(p => p.unit_type), DEFAULT_PRODUCT_TYPES);

/** The entered value in the spelling already used by another record ('rifle ' -> 'Rifle'). */
export const canonicalChoice = (value, options) => {
  const v = clean(value);
  if (!v) return '';
  const hit = (options || []).find(o => clean(o).toLowerCase() === v.toLowerCase());
  return hit || v;
};

const versionSort = (a, b) => {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
};

/**
 * Versions that exist for a BOM: the versions of its lines plus its header's
 * version, plus `keep` (the product's current version) so an edit never
 * silently drops it. Sorted ascending.
 */
export const bomVersionsFor = (bomId, { bomLines = [], bomDefinitions = [], keep = null } = {}) => {
  if (!bomId) return [];
  const versions = new Set();
  (bomLines || []).forEach(line => {
    if (line?.bom_id === bomId && clean(line.version)) versions.add(clean(line.version));
  });
  (bomDefinitions || []).forEach(def => {
    if (def?.bom_id === bomId && clean(def.version)) versions.add(clean(def.version));
  });
  if (clean(keep)) versions.add(clean(keep));
  return Array.from(versions).sort(versionSort);
};

/** Number of lines in one BOM version. */
export const bomLineCount = (bomId, version, bomLines = []) => (bomLines || [])
  .filter(line => line?.bom_id === bomId && clean(line.version) === clean(version)).length;

/**
 * The version to select for a BOM: the product's own when it exists, else the
 * BOM header's current version, else the highest version with lines.
 */
export const defaultBomVersion = (bomId, { bomLines = [], bomDefinitions = [], current = null } = {}) => {
  const versions = bomVersionsFor(bomId, { bomLines, bomDefinitions });
  if (clean(current) && versions.includes(clean(current))) return clean(current);
  const header = (bomDefinitions || []).find(d => d?.bom_id === bomId);
  if (header && clean(header.version)) return clean(header.version);
  return versions.length ? versions[versions.length - 1] : '1.0';
};

// ---------------------------------------------------------------------------
// Costing checks
// ---------------------------------------------------------------------------

/** Cost-rollup warning codes (GET /products/cost-summary) in plain words. */
export const COST_WARNING_LABELS = {
  missing_bom: 'BOM missing or costs $0',
  bom_version_not_found: 'BOM version does not exist',
  missing_router: 'Routing missing or has no operations',
  router_missing_machine: 'Routing uses a machine that does not exist',
  router_labor_without_type: 'Routing has labor minutes without a labor type',
  router_missing_labor_rate: 'Routing uses a labor type with no rate',
};

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/**
 * One product + its cost-summary row -> { problems: [{ level, text }], unitCost }.
 * level 'error' = the forecast's COGS is wrong for this product;
 * 'warning' = it prices or costs out, but something looks off.
 * A missing description is not a problem.
 */
export const productCostChecks = (product, costRow) => {
  const problems = [];
  const codes = new Set((costRow?.warnings || []).map(w => (typeof w === 'string' ? w : w?.code)).filter(Boolean));
  const bom = product?.bom ?? product?.bom_id;
  const router = product?.router ?? product?.router_id;

  if (!clean(bom)) problems.push({ level: 'error', text: 'No BOM assigned: material cost is $0' });
  else if (codes.has('bom_version_not_found')) problems.push({ level: 'error', text: `BOM ${bom} has no version ${product?.bom_version || ''}`.trim() });
  else if (codes.has('missing_bom')) problems.push({ level: 'error', text: `BOM ${bom} has no lines or costs $0` });

  if (!clean(router)) problems.push({ level: 'error', text: 'No routing assigned: labor and machine cost are $0' });
  else if (codes.has('missing_router')) problems.push({ level: 'error', text: `Routing ${router} has no operations` });

  ['router_missing_machine', 'router_labor_without_type', 'router_missing_labor_rate'].forEach(code => {
    if (codes.has(code)) problems.push({ level: 'warning', text: COST_WARNING_LABELS[code] });
  });
  codes.forEach(code => {
    if (!COST_WARNING_LABELS[code]) problems.push({ level: 'warning', text: code.replace(/_/g, ' ') });
  });

  const price = n(product?.base_price);
  const unitCost = costRow ? n(costRow.unit_total_cost) : null;
  if (!(price > 0)) problems.push({ level: 'warning', text: 'No list price (rows without a price-list entry have no fallback)' });
  else if (unitCost !== null && unitCost > 0 && price < unitCost) {
    problems.push({ level: 'warning', text: 'List price is below unit cost' });
  }
  if (!clean(product?.unit_type)) problems.push({ level: 'warning', text: 'No product type (excise rules by type will not apply)' });

  return { problems, unitCost };
};
