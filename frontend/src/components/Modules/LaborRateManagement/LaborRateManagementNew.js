import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import { useConfirm } from '../../Common/ConfirmDialog';
import { PageHeader } from '../../ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Select, SelectOption } from '../../ui/select';
import { DataTable } from '../../ui/data-table';
import LaborRateModal from './LaborRateModal';
import LaborRateSummary from './LaborRateSummary';
import LaborRateValidation from './LaborRateValidation';

const LaborRateManagement = () => {
  const { data, actions, loading } = useForecast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('table');
  const [showLaborRateModal, setShowLaborRateModal] = useState(false);
  const [editingLaborRate, setEditingLaborRate] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [sortField] = useState('rate_name');
  const [sortDirection] = useState('asc');
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
    // The context action shows the one toast (or the server's reason, e.g.
    // a duplicate rate id); on failure the form stays open.
    try {
      if (editingLaborRate) {
        await actions.updateLaborRate(editingLaborRate.rate_id, laborRateData);
      } else {
        await actions.createLaborRate(laborRateData);
      }
      
      setShowLaborRateModal(false);
      setEditingLaborRate(null);
    } catch (error) {
      console.error('Error saving labor rate:', error);
    }
  };

  // Handle labor rate deletion
  const handleDeleteLaborRate = async (rateId) => {
    const ops = (Array.isArray(data.router_operations) ? data.router_operations : [])
      .filter(op => op.labor_type_id === rateId);
    if (ops.length > 0) {
      // The server refuses to delete a labor rate that routing steps still use.
      const goToRoutings = await confirm({
        title: `${rateId} is still in use`,
        body: `Used by ${ops.length} routing operation${ops.length === 1 ? '' : 's'}: ${ops.map(op => `${op.router_id} seq ${op.sequence}`).join(', ')}. Give those operations another labor type (or delete them) first.`,
        confirmLabel: 'Open routings',
        cancelLabel: 'Close',
      });
      if (goToRoutings) navigate('/routing');
      return;
    }
    if (await confirm({
      title: `Delete labor rate ${rateId}?`,
      body: 'No routing uses it. This cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    })) {
      try {
        await actions.deleteLaborRate('labor_rates', rateId);
      } catch (error) {
        console.error('Error deleting labor rate:', error);
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
      if (await confirm({
        title: `Delete ${selectedLaborRates.length} labor rates?`,
        body: 'Any router operation referencing a deleted rate will contribute $0 for labor.',
        confirmLabel: 'Delete',
        variant: 'destructive',
      })) {
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
        <div className="space-y-0.5">
          <div className="font-semibold text-gray-900">{value}</div>
          <div className="whitespace-nowrap font-mono text-xs text-muted-foreground">{row.rate_id}</div>
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
      cellClassName: 'max-w-xs text-sm text-gray-600',
      render: (value) => value || <span className="text-muted-foreground">—</span>
    },
    {
      key: 'rate_amount',
      title: 'Hourly rate',
      headerClassName: 'text-right whitespace-nowrap',
      cellClassName: 'text-right',
      render: (value) => <span className="font-semibold tabular-nums">{formatCurrency(value)}</span>
    },
    {
      key: 'used_in',
      title: 'Used In',
      render: (_v, row) => {
        const ops = Array.isArray(data.router_operations) ? data.router_operations : [];
        const matching = ops.filter(op => op.labor_type_id === row.rate_id);
        if (matching.length === 0) {
          return (
            <span className="text-sm text-muted-foreground" title="Not referenced by any router op">—</span>
          );
        }
        const routerIds = [...new Set(matching.map(op => op.router_id))];
        return (
          <Badge
            variant="outline"
            className="whitespace-nowrap"
            title={`Routers: ${routerIds.join(', ')}`}
          >
            {matching.length} op{matching.length === 1 ? '' : 's'} · {routerIds.length} router{routerIds.length === 1 ? '' : 's'}
          </Badge>
        );
      }
    }
  ];

  // Full-page spinner only for the first load; later refreshes (after a
  // save) keep the table and any open dialog on screen.
  if (loading && !(Array.isArray(data.labor_rates) && data.labor_rates.length)) {
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
        description="Hourly rates by labor type. Routing operations use them to cost direct labor."
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
          <Select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
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