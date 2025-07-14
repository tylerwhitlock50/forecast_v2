import React, { createContext, useContext, useReducer, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-hot-toast';

const API_BASE = 'http://localhost:8000';

// Initial state
const initialState = {
  scenarios: {
    base: { id: 'base', name: 'Base Case', isActive: true, data: {} },
    best: { id: 'best', name: 'Best Case', isActive: false, data: {} },
    worst: { id: 'worst', name: 'Worst Case', isActive: false, data: {} }
  },
  activeScenario: 'base',
  data: {
    products: [],
    customers: [],
    forecasts: [],
    bom: [],
    routing: [],
    machines: [],
    employees: [],
    departments: [],
    payroll: [],
    expenses: [],
    loans: [],
    validation: {
      errors: [],
      warnings: [],
      completeness: {}
    }
  },
  loading: false,
  error: null,
  lastUpdated: null
};

// Action types
const actionTypes = {
  SET_LOADING: 'SET_LOADING',
  SET_ERROR: 'SET_ERROR',
  SET_DATA: 'SET_DATA',
  UPDATE_DATA: 'UPDATE_DATA',
  SWITCH_SCENARIO: 'SWITCH_SCENARIO',
  UPDATE_SCENARIO: 'UPDATE_SCENARIO',
  ADD_VALIDATION_ERROR: 'ADD_VALIDATION_ERROR',
  CLEAR_VALIDATION: 'CLEAR_VALIDATION',
  SET_LAST_UPDATED: 'SET_LAST_UPDATED'
};

// Reducer
const forecastReducer = (state, action) => {
  switch (action.type) {
    case actionTypes.SET_LOADING:
      return { ...state, loading: action.payload };
    
    case actionTypes.SET_ERROR:
      return { ...state, error: action.payload, loading: false };
    
    case actionTypes.SET_DATA:
      return { 
        ...state, 
        data: { ...state.data, ...action.payload },
        loading: false,
        error: null,
        lastUpdated: new Date()
      };
    
    case actionTypes.UPDATE_DATA:
      return {
        ...state,
        data: {
          ...state.data,
          [action.payload.type]: action.payload.data
        },
        lastUpdated: new Date()
      };
    
    case actionTypes.SWITCH_SCENARIO:
      return {
        ...state,
        activeScenario: action.payload,
        scenarios: {
          ...state.scenarios,
          [state.activeScenario]: {
            ...state.scenarios[state.activeScenario],
            isActive: false
          },
          [action.payload]: {
            ...state.scenarios[action.payload],
            isActive: true
          }
        }
      };
    
    case actionTypes.UPDATE_SCENARIO:
      return {
        ...state,
        scenarios: {
          ...state.scenarios,
          [action.payload.id]: {
            ...state.scenarios[action.payload.id],
            ...action.payload.data
          }
        }
      };
    
    case actionTypes.ADD_VALIDATION_ERROR:
      return {
        ...state,
        data: {
          ...state.data,
          validation: {
            ...state.data.validation,
            errors: [...state.data.validation.errors, action.payload]
          }
        }
      };
    
    case actionTypes.CLEAR_VALIDATION:
      return {
        ...state,
        data: {
          ...state.data,
          validation: {
            errors: [],
            warnings: [],
            completeness: {}
          }
        }
      };
    
    case actionTypes.SET_LAST_UPDATED:
      return { ...state, lastUpdated: new Date() };
    
    default:
      return state;
  }
};

// Context
const ForecastContext = createContext();

// Provider component
export const ForecastProvider = ({ children }) => {
  const [state, dispatch] = useReducer(forecastReducer, initialState);

  // Actions
  const actions = {
    setLoading: (loading) => dispatch({ type: actionTypes.SET_LOADING, payload: loading }),
    
    setError: (error) => dispatch({ type: actionTypes.SET_ERROR, payload: error }),
    
    setData: (data) => dispatch({ type: actionTypes.SET_DATA, payload: data }),
    
    updateData: (type, data) => dispatch({ type: actionTypes.UPDATE_DATA, payload: { type, data } }),
    
    switchScenario: (scenarioId) => dispatch({ type: actionTypes.SWITCH_SCENARIO, payload: scenarioId }),
    
    updateScenario: (id, data) => dispatch({ type: actionTypes.UPDATE_SCENARIO, payload: { id, data } }),
    
    addValidationError: (error) => dispatch({ type: actionTypes.ADD_VALIDATION_ERROR, payload: error }),
    
    clearValidation: () => dispatch({ type: actionTypes.CLEAR_VALIDATION }),

    // API calls
    fetchAllData: async () => {
      try {
        actions.setLoading(true);
        const [
          forecastRes,
          productsRes,
          customersRes,
          machinesRes,
          employeesRes
        ] = await Promise.all([
          axios.get(`${API_BASE}/forecast`),
          axios.get(`${API_BASE}/products`),
          axios.get(`${API_BASE}/customers`),
          axios.get(`${API_BASE}/machines`),
          axios.get(`${API_BASE}/employees`)
        ]);

        const data = {
          forecasts: forecastRes.data.status === 'success' ? forecastRes.data.data.sales_forecast || [] : [],
          products: productsRes.data.status === 'success' ? productsRes.data.data || [] : [],
          customers: customersRes.data.status === 'success' ? customersRes.data.data || [] : [],
          machines: machinesRes.data.status === 'success' ? machinesRes.data.data || [] : [],
          employees: employeesRes.data.status === 'success' ? employeesRes.data.data || [] : []
        };

        actions.setData(data);
        toast.success('Data loaded successfully');
      } catch (error) {
        console.error('Error fetching data:', error);
        actions.setError('Failed to load data');
        toast.error('Failed to load data');
      }
    },

    saveForecast: async (forecastData) => {
      try {
        actions.setLoading(true);
        const response = await axios.post(`${API_BASE}/forecast`, forecastData);
        if (response.data.status === 'success') {
          toast.success('Forecast saved successfully');
          actions.fetchAllData(); // Refresh data
        }
      } catch (error) {
        console.error('Error saving forecast:', error);
        actions.setError('Failed to save forecast');
        toast.error('Failed to save forecast');
      }
    },

    updateForecast: async (id, forecastData) => {
      try {
        actions.setLoading(true);
        const response = await axios.put(`${API_BASE}/forecast/${id}`, forecastData);
        if (response.data.status === 'success') {
          toast.success('Forecast updated successfully');
          actions.fetchAllData(); // Refresh data
        }
      } catch (error) {
        console.error('Error updating forecast:', error);
        actions.setError('Failed to update forecast');
        toast.error('Failed to update forecast');
      }
    },

    deleteForecast: async (id) => {
      try {
        actions.setLoading(true);
        const response = await axios.delete(`${API_BASE}/forecast/${id}`);
        if (response.data.status === 'success') {
          toast.success('Forecast deleted successfully');
          actions.fetchAllData(); // Refresh data
        }
      } catch (error) {
        console.error('Error deleting forecast:', error);
        actions.setError('Failed to delete forecast');
        toast.error('Failed to delete forecast');
      }
    },

    validateData: () => {
      actions.clearValidation();
      const errors = [];
      
      // Validate forecasts
      state.data.forecasts.forEach((forecast, index) => {
        if (!forecast.customer_id) {
          errors.push({ type: 'forecast', index, field: 'customer_id', message: 'Customer is required' });
        }
        if (!forecast.product_id) {
          errors.push({ type: 'forecast', index, field: 'product_id', message: 'Product is required' });
        }
        if (!forecast.quantity || forecast.quantity <= 0) {
          errors.push({ type: 'forecast', index, field: 'quantity', message: 'Quantity must be positive' });
        }
        if (!forecast.price || forecast.price <= 0) {
          errors.push({ type: 'forecast', index, field: 'price', message: 'Price must be positive' });
        }
      });

      errors.forEach(error => actions.addValidationError(error));
      return errors.length === 0;
    }
  };

  // Load data on mount
  useEffect(() => {
    actions.fetchAllData();
  }, []);

  const value = {
    state,
    actions,
    scenarios: state.scenarios,
    activeScenario: state.activeScenario,
    data: state.data,
    loading: state.loading,
    error: state.error,
    lastUpdated: state.lastUpdated
  };

  return (
    <ForecastContext.Provider value={value}>
      {children}
    </ForecastContext.Provider>
  );
};

// Custom hook
export const useForecast = () => {
  const context = useContext(ForecastContext);
  if (!context) {
    throw new Error('useForecast must be used within a ForecastProvider');
  }
  return context;
};

export default ForecastContext;