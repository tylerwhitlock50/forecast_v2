import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { useForecast } from '../../../context/ForecastContext';
import { useReporting, buildExportUrl } from './hooks/useReporting';
import { useReportWindow } from './hooks/useReportWindow';
import { downloadWorkbook } from './hooks/useCogsLabor';
import ScenarioPicker from './components/ScenarioPicker';
import IncomeStatement from './components/IncomeStatement';
import BalanceSheet from './components/BalanceSheet';
import CashFlowStatement from './components/CashFlowStatement';
import VarianceReport from './components/VarianceReport';
import AssumptionsPanel from './components/AssumptionsPanel';
import ReportingControls from './components/ReportingControls';
import ReportWarnings from './components/ReportWarnings';
import { Card } from '../../ui/card';
import { Button } from '../../ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../ui/tabs';
import { isLocked } from '../Scenarios/governance';
import { formatPeriod } from './utils/formatters';

const TABS = [
  { id: 'income-statement', label: 'Income Statement' },
  { id: 'balance-sheet', label: 'Balance Sheet' },
  { id: 'cash-flow', label: 'Cash Flow' },
  { id: 'variance', label: 'Budget vs Actual' },
  { id: 'assumptions', label: 'Assumptions' }
];

// Shown inline on the income statement instead of in the banner.
const HIDDEN_WARNINGS = ['no_deduction_rules'];

const ReportingDashboard = () => {
  const { state, activeScenario, actions } = useForecast();
  const { statements, loading, error, fetchStatements } = useReporting();

  const [selectedForecasts, setSelectedForecasts] = useState([]);
  const [consolidate, setConsolidate] = useState(false);
  const [activeTab, setActiveTab] = useState('income-statement');
  const [dismissedWarningsKey, setDismissedWarningsKey] = useState(null);
  const [exporting, setExporting] = useState(false);

  const scenarios = useMemo(() => state.scenarios || {}, [state.scenarios]);

  // Statements follow the active scenario unless the user is consolidating
  // several scenarios on this page.
  useEffect(() => {
    if (consolidate) return;
    const list = Object.values(scenarios);
    if (list.length === 0) {
      setSelectedForecasts([]);
      return;
    }
    const preferred = activeScenario && scenarios[activeScenario] ? activeScenario : list[0].id;
    setSelectedForecasts(prev => (prev.length === 1 && prev[0] === preferred ? prev : [preferred]));
  }, [scenarios, activeScenario, consolidate]);

  // Reporting window: the selected scenarios' sales window (whole calendar
  // years), following the scenario until the user picks a window by hand.
  const selectedScenarios = useMemo(() => selectedForecasts.map(id => scenarios[id]).filter(Boolean), [selectedForecasts, scenarios]);
  const { period: reportingPeriod, setPeriod: setReportingPeriod, defaultWindow } = useReportWindow(selectedScenarios);

  // Not consolidating, the page shows the active scenario: picking another
  // one here switches the active scenario (as the scenario bar does), so the
  // statements and the bar never disagree.
  const handlePickScenarios = (ids) => {
    if (consolidate) {
      setSelectedForecasts(ids);
      return;
    }
    const id = ids[0];
    if (id && id !== activeScenario) actions.switchScenario(id);
  };

  const handleConsolidateChange = (value) => {
    setConsolidate(value);
    if (!value) {
      const preferred = activeScenario && scenarios[activeScenario] ? activeScenario : selectedForecasts[0];
      setSelectedForecasts(preferred ? [preferred] : []);
    }
  };

  const refetch = useCallback(() => {
    if (selectedForecasts.length > 0) {
      fetchStatements(selectedForecasts, reportingPeriod);
    }
  }, [selectedForecasts, reportingPeriod, fetchStatements]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const warnings = statements?.warnings || [];
  const warningsKey = statements?.generated_at || JSON.stringify(warnings);
  const visibleWarnings = dismissedWarningsKey === warningsKey ? warnings.filter(w => w.level === 'info') : warnings;

  const handleExportCsv = () => {
    if (selectedForecasts.length === 0) return;
    window.open(buildExportUrl(selectedForecasts, reportingPeriod, 'wide'), '_blank');
  };

  const primaryForecastId = selectedForecasts[0];
  const primaryForecastName = scenarios[primaryForecastId]?.name;
  // Approved and locked: its assumptions and its own capex are read-only.
  const primaryForecastLocked = isLocked(scenarios[primaryForecastId]);
  const hasStatements = Boolean(statements?.income_statement);

  const handleExportWorkbook = async () => {
    if (selectedForecasts.length === 0) return;
    setExporting(true);
    try {
      await downloadWorkbook(selectedForecasts, reportingPeriod, selectedScenarios.map(s => s.name).join('_'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="container mx-auto space-y-6 px-6 py-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold text-gray-900">Reporting &amp; Analysis</h1>
          <p className="mt-1 max-w-3xl text-gray-600">
            Month-by-month income statement, balance sheet and cash flow for the active scenario, or for several scenarios added
            together. Margins by product and customer and the labor plan are
            on <Link to="/reporting/cogs-labor" className="font-medium text-orange-700 hover:underline">COGS &amp; Labor Forecast</Link>.
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          {loading && (
            <span className="text-xs text-gray-500 flex items-center gap-1.5" aria-live="polite">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Updating…
            </span>
          )}
          <Button variant="outline" onClick={handleExportCsv} disabled={selectedForecasts.length === 0} title="Statements as CSV, one column per month">
            <Download className="mr-2 h-4 w-4" aria-hidden="true" /> Export CSV
          </Button>
          <Button
            onClick={handleExportWorkbook}
            disabled={selectedForecasts.length === 0 || exporting}
            className="bg-orange-600 text-white hover:bg-orange-700"
            title="Statements, gross margin by product / customer, labor plan, sales detail, price list and deduction rules in one Excel file"
          >
            <FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden="true" /> {exporting ? 'Preparing…' : 'Export Excel workbook'}
          </Button>
        </div>
      </div>

      <Card className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <h3 className="text-base font-semibold text-gray-900 mb-1">Scenario</h3>
            <p className="mb-3 text-xs text-gray-500" data-testid="statements-scope-help">
              {consolidate
                ? 'Consolidating: the statements add up the scenarios ticked below and no longer follow the active scenario. Untick “Consolidate several scenarios” to go back to it.'
                : 'The statements follow the active scenario in the bar above. Choosing a different one here switches the active scenario. Tick “Consolidate several scenarios” to add several together.'}
            </p>
            <ScenarioPicker
              scenarios={scenarios}
              selected={selectedForecasts}
              onChange={handlePickScenarios}
              mode="single"
              consolidate={consolidate}
              onConsolidateChange={handleConsolidateChange}
            />
            <p className="mt-3 text-xs text-gray-500">
              Looking for side-by-side numbers? Use <Link to="/reporting/comparison" className="underline">Compare scenarios</Link>.
            </p>
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900 mb-3">Reporting window</h3>
            <ReportingControls period={reportingPeriod} onPeriodChange={setReportingPeriod} defaultWindow={defaultWindow} />
          </div>
        </div>
      </Card>

      {selectedForecasts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
          <span>{consolidate && selectedForecasts.length > 1 ? 'Consolidating' : 'Showing'}</span>
          {selectedForecasts.map(id => {
            const scenario = scenarios[id];
            return scenario ? (
              <span key={id} className="rounded bg-orange-50 px-2 py-0.5 font-medium text-orange-800 ring-1 ring-orange-200">{scenario.name}</span>
            ) : null;
          })}
          <span>for {formatPeriod(reportingPeriod.start)} – {formatPeriod(reportingPeriod.end)}</span>
          {statements?.generated_at && (
            <span className="text-xs text-gray-400">· generated {new Date(statements.generated_at).toLocaleString()}</span>
          )}
        </div>
      )}

      <ReportWarnings
        warnings={visibleWarnings}
        hide={HIDDEN_WARNINGS}
        onDismiss={() => setDismissedWarningsKey(warningsKey)}
      />

      {error && (
        <Card className="p-6 border-red-200 bg-red-50">
          <div className="text-red-800">
            <h3 className="font-medium">Could not load the statements</h3>
            <p className="mt-1 text-sm">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={refetch}>Try again</Button>
          </div>
        </Card>
      )}

      {selectedForecasts.length > 0 && (
        <Card className="p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            {/* On a phone the tabs wrap onto more rows instead of squeezing the labels into fixed fifths. */}
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
              {TABS.map(tab => (
                <TabsTrigger key={tab.id} value={tab.id} className="flex-1 px-2.5 sm:px-3">{tab.label}</TabsTrigger>
              ))}
            </TabsList>

            {activeTab === 'income-statement' && (
              <TabsContent value="income-statement" className="mt-6">
                {hasStatements ? (
                  <IncomeStatement data={statements.income_statement} periods={statements.periods} detail={statements.detail} />
                ) : (
                  <EmptyState loading={loading} />
                )}
              </TabsContent>
            )}
            {activeTab === 'balance-sheet' && (
              <TabsContent value="balance-sheet" className="mt-6">
                {hasStatements ? <BalanceSheet data={statements.balance_sheet} carryForward={statements.carry_forward} /> : <EmptyState loading={loading} />}
              </TabsContent>
            )}
            {activeTab === 'cash-flow' && (
              <TabsContent value="cash-flow" className="mt-6">
                {hasStatements ? <CashFlowStatement data={statements.cash_flow} /> : <EmptyState loading={loading} />}
              </TabsContent>
            )}
            {activeTab === 'variance' && (
              <TabsContent value="variance" className="mt-6">
                <VarianceReport forecastIds={selectedForecasts} period={reportingPeriod} />
              </TabsContent>
            )}
            {activeTab === 'assumptions' && (
              <TabsContent value="assumptions" className="mt-6">
                {selectedForecasts.length > 1 && (
                  <p className="text-sm text-amber-700 mb-4">
                    Assumptions are stored per forecast; editing <span className="font-medium">{primaryForecastName || primaryForecastId}</span> (the first selected forecast).
                  </p>
                )}
                <AssumptionsPanel
                  forecastId={primaryForecastId}
                  forecastName={primaryForecastName}
                  locked={primaryForecastLocked}
                  period={reportingPeriod}
                  onChanged={refetch}
                />
              </TabsContent>
            )}
          </Tabs>
        </Card>
      )}

      {selectedForecasts.length === 0 && (
        <Card className="p-12 text-center">
          <h3 className="text-xl font-medium text-gray-700 mb-2">Select a scenario to begin</h3>
          <p className="text-gray-500">
            Pick a scenario above, or <Link to="/scenarios" className="font-medium text-orange-700 hover:underline">create one under Scenarios</Link> and{' '}
            <Link to="/import" className="font-medium text-orange-700 hover:underline">import a sales forecast</Link>.
          </p>
        </Card>
      )}
    </div>
  );
};

const EmptyState = ({ loading }) => (
  <div className="text-center py-8 text-gray-500">
    {loading ? 'Loading financial statements…' : 'No statement data available for this selection.'}
  </div>
);

export default ReportingDashboard;
