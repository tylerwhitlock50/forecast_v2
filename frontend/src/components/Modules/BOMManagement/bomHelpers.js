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
