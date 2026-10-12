import React, { useCallback, useEffect, useState } from 'react';
import { Lock, Undo2 } from 'lucide-react';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../../ui/modal';
import { Button } from '../../../ui/button';
import { Badge } from '../../../ui/badge';
import { formatAccounting, formatPeriod } from '../utils/formatters';
import { StatusBox } from './ImportPreview';
import { errorText, fetchBatches, formatWhen, plural, previewUndo, undoBatch } from './actualsApi';

const STATUS = {
  imported: { label: 'Imported', variant: 'success' },
  partial: { label: 'Partly imported', variant: 'warning' },
  undone: { label: 'Undone', variant: 'secondary' },
  deleted: { label: 'Deleted', variant: 'secondary' }
};

const PAGE = 20;

// "4 new, 1 changed, 2 unchanged, 1 left out" (zeros left out).
export const batchCounts = (batch) => {
  const parts = [];
  if (batch.inserted) parts.push(`${batch.inserted} new`);
  if (batch.updated) parts.push(`${batch.updated} changed`);
  if (batch.unchanged) parts.push(`${batch.unchanged} unchanged`);
  if (batch.replaced) parts.push(`${batch.replaced} replaced`);
  if (batch.rejected) parts.push(`${batch.rejected} left out`);
  return parts.join(', ') || 'none';
};

export const batchTitle = (batch) => {
  if (batch.status === 'deleted') return 'Deleted actuals';
  if (batch.filename) return batch.filename;
  if (batch.source === 'manual') return 'Entered by hand';
  return batch.source || 'Import';
};

const BatchWhat = ({ batch }) => (
  <div className="min-w-0">
    <div className="font-medium text-gray-800 break-words">{batchTitle(batch)}</div>
    <div className="text-gray-500">
      <span className="font-mono">{batch.batch_id}</span>
      {batch.source && batch.filename && batch.source !== batch.filename ? ` · ${batch.source}` : ''}
    </div>
    {batch.note && <div className="text-gray-600 break-words">{batch.note}</div>}
  </div>
);

const BatchTotal = ({ batch }) => (
  <>
    {batch.file_total === null || batch.file_total === undefined ? '' : formatAccounting(batch.file_total, { decimals: 2 })}
    {batch.control_total !== null && batch.control_total !== undefined && (
      <div className="text-gray-500">control {formatAccounting(batch.control_total, { decimals: 2 })}</div>
    )}
  </>
);

const BatchMonths = ({ batch }) => (
  <>
    {(batch.periods || []).map(formatPeriod).join(', ')}
    {batch.closed_periods?.length > 0 && (
      <div className="text-gray-500"><Lock className="mr-1 inline h-3 w-3" aria-hidden="true" />closed</div>
    )}
  </>
);

const BatchStatus = ({ batch }) => {
  const status = STATUS[batch.status] || { label: batch.status, variant: 'secondary' };
  return <Badge variant={status.variant} className="whitespace-nowrap">{status.label}</Badge>;
};

const UndoButton = ({ batch, onClick }) => {
  if (batch.status === 'deleted' || batch.status === 'undone') return null;
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs"
      disabled={!batch.can_undo || !batch.rows_current}
      title={batch.undo_blocked_reason || (!batch.rows_current ? 'Every amount from this import has been changed since' : 'Undo this import')}
      onClick={onClick}
    >
      <Undo2 className="mr-1 h-3 w-3" aria-hidden="true" />Undo
    </Button>
  );
};

/** The actuals import / entry history with undo. */
// "This removes 1 amount and restores 2 amounts" from the undo preview.
export const undoSummary = (preview) => {
  const removes = preview?.rows_to_remove || 0;
  const restores = preview?.rows_to_restore || 0;
  const putsBack = preview?.rows_to_put_back || 0;
  const parts = [];
  if (removes) parts.push(`removes ${plural(removes, 'amount')}`);
  if (restores) parts.push(`puts ${plural(restores, 'amount')} back to ${restores === 1 ? 'its' : 'their'} earlier value`);
  if (putsBack) parts.push(`puts back ${plural(putsBack, 'amount')} this import replaced`);
  if (parts.length > 2) return `This ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return parts.length ? `This ${parts.join(' and ')}` : 'This changes nothing';
};

const ImportHistory = ({ refreshKey, onChanged }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [limit, setLimit] = useState(PAGE);
  const [confirm, setConfirm] = useState(null);   // { batch, preview, busy, error }

  const load = useCallback(async () => {
    try {
      setError(null);
      setData(await fetchBatches(limit));
    } catch (err) {
      setError(errorText(err, 'Could not load the import history'));
    }
  }, [limit]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const startUndo = async (batch) => {
    setConfirm({ batch, preview: null, busy: true, error: null });
    try {
      const preview = await previewUndo(batch.batch_id);
      setConfirm({ batch, preview, busy: false, error: null });
    } catch (err) {
      setConfirm({ batch, preview: null, busy: false, error: errorText(err, 'Could not check this import') });
    }
  };

  const doUndo = async () => {
    if (!confirm?.batch) return;
    setConfirm(c => ({ ...c, busy: true, error: null }));
    try {
      await undoBatch(confirm.batch.batch_id);
      setConfirm(null);
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      setConfirm(c => ({ ...c, busy: false, error: errorText(err, 'Undo failed') }));
    }
  };

  const batches = data?.batches || [];

  return (
    <div className="space-y-3" data-testid="actuals-history">
      <p className="text-sm text-gray-600">
        Every import and save of actuals, newest first. Undo removes the amounts an import wrote that have not been changed since.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {data && batches.length === 0 && <p className="text-sm text-gray-500">No actuals have been imported or saved yet.</p>}
      {batches.length > 0 && (
        <>
          <div className="hidden md:block overflow-x-auto rounded-md border border-gray-200">
            <table className="min-w-full text-xs" data-testid="actuals-history-table">
              <thead>
                <tr className="bg-gray-100 text-gray-600">
                  <th className="px-3 py-2 text-left font-medium">When</th>
                  <th className="px-3 py-2 text-left font-medium">What</th>
                  <th className="px-3 py-2 text-left font-medium">Amounts</th>
                  <th className="px-3 py-2 text-right font-medium">File total</th>
                  <th className="px-3 py-2 text-left font-medium">Months</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {batches.map(b => (
                  <tr key={b.batch_id} className="border-t border-gray-100 align-top" data-testid={`actuals-batch-${b.batch_id}`}>
                    <td className="px-3 py-2 text-gray-700 w-28">{formatWhen(b.created_at)}</td>
                    <td className="px-3 py-2 min-w-[10rem]"><BatchWhat batch={b} /></td>
                    <td className="px-3 py-2 text-gray-700" data-testid="actuals-batch-counts">{b.status === 'deleted' ? '' : batchCounts(b)}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap"><BatchTotal batch={b} /></td>
                    <td className="px-3 py-2 text-gray-700 max-w-[11rem]"><BatchMonths batch={b} /></td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <BatchStatus batch={b} />
                        <UndoButton batch={b} onClick={() => startUndo(b)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="md:hidden space-y-2" data-testid="actuals-history-cards">
            {batches.map(b => (
              <li key={b.batch_id} className="rounded-md border border-gray-200 p-3 text-xs" data-testid={`actuals-batch-card-${b.batch_id}`}>
                <div className="flex items-start justify-between gap-2">
                  <BatchWhat batch={b} />
                  <BatchStatus batch={b} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-gray-700">
                  <span className="text-gray-500">When</span><span>{formatWhen(b.created_at)}</span>
                  {b.status !== 'deleted' && (<><span className="text-gray-500">Amounts</span><span>{batchCounts(b)}</span></>)}
                  {b.file_total !== null && b.file_total !== undefined && (<><span className="text-gray-500">File total</span><span className="tabular-nums"><BatchTotal batch={b} /></span></>)}
                  {b.periods?.length > 0 && (<><span className="text-gray-500">Months</span><span><BatchMonths batch={b} /></span></>)}
                </div>
                <div className="mt-2"><UndoButton batch={b} onClick={() => startUndo(b)} /></div>
              </li>
            ))}
          </ul>
        </>
      )}
      {data && data.total_count > batches.length && (
        <Button variant="link" className="px-0" onClick={() => setLimit(l => l + PAGE)}>Show older</Button>
      )}

      {confirm && (
        <Modal onClose={() => !confirm.busy && setConfirm(null)} className="max-w-lg" data-testid="actuals-undo-dialog">
          <ModalHeader>
            <ModalTitle>Undo import?</ModalTitle>
            <ModalClose onClick={() => setConfirm(null)} disabled={confirm.busy} />
          </ModalHeader>
          <ModalContent className="space-y-3 text-sm">
            <p className="text-gray-700">
              <span className="font-medium">{batchTitle(confirm.batch)}</span>, {formatWhen(confirm.batch.created_at)}
            </p>
            {confirm.busy && !confirm.preview && <p className="text-gray-500">Checking what would be removed…</p>}
            {confirm.preview && (
              <>
                <p data-testid="actuals-undo-summary">
                  {undoSummary(confirm.preview)}
                  {confirm.preview.periods?.length ? ` in ${confirm.preview.periods.map(formatPeriod).join(', ')}` : ''}.
                </p>
                {(confirm.preview.notes || []).map((n, i) => (
                  <p key={i} className="text-amber-800">{n}</p>
                ))}
                {confirm.preview.changed?.length > 0 && (
                  <div>
                    <p className="text-gray-700">Amounts that existed before this import:</p>
                    <ul className="mt-1 list-inside list-disc text-gray-700" data-testid="actuals-undo-changed">
                      {confirm.preview.changed.map(r => (
                        <li key={`${r.period}|${r.line_item}|${r.reference_id}`}>
                          {formatPeriod(r.period)} {r.label}{r.reference_id ? ` (${r.reference_id})` : ''}: now {formatAccounting(r.amount, { decimals: 2 })}
                          {r.action === 'restore' && r.restores_to !== null && r.restores_to !== undefined
                            ? `, goes back to ${formatAccounting(r.restores_to, { decimals: 2 })}`
                            : ' (no earlier amount still in place: removed)'}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {confirm.preview.put_back_rows?.length > 0 && (
                  <div>
                    <p className="text-gray-700">Amounts this import replaced, put back:</p>
                    <ul className="mt-1 list-inside list-disc text-gray-700" data-testid="actuals-undo-put-back">
                      {confirm.preview.put_back_rows.map(r => (
                        <li key={`${r.period}|${r.line_item}|${r.reference_id}`}>
                          {formatPeriod(r.period)} {r.label}{r.reference_id ? ` (${r.reference_id})` : ''}: {formatAccounting(r.amount, { decimals: 2 })}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
            {confirm.error && <StatusBox tone="error">{confirm.error}</StatusBox>}
          </ModalContent>
          <ModalFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={confirm.busy}>Cancel</Button>
            <Button variant="destructive" onClick={doUndo} disabled={confirm.busy || !confirm.preview?.can_undo} data-testid="actuals-undo-confirm">
              {confirm.busy && confirm.preview ? 'Undoing…' : 'Undo import'}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
};

export default ImportHistory;
