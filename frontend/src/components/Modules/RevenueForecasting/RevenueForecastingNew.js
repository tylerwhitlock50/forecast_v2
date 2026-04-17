import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import api from '../../../lib/apiClient';
import { PageHeader } from '../../ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Select, SelectOption } from '../../ui/select';
import { Label } from '../../ui/label';
import RevenueMatrix from './RevenueMatrix';
import RevenueSummary from './RevenueSummary';
import RevenueAnalysis from './RevenueAnalysis';
import RevenueVisualizations from './RevenueVisualizations';
import RevenueValidation from './RevenueValidation';
import DataDebugger from './DataDebugger';
import ForecastLineModal from './ForecastLineModal';
import DateRangeModal from './DateRangeModal';
import CSVUploadModal from './CSVUploadModal';
import CustomerImportModal from './CustomerImportModal';
import ProductImportModal from './ProductImportModal';
import KeyboardShortcutsModal from './KeyboardShortcutsModal';
import NewScenarioModal from './NewScenarioModal';
import BranchScenarioModal from './BranchScenarioModal';
import { buildTimePeriods, getFormattedDateRange } from './periodUtils';

const RevenueForecasting = () => {
  const { data, actions, loading, scenarios, activeScenario } = useForecast();
  const [activeTab, setActiveTab] = useState('matrix');
  const [selectedSegment, setSelectedSegment] = useState('all');
  const [timeRange, setTimeRange] = useState('monthly');
  const [segments, setSegments] = useState([]);
  const [showNewScenarioModal, setShowNewScenarioModal] = useState(false);
  const [showBranchScenarioModal, setShowBranchScenarioModal] = useState(false);
  const [showForecastLineModal, setShowForecastLineModal] = useState(false);
  const [showDataDebugger, setShowDataDebugger] = useState(false);
  const [showSalesImportModal, setShowSalesImportModal] = useState(false);
  const [showCustomerImportModal, setShowCustomerImportModal] = useState(false);
  const [showProductImportModal, setShowProductImportModal] = useState(false);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [customDateRange, setCustomDateRange] = useState(null);
  const [showDateRangeModal, setShowDateRangeModal] = useState(false);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);

  // Load persisted preferences
  useEffect(() => {
    try {
      const savedTimeRange = localStorage.getItem('revenue_timeRange');
      const savedCustomRange = localStorage.getItem('revenue_customDateRange');
      
      if (savedTimeRange) {
        setTimeRange(savedTimeRange);
      }
      if (savedCustomRange) {
        const parsed = JSON.parse(savedCustomRange);
        if (parsed?.start && parsed?.end) {
          setCustomDateRange(parsed);
        }
      }
    } catch (err) {
      console.warn('Unable to load saved preferences', err);
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Press ? to show shortcuts
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setShowKeyboardShortcuts(true);
      }
      // Press Escape to close shortcuts
      if (e.key === 'Escape' && showKeyboardShortcuts) {
        setShowKeyboardShortcuts(false);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showKeyboardShortcuts]);

  // Persist preferences
  useEffect(() => {
    try {
      localStorage.setItem('revenue_timeRange', timeRange);
      if (customDateRange) {
        localStorage.setItem('revenue_customDateRange', JSON.stringify(customDateRange));
      } else {
        localStorage.removeItem('revenue_customDateRange');
      }
    } catch (err) {
      console.warn('Unable to persist preferences', err);
    }
  }, [timeRange, customDateRange]);
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

  // Generate time periods with improved logic
  const timePeriods = useMemo(() => {
    return buildTimePeriods(timeRange, customDateRange);
  }, [timeRange, customDateRange]);

  const rangeSummary = useMemo(() => {
    const unit = timeRange === 'weekly' ? 'weeks' : timeRange === 'quarterly' ? 'quarters' : 'months';

    if (customDateRange) {
      const monthsInRange = (customDateRange.end.year - customDateRange.start.year) * 12 +
        (customDateRange.end.month - customDateRange.start.month) + 1;
      const periodCount = timePeriods.length || monthsInRange;

      return `${customDateRange.start.month}/${customDateRange.start.year} – ${customDateRange.end.month}/${customDateRange.end.year} • ${periodCount} ${unit}`;
    }

    return `Default: next ${timePeriods.length} ${unit}`;
  }, [customDateRange, timePeriods, timeRange]);

  const applyPresetRange = (preset) => {
    const now = new Date();
    if (preset === 'current_fy') {
      setCustomDateRange({
        start: { month: 1, year: now.getFullYear() },
        end: { month: 12, year: now.getFullYear() }
      });
      return;
    }
    if (preset === 'next_12') {
      const startMonth = now.getMonth() + 1;
      const startYear = now.getFullYear();
      const endMonth = ((startMonth + 11) % 12) + 1;
      const endYear = startYear + Math.floor((startMonth - 1 + 11) / 12);
      setCustomDateRange({
        start: { month: startMonth, year: startYear },
        end: { month: endMonth, year: endYear }
      });
      return;
    }
    if (preset === 'next_qtr') {
      const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      const startQuarterMonth = Math.floor(startDate.getMonth() / 3) * 3;
      const start = { month: startQuarterMonth + 1, year: startDate.getFullYear() };
      const endDate = new Date(startDate.getFullYear(), startQuarterMonth + 3, 0);
      setCustomDateRange({
        start,
        end: { month: endDate.getMonth() + 1, year: endDate.getFullYear() }
      });
      return;
    }
  };

  const defaultDateRange = useMemo(() => {
    const toDateString = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    if (customDateRange) {
      const start = toDateString(customDateRange.start.year, customDateRange.start.month, 1);
      const endDate = new Date(customDateRange.end.year, customDateRange.end.month, 0);
      const end = toDateString(endDate.getFullYear(), endDate.getMonth() + 1, endDate.getDate());
      return { start, end };
    }

    // Default to next calendar year
    const nextYear = new Date().getFullYear() + 1;
    const start = toDateString(nextYear, 1, 1);
    const end = toDateString(nextYear, 12, 31);
    return { start, end };
  }, [customDateRange]);

  // Warn on invalid custom date range
  useEffect(() => {
    const formattedRange = getFormattedDateRange(customDateRange);
    if (!formattedRange) return;

    const [startYear, startMonth] = formattedRange.start.split('-').map(Number);
    const [endYear, endMonth] = formattedRange.end.split('-').map(Number);
    const startDate = new Date(startYear, startMonth - 1, 1);
    const endDate = new Date(endYear, endMonth, 0);

    if (startDate > endDate) {
      toast.error('Start date must be before end date for the custom range');
    }
  }, [customDateRange]);

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
    setUnsavedChanges(true);
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

  // Handle smart sales import
  const handleSmartSalesImport = async (importData) => {
    try {
      const { data: salesData, options, missingItems } = importData;
      
      // Transform data for API
      const sales = salesData.map(item => ({
        customer_id: item.customer_id,
        product_id: item.product_id || item.unit_id,
        period: item.period,
        quantity: parseFloat(item.quantity) || 0,
        price: parseFloat(item.price) || item.unit_price || 0
      }));

      const response = await api.post('/forecast/smart_import_sales', {
        sales,
        options: {
          autoCreate: options?.autoCreate ?? true
        },
        forecast_id: activeScenario
      });

      if (response.status === 'success') {
        toast.success(response.message);
        
        // Refresh data
        await actions.fetchAllData();
        
        // If items were auto-created, switch to validation tab
        if (response.data.created_customers?.length > 0 || response.data.created_products?.length > 0) {
          setActiveTab('validation');
          toast.info('Some items were auto-created. Please complete their details on the validation page.');
        }
        
        return true;
      } else {
        throw new Error(response.message || 'Import failed');
      }
    } catch (error) {
      console.error('Error importing sales:', error);
      toast.error(`Import failed: ${error.message}`);
      throw error;
    }
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
        setUnsavedChanges(false);
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

  // Skeleton loader component
  const SkeletonLoader = () => (
    <div className="space-y-4">
      <div className="h-8 bg-gray-200 rounded animate-pulse w-1/3"></div>
      <div className="grid grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-24 bg-gray-200 rounded animate-pulse"></div>
        ))}
      </div>
      <div className="h-96 bg-gray-200 rounded animate-pulse"></div>
    </div>
  );

  if (loading) {
    return (
      <div className="container mx-auto px-6 py-8">
        <SkeletonLoader />
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
      label: 'Import Sales',
      onClick: () => setShowSalesImportModal(true),
      variant: 'outline'
    },
    {
      label: 'Import Customers',
      onClick: () => setShowCustomerImportModal(true),
      variant: 'outline'
    },
    {
      label: 'Import Products',
      onClick: () => setShowProductImportModal(true),
      variant: 'outline'
    },
    {
      label: 'Export',
      onClick: handleBulkExport,
      variant: 'outline'
    },
    {
      label: 'Keyboard Shortcuts',
      onClick: () => setShowKeyboardShortcuts(true),
      variant: 'outline'
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

      {unsavedChanges && (
        <div className="sticky top-0 z-30 mb-4">
          <div className="bg-orange-50 border border-orange-200 rounded-md p-3 shadow-sm flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-orange-800">
              <span className="h-2 w-2 rounded-full bg-orange-600 animate-pulse"></span>
              <span className="font-medium">You have unsaved changes</span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => actions.fetchAllData().then(() => setUnsavedChanges(false))}>
                Discard
              </Button>
              <Button size="sm" className="bg-orange-600 hover:bg-orange-700" onClick={handleSaveChanges}>
                Save now
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Badge variant="secondary">Active scenario: {activeScenario || 'none selected'}</Badge>
        <Button size="sm" variant="outline" onClick={() => setShowNewScenarioModal(true)}>
          New Scenario
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowBranchScenarioModal(true)}
          disabled={!activeScenario}
          title={!activeScenario ? 'Select an active scenario first' : 'Duplicate the active scenario with optional overrides'}
        >
          Branch Scenario
        </Button>
      </div>

      {/* Compact Filter Bar */}
      <Card className="mb-6">
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Date Range Presets - Primary */}
            <div className="flex items-center gap-2 border-r pr-3">
              <Label className="text-sm font-medium text-gray-700">Range:</Label>
              <div className="flex gap-1.5">
                <Button 
                  size="sm" 
                  variant={!customDateRange ? "default" : "outline"}
                  onClick={() => setCustomDateRange(null)}
                  className={!customDateRange ? "bg-orange-600 hover:bg-orange-700 text-white" : ""}
                >
                  Default
                </Button>
                <Button size="sm" variant="outline" onClick={() => applyPresetRange('current_fy')}>
                  Current FY
                </Button>
                <Button size="sm" variant="outline" onClick={() => applyPresetRange('next_12')}>
                  Next 12M
                </Button>
                <Button size="sm" variant="outline" onClick={() => applyPresetRange('next_qtr')}>
                  Next Qtr
                </Button>
                <Button 
                  size="sm" 
                  variant={customDateRange ? "default" : "outline"}
                  onClick={() => setShowDateRangeModal(true)}
                  className={customDateRange ? "bg-orange-600 hover:bg-orange-700 text-white" : ""}
                >
                  Custom
                </Button>
              </div>
            </div>

            {/* Period Type */}
            <div className="flex items-center gap-2 border-r pr-3">
              <Label className="text-sm font-medium text-gray-700">Period:</Label>
              <Select value={timeRange} onChange={(e) => setTimeRange(e.target.value)} className="w-28">
                <SelectOption value="monthly">Monthly</SelectOption>
                <SelectOption value="quarterly">Quarterly</SelectOption>
                <SelectOption value="weekly">Weekly</SelectOption>
              </Select>
            </div>

            {/* Segment Filter */}
            <div className="flex items-center gap-2 border-r pr-3">
              <Label className="text-sm font-medium text-gray-700">Segment:</Label>
              <Select value={selectedSegment} onChange={(e) => setSelectedSegment(e.target.value)} className="w-36">
                <SelectOption value="all">All Segments</SelectOption>
                {segments.map(segment => (
                  <SelectOption key={segment} value={segment}>{segment}</SelectOption>
                ))}
              </Select>
            </div>

            {/* Range Summary */}
            <Badge variant="outline" className="ml-auto bg-gray-50">
              {rangeSummary}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Date Range Modal */}
      <DateRangeModal
        isOpen={showDateRangeModal}
        onClose={() => setShowDateRangeModal(false)}
        onApply={(range) => {
          setCustomDateRange(range);
        }}
        currentRange={customDateRange}
      />

      {/* Import Modals */}
      <CSVUploadModal
        isOpen={showSalesImportModal}
        onClose={() => setShowSalesImportModal(false)}
        onImport={handleSmartSalesImport}
        importType="sales_forecast"
        existingData={{ customers: data.customers || [], products: data.products || [] }}
      />

      <CustomerImportModal
        isOpen={showCustomerImportModal}
        onClose={() => setShowCustomerImportModal(false)}
        onComplete={async () => {
          await actions.fetchAllData();
        }}
      />

      <ProductImportModal
        isOpen={showProductImportModal}
        onClose={() => setShowProductImportModal(false)}
        onComplete={async () => {
          await actions.fetchAllData();
        }}
      />

      <NewScenarioModal
        open={showNewScenarioModal}
        onClose={() => setShowNewScenarioModal(false)}
        onCreate={(scenarioData) => actions.createScenario(scenarioData)}
      />

      <BranchScenarioModal
        open={showBranchScenarioModal}
        onClose={() => setShowBranchScenarioModal(false)}
        scenarios={scenarios}
        activeScenarioId={activeScenario}
        onSubmit={async (sourceId, scenarioData, overrides) => {
          const result = await actions.duplicateScenario(sourceId, scenarioData, overrides);
          if (result) {
            toast.success(`Branched to "${scenarioData.name}"`);
            await actions.fetchAllData(result.forecast_id);
          }
          return result;
        }}
      />


      <ForecastLineModal
        isOpen={showForecastLineModal}
        onClose={() => setShowForecastLineModal(false)}
        onSave={handleForecastLineSave}
        defaultDateRange={defaultDateRange}
      />

      <KeyboardShortcutsModal
        open={showKeyboardShortcuts}
        onClose={() => setShowKeyboardShortcuts(false)}
      />


      {/* Floating Action Button */}
      <button
        onClick={() => setShowForecastLineModal(true)}
        className="fixed bottom-8 right-8 bg-orange-600 hover:bg-orange-700 text-white rounded-full p-4 shadow-lg z-50 transition-all hover:scale-110"
        title="Add Forecast Line"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {showDataDebugger && <DataDebugger data={data} timePeriods={timePeriods} />}

      <RevenueSummary 
        data={data} 
        timePeriods={timePeriods} 
        selectedSegment={selectedSegment}
        onCardClick={(cardType) => {
          // Handle card click - could filter or navigate
          console.log('Card clicked:', cardType);
          // For now, just log. Can be extended to filter matrix
        }}
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
              key={`matrix-${timeRange}-${customDateRange ? `${customDateRange.start.year}-${customDateRange.start.month}-to-${customDateRange.end.year}-${customDateRange.end.month}` : 'default'}-${timePeriods.length}`}
              data={data}
              timePeriods={timePeriods}
              selectedSegment={selectedSegment}
              onDataChange={handleMatrixDataChange}
              onCellChange={handleCellChange}
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
