import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';

// Utility function to get the start of the current week
const getStartOfWeek = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  return new Date(d.setDate(diff));
};

// Utility function to get the end of the current year
const getEndOfYear = (date) => {
  return new Date(date.getFullYear(), 11, 31);
};

// Utility function to get the first day of the current month
const getFirstDayOfMonth = (date) => {
  return new Date(date.getFullYear(), date.getMonth(), 1);
};

// Utility function to get the first day of the current quarter
const getFirstDayOfQuarter = (date) => {
  const quarter = Math.floor(date.getMonth() / 3);
  return new Date(date.getFullYear(), quarter * 3, 1);
};

// Get ISO week number and corresponding year
const getISOWeekInfo = (date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Set to nearest Thursday to determine week/year
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
};

// Parse a YYYY-MM-DD string without timezone shifts
const parseDateInput = (value) => {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12); // noon avoids DST edge cases
};

// Normalize a date to the start of the requested period
const normalizeDateForPeriod = (date, periodType) => {
  if (!date) return null;
  if (periodType === 'weekly') return getStartOfWeek(date);
  if (periodType === 'quarterly') return getFirstDayOfQuarter(date);
  return getFirstDayOfMonth(date);
};

// Utility function to calculate periods between two dates based on period type
const calculatePeriodsBetween = (startDate, endDate, periodType) => {
  const periods = [];
  const current = normalizeDateForPeriod(startDate, periodType);
  const endBoundary = normalizeDateForPeriod(endDate, periodType);

  if (!current || !endBoundary) return periods;

  while (current <= endBoundary) {
    let periodKey, periodLabel;
    
    if (periodType === 'weekly') {
      const weekStart = getStartOfWeek(current);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      
      const { year, week } = getISOWeekInfo(weekStart);
      periodKey = `${year}-W${String(week).padStart(2, '0')}`;
      periodLabel = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}-${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      
      // Move to next week
      current.setDate(current.getDate() + 7);
    } else if (periodType === 'monthly') {
      periodKey = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
      periodLabel = `${current.toLocaleDateString('en-US', { month: 'short' })} ${current.getFullYear()}`;
      
      // Move to next month
      current.setMonth(current.getMonth() + 1, 1);
    } else if (periodType === 'quarterly') {
      const quarter = Math.floor(current.getMonth() / 3) + 1;
      periodKey = `${current.getFullYear()}-Q${quarter}`;
      periodLabel = `Q${quarter} ${current.getFullYear()}`;
      
      // Move to next quarter
      current.setMonth(current.getMonth() + 3, 1);
    }
    
    periods.push({ key: periodKey, label: periodLabel });
  }
  
  return periods;
};

const ForecastLineModal = ({ isOpen, onClose, onSave, initialData = null }) => {
  const { data, activeScenario } = useForecast();
  
  // Form state
  const [formData, setFormData] = useState({
    product_id: '',
    customer_id: '',
    segment: '',
    period_type: 'monthly', // monthly, weekly, quarterly
    start_date: '',
    end_date: '',
    quantity: 0,
    unit_price: 0,
    operation: 'add' // add, subtract, replace
  });

  // Validation state
  const [errors, setErrors] = useState({});

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

  // Calculate periods between start and end dates
  const calculatedPeriods = useMemo(() => {
    if (!formData.start_date || !formData.end_date) return [];
    
    const startDate = parseDateInput(formData.start_date);
    const endDate = parseDateInput(formData.end_date);
    
    if (startDate > endDate) return [];
    
    return calculatePeriodsBetween(startDate, endDate, formData.period_type);
  }, [formData.start_date, formData.end_date, formData.period_type]);

  // Initialize form with current date if no initial data
  useEffect(() => {
    if (!initialData && isOpen) {
      const now = new Date();
      let startDate, endDate;
      
      if (formData.period_type === 'weekly') {
        startDate = getStartOfWeek(now);
        endDate = getEndOfYear(now);
      } else if (formData.period_type === 'quarterly') {
        startDate = getFirstDayOfQuarter(now);
        endDate = getEndOfYear(now);
      } else {
        startDate = getFirstDayOfMonth(now);
        endDate = getEndOfYear(now);
      }
      
      setFormData({
        product_id: '',
        customer_id: '',
        segment: '',
        period_type: 'monthly',
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
        quantity: 0,
        unit_price: 0,
        operation: 'add'
      });
      setErrors({});
    } else if (initialData && isOpen) {
      // Convert period-based data to date-based data if needed
      const convertedData = { ...initialData };
      if (initialData.start_period && !initialData.start_date) {
        // Convert period to date (this is a simplified conversion)
        const now = new Date();
        convertedData.start_date = now.toISOString().split('T')[0];
        convertedData.end_date = now.toISOString().split('T')[0];
      }
      setFormData(convertedData);
      setErrors({});
    }
  }, [isOpen, initialData]);

  // Validate form
  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.product_id) newErrors.product_id = 'Product is required';
    if (!formData.customer_id) newErrors.customer_id = 'Customer is required';
    if (!formData.start_date) newErrors.start_date = 'Start date is required';
    if (!formData.end_date) newErrors.end_date = 'End date is required';
    if (formData.quantity <= 0) newErrors.quantity = 'Quantity must be greater than 0';
    if (formData.unit_price <= 0) newErrors.unit_price = 'Unit price must be greater than 0';
    
    // Validate date range
    if (formData.start_date && formData.end_date) {
      const startDate = new Date(formData.start_date);
      const endDate = new Date(formData.end_date);
      if (startDate > endDate) {
        newErrors.end_date = 'End date must be after start date';
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
      const salesRecords = calculatedPeriods.map(period => ({
        unit_id: formData.product_id,
        customer_id: formData.customer_id,
        period: period.key,
        quantity: formData.quantity,
        unit_price: formData.unit_price,
        total_revenue: formData.quantity * formData.unit_price,
        forecast_id: activeScenario
      }));

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
    
    // If period type changes, update dates to match the new period type
    if (field === 'period_type') {
      const now = new Date();
      let startDate, endDate;
      
      if (value === 'weekly') {
        startDate = getStartOfWeek(now);
        endDate = getEndOfYear(now);
      } else if (value === 'quarterly') {
        startDate = getFirstDayOfQuarter(now);
        endDate = getEndOfYear(now);
      } else {
        startDate = getFirstDayOfMonth(now);
        endDate = getEndOfYear(now);
      }
      
      setFormData(prev => ({ 
        ...prev, 
        [field]: value,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0]
      }));
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
                  <Label htmlFor="start_date">Start Date *</Label>
                  <Input
                    id="start_date"
                    type="date"
                    value={formData.start_date}
                    onChange={(e) => handleInputChange('start_date', e.target.value)}
                    className={errors.start_date ? 'border-red-500' : ''}
                  />
                  {errors.start_date && <span className="text-sm text-red-600">{errors.start_date}</span>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="end_date">End Date *</Label>
                  <Input
                    id="end_date"
                    type="date"
                    value={formData.end_date}
                    onChange={(e) => handleInputChange('end_date', e.target.value)}
                    className={errors.end_date ? 'border-red-500' : ''}
                  />
                  {errors.end_date && <span className="text-sm text-red-600">{errors.end_date}</span>}
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
                    {calculatedPeriods.length}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700">Total Quantity:</span>
                  <span className="font-semibold text-gray-900">
                    {calculatedPeriods.length && formData.quantity ? 
                      (calculatedPeriods.length * formData.quantity).toLocaleString() : 0
                    }
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700">Total Revenue:</span>
                  <span className="font-semibold text-green-600">
                    {calculatedPeriods.length && formData.quantity && formData.unit_price ? 
                      `$${(calculatedPeriods.length * formData.quantity * formData.unit_price).toLocaleString()}` : '$0'
                    }
                  </span>
                </div>
              </div>
              
              {/* Period Preview */}
              {calculatedPeriods.length > 0 && (
                <div className="bg-blue-50 p-4 rounded-lg">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Period Preview:</h4>
                  <div className="text-sm text-gray-600">
                    {calculatedPeriods.slice(0, 5).map(period => period.label).join(', ')}
                    {calculatedPeriods.length > 5 && ` ... and ${calculatedPeriods.length - 5} more periods`}
                  </div>
                </div>
              )}
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
