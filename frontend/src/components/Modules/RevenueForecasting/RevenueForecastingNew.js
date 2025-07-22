import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import { PageHeader } from '../../ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Select, SelectOption } from '../../ui/select';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import RevenueMatrix from './RevenueMatrix';
import RevenueSummary from './RevenueSummary';
import RevenueAnalysis from './RevenueAnalysis';
import RevenueVisualizations from './RevenueVisualizations';
import RevenueValidation from './RevenueValidation';
import DataDebugger from './DataDebugger';
import ForecastLineModal from './ForecastLineModal';

const RevenueForecasting = () => {
  const { data, actions, loading, scenarios, activeScenario } = useForecast();
  const [activeTab, setActiveTab] = useState('matrix');
  const [selectedSegment, setSelectedSegment] = useState('all');
  const [timeRange, setTimeRange] = useState('monthly');
  const [segments, setSegments] = useState([]);
  const [bulkImportMode, setBulkImportMode] = useState(false);
  const [showNewScenarioModal, setShowNewScenarioModal] = useState(false);
  const [showForecastLineModal, setShowForecastLineModal] = useState(false);
  const [showDataDebugger, setShowDataDebugger] = useState(false);

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
            unit_id: row.product_id,
            customer_id: row.customer_id,
            period: period.key,
            quantity: quantity,
            unit_price: price,
            total_revenue: quantity * price,
            forecast_id: activeScenario
          };

          updatedSales.push(saleItem);
        }
      });
    });

    actions.updateData('sales_forecast', updatedSales);
  };

  // Handle cell changes
  const handleCellChange = (rowIndex, colIndex, value, columnKey) => {
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

        const newSales = importedData.map(item => ({
          unit_id: item.product_id,
          customer_id: item.customer_id,
          period: item.period ? item.period.substring(0, 7) : item.period,
          quantity: parseFloat(item.quantity) || 0,
          unit_price: parseFloat(item.price) || 0,
          total_revenue: (parseFloat(item.quantity) || 0) * (parseFloat(item.price) || 0),
          forecast_id: activeScenario
        }));

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

        timePeriods.forEach(period => {
          const existingSale = sales.find(s => 
            s.unit_id === product.id && 
            s.customer_id === customer.customer_id && 
            s.period === period.key
          );
          
          baseRow[`quantity_${period.key}`] = existingSale?.quantity || 0;
          baseRow[`price_${period.key}`] = existingSale?.unit_price || 0;
          baseRow[`revenue_${period.key}`] = (existingSale?.quantity || 0) * (existingSale?.unit_price || 0);
        });

        matrixData.push(baseRow);
      });
    });

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

  // Handle forecast line save
  const handleForecastLineSave = async (salesRecords, operation) => {
    try {
      await actions.bulkUpdateForecast(salesRecords, operation);
      await actions.fetchAllData();
    } catch (error) {
      console.error('Error saving forecast line:', error);
      throw error;
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
      <div className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="ml-4 text-muted-foreground">Loading revenue data...</p>
        </div>
      </div>
    );
  }

  // Show error state if no data is loaded
  if (!data.products?.length && !data.customers?.length) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="flex flex-col items-center justify-center h-64 space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-muted-foreground">No data available. Please check the backend connection.</p>
          <Button onClick={() => actions.fetchAllData()}>
            Retry Loading Data
          </Button>
        </div>
      </div>
    );
  }

  const headerActions = [
    {
      label: 'Add Forecast Line',
      onClick: () => setShowForecastLineModal(true),
      variant: 'default',
      className: 'bg-orange-600 hover:bg-orange-700'
    },
    {
      label: 'Bulk Import',
      onClick: () => setBulkImportMode(!bulkImportMode),
      variant: 'outline'
    },
    {
      label: 'Export',
      onClick: handleBulkExport,
      variant: 'outline'
    },
    {
      label: 'Save Changes',
      onClick: handleSaveChanges,
      variant: 'default',
      className: 'bg-orange-600 hover:bg-orange-700'
    }
  ];

  if (showDataDebugger) {
    headerActions.push({
      label: 'Debug Data',
      onClick: logDataStructure,
      variant: 'secondary'
    });
  }

  headerActions.push({
    label: showDataDebugger ? 'Hide Debugger' : 'Show Debugger',
    onClick: () => setShowDataDebugger(!showDataDebugger),
    variant: 'outline'
  });

  return (
    <div className="container mx-auto px-6 py-8">
      <PageHeader
        title="Revenue Forecasting"
        description={`Manage your revenue forecasts and analyze segment performance. ${activeScenario ? `Active scenario: ${activeScenario}` : ''}`}
        actions={headerActions}
      />

      {/* Control Panel */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Label>Segment:</Label>
          <Select value={selectedSegment} onValueChange={setSelectedSegment}>
            <SelectOption value="all">All Segments</SelectOption>
            {segments.map(segment => (
              <SelectOption key={segment} value={segment}>{segment}</SelectOption>
            ))}
          </Select>
        </div>
        
        <div className="flex items-center gap-2">
          <Label>Time Range:</Label>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectOption value="monthly">Monthly</SelectOption>
            <SelectOption value="quarterly">Quarterly</SelectOption>
          </Select>
        </div>
      </div>

      {/* Bulk Import Panel */}
      {bulkImportMode && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Bulk Import</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Input
                type="file"
                accept=".csv"
                onChange={(e) => e.target.files[0] && handleBulkImport(e.target.files[0])}
                className="flex-1"
              />
              <Button variant="outline" onClick={() => setBulkImportMode(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* New Scenario Modal */}
      {showNewScenarioModal && (
        <Modal onClick={() => setShowNewScenarioModal(false)}>
          <div onClick={e => e.stopPropagation()}>
            <ModalHeader>
              <ModalTitle>Create New Scenario</ModalTitle>
              <ModalClose onClick={() => setShowNewScenarioModal(false)} />
            </ModalHeader>
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
              <ModalContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name:</Label>
                  <Input id="name" name="name" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description:</Label>
                  <Textarea id="description" name="description" rows={3} />
                </div>
              </ModalContent>
              <ModalFooter>
                <Button type="button" variant="outline" onClick={() => setShowNewScenarioModal(false)}>
                  Cancel
                </Button>
                <Button type="submit">Create</Button>
              </ModalFooter>
            </form>
          </div>
        </Modal>
      )}

      <ForecastLineModal
        isOpen={showForecastLineModal}
        onClose={() => setShowForecastLineModal(false)}
        onSave={handleForecastLineSave}
      />

      {showDataDebugger && <DataDebugger data={data} />}

      <RevenueSummary 
        data={data} 
        timePeriods={timePeriods} 
        selectedSegment={selectedSegment} 
      />

      {/* Custom Tab Navigation */}
      <div className="space-y-6">
        {/* Tab Buttons */}
        <div className="grid w-full grid-cols-4 bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab('matrix')}
            className={`px-3 py-2 text-sm font-medium rounded-md transition-all ${
              activeTab === 'matrix'
                ? 'bg-white text-orange-700 shadow-sm border border-orange-200'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Product-Customer Matrix
          </button>
          <button
            onClick={() => setActiveTab('analysis')}
            className={`px-3 py-2 text-sm font-medium rounded-md transition-all ${
              activeTab === 'analysis'
                ? 'bg-white text-orange-700 shadow-sm border border-orange-200'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Segment Analysis
          </button>
          <button
            onClick={() => setActiveTab('visualization')}
            className={`px-3 py-2 text-sm font-medium rounded-md transition-all ${
              activeTab === 'visualization'
                ? 'bg-white text-orange-700 shadow-sm border border-orange-200'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Visualizations
          </button>
          <button
            onClick={() => setActiveTab('validation')}
            className={`px-3 py-2 text-sm font-medium rounded-md transition-all ${
              activeTab === 'validation'
                ? 'bg-white text-orange-700 shadow-sm border border-orange-200'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Data Validation
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'matrix' && (
          <div className="space-y-6">
            <RevenueMatrix
              data={data}
              timePeriods={timePeriods}
              selectedSegment={selectedSegment}
              onDataChange={handleMatrixDataChange}
              onCellChange={handleCellChange}
              onAddForecastLine={() => setShowForecastLineModal(true)}
            />
          </div>
        )}

        {activeTab === 'analysis' && (
          <div className="space-y-6">
            <RevenueAnalysis
              data={data}
              timePeriods={timePeriods}
            />
          </div>
        )}

        {activeTab === 'visualization' && (
          <div className="space-y-6">
            <RevenueVisualizations
              data={data}
              timePeriods={timePeriods}
            />
          </div>
        )}

        {activeTab === 'validation' && (
          <div className="space-y-6">
            <RevenueValidation
              data={data}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default RevenueForecasting;