import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import './BOMManagement.css';

const BOMItemsModal = ({ isOpen, onClose, bom, items, onSave }) => {
  const { actions } = useForecast();
  const [bomItems, setBomItems] = useState([]);
  const [editingItem, setEditingItem] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    material_description: '',
    qty: '',
    unit: 'each',
    unit_price: '',
    material_cost: '',
    target_cost: ''
  });

  // Filter items for this BOM
  const currentBomItems = useMemo(() => {
    if (!bom) return [];
    return items.filter(item => 
      item.bom_id === bom.bom_id && 
      (item.version || '1.0') === (bom.version || '1.0')
    ).sort((a, b) => (a.bom_line || 0) - (b.bom_line || 0));
  }, [items, bom]);

  useEffect(() => {
    setBomItems(currentBomItems);
  }, [currentBomItems]);

  // Calculate material cost when qty or unit_price changes
  useEffect(() => {
    if (formData.qty && formData.unit_price) {
      const calculatedCost = parseFloat(formData.qty) * parseFloat(formData.unit_price);
      setFormData(prev => ({ ...prev, material_cost: calculatedCost.toFixed(2) }));
    }
  }, [formData.qty, formData.unit_price]);

  const resetForm = () => {
    setFormData({
      material_description: '',
      qty: '',
      unit: 'each',
      unit_price: '',
      material_cost: '',
      target_cost: ''
    });
    setEditingItem(null);
    setShowAddForm(false);
  };

  const handleEdit = (item) => {
    setFormData({
      material_description: item.material_description || '',
      qty: item.qty || '',
      unit: item.unit || 'each',
      unit_price: item.unit_price || '',
      material_cost: item.material_cost || '',
      target_cost: item.target_cost || ''
    });
    setEditingItem(item);
    setShowAddForm(true);
  };

  const handleSave = async () => {
    if (!formData.material_description.trim()) {
      toast.error('Material description is required');
      return;
    }

    try {
      const itemData = {
        bom_id: bom.bom_id,
        version: bom.version || '1.0',
        bom_line: editingItem ? editingItem.bom_line : getNextLineNumber(),
        material_description: formData.material_description,
        qty: parseFloat(formData.qty) || 0,
        unit: formData.unit,
        unit_price: parseFloat(formData.unit_price) || 0,
        material_cost: parseFloat(formData.material_cost) || 0,
        target_cost: parseFloat(formData.target_cost) || 0
      };

      if (editingItem) {
        // Update existing item
        await actions.updateBOM(`${editingItem.bom_id}-${editingItem.version}-${editingItem.bom_line}`, itemData);
        toast.success('BOM item updated successfully');
      } else {
        // Create new item
        await actions.createBOM(itemData);
        toast.success('BOM item added successfully');
      }

      resetForm();
      await onSave(); // Refresh data
    } catch (error) {
      console.error('Error saving BOM item:', error);
      toast.error('Failed to save BOM item');
    }
  };

  const handleDelete = async (item) => {
    if (window.confirm('Are you sure you want to delete this BOM item?')) {
      try {
        await actions.deleteBOM(`${item.bom_id}-${item.version}-${item.bom_line}`);
        toast.success('BOM item deleted successfully');
        await onSave(); // Refresh data
      } catch (error) {
        console.error('Error deleting BOM item:', error);
        toast.error('Failed to delete BOM item');
      }
    }
  };

  const getNextLineNumber = () => {
    const maxLine = Math.max(...bomItems.map(item => item.bom_line || 0), 0);
    return maxLine + 1;
  };

  const formatCurrency = (value) => {
    return `$${Number(value || 0).toFixed(2)}`;
  };

  const totalMaterialCost = bomItems.reduce((sum, item) => sum + (item.material_cost || 0), 0);
  const totalTargetCost = bomItems.reduce((sum, item) => sum + (item.target_cost || 0), 0);
  const costVariance = totalMaterialCost - totalTargetCost;

  if (!isOpen || !bom) return null;

  return (
    <div className="bom-items-modal-overlay" onClick={onClose}>
      <div className="bom-items-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Manage BOM Items - {bom.bom_name}</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="bom-items-container">
          {/* Summary Section */}
          <div className="bom-summary">
            <div className="summary-item">
              <span className="summary-label">Total Items:</span>
              <span className="summary-value">{bomItems.length}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Material Cost:</span>
              <span className="summary-value">{formatCurrency(totalMaterialCost)}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Target Cost:</span>
              <span className="summary-value">{formatCurrency(totalTargetCost)}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Variance:</span>
              <span className={`summary-value ${costVariance > 0 ? 'over' : costVariance < 0 ? 'under' : 'on-target'}`}>
                {costVariance > 0 ? '+' : ''}{formatCurrency(costVariance)}
              </span>
            </div>
          </div>

          {/* Add/Edit Form */}
          {showAddForm && (
            <div className="bom-item-form">
              <h3>{editingItem ? 'Edit' : 'Add'} BOM Item</h3>
              <div className="form-grid">
                <div className="form-group">
                  <label>Material Description *</label>
                  <input
                    type="text"
                    value={formData.material_description}
                    onChange={(e) => setFormData(prev => ({ ...prev, material_description: e.target.value }))}
                    placeholder="Enter material description"
                  />
                </div>
                <div className="form-group">
                  <label>Quantity</label>
                  <input
                    type="number"
                    step="0.001"
                    value={formData.qty}
                    onChange={(e) => setFormData(prev => ({ ...prev, qty: e.target.value }))}
                    placeholder="0"
                  />
                </div>
                <div className="form-group">
                  <label>Unit</label>
                  <select
                    value={formData.unit}
                    onChange={(e) => setFormData(prev => ({ ...prev, unit: e.target.value }))}
                  >
                    <option value="each">Each</option>
                    <option value="lbs">Pounds</option>
                    <option value="kg">Kilograms</option>
                    <option value="ft">Feet</option>
                    <option value="m">Meters</option>
                    <option value="sq ft">Square Feet</option>
                    <option value="sq m">Square Meters</option>
                    <option value="gal">Gallons</option>
                    <option value="L">Liters</option>
                    <option value="oz">Ounces</option>
                    <option value="g">Grams</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Unit Price</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.unit_price}
                    onChange={(e) => setFormData(prev => ({ ...prev, unit_price: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>
                <div className="form-group">
                  <label>Material Cost</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.material_cost}
                    onChange={(e) => setFormData(prev => ({ ...prev, material_cost: e.target.value }))}
                    placeholder="Auto-calculated"
                  />
                </div>
                <div className="form-group">
                  <label>Target Cost</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.target_cost}
                    onChange={(e) => setFormData(prev => ({ ...prev, target_cost: e.target.value }))}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={resetForm}>
                  Cancel
                </button>
                <button type="button" className="btn-primary" onClick={handleSave}>
                  {editingItem ? 'Update' : 'Add'} Item
                </button>
              </div>
            </div>
          )}

          {/* Items Table */}
          <div className="bom-items-table-container">
            <div className="table-header">
              <h3>BOM Items</h3>
              {!showAddForm && (
                <button 
                  className="btn-primary"
                  onClick={() => setShowAddForm(true)}
                >
                  ➕ Add Item
                </button>
              )}
            </div>

            {bomItems.length === 0 ? (
              <div className="no-items">
                <p>No items in this BOM yet.</p>
                <button 
                  className="btn-primary"
                  onClick={() => setShowAddForm(true)}
                >
                  Add First Item
                </button>
              </div>
            ) : (
              <table className="bom-items-table">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Material Description</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Unit Price</th>
                    <th>Material Cost</th>
                    <th>Target Cost</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bomItems.map(item => (
                    <tr key={`${item.bom_id}-${item.version}-${item.bom_line}`}>
                      <td>{item.bom_line}</td>
                      <td>{item.material_description}</td>
                      <td>{item.qty}</td>
                      <td>{item.unit}</td>
                      <td>{formatCurrency(item.unit_price)}</td>
                      <td>{formatCurrency(item.material_cost)}</td>
                      <td>{formatCurrency(item.target_cost)}</td>
                      <td>
                        <div className="item-actions">
                          <button
                            onClick={() => handleEdit(item)}
                            className="action-btn edit-btn"
                            title="Edit Item"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => handleDelete(item)}
                            className="action-btn delete-btn"
                            title="Delete Item"
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default BOMItemsModal;