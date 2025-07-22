import React from 'react';


const MachineTable = ({
  machines,
  selectedMachines,
  sortField,
  sortDirection,
  onSort,
  onSelect,
  onSelectAll,
  onEdit,
  onDelete
}) => {
  const allSelected = machines.length > 0 && selectedMachines.length === machines.length;
  const someSelected = selectedMachines.length > 0 && selectedMachines.length < machines.length;

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <span className="sort-icon">↕</span>;
    return <span className="sort-icon">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  const formatCurrency = (value) => {
    if (value === null || value === undefined) return '-';
    return `$${Number(value).toFixed(2)}`;
  };

  const formatNumber = (value) => {
    if (value === null || value === undefined) return '-';
    return Number(value).toLocaleString();
  };

  const columns = [
    { key: 'machine_id', label: 'Machine ID', sortable: true, width: '120px' },
    { key: 'machine_name', label: 'Machine Name', sortable: true, width: '200px' },
    { key: 'machine_description', label: 'Description', sortable: true, width: '250px' },
    { key: 'machine_rate', label: 'Rate ($/hr)', sortable: true, width: '120px' },
    { key: 'labor_type', label: 'Labor Type', sortable: true, width: '150px' },
    { key: 'available_minutes_per_month', label: 'Available (min/month)', sortable: true, width: '150px' },
    { key: 'actions', label: 'Actions', sortable: false, width: '120px' }
  ];

  return (
    <div className="machine-table-container">
      <table className="machine-table">
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
          {machines.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1} className="no-data">
                <div className="no-data-content">
                  <span>🏭</span>
                  <p>No machines found</p>
                  <small>Try adjusting your search or filters</small>
                </div>
              </td>
            </tr>
          ) : (
            machines.map(machine => (
              <tr key={machine.machine_id} className="machine-row">
                <td className="checkbox-cell">
                  <input
                    type="checkbox"
                    checked={selectedMachines.includes(machine.machine_id)}
                    onChange={(e) => onSelect(machine.machine_id, e.target.checked)}
                  />
                </td>
                <td className="machine-id">
                  <span className="id-badge">{machine.machine_id}</span>
                </td>
                <td className="machine-name">
                  <div className="name-cell">
                    <span className="name-text">{machine.machine_name}</span>
                    {machine.machine_name && (
                      <span className="name-tooltip">{machine.machine_name}</span>
                    )}
                  </div>
                </td>
                <td className="machine-description">
                  <span className="description-text">{machine.machine_description || 'N/A'}</span>
                </td>
                <td className="machine-rate">
                  <span className="rate-text">{formatCurrency(machine.machine_rate)}</span>
                </td>
                <td className="labor-type">
                  <span className={`type-badge ${machine.labor_type?.toLowerCase().replace(/\s+/g, '-') || 'general'}`}>
                    {machine.labor_type || 'General'}
                  </span>
                </td>
                <td className="available-minutes">
                  <span className="minutes-text">{formatNumber(machine.available_minutes_per_month)}</span>
                </td>
                <td className="actions-cell">
                  <div className="action-buttons">
                    <button
                      onClick={() => onEdit(machine)}
                      className="action-btn edit-btn"
                      title="Edit Machine"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => onDelete(machine.machine_id)}
                      className="action-btn delete-btn"
                      title="Delete Machine"
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
      
      {machines.length > 0 && (
        <div className="table-footer">
          <div className="table-info">
            <span>Showing {machines.length} of {machines.length} machines</span>
            {selectedMachines.length > 0 && (
              <span className="selected-info">
                ({selectedMachines.length} selected)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MachineTable;