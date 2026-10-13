import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../lib/apiClient';
import { toast } from 'react-hot-toast';
import { useConfirm } from '../Common/ConfirmDialog';
import { backupFilenameFrom, describeSnapshot, groupSnapshots, snapshotTime } from './snapshotList';
import './DatabaseModals.css';

const formatFileSize = (bytes) => {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return null;
  const k = 1024;
  const sizes = ['bytes', 'KB', 'MB', 'GB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(n) / Math.log(k)));
  return `${parseFloat((n / Math.pow(k, i)).toFixed(i ? 1 : 0))} ${sizes[i]}`;
};

const formatTime = (ms) => (ms === null ? null : new Date(ms).toLocaleString('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
}));

// The copy taken at an approval is that approval's evidence: the server refuses to delete it (409), so the
// dialog offers no Delete for it and says why. Loading one restores a copy, so it can still be inspected.
const EVIDENCE_GROUP = 'approvals';
const EVIDENCE_NOTE = "Each copy is the evidence of a scenario's approval, so it cannot be deleted. "
  + 'Load one to look inside it: a copy is restored and your current data is saved first.';

/**
 * Load a saved snapshot, delete one, or start clean. Snapshots are grouped by
 * why they exist (your saves, autosaves, safety copies the app made before a
 * Start clean or a load), newest first, and each one says what is in it.
 * The copies taken when a scenario was approved are that approval's evidence:
 * they can be loaded but not deleted, and their group says why.
 * After Start clean the dialog stays open with the safety copy it just made
 * selected, so getting the data back is one click.
 */
const DatabaseLoadModal = ({ isOpen, onClose, onLoad, onAfterReset }) => {
  const confirm = useConfirm();
  const [databases, setDatabases] = useState([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState(null);
  const [selectedDatabase, setSelectedDatabase] = useState(null);
  const [loadingDatabase, setLoadingDatabase] = useState(false);
  // The safety copy the last Start clean made (file name), while the dialog stays open.
  const [restorePoint, setRestorePoint] = useState(null);
  const listRef = useRef(null);

  const fetchDatabases = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const response = await api.get('/database/list', { suppressErrorToast: true });
      const list = Array.isArray(response?.data?.databases) ? response.data.databases : [];
      setDatabases(list);
      // Keep the selection only while that file still exists.
      setSelectedDatabase((current) => (current ? list.find((d) => d.filename === current.filename) || null : null));
      return list;
    } catch (error) {
      console.error('Error fetching databases:', error);
      setListError(error?.userMessage || 'Could not load the list of saved databases');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) fetchDatabases();
    else setRestorePoint(null);
  }, [isOpen, fetchDatabases]);

  const groups = useMemo(() => groupSnapshots(databases), [databases]);
  const restoreItem = restorePoint ? databases.find((d) => d.filename === restorePoint) || null : null;

  // Bring the start-clean safety copy into view once the list shows it.
  useEffect(() => {
    if (!isOpen || !restoreItem || !listRef.current) return;
    const node = listRef.current.querySelector('[data-restore-point="true"]');
    if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' });
  }, [isOpen, restoreItem]);

  const handleLoad = async () => {
    if (!selectedDatabase) {
      toast.error('Please select a database to load');
      return;
    }

    const confirmed = await confirm({
      title: `Load "${selectedDatabase.name}"?`,
      body: 'This replaces all current data with this snapshot. A safety copy of the current data is saved first '
        + '(unless the database is empty) and listed under "Safety copies made before loading".',
      confirmLabel: 'Load',
    });

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

  // Start from an empty model (e.g. after rehearsing with the sample files).
  // The server snapshots the current database first, so it can be loaded back.
  const handleStartClean = async () => {
    const confirmed = await confirm({
      title: 'Start with an empty database?',
      body: 'Every scenario, sale, customer, product, BOM, routing, price and rule is deleted. '
        + 'A snapshot of the current data is saved first, so you can load it back from this list.',
      confirmLabel: 'Delete all data',
      variant: 'destructive',
    });
    if (!confirmed) return;
    setLoadingDatabase(true);
    try {
      const response = await api.post('/database/start-clean', { confirm: true, snapshot_first: true }, { suppressErrorToast: true, suppressSuccessToast: true });
      const backup = backupFilenameFrom(response);
      toast.success(backup ? `Database cleared. Previous data saved as ${backup}` : 'Database cleared');
      const list = await fetchDatabases();
      const copy = backup ? list.find((d) => d.filename === backup) || null : null;
      setRestorePoint(copy ? copy.filename : null);
      setSelectedDatabase(copy);
      if (onAfterReset) await onAfterReset();
    } catch (error) {
      const detail = error?.response?.data?.detail;
      toast.error(`Could not clear the database${typeof detail === 'string' ? `: ${detail}` : ''}`);
    } finally {
      setLoadingDatabase(false);
    }
  };

  const handleDelete = async (database) => {
    const confirmed = await confirm({
      title: `Delete "${database.name}"?`,
      body: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    });

    if (!confirmed) return;

    try {
      await api.delete(`/database/delete/${encodeURIComponent(database.filename)}`);
      // API client handles the success toast.
      if (selectedDatabase?.filename === database.filename) setSelectedDatabase(null);
      if (restorePoint === database.filename) setRestorePoint(null);
      fetchDatabases();
    } catch (error) {
      console.error('Error deleting database:', error);
      // Error toast is already handled by API client
    }
  };

  if (!isOpen) return null;

  const renderItem = (database, groupKey) => {
    const selected = selectedDatabase?.filename === database.filename;
    const isRestorePoint = restorePoint === database.filename;
    const time = formatTime(snapshotTime(database));
    const size = formatFileSize(database.size);
    const contents = describeSnapshot(database);
    // Named saves lead with their name; the copies the app makes lead with their time.
    const title = groupKey === 'saves' ? database.name : (time || database.name);
    const meta = [groupKey === 'saves' ? time : null, database.filename, size].filter(Boolean);
    return (
      <li
        key={database.filename}
        className={`database-item${selected ? ' selected' : ''}${isRestorePoint ? ' restore-point' : ''}`}
        data-restore-point={isRestorePoint ? 'true' : undefined}
        data-testid="database-item"
      >
        <label className="database-item-select">
          <input
            type="radio"
            name="database-to-load"
            className="database-item-radio"
            value={database.filename}
            checked={selected}
            onChange={() => setSelectedDatabase(database)}
            disabled={loadingDatabase}
          />
          <span className="database-info">
            <span className="database-title">{title}</span>
            {contents && (
              <span className={`database-contents${contents.empty ? ' is-empty' : ''}`} data-testid="database-contents">{contents.text}</span>
            )}
            <span className="database-meta">{meta.join(' · ')}</span>
            {isRestorePoint && (
              <span className="restore-hint">Load this to get your previous data back</span>
            )}
          </span>
        </label>
        {groupKey === EVIDENCE_GROUP ? (
          <span className="evidence-badge" title={EVIDENCE_NOTE} data-testid="approval-evidence">
            Approval evidence
          </span>
        ) : (
          <button
            type="button"
            className="btn-delete"
            onClick={() => handleDelete(database)}
            title={`Delete ${database.filename}`}
            aria-label={`Delete ${database.filename}`}
            disabled={loadingDatabase}
          >
            Delete
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="database-modal-overlay" onClick={onClose}>
      <div
        className="database-modal-content database-load-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="database-load-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="database-load-title">Load Database</h2>
          <button type="button" className="close-button" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="modal-body">
          <div className="list-header">
            <h3>Saved databases{databases.length ? ` (${databases.length})` : ''}</h3>
            <button
              type="button"
              className="btn-refresh"
              onClick={fetchDatabases}
              disabled={loading}
            >
              Refresh
            </button>
          </div>

          {restoreItem && (
            <div className="restore-banner" role="status">
              All data was deleted. The safety copy made just before is selected below: load it to get your previous data back.
            </div>
          )}

          <div className="database-scroll" ref={listRef} data-testid="database-scroll">
            {loading && databases.length === 0 ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <p>Loading saved databases...</p>
              </div>
            ) : listError ? (
              <div className="empty-state" role="alert">
                <p>{listError}</p>
                <small>Check that the backend is running, then press Refresh.</small>
              </div>
            ) : databases.length === 0 ? (
              <div className="empty-state">
                <p>No saved databases found.</p>
                <small>Save a database first to see it here.</small>
              </div>
            ) : (
              groups.map((group) => (
                <section key={group.key} className="database-group" data-group={group.key}>
                  <div className="database-group-header">
                    <h4 id={`database-group-${group.key}`}>
                      {group.title} <span className="database-group-count">({group.items.length})</span>
                    </h4>
                    <span className="database-group-help">{group.help}</span>
                    {group.key === EVIDENCE_GROUP && (
                      <span className="database-group-help evidence-note">{EVIDENCE_NOTE}</span>
                    )}
                  </div>
                  <ul className="database-grid" aria-labelledby={`database-group-${group.key}`}>
                    {group.items.map((database) => renderItem(database, group.key))}
                  </ul>
                </section>
              ))
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn-danger-outline"
            onClick={handleStartClean}
            disabled={loadingDatabase}
            title="Delete all data and start with an empty model (a snapshot is saved first)"
          >
            Start clean…
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={loadingDatabase}
          >
            Cancel
          </button>
          <button
            type="button"
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
