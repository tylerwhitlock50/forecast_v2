import React, { useState } from 'react';
import './PayrollManagement.css';

const PayrollForecast = ({ forecast, forecastHorizon, onHorizonChange }) => {
  const [viewMode, setViewMode] = useState('table'); // 'table' or 'chart'
  const [showDetails, setShowDetails] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState(null);

  // Ensure forecast is defined and is an array
  const safeForecast = forecast || [];

  // Calculate monthly rollups from bi-weekly data
  const getMonthlyRollups = () => {
    const monthlyData = {};
    
    safeForecast.forEach(period => {
      const date = new Date(period.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {
          month: monthKey,
          totalCost: 0,
          payrollCount: 0,
          avgEmployeeCount: 0
        };
      }
      
      monthlyData[monthKey].totalCost += period.totalCost;
      monthlyData[monthKey].payrollCount += 1;
      monthlyData[monthKey].avgEmployeeCount += period.employeeCount;
    });

    // Calculate averages
    Object.keys(monthlyData).forEach(month => {
      monthlyData[month].avgEmployeeCount = Math.round(
        monthlyData[month].avgEmployeeCount / monthlyData[month].payrollCount
      );
    });

    return Object.values(monthlyData).sort((a, b) => a.month.localeCompare(b.month));
  };

  const monthlyRollups = getMonthlyRollups();

  // Calculate running totals and trends
  const getTrendData = () => {
    let runningTotal = 0;
    return safeForecast.map((period, index) => {
      runningTotal += period.totalCost;
      return {
        ...period,
        runningTotal,
        percentChange: index > 0 ? 
          ((period.totalCost - safeForecast[index - 1].totalCost) / safeForecast[index - 1].totalCost * 100) : 0
      };
    });
  };

  const trendData = getTrendData();

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <div className="payroll-forecast">
      <div className="payroll-forecast-header">
        <h2>Payroll Cash Flow Forecast</h2>
        <div className="payroll-forecast-controls">
          <label>
            Forecast Horizon:
            <select value={forecastHorizon} onChange={(e) => onHorizonChange(Number(e.target.value))}>
              <option value={13}>13 periods (6 months)</option>
              <option value={26}>26 periods (1 year)</option>
              <option value={52}>52 periods (2 years)</option>
            </select>
          </label>
          
          <div className="payroll-view-toggle">
            <button 
              className={viewMode === 'table' ? 'active' : ''}
              onClick={() => setViewMode('table')}
            >
              Table
            </button>
            <button 
              className={viewMode === 'chart' ? 'active' : ''}
              onClick={() => setViewMode('chart')}
            >
              Chart
            </button>
          </div>
        </div>
      </div>

      <div className="payroll-forecast-summary">
        <div className="payroll-summary-card">
          <h3>Next Payroll</h3>
          <div className="payroll-summary-value">
            {formatCurrency(safeForecast[0]?.totalCost || 0)}
          </div>
          <div className="payroll-summary-detail">
            {formatDate(safeForecast[0]?.date)} • {safeForecast[0]?.employeeCount} employees
          </div>
        </div>
        
        <div className="payroll-summary-card">
          <h3>Monthly Average</h3>
          <div className="payroll-summary-value">
            {formatCurrency(
              monthlyRollups.reduce((sum, month) => sum + month.totalCost, 0) / 
              Math.max(monthlyRollups.length, 1)
            )}
          </div>
          <div className="payroll-summary-detail">
            Based on {monthlyRollups.length} months
          </div>
        </div>
        
        <div className="payroll-summary-card">
          <h3>Annual Projection</h3>
          <div className="payroll-summary-value">
            {formatCurrency(
              safeForecast.slice(0, 26).reduce((sum, period) => sum + period.totalCost, 0)
            )}
          </div>
          <div className="payroll-summary-detail">
            26 pay periods
          </div>
        </div>
        
        <div className="payroll-summary-card">
          <h3>Total Forecast</h3>
          <div className="payroll-summary-value">
            {formatCurrency(
              safeForecast.reduce((sum, period) => sum + period.totalCost, 0)
            )}
          </div>
          <div className="payroll-summary-detail">
            {forecastHorizon} pay periods
          </div>
        </div>
      </div>

      {viewMode === 'table' && (
        <div className="payroll-forecast-table-container">
          <table className="payroll-forecast-table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Date</th>
                <th>Employees</th>
                <th>Gross Pay</th>
                <th>Total Cost</th>
                <th>Change</th>
                <th>Running Total</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {trendData.map((period) => (
                <tr key={period.period}>
                  <td>{period.period}</td>
                  <td>{formatDate(period.date)}</td>
                  <td>{period.employeeCount}</td>
                  <td>
                    {formatCurrency(
                      period.employeeDetails?.reduce((sum, emp) => 
                        sum + (emp.compensation?.grossPay || 0), 0
                      ) || 0
                    )}
                  </td>
                  <td>{formatCurrency(period.totalCost)}</td>
                  <td className={period.percentChange > 0 ? 'payroll-change-positive' : period.percentChange < 0 ? 'payroll-change-negative' : ''}>
                    {period.percentChange > 0 ? '+' : ''}{period.percentChange.toFixed(1)}%
                  </td>
                  <td>{formatCurrency(period.runningTotal)}</td>
                  <td>
                    <button 
                      className="payroll-btn-small"
                      onClick={() => {
                        setSelectedPeriod(period);
                        setShowDetails(true);
                      }}
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewMode === 'chart' && (
        <div className="payroll-forecast-chart">
          <PayrollChart data={trendData} />
        </div>
      )}

      <div className="payroll-monthly-rollups">
        <h3>Monthly Summary</h3>
        <div className="payroll-monthly-cards">
          {monthlyRollups.map(month => (
            <div key={month.month} className="payroll-monthly-card">
              <div className="payroll-month-label">
                {new Date(month.month + '-01').toLocaleDateString('en-US', { 
                  month: 'long', 
                  year: 'numeric' 
                })}
              </div>
              <div className="payroll-month-cost">{formatCurrency(month.totalCost)}</div>
              <div className="payroll-month-details">
                {month.payrollCount} payrolls • {month.avgEmployeeCount} avg employees
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Period Details Modal */}
      {showDetails && selectedPeriod && (
        <div className="payroll-modal-overlay" onClick={() => setShowDetails(false)}>
          <div className="payroll-modal" onClick={(e) => e.stopPropagation()}>
            <div className="payroll-modal-header">
              <h3>Payroll Details - {formatDate(selectedPeriod.date)}</h3>
              <button className="payroll-close-btn" onClick={() => setShowDetails(false)}>×</button>
            </div>
            
            <div className="payroll-modal-content">
              <div className="payroll-period-summary">
                <div className="payroll-summary-row">
                  <span>Total Employees:</span>
                  <span>{selectedPeriod.employeeCount}</span>
                </div>
                <div className="payroll-summary-row">
                  <span>Gross Pay:</span>
                  <span>{formatCurrency(
                    selectedPeriod.employeeDetails?.reduce((sum, emp) => 
                      sum + (emp.compensation?.grossPay || 0), 0
                    ) || 0
                  )}</span>
                </div>
                <div className="payroll-summary-row">
                  <span>Total Taxes:</span>
                  <span>{formatCurrency(
                    selectedPeriod.employeeDetails?.reduce((sum, emp) => 
                      sum + (emp.compensation?.federalTax || 0) + 
                      (emp.compensation?.stateTax || 0) + 
                      (emp.compensation?.socialSecurity || 0) + 
                      (emp.compensation?.medicare || 0) + 
                      (emp.compensation?.unemployment || 0), 0
                    ) || 0
                  )}</span>
                </div>
                <div className="payroll-summary-row">
                  <span>Benefits:</span>
                  <span>{formatCurrency(
                    selectedPeriod.employeeDetails?.reduce((sum, emp) => 
                      sum + (emp.compensation?.benefits || 0), 0
                    ) || 0
                  )}</span>
                </div>
                <div className="payroll-summary-row total">
                  <span>Total Cost:</span>
                  <span>{formatCurrency(selectedPeriod.totalCost)}</span>
                </div>
              </div>

              <div className="payroll-employee-details">
                <h4>Employee Breakdown</h4>
                <table>
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Department</th>
                      <th>Gross Pay</th>
                      <th>Total Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPeriod.employeeDetails?.map(emp => (
                      <tr key={emp.employee_id}>
                        <td>{emp.employee_name}</td>
                        <td>{emp.department}</td>
                        <td>{formatCurrency(emp.compensation?.grossPay || 0)}</td>
                        <td>{formatCurrency(emp.compensation?.totalCost || 0)}</td>
                      </tr>
                    )) || []}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Simple chart component for payroll visualization
const PayrollChart = ({ data }) => {
  const maxCost = Math.max(...data.map(d => d.totalCost));
  const minCost = Math.min(...data.map(d => d.totalCost));
  const range = maxCost - minCost;

  return (
    <div className="payroll-simple-chart">
      <div className="payroll-chart-header">
        <h4>Payroll Cost Trend</h4>
      </div>
      <div className="payroll-chart-container">
        <div className="payroll-y-axis">
          <div className="payroll-y-label">${(maxCost / 1000).toFixed(0)}k</div>
          <div className="payroll-y-label">${((maxCost + minCost) / 2000).toFixed(0)}k</div>
          <div className="payroll-y-label">${(minCost / 1000).toFixed(0)}k</div>
        </div>
        <div className="payroll-chart-area">
          {data.slice(0, 26).map((period, index) => {
            const height = range > 0 ? ((period.totalCost - minCost) / range * 200) : 100;
            return (
              <div key={period.period} className="payroll-chart-bar">
                <div 
                  className="payroll-bar"
                  style={{ height: `${height}px` }}
                  title={`Period ${period.period}: $${period.totalCost.toLocaleString()}`}
                />
                <div className="payroll-bar-label">
                  {index % 4 === 0 ? period.period : ''}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PayrollForecast;