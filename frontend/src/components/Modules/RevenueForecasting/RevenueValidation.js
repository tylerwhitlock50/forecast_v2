import React, { useState, useEffect } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import api from '../../../lib/apiClient';
import CustomerModal from '../CustomerManagement/CustomerModal';
import ProductModal from '../ProductManagement/ProductModal';

const RevenueValidation = ({ data }) => {
  const { actions } = useForecast();
  const [validationData, setValidationData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);

  useEffect(() => {
    fetchValidationData();
  }, []);

  const fetchValidationData = async () => {
    try {
      setLoading(true);
      const response = await api.get('/data/validation/issues');
      if (response.status === 'success') {
        setValidationData(response.data);
      }
    } catch (error) {
      console.error('Error fetching validation data:', error);
      toast.error('Failed to load validation data');
    } finally {
      setLoading(false);
    }
  };

  const handleEditCustomer = (customer) => {
    setEditingCustomer(customer);
    setShowCustomerModal(true);
  };

  const handleEditProduct = (product) => {
    setEditingProduct(product);
    setShowProductModal(true);
  };

  const handleSaveCustomer = async (customerData) => {
    try {
      if (editingCustomer) {
        await actions.updateCustomer(editingCustomer.customer_id, customerData);
      } else {
        await actions.createCustomer(customerData);
      }
      setShowCustomerModal(false);
      setEditingCustomer(null);
      await fetchValidationData();
      await actions.fetchAllData();
    } catch (error) {
      console.error('Error saving customer:', error);
      throw error;
    }
  };

  const handleSaveProduct = async (productData) => {
    try {
      if (editingProduct) {
        await actions.updateProduct(editingProduct.unit_id, productData);
      } else {
        await actions.createProduct(productData);
      }
      setShowProductModal(false);
      setEditingProduct(null);
      await fetchValidationData();
      await actions.fetchAllData();
    } catch (error) {
      console.error('Error saving product:', error);
      throw error;
    }
  };

  const handleFillMissingFields = async (type) => {
    try {
      if (type === 'customers') {
        const incomplete = validationData?.incomplete_customers || [];
        for (const customer of incomplete) {
          await actions.updateCustomer(customer.customer_id, {
            customer_type: customer.customer_type || 'Unknown',
            region: customer.region || 'Unknown'
          });
        }
        toast.success(`Updated ${incomplete.length} customers with default values`);
      } else if (type === 'products') {
        const incomplete = validationData?.incomplete_products || [];
        for (const product of incomplete) {
          await actions.updateProduct(product.unit_id, {
            base_price: product.base_price || 0,
            unit_description: product.unit_description || 'No description'
          });
        }
        toast.success(`Updated ${incomplete.length} products with default values`);
      }
      await fetchValidationData();
      await actions.fetchAllData();
    } catch (error) {
      console.error('Error filling missing fields:', error);
      toast.error('Failed to fill missing fields');
    }
  };

  const handleExportIssues = () => {
    if (!validationData) return;

    const issues = [];
    
    // Add incomplete customers
    (validationData.incomplete_customers || []).forEach(customer => {
      issues.push({
        type: 'Incomplete Customer',
        id: customer.customer_id,
        name: customer.customer_name,
        issue: `Missing: ${!customer.customer_type ? 'customer_type' : ''} ${!customer.region ? 'region' : ''}`.trim()
      });
    });

    // Add incomplete products
    (validationData.incomplete_products || []).forEach(product => {
      issues.push({
        type: 'Incomplete Product',
        id: product.unit_id,
        name: product.unit_name,
        issue: `Missing: ${!product.base_price || product.base_price === 0 ? 'base_price' : ''} ${!product.unit_description ? 'unit_description' : ''}`.trim()
      });
    });

    // Add orphaned sales
    (validationData.orphaned_sales || []).forEach(sale => {
      issues.push({
        type: 'Orphaned Sale',
        id: sale.sale_id,
        customer_id: sale.customer_id,
        product_id: sale.unit_id,
        issue: 'Referenced customer or product does not exist'
      });
    });

    // Add invalid periods
    (validationData.invalid_periods || []).forEach(sale => {
      issues.push({
        type: 'Invalid Period',
        id: sale.sale_id,
        period: sale.period,
        issue: 'Period format is invalid (expected YYYY-MM, YYYY-QX, or YYYY-WXX)'
      });
    });

    // Convert to CSV
    if (issues.length === 0) {
      toast.info('No issues to export');
      return;
    }

    const headers = Object.keys(issues[0]);
    const csv = [
      headers.join(','),
      ...issues.map(issue => headers.map(header => issue[header] || '').join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `validation_issues_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${issues.length} issues`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600"></div>
      </div>
    );
  }

  const summary = validationData?.summary || {};
  const totalIssues = summary.total_issues || 0;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-gray-600">Incomplete Customers</div>
            <div className="text-2xl font-bold text-orange-600 mt-2">
              {summary.incomplete_customers_count || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-gray-600">Incomplete Products</div>
            <div className="text-2xl font-bold text-orange-600 mt-2">
              {summary.incomplete_products_count || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-gray-600">Orphaned Sales</div>
            <div className="text-2xl font-bold text-red-600 mt-2">
              {summary.orphaned_sales_count || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm font-medium text-gray-600">Invalid Periods</div>
            <div className="text-2xl font-bold text-red-600 mt-2">
              {summary.invalid_periods_count || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        <Button
          onClick={() => handleFillMissingFields('customers')}
          disabled={!summary.incomplete_customers_count}
          variant="outline"
        >
          Fill Missing Customer Fields
        </Button>
        <Button
          onClick={() => handleFillMissingFields('products')}
          disabled={!summary.incomplete_products_count}
          variant="outline"
        >
          Fill Missing Product Fields
        </Button>
        <Button
          onClick={handleExportIssues}
          disabled={totalIssues === 0}
          variant="outline"
        >
          Export Issues
        </Button>
        <Button
          onClick={fetchValidationData}
          variant="outline"
        >
          Refresh
        </Button>
      </div>

      {/* Incomplete Customers */}
      {validationData?.incomplete_customers?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Incomplete Customers ({validationData.incomplete_customers.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {validationData.incomplete_customers.map((customer, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">{customer.customer_name}</div>
                    <div className="text-sm text-gray-500">ID: {customer.customer_id}</div>
                    <div className="flex gap-2 mt-2">
                      {!customer.customer_type && (
                        <Badge variant="outline" className="bg-yellow-50 text-yellow-700">
                          Missing Type
                        </Badge>
                      )}
                      {!customer.region && (
                        <Badge variant="outline" className="bg-yellow-50 text-yellow-700">
                          Missing Region
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEditCustomer(customer)}
                  >
                    Edit
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Incomplete Products */}
      {validationData?.incomplete_products?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Incomplete Products ({validationData.incomplete_products.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {validationData.incomplete_products.map((product, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">{product.unit_name}</div>
                    <div className="text-sm text-gray-500">ID: {product.unit_id}</div>
                    <div className="flex gap-2 mt-2">
                      {(!product.base_price || product.base_price === 0) && (
                        <Badge variant="outline" className="bg-yellow-50 text-yellow-700">
                          Missing Price
                        </Badge>
                      )}
                      {!product.unit_description && (
                        <Badge variant="outline" className="bg-yellow-50 text-yellow-700">
                          Missing Description
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEditProduct(product)}
                  >
                    Edit
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Orphaned Sales */}
      {validationData?.orphaned_sales?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-red-600">
              Orphaned Sales ({validationData.orphaned_sales.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-gray-600 mb-4">
              These sales reference customers or products that no longer exist.
            </div>
            <div className="space-y-2">
              {validationData.orphaned_sales.map((sale, idx) => (
                <div
                  key={idx}
                  className="p-3 border border-red-200 rounded-lg bg-red-50"
                >
                  <div className="text-sm">
                    <span className="font-medium">Sale ID:</span> {sale.sale_id}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Customer:</span> {sale.customer_id || 'N/A'}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Product:</span> {sale.unit_id || 'N/A'}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Period:</span> {sale.period || 'N/A'}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invalid Periods */}
      {validationData?.invalid_periods?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-red-600">
              Invalid Periods ({validationData.invalid_periods.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-gray-600 mb-4">
              These sales have invalid period formats. Expected: YYYY-MM, YYYY-QX, or YYYY-WXX
            </div>
            <div className="space-y-2">
              {validationData.invalid_periods.map((sale, idx) => (
                <div
                  key={idx}
                  className="p-3 border border-red-200 rounded-lg bg-red-50"
                >
                  <div className="text-sm">
                    <span className="font-medium">Sale ID:</span> {sale.sale_id}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Period:</span> {sale.period}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* No Issues */}
      {totalIssues === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="text-green-600 text-4xl mb-4">✓</div>
            <div className="text-xl font-semibold text-gray-900 mb-2">All Good!</div>
            <div className="text-gray-600">No validation issues found.</div>
          </CardContent>
        </Card>
      )}

      {/* Modals */}
      <CustomerModal
        isOpen={showCustomerModal}
        onClose={() => {
          setShowCustomerModal(false);
          setEditingCustomer(null);
        }}
        onSave={handleSaveCustomer}
        customer={editingCustomer}
        existingCustomers={data.customers || []}
      />

      <ProductModal
        isOpen={showProductModal}
        onClose={() => {
          setShowProductModal(false);
          setEditingProduct(null);
        }}
        onSave={handleSaveProduct}
        product={editingProduct}
        bomData={data.bom || []}
        routerData={data.routing || []}
        actions={actions}
      />
    </div>
  );
};

export default RevenueValidation;
