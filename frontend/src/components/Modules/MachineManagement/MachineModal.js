import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useForecast } from '../../../context/ForecastContext';
import './MachineManagement.css';

const MachineModal = ({ isOpen, onClose, onSave, machine }) => {
  const { data } = useForecast();
  const [formData, setFormData] = useState({
    machine_id: '',
    machine_name: '',
    machine_description: '',
    machine_rate: '',
    labor_type: '',
    available_minutes_per_month: ''
  });
  const [errors, setErrors] = useState({});

  // Initialize form when modal opens or machine changes
  useEffect(() => {
    if (isOpen) {
      if (machine) {
        // Editing existing machine
        setFormData({
          machine_id: machine.machine_id || '',
          machine_name: machine.machine_name || '',
          machine_description: machine.machine_description || '',
          machine_rate: machine.machine_rate || '',
          labor_type: machine.labor_type || '',
          available_minutes_per_month: machine.available_minutes_per_month || ''
        });
      } else {
        // Creating new machine
        setFormData({
          machine_id: '',
          machine_name: '',
          machine_description: '',
          machine_rate: '',
          labor_type: '',
          available_minutes_per_month: ''
        });
      }
      setErrors({});
    }
  }, [isOpen, machine]);

  // Validate form
  const validateForm = () => {
    const newErrors = {};
    
    // Only require machine_id for editing existing machines
    if (machine && !formData.machine_id.trim()) {
      newErrors.machine_id = 'Machine ID is required';
    }
    
    if (!formData.machine_name.trim()) {
      newErrors.machine_name = 'Machine name is required';
    }
    
    if (formData.machine_rate && (isNaN(formData.machine_rate) || formData.machine_rate < 0)) {
      newErrors.machine_rate = 'Machine rate must be a valid positive number';
    }
    
    if (formData.available_minutes_per_month && (isNaN(formData.available_minutes_per_month) || formData.available_minutes_per_month < 0)) {
      newErrors.available_minutes_per_month = 'Available minutes must be a valid positive number';
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
      // Convert numeric fields to appropriate types
      const dataToSave = {
        ...formData,
        machine_id: formData.machine_id.trim() || null, // Allow null for auto-generation
        machine_rate: formData.machine_rate ? parseFloat(formData.machine_rate) : null,
        available_minutes_per_month: formData.available_minutes_per_month ? parseInt(formData.available_minutes_per_month) : 0
      };
      
      await onSave(dataToSave);
    } catch (error) {
      console.error('Error saving machine:', error);
      toast.error('Failed to save machine');
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
    <div className="machine-modal-overlay" onClick={onClose}>
      <div className="machine-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{machine ? 'Edit Machine' : 'Add New Machine'}</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="machine-form">
          <div className="form-section">
            <h3>Machine Information</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Machine ID {machine ? '*' : ''}</label>
                <input
                  type="text"
                  value={formData.machine_id}
                  onChange={(e) => handleInputChange('machine_id', e.target.value)}
                  className={errors.machine_id ? 'error' : ''}
                  placeholder={machine ? "e.g., WC0001" : "Auto-generated if left empty"}
                  disabled={machine} // Disable editing of ID for existing machines
                />
                {errors.machine_id && <span className="error-message">{errors.machine_id}</span>}
                {!machine && <small style={{color: '#6c757d', fontSize: '0.8rem'}}>Leave empty to auto-generate</small>}
              </div>

              <div className="form-group">
                <label>Machine Name *</label>
                <input
                  type="text"
                  value={formData.machine_name}
                  onChange={(e) => handleInputChange('machine_name', e.target.value)}
                  className={errors.machine_name ? 'error' : ''}
                  placeholder="Enter machine name"
                />
                {errors.machine_name && <span className="error-message">{errors.machine_name}</span>}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Machine Description</label>
                <input
                  type="text"
                  value={formData.machine_description}
                  onChange={(e) => handleInputChange('machine_description', e.target.value)}
                  placeholder="Enter machine description"
                />
              </div>

              <div className="form-group">
                <label>Labor Type</label>
                <select
                  value={formData.labor_type}
                  onChange={(e) => handleInputChange('labor_type', e.target.value)}
                >
                  <option value="">Select Type</option>
                  {Array.isArray(data.labor_rates) && data.labor_rates.map(rate => (
                    <option key={rate.rate_id} value={rate.rate_name}>
                      {rate.rate_name} (${rate.rate_amount}/hr)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Machine Rate ($/hour)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.machine_rate}
                  onChange={(e) => handleInputChange('machine_rate', e.target.value)}
                  className={errors.machine_rate ? 'error' : ''}
                  placeholder="0.00"
                />
                {errors.machine_rate && <span className="error-message">{errors.machine_rate}</span>}
              </div>

              <div className="form-group">
                <label>Available Minutes per Month</label>
                <input
                  type="number"
                  value={formData.available_minutes_per_month}
                  onChange={(e) => handleInputChange('available_minutes_per_month', e.target.value)}
                  className={errors.available_minutes_per_month ? 'error' : ''}
                  placeholder="0"
                />
                {errors.available_minutes_per_month && <span className="error-message">{errors.available_minutes_per_month}</span>}
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              {machine ? 'Update Machine' : 'Create Machine'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default MachineModal;