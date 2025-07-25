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

    // Handle different types of errors
    let errorMessage = 'An unexpected error occurred';
    
    if (error.response) {
      // Server responded with error status
      const { status, data } = error.response;
      
      // Use backend error message if available
      if (data?.message) {
        errorMessage = data.message;
      } else {
        switch (status) {
          case 400:
            errorMessage = 'Bad request - please check your input';
            break;
          case 401:
            errorMessage = 'Unauthorized - please log in';
            break;
          case 403:
            errorMessage = 'Forbidden - insufficient permissions';
            break;
          case 404:
            errorMessage = 'Resource not found';
            break;
          case 422:
            errorMessage = 'Validation error - please check your input';
            break;
          case 500:
            errorMessage = 'Server error - please try again later';
            break;
          default:
            errorMessage = `Request failed with status ${status}`;
        }
      }
    } else if (error.request) {
      // Network error
      errorMessage = 'Network error - please check your connection';
    } else {
      // Request setup error
      errorMessage = error.message || 'Request setup error';
    }

    // Attach formatted error message to error object
    error.userMessage = errorMessage;
    
    return Promise.reject(error);
  }
);

// Helper function to handle API responses consistently
const handleResponse = (response) => {
  if (response.data?.status === 'success') {
    return response.data;
  } else if (response.data?.status === 'error') {
    throw new Error(response.data.message || 'API returned error status');
  } else {
    // Handle responses that don't follow the standard format
    return response.data;
  }
};

// Helper function to show success toast
const showSuccessToast = (message) => {
  if (message && message !== 'Success') {
    toast.success(message);
  }
};

// Helper function to show error toast
const showErrorToast = (error) => {
  const message = error.userMessage || error.message || 'Operation failed';
  toast.error(message);
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