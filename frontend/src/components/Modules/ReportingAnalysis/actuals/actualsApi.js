import api from '../../../../lib/apiClient';

/**
 * Actuals API (services/actuals.py on the backend).
 *
 * Import contract: a dry run always answers 200 with the report
 * (`outcome` = what a real import would do). A real import that is refused
 * writes nothing and answers 422 (409 for a closed month) with the same
 * report in `response.data.data` and the explanation in `detail`.
 */

const quiet = { suppressErrorToast: true, suppressSuccessToast: true };

export const errorText = (err, fallback = 'Something went wrong') =>
  err?.userMessage || err?.response?.data?.detail || err?.message || fallback;

/** The import report carried by a refused write (422 / 409), or null. */
export const reportFromError = (err) => {
  const data = err?.response?.data?.data;
  return data && typeof data === 'object' && 'outcome' in data ? data : null;
};

export const importQuery = (options = {}) => {
  const params = new URLSearchParams();
  if (options.dryRun) params.set('dry_run', 'true');
  if (options.allowPartial) params.set('allow_partial', 'true');
  if (options.combineDuplicates) params.set('combine_duplicates', 'true');
  if (options.replaceLines) params.set('replace_lines', 'true');
  const control = String(options.controlTotal ?? '').trim();
  if (control) params.set('control_total', control);
  if (options.note && options.note.trim()) params.set('note', options.note.trim());
  if (options.source && options.source.trim()) params.set('source', options.source.trim());
  const text = params.toString();
  return text ? `?${text}` : '';
};

/**
 * Upload a file for a check (dryRun) or a real import.
 * Resolves to { ok, report, message }: ok is false when the import was refused
 * (the report says why). Rejects only when there is no report (unreadable file, network).
 */
export const uploadActuals = async (file, options = {}) => {
  try {
    const res = await api.upload(`/reporting/actuals/import${importQuery(options)}`, file, quiet);
    const report = res?.data || null;
    return { ok: report?.outcome !== 'rejected', report, message: report?.message || res?.message };
  } catch (err) {
    const report = reportFromError(err);
    if (report) return { ok: false, report, message: report.message || errorText(err) };
    throw err;
  }
};

/**
 * Save JSON entries through the same pipeline (the hand-entry form). Same resolution as uploadActuals.
 * replaceLines: each entry sets its month + line total (amounts stored under other references, e.g.
 * an imported GL-JAN, are replaced; undoing the save puts them back) instead of being added to them.
 */
export const saveActualEntries = async (entries, options = {}) => {
  try {
    const res = await api.post('/reporting/actuals', {
      entries,
      dry_run: !!options.dryRun,
      allow_partial: !!options.allowPartial,
      replace_lines: !!options.replaceLines,
      source: options.source || 'manual',
    }, quiet);
    const report = res?.data || null;
    return { ok: report?.outcome !== 'rejected', report, message: report?.message || res?.message };
  } catch (err) {
    const report = reportFromError(err);
    if (report) return { ok: false, report, message: report.message || errorText(err) };
    throw err;
  }
};

export const fetchBatches = async (limit = 20) => {
  const res = await api.get(`/reporting/actuals/batches?limit=${limit}`, { suppressErrorToast: true });
  return res?.data || { batches: [], total_count: 0 };
};

export const previewUndo = async (batchId) => {
  const res = await api.delete(`/reporting/actuals/batches/${encodeURIComponent(batchId)}?dry_run=true`, quiet);
  return res?.data || null;
};

export const undoBatch = async (batchId) => {
  const res = await api.delete(`/reporting/actuals/batches/${encodeURIComponent(batchId)}`, quiet);
  return res?.data || null;
};

export const fetchPeriods = async (start, end) => {
  const query = start && end ? `?start_period=${start}&end_period=${end}` : '';
  const res = await api.get(`/reporting/actuals/periods${query}`, { suppressErrorToast: true });
  return res?.data || { periods: [], closed_periods: [] };
};

export const closePeriod = async (period, closedBy, note) => {
  const res = await api.post(`/reporting/actuals/periods/${period}/close`, { closed_by: closedBy || null, note: note || null }, quiet);
  return res?.data || null;
};

export const reopenPeriod = async (period, reason, reopenedBy) => {
  const res = await api.post(`/reporting/actuals/periods/${period}/reopen`, { reason, reopened_by: reopenedBy || null }, quiet);
  return res?.data || null;
};

/** '2026-10-12T14:03:00Z' -> local 'Oct 12, 2026, 7:03 AM'; anything unparseable is returned as is. */
export const formatWhen = (value) => {
  if (!value) return '';
  const text = String(value);
  const iso = /Z$|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export const plural = (n, word, many) => `${n} ${n === 1 ? word : (many || `${word}s`)}`;
