import React, { useState } from 'react';
import { Card } from '../../../ui/card';
import { Button } from '../../../ui/button';
import { formatCurrency, formatPercentage } from '../utils/formatters';

const BalanceSheet = ({ data, period, selectedForecasts, scenarios }) => {
  const [showPercentages, setShowPercentages] = useState(false);

  if (!data) {
    return (
      <div className="text-center py-8 text-gray-500">
        <div className="text-4xl mb-2">⚖️</div>
        <p>No balance sheet data available</p>
      </div>
    );
  }

  const totalAssets = data.assets.totalAssets;
  const totalLiabilities = data.liabilities.totalLiabilities;
  const totalEquity = data.equity.totalEquity;

  return (
    <div className="space-y-6">
      {/* Header with Controls */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Balance Sheet</h2>
          <p className="text-gray-600">
            As of {period.end}
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
        </div>
      </div>

      {/* Selected Forecasts Info */}
      <Card className="p-3 bg-blue-50 border-blue-200">
        <div className="text-sm text-blue-800">
          <strong>Combined Data from:</strong> {' '}
          {selectedForecasts.map(id => scenarios?.[id]?.name || id).join(', ')}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Assets */}
        <div className="space-y-4">
          <h3 className="text-xl font-semibold text-gray-900">ASSETS</h3>

          {/* Current Assets */}
          <Card className="p-4 bg-green-50 border-green-200">
            <h4 className="text-lg font-semibold text-green-800 mb-3">Current Assets</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-green-700">Accounts Receivable</span>
                <div className="text-right">
                  <div className="font-medium text-green-800">
                    {formatCurrency(data.assets.currentAssets.accountsReceivable)}
                  </div>
                  {showPercentages && (
                    <div className="text-sm text-green-600">
                      {formatPercentage(data.assets.currentAssets.accountsReceivable, totalAssets)}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-green-700">Inventory</span>
                <div className="text-right">
                  <div className="font-medium text-green-800">
                    {formatCurrency(data.assets.currentAssets.inventory)}
                  </div>
                  {showPercentages && (
                    <div className="text-sm text-green-600">
                      {formatPercentage(data.assets.currentAssets.inventory, totalAssets)}
                    </div>
                  )}
                </div>
              </div>
              <hr className="border-green-300" />
              <div className="flex justify-between font-semibold">
                <span className="text-green-800">Total Current Assets</span>
                <div className="text-right">
                  <div className="text-lg font-bold text-green-800">
                    {formatCurrency(data.assets.currentAssets.total)}
                  </div>
                  {showPercentages && (
                    <div className="text-sm text-green-600">
                      {formatPercentage(data.assets.currentAssets.total, totalAssets)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {/* Fixed Assets (Placeholder for future expansion) */}
          <Card className="p-4 bg-gray-50 border-gray-200">
            <h4 className="text-lg font-semibold text-gray-800 mb-3">Fixed Assets</h4>
            <div className="text-center py-4 text-gray-500">
              <div className="text-2xl mb-2">🏭</div>
              <p className="text-sm">Property, Plant & Equipment</p>
              <p className="text-xs mt-1">To be integrated with asset tracking</p>
            </div>
          </Card>

          {/* Total Assets */}
          <Card className="p-4 bg-blue-100 border-blue-300">
            <div className="flex justify-between items-center">
              <span className="text-xl font-bold text-blue-800">TOTAL ASSETS</span>
              <div className="text-right">
                <div className="text-2xl font-bold text-blue-800">
                  {formatCurrency(totalAssets)}
                </div>
                {showPercentages && (
                  <div className="text-sm text-blue-600">100.0%</div>
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* Liabilities & Equity */}
        <div className="space-y-4">
          <h3 className="text-xl font-semibold text-gray-900">LIABILITIES & EQUITY</h3>

          {/* Current Liabilities */}
          <Card className="p-4 bg-red-50 border-red-200">
            <h4 className="text-lg font-semibold text-red-800 mb-3">Current Liabilities</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-red-700">Accounts Payable</span>
                <div className="text-right">
                  <div className="font-medium text-red-800">
                    {formatCurrency(data.liabilities.currentLiabilities.accountsPayable)}
                  </div>
                  {showPercentages && (
                    <div className="text-sm text-red-600">
                      {formatPercentage(data.liabilities.currentLiabilities.accountsPayable, totalAssets)}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex justify-between">
                <span className="text-red-700">Current Portion - Long Term Debt</span>
                <div className="text-right">
                  <div className="font-medium text-red-800">
                    {formatCurrency(data.liabilities.currentLiabilities.currentPortionLongTermDebt)}
                  </div>
                  {showPercentages && (
                    <div className="text-sm text-red-600">
                      {formatPercentage(data.liabilities.currentLiabilities.currentPortionLongTermDebt, totalAssets)}
                    </div>
                  )}
                </div>
              </div>
              <hr className="border-red-300" />
              <div className="flex justify-between font-semibold">
                <span className="text-red-800">Total Current Liabilities</span>
                <div className="text-right">
                  <div className="text-lg font-bold text-red-800">
                    {formatCurrency(data.liabilities.currentLiabilities.total)}
                  </div>
                  {showPercentages && (
                    <div className="text-sm text-red-600">
                      {formatPercentage(data.liabilities.currentLiabilities.total, totalAssets)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {/* Long-term Liabilities (Placeholder) */}
          <Card className="p-4 bg-gray-50 border-gray-200">
            <h4 className="text-lg font-semibold text-gray-800 mb-3">Long-term Liabilities</h4>
            <div className="text-center py-4 text-gray-500">
              <div className="text-2xl mb-2">📄</div>
              <p className="text-sm">Long-term Debt</p>
              <p className="text-xs mt-1">Integrated with loan module</p>
            </div>
          </Card>

          {/* Total Liabilities */}
          <Card className="p-4 bg-red-100 border-red-300">
            <div className="flex justify-between items-center">
              <span className="text-lg font-bold text-red-800">Total Liabilities</span>
              <div className="text-right">
                <div className="text-xl font-bold text-red-800">
                  {formatCurrency(totalLiabilities)}
                </div>
                {showPercentages && (
                  <div className="text-sm text-red-600">
                    {formatPercentage(totalLiabilities, totalAssets)}
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* Shareholders' Equity */}
          <Card className="p-4 bg-purple-50 border-purple-200">
            <h4 className="text-lg font-semibold text-purple-800 mb-3">Shareholders' Equity</h4>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-purple-700">Retained Earnings</span>
                <div className="text-right">
                  <div className="font-medium text-purple-800">
                    {formatCurrency(data.equity.retainedEarnings)}
                  </div>
                  {showPercentages && (
                    <div className="text-sm text-purple-600">
                      {formatPercentage(data.equity.retainedEarnings, totalAssets)}
                    </div>
                  )}
                </div>
              </div>
              <hr className="border-purple-300" />
              <div className="flex justify-between font-semibold">
                <span className="text-purple-800">Total Equity</span>
                <div className="text-right">
                  <div className="text-lg font-bold text-purple-800">
                    {formatCurrency(totalEquity)}
                  </div>
                  {showPercentages && (
                    <div className="text-sm text-purple-600">
                      {formatPercentage(totalEquity, totalAssets)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {/* Total Liabilities & Equity */}
          <Card className="p-4 bg-blue-100 border-blue-300">
            <div className="flex justify-between items-center">
              <span className="text-xl font-bold text-blue-800">TOTAL LIAB. & EQUITY</span>
              <div className="text-right">
                <div className="text-2xl font-bold text-blue-800">
                  {formatCurrency(totalLiabilities + totalEquity)}
                </div>
                {showPercentages && (
                  <div className="text-sm text-blue-600">
                    {formatPercentage(totalLiabilities + totalEquity, totalAssets)}
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Working Capital Analysis */}
      <Card className="p-4 bg-yellow-50 border-yellow-200">
        <h3 className="text-lg font-semibold text-yellow-800 mb-3">Working Capital Analysis</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="text-center">
            <div className={`text-2xl font-bold ${
              data.workingCapital >= 0 ? 'text-green-600' : 'text-red-600'
            }`}>
              {formatCurrency(data.workingCapital)}
            </div>
            <div className="text-sm text-gray-600">Working Capital</div>
            <div className="text-xs text-gray-500 mt-1">
              Current Assets - Current Liabilities
            </div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">
              {totalAssets > 0 ? (data.assets.currentAssets.total / data.liabilities.currentLiabilities.total).toFixed(2) : '0.00'}
            </div>
            <div className="text-sm text-gray-600">Current Ratio</div>
            <div className="text-xs text-gray-500 mt-1">
              Current Assets ÷ Current Liabilities
            </div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-600">
              {totalAssets > 0 ? ((data.assets.currentAssets.total - data.assets.currentAssets.inventory) / data.liabilities.currentLiabilities.total).toFixed(2) : '0.00'}
            </div>
            <div className="text-sm text-gray-600">Quick Ratio</div>
            <div className="text-xs text-gray-500 mt-1">
              (Current Assets - Inventory) ÷ Current Liabilities
            </div>
          </div>
        </div>
      </Card>

      {/* Balance Check */}
      <Card className={`p-4 ${
        Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01
          ? 'bg-green-50 border-green-200'
          : 'bg-red-50 border-red-200'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className={`text-2xl ${
              Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01
                ? 'text-green-600'
                : 'text-red-600'
            }`}>
              {Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01 ? '✅' : '⚠️'}
            </span>
            <span className={`font-semibold ${
              Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01
                ? 'text-green-800'
                : 'text-red-800'
            }`}>
              Balance Sheet Check
            </span>
          </div>
          <div className="text-right">
            <div className={`font-medium ${
              Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01
                ? 'text-green-800'
                : 'text-red-800'
            }`}>
              Difference: {formatCurrency(Math.abs(totalAssets - (totalLiabilities + totalEquity)))}
            </div>
            <div className="text-xs text-gray-600">
              Assets must equal Liabilities + Equity
            </div>
          </div>
        </div>
      </Card>

      {/* Note about Simplified Balance Sheet */}
      <Card className="p-4 bg-gray-50 border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">📝 Balance Sheet Notes</h3>
        <div className="text-xs text-gray-600 space-y-1">
          <p>• This is a simplified balance sheet based on operational forecasting data</p>
          <p>• Accounts Receivable estimated as 1 month of revenue</p>
          <p>• Inventory estimated as 2 months of cost of goods sold</p>
          <p>• Accounts Payable estimated as 1 month of expenses and payroll</p>
          <p>• Fixed assets, depreciation, and detailed equity components require additional setup</p>
        </div>
      </Card>
    </div>
  );
};

export default BalanceSheet;