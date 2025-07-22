import React, { useMemo } from 'react';


const CustomerValidation = ({ customers }) => {
  const validationResults = useMemo(() => {
    const issues = [];
    const warnings = [];
    const stats = {
      total: customers.length,
      valid: 0,
      withIssues: 0,
      withWarnings: 0
    };

    customers.forEach((customer, index) => {
      const customerIssues = [];
      const customerWarnings = [];

      // Required field validation
      if (!customer.customer_name || (typeof customer.customer_name === 'string' && customer.customer_name.trim() === '') || customer.customer_name === null || customer.customer_name === undefined) {
        customerIssues.push('Missing customer name');
      }

      if (!customer.customer_id || (typeof customer.customer_id === 'string' && customer.customer_id.trim() === '') || customer.customer_id === null || customer.customer_id === undefined) {
        customerIssues.push('Missing customer ID');
      }

      // Email validation
      if (customer.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(customer.email)) {
          customerIssues.push('Invalid email format');
        }
      } else {
        customerWarnings.push('No email address provided');
      }

      // Phone validation
      if (customer.phone) {
        const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
        const cleanPhone = customer.phone.replace(/[\s\-\(\)]/g, '');
        if (!phoneRegex.test(cleanPhone)) {
          customerWarnings.push('Phone number format may be invalid');
        }
      } else {
        customerWarnings.push('No phone number provided');
      }

      // Duplicate check
      const duplicateName = customers.find((c, i) => 
        i !== index && 
        c.customer_name && 
        c.customer_name.toLowerCase() === customer.customer_name?.toLowerCase()
      );
      if (duplicateName) {
        customerWarnings.push('Duplicate customer name detected');
      }

      // Data completeness check
      const hasCompleteProfile = customer.customer_name && customer.email && customer.phone && customer.address;
      if (!hasCompleteProfile) {
        customerWarnings.push('Incomplete profile information');
      }

      // Add to overall stats
      if (customerIssues.length > 0) {
        issues.push({
          customer,
          issues: customerIssues
        });
        stats.withIssues++;
      } else if (customerWarnings.length > 0) {
        warnings.push({
          customer,
          warnings: customerWarnings
        });
        stats.withWarnings++;
      } else {
        stats.valid++;
      }
    });

    return { issues, warnings, stats };
  }, [customers]);

  const getSeverityClass = (type) => {
    return type === 'error' ? 'validation-error' : 'validation-warning';
  };

  const getSeverityIcon = (type) => {
    return type === 'error' ? '❌' : '⚠️';
  };

  return (
    <div className="customer-validation">
      <div className="validation-header">
        <h3>Data Validation</h3>
        <p>Quality check results for your customer database</p>
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
                  <span className="customer-name">{item.customer.customer_name || 'Unnamed Customer'}</span>
                  <span className="customer-id">({item.customer.customer_id})</span>
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
                  <span className="customer-name">{item.customer.customer_name || 'Unnamed Customer'}</span>
                  <span className="customer-id">({item.customer.customer_id})</span>
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
            <p>Your customer database looks great! All records are valid and complete.</p>
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

export default CustomerValidation; 