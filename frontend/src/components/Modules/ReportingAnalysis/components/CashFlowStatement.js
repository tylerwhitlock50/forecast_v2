import React, { useState } from 'react';
import { Card } from '../../../ui/card';
import { Button } from '../../../ui/button';
import { formatCurrency } from '../utils/formatters';

const CashFlowStatement = ({ data, period, selectedForecasts, scenarios }) => {
  const [viewMode, setViewMode] = useState('summary'); // 'summary', 'monthly'

  if (!data) {
    return (
      <div className="text-center py-8 text-gray-500">
        <div className="text-4xl mb-2">💰</div>
        <p>No cash flow statement data available</p>
      </div>
    );
  }

  const renderSummaryView = () => (
    <div className="space-y-6">
      {/* Operating Activities */}
      <Card className="p-4 bg-green-50 border-green-200">
        <h3 className="text-lg font-semibold text-green-800 mb-3">Cash Flow from Operating Activities</h3>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-green-700">Net Income</span>
            <div className={`font-medium ${
              data.operatingActivities.netIncome >= 0 ? 'text-green-800' : 'text-red-800'
            }`}>
              {formatCurrency(data.operatingActivities.netIncome)}
            </div>
          </div>
          
          {/* Adjustments (for future expansion) */}
          <div className="ml-4 text-sm space-y-1">
            <div className="flex justify-between text-gray-600">
              <span>Adjustments for non-cash items:</span>
              <span>-</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span className="ml-4">Depreciation & Amortization</span>
              <span>{formatCurrency(0)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span className="ml-4">Changes in Working Capital</span>
              <span>{formatCurrency(0)}</span>
            </div>
          </div>
          
          <hr className="border-green-300" />
          <div className="flex justify-between font-semibold">
            <span className="text-green-800">Net Cash from Operating Activities</span>
            <div className={`text-lg font-bold ${
              data.operatingActivities.operatingCashFlow >= 0 ? 'text-green-800' : 'text-red-800'
            }`}>
              {formatCurrency(data.operatingActivities.operatingCashFlow)}
            </div>
          </div>
        </div>
      </Card>

      {/* Investing Activities */}
      <Card className="p-4 bg-blue-50 border-blue-200">
        <h3 className="text-lg font-semibold text-blue-800 mb-3">Cash Flow from Investing Activities</h3>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-blue-700">Capital Expenditures</span>
            <div className="font-medium text-blue-800">
              {formatCurrency(data.investingActivities.capitalExpenditures)}
            </div>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Asset Purchases/Sales</span>
            <span>{formatCurrency(0)}</span>
          </div>
          <hr className="border-blue-300" />
          <div className="flex justify-between font-semibold">
            <span className="text-blue-800">Net Cash from Investing Activities</span>
            <div className={`text-lg font-bold ${
              data.investingActivities.investingCashFlow >= 0 ? 'text-blue-800' : 'text-red-800'
            }`}>
              {formatCurrency(data.investingActivities.investingCashFlow)}
            </div>
          </div>
        </div>
      </Card>

      {/* Financing Activities */}
      <Card className="p-4 bg-purple-50 border-purple-200">
        <h3 className="text-lg font-semibold text-purple-800 mb-3">Cash Flow from Financing Activities</h3>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-purple-700">Loan Principal Payments</span>
            <div className="font-medium text-red-800">
              {formatCurrency(data.financingActivities.principalPayments)}
            </div>
          </div>
          <div className="flex justify-between">
            <span className="text-purple-700">Interest Payments</span>
            <div className="font-medium text-red-800">
              {formatCurrency(data.financingActivities.interestPayments)}
            </div>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>New Borrowings</span>
            <span>{formatCurrency(0)}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Equity Transactions</span>
            <span>{formatCurrency(0)}</span>
          </div>
          <hr className="border-purple-300" />
          <div className="flex justify-between font-semibold">
            <span className="text-purple-800">Net Cash from Financing Activities</span>
            <div className={`text-lg font-bold ${
              data.financingActivities.financingCashFlow >= 0 ? 'text-purple-800' : 'text-red-800'
            }`}>
              {formatCurrency(data.financingActivities.financingCashFlow)}
            </div>
          </div>
        </div>
      </Card>

      {/* Net Cash Flow */}
      <Card className={`p-4 border-2 ${
        data.netCashFlow >= 0 
          ? 'bg-green-100 border-green-300' 
          : 'bg-red-100 border-red-300'
      }`}>
        <div className="flex justify-between items-center">
          <span className={`text-xl font-bold ${
            data.netCashFlow >= 0 ? 'text-green-800' : 'text-red-800'
          }`}>
            Net Increase (Decrease) in Cash
          </span>
          <div className={`text-2xl font-bold ${
            data.netCashFlow >= 0 ? 'text-green-800' : 'text-red-800'
          }`}>
            {formatCurrency(data.netCashFlow)}
          </div>
        </div>
      </Card>
    </div>
  );

  const renderMonthlyView = () => (
    <Card className="p-4">
      <h3 className="text-lg font-semibold mb-3">Monthly Cash Flow</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2">Period</th>
              <th className="text-right py-2">Cash Flow</th>
              <th className="text-right py-2">Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(data.byPeriod || {})
              .sort(([a], [b]) => a.localeCompare(b))
              .reduce((acc, [period, cashFlow], index) => {
                const cumulative = index === 0 ? cashFlow : acc[index - 1].cumulative + cashFlow;
                acc.push({ period, cashFlow, cumulative });
                return acc;
              }, [])
              .map(({ period, cashFlow, cumulative }, index) => (
                <tr key={period} className="border-b">
                  <td className="py-2">{period}</td>
                  <td className={`text-right py-2 font-medium ${
                    cashFlow >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {formatCurrency(cashFlow)}
                  </td>
                  <td className={`text-right py-2 font-medium ${
                    cumulative >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {formatCurrency(cumulative)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </Card>
  );

  return (
    <div className="space-y-6">
      {/* Header with Controls */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Cash Flow Statement</h2>
          <p className="text-gray-600">
            Period: {period.start} to {period.end}
          </p>
        </div>
        <div className="flex space-x-2">
          <select
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value)}
            className="px-3 py-1 border border-gray-300 rounded-md text-sm"
          >
            <option value="summary">Summary</option>
            <option value="monthly">Monthly Detail</option>
          </select>
        </div>
      </div>

      {/* Selected Forecasts Info */}
      <Card className="p-3 bg-blue-50 border-blue-200">
        <div className="text-sm text-blue-800">
          <strong>Combined Data from:</strong> {' '}
          {selectedForecasts.map(id => scenarios?.[id]?.name || id).join(', ')}
        </div>
      </Card>

      {/* Content */}
      {viewMode === 'summary' && renderSummaryView()}
      {viewMode === 'monthly' && (
        <>
          {renderSummaryView()}
          {renderMonthlyView()}
        </>
      )}

      {/* Cash Flow Analysis */}
      <Card className="p-4 bg-gray-50">
        <h3 className="text-lg font-semibold mb-3">Cash Flow Analysis</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
          <div>
            <div className={`text-2xl font-bold ${
              data.operatingActivities.operatingCashFlow >= 0 ? 'text-green-600' : 'text-red-600'
            }`}>
              {formatCurrency(data.operatingActivities.operatingCashFlow)}
            </div>
            <div className="text-sm text-gray-600">Operating Cash Flow</div>
            <div className="text-xs text-gray-500 mt-1">
              Cash generated from operations
            </div>
          </div>
          <div>
            <div className={`text-2xl font-bold ${
              data.financingActivities.financingCashFlow >= 0 ? 'text-green-600' : 'text-red-600'
            }`}>
              {formatCurrency(Math.abs(data.financingActivities.financingCashFlow))}
            </div>
            <div className="text-sm text-gray-600">Debt Service</div>
            <div className="text-xs text-gray-500 mt-1">
              Total loan payments
            </div>
          </div>
          <div>
            <div className={`text-2xl font-bold ${
              data.netCashFlow >= 0 ? 'text-green-600' : 'text-red-600'
            }`}>
              {data.operatingActivities.operatingCashFlow > 0 && Math.abs(data.financingActivities.financingCashFlow) > 0
                ? (data.operatingActivities.operatingCashFlow / Math.abs(data.financingActivities.financingCashFlow)).toFixed(2)
                : '0.00'}
            </div>
            <div className="text-sm text-gray-600">Debt Coverage Ratio</div>
            <div className="text-xs text-gray-500 mt-1">
              Operating Cash Flow ÷ Debt Service
            </div>
          </div>
        </div>
      </Card>

      {/* Cash Flow Health Indicators */}
      <Card className="p-4">
        <h3 className="text-lg font-semibold mb-3">Cash Flow Health Indicators</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
            <div className="flex items-center space-x-3">
              <span className={`text-2xl ${
                data.operatingActivities.operatingCashFlow > 0 ? '✅' : '⚠️'
              }`}>
                {data.operatingActivities.operatingCashFlow > 0 ? '✅' : '⚠️'}
              </span>
              <div>
                <div className="font-medium">Operating Cash Flow</div>
                <div className="text-sm text-gray-600">
                  {data.operatingActivities.operatingCashFlow > 0 
                    ? 'Positive - business generates cash' 
                    : 'Negative - business consumes cash'}
                </div>
              </div>
            </div>
            <div className={`font-bold ${
              data.operatingActivities.operatingCashFlow >= 0 ? 'text-green-600' : 'text-red-600'
            }`}>
              {formatCurrency(data.operatingActivities.operatingCashFlow)}
            </div>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
            <div className="flex items-center space-x-3">
              <span className={`text-2xl ${
                data.netCashFlow > 0 ? '✅' : data.netCashFlow === 0 ? '🟡' : '⚠️'
              }`}>
                {data.netCashFlow > 0 ? '✅' : data.netCashFlow === 0 ? '🟡' : '⚠️'}
              </span>
              <div>
                <div className="font-medium">Net Cash Flow</div>
                <div className="text-sm text-gray-600">
                  {data.netCashFlow > 0 
                    ? 'Positive - cash position improving' 
                    : data.netCashFlow === 0
                    ? 'Neutral - cash position stable'
                    : 'Negative - cash position declining'}
                </div>
              </div>
            </div>
            <div className={`font-bold ${
              data.netCashFlow >= 0 ? 'text-green-600' : 'text-red-600'
            }`}>
              {formatCurrency(data.netCashFlow)}
            </div>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
            <div className="flex items-center space-x-3">
              <span className={`text-2xl ${
                data.operatingActivities.operatingCashFlow > Math.abs(data.financingActivities.financingCashFlow) ? '✅' : '⚠️'
              }`}>
                {data.operatingActivities.operatingCashFlow > Math.abs(data.financingActivities.financingCashFlow) ? '✅' : '⚠️'}
              </span>
              <div>
                <div className="font-medium">Debt Service Coverage</div>
                <div className="text-sm text-gray-600">
                  {data.operatingActivities.operatingCashFlow > Math.abs(data.financingActivities.financingCashFlow)
                    ? 'Adequate - can cover debt payments' 
                    : 'Inadequate - may struggle with debt payments'}
                </div>
              </div>
            </div>
            <div className="font-bold text-blue-600">
              {data.operatingActivities.operatingCashFlow > 0 && Math.abs(data.financingActivities.financingCashFlow) > 0
                ? `${(data.operatingActivities.operatingCashFlow / Math.abs(data.financingActivities.financingCashFlow)).toFixed(2)}x`
                : '0.00x'}
            </div>
          </div>
        </div>
      </Card>

      {/* Note about Cash Flow Statement */}
      <Card className="p-4 bg-gray-50 border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">📝 Cash Flow Statement Notes</h3>
        <div className="text-xs text-gray-600 space-y-1">
          <p>• This cash flow statement is derived from operational forecasting data</p>
          <p>• Operating cash flow starts with net income (simplified method)</p>
          <p>• Adjustments for depreciation and working capital changes require additional setup</p>
          <p>• Financing activities include loan payments from the loan management module</p>
          <p>• Investment activities placeholder for future capital expenditure tracking</p>
        </div>
      </Card>
    </div>
  );
};

export default CashFlowStatement;