import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import CustomerTable from './CustomerTable';
import CustomerModal from './CustomerModal';
import CustomerSummary from './CustomerSummary';
import CustomerValidation from './CustomerValidation';
import './CustomerManagement.css';

const CustomerManagement = () => {
  const { data, actions, loading } = useForecast();
  const [activeTab, setActiveTab] = useState('table');
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterSegment, setFilterSegment] = useState('all');
  const [sortField, setSortField] = useState('customer_name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [selectedCustomers, setSelectedCustomers] = useState([]);
  const [bulkAction, setBulkAction] = useState('');

  // Get unique segments for filtering
  const segments = useMemo(() => {
    const customers = Array.isArray(data.customers) ? data.customers : [];
    return [...new Set(customers.map(c => c.customer_type || c.region || 'General'))];
  }, [data.customers]);

  // Filter and sort customers
  const filteredCustomers = useMemo(() => {
    let customers = Array.isArray(data.customers) ? data.customers : [];
    
    // Apply search filter
    if (searchTerm) {
      customers = customers.filter(customer => 
        customer.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        customer.customer_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        customer.customer_type?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        customer.region?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        customer.email?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // Apply segment filter
    if (filterSegment !== 'all') {
      customers = customers.filter(customer => 
        (customer.customer_type || customer.region || 'General') === filterSegment
      );
    }
    
    // Apply sorting
    customers.sort((a, b) => {
      const aValue = a[sortField] || '';
      const bValue = b[sortField] || '';
      
      if (sortDirection === 'asc') {
        return aValue.toString().localeCompare(bValue.toString());
      } else {
        return bValue.toString().localeCompare(aValue.toString());
      }
    });
    
    return customers;
  }, [data.customers, searchTerm, filterSegment, sortField, sortDirection]);

  // Handle customer creation/editing
  const handleSaveCustomer = async (customerData) => {
    try {
      if (editingCustomer) {
        // Update existing customer
        await actions.updateCustomer(editingCustomer.customer_id, customerData);
        toast.success('Customer updated successfully');
      } else {
        // Create new customer
        await actions.createCustomer(customerData);
        toast.success('Customer created successfully');
      }
      
      setShowCustomerModal(false);
      setEditingCustomer(null);
      await actions.fetchAllData(); // Refresh data
    } catch (error) {
      console.error('Error saving customer:', error);
      toast.error('Failed to save customer');
    }
  };

  // Handle customer deletion
  const handleDeleteCustomer = async (customerId) => {
    if (window.confirm('Are you sure you want to delete this customer? This action cannot be undone.')) {
      try {
        await actions.deleteCustomer('customers', customerId);
        toast.success('Customer deleted successfully');
        await actions.fetchAllData(); // Refresh data
      } catch (error) {
        console.error('Error deleting customer:', error);
        toast.error('Failed to delete customer');
      }
    }
  };

  // Handle bulk operations
  const handleBulkOperation = async () => {
    if (selectedCustomers.length === 0) {
      toast.error('Please select customers for bulk operation');
      return;
    }

    if (bulkAction === 'delete') {
      if (window.confirm(`Are you sure you want to delete ${selectedCustomers.length} customers? This action cannot be undone.`)) {
        try {
          for (const customerId of selectedCustomers) {
            await actions.deleteCustomer('customers', customerId);
          }
          toast.success(`${selectedCustomers.length} customers deleted successfully`);
          setSelectedCustomers([]);
          await actions.fetchAllData();
        } catch (error) {
          console.error('Error in bulk delete:', error);
          toast.error('Failed to delete some customers');
        }
      }
    } else if (bulkAction === 'export') {
      // Export selected customers to CSV
      const csvData = selectedCustomers.map(customerId => {
        const customer = data.customers.find(c => c.customer_id === customerId);
        return customer;
      }).filter(Boolean);

      if (csvData.length > 0) {
        const csv = [
          Object.keys(csvData[0]).join(','),
          ...csvData.map(row => Object.values(row).join(','))
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `customers-export-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`Exported ${csvData.length} customers`);
      }
    }
  };

  // Handle sorting
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Handle customer selection
  const handleCustomerSelect = (customerId, selected) => {
    if (selected) {
      setSelectedCustomers(prev => [...prev, customerId]);
    } else {
      setSelectedCustomers(prev => prev.filter(id => id !== customerId));
    }
  };

  // Handle select all
  const handleSelectAll = (selected) => {
    if (selected) {
      setSelectedCustomers(filteredCustomers.map(c => c.customer_id));
    } else {
      setSelectedCustomers([]);
    }
  };

  if (loading) {
    return (
      <div className="customer-management">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading customer data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="customer-management">
      <div className="customer-header">
        <h2>Customer Management</h2>
        <div className="customer-controls">
          <div className="search-controls">
            <input
              type="text"
              placeholder="Search customers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <select
              value={filterSegment}
              onChange={(e) => setFilterSegment(e.target.value)}
              className="segment-filter"
            >
              <option value="all">All Segments</option>
              {segments.map(segment => (
                <option key={segment} value={segment}>{segment}</option>
              ))}
            </select>
          </div>
          
          <div className="action-controls">
            <button 
              onClick={() => {
                setEditingCustomer(null);
                setShowCustomerModal(true);
              }}
              className="btn-primary"
            >
              ➕ Add Customer
            </button>
            
            {selectedCustomers.length > 0 && (
              <div className="bulk-actions">
                <select
                  value={bulkAction}
                  onChange={(e) => setBulkAction(e.target.value)}
                  className="bulk-action-select"
                >
                  <option value="">Bulk Actions</option>
                  <option value="export">Export Selected</option>
                  <option value="delete">Delete Selected</option>
                </select>
                <button 
                  onClick={handleBulkOperation}
                  disabled={!bulkAction}
                  className="btn-secondary"
                >
                  Apply
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="customer-tabs">
        <button 
          className={`tab ${activeTab === 'table' ? 'active' : ''}`}
          onClick={() => setActiveTab('table')}
        >
          Customer Table
        </button>
        <button 
          className={`tab ${activeTab === 'summary' ? 'active' : ''}`}
          onClick={() => setActiveTab('summary')}
        >
          Summary
        </button>
        <button 
          className={`tab ${activeTab === 'validation' ? 'active' : ''}`}
          onClick={() => setActiveTab('validation')}
        >
          Data Validation
        </button>
      </div>

      <div className="customer-content">
        {activeTab === 'table' && (
          <CustomerTable
            customers={filteredCustomers}
            selectedCustomers={selectedCustomers}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
            onSelect={handleCustomerSelect}
            onSelectAll={handleSelectAll}
            onEdit={(customer) => {
              setEditingCustomer(customer);
              setShowCustomerModal(true);
            }}
            onDelete={handleDeleteCustomer}
          />
        )}

        {activeTab === 'summary' && (
          <CustomerSummary customers={data.customers || []} />
        )}

        {activeTab === 'validation' && (
          <CustomerValidation customers={data.customers || []} />
        )}
      </div>

      <CustomerModal
        isOpen={showCustomerModal}
        onClose={() => {
          setShowCustomerModal(false);
          setEditingCustomer(null);
        }}
        onSave={handleSaveCustomer}
        customer={editingCustomer}
      />
    </div>
  );
};

export default CustomerManagement; 