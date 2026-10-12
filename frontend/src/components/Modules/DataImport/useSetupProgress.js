import { useEffect, useMemo, useState } from 'react';
import api from '../../../lib/apiClient';
import { useForecast } from '../../../context/ForecastContext';
import { setupProgress } from './importSteps';

const listOf = (payload, keys) => {
  const data = payload?.data ?? payload;
  if (Array.isArray(data)) return data;
  const key = keys.find((k) => Array.isArray(data?.[k]));
  return key ? data[key] : [];
};

// Price-list and deduction rule counts for the active scenario (company-wide
// rules + the scenario's own), shared by every screen that shows setup
// progress so the sidebar, the Import data page and the Sales Forecast
// checklist agree. One request per scenario at a time; every subscriber is
// told when the counts change.
const store = {
  key: undefined,
  value: { prices: null, deductions: null },
  seq: 0,
  inflight: null,
  listeners: new Set(),
};

const publish = () => store.listeners.forEach((listener) => listener(store.value));

/**
 * Fetch the counts again (when a screen opens, or with {force: true} after
 * rules changed). Only the latest request's answer is kept.
 */
export const refreshRuleCounts = (forecastId, { force = false } = {}) => {
  const key = forecastId || '';
  if (!force && store.inflight && store.inflight.key === key) return store.inflight.promise;
  store.seq += 1;
  const seq = store.seq;
  const fid = forecastId ? `?forecast_id=${encodeURIComponent(forecastId)}` : '';
  const count = (path, keys) => api.get(path, { suppressErrorToast: true })
    .then((res) => listOf(res, keys).length)
    .catch(() => null);
  const promise = Promise.all([
    count(`/pricing/prices${fid}`, ['prices', 'rules']),
    count(`/pricing/deductions${fid}`, ['rules', 'deductions']),
  ]).then(([prices, deductions]) => {
    if (seq !== store.seq) return store.value;
    store.inflight = null;
    store.key = key;
    store.value = { prices, deductions };
    publish();
    return store.value;
  });
  store.inflight = { key, promise };
  return promise;
};

/** {prices, deductions} for the scenario; refetched when `refreshKey` changes. */
export const useRuleCounts = (forecastId, refreshKey) => {
  const key = forecastId || '';
  const [value, setValue] = useState(() => (store.key === key ? store.value : { prices: null, deductions: null }));
  useEffect(() => {
    const listener = (next) => { if (store.key === key) setValue(next); };
    store.listeners.add(listener);
    if (store.key === key) setValue(store.value);
    refreshRuleCounts(forecastId);
    return () => { store.listeners.delete(listener); };
  }, [forecastId, key, refreshKey]);
  return value;
};

/**
 * Setup progress for the active scenario: the Import data steps in order
 * with their counts (see setupProgress). `refreshKey` refetches the rule
 * counts (for example the current path, so leaving the Pricing screen
 * updates the sidebar).
 */
const useSetupProgress = (refreshKey) => {
  const { data, scenarios, activeScenario, lastUpdated } = useForecast();
  const scenario = activeScenario ? scenarios?.[activeScenario] || null : null;
  const ruleCounts = useRuleCounts(activeScenario, `${refreshKey ?? ''}|${lastUpdated ?? ''}`);
  return useMemo(() => setupProgress({ data, scenario, ruleCounts }), [data, scenario, ruleCounts]);
};

export default useSetupProgress;
