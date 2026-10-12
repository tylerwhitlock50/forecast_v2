import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import api, { showErrorToast } from '../../../lib/apiClient';
import { goToImport } from '../../Common/importLink';
import { cloneRoutingRows, nextRouterId, routerDeleteImpact } from './routerHelpers';
import { useConfirm } from '../../Common/ConfirmDialog';
import { PageHeader } from '../../ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Select, SelectOption } from '../../ui/select';
import { DataTable } from '../../ui/data-table';
import RouterModal from './RouterModal';
import RouterOperationsModal from './RouterOperationsModal';
import RouterSummary from './RouterSummary';
import RouterValidation from './RouterValidation';

const RouterManagement = () => {
  const { data, actions, loading } = useForecast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('table');
  const [showRouterModal, setShowRouterModal] = useState(false);
  const [showOperationsModal, setShowOperationsModal] = useState(false);
  const [editingRouter, setEditingRouter] = useState(null);
  const [selectedRouter, setSelectedRouter] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterVersion, setFilterVersion] = useState('all');
  const [busy, setBusy] = useState(false);

  const routers = useMemo(
    () => (Array.isArray(data.router_definitions) ? data.router_definitions : []),
    [data.router_definitions]
  );
  const operations = useMemo(
    () => (Array.isArray(data.router_operations) ? data.router_operations : []),
    [data.router_operations]
  );

  // Get unique versions for filtering
  const versions = useMemo(
    () => [...new Set(routers.map(r => r.version || '1.0'))].sort(),
    [routers]
  );

  // Filter and sort routers (by name)
  const filteredRouters = useMemo(() => {
    let list = [...routers];
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(router =>
        router.router_name?.toLowerCase().includes(q) ||
        router.router_id?.toLowerCase().includes(q) ||
        router.router_description?.toLowerCase().includes(q)
      );
    }
    if (filterVersion !== 'all') {
      list = list.filter(router => (router.version || '1.0') === filterVersion);
    }
    list.sort((a, b) => String(a.router_name || '').localeCompare(String(b.router_name || '')));
    return list;
  }, [routers, searchTerm, filterVersion]);

  // Create / edit a routing header. The context shows the one toast (success,
  // or the server's reason); on failure the form stays open.
  const handleSaveRouter = async (routerData) => {
    try {
      if (editingRouter) {
        await actions.updateRouter(editingRouter.router_id, routerData);
      } else {
        await actions.createRouter({ ...routerData, router_id: routerData.router_id || nextRouterId(routers) });
      }
      setShowRouterModal(false);
      setEditingRouter(null);
    } catch (error) {
      console.error('Error saving router:', error);
    }
  };

  // Delete a routing: its operations and the product links go in ONE request
  // (?cascade=true), after a confirm that lists what will be removed.
  const handleDeleteRouter = async (router) => {
    const impact = routerDeleteImpact(router.router_id, operations, data.products || []);
    const ok = await confirm({
      title: `Delete routing ${router.router_id}?`,
      body: (
        <div className="space-y-3 text-sm text-gray-700">
          <p>
            <span className="font-medium text-gray-900">{router.router_name || router.router_id}</span> will be deleted with{' '}
            {impact.operationCount === 0
              ? 'no operations'
              : `its ${impact.operationCount} operation${impact.operationCount === 1 ? '' : 's'} (sequence ${impact.sequences.join(', ')})`}.
          </p>
          {impact.products.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
              <p className="font-medium">Used by {impact.products.length} product{impact.products.length === 1 ? '' : 's'}:</p>
              <p className="mt-1">{impact.products.join(', ')}</p>
              <p className="mt-2">They will be unlinked from this routing, so their labor and machine cost becomes $0 until you assign another routing.</p>
            </div>
          ) : (
            <p className="text-gray-500">No product uses this routing.</p>
          )}
          <p className="text-gray-500">This cannot be undone.</p>
        </div>
      ),
      confirmLabel: 'Delete routing',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await actions.deleteRouter(router.router_id, { cascade: true });
    } catch (error) {
      console.error('Error deleting router:', error);
    }
  };

  // Handle router operations management
  const handleManageOperations = (router) => {
    setSelectedRouter(router);
    setShowOperationsModal(true);
  };

  // Get operation count for router
  const getOperationCount = (routerId) => operations.filter(op => op.router_id === routerId).length;

  // Products referencing a router; used for the "Used By" column.
  const getProductsUsingRouter = (routerId) => {
    const products = Array.isArray(data.products) ? data.products : [];
    return products.filter(p => p.router === routerId);
  };

  // Labor + machine cost per unit of a routing (same rule as the backend
  // rollup: minutes / 60 x rate).
  const getConversionCost = (routerId) => {
    const machines = Array.isArray(data.machines) ? data.machines : [];
    const rates = Array.isArray(data.labor_rates) ? data.labor_rates : [];
    return operations
      .filter(op => op.router_id === routerId)
      .reduce((sum, op) => {
        const machine = machines.find(m => m.machine_id === op.machine_id);
        const rate = rates.find(r => r.rate_id === op.labor_type_id);
        return sum
          + (machine ? (op.machine_minutes || 0) / 60 * (machine.machine_rate || 0) : 0)
          + (rate ? (op.labor_minutes || 0) / 60 * (rate.rate_amount || 0) : 0);
      }, 0);
  };

  const formatMoney = (value) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0);

  // Clone a routing and all of its operations under a new id, in one import request.
  const handleCloneRouter = async (router) => {
    const newRouterId = nextRouterId(routers);
    const rows = cloneRoutingRows(operations, router, newRouterId);
    setBusy(true);
    try {
      if (rows.length > 0) {
        const res = await api.post(
          '/import/routings',
          { rows, mode: 'replace', link_products: false },
          { suppressSuccessToast: true, suppressErrorToast: true }
        );
        const errors = res?.data?.errors || [];
        if (errors.length) throw new Error(errors.map(e => e.error).join('; '));
        await actions.fetchAllData();
      } else {
        await actions.createRouter({
          router_id: newRouterId,
          router_name: `${router.router_name || router.router_id} (copy)`,
          router_description: router.router_description || '',
          version: router.version || '1.0',
        }, { silent: true });
      }
      toast.success(`Copied ${router.router_id} to ${newRouterId} (${rows.length} operation${rows.length === 1 ? '' : 's'})`);
    } catch (error) {
      console.error('Error cloning router:', error);
      showErrorToast(error, `Could not copy ${router.router_id}`);
    } finally {
      setBusy(false);
    }
  };

  // Define columns for DataTable (Clone / Edit / Delete live in the one
  // pinned actions column)
  const routerColumns = [
    {
      key: 'router_name',
      title: 'Routing',
      headerClassName: 'min-w-[11rem]',
      cellClassName: 'py-3',
      render: (value, row) => (
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-gray-900">{value || row.router_id}</span>
            <Badge variant="outline" className="whitespace-nowrap px-1.5 py-0 text-[11px] font-medium text-gray-600">v{row.version || '1.0'}</Badge>
          </div>
          <div className="whitespace-nowrap font-mono text-xs text-muted-foreground">{row.router_id}</div>
          {row.router_description && (
            <div className="max-w-xs text-xs text-gray-500">{row.router_description}</div>
          )}
        </div>
      )
    },
    {
      key: 'operations',
      title: 'Operations',
      cellClassName: 'py-3',
      render: (_v, row) => {
        const opCount = getOperationCount(row.router_id);
        return (
          <Button
            size="sm"
            variant="outline"
            className={`h-8 whitespace-nowrap px-2.5 ${opCount > 0 ? '' : 'border-amber-300 text-amber-800'}`}
            onClick={() => handleManageOperations(row)}
            title="View and edit the operations"
          >
            {opCount} op{opCount === 1 ? '' : 's'} · Edit
          </Button>
        );
      }
    },
    {
      key: 'cost_per_unit',
      title: <span className="cursor-help border-b border-dotted border-gray-400" title="Labor + machine cost per unit">Cost / unit</span>,
      headerClassName: 'text-right whitespace-nowrap',
      cellClassName: 'py-3 text-right',
      render: (_v, row) => (
        <span className="font-semibold tabular-nums">{formatMoney(getConversionCost(row.router_id))}</span>
      )
    },
    {
      key: 'used_by',
      title: 'Used by',
      cellClassName: 'py-3',
      render: (_v, row) => {
        const users = getProductsUsingRouter(row.router_id);
        if (users.length === 0) {
          return (
            <span className="text-sm text-muted-foreground" title="Not assigned to any product">—</span>
          );
        }
        const names = users.map(p => p.unit_name || p.unit_id);
        return (
          <span className="block max-w-[10rem] truncate text-sm text-gray-700" title={names.join(', ')}>
            {names.slice(0, 2).join(', ')}{names.length > 2 ? ` +${names.length - 2}` : ''}
          </span>
        );
      }
    }
  ];

  // Full-page spinner only for the first load; later refreshes (after a
  // save) keep the table and any open dialog on screen.
  if (loading && routers.length === 0) {
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
      label: 'Import from file',
      onClick: () => goToImport(navigate, 'routings'),
      variant: 'outline'
    },
    {
      label: 'Add Router',
      onClick: () => {
        setEditingRouter(null);
        setShowRouterModal(true);
      },
      variant: 'default',
      className: 'bg-orange-600 hover:bg-orange-700 text-white'
    }
  ];

  return (
    <div className="container mx-auto px-6 py-8">
      <PageHeader
        title="Routings"
        description="Operation steps per finished unit: machine minutes, labor minutes and labor type. Product labor and machine cost comes from its routing."
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
          <Select value={filterVersion} onChange={(e) => setFilterVersion(e.target.value)}>
            <SelectOption value="all">All Versions</SelectOption>
            {versions.map(version => (
              <SelectOption key={version} value={version}>{version}</SelectOption>
            ))}
          </Select>
        </div>
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
              <CardTitle>All routings ({filteredRouters.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                data={filteredRouters}
                columns={routerColumns}
                rowKey="router_id"
                rowActions={[
                  {
                    label: 'Clone',
                    title: 'Copy this routing and all its operations to a new routing',
                    onClick: (router) => { if (!busy) handleCloneRouter(router); },
                  },
                ]}
                onEdit={(router) => {
                  setEditingRouter(router);
                  setShowRouterModal(true);
                }}
                onDelete={(router) => handleDeleteRouter(router)}
                emptyMessage={
                  <div className="space-y-3">
                    <p>No routings yet. Import them from a spreadsheet, or add one by hand.</p>
                    <div className="flex justify-center gap-2">
                      <Button variant="outline" onClick={() => goToImport(navigate, 'routings')}>Import from file</Button>
                      <Button className="bg-orange-600 text-white hover:bg-orange-700" onClick={() => { setEditingRouter(null); setShowRouterModal(true); }}>Add Router</Button>
                    </div>
                  </div>
                }
              />
            </CardContent>
          </Card>
        )}

        {activeTab === 'summary' && (
          <RouterSummary
            routers={data.router_definitions || []}
            routerOperations={data.router_operations || []}
            machines={data.machines || []}
            products={data.products || []}
            laborRates={data.labor_rates || []}
          />
        )}

        {activeTab === 'validation' && (
          <RouterValidation
            routers={data.router_definitions || []}
            routerOperations={data.router_operations || []}
            machines={data.machines || []}
            products={data.products || []}
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
          // The operation actions already refreshed the data and showed their toast.
        }}
      />
    </div>
  );
};

export default RouterManagement;