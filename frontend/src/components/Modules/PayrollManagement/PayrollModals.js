import React, { useState, useEffect } from 'react';

// Employee Modal for adding/editing employees
export const EmployeeModal = ({ employee, departments, businessUnits, onSave, onCancel }) => {
  const [formData, setFormData] = useState({
    employee_name: '',
    department: '',
    hourly_rate: 0,
    rate_type: 'hourly',
    weekly_hours: 40,
    start_date: new Date().toISOString().split('T')[0],
    end_date: '',
    next_review_date: '',
    expected_raise: 0,
    benefits_eligible: true,
    allocations: { 'Customer-Centric Brands': 100 }
  });

  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (employee) {
      setFormData({ ...employee });
    }
  }, [employee]);

  const validateForm = () => {
    const newErrors = {};

    if (!formData.employee_name.trim()) {
      newErrors.employee_name = 'Employee name is required';
    }

    if (!formData.department.trim()) {
      newErrors.department = 'Department is required';
    }

    if (formData.hourly_rate <= 0) {
      newErrors.hourly_rate = 'Hourly rate must be greater than 0';
    }

    if (formData.weekly_hours <= 0 || formData.weekly_hours > 168) {
      newErrors.weekly_hours = 'Weekly hours must be between 1 and 168';
    }

    if (!formData.start_date) {
      newErrors.start_date = 'Start date is required';
    }

    // Validate allocations
    const allocationTotal = Object.values(formData.allocations || {}).reduce((sum, val) => sum + val, 0);
    if (Math.abs(allocationTotal - 100) > 0.01) {
      newErrors.allocations = 'Allocations must sum to 100%';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validateForm()) {
      onSave(formData);
    }
  };

  const handleAllocationChange = (businessUnit, value) => {
    const numValue = parseFloat(value) || 0;
    setFormData(prev => ({
      ...prev,
      allocations: {
        ...prev.allocations,
        [businessUnit]: numValue
      }
    }));
  };

  const autoDistributeAllocations = () => {
    const equalShare = 100 / businessUnits.length;
    const newAllocations = {};
    businessUnits.forEach(unit => {
      newAllocations[unit] = equalShare;
    });
    setFormData(prev => ({
      ...prev,
      allocations: newAllocations
    }));
  };

  const calculateNextReviewDate = () => {
    const startDate = new Date(formData.start_date);
    startDate.setFullYear(startDate.getFullYear() + 1);
    return startDate.toISOString().split('T')[0];
  };

  const allocationTotal = Object.values(formData.allocations || {}).reduce((sum, val) => sum + val, 0);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal large" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{employee?.employee_id ? 'Edit Employee' : 'Add New Employee'}</h3>
          <button className="close-btn" onClick={onCancel}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-content">
          <div className="form-grid">
            <div className="form-section">
              <h4>Basic Information</h4>
              
              <div className="form-group">
                <label>Employee Name *</label>
                <input
                  type="text"
                  value={formData.employee_name}
                  onChange={(e) => setFormData({...formData, employee_name: e.target.value})}
                  className={errors.employee_name ? 'error' : ''}
                />
                {errors.employee_name && <span className="error-text">{errors.employee_name}</span>}
              </div>

              <div className="form-group">
                <label>Department *</label>
                <select
                  value={formData.department}
                  onChange={(e) => setFormData({...formData, department: e.target.value})}
                  className={errors.department ? 'error' : ''}
                >
                  <option value="">Select Department</option>
                  {departments.map(dept => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                  <option value="NEW_DEPARTMENT">Add New Department...</option>
                </select>
                {errors.department && <span className="error-text">{errors.department}</span>}
              </div>

              {formData.department === 'NEW_DEPARTMENT' && (
                <div className="form-group">
                  <label>New Department Name</label>
                  <input
                    type="text"
                    placeholder="Enter new department name"
                    onChange={(e) => setFormData({...formData, department: e.target.value})}
                  />
                </div>
              )}
            </div>

            <div className="form-section">
              <h4>Compensation</h4>
              
              <div className="form-group">
                <label>Rate Type</label>
                <select
                  value={formData.rate_type}
                  onChange={(e) => setFormData({...formData, rate_type: e.target.value})}
                >
                  <option value="hourly">Hourly</option>
                  <option value="salary">Salary</option>
                </select>
              </div>

              <div className="form-group">
                <label>
                  {formData.rate_type === 'salary' ? 'Annual Salary *' : 'Hourly Rate *'}
                </label>
                <div className="input-group">
                  <span className="input-prefix">$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.hourly_rate}
                    onChange={(e) => setFormData({...formData, hourly_rate: parseFloat(e.target.value) || 0})}
                    className={errors.hourly_rate ? 'error' : ''}
                  />
                </div>
                {errors.hourly_rate && <span className="error-text">{errors.hourly_rate}</span>}
              </div>

              <div className="form-group">
                <label>Weekly Hours *</label>
                <input
                  type="number"
                  value={formData.weekly_hours}
                  onChange={(e) => setFormData({...formData, weekly_hours: parseInt(e.target.value) || 0})}
                  className={errors.weekly_hours ? 'error' : ''}
                />
                {errors.weekly_hours && <span className="error-text">{errors.weekly_hours}</span>}
              </div>

              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={formData.benefits_eligible}
                    onChange={(e) => setFormData({...formData, benefits_eligible: e.target.checked})}
                  />
                  Benefits Eligible
                </label>
              </div>
            </div>

            <div className="form-section">
              <h4>Employment Dates</h4>
              
              <div className="form-group">
                <label>Start Date *</label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({...formData, start_date: e.target.value})}
                  className={errors.start_date ? 'error' : ''}
                />
                {errors.start_date && <span className="error-text">{errors.start_date}</span>}
              </div>

              <div className="form-group">
                <label>End Date (Optional)</label>
                <input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData({...formData, end_date: e.target.value})}
                />
              </div>

              <div className="form-group">
                <label>Next Review Date</label>
                <div className="input-group">
                  <input
                    type="date"
                    value={formData.next_review_date}
                    onChange={(e) => setFormData({...formData, next_review_date: e.target.value})}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setFormData({...formData, next_review_date: calculateNextReviewDate()})}
                  >
                    Auto
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label>Expected Raise</label>
                <div className="input-group">
                  <input
                    type="number"
                    step="0.01"
                    value={formData.expected_raise}
                    onChange={(e) => setFormData({...formData, expected_raise: parseFloat(e.target.value) || 0})}
                    placeholder="Amount or percentage"
                  />
                  <span className="input-suffix">
                    {formData.expected_raise > 1 ? '$' : '%'}
                  </span>
                </div>
                <small>Enter percentage (0.05 for 5%) or flat amount ($2.50)</small>
              </div>
            </div>

            <div className="form-section full-width">
              <h4>
                Business Unit Allocation 
                <span className={`allocation-total ${Math.abs(allocationTotal - 100) > 0.01 ? 'invalid' : 'valid'}`}>
                  ({allocationTotal.toFixed(1)}%)
                </span>
              </h4>
              
              <div className="allocation-controls">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={autoDistributeAllocations}
                >
                  Equal Distribution
                </button>
              </div>

              <div className="allocation-grid">
                {businessUnits.map(unit => (
                  <div key={unit} className="allocation-item">
                    <label>{unit}</label>
                    <div className="input-group">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={formData.allocations?.[unit] || 0}
                        onChange={(e) => handleAllocationChange(unit, e.target.value)}
                      />
                      <span className="input-suffix">%</span>
                    </div>
                    <div 
                      className="allocation-bar"
                      style={{ width: `${formData.allocations?.[unit] || 0}%` }}
                    />
                  </div>
                ))}
              </div>

              {errors.allocations && <span className="error-text">{errors.allocations}</span>}
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" onClick={onCancel} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              {employee?.employee_id ? 'Update Employee' : 'Add Employee'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Allocation Modal for quick allocation editing
export const AllocationModal = ({ employee, businessUnits, onSave, onCancel }) => {
  const [allocations, setAllocations] = useState({});

  useEffect(() => {
    if (employee?.allocations) {
      setAllocations({ ...employee.allocations });
    }
  }, [employee]);

  const handleAllocationChange = (businessUnit, value) => {
    const numValue = parseFloat(value) || 0;
    setAllocations(prev => ({
      ...prev,
      [businessUnit]: numValue
    }));
  };

  const autoDistribute = () => {
    const equalShare = 100 / businessUnits.length;
    const newAllocations = {};
    businessUnits.forEach(unit => {
      newAllocations[unit] = equalShare;
    });
    setAllocations(newAllocations);
  };

  const normalizeAllocations = () => {
    const total = Object.values(allocations).reduce((sum, val) => sum + val, 0);
    if (total > 0) {
      const normalized = {};
      Object.keys(allocations).forEach(unit => {
        normalized[unit] = (allocations[unit] / total) * 100;
      });
      setAllocations(normalized);
    }
  };

  const handleSubmit = () => {
    const allocationTotal = Object.values(allocations).reduce((sum, val) => sum + val, 0);
    if (Math.abs(allocationTotal - 100) > 0.01) {
      alert('Allocations must sum to 100%');
      return;
    }

    onSave({
      ...employee,
      allocations
    });
  };

  const allocationTotal = Object.values(allocations).reduce((sum, val) => sum + val, 0);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit Allocation - {employee?.employee_name}</h3>
          <button className="close-btn" onClick={onCancel}>×</button>
        </div>

        <div className="modal-content">
          <div className="allocation-header">
            <div className="employee-info">
              <span className="employee-name">{employee?.employee_name}</span>
              <span className="employee-dept">{employee?.department}</span>
            </div>
            <div className={`allocation-total ${Math.abs(allocationTotal - 100) > 0.01 ? 'invalid' : 'valid'}`}>
              Total: {allocationTotal.toFixed(1)}%
            </div>
          </div>

          <div className="allocation-controls">
            <button className="btn-secondary" onClick={autoDistribute}>
              Equal Distribution
            </button>
            <button className="btn-secondary" onClick={normalizeAllocations}>
              Normalize to 100%
            </button>
          </div>

          <div className="allocation-list">
            {businessUnits.map(unit => (
              <div key={unit} className="allocation-row">
                <div className="unit-info">
                  <label>{unit}</label>
                </div>
                <div className="allocation-input">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="0.1"
                    value={allocations[unit] || 0}
                    onChange={(e) => handleAllocationChange(unit, e.target.value)}
                    className="allocation-slider"
                  />
                  <div className="input-group">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={allocations[unit] || 0}
                      onChange={(e) => handleAllocationChange(unit, e.target.value)}
                    />
                    <span className="input-suffix">%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="visual-allocation">
            <h4>Visual Allocation</h4>
            <div className="allocation-bars">
              {businessUnits.map(unit => (
                <div key={unit} className="visual-bar">
                  <div className="bar-label">{unit}</div>
                  <div className="bar-container">
                    <div 
                      className="bar-fill"
                      style={{ width: `${allocations[unit] || 0}%` }}
                    />
                  </div>
                  <div className="bar-percentage">{(allocations[unit] || 0).toFixed(1)}%</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
          <button onClick={handleSubmit} className="btn-primary">
            Save Allocation
          </button>
        </div>
      </div>
    </div>
  );
};

// Configuration Modal for tax and benefit rates
export const ConfigurationModal = ({ config, onSave, onCancel }) => {
  const [formData, setFormData] = useState({});

  useEffect(() => {
    setFormData({ ...config });
  }, [config]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
    onCancel();
  };

  const resetToDefaults = () => {
    setFormData({
      federalTaxRate: 0.22,
      stateTaxRate: 0.06,
      socialSecurityRate: 0.062,
      medicareRate: 0.0145,
      unemploymentRate: 0.006,
      benefitsRate: 0.25,
      workersCompRate: 0.015
    });
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Payroll Configuration</h3>
          <button className="close-btn" onClick={onCancel}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-content">
          <div className="config-section">
            <h4>Tax Rates</h4>
            
            <div className="form-group">
              <label>Federal Tax Rate</label>
              <div className="input-group">
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  max="1"
                  value={formData.federalTaxRate || 0}
                  onChange={(e) => setFormData({...formData, federalTaxRate: parseFloat(e.target.value) || 0})}
                />
                <span className="input-suffix">({(formData.federalTaxRate * 100).toFixed(1)}%)</span>
              </div>
            </div>

            <div className="form-group">
              <label>State Tax Rate</label>
              <div className="input-group">
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  max="1"
                  value={formData.stateTaxRate || 0}
                  onChange={(e) => setFormData({...formData, stateTaxRate: parseFloat(e.target.value) || 0})}
                />
                <span className="input-suffix">({(formData.stateTaxRate * 100).toFixed(1)}%)</span>
              </div>
            </div>

            <div className="form-group">
              <label>Social Security Rate</label>
              <div className="input-group">
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  max="1"
                  value={formData.socialSecurityRate || 0}
                  onChange={(e) => setFormData({...formData, socialSecurityRate: parseFloat(e.target.value) || 0})}
                />
                <span className="input-suffix">({(formData.socialSecurityRate * 100).toFixed(1)}%)</span>
              </div>
            </div>

            <div className="form-group">
              <label>Medicare Rate</label>
              <div className="input-group">
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  max="1"
                  value={formData.medicareRate || 0}
                  onChange={(e) => setFormData({...formData, medicareRate: parseFloat(e.target.value) || 0})}
                />
                <span className="input-suffix">({(formData.medicareRate * 100).toFixed(2)}%)</span>
              </div>
            </div>

            <div className="form-group">
              <label>Unemployment Rate</label>
              <div className="input-group">
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  max="1"
                  value={formData.unemploymentRate || 0}
                  onChange={(e) => setFormData({...formData, unemploymentRate: parseFloat(e.target.value) || 0})}
                />
                <span className="input-suffix">({(formData.unemploymentRate * 100).toFixed(1)}%)</span>
              </div>
            </div>
          </div>

          <div className="config-section">
            <h4>Other Costs</h4>
            
            <div className="form-group">
              <label>Benefits Rate</label>
              <div className="input-group">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={formData.benefitsRate || 0}
                  onChange={(e) => setFormData({...formData, benefitsRate: parseFloat(e.target.value) || 0})}
                />
                <span className="input-suffix">({(formData.benefitsRate * 100).toFixed(1)}%)</span>
              </div>
              <small>Percentage of gross pay for health insurance, retirement, etc.</small>
            </div>

            <div className="form-group">
              <label>Workers' Compensation Rate</label>
              <div className="input-group">
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  max="1"
                  value={formData.workersCompRate || 0}
                  onChange={(e) => setFormData({...formData, workersCompRate: parseFloat(e.target.value) || 0})}
                />
                <span className="input-suffix">({(formData.workersCompRate * 100).toFixed(2)}%)</span>
              </div>
            </div>
          </div>

          <div className="config-actions">
            <button type="button" onClick={resetToDefaults} className="btn-secondary">
              Reset to Defaults
            </button>
          </div>

          <div className="modal-actions">
            <button type="button" onClick={onCancel} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Save Configuration
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};