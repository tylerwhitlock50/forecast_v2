import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';

const ForecastLineModal = ({ isOpen, onClose, onSave, initialData = null }) => {
  const { data, activeScenario } = useForecast();
  
  // Form state
  const [formData, setFormData] = useState({
    product_id: '',
    customer_id: '',
    segment: '',
    period_type: 'monthly', // monthly, weekly, quarterly
    start_period: '',
    end_period: '',
    quantity: 0,
    unit_price: 0,
    operation: 'add' // add, subtract, replace
  });

  // Validation state
  const [errors, setErrors] = useState({});

  // Generate available periods
  const availablePeriods = useMemo(() => {
    const periods = [];
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    
    // Generate periods for the next 24 months
    for (let i = 0; i < 24; i++) {
      const date = new Date(currentYear, currentMonth + i, 1);
      const periodKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const periodLabel = `${date.toLocaleDateString('en-US', { month: 'short' })} ${date.getFullYear()}`;
      periods.push({ key: periodKey, label: periodLabel });
    }
    
    return periods;
  }, []);

  // Get unique segments from customers
  const segments = useMemo(() => {
    const customers = Array.isArray(data.customers) ? data.customers : [];
    return [...new Set(customers.map(c => c.customer_type || c.region || 'General'))];
  }, [data.customers]);

  // Filter customers by selected segment
  const filteredCustomers = useMemo(() => {
    if (!formData.segment) return data.customers || [];
    return (data.customers || []).filter(c => 
      (c.customer_type || c.region || 'General') === formData.segment
    );
  }, [data.customers, formData.segment]);

  // Initialize form with current date if no initial data
  useEffect(() => {
    if (!initialData && isOpen) {
      const now = new Date();
      const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      setFormData({
        product_id: '',
        customer_id: '',
        segment: '',
        period_type: 'monthly',
        start_period: currentPeriod,
        end_period: currentPeriod,
        quantity: 0,
        unit_price: 0,
        operation: 'add'
      });
      setErrors({});
    } else if (initialData && isOpen) {
      setFormData(initialData);
      setErrors({});
    }
  }, [isOpen, initialData]);

  // Validate form
  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.product_id) newErrors.product_id = 'Product is required';
    if (!formData.customer_id) newErrors.customer_id = 'Customer is required';
    if (!formData.start_period) newErrors.start_period = 'Start period is required';
    if (!formData.end_period) newErrors.end_period = 'End period is required';
    if (formData.quantity <= 0) newErrors.quantity = 'Quantity must be greater than 0';
    if (formData.unit_price <= 0) newErrors.unit_price = 'Unit price must be greater than 0';
    
    // Validate period range
    if (formData.start_period && formData.end_period) {
      if (formData.start_period > formData.end_period) {
        newErrors.end_period = 'End period must be after start period';
      }
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
      // Generate sales records for each period in the range
      const salesRecords = [];
      const startDate = new Date(formData.start_period + '-01');
      const endDate = new Date(formData.end_period + '-01');
      
      // Use a more reliable date iteration method
      let currentYear = startDate.getFullYear();
      let currentMonth = startDate.getMonth();
      
      while (true) {
        // Create period key for current month
        const periodKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
        
        // Calculate quantity for this period based on period type
        let periodQuantity = formData.quantity;
        if (formData.period_type === 'weekly') {
          // Convert weekly to monthly (assuming 4.33 weeks per month)
          periodQuantity = Math.round(formData.quantity * 4.33);
        } else if (formData.period_type === 'quarterly') {
          // Convert quarterly to monthly
          periodQuantity = Math.round(formData.quantity / 3);
        }
        
        salesRecords.push({
          unit_id: formData.product_id,
          customer_id: formData.customer_id,
          period: periodKey,
          quantity: periodQuantity,
          unit_price: formData.unit_price,
          total_revenue: periodQuantity * formData.unit_price,
          forecast_id: activeScenario
        });
        
        // Check if we've reached the end date
        if (currentYear === endDate.getFullYear() && currentMonth === endDate.getMonth()) {
          break;
        }
        
        // Move to next month safely
        currentMonth++;
        if (currentMonth > 11) {
          currentMonth = 0;
          currentYear++;
        }
      }

      // Call the save function
      await onSave(salesRecords, formData.operation);
      
      toast.success(`Successfully ${formData.operation === 'add' ? 'added' : formData.operation === 'subtract' ? 'subtracted' : 'updated'} ${salesRecords.length} forecast records`);
      onClose();
      
    } catch (error) {
      console.error('Error saving forecast line:', error);
      toast.error('Failed to save forecast line');
    }
  };

  // Handle input changes
  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Clear related errors
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
    
    // If segment changes, reset customer selection
    if (field === 'segment') {
      setFormData(prev => ({ ...prev, customer_id: '' }));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl">{initialData ? 'Edit Forecast Line' : 'Add Forecast Line'}</CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
              ×
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Product Selection */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">Product & Customer</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="product_id">Product *</Label>
                  <select
                    id="product_id"
                    value={formData.product_id}
                    onChange={(e) => handleInputChange('product_id', e.target.value)}
                    className={`w-full p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 ${
                      errors.product_id ? 'border-red-500' : 'border-gray-300'
                    }`}
                  >
                    <option value="">Select Product</option>
                    {(data.products || []).map(product => (
                      <option key={product.unit_id || product.id} value={product.unit_id || product.id}>
                        {product.unit_name || product.name}
                      </option>
                    ))}
                  </select>
                  {errors.product_id && <span className="text-sm text-red-600">{errors.product_id}</span>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="segment">Customer Segment</Label>
                  <select
                    id="segment"
                    value={formData.segment}
                    onChange={(e) => handleInputChange('segment', e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  >
                    <option value="">All Segments</option>
                    {segments.map(segment => (
                      <option key={segment} value={segment}>{segment}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="customer_id">Customer *</Label>
                  <select
                    id="customer_id"
                    value={formData.customer_id}
                    onChange={(e) => handleInputChange('customer_id', e.target.value)}
                    className={`w-full p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 ${
                      errors.customer_id ? 'border-red-500' : 'border-gray-300'
                    }`}
                  >
                    <option value="">Select Customer</option>
                    {filteredCustomers.map(customer => (
                      <option key={customer.customer_id} value={customer.customer_id}>
                        {customer.customer_name}
                      </option>
                    ))}
                  </select>
                  {errors.customer_id && <span className="text-sm text-red-600">{errors.customer_id}</span>}
                </div>
              </div>
            </div>

            {/* Time Period Configuration */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">Time Period</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="period_type">Period Type</Label>
                  <select
                    id="period_type"
                    value={formData.period_type}
                    onChange={(e) => handleInputChange('period_type', e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="weekly">Weekly</option>
                    <option value="quarterly">Quarterly</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="start_period">Start Period *</Label>
                  <select
                    id="start_period"
                    value={formData.start_period}
                    onChange={(e) => handleInputChange('start_period', e.target.value)}
                    className={`w-full p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 ${
                      errors.start_period ? 'border-red-500' : 'border-gray-300'
                    }`}
                  >
                    <option value="">Select Start Period</option>
                    {availablePeriods.map(period => (
                      <option key={period.key} value={period.key}>
                        {period.label}
                      </option>
                    ))}
                  </select>
                  {errors.start_period && <span className="text-sm text-red-600">{errors.start_period}</span>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="end_period">End Period *</Label>
                  <select
                    id="end_period"
                    value={formData.end_period}
                    onChange={(e) => handleInputChange('end_period', e.target.value)}
                    className={`w-full p-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 ${
                      errors.end_period ? 'border-red-500' : 'border-gray-300'
                    }`}
                  >
                    <option value="">Select End Period</option>
                    {availablePeriods.map(period => (
                      <option key={period.key} value={period.key}>
                        {period.label}
                      </option>
                    ))}
                  </select>
                  {errors.end_period && <span className="text-sm text-red-600">{errors.end_period}</span>}
                </div>
              </div>
            </div>

            {/* Quantity and Price */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">Quantity & Pricing</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="quantity">Quantity per {formData.period_type.slice(0, -2)} *</Label>
                  <Input
                    id="quantity"
                    type="number"
                    value={formData.quantity}
                    onChange={(e) => handleInputChange('quantity', parseFloat(e.target.value) || 0)}
                    min="0"
                    step="1"
                    placeholder={`e.g., 50 ${formData.period_type === 'weekly' ? 'units/week' : formData.period_type === 'monthly' ? 'units/month' : 'units/quarter'}`}
                    className={errors.quantity ? 'border-red-500' : ''}
                  />
                  {errors.quantity && <span className="text-sm text-red-600">{errors.quantity}</span>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="unit_price">Unit Price *</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                    <Input
                      id="unit_price"
                      type="number"
                      value={formData.unit_price}
                      onChange={(e) => handleInputChange('unit_price', parseFloat(e.target.value) || 0)}
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      className={`pl-8 ${errors.unit_price ? 'border-red-500' : ''}`}
                    />
                  </div>
                  {errors.unit_price && <span className="text-sm text-red-600">{errors.unit_price}</span>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="operation">Operation</Label>
                  <select
                    id="operation"
                    value={formData.operation}
                    onChange={(e) => handleInputChange('operation', e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  >
                    <option value="add">Add to existing</option>
                    <option value="subtract">Subtract from existing</option>
                    <option value="replace">Replace existing</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Summary */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2">Summary</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-gray-50 p-4 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700">Total Periods:</span>
                  <span className="font-semibold text-gray-900">
                    {formData.start_period && formData.end_period ? 
                      (() => {
                        const start = new Date(formData.start_period + '-01');
                        const end = new Date(formData.end_period + '-01');
                        const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
                        return months;
                      })() : 0
                    }
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700">Total Quantity:</span>
                  <span className="font-semibold text-gray-900">
                    {formData.start_period && formData.end_period && formData.quantity ? 
                      (() => {
                        const start = new Date(formData.start_period + '-01');
                        const end = new Date(formData.end_period + '-01');
                        const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
                        let periodQuantity = formData.quantity;
                        if (formData.period_type === 'weekly') {
                          periodQuantity = Math.round(formData.quantity * 4.33);
                        } else if (formData.period_type === 'quarterly') {
                          periodQuantity = Math.round(formData.quantity / 3);
                        }
                        return (periodQuantity * months).toLocaleString();
                      })() : 0
                    }
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700">Total Revenue:</span>
                  <span className="font-semibold text-green-600">
                    {formData.start_period && formData.end_period && formData.quantity && formData.unit_price ? 
                      (() => {
                        const start = new Date(formData.start_period + '-01');
                        const end = new Date(formData.end_period + '-01');
                        const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
                        let periodQuantity = formData.quantity;
                        if (formData.period_type === 'weekly') {
                          periodQuantity = Math.round(formData.quantity * 4.33);
                        } else if (formData.period_type === 'quarterly') {
                          periodQuantity = Math.round(formData.quantity / 3);
                        }
                        return `$${(periodQuantity * months * formData.unit_price).toLocaleString()}`;
                      })() : '$0'
                    }
                  </span>
                </div>
              </div>
            </div>

            {/* Form Actions */}
            <div className="flex justify-end gap-3 pt-6 border-t border-gray-200">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" className="bg-orange-600 hover:bg-orange-700">
                {initialData ? 'Update Forecast' : 'Add Forecast'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default ForecastLineModal; 