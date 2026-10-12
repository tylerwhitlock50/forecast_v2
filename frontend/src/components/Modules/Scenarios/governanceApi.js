// API calls for approvals, the change history and the legacy data checks.
import api from '../../../lib/apiClient';

const quiet = { suppressErrorToast: true, suppressSuccessToast: true };
const path = (id) => `/forecast/scenario/${encodeURIComponent(id)}`;

/** POST /forecast/scenario/{id}/approve -> the scenario with `approval`. Rejects with the API error. */
export const approveScenario = async (id, { approved_by: approvedBy, note }) => {
  const res = await api.post(`${path(id)}/approve`, { approved_by: approvedBy, note }, { ...quiet, timeout: 120000 });
  return res?.data;
};

/** POST /forecast/scenario/{id}/unlock -> the scenario with `unlock`. */
export const unlockScenario = async (id, { reason, actor }) => {
  const res = await api.post(`${path(id)}/unlock`, { reason, actor }, quiet);
  return res?.data;
};

/** GET /forecast/scenario/{id}/approvals -> entries, newest first. */
export const fetchApprovals = async (id) => {
  const res = await api.get(`${path(id)}/approvals`, quiet);
  return res?.data?.approvals || [];
};

/** GET /audit/log with filters -> {entries, total_count, has_more, clients, ...}. */
export const fetchAuditLog = async (params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') query.set(key, String(value).trim());
  });
  const res = await api.get(`/audit/log${query.toString() ? `?${query}` : ''}`, quiet);
  return res?.data || { entries: [], total_count: 0 };
};

/** GET /audit/legacy-checks -> {issues, counts, skipped, checked_at}. */
export const fetchLegacyChecks = async () => {
  const res = await api.get('/audit/legacy-checks', quiet);
  return res?.data || { issues: [], counts: {}, skipped: [] };
};
