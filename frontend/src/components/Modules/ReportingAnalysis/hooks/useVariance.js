import { useState, useCallback, useRef } from 'react';
import api from '../../../../lib/apiClient';
import { buildStatementsQuery } from './useReporting';

/**
 * Loads the budget-vs-actual report (GET /reporting/variance).
 */
export const useVariance = () => {
  const [variance, setVariance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestId = useRef(0);

  const fetchVariance = useCallback(async (forecastIds, period) => {
    if (!forecastIds || forecastIds.length === 0 || !period?.start || !period?.end) {
      setVariance(null);
      return null;
    }
    const thisRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const query = buildStatementsQuery(forecastIds, period);
      const res = await api.get(`/reporting/variance?${query}`, { suppressErrorToast: true });
      if (thisRequest !== requestId.current) return null;
      setVariance(res?.data || null);
      return res?.data || null;
    } catch (err) {
      if (thisRequest !== requestId.current) return null;
      console.error('Error fetching variance report:', err);
      setError(err.userMessage || err.message || 'Failed to load variance report');
      setVariance(null);
      return null;
    } finally {
      if (thisRequest === requestId.current) setLoading(false);
    }
  }, []);

  return { variance, loading, error, fetchVariance };
};

export default useVariance;
