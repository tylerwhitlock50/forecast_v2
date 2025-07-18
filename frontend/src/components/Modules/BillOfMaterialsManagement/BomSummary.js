import React, { useMemo } from 'react';
import './BillOfMaterialsManagement.css';

const BomSummary = ({ bomDefinitions, bomLines, units }) => {
  const summaryData = useMemo(() => {
    const totalBomDefinitions = bomDefinitions.length;
    const totalBomLines = bomLines.length;
    
    // Version breakdown (from BOM definitions)
    const versionBreakdown = bomDefinitions.reduce((acc, bom) => {
      const version = bom.version || '1.0';
      acc[version] = (acc[version] || 0) + 1;
      return acc;
    }, {});
    
    // BOM breakdown (how many lines per BOM)
    const bomBreakdown = bomLines.reduce((acc, line) => {
      const bomId = line.bom_id || 'Unknown';
      acc[bomId] = (acc[bomId] || 0) + 1;
      return acc;
    }, {});
    
    // Unit breakdown (from BOM lines)
    const unitBreakdown = bomLines.reduce((acc, line) => {
      const unit = line.unit || 'Unknown';
      acc[unit] = (acc[unit] || 0) + 1;
      return acc;
    }, {});
    
    // Cost statistics (from BOM lines)
    const costsWithValues = bomLines.filter(b => b.material_cost && b.material_cost > 0);
    const totalMaterialCost = costsWithValues.reduce((sum, b) => sum + b.material_cost, 0);
    const avgMaterialCost = costsWithValues.length > 0 
      ? totalMaterialCost / costsWithValues.length 
      : 0;
    const maxMaterialCost = costsWithValues.length > 0 
      ? Math.max(...costsWithValues.map(b => b.material_cost)) 
      : 0;
    
    // Target cost statistics (from BOM lines)
    const targetCostsWithValues = bomLines.filter(b => b.target_cost && b.target_cost > 0);
    const totalTargetCost = targetCostsWithValues.reduce((sum, b) => sum + b.target_cost, 0);
    const avgTargetCost = targetCostsWithValues.length > 0 
      ? totalTargetCost / targetCostsWithValues.length 
      : 0;
    
    // Price statistics (from BOM lines)
    const pricesWithValues = bomLines.filter(b => b.unit_price && b.unit_price > 0);
    const avgUnitPrice = pricesWithValues.length > 0 
      ? pricesWithValues.reduce((sum, b) => sum + b.unit_price, 0) / pricesWithValues.length 
      : 0;
    
    // Data completeness (from BOM lines)
    const withMaterialCost = bomLines.filter(b => b.material_cost && b.material_cost > 0).length;
    const withTargetCost = bomLines.filter(b => b.target_cost && b.target_cost > 0).length;
    const withUnitPrice = bomLines.filter(b => b.unit_price && b.unit_price > 0).length;
    const withDescription = bomLines.filter(b => b.material_description && b.material_description.trim()).length;
    const withQuantity = bomLines.filter(b => b.qty && b.qty > 0).length;
    const withUnit = bomLines.filter(b => b.unit && b.unit.trim()).length;
    
    // Complete profiles (BOM lines with all required data)
    const completeProfiles = bomLines.filter(b => 
      b.bom_id && b.material_description && b.qty && b.unit && b.material_cost
    ).length;
    
    // Unique BOMs
    const uniqueBoms = new Set(bomLines.map(b => b.bom_id)).size;
    
    // Cost variance analysis (from BOM lines)
    const costVariance = bomLines.filter(b => b.material_cost && b.target_cost).map(b => ({
      bom_id: b.bom_id,
      material_cost: b.material_cost,
      target_cost: b.target_cost,
      variance: b.material_cost - b.target_cost,
      variance_percent: b.target_cost > 0 ? ((b.material_cost - b.target_cost) / b.target_cost) * 100 : 0
    }));
    
    const avgVariance = costVariance.length > 0 
      ? costVariance.reduce((sum, v) => sum + v.variance_percent, 0) / costVariance.length 
      : 0;
    
    // BOM definitions with lines
    const bomsWithLines = bomDefinitions.filter(bom => 
      bomLines.some(line => line.bom_id === bom.bom_id && (line.version || '1.0') === bom.version)
    ).length;
    
    return {
      totalBomDefinitions,
      totalBomLines,
      uniqueBoms,
      bomsWithLines,
      versionBreakdown,
      bomBreakdown,
      unitBreakdown,
      costStats: {
        totalMaterialCost,
        avgMaterialCost,
        maxMaterialCost,
        withMaterialCost
      },
      targetCostStats: {
        totalTargetCost,
        avgTargetCost,
        withTargetCost
      },
      priceStats: {
        avgUnitPrice,
        withUnitPrice
      },
      completeness: {
        withMaterialCost,
        withTargetCost,
        withUnitPrice,
        withDescription,
        withQuantity,
        withUnit
      },
      dataQuality: {
        completeProfiles,
        incompleteProfiles: totalBomLines - completeProfiles
      },
      costVariance: {
        items: costVariance,
        avgVariance
      }
    };
  }, [bomDefinitions, bomLines]);

  const topVersions = Object.entries(summaryData.versionBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const topBoms = Object.entries(summaryData.bomBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const topUnits = Object.entries(summaryData.unitBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const formatCurrency = (value) => {
    return `$${value.toFixed(2)}`;
  };

  const formatNumber = (value) => {
    return Number(value).toLocaleString();
  };

  return (
    <div className="bom-summary">
      <div className="summary-header">
        <h3>BOM Analytics</h3>
        <p>Overview of your bill of materials and cost structure</p>
      </div>

      <div className="summary-grid">
        {/* Key Metrics */}
        <div className="summary-section">
          <h4>Key Metrics</h4>
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-icon">📋</div>
              <div className="metric-content">
                <span className="metric-value">{summaryData.totalBomDefinitions}</span>
                <span className="metric-label">BOM Definitions</span>
              </div>
            </div>
            
            <div className="metric-card">
              <div className="metric-icon">📝</div>
              <div className="metric-content">
                <span className="metric-value">{summaryData.totalBomLines}</span>
                <span className="metric-label">Total BOM Lines</span>
              </div>
            </div>
            
            <div className="metric-card">
              <div className="metric-icon">✅</div>
              <div className="metric-content">
                <span className="metric-value">{summaryData.dataQuality.completeProfiles}</span>
                <span className="metric-label">Complete Lines</span>
              </div>
            </div>
            
            <div className="metric-card">
              <div className="metric-icon">💰</div>
              <div className="metric-content">
                <span className="metric-value">{formatCurrency(summaryData.costStats.totalMaterialCost)}</span>
                <span className="metric-label">Total Material Cost</span>
              </div>
            </div>
          </div>
        </div>

        {/* Version Distribution */}
        <div className="summary-section">
          <h4>BOM Version Distribution</h4>
          <div className="chart-container">
            {topVersions.map(([version, count]) => (
              <div key={version} className="chart-bar">
                <div className="bar-label">{version}</div>
                <div className="bar-container">
                  <div 
                    className="bar" 
                    style={{ 
                      width: `${(count / summaryData.totalBomDefinitions) * 100}%`,
                      backgroundColor: '#007bff'
                    }}
                  ></div>
                  <span className="bar-value">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* BOM Lines Distribution */}
        <div className="summary-section">
          <h4>Lines per BOM</h4>
          <div className="chart-container">
            {topBoms.map(([bomId, count]) => (
              <div key={bomId} className="chart-bar">
                <div className="bar-label">{bomId}</div>
                <div className="bar-container">
                  <div 
                    className="bar" 
                    style={{ 
                      width: `${(count / summaryData.totalBomLines) * 100}%`,
                      backgroundColor: '#28a745'
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
                      width: `${(count / summaryData.totalBomLines) * 100}%`,
                      backgroundColor: '#ffc107'
                    }}
                  ></div>
                  <span className="bar-value">{count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Cost Analysis */}
        <div className="summary-section">
          <h4>Cost Analysis</h4>
          <div className="analysis-grid">
            <div className="analysis-item">
              <span className="analysis-label">Avg Material Cost</span>
              <span className="analysis-value">{formatCurrency(summaryData.costStats.avgMaterialCost)}</span>
            </div>
            <div className="analysis-item">
              <span className="analysis-label">Max Material Cost</span>
              <span className="analysis-value">{formatCurrency(summaryData.costStats.maxMaterialCost)}</span>
            </div>
            <div className="analysis-item">
              <span className="analysis-label">Avg Unit Price</span>
              <span className="analysis-value">{formatCurrency(summaryData.priceStats.avgUnitPrice)}</span>
            </div>
            <div className="analysis-item">
              <span className="analysis-label">Avg Target Cost</span>
              <span className="analysis-value">{formatCurrency(summaryData.targetCostStats.avgTargetCost)}</span>
            </div>
            <div className="analysis-item">
              <span className="analysis-label">Avg Cost Variance</span>
              <span className="analysis-value">{summaryData.costVariance.avgVariance.toFixed(1)}%</span>
            </div>
            <div className="analysis-item">
              <span className="analysis-label">Total Target Cost</span>
              <span className="analysis-value">{formatCurrency(summaryData.targetCostStats.totalTargetCost)}</span>
            </div>
          </div>
        </div>

        {/* Data Completeness */}
        <div className="summary-section">
          <h4>Data Completeness</h4>
          <div className="quality-metrics">
            <div className="quality-item">
              <span className="quality-label">Complete Lines</span>
              <div className="quality-bar">
                <div 
                  className="quality-fill" 
                  style={{ 
                    width: `${(summaryData.dataQuality.completeProfiles / summaryData.totalBomLines) * 100}%`,
                    backgroundColor: '#28a745'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.dataQuality.completeProfiles}</span>
            </div>
            
            <div className="quality-item">
              <span className="quality-label">With Material Cost</span>
              <div className="quality-bar">
                <div 
                  className="quality-fill" 
                  style={{ 
                    width: `${(summaryData.completeness.withMaterialCost / summaryData.totalBomLines) * 100}%`,
                    backgroundColor: '#007bff'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.completeness.withMaterialCost}</span>
            </div>
            
            <div className="quality-item">
              <span className="quality-label">With Target Cost</span>
              <div className="quality-bar">
                <div 
                  className="quality-fill" 
                  style={{ 
                    width: `${(summaryData.completeness.withTargetCost / summaryData.totalBomLines) * 100}%`,
                    backgroundColor: '#ffc107'
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
                    width: `${(summaryData.completeness.withUnitPrice / summaryData.totalBomLines) * 100}%`,
                    backgroundColor: '#6f42c1'
                  }}
                ></div>
              </div>
              <span className="quality-value">{summaryData.completeness.withUnitPrice}</span>
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
                {summaryData.dataQuality.incompleteProfiles} BOM lines have incomplete data. 
                Consider adding missing material costs, descriptions, or quantities.
              </span>
            </div>
          )}
          
          {summaryData.completeness.withMaterialCost < summaryData.totalBomLines * 0.8 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">💰</span>
              <span className="recommendation-text">
                Only {Math.round((summaryData.completeness.withMaterialCost / summaryData.totalBomLines) * 100)}% of BOM lines have material costs. 
                Cost information is crucial for accurate pricing and profitability analysis.
              </span>
            </div>
          )}
          
          {summaryData.completeness.withTargetCost < summaryData.totalBomLines * 0.5 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">🎯</span>
              <span className="recommendation-text">
                Only {Math.round((summaryData.completeness.withTargetCost / summaryData.totalBomLines) * 100)}% of BOM lines have target costs. 
                Target costs help track cost variance and identify improvement opportunities.
              </span>
            </div>
          )}
          
          {Math.abs(summaryData.costVariance.avgVariance) > 10 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">📊</span>
              <span className="recommendation-text">
                Average cost variance is {summaryData.costVariance.avgVariance.toFixed(1)}%. 
                Consider reviewing material costs and supplier pricing to align with targets.
              </span>
            </div>
          )}
          
          {summaryData.bomsWithLines < summaryData.totalBomDefinitions && (
            <div className="recommendation-item">
              <span className="recommendation-icon">📋</span>
              <span className="recommendation-text">
                {summaryData.totalBomDefinitions - summaryData.bomsWithLines} BOM definitions have no lines. 
                Consider adding BOM lines or removing unused BOM definitions.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BomSummary; 