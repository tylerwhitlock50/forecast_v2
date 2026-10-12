import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { describePriceSources, plural } from './importSteps';
import { describeRow } from './fileParsing';
import { formatPeriod } from '../ReportingAnalysis/utils/formatters';

const money = (value) => {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const num2 = (value) => (value === null || value === undefined ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 }));

const money0 = (value) => (Number(value) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const Tile = ({ label, value, tone = 'gray', hint }) => {
  const tones = {
    gray: 'border-gray-200 bg-white text-gray-900',
    green: 'border-green-200 bg-green-50 text-green-800',
    blue: 'border-blue-200 bg-blue-50 text-blue-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    red: 'border-red-200 bg-red-50 text-red-700',
  };
  return (
    <div className={`rounded-md border px-3 py-2 ${tones[tone]}`} title={hint}>
      <div className="text-[11px] font-medium uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{Number(value || 0).toLocaleString('en-US')}</div>
    </div>
  );
};

const ERROR_LIMIT = 50;

const lines = (n) => plural(n, ['line', 'lines']);

/**
 * Sales replace modes: what the import removes from the scenario, or why it
 * will not run. Nothing for an add / update import.
 */
const ReplaceSummary = ({ result, done, errorCount }) => {
  const mode = result.mode;
  if (mode !== 'replace' && mode !== 'replace_all') return null;
  const where = mode === 'replace'
    ? 'Only the months this file covers are touched; other months stay as they are.'
    : 'In every month: afterwards the scenario holds exactly the lines in this file.';
  if (result.replaceBlocked) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="status" data-testid="replace-summary">
        <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> Nothing will be changed</div>
        <div className="mt-0.5">
          {plural(errorCount, ['row has a problem', 'rows have problems'])}. Replacing only runs when every row is valid,
          so no lines are added, updated or removed until the file is fixed.
        </div>
      </div>
    );
  }
  // After the import the step's headline already says what was removed.
  if (done) return null;
  if (result.deleted > 0) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status" data-testid="replace-summary">
        <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> Will remove {lines(result.deleted)} that {result.deleted === 1 ? 'is' : 'are'} not in this file</div>
        <div className="mt-0.5 text-amber-800">{where}</div>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700" role="status" data-testid="replace-summary">
      Nothing will be removed: every line of the scenario {mode === 'replace' ? 'in the months this file covers ' : ''}is in the file.
    </div>
  );
};

/**
 * What a dry run (or a finished import) found: counts, row errors, warnings,
 * per-BOM material cost and, for sales, where each price came from.
 */
const ImportPreview = ({ result, rows, step, done = false, sourceRowFor = null }) => {
  const [showAllErrors, setShowAllErrors] = useState(false);
  if (!result) return null;
  const isSales = step.kind === 'sales';
  const noun = step.rowNoun ? step.rowNoun[1] : 'rows';
  const isRecords = step.endpoint === '/import/records';

  const errors = result.errors || [];
  const visibleErrors = showAllErrors ? errors : errors.slice(0, ERROR_LIMIT);
  const sources = describePriceSources(result.priceSources);

  const rowFor = (n) => {
    const idx = Number(n) - 1;
    if (!Number.isInteger(idx) || idx < 0 || !rows) return null;
    return rows[idx] || null;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {isSales ? (
          <>
            <Tile label={done ? 'New rows' : 'New rows'} value={result.inserted ?? result.imported} tone={(result.inserted ?? result.imported) ? 'green' : 'gray'} hint="Sales rows added to the scenario." />
            <Tile label="Updated rows" value={result.inserted === null ? 0 : result.updated} tone={result.updated ? 'blue' : 'gray'} hint="Rows for the same customer, product and month that already existed get the new quantity and price." />
            <Tile label="New customers / products" value={result.createdCustomers.length + result.createdProducts.length} tone={(result.createdCustomers.length + result.createdProducts.length) ? 'blue' : 'gray'} />
            <Tile label="Rows with errors" value={errors.length} tone={errors.length ? 'red' : 'gray'} />
          </>
        ) : (
          <>
            <Tile label={`New ${noun}`} value={result.created} tone={result.created ? 'green' : 'gray'} />
            <Tile label={`Updated ${noun}`} value={result.updated} tone={result.updated ? 'blue' : 'gray'} />
            {isRecords ? (
              <Tile
                label="Unchanged"
                value={result.unchanged + result.skipped}
                hint="Rows that match what is already saved, or existing rows left alone in 'Add new only' mode."
              />
            ) : (
              <Tile
                label={`Replaced ${noun}`}
                value={result.replaced}
                tone={result.replaced ? 'amber' : 'gray'}
                hint="Existing rows removed because the file replaces them (replace mode)."
              />
            )}
            <Tile label="Rows with errors" value={errors.length} tone={errors.length ? 'red' : 'gray'} />
          </>
        )}
      </div>

      {isSales && result.startPeriod && (
        <p className="text-sm text-gray-700">
          Covers <span className="font-medium">{formatPeriod(result.startPeriod)} – {formatPeriod(result.endPeriod)}</span>
          {result.totalQuantity !== null && <> · <span className="font-medium tabular-nums">{Number(result.totalQuantity).toLocaleString('en-US')}</span> units</>}
          {result.totalRevenue !== null && <> · <span className="font-medium tabular-nums">{money0(result.totalRevenue)}</span> gross sales</>}
        </p>
      )}

      {isSales && <ReplaceSummary result={result} done={done} errorCount={errors.length} />}

      {result.skipped > 0 && !isRecords && (
        <p className="text-sm text-gray-600">{plural(result.skipped, ['row was', 'rows were'])} skipped.</p>
      )}

      {isSales && sources.length > 0 && (
        <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          <div className="mb-1 font-medium text-gray-900">Where the prices came from</div>
          <ul className="space-y-0.5">
            {sources.map((s) => (
              <li key={s.source} className="flex items-baseline gap-2">
                <span className="w-16 text-right font-semibold tabular-nums">{s.count.toLocaleString('en-US')}</span>
                <span className={s.source === 'none' || s.source === 'zero_price' ? 'text-red-700' : ''}>{s.count === 1 ? 'row' : 'rows'} {s.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isSales && (result.createdCustomers.length > 0 || result.createdProducts.length > 0) && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          {result.createdCustomers.length > 0 && (
            <div><span className="font-medium">New customers:</span> {result.createdCustomers.slice(0, 12).join(', ')}{result.createdCustomers.length > 12 ? ` and ${result.createdCustomers.length - 12} more` : ''}</div>
          )}
          {result.createdProducts.length > 0 && (
            <div><span className="font-medium">New products:</span> {result.createdProducts.slice(0, 12).join(', ')}{result.createdProducts.length > 12 ? ` and ${result.createdProducts.length - 12} more` : ''}</div>
          )}
          <div className="mt-1 text-xs text-blue-800">Check their customer type, list price and BOM afterwards so pricing and costing work.</div>
        </div>
      )}

      {(result.createdMachines.length > 0 || result.createdLaborTypes.length > 0) && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {result.createdMachines.length > 0 && <div><span className="font-medium">Placeholder machines ($0/hour):</span> {result.createdMachines.map((m) => (typeof m === 'string' ? m : m.machine_id)).join(', ')}</div>}
          {result.createdLaborTypes.length > 0 && <div><span className="font-medium">Placeholder labor types ($0/hour):</span> {result.createdLaborTypes.map((m) => (typeof m === 'string' ? m : m.rate_id)).join(', ')}</div>}
          <div className="mt-1 text-xs">Set their rates on the Machines and Labor rates screens, or costs will be understated.</div>
        </div>
      )}

      {step.kind === 'boms' && result.boms.length > 0 && (
        <div className="overflow-hidden rounded-md border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">BOM</th>
                <th className="px-3 py-2">Version</th>
                <th className="px-3 py-2 text-right">Lines</th>
                <th className="px-3 py-2 text-right">Material cost / unit</th>
                <th className="px-3 py-2">Products</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {result.boms.map((b) => (
                <tr key={`${b.bom_id}-${b.version}`}>
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {b.bom_id}
                    {b.bom_name && b.bom_name !== b.bom_id && <span className="ml-2 font-normal text-gray-500">{b.bom_name}</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{b.version || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">{b.lines}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">{money(b.material_cost_per_unit)}</td>
                  <td className="px-3 py-2 text-gray-700">{(b.linked_products.length ? b.linked_products : b.used_by_products).join(', ') || <span className="text-amber-700">not used by a product yet</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {step.kind === 'routings' && result.routers.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Routing</th>
                <th className="px-3 py-2 text-right">Operations</th>
                <th className="px-3 py-2 text-right">Labor min / unit</th>
                <th className="px-3 py-2 text-right">Machine min / unit</th>
                <th className="px-3 py-2 text-right">Labor $ / unit</th>
                <th className="px-3 py-2 text-right">Machine $ / unit</th>
                <th className="px-3 py-2">Products</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {result.routers.map((r) => {
                const usedBy = (r.linked_products && r.linked_products.length ? r.linked_products : r.used_by_products) || [];
                return (
                  <tr key={r.router_id}>
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {r.router_id}
                      {Array.isArray(r.cost_warnings) && r.cost_warnings.length > 0 && (
                        <div className="text-[11px] font-normal text-amber-700">{r.cost_warnings.map((w) => String(w).replace(/_/g, ' ')).join(', ')}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{r.operations ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{num2(r.labor_minutes_per_unit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{num2(r.machine_minutes_per_unit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">{money(r.labor_cost_per_unit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">{money(r.machine_cost_per_unit)}</td>
                    <td className="px-3 py-2 text-gray-700">{usedBy.length ? usedBy.join(', ') : <span className="text-gray-400">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="mb-1 flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> {plural(result.warnings.length, ['warning', 'warnings'])}</div>
          <ul className="list-disc space-y-0.5 pl-5">
            {result.warnings.slice(0, 20).map((w, i) => (
              <li key={i}>{w.row ? <span className="font-medium">Row {w.row}: </span> : null}{w.message}</li>
            ))}
          </ul>
          {result.warnings.length > 20 && <div className="mt-1 text-xs">…and {result.warnings.length - 20} more</div>}
        </div>
      )}

      {errors.length > 0 && (
        <div className="overflow-hidden rounded-md border border-red-200">
          <div className="flex items-center gap-2 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
            <AlertTriangle className="h-4 w-4" />
            {plural(errors.length, ['row has a problem', 'rows have problems'])}
            {done ? ' and were not imported' : (result.replaceBlocked ? `: fix ${errors.length === 1 ? 'it' : 'them'} to import this file` : ' and will be skipped')}
          </div>
          <div className="max-h-72 overflow-y-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs font-medium uppercase tracking-wide text-gray-500 shadow-[0_1px_0_#e5e7eb]">
                <tr>
                  <th className="w-20 px-3 py-2 text-right" title="Data row number in your file (the header row is not counted)">Row</th>
                  <th className="px-3 py-2">Values</th>
                  <th className="px-3 py-2">Problem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibleErrors.map((e, i) => {
                  const sent = rowFor(e.row);
                  const fileRow = sourceRowFor && e.row ? (sourceRowFor[Number(e.row) - 1] ?? null) : null;
                  return (
                    <tr key={i}>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                        {e.row ?? '—'}
                        {fileRow !== null && fileRow + 1 !== Number(e.row) && (
                          <div className="text-[11px] text-gray-400" title="Row in your original (wide) file">file row {fileRow + 1}</div>
                        )}
                      </td>
                      <td className="max-w-xs truncate px-3 py-1.5 text-gray-500" title={sent ? JSON.stringify(sent) : ''}>{describeRow(sent) || '—'}</td>
                      <td className="px-3 py-1.5 text-red-700">{e.field ? <span className="font-medium">{e.field}: </span> : null}{e.error}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {errors.length > ERROR_LIMIT && !showAllErrors && (
            <button type="button" className="w-full border-t border-red-100 bg-white px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50" onClick={() => setShowAllErrors(true)}>
              Show all {errors.length.toLocaleString('en-US')} errors
            </button>
          )}
        </div>
      )}

      {done && errors.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4" /> Every row was imported.
        </div>
      )}
      {!done && errors.length === 0 && result.warnings.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4" /> No problems found.
        </div>
      )}
      {!done && (
        <p className="flex items-center gap-2 text-xs text-gray-500">
          <Info className="h-3.5 w-3.5" /> This is a check only. Nothing has been saved yet.
        </p>
      )}
    </div>
  );
};

export default ImportPreview;
