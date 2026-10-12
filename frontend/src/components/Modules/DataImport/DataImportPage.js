import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import api from '../../../lib/apiClient';
import { useForecast } from '../../../context/ForecastContext';
import { Card } from '../../ui/card';
import ImportStepCard from './ImportStepCard';
import { IMPORT_STEPS, normalizeTemplateDocs, plural } from './importSteps';
import { extractList } from '../Pricing/pricingUtils';
import { scrollToImportStep, stepFromHash } from '../../Common/importLink';

const NEXT_STEPS = [
  { to: '/pricing', title: 'Pricing & deductions', text: 'Check prices by customer type and the terms, chargebacks and excise tax rules.' },
  { to: '/reporting/cogs-labor', title: 'COGS & labor forecast', text: 'Gross sales → net sales → COGS → gross profit, plus labor hours by month. Export to Excel.' },
  { to: '/reporting', title: 'Financial statements', text: 'Income statement, cash flow and balance sheet for the scenario.' },
];

const HIGHLIGHT_MS = 2500;

const distinctCount = (rows, field) => new Set((rows || []).map((r) => r?.[field]).filter(Boolean)).size;

/**
 * Get started: load every kind of data in dependency order. Each step checks
 * the file with the server first (dry run) and only saves on confirm.
 */
const DataImportPage = () => {
  const { data, scenarios, activeScenario, actions } = useForecast();
  const location = useLocation();
  const [docs, setDocs] = useState({});
  const [ruleCounts, setRuleCounts] = useState({ prices: null, deductions: null });
  const [highlighted, setHighlighted] = useState(null);

  // Deep links (/import#sales, #boms, #labor_rates ...): on load and on every
  // navigation to a hash, even the same one again, scroll to that step and
  // highlight it briefly.
  const targetStep = stepFromHash(location.hash);
  useEffect(() => {
    if (!targetStep) return undefined;
    setHighlighted(targetStep);
    const stopScrolling = scrollToImportStep(targetStep);
    const timer = window.setTimeout(() => setHighlighted(null), HIGHLIGHT_MS);
    return () => {
      stopScrolling();
      window.clearTimeout(timer);
    };
  }, [targetStep, location.key]);

  const scenario = activeScenario ? scenarios?.[activeScenario] || null : null;
  const noScenarios = Object.keys(scenarios || {}).length === 0;

  useEffect(() => {
    let cancelled = false;
    api.get('/import/templates', { suppressErrorToast: true })
      .then((res) => { if (!cancelled) setDocs(normalizeTemplateDocs(res)); })
      .catch(() => { /* fall back to the built-in column lists */ });
    return () => { cancelled = true; };
  }, []);

  const loadRuleCounts = useCallback(async () => {
    const fid = activeScenario ? `?forecast_id=${encodeURIComponent(activeScenario)}` : '';
    const [prices, deductions] = await Promise.all([
      api.get(`/pricing/prices${fid}`, { suppressErrorToast: true }).then((r) => extractList(r, ['prices', 'rules']).length).catch(() => null),
      api.get(`/pricing/deductions${fid}`, { suppressErrorToast: true }).then((r) => extractList(r, ['rules', 'deductions']).length).catch(() => null),
    ]);
    setRuleCounts({ prices, deductions });
  }, [activeScenario]);

  useEffect(() => { loadRuleCounts(); }, [loadRuleCounts]);

  const counts = useMemo(() => {
    const bomLines = (data?.bom || []).length;
    const bomCount = distinctCount(data?.bom, 'bom_id');
    const routers = (data?.router_definitions || []).length;
    const ops = (data?.router_operations || []).length;
    const salesRows = scenario ? (scenario.sales_rows ?? (data?.sales_forecast || []).length) : null;
    return {
      customers: { count: (data?.customers || []).length },
      products: { count: (data?.products || []).length },
      machines: { count: (data?.machines || []).length },
      labor_rates: { count: (data?.labor_rates || []).length },
      routings: { count: routers, label: routers ? `${plural(routers, ['routing', 'routings'])} · ${plural(ops, ['operation', 'operations'])}` : null },
      boms: { count: bomCount, label: bomCount ? `${plural(bomCount, ['BOM', 'BOMs'])} · ${plural(bomLines, ['line', 'lines'])}` : null },
      prices: { count: ruleCounts.prices },
      deductions: { count: ruleCounts.deductions },
      sales: { count: salesRows },
    };
  }, [data, scenario, ruleCounts]);

  const doneSteps = IMPORT_STEPS.filter((s) => (counts[s.kind]?.count || 0) > 0).length;
  const pct = Math.round((doneSteps / IMPORT_STEPS.length) * 100);
  const isEmpty = doneSteps === 0;

  const handleImported = async (step) => {
    await actions.fetchAllData();
    if (step.kind === 'prices' || step.kind === 'deductions') await loadRuleCounts();
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-bold text-gray-900">Import data</h1>
          <p className="mt-1 text-gray-600">
            Load your data in this order: each step uses the ones above it. Every file is checked by the server first,
            so you see what will be added, updated or rejected before anything is saved.
          </p>
        </div>
        <div className="w-full max-w-xs" aria-label="Setup progress">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium text-gray-700">Setup progress</span>
            <span className="tabular-nums text-gray-500">{doneSteps} of {IMPORT_STEPS.length} steps have data</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-200">
            <div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {isEmpty && (
        <Card className="border-orange-200 bg-orange-50/60 p-5">
          <h2 className="text-base font-semibold text-gray-900">Starting from an empty model</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-700">
            <li>Download the template for a step to see the expected columns. Column names are flexible (for example <span className="font-mono">SKU</span> works for the product id).</li>
            <li>Fill it in Excel or export from your ERP, then upload the CSV or Excel file (the first sheet is read).</li>
            {noScenarios && <li>Before the sales forecast, <Link to="/scenarios" className="font-medium text-orange-700 underline">create a scenario</Link> (for example “Budget 2027”).</li>}
          </ol>
        </Card>
      )}

      <div className="space-y-3">
        {IMPORT_STEPS.map((step, index) => (
          <ImportStepCard
            key={step.kind}
            step={step}
            number={index + 1}
            count={counts[step.kind]?.count ?? null}
            countLabel={counts[step.kind]?.label || null}
            docs={docs[step.kind] || (step.table ? docs[step.table] : null) || null}
            scenario={scenario}
            noScenarios={noScenarios}
            onImported={handleImported}
            highlighted={highlighted === step.kind}
          />
        ))}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Then review the numbers</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {NEXT_STEPS.map((n) => (
            <Link key={n.to} to={n.to} className="group rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-orange-300 hover:shadow">
              <div className="flex items-center justify-between font-medium text-gray-900">
                {n.title}
                <ArrowRight className="h-4 w-4 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-orange-600" />
              </div>
              <p className="mt-1 text-sm text-gray-600">{n.text}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DataImportPage;
