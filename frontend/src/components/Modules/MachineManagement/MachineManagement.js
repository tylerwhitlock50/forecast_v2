import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import MachineTable from './MachineTable';
import MachineModal from './MachineModal';
import MachineSummary from './MachineSummary';
import MachineValidation from './MachineValidation';
import './MachineManagement.css';

const MachineManagement = () => {
  const { data, actions, loading } = useForecast();
  const [activeTab, setActiveTab] = useState('table');
  const [showMachineModal, setShowMachineModal] = useState(false);
  const [editingMachine, setEditingMachine] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [sortField, setSortField] = useState('machine_name');
  const [sortDirection, setSortDirection] = useState('asc');
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
      if (editingMachine) {
        // Update existing machine
        await actions.updateMachine(editingMachine.machine_id, machineData);
        toast.success('Machine updated successfully');
      } else {
        // Create new machine - generate machine ID if not provided
        if (!machineData.machine_id) {
          const machines = Array.isArray(data.machines) ? data.machines : [];
          const maxId = Math.max(...machines.map(m => {
            const id = m.machine_id?.replace('WC', '') || '0';
            return parseInt(id) || 0;
          }), 0);
          machineData.machine_id = `WC${String(maxId + 1).padStart(4, '0')}`;
        }
        
        await actions.createMachine(machineData);
        toast.success('Machine created successfully');
      }
      
      setShowMachineModal(false);
      setEditingMachine(null);
      await actions.fetchAllData(); // Refresh data
    } catch (error) {
      console.error('Error saving machine:', error);
      toast.error('Failed to save machine');
    }
  };

  // Handle machine deletion
  const handleDeleteMachine = async (machineId) => {
    if (window.confirm('Are you sure you want to delete this machine? This action cannot be undone.')) {
      try {
        await actions.deleteMachine(machineId);
      } catch (error) {
        console.error('Error deleting machine:', error);
        // Error handling is already done in the deleteMachine function
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
      if (window.confirm(`Are you sure you want to delete ${selectedMachines.length} machines? This action cannot be undone.`)) {
        try {
          for (const machineId of selectedMachines) {
            await actions.deleteMachine(machineId);
          }
          setSelectedMachines([]);
        } catch (error) {
          console.error('Error in bulk delete:', error);
          // Error handling is already done in the deleteMachine function
        }
      }
    } else if (bulkAction === 'export') {
      // Export selected machines to CSV
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

  // Handle sorting
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Handle machine selection
  const handleMachineSelect = (machineId, selected) => {
    if (selected) {
      setSelectedMachines(prev => [...prev, machineId]);
    } else {
      setSelectedMachines(prev => prev.filter(id => id !== machineId));
    }
  };

  // Handle select all
  const handleSelectAll = (selected) => {
    if (selected) {
      setSelectedMachines(filteredMachines.map(m => m.machine_id));
    } else {
      setSelectedMachines([]);
    }
  };

  if (loading) {
    return (
      <div className="machine-management">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading machine data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="machine-management">
      <div className="machine-header">
        <h2>Machine Management</h2>
        <div className="machine-controls">
          <div className="search-controls">
            <input
              type="text"
              placeholder="Search machines..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="type-filter"
            >
              <option value="all">All Types</option>
              {machineTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          
          <div className="action-controls">
            <button 
              onClick={() => {
                setEditingMachine(null);
                setShowMachineModal(true);
              }}
              className="btn-primary"
            >
              ➕ Add Machine
            </button>
            
            {selectedMachines.length > 0 && (
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

      <div className="machine-tabs">
        <button 
          className={`tab ${activeTab === 'table' ? 'active' : ''}`}
          onClick={() => setActiveTab('table')}
        >
          Machine Table
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

      <div className="machine-content">
        {activeTab === 'table' && (
          <MachineTable
            machines={filteredMachines}
            selectedMachines={selectedMachines}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
            onSelect={handleMachineSelect}
            onSelectAll={handleSelectAll}
            onEdit={(machine) => {
              setEditingMachine(machine);
              setShowMachineModal(true);
            }}
            onDelete={handleDeleteMachine}
          />
        )}

        {activeTab === 'summary' && (
          <MachineSummary machines={data.machines || []} />
        )}

        {activeTab === 'validation' && (
          <MachineValidation machines={data.machines || []} />
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