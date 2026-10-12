import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useForecast } from '../../../context/ForecastContext';
import { useReporting, buildExportUrl } from './hooks/useReporting';
import ScenarioPicker from './components/ScenarioPicker';
import IncomeStatement from './components/IncomeStatement';
import BalanceSheet from './components/BalanceSheet';
import CashFlowStatement from './components/CashFlowStatement';
import VarianceReport from './components/VarianceReport';
import AssumptionsPanel from './components/AssumptionsPanel';
import ReportingControls from './components/ReportingControls';
import { Card } from '../../ui/card';
import { Button } from '../../ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../ui/tabs';
import CostWarningsBanner from '../../Common/CostWarningsBanner';
import { formatPeriod } from './utils/formatters';

const TABS = [
  { id: 'income-statement', label: 'Income Statement' },
  { id: 'balance-sheet', label: 'Balance Sheet' },
  { id: 'cash-flow', label: 'Cash Flow' },
  { id: 'variance', label: 'Budget vs Actual' },
  { id: 'assumptions', label: 'Assumptions' }
];

const WARNING_LINKS = {
  cost_warnings: { to: '/bom', label: 'Review BOMs & routings' }
};

const currentYearPeriod = () => {
  const year = new Date().getFullYear();
  return { start: `${year}-01`, end: `${year}-12` };
};

const WarningsBanner = ({ warnings, onDismiss }) => {
  if (!warnings || warnings.length === 0) return null;
  return (
    <Card className="border-amber-300 bg-amber-50">
      <div className="p-4 flex items-start justify-between gap-4">
        <ul className="space-y-1 text-sm text-amber-900">
          {warnings.map((w, i) => {
            const link = WARNING_LINKS[w.code];
            return (
              <li key={`${w.code}-${i}`} className="flex flex-wrap items-center gap-2">
                <span className="font-medium uppercase text-[11px] tracking-wide text-amber-700">{w.code?.replace(/_/g, ' ')}</span>
                <span>{w.message}</span>
                {Array.isArray(w.periods) && w.periods.length > 0 && (
                  <span className="text-amber-700">({w.periods.map(formatPeriod).join(', ')})</span>
                )}
                {link && (
                  <Link to={link.to} className="underline text-amber-800 hover:text-amber-900">{link.label}</Link>
                )}
              </li>
            );
          })}
        </ul>
        <Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button>
      </div>
    </Card>
  );
};

const ReportingDashboard = () => {
  const { state, activeScenario } = useForecast();
  const { statements, loading, error, fetchStatements } = useReporting();

  const [selectedForecasts, setSelectedForecasts] = useState([]);
  const [consolidate, setConsolidate] = useState(false);
  const [reportingPeriod, setReportingPeriod] = useState(currentYearPeriod);
  const [activeTab, setActiveTab] = useState('income-statement');
  const [dismissedWarningsKey, setDismissedWarningsKey] = useState(null);

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
  const visibleWarnings = dismissedWarningsKey === warningsKey ? [] : warnings;

  const handleExportCsv = () => {
    if (selectedForecasts.length === 0) return;
    window.open(buildExportUrl(selectedForecasts, reportingPeriod, 'wide'), '_blank');
  };

  const primaryForecastId = selectedForecasts[0];
  const primaryForecastName = scenarios[primaryForecastId]?.name;
  const hasStatements = Boolean(statements?.income_statement);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reporting & Analysis</h1>
          <p className="text-gray-600">Income statement, balance sheet and cash flow for one scenario (or a consolidation of several)</p>
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <span className="text-sm text-gray-500 flex items-center gap-2">
              <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 inline-block" />
              Updating...
            </span>
          )}
          <Button variant="outline" onClick={handleExportCsv} disabled={selectedForecasts.length === 0}>
            Export CSV
          </Button>
        </div>
      </div>

      <CostWarningsBanner />

      <Card className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="text-lg font-medium mb-4">Scenario</h3>
            <ScenarioPicker
              scenarios={scenarios}
              selected={selectedForecasts}
              onChange={setSelectedForecasts}
              mode="single"
              consolidate={consolidate}
              onConsolidateChange={handleConsolidateChange}
            />
            <p className="mt-3 text-xs text-gray-500">
              Looking for side-by-side numbers? Use <Link to="/reporting/comparison" className="underline">Compare scenarios</Link>.
            </p>
          </div>
          <div>
            <h3 className="text-lg font-medium mb-4">Reporting Period</h3>
            <ReportingControls period={reportingPeriod} onPeriodChange={setReportingPeriod} />
          </div>
        </div>
      </Card>

      {selectedForecasts.length > 0 && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
            <span>{consolidate && selectedForecasts.length > 1 ? 'Consolidating:' : 'Scenario:'}</span>
            {selectedForecasts.map(id => {
              const scenario = scenarios[id];
              return scenario ? (
                <span key={id} className="bg-blue-100 text-blue-800 px-2 py-1 rounded">{scenario.name}</span>
              ) : null;
            })}
            <span>•</span>
            <span>Period: {formatPeriod(reportingPeriod.start)} to {formatPeriod(reportingPeriod.end)}</span>
            {statements?.generated_at && (
              <span className="text-xs text-gray-400">• generated {new Date(statements.generated_at).toLocaleString()}</span>
            )}
          </div>
        </Card>
      )}

      <WarningsBanner warnings={visibleWarnings} onDismiss={() => setDismissedWarningsKey(warningsKey)} />

      {error && (
        <Card className="p-6 border-red-200 bg-red-50">
          <div className="text-red-800">
            <h3 className="font-medium">Error Loading Data</h3>
            <p className="mt-1">{error}</p>
          </div>
        </Card>
      )}

      {selectedForecasts.length > 0 && (
        <Card className="p-6">
          <Tabs value={activeTab}>
            <TabsList className="grid w-full grid-cols-5">
              {TABS.map(tab => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  data-state={activeTab === tab.id ? 'active' : 'inactive'}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </TabsTrigger>
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
          <div className="text-gray-400">
            <h3 className="text-xl font-medium text-gray-500 mb-2">Select a scenario to begin</h3>
            <p className="text-gray-400">Pick a scenario above, or create one under Scenarios</p>
          </div>
        </Card>
      )}
    </div>
  );
};

const EmptyState = ({ loading }) => (
  <div className="text-center py-8 text-gray-500">
    {loading ? 'Loading financial statements...' : 'No statement data available for this selection.'}
  </div>
);

export default ReportingDashboard;
