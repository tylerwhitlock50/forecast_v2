import React, { useState } from 'react';
import './PayrollManagement.css';
import { monthKey, formatDateOnly } from '../../../lib/dates';
import { PAY_FREQUENCY_LABELS, runTotal } from './payrollView';

// Pay runs come from /payroll/forecast: total cost is the EMPLOYER cost
// (gross + employer payroll taxes + benefits). Employee withholding is shown
// for information; it comes out of gross pay and is not an extra cost.
const PayrollForecast = ({ forecast, forecastHorizon, onHorizonChange, runsPerYear = 26, payFrequency }) => {
  const [viewMode, setViewMode] = useState('table'); // 'table' or 'chart'
  const [showDetails, setShowDetails] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState(null);

  // Ensure forecast is defined and is an array
  const safeForecast = forecast || [];

  // Cash-basis monthly rollups: each pay run counts in the month of its pay
  // date (the server's `month`, else the date-only string's own month —
  // never a UTC-parsed Date, which shifts month ends into the prior month).
  const getMonthlyRollups = () => {
    const monthlyData = {};
    
    safeForecast.forEach(period => {
      const key = period.month || monthKey(period.date);
      if (!key) return;
      
      if (!monthlyData[key]) {
        monthlyData[key] = {
          month: key,
          totalCost: 0,
          payrollCount: 0,
          avgEmployeeCount: 0
        };
      }
      
      monthlyData[key].totalCost += period.totalCost;
      monthlyData[key].payrollCount += 1;
      monthlyData[key].avgEmployeeCount += period.employeeCount;
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
        percentChange: index > 0 && safeForecast[index - 1].totalCost ?
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

  const formatDate = (dateStr) => formatDateOnly(dateStr, { month: 'short', day: 'numeric', year: 'numeric' }, '—');

  const frequencyLabel = PAY_FREQUENCY_LABELS[payFrequency] || '';
  const horizonOptions = [
    { value: Math.max(1, Math.round(runsPerYear / 2)), label: '6 months' },
    { value: runsPerYear, label: '1 year' },
    { value: runsPerYear * 2, label: '2 years' }
  ];
  if (!horizonOptions.some(option => option.value === forecastHorizon)) {
    horizonOptions.push({ value: forecastHorizon, label: 'custom' });
    horizonOptions.sort((a, b) => a.value - b.value);
  }

  return (
    <div className="payroll-forecast">
      <div className="payroll-forecast-header">
        <h2>Payroll Cash Flow Forecast</h2>
        <div className="payroll-forecast-controls">
          <label>
            Forecast Horizon:
            <select value={forecastHorizon} onChange={(e) => onHorizonChange(Number(e.target.value))}>
              {horizonOptions.map(option => (
                <option key={option.value} value={option.value}>{option.value} periods ({option.label})</option>
              ))}
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
              safeForecast.slice(0, runsPerYear).reduce((sum, period) => sum + period.totalCost, 0)
            )}
          </div>
          <div className="payroll-summary-detail">
            {Math.min(runsPerYear, safeForecast.length)} {frequencyLabel ? `${frequencyLabel.toLowerCase()} ` : ''}pay periods
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
                <th title="Gross + employer payroll taxes + benefits">Employer Cost</th>
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
                  <td>{formatCurrency(runTotal(period, 'grossPay'))}</td>
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
          <PayrollChart data={trendData.slice(0, runsPerYear)} />
        </div>
      )}

      <div className="payroll-monthly-rollups">
        <h3>Monthly Summary</h3>
        <p className="payroll-monthly-note">Cash basis: pay runs are grouped by pay date, so a month with three Fridays shows three runs. The income statement accrues payroll evenly per calendar month instead.</p>
        <div className="payroll-monthly-cards">
          {monthlyRollups.map(month => (
            <div key={month.month} className="payroll-monthly-card">
              <div className="payroll-month-label">
                {formatDateOnly(month.month, { month: 'long', year: 'numeric' }, month.month)}
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
                  <span>{formatCurrency(runTotal(selectedPeriod, 'grossPay'))}</span>
                </div>
                <div className="payroll-summary-row">
                  <span>Employer Payroll Taxes:</span>
                  <span>{formatCurrency(runTotal(selectedPeriod, 'employerTaxes'))}</span>
                </div>
                <div className="payroll-summary-row">
                  <span>Benefits:</span>
                  <span>{formatCurrency(runTotal(selectedPeriod, 'benefits'))}</span>
                </div>
                <div className="payroll-summary-row total">
                  <span>Total Employer Cost:</span>
                  <span>{formatCurrency(selectedPeriod.totalCost)}</span>
                </div>
                <div className="payroll-summary-row" title="Income tax and the employee's FICA withheld from gross pay - not an employer cost">
                  <span>Employee Withholding (info):</span>
                  <span>{formatCurrency(runTotal(selectedPeriod, 'withholding'))}</span>
                </div>
                <div className="payroll-summary-row">
                  <span>Net Pay (info):</span>
                  <span>{formatCurrency(runTotal(selectedPeriod, 'netPay'))}</span>
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
                      <th>Employer Cost</th>
                      <th>Net Pay (info)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPeriod.employeeDetails?.map(emp => (
                      <tr key={emp.employee_id}>
                        <td>{emp.employee_name}</td>
                        <td>{emp.department}</td>
                        <td>{formatCurrency(emp.compensation?.grossPay || 0)}</td>
                        <td>{formatCurrency(emp.compensation?.totalCost || 0)}</td>
                        <td>{formatCurrency(emp.compensation?.netPay || 0)}</td>
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
          {data.map((period, index) => {
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