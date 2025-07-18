import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import BomTable from './BomTable';
import BomModal from './BomModal';
import BomLinesModal from './BomLinesModal';
import BomSummary from './BomSummary';
import BomValidation from './BomValidation';
import './BillOfMaterialsManagement.css';

const BillOfMaterialsManagement = () => {
  const { data, actions, loading } = useForecast();
  const [activeTab, setActiveTab] = useState('table');
  const [showBomModal, setShowBomModal] = useState(false);
  const [showBomLinesModal, setShowBomLinesModal] = useState(false);
  const [editingBom, setEditingBom] = useState(null);
  const [selectedBom, setSelectedBom] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterVersion, setFilterVersion] = useState('all');
  const [sortField, setSortField] = useState('bom_id');
  const [sortDirection, setSortDirection] = useState('asc');
  const [selectedBoms, setSelectedBoms] = useState([]);
  const [bulkAction, setBulkAction] = useState('');

  // Get unique BOM definitions (grouped by bom_id and version)
  const bomDefinitions = useMemo(() => {
    const boms = Array.isArray(data.bom) ? data.bom : [];
    const definitions = {};
    
    boms.forEach(bom => {
      const key = `${bom.bom_id}|${bom.version || '1.0'}`;
      if (!definitions[key]) {
        definitions[key] = {
          bom_id: bom.bom_id,
          version: bom.version || '1.0',
          bom_name: bom.bom_name || bom.bom_id,
          bom_description: bom.bom_description || '',
          total_lines: 0,
          total_material_cost: 0,
          total_target_cost: 0
        };
      }
      definitions[key].total_lines++;
      definitions[key].total_material_cost += bom.material_cost || 0;
      definitions[key].total_target_cost += bom.target_cost || 0;
    });
    
    return Object.values(definitions);
  }, [data.bom]);

  // Get unique versions for filtering
  const versions = useMemo(() => {
    return [...new Set(bomDefinitions.map(b => b.version))];
  }, [bomDefinitions]);

  // Filter and sort BOM definitions
  const filteredBomDefinitions = useMemo(() => {
    let definitions = [...bomDefinitions];
    
    // Apply search filter
    if (searchTerm) {
      definitions = definitions.filter(bom => 
        bom.bom_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        bom.bom_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        bom.bom_description?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // Apply version filter
    if (filterVersion !== 'all') {
      definitions = definitions.filter(bom => bom.version === filterVersion);
    }
    
    // Apply sorting
    definitions.sort((a, b) => {
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
    
    return definitions;
  }, [bomDefinitions, searchTerm, filterVersion, sortField, sortDirection]);

  // Handle BOM definition creation/editing
  const handleSaveBom = async (bomData) => {
    try {
      if (editingBom) {
        // Update existing BOM definition
        await actions.updateBomDefinition(editingBom.bom_id, editingBom.version, bomData);
        toast.success('BOM definition updated successfully');
      } else {
        // Create new BOM definition - generate BOM ID if not provided
        if (!bomData.bom_id) {
          const maxId = Math.max(...bomDefinitions.map(b => {
            const id = b.bom_id?.replace('BOM-', '') || '0';
            return parseInt(id) || 0;
          }), 0);
          bomData.bom_id = `BOM-${String(maxId + 1).padStart(3, '0')}`;
        }
        
        await actions.createBomDefinition(bomData);
        toast.success('BOM definition created successfully');
      }
      
      setShowBomModal(false);
      setEditingBom(null);
      await actions.fetchAllData(); // Refresh data
    } catch (error) {
      console.error('Error saving BOM definition:', error);
      toast.error('Failed to save BOM definition');
    }
  };

  // Handle BOM definition deletion
  const handleDeleteBom = async (bomId, version) => {
    if (window.confirm('Are you sure you want to delete this BOM definition? This will also delete all associated BOM lines. This action cannot be undone.')) {
      try {
        await actions.deleteBomDefinition(bomId, version);
      } catch (error) {
        console.error('Error deleting BOM definition:', error);
        // Error handling is already done in the deleteBomDefinition function
      }
    }
  };

  // Handle BOM lines management
  const handleManageBomLines = (bom) => {
    setSelectedBom(bom);
    setShowBomLinesModal(true);
  };

  // Handle bulk operations
  const handleBulkOperation = async () => {
    if (selectedBoms.length === 0) {
      toast.error('Please select BOMs for bulk operation');
      return;
    }

    if (bulkAction === 'delete') {
      if (window.confirm(`Are you sure you want to delete ${selectedBoms.length} BOM definitions? This action cannot be undone.`)) {
        try {
          for (const bomKey of selectedBoms) {
            const [bomId, version] = bomKey.split('|');
            await actions.deleteBomDefinition(bomId, version);
          }
          setSelectedBoms([]);
        } catch (error) {
          console.error('Error in bulk delete:', error);
          // Error handling is already done in the deleteBomDefinition function
        }
      }
    } else if (bulkAction === 'export') {
      // Export selected BOMs to CSV
      const csvData = selectedBoms.map(bomKey => {
        const [bomId, version] = bomKey.split('|');
        const bom = bomDefinitions.find(b => b.bom_id === bomId && b.version === version);
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
        a.download = `bom-definitions-export-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`Exported ${csvData.length} BOM definitions`);
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

  // Handle BOM selection
  const handleBomSelect = (bomKey, selected) => {
    if (selected) {
      setSelectedBoms(prev => [...prev, bomKey]);
    } else {
      setSelectedBoms(prev => prev.filter(key => key !== bomKey));
    }
  };

  // Handle select all
  const handleSelectAll = (selected) => {
    if (selected) {
      setSelectedBoms(filteredBomDefinitions.map(b => `${b.bom_id}|${b.version}`));
    } else {
      setSelectedBoms([]);
    }
  };

  if (loading) {
    return (
      <div className="bom-management">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading BOM data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bom-management">
      <div className="bom-header">
        <h2>Bill of Materials Management</h2>
        <div className="bom-controls">
          <div className="search-controls">
            <input
              type="text"
              placeholder="Search BOMs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <select
              value={filterVersion}
              onChange={(e) => setFilterVersion(e.target.value)}
              className="version-filter"
            >
              <option value="all">All Versions</option>
              {versions.map(version => (
                <option key={version} value={version}>{version}</option>
              ))}
            </select>
          </div>
          
          <div className="action-controls">
            <button 
              onClick={() => {
                setEditingBom(null);
                setShowBomModal(true);
              }}
              className="btn-primary"
            >
              ➕ Add BOM Definition
            </button>
            
            {selectedBoms.length > 0 && (
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

      <div className="bom-tabs">
        <button 
          className={`tab ${activeTab === 'table' ? 'active' : ''}`}
          onClick={() => setActiveTab('table')}
        >
          BOM Definitions
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

      <div className="bom-content">
        {activeTab === 'table' && (
          <BomTable
            bomDefinitions={filteredBomDefinitions}
            selectedBoms={selectedBoms}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
            onSelect={handleBomSelect}
            onSelectAll={handleSelectAll}
            onEdit={(bom) => {
              setEditingBom(bom);
              setShowBomModal(true);
            }}
            onDelete={handleDeleteBom}
            onManageBomLines={handleManageBomLines}
            bomLines={data.bom || []}
          />
        )}

        {activeTab === 'summary' && (
          <BomSummary 
            bomDefinitions={bomDefinitions}
            bomLines={data.bom || []}
            units={data.units || []}
          />
        )}

        {activeTab === 'validation' && (
          <BomValidation 
            bomDefinitions={bomDefinitions}
            bomLines={data.bom || []}
            units={data.units || []}
          />
        )}
      </div>

      <BomModal
        isOpen={showBomModal}
        onClose={() => {
          setShowBomModal(false);
          setEditingBom(null);
        }}
        onSave={handleSaveBom}
        bom={editingBom}
      />

      <BomLinesModal
        isOpen={showBomLinesModal}
        onClose={() => {
          setShowBomLinesModal(false);
          setSelectedBom(null);
        }}
        bom={selectedBom}
        bomLines={data.bom || []}
        units={data.units || []}
        onSave={async () => {
          await actions.fetchAllData();
          toast.success('BOM lines updated successfully');
        }}
      />
    </div>
  );
};

export default BillOfMaterialsManagement; 