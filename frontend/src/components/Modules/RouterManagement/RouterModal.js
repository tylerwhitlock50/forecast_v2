import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import './RouterManagement.css';

const RouterModal = ({ isOpen, onClose, onSave, router, machines, units, laborRates }) => {
  const [formData, setFormData] = useState({
    router_id: '',
    version: '1.0',
    unit_id: '',
    machine_id: '',
    machine_minutes: '',
    labor_minutes: '',
    labor_type_id: '',
    sequence: ''
  });
  const [errors, setErrors] = useState({});

  // Initialize form when modal opens or router changes
  useEffect(() => {
    if (isOpen) {
      if (router) {
        // Editing existing router
        setFormData({
          router_id: router.router_id || '',
          version: router.version || '1.0',
          unit_id: router.unit_id || '',
          machine_id: router.machine_id || '',
          machine_minutes: router.machine_minutes || '',
          labor_minutes: router.labor_minutes || '',
          labor_type_id: router.labor_type_id || '',
          sequence: router.sequence || ''
        });
      } else {
        // Creating new router
        setFormData({
          router_id: '',
          version: '1.0',
          unit_id: '',
          machine_id: '',
          machine_minutes: '',
          labor_minutes: '',
          labor_type_id: '',
          sequence: ''
        });
      }
      setErrors({});
    }
  }, [isOpen, router]);

  // Validate form
  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.router_id.trim()) {
      newErrors.router_id = 'Router ID is required';
    }
    
    if (!formData.unit_id.trim()) {
      newErrors.unit_id = 'Unit ID is required';
    }
    
    if (!formData.machine_id.trim()) {
      newErrors.machine_id = 'Machine ID is required';
    }
    
    if (!formData.sequence) {
      newErrors.sequence = 'Sequence is required';
    } else if (isNaN(formData.sequence) || formData.sequence < 1) {
      newErrors.sequence = 'Sequence must be a positive number';
    }
    
    if (formData.machine_minutes && (isNaN(formData.machine_minutes) || formData.machine_minutes < 0)) {
      newErrors.machine_minutes = 'Machine minutes must be a valid positive number';
    }
    
    if (formData.labor_minutes && (isNaN(formData.labor_minutes) || formData.labor_minutes < 0)) {
      newErrors.labor_minutes = 'Labor minutes must be a valid positive number';
    }
    
    // Check if unit exists
    const unitExists = units.some(unit => unit.unit_id === formData.unit_id);
    if (formData.unit_id && !unitExists) {
      newErrors.unit_id = 'Selected unit does not exist';
    }
    
    // Check if machine exists
    const machineExists = machines.some(machine => machine.machine_id === formData.machine_id);
    if (formData.machine_id && !machineExists) {
      newErrors.machine_id = 'Selected machine does not exist';
    }
    
    // Check if labor rate exists
    const laborRateExists = laborRates.some(rate => rate.rate_id === formData.labor_type_id);
    if (formData.labor_type_id && !laborRateExists) {
      newErrors.labor_type_id = 'Selected labor rate does not exist';
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
        machine_minutes: formData.machine_minutes ? parseFloat(formData.machine_minutes) : 0,
        labor_minutes: formData.labor_minutes ? parseFloat(formData.labor_minutes) : 0,
        sequence: parseInt(formData.sequence)
      };
      
      await onSave(dataToSave);
    } catch (error) {
      console.error('Error saving router:', error);
      toast.error('Failed to save router');
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

  // Get machine name for display
  const getMachineName = (machineId) => {
    const machine = machines.find(m => m.machine_id === machineId);
    return machine ? machine.machine_name : machineId;
  };

  // Get unit name for display
  const getUnitName = (unitId) => {
    const unit = units.find(u => u.unit_id === unitId);
    return unit ? unit.unit_name : unitId;
  };

  // Get labor rate name for display
  const getLaborRateName = (rateId) => {
    const rate = laborRates.find(r => r.rate_id === rateId);
    return rate ? rate.rate_name : rateId;
  };

  if (!isOpen) return null;

  return (
    <div className="router-modal-overlay" onClick={onClose}>
      <div className="router-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{router ? 'Edit Router Operation' : 'Add New Router Operation'}</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="router-form">
          <div className="form-section">
            <h3>Router Information</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Router ID *</label>
                <input
                  type="text"
                  value={formData.router_id}
                  onChange={(e) => handleInputChange('router_id', e.target.value)}
                  className={errors.router_id ? 'error' : ''}
                  placeholder="e.g., R0001"
                  disabled={router} // Disable editing of ID for existing routers
                />
                {errors.router_id && <span className="error-message">{errors.router_id}</span>}
              </div>

              <div className="form-group">
                <label>Version</label>
                <input
                  type="text"
                  value={formData.version}
                  onChange={(e) => handleInputChange('version', e.target.value)}
                  placeholder="1.0"
                  disabled={router} // Disable editing of version for existing routers
                />
              </div>

              <div className="form-group">
                <label>Sequence *</label>
                <input
                  type="number"
                  value={formData.sequence}
                  onChange={(e) => handleInputChange('sequence', e.target.value)}
                  className={errors.sequence ? 'error' : ''}
                  placeholder="1"
                  min="1"
                />
                {errors.sequence && <span className="error-message">{errors.sequence}</span>}
              </div>
            </div>
          </div>

          <div className="form-section">
            <h3>Operation Details</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Unit *</label>
                <select
                  value={formData.unit_id}
                  onChange={(e) => handleInputChange('unit_id', e.target.value)}
                  className={errors.unit_id ? 'error' : ''}
                >
                  <option value="">Select Unit</option>
                  {units.map(unit => (
                    <option key={unit.unit_id} value={unit.unit_id}>
                      {unit.unit_id} - {unit.unit_name}
                    </option>
                  ))}
                </select>
                {errors.unit_id && <span className="error-message">{errors.unit_id}</span>}
              </div>

              <div className="form-group">
                <label>Machine *</label>
                <select
                  value={formData.machine_id}
                  onChange={(e) => handleInputChange('machine_id', e.target.value)}
                  className={errors.machine_id ? 'error' : ''}
                >
                  <option value="">Select Machine</option>
                  {machines.map(machine => (
                    <option key={machine.machine_id} value={machine.machine_id}>
                      {machine.machine_id} - {machine.machine_name}
                    </option>
                  ))}
                </select>
                {errors.machine_id && <span className="error-message">{errors.machine_id}</span>}
              </div>

              <div className="form-group">
                <label>Labor Rate</label>
                <select
                  value={formData.labor_type_id}
                  onChange={(e) => handleInputChange('labor_type_id', e.target.value)}
                  className={errors.labor_type_id ? 'error' : ''}
                >
                  <option value="">Select Labor Rate</option>
                  {laborRates.map(rate => (
                    <option key={rate.rate_id} value={rate.rate_id}>
                      {rate.rate_id} - {rate.rate_name} (${rate.rate_amount}/hr)
                    </option>
                  ))}
                </select>
                {errors.labor_type_id && <span className="error-message">{errors.labor_type_id}</span>}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Machine Minutes</label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.machine_minutes}
                  onChange={(e) => handleInputChange('machine_minutes', e.target.value)}
                  className={errors.machine_minutes ? 'error' : ''}
                  placeholder="0.0"
                  min="0"
                />
                {errors.machine_minutes && <span className="error-message">{errors.machine_minutes}</span>}
              </div>

              <div className="form-group">
                <label>Labor Minutes</label>
                <input
                  type="number"
                  step="0.1"
                  value={formData.labor_minutes}
                  onChange={(e) => handleInputChange('labor_minutes', e.target.value)}
                  className={errors.labor_minutes ? 'error' : ''}
                  placeholder="0.0"
                  min="0"
                />
                {errors.labor_minutes && <span className="error-message">{errors.labor_minutes}</span>}
              </div>
            </div>
          </div>

          {/* Preview Section */}
          <div className="form-section">
            <h3>Operation Preview</h3>
            <div className="preview-grid">
              <div className="preview-item">
                <span className="preview-label">Unit:</span>
                <span className="preview-value">{getUnitName(formData.unit_id) || 'Not selected'}</span>
              </div>
              <div className="preview-item">
                <span className="preview-label">Machine:</span>
                <span className="preview-value">{getMachineName(formData.machine_id) || 'Not selected'}</span>
              </div>
              <div className="preview-item">
                <span className="preview-label">Labor Rate:</span>
                <span className="preview-value">{getLaborRateName(formData.labor_type_id) || 'Not selected'}</span>
              </div>
              <div className="preview-item">
                <span className="preview-label">Total Time:</span>
                <span className="preview-value">
                  {(parseFloat(formData.machine_minutes || 0) + parseFloat(formData.labor_minutes || 0)).toFixed(1)} minutes
                </span>
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              {router ? 'Update Router Operation' : 'Create Router Operation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RouterModal;