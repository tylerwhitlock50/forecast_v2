import React, { useMemo } from 'react';


const ProductSummary = ({ products }) => {
  const summaryData = useMemo(() => {
    const totalProducts = products.length;
    
    // Product types breakdown
    const typeBreakdown = products.reduce((acc, product) => {
      const type = product.unit_type || 'General';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    
    // Price range analysis
    const prices = products.map(p => parseFloat(p.base_price) || 0).filter(p => p > 0);
    const avgPrice = prices.length > 0 ? prices.reduce((sum, price) => sum + price, 0) / prices.length : 0;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
    const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
    
    // BOM usage
    const bomUsage = products.reduce((acc, product) => {
      const bom = product.bom || 'None';
      acc[bom] = (acc[bom] || 0) + 1;
      return acc;
    }, {});
    
    // Router usage
    const routerUsage = products.reduce((acc, product) => {
      const router = product.router || 'None';
      acc[router] = (acc[router] || 0) + 1;
      return acc;
    }, {});
    
    // Data completeness
    const withDescription = products.filter(p => p.unit_description).length;
    const withPrice = products.filter(p => p.base_price && parseFloat(p.base_price) > 0).length;
    const withBOM = products.filter(p => p.bom).length;
    const withRouter = products.filter(p => p.router).length;
    
    // Data quality metrics
    const completeProfiles = products.filter(p => 
      p.unit_name && p.base_price && p.bom && p.router
    ).length;
    
    return {
      totalProducts,
      typeBreakdown,
      priceMetrics: {
        average: avgPrice,
        maximum: maxPrice,
        minimum: minPrice,
        withPrice
      },
      bomUsage,
      routerUsage,
      dataQuality: {
        completeProfiles,
        incompleteProfiles: totalProducts - completeProfiles
      },
      completeness: {
        withDescription,
        withPrice,
        withBOM,
        withRouter
      }
    };
  }, [products]);

  const topProductTypes = Object.entries(summaryData.typeBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const topBOMs = Object.entries(summaryData.bomUsage)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const topRouters = Object.entries(summaryData.routerUsage)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  return (
    <div className="product-summary">
      <div className="summary-header">
        <h3>Product Analytics</h3>
        <p>Overview of your product catalog</p>
      </div>

      <div className="summary-grid">
        {/* Key Metrics */}
        <div className="summary-section">
          <h4>Key Metrics</h4>
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-icon">📦</div>
              <div className="metric-content">
                <span className="metric-value">{summaryData.totalProducts}</span>
                <span className="metric-label">Total Products</span>
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
                <span className="metric-value">${summaryData.priceMetrics.average.toFixed(2)}</span>
                <span className="metric-label">Avg Price</span>
              </div>
            </div>
            
            <div className="metric-card">
              <div className="metric-icon">🏭</div>
              <div className="metric-content">
                <span className="metric-value">{summaryData.completeness.withBOM}</span>
                <span className="metric-label">With BOM</span>
              </div>
            </div>
          </div>
        </div>

        {/* Product Types */}
        <div className="summary-section">
          <h4>Product Types</h4>
          <div className="chart-container">
            {topProductTypes.map(([type, count]) => (
              <div key={type} className="chart-bar">
                <div className="bar-label">{type}</div>
                <div className="bar-container">
                  <div 
                    className="bar" 
                    style={{ 
                      width: `${(count / summaryData.totalProducts) * 100}%`,
                      backgroundColor: getTypeColor(type)
                    }}
                  ></div>
                  <span className="bar-value">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* BOM Usage */}
        <div className="summary-section">
          <h4>BOM Usage</h4>
          <div className="chart-container">
            {topBOMs.map(([bom, count]) => (
              <div key={bom} className="chart-bar">
                <div className="bar-label">{bom}</div>
                <div className="bar-container">
                  <div 
                    className="bar" 
                    style={{ 
                      width: `${(count / summaryData.totalProducts) * 100}%`,
                      backgroundColor: getBOMColor(bom)
                    }}
                  ></div>
                  <span className="bar-value">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Router Usage */}
        <div className="summary-section">
          <h4>Router Usage</h4>
          <div className="chart-container">
            {topRouters.map(([router, count]) => (
              <div key={router} className="chart-bar">
                <div className="bar-label">{router}</div>
                <div className="bar-container">
                  <div 
                    className="bar" 
                    style={{ 
                      width: `${(count / summaryData.totalProducts) * 100}%`,
                      backgroundColor: getRouterColor(router)
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
                    width: `${(summaryData.dataQuality.completeProfiles / summaryData.totalProducts) * 100}%`,
                    backgroundColor: '#28a745'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.dataQuality.completeProfiles}</span>
            </div>
            
            <div className="quality-item">
              <span className="quality-label">With Description</span>
              <div className="quality-bar">
                <div 
                  className="quality-fill" 
                  style={{ 
                    width: `${(summaryData.completeness.withDescription / summaryData.totalProducts) * 100}%`,
                    backgroundColor: '#007bff'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.completeness.withDescription}</span>
            </div>
            
            <div className="quality-item">
              <span className="quality-label">With Price</span>
              <div className="quality-bar">
                <div 
                  className="quality-fill" 
                  style={{ 
                    width: `${(summaryData.completeness.withPrice / summaryData.totalProducts) * 100}%`,
                    backgroundColor: '#ffc107'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.completeness.withPrice}</span>
            </div>
            
            <div className="quality-item">
              <span className="quality-label">With Router</span>
              <div className="quality-bar">
                <div 
                  className="quality-fill" 
                  style={{ 
                    width: `${(summaryData.completeness.withRouter / summaryData.totalProducts) * 100}%`,
                    backgroundColor: '#6f42c1'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.completeness.withRouter}</span>
            </div>
          </div>
        </div>

        {/* Price Analysis */}
        <div className="summary-section">
          <h4>Price Analysis</h4>
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-icon">💰</div>
              <div className="metric-content">
                <span className="metric-value">${summaryData.priceMetrics.average.toFixed(2)}</span>
                <span className="metric-label">Average Price</span>
              </div>
            </div>
            
            <div className="metric-card">
              <div className="metric-icon">📈</div>
              <div className="metric-content">
                <span className="metric-value">${summaryData.priceMetrics.maximum.toFixed(2)}</span>
                <span className="metric-label">Highest Price</span>
              </div>
            </div>
            
            <div className="metric-card">
              <div className="metric-icon">📉</div>
              <div className="metric-content">
                <span className="metric-value">${summaryData.priceMetrics.minimum.toFixed(2)}</span>
                <span className="metric-label">Lowest Price</span>
              </div>
            </div>
            
            <div className="metric-card">
              <div className="metric-icon">📊</div>
              <div className="metric-content">
                <span className="metric-value">{summaryData.priceMetrics.withPrice}</span>
                <span className="metric-label">Priced Products</span>
              </div>
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
                {summaryData.dataQuality.incompleteProfiles} products have incomplete profiles. 
                Consider adding missing BOM and router information for accurate costing.
              </span>
            </div>
          )}
          
          {summaryData.completeness.withPrice < summaryData.totalProducts * 0.8 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">💰</span>
              <span className="recommendation-text">
                Only {Math.round((summaryData.completeness.withPrice / summaryData.totalProducts) * 100)}% of products have pricing. 
                Base prices are crucial for revenue forecasting.
              </span>
            </div>
          )}
          
          {summaryData.completeness.withBOM < summaryData.totalProducts * 0.8 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">🏭</span>
              <span className="recommendation-text">
                Only {Math.round((summaryData.completeness.withBOM / summaryData.totalProducts) * 100)}% of products have BOM assignments. 
                BOMs are essential for accurate cost calculations.
              </span>
            </div>
          )}
          
          {Object.keys(summaryData.typeBreakdown).length < 3 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">🏷️</span>
              <span className="recommendation-text">
                Product types are not well diversified. Consider adding more product type categories for better organization.
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
    'each': '#007bff',
    'unit': '#28a745',
    'piece': '#ffc107',
    'set': '#6f42c1',
    'kit': '#17a2b8',
    'box': '#e83e8c',
    'case': '#fd7e14',
    'pallet': '#6c757d',
    'General': '#6c757d'
  };
  return colors[type] || '#6c757d';
};

const getBOMColor = (bom) => {
  const colors = {
    'BOM-001': '#007bff',
    'BOM-002': '#28a745',
    'BOM-003': '#ffc107',
    'None': '#6c757d'
  };
  return colors[bom] || '#6c757d';
};

const getRouterColor = (router) => {
  const colors = {
    'R0001': '#007bff',
    'R0002': '#28a745',
    'R0003': '#ffc107',
    'None': '#6c757d'
  };
  return colors[router] || '#6c757d';
};

export default ProductSummary; 