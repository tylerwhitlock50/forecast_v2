import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { useForecast } from '../../../context/ForecastContext';
import { Card } from '../../ui/card';
import { Button, buttonVariants } from '../../ui/button';
import { cn } from '../../../lib/utils';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../ui/tabs';
import ReportingControls from './components/ReportingControls';
import StatementTable from './components/StatementTable';
import ReportWarnings from './components/ReportWarnings';
import GroupTable from './cogs/GroupTable';
import LaborTab from './cogs/LaborTab';
import MachinesTab from './cogs/MachinesTab';
import UnitCostsTab from './cogs/UnitCostsTab';
import { Segmented, TabIntro, Kpi } from './cogs/parts';
import { useReportWindow } from './hooks/useReportWindow';
import { useCogsForecast, useLaborForecast, downloadWorkbook, DEFAULT_HOURS_PER_FTE } from './hooks/useCogsLabor';
import { formatCurrency, formatPct, formatPeriod, formatNumber } from './utils/formatters';
import { downloadCsv, slug } from './utils/csv';
import {
  BRIDGE_ROWS, bridgeColumns, statementCsvRows, hasSalesInWindow, groupRows, sortRows, groupCsvRows,
  MONTHLY_METRICS, laborCsvRows, machineCsvRows, unitCostCsvRows, headline, mergeReportWarnings
} from './utils/cogsLabor';

const TABS = [
  { id: 'bridge', label: 'Gross margin bridge' },
  { id: 'product', label: 'By product' },
  { id: 'customer', label: 'By customer' },
  { id: 'customer_type', label: 'By customer type' },
  { id: 'labor', label: 'Labor' },
  { id: 'machines', label: 'Machines' },
  { id: 'unit_costs', label: 'Unit costs' }
];

const GROUP_INTRO = {
  product: 'Sales and contribution margin by product. Contribution = net sales − product COGS (materials, direct labor, machine), before factory overhead.',
  product_type: 'Sales and contribution margin by product type. Contribution = net sales − product COGS, before factory overhead.',
  customer: 'Sales and contribution margin by customer. Prices, terms, chargebacks and excise vary by customer and customer type, so margins differ too.',
  customer_type: 'Sales and contribution margin by customer type (dealer, distributor, direct, government …).'
};

const ORANGE = 'bg-orange-600 text-white hover:bg-orange-700';

const fte1 = (v) => formatNumber(v, { maximumFractionDigits: 1, minimumFractionDigits: 1 });

const money0 = (v) => formatCurrency(v, { maximumFractionDigits: 0, minimumFractionDigits: 0 });

const sortScenarios = (scenarios) =>
  Object.values(scenarios || {}).sort(
    (a, b) => (b.is_base ? 1 : 0) - (a.is_base ? 1 : 0) || (a.name || '').localeCompare(b.name || '')
  );

const KpiRow = ({ h, laborLoading }) => (
  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="cogs-kpis">
    <Kpi title="Gross sales" value={money0(h.gross)} subtitle={`${formatNumber(h.units, { maximumFractionDigits: 0 })} units`} tone="primary" />
    <Kpi
      title="Sales deductions"
      value={money0(h.deductions)}
      subtitle={h.deductionPct === null ? 'No sales' : `${formatPct(h.deductionPct)} of gross sales`}
      help="Terms, chargebacks, other allowances and excise tax"
    />
    <Kpi
      title="Net sales"
      value={money0(h.net)}
      subtitle={h.avgNetPrice === null ? '—' : `Avg ${formatCurrency(h.avgNetPrice, { maximumFractionDigits: 0, minimumFractionDigits: 0 })} / unit`}
      tone="primary"
    />
    <Kpi
      title="Gross profit"
      value={money0(h.grossProfit)}
      subtitle={h.grossMarginPct === null ? '—' : `${formatPct(h.grossMarginPct)} gross margin`}
      tone={h.grossProfit >= 0 ? 'success' : 'danger'}
    />
    <Kpi
      title="Direct labor"
      value={h.laborHours === null ? (laborLoading ? '…' : '—') : `${formatNumber(h.laborHours, { maximumFractionDigits: 0 })} h`}
      subtitle={h.avgFte === null ? 'Labor forecast unavailable' : (
        // Each half stays on one line so a narrow card never leaves "peak" on its own.
        <span data-testid="fte-subtitle">
          <span className="whitespace-nowrap">{fte1(h.avgFte)} avg FTE</span> · <span className="whitespace-nowrap">{fte1(h.peakFte)} peak</span>
        </span>
      )}
      help="Routing labor hours to build the forecast; FTE = hours ÷ hours per FTE"
    />
  </div>
);

const CogsLaborForecast = () => {
  const { state, activeScenario } = useForecast();
  const scenarios = useMemo(() => state.scenarios || {}, [state.scenarios]);
  const scenarioList = useMemo(() => sortScenarios(scenarios), [scenarios]);

  // The page follows the active scenario until another one is picked here;
  // switching the active scenario (scenario bar) takes over again.
  const [pickedId, setPickedId] = useState(null);
  useEffect(() => { setPickedId(null); }, [activeScenario]);
  const scenarioId = (pickedId && scenarios[pickedId] ? pickedId : null)
    || (activeScenario && scenarios[activeScenario] ? activeScenario : null)
    || scenarioList[0]?.id
    || null;
  const scenario = scenarioId ? scenarios[scenarioId] : null;
  const forecastIds = useMemo(() => (scenarioId ? [scenarioId] : []), [scenarioId]);

  const { period, setPeriod, defaultWindow } = useReportWindow(scenario);

  const { data: cogs, loading: cogsLoading, error: cogsError, load: loadCogs } = useCogsForecast();
  const { data: labor, loading: laborLoading, error: laborError, load: loadLabor } = useLaborForecast();

  const [hoursPerFte, setHoursPerFte] = useState(DEFAULT_HOURS_PER_FTE);
  const [hoursPerFteInput, setHoursPerFteInput] = useState(String(DEFAULT_HOURS_PER_FTE));
  const [hoursPerFteError, setHoursPerFteError] = useState(null);

  const [activeTab, setActiveTab] = useState('bridge');
  const [productGrouping, setProductGrouping] = useState('product');
  const [groupView, setGroupView] = useState('summary');
  const [monthlyMetric, setMonthlyMetric] = useState('net_sales');
  const [sorts, setSorts] = useState({});
  const [laborMetric, setLaborMetric] = useState('hours');
  const [exporting, setExporting] = useState(false);
  const [dismissedKey, setDismissedKey] = useState(null);

  const refreshCogs = useCallback(() => loadCogs(forecastIds, period), [loadCogs, forecastIds, period]);
  const refreshLabor = useCallback(() => loadLabor(forecastIds, period, { hours_per_fte: hoursPerFte }), [loadLabor, forecastIds, period, hoursPerFte]);

  useEffect(() => { refreshCogs(); }, [refreshCogs]);
  useEffect(() => { refreshLabor(); }, [refreshLabor]);

  const commitHoursPerFte = () => {
    const value = parseFloat(hoursPerFteInput);
    if (!Number.isFinite(value) || value <= 0 || value > 744) {
      setHoursPerFteError('Hours per FTE must be a number between 1 and 744 (hours in a month).');
      return;
    }
    setHoursPerFteError(null);
    if (value !== hoursPerFte) setHoursPerFte(value);
  };

  const periods = cogs?.periods || [];
  const h = headline(cogs, labor);
  const hasSales = hasSalesInWindow(cogs);
  const loading = cogsLoading || laborLoading;

  const grouping = activeTab === 'product' ? productGrouping : activeTab;
  const isGroupTab = ['product', 'customer', 'customer_type'].includes(activeTab);
  const sort = sorts[grouping] || { key: 'net_sales', direction: 'desc' };
  const handleSort = (key) => setSorts(s => {
    const current = s[grouping] || { key: 'net_sales', direction: 'desc' };
    const textKey = key === 'name' || key === 'type';
    const direction = current.key === key ? (current.direction === 'asc' ? 'desc' : 'asc') : (textKey ? 'asc' : 'desc');
    return { ...s, [grouping]: { key, direction } };
  });
  const rows = useMemo(
    () => (isGroupTab ? sortRows(groupRows(cogs, grouping), sort.key, sort.direction) : []),
    [cogs, grouping, isGroupTab, sort.key, sort.direction]
  );

  // Every machine_over_capacity warning is kept (one per machine); only a
  // labor warning repeating a COGS warning's code is dropped.
  const warnings = useMemo(() => mergeReportWarnings(cogs, labor), [cogs, labor]);
  const warningsKey = `${cogs?.generated_at}|${labor?.generated_at}`;
  const visibleWarnings = dismissedKey === warningsKey ? warnings.filter(w => w.level === 'info') : warnings;

  const scenarioName = scenario?.name || scenarioId || '';
  const csvRowsForTab = () => {
    switch (activeTab) {
      case 'bridge': return statementCsvRows(BRIDGE_ROWS, bridgeColumns(cogs?.summary), 'Line');
      case 'product':
      case 'customer':
      case 'customer_type': return groupCsvRows(rows, grouping, { view: groupView, periods, metric: monthlyMetric });
      case 'labor': return laborCsvRows(labor, laborMetric);
      case 'machines': return machineCsvRows(labor);
      case 'unit_costs': return unitCostCsvRows(cogs?.unit_costs);
      default: return [];
    }
  };
  const csvName = () => {
    const part = activeTab === 'product' ? productGrouping : activeTab === 'labor' ? `labor_${laborMetric}` : activeTab;
    const view = isGroupTab && groupView === 'monthly' ? `_monthly_${monthlyMetric}` : '';
    return `${slug(scenarioName)}_${part}${view}_${period.start}_${period.end}.csv`;
  };
  const tabNeedsLabor = activeTab === 'labor' || activeTab === 'machines';
  const csvDisabled = !scenarioId || (tabNeedsLabor ? !labor : !cogs) || (!tabNeedsLabor && !hasSales);

  const handleExportWorkbook = async () => {
    if (!scenarioId) return;
    setExporting(true);
    try {
      await downloadWorkbook(forecastIds, period, scenarioName);
    } finally {
      setExporting(false);
    }
  };

  const retry = () => { refreshCogs(); refreshLabor(); };

  return (
    <div className="container mx-auto space-y-6 px-6 py-8">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold text-gray-900">COGS &amp; Labor Forecast</h1>
          <p className="mt-1 max-w-3xl text-gray-600">
            Gross sales → deductions → net sales → cost of goods sold → gross profit, and the labor and machine hours the sales plan needs,
            built from your sales forecast, pricing rules, BOMs and routings.
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          {loading && (cogs || labor) && (
            <span className="flex items-center gap-1.5 text-xs text-gray-500" aria-live="polite">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Updating…
            </span>
          )}
          <Button variant="outline" onClick={() => downloadCsv(csvRowsForTab(), csvName())} disabled={csvDisabled} title="Download the table on the current tab as CSV">
            <Download className="mr-2 h-4 w-4" aria-hidden="true" /> Download CSV
          </Button>
          <Button
            onClick={handleExportWorkbook}
            disabled={!scenarioId || exporting}
            className={ORANGE}
            title="Every tab of this page plus the statements, sales detail, price list and deduction rules in one Excel file"
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden="true" /> {exporting ? 'Preparing…' : 'Export Excel workbook'}
          </Button>
        </div>
      </div>

      {/* Scenario + window */}
      <Card className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <label className="flex items-center gap-3 text-sm">
            <span className="font-medium text-gray-700">Scenario</span>
            <select
              aria-label="Scenario"
              value={scenarioId || ''}
              onChange={e => setPickedId(e.target.value || null)}
              disabled={scenarioList.length === 0}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
            >
              {scenarioList.length === 0 && <option value="">No scenarios</option>}
              {scenarioList.map(s => (
                <option key={s.id} value={s.id}>{s.name}{s.is_base ? ' (base)' : ''}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium text-gray-700">Window</span>
            <ReportingControls period={period} onPeriodChange={setPeriod} defaultWindow={defaultWindow} compact />
          </div>
          <div className="text-xs text-gray-500 lg:ml-auto">
            {scenario?.start_period
              ? <>Sales in this scenario: {formatPeriod(scenario.start_period)} – {formatPeriod(scenario.end_period)}</>
              : scenario ? 'This scenario has no sales yet' : null}
            {cogs?.generated_at && <span className="ml-2 text-gray-400">· generated {new Date(cogs.generated_at).toLocaleTimeString()}</span>}
          </div>
        </div>
      </Card>

      {!scenarioId ? (
        <Card className="p-10 text-center">
          <h3 className="text-lg font-semibold text-gray-800">No scenario yet</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm text-gray-600">
            This report reads one scenario's sales forecast. Create a scenario, then import products, BOMs, routings and a sales forecast.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Link to="/scenarios" className={buttonVariants({ variant: 'outline' })}>Create a scenario</Link>
            <Link to="/import" className={cn(buttonVariants(), ORANGE)}>Import data</Link>
          </div>
        </Card>
      ) : cogsError && !cogs ? (
        <Card className="border-red-200 bg-red-50 p-6">
          <h3 className="font-semibold text-red-800">Could not build the COGS forecast</h3>
          <p className="mt-1 text-sm text-red-700">{cogsError}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={retry}>Try again</Button>
        </Card>
      ) : !cogs ? (
        <Card className="p-10 text-center text-sm text-gray-500" data-testid="cogs-loading">
          <RefreshCw className="mx-auto mb-3 h-5 w-5 animate-spin text-orange-600" aria-hidden="true" />
          Building the forecast for {formatPeriod(period.start)} – {formatPeriod(period.end)}…
        </Card>
      ) : !hasSales ? (
        <Card className="p-10 text-center" data-testid="cogs-empty">
          <h3 className="text-lg font-semibold text-gray-800">No sales in {formatPeriod(period.start)} – {formatPeriod(period.end)}</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm text-gray-600">
            Everything on this page is calculated from the sales forecast of <span className="font-medium">{scenarioName}</span>.
            Import a sales forecast for these months, or pick a window that has sales.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link to="/import" className={cn(buttonVariants(), ORANGE)}>Import a sales forecast</Link>
            <Link to="/sales-forecast" className={buttonVariants({ variant: 'outline' })}>Open the sales forecast</Link>
            {scenario?.start_period && (
              <Button variant="outline" onClick={() => setPeriod(defaultWindow)}>
                Show {formatPeriod(defaultWindow.start)} – {formatPeriod(defaultWindow.end)}
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <>
          <KpiRow h={h} laborLoading={laborLoading} />

          <ReportWarnings warnings={visibleWarnings} onDismiss={() => setDismissedKey(warningsKey)} />
          {laborError && (
            <p className="text-sm text-red-700">The labor forecast could not be loaded: {laborError}</p>
          )}

          <Card className="p-5">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="h-auto flex-wrap justify-start gap-1">
                {TABS.map(t => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}
              </TabsList>

              <TabsContent value="bridge" className="mt-5">
                <TabIntro>
                  Month by month from gross sales through each sales deduction to net sales, cost of goods sold and gross profit.
                  These figures tie to the income statement.
                </TabIntro>
                <StatementTable rows={BRIDGE_ROWS} columns={bridgeColumns(cogs.summary)} firstColumnLabel="Gross margin bridge" testId="bridge-table" />
                <p className="mt-2 text-xs text-gray-500">Deductions are shown in parentheses. Hover a dotted label to see how a line is calculated.</p>
              </TabsContent>

              {isGroupTab && (
                <TabsContent value={activeTab} className="mt-5">
                  <TabIntro
                    right={(
                      <>
                        {activeTab === 'product' && (
                          <Segmented
                            label="Group by"
                            options={[{ value: 'product', label: 'Products' }, { value: 'product_type', label: 'Product types' }]}
                            value={productGrouping}
                            onChange={setProductGrouping}
                          />
                        )}
                        <Segmented
                          label="View"
                          options={[{ value: 'summary', label: 'Summary' }, { value: 'monthly', label: 'By month' }]}
                          value={groupView}
                          onChange={setGroupView}
                        />
                        {groupView === 'monthly' && (
                          <select
                            aria-label="Monthly measure"
                            value={monthlyMetric}
                            onChange={e => setMonthlyMetric(e.target.value)}
                            className="h-8 rounded-md border border-gray-300 bg-white px-2 text-xs focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
                          >
                            {MONTHLY_METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                          </select>
                        )}
                      </>
                    )}
                  >
                    {GROUP_INTRO[grouping]}
                  </TabIntro>
                  <GroupTable
                    rows={rows}
                    grouping={grouping}
                    view={groupView}
                    metric={monthlyMetric}
                    periods={periods}
                    sort={sort}
                    onSort={handleSort}
                    testId={`group-table-${grouping}`}
                  />
                  {groupView === 'summary' && (
                    <p className="mt-2 text-xs text-gray-500">
                      Click a column header to sort. Factory overhead and other COGS are period costs and appear only in the gross margin bridge.
                      {(grouping === 'customer' || grouping === 'customer_type') && ' Commissions are an operating expense, so they are not deducted from contribution.'}
                    </p>
                  )}
                </TabsContent>
              )}

              <TabsContent value="labor" className="mt-5">
                <LaborTab
                  labor={labor}
                  loading={laborLoading}
                  metric={laborMetric}
                  onMetricChange={setLaborMetric}
                  hoursPerFteInput={hoursPerFteInput}
                  onHoursPerFteInput={setHoursPerFteInput}
                  onHoursPerFteCommit={commitHoursPerFte}
                  hoursPerFteError={hoursPerFteError}
                />
              </TabsContent>

              <TabsContent value="machines" className="mt-5">
                <MachinesTab labor={labor} loading={laborLoading} />
              </TabsContent>

              <TabsContent value="unit_costs" className="mt-5">
                <UnitCostsTab unitCosts={cogs.unit_costs || []} />
              </TabsContent>
            </Tabs>
          </Card>
        </>
      )}
    </div>
  );
};

export default CogsLaborForecast;
