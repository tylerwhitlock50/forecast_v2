import React, { createContext, useContext, useReducer, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'react-hot-toast';

// Use relative path for proxy configuration (both development and production)
const API_BASE = '/api';

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
      if (action.payload.scenarios) {
        // If we're passing a full scenarios object, use it
        return {
          ...state,
          scenarios: action.payload.scenarios
        };
      } else {
        // If we're updating a single scenario
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
      }
    
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
    fetchAllData: async (forecastId = null) => {
      try {
        actions.setLoading(true);
        
        // Use the current active scenario if no forecastId provided
        const activeForecastId = forecastId || state.activeScenario;
        
        const [
          salesRes,
          unitsRes,
          customersRes,
          machinesRes,
          payrollRes,
          bomRes,
          routerDefinitionsRes,
          routerOperationsRes,
          laborRatesRes,
          forecastRes
        ] = await Promise.all([
          // Filter sales by forecast_id if we have an active scenario
          axios.get(`${API_BASE}/data/sales${activeForecastId ? `?forecast_id=${activeForecastId}` : ''}`),
          axios.get(`${API_BASE}/data/units`),
          axios.get(`${API_BASE}/data/customers`),
          axios.get(`${API_BASE}/data/machines`),
          axios.get(`${API_BASE}/data/payroll`),
          axios.get(`${API_BASE}/data/bom`),
          axios.get(`${API_BASE}/data/router_definitions`),
          axios.get(`${API_BASE}/data/router_operations`),
          axios.get(`${API_BASE}/data/labor_rates`),
          axios.get(`${API_BASE}/data/forecast`) // Get forecast data directly from forecast table
        ]);

        // Map backend data to frontend expected format
        const units = unitsRes.data.status === 'success' ? unitsRes.data.data || [] : [];
        const customers = customersRes.data.status === 'success' ? customersRes.data.data || [] : [];
        const sales = salesRes.data.status === 'success' ? salesRes.data.data || [] : [];
        const machines = machinesRes.data.status === 'success' ? machinesRes.data.data || [] : [];
        const payroll = payrollRes.data.status === 'success' ? payrollRes.data.data || [] : [];
        const bom = bomRes.data.status === 'success' ? bomRes.data.data || [] : [];
        console.log('Raw BOM data from API:', bom);
        const router_definitions = routerDefinitionsRes.data.status === 'success' ? routerDefinitionsRes.data.data || [] : [];
        const router_operations = routerOperationsRes.data.status === 'success' ? routerOperationsRes.data.data || [] : [];
        const labor_rates = laborRatesRes.data.status === 'success' ? laborRatesRes.data.data || [] : [];
        const forecast = forecastRes.data.status === 'success' ? forecastRes.data.data || [] : [];

        // Transform units to products format - keep original field names for consistency
        const products = units.map(unit => ({
          unit_id: unit.unit_id,
          unit_name: unit.unit_name,
          unit_description: unit.unit_description,
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

        // Transform router definitions and operations to combined format
        const routers = router_definitions.map(router => {
          const operations = router_operations.filter(op => op.router_id === router.router_id);
          return {
            ...router,
            operations: operations.sort((a, b) => a.sequence - b.sequence)
          };
        });

        // Transform router operations to routing format for backward compatibility
        const routing = router_operations.map(operation => ({
          id: operation.operation_id,
          router_id: operation.router_id,
          machine_id: operation.machine_id,
          machine_minutes: operation.machine_minutes,
          labor_minutes: operation.labor_minutes,
          sequence: operation.sequence,
          labor_type_id: operation.labor_type_id,
          operation_description: operation.operation_description
        }));

        // Process forecast data for scenarios
        const scenarioMap = {};
        forecast.forEach(scenario => {
          scenarioMap[scenario.forecast_id] = {
            id: scenario.forecast_id,
            name: scenario.name || 'Unnamed Scenario',
            description: scenario.description || '',
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
          routers,
          router_definitions,
          router_operations,
          labor_rates,
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
        
        console.log('Sample products data:', products.slice(0, 2));
        console.log('Sample units data:', units.slice(0, 2));

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
              name: scenario.name || 'Unnamed Scenario',
              description: scenario.description || '',
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
          const newScenario = response.data.data;
          toast.success(`Scenario ${newScenario.forecast_id} created successfully`);
          
          // Refresh scenarios and switch to the new one
          await actions.fetchScenarios();
          actions.switchScenario(newScenario.forecast_id);
          
          return newScenario;
        }
      } catch (error) {
        console.error('Error creating scenario:', error);
        toast.error('Failed to create scenario');
      }
    },

    bulkUpdateForecast: async (salesData, operation = 'add') => {
      try {
        actions.setLoading(true);
        // Transform sales data to the format expected by the backend
        const forecasts = salesData.map(sale => ({
          unit_id: sale.unit_id, // Keep as unit_id for backend
          customer_id: sale.customer_id,
          period: sale.period ? `${sale.period}-01` : sale.period, // Convert 2025-09 back to 2025-09-01 for backend
          quantity: sale.quantity,
          unit_price: sale.unit_price, // Keep as unit_price for backend
          total_revenue: sale.total_revenue,
          forecast_id: sale.forecast_id
        }));
        
        const response = await axios.post(`${API_BASE}/forecast/bulk_update`, { 
          forecasts,
          operation 
        });
        if (response.data.status === 'success') {
          toast.success(`Updated ${response.data.data.updated_count} forecast records`);
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error bulk updating forecast:', error);
        toast.error('Failed to update forecast');
        throw error; // Re-throw so the component can handle it
      } finally {
        actions.setLoading(false);
      }
    },

    // Removed updateSalesRecord function - use bulkUpdateForecast instead

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
    },

    // Customer Management Functions
    createCustomer: async (customerData) => {
      try {
        actions.setLoading(true);
        
        // Generate a unique customer ID if not provided
        if (!customerData.customer_id) {
          const customers = Array.isArray(state.data.customers) ? state.data.customers : [];
          const maxId = Math.max(...customers.map(c => {
            const id = c.customer_id?.replace('CUST-', '') || '0';
            return parseInt(id) || 0;
          }), 0);
          customerData.customer_id = `CUST-${String(maxId + 1).padStart(3, '0')}`;
        }

        const response = await axios.post(`${API_BASE}/forecast/create`, { 
          table: 'customers',
          data: customerData 
        });
        
        if (response.data.status === 'success') {
          toast.success('Customer created successfully');
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error creating customer:', error);
        toast.error('Failed to create customer');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    },

    updateCustomer: async (customerId, customerData) => {
      try {
        actions.setLoading(true);
        
        const response = await axios.post(`${API_BASE}/forecast/update`, {
          table: 'customers',
          id: customerId,
          updates: customerData
        });
        
        if (response.data.status === 'success') {
          toast.success('Customer updated successfully');
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error updating customer:', error);
        toast.error('Failed to update customer');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    },

    deleteCustomer: async (tableName, customerId) => {
      try {
        actions.setLoading(true);
        
        const response = await axios.delete(`${API_BASE}/forecast/delete/${tableName}/${customerId}`);
        
        if (response.data.status === 'success') {
          toast.success('Customer deleted successfully');
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error deleting customer:', error);
        toast.error('Failed to delete customer');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    },

    // Machine Management Functions
    createMachine: async (machineData) => {
      try {
        actions.setLoading(true);
        
        const response = await axios.post(`${API_BASE}/forecast/create`, { 
          table: 'machines',
          data: machineData 
        });
        
        if (response.data.status === 'success') {
          toast.success('Machine created successfully');
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error creating machine:', error);
        toast.error('Failed to create machine');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    },

    updateMachine: async (machineId, machineData) => {
      try {
        actions.setLoading(true);
        
        const response = await axios.post(`${API_BASE}/forecast/update`, {
          table: 'machines',
          id: machineId,
          updates: machineData
        });
        
        if (response.data.status === 'success') {
          toast.success('Machine updated successfully');
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error updating machine:', error);
        toast.error('Failed to update machine');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    },

    deleteMachine: async (machineId) => {
      try {
        actions.setLoading(true);
        
        const response = await axios.delete(`${API_BASE}/forecast/delete/machines/${machineId}`);
        
        if (response.data.status === 'success') {
          toast.success('Machine deleted successfully');
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error deleting machine:', error);
        toast.error('Failed to delete machine');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    },

    // Router Management Functions
    createRouter: async (routerData) => {
      try {
        actions.setLoading(true);
        
        const response = await axios.post(`${API_BASE}/forecast/create`, { 
          table: 'router_definitions',
          data: routerData 
        });
        
        if (response.data.status === 'success') {
          toast.success('Router created successfully');
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error creating router:', error);
        toast.error('Failed to create router');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    },

    updateRouter: async (routerId, routerData) => {
      try {
        actions.setLoading(true);
        
        const response = await axios.post(`${API_BASE}/forecast/update`, {
          table: 'router_definitions',
          id: routerId,
          updates: routerData
        });
        
        if (response.data.status === 'success') {
          toast.success('Router updated successfully');
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error updating router:', error);
        toast.error('Failed to update router');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    },

    deleteRouter: async (routerId) => {
      try {
        actions.setLoading(true);
        
        const response = await axios.delete(`${API_BASE}/forecast/delete/router_definitions/${routerId}`);
        
        if (response.data.status === 'success') {
          toast.success('Router deleted successfully');
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error deleting router:', error);
        toast.error('Failed to delete router');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    },

    // Router Operation Management Functions
    createRouterOperation: async (operationData) => {
      try {
        actions.setLoading(true);
        
        const response = await axios.post(`${API_BASE}/forecast/create`, { 
          table: 'router_operations',
          data: operationData 
        });
        
        if (response.data.status === 'success') {
          toast.success('Router operation created successfully');
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error creating router operation:', error);
        toast.error('Failed to create router operation');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    },

    updateRouterOperation: async (operationId, operationData) => {
      try {
        actions.setLoading(true);
        
        const response = await axios.post(`${API_BASE}/forecast/update`, {
          table: 'router_operations',
          id: operationId,
          updates: operationData
        });
        
        if (response.data.status === 'success') {
          toast.success('Router operation updated successfully');
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error updating router operation:', error);
        toast.error('Failed to update router operation');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    },

    deleteRouterOperation: async (operationId) => {
      try {
        actions.setLoading(true);
        
        const response = await axios.delete(`${API_BASE}/forecast/delete/router_operations/${operationId}`);
        
        if (response.data.status === 'success') {
          toast.success('Router operation deleted successfully');
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error deleting router operation:', error);
        toast.error('Failed to delete router operation');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    },

    // Product Management Functions
    createProduct: async (productData) => {
      try {
        actions.setLoading(true);
        
        // Generate a unique product ID if not provided
        if (!productData.unit_id || productData.unit_id.trim() === '') {
          const products = Array.isArray(state.data.products) ? state.data.products : [];
          const maxId = Math.max(...products.map(p => {
            const id = p.unit_id?.replace('PROD-', '') || '0';
            return parseInt(id) || 0;
          }), 0);
          productData.unit_id = `PROD-${String(maxId + 1).padStart(3, '0')}`;
          console.log('Auto-generated product ID:', productData.unit_id);
        }

        const response = await axios.post(`${API_BASE}/forecast/create`, { 
          table: 'units',
          data: productData 
        });
        
        if (response.data.status === 'success') {
          toast.success('Product created successfully');
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error creating product:', error);
        toast.error('Failed to create product');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    },

    updateProduct: async (productId, productData) => {
      try {
        actions.setLoading(true);
        
        const response = await axios.post(`${API_BASE}/forecast/update`, {
          table: 'units',
          id: productId,
          updates: productData
        });
        
        if (response.data.status === 'success') {
          toast.success('Product updated successfully');
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error updating product:', error);
        toast.error('Failed to update product');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    },

    deleteProduct: async (tableName, productId) => {
      try {
        actions.setLoading(true);
        
        const response = await axios.delete(`${API_BASE}/forecast/delete/${tableName}/${productId}`);
        
        if (response.data.status === 'success') {
          toast.success('Product deleted successfully');
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error deleting product:', error);
        toast.error('Failed to delete product');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    },

    // Labor Rate Management Functions
    createLaborRate: async (laborRateData) => {
      try {
        actions.setLoading(true);
        
        const response = await axios.post(`${API_BASE}/forecast/create`, { 
          table: 'labor_rates',
          data: laborRateData 
        });
        
        if (response.data.status === 'success') {
          toast.success('Labor rate created successfully');
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error creating labor rate:', error);
        toast.error('Failed to create labor rate');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    },

    updateLaborRate: async (laborRateId, laborRateData) => {
      try {
        actions.setLoading(true);
        
        const response = await axios.post(`${API_BASE}/forecast/update`, {
          table: 'labor_rates',
          id: laborRateId,
          updates: laborRateData
        });
        
        if (response.data.status === 'success') {
          toast.success('Labor rate updated successfully');
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error updating labor rate:', error);
        toast.error('Failed to update labor rate');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    },

    deleteLaborRate: async (tableName, laborRateId) => {
      try {
        actions.setLoading(true);
        
        const response = await axios.delete(`${API_BASE}/forecast/delete/${tableName}/${laborRateId}`);
        
        if (response.data.status === 'success') {
          toast.success('Labor rate deleted successfully');
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error deleting labor rate:', error);
        toast.error('Failed to delete labor rate');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    },

    // Unit Management Functions
    createUnit: async (unitData) => {
      try {
        actions.setLoading(true);
        
        const response = await axios.post(`${API_BASE}/forecast/create`, { 
          table: 'units',
          data: unitData 
        });
        
        if (response.data.status === 'success') {
          toast.success('Unit created successfully');
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error creating unit:', error);
        toast.error('Failed to create unit');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    },

    updateUnit: async (unitId, unitData) => {
      try {
        actions.setLoading(true);
        
        const response = await axios.post(`${API_BASE}/forecast/update`, {
          table: 'units',
          id: unitId,
          updates: unitData
        });
        
        if (response.data.status === 'success') {
          toast.success('Unit updated successfully');
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error updating unit:', error);
        toast.error('Failed to update unit');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    },

    // BOM Management Functions
    createBOM: async (bomData) => {
      try {
        actions.setLoading(true);
        
        const response = await axios.post(`${API_BASE}/forecast/create`, { 
          table: 'bom',
          data: bomData 
        });
        
        if (response.data.status === 'success') {
          toast.success('BOM created successfully');
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error creating BOM:', error);
        toast.error('Failed to create BOM');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    },

    updateBOM: async (bomId, bomData) => {
      try {
        actions.setLoading(true);
        
        console.log('updateBOM called with:', { bomId, bomData });
        
        const response = await axios.post(`${API_BASE}/forecast/update`, {
          table: 'bom',
          id: bomId,
          updates: bomData
        });
        
        console.log('updateBOM response:', response.data);
        
        if (response.data.status === 'success') {
          toast.success('BOM updated successfully');
          // Add a small delay to ensure database transaction is committed
          await new Promise(resolve => setTimeout(resolve, 100));
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error updating BOM:', error);
        toast.error('Failed to update BOM');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    },

    deleteBOM: async (bomId) => {
      try {
        actions.setLoading(true);
        
        const response = await axios.delete(`${API_BASE}/forecast/delete/bom/${bomId}`);
        
        if (response.data.status === 'success') {
          toast.success('BOM deleted successfully');
          await actions.fetchAllData();
        }
      } catch (error) {
        console.error('Error deleting BOM:', error);
        toast.error('Failed to delete BOM');
        throw error;
      } finally {
        actions.setLoading(false);
      }
    }
  };

  // Load data on mount and when active scenario changes
  useEffect(() => {
    const loadData = async () => {
      try {
        await actions.fetchAllData(state.activeScenario);
      } catch (error) {
        console.error('Error loading data:', error);
      }
    };
    
    loadData();
  }, [state.activeScenario]); // Only depend on activeScenario, not state changes



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