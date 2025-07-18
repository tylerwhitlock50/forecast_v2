import React, { useMemo } from 'react';
import './LaborRateManagement.css';

const LaborRateSummary = ({ laborRates }) => {
  const stats = useMemo(() => {
    const rates = Array.isArray(laborRates) ? laborRates : [];
    
    // Basic statistics
    const totalRates = rates.length;
    const rateAmounts = rates.map(rate => parseFloat(rate.rate_amount) || 0);
    const averageRate = rateAmounts.length > 0 ? rateAmounts.reduce((a, b) => a + b, 0) / rateAmounts.length : 0;
    const minRate = rateAmounts.length > 0 ? Math.min(...rateAmounts) : 0;
    const maxRate = rateAmounts.length > 0 ? Math.max(...rateAmounts) : 0;
    
    // Rate type distribution
    const rateTypeDistribution = rates.reduce((acc, rate) => {
      const type = rate.rate_type || 'General';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    
    // Rate type averages
    const rateTypeAverages = Object.keys(rateTypeDistribution).reduce((acc, type) => {
      const typeRates = rates.filter(rate => (rate.rate_type || 'General') === type);
      const typeAmounts = typeRates.map(rate => parseFloat(rate.rate_amount) || 0);
      acc[type] = typeAmounts.length > 0 ? typeAmounts.reduce((a, b) => a + b, 0) / typeAmounts.length : 0;
      return acc;
    }, {});
    
    // Rate ranges
    const rateRanges = {
      'Low ($0-$20)': rateAmounts.filter(rate => rate >= 0 && rate <= 20).length,
      'Medium ($20-$40)': rateAmounts.filter(rate => rate > 20 && rate <= 40).length,
      'High ($40-$60)': rateAmounts.filter(rate => rate > 40 && rate <= 60).length,
      'Premium ($60+)': rateAmounts.filter(rate => rate > 60).length
    };
    
    return {
      totalRates,
      averageRate,
      minRate,
      maxRate,
      rateTypeDistribution,
      rateTypeAverages,
      rateRanges
    };
  }, [laborRates]);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount || 0);
  };

  const formatPercent = (value, total) => {
    return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0%';
  };

  return (
    <div className="labor-rate-summary">
      <div className="summary-header">
        <h3>Labor Rate Summary</h3>
        <p>Overview of all labor rates and their distribution</p>
      </div>

      <div className="summary-content">
        <div className="summary-cards">
          <div className="summary-card">
            <div className="card-header">
              <h4>Total Rates</h4>
              <span className="card-icon">⚙️</span>
            </div>
            <div className="card-value">{stats.totalRates}</div>
            <div className="card-subtitle">Active labor rates</div>
          </div>

          <div className="summary-card">
            <div className="card-header">
              <h4>Average Rate</h4>
              <span className="card-icon">📊</span>
            </div>
            <div className="card-value">{formatCurrency(stats.averageRate)}</div>
            <div className="card-subtitle">Per hour</div>
          </div>

          <div className="summary-card">
            <div className="card-header">
              <h4>Rate Range</h4>
              <span className="card-icon">📏</span>
            </div>
            <div className="card-value">
              {formatCurrency(stats.minRate)} - {formatCurrency(stats.maxRate)}
            </div>
            <div className="card-subtitle">Min to Max</div>
          </div>

          <div className="summary-card">
            <div className="card-header">
              <h4>Rate Types</h4>
              <span className="card-icon">🏷️</span>
            </div>
            <div className="card-value">{Object.keys(stats.rateTypeDistribution).length}</div>
            <div className="card-subtitle">Different types</div>
          </div>
        </div>

        <div className="summary-charts">
          <div className="chart-section">
            <h4>Rate Type Distribution</h4>
            <div className="chart-container">
              {Object.entries(stats.rateTypeDistribution).map(([type, count]) => (
                <div key={type} className="chart-bar">
                  <div className="bar-label">
                    <span>{type}</span>
                    <span>{count} rates</span>
                  </div>
                  <div className="bar-container">
                    <div 
                      className="bar-fill"
                      style={{ width: `${(count / stats.totalRates) * 100}%` }}
                    />
                  </div>
                  <div className="bar-percentage">
                    {formatPercent(count, stats.totalRates)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="chart-section">
            <h4>Rate Ranges</h4>
            <div className="chart-container">
              {Object.entries(stats.rateRanges).map(([range, count]) => (
                <div key={range} className="chart-bar">
                  <div className="bar-label">
                    <span>{range}</span>
                    <span>{count} rates</span>
                  </div>
                  <div className="bar-container">
                    <div 
                      className="bar-fill"
                      style={{ width: `${(count / stats.totalRates) * 100}%` }}
                    />
                  </div>
                  <div className="bar-percentage">
                    {formatPercent(count, stats.totalRates)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="summary-tables">
          <div className="table-section">
            <h4>Average Rate by Type</h4>
            <table className="summary-table">
              <thead>
                <tr>
                  <th>Rate Type</th>
                  <th>Count</th>
                  <th>Average Rate</th>
                  <th>Distribution</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(stats.rateTypeAverages).map(([type, avgRate]) => (
                  <tr key={type}>
                    <td>
                      <span className={`type-badge ${type.toLowerCase().replace(/\s+/g, '-')}`}>
                        {type}
                      </span>
                    </td>
                    <td>{stats.rateTypeDistribution[type]}</td>
                    <td>{formatCurrency(avgRate)}</td>
                    <td>
                      <div className="distribution-bar">
                        <div 
                          className="distribution-fill"
                          style={{ width: `${(stats.rateTypeDistribution[type] / stats.totalRates) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LaborRateSummary;