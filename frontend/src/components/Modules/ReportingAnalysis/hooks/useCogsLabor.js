import { useState, useCallback, useRef } from 'react';
import { toast } from 'react-hot-toast';
import api, { apiClient } from '../../../../lib/apiClient';
import { buildStatementsQuery } from './useReporting';
import { downloadBlob, filenameFromDisposition, slug } from '../utils/csv';

export const DEFAULT_HOURS_PER_FTE = 173.33;

/**
 * GET one reporting endpoint for (scenarios, window[, extra params]) and keep
 * only the newest response, so quickly changing the window never shows a
 * stale report.
 */
const useReportEndpoint = (path, label) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestId = useRef(0);

  const load = useCallback(async (forecastIds, period, extra = {}) => {
    if (!forecastIds || forecastIds.length === 0 || !period?.start || !period?.end) {
      setData(null);
      return null;
    }
    const thisRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`${path}?${buildStatementsQuery(forecastIds, period, extra)}`, { suppressErrorToast: true, timeout: 120000 });
      if (thisRequest !== requestId.current) return null;
      setData(res?.data || null);
      return res?.data || null;
    } catch (err) {
      if (thisRequest !== requestId.current) return null;
      console.error(`Error loading ${label}:`, err);
      const detail = err?.response?.data?.detail;
      setError((typeof detail === 'string' && detail) || err.userMessage || err.message || `Failed to load the ${label}`);
      setData(null);
      return null;
    } finally {
      if (thisRequest === requestId.current) setLoading(false);
    }
  }, [path, label]);

  return { data, loading, error, load };
};

/** COGS forecast: GET /reporting/cogs-forecast */
export const useCogsForecast = () => useReportEndpoint('/reporting/cogs-forecast', 'COGS forecast');

/** Labor forecast: GET /reporting/labor-forecast (hours_per_fte as an extra param) */
export const useLaborForecast = () => useReportEndpoint('/reporting/labor-forecast', 'labor forecast');

/** Relative URL of the Excel workbook export. */
export const buildWorkbookUrl = (forecastIds, period) =>
  `/reporting/workbook?${buildStatementsQuery(forecastIds, period)}`;

/** Read an error message out of a Blob error body (the API answers errors with JSON). */
const blobErrorMessage = async (err) => {
  const blob = err?.response?.data;
  if (blob && typeof blob.text === 'function') {
    try {
      const body = JSON.parse(await blob.text());
      return body.detail || body.message || null;
    } catch {
      return null;
    }
  }
  return null;
};

/**
 * Download the Excel workbook for the scenarios and window. Fetches it as a
 * Blob (so a server error becomes a readable toast instead of a broken file)
 * and saves it under the server's file name.
 */
export const downloadWorkbook = async (forecastIds, period, scenarioName = '') => {
  try {
    const res = await apiClient.get(buildWorkbookUrl(forecastIds, period), { responseType: 'blob', timeout: 180000 });
    const name = filenameFromDisposition(res.headers?.['content-disposition'])
      || `forecast_${slug(scenarioName || forecastIds.join('_'))}_${period.start}_${period.end}.xlsx`;
    downloadBlob(res.data, name);
    toast.success(`Downloaded ${name}`);
    return true;
  } catch (err) {
    const message = (await blobErrorMessage(err)) || err.userMessage || err.message || 'Export failed';
    toast.error(`Excel export failed: ${message}`);
    return false;
  }
};
