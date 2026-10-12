import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useForecast } from '../../../context/ForecastContext';
import api from '../../../lib/apiClient';
import { defaultWindowForScenario } from '../../../lib/scenarioWindow';
import { cn } from '../../../lib/utils';
import { formatMoney } from '../../../lib/money';
import { PageHeader } from '../../ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { StatsCard } from '../../ui/stats-card';
import { Button, buttonVariants } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Select, SelectOption } from '../../ui/select';
import { getBOMDetails, getRoutingDetails } from './CostCalculations';
import CostWarningsBanner from '../../Common/CostWarningsBanner';
import MaterialsUsageTab from './MaterialsUsageTab';
import MachineUtilizationTab from './MachineUtilizationTab';
import LaborUtilizationTab from './LaborUtilizationTab';
import { ALL, DEFAULT_HOURS_PER_FTE, formatCompactCurrency, periodLabel } from './costViews';

const TABS = [
  { id: 'overview', label: 'Products' },
  { id: 'materials', label: 'Materials' },
  { id: 'machines', label: 'Machine capacity' },
  { id: 'labor', label: 'Labor & FTE' },
];

const REPORTS = {
  materials: '/products/materials/usage',
  machines: '/products/machines/utilization',
  labor: '/products/labor/utilization',
};

// Shared money rounding (lib/money): per-unit costs read the same here as on
// the COGS & Labor Unit costs tab and the product screens.
const formatCurrency = (value) => formatMoney(value || 0);

const formatPercent = (value) => `${(value || 0).toFixed(1)}%`;

const formatNumber = (value, decimals = 0) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value || 0);

// Minutes and quantities per unit keep their decimals (1.5 min must not read "2").
const formatMinutes = (value) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value || 0);

const pctOf = (part, whole) => (whole > 0 ? formatPercent((part / whole) * 100) : '—');

const monthsBetween = (start, end) => {
  const list = [];
  let [y, m] = String(start).split('-').map(Number);
  const [ey, em] = String(end).split('-').map(Number);
  if (!y || !m || !ey || !em) return list;
  while ((y < ey || (y === ey && m <= em)) && list.length < 240) {
    list.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return list;
};

const CostManagement = () => {
  const { data, loading, activeScenario, scenarios } = useForecast();
  const scenario = activeScenario ? scenarios?.[activeScenario] : null;
  // Same default window as the reports: the scenario's sales window (Jan–Dec 2027).
  const { start, end } = defaultWindowForScenario(scenario);

  const [activeTab, setActiveTab] = useState('overview');
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState(ALL);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Product cost summary + the COGS bridge (ties to the income statement).
  const [costSummary, setCostSummary] = useState([]);
  const [cogsTotals, setCogsTotals] = useState(null);
  const [summaryError, setSummaryError] = useState(null);

  // Month-by-month materials / machines / labor reports, loaded per tab.
  const [reports, setReports] = useState({});
  const [reportErrors, setReportErrors] = useState({});

  const salesRows = data?.sales_forecast;
  const bomRows = data?.bom;
  const operationRows = data?.router_operations;
  const machineRows = data?.machines;
  const laborRateRows = data?.labor_rates;

  useEffect(() => {
    let cancelled = false;
    setReports({});
    setReportErrors({});
    if (!activeScenario) {
      setCostSummary([]);
      setCogsTotals(null);
      return undefined;
    }
    setRefreshing(true);
    Promise.allSettled([
      api.get('/products/cost-summary', {
        params: { forecast_id: activeScenario, start_period: start, end_period: end },
        suppressErrorToast: true,
      }),
      api.get('/reporting/cogs-forecast', {
        params: { forecast_ids: activeScenario, start_period: start, end_period: end },
        suppressErrorToast: true,
      }),
    ]).then(([summaryRes, cogsRes]) => {
      if (cancelled) return;
      if (summaryRes.status === 'fulfilled') {
        setCostSummary((summaryRes.value?.data?.products || []).filter(p => (p.forecast_quantity || 0) > 0));
        setSummaryError(null);
      } else {
        setCostSummary([]);
        setSummaryError(summaryRes.reason?.userMessage || 'Could not load product costs');
      }
      setCogsTotals(cogsRes.status === 'fulfilled' ? cogsRes.value?.data?.summary?.totals || null : null);
      setRefreshing(false);
    });
    return () => { cancelled = true; };
    // The master data / sales rows are dependencies so the page re-reads the
    // costs after they change on another screen.
  }, [activeScenario, start, end, refreshKey, salesRows, bomRows, operationRows, machineRows, laborRateRows]);

  // A different scenario or window: start again from "All months".
  useEffect(() => { setSelectedPeriod(ALL); }, [activeScenario, start, end]);

  const loadReport = useCallback(async (kind) => {
    if (!activeScenario || !REPORTS[kind]) return;
    try {
      const res = await api.get(REPORTS[kind], {
        params: { forecast_id: activeScenario, start_period: start, end_period: end },
        suppressErrorToast: true,
      });
      setReports(prev => ({ ...prev, [kind]: res?.data || {} }));
      setReportErrors(prev => ({ ...prev, [kind]: null }));
    } catch (error) {
      setReportErrors(prev => ({ ...prev, [kind]: error?.userMessage || 'Could not load this report' }));
    }
  }, [activeScenario, start, end]);

  useEffect(() => {
    if (activeTab !== 'overview' && !reports[activeTab] && !reportErrors[activeTab]) {
      loadReport(activeTab);
    }
  }, [activeTab, reports, reportErrors, loadReport]);

  const periods = useMemo(() => {
    const fromReport = reports[activeTab]?.periods;
    if (Array.isArray(fromReport) && fromReport.length) return fromReport;
    return monthsBetween(start, end);
  }, [reports, activeTab, start, end]);

  const machineRates = useMemo(() => {
    const map = {};
    (Array.isArray(machineRows) ? machineRows : []).forEach(m => { map[m.machine_id] = m.machine_rate; });
    return map;
  }, [machineRows]);

  const selectedProduct = costSummary.find(p => p.product_id === selectedProductId) || null;
  const bomVersion = selectedProduct ? (selectedProduct.bom_version_used || selectedProduct.bom_version || '1.0') : '1.0';
  const bomDetails = useMemo(() => {
    if (!selectedProduct || !selectedProduct.bom_id) return [];
    return getBOMDetails({ bom: bomRows || [] }, selectedProduct.bom_id, bomVersion);
  }, [selectedProduct, bomVersion, bomRows]);
  const routingDetails = useMemo(() => {
    if (!selectedProduct || !selectedProduct.router_id) return [];
    return getRoutingDetails({
      router_operations: operationRows || [],
      machines: machineRows || [],
      labor_rates: laborRateRows || [],
    }, selectedProduct.router_id);
  }, [selectedProduct, operationRows, machineRows, laborRateRows]);

  if (loading && !activeScenario && costSummary.length === 0) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="ml-4 text-muted-foreground">Loading cost data...</p>
        </div>
      </div>
    );
  }

  // Totals: the COGS bridge (the income statement's numbers) when it loaded,
  // else the sum of the product rows.
  const sum = (key) => costSummary.reduce((acc, p) => acc + (p[key] || 0), 0);
  const t = cogsTotals || {
    gross_sales: sum('gross_sales'),
    total_sales_deductions: sum('total_sales_deductions'),
    net_sales: sum('forecasted_revenue'),
    materials: sum('material_cost'),
    labor: sum('labor_cost'),
    machine: sum('machine_cost'),
    product_cogs: sum('total_cogs'),
    factory_overhead: null,
    total_cogs: null,
  };
  const productCogs = t.product_cogs ?? ((t.materials || 0) + (t.labor || 0) + (t.machine || 0));
  const contribution = (t.net_sales || 0) - productCogs;
  const contributionPct = t.net_sales > 0 ? (contribution / t.net_sales) * 100 : 0;
  const windowText = `${periodLabel(start)} – ${periodLabel(end)}`;
  const scenarioText = scenario?.name || activeScenario;
  const hasOverhead = t.factory_overhead !== null && t.factory_overhead !== undefined;

  const report = reports[activeTab];
  const reportError = reportErrors[activeTab];

  return (
    <div className="container mx-auto px-6 py-8">
      <PageHeader
        title="Cost Management"
        description={activeScenario
          ? `Product costs, materials, machine capacity and direct labor for ${scenarioText} · ${windowText}`
          : 'Pick or create a scenario to see product costs.'}
        actions={(
          <>
            <Link to="/reporting/cogs-labor" className={cn(buttonVariants({ variant: 'outline' }), 'h-9')}>
              COGS &amp; labor forecast →
            </Link>
            <Button variant="outline" className="h-9" onClick={() => setRefreshKey(k => k + 1)} disabled={refreshing}>
              {refreshing ? 'Updating…' : 'Recalculate'}
            </Button>
          </>
        )}
      />

      <CostWarningsBanner />

      {summaryError && (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{summaryError}</div>
      )}

      {/* Summary tiles. Product COGS = materials + labor + machine, BEFORE factory overhead. */}
      <div className="mb-3 grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-6" data-testid="cost-kpis">
        <StatsCard
          title="Net sales"
          value={formatCompactCurrency(t.net_sales)}
          subtitle={t.total_sales_deductions
            ? `Gross ${formatCompactCurrency(t.gross_sales)} less ${formatCompactCurrency(t.total_sales_deductions)} deductions`
            : 'No sales deductions in this window'}
          help="Gross sales less terms, chargebacks, allowances and excise tax"
          variant="primary"
        />
        <StatsCard
          title="Product COGS"
          value={formatCompactCurrency(productCogs)}
          subtitle="Materials + labor + machine, before factory overhead"
          help="Product COGS (materials + labor + machine), before the direct labor variance, indirect labor, factory overhead and other COGS"
          variant="danger"
        />
        <StatsCard
          title="Materials"
          value={formatCompactCurrency(t.materials)}
          subtitle={`${pctOf(t.materials, productCogs)} of product COGS`}
          variant="info"
        />
        <StatsCard
          title="Direct labor"
          value={formatCompactCurrency(t.labor)}
          subtitle={`${pctOf(t.labor, productCogs)} of product COGS`}
          variant="warning"
        />
        <StatsCard
          title="Machine"
          value={formatCompactCurrency(t.machine)}
          subtitle={`${pctOf(t.machine, productCogs)} of product COGS`}
          variant="secondary"
        />
        <StatsCard
          title="Contribution margin"
          value={formatPercent(contributionPct)}
          subtitle={`${formatCompactCurrency(contribution)} = net sales − product COGS`}
          help="Before the direct labor variance, indirect labor, factory overhead and other COGS; the income statement's gross margin is after them"
          variant="success"
        />
      </div>

      {/* Reconcile to the income statement: total COGS = product COGS + every period cost in it. */}
      <p className="mb-8 text-sm text-gray-600" data-testid="cogs-reconciliation">
        {hasOverhead ? (
          <>
            Product COGS {formatCurrency(productCogs)}
            {t.labor_variance ? ` + direct labor variance ${formatCurrency(t.labor_variance)}` : ''}
            {t.indirect_labor ? ` + indirect labor ${formatCurrency(t.indirect_labor)}` : ''}
            {' '}+ factory overhead {formatCurrency(t.factory_overhead)}
            {t.other_cogs ? ` + other COGS ${formatCurrency(t.other_cogs)}` : ''} ={' '}
            <span className="font-medium text-gray-900">total COGS {formatCurrency(t.total_cogs)}</span> on the income statement
            {typeof t.gross_margin_pct === 'number' ? ` (gross margin ${formatPercent(t.gross_margin_pct)})` : ''}.{' '}
          </>
        ) : (
          <>These totals are product COGS; the income statement adds the direct labor variance, indirect labor, factory overhead and other COGS.{' '}</>
        )}
        <Link to="/reporting/cogs-labor" className="font-medium text-orange-700 hover:underline">See the full gross-margin bridge</Link>
      </p>

      {/* Tabs */}
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 sm:grid-cols-4" role="tablist">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'border border-orange-200 bg-white text-orange-700 shadow-sm'
                  : 'border border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab !== 'overview' && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <label htmlFor="cost-period" className="whitespace-nowrap text-sm font-medium text-gray-700">Show</label>
            <Select
              id="cost-period"
              className="h-9 w-64"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
            >
              <SelectOption value={ALL}>All months (average &amp; peak)</SelectOption>
              {periods.map(period => (
                <SelectOption key={period} value={period}>{periodLabel(period)}</SelectOption>
              ))}
            </Select>
          </div>
        )}

        {activeTab === 'overview' && (
          <div className="space-y-6">
            {costSummary.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-sm text-gray-500">
                  {activeScenario
                    ? `No products with sales in ${windowText}. Import or enter the sales forecast first.`
                    : 'No active scenario.'}
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 2xl:grid-cols-3">
                {costSummary.map((product) => (
                  <Card
                    key={product.product_id}
                    className={`cursor-pointer transition-shadow hover:shadow-md ${selectedProductId === product.product_id ? 'ring-2 ring-orange-500' : ''}`}
                    onClick={() => setSelectedProductId(product.product_id)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <CardTitle className="truncate text-lg" title={product.product_name}>{product.product_name || product.product_id}</CardTitle>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            <Badge variant="outline">{product.product_id}</Badge>
                            {product.bom_id && (
                              <Badge variant="outline" className="font-normal text-gray-600" title="BOM version this product is costed with">
                                {product.bom_id} v{product.bom_version_used || product.bom_version || '1.0'}
                              </Badge>
                            )}
                          </div>
                        </div>
                        {product.warnings && product.warnings.length > 0 && (
                          <Badge
                            variant="outline"
                            className="flex-none border-amber-400 bg-amber-50 text-amber-900"
                            title={`Incomplete cost data: ${product.warnings.join(', ')}`}
                          >
                            ⚠ {product.warnings.length}
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="mb-4 grid grid-cols-2 gap-3">
                        <div className="min-w-0">
                          <div className="text-xs text-muted-foreground">Net sales</div>
                          <div className="truncate font-semibold tabular-nums">{formatCurrency(product.forecasted_revenue)}</div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs text-muted-foreground">Product COGS</div>
                          <div className="truncate font-semibold tabular-nums text-red-600">{formatCurrency(product.total_cogs)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Contribution margin</div>
                          <div className={`font-semibold tabular-nums ${product.gross_margin_percent >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatPercent(product.gross_margin_percent)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Units</div>
                          <div className="font-semibold tabular-nums">{formatNumber(product.forecast_quantity)}</div>
                        </div>
                      </div>

                      <div className="space-y-1.5 text-sm">
                        {[['Materials', product.material_cost], ['Labor', product.labor_cost], ['Machine', product.machine_cost]].map(([label, value]) => (
                          <div key={label} className="flex justify-between gap-2">
                            <span className="text-gray-600">{label}</span>
                            <span className="tabular-nums">{formatCurrency(value)} <span className="text-gray-400">({pctOf(value, product.total_cogs)})</span></span>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                        Per unit: material {formatCurrency(product.unit_material_cost)} · labor {formatCurrency(product.unit_labor_cost)} · machine {formatCurrency(product.unit_machine_cost)}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {selectedProduct && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xl">
                      {selectedProduct.product_name}
                      <span className="ml-2 text-sm font-normal text-gray-500">cost build-up per unit</span>
                    </CardTitle>
                    <Button variant="ghost" size="sm" aria-label="Close details" onClick={() => setSelectedProductId(null)}>×</Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                    <div className="min-w-0">
                      <h3 className="mb-3 text-base font-semibold">
                        Bill of materials{selectedProduct.bom_id ? ` · ${selectedProduct.bom_id} v${bomVersion}` : ''}
                      </h3>
                      {bomDetails.length === 0 ? (
                        <p className="text-sm text-gray-500">{selectedProduct.bom_id ? 'This BOM version has no lines.' : 'No BOM linked to this product.'}</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm tabular-nums">
                            <thead>
                              <tr className="border-b text-gray-600">
                                <th className="p-2 text-left font-medium">Line</th>
                                <th className="p-2 text-left font-medium">Material</th>
                                <th className="p-2 text-right font-medium">Qty</th>
                                <th className="p-2 text-left font-medium">Unit</th>
                                <th className="p-2 text-right font-medium">Unit price</th>
                                <th className="p-2 text-right font-medium">Cost</th>
                              </tr>
                            </thead>
                            <tbody>
                              {bomDetails.map((item) => (
                                <tr key={`${item.bom_id}-${item.version}-${item.bom_line}`} className="border-b">
                                  <td className="p-2">{item.bom_line}</td>
                                  <td className="p-2">{item.material_description}</td>
                                  <td className="p-2 text-right">{formatMinutes(item.qty)}</td>
                                  <td className="p-2">{item.unit}</td>
                                  <td className="p-2 text-right">{formatCurrency(item.unit_price)}</td>
                                  <td className="p-2 text-right">{formatCurrency(item.material_cost)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    <div className="min-w-0">
                      <h3 className="mb-3 text-base font-semibold">
                        Routing{selectedProduct.router_id ? ` · ${selectedProduct.router_id}` : ''}
                      </h3>
                      {routingDetails.length === 0 ? (
                        <p className="text-sm text-gray-500">{selectedProduct.router_id ? 'This routing has no operations.' : 'No routing linked to this product.'}</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm tabular-nums">
                            <thead>
                              <tr className="border-b text-gray-600">
                                <th className="p-2 text-left font-medium">Seq</th>
                                <th className="p-2 text-left font-medium">Machine</th>
                                <th className="p-2 text-right font-medium">Machine min</th>
                                <th className="p-2 text-right font-medium">Labor min</th>
                                <th className="p-2 text-left font-medium">Labor type</th>
                                <th className="p-2 text-right font-medium">Labor rate</th>
                              </tr>
                            </thead>
                            <tbody>
                              {routingDetails.map((item) => (
                                <tr key={`${item.router_id}-${item.sequence}`} className="border-b">
                                  <td className="p-2">{item.sequence}</td>
                                  <td className="p-2">{item.machine_name}</td>
                                  <td className="p-2 text-right">{formatMinutes(item.machine_minutes)}</td>
                                  <td className="p-2 text-right">{formatMinutes(item.labor_minutes)}</td>
                                  <td className="p-2">{item.rate_name}</td>
                                  <td className="p-2 text-right">{formatCurrency(item.rate_amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {activeTab !== 'overview' && reportError && (
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-6 text-sm text-red-800">
              <span>{reportError}</span>
              <Button variant="outline" size="sm" onClick={() => setReportErrors(prev => ({ ...prev, [activeTab]: null }))}>
                Try again
              </Button>
            </CardContent>
          </Card>
        )}

        {activeTab !== 'overview' && !reportError && !report && (
          <Card>
            <CardContent className="flex items-center justify-center gap-3 py-12 text-sm text-gray-500">
              <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-orange-600" />
              Loading…
            </CardContent>
          </Card>
        )}

        {activeTab === 'materials' && report && (
          <MaterialsUsageTab
            materials={report.materials || []}
            periods={periods}
            totalCost={report.totals?.total_cost ?? null}
            selectedPeriod={selectedPeriod}
            formatCurrency={formatCurrency}
            formatNumber={formatNumber}
          />
        )}

        {activeTab === 'machines' && report && (
          <MachineUtilizationTab
            machines={report.machines || []}
            periods={periods}
            selectedPeriod={selectedPeriod}
            machineRates={machineRates}
            formatCurrency={formatCurrency}
            formatNumber={formatNumber}
          />
        )}

        {activeTab === 'labor' && report && (
          <LaborUtilizationTab
            labor={report.labor || []}
            periods={periods}
            hoursPerFte={report.hours_per_fte || DEFAULT_HOURS_PER_FTE}
            selectedPeriod={selectedPeriod}
            formatCurrency={formatCurrency}
            formatNumber={formatNumber}
          />
        )}
      </div>
    </div>
  );
};

export default CostManagement;
