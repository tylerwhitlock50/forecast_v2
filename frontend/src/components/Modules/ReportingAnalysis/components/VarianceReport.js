import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../../../lib/apiClient';
import { useVariance } from '../hooks/useVariance';
import { Card } from '../../../ui/card';
import { Button } from '../../../ui/button';
import { Input } from '../../../ui/input';
import { Label } from '../../../ui/label';
import { Select, SelectOption } from '../../../ui/select';
import { Badge } from '../../../ui/badge';
import { cn } from '../../../../lib/utils';
import { formatAccounting, formatPct, formatPeriod } from '../utils/formatters';

const STATEMENT_LABELS = {
  income: 'Income statement',
  cash_flow: 'Cash flow',
  balance_sheet: 'Balance sheet'
};

const varianceClass = (favorable) => {
  if (favorable === true) return 'text-green-600';
  if (favorable === false) return 'text-red-600';
  return 'text-gray-400';
};

const FavBadge = ({ favorable }) => {
  if (favorable === null || favorable === undefined) return <span className="text-gray-400">—</span>;
  return favorable ? (
    <Badge variant="success" className="px-2">Fav</Badge>
  ) : (
    <Badge variant="destructive" className="px-2">Unfav</Badge>
  );
};

const cell = (value) => (value === null || value === undefined ? '—' : formatAccounting(value));
const pctCell = (value) => (value === null || value === undefined ? '—' : formatPct(value));

// CSV template for actual imports, built client-side.
export const buildActualsTemplate = (lineItems, period) => {
  const header = 'period,line_item,amount,reference_id,notes';
  const body = lineItems.map(li => `${period || ''},${li.line_item},,,`).join('\n');
  return `${header}\n${body}\n`;
};

const VarianceReport = ({ forecastIds, period }) => {
  const { variance, loading, error, fetchVariance } = useVariance();
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [lineItems, setLineItems] = useState([]);
  const [entryPeriod, setEntryPeriod] = useState('');
  const [entryValues, setEntryValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [importResult, setImportResult] = useState(null);

  const refresh = useCallback(() => fetchVariance(forecastIds, period), [fetchVariance, forecastIds, period]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Line item catalogue for the entry form (falls back to the variance payload).
  useEffect(() => {
    let cancelled = false;
    api.get('/reporting/actuals/line-items', { suppressErrorToast: true })
      .then(res => {
        if (!cancelled && res?.data?.line_items) setLineItems(res.data.line_items);
      })
      .catch(() => {
        // handled by fallback below
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const periods = useMemo(() => variance?.periods || [], [variance]);
  const withActuals = useMemo(() => variance?.periods_with_actuals || [], [variance]);
  const items = useMemo(() => variance?.line_items || [], [variance]);

  const effectiveLineItems = useMemo(() => {
    if (lineItems.length > 0) return lineItems;
    return items.map(li => ({ line_item: li.line_item, label: li.label, direction: li.direction, statement: li.statement }));
  }, [lineItems, items]);

  // Default: latest period with actuals, else first period.
  useEffect(() => {
    if (periods.length === 0) return;
    const preferred = withActuals.length > 0 ? withActuals[withActuals.length - 1] : periods[0];
    setSelectedPeriod(prev => (prev && periods.includes(prev) ? prev : preferred));
    setEntryPeriod(prev => (prev && periods.includes(prev) ? prev : preferred));
  }, [periods, withActuals]);

  // Prefill the entry form from existing actuals for the entry period.
  const loadEntryValues = useCallback(async (p) => {
    if (!p) return;
    try {
      const res = await api.get(`/reporting/actuals?start_period=${p}&end_period=${p}`, { suppressErrorToast: true });
      const next = {};
      (res?.data?.actuals || []).forEach(a => {
        if (a.reference_id) return; // reference-level entries are not edited here
        next[a.line_item] = a.amount;
      });
      setEntryValues(next);
    } catch {
      setEntryValues({});
    }
  }, []);

  useEffect(() => {
    loadEntryValues(entryPeriod);
  }, [entryPeriod, loadEntryValues]);

  const handleSaveActuals = async () => {
    const entries = effectiveLineItems
      .filter(li => entryValues[li.line_item] !== undefined && entryValues[li.line_item] !== '' && entryValues[li.line_item] !== null)
      .map(li => ({ period: entryPeriod, line_item: li.line_item, amount: parseFloat(entryValues[li.line_item]), source: 'manual' }))
      .filter(e => !isNaN(e.amount));
    if (entries.length === 0) {
      setStatus({ type: 'error', text: 'Enter at least one amount before saving.' });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      await api.post('/reporting/actuals', { entries });
      setStatus({ type: 'success', text: `Saved ${entries.length} actual(s) for ${formatPeriod(entryPeriod)}.` });
      await refresh();
      await loadEntryValues(entryPeriod);
    } catch (err) {
      setStatus({ type: 'error', text: err.userMessage || err.message || 'Failed to save actuals' });
    } finally {
      setSaving(false);
    }
  };

  const handleImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportResult(null);
    try {
      const res = await api.upload('/reporting/actuals/import', file);
      setImportResult({ imported: res?.data?.imported ?? 0, errors: res?.data?.errors || [] });
      await refresh();
      await loadEntryValues(entryPeriod);
    } catch (err) {
      setImportResult({ imported: 0, errors: [err.userMessage || err.message || 'Import failed'] });
    }
  };

  const handleDownloadTemplate = () => {
    const csv = buildActualsTemplate(effectiveLineItems, entryPeriod);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `actuals_template_${entryPeriod || 'period'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleClearPeriod = async () => {
    if (!entryPeriod) return;
    if (!window.confirm(`Delete all actuals for ${formatPeriod(entryPeriod)}? This cannot be undone.`)) return;
    try {
      await api.delete(`/reporting/actuals?period=${entryPeriod}`);
      setEntryValues({});
      setStatus({ type: 'success', text: `Cleared actuals for ${formatPeriod(entryPeriod)}.` });
      await refresh();
    } catch (err) {
      setStatus({ type: 'error', text: err.userMessage || err.message || 'Failed to clear actuals' });
    }
  };

  if (loading && !variance) {
    return <p className="text-sm text-gray-500 py-6 text-center">Loading budget vs actual...</p>;
  }
  if (error) {
    return <p className="text-sm text-red-600 py-6 text-center">{error}</p>;
  }
  if (!variance) {
    return <p className="text-sm text-gray-500 py-6 text-center">Select a forecast to view budget vs actual.</p>;
  }

  return (
    <div className="space-y-6">
      {/* Period comparison */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h3 className="text-lg font-medium">Budget vs actual</h3>
          <p className="text-sm text-gray-600">
            {withActuals.length > 0
              ? `Actuals entered for ${withActuals.length} of ${periods.length} periods.`
              : 'No actuals entered yet for this window — enter them below or import a CSV.'}
          </p>
        </div>
        <div className="w-48">
          <Label htmlFor="variance-period">Period</Label>
          <Select id="variance-period" value={selectedPeriod} onChange={e => setSelectedPeriod(e.target.value)}>
            {periods.map(p => (
              <SelectOption key={p} value={p}>
                {formatPeriod(p)}{withActuals.includes(p) ? ' •' : ''}
              </SelectOption>
            ))}
          </Select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table data-testid="variance-table" className="min-w-full text-xs tabular-nums">
          <thead>
            <tr className="bg-gray-100 text-gray-600">
              <th className="px-3 py-2 text-left font-medium">Line item</th>
              <th className="px-3 py-2 text-left font-medium">Statement</th>
              <th className="px-3 py-2 text-right font-medium">Budget</th>
              <th className="px-3 py-2 text-right font-medium">Actual</th>
              <th className="px-3 py-2 text-right font-medium">Variance</th>
              <th className="px-3 py-2 text-right font-medium">Var %</th>
              <th className="px-3 py-2 text-center font-medium">F / U</th>
            </tr>
          </thead>
          <tbody>
            {items.map(li => {
              const row = (li.by_period || []).find(r => r.period === selectedPeriod) || {};
              const hasActual = row.actual !== null && row.actual !== undefined;
              return (
                <tr key={li.line_item} data-testid={`variance-row-${li.line_item}`} className="border-t border-gray-100 hover:bg-blue-50/40">
                  <td className="px-3 py-1 whitespace-nowrap font-medium text-gray-800">{li.label}</td>
                  <td className="px-3 py-1 whitespace-nowrap text-gray-500">{STATEMENT_LABELS[li.statement] || li.statement}</td>
                  <td className="px-3 py-1 text-right whitespace-nowrap">{cell(row.budget)}</td>
                  <td className="px-3 py-1 text-right whitespace-nowrap">{hasActual ? cell(row.actual) : '—'}</td>
                  <td className={cn('px-3 py-1 text-right whitespace-nowrap font-medium', varianceClass(row.favorable))} data-testid={`variance-${li.line_item}`}>
                    {hasActual ? cell(row.variance) : '—'}
                  </td>
                  <td className={cn('px-3 py-1 text-right whitespace-nowrap', varianceClass(row.favorable))}>
                    {hasActual ? pctCell(row.variance_pct) : '—'}
                  </td>
                  <td className="px-3 py-1 text-center"><FavBadge favorable={hasActual ? row.favorable : null} /></td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">No line items returned.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* To date */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">
          To date {withActuals.length > 0 ? `(through ${formatPeriod(withActuals[withActuals.length - 1])})` : ''}
        </h4>
        <div className="overflow-x-auto rounded-md border border-gray-200">
          <table data-testid="variance-to-date-table" className="min-w-full text-xs tabular-nums">
            <thead>
              <tr className="bg-gray-100 text-gray-600">
                <th className="px-3 py-2 text-left font-medium">Line item</th>
                <th className="px-3 py-2 text-right font-medium">Budget (full window)</th>
                <th className="px-3 py-2 text-right font-medium">Budget to date</th>
                <th className="px-3 py-2 text-right font-medium">Actual to date</th>
                <th className="px-3 py-2 text-right font-medium">Variance</th>
                <th className="px-3 py-2 text-right font-medium">Var %</th>
                <th className="px-3 py-2 text-center font-medium">F / U</th>
              </tr>
            </thead>
            <tbody>
              {items.map(li => {
                const t = li.totals || {};
                const has = t.actual_to_date !== null && t.actual_to_date !== undefined;
                return (
                  <tr key={li.line_item} data-testid={`variance-to-date-row-${li.line_item}`} className="border-t border-gray-100">
                    <td className="px-3 py-1 whitespace-nowrap font-medium text-gray-800">{li.label}</td>
                    <td className="px-3 py-1 text-right whitespace-nowrap">{cell(t.budget_full_period)}</td>
                    <td className="px-3 py-1 text-right whitespace-nowrap">{cell(t.budget_to_date)}</td>
                    <td className="px-3 py-1 text-right whitespace-nowrap">{has ? cell(t.actual_to_date) : '—'}</td>
                    <td className={cn('px-3 py-1 text-right whitespace-nowrap font-medium', varianceClass(t.favorable))}>{has ? cell(t.variance_to_date) : '—'}</td>
                    <td className={cn('px-3 py-1 text-right whitespace-nowrap', varianceClass(t.favorable))}>{has ? pctCell(t.variance_pct_to_date) : '—'}</td>
                    <td className="px-3 py-1 text-center"><FavBadge favorable={has ? t.favorable : null} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Enter actuals */}
      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h3 className="text-lg font-medium">Enter actuals</h3>
            <p className="text-sm text-gray-600">Amounts are saved per period and line item; leave a field blank to keep it unchanged.</p>
          </div>
          <div className="w-48">
            <Label htmlFor="entry-period">Entry period</Label>
            <Select id="entry-period" value={entryPeriod} onChange={e => setEntryPeriod(e.target.value)}>
              {periods.map(p => (
                <SelectOption key={p} value={p}>{formatPeriod(p)}</SelectOption>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {effectiveLineItems.map(li => (
            <div key={li.line_item}>
              <Label htmlFor={`actual-${li.line_item}`} className="text-xs text-gray-600">
                {li.label}
                <span className="ml-1 text-gray-400">({STATEMENT_LABELS[li.statement] || li.statement})</span>
              </Label>
              <Input
                id={`actual-${li.line_item}`}
                type="number"
                step="0.01"
                className="h-8 mt-1 text-right"
                value={entryValues[li.line_item] ?? ''}
                onChange={e => setEntryValues(v => ({ ...v, [li.line_item]: e.target.value }))}
                placeholder="0.00"
              />
            </div>
          ))}
        </div>

        {status && (
          <p className={cn('text-sm', status.type === 'error' ? 'text-red-600' : 'text-green-700')}>{status.text}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleSaveActuals} disabled={saving || !entryPeriod}>
            {saving ? 'Saving...' : 'Save actuals'}
          </Button>
          <Button variant="outline" asChild className="cursor-pointer">
            <label>
              Import CSV
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleImport} data-testid="actuals-import-input" />
            </label>
          </Button>
          <Button variant="outline" onClick={handleDownloadTemplate}>Download template</Button>
          <Button variant="destructive" onClick={handleClearPeriod} disabled={!entryPeriod}>
            Clear period
          </Button>
        </div>

        {importResult && (
          <div className="text-sm">
            <p className="text-green-700">Imported {importResult.imported} row(s).</p>
            {importResult.errors.length > 0 && (
              <ul className="mt-1 list-disc list-inside text-red-600">
                {importResult.errors.map((e, i) => (
                  <li key={i}>{typeof e === 'string' ? e : JSON.stringify(e)}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>
    </div>
  );
};

export default VarianceReport;
