import React, { createContext, useContext, useReducer, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-hot-toast';

// Use relative path for Docker nginx proxy, fallback to localhost for development
const API_BASE = process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:8000';

// Initial state
const initialState = {
  scenarios: {}, // Will be populated from database
  activeScenario: null,
  data: {
    products: [], // Will be mapped from units
    customers: [],
    forecasts: [], // Will be mapped from sales
    bom: [],
    routing: [], // Will be mapped from routers
    machines: [],
    employees: [], // Will be mapped from payroll
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
          salesRes,
          unitsRes,
          customersRes,
          machinesRes,
          payrollRes,
          bomRes,
          routersRes,
          forecastRes
        ] = await Promise.all([
          axios.get(`${API_BASE}/data/sales`), // Get sales data directly from sales table
          axios.get(`${API_BASE}/data/units`),
          axios.get(`${API_BASE}/data/customers`),
          axios.get(`${API_BASE}/data/machines`),
          axios.get(`${API_BASE}/data/payroll`),
          axios.get(`${API_BASE}/data/bom`),
          axios.get(`${API_BASE}/data/routers`),
          axios.get(`${API_BASE}/data/forecast`) // Get forecast data directly from forecast table
        ]);

        // Map backend data to frontend expected format
        const units = unitsRes.data.status === 'success' ? unitsRes.data.data || [] : [];
        const customers = customersRes.data.status === 'success' ? customersRes.data.data || [] : [];
        const sales = salesRes.data.status === 'success' ? salesRes.data.data || [] : [];
        const machines = machinesRes.data.status === 'success' ? machinesRes.data.data || [] : [];
        const payroll = payrollRes.data.status === 'success' ? payrollRes.data.data || [] : [];
        const bom = bomRes.data.status === 'success' ? bomRes.data.data || [] : [];
        const routers = routersRes.data.status === 'success' ? routersRes.data.data || [] : [];
        const forecast = forecastRes.data.status === 'success' ? forecastRes.data.data || [] : [];

        // Transform units to products format
        const products = units.map(unit => ({
          id: unit.unit_id,
          name: unit.unit_name,
          description: unit.unit_description,
          base_price: unit.base_price,
          unit_type: unit.unit_type,
          bom: unit.bom,
          router: unit.router
        }));

        // Transform sales to forecasts format and normalize period format
        const forecasts = sales.map(sale => ({
          id: sale.sale_id,
          product_id: sale.unit_id, // Map unit_id to product_id
          customer_id: sale.customer_id,
          period: sale.period ? sale.period.substring(0, 7) : sale.period, // Convert 2025-09-01 to 2025-09
          quantity: sale.quantity,
          price: sale.unit_price,
          total_revenue: sale.total_revenue,
          forecast_id: sale.forecast_id
        }));

        // Also normalize the sales data period format for direct use
        const normalizedSales = sales.map(sale => ({
          ...sale,
          period: sale.period ? sale.period.substring(0, 7) : sale.period // Convert 2025-09-01 to 2025-09
        }));

        // Transform payroll to employees format
        const employees = payroll.map(emp => ({
          id: emp.employee_id,
          name: emp.employee_name,
          weekly_hours: emp.weekly_hours,
          hourly_rate: emp.hourly_rate,
          labor_type: emp.labor_type,
          start_date: emp.start_date,
          end_date: emp.end_date
        }));

        // Transform routers to routing format
        const routing = routers.map(router => ({
          id: router.router_id,
          unit_id: router.unit_id,
          machine_id: router.machine_id,
          machine_minutes: router.machine_minutes,
          labor_minutes: router.labor_minutes,
          sequence: router.sequence
        }));

        // Process forecast data for scenarios
        const scenarioMap = {};
        forecast.forEach(scenario => {
          scenarioMap[scenario.forecast_id] = {
            id: scenario.forecast_id,
            name: scenario.name,
            description: scenario.description,
            isActive: false
          };
        });

        // Set first scenario as active if no active scenario
        if (forecast.length > 0 && !state.activeScenario) {
          scenarioMap[forecast[0].forecast_id].isActive = true;
          dispatch({ type: actionTypes.SWITCH_SCENARIO, payload: forecast[0].forecast_id });
        }

        // Store scenarios
        dispatch({ type: actionTypes.UPDATE_DATA, payload: { type: 'scenarios', data: scenarioMap } });
        dispatch({ type: actionTypes.UPDATE_SCENARIO, payload: { scenarios: scenarioMap } });

        const data = {
          products,
          customers,
          sales_forecast: normalizedSales, // Use normalized sales data for components
          forecasts, // Keep transformed forecasts for backward compatibility
          forecast, // Raw forecast table data
          machines,
          employees,
          payroll,
          bom,
          routing
        };

        console.log('Data loaded:', {
          productsCount: products.length,
          customersCount: customers.length,
          salesCount: sales.length,
          forecastsCount: forecasts.length,
          forecastCount: forecast.length,
          sampleSales: sales.slice(0, 2),
          sampleProducts: products.slice(0, 2),
          sampleCustomers: customers.slice(0, 2),
          sampleForecast: forecast.slice(0, 2)
        });

        console.log('Setting data in context:', {
          salesCount: data.sales_forecast?.length || 0,
          productsCount: data.products?.length || 0,
          customersCount: data.customers?.length || 0
        });
        actions.setData(data);
        toast.success('Data loaded successfully');
      } catch (error) {
        console.error('Error fetching data:', error);
        actions.setError('Failed to load data');
        toast.error('Failed to load data');
      }
    },

    fetchScenarios: async () => {
      try {
        console.log('Fetching scenarios...');
        const response = await axios.get(`${API_BASE}/data/forecast`);
        console.log('Forecast response:', response.data);
        
        if (response.data.status === 'success') {
          const scenarios = response.data.data || [];
          console.log('Raw scenarios:', scenarios);
          
          const scenarioMap = {};
          
          scenarios.forEach(scenario => {
            scenarioMap[scenario.forecast_id] = {
              id: scenario.forecast_id,
              name: scenario.name,
              description: scenario.description,
              isActive: false
            };
          });
          
          console.log('Processed scenario map:', scenarioMap);
          
          // Set first scenario as active if no active scenario
          if (scenarios.length > 0 && !state.activeScenario) {
            scenarioMap[scenarios[0].forecast_id].isActive = true;
            dispatch({ type: actionTypes.SWITCH_SCENARIO, payload: scenarios[0].forecast_id });
          }
          
          // Store scenarios in both locations for compatibility
          dispatch({ type: actionTypes.UPDATE_DATA, payload: { type: 'scenarios', data: scenarioMap } });
          dispatch({ type: actionTypes.UPDATE_SCENARIO, payload: { scenarios: scenarioMap } });
          
          console.log('Scenarios loaded successfully');
        }
      } catch (error) {
        console.error('Error fetching scenarios:', error);
        toast.error('Failed to load forecast scenarios');
      }
    },

    createScenario: async (scenarioData) => {
      try {
        const response = await axios.post(`${API_BASE}/forecast/scenario`, scenarioData);
        if (response.data.status === 'success') {
          toast.success('Scenario created successfully');
          await actions.fetchScenarios();
          return response.data.data;
        }
      } catch (error) {
        console.error('Error creating scenario:', error);
        toast.error('Failed to create scenario');
      }
    },

    bulkUpdateForecast: async (salesData) => {
      try {
        actions.setLoading(true);
        // Transform sales data to the format expected by the backend
        const forecasts = salesData.map(sale => ({
          product_id: sale.unit_id, // Map unit_id to product_id for backend
          customer_id: sale.customer_id,
          period: sale.period ? `${sale.period}-01` : sale.period, // Convert 2025-09 back to 2025-09-01 for backend
          quantity: sale.quantity,
          price: sale.unit_price, // Map unit_price to price for backend
          total_revenue: sale.total_revenue,
          forecast_id: sale.forecast_id
        }));
        
        const response = await axios.post(`${API_BASE}/forecast/bulk_update`, { forecasts });
        if (response.data.status === 'success') {
          toast.success(`Updated ${response.data.data.updated_count} forecast records`);
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error bulk updating forecast:', error);
        toast.error('Failed to update forecast');
      }
    },

    updateSalesRecord: async (salesData) => {
      try {
        actions.setLoading(true);
        
        // Transform sales data to the format expected by the backend forecast/bulk_update endpoint
        const forecasts = salesData.map(sale => ({
          product_id: sale.unit_id, // Map unit_id to product_id for backend
          customer_id: sale.customer_id,
          period: sale.period ? `${sale.period}-01` : sale.period, // Convert 2025-09 back to 2025-09-01 for backend
          quantity: sale.quantity,
          price: sale.unit_price, // Map unit_price to price for backend
          total_revenue: sale.total_revenue,
          forecast_id: sale.forecast_id || 'F001' // Default forecast ID
        }));
        
        // Use the existing forecast/bulk_update endpoint
        const response = await axios.post(`${API_BASE}/forecast/bulk_update`, { forecasts });
        if (response.data.status === 'success') {
          toast.success(`Updated ${response.data.data.updated_count} sales records`);
          await actions.fetchAllData(); // Refresh data
        }
      } catch (error) {
        console.error('Error updating sales records:', error);
        toast.error('Failed to update sales records');
        throw error; // Re-throw so the component can handle it
      } finally {
        actions.setLoading(false);
      }
    },

    saveForecast: async (forecastData) => {
      try {
        actions.setLoading(true);
        
        // Transform frontend forecast data to backend sales format
        const salesData = {
          customer_id: forecastData.customer_id,
          unit_id: forecastData.product_id, // Map product_id back to unit_id
          period: forecastData.period,
          quantity: forecastData.quantity,
          unit_price: forecastData.price,
          total_revenue: forecastData.total_revenue,
          forecast_id: forecastData.forecast_id
        };

        const response = await axios.post(`${API_BASE}/forecast/create`, { sales: salesData });
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

    updateForecast: async (updateData) => {
      try {
        actions.setLoading(true);
        
        // Transform the update data to match backend structure
        const backendUpdateData = {
          table: updateData.table === 'forecasts' ? 'sales' : updateData.table,
          id: updateData.id,
          updates: {}
        };

        // Map frontend field names to backend field names
        Object.keys(updateData.updates).forEach(key => {
          if (key === 'product_id') {
            backendUpdateData.updates['unit_id'] = updateData.updates[key];
          } else if (key === 'price') {
            backendUpdateData.updates['unit_price'] = updateData.updates[key];
          } else {
            backendUpdateData.updates[key] = updateData.updates[key];
          }
        });

        const response = await axios.post(`${API_BASE}/forecast/update`, backendUpdateData);
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

    deleteForecast: async (tableName, recordId) => {
      try {
        actions.setLoading(true);
        // Map frontend table names to backend table names
        const backendTableName = tableName === 'forecasts' ? 'sales' : tableName;
        const response = await axios.delete(`${API_BASE}/forecast/delete/${backendTableName}/${recordId}`);
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
      
      // Validate forecasts - ensure forecasts is an array
      const forecasts = Array.isArray(state.data.forecasts) ? state.data.forecasts : [];
      forecasts.forEach((forecast, index) => {
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
    actions.fetchAllData(); // This will also fetch scenarios if needed
  }, []);

  // Load data when active scenario changes
  useEffect(() => {
    // Don't filter by scenario - we want to see all sales data
    // The scenario filtering should be done in the UI components
    actions.fetchAllData();
  }, [state.activeScenario]);

  const value = {
    state,
    actions,
    scenarios: state.scenarios || state.data.scenarios || {},
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