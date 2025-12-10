import React, { useMemo, useState } from 'react';
import EditableGrid from '../../Common/EditableGrid';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';

const RevenueMatrix = ({ 
  data, 
  timePeriods, 
  selectedSegment, 
  onDataChange, 
  onCellChange,
  onAddForecastLine 
}) => {
  const { actions, activeScenario } = useForecast();
  const [editingCell, setEditingCell] = useState(null);
  const [editModal, setEditModal] = useState(null);

  // Generate product-customer matrix data - ONLY for combinations that have actual forecast data
  const matrixData = useMemo(() => {
    console.log('RevenueMatrix data:', {
      products: data.products?.length || 0,
      customers: data.customers?.length || 0,
      sales: data.sales_forecast?.length || 0,
      activeScenario: activeScenario,
      sampleProducts: data.products?.slice(0, 2),
      sampleCustomers: data.customers?.slice(0, 2),
      sampleSales: data.sales_forecast?.slice(0, 2)
    });
    
    // Debug: Log all sales for the active scenario
    const activeSales = Array.isArray(data.sales_forecast) ? 
      data.sales_forecast.filter(s => s.forecast_id === (activeScenario || 'F001')) : [];
    console.log('Active sales for scenario', activeScenario || 'F001', ':', activeSales);
    
    const matrix = [];
    
    const products = Array.isArray(data.products) ? data.products : [];
    const customers = Array.isArray(data.customers) ? data.customers : [];
    const sales = Array.isArray(data.sales_forecast) ? data.sales_forecast : [];
    
    // Create a map of product-customer combinations that have actual forecast data
    const forecastCombinations = new Set();
    sales.forEach(sale => {
      if (sale.forecast_id === (activeScenario || 'F001')) {
        const combinationKey = `${sale.unit_id}-${sale.customer_id}`;
        forecastCombinations.add(combinationKey);
        console.log('Added combination:', combinationKey, 'from sale:', sale);
      }
    });
    
    console.log('All forecast combinations:', Array.from(forecastCombinations));
    
    // Create a mapping from product names to product IDs for flexible matching
    const productNameToId = {};
    products.forEach(product => {
      if (product.unit_name) {
        productNameToId[product.unit_name] = product.unit_id || product.id;
      }
    });
    
    // Only create matrix rows for combinations that have forecast data
    products.forEach(product => {
      customers.forEach(customer => {
        const productId = product.unit_id || product.id;
        const combinationKey = `${productId}-${customer.customer_id}`;
        
        console.log('Checking combination:', combinationKey, 'for product:', productId, 'customer:', customer.customer_id);
        
        // Check if this combination has forecast data (direct match or name-based match)
        const hasDirectMatch = forecastCombinations.has(combinationKey);
        const hasNameMatch = product.unit_name && forecastCombinations.has(`${product.unit_name}-${customer.customer_id}`);
        
        if (hasDirectMatch || hasNameMatch) {
          console.log('Found matching combination:', combinationKey);
          const baseRow = {
            id: combinationKey,
            product_id: product.unit_id || product.id,
            product_name: product.unit_name || product.name,
            customer_id: customer.customer_id,
            customer_name: customer.customer_name,
            segment: customer.customer_type || customer.region || 'General',
            total_quantity: 0,
            total_revenue: 0
          };

          // Add time period columns
          timePeriods.forEach(period => {
            // Find existing sale with flexible matching (by ID or name)
            const existingSale = sales.find(s => 
              (s.unit_id === productId || s.unit_id === product.unit_name) && 
              s.customer_id === customer.customer_id && 
              s.period === period.key &&
              s.forecast_id === (activeScenario || 'F001')
            );
            
            const quantity = existingSale?.quantity || 0;
            const price = existingSale?.unit_price || 0;
            const revenue = quantity * price;
            
            baseRow[`quantity_${period.key}`] = quantity;
            baseRow[`price_${period.key}`] = price;
            baseRow[`revenue_${period.key}`] = revenue;
            
            baseRow.total_quantity += quantity;
            baseRow.total_revenue += revenue;
          });

          matrix.push(baseRow);
        }
      });
    });

    return matrix;
  }, [data.products, data.customers, data.sales_forecast, timePeriods, activeScenario]);

  // Filter matrix data by segment
  const filteredMatrixData = useMemo(() => {
    if (selectedSegment === 'all') return matrixData;
    return matrixData.filter(row => row.segment === selectedSegment);
  }, [matrixData, selectedSegment]);

  // Handle cell click for revenue cells
  const handleRevenueCellClick = (rowIndex, colIndex, periodKey, rowData) => {
    console.log('Revenue cell clicked:', { rowIndex, colIndex, periodKey, rowData });
    
    const quantity = rowData[`quantity_${periodKey}`] || 0;
    const price = rowData[`price_${periodKey}`] || 0;
    
    setEditModal({
      rowIndex,
      colIndex,
      periodKey,
      rowData,
      quantity,
      price,
      revenue: quantity * price
    });
  };

  // Handle save from edit modal
  const handleSaveEdit = async (newQuantity, newPrice) => {
    if (!editModal) return;

    const { rowIndex, colIndex, periodKey, rowData } = editModal;
    const newRevenue = newQuantity * newPrice;

    try {
      // Update the matrix data
      const updatedData = [...filteredMatrixData];
      updatedData[rowIndex] = {
        ...rowData,
        [`quantity_${periodKey}`]: newQuantity,
        [`price_${periodKey}`]: newPrice,
        [`revenue_${periodKey}`]: newRevenue
      };

      // Recalculate totals
      let totalQuantity = 0;
      let totalRevenue = 0;
      timePeriods.forEach(period => {
        const qty = updatedData[rowIndex][`quantity_${period.key}`] || 0;
        const rev = updatedData[rowIndex][`revenue_${period.key}`] || 0;
        totalQuantity += qty;
        totalRevenue += rev;
      });
      updatedData[rowIndex].total_quantity = totalQuantity;
      updatedData[rowIndex].total_revenue = totalRevenue;

      // Update the context data
      onDataChange(updatedData);

      // Update the database record using the correct API endpoint
      const saleRecord = {
        unit_id: rowData.product_id,
        customer_id: rowData.customer_id,
        period: periodKey,
        quantity: newQuantity,
        unit_price: newPrice,
        total_revenue: newRevenue,
        forecast_id: activeScenario || 'F001' // Use active scenario or default
      };

      // Use the bulkUpdateForecast function instead of updateSalesRecord
      await actions.bulkUpdateForecast([saleRecord], 'replace');

      setEditModal(null);
      toast.success('Revenue updated successfully');
    } catch (error) {
      console.error('Error updating revenue:', error);
      toast.error('Failed to update revenue');
    }
  };

  // Generate columns for the matrix grid
  const matrixColumns = useMemo(() => {
    const columns = [
      { key: 'product_name', title: 'Unit', type: 'text', required: true, width: 120 },
      { key: 'customer_name', title: 'Customer', type: 'text', required: true, width: 120 },
      { key: 'segment', title: 'Segment', type: 'text', width: 80 }
    ];

    // Add revenue columns for each time period
    timePeriods.forEach(period => {
      const shortLabel = period.label.replace(/\s+/g, '');
      columns.push({
        key: `revenue_${period.key}`,
        title: `Revenue ${shortLabel}`,
        type: 'number',
        min: 0,
        width: 100,
        format: (value) => value ? `$${value.toLocaleString()}` : '$0',
        onClick: (rowIndex, colIndex, rowData) => handleRevenueCellClick(rowIndex, colIndex, period.key, rowData),
        title: `Revenue ${shortLabel}`
      });
    });

    // Add total columns
    columns.push(
      {
        key: 'total_quantity',
        title: 'Total Qty',
        type: 'number',
        width: 80,
        format: (value) => value ? value.toLocaleString() : '0'
      },
      {
        key: 'total_revenue',
        title: 'Total $',
        type: 'number',
        width: 100,
        format: (value) => value ? `$${value.toLocaleString()}` : '$0'
      }
    );

    return columns;
  }, [timePeriods, handleRevenueCellClick]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            📊 Revenue Matrix
            <Badge variant="secondary" className="bg-orange-100 text-orange-800">
              {filteredMatrixData.length} entries
            </Badge>
          </CardTitle>
          {onAddForecastLine && (
            <Button 
              onClick={onAddForecastLine}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              ➕ Add Forecast Line
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {filteredMatrixData.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">📊</div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No forecast data found</h3>
            <p className="text-gray-600 mb-4">
              No revenue forecast data exists for the current scenario ({activeScenario || 'F001'}).
            </p>
            <p className="text-gray-500">
              Click "Add Forecast Line" to create your first forecast entry.
            </p>
          </div>
        ) : (
          <EditableGrid
            key={`grid-${timePeriods.map(p => p.key).join('-')}`}
            data={filteredMatrixData}
            columns={matrixColumns}
            onDataChange={onDataChange}
            onCellChange={onCellChange}
            enableDragFill={true}
            enableBulkEdit={true}
            enableKeyboardNavigation={true}
            className="revenue-matrix"
          />
        )}

        {/* Edit Modal */}
        {editModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <Card className="w-full max-w-md">
              <CardHeader>
                <CardTitle>Edit Revenue</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Product:</label>
                  <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">{editModal.rowData.product_name}</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Customer:</label>
                  <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">{editModal.rowData.customer_name}</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Period:</label>
                  <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">{editModal.periodKey}</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Quantity:</label>
                  <input
                    type="number"
                    min="0"
                    value={editModal.quantity}
                    onChange={(e) => {
                      const newQty = parseInt(e.target.value) || 0;
                      const newRevenue = newQty * editModal.price;
                      setEditModal(prev => ({
                        ...prev,
                        quantity: newQty,
                        revenue: newRevenue
                      }));
                    }}
                    className="w-full p-2 border border-gray-300 rounded focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Unit Price:</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editModal.price}
                    onChange={(e) => {
                      const newPrice = parseFloat(e.target.value) || 0;
                      const newRevenue = editModal.quantity * newPrice;
                      setEditModal(prev => ({
                        ...prev,
                        price: newPrice,
                        revenue: newRevenue
                      }));
                    }}
                    className="w-full p-2 border border-gray-300 rounded focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Total Revenue:</label>
                  <p className="text-lg font-semibold text-orange-600">${editModal.revenue.toLocaleString()}</p>
                </div>
                <div className="flex gap-2 pt-4">
                  <Button 
                    onClick={() => handleSaveEdit(editModal.quantity, editModal.price)}
                    className="flex-1 bg-orange-600 hover:bg-orange-700"
                  >
                    Save
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => setEditModal(null)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default RevenueMatrix; 
