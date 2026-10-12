import { useState, useCallback, useRef } from 'react';
import api from '../../../../lib/apiClient';

// Query string shared by the statements and export endpoints.
export const buildStatementsQuery = (forecastIds, period, extra = {}) => {
  const params = new URLSearchParams();
  params.set('forecast_ids', (forecastIds || []).join(','));
  params.set('start_period', period.start);
  params.set('end_period', period.end);
  Object.entries(extra).forEach(([key, value]) => {
    if (value !== undefined && value !== null) params.set(key, String(value));
  });
  return params.toString();
};

// Absolute URL (through the /api proxy) for the CSV export; opened directly, not via api.get.
export const buildExportUrl = (forecastIds, period, layout = 'wide') =>
  `/api/reporting/statements/export?${buildStatementsQuery(forecastIds, period, { layout })}`;

/**
 * Loads the server-computed financial statements
 * (GET /reporting/statements) for a set of forecasts and a period window.
 */
export const useReporting = () => {
  const [statements, setStatements] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestId = useRef(0);

  const fetchStatements = useCallback(async (forecastIds, period) => {
    if (!forecastIds || forecastIds.length === 0 || !period?.start || !period?.end) {
      setStatements(null);
      return null;
    }

    const thisRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const query = buildStatementsQuery(forecastIds, period, { include_raises: true });
      const res = await api.get(`/reporting/statements?${query}`, { suppressErrorToast: true });
      if (thisRequest !== requestId.current) return null; // a newer request superseded this one
      setStatements(res?.data || null);
      return res?.data || null;
    } catch (err) {
      if (thisRequest !== requestId.current) return null;
      console.error('Error fetching financial statements:', err);
      setError(err.userMessage || err.message || 'Failed to load financial statements');
      setStatements(null);
      return null;
    } finally {
      if (thisRequest === requestId.current) setLoading(false);
    }
  }, []);

  return { statements, loading, error, fetchStatements };
};

export default useReporting;
