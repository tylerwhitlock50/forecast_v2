import { useState, useCallback, useRef } from 'react';
import api from '../../../../lib/apiClient';
import { toast } from 'react-hot-toast';

// Lines between operating income and net income. When the comparison API
// does not send them, they are read from each scenario's income statement
// over the same window (the same engine, so the column still foots).
export const STATEMENT_LINES = ['interest_expense', 'pre_tax_income', 'income_tax'];

const lacks = (row, key) => row[key] === undefined || row[key] === null;

/**
 * Fill STATEMENT_LINES on comparison rows that lack them from
 * GET /reporting/statements (one call per scenario, same window).
 * Rows whose statements cannot be read are returned unchanged.
 */
export const fillStatementLines = async (rows, window) => {
  const list = rows || [];
  const start = window?.start_period;
  const end = window?.end_period;
  const missing = list.filter(r => STATEMENT_LINES.some(k => lacks(r, k)));
  if (missing.length === 0 || !start || !end) return list;
  const results = await Promise.allSettled(missing.map(r => {
    const params = new URLSearchParams({ forecast_ids: r.forecast_id, start_period: start, end_period: end });
    return api.get(`/reporting/statements?${params.toString()}`, { suppressErrorToast: true });
  }));
  const totalsById = {};
  results.forEach((res, i) => {
    const totals = res.status === 'fulfilled' ? res.value?.data?.income_statement?.totals : null;
    if (totals) totalsById[missing[i].forecast_id] = totals;
  });
  return list.map(r => {
    const t = totalsById[r.forecast_id];
    if (!t) return r;
    const extra = {};
    STATEMENT_LINES.forEach(k => {
      if (lacks(r, k) && typeof t[k] === 'number') extra[k] = t[k];
    });
    return { ...r, ...extra };
  });
};

/**
 * Side-by-side totals for a set of scenarios from GET /forecast/comparison.
 * Every scenario is totalled over the same window; when none is given the
 * server uses the union of the selected scenarios' sales months and
 * reports it back as `window`.
 */
export const useScenarioComparison = () => {
  const [data, setData] = useState([]);
  const [sharedWindow, setWindow] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const latest = useRef(0);

  const fetchComparison = useCallback(async (forecastIds, period = null) => {
    const request = ++latest.current;
    if (!forecastIds || forecastIds.length === 0) {
      setData([]);
      setWindow(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('forecast_ids', forecastIds.join(','));
      if (period?.start && period?.end) {
        params.set('start_period', period.start);
        params.set('end_period', period.end);
      }
      const res = await api.get(`/forecast/comparison?${params.toString()}`, { suppressErrorToast: true });
      const window = res.data?.window
        || (period?.start && period?.end ? { start_period: period.start, end_period: period.end } : null);
      const rows = await fillStatementLines(res.data?.comparison || [], window);
      if (request !== latest.current) return; // a newer selection is already loading
      setData(rows);
      setWindow(res.data?.window || null);
    } catch (err) {
      if (request !== latest.current) return;
      console.error('Error fetching comparison data:', err);
      setError(err.userMessage || err.message || 'Failed to fetch comparison data');
      toast.error('Failed to load comparison data');
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, []);

  return { data, window: sharedWindow, loading, error, fetchComparison };
};
