// Product detail helpers for Cost Management.
//
// Every quantity, cost and capacity figure on the screen comes from the
// backend (/products/cost-summary, /products/materials/usage,
// /products/machines/utilization, /products/labor/utilization and
// /reporting/cogs-forecast) so it ties to the statements. Only the static
// BOM / routing listings of the selected product are built here.

const versionOf = (value) => (value === null || value === undefined || value === '' ? '1.0' : String(value));

// BOM lines of ONE BOM version: the version the product is costed with.
export const getBOMDetails = (data, bomId, version = '1.0') => {
  const { bom = [] } = data;
  return bom
    .filter(bomItem => bomItem.bom_id === bomId && versionOf(bomItem.version) === versionOf(version))
    .sort((a, b) => (a.bom_line || 0) - (b.bom_line || 0));
};

// Get routing details for a product
export const getRoutingDetails = (data, routerId) => {
  const { router_operations = [], machines = [], labor_rates = [] } = data;

  const routingOperations = router_operations
    .filter(operation => operation.router_id === routerId)
    .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

  return routingOperations.map(operation => {
    const machine = machines.find(m => m.machine_id === operation.machine_id);
    const laborRate = labor_rates.find(rate => rate.rate_id === operation.labor_type_id);

    return {
      ...operation,
      machine_name: machine ? machine.machine_name : (operation.machine_id || '—'),
      machine_rate: machine ? machine.machine_rate : 0,
      rate_name: laborRate ? laborRate.rate_name : (operation.labor_type_id || '—'),
      rate_amount: laborRate ? laborRate.rate_amount : 0
    };
  });
};
