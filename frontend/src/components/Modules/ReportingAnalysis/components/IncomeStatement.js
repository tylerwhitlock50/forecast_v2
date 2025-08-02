import React, { useState } from 'react';
import { Card } from '../../../ui/card';
import { Button } from '../../../ui/button';
import { formatCurrency, formatPercentage } from '../utils/formatters';

const IncomeStatement = ({ data, period, selectedForecasts, scenarios }) => {
  const [viewMode, setViewMode] = useState('summary'); // 'summary', 'detailed', 'comparative'
  const [showPercentages, setShowPercentages] = useState(true);

  if (!data) {
    return (
      <div className="text-center py-8 text-gray-500">
        <div className="text-4xl mb-2">📊</div>
        <p>No income statement data available</p>
      </div>
    );
  }

  const renderSummaryView = () => (
    <div className="space-y-6">
      {/* Revenue Section */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-green-800 mb-3">Revenue</h3>
        <div className="flex justify-between items-center">
          <span className="text-green-700">Gross Revenue</span>
          <div className="text-right">
            <div className="text-lg font-bold text-green-800">
              {formatCurrency(data.revenue.grossRevenue)}
            </div>
            {showPercentages && (
              <div className="text-sm text-green-600">100.0%</div>
            )}
          </div>
        </div>
      </div>

      {/* Cost of Goods Sold */}
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-red-800 mb-3">Cost of Goods Sold</h3>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-red-700">Materials</span>
            <div className="text-right">
              <div className="font-medium text-red-800">
                {formatCurrency(data.costOfGoodsSold.materials)}
              </div>
              {showPercentages && (
                <div className="text-sm text-red-600">
                  {formatPercentage(data.costOfGoodsSold.materials, data.revenue.grossRevenue)}
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-between">
            <span className="text-red-700">Labor</span>
            <div className="text-right">
              <div className="font-medium text-red-800">
                {formatCurrency(data.costOfGoodsSold.labor)}
              </div>
              {showPercentages && (
                <div className="text-sm text-red-600">
                  {formatPercentage(data.costOfGoodsSold.labor, data.revenue.grossRevenue)}
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-between">
            <span className="text-red-700">Manufacturing</span>
            <div className="text-right">
              <div className="font-medium text-red-800">
                {formatCurrency(data.costOfGoodsSold.manufacturing)}
              </div>
              {showPercentages && (
                <div className="text-sm text-red-600">
                  {formatPercentage(data.costOfGoodsSold.manufacturing, data.revenue.grossRevenue)}
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-between">
            <span className="text-red-700">Factory Overhead</span>
            <div className="text-right">
              <div className="font-medium text-red-800">
                {formatCurrency(data.costOfGoodsSold.factoryOverhead)}
              </div>
              {showPercentages && (
                <div className="text-sm text-red-600">
                  {formatPercentage(data.costOfGoodsSold.factoryOverhead, data.revenue.grossRevenue)}
                </div>
              )}
            </div>
          </div>
          <hr className="border-red-300" />
          <div className="flex justify-between font-semibold">
            <span className="text-red-800">Total COGS</span>
            <div className="text-right">
              <div className="text-lg font-bold text-red-800">
                {formatCurrency(data.costOfGoodsSold.total)}
              </div>
              {showPercentages && (
                <div className="text-sm text-red-600">
                  {formatPercentage(data.costOfGoodsSold.total, data.revenue.grossRevenue)}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Gross Profit */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-blue-800 mb-3">Gross Profit</h3>
        <div className="flex justify-between items-center">
          <span className="text-blue-700">Gross Profit</span>
          <div className="text-right">
            <div className="text-xl font-bold text-blue-800">
              {formatCurrency(data.grossProfit)}
            </div>
            {showPercentages && (
              <div className="text-sm text-blue-600">
                {formatPercentage(data.grossProfit, data.revenue.grossRevenue)} margin
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Operating Expenses */}
      <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-orange-800 mb-3">Operating Expenses</h3>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-orange-700">Payroll</span>
            <div className="text-right">
              <div className="font-medium text-orange-800">
                {formatCurrency(data.operatingExpenses.payroll)}
              </div>
              {showPercentages && (
                <div className="text-sm text-orange-600">
                  {formatPercentage(data.operatingExpenses.payroll, data.revenue.grossRevenue)}
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-between">
            <span className="text-orange-700">Administrative</span>
            <div className="text-right">
              <div className="font-medium text-orange-800">
                {formatCurrency(data.operatingExpenses.adminExpenses)}
              </div>
              {showPercentages && (
                <div className="text-sm text-orange-600">
                  {formatPercentage(data.operatingExpenses.adminExpenses, data.revenue.grossRevenue)}
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-between">
            <span className="text-orange-700">Other Operating</span>
            <div className="text-right">
              <div className="font-medium text-orange-800">
                {formatCurrency(data.operatingExpenses.operatingExpenses)}
              </div>
              {showPercentages && (
                <div className="text-sm text-orange-600">
                  {formatPercentage(data.operatingExpenses.operatingExpenses, data.revenue.grossRevenue)}
                </div>
              )}
            </div>
          </div>
          <hr className="border-orange-300" />
          <div className="flex justify-between font-semibold">
            <span className="text-orange-800">Total Operating Expenses</span>
            <div className="text-right">
              <div className="text-lg font-bold text-orange-800">
                {formatCurrency(data.operatingExpenses.total)}
              </div>
              {showPercentages && (
                <div className="text-sm text-orange-600">
                  {formatPercentage(data.operatingExpenses.total, data.revenue.grossRevenue)}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Operating Income */}
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-purple-800 mb-3">Operating Income</h3>
        <div className="flex justify-between items-center">
          <span className="text-purple-700">Operating Income (EBIT)</span>
          <div className="text-right">
            <div className="text-xl font-bold text-purple-800">
              {formatCurrency(data.operatingIncome)}
            </div>
            {showPercentages && (
              <div className="text-sm text-purple-600">
                {formatPercentage(data.operatingIncome, data.revenue.grossRevenue)} margin
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Other Expenses */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-gray-800 mb-3">Other Expenses</h3>
        <div className="flex justify-between">
          <span className="text-gray-700">Interest Expense</span>
          <div className="text-right">
            <div className="font-medium text-gray-800">
              {formatCurrency(data.otherExpenses.interestExpense)}
            </div>
            {showPercentages && (
              <div className="text-sm text-gray-600">
                {formatPercentage(data.otherExpenses.interestExpense, data.revenue.grossRevenue)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Net Income */}
      <div className={`border-2 rounded-lg p-4 ${
        data.netIncome >= 0 
          ? 'bg-green-100 border-green-300' 
          : 'bg-red-100 border-red-300'
      }`}>
        <h3 className={`text-lg font-semibold mb-3 ${
          data.netIncome >= 0 ? 'text-green-800' : 'text-red-800'
        }`}>
          Net Income
        </h3>
        <div className="flex justify-between items-center">
          <span className={data.netIncome >= 0 ? 'text-green-700' : 'text-red-700'}>
            Net Income
          </span>
          <div className="text-right">
            <div className={`text-2xl font-bold ${
              data.netIncome >= 0 ? 'text-green-800' : 'text-red-800'
            }`}>
              {formatCurrency(data.netIncome)}
            </div>
            {showPercentages && (
              <div className={`text-sm ${
                data.netIncome >= 0 ? 'text-green-600' : 'text-red-600'
              }`}>
                {formatPercentage(data.netIncome, data.revenue.grossRevenue)} margin
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderDetailedView = () => (
    <div className="space-y-4">
      {/* Revenue Breakdown by Product/Customer */}
      <Card className="p-4">
        <h3 className="text-lg font-semibold mb-3">Revenue Breakdown</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h4 className="font-medium mb-2">By Product</h4>
            <div className="space-y-1 text-sm">
              {Object.entries(data.revenue.byProduct || {}).map(([productId, amount]) => (
                <div key={productId} className="flex justify-between">
                  <span className="text-gray-600">{productId}</span>
                  <span className="font-medium">{formatCurrency(amount)}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h4 className="font-medium mb-2">By Customer</h4>
            <div className="space-y-1 text-sm">
              {Object.entries(data.revenue.byCustomer || {}).slice(0, 5).map(([customerId, amount]) => (
                <div key={customerId} className="flex justify-between">
                  <span className="text-gray-600">{customerId}</span>
                  <span className="font-medium">{formatCurrency(amount)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Monthly Breakdown */}
      <Card className="p-4">
        <h3 className="text-lg font-semibold mb-3">Monthly Revenue</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          {Object.entries(data.revenue.byPeriod || {}).map(([period, amount]) => (
            <div key={period} className="bg-gray-50 p-2 rounded">
              <div className="text-gray-600">{period}</div>
              <div className="font-medium">{formatCurrency(amount)}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header with Controls */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Income Statement</h2>
          <p className="text-gray-600">
            Period: {period.start} to {period.end}
          </p>
        </div>
        <div className="flex space-x-2">
          <Button
            variant={showPercentages ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowPercentages(!showPercentages)}
          >
            {showPercentages ? 'Hide %' : 'Show %'}
          </Button>
          <select
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value)}
            className="px-3 py-1 border border-gray-300 rounded-md text-sm"
          >
            <option value="summary">Summary</option>
            <option value="detailed">Detailed</option>
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
      {viewMode === 'detailed' && (
        <>
          {renderSummaryView()}
          {renderDetailedView()}
        </>
      )}

      {/* Key Metrics Summary */}
      <Card className="p-4 bg-gray-50">
        <h3 className="text-lg font-semibold mb-3">Key Metrics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-green-600">
              {formatPercentage(data.grossProfit, data.revenue.grossRevenue)}
            </div>
            <div className="text-sm text-gray-600">Gross Margin</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-blue-600">
              {formatPercentage(data.operatingIncome, data.revenue.grossRevenue)}
            </div>
            <div className="text-sm text-gray-600">Operating Margin</div>
          </div>
          <div>
            <div className={`text-2xl font-bold ${
              data.netIncome >= 0 ? 'text-green-600' : 'text-red-600'
            }`}>
              {formatPercentage(data.netIncome, data.revenue.grossRevenue)}
            </div>
            <div className="text-sm text-gray-600">Net Margin</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-purple-600">
              {formatCurrency(data.revenue.grossRevenue)}
            </div>
            <div className="text-sm text-gray-600">Total Revenue</div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default IncomeStatement;