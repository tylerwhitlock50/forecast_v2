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
  onClone,
  machines,
  units,
  laborRates
}) => {
  const allSelected = routers.length > 0 && selectedRouters.length === routers.length;
  const someSelected = selectedRouters.length > 0 && selectedRouters.length < routers.length;

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <span className="sort-icon">↕</span>;
    return <span className="sort-icon">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  const formatNumber = (value) => {
    if (value === null || value === undefined) return '-';
    return Number(value).toFixed(1);
  };

  const getMachineName = (machineId) => {
    const machine = machines.find(m => m.machine_id === machineId);
    return machine ? machine.machine_name : machineId;
  };

  const getUnitName = (unitId) => {
    const unit = units.find(u => u.unit_id === unitId);
    return unit ? unit.unit_name : unitId;
  };

  const getLaborRateName = (rateId) => {
    const rate = laborRates.find(r => r.rate_id === rateId);
    return rate ? rate.rate_name : rateId;
  };

  const columns = [
    { key: 'router_id', label: 'Router ID', sortable: true, width: '120px' },
    { key: 'version', label: 'Version', sortable: true, width: '80px' },
    { key: 'sequence', label: 'Seq', sortable: true, width: '60px' },
    { key: 'unit_id', label: 'Unit', sortable: true, width: '150px' },
    { key: 'machine_id', label: 'Machine', sortable: true, width: '150px' },
    { key: 'machine_minutes', label: 'Machine Min', sortable: true, width: '100px' },
    { key: 'labor_minutes', label: 'Labor Min', sortable: true, width: '100px' },
    { key: 'labor_type_id', label: 'Labor Rate', sortable: true, width: '150px' },
    { key: 'actions', label: 'Actions', sortable: false, width: '140px' }
  ];

  const getRouterKey = (router) => {
    return `${router.router_id}-${router.version}-${router.sequence}`;
  };

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
            routers.map(router => (
              <tr key={getRouterKey(router)} className="router-row">
                <td className="checkbox-cell">
                  <input
                    type="checkbox"
                    checked={selectedRouters.includes(getRouterKey(router))}
                    onChange={(e) => onSelect(getRouterKey(router), e.target.checked)}
                  />
                </td>
                <td className="router-id">
                  <span className="id-badge">{router.router_id}</span>
                </td>
                <td className="version">
                  <span className="version-badge">{router.version || '1.0'}</span>
                </td>
                <td className="sequence">
                  <span className="sequence-badge">{router.sequence}</span>
                </td>
                <td className="unit">
                  <div className="unit-cell">
                    <span className="unit-id">{router.unit_id}</span>
                    <span className="unit-name">{getUnitName(router.unit_id)}</span>
                  </div>
                </td>
                <td className="machine">
                  <div className="machine-cell">
                    <span className="machine-id">{router.machine_id}</span>
                    <span className="machine-name">{getMachineName(router.machine_id)}</span>
                  </div>
                </td>
                <td className="machine-minutes">
                  <span className="minutes-text">{formatNumber(router.machine_minutes)}</span>
                </td>
                <td className="labor-minutes">
                  <span className="minutes-text">{formatNumber(router.labor_minutes)}</span>
                </td>
                <td className="labor-rate">
                  <div className="labor-rate-cell">
                    <span className="rate-id">{router.labor_type_id}</span>
                    <span className="rate-name">{getLaborRateName(router.labor_type_id)}</span>
                  </div>
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
                      onClick={() => onClone(router.router_id)}
                      className="action-btn clone-btn"
                      title="Clone Router"
                    >
                      📋
                    </button>
                    <button
                      onClick={() => onDelete(getRouterKey(router))}
                      className="action-btn delete-btn"
                      title="Delete Router"
                    >
                      🗑️
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      
      {routers.length > 0 && (
        <div className="table-footer">
          <div className="table-info">
            <span>Showing {routers.length} of {routers.length} router operations</span>
            {selectedRouters.length > 0 && (
              <span className="selected-info">
                ({selectedRouters.length} selected)
              </span>
            )}
          </div>
          <div className="table-stats">
            <span>Total Machine Minutes: {routers.reduce((sum, r) => sum + (r.machine_minutes || 0), 0).toFixed(1)}</span>
            <span>Total Labor Minutes: {routers.reduce((sum, r) => sum + (r.labor_minutes || 0), 0).toFixed(1)}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default RouterTable;