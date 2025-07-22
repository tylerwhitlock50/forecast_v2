import React, { useMemo } from 'react';


const BOMValidation = ({ boms, bomItems, units }) => {
  // Ensure arrays are defined and not null
  const safeBoms = boms || [];
  const safeBomItems = bomItems || [];
  
  const validationResults = useMemo(() => {
    const issues = [];
    const warnings = [];
    
    // 1. BOMs without items
    const bomsWithoutItems = safeBoms.filter(bom => {
      const itemCount = safeBomItems.filter(item => item.bom_id === bom.bom_id).length;
      return itemCount === 0;
    });
    
    if (bomsWithoutItems.length > 0) {
      issues.push({
        type: 'error',
        category: 'Missing Data',
        title: 'BOMs Without Items',
        description: `${bomsWithoutItems.length} BOMs have no items defined`,
        items: bomsWithoutItems.map(bom => bom.bom_id),
        severity: 'high'
      });
    }
    
    // 2. Items without material descriptions
    const itemsWithoutDescription = safeBomItems.filter(item => 
      !item.material_description || (typeof item.material_description === 'string' && item.material_description.trim() === '') || item.material_description === null || item.material_description === undefined
    );
    
    if (itemsWithoutDescription.length > 0) {
      issues.push({
        type: 'error',
        category: 'Missing Data',
        title: 'Items Without Description',
        description: `${itemsWithoutDescription.length} BOM items missing material descriptions`,
        items: itemsWithoutDescription.map(item => `${item.bom_id} Line ${item.bom_line}`),
        severity: 'high'
      });
    }
    
    // 3. Items with zero or negative quantities
    const itemsWithBadQuantity = safeBomItems.filter(item => 
      !item.qty || item.qty <= 0
    );
    
    if (itemsWithBadQuantity.length > 0) {
      warnings.push({
        type: 'warning',
        category: 'Data Quality',
        title: 'Items With Invalid Quantities',
        description: `${itemsWithBadQuantity.length} items have zero or negative quantities`,
        items: itemsWithBadQuantity.map(item => `${item.bom_id} Line ${item.bom_line}: ${item.material_description}`),
        severity: 'medium'
      });
    }
    
    // 4. Items without unit prices
    const itemsWithoutPrice = safeBomItems.filter(item => 
      !item.unit_price || item.unit_price <= 0
    );
    
    if (itemsWithoutPrice.length > 0) {
      warnings.push({
        type: 'warning',
        category: 'Costing',
        title: 'Items Without Unit Prices',
        description: `${itemsWithoutPrice.length} items missing unit prices`,
        items: itemsWithoutPrice.map(item => `${item.bom_id} Line ${item.bom_line}: ${item.material_description}`),
        severity: 'medium'
      });
    }
    
    // 5. Items without target costs
    const itemsWithoutTarget = safeBomItems.filter(item => 
      !item.target_cost || item.target_cost <= 0
    );
    
    if (itemsWithoutTarget.length > 0) {
      warnings.push({
        type: 'warning',
        category: 'Costing',
        title: 'Items Without Target Costs',
        description: `${itemsWithoutTarget.length} items missing target costs`,
        items: itemsWithoutTarget.map(item => `${item.bom_id} Line ${item.bom_line}: ${item.material_description}`),
        severity: 'low'
      });
    }
    
    // 6. Cost variance validation
    const itemsWithHighVariance = safeBomItems.filter(item => {
      if (!item.material_cost || !item.target_cost) return false;
      const variance = Math.abs(item.material_cost - item.target_cost);
      const variancePercent = (variance / item.target_cost) * 100;
      return variancePercent > 20; // More than 20% variance
    });
    
    if (itemsWithHighVariance.length > 0) {
      warnings.push({
        type: 'warning',
        category: 'Costing',
        title: 'High Cost Variance',
        description: `${itemsWithHighVariance.length} items have >20% cost variance from target`,
        items: itemsWithHighVariance.map(item => {
          const variance = ((item.material_cost - item.target_cost) / item.target_cost * 100).toFixed(1);
          return `${item.bom_id} Line ${item.bom_line}: ${variance}% variance`;
        }),
        severity: 'medium'
      });
    }
    
    // 7. Duplicate line numbers within BOMs
    const duplicateLines = [];
    const bomGroups = safeBomItems.reduce((acc, item) => {
      const key = `${item.bom_id}-${item.version}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});
    
    Object.entries(bomGroups).forEach(([bomKey, items]) => {
      const lineNumbers = items.map(item => item.bom_line);
      const duplicates = lineNumbers.filter((line, index) => lineNumbers.indexOf(line) !== index);
      if (duplicates.length > 0) {
        duplicateLines.push(bomKey);
      }
    });
    
    if (duplicateLines.length > 0) {
      issues.push({
        type: 'error',
        category: 'Data Integrity',
        title: 'Duplicate Line Numbers',
        description: `${duplicateLines.length} BOMs have duplicate line numbers`,
        items: duplicateLines,
        severity: 'high'
      });
    }
    
    // 8. Inconsistent unit usage
    const unitUsage = safeBomItems.reduce((acc, item) => {
      const desc = item.material_description?.toLowerCase() || '';
      if (!acc[desc]) acc[desc] = new Set();
      acc[desc].add(item.unit);
      return acc;
    }, {});
    
    const inconsistentUnits = Object.entries(unitUsage)
      .filter(([desc, units]) => units.size > 1)
      .map(([desc, units]) => `${desc}: ${Array.from(units).join(', ')}`);
    
    if (inconsistentUnits.length > 0) {
      warnings.push({
        type: 'warning',
        category: 'Data Quality',
        title: 'Inconsistent Units',
        description: `${inconsistentUnits.length} materials use different units`,
        items: inconsistentUnits.slice(0, 10), // Limit to 10 items
        severity: 'low'
      });
    }
    
    // 9. BOMs with very few items (potential incomplete BOMs)
    const sparseBOMs = safeBoms.filter(bom => {
      const itemCount = safeBomItems.filter(item => item.bom_id === bom.bom_id).length;
      return itemCount > 0 && itemCount < 3;
    });
    
    if (sparseBOMs.length > 0) {
      warnings.push({
        type: 'warning',
        category: 'Completeness',
        title: 'BOMs With Few Items',
        description: `${sparseBOMs.length} BOMs have less than 3 items (possibly incomplete)`,
        items: sparseBOMs.map(bom => `${bom.bom_id} (${safeBomItems.filter(item => item.bom_id === bom.bom_id).length} items)`),
        severity: 'low'
      });
    }
    
    // 10. Cost calculation mismatches
    const costMismatches = safeBomItems.filter(item => {
      if (!item.qty || !item.unit_price || !item.material_cost) return false;
      const expectedCost = item.qty * item.unit_price;
      const actualCost = item.material_cost;
      const difference = Math.abs(expectedCost - actualCost);
      return difference > 0.01; // More than 1 cent difference
    });
    
    if (costMismatches.length > 0) {
      warnings.push({
        type: 'warning',
        category: 'Calculations',
        title: 'Cost Calculation Mismatches',
        description: `${costMismatches.length} items have material cost ≠ quantity × unit price`,
        items: costMismatches.map(item => {
          const expected = (item.qty * item.unit_price).toFixed(2);
          const actual = item.material_cost.toFixed(2);
          return `${item.bom_id} Line ${item.bom_line}: Expected $${expected}, Actual $${actual}`;
        }),
        severity: 'medium'
      });
    }
    
    return { issues, warnings };
  }, [safeBoms, safeBomItems]);

  const allValidations = [...validationResults.issues, ...validationResults.warnings];
  const errorCount = validationResults.issues.length;
  const warningCount = validationResults.warnings.length;

  const getValidationIcon = (type) => {
    switch (type) {
      case 'error': return '❌';
      case 'warning': return '⚠️';
      default: return 'ℹ️';
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'high': return '#dc3545';
      case 'medium': return '#ffc107';
      case 'low': return '#17a2b8';
      default: return '#6c757d';
    }
  };

  const getHealthScore = () => {
    const totalItems = safeBomItems.length;
    const totalBOMs = safeBoms.length;
    
    if (totalItems === 0) return 0;
    
    // Calculate health based on various factors
    let score = 100;
    
    // Deduct for errors (major impact)
    score -= errorCount * 10;
    
    // Deduct for warnings (minor impact)
    score -= warningCount * 2;
    
    // Bonus for completeness
    const completeItems = bomItems.filter(item => 
      item.material_description && 
      item.qty > 0 && 
      item.unit_price > 0 && 
      item.material_cost > 0
    ).length;
    
    const completenessBonus = (completeItems / totalItems) * 20;
    score += completenessBonus;
    
    return Math.max(0, Math.min(100, score));
  };

  const healthScore = getHealthScore();

  return (
    <div className="bom-validation">
      <div className="validation-header">
        <h3>BOM Data Validation</h3>
        <p>Analysis of data quality, completeness, and consistency</p>
      </div>

      {/* Health Score */}
      <div className="health-score-section">
        <div className="health-score-card">
          <div className="health-score-circle">
            <div 
              className="health-score-fill" 
              style={{ 
                background: `conic-gradient(${healthScore >= 80 ? '#28a745' : healthScore >= 60 ? '#ffc107' : '#dc3545'} ${healthScore * 3.6}deg, #e9ecef 0deg)` 
              }}
            >
              <div className="health-score-inner">
                <span className="health-score-value">{Math.round(healthScore)}</span>
                <span className="health-score-label">Health Score</span>
              </div>
            </div>
          </div>
          <div className="health-score-summary">
            <div className="score-item">
              <span className="score-count error">{errorCount}</span>
              <span className="score-label">Errors</span>
            </div>
            <div className="score-item">
              <span className="score-count warning">{warningCount}</span>
              <span className="score-label">Warnings</span>
            </div>
            <div className="score-item">
              <span className="score-count">{boms.length}</span>
              <span className="score-label">BOMs</span>
            </div>
            <div className="score-item">
                              <span className="score-count">{safeBomItems.length}</span>
              <span className="score-label">Items</span>
            </div>
          </div>
        </div>
      </div>

      {/* Validation Results */}
      <div className="validation-results">
        {allValidations.length === 0 ? (
          <div className="no-issues">
            <div className="no-issues-icon">✅</div>
            <h4>All Good!</h4>
            <p>No validation issues found in your BOM data.</p>
          </div>
        ) : (
          <div className="validation-list">
            {allValidations.map((validation, index) => (
              <div 
                key={index} 
                className={`validation-item ${validation.type}`}
                style={{ borderLeftColor: getSeverityColor(validation.severity) }}
              >
                <div className="validation-header">
                  <div className="validation-title">
                    <span className="validation-icon">{getValidationIcon(validation.type)}</span>
                    <span className="validation-name">{validation.title}</span>
                    <span className="validation-category">{validation.category}</span>
                  </div>
                  <span 
                    className="validation-severity"
                    style={{ backgroundColor: getSeverityColor(validation.severity) }}
                  >
                    {validation.severity}
                  </span>
                </div>
                <p className="validation-description">{validation.description}</p>
                {validation.items && validation.items.length > 0 && (
                  <div className="validation-items">
                    <details>
                      <summary>Show affected items ({validation.items.length})</summary>
                      <ul className="affected-items">
                        {validation.items.slice(0, 20).map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                        {validation.items.length > 20 && (
                          <li className="more-items">... and {validation.items.length - 20} more</li>
                        )}
                      </ul>
                    </details>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Stats */}
      <div className="validation-stats">
        <h4>Quick Statistics</h4>
        <div className="stats-grid">
          <div className="stat-item">
            <span className="stat-label">Total BOMs</span>
            <span className="stat-value">{safeBoms.length}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Total Items</span>
            <span className="stat-value">{safeBomItems.length}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Avg Items per BOM</span>
            <span className="stat-value">{safeBoms.length > 0 ? (safeBomItems.length / safeBoms.length).toFixed(1) : 0}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Unique Materials</span>
            <span className="stat-value">{new Set(safeBomItems.map(item => item.material_description?.toLowerCase())).size}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Complete Items</span>
            <span className="stat-value">
              {safeBomItems.filter(item => 
                item.material_description && 
                item.qty > 0 && 
                item.unit_price > 0
              ).length}
            </span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Data Completeness</span>
            <span className="stat-value">
              {safeBomItems.length > 0 ? 
                Math.round((safeBomItems.filter(item => 
                  item.material_description && 
                  item.qty > 0 && 
                  item.unit_price > 0
                ).length / safeBomItems.length) * 100) : 0}%
            </span>
          </div>
        </div>
      </div>

      {/* Recommendations */}
      {allValidations.length > 0 && (
        <div className="validation-recommendations">
          <h4>Recommendations</h4>
          <div className="recommendations-list">
            {errorCount > 0 && (
              <div className="recommendation error">
                <span className="rec-icon">🚨</span>
                <div className="rec-content">
                  <strong>Address Critical Issues:</strong> Fix {errorCount} error{errorCount !== 1 ? 's' : ''} first as they may prevent proper BOM functionality.
                </div>
              </div>
            )}
            
            {warningCount > 5 && (
              <div className="recommendation warning">
                <span className="rec-icon">📋</span>
                <div className="rec-content">
                  <strong>Data Quality Review:</strong> Consider reviewing data entry processes to reduce the {warningCount} warnings.
                </div>
              </div>
            )}
            
            {safeBomItems.filter(item => !item.target_cost || item.target_cost <= 0).length > safeBomItems.length * 0.5 && (
              <div className="recommendation info">
                <span className="rec-icon">🎯</span>
                <div className="rec-content">
                  <strong>Add Target Costs:</strong> Setting target costs helps track cost performance and identify savings opportunities.
                </div>
              </div>
            )}
            
            {healthScore < 70 && (
              <div className="recommendation warning">
                <span className="rec-icon">💡</span>
                <div className="rec-content">
                  <strong>Improve Data Quality:</strong> Focus on completing missing information and resolving inconsistencies to improve the health score.
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default BOMValidation;