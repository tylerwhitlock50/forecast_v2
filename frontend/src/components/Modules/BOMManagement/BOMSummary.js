import React, { useMemo } from 'react';
import './BOMManagement.css';

const BOMSummary = ({ boms, bomItems, units }) => {
  const summaryData = useMemo(() => {
    // Ensure arrays are defined and not null
    const safeBoms = boms || [];
    const safeBomItems = bomItems || [];
    
    const totalBOMs = safeBoms.length;
    
    // Version breakdown
    const versionBreakdown = safeBoms.reduce((acc, bom) => {
      const version = bom.version || '1.0';
      acc[version] = (acc[version] || 0) + 1;
      return acc;
    }, {});
    
    // Cost analysis
    const totalMaterialCost = safeBomItems.reduce((sum, item) => sum + (item.material_cost || 0), 0);
    const totalTargetCost = safeBomItems.reduce((sum, item) => sum + (item.target_cost || 0), 0);
    const avgMaterialCost = totalBOMs > 0 ? totalMaterialCost / totalBOMs : 0;
    const avgTargetCost = totalBOMs > 0 ? totalTargetCost / totalBOMs : 0;
    const costVariance = totalMaterialCost - totalTargetCost;
    
    // Item analysis
    const totalItems = safeBomItems.length;
    const avgItemsPerBOM = totalBOMs > 0 ? totalItems / totalBOMs : 0;
    
    // Material type breakdown
    const materialTypes = safeBomItems.reduce((acc, item) => {
      const description = item.material_description || 'Unknown';
      const type = getItemType(description);
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    
    // Unit breakdown
    const unitBreakdown = safeBomItems.reduce((acc, item) => {
      const unit = item.unit || 'each';
      acc[unit] = (acc[unit] || 0) + 1;
      return acc;
    }, {});
    
    // Cost per BOM breakdown
    const bomCosts = safeBoms.map(bom => {
      const bomTotal = safeBomItems
        .filter(item => item.bom_id === bom.bom_id)
        .reduce((sum, item) => sum + (item.material_cost || 0), 0);
      return { bom_id: bom.bom_id, cost: bomTotal };
    }).sort((a, b) => b.cost - a.cost);
    
    // Data completeness
    const withTargetCost = safeBomItems.filter(item => item.target_cost && item.target_cost > 0).length;
    const withUnitPrice = safeBomItems.filter(item => item.unit_price && item.unit_price > 0).length;
    const withQuantity = safeBomItems.filter(item => item.qty && item.qty > 0).length;
    
    // Complete BOMs
    const completeBOMs = safeBoms.filter(bom => {
      const bomItemCount = safeBomItems.filter(item => item.bom_id === bom.bom_id).length;
      const completeItems = safeBomItems.filter(item => 
        item.bom_id === bom.bom_id && 
        item.material_description && 
        item.qty > 0 && 
        item.unit_price > 0
      ).length;
      return bomItemCount > 0 && completeItems === bomItemCount;
    }).length;
    
    return {
      totalBOMs,
      versionBreakdown,
      costStats: {
        totalMaterialCost,
        totalTargetCost,
        avgMaterialCost,
        avgTargetCost,
        costVariance
      },
      itemStats: {
        totalItems,
        avgItemsPerBOM
      },
      materialTypes,
      unitBreakdown,
      bomCosts: bomCosts.slice(0, 5), // Top 5 most expensive BOMs
      completeness: {
        withTargetCost,
        withUnitPrice,
        withQuantity
      },
      dataQuality: {
        completeBOMs,
        incompleteBOMs: totalBOMs - completeBOMs
      }
    };
  }, [boms, bomItems]);

  const topVersions = Object.entries(summaryData.versionBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const topMaterialTypes = Object.entries(summaryData.materialTypes)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const topUnits = Object.entries(summaryData.unitBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const formatCurrency = (value) => {
    return `$${Number(value).toFixed(2)}`;
  };

  return (
    <div className="bom-summary">
      <div className="summary-header">
        <h3>BOM Analytics</h3>
        <p>Overview of your Bill of Materials and cost structure</p>
      </div>

      <div className="summary-grid">
        {/* Key Metrics */}
        <div className="summary-section">
          <h4>Key Metrics</h4>
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-icon">📋</div>
              <div className="metric-content">
                <span className="metric-value">{summaryData.totalBOMs}</span>
                <span className="metric-label">Total BOMs</span>
              </div>
            </div>
            
            <div className="metric-card">
              <div className="metric-icon">✅</div>
              <div className="metric-content">
                <span className="metric-value">{summaryData.dataQuality.completeBOMs}</span>
                <span className="metric-label">Complete BOMs</span>
              </div>
            </div>
            
            <div className="metric-card">
              <div className="metric-icon">💰</div>
              <div className="metric-content">
                <span className="metric-value">{formatCurrency(summaryData.costStats.totalMaterialCost)}</span>
                <span className="metric-label">Total Material Cost</span>
              </div>
            </div>
            
            <div className="metric-card">
              <div className="metric-icon">📦</div>
              <div className="metric-content">
                <span className="metric-value">{summaryData.itemStats.totalItems}</span>
                <span className="metric-label">Total Items</span>
              </div>
            </div>
          </div>
        </div>

        {/* Cost Analysis */}
        <div className="summary-section">
          <h4>Cost Analysis</h4>
          <div className="analysis-grid">
            <div className="analysis-item">
              <span className="analysis-label">Average Material Cost</span>
              <span className="analysis-value">{formatCurrency(summaryData.costStats.avgMaterialCost)}</span>
            </div>
            <div className="analysis-item">
              <span className="analysis-label">Average Target Cost</span>
              <span className="analysis-value">{formatCurrency(summaryData.costStats.avgTargetCost)}</span>
            </div>
            <div className="analysis-item">
              <span className="analysis-label">Cost Variance</span>
              <span className={`analysis-value ${summaryData.costStats.costVariance > 0 ? 'over' : summaryData.costStats.costVariance < 0 ? 'under' : 'on-target'}`}>
                {summaryData.costStats.costVariance > 0 ? '+' : ''}{formatCurrency(summaryData.costStats.costVariance)}
              </span>
            </div>
            <div className="analysis-item">
              <span className="analysis-label">Average Items per BOM</span>
              <span className="analysis-value">{summaryData.itemStats.avgItemsPerBOM.toFixed(1)}</span>
            </div>
          </div>
        </div>

        {/* Top Expensive BOMs */}
        <div className="summary-section">
          <h4>Most Expensive BOMs</h4>
          <div className="chart-container">
            {summaryData.bomCosts.map(({bom_id, cost}) => (
              <div key={bom_id} className="chart-bar">
                <div className="bar-label">{bom_id}</div>
                <div className="bar-container">
                  <div 
                    className="bar" 
                    style={{ 
                      width: `${summaryData.bomCosts.length > 0 ? (cost / summaryData.bomCosts[0].cost) * 100 : 0}%`,
                      backgroundColor: '#dc3545'
                    }}
                  ></div>
                  <span className="bar-value">{formatCurrency(cost)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Material Type Distribution */}
        <div className="summary-section">
          <h4>Material Type Distribution</h4>
          <div className="chart-container">
            {topMaterialTypes.map(([type, count]) => (
              <div key={type} className="chart-bar">
                <div className="bar-label">{type}</div>
                <div className="bar-container">
                  <div 
                    className="bar" 
                    style={{ 
                      width: `${(count / summaryData.itemStats.totalItems) * 100}%`,
                      backgroundColor: getMaterialTypeColor(type)
                    }}
                  ></div>
                  <span className="bar-value">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Unit Distribution */}
        <div className="summary-section">
          <h4>Unit Distribution</h4>
          <div className="chart-container">
            {topUnits.map(([unit, count]) => (
              <div key={unit} className="chart-bar">
                <div className="bar-label">{unit}</div>
                <div className="bar-container">
                  <div 
                    className="bar" 
                    style={{ 
                      width: `${(count / summaryData.itemStats.totalItems) * 100}%`,
                      backgroundColor: '#17a2b8'
                    }}
                  ></div>
                  <span className="bar-value">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Data Completeness */}
        <div className="summary-section">
          <h4>Data Completeness</h4>
          <div className="quality-metrics">
            <div className="quality-item">
              <span className="quality-label">Complete BOMs</span>
              <div className="quality-bar">
                <div 
                  className="quality-fill" 
                  style={{ 
                    width: `${(summaryData.dataQuality.completeBOMs / summaryData.totalBOMs) * 100}%`,
                    backgroundColor: '#28a745'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.dataQuality.completeBOMs}</span>
            </div>
            
            <div className="quality-item">
              <span className="quality-label">With Target Cost</span>
              <div className="quality-bar">
                <div 
                  className="quality-fill" 
                  style={{ 
                    width: `${(summaryData.completeness.withTargetCost / summaryData.itemStats.totalItems) * 100}%`,
                    backgroundColor: '#007bff'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.completeness.withTargetCost}</span>
            </div>
            
            <div className="quality-item">
              <span className="quality-label">With Unit Price</span>
              <div className="quality-bar">
                <div 
                  className="quality-fill" 
                  style={{ 
                    width: `${(summaryData.completeness.withUnitPrice / summaryData.itemStats.totalItems) * 100}%`,
                    backgroundColor: '#ffc107'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.completeness.withUnitPrice}</span>
            </div>
            
            <div className="quality-item">
              <span className="quality-label">With Quantity</span>
              <div className="quality-bar">
                <div 
                  className="quality-fill" 
                  style={{ 
                    width: `${(summaryData.completeness.withQuantity / summaryData.itemStats.totalItems) * 100}%`,
                    backgroundColor: '#6f42c1'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.completeness.withQuantity}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Recommendations */}
      <div className="summary-section recommendations">
        <h4>Recommendations</h4>
        <div className="recommendations-list">
          {summaryData.dataQuality.incompleteBOMs > 0 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">⚠️</span>
              <span className="recommendation-text">
                {summaryData.dataQuality.incompleteBOMs} BOMs have incomplete data. 
                Consider adding missing quantities, unit prices, or target costs.
              </span>
            </div>
          )}
          
          {summaryData.costStats.costVariance > summaryData.costStats.totalTargetCost * 0.1 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">💰</span>
              <span className="recommendation-text">
                Material costs are {((summaryData.costStats.costVariance / summaryData.costStats.totalTargetCost) * 100).toFixed(1)}% 
                over target. Review high-cost items for potential savings.
              </span>
            </div>
          )}
          
          {summaryData.completeness.withTargetCost < summaryData.itemStats.totalItems * 0.8 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">🎯</span>
              <span className="recommendation-text">
                Only {Math.round((summaryData.completeness.withTargetCost / summaryData.itemStats.totalItems) * 100)}% of items have target costs. 
                Target costs help track cost performance and identify savings opportunities.
              </span>
            </div>
          )}
          
          {summaryData.itemStats.avgItemsPerBOM < 3 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">📦</span>
              <span className="recommendation-text">
                BOMs have relatively few items (avg: {summaryData.itemStats.avgItemsPerBOM.toFixed(1)}). 
                Ensure all necessary materials and components are included.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Helper functions
const getItemType = (description) => {
  const desc = description.toLowerCase();
  if (desc.includes('packaging') || desc.includes('box') || desc.includes('bag')) return 'Packaging';
  if (desc.includes('material') || desc.includes('raw')) return 'Raw Material';
  if (desc.includes('component') || desc.includes('part')) return 'Component';
  if (desc.includes('hardware') || desc.includes('screw') || desc.includes('bolt')) return 'Hardware';
  if (desc.includes('adhesive') || desc.includes('glue') || desc.includes('tape')) return 'Adhesive';
  if (desc.includes('finish') || desc.includes('paint') || desc.includes('coating')) return 'Finishing';
  return 'Other';
};

const getMaterialTypeColor = (type) => {
  const colors = {
    'Packaging': '#007bff',
    'Raw Material': '#28a745',
    'Component': '#ffc107',
    'Hardware': '#dc3545',
    'Adhesive': '#6f42c1',
    'Finishing': '#fd7e14',
    'Other': '#6c757d'
  };
  return colors[type] || '#6c757d';
};

export default BOMSummary;