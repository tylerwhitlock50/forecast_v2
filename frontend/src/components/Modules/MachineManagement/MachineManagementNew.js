import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import { useConfirm } from '../../Common/ConfirmDialog';
import { PageHeader } from '../../ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Select, SelectOption } from '../../ui/select';
import { DataTable } from '../../ui/data-table';

import MachineModal from './MachineModal';
import MachineSummary from './MachineSummary';
import MachineValidation from './MachineValidation';
import { formatCapacityHours } from './machineHelpers';

const MachineManagement = () => {
  const { data, actions, loading } = useForecast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('table');
  const [showMachineModal, setShowMachineModal] = useState(false);
  const [editingMachine, setEditingMachine] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [sortField] = useState('machine_name');
  const [sortDirection] = useState('asc');
  const [selectedMachines, setSelectedMachines] = useState([]);
  const [bulkAction, setBulkAction] = useState('');

  // Get unique machine types for filtering
  const machineTypes = useMemo(() => {
    const machines = Array.isArray(data.machines) ? data.machines : [];
    return [...new Set(machines.map(m => m.labor_type || 'General'))];
  }, [data.machines]);

  // Filter and sort machines
  const filteredMachines = useMemo(() => {
    let machines = Array.isArray(data.machines) ? data.machines : [];
    
    // Apply search filter
    if (searchTerm) {
      machines = machines.filter(machine => 
        machine.machine_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        machine.machine_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        machine.machine_description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        machine.labor_type?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // Apply type filter
    if (filterType !== 'all') {
      machines = machines.filter(machine => 
        (machine.labor_type || 'General') === filterType
      );
    }
    
    // Apply sorting
    machines.sort((a, b) => {
      const aValue = a[sortField] || '';
      const bValue = b[sortField] || '';
      
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
      }
      
      if (sortDirection === 'asc') {
        return aValue.toString().localeCompare(bValue.toString());
      } else {
        return bValue.toString().localeCompare(aValue.toString());
      }
    });
    
    return machines;
  }, [data.machines, searchTerm, filterType, sortField, sortDirection]);

  // Handle machine creation/editing
  const handleSaveMachine = async (machineData) => {
    try {
      // The context action shows the one toast (or the server's reason);
      // on failure the form stays open.
      if (editingMachine) {
        await actions.updateMachine(editingMachine.machine_id, machineData);
      } else {
        // Generate machine ID if not provided
        if (!machineData.machine_id) {
          const machines = Array.isArray(data.machines) ? data.machines : [];
          const maxId = Math.max(...machines.map(m => {
            const id = m.machine_id?.replace('WC', '') || '0';
            return parseInt(id) || 0;
          }), 0);
          machineData.machine_id = `WC${String(maxId + 1).padStart(4, '0')}`;
        }
        
        await actions.createMachine(machineData);
      }
      
      setShowMachineModal(false);
      setEditingMachine(null);
    } catch (error) {
      console.error('Error saving machine:', error);
    }
  };

  // Handle machine deletion
  const handleDeleteMachine = async (machineId) => {
    const ops = (Array.isArray(data.router_operations) ? data.router_operations : [])
      .filter(op => op.machine_id === machineId);
    if (ops.length > 0) {
      // The server refuses to delete a machine that routing steps still use.
      const goToRoutings = await confirm({
        title: `${machineId} is still in use`,
        body: `Used by ${ops.length} routing operation${ops.length === 1 ? '' : 's'}: ${ops.map(op => `${op.router_id} seq ${op.sequence}`).join(', ')}. Point those operations at another machine (or delete them) first.`,
        confirmLabel: 'Open routings',
        cancelLabel: 'Close',
      });
      if (goToRoutings) navigate('/routing');
      return;
    }
    if (await confirm({
      title: `Delete machine ${machineId}?`,
      body: 'No routing uses it. This cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    })) {
      try {
        await actions.deleteMachine(machineId);
      } catch (error) {
        console.error('Error deleting machine:', error);
      }
    }
  };

  // Handle bulk operations
  const handleBulkOperation = async () => {
    if (selectedMachines.length === 0) {
      toast.error('Please select machines for bulk operation');
      return;
    }

    if (bulkAction === 'delete') {
      if (await confirm({
        title: `Delete ${selectedMachines.length} machines?`,
        body: 'Router operations referencing deleted machines will contribute $0 for machine cost.',
        confirmLabel: 'Delete',
        variant: 'destructive',
      })) {
        try {
          for (const machineId of selectedMachines) {
            await actions.deleteMachine(machineId);
          }
          setSelectedMachines([]);
        } catch (error) {
          console.error('Error in bulk delete:', error);
        }
      }
    } else if (bulkAction === 'export') {
      const csvData = selectedMachines.map(machineId => {
        const machine = data.machines.find(m => m.machine_id === machineId);
        return machine;
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
        a.download = `machines-export-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`Exported ${csvData.length} machines`);
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

  // Labor type and description are optional on a machine; their columns only show when used.
  const anyTyped = (Array.isArray(data.machines) ? data.machines : []).some(m => m.labor_type && String(m.labor_type).trim());
  const anyDescribed = (Array.isArray(data.machines) ? data.machines : []).some(m => m.machine_description && String(m.machine_description).trim());

  // Define columns for DataTable
  const machineColumns = [
    {
      key: 'machine_name',
      title: 'Machine',
      render: (value, row) => (
        <div className="min-w-[12rem] space-y-0.5">
          <div className="font-semibold">{value}</div>
          <div className="font-mono text-xs text-muted-foreground">{row.machine_id}</div>
        </div>
      )
    },
    ...(anyTyped ? [{
      key: 'labor_type',
      title: 'Type',
      render: (value) => (value ? <Badge variant="outline">{value}</Badge> : <span className="text-xs text-gray-400">—</span>)
    }] : []),
    {
      key: 'machine_rate',
      title: 'Hourly rate',
      render: (value) => (value === null || value === undefined || value === ''
        ? <span className="text-xs font-medium text-amber-700">Not set</span>
        : <span className="whitespace-nowrap tabular-nums">{formatCurrency(value)}</span>)
    },
    {
      key: 'available_minutes_per_month',
      title: 'Capacity (h / month)',
      render: (value) => {
        const hours = formatCapacityHours(value);
        return hours === null || !Number(value)
          ? <span className="text-xs font-medium text-amber-700">Not set</span>
          : <span className="whitespace-nowrap tabular-nums" title={`${Number(value).toLocaleString('en-US')} minutes per month`}>{hours}</span>;
      }
    },
    ...(anyDescribed ? [{
      key: 'machine_description',
      title: 'Description',
      render: (value) => <span className="text-sm text-gray-600">{value || ''}</span>
    }] : []),
    {
      key: 'used_in',
      title: 'Used In',
      render: (_v, row) => {
        const ops = Array.isArray(data.router_operations) ? data.router_operations : [];
        const matching = ops.filter(op => op.machine_id === row.machine_id);
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
  if (loading && !(Array.isArray(data.machines) && data.machines.length)) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="ml-4 text-muted-foreground">Loading machine data...</p>
        </div>
      </div>
    );
  }

  const headerActions = [
    {
      label: 'Add Machine',
      onClick: () => {
        setEditingMachine(null);
        setShowMachineModal(true);
      },
      variant: 'default',
      className: 'bg-orange-600 hover:bg-orange-700'
    }
  ];

  if (selectedMachines.length > 0) {
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
        title="Machine Management"
        description="Manage your manufacturing equipment, capacity, and rates"
        actions={headerActions}
      />

      {/* Search and Filter Controls */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Label>Search:</Label>
          <Input
            type="text"
            placeholder="Search machines..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-64"
          />
        </div>
        
        {anyTyped && (
          <div className="flex items-center gap-2">
            <Label>Type:</Label>
            <Select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <SelectOption value="all">All Types</SelectOption>
              {machineTypes.map(type => (
                <SelectOption key={type} value={type}>{type}</SelectOption>
              ))}
            </Select>
          </div>
        )}

        {selectedMachines.length > 0 && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="px-3 py-1">
              {selectedMachines.length} selected
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
            Machine Table
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
                <CardTitle>All Machines ({filteredMachines.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <DataTable
                  data={filteredMachines}
                  columns={machineColumns}
                  onEdit={(machine) => {
                    setEditingMachine(machine);
                    setShowMachineModal(true);
                  }}
                  onDelete={(machine) => handleDeleteMachine(machine.machine_id)}
                  emptyMessage="No machines found. Click 'Add Machine' to get started."
                />
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'summary' && (
          <div className="space-y-6">
            <MachineSummary machines={data.machines || []} />
          </div>
        )}

        {activeTab === 'validation' && (
          <div className="space-y-6">
            <MachineValidation machines={data.machines || []} />
          </div>
        )}
      </div>

      <MachineModal
        isOpen={showMachineModal}
        onClose={() => {
          setShowMachineModal(false);
          setEditingMachine(null);
        }}
        onSave={handleSaveMachine}
        machine={editingMachine}
      />
    </div>
  );
};

export default MachineManagement;