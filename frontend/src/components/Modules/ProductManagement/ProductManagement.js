import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import ProductTable from './ProductTable';
import ProductModal from './ProductModal';
import ProductSummary from './ProductSummary';
import ProductValidation from './ProductValidation';
import './ProductManagement.css';

const ProductManagement = () => {
  const { data, actions, loading } = useForecast();
  const [activeTab, setActiveTab] = useState('table');
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [sortField, setSortField] = useState('unit_name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [bulkAction, setBulkAction] = useState('');

  // Get unique product types for filtering
  const productTypes = useMemo(() => {
    const products = Array.isArray(data.products) ? data.products : [];
    return [...new Set(products.map(p => p.unit_type || 'General'))];
  }, [data.products]);

  // Filter and sort products
  const filteredProducts = useMemo(() => {
    let products = Array.isArray(data.products) ? data.products : [];
    
    console.log('ProductManagement - data.products:', data.products);
    console.log('ProductManagement - filtered products:', products);
    
    // Apply search filter
    if (searchTerm) {
      products = products.filter(product => 
        product.unit_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.unit_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.unit_type?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.unit_description?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // Apply type filter
    if (filterType !== 'all') {
      products = products.filter(product => 
        (product.unit_type || 'General') === filterType
      );
    }
    
    // Apply sorting
    products.sort((a, b) => {
      const aValue = a[sortField] || '';
      const bValue = b[sortField] || '';
      
      if (sortDirection === 'asc') {
        return aValue.toString().localeCompare(bValue.toString());
      } else {
        return bValue.toString().localeCompare(aValue.toString());
      }
    });
    
    return products;
  }, [data.products, searchTerm, filterType, sortField, sortDirection]);

  // Handle product creation/editing
  const handleSaveProduct = async (productData) => {
    try {
      if (editingProduct) {
        // Update existing product
        await actions.updateProduct(editingProduct.unit_id, productData);
        toast.success('Product updated successfully');
      } else {
        // Create new product
        await actions.createProduct(productData);
        toast.success('Product created successfully');
      }
      
      setShowProductModal(false);
      setEditingProduct(null);
      await actions.fetchAllData(); // Refresh data
    } catch (error) {
      console.error('Error saving product:', error);
      toast.error('Failed to save product');
    }
  };

  // Handle product deletion
  const handleDeleteProduct = async (productId) => {
    if (window.confirm('Are you sure you want to delete this product? This action cannot be undone.')) {
      try {
        await actions.deleteProduct('units', productId);
        toast.success('Product deleted successfully');
        await actions.fetchAllData(); // Refresh data
      } catch (error) {
        console.error('Error deleting product:', error);
        toast.error('Failed to delete product');
      }
    }
  };

  // Handle bulk operations
  const handleBulkOperation = async () => {
    if (selectedProducts.length === 0) {
      toast.error('Please select products for bulk operation');
      return;
    }

    if (bulkAction === 'delete') {
      if (window.confirm(`Are you sure you want to delete ${selectedProducts.length} products? This action cannot be undone.`)) {
        try {
          for (const productId of selectedProducts) {
            await actions.deleteProduct('units', productId);
          }
          toast.success(`${selectedProducts.length} products deleted successfully`);
          setSelectedProducts([]);
          await actions.fetchAllData();
        } catch (error) {
          console.error('Error in bulk delete:', error);
          toast.error('Failed to delete some products');
        }
      }
    } else if (bulkAction === 'export') {
      // Export selected products to CSV
      const csvData = selectedProducts.map(productId => {
        const product = data.products.find(p => p.unit_id === productId);
        return product;
      }).filter(Boolean);

      if (csvData.length > 0) {
        const csv = [
          Object.keys(csvData[0]).join(','),
          ...csvData.map(row => Object.values(row).join(','))
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `products-export-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`Exported ${csvData.length} products`);
      }
    }
  };

  // Handle sorting
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Handle product selection
  const handleProductSelect = (productId, selected) => {
    if (selected) {
      setSelectedProducts(prev => [...prev, productId]);
    } else {
      setSelectedProducts(prev => prev.filter(id => id !== productId));
    }
  };

  // Handle select all
  const handleSelectAll = (selected) => {
    if (selected) {
      setSelectedProducts(filteredProducts.map(p => p.unit_id));
    } else {
      setSelectedProducts([]);
    }
  };

  if (loading) {
    return (
      <div className="product-management">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading product data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="product-management">
      <div className="product-header">
        <h2>Product Management</h2>
        <div className="product-controls">
          <div className="search-controls">
            <input
              type="text"
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="type-filter"
            >
              <option value="all">All Types</option>
              {productTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          
          <div className="action-controls">
            <button 
              onClick={() => {
                setEditingProduct(null);
                setShowProductModal(true);
              }}
              className="btn-primary"
            >
              ➕ Add Product
            </button>
            
            {selectedProducts.length > 0 && (
              <div className="bulk-actions">
                <select
                  value={bulkAction}
                  onChange={(e) => setBulkAction(e.target.value)}
                  className="bulk-action-select"
                >
                  <option value="">Bulk Actions</option>
                  <option value="export">Export Selected</option>
                  <option value="delete">Delete Selected</option>
                </select>
                <button 
                  onClick={handleBulkOperation}
                  disabled={!bulkAction}
                  className="btn-secondary"
                >
                  Apply
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="product-tabs">
        <button 
          className={`tab ${activeTab === 'table' ? 'active' : ''}`}
          onClick={() => setActiveTab('table')}
        >
          Product Table
        </button>
        <button 
          className={`tab ${activeTab === 'summary' ? 'active' : ''}`}
          onClick={() => setActiveTab('summary')}
        >
          Summary
        </button>
        <button 
          className={`tab ${activeTab === 'validation' ? 'active' : ''}`}
          onClick={() => setActiveTab('validation')}
        >
          Data Validation
        </button>
      </div>

      <div className="product-content">
        {activeTab === 'table' && (
          <ProductTable
            products={filteredProducts}
            selectedProducts={selectedProducts}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
            onSelect={handleProductSelect}
            onSelectAll={handleSelectAll}
            onEdit={(product) => {
              setEditingProduct(product);
              setShowProductModal(true);
            }}
            onDelete={handleDeleteProduct}
            bomData={data.bom_definitions || []}
            routerData={data.router_definitions || []}
          />
        )}

        {activeTab === 'summary' && (
          <ProductSummary products={data.products || []} />
        )}

        {activeTab === 'validation' && (
          <ProductValidation products={data.products || []} />
        )}
      </div>

      <ProductModal
        isOpen={showProductModal}
        onClose={() => {
          setShowProductModal(false);
          setEditingProduct(null);
        }}
        onSave={handleSaveProduct}
        product={editingProduct}
        bomData={data.bom_definitions || []}
        routerData={data.router_definitions || []}
      />
    </div>
  );
};

export default ProductManagement; 