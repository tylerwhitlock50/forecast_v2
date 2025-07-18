import React, { useMemo } from 'react';
import './BillOfMaterialsManagement.css';

const BomValidation = ({ bomDefinitions, bomLines, units }) => {
  const validationResults = useMemo(() => {
    const issues = [];
    const warnings = [];
    const stats = {
      total: bomLines.length,
      valid: 0,
      withIssues: 0,
      withWarnings: 0
    };

    // Create lookup maps for faster validation
    const unitIds = new Set(units.map(u => u.unit_id));
    const bomDefinitionIds = new Set(bomDefinitions.map(b => `${b.bom_id}|${b.version}`));

    bomLines.forEach((line, index) => {
      const lineIssues = [];
      const lineWarnings = [];

      // Required field validation
      if (!line.bom_id || line.bom_id.trim() === '') {
        lineIssues.push('Missing BOM ID');
      }

      if (!line.material_description || line.material_description.trim() === '') {
        lineIssues.push('Missing material description');
      }

      if (!line.qty || line.qty <= 0) {
        lineIssues.push('Invalid quantity (must be positive)');
      }

      if (!line.unit || line.unit.trim() === '') {
        lineIssues.push('Missing unit');
      }

      // Foreign key validation - check if BOM definition exists
      if (line.bom_id && line.version) {
        const bomKey = `${line.bom_id}|${line.version || '1.0'}`;
        if (!bomDefinitionIds.has(bomKey)) {
          lineIssues.push(`BOM definition '${line.bom_id}' v${line.version || '1.0'} does not exist`);
        }
      }

      // Cost validation
      if (line.material_cost !== null && line.material_cost !== undefined) {
        if (isNaN(line.material_cost) || line.material_cost < 0) {
          lineIssues.push('Invalid material cost (must be a non-negative number)');
        } else if (line.material_cost === 0) {
          lineWarnings.push('Material cost is zero');
        } else if (line.material_cost > 10000) {
          lineWarnings.push('Material cost seems unusually high (>$10,000)');
        }
      } else {
        lineWarnings.push('No material cost provided');
      }

      if (line.target_cost !== null && line.target_cost !== undefined) {
        if (isNaN(line.target_cost) || line.target_cost < 0) {
          lineIssues.push('Invalid target cost (must be a non-negative number)');
        } else if (line.target_cost === 0) {
          lineWarnings.push('Target cost is zero');
        } else if (line.target_cost > 10000) {
          lineWarnings.push('Target cost seems unusually high (>$10,000)');
        }
      } else {
        lineWarnings.push('No target cost provided');
      }

      if (line.unit_price !== null && line.unit_price !== undefined) {
        if (isNaN(line.unit_price) || line.unit_price < 0) {
          lineIssues.push('Invalid unit price (must be a non-negative number)');
        } else if (line.unit_price === 0) {
          lineWarnings.push('Unit price is zero');
        } else if (line.unit_price > 1000) {
          lineWarnings.push('Unit price seems unusually high (>$1,000/unit)');
        }
      } else {
        lineWarnings.push('No unit price provided');
      }

      // Quantity validation
      if (line.qty !== null && line.qty !== undefined) {
        if (isNaN(line.qty) || line.qty <= 0) {
          lineIssues.push('Invalid quantity (must be a positive number)');
        } else if (line.qty > 1000000) {
          lineWarnings.push('Quantity seems unusually high (>1,000,000)');
        }
      }

      // Version validation
      if (!line.version || line.version.trim() === '') {
        lineWarnings.push('No version specified');
      }

      // BOM line validation
      if (!line.bom_line || line.bom_line <= 0) {
        lineWarnings.push('Invalid BOM line number');
      }

      // Duplicate check
      const duplicateLine = bomLines.find((l, i) => 
        i !== index && 
        l.bom_id === line.bom_id && 
        l.version === line.version && 
        l.bom_line === line.bom_line
      );
      if (duplicateLine) {
        lineIssues.push('Duplicate BOM line (same ID, version, and line number)');
      }

      // Cost consistency check
      if (line.qty && line.unit_price && line.material_cost) {
        const expectedCost = line.qty * line.unit_price;
        const actualCost = line.material_cost;
        const variance = Math.abs(actualCost - expectedCost);
        const variancePercent = (variance / expectedCost) * 100;
        
        if (variancePercent > 1) { // More than 1% variance
          lineWarnings.push(`Material cost ($${actualCost.toFixed(2)}) doesn't match quantity × unit price ($${expectedCost.toFixed(2)})`);
        }
      }

      // Target cost vs material cost check
      if (line.material_cost && line.target_cost) {
        const variance = Math.abs(line.material_cost - line.target_cost);
        const variancePercent = (variance / line.target_cost) * 100;
        
        if (variancePercent > 20) { // More than 20% variance
          lineWarnings.push(`Large cost variance: material cost ($${line.material_cost.toFixed(2)}) vs target cost ($${line.target_cost.toFixed(2)})`);
        }
      }

      // Data completeness check
      const hasCompleteProfile = line.bom_id && 
                                line.material_description && 
                                line.qty && 
                                line.unit && 
                                line.material_cost;
      if (!hasCompleteProfile) {
        lineWarnings.push('Incomplete profile information');
      }

      // Add to overall stats
      if (lineIssues.length > 0) {
        issues.push({
          line,
          issues: lineIssues
        });
        stats.withIssues++;
      } else if (lineWarnings.length > 0) {
        warnings.push({
          line,
          warnings: lineWarnings
        });
        stats.withWarnings++;
      } else {
        stats.valid++;
      }
    });

    return { issues, warnings, stats };
  }, [bomDefinitions, bomLines, units]);

  const getSeverityClass = (type) => {
    return type === 'error' ? 'validation-error' : 'validation-warning';
  };

  const getSeverityIcon = (type) => {
    return type === 'error' ? '❌' : '⚠️';
  };

  const getBomLineDisplayName = (line) => {
    return `${line.bom_id} v${line.version || '1.0'} - Line ${line.bom_line}`;
  };

  const formatCurrency = (value) => {
    if (value === null || value === undefined) return 'N/A';
    return `$${Number(value).toFixed(2)}`;
  };

  return (
    <div className="bom-validation">
      <div className="validation-header">
        <h3>Data Validation</h3>
        <p>Quality check results for your BOM database</p>
      </div>

      {/* Validation Summary */}
      <div className="validation-summary">
        <div className="summary-card">
          <div className="summary-icon valid">✅</div>
          <div className="summary-content">
            <span className="summary-value">{validationResults.stats.valid}</span>
            <span className="summary-label">Valid BOM Lines</span>
          </div>
        </div>
        
        <div className="summary-card">
          <div className="summary-icon warning">⚠️</div>
          <div className="summary-content">
            <span className="summary-value">{validationResults.stats.withWarnings}</span>
            <span className="summary-label">With Warnings</span>
          </div>
        </div>
        
        <div className="summary-card">
          <div className="summary-icon error">❌</div>
          <div className="summary-content">
            <span className="summary-value">{validationResults.stats.withIssues}</span>
            <span className="summary-label">With Issues</span>
          </div>
        </div>
        
        <div className="summary-card">
          <div className="summary-icon total">📊</div>
          <div className="summary-content">
            <span className="summary-value">{validationResults.stats.total}</span>
            <span className="summary-label">Total BOM Lines</span>
          </div>
        </div>
      </div>

      {/* Critical Issues */}
      {validationResults.issues.length > 0 && (
        <div className="validation-section">
          <h4>
            <span className="section-icon">❌</span>
            Critical Issues ({validationResults.issues.length})
          </h4>
          <div className="validation-list">
            {validationResults.issues.map((item, index) => (
              <div key={index} className={`validation-item ${getSeverityClass('error')}`}>
                <div className="validation-header">
                  <span className="validation-icon">{getSeverityIcon('error')}</span>
                  <span className="bom-name">{getBomLineDisplayName(item.line)}</span>
                  <span className="bom-details">
                    {item.line.material_description} - {item.line.qty} {item.line.unit}
                  </span>
                </div>
                <div className="validation-issues">
                  {item.issues.map((issue, issueIndex) => (
                    <div key={issueIndex} className="issue-item">
                      <span className="issue-bullet">•</span>
                      <span className="issue-text">{issue}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warnings */}
      {validationResults.warnings.length > 0 && (
        <div className="validation-section">
          <h4>
            <span className="section-icon">⚠️</span>
            Warnings ({validationResults.warnings.length})
          </h4>
          <div className="validation-list">
            {validationResults.warnings.map((item, index) => (
              <div key={index} className={`validation-item ${getSeverityClass('warning')}`}>
                <div className="validation-header">
                  <span className="validation-icon">{getSeverityIcon('warning')}</span>
                  <span className="bom-name">{getBomLineDisplayName(item.line)}</span>
                  <span className="bom-details">
                    {item.line.material_description} - {item.line.qty} {item.line.unit} - 
                    Cost: {formatCurrency(item.line.material_cost)} | 
                    Target: {formatCurrency(item.line.target_cost)}
                  </span>
                </div>
                <div className="validation-issues">
                  {item.warnings.map((warning, warningIndex) => (
                    <div key={warningIndex} className="issue-item">
                      <span className="issue-bullet">•</span>
                      <span className="issue-text">{warning}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Clear Message */}
      {validationResults.issues.length === 0 && validationResults.warnings.length === 0 && (
        <div className="validation-section">
          <div className="all-clear">
            <div className="all-clear-icon">🎉</div>
            <h4>All Clear!</h4>
            <p>Your BOM database looks great! All BOM lines are valid and complete.</p>
          </div>
        </div>
      )}

      {/* Data Quality Score */}
      <div className="validation-section">
        <h4>Data Quality Score</h4>
        <div className="quality-score">
          <div className="score-circle" style={{'--score': (validationResults.stats.valid / validationResults.stats.total) * 100}}>
            <div className="score-value">
              {Math.round((validationResults.stats.valid / validationResults.stats.total) * 100)}%
            </div>
            <div className="score-label">Quality Score</div>
          </div>
          <div className="score-breakdown">
            <div className="breakdown-item">
              <span className="breakdown-label">Valid BOM Lines:</span>
              <span className="breakdown-value">{validationResults.stats.valid}</span>
            </div>
            <div className="breakdown-item">
              <span className="breakdown-label">BOM Lines with Issues:</span>
              <span className="breakdown-value">{validationResults.stats.withIssues}</span>
            </div>
            <div className="breakdown-item">
              <span className="breakdown-label">BOM Lines with Warnings:</span>
              <span className="breakdown-value">{validationResults.stats.withWarnings}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Recommendations */}
      <div className="validation-section">
        <h4>Recommendations</h4>
        <div className="recommendations-list">
          {validationResults.issues.length > 0 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">🔧</span>
              <span className="recommendation-text">
                Fix {validationResults.issues.length} critical issues to improve data quality.
              </span>
            </div>
          )}
          
          {validationResults.warnings.length > 0 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">📝</span>
              <span className="recommendation-text">
                Address {validationResults.warnings.length} warnings to enhance data completeness.
              </span>
            </div>
          )}
          
          {validationResults.stats.valid < validationResults.stats.total * 0.8 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">📊</span>
              <span className="recommendation-text">
                Consider implementing data validation rules to prevent future issues.
              </span>
            </div>
          )}
          
          {validationResults.stats.valid === validationResults.stats.total && (
            <div className="recommendation-item">
              <span className="recommendation-icon">🌟</span>
              <span className="recommendation-text">
                Excellent data quality! Consider setting up automated validation checks.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BomValidation; 