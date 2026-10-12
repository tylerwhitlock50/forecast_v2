import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import api, { apiClient } from '../../../lib/apiClient';
import { Card } from '../../ui/card';
import { Button } from '../../ui/button';
import ImportPreview from './ImportPreview';
import { readImportFile, prepareSalesRows } from './fileParsing';
import { errorMessage, plural, summarizeImportResult } from './importSteps';
import { formatPeriod } from '../ReportingAnalysis/utils/formatters';

const IMPORT_TIMEOUT_MS = 180000;

const defaultOptions = (step) => (step.options || []).reduce((acc, o) => ({ ...acc, [o.key]: o.default }), {});

const ColumnChips = ({ required, optional, docs }) => (
  <div className="flex flex-wrap items-center gap-1.5 text-xs">
    <span className="mr-1 text-gray-500">Columns:</span>
    {required.map((c) => (
      <span key={`r-${c}`} title={docs?.[c] ? `Required. ${docs[c]}` : 'Required'} className="rounded border border-gray-300 bg-gray-100 px-1.5 py-0.5 font-mono text-gray-900">
        {c}<span className="ml-0.5 text-orange-600">*</span>
      </span>
    ))}
    {optional.map((c) => (
      <span key={`o-${c}`} title={docs?.[c] ? `Optional. ${docs[c]}` : 'Optional'} className="rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-gray-500">
        {c}
      </span>
    ))}
  </div>
);

/**
 * One import step: template, upload, server-side check (dry run), confirm,
 * result. The server validates and reports per-row errors; nothing is saved
 * until the user confirms.
 */
const ImportStepCard = ({ step, number, count, countLabel, docs, scenario, noScenarios, onImported }) => {
  const fileInput = useRef(null);
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null); // {rows, headers, sheetName, sales?}
  const [mode, setMode] = useState(step.modes ? step.modes[0].value : null);
  const [options, setOptions] = useState(() => defaultOptions(step));
  const [phase, setPhase] = useState('idle'); // idle | reading | checking | preview | importing | done
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const isSales = step.kind === 'sales';
  const blocked = isSales && !scenario;
  const columns = docs || { required: step.required, optional: step.optional, docs: {} };
  const hasData = typeof count === 'number' && count > 0;

  const reset = () => {
    setFile(null);
    setParsed(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setPhase('idle');
    if (fileInput.current) fileInput.current.value = '';
  };

  const rowsToSend = (p = parsed) => (isSales ? p?.sales?.rows : p?.rows) || [];

  const buildBody = (rows, dryRun, currentMode = mode, currentOptions = options) => {
    if (isSales) {
      return {
        forecast_id: scenario.id,
        sales: rows,
        dry_run: dryRun,
        options: { autoCreate: Boolean(currentOptions.autoCreate), allowZeroPrice: Boolean(currentOptions.allowZeroPrice), dry_run: dryRun },
      };
    }
    const { scenarioOnly, ...flags } = currentOptions;
    const body = { rows, dry_run: dryRun, ...flags };
    if (currentMode) body.mode = currentMode;
    if (step.table) body.table = step.table;
    if (scenarioOnly && scenario) body.forecast_id = scenario.id;
    return body;
  };

  const send = async (p, dryRun, currentMode = mode, currentOptions = options) => {
    const rows = rowsToSend(p);
    const response = await api.post(step.endpoint, buildBody(rows, dryRun, currentMode, currentOptions), {
      suppressSuccessToast: true,
      suppressErrorToast: true,
      timeout: IMPORT_TIMEOUT_MS,
    });
    return summarizeImportResult(response);
  };

  const check = async (p = parsed, currentMode = mode, currentOptions = options) => {
    if (!p || rowsToSend(p).length === 0) return;
    setPhase('checking');
    setError(null);
    setPreview(null);
    try {
      const summary = await send(p, true, currentMode, currentOptions);
      setPreview(summary);
      setPhase('preview');
    } catch (err) {
      setError(errorMessage(err, 'The server could not check this file.'));
      setPhase('idle');
    }
  };

  const handleFile = async (event) => {
    const chosen = event.target.files?.[0];
    // Clear the input so choosing the same file again (after fixing it) still triggers a fresh check.
    event.target.value = '';
    if (!chosen) return;
    setFile(chosen);
    setPreview(null);
    setResult(null);
    setError(null);
    setPhase('reading');
    try {
      const read = await readImportFile(chosen);
      if (read.rows.length === 0) {
        setParsed(null);
        setError('The file has no data rows under the header row.');
        setPhase('idle');
        return;
      }
      const next = { ...read };
      if (isSales) next.sales = prepareSalesRows(read.rows);
      setParsed(next);
      await check(next);
    } catch (err) {
      setParsed(null);
      setError(err?.message || 'Could not read that file.');
      setPhase('idle');
    }
  };

  const changeMode = (value) => {
    setMode(value);
    if (parsed) check(parsed, value, options);
  };

  const changeOption = (key, value) => {
    const next = { ...options, [key]: value };
    setOptions(next);
    if (parsed) check(parsed, mode, next);
  };

  const confirmImport = async () => {
    setPhase('importing');
    setError(null);
    try {
      const summary = await send(parsed, false);
      setResult(summary);
      setPhase('done');
      if (onImported) await onImported(step, summary);
    } catch (err) {
      setError(errorMessage(err, 'The import failed. Nothing was saved.'));
      setPhase('preview');
    }
  };

  const downloadTemplate = async () => {
    setDownloading(true);
    try {
      const response = await apiClient.get(`/import/templates/${step.kind}`, { responseType: 'blob' });
      const disposition = response.headers?.['content-disposition'] || '';
      const match = /filename="?([^";]+)"?/i.exec(disposition);
      const name = match ? match[1] : `${step.kind}_template.csv`;
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(errorMessage(err, 'Could not download the template.'));
    } finally {
      setDownloading(false);
    }
  };

  // What the server says it would write: sales rows, or new + updated rows / lines / operations / rules.
  const importCount = preview ? (isSales ? preview.imported : preview.created + preview.updated) : 0;
  const nothingToChange = Boolean(preview) && importCount === 0 && preview.errors.length === 0;
  const busy = phase === 'reading' || phase === 'checking' || phase === 'importing';
  const modeInfo = step.modes?.find((m) => m.value === mode);

  return (
    <Card className={`overflow-hidden ${phase !== 'idle' || error ? 'ring-1 ring-orange-200' : ''}`} data-testid={`import-step-${step.kind}`}>
      <div className="flex gap-4 p-5">
        <div className="flex-shrink-0">
          {hasData ? (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-700" title="Has data">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 bg-white text-sm font-semibold text-gray-600">
              {number}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 md:flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-gray-900">
                  <span className="mr-1 text-gray-400">{number}.</span>{step.title}
                </h3>
                {typeof count === 'number' && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${hasData ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {hasData ? countLabel || plural(count, step.noun) : 'None yet'}
                  </span>
                )}
                {step.manageLink && hasData && (
                  <Link to={step.manageLink.to} className="text-xs font-medium text-orange-700 hover:underline">{step.manageLink.label} →</Link>
                )}
              </div>
              <p className="mt-1 text-sm text-gray-600">{step.purpose}</p>
              {isSales && (
                <p className="mt-1 text-sm">
                  {scenario ? (
                    <>
                      <span className="text-gray-500">Imports into scenario </span>
                      <span className="font-medium text-gray-900">{scenario.name}</span>
                      <span className="text-gray-400"> ({scenario.id})</span>
                      {scenario.start_period && (
                        <span className="text-gray-500"> · currently {formatPeriod(scenario.start_period)} – {formatPeriod(scenario.end_period)}</span>
                      )}
                      <span className="text-gray-500">. Rows for the same customer, product and month are updated; other rows are kept.</span>
                    </>
                  ) : (
                    <span className="text-amber-700">
                      {noScenarios ? 'Create a scenario first; the sales forecast is imported into it.' : 'Choose an active scenario in the bar above first.'}{' '}
                      <Link to="/scenarios" className="font-medium underline">Go to Scenarios</Link>
                    </span>
                  )}
                </p>
              )}
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" onClick={downloadTemplate} disabled={downloading}>
                {downloading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
                Template
              </Button>
              <Button
                size="sm"
                onClick={() => fileInput.current?.click()}
                disabled={blocked || busy}
                className="bg-orange-600 text-white hover:bg-orange-700"
              >
                <Upload className="mr-1.5 h-4 w-4" />
                Upload CSV or Excel
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.txt,.xlsx,.xls,.xlsm"
                className="hidden"
                onChange={handleFile}
                aria-label={`Upload ${step.title} file`}
              />
            </div>
          </div>

          <ColumnChips required={columns.required} optional={columns.optional} docs={columns.docs} />

          {error && (
            <div className="flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)} className="text-red-500 hover:text-red-700" aria-label="Dismiss"><X className="h-4 w-4" /></button>
            </div>
          )}

          {file && phase !== 'idle' && (
            <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <FileSpreadsheet className="h-4 w-4 flex-shrink-0 text-gray-500" />
                  <span className="truncate font-medium text-gray-900">{file.name}</span>
                  {parsed && (
                    <span className="text-gray-500">
                      · {plural(parsed.rows.length, ['row', 'rows'])}
                      {parsed.sheetName ? ` · sheet "${parsed.sheetName}"` : ''}
                    </span>
                  )}
                </div>
                {phase !== 'importing' && (
                  <Button variant="ghost" size="sm" onClick={reset}>
                    {phase === 'done' ? 'Close' : 'Cancel'}
                  </Button>
                )}
              </div>

              {isSales && parsed?.sales?.layout === 'wide' && (
                <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900">
                  One column per month detected ({formatPeriod(parsed.sales.monthColumns[0].period)} – {formatPeriod(parsed.sales.monthColumns[parsed.sales.monthColumns.length - 1].period)}).
                  {' '}Converted {plural(parsed.rows.length, ['row', 'rows'])} into {plural(parsed.sales.rows.length, ['monthly row', 'monthly rows'])}; blank and zero months are skipped.
                </p>
              )}

              {phase !== 'done' && (step.modes || step.options) && (
                <div className="space-y-2">
                  {step.modes && (
                    <div>
                      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Import mode">
                        {step.modes.map((m) => (
                          <label
                            key={m.value}
                            className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm ${mode === m.value ? 'border-orange-500 bg-orange-50 text-orange-900' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}
                          >
                            <input
                              type="radio"
                              name={`mode-${step.kind}`}
                              value={m.value}
                              checked={mode === m.value}
                              onChange={() => changeMode(m.value)}
                              disabled={busy}
                              className="sr-only"
                            />
                            {m.label}
                          </label>
                        ))}
                      </div>
                      {modeInfo && <p className="mt-1 text-xs text-gray-500">{modeInfo.help}</p>}
                    </div>
                  )}
                  {(step.options || []).filter((o) => !o.needsScenario || scenario).map((o) => (
                    <label key={o.key} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={Boolean(options[o.key])}
                        onChange={(e) => changeOption(o.key, e.target.checked)}
                        disabled={busy}
                        className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                      />
                      {o.needsScenario && scenario ? o.label.replace('the active scenario', `${scenario.name}`) : o.label}
                    </label>
                  ))}
                </div>
              )}

              {(phase === 'reading' || phase === 'checking') && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {phase === 'reading' ? 'Reading the file…' : 'Checking every row with the server…'}
                </div>
              )}

              {phase === 'preview' && preview && (
                <>
                  <ImportPreview result={preview} rows={rowsToSend()} step={step} sourceRowFor={parsed?.sales?.layout === 'wide' ? parsed.sales.sourceRowFor : null} />
                  {isSales && !options.autoCreate && preview.errors.some((e) => /does not exist/i.test(e.error)) && (
                    <p className="text-sm text-gray-700">
                      Some customers or products are not set up. Import them in steps 1–2, or tick
                      {' '}<span className="font-medium">“Create customers and products that are not set up yet”</span> above.
                    </p>
                  )}
                  {isSales && !options.allowZeroPrice && preview.errors.some((e) => /^No price/i.test(e.error)) && (
                    <p className="text-sm text-gray-700">
                      Some rows have no price and nothing in the price list or list price to fill it. Add prices (step 7) or list prices (step 2),
                      or tick <span className="font-medium">“Import rows that have no price at $0”</span>.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3">
                    <Button
                      onClick={confirmImport}
                      disabled={importCount === 0}
                      className="bg-orange-600 text-white hover:bg-orange-700"
                    >
                      Import {plural(importCount, step.rowNoun || ['row', 'rows'])}
                    </Button>
                    <Button variant="outline" onClick={reset}>Cancel</Button>
                    {preview.errors.length > 0 && importCount > 0 && (
                      <span className="text-xs text-gray-500">Rows with problems are skipped. Fix the file and upload it again to include them.</span>
                    )}
                    {importCount === 0 && !nothingToChange && (
                      <span className="text-xs text-red-700">Nothing can be imported. Fix the problems above and upload the file again.</span>
                    )}
                    {nothingToChange && (
                      <span className="text-xs text-gray-600">Nothing to change: everything in this file is already saved.</span>
                    )}
                  </div>
                </>
              )}

              {phase === 'importing' && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Loader2 className="h-4 w-4 animate-spin" /> Importing…
                </div>
              )}

              {phase === 'done' && result && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-green-800">
                    <CheckCircle2 className="h-5 w-5" />
                    {isSales
                      ? `Imported ${plural(result.imported, ['sales row', 'sales rows'])} into ${scenario?.name || 'the scenario'}.`
                      : `Import finished: ${[
                        result.created ? `${result.created.toLocaleString('en-US')} added` : null,
                        result.updated ? `${result.updated.toLocaleString('en-US')} updated` : null,
                        result.replaced ? `${result.replaced.toLocaleString('en-US')} replaced` : null,
                      ].filter(Boolean).join(', ') || 'no changes'}.`}
                  </div>
                  <ImportPreview result={result} rows={rowsToSend()} step={step} done sourceRowFor={parsed?.sales?.layout === 'wide' ? parsed.sales.sourceRowFor : null} />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => { reset(); fileInput.current?.click(); }}>Import another file</Button>
                    {step.manageLink && (
                      <Link to={step.manageLink.to} className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-orange-700 hover:bg-orange-50">
                        {step.manageLink.label} →
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};

export default ImportStepCard;
