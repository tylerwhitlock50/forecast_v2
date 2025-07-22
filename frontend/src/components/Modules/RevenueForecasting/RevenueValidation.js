import React from 'react';
import ValidationIndicator from '../../Common/ValidationIndicator';


const RevenueValidation = ({ data }) => {
  return (
    <div className="validation-tab">
      <h3>Data Validation</h3>
      <div className="validation-summary">
        <ValidationIndicator 
          type="error" 
          size="large"
          message={`${data.validation.errors.length} errors found`}
        />
        <ValidationIndicator 
          type="warning" 
          size="large"
          message={`${data.validation.warnings.length} warnings found`}
        />
      </div>
      <div className="validation-issues">
        {data.validation.errors.map((error, index) => (
          <div key={index} className="validation-issue error">
            <ValidationIndicator type="error" size="small" />
            <span>{error.message}</span>
          </div>
        ))}
        {data.validation.warnings.map((warning, index) => (
          <div key={index} className="validation-issue warning">
            <ValidationIndicator type="warning" size="small" />
            <span>{warning.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RevenueValidation; 