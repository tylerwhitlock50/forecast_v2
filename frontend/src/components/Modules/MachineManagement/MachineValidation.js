import React, { useMemo } from 'react';


const MachineValidation = ({ machines }) => {
  const validationResults = useMemo(() => {
    const issues = [];
    const warnings = [];
    const stats = {
      total: machines.length,
      valid: 0,
      withIssues: 0,
      withWarnings: 0
    };

    machines.forEach((machine, index) => {
      const machineIssues = [];
      const machineWarnings = [];

      // Required field validation
      if (!machine.machine_name || (typeof machine.machine_name === 'string' && machine.machine_name.trim() === '') || machine.machine_name === null || machine.machine_name === undefined) {
        machineIssues.push('Missing machine name');
      }

      if (!machine.machine_id || (typeof machine.machine_id === 'string' && machine.machine_id.trim() === '') || machine.machine_id === null || machine.machine_id === undefined) {
        machineIssues.push('Missing machine ID');
      }

      // Rate validation
      if (machine.machine_rate !== null && machine.machine_rate !== undefined) {
        if (isNaN(machine.machine_rate) || machine.machine_rate < 0) {
          machineIssues.push('Invalid machine rate (must be a positive number)');
        } else if (machine.machine_rate === 0) {
          machineWarnings.push('Machine rate is zero');
        } else if (machine.machine_rate > 1000) {
          machineWarnings.push('Machine rate seems unusually high (>$1000/hour)');
        }
      } else {
        machineWarnings.push('No machine rate provided');
      }

      // Capacity validation
      if (machine.available_minutes_per_month !== null && machine.available_minutes_per_month !== undefined) {
        if (isNaN(machine.available_minutes_per_month) || machine.available_minutes_per_month < 0) {
          machineIssues.push('Invalid capacity (must be a positive number)');
        } else if (machine.available_minutes_per_month === 0) {
          machineWarnings.push('Machine capacity is zero');
        } else if (machine.available_minutes_per_month > 50000) {
          machineWarnings.push('Machine capacity seems unusually high (>50,000 min/month)');
        }
      } else {
        machineWarnings.push('No capacity information provided');
      }

      // Labor type validation
      if (!machine.labor_type || (typeof machine.labor_type === 'string' && machine.labor_type.trim() === '') || machine.labor_type === null || machine.labor_type === undefined) {
        machineWarnings.push('No labor type specified');
      }

      // Description validation
      if (!machine.machine_description || (typeof machine.machine_description === 'string' && machine.machine_description.trim() === '') || machine.machine_description === null || machine.machine_description === undefined) {
        machineWarnings.push('No machine description provided');
      }

      // Duplicate check
      const duplicateName = machines.find((m, i) => 
        i !== index && 
        m.machine_name && 
        m.machine_name.toLowerCase() === machine.machine_name?.toLowerCase()
      );
      if (duplicateName) {
        machineWarnings.push('Duplicate machine name detected');
      }

      const duplicateId = machines.find((m, i) => 
        i !== index && 
        m.machine_id && 
        m.machine_id.toLowerCase() === machine.machine_id?.toLowerCase()
      );
      if (duplicateId) {
        machineIssues.push('Duplicate machine ID detected');
      }

      // Data completeness check
      const hasCompleteProfile = machine.machine_name && 
                                machine.machine_rate && 
                                machine.labor_type && 
                                machine.available_minutes_per_month;
      if (!hasCompleteProfile) {
        machineWarnings.push('Incomplete profile information');
      }

      // Add to overall stats
      if (machineIssues.length > 0) {
        issues.push({
          machine,
          issues: machineIssues
        });
        stats.withIssues++;
      } else if (machineWarnings.length > 0) {
        warnings.push({
          machine,
          warnings: machineWarnings
        });
        stats.withWarnings++;
      } else {
        stats.valid++;
      }
    });

    return { issues, warnings, stats };
  }, [machines]);

  const getSeverityClass = (type) => {
    return type === 'error' ? 'validation-error' : 'validation-warning';
  };

  const getSeverityIcon = (type) => {
    return type === 'error' ? '❌' : '⚠️';
  };

  return (
    <div className="machine-validation">
      <div className="validation-header">
        <h3>Data Validation</h3>
        <p>Quality check results for your machine database</p>
      </div>

      {/* Validation Summary */}
      <div className="validation-summary">
        <div className="summary-card">
          <div className="summary-icon valid">✅</div>
          <div className="summary-content">
            <span className="summary-value">{validationResults.stats.valid}</span>
            <span className="summary-label">Valid Records</span>
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
            <span className="summary-label">Total Records</span>
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
                  <span className="machine-name">{item.machine.machine_name || 'Unnamed Machine'}</span>
                  <span className="machine-id">({item.machine.machine_id})</span>
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
                  <span className="machine-name">{item.machine.machine_name || 'Unnamed Machine'}</span>
                  <span className="machine-id">({item.machine.machine_id})</span>
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
            <p>Your machine database looks great! All records are valid and complete.</p>
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
              <span className="breakdown-label">Valid Records:</span>
              <span className="breakdown-value">{validationResults.stats.valid}</span>
            </div>
            <div className="breakdown-item">
              <span className="breakdown-label">Records with Issues:</span>
              <span className="breakdown-value">{validationResults.stats.withIssues}</span>
            </div>
            <div className="breakdown-item">
              <span className="breakdown-label">Records with Warnings:</span>
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

export default MachineValidation;