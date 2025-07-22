import React from 'react';


const BOMTable = ({
  boms,
  selectedBOMs,
  sortField,
  sortDirection,
  onSort,
  onSelect,
  onSelectAll,
  onEdit,
  onDelete,
  onManageItems,
  onClone,
  bomItems
}) => {
  const allSelected = boms.length > 0 && selectedBOMs.length === boms.length;
  const someSelected = selectedBOMs.length > 0 && selectedBOMs.length < boms.length;

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

  const getItemCount = (bomId) => {
    return bomItems.filter(item => item.bom_id === bomId).length;
  };

  const getTotalCost = (bomId) => {
    return bomItems
      .filter(item => item.bom_id === bomId)
      .reduce((sum, item) => sum + (item.material_cost || 0), 0);
  };

  const getTargetCost = (bomId) => {
    return bomItems
      .filter(item => item.bom_id === bomId)
      .reduce((sum, item) => sum + (item.target_cost || 0), 0);
  };

  const columns = [
    { key: 'bom_id', label: 'BOM ID', sortable: true, width: '120px' },
    { key: 'bom_name', label: 'BOM Name', sortable: true, width: '200px' },
    { key: 'bom_description', label: 'Description', sortable: true, width: '250px' },
    { key: 'version', label: 'Version', sortable: true, width: '100px' },
    { key: 'items', label: 'Items', sortable: false, width: '100px' },
    { key: 'total_cost', label: 'Total Cost', sortable: false, width: '120px' },
    { key: 'target_cost', label: 'Target Cost', sortable: false, width: '120px' },
    { key: 'actions', label: 'Actions', sortable: false, width: '220px' }
  ];

  return (
    <div className="bom-table-container">
      <table className="bom-table">
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
          {boms.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1} className="no-data">
                <div className="no-data-content">
                  <span>📋</span>
                  <p>No BOMs found</p>
                  <small>Try adjusting your search or filters</small>
                </div>
              </td>
            </tr>
          ) : (
            boms.map(bom => {
              const itemCount = getItemCount(bom.bom_id);
              const totalCost = getTotalCost(bom.bom_id);
              const targetCost = getTargetCost(bom.bom_id);
              const costVariance = totalCost - targetCost;

              return (
                <tr key={bom.bom_id} className="bom-row">
                  <td className="checkbox-cell">
                    <input
                      type="checkbox"
                      checked={selectedBOMs.includes(bom.bom_id)}
                      onChange={(e) => onSelect(bom.bom_id, e.target.checked)}
                    />
                  </td>
                  <td className="bom-id">
                    <span className="id-badge">{bom.bom_id}</span>
                  </td>
                  <td className="bom-name">
                    <div className="name-cell">
                      <span className="name-text">{bom.bom_name}</span>
                      {bom.bom_name && (
                        <span className="name-tooltip">{bom.bom_name}</span>
                      )}
                    </div>
                  </td>
                  <td className="bom-description">
                    <span className="description-text">{bom.bom_description || 'N/A'}</span>
                  </td>
                  <td className="version">
                    <span className="version-badge">{bom.version || '1.0'}</span>
                  </td>
                  <td className="items">
                    <span className="count-text">{itemCount}</span>
                  </td>
                  <td className="total-cost">
                    <span className="cost-text">{formatCurrency(totalCost)}</span>
                  </td>
                  <td className="target-cost">
                    <div className="target-cost-cell">
                      <span className="cost-text">{formatCurrency(targetCost)}</span>
                      {targetCost > 0 && (
                        <span className={`variance-text ${costVariance > 0 ? 'over' : costVariance < 0 ? 'under' : 'on-target'}`}>
                          {costVariance > 0 ? '+' : ''}{formatCurrency(costVariance)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="actions-cell">
                    <div className="action-buttons">
                      <button
                        onClick={() => onEdit(bom)}
                        className="action-btn edit-btn"
                        title="Edit BOM"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => onManageItems(bom)}
                        className="action-btn manage-btn"
                        title="Manage Items"
                      >
                        📦
                      </button>
                      <button
                        onClick={() => onClone(bom.bom_id)}
                        className="action-btn clone-btn"
                        title="Clone BOM"
                      >
                        📋
                      </button>
                      <button
                        onClick={() => onDelete(bom.bom_id)}
                        className="action-btn delete-btn"
                        title="Delete BOM"
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
      
      {boms.length > 0 && (
        <div className="table-footer">
          <div className="table-info">
            <span>Showing {boms.length} of {boms.length} BOMs</span>
            {selectedBOMs.length > 0 && (
              <span className="selected-info">
                ({selectedBOMs.length} selected)
              </span>
            )}
          </div>
          <div className="table-stats">
            <span>Total Items: {bomItems.length}</span>
            <span>Total Material Cost: {formatCurrency(bomItems.reduce((sum, item) => sum + (item.material_cost || 0), 0))}</span>
            <span>Total Target Cost: {formatCurrency(bomItems.reduce((sum, item) => sum + (item.target_cost || 0), 0))}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default BOMTable;