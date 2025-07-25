import React, { useState, useEffect } from 'react';
import api from '../../lib/apiClient';
import { toast } from 'react-hot-toast';
import './DatabaseModals.css';

const DatabaseLoadModal = ({ isOpen, onClose, onLoad }) => {
  const [databases, setDatabases] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedDatabase, setSelectedDatabase] = useState(null);
  const [loadingDatabase, setLoadingDatabase] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchDatabases();
    }
  }, [isOpen]);

  const fetchDatabases = async () => {
    setLoading(true);
    try {
      const response = await api.get('/database/list', { suppressErrorToast: true });
      setDatabases(response.data.databases || []);
    } catch (error) {
      console.error('Error fetching databases:', error);
      toast.error('Failed to load database list');
    } finally {
      setLoading(false);
    }
  };

  const handleLoad = async () => {
    if (!selectedDatabase) {
      toast.error('Please select a database to load');
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to load "${selectedDatabase.name}"? This will replace the current database. A backup of the current database will be created automatically.`
    );

    if (!confirmed) return;

    setLoadingDatabase(true);
    try {
      await onLoad(selectedDatabase.filename);
      onClose();
    } catch (error) {
      console.error('Error loading database:', error);
      toast.error('Failed to load database');
    } finally {
      setLoadingDatabase(false);
    }
  };

  const handleDelete = async (database) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${database.name}"? This action cannot be undone.`
    );

    if (!confirmed) return;

    try {
      const response = await api.delete(`/database/delete/${database.filename}`);
      
      // API client handles success toast
      fetchDatabases(); // Refresh the list
      if (selectedDatabase?.filename === database.filename) {
        setSelectedDatabase(null);
      }
    } catch (error) {
      console.error('Error deleting database:', error);
      // Error toast is already handled by API client
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  if (!isOpen) return null;

  return (
    <div className="database-modal-overlay" onClick={onClose}>
      <div className="database-modal-content database-load-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Load Database</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>Loading saved databases...</p>
            </div>
          ) : databases.length === 0 ? (
            <div className="empty-state">
              <p>No saved databases found.</p>
              <small>Save a database first to see it here.</small>
            </div>
          ) : (
            <div className="database-list">
              <div className="list-header">
                <h3>Saved Databases ({databases.length})</h3>
                <button 
                  className="btn-refresh"
                  onClick={fetchDatabases}
                  disabled={loading}
                >
                  🔄 Refresh
                </button>
              </div>
              
              <div className="database-grid">
                {databases.map((database) => (
                  <div
                    key={database.filename}
                    className={`database-item ${selectedDatabase?.filename === database.filename ? 'selected' : ''}`}
                    onClick={() => setSelectedDatabase(database)}
                  >
                    <div className="database-info">
                      <h4>{database.name}</h4>
                      <div className="database-details">
                        <span className="detail">
                          <strong>Size:</strong> {formatFileSize(database.size)}
                        </span>
                        <span className="detail">
                          <strong>Created:</strong> {formatDate(database.created)}
                        </span>
                        <span className="detail">
                          <strong>Modified:</strong> {formatDate(database.modified)}
                        </span>
                      </div>
                    </div>
                    <div className="database-actions">
                      <button
                        className="btn-delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(database);
                        }}
                        title="Delete database"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button 
            className="btn-secondary" 
            onClick={onClose}
            disabled={loadingDatabase}
          >
            Cancel
          </button>
          <button 
            className="btn-primary" 
            onClick={handleLoad}
            disabled={loadingDatabase || !selectedDatabase}
          >
            {loadingDatabase ? 'Loading...' : 'Load Database'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DatabaseLoadModal;