import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
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
import DateRangeModal from './DateRangeModal';

// Format a week label with the date span
const formatWeekLabel = (weekStart, weekEnd, weekNumber) => {
  const span = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}-${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  return `W${String(weekNumber).padStart(2, '0')} (${span})`;
};

// Normalize to Monday as start of week
const getStartOfWeek = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday = 1
  return new Date(d.setDate(diff));
};

// ISO week number and corresponding year
const getISOWeekInfo = (date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
};

// Utility function to generate time periods
const generateTimePeriods = (timeRange, count = 12) => {
  const periods = [];
  const now = new Date();
  
  for (let i = 0; i < count; i++) {
    let date, key, label;
    
    if (timeRange === 'weekly') {
      // Start from the beginning of the current week
      const startOfWeek = getStartOfWeek(now);
      date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + (i * 7));
      
      const weekStart = getStartOfWeek(date);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      
      const { year, week } = getISOWeekInfo(weekStart);
      key = `${year}-W${String(week).padStart(2, '0')}`;
      label = formatWeekLabel(weekStart, weekEnd, week);
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
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [customDateRange, setCustomDateRange] = useState(null);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [dateRangeStart, setDateRangeStart] = useState(null);
  const [dateRangeEnd, setDateRangeEnd] = useState(null);
  const [showDateRangeModal, setShowDateRangeModal] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(null);
  const [groupByYear, setGroupByYear] = useState(false);

  // Load persisted preferences
  useEffect(() => {
    try {
      const savedTimeRange = localStorage.getItem('revenue_timeRange');
      const savedCustomRange = localStorage.getItem('revenue_customDateRange');
      const savedVisibleColumns = localStorage.getItem('revenue_visibleColumns');
      const savedGroupByYear = localStorage.getItem('revenue_groupByYear');
      
      if (savedTimeRange) {
        setTimeRange(savedTimeRange);
      }
      if (savedCustomRange) {
        const parsed = JSON.parse(savedCustomRange);
        if (parsed?.start && parsed?.end) {
          setCustomDateRange(parsed);
        }
      }
      if (savedVisibleColumns) {
        setVisibleColumns(JSON.parse(savedVisibleColumns));
      }
      if (savedGroupByYear) {
        setGroupByYear(savedGroupByYear === 'true');
      }
    } catch (err) {
      console.warn('Unable to load saved preferences', err);
    }
  }, []);

  // Persist preferences
  useEffect(() => {
    try {
      localStorage.setItem('revenue_timeRange', timeRange);
      if (customDateRange) {
        localStorage.setItem('revenue_customDateRange', JSON.stringify(customDateRange));
      } else {
        localStorage.removeItem('revenue_customDateRange');
      }
      if (visibleColumns) {
        localStorage.setItem('revenue_visibleColumns', JSON.stringify(visibleColumns));
      }
      localStorage.setItem('revenue_groupByYear', groupByYear.toString());
    } catch (err) {
      console.warn('Unable to persist preferences', err);
    }
  }, [timeRange, customDateRange, visibleColumns, groupByYear]);
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

  const rangeSummary = useMemo(() => {
    if (customDateRange) {
      const monthsInRange = (customDateRange.end.year - customDateRange.start.year) * 12 +
        (customDateRange.end.month - customDateRange.start.month) + 1;
      const unit = timeRange === 'weekly' ? 'weeks' : timeRange === 'quarterly' ? 'quarters' : 'months';
      return `${customDateRange.start.month}/${customDateRange.start.year} – ${customDateRange.end.month}/${customDateRange.end.year} • ${monthsInRange} ${unit}`;
    }
    const unit = timeRange === 'weekly' ? 'weeks' : timeRange === 'quarterly' ? 'quarters' : 'months';
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
    const formattedRange = getFormattedDateRange();
    if (!formattedRange) return;

    const [startYear, startMonth] = formattedRange.start.split('-').map(Number);
    const [endYear, endMonth] = formattedRange.end.split('-').map(Number);
    const startDate = new Date(startYear, startMonth - 1, 1);
    const endDate = new Date(endYear, endMonth, 0);

    if (startDate > endDate) {
      toast.error('Start date must be before end date for the custom range');
    }
  }, [customDateRange]);

  // Generate time periods with improved logic
  const timePeriods = useMemo(() => {
    const formattedRange = getFormattedDateRange();
    
    if (formattedRange) {
      const [startYear, startMonth] = formattedRange.start.split('-').map(Number);
      const [endYear, endMonth] = formattedRange.end.split('-').map(Number);

      const startDate = new Date(startYear, startMonth - 1, 1);
      const endDate = new Date(endYear, endMonth, 0); // last day of end month

      if (startDate > endDate) {
        console.warn('Custom date range start is after end; no periods generated.');
        return [];
      }

      const periods = [];

      if (timeRange === 'weekly') {
        let current = getStartOfWeek(startDate);
        const endBoundary = endDate;

        while (current <= endBoundary) {
          const weekStart = getStartOfWeek(current);
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekStart.getDate() + 6);

          const { year, week } = getISOWeekInfo(weekStart);
          const key = `${year}-W${String(week).padStart(2, '0')}`;
          const label = formatWeekLabel(weekStart, weekEnd, week);

          periods.push({ key, label });
          current.setDate(current.getDate() + 7);
        }

        return periods;
      }

      if (timeRange === 'quarterly') {
        // Align start to the beginning of its quarter
        const startQuarterMonth = Math.floor(startDate.getMonth() / 3) * 3;
        let current = new Date(startDate.getFullYear(), startQuarterMonth, 1);

        while (current <= endDate) {
          const quarter = Math.floor(current.getMonth() / 3) + 1;
          const key = `${current.getFullYear()}-Q${quarter}`;
          const label = `Q${quarter} ${current.getFullYear()}`;

          periods.push({ key, label });
          current.setMonth(current.getMonth() + 3, 1);
        }

        return periods;
      }

      // Monthly
      let current = new Date(startDate);
      while (current <= endDate) {
        const key = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
        const label = `${current.toLocaleDateString('en-US', { month: 'short' })} ${current.getFullYear()}`;

        periods.push({ key, label });
        current.setMonth(current.getMonth() + 1, 1);
      }

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

  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);

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
      label: 'Keyboard Shortcuts',
      onClick: () => setShowKeyboardShortcuts(true),
      variant: 'outline'
    }
  ];
  
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
        <Badge variant="secondary">Active scenario: {activeScenario || 'F001'}</Badge>
        <Button size="sm" variant="outline" onClick={() => setShowNewScenarioModal(true)}>
          New Scenario
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
          const start = new Date(range.start.year, range.start.month - 1, 1);
          const end = new Date(range.end.year, range.end.month, 0);
          setDateRangeStart(start);
          setDateRangeEnd(end);
        }}
        currentRange={customDateRange}
      />

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
        defaultDateRange={defaultDateRange}
      />

      {/* Keyboard Shortcuts Modal */}
      {showKeyboardShortcuts && (
        <Modal onClick={() => setShowKeyboardShortcuts(false)}>
          <div onClick={e => e.stopPropagation()}>
            <ModalHeader>
              <ModalTitle>Keyboard Shortcuts</ModalTitle>
              <ModalClose onClick={() => setShowKeyboardShortcuts(false)} />
            </ModalHeader>
            <ModalContent>
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">Navigation</h3>
                  <ul className="space-y-1 text-sm">
                    <li><kbd className="px-2 py-1 bg-gray-100 rounded">Arrow Keys</kbd> - Navigate cells</li>
                    <li><kbd className="px-2 py-1 bg-gray-100 rounded">Enter</kbd> or <kbd className="px-2 py-1 bg-gray-100 rounded">F2</kbd> - Edit cell</li>
                    <li><kbd className="px-2 py-1 bg-gray-100 rounded">Tab</kbd> - Next cell</li>
                    <li><kbd className="px-2 py-1 bg-gray-100 rounded">Esc</kbd> - Cancel editing</li>
                  </ul>
                </div>
                <div>
                  <h3 className="font-semibold mb-2">Actions</h3>
                  <ul className="space-y-1 text-sm">
                    <li><kbd className="px-2 py-1 bg-gray-100 rounded">Ctrl+C</kbd> - Copy cells</li>
                    <li><kbd className="px-2 py-1 bg-gray-100 rounded">Ctrl+V</kbd> - Paste cells</li>
                    <li><kbd className="px-2 py-1 bg-gray-100 rounded">Delete</kbd> - Clear cell</li>
                    <li><kbd className="px-2 py-1 bg-gray-100 rounded">?</kbd> - Show this help</li>
                  </ul>
                </div>
              </div>
            </ModalContent>
            <ModalFooter>
              <Button onClick={() => setShowKeyboardShortcuts(false)}>Close</Button>
            </ModalFooter>
          </div>
        </Modal>
      )}

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
              timeRange={timeRange}
              onTimeRangeChange={setTimeRange}
              visibleColumns={visibleColumns}
              onColumnVisibilityChange={setVisibleColumns}
              groupByYear={groupByYear}
              onGroupByYear={setGroupByYear}
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
