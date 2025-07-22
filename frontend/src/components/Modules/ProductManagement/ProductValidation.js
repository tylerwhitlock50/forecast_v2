import React, { useMemo } from 'react';


const ProductValidation = ({ products }) => {
  const validationResults = useMemo(() => {
    const issues = [];
    const warnings = [];
    const stats = {
      total: products.length,
      valid: 0,
      withIssues: 0,
      withWarnings: 0
    };

    products.forEach((product, index) => {
      const productIssues = [];
      const productWarnings = [];

      // Required field validation
      if (!product.unit_name || (typeof product.unit_name === 'string' && product.unit_name.trim() === '') || product.unit_name === null || product.unit_name === undefined) {
        productIssues.push('Missing product name');
      }

      if (!product.unit_id || (typeof product.unit_id === 'string' && product.unit_id.trim() === '') || product.unit_id === null || product.unit_id === undefined) {
        productIssues.push('Missing product ID');
      }

      // Price validation
      if (product.base_price) {
        const price = parseFloat(product.base_price);
        if (isNaN(price)) {
          productIssues.push('Invalid price format');
        } else if (price < 0) {
          productIssues.push('Price cannot be negative');
        } else if (price === 0) {
          productWarnings.push('Product has zero price');
        }
      } else {
        productWarnings.push('No base price provided');
      }

      // BOM validation
      if (!product.bom || (typeof product.bom === 'string' && product.bom.trim() === '') || product.bom === null || product.bom === undefined) {
        productWarnings.push('No BOM assigned');
      }

      // Router validation
      if (!product.router || (typeof product.router === 'string' && product.router.trim() === '') || product.router === null || product.router === undefined) {
        productWarnings.push('No router assigned');
      }

      // Duplicate check
      const duplicateName = products.find((p, i) => 
        i !== index && 
        p.unit_name && 
        p.unit_name.toLowerCase() === product.unit_name?.toLowerCase()
      );
      if (duplicateName) {
        productWarnings.push('Duplicate product name detected');
      }

      const duplicateId = products.find((p, i) => 
        i !== index && 
        p.unit_id && 
        p.unit_id.toLowerCase() === product.unit_id?.toLowerCase()
      );
      if (duplicateId) {
        productIssues.push('Duplicate product ID detected');
      }

      // Data completeness check
      const hasCompleteProfile = product.unit_name && product.base_price && product.bom && product.router;
      if (!hasCompleteProfile) {
        productWarnings.push('Incomplete product profile');
      }

      // Description check
      if (!product.unit_description || (typeof product.unit_description === 'string' && product.unit_description.trim() === '') || product.unit_description === null || product.unit_description === undefined) {
        productWarnings.push('No product description provided');
      }

      // Add to overall stats
      if (productIssues.length > 0) {
        issues.push({
          product,
          issues: productIssues
        });
        stats.withIssues++;
      } else if (productWarnings.length > 0) {
        warnings.push({
          product,
          warnings: productWarnings
        });
        stats.withWarnings++;
      } else {
        stats.valid++;
      }
    });

    return { issues, warnings, stats };
  }, [products]);

  const getSeverityClass = (type) => {
    return type === 'error' ? 'validation-error' : 'validation-warning';
  };

  const getSeverityIcon = (type) => {
    return type === 'error' ? '❌' : '⚠️';
  };

  return (
    <div className="product-validation">
      <div className="validation-header">
        <h3>Data Validation</h3>
        <p>Quality check results for your product database</p>
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
                  <span className="product-name">{item.product.unit_name || 'Unnamed Product'}</span>
                  <span className="product-id">({item.product.unit_id})</span>
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
                  <span className="product-name">{item.product.unit_name || 'Unnamed Product'}</span>
                  <span className="product-id">({item.product.unit_id})</span>
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
            <p>Your product database looks great! All records are valid and complete.</p>
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

export default ProductValidation; 