import React from 'react';
import './BillOfMaterialsManagement.css';

const BomTable = ({
  bomDefinitions,
  selectedBoms,
  sortField,
  sortDirection,
  onSort,
  onSelect,
  onSelectAll,
  onEdit,
  onDelete,
  onManageBomLines,
  bomLines
}) => {
  const allSelected = bomDefinitions.length > 0 && selectedBoms.length === bomDefinitions.length;
  const someSelected = selectedBoms.length > 0 && selectedBoms.length < bomDefinitions.length;

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

  const getBomLineCount = (bomId, version) => {
    return bomLines.filter(line => line.bom_id === bomId && (line.version || '1.0') === version).length;
  };

  const getTotalMaterialCost = (bomId, version) => {
    return bomLines
      .filter(line => line.bom_id === bomId && (line.version || '1.0') === version)
      .reduce((sum, line) => sum + (line.material_cost || 0), 0);
  };

  const getTotalTargetCost = (bomId, version) => {
    return bomLines
      .filter(line => line.bom_id === bomId && (line.version || '1.0') === version)
      .reduce((sum, line) => sum + (line.target_cost || 0), 0);
  };

  const columns = [
    { key: 'bom_id', label: 'BOM ID', sortable: true, width: '120px' },
    { key: 'bom_name', label: 'BOM Name', sortable: true, width: '200px' },
    { key: 'bom_description', label: 'Description', sortable: true, width: '250px' },
    { key: 'version', label: 'Version', sortable: true, width: '100px' },
    { key: 'total_lines', label: 'Lines', sortable: true, width: '100px' },
    { key: 'total_material_cost', label: 'Material Cost', sortable: true, width: '150px' },
    { key: 'total_target_cost', label: 'Target Cost', sortable: true, width: '150px' },
    { key: 'actions', label: 'Actions', sortable: false, width: '200px' }
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
          {bomDefinitions.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1} className="no-data">
                <div className="no-data-content">
                  <span>📋</span>
                  <p>No BOM definitions found</p>
                  <small>Try adjusting your search or filters</small>
                </div>
              </td>
            </tr>
          ) : (
            bomDefinitions.map(bom => {
              const bomKey = `${bom.bom_id}|${bom.version}`;
              const lineCount = getBomLineCount(bom.bom_id, bom.version);
              const totalMaterialCost = getTotalMaterialCost(bom.bom_id, bom.version);
              const totalTargetCost = getTotalTargetCost(bom.bom_id, bom.version);

              return (
                <tr key={bomKey} className="bom-row">
                  <td className="checkbox-cell">
                    <input
                      type="checkbox"
                      checked={selectedBoms.includes(bomKey)}
                      onChange={(e) => onSelect(bomKey, e.target.checked)}
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
                    <span className="version-badge">{bom.version}</span>
                  </td>
                  <td className="total-lines">
                    <span className="quantity-text">{lineCount}</span>
                  </td>
                  <td className="total-material-cost">
                    <span className="cost-text">{formatCurrency(totalMaterialCost)}</span>
                  </td>
                  <td className="total-target-cost">
                    <span className="cost-text">{formatCurrency(totalTargetCost)}</span>
                  </td>
                  <td className="actions-cell">
                    <div className="action-buttons">
                      <button
                        onClick={() => onEdit(bom)}
                        className="action-btn edit-btn"
                        title="Edit BOM Definition"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => onManageBomLines(bom)}
                        className="action-btn clone-btn"
                        title="Manage BOM Lines"
                      >
                        📋
                      </button>
                      <button
                        onClick={() => onDelete(bom.bom_id, bom.version)}
                        className="action-btn delete-btn"
                        title="Delete BOM Definition"
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
      
      {bomDefinitions.length > 0 && (
        <div className="table-footer">
          <div className="table-info">
            <span>Showing {bomDefinitions.length} of {bomDefinitions.length} BOM definitions</span>
            {selectedBoms.length > 0 && (
              <span className="selected-info">
                ({selectedBoms.length} selected)
              </span>
            )}
          </div>
          <div className="table-stats">
            <span>Total BOM Lines: {bomLines.length}</span>
            <span>Total Material Cost: {formatCurrency(bomLines.reduce((sum, line) => sum + (line.material_cost || 0), 0))}</span>
            <span>Total Target Cost: {formatCurrency(bomLines.reduce((sum, line) => sum + (line.target_cost || 0), 0))}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default BomTable; 