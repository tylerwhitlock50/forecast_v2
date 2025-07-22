import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import { PageHeader } from '../../ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Select, SelectOption } from '../../ui/select';
import { DataTable } from '../../ui/data-table';
import LaborRateTable from './LaborRateTable';
import LaborRateModal from './LaborRateModal';
import LaborRateSummary from './LaborRateSummary';
import LaborRateValidation from './LaborRateValidation';

const LaborRateManagement = () => {
  const { data, actions, loading } = useForecast();
  const [activeTab, setActiveTab] = useState('table');
  const [showLaborRateModal, setShowLaborRateModal] = useState(false);
  const [editingLaborRate, setEditingLaborRate] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [sortField, setSortField] = useState('rate_name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [selectedLaborRates, setSelectedLaborRates] = useState([]);
  const [bulkAction, setBulkAction] = useState('');

  // Get unique rate types for filtering
  const rateTypes = useMemo(() => {
    const laborRates = Array.isArray(data.labor_rates) ? data.labor_rates : [];
    return [...new Set(laborRates.map(lr => lr.rate_type || 'General'))];
  }, [data.labor_rates]);

  // Filter and sort labor rates
  const filteredLaborRates = useMemo(() => {
    let laborRates = Array.isArray(data.labor_rates) ? data.labor_rates : [];
    
    // Apply search filter
    if (searchTerm) {
      laborRates = laborRates.filter(laborRate => 
        laborRate.rate_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        laborRate.rate_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        laborRate.rate_type?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        laborRate.rate_description?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // Apply type filter
    if (filterType !== 'all') {
      laborRates = laborRates.filter(laborRate => 
        (laborRate.rate_type || 'General') === filterType
      );
    }
    
    // Apply sorting
    laborRates.sort((a, b) => {
      let aValue = a[sortField] || '';
      let bValue = b[sortField] || '';
      
      // Handle numeric sorting for rate_amount
      if (sortField === 'rate_amount') {
        aValue = parseFloat(aValue) || 0;
        bValue = parseFloat(bValue) || 0;
      }
      
      if (sortDirection === 'asc') {
        return aValue.toString().localeCompare(bValue.toString(), undefined, { numeric: true });
      } else {
        return bValue.toString().localeCompare(aValue.toString(), undefined, { numeric: true });
      }
    });
    
    return laborRates;
  }, [data.labor_rates, searchTerm, filterType, sortField, sortDirection]);

  // Handle labor rate creation/editing
  const handleSaveLaborRate = async (laborRateData) => {
    try {
      if (editingLaborRate) {
        await actions.updateLaborRate(editingLaborRate.rate_id, laborRateData);
        toast.success('Labor rate updated successfully');
      } else {
        await actions.createLaborRate(laborRateData);
        toast.success('Labor rate created successfully');
      }
      
      setShowLaborRateModal(false);
      setEditingLaborRate(null);
      await actions.fetchAllData();
    } catch (error) {
      console.error('Error saving labor rate:', error);
      toast.error('Failed to save labor rate');
    }
  };

  // Handle labor rate deletion
  const handleDeleteLaborRate = async (rateId) => {
    if (window.confirm('Are you sure you want to delete this labor rate? This action cannot be undone.')) {
      try {
        await actions.deleteLaborRate('labor_rates', rateId);
        toast.success('Labor rate deleted successfully');
        await actions.fetchAllData();
      } catch (error) {
        console.error('Error deleting labor rate:', error);
        toast.error('Failed to delete labor rate');
      }
    }
  };

  // Handle bulk operations
  const handleBulkOperation = async () => {
    if (selectedLaborRates.length === 0) {
      toast.error('Please select labor rates for bulk operation');
      return;
    }

    if (bulkAction === 'delete') {
      if (window.confirm(`Are you sure you want to delete ${selectedLaborRates.length} labor rates? This action cannot be undone.`)) {
        try {
          for (const rateId of selectedLaborRates) {
            await actions.deleteLaborRate('labor_rates', rateId);
          }
          toast.success(`${selectedLaborRates.length} labor rates deleted successfully`);
          setSelectedLaborRates([]);
          await actions.fetchAllData();
        } catch (error) {
          console.error('Error in bulk delete:', error);
          toast.error('Failed to delete some labor rates');
        }
      }
    } else if (bulkAction === 'export') {
      const csvData = selectedLaborRates.map(rateId => {
        const laborRate = data.labor_rates.find(lr => lr.rate_id === rateId);
        return laborRate;
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
        a.download = `labor-rates-export-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`Exported ${csvData.length} labor rates`);
      }
    }
  };

  const formatCurrency = (amount) => {
    if (!amount) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  // Define columns for DataTable
  const laborRateColumns = [
    {
      key: 'rate_name',
      title: 'Rate Name',
      render: (value, row) => (
        <div className="space-y-1">
          <div className="font-semibold">{value}</div>
          <div className="text-sm text-muted-foreground">ID: {row.rate_id}</div>
        </div>
      )
    },
    {
      key: 'rate_type',
      title: 'Rate Type',
      render: (value) => {
        const type = value || 'General';
        const variants = {
          'Direct': 'success',
          'Indirect': 'warning',
          'Overhead': 'info',
          'Supervision': 'secondary',
          'General': 'default'
        };
        return <Badge variant={variants[type] || 'default'}>{type}</Badge>;
      }
    },
    {
      key: 'rate_description',
      title: 'Description',
      render: (value) => value || 'N/A'
    },
    {
      key: 'rate_amount',
      title: 'Hourly Rate',
      render: (value) => <span className="font-semibold">{formatCurrency(value)}</span>
    },
    {
      key: 'overtime_multiplier',
      title: 'Overtime Rate',
      render: (value, row) => {
        const overtimeRate = (row.rate_amount || 0) * (value || 1.5);
        return (
          <div className="space-y-1">
            <div className="font-semibold">{formatCurrency(overtimeRate)}</div>
            <div className="text-sm text-muted-foreground">({value || 1.5}x)</div>
          </div>
        );
      }
    },
    {
      key: 'burden_rate',
      title: 'Burden Rate',
      render: (value) => value ? `${value}%` : 'N/A'
    },
    {
      key: 'is_active',
      title: 'Status',
      render: (value) => (
        <Badge variant={value !== false ? 'success' : 'secondary'}>
          {value !== false ? 'Active' : 'Inactive'}
        </Badge>
      )
    }
  ];

  if (loading) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="ml-4 text-muted-foreground">Loading labor rate data...</p>
        </div>
      </div>
    );
  }

  const headerActions = [
    {
      label: 'Add Labor Rate',
      onClick: () => {
        setEditingLaborRate(null);
        setShowLaborRateModal(true);
      },
      variant: 'default'
    }
  ];

  if (selectedLaborRates.length > 0) {
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
        title="Labor Rate Management"
        description="Manage labor rates, overtime multipliers, and burden rates"
        actions={headerActions}
      />

      {/* Search and Filter Controls */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Label>Search:</Label>
          <Input
            type="text"
            placeholder="Search labor rates..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-64"
          />
        </div>
        
        <div className="flex items-center gap-2">
          <Label>Type:</Label>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectOption value="all">All Types</SelectOption>
            {rateTypes.map(type => (
              <SelectOption key={type} value={type}>{type}</SelectOption>
            ))}
          </Select>
        </div>

        {selectedLaborRates.length > 0 && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="px-3 py-1">
              {selectedLaborRates.length} selected
            </Badge>
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="table">Labor Rate Table</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="validation">Data Validation</TabsTrigger>
        </TabsList>

        <TabsContent value="table" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>All Labor Rates ({filteredLaborRates.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                data={filteredLaborRates}
                columns={laborRateColumns}
                onEdit={(laborRate) => {
                  setEditingLaborRate(laborRate);
                  setShowLaborRateModal(true);
                }}
                onDelete={(laborRate) => handleDeleteLaborRate(laborRate.rate_id)}
                emptyMessage="No labor rates found. Click 'Add Labor Rate' to get started."
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="summary" className="space-y-6">
          <LaborRateSummary laborRates={data.labor_rates || []} />
        </TabsContent>

        <TabsContent value="validation" className="space-y-6">
          <LaborRateValidation laborRates={data.labor_rates || []} />
        </TabsContent>
      </Tabs>

      <LaborRateModal
        isOpen={showLaborRateModal}
        onClose={() => {
          setShowLaborRateModal(false);
          setEditingLaborRate(null);
        }}
        onSave={handleSaveLaborRate}
        laborRate={editingLaborRate}
      />
    </div>
  );
};

export default LaborRateManagement;