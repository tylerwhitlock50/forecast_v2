import React from 'react';
import { useForecast } from '../../../context/ForecastContext';
import './RevenueForecasting.css';

const DataDebugger = ({ data }) => {
  const { activeScenario } = useForecast();
  
  const debugInfo = {
    products: {
      count: data.products?.length || 0,
      sample: data.products?.slice(0, 2) || [],
      hasData: Array.isArray(data.products) && data.products.length > 0
    },
    customers: {
      count: data.customers?.length || 0,
      sample: data.customers?.slice(0, 2) || [],
      hasData: Array.isArray(data.customers) && data.customers.length > 0
    },
    sales_forecast: {
      count: data.sales_forecast?.length || 0,
      sample: data.sales_forecast?.slice(0, 2) || [],
      hasData: Array.isArray(data.sales_forecast) && data.sales_forecast.length > 0
    },
    forecasts: {
      count: data.forecasts?.length || 0,
      sample: data.forecasts?.slice(0, 2) || [],
      hasData: Array.isArray(data.forecasts) && data.forecasts.length > 0
    },
    // Add scenario-specific sales count
    scenario_sales: {
      count: data.sales_forecast?.filter(s => s.forecast_id === (activeScenario || 'F001')).length || 0,
      sample: data.sales_forecast?.filter(s => s.forecast_id === (activeScenario || 'F001')).slice(0, 2) || [],
      hasData: Array.isArray(data.sales_forecast) && data.sales_forecast.filter(s => s.forecast_id === (activeScenario || 'F001')).length > 0
    }
  };

  return (
    <div style={{ 
      background: '#f8f9fa', 
      padding: '1rem', 
      border: '1px solid #dee2e6', 
      borderRadius: '8px',
      marginBottom: '1rem'
    }}>
      <h4>Data Debug Info</h4>
      <div style={{ marginBottom: '0.5rem', fontWeight: 'bold', color: '#495057' }}>
        Active Scenario: {activeScenario || 'F001'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <div>
          <strong>Products:</strong> {debugInfo.products.count} 
          {debugInfo.products.hasData ? ' ✅' : ' ❌'}
          {debugInfo.products.sample.length > 0 && (
            <div style={{ fontSize: '0.8rem', color: '#666' }}>
              Sample: {debugInfo.products.sample[0]?.name || debugInfo.products.sample[0]?.unit_name}
            </div>
          )}
        </div>
        <div>
          <strong>Customers:</strong> {debugInfo.customers.count}
          {debugInfo.customers.hasData ? ' ✅' : ' ❌'}
          {debugInfo.customers.sample.length > 0 && (
            <div style={{ fontSize: '0.8rem', color: '#666' }}>
              Sample: {debugInfo.customers.sample[0]?.customer_name}
            </div>
          )}
        </div>
        <div>
          <strong>All Sales Forecast:</strong> {debugInfo.sales_forecast.count}
          {debugInfo.sales_forecast.hasData ? ' ✅' : ' ❌'}
          {debugInfo.sales_forecast.sample.length > 0 && (
            <div style={{ fontSize: '0.8rem', color: '#666' }}>
              Sample: {debugInfo.sales_forecast.sample[0]?.unit_id} - {debugInfo.sales_forecast.sample[0]?.customer_id}
            </div>
          )}
        </div>
        <div>
          <strong>Scenario Sales ({activeScenario || 'F001'}):</strong> {debugInfo.scenario_sales.count}
          {debugInfo.scenario_sales.hasData ? ' ✅' : ' ❌'}
          {debugInfo.scenario_sales.sample.length > 0 && (
            <div style={{ fontSize: '0.8rem', color: '#666' }}>
              Sample: {debugInfo.scenario_sales.sample[0]?.unit_id} - {debugInfo.scenario_sales.sample[0]?.customer_id}
            </div>
          )}
        </div>
        <div>
          <strong>Forecasts:</strong> {debugInfo.forecasts.count}
          {debugInfo.forecasts.hasData ? ' ✅' : ' ❌'}
          {debugInfo.forecasts.sample.length > 0 && (
            <div style={{ fontSize: '0.8rem', color: '#666' }}>
              Sample: {debugInfo.forecasts.sample[0]?.product_id} - {debugInfo.forecasts.sample[0]?.customer_id}
            </div>
          )}
        </div>
      </div>
      
      {debugInfo.scenario_sales.sample.length > 0 && (
        <details style={{ marginTop: '1rem' }}>
          <summary>Raw Sales Data Sample (Current Scenario)</summary>
          <pre style={{ 
            background: '#fff', 
            padding: '0.5rem', 
            border: '1px solid #ccc',
            fontSize: '0.8rem',
            overflow: 'auto'
          }}>
            {JSON.stringify(debugInfo.scenario_sales.sample, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
};

export default DataDebugger; 