import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import './BOMManagement.css';

const BOMModal = ({ isOpen, onClose, onSave, bom }) => {
  const [formData, setFormData] = useState({
    bom_id: '',
    bom_name: '',
    bom_description: '',
    version: '1.0'
  });
  const [errors, setErrors] = useState({});

  // Initialize form when modal opens or bom changes
  useEffect(() => {
    if (isOpen) {
      if (bom) {
        // Editing existing BOM
        setFormData({
          bom_id: bom.bom_id || '',
          bom_name: bom.bom_name || '',
          bom_description: bom.bom_description || '',
          version: bom.version || '1.0'
        });
      } else {
        // Creating new BOM
        setFormData({
          bom_id: '',
          bom_name: '',
          bom_description: '',
          version: '1.0'
        });
      }
      setErrors({});
    }
  }, [isOpen, bom]);

  // Validate form
  const validateForm = () => {
    const newErrors = {};
    
    // Only require bom_id for editing existing BOMs
    if (bom && !formData.bom_id.trim()) {
      newErrors.bom_id = 'BOM ID is required';
    }
    
    if (!formData.bom_name.trim()) {
      newErrors.bom_name = 'BOM name is required';
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
      // Prepare data to save
      const dataToSave = {
        ...formData,
        bom_id: formData.bom_id.trim() || null, // Allow null for auto-generation
      };
      
      await onSave(dataToSave);
    } catch (error) {
      console.error('Error saving BOM:', error);
      toast.error('Failed to save BOM');
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
    <div className="bom-modal-overlay" onClick={onClose}>
      <div className="bom-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{bom ? 'Edit BOM' : 'Add New BOM'}</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="bom-form">
          <div className="form-section">
            <h3>BOM Information</h3>
            <div className="form-row">
              <div className="form-group">
                <label>BOM ID {bom ? '*' : ''}</label>
                <input
                  type="text"
                  value={formData.bom_id}
                  onChange={(e) => handleInputChange('bom_id', e.target.value)}
                  className={errors.bom_id ? 'error' : ''}
                  placeholder={bom ? "e.g., BOM-001" : "Auto-generated if left empty"}
                  disabled={bom} // Disable editing of ID for existing BOMs
                />
                {errors.bom_id && <span className="error-message">{errors.bom_id}</span>}
                {!bom && <small style={{color: '#6c757d', fontSize: '0.8rem'}}>Leave empty to auto-generate</small>}
              </div>

              <div className="form-group">
                <label>BOM Name *</label>
                <input
                  type="text"
                  value={formData.bom_name}
                  onChange={(e) => handleInputChange('bom_name', e.target.value)}
                  className={errors.bom_name ? 'error' : ''}
                  placeholder="Enter BOM name"
                />
                {errors.bom_name && <span className="error-message">{errors.bom_name}</span>}
              </div>

              <div className="form-group">
                <label>Version</label>
                <input
                  type="text"
                  value={formData.version}
                  onChange={(e) => handleInputChange('version', e.target.value)}
                  placeholder="1.0"
                  disabled={bom} // Disable editing of version for existing BOMs
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={formData.bom_description}
                  onChange={(e) => handleInputChange('bom_description', e.target.value)}
                  placeholder="Enter BOM description"
                  rows="3"
                  style={{ resize: 'vertical', minHeight: '80px' }}
                />
              </div>
            </div>
          </div>

          {!bom && (
            <div className="form-section">
              <h3>Next Steps</h3>
              <div className="info-box">
                <p>After creating this BOM, you can:</p>
                <ul>
                  <li>Add materials and components using the "Manage Items" button</li>
                  <li>Set quantities, unit costs, and target costs for each item</li>
                  <li>Clone this BOM to create variations</li>
                  <li>Link this BOM to products in the units table</li>
                </ul>
              </div>
            </div>
          )}

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              {bom ? 'Update BOM' : 'Create BOM'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default BOMModal;