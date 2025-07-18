import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useForecast } from '../../../context/ForecastContext';
import './BillOfMaterialsManagement.css';

const BomLinesModal = ({ isOpen, onClose, bom, bomLines, units, onSave }) => {
  const { actions } = useForecast();
  const [bomLinesList, setBomLinesList] = useState([]);
  const [showAddLine, setShowAddLine] = useState(false);
  const [editingLine, setEditingLine] = useState(null);
  const [formData, setFormData] = useState({
    bom_line: '',
    material_description: '',
    qty: '',
    unit: '',
    unit_price: '',
    material_cost: '',
    target_cost: ''
  });
  const [errors, setErrors] = useState({});

  // Initialize BOM lines when modal opens or bom changes
  useEffect(() => {
    if (isOpen && bom) {
      const lines = bomLines
        .filter(line => line.bom_id === bom.bom_id && (line.version || '1.0') === bom.version)
        .sort((a, b) => a.bom_line - b.bom_line);
      setBomLinesList(lines);
      setShowAddLine(false);
      setEditingLine(null);
      setFormData({
        bom_line: '',
        material_description: '',
        qty: '',
        unit: '',
        unit_price: '',
        material_cost: '',
        target_cost: ''
      });
      setErrors({});
    }
  }, [isOpen, bom, bomLines]);

  // Validate form
  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.bom_line) {
      newErrors.bom_line = 'BOM line number is required';
    } else if (isNaN(formData.bom_line) || formData.bom_line < 1) {
      newErrors.bom_line = 'BOM line must be a positive number';
    } else {
      // Check for duplicate line number
      const existingLine = bomLinesList.find(line => 
        line.bom_line === parseInt(formData.bom_line) && 
        (!editingLine || line.bom_line !== editingLine.bom_line)
      );
      if (existingLine) {
        newErrors.bom_line = 'BOM line number already exists';
      }
    }
    
    if (!formData.material_description.trim()) {
      newErrors.material_description = 'Material description is required';
    }
    
    if (!formData.qty || isNaN(formData.qty) || parseFloat(formData.qty) <= 0) {
      newErrors.qty = 'Quantity must be a positive number';
    }
    
    if (!formData.unit.trim()) {
      newErrors.unit = 'Unit is required';
    }
    
    if (formData.unit_price && (isNaN(formData.unit_price) || parseFloat(formData.unit_price) < 0)) {
      newErrors.unit_price = 'Unit price must be a non-negative number';
    }
    
    if (formData.material_cost && (isNaN(formData.material_cost) || parseFloat(formData.material_cost) < 0)) {
      newErrors.material_cost = 'Material cost must be a non-negative number';
    }
    
    if (formData.target_cost && (isNaN(formData.target_cost) || parseFloat(formData.target_cost) < 0)) {
      newErrors.target_cost = 'Target cost must be a non-negative number';
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
      const dataToSave = {
        bom_id: bom.bom_id,
        version: bom.version,
        bom_line: parseInt(formData.bom_line),
        material_description: formData.material_description.trim(),
        qty: parseFloat(formData.qty),
        unit: formData.unit.trim(),
        unit_price: formData.unit_price ? parseFloat(formData.unit_price) : null,
        material_cost: formData.material_cost ? parseFloat(formData.material_cost) : null,
        target_cost: formData.target_cost ? parseFloat(formData.target_cost) : null
      };
      
      if (editingLine) {
        await actions.updateBomLine(editingLine.bom_id, editingLine.version, editingLine.bom_line, dataToSave);
        toast.success('BOM line updated successfully');
      } else {
        await actions.createBomLine(dataToSave);
        toast.success('BOM line created successfully');
      }
      
      setShowAddLine(false);
      setEditingLine(null);
      await onSave();
    } catch (error) {
      console.error('Error saving BOM line:', error);
      toast.error('Failed to save BOM line');
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

  // Calculate material cost when quantity or unit price changes
  useEffect(() => {
    if (formData.qty && formData.unit_price) {
      const qty = parseFloat(formData.qty);
      const unitPrice = parseFloat(formData.unit_price);
      if (!isNaN(qty) && !isNaN(unitPrice)) {
        const calculatedCost = qty * unitPrice;
        setFormData(prev => ({ ...prev, material_cost: calculatedCost.toFixed(2) }));
      }
    }
  }, [formData.qty, formData.unit_price]);

  // Handle edit line
  const handleEditLine = (line) => {
    setEditingLine(line);
    setFormData({
      bom_line: line.bom_line.toString(),
      material_description: line.material_description || '',
      qty: line.qty?.toString() || '',
      unit: line.unit || '',
      unit_price: line.unit_price?.toString() || '',
      material_cost: line.material_cost?.toString() || '',
      target_cost: line.target_cost?.toString() || ''
    });
    setShowAddLine(true);
  };

  // Handle delete line
  const handleDeleteLine = async (bomId, version, bomLine) => {
    if (window.confirm('Are you sure you want to delete this BOM line?')) {
      try {
        await actions.deleteBomLine(bomId, version, bomLine);
        toast.success('BOM line deleted successfully');
        await onSave();
      } catch (error) {
        console.error('Error deleting BOM line:', error);
        toast.error('Failed to delete BOM line');
      }
    }
  };

  // Handle cancel edit
  const handleCancelEdit = () => {
    setShowAddLine(false);
    setEditingLine(null);
    setFormData({
      bom_line: '',
      material_description: '',
      qty: '',
      unit: '',
      unit_price: '',
      material_cost: '',
      target_cost: ''
    });
    setErrors({});
  };

  const formatCurrency = (value) => {
    if (value === null || value === undefined) return '-';
    return `$${Number(value).toFixed(2)}`;
  };

  const formatNumber = (value) => {
    if (value === null || value === undefined) return '-';
    return Number(value).toLocaleString();
  };

  if (!isOpen || !bom) return null;

  return (
    <div className="bom-modal-overlay" onClick={onClose}>
      <div className="bom-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Manage BOM Lines: {bom.bom_name}</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="bom-form">
          {/* BOM Lines List */}
          <div className="form-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3>BOM Lines ({bomLinesList.length})</h3>
              <button 
                type="button" 
                className="btn-primary"
                onClick={() => setShowAddLine(true)}
                disabled={showAddLine}
              >
                ➕ Add BOM Line
              </button>
            </div>

            {bomLinesList.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#6c757d' }}>
                <p>No BOM lines defined for this BOM.</p>
                <p>Click "Add BOM Line" to get started.</p>
              </div>
            ) : (
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {bomLinesList.map((line) => (
                  <div 
                    key={`${line.bom_id}-${line.version}-${line.bom_line}`} 
                    style={{ 
                      border: '1px solid #e9ecef', 
                      borderRadius: '6px', 
                      padding: '1rem', 
                      marginBottom: '1rem',
                      backgroundColor: '#f8f9fa'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
                          <span className="line-badge" style={{ fontSize: '0.9rem' }}>
                            {line.bom_line}
                          </span>
                          <strong>{line.material_description}</strong>
                        </div>
                        <div style={{ display: 'flex', gap: '2rem', fontSize: '0.9rem' }}>
                          <span>Qty: {formatNumber(line.qty)} {line.unit}</span>
                          <span>Unit Price: {formatCurrency(line.unit_price)}</span>
                          <span>Material Cost: {formatCurrency(line.material_cost)}</span>
                          <span>Target Cost: {formatCurrency(line.target_cost)}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          onClick={() => handleEditLine(line)}
                          className="action-btn edit-btn"
                          style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
                        >
                          ✏️ Edit
                        </button>
                        <button
                          onClick={() => handleDeleteLine(line.bom_id, line.version || '1.0', line.bom_line)}
                          className="action-btn delete-btn"
                          style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add/Edit BOM Line Form */}
          {showAddLine && (
            <div className="form-section">
              <h3>{editingLine ? 'Edit BOM Line' : 'Add New BOM Line'}</h3>
              <form onSubmit={handleSubmit}>
                <div className="form-row">
                  <div className="form-group">
                    <label>BOM Line *</label>
                    <input
                      type="number"
                      value={formData.bom_line}
                      onChange={(e) => handleInputChange('bom_line', e.target.value)}
                      className={errors.bom_line ? 'error' : ''}
                      placeholder="1"
                      min="1"
                    />
                    {errors.bom_line && <span className="error-message">{errors.bom_line}</span>}
                  </div>

                  <div className="form-group">
                    <label>Material Description *</label>
                    <input
                      type="text"
                      value={formData.material_description}
                      onChange={(e) => handleInputChange('material_description', e.target.value)}
                      className={errors.material_description ? 'error' : ''}
                      placeholder="Enter material description"
                    />
                    {errors.material_description && <span className="error-message">{errors.material_description}</span>}
                  </div>

                  <div className="form-group">
                    <label>Unit *</label>
                    <select
                      value={formData.unit}
                      onChange={(e) => handleInputChange('unit', e.target.value)}
                      className={errors.unit ? 'error' : ''}
                    >
                      <option value="">Select Unit</option>
                      <option value="each">Each</option>
                      <option value="gram">Gram</option>
                      <option value="inches">Inches</option>
                      <option value="feet">Feet</option>
                      <option value="meters">Meters</option>
                      <option value="pounds">Pounds</option>
                      <option value="kilograms">Kilograms</option>
                      <option value="pieces">Pieces</option>
                      <option value="units">Units</option>
                    </select>
                    {errors.unit && <span className="error-message">{errors.unit}</span>}
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Quantity *</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.qty}
                      onChange={(e) => handleInputChange('qty', e.target.value)}
                      className={errors.qty ? 'error' : ''}
                      placeholder="1.0"
                      min="0.01"
                    />
                    {errors.qty && <span className="error-message">{errors.qty}</span>}
                  </div>

                  <div className="form-group">
                    <label>Unit Price ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.unit_price}
                      onChange={(e) => handleInputChange('unit_price', e.target.value)}
                      className={errors.unit_price ? 'error' : ''}
                      placeholder="0.00"
                      min="0"
                    />
                    {errors.unit_price && <span className="error-message">{errors.unit_price}</span>}
                  </div>

                  <div className="form-group">
                    <label>Material Cost ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.material_cost}
                      onChange={(e) => handleInputChange('material_cost', e.target.value)}
                      className={errors.material_cost ? 'error' : ''}
                      placeholder="0.00"
                      min="0"
                      readOnly={formData.qty && formData.unit_price}
                    />
                    {errors.material_cost && <span className="error-message">{errors.material_cost}</span>}
                    {formData.qty && formData.unit_price && (
                      <small style={{color: '#6c757d', fontSize: '0.8rem'}}>Auto-calculated from quantity × unit price</small>
                    )}
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Target Cost ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.target_cost}
                      onChange={(e) => handleInputChange('target_cost', e.target.value)}
                      className={errors.target_cost ? 'error' : ''}
                      placeholder="0.00"
                      min="0"
                    />
                    {errors.target_cost && <span className="error-message">{errors.target_cost}</span>}
                  </div>
                </div>

                <div className="form-actions">
                  <button type="button" className="btn-secondary" onClick={handleCancelEdit}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    {editingLine ? 'Update BOM Line' : 'Create BOM Line'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Summary */}
          <div className="form-section">
            <h3>BOM Summary</h3>
            <div className="preview-grid">
              <div className="preview-item">
                <span className="preview-label">Total Lines:</span>
                <span className="preview-value">{bomLinesList.length}</span>
              </div>
              <div className="preview-item">
                <span className="preview-label">Total Material Cost:</span>
                <span className="preview-value">
                  {formatCurrency(bomLinesList.reduce((sum, line) => sum + (line.material_cost || 0), 0))}
                </span>
              </div>
              <div className="preview-item">
                <span className="preview-label">Total Target Cost:</span>
                <span className="preview-value">
                  {formatCurrency(bomLinesList.reduce((sum, line) => sum + (line.target_cost || 0), 0))}
                </span>
              </div>
              <div className="preview-item">
                <span className="preview-label">Cost Variance:</span>
                <span className="preview-value">
                  {(() => {
                    const materialCost = bomLinesList.reduce((sum, line) => sum + (line.material_cost || 0), 0);
                    const targetCost = bomLinesList.reduce((sum, line) => sum + (line.target_cost || 0), 0);
                    const variance = materialCost - targetCost;
                    return formatCurrency(variance);
                  })()}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BomLinesModal; 