// Plain-English labels for the cost roll-up warning codes (app/utils/cost_rollup.py)
// and the screen where each one is fixed.
export const COST_WARNING_LABELS = {
  missing_bom: 'No BOM assigned',
  missing_router: 'No routing assigned',
  router_missing_machine: 'Routing references an unknown machine',
  router_missing_labor_rate: 'Routing references an unknown labor rate',
  router_labor_without_type: 'Routing step has labor minutes but no labor type',
};

export const COST_WARNING_ACTIONS = {
  missing_bom: { path: '/bom', label: 'Open BOM Management' },
  missing_router: { path: '/routing', label: 'Open Work Routing' },
  router_missing_machine: { path: '/machines', label: 'Open Machine Management' },
  router_missing_labor_rate: { path: '/labor-rates', label: 'Open Labor Rates' },
  router_labor_without_type: { path: '/routing', label: 'Open Work Routing' },
};
