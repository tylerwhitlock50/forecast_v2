import React, { useMemo } from 'react';


const RouterValidation = ({ routers, routerOperations, machines, units, laborRates }) => {
  const validationResults = useMemo(() => {
    const issues = [];
    const warnings = [];
    const stats = {
      total: (routers?.length || 0) + (routerOperations?.length || 0),
      valid: 0,
      withIssues: 0,
      withWarnings: 0
    };

    // Create lookup maps for faster validation
    const machineIds = new Set(machines.map(m => m.machine_id));
    const unitIds = new Set(units.map(u => u.unit_id));
    const laborRateIds = new Set(laborRates.map(r => r.rate_id));

    // Validate router definitions
    if (routers && routers.length > 0) {
      routers.forEach((router, index) => {
      const routerIssues = [];
      const routerWarnings = [];

      // Required field validation
      if (!router.router_id || (typeof router.router_id === 'string' && router.router_id.trim() === '') || router.router_id === null || router.router_id === undefined) {
        routerIssues.push('Missing router ID');
      }

      if (!router.unit_id || (typeof router.unit_id === 'string' && router.unit_id.trim() === '') || router.unit_id === null || router.unit_id === undefined) {
        routerIssues.push('Missing unit ID');
      }

      if (!router.machine_id || (typeof router.machine_id === 'string' && router.machine_id.trim() === '') || router.machine_id === null || router.machine_id === undefined) {
        routerIssues.push('Missing machine ID');
      }

      if (!router.sequence || router.sequence < 1) {
        routerIssues.push('Missing or invalid sequence number');
      }

      // Foreign key validation
      if (router.unit_id && !unitIds.has(router.unit_id)) {
        routerIssues.push(`Unit '${router.unit_id}' does not exist`);
      }

      if (router.machine_id && !machineIds.has(router.machine_id)) {
        routerIssues.push(`Machine '${router.machine_id}' does not exist`);
      }

      if (router.labor_type_id && !laborRateIds.has(router.labor_type_id)) {
        routerIssues.push(`Labor rate '${router.labor_type_id}' does not exist`);
      }

      // Time validation
      if (router.machine_minutes !== null && router.machine_minutes !== undefined) {
        if (isNaN(router.machine_minutes) || router.machine_minutes < 0) {
          routerIssues.push('Invalid machine minutes (must be a positive number)');
        } else if (router.machine_minutes === 0) {
          routerWarnings.push('Machine minutes is zero');
        } else if (router.machine_minutes > 1440) {
          routerWarnings.push('Machine minutes exceeds 24 hours');
        }
      } else {
        routerWarnings.push('No machine minutes specified');
      }

      if (router.labor_minutes !== null && router.labor_minutes !== undefined) {
        if (isNaN(router.labor_minutes) || router.labor_minutes < 0) {
          routerIssues.push('Invalid labor minutes (must be a positive number)');
        } else if (router.labor_minutes === 0) {
          routerWarnings.push('Labor minutes is zero');
        } else if (router.labor_minutes > 1440) {
          routerWarnings.push('Labor minutes exceeds 24 hours');
        }
      } else {
        routerWarnings.push('No labor minutes specified');
      }

      // Version validation
      if (!router.version || (typeof router.version === 'string' && router.version.trim() === '') || router.version === null || router.version === undefined) {
        routerWarnings.push('No version specified (defaulting to 1.0)');
      }

      // Labor rate consistency
      if (!router.labor_type_id && router.labor_minutes && router.labor_minutes > 0) {
        routerWarnings.push('Labor minutes specified but no labor rate assigned');
      }

      // Efficiency warnings
      if (router.machine_minutes && router.labor_minutes && 
          router.machine_minutes > 0 && router.labor_minutes > 0) {
        const ratio = router.labor_minutes / router.machine_minutes;
        if (ratio > 3) {
          routerWarnings.push('Labor time significantly exceeds machine time');
        } else if (ratio < 0.1) {
          routerWarnings.push('Machine time significantly exceeds labor time');
        }
      }

      // Duplicate sequence check within same router/version
      const duplicateSequence = routers.find((r, i) => 
        i !== index && 
        r.router_id === router.router_id &&
        r.version === router.version &&
        r.sequence === router.sequence
      );
      if (duplicateSequence) {
        const versionStr = router.version ? String(router.version) : '1.0';
        routerIssues.push(`Duplicate sequence ${router.sequence} in router ${router.router_id} version ${versionStr}`);
      }

      // Orphaned operations (no matching unit in units table)
      if (router.unit_id && unitIds.size > 0 && !unitIds.has(router.unit_id)) {
        routerWarnings.push('Referenced unit may not exist in units table');
      }

      // Data completeness check
      const hasCompleteProfile = router.router_id && 
                                router.unit_id && 
                                router.machine_id && 
                                router.sequence && 
                                (router.machine_minutes > 0 || router.labor_minutes > 0);
      if (!hasCompleteProfile) {
        routerWarnings.push('Incomplete operation profile');
      }

      // Add to overall stats
      if (routerIssues.length > 0) {
        issues.push({
          router,
          issues: routerIssues
        });
        stats.withIssues++;
      } else if (routerWarnings.length > 0) {
        warnings.push({
          router,
          warnings: routerWarnings
        });
        stats.withWarnings++;
      } else {
        stats.valid++;
      }
    });
    }

    // Validate router operations
    if (routerOperations && routerOperations.length > 0) {
      routerOperations.forEach((operation, index) => {
        const operationIssues = [];
        const operationWarnings = [];

        // Required field validation for operations
        if (!operation.router_id || (typeof operation.router_id === 'string' && operation.router_id.trim() === '') || operation.router_id === null || operation.router_id === undefined) {
          operationIssues.push('Missing router ID');
        }

        if (!operation.machine_id || (typeof operation.machine_id === 'string' && operation.machine_id.trim() === '') || operation.machine_id === null || operation.machine_id === undefined) {
          operationIssues.push('Missing machine ID');
        }

        if (!operation.sequence || operation.sequence < 1) {
          operationIssues.push('Missing or invalid sequence number');
        }

        // Foreign key validation
        if (operation.machine_id && !machineIds.has(operation.machine_id)) {
          operationIssues.push(`Machine '${operation.machine_id}' does not exist`);
        }

        if (operation.labor_type_id && !laborRateIds.has(operation.labor_type_id)) {
          operationIssues.push(`Labor rate '${operation.labor_type_id}' does not exist`);
        }

        // Time validation
        if (operation.machine_minutes !== null && operation.machine_minutes !== undefined) {
          if (isNaN(operation.machine_minutes) || operation.machine_minutes < 0) {
            operationIssues.push('Invalid machine minutes (must be a positive number)');
          } else if (operation.machine_minutes === 0) {
            operationWarnings.push('Machine minutes is zero');
          } else if (operation.machine_minutes > 1440) {
            operationWarnings.push('Machine minutes exceeds 24 hours');
          }
        } else {
          operationWarnings.push('No machine minutes specified');
        }

        if (operation.labor_minutes !== null && operation.labor_minutes !== undefined) {
          if (isNaN(operation.labor_minutes) || operation.labor_minutes < 0) {
            operationIssues.push('Invalid labor minutes (must be a positive number)');
          } else if (operation.labor_minutes === 0) {
            operationWarnings.push('Labor minutes is zero');
          } else if (operation.labor_minutes > 1440) {
            operationWarnings.push('Labor minutes exceeds 24 hours');
          }
        } else {
          operationWarnings.push('No labor minutes specified');
        }

        // Labor rate consistency
        if (!operation.labor_type_id && operation.labor_minutes && operation.labor_minutes > 0) {
          operationWarnings.push('Labor minutes specified but no labor rate assigned');
        }

        // Efficiency warnings
        if (operation.machine_minutes && operation.labor_minutes && 
            operation.machine_minutes > 0 && operation.labor_minutes > 0) {
          const ratio = operation.labor_minutes / operation.machine_minutes;
          if (ratio > 3) {
            operationWarnings.push('Labor time significantly exceeds machine time');
          } else if (ratio < 0.1) {
            operationWarnings.push('Machine time significantly exceeds labor time');
          }
        }

        // Duplicate sequence check within same router
        const duplicateSequence = routerOperations.find((op, i) => 
          i !== index && 
          op.router_id === operation.router_id &&
          op.sequence === operation.sequence
        );
        if (duplicateSequence) {
          operationIssues.push(`Duplicate sequence ${operation.sequence} in router ${operation.router_id}`);
        }

        // Data completeness check
        const hasCompleteProfile = operation.router_id && 
                                  operation.machine_id && 
                                  operation.sequence && 
                                  (operation.machine_minutes > 0 || operation.labor_minutes > 0);
        if (!hasCompleteProfile) {
          operationWarnings.push('Incomplete operation profile');
        }

        // Add to overall stats
        if (operationIssues.length > 0) {
          issues.push({
            router: operation,
            issues: operationIssues
          });
          stats.withIssues++;
        } else if (operationWarnings.length > 0) {
          warnings.push({
            router: operation,
            warnings: operationWarnings
          });
          stats.withWarnings++;
        } else {
          stats.valid++;
        }
      });
    }

    return { issues, warnings, stats };
  }, [routers, routerOperations, machines, units, laborRates]);

  const getSeverityClass = (type) => {
    return type === 'error' ? 'validation-error' : 'validation-warning';
  };

  const getSeverityIcon = (type) => {
    return type === 'error' ? '❌' : '⚠️';
  };

  const getRouterDisplayName = (router) => {
    // Handle both router definitions and router operations
    if (router.version !== null && router.version !== undefined) {
      // Router definition
      const versionStr = String(router.version);
      return `${router.router_id} v${versionStr} seq${router.sequence || 'N/A'}`;
    } else {
      // Router operation
      return `${router.router_id} seq${router.sequence}`;
    }
  };

  return (
    <div className="router-validation">
      <div className="validation-header">
        <h3>Data Validation</h3>
        <p>Quality check results for your router database</p>
      </div>

      {/* Validation Summary */}
      <div className="validation-summary">
        <div className="summary-card">
          <div className="summary-icon valid">✅</div>
          <div className="summary-content">
            <span className="summary-value">{validationResults.stats.valid}</span>
            <span className="summary-label">Valid Operations</span>
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
            <span className="summary-label">Total Operations</span>
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
                  <span className="router-name">{getRouterDisplayName(item.router)}</span>
                  <span className="router-details">
                    {item.router.unit_id ? 
                      `(${item.router.unit_id} → ${item.router.machine_id})` : 
                      `(${item.router.machine_id})`
                    }
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
                  <span className="router-name">{getRouterDisplayName(item.router)}</span>
                  <span className="router-details">
                    {item.router.unit_id ? 
                      `(${item.router.unit_id} → ${item.router.machine_id})` : 
                      `(${item.router.machine_id})`
                    }
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
            <p>Your router database looks great! All operations are valid and complete.</p>
          </div>
        </div>
      )}

      {/* Data Quality Score */}
      <div className="validation-section">
        <h4>Data Quality Score</h4>
        <div className="quality-score">
          <div className="score-circle">
            <div className="score-value">
              {Math.round((validationResults.stats.valid / validationResults.stats.total) * 100)}%
            </div>
            <div className="score-label">Quality Score</div>
          </div>
          <div className="score-breakdown">
            <div className="breakdown-item">
              <span className="breakdown-label">Valid Operations:</span>
              <span className="breakdown-value">{validationResults.stats.valid}</span>
            </div>
            <div className="breakdown-item">
              <span className="breakdown-label">Operations with Issues:</span>
              <span className="breakdown-value">{validationResults.stats.withIssues}</span>
            </div>
            <div className="breakdown-item">
              <span className="breakdown-label">Operations with Warnings:</span>
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
                Focus on missing required fields and invalid foreign key references.
              </span>
            </div>
          )}
          
          {validationResults.warnings.length > 0 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">📝</span>
              <span className="recommendation-text">
                Address {validationResults.warnings.length} warnings to enhance data completeness. 
                Consider adding missing time estimates and labor rate assignments.
              </span>
            </div>
          )}
          
          {validationResults.stats.valid < validationResults.stats.total * 0.8 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">📊</span>
              <span className="recommendation-text">
                Data quality is below 80%. Consider implementing validation rules and 
                regular data quality checks to maintain router accuracy.
              </span>
            </div>
          )}
          
          {validationResults.stats.valid === validationResults.stats.total && (
            <div className="recommendation-item">
              <span className="recommendation-icon">🌟</span>
              <span className="recommendation-text">
                Excellent data quality! Consider setting up automated validation checks 
                to maintain this high standard as your routing data grows.
              </span>
            </div>
          )}
          
          {machines.length === 0 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">🏭</span>
              <span className="recommendation-text">
                No machines found in the database. Router operations require machine assignments 
                for proper scheduling and costing.
              </span>
            </div>
          )}
          
          {units.length === 0 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">📦</span>
              <span className="recommendation-text">
                No units found in the database. Router operations must be linked to units 
                for production planning.
              </span>
            </div>
          )}
          
          {laborRates.length === 0 && (
            <div className="recommendation-item">
              <span className="recommendation-icon">💰</span>
              <span className="recommendation-text">
                No labor rates found in the database. Labor rates are essential for 
                accurate cost calculations in router operations.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RouterValidation;