import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import './RouterManagement.css';

const RouterModal = ({ isOpen, onClose, onSave, router }) => {
  const [formData, setFormData] = useState({
    router_id: '',
    router_name: '',
    router_description: '',
    version: '1.0'
  });
  const [errors, setErrors] = useState({});

  // Initialize form when modal opens or router changes
  useEffect(() => {
    if (isOpen) {
      if (router) {
        // Editing existing router
        setFormData({
          router_id: router.router_id || '',
          router_name: router.router_name || '',
          router_description: router.router_description || '',
          version: router.version || '1.0'
        });
      } else {
        // Creating new router
        setFormData({
          router_id: '',
          router_name: '',
          router_description: '',
          version: '1.0'
        });
      }
      setErrors({});
    }
  }, [isOpen, router]);

  // Validate form
  const validateForm = () => {
    const newErrors = {};
    
    // Only require router_id for editing existing routers
    if (router && !formData.router_id.trim()) {
      newErrors.router_id = 'Router ID is required';
    }
    
    if (!formData.router_name.trim()) {
      newErrors.router_name = 'Router name is required';
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
        router_id: formData.router_id.trim() || null, // Allow null for auto-generation
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

  if (!isOpen) return null;

  return (
    <div className="router-modal-overlay" onClick={onClose}>
      <div className="router-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{router ? 'Edit Router' : 'Add New Router'}</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="router-form">
          <div className="form-section">
            <h3>Router Information</h3>
            <div className="form-row">
              <div className="form-group">
                <label>Router ID {router ? '*' : ''}</label>
                <input
                  type="text"
                  value={formData.router_id}
                  onChange={(e) => handleInputChange('router_id', e.target.value)}
                  className={errors.router_id ? 'error' : ''}
                  placeholder={router ? "e.g., R0001" : "Auto-generated if left empty"}
                  disabled={router} // Disable editing of ID for existing routers
                />
                {errors.router_id && <span className="error-message">{errors.router_id}</span>}
                {!router && <small style={{color: '#6c757d', fontSize: '0.8rem'}}>Leave empty to auto-generate</small>}
              </div>

              <div className="form-group">
                <label>Router Name *</label>
                <input
                  type="text"
                  value={formData.router_name}
                  onChange={(e) => handleInputChange('router_name', e.target.value)}
                  className={errors.router_name ? 'error' : ''}
                  placeholder="Enter router name"
                />
                {errors.router_name && <span className="error-message">{errors.router_name}</span>}
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
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Description</label>
                <input
                  type="text"
                  value={formData.router_description}
                  onChange={(e) => handleInputChange('router_description', e.target.value)}
                  placeholder="Enter router description"
                />
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              {router ? 'Update Router' : 'Create Router'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RouterModal;