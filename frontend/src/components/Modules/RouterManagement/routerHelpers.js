// Pure helpers for the Routing screen (tested in routerHelpers.test.js).

/** Next free id in the R0001 style (ids in other styles are ignored). */
export const nextRouterId = (routers = []) => {
  const taken = new Set(routers.map(r => r.router_id));
  let n = Math.max(
    0,
    ...routers.map(r => {
      const m = /^R(\d+)$/.exec(String(r.router_id || ''));
      return m ? parseInt(m[1], 10) : 0;
    })
  ) + 1;
  while (taken.has(`R${String(n).padStart(4, '0')}`)) n += 1;
  return `R${String(n).padStart(4, '0')}`;
};

export const operationsOf = (operations = [], routerId) =>
  operations
    .filter(op => op.router_id === routerId)
    .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

/** Rows for POST /import/routings that copy a routing and its operations to a new id. */
export const cloneRoutingRows = (operations, source, newRouterId) =>
  operationsOf(operations, source?.router_id).map(op => ({
    router_id: newRouterId,
    router_name: `${source.router_name || source.router_id} (copy)`,
    router_description: source.router_description || '',
    version: source.version || '1.0',
    sequence: op.sequence,
    machine_id: op.machine_id,
    machine_minutes: op.machine_minutes,
    labor_minutes: op.labor_minutes,
    labor_type_id: op.labor_type_id,
    operation_description: op.operation_description,
  }));

/** What deleting a routing removes: its operations, and the products that get unlinked. */
export const routerDeleteImpact = (routerId, operations = [], products = []) => {
  const ops = operationsOf(operations, routerId);
  const users = products.filter(p => (p.router ?? p.router_id) === routerId);
  return {
    operationCount: ops.length,
    sequences: ops.map(op => op.sequence),
    products: users.map(p => p.unit_name || p.unit_id).filter(Boolean),
  };
};

const blank = (value) => value === null || value === undefined || String(value).trim() === '';
const listOf = (value) => (Array.isArray(value) ? value : []);
const opLabel = (op) => `${op.router_id} op ${op.sequence ?? '?'}${op.operation_description ? ` (${op.operation_description})` : ''}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Data checks for the Routings screen. Routing headers (router_definitions)
 * and their operations (router_operations) are checked separately: a header
 * has no machine or sequence of its own, so it is never reported for
 * missing them. Products link to a routing through their `router` (or
 * router_id) field. Errors change or zero a product's labor / machine cost;
 * warnings point at operations that cost less than they probably should.
 *
 * Returns {issues, warnings, routings, operations, cleanRoutings}; each
 * issue / warning is {type, title, description, items, severity}.
 */
export const validateRoutings = ({ routers = [], operations = [], machines = [], products = [], laborRates = [] } = {}) => {
  const headers = listOf(routers);
  const ops = listOf(operations);
  const machineById = new Map(listOf(machines).map((m) => [m.machine_id, m]));
  const rateById = new Map(listOf(laborRates).map((r) => [r.rate_id, r]));
  const routerIds = new Set(headers.map((r) => r.router_id));
  const productRouter = (p) => p?.router ?? p?.router_id ?? null;
  const usersOf = (routerId) => listOf(products).filter((p) => productRouter(p) === routerId);

  const issues = [];
  const warnings = [];
  const problemRoutings = new Set();
  const add = (list, entry, routerIdsHit) => {
    if (!entry.items.length) return;
    routerIdsHit.forEach((id) => problemRoutings.add(id));
    list.push(entry);
  };

  // Errors -------------------------------------------------------------
  const empty = headers.filter((r) => !ops.some((op) => op.router_id === r.router_id));
  add(issues, {
    type: 'error',
    title: 'Routings without operations',
    description: `${plural(empty.length, 'routing has', 'routings have')} no operations, so products using ${empty.length === 1 ? 'it' : 'them'} get $0 labor and machine cost`,
    items: empty.map((r) => {
      const users = usersOf(r.router_id).map((p) => p.unit_id);
      return `${r.router_id}${r.router_name ? ` (${r.router_name})` : ''}${users.length ? ` · used by ${users.join(', ')}` : ''}`;
    }),
    severity: 'high',
  }, empty.map((r) => r.router_id));

  const orphans = ops.filter((op) => !routerIds.has(op.router_id));
  add(issues, {
    type: 'error',
    title: 'Operations of a routing that does not exist',
    description: `${plural(orphans.length, 'operation belongs', 'operations belong')} to a routing id with no routing`,
    items: orphans.map(opLabel),
    severity: 'high',
  }, orphans.map((op) => op.router_id));

  const unknownMachine = ops.filter((op) => !blank(op.machine_id) && !machineById.has(op.machine_id));
  add(issues, {
    type: 'error',
    title: 'Machine not found',
    description: `${plural(unknownMachine.length, 'operation uses a machine', 'operations use machines')} that ${unknownMachine.length === 1 ? 'is' : 'are'} not set up, so machine time is not costed`,
    items: unknownMachine.map((op) => `${opLabel(op)}: ${op.machine_id}`),
    severity: 'high',
  }, unknownMachine.map((op) => op.router_id));

  const unknownRate = ops.filter((op) => !blank(op.labor_type_id) && !rateById.has(op.labor_type_id));
  add(issues, {
    type: 'error',
    title: 'Labor type not found',
    description: `${plural(unknownRate.length, 'operation uses a labor type', 'operations use labor types')} with no labor rate, so labor time is not costed`,
    items: unknownRate.map((op) => `${opLabel(op)}: ${op.labor_type_id}`),
    severity: 'high',
  }, unknownRate.map((op) => op.router_id));

  const negative = ops.filter((op) => Number(op.machine_minutes) < 0 || Number(op.labor_minutes) < 0);
  add(issues, {
    type: 'error',
    title: 'Negative minutes',
    description: `${plural(negative.length, 'operation has', 'operations have')} negative machine or labor minutes`,
    items: negative.map(opLabel),
    severity: 'high',
  }, negative.map((op) => op.router_id));

  const missingRouting = listOf(products).filter((p) => !blank(productRouter(p)) && !routerIds.has(productRouter(p)));
  add(issues, {
    type: 'error',
    title: 'Products pointing at a missing routing',
    description: `${plural(missingRouting.length, 'product points', 'products point')} at a routing that does not exist, so ${missingRouting.length === 1 ? 'it gets' : 'they get'} $0 labor and machine cost`,
    items: missingRouting.map((p) => `${p.unit_id}${p.unit_name ? ` (${p.unit_name})` : ''}: ${productRouter(p)}`),
    severity: 'high',
  }, []);

  // Warnings -----------------------------------------------------------
  const laborNoType = ops.filter((op) => Number(op.labor_minutes) > 0 && blank(op.labor_type_id));
  add(warnings, {
    type: 'warning',
    title: 'Labor minutes without a labor type',
    description: `${plural(laborNoType.length, 'operation has', 'operations have')} labor minutes but no labor type, so the labor is not costed`,
    items: laborNoType.map((op) => `${opLabel(op)}: ${op.labor_minutes} min`),
    severity: 'medium',
  }, laborNoType.map((op) => op.router_id));

  const noTime = ops.filter((op) => !(Number(op.machine_minutes) > 0) && !(Number(op.labor_minutes) > 0));
  add(warnings, {
    type: 'warning',
    title: 'Operations with no time',
    description: `${plural(noTime.length, 'operation has', 'operations have')} neither machine nor labor minutes, so ${noTime.length === 1 ? 'it adds' : 'they add'} no cost`,
    items: noTime.map(opLabel),
    severity: 'medium',
  }, noTime.map((op) => op.router_id));

  const freeMachine = ops.filter((op) => {
    const machine = machineById.get(op.machine_id);
    return machine && Number(op.machine_minutes) > 0 && !(Number(machine.machine_rate) > 0);
  });
  add(warnings, {
    type: 'warning',
    title: 'Machine without an hourly rate',
    description: `${plural(freeMachine.length, 'operation runs', 'operations run')} on a machine with no hourly rate, so machine time costs $0`,
    items: freeMachine.map((op) => `${opLabel(op)}: ${op.machine_id}`),
    severity: 'medium',
  }, freeMachine.map((op) => op.router_id));

  const freeLabor = ops.filter((op) => {
    const rate = rateById.get(op.labor_type_id);
    return rate && Number(op.labor_minutes) > 0 && !(Number(rate.rate_amount) > 0);
  });
  add(warnings, {
    type: 'warning',
    title: 'Labor type without an hourly rate',
    description: `${plural(freeLabor.length, 'operation uses', 'operations use')} a labor type with no hourly rate, so labor costs $0`,
    items: freeLabor.map((op) => `${opLabel(op)}: ${op.labor_type_id}`),
    severity: 'medium',
  }, freeLabor.map((op) => op.router_id));

  const duplicateSeq = [];
  headers.forEach((r) => {
    const seen = new Set();
    operationsOf(ops, r.router_id).forEach((op) => {
      if (op.sequence === null || op.sequence === undefined) return;
      if (seen.has(op.sequence)) duplicateSeq.push(op);
      seen.add(op.sequence);
    });
  });
  add(warnings, {
    type: 'warning',
    title: 'Repeated operation numbers',
    description: `${plural(duplicateSeq.length, 'operation number is', 'operation numbers are')} used twice in the same routing`,
    items: duplicateSeq.map(opLabel),
    severity: 'low',
  }, duplicateSeq.map((op) => op.router_id));

  const unused = headers.filter((r) => usersOf(r.router_id).length === 0);
  add(warnings, {
    type: 'warning',
    title: 'Routings no product uses',
    description: `${plural(unused.length, 'routing is', 'routings are')} not linked to a product, so ${unused.length === 1 ? 'it does' : 'they do'} not reach COGS`,
    items: unused.map((r) => `${r.router_id}${r.router_name ? ` (${r.router_name})` : ''}`),
    severity: 'low',
  }, []);

  return {
    issues,
    warnings,
    routings: headers.length,
    operations: ops.length,
    cleanRoutings: headers.filter((r) => !problemRoutings.has(r.router_id)).length,
  };
};
