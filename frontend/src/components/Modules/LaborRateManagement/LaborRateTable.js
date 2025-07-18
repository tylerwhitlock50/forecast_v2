import React from 'react';
import './LaborRateManagement.css';

const LaborRateTable = ({
  laborRates,
  selectedLaborRates,
  sortField,
  sortDirection,
  onSort,
  onSelect,
  onSelectAll,
  onEdit,
  onDelete
}) => {
  const allSelected = laborRates.length > 0 && selectedLaborRates.length === laborRates.length;
  const someSelected = selectedLaborRates.length > 0 && selectedLaborRates.length < laborRates.length;

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <span className="sort-icon">↕</span>;
    return <span className="sort-icon">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount || 0);
  };

  const columns = [
    { key: 'rate_id', label: 'Rate ID', sortable: true, width: '120px' },
    { key: 'rate_name', label: 'Rate Name', sortable: true, width: '200px' },
    { key: 'rate_type', label: 'Type', sortable: true, width: '120px' },
    { key: 'rate_amount', label: 'Hourly Rate', sortable: true, width: '120px' },
    { key: 'rate_description', label: 'Description', sortable: true, width: '250px' },
    { key: 'actions', label: 'Actions', sortable: false, width: '120px' }
  ];

  return (
    <div className="labor-rate-table-container">
      <table className="labor-rate-table">
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
          {laborRates.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1} className="no-data">
                <div className="no-data-content">
                  <span>⚙️</span>
                  <p>No labor rates found</p>
                  <small>Try adjusting your search or filters</small>
                </div>
              </td>
            </tr>
          ) : (
            laborRates.map(laborRate => (
              <tr key={laborRate.rate_id} className="labor-rate-row">
                <td className="checkbox-cell">
                  <input
                    type="checkbox"
                    checked={selectedLaborRates.includes(laborRate.rate_id)}
                    onChange={(e) => onSelect(laborRate.rate_id, e.target.checked)}
                  />
                </td>
                <td className="rate-id">
                  <span className="id-badge">{laborRate.rate_id}</span>
                </td>
                <td className="rate-name">
                  <div className="name-cell">
                    <span className="name-text">{laborRate.rate_name}</span>
                    {laborRate.rate_name && (
                      <span className="name-tooltip">{laborRate.rate_name}</span>
                    )}
                  </div>
                </td>
                <td className="rate-type">
                  <span className={`type-badge ${laborRate.rate_type?.toLowerCase().replace(/\s+/g, '-') || 'general'}`}>
                    {laborRate.rate_type || 'General'}
                  </span>
                </td>
                <td className="rate-amount">
                  <span className="amount-text">{formatCurrency(laborRate.rate_amount)}</span>
                </td>
                <td className="rate-description">
                  <span className="description-text" title={laborRate.rate_description}>
                    {laborRate.rate_description || 'No description'}
                  </span>
                </td>
                <td className="actions-cell">
                  <div className="action-buttons">
                    <button
                      onClick={() => onEdit(laborRate)}
                      className="action-btn edit-btn"
                      title="Edit Labor Rate"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => onDelete(laborRate.rate_id)}
                      className="action-btn delete-btn"
                      title="Delete Labor Rate"
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
      
      {laborRates.length > 0 && (
        <div className="table-footer">
          <div className="table-info">
            <span>Showing {laborRates.length} of {laborRates.length} labor rates</span>
            {selectedLaborRates.length > 0 && (
              <span className="selected-info">
                ({selectedLaborRates.length} selected)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LaborRateTable;