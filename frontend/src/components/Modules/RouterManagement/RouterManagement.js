import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import RouterTable from './RouterTable';
import RouterModal from './RouterModal';
import RouterOperationsModal from './RouterOperationsModal';
import RouterSummary from './RouterSummary';
import RouterValidation from './RouterValidation';
import './RouterManagement.css';

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
        // Update existing router
        await actions.updateRouter(editingRouter.router_id, routerData);
        toast.success('Router updated successfully');
      } else {
        // Create new router - generate router ID if not provided
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
      await actions.fetchAllData(); // Refresh data
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
        // Error handling is already done in the deleteRouter function
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
          // Error handling is already done in the deleteRouter function
        }
      }
    } else if (bulkAction === 'export') {
      // Export selected routers to CSV
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

  if (loading) {
    return (
      <div className="router-management">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading router data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="router-management">
      <div className="router-header">
        <h2>Router Management</h2>
        <div className="router-controls">
          <div className="search-controls">
            <input
              type="text"
              placeholder="Search routers..."
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
                setEditingRouter(null);
                setShowRouterModal(true);
              }}
              className="btn-primary"
            >
              ➕ Add Router
            </button>
            
            {selectedRouters.length > 0 && (
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

      <div className="router-tabs">
        <button 
          className={`tab ${activeTab === 'table' ? 'active' : ''}`}
          onClick={() => setActiveTab('table')}
        >
          Router Table
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

      <div className="router-content">
        {activeTab === 'table' && (
          <RouterTable
            routers={filteredRouters}
            selectedRouters={selectedRouters}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
            onSelect={handleRouterSelect}
            onSelectAll={handleSelectAll}
            onEdit={(router) => {
              setEditingRouter(router);
              setShowRouterModal(true);
            }}
            onDelete={handleDeleteRouter}
            onManageOperations={handleManageOperations}
            routerOperations={data.router_operations || []}
          />
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