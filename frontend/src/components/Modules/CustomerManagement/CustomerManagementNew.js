import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import { PageHeader } from '../../ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Select, SelectOption } from '../../ui/select';
import { DataTable } from '../../ui/data-table';
import CustomerTable from './CustomerTable';
import CustomerModal from './CustomerModal';
import CustomerSummary from './CustomerSummary';
import CustomerValidation from './CustomerValidation';

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

  // Get unique customer types for filtering
  const customerTypes = useMemo(() => {
    const customers = Array.isArray(data.customers) ? data.customers : [];
    return [...new Set(customers.map(c => c.customer_type).filter(Boolean))];
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
        customer.region?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // Apply customer type filter
    if (filterSegment !== 'all') {
      customers = customers.filter(customer => 
        customer.customer_type === filterSegment
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
        await actions.updateCustomer(editingCustomer.customer_id, customerData);
        toast.success('Customer updated successfully');
      } else {
        await actions.createCustomer(customerData);
        toast.success('Customer created successfully');
      }
      
      setShowCustomerModal(false);
      setEditingCustomer(null);
      await actions.fetchAllData();
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
        await actions.fetchAllData();
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

  // Define columns for DataTable
  const customerColumns = [
    {
      key: 'customer_name',
      title: 'Customer Name',
      render: (value, row) => (
        <div className="space-y-1">
          <div className="font-semibold">{value}</div>
          <div className="text-sm text-muted-foreground">ID: {row.customer_id}</div>
        </div>
      )
    },
    {
      key: 'customer_type',
      title: 'Customer Type',
      render: (value) => {
        const variants = {
          'D2C-WEB': 'default',
          'ONLINE-DEALER': 'secondary',
          'DEALER': 'outline',
          'D2C-AMAZON': 'default',
          'Enterprise': 'success',
          'SMB': 'warning',
          'Retail': 'info',
          'Manufacturing': 'secondary'
        };
        return <Badge variant={variants[value] || 'default'}>{value || 'N/A'}</Badge>;
      }
    },
    {
      key: 'region',
      title: 'Region',
      render: (value) => value || 'N/A'
    }
  ];

  if (loading) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="ml-4 text-muted-foreground">Loading customer data...</p>
        </div>
      </div>
    );
  }

  const headerActions = [
    {
      label: 'Add Customer',
      onClick: () => {
        setEditingCustomer(null);
        setShowCustomerModal(true);
      },
      variant: 'default',
      className: 'bg-orange-600 hover:bg-orange-700'
    }
  ];

  if (selectedCustomers.length > 0) {
    headerActions.push({
      label: 'Export Selected',
      onClick: () => {
        setBulkAction('export');
        handleBulkOperation();
      },
      variant: 'outline'
    });
    headerActions.push({
      label: 'Delete Selected',
      onClick: () => {
        setBulkAction('delete');
        handleBulkOperation();
      },
      variant: 'destructive'
    });
  }

  return (
    <div className="container mx-auto px-6 py-8">
      <PageHeader
        title="Customer Management"
        description="Manage your customer database, segments, and contact information"
        actions={headerActions}
      />

      {/* Search and Filter Controls */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Label>Search:</Label>
          <Input
            type="text"
            placeholder="Search customers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-64"
          />
        </div>
        
        <div className="flex items-center gap-2">
          <Label>Customer Type:</Label>
          <Select value={filterSegment} onChange={(e) => setFilterSegment(e.target.value)}>
            <SelectOption value="all">All Types</SelectOption>
            {customerTypes.map(type => (
              <SelectOption key={type} value={type}>{type}</SelectOption>
            ))}
          </Select>
        </div>

        {selectedCustomers.length > 0 && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="px-3 py-1">
              {selectedCustomers.length} selected
            </Badge>
          </div>
        )}
      </div>

      {/* Custom Tab Navigation */}
      <div className="space-y-6">
        {/* Tab Buttons */}
        <div className="grid w-full grid-cols-3 bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab('table')}
            className={`px-3 py-2 text-sm font-medium rounded-md transition-all ${
              activeTab === 'table'
                ? 'bg-white text-orange-700 shadow-sm border border-orange-200'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Customer Table
          </button>
          <button
            onClick={() => setActiveTab('summary')}
            className={`px-3 py-2 text-sm font-medium rounded-md transition-all ${
              activeTab === 'summary'
                ? 'bg-white text-orange-700 shadow-sm border border-orange-200'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Summary
          </button>
          <button
            onClick={() => setActiveTab('validation')}
            className={`px-3 py-2 text-sm font-medium rounded-md transition-all ${
              activeTab === 'validation'
                ? 'bg-white text-orange-700 shadow-sm border border-orange-200'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Data Validation
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'table' && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>All Customers ({filteredCustomers.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <DataTable
                  data={filteredCustomers}
                  columns={customerColumns}
                  onEdit={(customer) => {
                    setEditingCustomer(customer);
                    setShowCustomerModal(true);
                  }}
                  onDelete={(customer) => handleDeleteCustomer(customer.customer_id)}
                  emptyMessage="No customers found. Click 'Add Customer' to get started."
                />
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'summary' && (
          <div className="space-y-6">
            <CustomerSummary customers={data.customers || []} />
          </div>
        )}

        {activeTab === 'validation' && (
          <div className="space-y-6">
            <CustomerValidation customers={data.customers || []} />
          </div>
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
        existingCustomers={data.customers || []}
      />
    </div>
  );
};

export default CustomerManagement;