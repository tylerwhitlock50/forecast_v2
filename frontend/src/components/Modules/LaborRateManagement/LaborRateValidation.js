import React, { useMemo } from 'react';


const LaborRateValidation = ({ laborRates }) => {
  const validationResults = useMemo(() => {
    const rates = Array.isArray(laborRates) ? laborRates : [];
    const errors = [];
    const warnings = [];
    const info = [];

    // Check for missing required fields
    rates.forEach((rate, index) => {
      if (!rate.rate_id || (typeof rate.rate_id === 'string' && !rate.rate_id.trim()) || rate.rate_id === null || rate.rate_id === undefined) {
        errors.push({
          type: 'Missing Rate ID',
          message: `Labor rate at row ${index + 1} is missing a rate ID`,
          severity: 'error',
          row: index + 1,
          field: 'rate_id'
        });
      }

      if (!rate.rate_name || (typeof rate.rate_name === 'string' && !rate.rate_name.trim()) || rate.rate_name === null || rate.rate_name === undefined) {
        errors.push({
          type: 'Missing Rate Name',
          message: `Labor rate at row ${index + 1} is missing a rate name`,
          severity: 'error',
          row: index + 1,
          field: 'rate_name'
        });
      }

      if (!rate.rate_type || (typeof rate.rate_type === 'string' && !rate.rate_type.trim()) || rate.rate_type === null || rate.rate_type === undefined) {
        warnings.push({
          type: 'Missing Rate Type',
          message: `Labor rate "${rate.rate_name}" is missing a rate type`,
          severity: 'warning',
          row: index + 1,
          field: 'rate_type'
        });
      }

      if (!rate.rate_amount || isNaN(rate.rate_amount) || parseFloat(rate.rate_amount) < 0) {
        errors.push({
          type: 'Invalid Rate Amount',
          message: `Labor rate "${rate.rate_name}" has invalid or missing rate amount`,
          severity: 'error',
          row: index + 1,
          field: 'rate_amount'
        });
      }
    });

    // Check for duplicate rate IDs
    const rateIds = rates.map(rate => rate.rate_id).filter(Boolean);
    const duplicateIds = rateIds.filter((id, index) => rateIds.indexOf(id) !== index);
    if (duplicateIds.length > 0) {
      [...new Set(duplicateIds)].forEach(id => {
        errors.push({
          type: 'Duplicate Rate ID',
          message: `Rate ID "${id}" is used by multiple labor rates`,
          severity: 'error',
          field: 'rate_id'
        });
      });
    }

    // Check for duplicate rate names
    const rateNames = rates.map(rate => rate.rate_name).filter(Boolean);
    const duplicateNames = rateNames.filter((name, index) => rateNames.indexOf(name) !== index);
    if (duplicateNames.length > 0) {
      [...new Set(duplicateNames)].forEach(name => {
        warnings.push({
          type: 'Duplicate Rate Name',
          message: `Rate name "${name}" is used by multiple labor rates`,
          severity: 'warning',
          field: 'rate_name'
        });
      });
    }

    // Check for unusual rate amounts
    const rateAmounts = rates.map(rate => parseFloat(rate.rate_amount)).filter(amount => !isNaN(amount) && amount > 0);
    const averageRate = rateAmounts.length > 0 ? rateAmounts.reduce((a, b) => a + b, 0) / rateAmounts.length : 0;
    const stdDev = rateAmounts.length > 0 ? Math.sqrt(rateAmounts.reduce((acc, rate) => acc + Math.pow(rate - averageRate, 2), 0) / rateAmounts.length) : 0;
    
    rates.forEach((rate, index) => {
      const amount = parseFloat(rate.rate_amount);
      if (!isNaN(amount) && amount > 0) {
        if (amount < 5) {
          warnings.push({
            type: 'Low Rate Amount',
            message: `Labor rate "${rate.rate_name}" has unusually low rate (${amount.toFixed(2)})`,
            severity: 'warning',
            row: index + 1,
            field: 'rate_amount'
          });
        } else if (amount > 200) {
          warnings.push({
            type: 'High Rate Amount',
            message: `Labor rate "${rate.rate_name}" has unusually high rate (${amount.toFixed(2)})`,
            severity: 'warning',
            row: index + 1,
            field: 'rate_amount'
          });
        } else if (stdDev > 0 && Math.abs(amount - averageRate) > (2 * stdDev)) {
          info.push({
            type: 'Rate Outlier',
            message: `Labor rate "${rate.rate_name}" (${amount.toFixed(2)}) is significantly different from average (${averageRate.toFixed(2)})`,
            severity: 'info',
            row: index + 1,
            field: 'rate_amount'
          });
        }
      }
    });

    // Check for missing descriptions
    const missingDescriptions = rates.filter(rate => !rate.rate_description || (typeof rate.rate_description === 'string' && !rate.rate_description.trim()) || rate.rate_description === null || rate.rate_description === undefined).length;
    if (missingDescriptions > 0) {
      info.push({
        type: 'Missing Descriptions',
        message: `${missingDescriptions} labor rates are missing descriptions`,
        severity: 'info',
        field: 'rate_description'
      });
    }

    return {
      errors,
      warnings,
      info,
      totalIssues: errors.length + warnings.length + info.length
    };
  }, [laborRates]);

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'error': return '❌';
      case 'warning': return '⚠️';
      case 'info': return 'ℹ️';
      default: return '🔍';
    }
  };

  const getSeverityClass = (severity) => {
    return `validation-item ${severity}`;
  };

  return (
    <div className="labor-rate-validation">
      <div className="validation-header">
        <h3>Data Validation</h3>
        <p>Quality checks for labor rate data</p>
      </div>

      <div className="validation-summary">
        <div className="summary-cards">
          <div className="validation-card error">
            <div className="card-header">
              <span className="card-icon">❌</span>
              <h4>Errors</h4>
            </div>
            <div className="card-value">{validationResults.errors.length}</div>
            <div className="card-subtitle">Must be fixed</div>
          </div>

          <div className="validation-card warning">
            <div className="card-header">
              <span className="card-icon">⚠️</span>
              <h4>Warnings</h4>
            </div>
            <div className="card-value">{validationResults.warnings.length}</div>
            <div className="card-subtitle">Should be reviewed</div>
          </div>

          <div className="validation-card info">
            <div className="card-header">
              <span className="card-icon">ℹ️</span>
              <h4>Info</h4>
            </div>
            <div className="card-value">{validationResults.info.length}</div>
            <div className="card-subtitle">For your information</div>
          </div>

          <div className="validation-card total">
            <div className="card-header">
              <span className="card-icon">🔍</span>
              <h4>Total Issues</h4>
            </div>
            <div className="card-value">{validationResults.totalIssues}</div>
            <div className="card-subtitle">All findings</div>
          </div>
        </div>
      </div>

      <div className="validation-content">
        {validationResults.totalIssues === 0 ? (
          <div className="no-issues">
            <div className="no-issues-icon">✅</div>
            <h4>No Issues Found</h4>
            <p>All labor rate data appears to be valid and complete.</p>
          </div>
        ) : (
          <div className="validation-results">
            {validationResults.errors.length > 0 && (
              <div className="validation-section">
                <h4 className="section-title error">
                  <span className="section-icon">❌</span>
                  Errors ({validationResults.errors.length})
                </h4>
                <div className="validation-list">
                  {validationResults.errors.map((error, index) => (
                    <div key={index} className={getSeverityClass(error.severity)}>
                      <div className="validation-icon">
                        {getSeverityIcon(error.severity)}
                      </div>
                      <div className="validation-details">
                        <div className="validation-type">{error.type}</div>
                        <div className="validation-message">{error.message}</div>
                        {error.row && (
                          <div className="validation-location">Row {error.row}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {validationResults.warnings.length > 0 && (
              <div className="validation-section">
                <h4 className="section-title warning">
                  <span className="section-icon">⚠️</span>
                  Warnings ({validationResults.warnings.length})
                </h4>
                <div className="validation-list">
                  {validationResults.warnings.map((warning, index) => (
                    <div key={index} className={getSeverityClass(warning.severity)}>
                      <div className="validation-icon">
                        {getSeverityIcon(warning.severity)}
                      </div>
                      <div className="validation-details">
                        <div className="validation-type">{warning.type}</div>
                        <div className="validation-message">{warning.message}</div>
                        {warning.row && (
                          <div className="validation-location">Row {warning.row}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {validationResults.info.length > 0 && (
              <div className="validation-section">
                <h4 className="section-title info">
                  <span className="section-icon">ℹ️</span>
                  Information ({validationResults.info.length})
                </h4>
                <div className="validation-list">
                  {validationResults.info.map((info, index) => (
                    <div key={index} className={getSeverityClass(info.severity)}>
                      <div className="validation-icon">
                        {getSeverityIcon(info.severity)}
                      </div>
                      <div className="validation-details">
                        <div className="validation-type">{info.type}</div>
                        <div className="validation-message">{info.message}</div>
                        {info.row && (
                          <div className="validation-location">Row {info.row}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default LaborRateValidation;