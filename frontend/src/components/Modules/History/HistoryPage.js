import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForecast } from '../../../context/ForecastContext';
import { PageHeader } from '../../ui/page-header';
import { Card, CardContent } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { fetchAuditLog } from '../Scenarios/governanceApi';
import { scenarioErrorMessage } from '../Scenarios/scenarioErrors';
import { formatDay, formatTime, formatWhen } from '../Scenarios/governance';
import LegacyChecksPanel from './LegacyChecksPanel';
import { CLIENT_LABELS, auditQuery, clientLabel, requestLine, resultOf } from './historyFormat';

const PAGE_SIZE = 50;
const EMPTY_FILTERS = { forecastId: '', client: '', status: '', text: '', from: '', to: '', since: '' };
const selectClass = 'h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500';

const ResultBadge = ({ status }) => {
  const result = resultOf(status);
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${result.tone}`}
      title={result.detail ? `${result.label} (${result.detail}, HTTP ${status})` : `HTTP ${status}`}
    >
      {result.label}
    </span>
  );
};

/**
 * The change history: every change made through the web app, the MCP tools
 * (Claude Code / Codex) or a script, newest first, plus the legacy data checks.
 */
const HistoryPage = () => {
  const { scenarios } = useForecast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => ({
    ...EMPTY_FILTERS,
    forecastId: searchParams.get('forecast_id') || '',
    client: searchParams.get('client') || '',
    since: searchParams.get('since') || '',
  }));
  const [text, setText] = useState('');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState({});

  const scenarioList = useMemo(
    () => Object.values(scenarios || {}).sort((a, b) => a.name.localeCompare(b.name)),
    [scenarios],
  );
  const scenarioName = (id) => (id ? scenarios?.[id]?.name || id : '');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPage(await fetchAuditLog(auditQuery(filters, { limit: PAGE_SIZE, offset })));
    } catch (err) {
      setError(scenarioErrorMessage(err, 'Could not load the change history'));
    } finally {
      setLoading(false);
    }
  }, [filters, offset]);

  useEffect(() => { load(); }, [load]);

  // The search box filters after a short pause, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((f) => (f.text === text ? f : { ...f, text }));
      setOffset(0);
    }, 350);
    return () => clearTimeout(timer);
  }, [text]);

  const setFilter = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setOffset(0);
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setText('');
    setOffset(0);
    if ([...searchParams.keys()].length) setSearchParams({});
  };

  const clearSince = () => {
    setFilter('since', '');
    const next = new URLSearchParams(searchParams);
    next.delete('since');
    setSearchParams(next);
  };

  const entries = page?.entries || [];
  const total = page?.total_count || 0;
  const filtered = Object.entries(filters).some(([, v]) => v);
  const toggle = (id) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  const details = (entry) => (
    <div className="space-y-1 text-xs text-gray-600">
      <div className="break-all font-mono">{requestLine(entry)}</div>
      {entry.body_excerpt && <div className="break-all"><span className="font-medium text-gray-700">Sent:</span> {entry.body_excerpt}</div>}
      <div>Took {entry.duration_ms ?? '?'} ms · HTTP {entry.status}</div>
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-8 sm:px-6">
      <PageHeader
        title="Change history"
        description="Every change made in the web app, by an AI assistant (MCP) or by a script: who, what and when. Refused changes are listed too. Start clean keeps this history."
        actions={[{ label: loading ? 'Refreshing…' : 'Refresh', variant: 'outline', onClick: load, disabled: loading }]}
      />

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="history-text">Search</Label>
              <Input
                id="history-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. payroll, import, approve"
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="history-scenario">Scenario</Label>
              <select
                id="history-scenario"
                className={selectClass}
                value={filters.forecastId}
                onChange={(e) => setFilter('forecastId', e.target.value)}
              >
                <option value="">All scenarios</option>
                {scenarioList.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="history-client">Made in</Label>
              <select id="history-client" className={selectClass} value={filters.client} onChange={(e) => setFilter('client', e.target.value)}>
                <option value="">Anywhere</option>
                {Object.entries(CLIENT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="history-status">Result</Label>
              <select id="history-status" className={selectClass} value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
                <option value="">Saved or refused</option>
                <option value="ok">Saved</option>
                <option value="refused">Refused or failed</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="history-from">From</Label>
              <Input id="history-from" type="date" className="h-9 px-2" value={filters.from}
                onChange={(e) => setFilter('from', e.target.value)} disabled={Boolean(filters.since)}
                title={filters.since ? 'Remove the "Since" filter to pick a day' : undefined} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="history-to">To</Label>
              <Input id="history-to" type="date" className="h-9 px-2" value={filters.to}
                onChange={(e) => setFilter('to', e.target.value)} />
            </div>
          </div>

          {(filters.since || filtered) && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {filters.since && (
                <span className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-xs text-orange-900">
                  Since {formatWhen(filters.since)}
                  <button type="button" aria-label="Remove the since filter" className="ml-1 font-semibold" onClick={clearSince}>×</button>
                </span>
              )}
              {filtered && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={clearFilters}>Clear filters</Button>
              )}
            </div>
          )}

          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

          {!error && page && entries.length === 0 && (
            <p className="py-6 text-center text-sm text-gray-500">
              {filtered ? 'No changes match these filters.' : 'No changes recorded yet. Every save, import, approval and delete will appear here.'}
            </p>
          )}
          {!error && !page && <p className="py-6 text-center text-sm text-gray-500">Loading…</p>}

          {entries.length > 0 && (
            <>
              {/* Narrow screens: one card per change. */}
              <ul className="space-y-2 md:hidden" data-testid="history-cards">
                {entries.map((entry) => (
                  <li key={entry.log_id} className="rounded-md border border-gray-200 p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 break-words font-medium text-gray-900">{entry.summary}</span>
                      <ResultBadge status={entry.status} />
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {formatWhen(entry.created_at)} · {clientLabel(entry.client)}
                      {entry.actor ? ` · ${entry.actor}` : ''}
                      {entry.forecast_id ? ` · ${scenarioName(entry.forecast_id)}` : ''}
                    </div>
                    <button type="button" className="mt-1 text-xs font-medium text-orange-700" onClick={() => toggle(entry.log_id)}>
                      {open[entry.log_id] ? 'Hide details' : 'Details'}
                    </button>
                    {open[entry.log_id] && <div className="mt-1">{details(entry)}</div>}
                  </li>
                ))}
              </ul>

              <div className="hidden md:block">
                <table className="w-full table-fixed text-sm" data-testid="history-table">
                  <colgroup>
                    <col className="w-[15%]" />
                    <col className="w-[13%]" />
                    <col className="w-[13%]" />
                    <col className="w-[14%]" />
                    <col className="w-[35%]" />
                    <col className="w-[10%]" />
                  </colgroup>
                  <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2">When</th>
                      <th className="px-3 py-2">Who</th>
                      <th className="px-3 py-2">Made in</th>
                      <th className="px-3 py-2">Scenario</th>
                      <th className="px-3 py-2">What changed</th>
                      <th className="px-3 py-2">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {entries.map((entry) => (
                      <React.Fragment key={entry.log_id}>
                        <tr className="align-top hover:bg-gray-50">
                          <td className="px-3 py-2 text-gray-700">
                            <div className="whitespace-nowrap">{formatDay(entry.created_at)}</div>
                            <div className="text-xs text-gray-500">{formatTime(entry.created_at)}</div>
                          </td>
                          <td className="truncate px-3 py-2 text-gray-700" title={entry.actor || ''}>
                            {entry.actor || <span className="text-gray-400">Not given</span>}
                          </td>
                          <td className="px-3 py-2 text-gray-700">{clientLabel(entry.client)}</td>
                          <td className="truncate px-3 py-2 text-gray-700" title={entry.forecast_id || ''}>
                            {entry.forecast_id ? scenarioName(entry.forecast_id) : <span className="text-gray-400">Company-wide</span>}
                          </td>
                          <td className="px-3 py-2">
                            <div className="break-words text-gray-900">{entry.summary}</div>
                            <button type="button" className="text-xs font-medium text-orange-700 hover:underline" onClick={() => toggle(entry.log_id)}>
                              {open[entry.log_id] ? 'Hide details' : 'Details'}
                            </button>
                            {open[entry.log_id] && <div className="mt-1">{details(entry)}</div>}
                          </td>
                          <td className="px-3 py-2"><ResultBadge status={entry.status} /></td>
                        </tr>
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
                <span>
                  Showing {offset + 1}–{offset + entries.length} of {total.toLocaleString('en-US')} change{total === 1 ? '' : 's'}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={offset === 0 || loading}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                    Newer
                  </Button>
                  <Button size="sm" variant="outline" disabled={!page?.has_more || loading}
                    onClick={() => setOffset(offset + PAGE_SIZE)}>
                    Older
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <LegacyChecksPanel />
    </div>
  );
};

export default HistoryPage;
