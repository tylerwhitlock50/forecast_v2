import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import BOMTable from './BOMTable';
import BOMModal from './BOMModal';
import BOMItemsModal from './BOMItemsModal';
import BOMSummary from './BOMSummary';
import BOMValidation from './BOMValidation';
import './BOMManagement.css';

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

  // Get unique versions for filtering from BOM data
  const versions = useMemo(() => {
    const boms = Array.isArray(data.bom) ? data.bom : [];
    return [...new Set(boms.map(b => b.version || '1.0'))];
  }, [data.bom]);

  // Transform BOM data to definitions format
  const bomDefinitions = useMemo(() => {
    const boms = Array.isArray(data.bom) ? data.bom : [];
    console.log('Raw BOM data for transformation:', boms);
    
    const groupedBOMs = boms.reduce((acc, bomItem) => {
      const key = `${bomItem.bom_id}-${bomItem.version || '1.0'}`;
      if (!acc[key]) {
        // Try to get the BOM name from the header entry (bom_line = 1)
        const headerEntry = boms.find(item => 
          item.bom_id === bomItem.bom_id && 
          item.version === bomItem.version && 
          item.bom_line === 1
        );
        
        const bomName = headerEntry && headerEntry.material_description && 
                       headerEntry.material_description !== 'BOM Header' 
                       ? headerEntry.material_description 
                       : `BOM ${bomItem.bom_id}`;
        
        console.log(`Creating BOM definition for ${key}:`, { 
          bom_id: bomItem.bom_id, 
          bom_name: bomName, 
          headerEntry: headerEntry?.material_description 
        });
        
        acc[key] = {
          bom_id: bomItem.bom_id,
          bom_name: bomName,
          bom_description: `Bill of Materials for ${bomItem.bom_id}`,
          version: bomItem.version || '1.0',
          created_at: bomItem.created_at,
          total_cost: 0,
          line_count: 0
        };
      }
      acc[key].total_cost += bomItem.material_cost || 0;
      acc[key].line_count += 1;
      return acc;
    }, {});
    
    const result = Object.values(groupedBOMs);
    console.log('Final BOM definitions:', result);
    return result;
  }, [data.bom]);

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
        console.log('Updating BOM:', editingBOM, 'with data:', bomData);
        
        // Update existing BOM definition - find the header entry and update it
        const bomItems = Array.isArray(data.bom) ? data.bom : [];
        const headerEntry = bomItems.find(item => 
          item.bom_id === editingBOM.bom_id && 
          (item.version || '1.0') === (editingBOM.version || '1.0') && 
          item.bom_line === 1
        );
        
        console.log('Found header entry:', headerEntry);
        
        if (headerEntry) {
          // Update the header entry with the new BOM name
          const updateData = {
            material_description: bomData.bom_name || `BOM ${editingBOM.bom_id}`
          };
          console.log('Updating with data:', updateData);
          
          const recordId = `${headerEntry.bom_id}-${headerEntry.version || '1.0'}-${headerEntry.bom_line}`;
          console.log('Record ID for update:', recordId);
          
          await actions.updateBOM(recordId, updateData);
          toast.success('BOM updated successfully');
        } else {
          console.error('Header entry not found for BOM:', editingBOM);
          toast.error('Could not find BOM header entry to update');
          return;
        }
      } else {
        // Create new BOM definition - generate BOM ID if not provided
        if (!bomData.bom_id) {
          const boms = bomDefinitions;
          const maxId = Math.max(...boms.map(b => {
            const id = b.bom_id?.replace('BOM-', '') || '0';
            return parseInt(id) || 0;
          }), 0);
          bomData.bom_id = `BOM-${String(maxId + 1).padStart(3, '0')}`;
        }
        
        // Create a BOM entry with the actual name and description from the form
        const bomEntry = {
          bom_id: bomData.bom_id,
          version: bomData.version || '1.0',
          bom_line: 1,
          material_description: bomData.bom_name || 'BOM Header', // Use the actual BOM name
          qty: 1, // Set to 1 for the header entry
          unit: 'each',
          unit_price: 0,
          material_cost: 0,
          target_cost: 0
        };
        
        await actions.createBOM(bomEntry);
        toast.success('BOM created successfully');
      }
      
      setShowBOMModal(false);
      setEditingBOM(null);
      await actions.fetchAllData(); // Refresh data
    } catch (error) {
      console.error('Error saving BOM:', error);
      toast.error('Failed to save BOM');
    }
  };

  // Handle BOM deletion
  const handleDeleteBOM = async (bomId) => {
    if (window.confirm('Are you sure you want to delete this BOM? This will also delete all associated items. This action cannot be undone.')) {
      try {
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
        delete clonedItem.created_at; // Let the backend set this
        
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
      // Export selected BOMs to CSV
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
      // Clone selected BOMs
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
  const handleBOMSelect = (bomId, selected) => {
    if (selected) {
      setSelectedBOMs(prev => [...prev, bomId]);
    } else {
      setSelectedBOMs(prev => prev.filter(id => id !== bomId));
    }
  };

  // Handle select all
  const handleSelectAll = (selected) => {
    if (selected) {
      setSelectedBOMs(filteredBOMs.map(b => b.bom_id));
    } else {
      setSelectedBOMs([]);
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
        <h2>BOM Management</h2>
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
                setEditingBOM(null);
                setShowBOMModal(true);
              }}
              className="btn-primary"
            >
              ➕ Add BOM
            </button>
            
            {selectedBOMs.length > 0 && (
              <div className="bulk-actions">
                <select
                  value={bulkAction}
                  onChange={(e) => setBulkAction(e.target.value)}
                  className="bulk-action-select"
                >
                  <option value="">Bulk Actions</option>
                  <option value="export">Export Selected</option>
                  <option value="clone">Clone Selected</option>
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
          BOM Table
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
          <BOMTable
            boms={filteredBOMs}
            selectedBOMs={selectedBOMs}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
            onSelect={handleBOMSelect}
            onSelectAll={handleSelectAll}
            onEdit={(bom) => {
              setEditingBOM(bom);
              setShowBOMModal(true);
            }}
            onDelete={handleDeleteBOM}
            onManageItems={handleManageItems}
            onClone={handleCloneBOM}
            bomItems={data.bom || []}
          />
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
            bomItems={data.bom || []}
            units={data.units || []}
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
        items={data.bom || []}
        onSave={async () => {
          await actions.fetchAllData();
          toast.success('BOM items updated successfully');
        }}
      />
    </div>
  );
};

export default BOMManagement;