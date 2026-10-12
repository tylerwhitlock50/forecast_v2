// Plain-language labels for the change history (pure functions, tested).

/** Who sent the change: web app, AI assistant (MCP) or a script. */
export const CLIENT_LABELS = {
  web: 'Web app',
  mcp: 'AI assistant (MCP)',
  api: 'Script / API',
};

export const clientLabel = (client) => CLIENT_LABELS[client] || (client ? String(client) : 'Unknown');

/** {label, tone} for an HTTP status: Saved / Refused / Failed. */
export const resultOf = (status) => {
  const code = Number(status) || 0;
  if (code > 0 && code < 400) return { label: 'Saved', tone: 'border-green-200 bg-green-50 text-green-800' };
  if (code === 409) return { label: 'Refused', detail: 'conflict or locked', tone: 'border-amber-200 bg-amber-50 text-amber-900' };
  if (code >= 500) return { label: 'Failed', detail: `error ${code}`, tone: 'border-red-200 bg-red-50 text-red-800' };
  return { label: 'Refused', detail: code ? `error ${code}` : '', tone: 'border-red-200 bg-red-50 text-red-800' };
};

/** 'YYYY-MM-DD' (a local calendar day) -> UTC 'YYYY-MM-DDTHH:MM:SS' at its start, or at its end with `endOfDay`. */
export const localDayToUtc = (day, endOfDay = false) => {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const date = new Date(`${day}T${endOfDay ? '23:59:59' : '00:00:00'}`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 19);
};

/**
 * Query parameters for GET /audit/log from the page filters.
 * `since` (an exact UTC time, e.g. from 'See what changed since approval') wins over the From day.
 */
export const auditQuery = (filters, { limit = 50, offset = 0 } = {}) => {
  const params = { limit, offset };
  if (filters.forecastId) params.forecast_id = filters.forecastId;
  if (filters.client) params.client = filters.client;
  if (filters.status) params.status = filters.status;
  if (filters.text && filters.text.trim()) params.path_contains = filters.text.trim();
  const since = filters.since || localDayToUtc(filters.from);
  if (since) params.since = since;
  const until = localDayToUtc(filters.to, true);
  if (until) params.until = until;
  return params;
};

/** 'POST /forecast/scenario/F001/approve?x=1' for the details line. */
export const requestLine = (entry) => {
  if (!entry) return '';
  const query = entry.query ? `?${entry.query}` : '';
  return `${entry.method || ''} ${entry.path || ''}${query}`.trim();
};

/** Severity badge for a legacy data check. */
export const SEVERITY = {
  error: { label: 'Fix before trusting the numbers', short: 'Error', tone: 'border-red-200 bg-red-50 text-red-800' },
  warning: { label: 'Worth fixing', short: 'Warning', tone: 'border-amber-200 bg-amber-50 text-amber-900' },
  info: { label: 'Good to know', short: 'Note', tone: 'border-gray-200 bg-gray-50 text-gray-700' },
};

/** Where a check's 'Open' button goes, with its label. */
export const LINK_LABELS = {
  '/reporting': 'Open Reporting (Assumptions)',
  '/loans': 'Open Loan Schedules',
  '/bom': 'Open Bill of Materials',
  '/products': 'Open Product Setup',
  '/payroll': 'Open Payroll',
};
