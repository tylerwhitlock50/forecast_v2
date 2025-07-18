import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import LaborRateTable from './LaborRateTable';
import LaborRateModal from './LaborRateModal';
import LaborRateSummary from './LaborRateSummary';
import LaborRateValidation from './LaborRateValidation';
import './LaborRateManagement.css';

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
        // Update existing labor rate
        await actions.updateLaborRate(editingLaborRate.rate_id, laborRateData);
        toast.success('Labor rate updated successfully');
      } else {
        // Create new labor rate
        await actions.createLaborRate(laborRateData);
        toast.success('Labor rate created successfully');
      }
      
      setShowLaborRateModal(false);
      setEditingLaborRate(null);
      await actions.fetchAllData(); // Refresh data
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
        await actions.fetchAllData(); // Refresh data
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
      // Export selected labor rates to CSV
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

  // Handle sorting
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Handle labor rate selection
  const handleLaborRateSelect = (rateId, selected) => {
    if (selected) {
      setSelectedLaborRates(prev => [...prev, rateId]);
    } else {
      setSelectedLaborRates(prev => prev.filter(id => id !== rateId));
    }
  };

  // Handle select all
  const handleSelectAll = (selected) => {
    if (selected) {
      setSelectedLaborRates(filteredLaborRates.map(lr => lr.rate_id));
    } else {
      setSelectedLaborRates([]);
    }
  };

  if (loading) {
    return (
      <div className="labor-rate-management">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading labor rate data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="labor-rate-management">
      <div className="labor-rate-header">
        <h2>Labor Rate Management</h2>
        <div className="labor-rate-controls">
          <div className="search-controls">
            <input
              type="text"
              placeholder="Search labor rates..."
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
              {rateTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          
          <div className="action-controls">
            <button 
              onClick={() => {
                setEditingLaborRate(null);
                setShowLaborRateModal(true);
              }}
              className="btn-primary"
            >
              ➕ Add Labor Rate
            </button>
            
            {selectedLaborRates.length > 0 && (
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

      <div className="labor-rate-tabs">
        <button 
          className={`tab ${activeTab === 'table' ? 'active' : ''}`}
          onClick={() => setActiveTab('table')}
        >
          Labor Rate Table
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

      <div className="labor-rate-content">
        {activeTab === 'table' && (
          <LaborRateTable
            laborRates={filteredLaborRates}
            selectedLaborRates={selectedLaborRates}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
            onSelect={handleLaborRateSelect}
            onSelectAll={handleSelectAll}
            onEdit={(laborRate) => {
              setEditingLaborRate(laborRate);
              setShowLaborRateModal(true);
            }}
            onDelete={handleDeleteLaborRate}
          />
        )}

        {activeTab === 'summary' && (
          <LaborRateSummary laborRates={data.labor_rates || []} />
        )}

        {activeTab === 'validation' && (
          <LaborRateValidation laborRates={data.labor_rates || []} />
        )}
      </div>

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