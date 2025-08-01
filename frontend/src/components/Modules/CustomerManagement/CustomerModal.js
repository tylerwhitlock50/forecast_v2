import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';

const CustomerModal = ({ isOpen, onClose, onSave, customer, existingCustomers = [] }) => {
  const [formData, setFormData] = useState({
    customer_id: '',
    customer_name: '',
    customer_type: '',
    region: ''
  });
  const [errors, setErrors] = useState({});

  // Generate next customer ID
  const generateNextCustomerId = () => {
    const existingIds = existingCustomers.map(c => c.customer_id);
    let nextNumber = 1;
    
    // Find the highest existing number
    existingIds.forEach(id => {
      const match = id.match(/CUST-(\d+)/);
      if (match) {
        const num = parseInt(match[1]);
        if (num >= nextNumber) {
          nextNumber = num + 1;
        }
      }
    });
    
    return `CUST-${nextNumber.toString().padStart(3, '0')}`;
  };

  // Initialize form when modal opens or customer changes
  useEffect(() => {
    if (isOpen) {
      if (customer) {
        // Editing existing customer
        setFormData({
          customer_id: customer.customer_id || '',
          customer_name: customer.customer_name || '',
          customer_type: customer.customer_type || '',
          region: customer.region || ''
        });
      } else {
        // Creating new customer - auto-generate ID
        setFormData({
          customer_id: generateNextCustomerId(),
          customer_name: '',
          customer_type: '',
          region: ''
        });
      }
      setErrors({});
    }
  }, [isOpen, customer, existingCustomers]);

  // Validate form
  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.customer_id.trim()) {
      newErrors.customer_id = 'Customer ID is required';
    }
    
    if (!formData.customer_name.trim()) {
      newErrors.customer_name = 'Customer name is required';
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
      await onSave(formData);
    } catch (error) {
      console.error('Error saving customer:', error);
      toast.error('Failed to save customer');
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {customer ? 'Edit Customer' : 'Add New Customer'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Customer ID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Customer ID *
            </label>
            <input
              type="text"
              value={formData.customer_id}
              onChange={(e) => handleInputChange('customer_id', e.target.value)}
              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 ${
                errors.customer_id ? 'border-red-500' : 'border-gray-300'
              } ${!customer ? 'bg-gray-100 cursor-not-allowed' : ''}`}
              placeholder="e.g., CUST-001"
              disabled={!customer} // Disable for new customers, allow editing for existing
              readOnly={!customer} // Make it read-only for new customers
            />
            {!customer && (
              <p className="mt-1 text-sm text-gray-500">
                Customer ID will be auto-generated
              </p>
            )}
            {errors.customer_id && (
              <p className="mt-1 text-sm text-red-600">{errors.customer_id}</p>
            )}
          </div>

          {/* Customer Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Customer Name *
            </label>
            <input
              type="text"
              value={formData.customer_name}
              onChange={(e) => handleInputChange('customer_name', e.target.value)}
              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 ${
                errors.customer_name ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="Enter customer name"
            />
            {errors.customer_name && (
              <p className="mt-1 text-sm text-red-600">{errors.customer_name}</p>
            )}
          </div>

          {/* Customer Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Customer Type
            </label>
            <select
              value={formData.customer_type}
              onChange={(e) => handleInputChange('customer_type', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            >
              <option value="">Select Type</option>
              <option value="D2C-WEB">D2C-WEB</option>
              <option value="ONLINE-DEALER">ONLINE-DEALER</option>
              <option value="DEALER">DEALER</option>
              <option value="D2C-AMAZON">D2C-AMAZON</option>
              <option value="Enterprise">Enterprise</option>
              <option value="SMB">SMB</option>
              <option value="Startup">Startup</option>
              <option value="Government">Government</option>
              <option value="Education">Education</option>
              <option value="Healthcare">Healthcare</option>
              <option value="Retail">Retail</option>
              <option value="Manufacturing">Manufacturing</option>
              <option value="Other">Other</option>
            </select>
          </div>

          {/* Region */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Region
            </label>
            <select
              value={formData.region}
              onChange={(e) => handleInputChange('region', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            >
              <option value="">Select Region</option>
              <option value="US">US</option>
              <option value="North America">North America</option>
              <option value="Europe">Europe</option>
              <option value="Asia Pacific">Asia Pacific</option>
              <option value="Latin America">Latin America</option>
              <option value="Middle East">Middle East</option>
              <option value="Africa">Africa</option>
            </select>
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-orange-600 border border-transparent rounded-md hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500"
            >
              {customer ? 'Update Customer' : 'Create Customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CustomerModal; 