import React, { useMemo } from 'react';


const CustomerSummary = ({ customers }) => {
  const summaryData = useMemo(() => {
    const totalCustomers = customers.length;
    
    // Customer types breakdown
    const typeBreakdown = customers.reduce((acc, customer) => {
      const type = customer.customer_type || 'General';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    
    // Region breakdown
    const regionBreakdown = customers.reduce((acc, customer) => {
      const region = customer.region || 'Unknown';
      acc[region] = (acc[region] || 0) + 1;
      return acc;
    }, {});
    
    // Contact completeness
    const withEmail = customers.filter(c => c.email).length;
    const withPhone = customers.filter(c => c.phone).length;
    const withAddress = customers.filter(c => c.address).length;
    const withContactPerson = customers.filter(c => c.contact_person).length;
    
    // Data quality metrics
    const completeProfiles = customers.filter(c => 
      c.customer_name && c.email && c.phone && c.address
    ).length;
    
    return {
      totalCustomers,
      typeBreakdown,
      regionBreakdown,
      contactMetrics: {
        withEmail,
        withPhone,
        withAddress,
        withContactPerson
      },
      dataQuality: {
        completeProfiles,
        incompleteProfiles: totalCustomers - completeProfiles
      }
    };
  }, [customers]);

  const topCustomerTypes = Object.entries(summaryData.typeBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const topRegions = Object.entries(summaryData.regionBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  return (
    <div className="customer-summary">
      <div className="summary-header">
        <h3>Customer Analytics</h3>
        <p>Overview of your customer database</p>
      </div>

      <div className="summary-grid">
        {/* Key Metrics */}
        <div className="summary-section">
          <h4>Key Metrics</h4>
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-icon">👥</div>
              <div className="metric-content">
                <span className="metric-value">{summaryData.totalCustomers}</span>
                <span className="metric-label">Total Customers</span>
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
              <div className="metric-icon">📧</div>
              <div className="metric-content">
                <span className="metric-value">{summaryData.contactMetrics.withEmail}</span>
                <span className="metric-label">With Email</span>
              </div>
            </div>
            
            <div className="metric-card">
              <div className="metric-icon">📞</div>
              <div className="metric-content">
                <span className="metric-value">{summaryData.contactMetrics.withPhone}</span>
                <span className="metric-label">With Phone</span>
              </div>
            </div>
          </div>
        </div>

        {/* Customer Types */}
        <div className="summary-section">
          <h4>Customer Types</h4>
          <div className="chart-container">
            {topCustomerTypes.map(([type, count]) => (
              <div key={type} className="chart-bar">
                <div className="bar-label">{type}</div>
                <div className="bar-container">
                  <div 
                    className="bar" 
                    style={{ 
                      width: `${(count / summaryData.totalCustomers) * 100}%`,
                      backgroundColor: getTypeColor(type)
                    }}
                  ></div>
                  <span className="bar-value">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Regional Distribution */}
        <div className="summary-section">
          <h4>Regional Distribution</h4>
          <div className="chart-container">
            {topRegions.map(([region, count]) => (
              <div key={region} className="chart-bar">
                <div className="bar-label">{region}</div>
                <div className="bar-container">
                  <div 
                    className="bar" 
                    style={{ 
                      width: `${(count / summaryData.totalCustomers) * 100}%`,
                      backgroundColor: getRegionColor(region)
                    }}
                  ></div>
                  <span className="bar-value">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Data Quality */}
        <div className="summary-section">
          <h4>Data Quality</h4>
          <div className="quality-metrics">
            <div className="quality-item">
              <span className="quality-label">Complete Profiles</span>
              <div className="quality-bar">
                <div 
                  className="quality-fill" 
                  style={{ 
                    width: `${(summaryData.dataQuality.completeProfiles / summaryData.totalCustomers) * 100}%`,
                    backgroundColor: '#28a745'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.dataQuality.completeProfiles}</span>
            </div>
            
            <div className="quality-item">
              <span className="quality-label">With Email</span>
              <div className="quality-bar">
                <div 
                  className="quality-fill" 
                  style={{ 
                    width: `${(summaryData.contactMetrics.withEmail / summaryData.totalCustomers) * 100}%`,
                    backgroundColor: '#007bff'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.contactMetrics.withEmail}</span>
            </div>
            
            <div className="quality-item">
              <span className="quality-label">With Phone</span>
              <div className="quality-bar">
                <div 
                  className="quality-fill" 
                  style={{ 
                    width: `${(summaryData.contactMetrics.withPhone / summaryData.totalCustomers) * 100}%`,
                    backgroundColor: '#ffc107'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.contactMetrics.withPhone}</span>
            </div>
            
            <div className="quality-item">
              <span className="quality-label">With Address</span>
              <div className="quality-bar">
                <div 
                  className="quality-fill" 
                  style={{ 
                    width: `${(summaryData.contactMetrics.withAddress / summaryData.totalCustomers) * 100}%`,
                    backgroundColor: '#6f42c1'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.contactMetrics.withAddress}</span>
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
                {summaryData.dataQuality.incompleteProfiles} customers have incomplete profiles. 
                Consider reaching out to gather missing information.
              </span>
            </div>
          )}
          
          {summaryData.contactMetrics.withEmail < summaryData.totalCustomers * 0.8 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">📧</span>
              <span className="recommendation-text">
                Only {Math.round((summaryData.contactMetrics.withEmail / summaryData.totalCustomers) * 100)}% of customers have email addresses. 
                Email addresses are crucial for marketing campaigns.
              </span>
            </div>
          )}
          
          {Object.keys(summaryData.typeBreakdown).length < 3 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">🏷️</span>
              <span className="recommendation-text">
                Customer types are not well diversified. Consider adding more customer type categories.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Helper functions for colors
const getTypeColor = (type) => {
  const colors = {
    'Enterprise': '#007bff',
    'SMB': '#28a745',
    'Startup': '#ffc107',
    'Government': '#6f42c1',
    'Education': '#17a2b8',
    'Healthcare': '#e83e8c',
    'Retail': '#fd7e14',
    'Manufacturing': '#6c757d',
    'Other': '#6c757d',
    'General': '#6c757d'
  };
  return colors[type] || '#6c757d';
};

const getRegionColor = (region) => {
  const colors = {
    'North America': '#007bff',
    'Europe': '#28a745',
    'Asia Pacific': '#ffc107',
    'Latin America': '#e83e8c',
    'Middle East': '#fd7e14',
    'Africa': '#6f42c1',
    'Unknown': '#6c757d'
  };
  return colors[region] || '#6c757d';
};

export default CustomerSummary; 