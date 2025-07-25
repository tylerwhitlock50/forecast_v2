import React, { useState, useEffect } from 'react';
import api from '../../../lib/apiClient';

const ExpenseReports = ({ expenses, categories, summaryStats }) => {
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchReportData();
  }, []);

  const fetchReportData = async () => {
    setLoading(true);
    try {
      const response = await api.get('/expenses/report', { suppressErrorToast: true });
      setReportData(response.data);
    } catch (error) {
      console.error('Error fetching report data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount || 0);
  };

  const formatPeriod = (period) => {
    const [year, month] = period.split('-');
    const date = new Date(year, month - 1);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
  };

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner"></div>
        <p>Loading reports...</p>
      </div>
    );
  }

  if (!reportData) {
    return (
      <div className="empty-state">
        <div className="empty-icon">📊</div>
        <h3>Report data not available</h3>
        <button className="btn btn-primary" onClick={fetchReportData}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="expense-reports">
      <div className="reports-header">
        <h3>Expense Reports & Analytics</h3>
        <button className="btn btn-outline" onClick={fetchReportData}>
          🔄 Refresh
        </button>
      </div>

      {/* Summary Overview */}
      <div className="report-section">
        <h4>📊 Annual Summary</h4>
        <div className="summary-grid">
          <div className="summary-card">
            <div className="summary-value">{formatCurrency(reportData.total_monthly)}</div>
            <div className="summary-label">Monthly Recurring</div>
            <div className="summary-sublabel">Annualized: {formatCurrency(reportData.total_monthly)}</div>
          </div>
          
          <div className="summary-card">
            <div className="summary-value">{formatCurrency(reportData.total_quarterly)}</div>
            <div className="summary-label">Quarterly Recurring</div>
            <div className="summary-sublabel">Annualized: {formatCurrency(reportData.total_quarterly)}</div>
          </div>
          
          <div className="summary-card">
            <div className="summary-value">{formatCurrency(reportData.total_annual)}</div>
            <div className="summary-label">Annual Expenses</div>
            <div className="summary-sublabel">Yearly commitments</div>
          </div>
          
          <div className="summary-card">
            <div className="summary-value">{formatCurrency(reportData.total_one_time)}</div>
            <div className="summary-label">One-time Expenses</div>
            <div className="summary-sublabel">Current period</div>
          </div>
        </div>
      </div>

      {/* Category Breakdown */}
      <div className="report-section">
        <h4>🏗️ Category Breakdown</h4>
        <div className="category-breakdown">
          <div className="breakdown-card factory-overhead">
            <div className="breakdown-header">
              <h5>🏭 Factory Overhead</h5>
              <div className="breakdown-amount">
                {formatCurrency(reportData.factory_overhead_total)}
              </div>
            </div>
            <div className="breakdown-description">
              Manufacturing and production support costs
            </div>
          </div>
          
          <div className="breakdown-card admin-expense">
            <div className="breakdown-header">
              <h5>🏢 Administrative Expenses</h5>
              <div className="breakdown-amount">
                {formatCurrency(reportData.admin_expense_total)}
              </div>
            </div>
            <div className="breakdown-description">
              General business operating expenses
            </div>
          </div>
          
          <div className="breakdown-card cogs">
            <div className="breakdown-header">
              <h5>⚙️ Cost of Goods Sold</h5>
              <div className="breakdown-amount">
                {formatCurrency(reportData.cogs_total)}
              </div>
            </div>
            <div className="breakdown-description">
              Direct costs attributable to production
            </div>
          </div>
        </div>
      </div>

      {/* Upcoming Payments */}
      {reportData.upcoming_payments && reportData.upcoming_payments.length > 0 && (
        <div className="report-section">
          <h4>📅 Upcoming Payments</h4>
          <div className="payments-table-container">
            <table className="payments-table">
              <thead>
                <tr>
                  <th>Expense</th>
                  <th>Category</th>
                  <th>Period</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {reportData.upcoming_payments.map((payment, index) => (
                  <tr key={index}>
                    <td>{payment.expense_name}</td>
                    <td>{payment.category_name}</td>
                    <td>{formatPeriod(payment.period)}</td>
                    <td>{formatCurrency(payment.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Overdue Payments */}
      {reportData.overdue_payments && reportData.overdue_payments.length > 0 && (
        <div className="report-section">
          <h4>⚠️ Overdue Payments</h4>
          <div className="overdue-alert">
            <p>The following payments are past due and require attention:</p>
          </div>
          <div className="payments-table-container">
            <table className="payments-table overdue">
              <thead>
                <tr>
                  <th>Expense</th>
                  <th>Category</th>
                  <th>Period</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {reportData.overdue_payments.map((payment, index) => (
                  <tr key={index} className="overdue-row">
                    <td>{payment.expense_name}</td>
                    <td>{payment.category_name}</td>
                    <td>{formatPeriod(payment.period)}</td>
                    <td>{formatCurrency(payment.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top Categories */}
      {reportData.top_categories && reportData.top_categories.length > 0 && (
        <div className="report-section">
          <h4>🏆 Top Expense Categories</h4>
          <div className="top-categories">
            {reportData.top_categories.slice(0, 10).map((category, index) => (
              <div key={index} className="category-rank">
                <div className="rank-number">#{index + 1}</div>
                <div className="category-info">
                  <div className="category-name">{category.category_name}</div>
                  <div className="category-type">{category.category_type}</div>
                </div>
                <div className="category-stats">
                  <div className="annual-total">{formatCurrency(category.annual_total)}</div>
                  <div className="expense-count">{category.expense_count} expenses</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Monthly Forecast Chart */}
      {reportData.monthly_forecast && reportData.monthly_forecast.length > 0 && (
        <div className="report-section">
          <h4>📈 12-Month Forecast</h4>
          <div className="forecast-chart">
            {/* Group forecast by period and calculate totals */}
            {(() => {
              const forecastByPeriod = reportData.monthly_forecast.reduce((acc, item) => {
                if (!acc[item.period]) {
                  acc[item.period] = { total: 0, categories: 0 };
                }
                acc[item.period].total += item.total_amount;
                acc[item.period].categories += 1;
                return acc;
              }, {});

              const periods = Object.keys(forecastByPeriod).sort().slice(0, 12);
              const maxAmount = Math.max(...periods.map(p => forecastByPeriod[p].total));

              return (
                <div className="chart-container">
                  {periods.map(period => {
                    const data = forecastByPeriod[period];
                    const heightPercent = maxAmount > 0 ? (data.total / maxAmount) * 100 : 0;
                    
                    return (
                      <div key={period} className="chart-bar">
                        <div 
                          className="bar" 
                          style={{ height: `${Math.max(heightPercent, 2)}%` }}
                          title={`${formatPeriod(period)}: ${formatCurrency(data.total)}`}
                        />
                        <div className="bar-label">
                          <div className="period-label">{formatPeriod(period)}</div>
                          <div className="amount-label">{formatCurrency(data.total)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Export Options */}
      <div className="report-section">
        <h4>📁 Export Options</h4>
        <div className="export-buttons">
          <button className="btn btn-outline">
            📊 Export to Excel
          </button>
          <button className="btn btn-outline">
            📄 Generate PDF Report
          </button>
          <button className="btn btn-outline">
            📧 Email Report
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExpenseReports;