import React, { useMemo, useState, useCallback } from 'react';
import EditableGrid from '../../Common/EditableGrid';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import ColumnVisibilityMenu from './ColumnVisibilityMenu';

const RevenueMatrix = ({ 
  data, 
  timePeriods, 
  selectedSegment,
  onDataChange, 
  onCellChange,
  timeRange,
  onTimeRangeChange,
  visibleColumns,
  onColumnVisibilityChange,
  groupByYear,
  onGroupByYear
}) => {
  const { actions, activeScenario } = useForecast();
  const [editingCell, setEditingCell] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [savingCells, setSavingCells] = useState(new Set());

  // Cache active sales for the scenario
  const activeSales = useMemo(() => {
    const sales = Array.isArray(data.sales_forecast) ? data.sales_forecast : [];
    const scenarioId = activeScenario || 'F001';
    return sales.filter(s => s.forecast_id === scenarioId);
  }, [data.sales_forecast, activeScenario]);

  // Cache forecast combinations set
  const forecastCombinations = useMemo(() => {
    const combinations = new Set();
    activeSales.forEach(sale => {
      const combinationKey = `${sale.unit_id}-${sale.customer_id}`;
      combinations.add(combinationKey);
    });
    return combinations;
  }, [activeSales]);

  // Cache product name to ID mapping
  const productNameToId = useMemo(() => {
    const products = Array.isArray(data.products) ? data.products : [];
    const mapping = {};
    products.forEach(product => {
      if (product.unit_name) {
        mapping[product.unit_name] = product.unit_id || product.id;
      }
    });
    return mapping;
  }, [data.products]);

  // Cache sales lookup map for faster period lookups
  const salesLookupMap = useMemo(() => {
    const map = new Map();
    const scenarioId = activeScenario || 'F001';
    activeSales.forEach(sale => {
      const key = `${sale.unit_id}-${sale.customer_id}-${sale.period}`;
      map.set(key, sale);
    });
    return map;
  }, [activeSales, activeScenario]);

  // Generate product-customer matrix data - ONLY for combinations that have actual forecast data
  const matrixData = useMemo(() => {
    const matrix = [];
    const products = Array.isArray(data.products) ? data.products : [];
    const customers = Array.isArray(data.customers) ? data.customers : [];
    const scenarioId = activeScenario || 'F001';
    
    // Only create matrix rows for combinations that have forecast data
    products.forEach(product => {
      customers.forEach(customer => {
        const productId = product.unit_id || product.id;
        const combinationKey = `${productId}-${customer.customer_id}`;
        
        // Check if this combination has forecast data (direct match or name-based match)
        const hasDirectMatch = forecastCombinations.has(combinationKey);
        const hasNameMatch = product.unit_name && forecastCombinations.has(`${product.unit_name}-${customer.customer_id}`);
        
        if (hasDirectMatch || hasNameMatch) {
          const baseRow = {
            id: combinationKey,
            product_id: productId,
            product_name: product.unit_name || product.name,
            customer_id: customer.customer_id,
            customer_name: customer.customer_name,
            segment: customer.customer_type || customer.region || 'General',
            total_quantity: 0,
            total_revenue: 0
          };

          // Add time period columns using cached lookup
          timePeriods.forEach(period => {
            // Try direct match first, then name match
            const directKey = `${productId}-${customer.customer_id}-${period.key}`;
            const nameKey = product.unit_name ? `${product.unit_name}-${customer.customer_id}-${period.key}` : null;
            
            const existingSale = salesLookupMap.get(directKey) || (nameKey ? salesLookupMap.get(nameKey) : null);
            
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
  }, [data.products, data.customers, forecastCombinations, productNameToId, salesLookupMap, timePeriods, activeScenario]);

  // Filter matrix data by segment
  const filteredMatrixData = useMemo(() => {
    if (selectedSegment === 'all') return matrixData;
    return matrixData.filter(row => row.segment === selectedSegment);
  }, [matrixData, selectedSegment]);

  // Handle inline cell editing for revenue cells
  const handleRevenueCellClick = useCallback((rowIndex, colIndex, periodKey, rowData) => {
    // For inline editing, we'll handle this in the EditableGrid's onClick
    // This function is kept for backward compatibility but won't show modal
    const quantity = rowData[`quantity_${periodKey}`] || 0;
    const price = rowData[`price_${periodKey}`] || 0;
    
    // Set editing state for inline editing
    setEditingCell({
      rowIndex,
      colIndex,
      periodKey,
      rowData,
      quantity,
      price,
      revenue: quantity * price
    });
  }, []);
  
  // Handle inline save for revenue cells
  const handleInlineSave = useCallback(async (rowIndex, periodKey, newQuantity, newPrice) => {
    const rowData = filteredMatrixData[rowIndex];
    if (!rowData) return;
    
    const newRevenue = newQuantity * newPrice;
    const cellKey = `${rowIndex}-${periodKey}`;
    
    try {
      // Show loading indicator for this cell
      setSavingCells(prev => new Set(prev).add(cellKey));
      
      // Update the matrix data optimistically
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

      // Save to database with optimistic update
      const saleRecord = {
        unit_id: rowData.product_id,
        customer_id: rowData.customer_id,
        period: periodKey,
        quantity: newQuantity,
        unit_price: newPrice,
        total_revenue: newRevenue,
        forecast_id: activeScenario || 'F001'
      };

      await actions.updateSalesForecastOptimistic([saleRecord], 'replace');
      setEditingCell(null);
    } catch (error) {
      console.error('Error updating revenue:', error);
      toast.error('Failed to update revenue');
    } finally {
      // Remove loading indicator
      setSavingCells(prev => {
        const next = new Set(prev);
        next.delete(cellKey);
        return next;
      });
    }
  }, [filteredMatrixData, timePeriods, onDataChange, actions, activeScenario]);

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

      // Use optimistic update for immediate feedback
      actions.updateSalesForecastOptimistic([saleRecord], 'replace');

      setEditModal(null);
      // Suppress success toast to reduce notification barrage
    } catch (error) {
      console.error('Error updating revenue:', error);
      toast.error('Failed to update revenue');
    }
  };

  // Filter time periods based on visible columns
  const visibleTimePeriods = useMemo(() => {
    if (!visibleColumns || visibleColumns.length === 0) {
      return timePeriods;
    }
    return timePeriods.filter(period => visibleColumns.includes(period.key));
  }, [timePeriods, visibleColumns]);

  // Generate columns for the matrix grid with inline editing support
  const matrixColumns = useMemo(() => {
    const columns = [
      { key: 'product_name', title: 'Unit', type: 'text', required: true, width: 120, sticky: true },
      { key: 'customer_name', title: 'Customer', type: 'text', required: true, width: 120, sticky: true },
      { key: 'segment', title: 'Segment', type: 'text', width: 80, sticky: true }
    ];

    // Add revenue columns for each visible time period
    visibleTimePeriods.forEach(period => {
      const shortLabel = period.label.replace(/\s+/g, '');
      columns.push({
        key: `revenue_${period.key}`,
        title: `Revenue ${shortLabel}`,
        type: 'number',
        min: 0,
        width: 120,
        format: (value) => value ? `$${value.toLocaleString()}` : '$0',
        onClick: (rowIndex, colIndex, rowData) => {
          // Set editing state for inline editing
          const quantity = rowData[`quantity_${period.key}`] || 0;
          const price = rowData[`price_${period.key}`] || 0;
          setEditingCell({
            rowIndex,
            colIndex,
            periodKey: period.key,
            rowData,
            quantity,
            price,
            revenue: quantity * price
          });
        }
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
  }, [visibleTimePeriods]);

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
          <ColumnVisibilityMenu
            timePeriods={timePeriods}
            timeRange={timeRange}
            onTimeRangeChange={onTimeRangeChange}
            onColumnVisibilityChange={onColumnVisibilityChange}
            onGroupByYear={onGroupByYear}
            groupByYear={groupByYear}
            visibleColumns={visibleColumns}
          />
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

        {/* Inline Edit Overlay */}
        {editingCell && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-20 flex items-center justify-center z-50"
            onClick={() => setEditingCell(null)}
          >
            <div 
              className="bg-white rounded-lg shadow-xl p-4 min-w-[400px]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                  <h3 className="text-lg font-semibold">Edit Revenue</h3>
                  <button
                    onClick={() => setEditingCell(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Product:</label>
                  <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">{editingCell.rowData.product_name}</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Customer:</label>
                  <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">{editingCell.rowData.customer_name}</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Period:</label>
                  <p className="text-sm text-gray-900 bg-gray-50 p-2 rounded">{editingCell.periodKey}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Quantity:</label>
                    <input
                      type="number"
                      min="0"
                      value={editingCell.quantity}
                      onChange={(e) => {
                        const newQty = parseInt(e.target.value) || 0;
                        setEditingCell(prev => ({
                          ...prev,
                          quantity: newQty,
                          revenue: newQty * prev.price
                        }));
                      }}
                      className="w-full p-2 border border-gray-300 rounded focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                      autoFocus
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Unit Price:</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editingCell.price}
                      onChange={(e) => {
                        const newPrice = parseFloat(e.target.value) || 0;
                        setEditingCell(prev => ({
                          ...prev,
                          price: newPrice,
                          revenue: prev.quantity * newPrice
                        }));
                      }}
                      className="w-full p-2 border border-gray-300 rounded focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">Total Revenue:</label>
                  <p className="text-lg font-semibold text-orange-600">${editingCell.revenue.toLocaleString()}</p>
                </div>
                <div className="flex gap-2 pt-4 border-t">
                  <Button 
                    onClick={() => handleInlineSave(editingCell.rowIndex, editingCell.periodKey, editingCell.quantity, editingCell.price)}
                    className="flex-1 bg-orange-600 hover:bg-orange-700"
                  >
                    Save
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => setEditingCell(null)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Legacy Edit Modal - kept for backward compatibility but should not be used */}
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

export default React.memo(RevenueMatrix); 
