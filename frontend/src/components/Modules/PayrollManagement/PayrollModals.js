import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { parseLocalDate, toDateOnly } from '../../../lib/dates';
import { ANNUAL_SALARY_THRESHOLD, MAX_PLAUSIBLE_HOURLY_RATE, allocationTotal as sumAllocations } from './payrollView';

/**
 * Pay-rate validation, the same rules as the API: salaried staff are entered
 * as an ANNUAL salary; an hourly rate is dollars per hour.
 */
export const validatePayRate = (rateType, rate) => {
  const value = Number(rate) || 0;
  if (value <= 0) {
    return rateType === 'salary' ? 'Annual salary must be greater than 0' : 'Hourly rate must be greater than 0';
  }
  if (rateType === 'salary' && value < ANNUAL_SALARY_THRESHOLD) {
    return `Enter the annual salary (e.g. 85000), not an hourly rate. A salary under ${ANNUAL_SALARY_THRESHOLD.toLocaleString()} would be read as an hourly rate x 2,080.`;
  }
  if (rateType !== 'salary' && value > MAX_PLAUSIBLE_HOURLY_RATE) {
    return `$${value.toLocaleString()} an hour looks like an annual salary - choose Rate Type "Salary" for salaried staff.`;
  }
  return null;
};

// Employee Modal for adding/editing employees
export const EmployeeModal = ({ employee, departments, businessUnits, onSave, onCancel, activeScenario = null, activeScenarioName = '' }) => {
  const [formData, setFormData] = useState({
    employee_name: '',
    department: '',
    hourly_rate: 0,
    rate_type: 'hourly',
    weekly_hours: 40,
    start_date: toDateOnly(),
    end_date: '',
    next_review_date: '',
    expected_raise: 0,
    benefits_eligible: true,
    allocations: { 'Customer-Centric Brands': 100 },
    forecast_id: activeScenario || null
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

    const rateError = validatePayRate(formData.rate_type, formData.hourly_rate);
    if (rateError) {
      newErrors.hourly_rate = rateError;
    }

    if (formData.weekly_hours <= 0 || formData.weekly_hours > 168) {
      newErrors.weekly_hours = 'Weekly hours must be between 1 and 168';
    }

    if (!formData.start_date) {
      newErrors.start_date = 'Start date is required';
    }

    // Validate allocations
    if (Math.abs(sumAllocations(formData.allocations) - 100) > 0.01) {
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
    const startDate = parseLocalDate(formData.start_date) || new Date();
    startDate.setFullYear(startDate.getFullYear() + 1);
    return toDateOnly(startDate);
  };

  const allocationTotal = sumAllocations(formData.allocations);

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

              <div className="form-group">
                <label>Scope</label>
                <select
                  value={formData.forecast_id || ''}
                  onChange={(e) => setFormData({...formData, forecast_id: e.target.value || null})}
                >
                  <option value="">Company-wide (in every scenario)</option>
                  {activeScenario && (
                    <option value={activeScenario}>This scenario only ({activeScenarioName || activeScenario})</option>
                  )}
                  {formData.forecast_id && formData.forecast_id !== activeScenario && (
                    <option value={formData.forecast_id}>Scenario {formData.forecast_id} only</option>
                  )}
                </select>
                <small className="text-muted-foreground">
                  Company-wide employees roll into every scenario's statements. Scenario-only employees are copied when that scenario is branched.
                </small>
              </div>
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
                <label htmlFor="payroll-rate">
                  {formData.rate_type === 'salary' ? 'Annual Salary *' : 'Hourly Rate *'}
                </label>
                <div className="input-group">
                  <span className="input-prefix">$</span>
                  <input
                    id="payroll-rate"
                    type="number"
                    step="0.01"
                    value={formData.hourly_rate}
                    onChange={(e) => setFormData({...formData, hourly_rate: parseFloat(e.target.value) || 0})}
                    className={errors.hourly_rate ? 'error' : ''}
                  />
                  <span className="input-suffix">{formData.rate_type === 'salary' ? '/ year' : '/ hour'}</span>
                </div>
                <small>
                  {formData.rate_type === 'salary'
                    ? 'The yearly salary, e.g. 85000. Payroll cost = salary x (1 + employer taxes + benefits).'
                    : 'Dollars per hour. Annual gross = rate x weekly hours x 52.'}
                </small>
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
                  value={formData.end_date || ''}
                  onChange={(e) => setFormData({...formData, end_date: e.target.value})}
                />
              </div>

              <div className="form-group">
                <label>Next Review Date</label>
                <div className="input-group">
                  <input
                    type="date"
                    value={formData.next_review_date || ''}
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
                <small>
                  Enter a fraction (0.05 for 5%) or a flat amount in the rate's units
                  ({formData.rate_type === 'salary' ? 'e.g. 5000 a year' : 'e.g. 2.50 an hour'}).
                </small>
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
    const total = sumAllocations(allocations);
    if (total > 0) {
      const normalized = {};
      Object.keys(allocations).forEach(unit => {
        normalized[unit] = (allocations[unit] / total) * 100;
      });
      setAllocations(normalized);
    }
  };

  const handleSubmit = () => {
    if (Math.abs(sumAllocations(allocations) - 100) > 0.01) {
      toast.error('Allocations must sum to 100%');
      return;
    }

    onSave({
      ...employee,
      allocations
    });
  };

  const allocationTotal = sumAllocations(allocations);

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
const RateInput = ({ id, label, help, value, onChange, step = '0.001', digits = 2 }) => (
  <div className="form-group">
    <label htmlFor={id}>{label}</label>
    <div className="input-group">
      <input
        id={id}
        type="number"
        step={step}
        min="0"
        max="1"
        value={value || 0}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
      <span className="input-suffix">({((value || 0) * 100).toFixed(digits)}%)</span>
    </div>
    {help && <small>{help}</small>}
  </div>
);

export const ConfigurationModal = ({ config, onSave, onCancel }) => {
  const [formData, setFormData] = useState({});

  useEffect(() => {
    setFormData({ ...config });
  }, [config]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  const resetToDefaults = () => {
    setFormData({
      federalTaxRate: 0.22,
      stateTaxRate: 0.06,
      socialSecurityRate: 0.062,
      medicareRate: 0.0145,
      unemploymentRate: 0.006,
      benefitsRate: 0.25,
      workersCompRate: 0.015,
      payFrequency: 'biweekly'
    });
  };

  const set = (field) => (value) => setFormData({ ...formData, [field]: value });
  const employerRate = (formData.socialSecurityRate || 0) + (formData.medicareRate || 0)
    + (formData.unemploymentRate || 0) + (formData.workersCompRate || 0);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Payroll Configuration</h3>
          <button className="close-btn" onClick={onCancel}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-content">
          <div className="config-section">
            <h4>Pay Schedule</h4>
            <div className="form-group">
              <label htmlFor="payroll-frequency">Pay Frequency</label>
              <select
                id="payroll-frequency"
                value={formData.payFrequency || 'biweekly'}
                onChange={(e) => setFormData({...formData, payFrequency: e.target.value})}
              >
                <option value="weekly">Weekly (52 runs/year)</option>
                <option value="biweekly">Biweekly (26 runs/year)</option>
                <option value="semimonthly">Semimonthly (24 runs/year)</option>
                <option value="monthly">Monthly (12 runs/year)</option>
              </select>
              <small>Used for the pay-run forecast. Financial statements always use calendar months.</small>
            </div>
          </div>

          <div className="config-section">
            <h4>Employer Payroll Taxes (added to payroll cost)</h4>
            <RateInput id="payroll-ss" label="Social Security Rate (employer)" value={formData.socialSecurityRate}
              onChange={set('socialSecurityRate')} digits={1} />
            <RateInput id="payroll-medicare" label="Medicare Rate (employer)" value={formData.medicareRate}
              onChange={set('medicareRate')} />
            <RateInput id="payroll-unemployment" label="Unemployment Rate (FUTA / SUTA)" value={formData.unemploymentRate}
              onChange={set('unemploymentRate')} digits={1} />
            <RateInput id="payroll-workers-comp" label="Workers' Compensation Rate" value={formData.workersCompRate}
              onChange={set('workersCompRate')} />
          </div>

          <div className="config-section">
            <h4>Benefits (benefits-eligible staff, added to payroll cost)</h4>
            <RateInput id="payroll-benefits" label="Benefits Rate" value={formData.benefitsRate}
              onChange={set('benefitsRate')} step="0.01" digits={1}
              help="Percentage of gross pay for health insurance, retirement, etc." />
          </div>

          <div className="config-section">
            <h4>Employee Withholding (not an employer cost)</h4>
            <RateInput id="payroll-federal" label="Federal Income Tax Rate - employee withholding (not an employer cost)"
              value={formData.federalTaxRate} onChange={set('federalTaxRate')} digits={1} />
            <RateInput id="payroll-state" label="State Income Tax Rate - employee withholding (not an employer cost)"
              value={formData.stateTaxRate} onChange={set('stateTaxRate')} digits={1} />
            <small>
              Income tax is withheld from the employee's gross pay. It is shown as withholding and net pay only and
              never changes payroll cost or the financial statements.
            </small>
          </div>

          <div className="config-section">
            <p className="text-sm" data-testid="burden-preview">
              Payroll cost = gross pay x {(1 + employerRate + (formData.benefitsRate || 0)).toFixed(4)} for
              benefits-eligible staff ({(1 + employerRate).toFixed(4)} otherwise).
            </p>
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
