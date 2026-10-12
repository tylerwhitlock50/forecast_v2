import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import api, { showErrorToast } from '../../../lib/apiClient';
import { goToImportStep } from '../../Common/importLink';
import { bomDeleteImpact, cloneRows, linesOf, nextBomId, versionOf } from './bomHelpers';
import { useConfirm } from '../../Common/ConfirmDialog';
import { PageHeader } from '../../ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Select, SelectOption } from '../../ui/select';
import { DataTable } from '../../ui/data-table';
import BOMModal from './BOMModal';
import BOMItemsModal from './BOMItemsModal';
import BOMSummary from './BOMSummary';
import BOMValidation from './BOMValidation';

const BOMManagement = () => {
  const { data, actions, loading } = useForecast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('table');
  const [showBOMModal, setShowBOMModal] = useState(false);
  const [showItemsModal, setShowItemsModal] = useState(false);
  const [editingBOM, setEditingBOM] = useState(null);
  const [selectedBOM, setSelectedBOM] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterVersion, setFilterVersion] = useState('all');
  const [busy, setBusy] = useState(false);

  // Get unique versions for filtering from BOM definitions
  const versions = useMemo(() => {
    const boms = Array.isArray(data.bom_definitions) ? data.bom_definitions : [];
    return [...new Set(boms.map(b => versionOf(b.version)))].sort();
  }, [data.bom_definitions]);

  // Use BOM definitions directly and enhance with line counts and costs
  const bomDefinitions = useMemo(() => {
    const boms = Array.isArray(data.bom_definitions) ? data.bom_definitions : [];
    const bomLines = Array.isArray(data.bom) ? data.bom : [];
    const products = Array.isArray(data.products) ? data.products : [];

    return boms.map((bomDef) => {
      const lines = linesOf(bomLines, bomDef.bom_id, bomDef.version);
      // Products reference the BOM by id + bom_version (the version the
      // product ships with). "Used by" counts the products on this version.
      const productsOnThisVersion = products.filter(
        (p) => p.bom === bomDef.bom_id && versionOf(p.bom_version) === versionOf(bomDef.version)
      );
      const productsOnAnyVersion = products.filter((p) => p.bom === bomDef.bom_id);

      return {
        ...bomDef,
        total_cost: lines.reduce((sum, line) => sum + (line.material_cost || 0), 0),
        line_count: lines.length,
        used_by_count: productsOnThisVersion.length,
        used_by_any_version_count: productsOnAnyVersion.length,
        used_by_names: productsOnThisVersion.map((p) => p.unit_name).filter(Boolean),
      };
    });
  }, [data.bom_definitions, data.bom, data.products]);

  // Filter and sort BOMs (by name)
  const filteredBOMs = useMemo(() => {
    let boms = [...bomDefinitions];
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      boms = boms.filter(bom =>
        bom.bom_name?.toLowerCase().includes(q) ||
        bom.bom_id?.toLowerCase().includes(q) ||
        bom.bom_description?.toLowerCase().includes(q)
      );
    }
    if (filterVersion !== 'all') {
      boms = boms.filter(bom => versionOf(bom.version) === filterVersion);
    }
    boms.sort((a, b) => String(a.bom_name || '').localeCompare(String(b.bom_name || '')));
    return boms;
  }, [bomDefinitions, searchTerm, filterVersion]);

  // Create / edit a BOM header. The context shows the one toast (success, or
  // the server's reason); on failure the form stays open.
  const handleSaveBOM = async (bomData, { openItemsAfter = false } = {}) => {
    try {
      let savedBOM;
      if (editingBOM) {
        await actions.updateBOMDefinition(editingBOM.bom_id, bomData);
        savedBOM = { ...editingBOM, ...bomData };
      } else {
        savedBOM = { ...bomData, bom_id: bomData.bom_id || nextBomId(bomDefinitions) };
        await actions.createBOMDefinition(savedBOM);
      }

      setShowBOMModal(false);
      setEditingBOM(null);

      if (openItemsAfter) {
        // Jump straight into the items modal so the user can add lines
        // without hunting for the Manage button.
        setSelectedBOM({ ...savedBOM, version: versionOf(savedBOM.version) });
        setShowItemsModal(true);
      }
    } catch (error) {
      console.error('Error saving BOM:', error);
    }
  };

  // Delete a BOM: the header, every line of every version and the product
  // links go in ONE request (?cascade=true), after a confirm that says so.
  const handleDeleteBOM = async (bom) => {
    const impact = bomDeleteImpact(bom.bom_id, data.bom || [], data.products || []);
    const ok = await confirm({
      title: `Delete BOM ${bom.bom_id}?`,
      body: (
        <div className="space-y-3 text-sm text-gray-700">
          <p>
            <span className="font-medium text-gray-900">{bom.bom_name || bom.bom_id}</span> will be deleted with{' '}
            {impact.lineCount === 0
              ? 'no material lines'
              : `its ${impact.lineCount} material line${impact.lineCount === 1 ? '' : 's'}`}
            {impact.versions.length > 0 && ` (version${impact.versions.length === 1 ? '' : 's'} ${impact.versions.join(', ')})`}.
          </p>
          {impact.products.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
              <p className="font-medium">Used by {impact.products.length} product{impact.products.length === 1 ? '' : 's'}:</p>
              <p className="mt-1">{impact.products.join(', ')}</p>
              <p className="mt-2">They will be unlinked from this BOM, so their material cost becomes $0 until you assign another BOM.</p>
            </div>
          ) : (
            <p className="text-gray-500">No product uses this BOM.</p>
          )}
          <p className="text-gray-500">This cannot be undone.</p>
        </div>
      ),
      confirmLabel: 'Delete BOM',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await actions.deleteBOMDefinition(bom.bom_id, { cascade: true });
    } catch (error) {
      console.error('Error deleting BOM:', error);
    }
  };

  // Handle BOM items management
  const handleManageItems = (bom) => {
    setSelectedBOM(bom);
    setShowItemsModal(true);
  };

  // Clone the BOM version shown on the row (header + its lines, same version
  // and line numbers) under a new id, in one import request.
  const handleCloneBOM = async (bom) => {
    const version = versionOf(bom.version);
    const newBomId = nextBomId(bomDefinitions);
    const rows = cloneRows(data.bom || [], bom, newBomId);
    setBusy(true);
    try {
      if (rows.length > 0) {
        const res = await api.post(
          '/import/boms',
          { rows, mode: 'replace', link_products: false },
          { suppressSuccessToast: true, suppressErrorToast: true }
        );
        const errors = res?.data?.errors || [];
        if (errors.length) throw new Error(errors.map(e => e.error).join('; '));
        await actions.fetchAllData();
      } else {
        await actions.createBOMDefinition({
          bom_id: newBomId,
          bom_name: `${bom.bom_name || bom.bom_id} (copy)`,
          bom_description: bom.bom_description || '',
          version,
        }, { silent: true });
      }
      toast.success(`Copied ${bom.bom_id} v${version} to ${newBomId} (${rows.length} line${rows.length === 1 ? '' : 's'})`);
    } catch (error) {
      console.error('Error cloning BOM:', error);
      showErrorToast(error, `Could not copy ${bom.bom_id}`);
    } finally {
      setBusy(false);
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

  // Define columns for DataTable (Clone / Edit / Delete live in the one
  // pinned actions column)
  const bomColumns = [
    {
      key: 'bom_name',
      title: 'BOM',
      headerClassName: 'min-w-[11rem]',
      cellClassName: 'py-3',
      render: (value, row) => (
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-gray-900">{value || row.bom_id}</span>
            <Badge variant="outline" className="whitespace-nowrap px-1.5 py-0 text-[11px] font-medium text-gray-600">v{versionOf(row.version)}</Badge>
          </div>
          <div className="whitespace-nowrap font-mono text-xs text-muted-foreground">{row.bom_id}</div>
          {row.bom_description && (
            <div className="max-w-xs text-xs text-gray-500">{row.bom_description}</div>
          )}
        </div>
      )
    },
    {
      key: 'line_count',
      title: 'Lines',
      cellClassName: 'py-3',
      render: (value, row) => (
        <Button
          size="sm"
          variant="outline"
          className={`h-8 whitespace-nowrap px-2.5 ${value > 0 ? '' : 'border-amber-300 text-amber-800'}`}
          onClick={() => handleManageItems(row)}
          title="View and edit the material lines"
        >
          {value || 0} line{value === 1 ? '' : 's'} · Edit
        </Button>
      )
    },
    {
      key: 'total_cost',
      title: 'Material / unit',
      headerClassName: 'text-right whitespace-nowrap',
      cellClassName: 'py-3 text-right',
      render: (value) => <span className="font-semibold tabular-nums">{formatCurrency(value)}</span>
    },
    {
      key: 'used_by_count',
      title: 'Used by',
      cellClassName: 'py-3',
      render: (value, row) => {
        if (!value) {
          return (
            <span className="text-sm text-muted-foreground" title="Not assigned to any product on this version">
              —
            </span>
          );
        }
        const names = row.used_by_names || [];
        const shown = names.slice(0, 2).join(', ');
        return (
          <span className="block max-w-[10rem] truncate text-sm text-gray-700" title={names.join(', ')}>
            {names.length ? shown : `${value} product${value === 1 ? '' : 's'}`}
            {names.length > 2 ? ` +${names.length - 2}` : ''}
          </span>
        );
      }
    }
  ];

  // Full-page spinner only for the first load; later refreshes (after a
  // save) keep the table and any open dialog on screen.
  if (loading && bomDefinitions.length === 0) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="ml-4 text-muted-foreground">Loading BOM data...</p>
        </div>
      </div>
    );
  }

  const headerActions = [
    {
      label: 'Import from file',
      onClick: () => goToImportStep(navigate, 'boms'),
      variant: 'outline'
    },
    {
      label: 'Add BOM',
      onClick: () => {
        setEditingBOM(null);
        setShowBOMModal(true);
      },
      variant: 'default',
      className: 'bg-orange-600 hover:bg-orange-700 text-white'
    }
  ];

  return (
    <div className="container mx-auto px-6 py-8">
      <PageHeader
        title="Bills of Materials"
        description="Materials and quantities per finished unit. Product material cost comes from the BOM version each product uses."
        actions={headerActions}
      />

      {/* Search and Filter Controls */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Label>Search:</Label>
          <Input
            type="text"
            placeholder="Search BOMs..."
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
            BOM Table
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
              <CardTitle>All BOMs ({filteredBOMs.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                data={filteredBOMs}
                columns={bomColumns}
                rowKey="bom_id"
                rowActions={[
                  {
                    label: 'Clone',
                    title: 'Copy this BOM version (header and lines) to a new BOM',
                    onClick: (bom) => { if (!busy) handleCloneBOM(bom); },
                  },
                ]}
                onEdit={(bom) => {
                  setEditingBOM(bom);
                  setShowBOMModal(true);
                }}
                onDelete={(bom) => handleDeleteBOM(bom)}
                emptyMessage={
                  <div className="space-y-3">
                    <p>No BOMs yet. Import them from a spreadsheet, or add one by hand.</p>
                    <div className="flex justify-center gap-2">
                      <Button variant="outline" onClick={() => goToImportStep(navigate, 'boms')}>Import from file</Button>
                      <Button className="bg-orange-600 text-white hover:bg-orange-700" onClick={() => { setEditingBOM(null); setShowBOMModal(true); }}>Add BOM</Button>
                    </div>
                  </div>
                }
              />
            </CardContent>
          </Card>
        )}

        {activeTab === 'summary' && (
          <BOMSummary 
            boms={bomDefinitions} 
            bomItems={data.bom || []}
            units={data.units || []}
          />
        )}

        {activeTab === 'validation' && (
          <BOMValidation 
            boms={bomDefinitions} 
            bomLines={data.bom || []}
          />
        )}
      </div>

      <BOMModal
        isOpen={showBOMModal}
        onClose={() => {
          setShowBOMModal(false);
          setEditingBOM(null);
        }}
        onSave={handleSaveBOM}
        bom={editingBOM}
      />

      <BOMItemsModal
        isOpen={showItemsModal}
        onClose={() => {
          setShowItemsModal(false);
          setSelectedBOM(null);
        }}
        bom={selectedBOM}
        bomItems={data.bom || []}
        bomDefinitions={bomDefinitions}
        onSave={async () => {
          // The item actions already refreshed the data and showed their toast.
        }}
      />
    </div>
  );
};

export default BOMManagement;