import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useForecast } from '../../../context/ForecastContext';
import { useConfirm } from '../../Common/ConfirmDialog';
import { Modal, ModalHeader, ModalTitle, ModalClose } from '../../ui/modal';


const RouterOperationsModal = ({ isOpen, onClose, router, operations, machines, laborRates, onSave }) => {
  const { actions } = useForecast();
  const confirm = useConfirm();
  const [routerOperations, setRouterOperations] = useState([]);
  const [showAddOperation, setShowAddOperation] = useState(false);
  const [editingOperation, setEditingOperation] = useState(null);
  const [formData, setFormData] = useState({
    sequence: '',
    machine_id: '',
    machine_minutes: '',
    labor_minutes: '',
    labor_type_id: '',
    operation_description: ''
  });
  const [errors, setErrors] = useState({});

  // Initialize operations when modal opens or router changes
  useEffect(() => {
    if (isOpen && router) {
      const routerOps = operations
        .filter(op => op.router_id === router.router_id)
        .sort((a, b) => a.sequence - b.sequence);
      setRouterOperations(routerOps);
      setShowAddOperation(false);
      setEditingOperation(null);
      setFormData({
        sequence: '',
        machine_id: '',
        machine_minutes: '',
        labor_minutes: '',
        labor_type_id: '',
        operation_description: ''
      });
      setErrors({});
    }
  }, [isOpen, router, operations]);

  // Validate form
  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.sequence) {
      newErrors.sequence = 'Sequence is required';
    } else if (isNaN(formData.sequence) || formData.sequence < 1) {
      newErrors.sequence = 'Sequence must be a positive number';
    } else {
      // Check for duplicate sequence
      const existingOp = routerOperations.find(op => 
        op.sequence === parseInt(formData.sequence) && 
        (!editingOperation || op.operation_id !== editingOperation.operation_id)
      );
      if (existingOp) {
        newErrors.sequence = 'Sequence number already exists';
      }
    }
    
    if (!formData.machine_id.trim()) {
      newErrors.machine_id = 'Machine is required';
    }
    
    if (formData.machine_minutes && (isNaN(formData.machine_minutes) || formData.machine_minutes < 0)) {
      newErrors.machine_minutes = 'Machine minutes must be a valid positive number';
    }
    
    if (formData.labor_minutes && (isNaN(formData.labor_minutes) || formData.labor_minutes < 0)) {
      newErrors.labor_minutes = 'Labor minutes must be a valid positive number';
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
        router_id: router.router_id,
        sequence: parseInt(formData.sequence),
        machine_id: formData.machine_id,
        machine_minutes: formData.machine_minutes ? parseFloat(formData.machine_minutes) : 0,
        labor_minutes: formData.labor_minutes ? parseFloat(formData.labor_minutes) : 0,
        labor_type_id: formData.labor_type_id || null,
        operation_description: formData.operation_description || ''
      };
      
      // The context action shows the one toast (or the server's reason).
      if (editingOperation && editingOperation.operation_id) {
        await actions.updateRouterOperation(String(editingOperation.operation_id), dataToSave);
      } else if (editingOperation && editingOperation.router_id && editingOperation.sequence) {
        // Compound key: router_id-sequence
        await actions.updateRouterOperation(`${editingOperation.router_id}-${editingOperation.sequence}`, dataToSave);
      } else {
        await actions.createRouterOperation(dataToSave);
      }
      
      setShowAddOperation(false);
      setEditingOperation(null);
      await onSave();
    } catch (error) {
      console.error('Error saving operation:', error);
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

  // Handle edit operation
  const handleEditOperation = (operation) => {
    setEditingOperation(operation);
    setFormData({
      sequence: operation.sequence.toString(),
      machine_id: operation.machine_id || '',
      machine_minutes: operation.machine_minutes?.toString() || '',
      labor_minutes: operation.labor_minutes?.toString() || '',
      labor_type_id: operation.labor_type_id || '',
      operation_description: operation.operation_description || ''
    });
    setShowAddOperation(true);
  };

  // Handle delete operation
  const handleDeleteOperation = async (operationId) => {
    if (await confirm({
      title: 'Delete operation?',
      body: 'The router will be recalculated without this operation.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    })) {
      try {
        await actions.deleteRouterOperation(operationId);
        await onSave();
      } catch (error) {
        console.error('Error deleting operation:', error);
      }
    }
  };

  // Handle cancel edit
  const handleCancelEdit = () => {
    setShowAddOperation(false);
    setEditingOperation(null);
    setFormData({
      sequence: '',
      machine_id: '',
      machine_minutes: '',
      labor_minutes: '',
      labor_type_id: '',
      operation_description: ''
    });
    setErrors({});
  };

  // Get machine name for display
  const getMachineName = (machineId) => {
    const machine = machines.find(m => m.machine_id === machineId);
    return machine ? machine.machine_name : machineId;
  };

  // Get labor rate name for display
  const getLaborRateName = (rateId) => {
    const rate = laborRates.find(r => r.rate_id === rateId);
    return rate ? rate.rate_name : rateId;
  };

  // Per-op per-unit dollar cost. Mirrors the server-side rollup in
  // utils/cost_rollup.py so what shows here matches the forecast numbers.
  const formatDollar = (n) =>
    `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const operationCosts = (op) => {
    const machine = machines.find(m => m.machine_id === op.machine_id);
    const rate = laborRates.find(r => r.rate_id === op.labor_type_id);
    const machineCost = machine ? (op.machine_minutes || 0) / 60 * (machine.machine_rate || 0) : 0;
    const laborCost = rate ? (op.labor_minutes || 0) / 60 * (rate.rate_amount || 0) : 0;
    return {
      machineCost,
      laborCost,
      totalCost: machineCost + laborCost,
      missingMachine: !!op.machine_id && !machine,
      missingRate: !!op.labor_type_id && !rate,
    };
  };

  const routerTotals = routerOperations.reduce(
    (acc, op) => {
      const c = operationCosts(op);
      acc.machine += c.machineCost;
      acc.labor += c.laborCost;
      return acc;
    },
    { machine: 0, labor: 0 }
  );
  const totalCostPerUnit = routerTotals.machine + routerTotals.labor;

  if (!isOpen || !router) return null;

  return (
    <Modal onClose={onClose} className="max-w-6xl">
        <ModalHeader className="pr-14">
          <ModalTitle>
            Operations: {router.router_name || router.router_id}
            <span className="ml-2 text-sm font-normal text-gray-500">{router.router_id}</span>
          </ModalTitle>
          <ModalClose onClick={onClose} />
        </ModalHeader>

        <div className="router-form p-6">
          {/* Operations List */}
          <div className="form-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3>Operations ({routerOperations.length})</h3>
              <button 
                type="button" 
                className="btn-primary"
                onClick={() => setShowAddOperation(true)}
                disabled={showAddOperation}
              >
                ➕ Add Operation
              </button>
            </div>

            {routerOperations.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#6c757d' }}>
                <p>No operations defined for this router.</p>
                <p>Click "Add Operation" to get started.</p>
              </div>
            ) : (
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {routerOperations.map((operation) => {
                  const costs = operationCosts(operation);
                  return (
                  <div
                    key={operation.operation_id}
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
                          <span className="sequence-badge" style={{ fontSize: '0.9rem' }}>
                            {operation.sequence}
                          </span>
                          <strong>{getMachineName(operation.machine_id)}</strong>
                          {operation.operation_description && (
                            <span style={{ color: '#6c757d', fontSize: '0.9rem' }}>
                              - {operation.operation_description}
                            </span>
                          )}
                          <span style={{ marginLeft: 'auto', fontWeight: 600 }}>
                            {formatDollar(costs.totalCost)} / unit
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '2rem', fontSize: '0.9rem', flexWrap: 'wrap' }}>
                          <span>
                            Machine: {operation.machine_minutes || 0} min
                            <span style={{ color: '#6c757d' }}> → {formatDollar(costs.machineCost)}</span>
                          </span>
                          <span>
                            Labor: {operation.labor_minutes || 0} min
                            <span style={{ color: '#6c757d' }}> → {formatDollar(costs.laborCost)}</span>
                          </span>
                          {operation.labor_type_id && (
                            <span>Rate: {getLaborRateName(operation.labor_type_id)}</span>
                          )}
                          {(costs.missingMachine || costs.missingRate) && (
                            <span style={{ color: '#b45309' }}>
                              ⚠ {costs.missingMachine ? 'unknown machine' : ''}{costs.missingMachine && costs.missingRate ? ', ' : ''}{costs.missingRate ? 'unknown labor rate' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          onClick={() => handleEditOperation(operation)}
                          className="action-btn edit-btn"
                          style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
                        >
                          ✏️ Edit
                        </button>
                        <button
                          onClick={() => handleDeleteOperation(`${operation.router_id}-${operation.sequence}`)}
                          className="action-btn delete-btn"
                          style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Add/Edit Operation Form */}
          {showAddOperation && (
            <div className="form-section">
              <h3>{editingOperation ? 'Edit Operation' : 'Add New Operation'}</h3>
              <form onSubmit={handleSubmit}>
                <div className="form-row">
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
                    >
                      <option value="">Select Labor Rate</option>
                      {laborRates.map(rate => (
                        <option key={rate.rate_id} value={rate.rate_id}>
                          {rate.rate_id} - {rate.rate_name} (${rate.rate_amount}/hr)
                        </option>
                      ))}
                    </select>
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

                  <div className="form-group">
                    <label>Description</label>
                    <input
                      type="text"
                      value={formData.operation_description}
                      onChange={(e) => handleInputChange('operation_description', e.target.value)}
                      placeholder="Operation description"
                    />
                  </div>
                </div>

                <div className="form-actions">
                  <button type="button" className="btn-secondary" onClick={handleCancelEdit}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    {editingOperation ? 'Update Operation' : 'Create Operation'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Summary */}
          <div className="form-section">
            <h3>Router Summary</h3>
            <div className="preview-grid">
              <div className="preview-item">
                <span className="preview-label">Total Operations:</span>
                <span className="preview-value">{routerOperations.length}</span>
              </div>
              <div className="preview-item">
                <span className="preview-label">Machine Time / unit:</span>
                <span className="preview-value">
                  {routerOperations.reduce((sum, op) => sum + (op.machine_minutes || 0), 0).toFixed(1)} min
                  <span style={{ color: '#6c757d', marginLeft: '0.5rem' }}>
                    → {formatDollar(routerTotals.machine)}
                  </span>
                </span>
              </div>
              <div className="preview-item">
                <span className="preview-label">Labor Time / unit:</span>
                <span className="preview-value">
                  {routerOperations.reduce((sum, op) => sum + (op.labor_minutes || 0), 0).toFixed(1)} min
                  <span style={{ color: '#6c757d', marginLeft: '0.5rem' }}>
                    → {formatDollar(routerTotals.labor)}
                  </span>
                </span>
              </div>
              <div className="preview-item" style={{ fontWeight: 600 }}>
                <span className="preview-label">Total Conversion Cost:</span>
                <span className="preview-value">{formatDollar(totalCostPerUnit)} / unit</span>
              </div>
            </div>
          </div>
        </div>
    </Modal>
  );
};

export default RouterOperationsModal; 