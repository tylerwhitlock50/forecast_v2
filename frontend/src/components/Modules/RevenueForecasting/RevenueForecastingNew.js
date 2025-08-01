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

// Utility function to generate time periods
const generateTimePeriods = (timeRange, count = 12) => {
  const periods = [];
  const now = new Date();
  
  for (let i = 0; i < count; i++) {
    let date, key, label;
    
    if (timeRange === 'weekly') {
      // Start from the beginning of the current week
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
      date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + (i * 7));
      
      const weekStart = new Date(date);
      const weekEnd = new Date(date);
      weekEnd.setDate(date.getDate() + 6);
      
      // Calculate week number more accurately
      const weekNumber = Math.ceil((date.getDate() + date.getDay()) / 7);
      key = `${date.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
      label = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}-${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    } else if (timeRange === 'monthly') {
      date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      label = `${date.toLocaleDateString('en-US', { month: 'short' })} ${date.getFullYear()}`;
    } else if (timeRange === 'quarterly') {
      date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const quarter = Math.floor(date.getMonth() / 3) + 1;
      key = `${date.getFullYear()}-Q${quarter}`;
      label = `Q${quarter} ${date.getFullYear()}`;
    }
    
    periods.push({ key, label });
  }
  
  return periods;
};

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
  const [customDateRange, setCustomDateRange] = useState(null); // { start: { month: 9, year: 2025 }, end: { month: 12, year: 2025 } }

  // Generate months and years for dropdowns
  const months = [
    { value: 1, label: 'January' },
    { value: 2, label: 'February' },
    { value: 3, label: 'March' },
    { value: 4, label: 'April' },
    { value: 5, label: 'May' },
    { value: 6, label: 'June' },
    { value: 7, label: 'July' },
    { value: 8, label: 'August' },
    { value: 9, label: 'September' },
    { value: 10, label: 'October' },
    { value: 11, label: 'November' },
    { value: 12, label: 'December' }
  ];

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 10 }, (_, i) => currentYear + i);

  // Helper function to format date range for period generation
  const getFormattedDateRange = () => {
    if (!customDateRange) return null;
    
    const startMonth = String(customDateRange.start.month).padStart(2, '0');
    const endMonth = String(customDateRange.end.month).padStart(2, '0');
    
    return {
      start: `${customDateRange.start.year}-${startMonth}`,
      end: `${customDateRange.end.year}-${endMonth}`
    };
  };

  // Generate time periods with improved logic
  const timePeriods = useMemo(() => {
    const formattedRange = getFormattedDateRange();
    
    if (formattedRange) {
      // Generate periods for custom date range
      const periods = [];
      
      // Parse periods correctly (YYYY-MM format)
      const [startYear, startMonth] = formattedRange.start.split('-').map(Number);
      const [endYear, endMonth] = formattedRange.end.split('-').map(Number);
      
      console.log('Generating periods for range:', {
        start: formattedRange.start,
        end: formattedRange.end,
        startYear,
        startMonth,
        endYear,
        endMonth
      });
      
      let currentYear = startYear;
      let currentMonth = startMonth - 1; // JavaScript months are 0-based
      
      while (true) {
        let key, label;
        
        if (timeRange === 'weekly') {
          // For weekly, we'll use monthly periods but with weekly labels
          const date = new Date(currentYear, currentMonth, 1);
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          label = `${date.toLocaleDateString('en-US', { month: 'short' })} ${date.getFullYear()}`;
        } else if (timeRange === 'monthly') {
          const date = new Date(currentYear, currentMonth, 1);
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          label = `${date.toLocaleDateString('en-US', { month: 'short' })} ${date.getFullYear()}`;
        } else if (timeRange === 'quarterly') {
          const date = new Date(currentYear, currentMonth, 1);
          const quarter = Math.floor(date.getMonth() / 3) + 1;
          key = `${date.getFullYear()}-Q${quarter}`;
          label = `Q${quarter} ${date.getFullYear()}`;
        }
        
        periods.push({ key, label });
        
        console.log(`Added period: ${key} - ${label} (currentYear: ${currentYear}, currentMonth: ${currentMonth})`);
        
        // Check if we've reached the end (inclusive of end month)
        if (currentYear === endYear && currentMonth === (endMonth - 1)) {
          console.log('Reached end condition, breaking loop');
          break;
        }
        
        // Move to next month
        currentMonth++;
        if (currentMonth > 11) {
          currentMonth = 0;
          currentYear++;
        }
        
        // Additional safety check to prevent infinite loops
        if (currentYear > endYear || (currentYear === endYear && currentMonth > (endMonth - 1))) {
          console.log('Safety check triggered, breaking loop');
          break;
        }
      }
      
      console.log(`Generated ${periods.length} periods:`, periods.map(p => p.key));
      return periods;
    } else {
      // Use default logic (current date + next N months)
      const monthCount = timeRange === 'monthly' ? 12 : timeRange === 'quarterly' ? 4 : 52;
      return generateTimePeriods(timeRange, monthCount);
    }
  }, [timeRange, customDateRange]);

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
      
      // Auto-set custom date range based on the periods being added
      if (salesRecords.length > 0) {
        const periods = salesRecords.map(s => s.period).sort();
        const startPeriod = periods[0];
        const endPeriod = periods[periods.length - 1];
        
        // Extract year and month from period keys
        const startMatch = startPeriod.match(/^(\d{4})-(\d{2})/);
        const endMatch = endPeriod.match(/^(\d{4})-(\d{2})/);
        
        if (startMatch && endMatch) {
          const startMonth = parseInt(startMatch[2]);
          const startYear = parseInt(startMatch[1]);
          const endMonth = parseInt(endMatch[2]);
          const endYear = parseInt(endMatch[1]);
          
          setCustomDateRange({
            start: { month: startMonth, year: startYear },
            end: { month: endMonth, year: endYear }
          });
          toast.success(`Matrix view updated to show periods: ${startMonth}/${startYear} to ${endMonth}/${endYear}`);
        }
      }
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
          <Select value={selectedSegment} onChange={(e) => setSelectedSegment(e.target.value)}>
            <SelectOption value="all">All Segments</SelectOption>
            {segments.map(segment => (
              <SelectOption key={segment} value={segment}>{segment}</SelectOption>
            ))}
          </Select>
        </div>
        
        <div className="flex items-center gap-2">
          <Label>Time Range:</Label>
          <Select value={timeRange} onChange={(e) => setTimeRange(e.target.value)}>
            <SelectOption value="monthly">Monthly</SelectOption>
            <SelectOption value="quarterly">Quarterly</SelectOption>
            <SelectOption value="weekly">Weekly</SelectOption>
          </Select>
        </div>
        
        <div className="flex items-center gap-2">
          <Label>Date Range:</Label>
          <Select 
            value={customDateRange ? 'custom' : 'default'} 
            onChange={(e) => {
              if (e.target.value === 'default') {
                setCustomDateRange(null);
              } else if (e.target.value === 'custom') {
                // Set a default custom range
                const now = new Date();
                setCustomDateRange({ 
                  start: { month: now.getMonth() + 1, year: now.getFullYear() }, 
                  end: { month: 12, year: now.getFullYear() } 
                });
              }
            }}
          >
            <SelectOption value="default">Current + 12 months</SelectOption>
            <SelectOption value="custom">Custom Range</SelectOption>
          </Select>
        </div>
        
        {customDateRange && (
          <>
            <div className="flex items-center gap-2">
              <Label>Start:</Label>
              <div className="flex gap-1">
                <Select
                  value={customDateRange.start.month}
                  onChange={(e) => setCustomDateRange(prev => ({ 
                    ...prev, 
                    start: { ...prev.start, month: parseInt(e.target.value) }
                  }))}
                  className="w-24"
                >
                  {months.map(month => (
                    <SelectOption key={month.value} value={month.value}>
                      {month.label}
                    </SelectOption>
                  ))}
                </Select>
                <Select
                  value={customDateRange.start.year}
                  onChange={(e) => setCustomDateRange(prev => ({ 
                    ...prev, 
                    start: { ...prev.start, year: parseInt(e.target.value) }
                  }))}
                  className="w-20"
                >
                  {years.map(year => (
                    <SelectOption key={year} value={year}>
                      {year}
                    </SelectOption>
                  ))}
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label>End:</Label>
              <div className="flex gap-1">
                <Select
                  value={customDateRange.end.month}
                  onChange={(e) => setCustomDateRange(prev => ({ 
                    ...prev, 
                    end: { ...prev.end, month: parseInt(e.target.value) }
                  }))}
                  className="w-24"
                >
                  {months.map(month => (
                    <SelectOption key={month.value} value={month.value}>
                      {month.label}
                    </SelectOption>
                  ))}
                </Select>
                <Select
                  value={customDateRange.end.year}
                  onChange={(e) => setCustomDateRange(prev => ({ 
                    ...prev, 
                    end: { ...prev.end, year: parseInt(e.target.value) }
                  }))}
                  className="w-20"
                >
                  {years.map(year => (
                    <SelectOption key={year} value={year}>
                      {year}
                    </SelectOption>
                  ))}
                </Select>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCustomDateRange(null)}
            >
              Reset
            </Button>
          </>
        )}
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

      {showDataDebugger && <DataDebugger data={data} timePeriods={timePeriods} />}

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