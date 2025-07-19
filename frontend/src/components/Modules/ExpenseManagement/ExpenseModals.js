import React, { useState, useEffect } from 'react';

export const ExpenseModal = ({ expense, categories, onSave, onClose }) => {
  const [formData, setFormData] = useState({
    expense_name: '',
    category_id: '',
    amount: '',
    frequency: 'monthly',
    start_date: '',
    end_date: '',
    vendor: '',
    description: '',
    payment_method: '',
    approval_required: false,
    approved_by: '',
    approval_date: '',
    expense_allocation: 'immediate',
    amortization_months: '',
    department: '',
    cost_center: '',
    is_active: true
  });

  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (expense) {
      setFormData({
        expense_name: expense.expense_name || '',
        category_id: expense.category_id || '',
        amount: expense.amount || '',
        frequency: expense.frequency || 'monthly',
        start_date: expense.start_date || '',
        end_date: expense.end_date || '',
        vendor: expense.vendor || '',
        description: expense.description || '',
        payment_method: expense.payment_method || '',
        approval_required: expense.approval_required || false,
        approved_by: expense.approved_by || '',
        approval_date: expense.approval_date || '',
        expense_allocation: expense.expense_allocation || 'immediate',
        amortization_months: expense.amortization_months || '',
        department: expense.department || '',
        cost_center: expense.cost_center || '',
        is_active: expense.is_active !== undefined ? expense.is_active : true
      });
    }
  }, [expense]);

  const validateForm = () => {
    const newErrors = {};

    if (!formData.expense_name.trim()) {
      newErrors.expense_name = 'Expense name is required';
    }

    if (!formData.category_id) {
      newErrors.category_id = 'Category is required';
    }

    if (!formData.amount || formData.amount <= 0) {
      newErrors.amount = 'Amount must be greater than 0';
    }

    if (!formData.start_date) {
      newErrors.start_date = 'Start date is required';
    }

    if (formData.expense_allocation === 'amortized' && (!formData.amortization_months || formData.amortization_months <= 0)) {
      newErrors.amortization_months = 'Amortization months required for amortized allocation';
    }

    if (formData.end_date && formData.start_date && new Date(formData.end_date) <= new Date(formData.start_date)) {
      newErrors.end_date = 'End date must be after start date';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    // Clean up data
    const submitData = { ...formData };
    
    // Convert string numbers to numbers
    submitData.amount = parseFloat(submitData.amount);
    if (submitData.amortization_months) {
      submitData.amortization_months = parseInt(submitData.amortization_months);
    }

    // Remove empty strings
    Object.keys(submitData).forEach(key => {
      if (submitData[key] === '') {
        submitData[key] = null;
      }
    });

    onSave(submitData);
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content expense-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{expense ? 'Edit Expense' : 'Add New Expense'}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="expense-form">
          <div className="form-grid">
            <div className="form-group">
              <label>Expense Name *</label>
              <input
                type="text"
                value={formData.expense_name}
                onChange={(e) => handleChange('expense_name', e.target.value)}
                className={errors.expense_name ? 'error' : ''}
                placeholder="e.g., Office Rent, Software License"
              />
              {errors.expense_name && <span className="error-text">{errors.expense_name}</span>}
            </div>

            <div className="form-group">
              <label>Category *</label>
              <select
                value={formData.category_id}
                onChange={(e) => handleChange('category_id', e.target.value)}
                className={errors.category_id ? 'error' : ''}
              >
                <option value="">Select Category</option>
                {categories.map(cat => (
                  <option key={cat.category_id} value={cat.category_id}>
                    {cat.category_name} ({cat.category_type})
                  </option>
                ))}
              </select>
              {errors.category_id && <span className="error-text">{errors.category_id}</span>}
            </div>

            <div className="form-group">
              <label>Amount *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.amount}
                onChange={(e) => handleChange('amount', e.target.value)}
                className={errors.amount ? 'error' : ''}
                placeholder="0.00"
              />
              {errors.amount && <span className="error-text">{errors.amount}</span>}
            </div>

            <div className="form-group">
              <label>Frequency *</label>
              <select
                value={formData.frequency}
                onChange={(e) => handleChange('frequency', e.target.value)}
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="biannually">Biannually</option>
                <option value="annually">Annually</option>
                <option value="one_time">One-time</option>
              </select>
            </div>

            <div className="form-group">
              <label>Start Date *</label>
              <input
                type="date"
                value={formData.start_date}
                onChange={(e) => handleChange('start_date', e.target.value)}
                className={errors.start_date ? 'error' : ''}
              />
              {errors.start_date && <span className="error-text">{errors.start_date}</span>}
            </div>

            <div className="form-group">
              <label>End Date</label>
              <input
                type="date"
                value={formData.end_date}
                onChange={(e) => handleChange('end_date', e.target.value)}
                className={errors.end_date ? 'error' : ''}
              />
              {errors.end_date && <span className="error-text">{errors.end_date}</span>}
            </div>

            <div className="form-group">
              <label>Vendor</label>
              <input
                type="text"
                value={formData.vendor}
                onChange={(e) => handleChange('vendor', e.target.value)}
                placeholder="e.g., Office Depot, Electric Company"
              />
            </div>

            <div className="form-group">
              <label>Payment Method</label>
              <select
                value={formData.payment_method}
                onChange={(e) => handleChange('payment_method', e.target.value)}
              >
                <option value="">Select Payment Method</option>
                <option value="ACH">ACH</option>
                <option value="Check">Check</option>
                <option value="Credit Card">Credit Card</option>
                <option value="Net30">Net30</option>
              </select>
            </div>

            <div className="form-group">
              <label>Department</label>
              <input
                type="text"
                value={formData.department}
                onChange={(e) => handleChange('department', e.target.value)}
                placeholder="e.g., Manufacturing, Administration"
              />
            </div>

            <div className="form-group">
              <label>Cost Center</label>
              <input
                type="text"
                value={formData.cost_center}
                onChange={(e) => handleChange('cost_center', e.target.value)}
                placeholder="e.g., MFGCOST, ADMCOST"
              />
            </div>

            <div className="form-group">
              <label>Allocation Method</label>
              <select
                value={formData.expense_allocation}
                onChange={(e) => handleChange('expense_allocation', e.target.value)}
              >
                <option value="immediate">Immediate</option>
                <option value="amortized">Amortized</option>
              </select>
            </div>

            {formData.expense_allocation === 'amortized' && (
              <div className="form-group">
                <label>Amortization Months *</label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={formData.amortization_months}
                  onChange={(e) => handleChange('amortization_months', e.target.value)}
                  className={errors.amortization_months ? 'error' : ''}
                  placeholder="12"
                />
                {errors.amortization_months && <span className="error-text">{errors.amortization_months}</span>}
              </div>
            )}
          </div>

          <div className="form-group full-width">
            <label>Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => handleChange('description', e.target.value)}
              placeholder="Additional details about this expense..."
              rows="3"
            />
          </div>

          <div className="form-checkboxes">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={formData.approval_required}
                onChange={(e) => handleChange('approval_required', e.target.checked)}
              />
              Requires Approval
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) => handleChange('is_active', e.target.checked)}
              />
              Active
            </label>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              {expense ? 'Update Expense' : 'Create Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const CategoryModal = ({ categories, onSave, onClose }) => {
  const [formData, setFormData] = useState({
    category_name: '',
    category_type: 'factory_overhead',
    parent_category_id: '',
    account_code: '',
    description: ''
  });

  const [errors, setErrors] = useState({});

  const validateForm = () => {
    const newErrors = {};

    if (!formData.category_name.trim()) {
      newErrors.category_name = 'Category name is required';
    }

    if (!formData.category_type) {
      newErrors.category_type = 'Category type is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    // Clean up data
    const submitData = { ...formData };
    
    // Remove empty strings
    Object.keys(submitData).forEach(key => {
      if (submitData[key] === '') {
        submitData[key] = null;
      }
    });

    onSave(submitData);
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  // Get parent categories (only same type)
  const parentCategories = categories.filter(cat => 
    cat.category_type === formData.category_type && !cat.parent_category_id
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content category-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Add New Category</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="category-form">
          <div className="form-group">
            <label>Category Name *</label>
            <input
              type="text"
              value={formData.category_name}
              onChange={(e) => handleChange('category_name', e.target.value)}
              className={errors.category_name ? 'error' : ''}
              placeholder="e.g., Office Supplies, Welding Supplies"
            />
            {errors.category_name && <span className="error-text">{errors.category_name}</span>}
          </div>

          <div className="form-group">
            <label>Category Type *</label>
            <select
              value={formData.category_type}
              onChange={(e) => handleChange('category_type', e.target.value)}
              className={errors.category_type ? 'error' : ''}
            >
              <option value="factory_overhead">Factory Overhead</option>
              <option value="admin_expense">Administrative Expense</option>
              <option value="cogs">Cost of Goods Sold</option>
            </select>
            {errors.category_type && <span className="error-text">{errors.category_type}</span>}
          </div>

          <div className="form-group">
            <label>Parent Category</label>
            <select
              value={formData.parent_category_id}
              onChange={(e) => handleChange('parent_category_id', e.target.value)}
            >
              <option value="">None (Top Level)</option>
              {parentCategories.map(cat => (
                <option key={cat.category_id} value={cat.category_id}>
                  {cat.category_name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Account Code</label>
            <input
              type="text"
              value={formData.account_code}
              onChange={(e) => handleChange('account_code', e.target.value)}
              placeholder="e.g., 6100, 7200"
            />
          </div>

          <div className="form-group">
            <label>Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => handleChange('description', e.target.value)}
              placeholder="Description of this category..."
              rows="3"
            />
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Create Category
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};