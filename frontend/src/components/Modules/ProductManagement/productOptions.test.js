import {
  bomLineCount,
  bomVersionsFor,
  canonicalChoice,
  defaultBomVersion,
  mapProductForBackend,
  productCostChecks,
  productTypeOptions,
} from './productOptions';

describe('mapProductForBackend', () => {
  test('an update keeps the stored BOM version (never resets 2.0 to 1.0)', () => {
    const payload = mapProductForBackend({ unit_name: 'Ridgeline', base_price: 2899, bom: 'BOM-RFL-300', router: 'RTG-BOLT' });
    expect(payload).toEqual({ unit_name: 'Ridgeline', base_price: 2899, bom_id: 'BOM-RFL-300', router_id: 'RTG-BOLT' });
    expect(payload).not.toHaveProperty('bom_version');
    expect(payload).not.toHaveProperty('router_version');
  });

  test('an update sends the version the user picked', () => {
    expect(mapProductForBackend({ bom: 'BOM-1', bom_version: '2.0' })).toEqual({ bom_id: 'BOM-1', bom_version: '2.0' });
    expect(mapProductForBackend({ bom: 'BOM-1', bom_version: '' })).toEqual({ bom_id: 'BOM-1' });
  });

  test('create defaults versions to 1.0; clearing the BOM clears its version', () => {
    expect(mapProductForBackend({ bom: 'BOM-1', router: 'R1' }, { isCreate: true }))
      .toEqual({ bom_id: 'BOM-1', bom_version: '1.0', router_id: 'R1', router_version: '1.0' });
    expect(mapProductForBackend({ bom: null, bom_version: null })).toEqual({ bom_id: null, bom_version: null });
  });
});

describe('BOM versions', () => {
  const bomLines = [
    { bom_id: 'BOM-A', version: '1.0', bom_line: 1 },
    { bom_id: 'BOM-A', version: '1.0', bom_line: 2 },
    { bom_id: 'BOM-A', version: '2.0', bom_line: 1 },
    { bom_id: 'BOM-A', version: '10.0', bom_line: 1 },
    { bom_id: 'BOM-B', version: '1.0', bom_line: 1 },
  ];
  const bomDefinitions = [{ bom_id: 'BOM-A', version: '2.0' }, { bom_id: 'BOM-C', version: '3.0' }];

  test('versions come from lines and the header, numerically sorted, keeping the product version', () => {
    expect(bomVersionsFor('BOM-A', { bomLines, bomDefinitions })).toEqual(['1.0', '2.0', '10.0']);
    expect(bomVersionsFor('BOM-C', { bomLines, bomDefinitions })).toEqual(['3.0']);
    expect(bomVersionsFor('BOM-B', { bomLines, bomDefinitions, keep: '4.0' })).toEqual(['1.0', '4.0']);
    expect(bomVersionsFor('', { bomLines })).toEqual([]);
  });

  test('default version: the product one when it exists, else the header one, else the highest', () => {
    expect(defaultBomVersion('BOM-A', { bomLines, bomDefinitions, current: '1.0' })).toBe('1.0');
    expect(defaultBomVersion('BOM-A', { bomLines, bomDefinitions, current: '9.9' })).toBe('2.0');
    expect(defaultBomVersion('BOM-B', { bomLines, bomDefinitions })).toBe('1.0');
    expect(bomLineCount('BOM-A', '1.0', bomLines)).toBe(2);
  });
});

describe('product type suggestions', () => {
  test('existing types first (their spelling wins), then the firearm defaults', () => {
    const options = productTypeOptions([{ unit_type: 'rifle' }, { unit_type: 'Component' }, { unit_type: ' ' }]);
    expect(options.slice(0, 2)).toEqual(['Component', 'rifle']);
    expect(options).toContain('Pistol');
    expect(options.filter(o => o.toLowerCase() === 'rifle')).toHaveLength(1);
  });

  test('canonicalChoice reuses the existing spelling', () => {
    expect(canonicalChoice(' RIFLE ', ['Rifle', 'Pistol'])).toBe('Rifle');
    expect(canonicalChoice('Suppressor', ['Rifle'])).toBe('Suppressor');
    expect(canonicalChoice('  ', ['Rifle'])).toBe('');
  });
});

describe('productCostChecks', () => {
  const good = { unit_id: 'RFL', unit_type: 'Rifle', base_price: 1899, bom: 'BOM-A', bom_version: '1.0', router: 'R1' };

  test('a fully costed product has no problems; a missing description is not a problem', () => {
    const { problems, unitCost } = productCostChecks(good, { unit_total_cost: 711.5, warnings: [] });
    expect(problems).toEqual([]);
    expect(unitCost).toBe(711.5);
  });

  test('missing BOM / version / routing are errors', () => {
    expect(productCostChecks({ ...good, bom: null }, { warnings: ['missing_bom'] }).problems[0].level).toBe('error');
    const version = productCostChecks({ ...good, bom_version: '3.0' }, { warnings: ['bom_version_not_found'] }).problems;
    expect(version[0].text).toMatch(/no version 3.0/);
    const noOps = productCostChecks(good, { warnings: ['missing_router'] }).problems;
    expect(noOps).toEqual([{ level: 'error', text: 'Routing R1 has no operations' }]);
  });

  test('price below cost, no price and no type are warnings', () => {
    expect(productCostChecks({ ...good, base_price: 500 }, { unit_total_cost: 700, warnings: [] }).problems)
      .toEqual([{ level: 'warning', text: 'List price is below unit cost' }]);
    const levels = productCostChecks({ ...good, base_price: 0, unit_type: '' }, { unit_total_cost: 700, warnings: [] }).problems.map(p => p.level);
    expect(levels).toEqual(['warning', 'warning']);
  });
});
