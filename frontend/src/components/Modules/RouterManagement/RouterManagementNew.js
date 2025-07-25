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
import RouterTable from './RouterTable';
import RouterModal from './RouterModal';
import RouterOperationsModal from './RouterOperationsModal';
import RouterSummary from './RouterSummary';
import RouterValidation from './RouterValidation';

const RouterManagement = () => {
  const { data, actions, loading } = useForecast();
  const [activeTab, setActiveTab] = useState('table');
  const [showRouterModal, setShowRouterModal] = useState(false);
  const [showOperationsModal, setShowOperationsModal] = useState(false);
  const [editingRouter, setEditingRouter] = useState(null);
  const [selectedRouter, setSelectedRouter] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterVersion, setFilterVersion] = useState('all');
  const [sortField, setSortField] = useState('router_name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [selectedRouters, setSelectedRouters] = useState([]);
  const [bulkAction, setBulkAction] = useState('');

  // Get unique versions for filtering
  const versions = useMemo(() => {
    const routers = Array.isArray(data.router_definitions) ? data.router_definitions : [];
    return [...new Set(routers.map(r => r.version || '1.0'))];
  }, [data.router_definitions]);

  // Filter and sort routers
  const filteredRouters = useMemo(() => {
    let routers = Array.isArray(data.router_definitions) ? data.router_definitions : [];
    
    // Apply search filter
    if (searchTerm) {
      routers = routers.filter(router => 
        router.router_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        router.router_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        router.router_description?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // Apply version filter
    if (filterVersion !== 'all') {
      routers = routers.filter(router => 
        (router.version || '1.0') === filterVersion
      );
    }
    
    // Apply sorting
    routers.sort((a, b) => {
      let aValue = a[sortField] || '';
      let bValue = b[sortField] || '';
      
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
      }
      
      if (sortDirection === 'asc') {
        return aValue.toString().localeCompare(bValue.toString());
      } else {
        return bValue.toString().localeCompare(aValue.toString());
      }
    });
    
    return routers;
  }, [data.router_definitions, searchTerm, filterVersion, sortField, sortDirection]);

  // Handle router creation/editing
  const handleSaveRouter = async (routerData) => {
    try {
      if (editingRouter) {
        await actions.updateRouter(editingRouter.router_id, routerData);
        toast.success('Router updated successfully');
      } else {
        // Generate router ID if not provided
        if (!routerData.router_id) {
          const routers = Array.isArray(data.router_definitions) ? data.router_definitions : [];
          const maxId = Math.max(...routers.map(r => {
            const id = r.router_id?.replace('R', '') || '0';
            return parseInt(id) || 0;
          }), 0);
          routerData.router_id = `R${String(maxId + 1).padStart(4, '0')}`;
        }
        
        await actions.createRouter(routerData);
        toast.success('Router created successfully');
      }
      
      setShowRouterModal(false);
      setEditingRouter(null);
      await actions.fetchAllData();
    } catch (error) {
      console.error('Error saving router:', error);
      toast.error('Failed to save router');
    }
  };

  // Handle router deletion
  const handleDeleteRouter = async (routerId) => {
    if (window.confirm('Are you sure you want to delete this router? This will also delete all associated operations. This action cannot be undone.')) {
      try {
        await actions.deleteRouter(routerId);
      } catch (error) {
        console.error('Error deleting router:', error);
      }
    }
  };

  // Handle router operations management
  const handleManageOperations = (router) => {
    setSelectedRouter(router);
    setShowOperationsModal(true);
  };

  // Handle bulk operations
  const handleBulkOperation = async () => {
    if (selectedRouters.length === 0) {
      toast.error('Please select routers for bulk operation');
      return;
    }

    if (bulkAction === 'delete') {
      if (window.confirm(`Are you sure you want to delete ${selectedRouters.length} routers? This action cannot be undone.`)) {
        try {
          for (const routerId of selectedRouters) {
            await actions.deleteRouter(routerId);
          }
          setSelectedRouters([]);
        } catch (error) {
          console.error('Error in bulk delete:', error);
        }
      }
    } else if (bulkAction === 'export') {
      const csvData = selectedRouters.map(routerId => {
        const router = data.router_definitions.find(r => r.router_id === routerId);
        return router;
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
        a.download = `routers-export-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`Exported ${csvData.length} routers`);
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

  // Handle router selection
  const handleRouterSelect = (routerId, selected) => {
    if (selected) {
      setSelectedRouters(prev => [...prev, routerId]);
    } else {
      setSelectedRouters(prev => prev.filter(id => id !== routerId));
    }
  };

  // Handle select all
  const handleSelectAll = (selected) => {
    if (selected) {
      setSelectedRouters(filteredRouters.map(r => r.router_id));
    } else {
      setSelectedRouters([]);
    }
  };

  // Get operation count for router
  const getOperationCount = (routerId) => {
    const operations = Array.isArray(data.router_operations) ? data.router_operations : [];
    return operations.filter(op => op.router_id === routerId).length;
  };

  // Define columns for DataTable
  const routerColumns = [
    {
      key: 'router_name',
      title: 'Router Name',
      render: (value, row) => (
        <div className="space-y-1">
          <div className="font-semibold">{value}</div>
          <div className="text-sm text-muted-foreground">ID: {row.router_id}</div>
        </div>
      )
    },
    {
      key: 'router_description',
      title: 'Description',
      render: (value) => value || 'N/A'
    },
    {
      key: 'version',
      title: 'Version',
      render: (value) => (
        <Badge variant="outline">{value || '1.0'}</Badge>
      )
    },
    {
      key: 'router_id',
      title: 'Operations',
      render: (value, row) => {
        const opCount = getOperationCount(value);
        return (
          <div className="flex items-center gap-2">
            <Badge variant={opCount > 0 ? 'success' : 'secondary'}>
              {opCount} ops
            </Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleManageOperations(row)}
            >
              Manage
            </Button>
          </div>
        );
      }
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
          <p className="ml-4 text-muted-foreground">Loading router data...</p>
        </div>
      </div>
    );
  }

  const headerActions = [
    {
      label: 'Add Router',
      onClick: () => {
        setEditingRouter(null);
        setShowRouterModal(true);
      },
      variant: 'default',
      className: 'bg-orange-600 hover:bg-orange-700'
    }
  ];

  if (selectedRouters.length > 0) {
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
        title="Router Management"
        description="Manage manufacturing routing definitions and operation sequences"
        actions={headerActions}
      />

      {/* Search and Filter Controls */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Label>Search:</Label>
          <Input
            type="text"
            placeholder="Search routers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-64"
          />
        </div>
        
        <div className="flex items-center gap-2">
          <Label>Version:</Label>
          <Select value={filterVersion} onValueChange={setFilterVersion}>
            <SelectOption value="all">All Versions</SelectOption>
            {versions.map(version => (
              <SelectOption key={version} value={version}>{version}</SelectOption>
            ))}
          </Select>
        </div>

        {selectedRouters.length > 0 && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="px-3 py-1">
              {selectedRouters.length} selected
            </Badge>
          </div>
        )}
      </div>

      {/* Tab Navigation */}
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
            Router Table
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
          <Card>
            <CardHeader>
              <CardTitle>All Routers ({filteredRouters.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                data={filteredRouters}
                columns={routerColumns}
                onEdit={(router) => {
                  setEditingRouter(router);
                  setShowRouterModal(true);
                }}
                onDelete={(router) => handleDeleteRouter(router.router_id)}
                emptyMessage="No routers found. Click 'Add Router' to get started."
              />
            </CardContent>
          </Card>
        )}

        {activeTab === 'summary' && (
          <RouterSummary 
            routers={data.router_definitions || []} 
            routerOperations={data.router_operations || []}
            machines={data.machines || []}
            units={data.units || []}
            laborRates={data.labor_rates || []}
          />
        )}

        {activeTab === 'validation' && (
          <RouterValidation 
            routers={data.router_definitions || []} 
            routerOperations={data.router_operations || []}
            machines={data.machines || []}
            units={data.units || []}
            laborRates={data.labor_rates || []}
          />
        )}
      </div>

      <RouterModal
        isOpen={showRouterModal}
        onClose={() => {
          setShowRouterModal(false);
          setEditingRouter(null);
        }}
        onSave={handleSaveRouter}
        router={editingRouter}
      />

      <RouterOperationsModal
        isOpen={showOperationsModal}
        onClose={() => {
          setShowOperationsModal(false);
          setSelectedRouter(null);
        }}
        router={selectedRouter}
        operations={data.router_operations || []}
        machines={data.machines || []}
        laborRates={data.labor_rates || []}
        onSave={async () => {
          await actions.fetchAllData();
          toast.success('Operations updated successfully');
        }}
      />
    </div>
  );
};

export default RouterManagement;