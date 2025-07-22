import React from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';

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
    <Card className="mb-6 border-orange-200 bg-orange-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-orange-800">
          🔍 Data Debug Info
        </CardTitle>
        <div className="text-sm text-orange-700 font-medium">
          Active Scenario: {activeScenario || 'F001'}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-700">Products:</span>
              <span className="font-mono text-lg">{debugInfo.products.count}</span>
              <Badge variant={debugInfo.products.hasData ? "default" : "destructive"} className="text-xs">
                {debugInfo.products.hasData ? '✅' : '❌'}
              </Badge>
            </div>
            {debugInfo.products.sample.length > 0 && (
              <div className="text-xs text-gray-600 bg-white p-2 rounded border">
                Sample: {debugInfo.products.sample[0]?.name || debugInfo.products.sample[0]?.unit_name}
              </div>
            )}
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-700">Customers:</span>
              <span className="font-mono text-lg">{debugInfo.customers.count}</span>
              <Badge variant={debugInfo.customers.hasData ? "default" : "destructive"} className="text-xs">
                {debugInfo.customers.hasData ? '✅' : '❌'}
              </Badge>
            </div>
            {debugInfo.customers.sample.length > 0 && (
              <div className="text-xs text-gray-600 bg-white p-2 rounded border">
                Sample: {debugInfo.customers.sample[0]?.customer_name}
              </div>
            )}
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-700">All Sales:</span>
              <span className="font-mono text-lg">{debugInfo.sales_forecast.count}</span>
              <Badge variant={debugInfo.sales_forecast.hasData ? "default" : "destructive"} className="text-xs">
                {debugInfo.sales_forecast.hasData ? '✅' : '❌'}
              </Badge>
            </div>
            {debugInfo.sales_forecast.sample.length > 0 && (
              <div className="text-xs text-gray-600 bg-white p-2 rounded border">
                Sample: {debugInfo.sales_forecast.sample[0]?.unit_id} - {debugInfo.sales_forecast.sample[0]?.customer_id}
              </div>
            )}
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-700">Scenario Sales:</span>
              <span className="font-mono text-lg">{debugInfo.scenario_sales.count}</span>
              <Badge variant={debugInfo.scenario_sales.hasData ? "default" : "destructive"} className="text-xs">
                {debugInfo.scenario_sales.hasData ? '✅' : '❌'}
              </Badge>
            </div>
            {debugInfo.scenario_sales.sample.length > 0 && (
              <div className="text-xs text-gray-600 bg-white p-2 rounded border">
                Sample: {debugInfo.scenario_sales.sample[0]?.unit_id} - {debugInfo.scenario_sales.sample[0]?.customer_id}
              </div>
            )}
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-700">Forecasts:</span>
              <span className="font-mono text-lg">{debugInfo.forecasts.count}</span>
              <Badge variant={debugInfo.forecasts.hasData ? "default" : "destructive"} className="text-xs">
                {debugInfo.forecasts.hasData ? '✅' : '❌'}
              </Badge>
            </div>
            {debugInfo.forecasts.sample.length > 0 && (
              <div className="text-xs text-gray-600 bg-white p-2 rounded border">
                Sample: {debugInfo.forecasts.sample[0]?.product_id} - {debugInfo.forecasts.sample[0]?.customer_id}
              </div>
            )}
          </div>
        </div>
        
        {debugInfo.scenario_sales.sample.length > 0 && (
          <details className="mt-6">
            <summary className="cursor-pointer text-orange-700 font-medium hover:text-orange-800">
              Raw Sales Data Sample (Current Scenario)
            </summary>
            <pre className="mt-2 bg-white p-4 rounded border text-xs overflow-auto max-h-64">
              {JSON.stringify(debugInfo.scenario_sales.sample, null, 2)}
            </pre>
          </details>
        )}
      </CardContent>
    </Card>
  );
};

export default DataDebugger; 