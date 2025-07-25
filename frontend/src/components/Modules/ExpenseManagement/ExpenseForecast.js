import React, { useState, useEffect } from 'react';
import api from '../../../lib/apiClient';

const ExpenseForecast = ({ expenses, categories, allocations, onFetchAllocations }) => {
  const [forecastPeriods, setForecastPeriods] = useState(12); // months
  const [selectedCategory, setSelectedCategory] = useState('');
  const [forecastData, setForecastData] = useState([]);

  useEffect(() => {
    fetchForecastData();
  }, [forecastPeriods, selectedCategory]);

  const fetchForecastData = async () => {
    try {
      const today = new Date();
      const startPeriod = today.toISOString().slice(0, 7); // YYYY-MM
      const endDate = new Date(today.getFullYear(), today.getMonth() + forecastPeriods, 0);
      const endPeriod = endDate.toISOString().slice(0, 7);
      
      const queryParams = new URLSearchParams({
        start_period: startPeriod,
        end_period: endPeriod
      });
      
      if (selectedCategory) {
        queryParams.append('category_type', selectedCategory);
      }

      const response = await api.get(`/expenses/forecast?${queryParams}`, { suppressErrorToast: true });
      setForecastData(response.data);
    } catch (error) {
      console.error('Error fetching forecast data:', error);
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

  // Group forecast data by period
  const forecastByPeriod = forecastData.reduce((acc, item) => {
    if (!acc[item.period]) {
      acc[item.period] = [];
    }
    acc[item.period].push(item);
    return acc;
  }, {});

  // Calculate period totals
  const periodTotals = Object.keys(forecastByPeriod).reduce((acc, period) => {
    acc[period] = forecastByPeriod[period].reduce((sum, item) => sum + item.total_amount, 0);
    return acc;
  }, {});

  // Generate period list for next N months
  const generatePeriods = () => {
    const periods = [];
    const today = new Date();
    for (let i = 0; i < forecastPeriods; i++) {
      const date = new Date(today.getFullYear(), today.getMonth() + i, 1);
      periods.push(date.toISOString().slice(0, 7));
    }
    return periods;
  };

  const periods = generatePeriods();

  return (
    <div className="expense-forecast">
      <div className="forecast-header">
        <h3>Expense Forecast</h3>
        <div className="forecast-controls">
          <div className="control-group">
            <label>Forecast Periods:</label>
            <select 
              value={forecastPeriods} 
              onChange={(e) => setForecastPeriods(parseInt(e.target.value))}
            >
              <option value={6}>6 Months</option>
              <option value={12}>12 Months</option>
              <option value={18}>18 Months</option>
              <option value={24}>24 Months</option>
            </select>
          </div>
          
          <div className="control-group">
            <label>Category Type:</label>
            <select 
              value={selectedCategory} 
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="">All Categories</option>
              <option value="factory_overhead">Factory Overhead</option>
              <option value="admin_expense">Admin Expenses</option>
              <option value="cogs">Cost of Goods Sold</option>
            </select>
          </div>
          
          <button 
            className="btn btn-outline"
            onClick={fetchForecastData}
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      <div className="forecast-summary">
        <div className="summary-card">
          <div className="summary-value">
            {formatCurrency(Object.values(periodTotals).reduce((sum, total) => sum + total, 0))}
          </div>
          <div className="summary-label">Total Forecast</div>
          <div className="summary-sublabel">{forecastPeriods} months</div>
        </div>
        
        <div className="summary-card">
          <div className="summary-value">
            {formatCurrency(Object.values(periodTotals).reduce((sum, total) => sum + total, 0) / forecastPeriods)}
          </div>
          <div className="summary-label">Average Monthly</div>
          <div className="summary-sublabel">Expected amount</div>
        </div>
        
        <div className="summary-card">
          <div className="summary-value">
            {Math.max(...Object.values(periodTotals).map(t => t || 0)).toLocaleString()}
          </div>
          <div className="summary-label">Peak Month</div>
          <div className="summary-sublabel">Highest expense</div>
        </div>
      </div>

      <div className="forecast-table-container">
        <table className="forecast-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Scheduled</th>
              <th>Amortized</th>
              <th>One-time</th>
              <th>Total</th>
              <th>Categories</th>
            </tr>
          </thead>
          <tbody>
            {periods.map(period => {
              const periodData = forecastByPeriod[period] || [];
              const total = periodTotals[period] || 0;
              const scheduled = periodData.reduce((sum, item) => sum + item.total_scheduled, 0);
              const amortized = periodData.reduce((sum, item) => sum + item.total_amortized, 0);
              const oneTime = periodData.reduce((sum, item) => sum + item.total_one_time, 0);
              const categoryCount = periodData.length;

              return (
                <tr key={period} className={total > 0 ? 'has-expenses' : 'no-expenses'}>
                  <td className="period-cell">
                    <div className="period-main">{formatPeriod(period)}</div>
                    <div className="period-code">{period}</div>
                  </td>
                  
                  <td className="amount-cell">
                    <div className="amount">{formatCurrency(scheduled)}</div>
                    {scheduled > 0 && (
                      <div className="amount-percent">
                        {total > 0 ? Math.round((scheduled / total) * 100) : 0}%
                      </div>
                    )}
                  </td>
                  
                  <td className="amount-cell">
                    <div className="amount">{formatCurrency(amortized)}</div>
                    {amortized > 0 && (
                      <div className="amount-percent">
                        {total > 0 ? Math.round((amortized / total) * 100) : 0}%
                      </div>
                    )}
                  </td>
                  
                  <td className="amount-cell">
                    <div className="amount">{formatCurrency(oneTime)}</div>
                    {oneTime > 0 && (
                      <div className="amount-percent">
                        {total > 0 ? Math.round((oneTime / total) * 100) : 0}%
                      </div>
                    )}
                  </td>
                  
                  <td className="total-cell">
                    <div className="total-amount">{formatCurrency(total)}</div>
                  </td>
                  
                  <td className="categories-cell">
                    {categoryCount > 0 ? (
                      <div className="category-summary">
                        <span className="category-count">{categoryCount} categories</span>
                        <button 
                          className="btn btn-sm btn-outline"
                          onClick={() => onFetchAllocations(null, period)}
                        >
                          View Details
                        </button>
                      </div>
                    ) : (
                      <span className="no-categories">No expenses</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {allocations && allocations.length > 0 && (
        <div className="allocation-details">
          <h4>Allocation Details</h4>
          <div className="allocation-table-container">
            <table className="allocation-table">
              <thead>
                <tr>
                  <th>Expense</th>
                  <th>Category</th>
                  <th>Period</th>
                  <th>Amount</th>
                  <th>Type</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {allocations.map(allocation => (
                  <tr key={allocation.allocation_id}>
                    <td>{allocation.expense_name}</td>
                    <td>{allocation.category_name}</td>
                    <td>{formatPeriod(allocation.period)}</td>
                    <td>{formatCurrency(allocation.allocated_amount)}</td>
                    <td>
                      <span className={`allocation-type ${allocation.allocation_type}`}>
                        {allocation.allocation_type}
                      </span>
                    </td>
                    <td>
                      <span className={`payment-status ${allocation.payment_status}`}>
                        {allocation.payment_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {forecastData.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">📈</div>
          <h3>No forecast data</h3>
          <p>Add expenses to see forecast projections.</p>
        </div>
      )}
    </div>
  );
};

export default ExpenseForecast;