import React, { useMemo } from 'react';
import './MachineManagement.css';

const MachineSummary = ({ machines }) => {
  const summaryData = useMemo(() => {
    const totalMachines = machines.length;
    
    // Labor type breakdown
    const laborTypeBreakdown = machines.reduce((acc, machine) => {
      const type = machine.labor_type || 'General';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    
    // Rate statistics
    const ratesWithValues = machines.filter(m => m.machine_rate && m.machine_rate > 0);
    const avgRate = ratesWithValues.length > 0 
      ? ratesWithValues.reduce((sum, m) => sum + m.machine_rate, 0) / ratesWithValues.length 
      : 0;
    const minRate = ratesWithValues.length > 0 
      ? Math.min(...ratesWithValues.map(m => m.machine_rate)) 
      : 0;
    const maxRate = ratesWithValues.length > 0 
      ? Math.max(...ratesWithValues.map(m => m.machine_rate)) 
      : 0;
    
    // Capacity statistics
    const capacityWithValues = machines.filter(m => m.available_minutes_per_month && m.available_minutes_per_month > 0);
    const totalCapacity = capacityWithValues.reduce((sum, m) => sum + m.available_minutes_per_month, 0);
    const avgCapacity = capacityWithValues.length > 0 
      ? totalCapacity / capacityWithValues.length 
      : 0;
    
    // Data completeness
    const withRates = machines.filter(m => m.machine_rate && m.machine_rate > 0).length;
    const withCapacity = machines.filter(m => m.available_minutes_per_month && m.available_minutes_per_month > 0).length;
    const withDescription = machines.filter(m => m.machine_description && (typeof m.machine_description === 'string' ? m.machine_description.trim() : true)).length;
    const withLaborType = machines.filter(m => m.labor_type && (typeof m.labor_type === 'string' ? m.labor_type.trim() : true)).length;
    
    // Data quality metrics
    const completeProfiles = machines.filter(m => 
      m.machine_name && m.machine_rate && m.labor_type && m.available_minutes_per_month
    ).length;
    
    return {
      totalMachines,
      laborTypeBreakdown,
      rateStats: {
        avgRate,
        minRate,
        maxRate,
        withRates
      },
      capacityStats: {
        totalCapacity,
        avgCapacity,
        withCapacity
      },
      completeness: {
        withRates,
        withCapacity,
        withDescription,
        withLaborType
      },
      dataQuality: {
        completeProfiles,
        incompleteProfiles: totalMachines - completeProfiles
      }
    };
  }, [machines]);

  const topLaborTypes = Object.entries(summaryData.laborTypeBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const formatCurrency = (value) => {
    return `$${value.toFixed(2)}`;
  };

  const formatMinutes = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  };

  return (
    <div className="machine-summary">
      <div className="summary-header">
        <h3>Machine Analytics</h3>
        <p>Overview of your machine inventory and capacity</p>
      </div>

      <div className="summary-grid">
        {/* Key Metrics */}
        <div className="summary-section">
          <h4>Key Metrics</h4>
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-icon">🏭</div>
              <div className="metric-content">
                <span className="metric-value">{summaryData.totalMachines}</span>
                <span className="metric-label">Total Machines</span>
              </div>
            </div>
            
            <div className="metric-card">
              <div className="metric-icon">✅</div>
              <div className="metric-content">
                <span className="metric-value">{summaryData.dataQuality.completeProfiles}</span>
                <span className="metric-label">Complete Profiles</span>
              </div>
            </div>
            
            <div className="metric-card">
              <div className="metric-icon">💰</div>
              <div className="metric-content">
                <span className="metric-value">{formatCurrency(summaryData.rateStats.avgRate)}</span>
                <span className="metric-label">Avg Rate/Hour</span>
              </div>
            </div>
            
            <div className="metric-card">
              <div className="metric-icon">⏰</div>
              <div className="metric-content">
                <span className="metric-value">{summaryData.capacityStats.totalCapacity.toLocaleString()}</span>
                <span className="metric-label">Total Capacity (min/month)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Labor Type Distribution */}
        <div className="summary-section">
          <h4>Labor Type Distribution</h4>
          <div className="chart-container">
            {topLaborTypes.map(([type, count]) => (
              <div key={type} className="chart-bar">
                <div className="bar-label">{type}</div>
                <div className="bar-container">
                  <div 
                    className="bar" 
                    style={{ 
                      width: `${(count / summaryData.totalMachines) * 100}%`,
                      backgroundColor: getLaborTypeColor(type)
                    }}
                  ></div>
                  <span className="bar-value">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Rate Analysis */}
        <div className="summary-section">
          <h4>Rate Analysis</h4>
          <div className="analysis-grid">
            <div className="analysis-item">
              <span className="analysis-label">Minimum Rate</span>
              <span className="analysis-value">{formatCurrency(summaryData.rateStats.minRate)}</span>
            </div>
            <div className="analysis-item">
              <span className="analysis-label">Maximum Rate</span>
              <span className="analysis-value">{formatCurrency(summaryData.rateStats.maxRate)}</span>
            </div>
            <div className="analysis-item">
              <span className="analysis-label">Average Rate</span>
              <span className="analysis-value">{formatCurrency(summaryData.rateStats.avgRate)}</span>
            </div>
            <div className="analysis-item">
              <span className="analysis-label">Machines with Rates</span>
              <span className="analysis-value">{summaryData.rateStats.withRates} of {summaryData.totalMachines}</span>
            </div>
          </div>
        </div>

        {/* Data Completeness */}
        <div className="summary-section">
          <h4>Data Completeness</h4>
          <div className="quality-metrics">
            <div className="quality-item">
              <span className="quality-label">Complete Profiles</span>
              <div className="quality-bar">
                <div 
                  className="quality-fill" 
                  style={{ 
                    width: `${(summaryData.dataQuality.completeProfiles / summaryData.totalMachines) * 100}%`,
                    backgroundColor: '#28a745'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.dataQuality.completeProfiles}</span>
            </div>
            
            <div className="quality-item">
              <span className="quality-label">With Rates</span>
              <div className="quality-bar">
                <div 
                  className="quality-fill" 
                  style={{ 
                    width: `${(summaryData.completeness.withRates / summaryData.totalMachines) * 100}%`,
                    backgroundColor: '#007bff'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.completeness.withRates}</span>
            </div>
            
            <div className="quality-item">
              <span className="quality-label">With Capacity</span>
              <div className="quality-bar">
                <div 
                  className="quality-fill" 
                  style={{ 
                    width: `${(summaryData.completeness.withCapacity / summaryData.totalMachines) * 100}%`,
                    backgroundColor: '#ffc107'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.completeness.withCapacity}</span>
            </div>
            
            <div className="quality-item">
              <span className="quality-label">With Description</span>
              <div className="quality-bar">
                <div 
                  className="quality-fill" 
                  style={{ 
                    width: `${(summaryData.completeness.withDescription / summaryData.totalMachines) * 100}%`,
                    backgroundColor: '#6f42c1'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.completeness.withDescription}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Recommendations */}
      <div className="summary-section recommendations">
        <h4>Recommendations</h4>
        <div className="recommendations-list">
          {summaryData.dataQuality.incompleteProfiles > 0 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">⚠️</span>
              <span className="recommendation-text">
                {summaryData.dataQuality.incompleteProfiles} machines have incomplete profiles. 
                Consider adding missing rate, capacity, or labor type information.
              </span>
            </div>
          )}
          
          {summaryData.completeness.withRates < summaryData.totalMachines * 0.8 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">💰</span>
              <span className="recommendation-text">
                Only {Math.round((summaryData.completeness.withRates / summaryData.totalMachines) * 100)}% of machines have hourly rates. 
                Rate information is crucial for accurate cost calculations.
              </span>
            </div>
          )}
          
          {summaryData.completeness.withCapacity < summaryData.totalMachines * 0.8 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">⏰</span>
              <span className="recommendation-text">
                Only {Math.round((summaryData.completeness.withCapacity / summaryData.totalMachines) * 100)}% of machines have capacity information. 
                Capacity data is essential for production planning.
              </span>
            </div>
          )}
          
          {Object.keys(summaryData.laborTypeBreakdown).length < 3 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">🏷️</span>
              <span className="recommendation-text">
                Labor types are not well diversified. Consider categorizing machines by their specific functions.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Helper function for labor type colors
const getLaborTypeColor = (type) => {
  const colors = {
    'GENERAL': '#007bff',
    'QUALITY': '#28a745',
    'MACHINE SHOP': '#ffc107',
    'SUPERVISION': '#e83e8c',
    'ENGINEERING': '#6f42c1',
    'SHIPPING': '#17a2b8',
    'ADMIN': '#fd7e14',
    'Press': '#dc3545',
    'Assembly': '#20c997',
    'Trim/Clean': '#6c757d',
    'Other': '#6c757d'
  };
  return colors[type] || '#6c757d';
};

export default MachineSummary;