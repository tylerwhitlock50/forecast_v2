import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import { toast } from 'react-hot-toast';
import { Download, Plus, Upload } from 'lucide-react';
import { useForecast } from '../../../context/ForecastContext';
import { useConfirm } from '../../Common/ConfirmDialog';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Select, SelectOption } from '../../ui/select';
import { DataTable } from '../../ui/data-table';
import CustomerModal from './CustomerModal';
import CustomerSummary from './CustomerSummary';
import CustomerValidation from './CustomerValidation';
import { goToImport } from '../../Common/importLink';
import { DependencyList, fetchSalesDependencies } from '../RevenueForecasting/salesDependencies';

const EXPORT_COLUMNS = ['customer_id', 'customer_name', 'customer_type', 'region'];

const TABS = [
  { id: 'table', label: 'Customers' },
  { id: 'summary', label: 'Summary' },
  { id: 'validation', label: 'Data checks' },
];

const CustomerManagement = () => {
  const navigate = useNavigate();
  const { data, actions, loading, scenarios } = useForecast();
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState('table');
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');

  const customers = useMemo(() => (Array.isArray(data.customers) ? data.customers : []), [data.customers]);

  const customerTypes = useMemo(
    () => [...new Set(customers.map(c => c.customer_type || 'No type'))].sort(),
    [customers]
  );

  const filteredCustomers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return customers
      .filter(c => !term || [c.customer_name, c.customer_id, c.customer_type, c.region]
        .some(v => String(v || '').toLowerCase().includes(term)))
      .filter(c => filterType === 'all' || (c.customer_type || 'No type') === filterType)
      .sort((a, b) => String(a.customer_name || '').localeCompare(String(b.customer_name || '')));
  }, [customers, searchTerm, filterType]);

  const handleSaveCustomer = async (customerData) => {
    // The context shows the success / error toast and reloads the data.
    if (editingCustomer) await actions.updateCustomer(editingCustomer.customer_id, customerData);
    else await actions.createCustomer(customerData);
    setShowCustomerModal(false);
    setEditingCustomer(null);
  };

  // Say exactly which sales rows go with the customer before deleting it;
  // sales are only deleted when the user confirms that.
  const handleDeleteCustomer = async (customer) => {
    const name = customer.customer_name || customer.customer_id;
    let deps;
    try {
      deps = await fetchSalesDependencies('customer_id', customer.customer_id, scenarios);
    } catch {
      toast.error('Could not check where this customer is used. Nothing was deleted.');
      return;
    }
    const ok = await confirm({
      title: `Delete ${name}?`,
      body: <DependencyList name={name} deps={deps} noun="customer" />,
      confirmLabel: deps.rows ? `Delete customer and ${deps.rows.toLocaleString('en-US')} sales rows` : 'Delete customer',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await actions.deleteCustomer('customers', customer.customer_id, { cascade: deps.rows > 0 });
    } catch {
      // deleteCustomer already showed the server's reason.
    }
  };

  const handleExport = () => {
    if (filteredCustomers.length === 0) {
      toast.error('No customers to export');
      return;
    }
    const rows = filteredCustomers.map(c => ({
      customer_id: c.customer_id,
      customer_name: c.customer_name || '',
      customer_type: c.customer_type || '',
      region: c.region || '',
    }));
    const csv = Papa.unparse(rows, { columns: EXPORT_COLUMNS });
    const url = URL.createObjectURL(new Blob([`﻿${csv}\n`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `customers_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(`Exported ${rows.length} customers`);
  };

  const customerColumns = [
    {
      key: 'customer_name',
      title: 'Customer',
      render: (value, row) => (
        <div className="space-y-0.5">
          <div className="font-semibold text-gray-900">{value || row.customer_id}</div>
          <div className="font-mono text-xs text-gray-500">{row.customer_id}</div>
        </div>
      )
    },
    {
      key: 'customer_type',
      title: 'Customer type',
      render: (value) => (value
        ? <Badge variant="outline">{value}</Badge>
        : <span className="text-xs font-medium text-amber-700">No type</span>)
    },
    {
      key: 'region',
      title: 'Region',
      render: (value) => <span className="text-sm text-gray-700">{value || ''}</span>
    }
  ];

  if (loading && customers.length === 0) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-orange-600" />
          <p className="ml-4 text-gray-500">Loading customers…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 max-w-2xl lg:flex-1">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Customers</h1>
          <p className="mt-1 text-gray-600">Who you sell to. The customer type (Dealer, Distributor, Direct…) picks the price list and the discounts.</p>
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 lg:flex-nowrap">
          <Button variant="outline" onClick={() => goToImport(navigate, 'customers')} title="Import data, step 1: Customers">
            <Upload className="mr-1.5 h-4 w-4" />
            Import customers
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={filteredCustomers.length === 0}>
            <Download className="mr-1.5 h-4 w-4" />
            Export CSV
          </Button>
          <Button
            onClick={() => { setEditingCustomer(null); setShowCustomerModal(true); }}
            className="bg-orange-600 text-white hover:bg-orange-700"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Add customer
          </Button>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="customer-search">Search</Label>
          <Input
            id="customer-search"
            type="text"
            placeholder="Name, ID, type, region…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-64"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="customer-type-filter">Customer type</Label>
          <Select id="customer-type-filter" value={filterType} onChange={(e) => setFilterType(e.target.value)} className="w-44">
            <SelectOption value="all">All types</SelectOption>
            {customerTypes.map(type => <SelectOption key={type} value={type}>{type}</SelectOption>)}
          </Select>
        </div>
      </div>

      <div className="mb-5 inline-flex rounded-lg bg-gray-100 p-1" role="tablist" aria-label="Customer views">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${activeTab === tab.id ? 'bg-white text-orange-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'table' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              {filteredCustomers.length === customers.length ? `${customers.length} customers` : `${filteredCustomers.length} of ${customers.length} customers`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {customers.length === 0 ? (
              <div className="py-12 text-center">
                <h3 className="mb-2 text-lg font-semibold text-gray-900">No customers yet</h3>
                <p className="mb-4 text-sm text-gray-600">Import your customer list with each customer's type, or add customers one at a time.</p>
                <div className="flex justify-center gap-2">
                  <Button variant="outline" onClick={() => goToImport(navigate, 'customers')}>Import customers</Button>
                  <Button onClick={() => { setEditingCustomer(null); setShowCustomerModal(true); }} className="bg-orange-600 text-white hover:bg-orange-700">Add customer</Button>
                </div>
              </div>
            ) : (
              <DataTable
                data={filteredCustomers}
                columns={customerColumns}
                rowKey="customer_id"
                onEdit={(customer) => { setEditingCustomer(customer); setShowCustomerModal(true); }}
                onDelete={handleDeleteCustomer}
                emptyMessage="No customers match the search."
              />
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'summary' && <CustomerSummary customers={customers} />}

      {activeTab === 'validation' && <CustomerValidation customers={customers} />}

      <CustomerModal
        isOpen={showCustomerModal}
        onClose={() => { setShowCustomerModal(false); setEditingCustomer(null); }}
        onSave={handleSaveCustomer}
        customer={editingCustomer}
        existingCustomers={customers}
      />
    </div>
  );
};

export default CustomerManagement;
