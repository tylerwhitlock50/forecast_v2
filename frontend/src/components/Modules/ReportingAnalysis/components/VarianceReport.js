import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Lock, Upload } from 'lucide-react';
import api from '../../../../lib/apiClient';
import { useVariance } from '../hooks/useVariance';
import { Card } from '../../../ui/card';
import { Button } from '../../../ui/button';
import { Input } from '../../../ui/input';
import { Label } from '../../../ui/label';
import { Select, SelectOption } from '../../../ui/select';
import { Badge } from '../../../ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../../ui/tabs';
import { cn } from '../../../../lib/utils';
import { formatAccounting, formatPct, formatPeriod } from '../utils/formatters';
import ImportActualsDialog from '../actuals/ImportActualsDialog';
import ImportHistory from '../actuals/ImportHistory';
import PeriodClosePanel, { ClosedBadge } from '../actuals/PeriodClosePanel';
import { errorText, saveActualEntries } from '../actuals/actualsApi';

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

// Which months a line has actuals for, relative to the latest month with any actuals.
export const coverageText = (totals, actualsThrough) => {
  const compared = totals?.periods_compared || [];
  const missing = totals?.missing_periods || [];
  const coverage = totals?.coverage || (compared.length ? (missing.length ? 'partial' : 'complete') : 'none');
  if (coverage === 'none') return 'No actuals';
  if (coverage === 'complete') {
    return compared.length === 1 ? `${formatPeriod(compared[0])} only` : `Complete through ${formatPeriod(actualsThrough || compared[compared.length - 1])}`;
  }
  return `Partial — missing ${missing.map(formatPeriod).join(', ')}`;
};

const CoverageBadge = ({ totals, actualsThrough }) => {
  const coverage = totals?.coverage || 'none';
  const variant = coverage === 'complete' ? 'success' : coverage === 'partial' ? 'warning' : 'secondary';
  return (
    <Badge variant={variant} className="px-2 whitespace-nowrap" data-coverage={coverage}>
      {coverageText(totals, actualsThrough)}
    </Badge>
  );
};

// CSV template for actual imports, built client-side.
export const buildActualsTemplate = (lineItems, period) => {
  const header = 'period,line_item,amount,reference_id,notes';
  const body = lineItems.map(li => `${period || ''},${li.line_item},,,`).join('\n');
  return `${header}\n${body}\n`;
};

// "Saved 2 actual(s) for Feb 2026" / why nothing was saved, from the import report.
export const saveMessage = (report, period) => {
  const written = (report?.inserted || 0) + (report?.updated || 0);
  const replaced = report?.replaced || 0;
  if (report?.outcome === 'unchanged' || (written === 0 && replaced === 0)) {
    return `Nothing changed for ${formatPeriod(period)}: the amounts already match what is stored.`;
  }
  const parts = [];
  if (report.inserted) parts.push(`${report.inserted} new`);
  if (report.updated) parts.push(`${report.updated} changed`);
  if (replaced) parts.push(`${replaced} imported ${replaced === 1 ? 'amount' : 'amounts'} replaced`);
  const undo = replaced ? ' Undo the save under Import history to put the imported amounts back.' : '';
  return `Saved ${written} actual(s) for ${formatPeriod(period)} (${parts.join(', ')}).${undo}`;
};

/**
 * Each line's month total from the stored actuals rows: amounts are stored per reference and added up
 * (an import under GL-JAN plus a hand entry is their sum), so the form shows and edits the total.
 * Returns { line_item: { total, referenced: [{ reference_id, amount }] } }.
 */
export const lineMonthTotals = (actuals) => {
  const out = {};
  (actuals || []).forEach(a => {
    const line = out[a.line_item] || { total: 0, referenced: [] };
    line.total = Math.round((line.total + Number(a.amount || 0)) * 100) / 100;
    if (a.reference_id) line.referenced.push({ reference_id: a.reference_id, amount: Number(a.amount || 0) });
    out[a.line_item] = line;
  });
  return out;
};

const sameAmount = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const VarianceReport = ({ forecastIds, period }) => {
  const { variance, loading, error, fetchVariance } = useVariance();
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [lineItems, setLineItems] = useState([]);
  const [entryPeriod, setEntryPeriod] = useState('');
  const [entryValues, setEntryValues] = useState({});
  const [entryStored, setEntryStored] = useState({});   // line_item -> { total, referenced } as stored
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [actualsTab, setActualsTab] = useState('entry');
  const [refreshKey, setRefreshKey] = useState(0);

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
  const actualsThrough = variance?.actuals_through || (withActuals.length > 0 ? withActuals[withActuals.length - 1] : null);
  const incompleteLines = useMemo(() => variance?.incomplete_lines || [], [variance]);
  const periodCoverage = useMemo(() => variance?.period_coverage || [], [variance]);
  const selectedCoverage = periodCoverage.find(c => c.period === selectedPeriod) || null;
  const closedPeriods = useMemo(() => variance?.closed_periods || [], [variance]);
  const selectedClosed = closedPeriods.includes(selectedPeriod);
  const entryClosed = closedPeriods.includes(entryPeriod);

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

  // Prefill the entry form with each line's month total, imported amounts (with a reference) included.
  const loadEntryValues = useCallback(async (p) => {
    if (!p) return;
    try {
      const res = await api.get(`/reporting/actuals?start_period=${p}&end_period=${p}`, { suppressErrorToast: true });
      const totals = lineMonthTotals(res?.data?.actuals);
      const next = {};
      Object.entries(totals).forEach(([line, t]) => { next[line] = t.total; });
      setEntryStored(totals);
      setEntryValues(next);
    } catch {
      setEntryStored({});
      setEntryValues({});
    }
  }, []);

  useEffect(() => {
    loadEntryValues(entryPeriod);
  }, [entryPeriod, loadEntryValues]);

  // After an import, undo, close or reopen: reload the report, the entry form and the actuals panels.
  const refreshAll = useCallback(async () => {
    setRefreshKey(k => k + 1);
    await refresh();
    await loadEntryValues(entryPeriod);
  }, [refresh, loadEntryValues, entryPeriod]);

  const handleSaveActuals = async () => {
    const typed = effectiveLineItems
      .filter(li => entryValues[li.line_item] !== undefined && entryValues[li.line_item] !== '' && entryValues[li.line_item] !== null)
      .map(li => ({ period: entryPeriod, line_item: li.line_item, amount: parseFloat(entryValues[li.line_item]), source: 'manual' }))
      .filter(e => !isNaN(e.amount));
    if (typed.length === 0) {
      setStatus({ type: 'error', text: 'Enter at least one amount before saving.' });
      return;
    }
    // Only lines whose month total changed are saved. Each sets the line's total for the month:
    // amounts imported under a reference are replaced (replace_lines), never added to.
    const entries = typed.filter(e => !entryStored[e.line_item] || !sameAmount(entryStored[e.line_item].total, e.amount));
    if (entries.length === 0) {
      setStatus({ type: 'success', text: saveMessage({ outcome: 'unchanged' }, entryPeriod) });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const result = await saveActualEntries(entries, { source: 'manual', replaceLines: true });
      if (!result.ok) {
        setStatus({ type: 'error', text: result.message || 'Nothing was saved.' });
        return;
      }
      setStatus({ type: 'success', text: saveMessage(result.report, entryPeriod) });
      await refreshAll();
    } catch (err) {
      setStatus({ type: 'error', text: errorText(err, 'Failed to save actuals') });
    } finally {
      setSaving(false);
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
      await api.delete(`/reporting/actuals?period=${entryPeriod}`, { suppressErrorToast: true });
      setEntryValues({});
      setEntryStored({});
      setStatus({ type: 'success', text: `Cleared actuals for ${formatPeriod(entryPeriod)}.` });
      await refreshAll();
    } catch (err) {
      setStatus({ type: 'error', text: errorText(err, 'Failed to clear actuals') });
    }
  };

  const handleImported = () => {
    setStatus(null);
    refreshAll();
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
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-lg font-medium">
            Budget vs actual
            {selectedClosed && <ClosedBadge className="align-middle" />}
          </h3>
          <p className="text-sm text-gray-600">
            {withActuals.length > 0
              ? `Actuals entered for ${withActuals.length} of ${periods.length} periods (latest ${formatPeriod(actualsThrough)}).`
              : 'No actuals entered yet for this window — enter them below or import a file.'}
          </p>
          {incompleteLines.length > 0 && (
            <p className="text-sm text-amber-800 mt-1" data-testid="incomplete-actuals-note">
              Incomplete actuals: {incompleteLines.map(l => `${l.label} missing ${l.missing_periods.map(formatPeriod).join(', ')}`).join('; ')}.
              A blank month is missing, not zero; to-date variances compare only the months each line has actuals for.
            </p>
          )}
          {selectedClosed && (
            <p className="text-sm text-gray-600 mt-1" data-testid="selected-period-closed">
              {formatPeriod(selectedPeriod)} is closed: its actuals are locked until the month is reopened.
            </p>
          )}
          {selectedCoverage && !selectedCoverage.complete && (
            <p className="text-sm text-gray-600 mt-1" data-testid="period-coverage-note">
              {formatPeriod(selectedPeriod)}: actuals entered for {selectedCoverage.lines_entered} of {selectedCoverage.lines_total} lines; the rest show — (missing).
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <Label htmlFor="variance-period">Period</Label>
            <Select id="variance-period" value={selectedPeriod} onChange={e => setSelectedPeriod(e.target.value)}>
              {periods.map(p => (
                <SelectOption key={p} value={p}>
                  {formatPeriod(p)}{withActuals.includes(p) ? ' •' : ''}{closedPeriods.includes(p) ? ' (closed)' : ''}
                </SelectOption>
              ))}
            </Select>
          </div>
          <Button onClick={() => setShowImport(true)} data-testid="open-actuals-import">
            <Upload className="mr-2 h-4 w-4" aria-hidden="true" />Import actuals
          </Button>
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
          To date {actualsThrough ? `(through ${formatPeriod(actualsThrough)})` : ''}
        </h4>
        <p className="text-xs text-gray-500 mb-2">Budget to date and the variance cover only the months each line has actuals for; see Coverage.</p>
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
                <th className="px-3 py-2 text-left font-medium">Coverage</th>
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
                    <td className="px-3 py-1 text-right whitespace-nowrap">{has ? cell(t.budget_to_date) : '—'}</td>
                    <td className="px-3 py-1 text-right whitespace-nowrap">{has ? cell(t.actual_to_date) : '—'}</td>
                    <td className={cn('px-3 py-1 text-right whitespace-nowrap font-medium', varianceClass(t.favorable))}>{has ? cell(t.variance_to_date) : '—'}</td>
                    <td className={cn('px-3 py-1 text-right whitespace-nowrap', varianceClass(t.favorable))}>{has ? pctCell(t.variance_pct_to_date) : '—'}</td>
                    <td className="px-3 py-1 text-center"><FavBadge favorable={has ? t.favorable : null} /></td>
                    <td className="px-3 py-1 whitespace-nowrap"><CoverageBadge totals={t} actualsThrough={actualsThrough} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Actuals: enter by hand, month-end close, import history */}
      <Card className="p-4 space-y-4">
        <Tabs value={actualsTab} onValueChange={setActualsTab}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="entry">Enter by hand</TabsTrigger>
              <TabsTrigger value="close">Month-end close</TabsTrigger>
              <TabsTrigger value="history">Import history</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="entry" className="mt-4 space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h3 className="text-lg font-medium">Enter actuals</h3>
                <p className="text-sm text-gray-600" data-testid="actuals-entry-help">
                  Each field is the line&rsquo;s total for the month, imported amounts included. Saving a changed amount sets that
                  total: amounts imported under a reference are replaced by it, not added to (undo the save under Import history to put
                  them back). Fields you leave unchanged or blank are not saved.
                </p>
              </div>
              <div className="w-48">
                <Label htmlFor="entry-period">Entry period</Label>
                <Select id="entry-period" value={entryPeriod} onChange={e => setEntryPeriod(e.target.value)}>
                  {periods.map(p => (
                    <SelectOption key={p} value={p}>{formatPeriod(p)}{closedPeriods.includes(p) ? ' (closed)' : ''}</SelectOption>
                  ))}
                </Select>
              </div>
            </div>

            {entryClosed && (
              <div className="flex items-start gap-2 rounded-md border border-gray-300 bg-gray-50 p-3 text-sm text-gray-700" data-testid="entry-period-closed">
                <Lock className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
                <span>
                  {formatPeriod(entryPeriod)} is closed, so its actuals cannot be changed.{' '}
                  <button type="button" className="font-medium text-orange-700 hover:underline" onClick={() => setActualsTab('close')}>
                    Reopen it under Month-end close
                  </button>{' '}to make changes.
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {effectiveLineItems.map(li => {
                const referenced = entryStored[li.line_item]?.referenced || [];
                const typed = entryValues[li.line_item];
                const changed = referenced.length > 0 && typed !== '' && typed !== undefined && typed !== null
                  && !isNaN(parseFloat(typed)) && !sameAmount(parseFloat(typed), entryStored[li.line_item].total);
                return (
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
                      value={typed ?? ''}
                      onChange={e => setEntryValues(v => ({ ...v, [li.line_item]: e.target.value }))}
                      placeholder="0.00"
                      disabled={entryClosed}
                    />
                    {referenced.length > 0 && (
                      <p className={cn('mt-0.5 text-xs', changed ? 'text-amber-800' : 'text-gray-500')} data-testid={`actual-${li.line_item}-imported`}>
                        Includes imported {referenced.map(r => `${r.reference_id} ${formatAccounting(r.amount, { decimals: 2 })}`).join('; ')}
                        {changed ? ' (replaced by this total when you save)' : ''}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {status && (
              <p className={cn('text-sm', status.type === 'error' ? 'text-red-600' : 'text-green-700')} data-testid="actuals-entry-status">{status.text}</p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleSaveActuals} disabled={saving || !entryPeriod || entryClosed}>
                {saving ? 'Saving...' : 'Save actuals'}
              </Button>
              <Button variant="outline" onClick={handleDownloadTemplate}>Download template</Button>
              <Button variant="destructive" onClick={handleClearPeriod} disabled={!entryPeriod || entryClosed}>
                Clear period
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="close" className="mt-4">
            <PeriodClosePanel start={period?.start} end={period?.end} refreshKey={refreshKey} onChanged={refreshAll} />
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <ImportHistory refreshKey={refreshKey} onChanged={refreshAll} />
          </TabsContent>
        </Tabs>
      </Card>

      {showImport && (
        <ImportActualsDialog
          onClose={() => setShowImport(false)}
          onImported={handleImported}
          onDownloadTemplate={handleDownloadTemplate}
        />
      )}
    </div>
  );
};

export default VarianceReport;
