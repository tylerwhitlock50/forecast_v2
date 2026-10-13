import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import { toast } from 'react-hot-toast';
import { ChevronDown, Download, Keyboard, Loader2, Plus, Upload } from 'lucide-react';
import { useForecast } from '../../../context/ForecastContext';
import api, { apiClient } from '../../../lib/apiClient';
import { calendarYearWindow } from '../../../lib/scenarioWindow';
import { Card, CardContent } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import RevenueMatrix, { LOCKED_NOTE } from './RevenueMatrix';
import RevenueSummary from './RevenueSummary';
import RevenueAnalysis from './RevenueAnalysis';
import RevenueVisualizations from './RevenueVisualizations';
import RevenueValidation from './RevenueValidation';
import ForecastLineModal from './ForecastLineModal';
import DateRangeModal from './DateRangeModal';
import KeyboardShortcutsModal from './KeyboardShortcutsModal';
import NewScenarioModal from './NewScenarioModal';
import GettingStartedCard from './GettingStartedCard';
import { goToImport } from '../../Common/importLink';
import { isLocked } from '../Scenarios/governance';
import {
  buildLines,
  buildPeriods,
  defaultRevenueWindow,
  describeWindow,
  monthsBetween,
  NO_TYPE,
  SALES_EXPORT_COLUMNS,
  salesExportRows,
  shortWindowLabel,
  summarizeLines,
  windowCovers,
  yearsInWindow,
} from './revenueData';

const PERIOD_MODE_KEY = 'revenue_timeRange';

const TABS = [
  { id: 'matrix', label: 'Forecast lines' },
  { id: 'types', label: 'By customer type' },
  { id: 'charts', label: 'Charts' },
  { id: 'checks', label: 'Data checks' },
];

const readPeriodMode = () => {
  try {
    return localStorage.getItem(PERIOD_MODE_KEY) === 'quarterly' ? 'quarterly' : 'monthly';
  } catch {
    return 'monthly';
  }
};

const safeName = (text) => String(text || 'forecast').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'forecast';

const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const downloadCsv = (rows, columns, filename) => {
  // Papa.unparse quotes any field with a comma, quote or line break.
  const csv = Papa.unparse({ fields: columns, data: rows.map(r => columns.map(c => (r[c] ?? ''))) });
  downloadBlob(new Blob([`﻿${csv}\n`], { type: 'text/csv;charset=utf-8' }), filename);
};

const Segmented = ({ options, value, onChange, label }) => (
  <div role="group" aria-label={label} className="inline-flex rounded-md border border-gray-300 bg-white p-0.5">
    {options.map(o => (
      <button
        key={o.value}
        type="button"
        aria-pressed={value === o.value}
        onClick={() => onChange(o.value)}
        title={o.title}
        className={`rounded px-3 py-1 text-sm font-medium transition-colors ${value === o.value ? 'bg-orange-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

/** Export menu: re-importable sales lines, the costed sales detail, or the Excel workbook. */
const ExportMenu = ({ disabled, onExport, busy }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const items = [
    { id: 'lines', title: 'Sales lines (CSV)', text: 'One row per customer, product and month. Edit and import it back.' },
    { id: 'detail', title: 'Costed sales detail (CSV)', text: 'Each line with deductions, net sales, COGS and margin.' },
    { id: 'workbook', title: 'Excel workbook', text: 'Every report for the scenario and these months.' },
  ];

  return (
    <div className="relative" ref={ref}>
      <Button variant="outline" onClick={() => setOpen(o => !o)} disabled={disabled || Boolean(busy)} aria-haspopup="menu" aria-expanded={open}>
        {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
        Export
        <ChevronDown className="ml-1 h-4 w-4" />
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-1 w-80 rounded-md border border-gray-200 bg-white p-1 shadow-lg">
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onExport(item.id); }}
              className="block w-full rounded px-3 py-2 text-left hover:bg-orange-50"
            >
              <div className="text-sm font-medium text-gray-900">{item.title}</div>
              <div className="text-xs text-gray-500">{item.text}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const RevenueForecasting = () => {
  const navigate = useNavigate();
  const { data, actions, loading, error, scenarios, activeScenario } = useForecast();
  const [activeTab, setActiveTab] = useState('matrix');
  const [selectedSegment, setSelectedSegment] = useState('all');
  const [periodMode, setPeriodMode] = useState(readPeriodMode);
  const [range, setRange] = useState({ kind: 'scenario' });
  const [showForecastLineModal, setShowForecastLineModal] = useState(false);
  const [showNewScenarioModal, setShowNewScenarioModal] = useState(false);
  const [showDateRangeModal, setShowDateRangeModal] = useState(false);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [exporting, setExporting] = useState(null);

  const scenario = activeScenario && scenarios ? scenarios[activeScenario] || null : null;
  // Approved and locked: its sales cannot change, so nothing here offers to.
  const locked = isLocked(scenario);

  useEffect(() => {
    try { localStorage.setItem(PERIOD_MODE_KEY, periodMode); } catch { /* storage unavailable */ }
  }, [periodMode]);

  // A new scenario opens on its own sales window, never on a range picked for another one.
  useEffect(() => {
    setRange({ kind: 'scenario' });
    setSelectedSegment('all');
  }, [activeScenario]);

  // Press ? for the keyboard shortcuts.
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) setShowKeyboardShortcuts(true);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const salesStart = scenario?.start_period || null;
  const salesEnd = scenario?.end_period || null;
  const scenarioWindow = useMemo(
    () => defaultRevenueWindow({ start_period: salesStart, end_period: salesEnd }),
    [salesStart, salesEnd]
  );

  const viewWindow = useMemo(() => {
    if (range.kind === 'year') return calendarYearWindow(range.year);
    if (range.kind === 'custom') return { start: range.start, end: range.end };
    return scenarioWindow;
  }, [range, scenarioWindow]);

  const months = useMemo(() => monthsBetween(viewWindow.start, viewWindow.end), [viewWindow]);
  const periods = useMemo(() => buildPeriods(viewWindow, periodMode), [viewWindow, periodMode]);

  const allLines = useMemo(() => buildLines({
    sales: data.sales_forecast,
    products: data.products,
    customers: data.customers,
    scenarioId: activeScenario,
  }), [data.sales_forecast, data.products, data.customers, activeScenario]);

  const windowLines = useMemo(() => {
    const monthSet = new Set(months);
    return allLines.filter(line => Array.from(line.months.keys()).some(m => monthSet.has(m)));
  }, [allLines, months]);

  const segments = useMemo(() => {
    const set = new Set(windowLines.map(l => l.segment));
    (data.customers || []).forEach(c => { if (String(c.customer_type || '').trim()) set.add(c.customer_type.trim()); });
    return Array.from(set).sort((a, b) => (a === NO_TYPE) - (b === NO_TYPE) || a.localeCompare(b));
  }, [windowLines, data.customers]);

  const filteredLines = useMemo(
    () => (selectedSegment === 'all' ? windowLines : windowLines.filter(l => l.segment === selectedSegment)),
    [windowLines, selectedSegment]
  );

  const summary = useMemo(() => summarizeLines(filteredLines, months), [filteredLines, months]);

  const scenarioYears = yearsInWindow(scenarioWindow);
  const rangeValue = range.kind === 'year' ? `year:${range.year}` : range.kind;
  const rangeOptions = [
    { value: 'scenario', label: 'Scenario window', title: describeWindow(scenarioWindow) },
    ...(scenarioYears.length > 1 ? scenarioYears.map(y => ({ value: `year:${y}`, label: `FY ${y}` })) : []),
    { value: 'custom', label: range.kind === 'custom' ? 'Custom ✓' : 'Custom…' },
  ];

  const handleRangeChange = (value) => {
    if (value === 'scenario') setRange({ kind: 'scenario' });
    else if (value === 'custom') setShowDateRangeModal(true);
    else if (value.startsWith('year:')) setRange({ kind: 'year', year: value.slice(5) });
  };

  // Save a forecast line: write it, wait for the saved rows, refresh the
  // scenario's sales window, and make sure the new months are on screen.
  const handleForecastLineSave = useCallback(async (salesRecords, operation) => {
    await actions.bulkUpdateForecast(salesRecords, operation, true);
    const saved = salesRecords.map(s => s.period);
    toast.success(`Saved ${salesRecords.length} month${salesRecords.length === 1 ? '' : 's'} for this line`);
    if (range.kind !== 'scenario' && !windowCovers(viewWindow, saved)) {
      setRange({ kind: 'scenario' });
      toast('Showing the scenario window so the new months are visible.', { icon: 'ℹ️' });
    }
  }, [actions, range.kind, viewWindow]);

  const handleExport = async (kind) => {
    const fid = activeScenario;
    const base = `${safeName(scenario?.name || fid)}_${viewWindow.start}_${viewWindow.end}`;
    if (kind === 'lines') {
      const rows = salesExportRows(windowLines, months, selectedSegment);
      if (!rows.length) {
        toast.error('No sales rows in these months to export.');
        return;
      }
      downloadCsv(rows, SALES_EXPORT_COLUMNS, `sales-forecast_${base}.csv`);
      toast.success(`Exported ${rows.length.toLocaleString('en-US')} sales rows`);
      return;
    }
    if (!fid) return;
    const params = `forecast_ids=${encodeURIComponent(fid)}&start_period=${viewWindow.start}&end_period=${viewWindow.end}`;
    setExporting(kind);
    try {
      if (kind === 'detail') {
        const res = await api.get(`/reporting/sales-detail?${params}&limit=20000`, { suppressErrorToast: true, timeout: 180000 });
        const detail = res?.data || {};
        const columns = (detail.columns || []).map(c => c.key);
        const labels = Object.fromEntries((detail.columns || []).map(c => [c.key, c.label || c.key]));
        const rows = detail.rows || [];
        if (!rows.length) {
          toast.error('No sales rows in these months to export.');
          return;
        }
        const csv = Papa.unparse({ fields: columns.map(c => labels[c]), data: rows.map(r => columns.map(c => r[c] ?? '')) });
        downloadBlob(new Blob([`﻿${csv}\n`], { type: 'text/csv;charset=utf-8' }), `sales-detail_${base}.csv`);
        toast.success(detail.has_more
          ? `Exported the first ${rows.length.toLocaleString('en-US')} of ${detail.total_count.toLocaleString('en-US')} rows; use the Excel workbook for all of them`
          : `Exported ${rows.length.toLocaleString('en-US')} costed sales rows`);
      } else if (kind === 'workbook') {
        const response = await apiClient.get(`/reporting/workbook?${params}`, { responseType: 'blob', timeout: 180000 });
        const disposition = response.headers?.['content-disposition'] || '';
        const match = /filename="?([^";]+)"?/i.exec(disposition);
        downloadBlob(response.data, match ? match[1] : `forecast_${base}.xlsx`);
        toast.success('Excel workbook downloaded');
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.userMessage || 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  const hasMasterData = Boolean(data.products?.length || data.customers?.length);

  if (loading && !hasMasterData) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="space-y-4" aria-busy="true">
          <div className="h-8 w-1/3 animate-pulse rounded bg-gray-200" />
          <div className="grid grid-cols-5 gap-4">
            {[...Array(5)].map((_, i) => <div key={i} className="h-24 animate-pulse rounded bg-gray-200" />)}
          </div>
          <div className="h-96 animate-pulse rounded bg-gray-200" />
        </div>
      </div>
    );
  }

  const header = (
    <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 max-w-2xl lg:flex-1">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Sales Forecast</h1>
        <p className="mt-1 text-gray-600">Units and price by customer, product and month for the active scenario.</p>
      </div>
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 lg:flex-nowrap">
        {hasMasterData ? (
          <Button variant="outline" onClick={() => goToImport(navigate, 'sales')} title="Import data, step 9: Sales forecast">
            <Upload className="mr-1.5 h-4 w-4" />
            Import sales
          </Button>
        ) : (
          <Button variant="outline" onClick={() => navigate('/import')}>
            <Upload className="mr-1.5 h-4 w-4" />
            Import data
          </Button>
        )}
        {hasMasterData && <ExportMenu disabled={!activeScenario} busy={exporting} onExport={handleExport} />}
        {hasMasterData && (
          <Button
            onClick={() => setShowForecastLineModal(true)}
            disabled={!activeScenario || locked}
            title={locked ? LOCKED_NOTE : undefined}
            className="bg-orange-600 text-white hover:bg-orange-700"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Add forecast line
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={() => setShowKeyboardShortcuts(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
          <Keyboard className="h-5 w-5 text-gray-500" />
        </Button>
      </div>
    </div>
  );

  const modals = (
    <>
      <NewScenarioModal
        open={showNewScenarioModal}
        onClose={() => setShowNewScenarioModal(false)}
        onCreate={(scenarioData) => actions.createScenario(scenarioData)}
      />
      <ForecastLineModal
        isOpen={showForecastLineModal}
        onClose={() => setShowForecastLineModal(false)}
        onSave={handleForecastLineSave}
        defaultWindow={viewWindow}
      />
      <DateRangeModal
        isOpen={showDateRangeModal}
        onClose={() => setShowDateRangeModal(false)}
        onApply={(next) => setRange({ kind: 'custom', start: next.start, end: next.end })}
        currentRange={range.kind === 'custom' ? viewWindow : null}
        scenarioWindow={scenarioWindow}
      />
      <KeyboardShortcutsModal open={showKeyboardShortcuts} onClose={() => setShowKeyboardShortcuts(false)} />
    </>
  );

  // Empty model: the setup path, nothing else.
  if (!hasMasterData) {
    return (
      <div className="container mx-auto px-6 py-8">
        {header}
        {error && (
          <div className="mb-4 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            <span>The data could not be loaded. Check that the server is running.</span>
            <Button variant="outline" size="sm" onClick={() => actions.fetchAllData()}>Try again</Button>
          </div>
        )}
        <GettingStartedCard forceShow onCreateScenario={() => setShowNewScenarioModal(true)} />
        {modals}
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 py-8 pb-16">
      {header}

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-gray-600">
        {scenario ? (
          <>
            <span>{locked ? 'Viewing' : 'Editing'}</span>
            <span className="font-semibold text-gray-900">{scenario.name}</span>
            <Badge variant="outline" className="font-mono">{activeScenario}</Badge>
            {scenario.is_base && <Badge variant="secondary">Base</Badge>}
            {scenario.description && <span className="text-gray-500">— {scenario.description}</span>}
          </>
        ) : (
          <span className="text-amber-700">No scenario selected. Pick one in the bar above or create one on the Scenarios page.</span>
        )}
        <Link to="/scenarios" className="ml-auto font-medium text-orange-700 hover:underline">
          Manage, branch or compare scenarios
        </Link>
      </div>

      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">Months</span>
            <Segmented label="Months to show" options={rangeOptions} value={rangeValue} onChange={handleRangeChange} />
            <span className="whitespace-nowrap text-sm tabular-nums text-gray-500" data-testid="range-summary" title={describeWindow(viewWindow)}>
              {shortWindowLabel(viewWindow)} · {months.length} month{months.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">View</span>
            <Segmented
              label="Period"
              options={[
                { value: 'monthly', label: 'Monthly', title: 'One column per month; cells are editable' },
                { value: 'quarterly', label: 'Quarterly', title: 'One column per quarter; totals only' },
              ]}
              value={periodMode}
              onChange={setPeriodMode}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="font-medium text-gray-700">Customer type</span>
            <select
              value={selectedSegment}
              onChange={(e) => setSelectedSegment(e.target.value)}
              className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="all">All types</option>
              {segments.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </CardContent>
      </Card>

      <RevenueSummary summary={summary} windowLabel={shortWindowLabel(viewWindow)} />

      <div className="mb-5 inline-flex rounded-lg bg-gray-100 p-1" role="tablist" aria-label="Sales forecast views">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${activeTab === tab.id ? 'bg-white text-orange-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'matrix' && (
        <div className="space-y-5">
          <GettingStartedCard onCreateScenario={() => setShowNewScenarioModal(true)} />
          <RevenueMatrix
            lines={windowLines}
            periods={periods}
            selectedSegment={selectedSegment}
            periodType={periodMode}
            onAddForecastLine={() => setShowForecastLineModal(true)}
          />
        </div>
      )}

      {activeTab === 'types' && <RevenueAnalysis lines={windowLines} months={months} />}

      {activeTab === 'charts' && <RevenueVisualizations lines={filteredLines} periods={periods} months={months} />}

      {activeTab === 'checks' && <RevenueValidation data={data} />}

      {modals}
    </div>
  );
};

export default RevenueForecasting;
