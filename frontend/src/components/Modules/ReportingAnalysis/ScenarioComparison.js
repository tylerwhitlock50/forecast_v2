import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useForecast } from '../../../context/ForecastContext';
import ScenarioPicker from './components/ScenarioPicker';
import ReportingControls from './components/ReportingControls';
import { useScenarioComparison } from './hooks/useScenarioComparison';
import { Card } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { formatAccounting, formatPeriod } from './utils/formatters';

const METRICS = [
  { key: 'revenue', label: 'Revenue', direction: 'income' },
  { key: 'cogs', label: 'Cost of goods sold', direction: 'expense' },
  { key: 'gross_profit', label: 'Gross profit', direction: 'income', bold: true },
  { key: 'payroll', label: 'Payroll', direction: 'expense' },
  { key: 'expenses', label: 'Other operating expense', direction: 'expense' },
  { key: 'operating_income', label: 'Operating income', direction: 'income', bold: true },
  { key: 'net_income', label: 'Net income', direction: 'income', bold: true },
  { key: 'closing_cash', label: 'Closing cash', direction: 'income', bold: true },
];

const deltaClass = (delta, direction) => {
  if (delta === null || delta === undefined || Math.abs(delta) < 0.5) return 'text-gray-400';
  const favorable = direction === 'expense' ? delta < 0 : delta > 0;
  return favorable ? 'text-green-700' : 'text-red-600';
};

const pct = (delta, base) => {
  if (delta === null || delta === undefined || !base) return null;
  return (delta / Math.abs(base)) * 100;
};

/**
 * Compare 2–4 scenarios side by side over ONE shared window, with every
 * non-base column shown as a delta against the base scenario.
 */
const ScenarioComparison = () => {
  const { scenarios, activeScenario } = useForecast();
  const [selected, setSelected] = useState([]);
  const [customWindow, setCustomWindow] = useState(null); // null = union of sales months
  const { data, window: serverWindow, loading, error, fetchComparison } = useScenarioComparison();

  const list = useMemo(() => Object.values(scenarios || {}), [scenarios]);

  // Default: the base scenario plus the active one (or the first two).
  useEffect(() => {
    if (selected.length > 0 || list.length === 0) return;
    const base = list.find(s => s.is_base);
    const ids = [];
    if (base) ids.push(base.id);
    if (activeScenario && !ids.includes(activeScenario)) ids.push(activeScenario);
    for (const s of list) {
      if (ids.length >= 2) break;
      if (!ids.includes(s.id)) ids.push(s.id);
    }
    setSelected(ids);
  }, [list, activeScenario, selected.length]);

  useEffect(() => {
    fetchComparison(selected, customWindow);
  }, [selected, customWindow, fetchComparison]);

  const rows = useMemo(() => {
    // Base column: the flagged base if selected, else the first selected.
    const ordered = selected.map(id => data.find(r => r.forecast_id === id)).filter(Boolean);
    const baseIndex = Math.max(0, ordered.findIndex(r => r.is_base));
    if (baseIndex > 0) ordered.unshift(ordered.splice(baseIndex, 1)[0]);
    return ordered;
  }, [data, selected]);
  const baseRow = rows[0] || null;
  const activeWindow = customWindow || (serverWindow ? { start: serverWindow.start_period, end: serverWindow.end_period } : null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Compare scenarios</h1>
          <p className="text-gray-600">
            Each column is totalled over the same window using the statements engine, so the figures match the Statements screen.
            Deltas are against the base scenario.
          </p>
        </div>
        <Link to="/scenarios" className="text-sm font-medium text-orange-700 hover:underline">Manage scenarios</Link>
      </div>

      <Card className="p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-3 text-lg font-medium">Scenarios</h3>
            <ScenarioPicker scenarios={scenarios} selected={selected} onChange={setSelected} mode="multi" min={1} max={4} />
          </div>
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-medium">Window</h3>
              {customWindow ? (
                <Button size="sm" variant="outline" onClick={() => setCustomWindow(null)}>Use full sales window</Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setCustomWindow(activeWindow || { start: `${new Date().getFullYear()}-01`, end: `${new Date().getFullYear()}-12` })}>
                  Choose a window
                </Button>
              )}
            </div>
            {customWindow ? (
              <ReportingControls period={customWindow} onPeriodChange={setCustomWindow} />
            ) : (
              <p className="text-sm text-gray-600">
                {activeWindow
                  ? <>Union of the selected scenarios' sales months: <span className="font-medium">{formatPeriod(activeWindow.start)} – {formatPeriod(activeWindow.end)}</span>. A branch that was extended by a few months is still compared like for like.</>
                  : 'Pick scenarios to see their shared window.'}
              </p>
            )}
          </div>
        </div>
      </Card>

      {loading && <p className="text-sm text-gray-500">Loading comparison…</p>}
      {error && <p className="text-red-600">{error}</p>}

      {rows.length > 0 && (
        <Card className="overflow-x-auto p-6">
          <table className="min-w-full text-sm tabular-nums">
            <thead>
              <tr className="text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3 text-left">Line</th>
                {rows.map((r, i) => (
                  <th key={r.forecast_id} className="px-4 py-3 text-right" colSpan={i === 0 ? 1 : 2}>
                    <div className="flex items-center justify-end gap-2 normal-case">
                      <span className="text-sm font-semibold text-gray-900">{r.name}</span>
                      <span className="font-mono text-xs text-gray-400">{r.forecast_id}</span>
                      {i === 0 && <Badge variant="secondary">{r.is_base ? 'Base' : 'Reference'}</Badge>}
                    </div>
                  </th>
                ))}
              </tr>
              {rows.length > 1 && (
                <tr className="text-[11px] uppercase tracking-wider text-gray-400">
                  <th />
                  <th className="px-4 pb-2 text-right">Amount</th>
                  {rows.slice(1).map(r => (
                    <React.Fragment key={r.forecast_id}>
                      <th className="px-4 pb-2 text-right">Amount</th>
                      <th className="px-4 pb-2 text-right">Δ vs base</th>
                    </React.Fragment>
                  ))}
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-gray-100">
              {METRICS.map(m => (
                <tr key={m.key} className={m.bold ? 'font-semibold' : ''}>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-800">{m.label}</td>
                  <td className="px-4 py-2 text-right">{formatAccounting(baseRow?.[m.key])}</td>
                  {rows.slice(1).map(r => {
                    const value = r[m.key];
                    const base = baseRow?.[m.key];
                    const delta = value === null || value === undefined || base === null || base === undefined ? null : value - base;
                    const p = pct(delta, base);
                    return (
                      <React.Fragment key={r.forecast_id}>
                        <td className="px-4 py-2 text-right">{formatAccounting(value)}</td>
                        <td className={`px-4 py-2 text-right ${deltaClass(delta, m.direction)}`}>
                          {delta === null ? '—' : (
                            <>
                              {delta > 0 ? '+' : ''}{formatAccounting(delta)}
                              {p !== null && <span className="ml-1 text-xs">({p > 0 ? '+' : ''}{p.toFixed(1)}%)</span>}
                            </>
                          )}
                        </td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 1 && (
            <p className="mt-3 text-xs text-gray-500">Select a second scenario to see deltas.</p>
          )}
        </Card>
      )}
    </div>
  );
};

export default ScenarioComparison;
