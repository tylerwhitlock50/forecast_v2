import { nextRouterId, operationsOf, cloneRoutingRows, routerDeleteImpact, validateRoutings } from './routerHelpers';

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

describe('validateRoutings', () => {
  const machines = [{ machine_id: 'WC-LATH1', machine_rate: 95 }, { machine_id: 'WC-TEST', machine_rate: 30 }];
  const laborRates = [{ rate_id: 'MACH', rate_amount: 32.5 }, { rate_id: 'QC', rate_amount: 28 }];
  const routers = [{ router_id: 'RT-RF100', router_name: 'RF-100 routing', version: '1.0' }];
  const products = [{ unit_id: 'RF-100', router: 'RT-RF100' }];
  const operations = [
    { router_id: 'RT-RF100', sequence: 10, machine_id: 'WC-LATH1', machine_minutes: 42, labor_minutes: 20, labor_type_id: 'MACH' },
    // A test-range step: labor only, no machine minutes. Not a problem.
    { router_id: 'RT-RF100', sequence: 60, machine_id: 'WC-TEST', machine_minutes: 0, labor_minutes: 15, labor_type_id: 'QC' },
  ];

  it('does not treat routing headers as operations (no false "missing machine / sequence")', () => {
    const r = validateRoutings({ routers, operations, machines, products, laborRates });
    expect(r.issues).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r).toMatchObject({ routings: 1, operations: 2, cleanRoutings: 1 });
  });

  it('reports what changes cost: empty routings, unknown machines, labor without a type, missing links', () => {
    const r = validateRoutings({
      routers: [...routers, { router_id: 'RT-EMPTY' }],
      operations: [
        ...operations,
        { router_id: 'RT-RF100', sequence: 70, machine_id: 'WC-GONE', machine_minutes: 5, labor_minutes: 4, labor_type_id: null },
      ],
      machines,
      laborRates,
      products: [...products, { unit_id: 'RF-999', router: 'RT-NOPE' }],
    });
    expect(r.issues.map((i) => i.title)).toEqual(['Routings without operations', 'Machine not found', 'Products pointing at a missing routing']);
    expect(r.issues[1].items).toEqual(['RT-RF100 op 70: WC-GONE']);
    expect(r.warnings.map((w) => w.title)).toEqual(['Labor minutes without a labor type', 'Routings no product uses']);
    expect(r.cleanRoutings).toBe(0);
  });
});
