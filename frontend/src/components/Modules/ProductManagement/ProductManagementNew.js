import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import { toast } from 'react-hot-toast';
import { Download, Plus, Upload } from 'lucide-react';
import { useForecast } from '../../../context/ForecastContext';
import api from '../../../lib/apiClient';
import { useConfirm } from '../../Common/ConfirmDialog';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Select, SelectOption } from '../../ui/select';
import { DataTable } from '../../ui/data-table';
import ProductModal from './ProductModal';
import ProductSummary from './ProductSummary';
import ProductValidation from './ProductValidation';
import { goToImport } from '../../Common/importLink';
import { DependencyList, fetchSalesDependencies } from '../RevenueForecasting/salesDependencies';

const EXPORT_COLUMNS = ['unit_id', 'unit_name', 'unit_type', 'base_price', 'bom_id', 'bom_version', 'router_id', 'unit_description'];

const TABS = [
  { id: 'table', label: 'Products' },
  { id: 'summary', label: 'Summary' },
  { id: 'validation', label: 'Costing checks' },
];

const ProductManagement = () => {
  const navigate = useNavigate();
  const { data, actions, loading, scenarios } = useForecast();
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState('table');
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');

  const products = useMemo(() => (Array.isArray(data.products) ? data.products : []), [data.products]);

  const productTypes = useMemo(
    () => [...new Set(products.map(p => p.unit_type || 'No type'))].sort(),
    [products]
  );

  const filteredProducts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return products
      .filter(p => !term || [p.unit_name, p.unit_id, p.unit_type, p.unit_description]
        .some(v => String(v || '').toLowerCase().includes(term)))
      .filter(p => filterType === 'all' || (p.unit_type || 'No type') === filterType)
      .sort((a, b) => String(a.unit_name || '').localeCompare(String(b.unit_name || '')));
  }, [products, searchTerm, filterType]);

  const handleSaveProduct = async (productData) => {
    // The context shows the success / error toast and reloads the data.
    if (editingProduct) await actions.updateProduct(editingProduct.unit_id, productData);
    else await actions.createProduct(productData);
    setShowProductModal(false);
    setEditingProduct(null);
  };

  // Say exactly which sales rows go with the product before deleting it.
  const handleDeleteProduct = async (product) => {
    const name = product.unit_name || product.unit_id;
    let deps;
    try {
      deps = await fetchSalesDependencies('unit_id', product.unit_id, scenarios);
    } catch {
      toast.error('Could not check where this product is used. Nothing was deleted.');
      return;
    }
    const ok = await confirm({
      title: `Delete ${name}?`,
      body: <DependencyList name={name} deps={deps} noun="product" />,
      confirmLabel: deps.rows ? `Delete product and ${deps.rows.toLocaleString('en-US')} sales rows` : 'Delete product',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      const res = await api.delete(`/forecast/delete/units/${encodeURIComponent(product.unit_id)}`, {
        params: deps.rows ? { cascade: true } : {},
        suppressSuccessToast: true,
        suppressErrorToast: true,
      });
      const deleted = res?.data?.deleted_sales || 0;
      toast.success(deleted ? `Deleted ${name} and ${deleted.toLocaleString('en-US')} sales rows` : `Deleted ${name}`);
      await actions.fetchAllData();
    } catch (error) {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : 'Failed to delete the product');
    }
  };

  const handleExport = () => {
    if (filteredProducts.length === 0) {
      toast.error('No products to export');
      return;
    }
    const rows = filteredProducts.map(p => ({
      unit_id: p.unit_id,
      unit_name: p.unit_name,
      unit_type: p.unit_type || '',
      base_price: p.base_price ?? '',
      bom_id: p.bom || '',
      bom_version: p.bom ? (p.bom_version || '') : '',
      router_id: p.router || '',
      unit_description: p.unit_description || '',
    }));
    const csv = Papa.unparse(rows, { columns: EXPORT_COLUMNS });
    const url = URL.createObjectURL(new Blob([`﻿${csv}\n`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `products_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(`Exported ${rows.length} products`);
  };

  const productColumns = [
    {
      key: 'unit_name',
      title: 'Product',
      render: (value, row) => (
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => navigate(`/products/${encodeURIComponent(row.unit_id)}`)}
            className="text-left font-semibold text-gray-900 hover:text-orange-700 hover:underline"
          >
            {value || row.unit_id}
          </button>
          <div className="font-mono text-xs text-gray-500">{row.unit_id}</div>
        </div>
      )
    },
    {
      key: 'unit_type',
      title: 'Type',
      render: (value) => (value ? <Badge variant="outline">{value}</Badge> : <span className="text-xs text-gray-400">No type</span>)
    },
    {
      key: 'base_price',
      title: 'List price',
      type: 'currency'
    },
    {
      key: 'bom',
      title: 'BOM',
      render: (value, row) => (value ? (
        <span className="whitespace-nowrap font-mono text-xs text-gray-700">
          {value}<span className="ml-1 rounded bg-gray-100 px-1 py-0.5 text-gray-600">v{row.bom_version || '1.0'}</span>
        </span>
      ) : <span className="text-xs font-medium text-amber-700">No BOM</span>)
    },
    {
      key: 'router',
      title: 'Routing',
      render: (value) => (value
        ? <span className="font-mono text-xs text-gray-700">{value}</span>
        : <span className="text-xs font-medium text-amber-700">No routing</span>)
    },
    {
      key: 'unit_description',
      title: 'Description',
      render: (value) => <span className="text-sm text-gray-600">{value || ''}</span>
    },
  ];

  if (loading && products.length === 0) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-orange-600" />
          <p className="ml-4 text-gray-500">Loading products…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 max-w-2xl lg:flex-1">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Products</h1>
          <p className="mt-1 text-gray-600">What you sell: list price, product type, and the BOM and routing that cost each unit.</p>
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 lg:flex-nowrap">
          <Button variant="outline" onClick={() => goToImport(navigate, 'products')} title="Import data, step 2: Products">
            <Upload className="mr-1.5 h-4 w-4" />
            Import products
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={filteredProducts.length === 0}>
            <Download className="mr-1.5 h-4 w-4" />
            Export CSV
          </Button>
          <Button
            onClick={() => { setEditingProduct(null); setShowProductModal(true); }}
            className="bg-orange-600 text-white hover:bg-orange-700"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Add product
          </Button>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="product-search">Search</Label>
          <Input
            id="product-search"
            type="text"
            placeholder="Name, ID, type…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-64"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="product-type-filter">Type</Label>
          <Select id="product-type-filter" value={filterType} onChange={(e) => setFilterType(e.target.value)} className="w-44">
            <SelectOption value="all">All types</SelectOption>
            {productTypes.map(type => <SelectOption key={type} value={type}>{type}</SelectOption>)}
          </Select>
        </div>
      </div>

      <div className="mb-5 inline-flex rounded-lg bg-gray-100 p-1" role="tablist" aria-label="Product views">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${activeTab === tab.id ? 'bg-white text-orange-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'table' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              {filteredProducts.length === products.length ? `${products.length} products` : `${filteredProducts.length} of ${products.length} products`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {products.length === 0 ? (
              <div className="py-12 text-center">
                <h3 className="mb-2 text-lg font-semibold text-gray-900">No products yet</h3>
                <p className="mb-4 text-sm text-gray-600">Import your product list (with BOM and routing IDs) or add products one at a time.</p>
                <div className="flex justify-center gap-2">
                  <Button variant="outline" onClick={() => goToImport(navigate, 'products')}>Import products</Button>
                  <Button onClick={() => { setEditingProduct(null); setShowProductModal(true); }} className="bg-orange-600 text-white hover:bg-orange-700">Add product</Button>
                </div>
              </div>
            ) : (
              <DataTable
                data={filteredProducts}
                columns={productColumns}
                rowKey="unit_id"
                onEdit={(product) => { setEditingProduct(product); setShowProductModal(true); }}
                onDelete={handleDeleteProduct}
                emptyMessage="No products match the search."
              />
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'summary' && <ProductSummary products={products} />}

      {activeTab === 'validation' && <ProductValidation products={products} />}

      <ProductModal
        isOpen={showProductModal}
        onClose={() => { setShowProductModal(false); setEditingProduct(null); }}
        onSave={handleSaveProduct}
        product={editingProduct}
      />
    </div>
  );
};

export default ProductManagement;
