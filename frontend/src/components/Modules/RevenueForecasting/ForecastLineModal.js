import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import './ForecastLineModal.css';

const ForecastLineModal = ({ isOpen, onClose, onSave, initialData = null }) => {
  const { data, activeScenario } = useForecast();
  
  // Form state
  const [formData, setFormData] = useState({
    product_id: '',
    customer_id: '',
    period_type: 'monthly', // monthly, weekly, quarterly
    start_period: '',
    end_period: '',
    quantity: 0,
    unit_price: 0,
    operation: 'add' // add, subtract, replace
  });

  // Validation state
  const [errors, setErrors] = useState({});

  // Generate available periods
  const availablePeriods = useMemo(() => {
    const periods = [];
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    
    // Generate periods for the next 24 months
    for (let i = 0; i < 24; i++) {
      const date = new Date(currentYear, currentMonth + i, 1);
      const periodKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const periodLabel = `${date.toLocaleDateString('en-US', { month: 'short' })} ${date.getFullYear()}`;
      periods.push({ key: periodKey, label: periodLabel });
    }
    
    return periods;
  }, []);

  // Get unique segments from customers
  const segments = useMemo(() => {
    const customers = Array.isArray(data.customers) ? data.customers : [];
    return [...new Set(customers.map(c => c.customer_type || c.region || 'General'))];
  }, [data.customers]);

  // Filter customers by selected segment
  const filteredCustomers = useMemo(() => {
    if (!formData.segment) return data.customers || [];
    return (data.customers || []).filter(c => 
      (c.customer_type || c.region || 'General') === formData.segment
    );
  }, [data.customers, formData.segment]);

  // Initialize form with current date if no initial data
  useEffect(() => {
    if (!initialData && isOpen) {
      const now = new Date();
      const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      setFormData({
        product_id: '',
        customer_id: '',
        segment: '',
        period_type: 'monthly',
        start_period: currentPeriod,
        end_period: currentPeriod,
        quantity: 0,
        unit_price: 0,
        operation: 'add'
      });
    } else if (initialData && isOpen) {
      setFormData(initialData);
    }
  }, [isOpen, initialData]);

  // Validate form
  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.product_id) newErrors.product_id = 'Product is required';
    if (!formData.customer_id) newErrors.customer_id = 'Customer is required';
    if (!formData.start_period) newErrors.start_period = 'Start period is required';
    if (!formData.end_period) newErrors.end_period = 'End period is required';
    if (formData.quantity <= 0) newErrors.quantity = 'Quantity must be greater than 0';
    if (formData.unit_price <= 0) newErrors.unit_price = 'Unit price must be greater than 0';
    
    // Validate period range
    if (formData.start_period && formData.end_period) {
      if (formData.start_period > formData.end_period) {
        newErrors.end_period = 'End period must be after start period';
      }
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
      // Generate sales records for each period in the range
      const salesRecords = [];
      const startDate = new Date(formData.start_period + '-01');
      const endDate = new Date(formData.end_period + '-01');
      
      let currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const periodKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
        
        // Calculate quantity for this period based on period type
        let periodQuantity = formData.quantity;
        if (formData.period_type === 'weekly') {
          // Convert weekly to monthly (assuming 4.33 weeks per month)
          periodQuantity = Math.round(formData.quantity * 4.33);
        } else if (formData.period_type === 'quarterly') {
          // Convert quarterly to monthly
          periodQuantity = Math.round(formData.quantity / 3);
        }
        
        salesRecords.push({
          unit_id: formData.product_id,
          customer_id: formData.customer_id,
          period: periodKey,
          quantity: periodQuantity,
          unit_price: formData.unit_price,
          total_revenue: periodQuantity * formData.unit_price,
          forecast_id: activeScenario
        });
        
        // Move to next month
        currentDate.setMonth(currentDate.getMonth() + 1);
      }

      // Call the save function
      await onSave(salesRecords, formData.operation);
      
      toast.success(`Successfully ${formData.operation === 'add' ? 'added' : formData.operation === 'subtract' ? 'subtracted' : 'updated'} ${salesRecords.length} forecast records`);
      onClose();
      
    } catch (error) {
      console.error('Error saving forecast line:', error);
      toast.error('Failed to save forecast line');
    }
  };

  // Handle input changes
  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Clear related errors
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="forecast-line-modal-overlay" onClick={onClose}>
      <div className="forecast-line-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{initialData ? 'Edit Forecast Line' : 'Add Forecast Line'}</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="forecast-line-form">
          {/* Product Selection */}
          <div className="form-section">
            <h3>Product & Customer</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Product *</label>
                <select
                  value={formData.product_id}
                  onChange={(e) => handleInputChange('product_id', e.target.value)}
                  className={errors.product_id ? 'error' : ''}
                >
                  <option value="">Select Product</option>
                  {(data.products || []).map(product => (
                    <option key={product.unit_id || product.id} value={product.unit_id || product.id}>
                      {product.unit_name || product.name}
                    </option>
                  ))}
                </select>
                {errors.product_id && <span className="error-message">{errors.product_id}</span>}
              </div>

              <div className="form-group">
                <label>Customer Segment</label>
                <select
                  value={formData.segment}
                  onChange={(e) => handleInputChange('segment', e.target.value)}
                >
                  <option value="">All Segments</option>
                  {segments.map(segment => (
                    <option key={segment} value={segment}>{segment}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Customer *</label>
                <select
                  value={formData.customer_id}
                  onChange={(e) => handleInputChange('customer_id', e.target.value)}
                  className={errors.customer_id ? 'error' : ''}
                >
                  <option value="">Select Customer</option>
                  {filteredCustomers.map(customer => (
                    <option key={customer.customer_id} value={customer.customer_id}>
                      {customer.customer_name}
                    </option>
                  ))}
                </select>
                {errors.customer_id && <span className="error-message">{errors.customer_id}</span>}
              </div>
            </div>
          </div>

          {/* Time Period Configuration */}
          <div className="form-section">
            <h3>Time Period</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Period Type</label>
                <select
                  value={formData.period_type}
                  onChange={(e) => handleInputChange('period_type', e.target.value)}
                >
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                  <option value="quarterly">Quarterly</option>
                </select>
              </div>

              <div className="form-group">
                <label>Start Period *</label>
                <select
                  value={formData.start_period}
                  onChange={(e) => handleInputChange('start_period', e.target.value)}
                  className={errors.start_period ? 'error' : ''}
                >
                  <option value="">Select Start Period</option>
                  {availablePeriods.map(period => (
                    <option key={period.key} value={period.key}>
                      {period.label}
                    </option>
                  ))}
                </select>
                {errors.start_period && <span className="error-message">{errors.start_period}</span>}
              </div>

              <div className="form-group">
                <label>End Period *</label>
                <select
                  value={formData.end_period}
                  onChange={(e) => handleInputChange('end_period', e.target.value)}
                  className={errors.end_period ? 'error' : ''}
                >
                  <option value="">Select End Period</option>
                  {availablePeriods.map(period => (
                    <option key={period.key} value={period.key}>
                      {period.label}
                    </option>
                  ))}
                </select>
                {errors.end_period && <span className="error-message">{errors.end_period}</span>}
              </div>
            </div>
          </div>

          {/* Quantity and Price */}
          <div className="form-section">
            <h3>Quantity & Pricing</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Quantity per {formData.period_type.slice(0, -2)} *</label>
                <input
                  type="number"
                  value={formData.quantity}
                  onChange={(e) => handleInputChange('quantity', parseFloat(e.target.value) || 0)}
                  min="0"
                  step="1"
                  className={errors.quantity ? 'error' : ''}
                  placeholder={`e.g., 50 ${formData.period_type === 'weekly' ? 'units/week' : formData.period_type === 'monthly' ? 'units/month' : 'units/quarter'}`}
                />
                {errors.quantity && <span className="error-message">{errors.quantity}</span>}
              </div>

              <div className="form-group">
                <label>Unit Price *</label>
                <div className="price-input">
                  <span className="currency">$</span>
                  <input
                    type="number"
                    value={formData.unit_price}
                    onChange={(e) => handleInputChange('unit_price', parseFloat(e.target.value) || 0)}
                    min="0"
                    step="0.01"
                    className={errors.unit_price ? 'error' : ''}
                    placeholder="0.00"
                  />
                </div>
                {errors.unit_price && <span className="error-message">{errors.unit_price}</span>}
              </div>

              <div className="form-group">
                <label>Operation</label>
                <select
                  value={formData.operation}
                  onChange={(e) => handleInputChange('operation', e.target.value)}
                >
                  <option value="add">Add to existing</option>
                  <option value="subtract">Subtract from existing</option>
                  <option value="replace">Replace existing</option>
                </select>
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="form-section summary-section">
            <h3>Summary</h3>
            <div className="summary-grid">
              <div className="summary-item">
                <span className="summary-label">Total Periods:</span>
                <span className="summary-value">
                  {formData.start_period && formData.end_period ? 
                    (() => {
                      const start = new Date(formData.start_period + '-01');
                      const end = new Date(formData.end_period + '-01');
                      const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
                      return months;
                    })() : 0
                  }
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Total Quantity:</span>
                <span className="summary-value">
                  {formData.start_period && formData.end_period && formData.quantity ? 
                    (() => {
                      const start = new Date(formData.start_period + '-01');
                      const end = new Date(formData.end_period + '-01');
                      const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
                      let periodQuantity = formData.quantity;
                      if (formData.period_type === 'weekly') {
                        periodQuantity = Math.round(formData.quantity * 4.33);
                      } else if (formData.period_type === 'quarterly') {
                        periodQuantity = Math.round(formData.quantity / 3);
                      }
                      return (periodQuantity * months).toLocaleString();
                    })() : 0
                  }
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Total Revenue:</span>
                <span className="summary-value">
                  {formData.start_period && formData.end_period && formData.quantity && formData.unit_price ? 
                    (() => {
                      const start = new Date(formData.start_period + '-01');
                      const end = new Date(formData.end_period + '-01');
                      const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
                      let periodQuantity = formData.quantity;
                      if (formData.period_type === 'weekly') {
                        periodQuantity = Math.round(formData.quantity * 4.33);
                      } else if (formData.period_type === 'quarterly') {
                        periodQuantity = Math.round(formData.quantity / 3);
                      }
                      return `$${(periodQuantity * months * formData.unit_price).toLocaleString()}`;
                    })() : '$0'
                  }
                </span>
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              {initialData ? 'Update Forecast' : 'Add Forecast'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ForecastLineModal; 