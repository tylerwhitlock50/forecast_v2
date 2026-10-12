// How each screen relates to the active scenario. Shown in the scenario bar
// so it is always clear whether what you are editing is scenario-specific,
// company-wide, or a mix. Must match the backend scoping rules:
// sales rows always belong to one scenario; payroll / expenses / capex rows
// with a NULL forecast_id are company-wide and included in every scenario.
export const SCOPE_KINDS = {
  scenario: {
    label: 'Scenario-specific',
    tone: 'bg-orange-100 text-orange-800 border-orange-200',
    help: 'Rows on this screen belong only to the active scenario.',
  },
  mixed: {
    label: 'Company-wide + this scenario',
    tone: 'bg-blue-100 text-blue-800 border-blue-200',
    help: 'Shows company-wide rows plus rows pinned to the active scenario, exactly as the statements use them.',
  },
  company: {
    label: 'Company-wide',
    tone: 'bg-gray-100 text-gray-700 border-gray-200',
    help: 'Shared by every scenario. Changing it changes all scenarios.',
  },
  // Master data shared by every scenario, figures computed from the active
  // scenario's sales (Cost Management, product detail).
  sales: {
    label: "Uses this scenario's sales",
    tone: 'bg-amber-50 text-amber-800 border-amber-200',
    help: "Products, BOMs, routings and rates are shared by every scenario; the quantities and costs shown come from the active scenario's sales forecast.",
  },
  selection: {
    label: 'Follows the active scenario',
    tone: 'bg-gray-100 text-gray-700 border-gray-200',
    help: 'Reports follow the active scenario unless you pick several scenarios on the page to consolidate or compare them.',
  },
};

const ROUTE_SCOPES = [
  { test: (p) => p.startsWith('/scenarios'), kind: null },
  { test: (p) => p.startsWith('/sales-forecast'), kind: 'scenario' },
  { test: (p) => p.startsWith('/pricing') || p.startsWith('/import'), kind: 'mixed' },
  { test: (p) => p.startsWith('/payroll') || p.startsWith('/expenses'), kind: 'mixed' },
  { test: (p) => p.startsWith('/cost-management') || /^\/products\/[^/]+/.test(p), kind: 'sales' },
  { test: (p) => p.startsWith('/reporting'), kind: 'selection' },
];

export const scopeForPath = (pathname) => {
  const match = ROUTE_SCOPES.find(r => r.test(pathname || ''));
  if (match) return match.kind ? SCOPE_KINDS[match.kind] : null;
  return SCOPE_KINDS.company;
};
