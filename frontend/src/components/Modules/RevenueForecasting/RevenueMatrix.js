import React, { useMemo, useState } from 'react';
import EditableGrid from '../../Common/EditableGrid';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import './RevenueForecasting.css';

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
    
    const matrix = [];
    
    const products = Array.isArray(data.products) ? data.products : [];
    const customers = Array.isArray(data.customers) ? data.customers : [];
    const sales = Array.isArray(data.sales_forecast) ? data.sales_forecast : [];
    
    // Create a map of product-customer combinations that have actual forecast data
    const forecastCombinations = new Set();
    sales.forEach(sale => {
      if (sale.forecast_id === (activeScenario || 'F001')) {
        forecastCombinations.add(`${sale.unit_id}-${sale.customer_id}`);
      }
    });
    
    // Only create matrix rows for combinations that have forecast data
    products.forEach(product => {
      customers.forEach(customer => {
        const combinationKey = `${product.id}-${customer.customer_id}`;
        
        // Only include this combination if it has forecast data
        if (forecastCombinations.has(combinationKey)) {
          const baseRow = {
            id: combinationKey,
            product_id: product.id,
            product_name: product.name || product.unit_name,
            customer_id: customer.customer_id,
            customer_name: customer.customer_name,
            segment: customer.customer_type || customer.region || 'General',
            total_quantity: 0,
            total_revenue: 0
          };

          // Add time period columns
          timePeriods.forEach(period => {
            const existingSale = sales.find(s => 
              s.unit_id === product.id && 
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
  }, [timePeriods]);

  return (
    <div className="matrix-tab">
      <div className="matrix-header">
        <h3>Revenue Matrix</h3>
        {onAddForecastLine && (
          <button 
            onClick={onAddForecastLine}
            className="add-forecast-line-btn"
            style={{ 
              backgroundColor: '#007bff', 
              color: 'white', 
              borderColor: '#007bff',
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: '1px solid',
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontWeight: '500'
            }}
          >
            ➕Add Forecast  Line
          </button>
        )}
      </div>

      {filteredMatrixData.length === 0 ? (
        <div style={{ 
          textAlign: 'center', 
          padding: '2rem', 
          color: '#6c757d',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px',
          border: '1px solid #dee2e6'
        }}>
          <h4>No forecast data found</h4>
          <p>No revenue forecast data exists for the current scenario ({activeScenario || 'F001'}).</p>
          <p>Click "Add Forecast Line" to create your first forecast entry.</p>
        </div>
      ) : (
        <EditableGrid
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
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Edit Revenue</h3>
            <div className="edit-form">
              <div className="form-group">
                <label>Product:</label>
                <span>{editModal.rowData.product_name}</span>
              </div>
              <div className="form-group">
                <label>Customer:</label>
                <span>{editModal.rowData.customer_name}</span>
              </div>
              <div className="form-group">
                <label>Period:</label>
                <span>{editModal.periodKey}</span>
              </div>
              <div className="form-group">
                <label>Quantity:</label>
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
                />
              </div>
              <div className="form-group">
                <label>Unit Price:</label>
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
                />
              </div>
              <div className="form-group">
                <label>Total Revenue:</label>
                <span className="revenue-display">${editModal.revenue.toLocaleString()}</span>
              </div>
              <div className="form-actions">
                <button 
                  type="button" 
                  onClick={() => handleSaveEdit(editModal.quantity, editModal.price)}
                  style={{ backgroundColor: '#28a745', color: 'white', borderColor: '#28a745' }}
                >
                  Save
                </button>
                <button type="button" onClick={() => setEditModal(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RevenueMatrix; 