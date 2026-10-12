import axios from 'axios';
import { toast } from 'react-hot-toast';

// Use relative path for proxy configuration (both development and production)
const API_BASE = '/api';

// Create axios instance with default configuration
const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 30000, // 30 second timeout
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for logging and potential auth
apiClient.interceptors.request.use(
  (config) => {
    // Add request ID for tracking
    config.metadata = { startTime: Date.now() };
    return config;
  },
  (error) => {
    console.error('Request error:', error);
    return Promise.reject(error);
  }
);

const STATUS_MESSAGES = {
  400: 'Bad request - please check your input',
  401: 'Unauthorized - please log in',
  403: 'Forbidden - insufficient permissions',
  404: 'Not found',
  409: 'Conflict - the record is in use or already exists',
  413: 'The file or request is too large',
  422: 'Validation error - please check your input',
  500: 'The server could not complete the request',
  502: 'The backend is not reachable (502)',
  503: 'The backend is not available (503)',
  504: 'The backend took too long to answer (504)',
};

// FastAPI 422 bodies carry a list of {loc, msg, type}; show "field: message".
const formatValidationItem = (item) => {
  if (item === null || item === undefined) return '';
  if (typeof item === 'string') return item;
  const msg = item.msg || item.message || '';
  const loc = Array.isArray(item.loc)
    ? item.loc.filter(part => !['body', 'query', 'path'].includes(part)).join('.')
    : '';
  return loc ? `${loc}: ${msg}` : String(msg || JSON.stringify(item));
};

const detailText = (detail) => {
  if (detail === null || detail === undefined || detail === '') return '';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const items = detail.map(formatValidationItem).filter(Boolean);
    if (items.length === 0) return '';
    const shown = items.slice(0, 3).join('; ');
    return items.length > 3 ? `${shown} (and ${items.length - 3} more)` : shown;
  }
  if (typeof detail === 'object') {
    return detailText(detail.message || detail.detail || detail.msg || detail.error || '');
  }
  return String(detail);
};

/**
 * The message to show for a failed request: the backend's own explanation
 * (FastAPI `detail` as a string or a validation list, else `message` /
 * `error`), falling back to a description of the HTTP status, a network
 * error or the JS error message.
 */
export const extractErrorMessage = (error, fallback = 'An unexpected error occurred') => {
  if (!error) return fallback;
  if (error.response) {
    const { status, data } = error.response;
    const fromBody = typeof data === 'string'
      ? (data.trim().startsWith('<') ? '' : data.trim().slice(0, 300))
      : detailText(data?.detail) || detailText(data?.message) || detailText(data?.error);
    if (fromBody) return fromBody;
    return STATUS_MESSAGES[status] || `Request failed with status ${status}`;
  }
  if (error.code === 'ECONNABORTED') return 'The request timed out - the backend took too long to answer';
  if (error.request) return 'Network error - the backend is not reachable';
  return error.userMessage || error.message || fallback;
};

/** "Could not save labor rate: <backend reason>" (or just the prefix's reason when it has none). */
export const describeError = (error, action) => {
  const reason = error?.userMessage || extractErrorMessage(error, '');
  if (!action) return reason || 'Operation failed';
  return reason ? `${action}: ${reason}` : action;
};

// Response interceptor for consistent error handling
apiClient.interceptors.response.use(
  (response) => {
    // Log successful requests in development
    if (process.env.NODE_ENV === 'development') {
      const duration = Date.now() - response.config.metadata.startTime;
      console.log(`✅ ${response.config.method?.toUpperCase()} ${response.config.url} (${duration}ms)`);
    }
    return response;
  },
  (error) => {
    // Log error requests
    const duration = error.config?.metadata ? Date.now() - error.config.metadata.startTime : 0;
    console.error(`❌ ${error.config?.method?.toUpperCase()} ${error.config?.url} (${duration}ms)`, error);

    // Attach the formatted message (backend detail first) to the error object
    error.userMessage = extractErrorMessage(error);

    return Promise.reject(error);
  }
);

// Helper function to handle API responses consistently
const handleResponse = (response) => {
  if (response.data?.status === 'success') {
    return response.data;
  } else if (response.data?.status === 'error') {
    const error = new Error(response.data.message || 'API returned error status');
    error.userMessage = error.message;
    throw error;
  } else {
    // Handle responses that don't follow the standard format
    return response.data;
  }
};

// Toasts carry an id derived from their text, so the same message raised
// twice for one action (by the client and by a caller) shows once.
const showSuccessToast = (message) => {
  if (message && message !== 'Success') {
    toast.success(message, { id: `ok:${message}` });
  }
};

// Show an error toast once per error object; callers that toast the same
// error themselves can check `error.toastShown`.
const showErrorToast = (error, action) => {
  if (error?.toastShown) return;
  const message = describeError(error, action);
  // Longer server explanations stay up long enough to read.
  const duration = Math.min(10000, Math.max(4000, message.length * 60));
  toast.error(message, { id: `err:${message}`, duration });
  if (error && typeof error === 'object') error.toastShown = true;
};

// API client class with common methods
class APIClient {
  constructor() {
    this.client = apiClient;
  }

  // GET request
  async get(url, config = {}) {
    try {
      const response = await this.client.get(url, config);
      const data = handleResponse(response);
      return data;
    } catch (error) {
      if (!config.suppressErrorToast) {
        showErrorToast(error);
      }
      throw error;
    }
  }

  // POST request
  async post(url, data = {}, config = {}) {
    try {
      const response = await this.client.post(url, data, config);
      const responseData = handleResponse(response);
      
      if (!config.suppressSuccessToast && responseData.message) {
        showSuccessToast(responseData.message);
      }
      
      return responseData;
    } catch (error) {
      if (!config.suppressErrorToast) {
        showErrorToast(error);
      }
      throw error;
    }
  }

  // PUT request
  async put(url, data = {}, config = {}) {
    try {
      const response = await this.client.put(url, data, config);
      const responseData = handleResponse(response);
      
      if (!config.suppressSuccessToast && responseData.message) {
        showSuccessToast(responseData.message);
      }
      
      return responseData;
    } catch (error) {
      if (!config.suppressErrorToast) {
        showErrorToast(error);
      }
      throw error;
    }
  }

  // DELETE request
  async delete(url, config = {}) {
    try {
      const response = await this.client.delete(url, config);
      const responseData = handleResponse(response);
      
      if (!config.suppressSuccessToast && responseData.message) {
        showSuccessToast(responseData.message);
      }
      
      return responseData;
    } catch (error) {
      if (!config.suppressErrorToast) {
        showErrorToast(error);
      }
      throw error;
    }
  }

  // Batch GET requests
  async batchGet(urls, config = {}) {
    try {
      const promises = urls.map(url => this.client.get(url, { ...config, suppressErrorToast: true }));
      const responses = await Promise.all(promises);
      return responses.map(response => handleResponse(response));
    } catch (error) {
      if (!config.suppressErrorToast) {
        showErrorToast(error);
      }
      throw error;
    }
  }

  // Upload file
  async upload(url, file, config = {}) {
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const response = await this.client.post(url, formData, {
        ...config,
        headers: {
          'Content-Type': 'multipart/form-data',
          ...config.headers,
        },
      });
      
      const responseData = handleResponse(response);
      
      if (!config.suppressSuccessToast && responseData.message) {
        showSuccessToast(responseData.message);
      }
      
      return responseData;
    } catch (error) {
      if (!config.suppressErrorToast) {
        showErrorToast(error);
      }
      throw error;
    }
  }
}

// Create and export singleton instance
const api = new APIClient();

export default api;

// Export the axios instance directly for advanced usage
export { apiClient };

// Export helper functions for custom usage
export { handleResponse, showSuccessToast, showErrorToast };