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
import BOMTable from './BOMTable';
import BOMModal from './BOMModal';
import BOMItemsModal from './BOMItemsModal';
import BOMSummary from './BOMSummary';
import BOMValidation from './BOMValidation';

const BOMManagement = () => {
  const { data, actions, loading } = useForecast();
  const [activeTab, setActiveTab] = useState('table');
  const [showBOMModal, setShowBOMModal] = useState(false);
  const [showItemsModal, setShowItemsModal] = useState(false);
  const [editingBOM, setEditingBOM] = useState(null);
  const [selectedBOM, setSelectedBOM] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterVersion, setFilterVersion] = useState('all');
  const [sortField, setSortField] = useState('bom_name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [selectedBOMs, setSelectedBOMs] = useState([]);
  const [bulkAction, setBulkAction] = useState('');

  // Get unique versions for filtering from BOM definitions
  const versions = useMemo(() => {
    const boms = Array.isArray(data.bom_definitions) ? data.bom_definitions : [];
    return [...new Set(boms.map(b => b.version || '1.0'))];
  }, [data.bom_definitions]);

  // Use BOM definitions directly and enhance with line counts and costs
  const bomDefinitions = useMemo(() => {
    const boms = Array.isArray(data.bom_definitions) ? data.bom_definitions : [];
    const bomLines = Array.isArray(data.bom) ? data.bom : [];
    console.log('Raw BOM definitions:', boms);
    console.log('Raw BOM lines:', bomLines);
    
    const enhancedBOMs = boms.map(bomDef => {
      // Get all lines for this BOM
      const lines = bomLines.filter(line => 
        line.bom_id === bomDef.bom_id && 
        line.version === bomDef.version
      );
      
      const totalCost = lines.reduce((sum, line) => sum + (line.material_cost || 0), 0);
      const lineCount = lines.length;
      
      return {
        ...bomDef,
        total_cost: totalCost,
        line_count: lineCount
      };
    });
    
    console.log('Enhanced BOM definitions:', enhancedBOMs);
    return enhancedBOMs;
  }, [data.bom_definitions, data.bom]);

  // Filter and sort BOMs
  const filteredBOMs = useMemo(() => {
    let boms = [...bomDefinitions];
    
    // Apply search filter
    if (searchTerm) {
      boms = boms.filter(bom => 
        bom.bom_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        bom.bom_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        bom.bom_description?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // Apply version filter
    if (filterVersion !== 'all') {
      boms = boms.filter(bom => 
        (bom.version || '1.0') === filterVersion
      );
    }
    
    // Apply sorting
    boms.sort((a, b) => {
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
    
    return boms;
  }, [bomDefinitions, searchTerm, filterVersion, sortField, sortDirection]);

  // Handle BOM creation/editing
  const handleSaveBOM = async (bomData) => {
    try {
      if (editingBOM) {
        await actions.updateBOMDefinition(editingBOM.bom_id, bomData);
        toast.success('BOM updated successfully');
      } else {
        // Generate BOM ID if not provided
        if (!bomData.bom_id) {
          const boms = bomDefinitions;
          const maxId = Math.max(...boms.map(b => {
            const id = b.bom_id?.replace('BOM-', '') || '0';
            return parseInt(id) || 0;
          }), 0);
          bomData.bom_id = `BOM-${String(maxId + 1).padStart(3, '0')}`;
        }
        
        await actions.createBOMDefinition(bomData);
        toast.success('BOM created successfully');
      }
      
      setShowBOMModal(false);
      setEditingBOM(null);
      await actions.fetchAllData();
    } catch (error) {
      console.error('Error saving BOM:', error);
      toast.error('Failed to save BOM');
    }
  };

  // Handle BOM deletion
  const handleDeleteBOM = async (bomId) => {
    if (window.confirm('Are you sure you want to delete this BOM? This will also delete all associated items. This action cannot be undone.')) {
      try {
        // Delete BOM definition first
        await actions.deleteBOMDefinition(bomId);
        
        // Delete all BOM items with this BOM ID
        const bomItems = Array.isArray(data.bom) ? data.bom : [];
        const itemsToDelete = bomItems.filter(item => item.bom_id === bomId);
        
        for (const item of itemsToDelete) {
          await actions.deleteBOM(`${item.bom_id}-${item.version}-${item.bom_line}`);
        }
        
        toast.success('BOM deleted successfully');
      } catch (error) {
        console.error('Error deleting BOM:', error);
        toast.error('Failed to delete BOM');
      }
    }
  };

  // Handle BOM items management
  const handleManageItems = (bom) => {
    setSelectedBOM(bom);
    setShowItemsModal(true);
  };

  // Handle BOM cloning
  const handleCloneBOM = async (bomId) => {
    try {
      const bomItems = Array.isArray(data.bom) ? data.bom : [];
      const itemsToClone = bomItems.filter(item => item.bom_id === bomId);
      
      if (itemsToClone.length === 0) {
        toast.error('No items found to clone');
        return;
      }
      
      // Generate new BOM ID
      const boms = bomDefinitions;
      const maxId = Math.max(...boms.map(b => {
        const id = b.bom_id?.replace('BOM-', '') || '0';
        return parseInt(id) || 0;
      }), 0);
      const newBomId = `BOM-${String(maxId + 1).padStart(3, '0')}`;
      
      // Clone all items
      for (const item of itemsToClone) {
        const clonedItem = {
          ...item,
          bom_id: newBomId,
          version: '1.0'
        };
        delete clonedItem.created_at;
        
        await actions.createBOM(clonedItem);
      }
      
      toast.success(`BOM cloned successfully as ${newBomId}`);
      await actions.fetchAllData();
    } catch (error) {
      console.error('Error cloning BOM:', error);
      toast.error('Failed to clone BOM');
    }
  };

  // Handle bulk operations
  const handleBulkOperation = async () => {
    if (selectedBOMs.length === 0) {
      toast.error('Please select BOMs for bulk operation');
      return;
    }

    if (bulkAction === 'delete') {
      if (window.confirm(`Are you sure you want to delete ${selectedBOMs.length} BOMs? This action cannot be undone.`)) {
        try {
          for (const bomId of selectedBOMs) {
            await handleDeleteBOM(bomId);
          }
          setSelectedBOMs([]);
        } catch (error) {
          console.error('Error in bulk delete:', error);
        }
      }
    } else if (bulkAction === 'export') {
      const csvData = selectedBOMs.map(bomId => {
        const bom = bomDefinitions.find(b => b.bom_id === bomId);
        return bom;
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
        a.download = `boms-export-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`Exported ${csvData.length} BOMs`);
      }
    } else if (bulkAction === 'clone') {
      try {
        for (const bomId of selectedBOMs) {
          await handleCloneBOM(bomId);
        }
        setSelectedBOMs([]);
      } catch (error) {
        console.error('Error in bulk clone:', error);
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
  const bomColumns = [
    {
      key: 'bom_name',
      title: 'BOM Name',
      render: (value, row) => (
        <div className="space-y-1">
          <div className="font-semibold">{value}</div>
          <div className="text-sm text-muted-foreground">ID: {row.bom_id}</div>
        </div>
      )
    },
    {
      key: 'bom_description',
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
      key: 'line_count',
      title: 'Items',
      render: (value, row) => (
        <div className="flex items-center gap-2">
          <Badge variant={value > 0 ? 'success' : 'secondary'}>
            {value || 0} items
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleManageItems(row)}
          >
            Manage
          </Button>
        </div>
      )
    },
    {
      key: 'total_cost',
      title: 'Total Cost',
      render: (value) => <span className="font-semibold">{formatCurrency(value)}</span>
    },
    {
      key: 'bom_id',
      title: 'Actions',
      render: (value, row) => (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleCloneBOM(value)}
            title="Clone BOM"
          >
            Clone
          </Button>
        </div>
      )
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
          <p className="ml-4 text-muted-foreground">Loading BOM data...</p>
        </div>
      </div>
    );
  }

  const headerActions = [
    {
      label: 'Add BOM',
      onClick: () => {
        setEditingBOM(null);
        setShowBOMModal(true);
      },
      variant: 'default',
      className: 'bg-orange-600 hover:bg-orange-700'
    }
  ];

  if (selectedBOMs.length > 0) {
    headerActions.push({
      label: 'Export Selected',
      onClick: () => {
        setBulkAction('export');
        handleBulkOperation();
      },
      variant: 'outline'
    });
    headerActions.push({
      label: 'Clone Selected',
      onClick: () => {
        setBulkAction('clone');
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
        title="BOM Management"
        description="Manage bill of materials, material costs, and component specifications"
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
          <Select value={filterVersion} onValueChange={setFilterVersion}>
            <SelectOption value="all">All Versions</SelectOption>
            {versions.map(version => (
              <SelectOption key={version} value={version}>{version}</SelectOption>
            ))}
          </Select>
        </div>

        {selectedBOMs.length > 0 && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="px-3 py-1">
              {selectedBOMs.length} selected
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
                onEdit={(bom) => {
                  setEditingBOM(bom);
                  setShowBOMModal(true);
                }}
                onDelete={(bom) => handleDeleteBOM(bom.bom_id)}
                emptyMessage="No BOMs found. Click 'Add BOM' to get started."
              />
            </CardContent>
          </Card>
        )}

        {activeTab === 'summary' && (
          <BOMSummary 
            boms={bomDefinitions} 
            bomLines={data.bom || []}
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
        onSave={async () => {
          await actions.fetchAllData();
          toast.success('BOM items updated successfully');
        }}
      />
    </div>
  );
};

export default BOMManagement;