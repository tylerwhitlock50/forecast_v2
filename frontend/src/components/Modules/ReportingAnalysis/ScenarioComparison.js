import React, { useState, useEffect } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import ForecastSelector from './components/ForecastSelector';
import { useScenarioComparison } from './hooks/useScenarioComparison';
import { Card } from '../../ui/card';

const ScenarioComparison = () => {
  const { state } = useForecast();
  const [selectedForecasts, setSelectedForecasts] = useState([]);
  const { data, loading, error, fetchComparison } = useScenarioComparison();

  useEffect(() => {
    if (selectedForecasts.length > 0) {
      fetchComparison(selectedForecasts);
    }
  }, [selectedForecasts, fetchComparison]);

  const scenarios = state.scenarios || {};

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Scenario Comparison</h1>
        <p className="text-gray-600">Compare revenue, expenses and payroll across scenarios</p>
      </div>

      <Card className="p-6">
        <h3 className="text-lg font-medium mb-4">Select Scenarios</h3>
        <ForecastSelector
          scenarios={scenarios}
          selectedForecasts={selectedForecasts}
          onSelectionChange={setSelectedForecasts}
        />
      </Card>

      {loading && <p>Loading comparison...</p>}
      {error && <p className="text-red-600">{error}</p>}

      {data.length > 0 && (
        <Card className="p-6">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Scenario</th>
                <th className="px-6 py-3">Revenue</th>
                <th className="px-6 py-3">Expenses</th>
                <th className="px-6 py-3">Payroll</th>
                <th className="px-6 py-3">Profit</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {data.map(row => (
                <tr key={row.forecast_id}>
                  <td className="px-6 py-4 whitespace-nowrap">{row.forecast_id}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{(row.revenue ?? 0).toFixed(2)}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{(row.expenses ?? 0).toFixed(2)}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{(row.payroll ?? 0).toFixed(2)}</td>
                  <td className="px-6 py-4 whitespace-nowrap">{((row.revenue ?? 0) - (row.expenses ?? 0) - (row.payroll ?? 0)).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
};

export default ScenarioComparison;
