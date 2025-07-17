import React from 'react';
import './RouterManagement.css';

const RouterTable = ({
  routers,
  selectedRouters,
  sortField,
  sortDirection,
  onSort,
  onSelect,
  onSelectAll,
  onEdit,
  onDelete,
  onManageOperations,
  routerOperations
}) => {
  const allSelected = routers.length > 0 && selectedRouters.length === routers.length;
  const someSelected = selectedRouters.length > 0 && selectedRouters.length < routers.length;

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <span className="sort-icon">↕</span>;
    return <span className="sort-icon">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  const formatNumber = (value) => {
    if (value === null || value === undefined) return '-';
    return Number(value).toLocaleString();
  };

  const getOperationCount = (routerId) => {
    return routerOperations.filter(op => op.router_id === routerId).length;
  };

  const getTotalMachineTime = (routerId) => {
    return routerOperations
      .filter(op => op.router_id === routerId)
      .reduce((sum, op) => sum + (op.machine_minutes || 0), 0);
  };

  const getTotalLaborTime = (routerId) => {
    return routerOperations
      .filter(op => op.router_id === routerId)
      .reduce((sum, op) => sum + (op.labor_minutes || 0), 0);
  };

  const columns = [
    { key: 'router_id', label: 'Router ID', sortable: true, width: '120px' },
    { key: 'router_name', label: 'Router Name', sortable: true, width: '200px' },
    { key: 'router_description', label: 'Description', sortable: true, width: '250px' },
    { key: 'version', label: 'Version', sortable: true, width: '100px' },
    { key: 'operations', label: 'Operations', sortable: false, width: '120px' },
    { key: 'total_time', label: 'Total Time (min)', sortable: false, width: '150px' },
    { key: 'actions', label: 'Actions', sortable: false, width: '200px' }
  ];

  return (
    <div className="router-table-container">
      <table className="router-table">
        <thead>
          <tr>
            <th className="checkbox-cell">
              <input
                type="checkbox"
                checked={allSelected}
                ref={input => {
                  if (input) input.indeterminate = someSelected;
                }}
                onChange={(e) => onSelectAll(e.target.checked)}
              />
            </th>
            {columns.map(column => (
              <th
                key={column.key}
                style={{ width: column.width }}
                className={column.sortable ? 'sortable' : ''}
                onClick={() => column.sortable && onSort(column.key)}
              >
                <div className="header-content">
                  <span>{column.label}</span>
                  {column.sortable && <SortIcon field={column.key} />}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {routers.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1} className="no-data">
                <div className="no-data-content">
                  <span>🔄</span>
                  <p>No routers found</p>
                  <small>Try adjusting your search or filters</small>
                </div>
              </td>
            </tr>
          ) : (
            routers.map(router => {
              const operationCount = getOperationCount(router.router_id);
              const totalMachineTime = getTotalMachineTime(router.router_id);
              const totalLaborTime = getTotalLaborTime(router.router_id);
              const totalTime = totalMachineTime + totalLaborTime;

              return (
                <tr key={router.router_id} className="router-row">
                  <td className="checkbox-cell">
                    <input
                      type="checkbox"
                      checked={selectedRouters.includes(router.router_id)}
                      onChange={(e) => onSelect(router.router_id, e.target.checked)}
                    />
                  </td>
                  <td className="router-id">
                    <span className="id-badge">{router.router_id}</span>
                  </td>
                  <td className="router-name">
                    <div className="name-cell">
                      <span className="name-text">{router.router_name}</span>
                      {router.router_name && (
                        <span className="name-tooltip">{router.router_name}</span>
                      )}
                    </div>
                  </td>
                  <td className="router-description">
                    <span className="description-text">{router.router_description || 'N/A'}</span>
                  </td>
                  <td className="version">
                    <span className="version-badge">{router.version || '1.0'}</span>
                  </td>
                  <td className="operations">
                    <span className="minutes-text">{operationCount}</span>
                  </td>
                  <td className="total-time">
                    <span className="minutes-text">{formatNumber(totalTime)}</span>
                  </td>
                  <td className="actions-cell">
                    <div className="action-buttons">
                      <button
                        onClick={() => onEdit(router)}
                        className="action-btn edit-btn"
                        title="Edit Router"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => onManageOperations(router)}
                        className="action-btn clone-btn"
                        title="Manage Operations"
                      >
                        ⚙️
                      </button>
                      <button
                        onClick={() => onDelete(router.router_id)}
                        className="action-btn delete-btn"
                        title="Delete Router"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      
      {routers.length > 0 && (
        <div className="table-footer">
          <div className="table-info">
            <span>Showing {routers.length} of {routers.length} routers</span>
            {selectedRouters.length > 0 && (
              <span className="selected-info">
                ({selectedRouters.length} selected)
              </span>
            )}
          </div>
          <div className="table-stats">
            <span>Total Operations: {routerOperations.length}</span>
            <span>Total Machine Minutes: {routerOperations.reduce((sum, op) => sum + (op.machine_minutes || 0), 0).toFixed(1)}</span>
            <span>Total Labor Minutes: {routerOperations.reduce((sum, op) => sum + (op.labor_minutes || 0), 0).toFixed(1)}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default RouterTable;