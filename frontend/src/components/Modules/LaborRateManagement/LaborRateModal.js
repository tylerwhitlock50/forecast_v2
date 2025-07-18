import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import './LaborRateManagement.css';

const LaborRateModal = ({ isOpen, onClose, onSave, laborRate }) => {
  const [formData, setFormData] = useState({
    rate_id: '',
    rate_name: '',
    rate_type: '',
    rate_amount: '',
    rate_description: ''
  });
  const [errors, setErrors] = useState({});

  // Initialize form when modal opens or labor rate changes
  useEffect(() => {
    if (isOpen) {
      if (laborRate) {
        // Editing existing labor rate
        setFormData({
          rate_id: laborRate.rate_id || '',
          rate_name: laborRate.rate_name || '',
          rate_type: laborRate.rate_type || '',
          rate_amount: laborRate.rate_amount || '',
          rate_description: laborRate.rate_description || ''
        });
      } else {
        // Creating new labor rate
        setFormData({
          rate_id: '',
          rate_name: '',
          rate_type: '',
          rate_amount: '',
          rate_description: ''
        });
      }
      setErrors({});
    }
  }, [isOpen, laborRate]);

  // Validate form
  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.rate_id.trim()) {
      newErrors.rate_id = 'Rate ID is required';
    }
    
    if (!formData.rate_name.trim()) {
      newErrors.rate_name = 'Rate name is required';
    }
    
    if (!formData.rate_type.trim()) {
      newErrors.rate_type = 'Rate type is required';
    }
    
    if (!formData.rate_amount || isNaN(formData.rate_amount) || parseFloat(formData.rate_amount) < 0) {
      newErrors.rate_amount = 'Valid hourly rate is required';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      toast.error('Please fix the errors in the form');
      return;
    }

    try {
      // Convert rate_amount to number for submission
      const submitData = {
        ...formData,
        rate_amount: parseFloat(formData.rate_amount)
      };
      await onSave(submitData);
    } catch (error) {
      console.error('Error saving labor rate:', error);
      toast.error('Failed to save labor rate');
    }
  };

  // Handle input changes
  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  // Generate rate ID suggestion
  const generateRateId = () => {
    const baseName = formData.rate_name.toUpperCase().replace(/\s+/g, '-');
    const rateType = formData.rate_type.toUpperCase().replace(/\s+/g, '-');
    return `${rateType}-${baseName}` || 'RATE-001';
  };

  if (!isOpen) return null;

  return (
    <div className="labor-rate-modal-overlay" onClick={onClose}>
      <div className="labor-rate-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{laborRate ? 'Edit Labor Rate' : 'Add New Labor Rate'}</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="labor-rate-form">
          <div className="form-section">
            <h3>Labor Rate Information</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Rate ID *</label>
                <div className="input-with-action">
                  <input
                    type="text"
                    value={formData.rate_id}
                    onChange={(e) => handleInputChange('rate_id', e.target.value)}
                    className={errors.rate_id ? 'error' : ''}
                    placeholder="e.g., DIRECT-LABOR"
                    disabled={laborRate} // Disable editing of ID for existing rates
                  />
                  {!laborRate && (
                    <button
                      type="button"
                      onClick={() => handleInputChange('rate_id', generateRateId())}
                      className="btn-generate"
                      title="Generate Rate ID"
                    >
                      🔄
                    </button>
                  )}
                </div>
                {errors.rate_id && <span className="error-message">{errors.rate_id}</span>}
              </div>

              <div className="form-group">
                <label>Rate Name *</label>
                <input
                  type="text"
                  value={formData.rate_name}
                  onChange={(e) => handleInputChange('rate_name', e.target.value)}
                  className={errors.rate_name ? 'error' : ''}
                  placeholder="Enter rate name"
                />
                {errors.rate_name && <span className="error-message">{errors.rate_name}</span>}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Rate Type *</label>
                <select
                  value={formData.rate_type}
                  onChange={(e) => handleInputChange('rate_type', e.target.value)}
                  className={errors.rate_type ? 'error' : ''}
                >
                  <option value="">Select Rate Type</option>
                  <option value="Direct Labor">Direct Labor</option>
                  <option value="Indirect Labor">Indirect Labor</option>
                  <option value="Machine Operator">Machine Operator</option>
                  <option value="Setup">Setup</option>
                  <option value="Quality Control">Quality Control</option>
                  <option value="Maintenance">Maintenance</option>
                  <option value="Supervision">Supervision</option>
                  <option value="Engineering">Engineering</option>
                  <option value="Administrative">Administrative</option>
                  <option value="Skilled Labor">Skilled Labor</option>
                  <option value="Semi-skilled Labor">Semi-skilled Labor</option>
                  <option value="Unskilled Labor">Unskilled Labor</option>
                  <option value="Overtime">Overtime</option>
                  <option value="Holiday">Holiday</option>
                  <option value="Contract">Contract</option>
                </select>
                {errors.rate_type && <span className="error-message">{errors.rate_type}</span>}
              </div>

              <div className="form-group">
                <label>Hourly Rate (USD) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.rate_amount}
                  onChange={(e) => handleInputChange('rate_amount', e.target.value)}
                  className={errors.rate_amount ? 'error' : ''}
                  placeholder="0.00"
                />
                {errors.rate_amount && <span className="error-message">{errors.rate_amount}</span>}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group full-width">
                <label>Description</label>
                <textarea
                  value={formData.rate_description}
                  onChange={(e) => handleInputChange('rate_description', e.target.value)}
                  placeholder="Enter rate description (optional)"
                  rows="3"
                />
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              {laborRate ? 'Update Labor Rate' : 'Create Labor Rate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LaborRateModal;