import React, { useState } from 'react';
import { toast } from 'react-hot-toast';
import './DatabaseModals.css';

const DatabaseSaveModal = ({ isOpen, onClose, onSave }) => {
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!saveName.trim()) {
      toast.error('Please enter a name for the database save');
      return;
    }

    setSaving(true);
    try {
      await onSave(saveName.trim());
      setSaveName('');
      onClose();
    } catch (error) {
      console.error('Error saving database:', error);
      toast.error('Failed to save database');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSave();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="database-modal-overlay" onClick={onClose}>
      <div className="database-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Save Database</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="saveName">Database Name:</label>
            <input
              id="saveName"
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Enter a name for this database save"
              className="form-input"
              disabled={saving}
              autoFocus
            />
            <small className="form-help">
              This will create a copy of the current database with the specified name.
            </small>
          </div>
        </div>

        <div className="modal-footer">
          <button 
            className="btn-secondary" 
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button 
            className="btn-primary" 
            onClick={handleSave}
            disabled={saving || !saveName.trim()}
          >
            {saving ? 'Saving...' : 'Save Database'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DatabaseSaveModal;