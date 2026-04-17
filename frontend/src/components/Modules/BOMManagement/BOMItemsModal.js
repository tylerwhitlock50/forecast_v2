import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import { useConfirm } from '../../Common/ConfirmDialog';


const BOMItemsModal = ({ isOpen, onClose, bom, bomItems, bomDefinitions = [], onSave }) => {
  const { actions } = useForecast();
  const confirm = useConfirm();
  const [localBomItems, setLocalBomItems] = useState([]);
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
  const [copySourceBomId, setCopySourceBomId] = useState('');
  const [copying, setCopying] = useState(false);

  // Filter items for this BOM
  const currentBomItems = useMemo(() => {
    if (!bom || !bomItems) return [];
    return bomItems.filter(item => 
      item.bom_id === bom.bom_id && 
      (item.version || '1.0') === (bom.version || '1.0')
    ).sort((a, b) => (a.bom_line || 0) - (b.bom_line || 0));
  }, [bomItems, bom]);

  useEffect(() => {
    setLocalBomItems(currentBomItems);
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
    if (await confirm({
      title: 'Delete BOM line?',
      body: `Line ${item.bom_line || ''}: ${item.material_description || ''}`.trim(),
      confirmLabel: 'Delete',
      variant: 'destructive',
    })) {
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
    const maxLine = Math.max(...localBomItems.map(item => item.bom_line || 0), 0);
    return maxLine + 1;
  };

  // Candidate BOMs to copy lines from: any BOM that has lines, minus the
  // one we're editing. Display by name if we have it, else by id.
  const copyCandidates = useMemo(() => {
    const bomIdsWithLines = new Set(
      (bomItems || []).map((l) => l.bom_id).filter(Boolean)
    );
    const currentVersion = bom?.version || '1.0';
    const seen = new Set();
    const options = [];
    for (const def of bomDefinitions) {
      const key = `${def.bom_id}|${def.version || '1.0'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!bomIdsWithLines.has(def.bom_id)) continue;
      if (def.bom_id === bom?.bom_id && (def.version || '1.0') === currentVersion) continue;
      options.push({
        key,
        label: `${def.bom_name || def.bom_id} (v${def.version || '1.0'})`,
        bomId: def.bom_id,
        version: def.version || '1.0',
      });
    }
    return options;
  }, [bomDefinitions, bomItems, bom]);

  const handleCopyLines = async () => {
    if (!copySourceBomId) return;
    const [srcBomId, srcVersion] = copySourceBomId.split('|');
    const sourceLines = (bomItems || []).filter(
      (l) => l.bom_id === srcBomId && (l.version || '1.0') === srcVersion
    );
    if (sourceLines.length === 0) {
      toast.error('Source BOM has no lines');
      return;
    }
    setCopying(true);
    try {
      let next = getNextLineNumber();
      for (const line of sourceLines) {
        await actions.createBOM({
          bom_id: bom.bom_id,
          version: bom.version || '1.0',
          bom_line: next,
          material_description: line.material_description,
          qty: line.qty,
          unit: line.unit,
          unit_price: line.unit_price,
          material_cost: line.material_cost,
          target_cost: line.target_cost,
        });
        next += 1;
      }
      toast.success(`Copied ${sourceLines.length} line${sourceLines.length === 1 ? '' : 's'} from ${srcBomId}`);
      setCopySourceBomId('');
      await onSave();
    } catch (err) {
      console.error('Error copying lines:', err);
      toast.error('Failed to copy lines');
    } finally {
      setCopying(false);
    }
  };

  const formatCurrency = (value) => {
    return `$${Number(value || 0).toFixed(2)}`;
  };

  // BOM.material_cost is stored per unit of finished good, so summing
  // across lines gives the material cost contributed by this BOM to one
  // finished unit — the same number the /products/unit-cost preview uses.
  const totalMaterialCost = localBomItems.reduce((sum, item) => sum + (item.material_cost || 0), 0);
  const totalTargetCost = localBomItems.reduce((sum, item) => sum + (item.target_cost || 0), 0);
  const costVariance = totalMaterialCost - totalTargetCost;
  const incompleteLines = localBomItems.filter(
    (item) => !(item.qty > 0) || !(item.unit_price > 0) || !(item.material_cost > 0)
  );

  if (!isOpen || !bom) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '1000px', maxHeight: '90vh' }}>
        <div className="modal-header">
          <h2>Manage BOM Items - {bom.bom_name}</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="bom-items-container">
          {/* Summary Section */}
          <div className="bom-summary">
            <div className="summary-item">
              <span className="summary-label">Total Items:</span>
              <span className="summary-value">{localBomItems.length}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Material / Unit:</span>
              <span className="summary-value">{formatCurrency(totalMaterialCost)}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Target / Unit:</span>
              <span className="summary-value">{formatCurrency(totalTargetCost)}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Variance:</span>
              <span className={`summary-value ${costVariance > 0 ? 'over' : costVariance < 0 ? 'under' : 'on-target'}`}>
                {costVariance > 0 ? '+' : ''}{formatCurrency(costVariance)}
              </span>
            </div>
            {incompleteLines.length > 0 && (
              <div className="summary-item" style={{ color: '#b45309' }}>
                <span className="summary-label">⚠ Incomplete lines:</span>
                <span className="summary-value" title={`Lines missing qty or unit price: ${incompleteLines.map(l => l.material_description || `line ${l.bom_line}`).join(', ')}`}>
                  {incompleteLines.length}
                </span>
              </div>
            )}
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
            <div className="table-header" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <h3 style={{ marginRight: 'auto' }}>BOM Items</h3>
              {copyCandidates.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.85rem', color: '#6c757d' }}>Copy lines from:</label>
                  <select
                    value={copySourceBomId}
                    onChange={(e) => setCopySourceBomId(e.target.value)}
                    style={{ padding: '0.25rem 0.5rem' }}
                  >
                    <option value="">Select BOM…</option>
                    {copyCandidates.map((c) => (
                      <option key={c.key} value={c.key}>{c.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleCopyLines}
                    disabled={!copySourceBomId || copying}
                  >
                    {copying ? 'Copying…' : 'Append'}
                  </button>
                </div>
              )}
              {!showAddForm && (
                <button
                  className="btn-primary"
                  onClick={() => setShowAddForm(true)}
                >
                  ➕ Add Item
                </button>
              )}
            </div>

            {localBomItems.length === 0 ? (
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
                  {localBomItems.map(item => (
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