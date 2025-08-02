import React, { useState, useEffect } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { useReporting } from './hooks/useReporting';
import ForecastSelector from './components/ForecastSelector';
import IncomeStatement from './components/IncomeStatement';
import BalanceSheet from './components/BalanceSheet';
import CashFlowStatement from './components/CashFlowStatement';
import ReportingControls from './components/ReportingControls';
import { Card } from '../../ui/card';
import { Button } from '../../ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../ui/tabs';

const ReportingDashboard = () => {
  const { state, actions } = useForecast();
  const { 
    combinedData, 
    loading, 
    error, 
    fetchCombinedData,
    calculateFinancialStatements 
  } = useReporting();

  const [selectedForecasts, setSelectedForecasts] = useState([]);
  const [reportingPeriod, setReportingPeriod] = useState({
    start: '2024-01',
    end: '2024-12'
  });
  const [activeTab, setActiveTab] = useState('income-statement');
  const [financialStatements, setFinancialStatements] = useState({
    incomeStatement: null,
    balanceSheet: null,
    cashFlowStatement: null
  });

  // Initialize with available scenarios
  useEffect(() => {
    const scenarios = Object.values(state.scenarios || {});
    if (scenarios.length > 0 && selectedForecasts.length === 0) {
      setSelectedForecasts([scenarios[0].id]);
    }
  }, [state.scenarios, selectedForecasts.length]);

  // Fetch data when forecasts or period changes
  useEffect(() => {
    if (selectedForecasts.length > 0) {
      fetchCombinedData(selectedForecasts, reportingPeriod);
    }
  }, [selectedForecasts, reportingPeriod, fetchCombinedData]);

  // Calculate financial statements when data changes
  useEffect(() => {
    if (combinedData) {
      const statements = calculateFinancialStatements(combinedData, reportingPeriod);
      setFinancialStatements(statements);
    }
  }, [combinedData, reportingPeriod, calculateFinancialStatements]);

  const handleForecastSelection = (forecastIds) => {
    setSelectedForecasts(forecastIds);
  };

  const handlePeriodChange = (newPeriod) => {
    setReportingPeriod(newPeriod);
  };

  const handleExportReport = (format) => {
    // Export functionality can be implemented here
    console.log(`Exporting report in ${format} format`);
  };

  const tabs = [
    { id: 'income-statement', label: 'Income Statement', icon: '📊' },
    { id: 'balance-sheet', label: 'Balance Sheet', icon: '⚖️' },
    { id: 'cash-flow', label: 'Cash Flow', icon: '💰' }
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading financial data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reporting & Analysis</h1>
          <p className="text-gray-600">Generate comprehensive financial statements from your forecasts</p>
        </div>
        <div className="flex space-x-2">
          <Button 
            variant="outline" 
            onClick={() => handleExportReport('pdf')}
            disabled={!financialStatements.incomeStatement}
          >
            Export PDF
          </Button>
          <Button 
            variant="outline" 
            onClick={() => handleExportReport('excel')}
            disabled={!financialStatements.incomeStatement}
          >
            Export Excel
          </Button>
        </div>
      </div>

      {/* Controls */}
      <Card className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="text-lg font-medium mb-4">Forecast Selection</h3>
            <ForecastSelector
              scenarios={state.scenarios || {}}
              selectedForecasts={selectedForecasts}
              onSelectionChange={handleForecastSelection}
            />
          </div>
          <div>
            <h3 className="text-lg font-medium mb-4">Reporting Period</h3>
            <ReportingControls
              period={reportingPeriod}
              onPeriodChange={handlePeriodChange}
            />
          </div>
        </div>
      </Card>

      {/* Selected Forecasts Summary */}
      {selectedForecasts.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center space-x-2 text-sm text-gray-600">
            <span>Selected Forecasts:</span>
            {selectedForecasts.map(id => {
              const scenario = state.scenarios?.[id];
              return scenario ? (
                <span key={id} className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                  {scenario.name}
                </span>
              ) : null;
            })}
            <span>•</span>
            <span>Period: {reportingPeriod.start} to {reportingPeriod.end}</span>
          </div>
        </Card>
      )}

      {/* Error State */}
      {error && (
        <Card className="p-6 border-red-200 bg-red-50">
          <div className="text-red-800">
            <h3 className="font-medium">Error Loading Data</h3>
            <p className="mt-1">{error}</p>
          </div>
        </Card>
      )}

      {/* Financial Statements */}
      {financialStatements.incomeStatement && (
        <Card className="p-6">
          <Tabs value={activeTab}>
            <TabsList className="grid w-full grid-cols-3">
              {tabs.map(tab => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="flex items-center space-x-2"
                  onClick={() => setActiveTab(tab.id)}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="income-statement" className="mt-6">
              <IncomeStatement 
                data={financialStatements.incomeStatement}
                period={reportingPeriod}
                selectedForecasts={selectedForecasts}
                scenarios={state.scenarios}
              />
            </TabsContent>
            
            <TabsContent value="balance-sheet" className="mt-6">
              <BalanceSheet 
                data={financialStatements.balanceSheet}
                period={reportingPeriod}
                selectedForecasts={selectedForecasts}
                scenarios={state.scenarios}
              />
            </TabsContent>
            
            <TabsContent value="cash-flow" className="mt-6">
              <CashFlowStatement 
                data={financialStatements.cashFlowStatement}
                period={reportingPeriod}
                selectedForecasts={selectedForecasts}
                scenarios={state.scenarios}
              />
            </TabsContent>
          </Tabs>
        </Card>
      )}

      {/* No Data State */}
      {selectedForecasts.length === 0 && (
        <Card className="p-12 text-center">
          <div className="text-gray-400">
            <div className="text-6xl mb-4">📊</div>
            <h3 className="text-xl font-medium text-gray-500 mb-2">Select Forecasts to Begin</h3>
            <p className="text-gray-400">
              Choose one or more forecast scenarios to generate financial statements
            </p>
          </div>
        </Card>
      )}
    </div>
  );
};

export default ReportingDashboard;