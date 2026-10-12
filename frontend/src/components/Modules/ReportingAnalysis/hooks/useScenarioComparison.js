import { useState, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import api, { extractErrorMessage } from '../../../../lib/apiClient';
import { toast } from 'react-hot-toast';
import ForecastContext from '../../../../context/ForecastContext';

/**
 * The ids that are still scenarios: `ids` without the ones missing from
 * `scenarios` (the context's id -> scenario map), duplicates and blanks
 * dropped, order kept. While the scenario list is not loaded (empty or
 * missing) the ids are kept as they are.
 */
export const knownScenarioIds = (ids, scenarios) => {
  const list = [];
  (ids || []).forEach((id) => {
    const value = id === null || id === undefined ? '' : String(id).trim();
    if (value && !list.includes(value)) list.push(value);
  });
  const known = scenarios && typeof scenarios === 'object' ? Object.keys(scenarios) : [];
  if (known.length === 0) return list;
  return list.filter((id) => known.includes(id));
};

/** What to show when GET /forecast/comparison fails: the API's own detail (a 404 names the unknown ids). */
export const comparisonErrorMessage = (err) => {
  const detail = extractErrorMessage(err, 'Failed to fetch comparison data');
  if (err?.response?.status === 404) {
    return `${detail.replace(/\.$/, '')}. The scenario may have been deleted: pick another scenario to compare.`;
  }
  return detail;
};

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
 *
 * Ids that are no longer in the scenario list (a scenario deleted since it
 * was selected) are dropped before the request, and their rows are dropped
 * from `data`; if the API still answers 404 its detail is shown.
 */
export const useScenarioComparison = () => {
  const [data, setData] = useState([]);
  const [sharedWindow, setWindow] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const latest = useRef(0);
  // Outside a ForecastProvider (tests) there is no list to check against.
  const scenarios = useContext(ForecastContext)?.scenarios || null;
  const scenariosRef = useRef(scenarios);
  useEffect(() => { scenariosRef.current = scenarios; }, [scenarios]);

  const fetchComparison = useCallback(async (requestedIds, period = null) => {
    const request = ++latest.current;
    const forecastIds = knownScenarioIds(requestedIds, scenariosRef.current);
    if (forecastIds.length === 0) {
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
      const message = comparisonErrorMessage(err);
      setData([]);
      setError(message);
      toast.error(`Could not load the comparison: ${message}`, { id: `comparison:${message}` });
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, []);

  // A scenario deleted after the comparison loaded drops out of the table too.
  const visible = useMemo(() => {
    const known = scenarios && typeof scenarios === 'object' ? Object.keys(scenarios) : [];
    if (known.length === 0) return data;
    return data.filter((row) => known.includes(row.forecast_id));
  }, [data, scenarios]);

  return { data: visible, window: sharedWindow, loading, error, fetchComparison };
};
