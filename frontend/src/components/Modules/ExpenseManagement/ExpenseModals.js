import React, { useState, useEffect } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Select, SelectOption } from '../../ui/select';
import { Textarea } from '../../ui/textarea';

export const ExpenseModal = ({ expense, categories, onSave, onClose, activeScenario = null, activeScenarioName = '' }) => {
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
    is_active: true,
    forecast_id: activeScenario || null
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
        is_active: expense.is_active !== undefined ? expense.is_active : true,
        forecast_id: expense.forecast_id || null
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
    submitData.forecast_id = submitData.forecast_id || null;

    onSave(submitData);
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  const err = (field) => (errors[field] ? <p className="mt-1 text-xs text-red-600">{errors[field]}</p> : null);
  const bad = (field) => (errors[field] ? 'border-red-500' : '');

  return (
    <Modal onClose={onClose} className="max-w-3xl">
      <ModalHeader>
        <ModalTitle>{expense ? `Edit expense: ${expense.expense_name}` : 'Add an expense'}</ModalTitle>
        <ModalClose onClick={onClose} />
      </ModalHeader>

      <form onSubmit={handleSubmit} className="expense-form">
        <ModalContent className="space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label htmlFor="expense_name">Expense name *</Label>
              <Input
                id="expense_name"
                className={`mt-1.5 ${bad('expense_name')}`}
                value={formData.expense_name}
                onChange={(e) => handleChange('expense_name', e.target.value)}
                placeholder="e.g., Plant electricity, ERP licence"
                autoFocus
              />
              {err('expense_name')}
            </div>

            <div>
              <Label htmlFor="expense_category">Category *</Label>
              <Select
                id="expense_category"
                className={`mt-1.5 ${bad('category_id')}`}
                value={formData.category_id}
                onChange={(e) => handleChange('category_id', e.target.value)}
              >
                <SelectOption value="">Select a category</SelectOption>
                {categories.map(cat => (
                  <SelectOption key={cat.category_id} value={cat.category_id}>
                    {cat.category_name} ({String(cat.category_type || '').replace(/_/g, ' ')})
                  </SelectOption>
                ))}
              </Select>
              {err('category_id')}
            </div>

            <div>
              <Label htmlFor="expense_scope">Scope</Label>
              <Select
                id="expense_scope"
                className="mt-1.5"
                value={formData.forecast_id || ''}
                onChange={(e) => handleChange('forecast_id', e.target.value || null)}
              >
                <SelectOption value="">Company-wide (in every scenario)</SelectOption>
                {activeScenario && (
                  <SelectOption value={activeScenario}>This scenario only ({activeScenarioName || activeScenario})</SelectOption>
                )}
                {formData.forecast_id && formData.forecast_id !== activeScenario && (
                  <SelectOption value={formData.forecast_id}>Scenario {formData.forecast_id} only</SelectOption>
                )}
              </Select>
              <p className="mt-1 text-xs text-gray-500">
                Company-wide expenses roll into every scenario; scenario-only ones are copied when that scenario is branched.
              </p>
            </div>

            <div>
              <Label htmlFor="expense_amount">Amount *</Label>
              <Input
                id="expense_amount"
                type="number"
                step="0.01"
                min="0"
                className={`mt-1.5 ${bad('amount')}`}
                value={formData.amount}
                onChange={(e) => handleChange('amount', e.target.value)}
                placeholder="0.00"
              />
              {err('amount')}
            </div>

            <div>
              <Label htmlFor="expense_frequency">Frequency *</Label>
              <Select
                id="expense_frequency"
                className="mt-1.5"
                value={formData.frequency}
                onChange={(e) => handleChange('frequency', e.target.value)}
              >
                <SelectOption value="weekly">Weekly</SelectOption>
                <SelectOption value="monthly">Monthly</SelectOption>
                <SelectOption value="quarterly">Quarterly</SelectOption>
                <SelectOption value="biannually">Twice a year</SelectOption>
                <SelectOption value="annually">Annually</SelectOption>
                <SelectOption value="one_time">One-time</SelectOption>
              </Select>
            </div>

            <div>
              <Label htmlFor="expense_start">Start date *</Label>
              <Input
                id="expense_start"
                type="date"
                className={`mt-1.5 ${bad('start_date')}`}
                value={formData.start_date}
                onChange={(e) => handleChange('start_date', e.target.value)}
              />
              {err('start_date')}
            </div>

            <div>
              <Label htmlFor="expense_end">End date</Label>
              <Input
                id="expense_end"
                type="date"
                className={`mt-1.5 ${bad('end_date')}`}
                value={formData.end_date}
                onChange={(e) => handleChange('end_date', e.target.value)}
              />
              {err('end_date')}
            </div>

            <div>
              <Label htmlFor="expense_vendor">Vendor</Label>
              <Input
                id="expense_vendor"
                className="mt-1.5"
                value={formData.vendor}
                onChange={(e) => handleChange('vendor', e.target.value)}
                placeholder="e.g., Rocky Mountain Power"
              />
            </div>

            <div>
              <Label htmlFor="expense_payment">Payment method</Label>
              <Select
                id="expense_payment"
                className="mt-1.5"
                value={formData.payment_method}
                onChange={(e) => handleChange('payment_method', e.target.value)}
              >
                <SelectOption value="">Not specified</SelectOption>
                <SelectOption value="ACH">ACH</SelectOption>
                <SelectOption value="Check">Check</SelectOption>
                <SelectOption value="Credit Card">Credit card</SelectOption>
                <SelectOption value="Net30">Net 30</SelectOption>
              </Select>
            </div>

            <div>
              <Label htmlFor="expense_department">Department</Label>
              <Input
                id="expense_department"
                className="mt-1.5"
                value={formData.department}
                onChange={(e) => handleChange('department', e.target.value)}
                placeholder="e.g., Manufacturing"
              />
            </div>

            <div>
              <Label htmlFor="expense_cost_center">Cost center</Label>
              <Input
                id="expense_cost_center"
                className="mt-1.5"
                value={formData.cost_center}
                onChange={(e) => handleChange('cost_center', e.target.value)}
                placeholder="e.g., MFGCOST"
              />
            </div>

            <div>
              <Label htmlFor="expense_allocation">Allocation</Label>
              <Select
                id="expense_allocation"
                className="mt-1.5"
                value={formData.expense_allocation}
                onChange={(e) => handleChange('expense_allocation', e.target.value)}
              >
                <SelectOption value="immediate">Expense when incurred</SelectOption>
                <SelectOption value="amortized">Spread over months (amortized)</SelectOption>
              </Select>
            </div>

            {formData.expense_allocation === 'amortized' && (
              <div>
                <Label htmlFor="expense_amortization">Amortization months *</Label>
                <Input
                  id="expense_amortization"
                  type="number"
                  min="1"
                  max="60"
                  className={`mt-1.5 ${bad('amortization_months')}`}
                  value={formData.amortization_months}
                  onChange={(e) => handleChange('amortization_months', e.target.value)}
                  placeholder="12"
                />
                {err('amortization_months')}
              </div>
            )}

            <div className="md:col-span-2">
              <Label htmlFor="expense_description">Description</Label>
              <Textarea
                id="expense_description"
                className="mt-1.5"
                value={formData.description}
                onChange={(e) => handleChange('description', e.target.value)}
                placeholder="Optional details"
                rows={3}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-6 text-sm text-gray-700">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-orange-600"
                checked={formData.approval_required}
                onChange={(e) => handleChange('approval_required', e.target.checked)}
              />
              Requires approval
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-orange-600"
                checked={formData.is_active}
                onChange={(e) => handleChange('is_active', e.target.checked)}
              />
              Active (included in the forecast)
            </label>
          </div>
        </ModalContent>

        <ModalFooter className="sticky bottom-0 bg-background">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="bg-orange-600 text-white hover:bg-orange-700">
            {expense ? 'Save changes' : 'Create expense'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
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
    submitData.forecast_id = submitData.forecast_id || null;

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

  const err = (field) => (errors[field] ? <p className="mt-1 text-xs text-red-600">{errors[field]}</p> : null);

  return (
    <Modal onClose={onClose} className="max-w-lg">
      <ModalHeader>
        <ModalTitle>Add an expense category</ModalTitle>
        <ModalClose onClick={onClose} />
      </ModalHeader>

      <form onSubmit={handleSubmit} className="category-form">
        <ModalContent className="space-y-4">
          <div>
            <Label htmlFor="category_name">Category name *</Label>
            <Input
              id="category_name"
              className={`mt-1.5 ${errors.category_name ? 'border-red-500' : ''}`}
              value={formData.category_name}
              onChange={(e) => handleChange('category_name', e.target.value)}
              placeholder="e.g., Shop supplies, Utilities"
              autoFocus
            />
            {err('category_name')}
          </div>

          <div>
            <Label htmlFor="category_type">Type *</Label>
            <Select
              id="category_type"
              className={`mt-1.5 ${errors.category_type ? 'border-red-500' : ''}`}
              value={formData.category_type}
              onChange={(e) => handleChange('category_type', e.target.value)}
            >
              <SelectOption value="factory_overhead">Factory overhead (in COGS)</SelectOption>
              <SelectOption value="admin_expense">Administrative expense (below gross profit)</SelectOption>
              <SelectOption value="cogs">Cost of goods sold</SelectOption>
            </Select>
            {err('category_type')}
          </div>

          <div>
            <Label htmlFor="category_parent">Parent category</Label>
            <Select
              id="category_parent"
              className="mt-1.5"
              value={formData.parent_category_id}
              onChange={(e) => handleChange('parent_category_id', e.target.value)}
            >
              <SelectOption value="">None (top level)</SelectOption>
              {parentCategories.map(cat => (
                <SelectOption key={cat.category_id} value={cat.category_id}>
                  {cat.category_name}
                </SelectOption>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="category_account">Account code</Label>
            <Input
              id="category_account"
              className="mt-1.5"
              value={formData.account_code}
              onChange={(e) => handleChange('account_code', e.target.value)}
              placeholder="e.g., 6100"
            />
          </div>

          <div>
            <Label htmlFor="category_description">Description</Label>
            <Textarea
              id="category_description"
              className="mt-1.5"
              value={formData.description}
              onChange={(e) => handleChange('description', e.target.value)}
              placeholder="Optional"
              rows={3}
            />
          </div>
        </ModalContent>

        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="bg-orange-600 text-white hover:bg-orange-700">
            Create category
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
};
