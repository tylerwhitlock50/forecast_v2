import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';


const CustomerModal = ({ isOpen, onClose, onSave, customer }) => {
  const [formData, setFormData] = useState({
    customer_id: '',
    customer_name: '',
    customer_type: '',
    region: ''
  });
  const [errors, setErrors] = useState({});

  // Initialize form when modal opens or customer changes
  useEffect(() => {
    if (isOpen) {
      if (customer) {
        // Editing existing customer
        setFormData({
          customer_id: customer.customer_id || '',
          customer_name: customer.customer_name || '',
          customer_type: customer.customer_type || '',
          region: customer.region || ''
        });
      } else {
        // Creating new customer
        setFormData({
          customer_id: '',
          customer_name: '',
          customer_type: '',
          region: ''
        });
      }
      setErrors({});
    }
  }, [isOpen, customer]);

  // Validate form
  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.customer_id.trim()) {
      newErrors.customer_id = 'Customer ID is required';
    }
    
    if (!formData.customer_name.trim()) {
      newErrors.customer_name = 'Customer name is required';
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
      await onSave(formData);
    } catch (error) {
      console.error('Error saving customer:', error);
      toast.error('Failed to save customer');
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

  if (!isOpen) return null;

  return (
    <div className="customer-modal-overlay" onClick={onClose}>
      <div className="customer-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{customer ? 'Edit Customer' : 'Add New Customer'}</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="customer-form">
          <div className="form-section">
            <h3>Customer Information</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Customer ID *</label>
                <input
                  type="text"
                  value={formData.customer_id}
                  onChange={(e) => handleInputChange('customer_id', e.target.value)}
                  className={errors.customer_id ? 'error' : ''}
                  placeholder="e.g., CUST-001"
                  disabled={customer} // Disable editing of ID for existing customers
                />
                {errors.customer_id && <span className="error-message">{errors.customer_id}</span>}
              </div>

              <div className="form-group">
                <label>Customer Name *</label>
                <input
                  type="text"
                  value={formData.customer_name}
                  onChange={(e) => handleInputChange('customer_name', e.target.value)}
                  className={errors.customer_name ? 'error' : ''}
                  placeholder="Enter customer name"
                />
                {errors.customer_name && <span className="error-message">{errors.customer_name}</span>}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Customer Type</label>
                <select
                  value={formData.customer_type}
                  onChange={(e) => handleInputChange('customer_type', e.target.value)}
                >
                  <option value="">Select Type</option>
                  <option value="D2C-WEB">D2C-WEB</option>
                  <option value="ONLINE-DEALER">ONLINE-DEALER</option>
                  <option value="DEALER">DEALER</option>
                  <option value="D2C-AMAZON">D2C-AMAZON</option>
                  <option value="Enterprise">Enterprise</option>
                  <option value="SMB">SMB</option>
                  <option value="Startup">Startup</option>
                  <option value="Government">Government</option>
                  <option value="Education">Education</option>
                  <option value="Healthcare">Healthcare</option>
                  <option value="Retail">Retail</option>
                  <option value="Manufacturing">Manufacturing</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div className="form-group">
                <label>Region</label>
                <select
                  value={formData.region}
                  onChange={(e) => handleInputChange('region', e.target.value)}
                >
                  <option value="">Select Region</option>
                  <option value="US">US</option>
                  <option value="North America">North America</option>
                  <option value="Europe">Europe</option>
                  <option value="Asia Pacific">Asia Pacific</option>
                  <option value="Latin America">Latin America</option>
                  <option value="Middle East">Middle East</option>
                  <option value="Africa">Africa</option>
                </select>
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              {customer ? 'Update Customer' : 'Create Customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CustomerModal; 