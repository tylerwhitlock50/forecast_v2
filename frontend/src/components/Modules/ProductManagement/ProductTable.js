import React from 'react';
import './ProductManagement.css';

const ProductTable = ({
  products,
  selectedProducts,
  sortField,
  sortDirection,
  onSort,
  onSelect,
  onSelectAll,
  onEdit,
  onDelete,
  bomData = [],
  routerData = []
}) => {
  console.log('ProductTable - received products:', products);
  console.log('ProductTable - sample product:', products[0]);
  const allSelected = products.length > 0 && selectedProducts.length === products.length;
  const someSelected = selectedProducts.length > 0 && selectedProducts.length < products.length;

  // Helper function to get BOM display name
  const getBOMDisplayName = (bomId) => {
    if (!bomId) return 'N/A';
    // Look for BOM definition with bom_name
    const bomDefinition = bomData.find(item => item.bom_id === bomId && item.bom_name);
    if (bomDefinition) {
      return `${bomId} - ${bomDefinition.bom_name}`;
    }
    // Fallback to counting materials
    const bomItems = bomData.filter(item => item.bom_id === bomId);
    if (bomItems.length > 0) {
      const materialCount = bomItems.length;
      return `${bomId} (${materialCount} materials)`;
    }
    return bomId;
  };

  // Helper function to get Router display name
  const getRouterDisplayName = (routerId) => {
    if (!routerId) return 'N/A';
    const router = routerData.find(item => item.router_id === routerId);
    if (router && router.router_name) {
      return `${routerId} - ${router.router_name}`;
    }
    return routerId;
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <span className="sort-icon">↕</span>;
    return <span className="sort-icon">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  const columns = [
    { key: 'unit_id', label: 'Product ID', sortable: true, width: '120px' },
    { key: 'unit_name', label: 'Product Name', sortable: true, width: '200px' },
    { key: 'unit_description', label: 'Description', sortable: true, width: '200px' },
    { key: 'base_price', label: 'Base Price', sortable: true, width: '120px' },
    { key: 'unit_type', label: 'Type', sortable: true, width: '120px' },
    { key: 'bom', label: 'BOM', sortable: true, width: '120px' },
    { key: 'router', label: 'Router', sortable: true, width: '120px' },
    { key: 'actions', label: 'Actions', sortable: false, width: '120px' }
  ];

  return (
    <div className="product-table-container">
      <table className="product-table">
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
          {products.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1} className="no-data">
                <div className="no-data-content">
                  <span>📦</span>
                  <p>No products found</p>
                  <small>Try adjusting your search or filters</small>
                </div>
              </td>
            </tr>
          ) : (
            products.map(product => (
              <tr key={product.unit_id} className="product-row">
                <td className="checkbox-cell">
                  <input
                    type="checkbox"
                    checked={selectedProducts.includes(product.unit_id)}
                    onChange={(e) => onSelect(product.unit_id, e.target.checked)}
                  />
                </td>
                <td className="product-id">
                  <span className="id-badge">{product.unit_id}</span>
                </td>
                <td className="product-name">
                  <div className="name-cell">
                    <span className="name-text">{product.unit_name}</span>
                    {product.unit_name && (
                      <span className="name-tooltip">{product.unit_name}</span>
                    )}
                  </div>
                </td>
                <td className="description-cell">
                  <div className="description-cell">
                    <span className="description-text">{product.unit_description}</span>
                    {product.unit_description && (
                      <span className="description-tooltip">{product.unit_description}</span>
                    )}
                  </div>
                </td>
                <td className="price-cell">
                  ${product.base_price ? parseFloat(product.base_price).toFixed(2) : '0.00'}
                </td>
                <td className="product-type">
                  <span className={`type-badge ${product.unit_type?.toLowerCase() || 'general'}`}>
                    {product.unit_type || 'General'}
                  </span>
                </td>
                <td className="bom-cell">
                  <div className="bom-cell">
                    <span className="bom-text">{getBOMDisplayName(product.bom)}</span>
                    {product.bom && (
                      <span className="bom-tooltip">{getBOMDisplayName(product.bom)}</span>
                    )}
                  </div>
                </td>
                <td className="router-cell">
                  <div className="router-cell">
                    <span className="router-text">{getRouterDisplayName(product.router)}</span>
                    {product.router && (
                      <span className="router-tooltip">{getRouterDisplayName(product.router)}</span>
                    )}
                  </div>
                </td>
                <td className="actions-cell">
                  <div className="action-buttons">
                    <button
                      onClick={() => onEdit(product)}
                      className="action-btn edit-btn"
                      title="Edit Product"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => onDelete(product.unit_id)}
                      className="action-btn delete-btn"
                      title="Delete Product"
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
      
      {products.length > 0 && (
        <div className="table-footer">
          <div className="table-info">
            <span>Showing {products.length} of {products.length} products</span>
            {selectedProducts.length > 0 && (
              <span className="selected-info">
                ({selectedProducts.length} selected)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductTable; 