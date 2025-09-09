import { useState, useCallback } from 'react';
import api from '../../../../lib/apiClient';
import { toast } from 'react-hot-toast';

export const useScenarioComparison = () => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchComparison = useCallback(async (forecastIds) => {
    if (!forecastIds || forecastIds.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const query = forecastIds.map(id => `forecast_ids=${id}`).join('&');
      const res = await api.get(`/forecast/comparison?${query}`, { suppressErrorToast: true });
      setData(res.data?.comparison || []);
    } catch (err) {
      console.error('Error fetching comparison data:', err);
      setError(err.message || 'Failed to fetch comparison data');
      toast.error('Failed to load comparison data');
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, fetchComparison };
};
