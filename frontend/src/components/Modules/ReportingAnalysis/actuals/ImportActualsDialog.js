import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../../ui/modal';
import { Button } from '../../../ui/button';
import { Input } from '../../../ui/input';
import { Label } from '../../../ui/label';
import ImportPreview, { StatusBox } from './ImportPreview';
import { errorText, plural, uploadActuals } from './actualsApi';

const ACCEPT = '.csv,.xlsx,.xlsm,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CHECK_DELAY_MS = 400;

const Checkbox = ({ id, checked, onChange, children, help }) => (
  <div className="flex items-start gap-2">
    <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 rounded border-gray-300" checked={checked} onChange={e => onChange(e.target.checked)} />
    <label htmlFor={id} className="text-sm text-gray-800">
      {children}
      {help && <span className="block text-xs text-gray-500">{help}</span>}
    </label>
  </div>
);

/**
 * Import actuals from a CSV / Excel file: choose the file, the check runs
 * (a dry run: nothing is written) and shows counts, rows with problems,
 * totals by line and month and the control-total tie-out; Import writes it
 * as one batch, or nothing at all if any row is rejected (unless "Import the
 * valid rows" is ticked).
 */
const ImportActualsDialog = ({ onClose, onImported, onDownloadTemplate }) => {
  const [file, setFile] = useState(null);
  const [controlTotal, setControlTotal] = useState('');
  const [combineDuplicates, setCombineDuplicates] = useState(false);
  const [allowPartial, setAllowPartial] = useState(false);
  const [note, setNote] = useState('');
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState(null);          // { ok, report, message } of the latest dry run
  const [checkError, setCheckError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);        // { ok, report, message } of the real import
  const sequence = useRef(0);
  const fileInput = useRef(null);

  const options = { controlTotal, combineDuplicates, allowPartial };

  const runCheck = useCallback(async (theFile, opts) => {
    if (!theFile) return;
    const mine = ++sequence.current;
    setChecking(true);
    setCheckError(null);
    try {
      const outcome = await uploadActuals(theFile, { ...opts, dryRun: true });
      if (mine !== sequence.current) return;
      setCheck(outcome);
    } catch (err) {
      if (mine !== sequence.current) return;
      setCheck(null);
      setCheckError(errorText(err, 'The file could not be checked'));
    } finally {
      if (mine === sequence.current) setChecking(false);
    }
  }, []);

  // Re-check whenever the file or an option that changes the outcome changes.
  useEffect(() => {
    if (!file || result) return undefined;
    const timer = setTimeout(() => runCheck(file, { controlTotal, combineDuplicates, allowPartial }), CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [file, controlTotal, combineDuplicates, allowPartial, runCheck, result]);

  const handleFile = (event) => {
    const chosen = event.target.files?.[0] || null;
    event.target.value = '';
    if (!chosen) return;
    sequence.current += 1;
    setFile(chosen);
    setCheck(null);
    setCheckError(null);
    setResult(null);
    setChecking(true);
  };

  const report = check?.report;
  const canImport = !!file && !checking && !importing && !!report && ['imported', 'partial'].includes(report.outcome);
  const writeCount = report ? (report.inserted || 0) + (report.updated || 0) : 0;

  const handleImport = async () => {
    if (!canImport) return;
    setImporting(true);
    try {
      const outcome = await uploadActuals(file, { ...options, note });
      setResult(outcome);
      if (outcome.ok && onImported) onImported(outcome.report);
    } catch (err) {
      setResult({ ok: false, report: null, message: errorText(err, 'Import failed') });
    } finally {
      setImporting(false);
    }
  };

  const done = result?.ok;

  return (
    <Modal onClose={onClose} className="max-w-4xl" data-testid="actuals-import-dialog">
      <ModalHeader>
        <ModalTitle>Import actuals</ModalTitle>
        <ModalClose onClick={onClose} />
      </ModalHeader>
      <ModalContent className="space-y-5">
        {done ? (
          <StatusBox tone="success" title="Actuals imported" testId="actuals-import-done">
            {plural(result.report.inserted, 'new amount')}, {plural(result.report.updated, 'changed amount')}, {result.report.unchanged} unchanged
            {result.report.rejected ? `; ${plural(result.report.rejected, 'row')} left out` : ''}.
            {' '}Saved as import <span className="font-mono">{result.report.batch_id}</span>: you can undo it under Import history.
          </StatusBox>
        ) : (
          <>
            <div className="space-y-2">
              <p className="text-sm text-gray-600">
                One row per month and line: <span className="font-medium">period</span>, <span className="font-medium">line item</span> and{' '}
                <span className="font-medium">amount</span> (optional reference and notes). CSV or Excel. Lines can be written as on the statements
                (&ldquo;Net Sales&rdquo;, &ldquo;COGS - Materials&rdquo;). A blank amount is a problem, not zero; enter 0 for a confirmed zero.
                Nothing is saved until you click Import.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
                  <FileUp className="mr-2 h-4 w-4" aria-hidden="true" />{file ? 'Choose another file' : 'Choose file'}
                </Button>
                <input ref={fileInput} type="file" accept={ACCEPT} className="hidden" onChange={handleFile} data-testid="actuals-file-input" />
                <span className="text-sm text-gray-700" data-testid="actuals-file-name">{file ? file.name : 'No file chosen'}</span>
                {onDownloadTemplate && (
                  <Button type="button" variant="link" className="px-1" onClick={onDownloadTemplate}>Download template</Button>
                )}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="actuals-control-total">Control total (optional)</Label>
                <Input
                  id="actuals-control-total"
                  inputMode="decimal"
                  placeholder="e.g. 1,254,300.00"
                  value={controlTotal}
                  onChange={e => setControlTotal(e.target.value)}
                />
                <p className="text-xs text-gray-500">The file&rsquo;s amounts must add up to this, e.g. the total of the trial balance you exported.</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="actuals-import-note">Note (optional)</Label>
                <Input id="actuals-import-note" placeholder="e.g. April close, TB v2" value={note} onChange={e => setNote(e.target.value)} />
                <p className="text-xs text-gray-500">Kept with the import in the history.</p>
              </div>
              <Checkbox id="actuals-combine" checked={combineDuplicates} onChange={setCombineDuplicates}
                help="Rows with the same month, line and reference are added together. Otherwise they are a problem.">
                Add up duplicate rows
              </Checkbox>
              <Checkbox id="actuals-partial" checked={allowPartial} onChange={setAllowPartial}
                help="Rows with problems are left out. Otherwise nothing is imported until every row is right.">
                Import the valid rows even if some rows have problems
              </Checkbox>
            </div>

            {checking && <p className="text-sm text-gray-500" data-testid="actuals-checking">Checking the file…</p>}
            {checkError && !checking && (
              <StatusBox tone="error" title="The file could not be read" testId="actuals-check-error">{checkError}</StatusBox>
            )}
            {result && !result.ok && (
              <StatusBox tone="error" title="Nothing was imported" testId="actuals-import-refused">{result.message}</StatusBox>
            )}
            {!checking && (result?.report || report) && <ImportPreview report={result?.report || report} />}
          </>
        )}
      </ModalContent>
      <ModalFooter>
        {done ? (
          <Button key="done" onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button key="cancel" variant="outline" onClick={onClose}>Cancel</Button>
            <Button key="import" onClick={handleImport} disabled={!canImport} data-testid="actuals-import-confirm">
              {importing ? 'Importing…' : canImport && writeCount ? `Import ${plural(writeCount, 'amount')}` : 'Import'}
            </Button>
          </>
        )}
      </ModalFooter>
    </Modal>
  );
};

export default ImportActualsDialog;
