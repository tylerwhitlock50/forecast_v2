import React from 'react';
import './CustomerManagement.css';

const CustomerTable = ({
  customers,
  selectedCustomers,
  sortField,
  sortDirection,
  onSort,
  onSelect,
  onSelectAll,
  onEdit,
  onDelete
}) => {
  const allSelected = customers.length > 0 && selectedCustomers.length === customers.length;
  const someSelected = selectedCustomers.length > 0 && selectedCustomers.length < customers.length;

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <span className="sort-icon">↕</span>;
    return <span className="sort-icon">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  const columns = [
    { key: 'customer_id', label: 'Customer ID', sortable: true, width: '120px' },
    { key: 'customer_name', label: 'Customer Name', sortable: true, width: '200px' },
    { key: 'customer_type', label: 'Type', sortable: true, width: '120px' },
    { key: 'region', label: 'Region', sortable: true, width: '120px' },
    { key: 'actions', label: 'Actions', sortable: false, width: '120px' }
  ];

  return (
    <div className="customer-table-container">
      <table className="customer-table">
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
          {customers.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1} className="no-data">
                <div className="no-data-content">
                  <span>📭</span>
                  <p>No customers found</p>
                  <small>Try adjusting your search or filters</small>
                </div>
              </td>
            </tr>
          ) : (
            customers.map(customer => (
              <tr key={customer.customer_id} className="customer-row">
                <td className="checkbox-cell">
                  <input
                    type="checkbox"
                    checked={selectedCustomers.includes(customer.customer_id)}
                    onChange={(e) => onSelect(customer.customer_id, e.target.checked)}
                  />
                </td>
                <td className="customer-id">
                  <span className="id-badge">{customer.customer_id}</span>
                </td>
                <td className="customer-name">
                  <div className="name-cell">
                    <span className="name-text">{customer.customer_name}</span>
                    {customer.customer_name && (
                      <span className="name-tooltip">{customer.customer_name}</span>
                    )}
                  </div>
                </td>
                <td className="customer-type">
                  <span className={`type-badge ${customer.customer_type?.toLowerCase() || 'general'}`}>
                    {customer.customer_type || 'General'}
                  </span>
                </td>
                <td className="customer-region">
                  <span className="region-text">{customer.region || 'N/A'}</span>
                </td>
                <td className="actions-cell">
                  <div className="action-buttons">
                    <button
                      onClick={() => onEdit(customer)}
                      className="action-btn edit-btn"
                      title="Edit Customer"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => onDelete(customer.customer_id)}
                      className="action-btn delete-btn"
                      title="Delete Customer"
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
      
      {customers.length > 0 && (
        <div className="table-footer">
          <div className="table-info">
            <span>Showing {customers.length} of {customers.length} customers</span>
            {selectedCustomers.length > 0 && (
              <span className="selected-info">
                ({selectedCustomers.length} selected)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerTable; 