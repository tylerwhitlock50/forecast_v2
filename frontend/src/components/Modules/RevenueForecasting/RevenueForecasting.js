import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import EditableGrid from '../../Common/EditableGrid';
import ValidationIndicator from '../../Common/ValidationIndicator';
import { toast } from 'react-hot-toast';
import './RevenueForecasting.css';

const RevenueForecasting = () => {
  const { data, actions, loading, scenarios, activeScenario } = useForecast();
  const [activeTab, setActiveTab] = useState('matrix');
  const [selectedSegment, setSelectedSegment] = useState('all');
  const [timeRange, setTimeRange] = useState('monthly');
  const [forecastData, setForecastData] = useState([]);
  const [segments, setSegments] = useState([]);
  const [bulkImportMode, setBulkImportMode] = useState(false);
  const [showNewScenarioModal, setShowNewScenarioModal] = useState(false);

  // Initialize forecast data
  useEffect(() => {
    if (Array.isArray(data.forecasts)) {
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
    
    const products = Array.isArray(data.products) ? data.products : [];
    const customers = Array.isArray(data.customers) ? data.customers : [];
    
    products.forEach(product => {
      customers.forEach(customer => {
        const baseRow = {
          id: `${product.id}-${customer.customer_id}`,
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
          const existingForecast = forecastData.find(f => 
            f.product_id === product.id && 
            f.customer_id === customer.customer_id && 
            f.period === period.key
          );
          
          baseRow[`quantity_${period.key}`] = existingForecast?.quantity || 0;
          baseRow[`price_${period.key}`] = existingForecast?.price || product.base_price || 0;
          baseRow[`revenue_${period.key}`] = (existingForecast?.quantity || 0) * (existingForecast?.price || product.base_price || 0);
          
          baseRow.total_quantity += existingForecast?.quantity || 0;
          baseRow.total_revenue += (existingForecast?.quantity || 0) * (existingForecast?.price || product.base_price || 0);
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
      { key: 'product_name', title: 'Unit', type: 'text', required: true, width: 150 },
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
    const updatedForecasts = [];
    
    newData.forEach(row => {
      timePeriods.forEach(period => {
        const quantity = row[`quantity_${period.key}`] || 0;
        const price = row[`price_${period.key}`] || 0;
        
        if (quantity > 0 || price > 0) {
          const forecastItem = {
            product_id: row.product_id,
            customer_id: row.customer_id,
            period: period.key,
            quantity: quantity,
            price: price,
            total_revenue: quantity * price,
            forecast_id: activeScenario
          };

          updatedForecasts.push(forecastItem);
        }
      });
    });

    setForecastData(updatedForecasts);
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
    const customers = Array.isArray(data.customers) ? data.customers : [];
    const uniqueSegments = [...new Set(customers.map(c => c.customer_type || c.region || 'General'))];
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

  // Handle save changes
  const handleSaveChanges = async () => {
    try {
      if (forecastData.length > 0) {
        await actions.bulkUpdateForecast(forecastData);
      } else {
        toast.info('No changes to save');
      }
    } catch (error) {
      toast.error('Failed to save changes');
    }
  };

  // Debug function to log data structure
  const logDataStructure = () => {
    console.log('Current data structure:', {
      products: data.products?.length || 0,
      customers: data.customers?.length || 0,
      forecasts: data.forecasts?.length || 0,
      machines: data.machines?.length || 0,
      employees: data.employees?.length || 0,
      bom: data.bom?.length || 0,
      routing: data.routing?.length || 0
    });
    console.log('Sample products:', data.products?.slice(0, 2));
    console.log('Sample customers:', data.customers?.slice(0, 2));
    console.log('Sample forecasts:', data.forecasts?.slice(0, 2));
    
    // Debug matrix generation
    console.log('Matrix data info:', {
      matrixDataLength: matrixData.length,
      filteredMatrixDataLength: filteredMatrixData.length,
      timePeriodsLength: timePeriods.length,
      selectedSegment: selectedSegment
    });
    
    if (matrixData.length > 0) {
      console.log('First matrix row:', matrixData[0]);
    }
  };

  // Log data structure on component mount
  useEffect(() => {
    if (data.products?.length > 0 || data.customers?.length > 0) {
      logDataStructure();
    }
  }, [data.products, data.customers]);

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

  // Show error state if no data is loaded
  if (!data.products?.length && !data.customers?.length) {
    return (
      <div className="revenue-forecasting">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>No data available. Please check the backend connection.</p>
          <button onClick={() => actions.fetchAllData()} style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}>
            Retry Loading Data
          </button>
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
            <label>Forecast Scenario:</label>
            <select 
              value={activeScenario || 'base'} 
              onChange={(e) => actions.switchScenario(e.target.value)}
              className="scenario-selector"
            >
              {Object.entries(scenarios || {}).map(([id, scenario]) => (
                <option key={id} value={id}>
                  {id} | {scenario.name}
                </option>
              ))}
            </select>
          </div>
          
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
            <button onClick={handleSaveChanges} style={{ backgroundColor: '#28a745', color: 'white', borderColor: '#28a745' }}>
              💾 Save Changes
            </button>
            <button onClick={logDataStructure} style={{ backgroundColor: '#6c757d', color: 'white', borderColor: '#6c757d' }}>
              🐛 Debug Data
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

      {showNewScenarioModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Create New Scenario</h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.target);
              const scenarioData = {
                name: formData.get('name'),
                description: formData.get('description')
              };
              actions.createScenario(scenarioData);
              setShowNewScenarioModal(false);
            }}>
              <div className="form-group">
                <label>Name:</label>
                <input type="text" name="name" required />
              </div>
              <div className="form-group">
                <label>Description:</label>
                <textarea name="description" rows="3"></textarea>
              </div>
              <div className="form-actions">
                <button type="submit">Create</button>
                <button type="button" onClick={() => setShowNewScenarioModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
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
          className={`tab ${activeTab === 'visualization' ? 'active' : ''}`}
          onClick={() => setActiveTab('visualization')}
        >
          Visualizations
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

        {activeTab === 'visualization' && (
          <div className="visualization-tab">
            <h3>Revenue Visualizations</h3>
            <div className="visualization-grid">
              <div className="chart-container">
                <h4>Revenue by Product</h4>
                <div className="simple-chart">
                  {Array.from(new Set(matrixData.map(row => row.product_name))).map(product => {
                    const productRevenue = matrixData
                      .filter(row => row.product_name === product)
                      .reduce((sum, row) => sum + row.total_revenue, 0);
                    const maxRevenue = Math.max(...Array.from(new Set(matrixData.map(row => row.product_name))).map(p => 
                      matrixData.filter(row => row.product_name === p).reduce((sum, row) => sum + row.total_revenue, 0)
                    ));
                    const width = maxRevenue > 0 ? (productRevenue / maxRevenue) * 100 : 0;
                    
                    return (
                      <div key={product} className="chart-bar">
                        <div className="bar-label">{product}</div>
                        <div className="bar-container">
                          <div className="bar" style={{ width: `${width}%` }}></div>
                          <span className="bar-value">${productRevenue.toLocaleString()}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              
              <div className="chart-container">
                <h4>Revenue by Customer</h4>
                <div className="simple-chart">
                  {Array.from(new Set(matrixData.map(row => row.customer_name))).map(customer => {
                    const customerRevenue = matrixData
                      .filter(row => row.customer_name === customer)
                      .reduce((sum, row) => sum + row.total_revenue, 0);
                    const maxRevenue = Math.max(...Array.from(new Set(matrixData.map(row => row.customer_name))).map(c => 
                      matrixData.filter(row => row.customer_name === c).reduce((sum, row) => sum + row.total_revenue, 0)
                    ));
                    const width = maxRevenue > 0 ? (customerRevenue / maxRevenue) * 100 : 0;
                    
                    return (
                      <div key={customer} className="chart-bar">
                        <div className="bar-label">{customer}</div>
                        <div className="bar-container">
                          <div className="bar" style={{ width: `${width}%` }}></div>
                          <span className="bar-value">${customerRevenue.toLocaleString()}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              
              <div className="chart-container">
                <h4>Revenue by Time Period</h4>
                <div className="simple-chart">
                  {timePeriods.map(period => {
                    const periodRevenue = matrixData.reduce((sum, row) => sum + (row[`revenue_${period.key}`] || 0), 0);
                    const maxRevenue = Math.max(...timePeriods.map(p => 
                      matrixData.reduce((sum, row) => sum + (row[`revenue_${p.key}`] || 0), 0)
                    ));
                    const width = maxRevenue > 0 ? (periodRevenue / maxRevenue) * 100 : 0;
                    
                    return (
                      <div key={period.key} className="chart-bar">
                        <div className="bar-label">{period.label}</div>
                        <div className="bar-container">
                          <div className="bar" style={{ width: `${width}%` }}></div>
                          <span className="bar-value">${periodRevenue.toLocaleString()}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
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