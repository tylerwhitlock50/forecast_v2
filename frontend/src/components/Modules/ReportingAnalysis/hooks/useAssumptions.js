import { useState, useCallback } from 'react';
import api from '../../../../lib/apiClient';

/**
 * Balance-sheet assumptions and capital expenditures for one forecast
 * (GET/PUT /reporting/assumptions, CRUD on /reporting/capex).
 */
export const useAssumptions = () => {
  const [assumptions, setAssumptions] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [capex, setCapex] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const loadAssumptions = useCallback(async (forecastId) => {
    if (!forecastId) {
      setAssumptions(null);
      setDefaults(null);
      return null;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(
        `/reporting/assumptions?forecast_id=${encodeURIComponent(forecastId)}`,
        { suppressErrorToast: true }
      );
      setAssumptions(res?.data?.assumptions || null);
      setDefaults(res?.data?.defaults || null);
      return res?.data || null;
    } catch (err) {
      console.error('Error loading assumptions:', err);
      setError(err.userMessage || err.message || 'Failed to load assumptions');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const saveAssumptions = useCallback(async (forecastId, values) => {
    setSaving(true);
    setError(null);
    try {
      // No client toast: the panel shows the reason inline, as the one message.
      const res = await api.put(
        `/reporting/assumptions?forecast_id=${encodeURIComponent(forecastId)}`,
        values,
        { suppressErrorToast: true }
      );
      if (res?.data?.assumptions) setAssumptions(res.data.assumptions);
      else setAssumptions({ ...values, forecast_id: forecastId, found: true });
      return true;
    } catch (err) {
      console.error('Error saving assumptions:', err);
      setError(err.userMessage || err.message || 'Failed to save assumptions');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const loadCapex = useCallback(async (forecastId) => {
    if (!forecastId) {
      setCapex([]);
      return [];
    }
    try {
      const res = await api.get(
        `/reporting/capex?forecast_id=${encodeURIComponent(forecastId)}`,
        { suppressErrorToast: true }
      );
      const items = res?.data?.capex || [];
      setCapex(items);
      return items;
    } catch (err) {
      console.error('Error loading capital expenditures:', err);
      setError(err.userMessage || err.message || 'Failed to load capital expenditures');
      return [];
    }
  }, []);

  const createCapex = useCallback(async (body) => {
    await api.post('/reporting/capex', body);
    return true;
  }, []);

  const updateCapex = useCallback(async (capexId, body) => {
    await api.put(`/reporting/capex/${encodeURIComponent(capexId)}`, body);
    return true;
  }, []);

  const deleteCapex = useCallback(async (capexId) => {
    await api.delete(`/reporting/capex/${encodeURIComponent(capexId)}`);
    return true;
  }, []);

  return {
    assumptions,
    defaults,
    capex,
    loading,
    saving,
    error,
    loadAssumptions,
    saveAssumptions,
    loadCapex,
    createCapex,
    updateCapex,
    deleteCapex
  };
};

export default useAssumptions;
