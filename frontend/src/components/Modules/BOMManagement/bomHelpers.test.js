import { nextBomId, linesOf, cloneRows, bomDeleteImpact, versionOf, validateBoms } from './bomHelpers';

const lines = [
  { bom_id: 'B-RIDGE', version: '1.0', bom_line: 2, material_description: 'Stock', qty: 1, unit: 'each', unit_price: 200, material_cost: 200 },
  { bom_id: 'B-RIDGE', version: '1.0', bom_line: 1, material_description: 'Barrel', qty: 1, unit: 'each', unit_price: 140, material_cost: 140 },
  { bom_id: 'B-RIDGE', version: '2.0', bom_line: 1, material_description: 'Barrel v2', qty: 1, unit: 'each', unit_price: 150, material_cost: 150 },
  { bom_id: 'B-MESA', version: null, bom_line: 1, material_description: 'Barrel', qty: 1, unit: 'each', unit_price: 95, material_cost: 95 },
];

describe('bomHelpers', () => {
  it('versionOf defaults blank versions to 1.0', () => {
    expect(versionOf(null)).toBe('1.0');
    expect(versionOf('')).toBe('1.0');
    expect(versionOf('2.0')).toBe('2.0');
  });

  it('nextBomId skips ids in other styles and taken ids', () => {
    expect(nextBomId([])).toBe('BOM-001');
    expect(nextBomId([{ bom_id: 'BOM-RFL-100' }, { bom_id: 'BOM-002' }])).toBe('BOM-003');
  });

  it('linesOf returns one version, ordered by line', () => {
    expect(linesOf(lines, 'B-RIDGE', '1.0').map(l => l.bom_line)).toEqual([1, 2]);
    expect(linesOf(lines, 'B-MESA', '1.0')).toHaveLength(1);
  });

  it('cloneRows copies only the selected version and keeps version + line numbers', () => {
    const rows = cloneRows(lines, { bom_id: 'B-RIDGE', bom_name: 'Ridgeline', version: '2.0' }, 'BOM-007');
    expect(rows).toEqual([
      expect.objectContaining({ bom_id: 'BOM-007', version: '2.0', bom_line: 1, material_description: 'Barrel v2', bom_name: 'Ridgeline (copy)' }),
    ]);
    expect(cloneRows(lines, { bom_id: 'B-RIDGE', version: '1.0' }, 'X')).toHaveLength(2);
  });

  it('bomDeleteImpact counts every version and lists the products using the BOM', () => {
    const products = [
      { unit_id: 'P-RIDGE', unit_name: 'Ridgeline', bom: 'B-RIDGE' },
      { unit_id: 'P-MESA', unit_name: 'Mesa', bom: 'B-MESA' },
    ];
    expect(bomDeleteImpact('B-RIDGE', lines, products)).toEqual({ lineCount: 3, versions: ['1.0', '2.0'], products: ['Ridgeline'] });
    expect(bomDeleteImpact('B-NONE', lines, products)).toEqual({ lineCount: 0, versions: [], products: [] });
  });
});

describe('validateBoms', () => {
  const headers = [
    { bom_id: 'BOM-RF100', version: 'A', bom_name: 'RF-100 assembly' },
    { bom_id: 'BOM-AC200', version: 'A', bom_name: 'AC-200 assembly' },
  ];
  const good = [
    { bom_id: 'BOM-RF100', version: 'A', bom_line: 10, material_description: 'Barrel blank', qty: 1, unit_price: 118, material_cost: 118 },
    { bom_id: 'BOM-RF100', version: 'A', bom_line: 20, material_description: 'Receiver', qty: 1, unit_price: 142.5, material_cost: 142.5 },
    { bom_id: 'BOM-AC200', version: 'A', bom_line: 10, material_description: 'Mount', qty: 1, unit_price: 31.25, material_cost: 31.25 },
  ];

  it('finds the lines of every BOM version (no false "BOMs without lines")', () => {
    const r = validateBoms(headers, good);
    expect(r.issues).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r).toMatchObject({ checkedBoms: 2, bomsWithProblems: 0, totalLines: 3, completeLines: 3 });
  });

  it('does not ask for target costs when none are set', () => {
    const r = validateBoms(headers, good.map((l) => ({ ...l, target_cost: null })));
    expect(r.warnings.map((w) => w.title)).toEqual([]);
  });

  it('reports an empty BOM version, a $0 line and a cost that is not qty x price', () => {
    const r = validateBoms(
      [...headers, { bom_id: 'BOM-RF100', version: 'B' }],
      [
        ...good,
        { bom_id: 'BOM-AC200', version: 'A', bom_line: 20, material_description: 'Screws', qty: 4, unit_price: 0, material_cost: 0 },
        { bom_id: 'BOM-AC200', version: 'A', bom_line: 30, material_description: 'Rings', qty: 2, unit_price: 1250, material_cost: 1000 },
      ],
    );
    expect(r.issues.map((i) => i.title)).toEqual(['BOMs without lines']);
    expect(r.issues[0].items).toEqual(['BOM-RF100 vB']);
    expect(r.warnings.map((w) => w.title)).toEqual(['Lines without a unit cost', 'Extended cost is not quantity × unit cost']);
    expect(r.warnings[1].items[0]).toBe('BOM-AC200 vA line 30: expected $2,500.00, stored $1,000.00');
    expect(r.bomsWithProblems).toBe(2);
  });
});
