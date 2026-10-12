import React, { useState, useEffect } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import ForecastSelector from './components/ForecastSelector';
import { useScenarioComparison } from './hooks/useScenarioComparison';
import { Card } from '../../ui/card';
import { formatCurrency, formatPeriod } from './utils/formatters';

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
        <p className="text-gray-600">Compare revenue, cost, payroll and profit across scenarios</p>
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
        <Card className="p-6 overflow-x-auto">
          <p className="text-sm text-gray-500 mb-3">
            Figures come from the statements engine over each scenario&apos;s sales window, so they match the Reporting screen.
          </p>
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3 text-left">Scenario</th>
                <th className="px-4 py-3 text-left">Window</th>
                <th className="px-4 py-3 text-right">Revenue</th>
                <th className="px-4 py-3 text-right">COGS</th>
                <th className="px-4 py-3 text-right">Gross Profit</th>
                <th className="px-4 py-3 text-right">Payroll</th>
                <th className="px-4 py-3 text-right">Other Opex</th>
                <th className="px-4 py-3 text-right">Operating Income</th>
                <th className="px-4 py-3 text-right">Net Income</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200 tabular-nums">
              {data.map(row => {
                const name = row.name || scenarios[row.forecast_id]?.name || row.forecast_id;
                const window = row.start_period ? `${formatPeriod(row.start_period)} – ${formatPeriod(row.end_period)}` : 'No sales';
                const grossProfit = row.gross_profit ?? ((row.revenue ?? 0) - (row.cogs ?? 0));
                const netIncome = row.net_income ?? ((row.revenue ?? 0) - (row.expenses ?? 0) - (row.payroll ?? 0));
                return (
                  <tr key={row.forecast_id}>
                    <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-900">{name}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500">{window}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(row.revenue ?? 0)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(row.cogs ?? 0)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(grossProfit)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(row.payroll ?? 0)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(row.expenses ?? 0)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(row.operating_income ?? 0)}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${netIncome < 0 ? 'text-red-600' : 'text-green-700'}`}>{formatCurrency(netIncome)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
};

export default ScenarioComparison;
