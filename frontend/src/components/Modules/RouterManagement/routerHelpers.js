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
