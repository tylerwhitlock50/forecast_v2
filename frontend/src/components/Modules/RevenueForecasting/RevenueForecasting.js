import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import RevenueMatrix from './RevenueMatrix';
import RevenueSummary from './RevenueSummary';
import RevenueAnalysis from './RevenueAnalysis';
import RevenueVisualizations from './RevenueVisualizations';
import RevenueValidation from './RevenueValidation';
import DataDebugger from './DataDebugger';
import './RevenueForecasting.css';

const RevenueForecasting = () => {
  const { data, actions, loading, scenarios, activeScenario } = useForecast();
  const [activeTab, setActiveTab] = useState('matrix');
  const [selectedSegment, setSelectedSegment] = useState('all');
  const [timeRange, setTimeRange] = useState('monthly');
  const [segments, setSegments] = useState([]);
  const [bulkImportMode, setBulkImportMode] = useState(false);
  const [showNewScenarioModal, setShowNewScenarioModal] = useState(false);

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
          ? `${date.toLocaleDateString('en-US', { month: 'short' })}${date.getFullYear().toString().slice(-2)}`
          : `Q${Math.floor(date.getMonth() / 3) + 1}${date.getFullYear().toString().slice(-2)}`
      });
    }
    
    return periods;
  }, [timeRange]);



  // Handle matrix data changes
  const handleMatrixDataChange = (newData) => {
    const updatedSales = [];
    
    newData.forEach(row => {
      timePeriods.forEach(period => {
        const quantity = row[`quantity_${period.key}`] || 0;
        const price = row[`price_${period.key}`] || 0;
        
        if (quantity > 0 || price > 0) {
          const saleItem = {
            unit_id: row.product_id, // Map product_id back to unit_id for backend
            customer_id: row.customer_id,
            period: period.key, // Already in correct format (2025-09)
            quantity: quantity,
            unit_price: price, // Map price back to unit_price for backend
            total_revenue: quantity * price,
            forecast_id: activeScenario
          };

          updatedSales.push(saleItem);
        }
      });
    });

    // Update the sales data in the context
    actions.updateData('sales_forecast', updatedSales);
  };

  // Handle cell changes
  const handleCellChange = (rowIndex, colIndex, value, columnKey) => {
    // This will be handled by the RevenueMatrix component
    console.log('Cell change:', { rowIndex, colIndex, value, columnKey });
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

        // Process imported data and merge with existing sales
        const newSales = importedData.map(item => ({
          unit_id: item.product_id, // Map product_id to unit_id for backend
          customer_id: item.customer_id,
          period: item.period ? item.period.substring(0, 7) : item.period, // Normalize period format
          quantity: parseFloat(item.quantity) || 0,
          unit_price: parseFloat(item.price) || 0, // Map price to unit_price for backend
          total_revenue: (parseFloat(item.quantity) || 0) * (parseFloat(item.price) || 0),
          forecast_id: activeScenario
        }));

        // Update the sales data in the context
        const currentSales = data.sales_forecast || [];
        actions.updateData('sales_forecast', [...currentSales, ...newSales]);
        toast.success(`Imported ${newSales.length} sales items`);
      } catch (error) {
        toast.error('Failed to import file');
      }
    };
    reader.readAsText(file);
  };

  // Handle bulk export
  const handleBulkExport = () => {
    // Generate matrix data for export
    const matrixData = [];
    const products = Array.isArray(data.products) ? data.products : [];
    const customers = Array.isArray(data.customers) ? data.customers : [];
    const sales = Array.isArray(data.sales_forecast) ? data.sales_forecast : [];
    
    products.forEach(product => {
      customers.forEach(customer => {
        const baseRow = {
          product_name: product.name || product.unit_name,
          customer_name: customer.customer_name,
          segment: customer.customer_type || customer.region || 'General'
        };

        // Add time period columns
        timePeriods.forEach(period => {
          const existingSale = sales.find(s => 
            s.unit_id === product.id && 
            s.customer_id === customer.customer_id && 
            s.period === period.key
          );
          
          baseRow[`quantity_${period.key}`] = existingSale?.quantity || 0;
          baseRow[`price_${period.key}`] = existingSale?.unit_price || 0; // Only use actual sale price, not base price
          baseRow[`revenue_${period.key}`] = (existingSale?.quantity || 0) * (existingSale?.unit_price || 0);
        });

        matrixData.push(baseRow);
      });
    });

    // Filter by segment if needed
    const exportData = selectedSegment === 'all' 
      ? matrixData 
      : matrixData.filter(row => row.segment === selectedSegment);

    if (exportData.length === 0) {
      toast.error('No data to export');
      return;
    }

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
    toast.success(`Exported ${exportData.length} rows`);
  };



  // Handle save changes
  const handleSaveChanges = async () => {
    try {
      const salesData = data.sales_forecast || [];
      if (salesData.length > 0) {
        await actions.bulkUpdateForecast(salesData);
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
      sales_forecast: data.sales_forecast?.length || 0,
      machines: data.machines?.length || 0,
      employees: data.employees?.length || 0,
      bom: data.bom?.length || 0,
      routing: data.routing?.length || 0
    });
    console.log('Sample products:', data.products?.slice(0, 2));
    console.log('Sample customers:', data.customers?.slice(0, 2));
    console.log('Sample sales:', data.sales_forecast?.slice(0, 2));
    
    console.log('Time periods:', timePeriods);
    console.log('Selected segment:', selectedSegment);
  };

  // Log data structure on component mount
  useEffect(() => {
    if (data.products?.length > 0 || data.customers?.length > 0) {
      logDataStructure();
    }
  }, [data.products, data.customers, data.sales_forecast]);

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

      <DataDebugger data={data} />

      <RevenueSummary 
        data={data} 
        timePeriods={timePeriods} 
        selectedSegment={selectedSegment} 
      />

      <div className="revenue-content">
        {activeTab === 'matrix' && (
          <RevenueMatrix
            data={data}
            timePeriods={timePeriods}
            selectedSegment={selectedSegment}
            onDataChange={handleMatrixDataChange}
            onCellChange={handleCellChange}
          />
        )}

        {activeTab === 'analysis' && (
          <RevenueAnalysis
            data={data}
            timePeriods={timePeriods}
          />
        )}

        {activeTab === 'visualization' && (
          <RevenueVisualizations
            data={data}
            timePeriods={timePeriods}
          />
        )}

        {activeTab === 'validation' && (
          <RevenueValidation
            data={data}
          />
        )}
      </div>
    </div>
  );
};

export default RevenueForecasting;