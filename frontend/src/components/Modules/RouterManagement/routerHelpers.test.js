import { nextRouterId, operationsOf, cloneRoutingRows, routerDeleteImpact } from './routerHelpers';

const ops = [
  { operation_id: 2, router_id: 'RTG-BOLT', sequence: 20, machine_id: 'CNC-01', machine_minutes: 22, labor_minutes: 8, labor_type_id: 'LR-MACH', operation_description: 'Machine' },
  { operation_id: 1, router_id: 'RTG-BOLT', sequence: 10, machine_id: 'LATHE-01', machine_minutes: 18, labor_minutes: 6, labor_type_id: 'LR-MACH', operation_description: 'Turn' },
  { operation_id: 3, router_id: 'RTG-AR', sequence: 10, machine_id: 'CNC-01', machine_minutes: 14, labor_minutes: 5, labor_type_id: 'LR-MACH' },
];

describe('routerHelpers', () => {
  it('nextRouterId follows the R0001 style', () => {
    expect(nextRouterId([])).toBe('R0001');
    expect(nextRouterId([{ router_id: 'RTG-BOLT' }, { router_id: 'R0009' }])).toBe('R0010');
  });

  it('operationsOf orders by sequence', () => {
    expect(operationsOf(ops, 'RTG-BOLT').map(o => o.sequence)).toEqual([10, 20]);
  });

  it('cloneRoutingRows copies every operation to the new id', () => {
    const rows = cloneRoutingRows(ops, { router_id: 'RTG-BOLT', router_name: 'Bolt' }, 'R0002');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(expect.objectContaining({ router_id: 'R0002', router_name: 'Bolt (copy)', sequence: 10, machine_id: 'LATHE-01', labor_minutes: 6 }));
    expect(rows[0]).not.toHaveProperty('operation_id');
  });

  it('routerDeleteImpact lists operations and products', () => {
    const products = [{ unit_id: 'RFL-100', unit_name: 'Ridgeline', router: 'RTG-BOLT' }, { unit_id: 'AR-15', router: 'RTG-AR' }];
    expect(routerDeleteImpact('RTG-BOLT', ops, products)).toEqual({ operationCount: 2, sequences: [10, 20], products: ['Ridgeline'] });
    expect(routerDeleteImpact('RTG-AR', ops, products).products).toEqual(['AR-15']);
  });
});
