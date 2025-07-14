import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import EditableGrid from '../../Common/EditableGrid';
import ValidationIndicator from '../../Common/ValidationIndicator';
import { toast } from 'react-hot-toast';
import './RevenueForecasting.css';

const RevenueForecasting = () => {
  const { data, actions, loading } = useForecast();
  const [activeTab, setActiveTab] = useState('matrix');
  const [selectedSegment, setSelectedSegment] = useState('all');
  const [timeRange, setTimeRange] = useState('monthly');
  const [forecastData, setForecastData] = useState([]);
  const [segments, setSegments] = useState([]);
  const [bulkImportMode, setBulkImportMode] = useState(false);

  // Initialize forecast data
  useEffect(() => {
    if (data.forecasts) {
      setForecastData(data.forecasts);
    }
  }, [data.forecasts]);

  // Generate time periods
  const timePeriods = useMemo(() => {
    const periods = [];
    const now = new Date();
    const monthCount = timeRange === 'monthly' ? 12 : 4;
    
    for (let i = 0; i < monthCount; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      periods.push({
        key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
        label: timeRange === 'monthly' 
          ? date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
          : `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`
      });
    }
    
    return periods;
  }, [timeRange]);

  // Generate product-customer matrix data
  const matrixData = useMemo(() => {
    const matrix = [];
    
    data.products.forEach(product => {
      data.customers.forEach(customer => {
        const baseRow = {
          id: `${product.id}-${customer.id}`,
          product_id: product.id,
          product_name: product.name,
          customer_id: customer.id,
          customer_name: customer.name,
          segment: customer.segment || 'General',
          total_quantity: 0,
          total_revenue: 0
        };

        // Add time period columns
        timePeriods.forEach(period => {
          const existingForecast = forecastData.find(f => 
            f.product_id === product.id && 
            f.customer_id === customer.id && 
            f.period === period.key
          );
          
          baseRow[`quantity_${period.key}`] = existingForecast?.quantity || 0;
          baseRow[`price_${period.key}`] = existingForecast?.price || 0;
          baseRow[`revenue_${period.key}`] = (existingForecast?.quantity || 0) * (existingForecast?.price || 0);
          
          baseRow.total_quantity += existingForecast?.quantity || 0;
          baseRow.total_revenue += (existingForecast?.quantity || 0) * (existingForecast?.price || 0);
        });

        matrix.push(baseRow);
      });
    });

    return matrix;
  }, [data.products, data.customers, forecastData, timePeriods]);

  // Filter matrix data by segment
  const filteredMatrixData = useMemo(() => {
    if (selectedSegment === 'all') return matrixData;
    return matrixData.filter(row => row.segment === selectedSegment);
  }, [matrixData, selectedSegment]);

  // Generate columns for the matrix grid
  const matrixColumns = useMemo(() => {
    const columns = [
      { key: 'product_name', title: 'Product', type: 'text', required: true, width: 150 },
      { key: 'customer_name', title: 'Customer', type: 'text', required: true, width: 150 },
      { key: 'segment', title: 'Segment', type: 'text', width: 100 }
    ];

    // Add quantity and price columns for each time period
    timePeriods.forEach(period => {
      columns.push({
        key: `quantity_${period.key}`,
        title: `Qty ${period.label}`,
        type: 'number',
        min: 0,
        width: 80,
        format: (value) => value ? value.toLocaleString() : ''
      });
      columns.push({
        key: `price_${period.key}`,
        title: `Price ${period.label}`,
        type: 'number',
        min: 0,
        width: 80,
        format: (value) => value ? `$${value.toFixed(2)}` : ''
      });
    });

    // Add total columns
    columns.push(
      {
        key: 'total_quantity',
        title: 'Total Qty',
        type: 'number',
        width: 100,
        format: (value) => value ? value.toLocaleString() : '0'
      },
      {
        key: 'total_revenue',
        title: 'Total Revenue',
        type: 'number',
        width: 120,
        format: (value) => value ? `$${value.toLocaleString()}` : '$0'
      }
    );

    return columns;
  }, [timePeriods]);

  // Handle matrix data changes
  const handleMatrixDataChange = (newData) => {
    setForecastData(prevData => {
      const updatedForecasts = [...prevData];
      
      newData.forEach(row => {
        timePeriods.forEach(period => {
          const quantity = row[`quantity_${period.key}`];
          const price = row[`price_${period.key}`];
          
          if (quantity > 0 || price > 0) {
            const existingIndex = updatedForecasts.findIndex(f => 
              f.product_id === row.product_id && 
              f.customer_id === row.customer_id && 
              f.period === period.key
            );

            const forecastItem = {
              product_id: row.product_id,
              customer_id: row.customer_id,
              period: period.key,
              quantity: quantity || 0,
              price: price || 0,
              total_revenue: (quantity || 0) * (price || 0)
            };

            if (existingIndex >= 0) {
              updatedForecasts[existingIndex] = forecastItem;
            } else {
              updatedForecasts.push(forecastItem);
            }
          }
        });
      });

      return updatedForecasts;
    });
  };

  // Handle cell changes
  const handleCellChange = (rowIndex, colIndex, value, columnKey) => {
    const row = filteredMatrixData[rowIndex];
    
    // If it's a quantity or price column, update the corresponding revenue
    if (columnKey.startsWith('quantity_') || columnKey.startsWith('price_')) {
      const period = columnKey.split('_')[1];
      const isQuantity = columnKey.startsWith('quantity_');
      
      const currentQuantity = isQuantity ? value : row[`quantity_${period}`];
      const currentPrice = isQuantity ? row[`price_${period}`] : value;
      
      const newRevenue = (currentQuantity || 0) * (currentPrice || 0);
      
      // Update the revenue column
      const newData = [...filteredMatrixData];
      newData[rowIndex] = {
        ...row,
        [columnKey]: value,
        [`revenue_${period}`]: newRevenue
      };
      
      handleMatrixDataChange(newData);
    }
  };

  // Get unique segments
  useEffect(() => {
    const uniqueSegments = [...new Set(data.customers.map(c => c.segment || 'General'))];
    setSegments(uniqueSegments);
  }, [data.customers]);

  // Handle bulk import
  const handleBulkImport = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csv = e.target.result;
        const lines = csv.split('\n');
        const headers = lines[0].split(',');
        
        const importedData = lines.slice(1).map(line => {
          const values = line.split(',');
          const item = {};
          headers.forEach((header, index) => {
            item[header.trim()] = values[index]?.trim();
          });
          return item;
        });

        // Process imported data and merge with existing forecasts
        const newForecasts = importedData.map(item => ({
          product_id: item.product_id,
          customer_id: item.customer_id,
          period: item.period,
          quantity: parseFloat(item.quantity) || 0,
          price: parseFloat(item.price) || 0,
          total_revenue: (parseFloat(item.quantity) || 0) * (parseFloat(item.price) || 0)
        }));

        setForecastData(prev => [...prev, ...newForecasts]);
        toast.success(`Imported ${newForecasts.length} forecast items`);
      } catch (error) {
        toast.error('Failed to import file');
      }
    };
    reader.readAsText(file);
  };

  // Handle bulk export
  const handleBulkExport = () => {
    const exportData = filteredMatrixData.map(row => {
      const exportRow = {
        product_name: row.product_name,
        customer_name: row.customer_name,
        segment: row.segment
      };
      
      timePeriods.forEach(period => {
        exportRow[`quantity_${period.key}`] = row[`quantity_${period.key}`];
        exportRow[`price_${period.key}`] = row[`price_${period.key}`];
        exportRow[`revenue_${period.key}`] = row[`revenue_${period.key}`];
      });
      
      return exportRow;
    });

    const csv = [
      Object.keys(exportData[0]).join(','),
      ...exportData.map(row => Object.values(row).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `revenue-forecast-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Calculate summary statistics
  const summaryStats = useMemo(() => {
    const totalQuantity = filteredMatrixData.reduce((sum, row) => sum + row.total_quantity, 0);
    const totalRevenue = filteredMatrixData.reduce((sum, row) => sum + row.total_revenue, 0);
    const productCount = new Set(filteredMatrixData.map(row => row.product_id)).size;
    const customerCount = new Set(filteredMatrixData.map(row => row.customer_id)).size;

    return {
      totalQuantity,
      totalRevenue,
      productCount,
      customerCount,
      averagePrice: totalQuantity > 0 ? totalRevenue / totalQuantity : 0
    };
  }, [filteredMatrixData]);

  if (loading) {
    return (
      <div className="revenue-forecasting">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading revenue data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="revenue-forecasting">
      <div className="revenue-header">
        <h2>Revenue Forecasting</h2>
        <div className="revenue-controls">
          <div className="control-group">
            <label>Segment:</label>
            <select 
              value={selectedSegment} 
              onChange={(e) => setSelectedSegment(e.target.value)}
              className="segment-selector"
            >
              <option value="all">All Segments</option>
              {segments.map(segment => (
                <option key={segment} value={segment}>{segment}</option>
              ))}
            </select>
          </div>
          
          <div className="control-group">
            <label>Time Range:</label>
            <select 
              value={timeRange} 
              onChange={(e) => setTimeRange(e.target.value)}
              className="time-range-selector"
            >
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
            </select>
          </div>
          
          <div className="bulk-actions">
            <button onClick={() => setBulkImportMode(!bulkImportMode)}>
              📥 Bulk Import
            </button>
            <button onClick={handleBulkExport}>
              📤 Export
            </button>
          </div>
        </div>
      </div>

      {bulkImportMode && (
        <div className="bulk-import-panel">
          <h3>Bulk Import</h3>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => e.target.files[0] && handleBulkImport(e.target.files[0])}
          />
          <button onClick={() => setBulkImportMode(false)}>Cancel</button>
        </div>
      )}

      <div className="revenue-tabs">
        <button 
          className={`tab ${activeTab === 'matrix' ? 'active' : ''}`}
          onClick={() => setActiveTab('matrix')}
        >
          Product-Customer Matrix
        </button>
        <button 
          className={`tab ${activeTab === 'analysis' ? 'active' : ''}`}
          onClick={() => setActiveTab('analysis')}
        >
          Segment Analysis
        </button>
        <button 
          className={`tab ${activeTab === 'validation' ? 'active' : ''}`}
          onClick={() => setActiveTab('validation')}
        >
          Data Validation
        </button>
      </div>

      <div className="revenue-summary">
        <div className="summary-card">
          <h4>Total Revenue</h4>
          <p className="summary-value">${summaryStats.totalRevenue.toLocaleString()}</p>
        </div>
        <div className="summary-card">
          <h4>Total Quantity</h4>
          <p className="summary-value">{summaryStats.totalQuantity.toLocaleString()}</p>
        </div>
        <div className="summary-card">
          <h4>Products</h4>
          <p className="summary-value">{summaryStats.productCount}</p>
        </div>
        <div className="summary-card">
          <h4>Customers</h4>
          <p className="summary-value">{summaryStats.customerCount}</p>
        </div>
        <div className="summary-card">
          <h4>Avg Price</h4>
          <p className="summary-value">${summaryStats.averagePrice.toFixed(2)}</p>
        </div>
      </div>

      <div className="revenue-content">
        {activeTab === 'matrix' && (
          <div className="matrix-tab">
            <EditableGrid
              data={filteredMatrixData}
              columns={matrixColumns}
              onDataChange={handleMatrixDataChange}
              onCellChange={handleCellChange}
              enableDragFill={true}
              enableBulkEdit={true}
              enableKeyboardNavigation={true}
              className="revenue-matrix"
            />
          </div>
        )}

        {activeTab === 'analysis' && (
          <div className="analysis-tab">
            <h3>Segment Analysis</h3>
            <div className="segment-charts">
              {segments.map(segment => {
                const segmentData = matrixData.filter(row => row.segment === segment);
                const segmentRevenue = segmentData.reduce((sum, row) => sum + row.total_revenue, 0);
                const segmentQuantity = segmentData.reduce((sum, row) => sum + row.total_quantity, 0);
                
                return (
                  <div key={segment} className="segment-card">
                    <h4>{segment}</h4>
                    <div className="segment-metrics">
                      <p>Revenue: ${segmentRevenue.toLocaleString()}</p>
                      <p>Quantity: {segmentQuantity.toLocaleString()}</p>
                      <p>Products: {new Set(segmentData.map(row => row.product_id)).size}</p>
                      <p>Customers: {new Set(segmentData.map(row => row.customer_id)).size}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'validation' && (
          <div className="validation-tab">
            <h3>Data Validation</h3>
            <div className="validation-summary">
              <ValidationIndicator 
                type="error" 
                size="large"
                message={`${data.validation.errors.length} errors found`}
              />
              <ValidationIndicator 
                type="warning" 
                size="large"
                message={`${data.validation.warnings.length} warnings found`}
              />
            </div>
            <div className="validation-issues">
              {data.validation.errors.map((error, index) => (
                <div key={index} className="validation-issue error">
                  <ValidationIndicator type="error" size="small" />
                  <span>{error.message}</span>
                </div>
              ))}
              {data.validation.warnings.map((warning, index) => (
                <div key={index} className="validation-issue warning">
                  <ValidationIndicator type="warning" size="small" />
                  <span>{warning.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RevenueForecasting;