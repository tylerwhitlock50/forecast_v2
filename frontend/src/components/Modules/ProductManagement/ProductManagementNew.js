import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import { PageHeader } from '../../ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Select, SelectOption } from '../../ui/select';
import { DataTable } from '../../ui/data-table';
import ProductTable from './ProductTable';
import ProductModal from './ProductModal';
import ProductSummary from './ProductSummary';
import ProductValidation from './ProductValidation';

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
        await actions.updateProduct(editingProduct.unit_id, productData);
        toast.success('Product updated successfully');
      } else {
        await actions.createProduct(productData);
        toast.success('Product created successfully');
      }
      
      setShowProductModal(false);
      setEditingProduct(null);
      await actions.fetchAllData();
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
        await actions.fetchAllData();
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

  // Define columns for DataTable
  const productColumns = [
    {
      key: 'unit_name',
      title: 'Product Name',
      render: (value, row) => (
        <div className="space-y-1">
          <div className="font-semibold">{value}</div>
          <div className="text-sm text-muted-foreground">ID: {row.unit_id}</div>
        </div>
      )
    },
    {
      key: 'unit_type',
      title: 'Type',
      render: (value) => {
        const type = value || 'General';
        const variants = {
          'Finished Goods': 'success',
          'Raw Materials': 'warning',
          'Components': 'info',
          'General': 'default'
        };
        return <Badge variant={variants[type] || 'default'}>{type}</Badge>;
      }
    },
    {
      key: 'unit_description',
      title: 'Description',
      render: (value) => value || 'N/A'
    },
    {
      key: 'base_price',
      title: 'Base Price',
      type: 'currency'
    },
    {
      key: 'bom_id',
      title: 'BOM',
      render: (value) => value ? (
        <Badge variant="outline">{value}</Badge>
      ) : (
        <span className="text-muted-foreground">No BOM</span>
      )
    },
    {
      key: 'router_id',
      title: 'Router',
      render: (value) => value ? (
        <Badge variant="outline">{value}</Badge>
      ) : (
        <span className="text-muted-foreground">No Router</span>
      )
    },
    {
      key: 'is_active',
      title: 'Status',
      render: (value) => (
        <Badge variant={value !== false ? 'success' : 'secondary'}>
          {value !== false ? 'Active' : 'Inactive'}
        </Badge>
      )
    }
  ];

  if (loading) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="ml-4 text-muted-foreground">Loading product data...</p>
        </div>
      </div>
    );
  }

  const headerActions = [
    {
      label: 'Add Product',
      onClick: () => {
        setEditingProduct(null);
        setShowProductModal(true);
      },
      variant: 'default'
    }
  ];

  if (selectedProducts.length > 0) {
    headerActions.push({
      label: 'Export Selected',
      onClick: () => {
        setBulkAction('export');
        handleBulkOperation();
      },
      variant: 'outline'
    });
    headerActions.push({
      label: 'Delete Selected',
      onClick: () => {
        setBulkAction('delete');
        handleBulkOperation();
      },
      variant: 'destructive'
    });
  }

  return (
    <div className="container mx-auto px-6 py-8">
      <PageHeader
        title="Product Management"
        description="Manage your product catalog, pricing, and specifications"
        actions={headerActions}
      />

      {/* Search and Filter Controls */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Label>Search:</Label>
          <Input
            type="text"
            placeholder="Search products..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-64"
          />
        </div>
        
        <div className="flex items-center gap-2">
          <Label>Type:</Label>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectOption value="all">All Types</SelectOption>
            {productTypes.map(type => (
              <SelectOption key={type} value={type}>{type}</SelectOption>
            ))}
          </Select>
        </div>

        {selectedProducts.length > 0 && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="px-3 py-1">
              {selectedProducts.length} selected
            </Badge>
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="table">Product Table</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="validation">Data Validation</TabsTrigger>
        </TabsList>

        <TabsContent value="table" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>All Products ({filteredProducts.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                data={filteredProducts}
                columns={productColumns}
                onEdit={(product) => {
                  setEditingProduct(product);
                  setShowProductModal(true);
                }}
                onDelete={(product) => handleDeleteProduct(product.unit_id)}
                emptyMessage="No products found. Click 'Add Product' to get started."
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="summary" className="space-y-6">
          <ProductSummary products={data.products || []} />
        </TabsContent>

        <TabsContent value="validation" className="space-y-6">
          <ProductValidation products={data.products || []} />
        </TabsContent>
      </Tabs>

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