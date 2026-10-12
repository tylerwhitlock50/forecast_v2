import { useState, useCallback } from 'react';
import api from '../../../../lib/apiClient';
import { toast } from 'react-hot-toast';

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

  const fetchComparison = useCallback(async (forecastIds, period = null) => {
    if (!forecastIds || forecastIds.length === 0) {
      setData([]);
      setWindow(null);
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
      setData(res.data?.comparison || []);
      setWindow(res.data?.window || null);
    } catch (err) {
      console.error('Error fetching comparison data:', err);
      setError(err.userMessage || err.message || 'Failed to fetch comparison data');
      toast.error('Failed to load comparison data');
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, window: sharedWindow, loading, error, fetchComparison };
};
