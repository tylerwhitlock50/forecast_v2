import React, { useCallback, useEffect, useState } from 'react';
import { Lock, LockOpen } from 'lucide-react';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../../ui/modal';
import { Button } from '../../../ui/button';
import { Input } from '../../../ui/input';
import { Label } from '../../../ui/label';
import { formatPeriod } from '../utils/formatters';
import { StatusBox } from './ImportPreview';
import { closePeriod, errorText, fetchPeriods, formatWhen, reopenPeriod } from './actualsApi';

const NAME_KEY = 'forecast.actuals.closedBy';

const rememberedName = () => {
  try {
    return window.localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
};

const rememberName = (name) => {
  try {
    if (name) window.localStorage.setItem(NAME_KEY, name);
  } catch {
    // private mode: nothing to remember
  }
};

export const ClosedBadge = ({ className = '' }) => (
  <span className={`inline-flex items-center gap-1 rounded-full bg-gray-800 px-2 py-0.5 text-xs font-medium text-white ${className}`}>
    <Lock className="h-3 w-3" aria-hidden="true" />Closed
  </span>
);

/** Month-end close for the report window: close a month (its actuals are then locked) or reopen it with a reason. */
const PeriodClosePanel = ({ start, end, refreshKey, onChanged }) => {
  const [periods, setPeriods] = useState(null);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null);   // { mode: 'close' | 'reopen', period, name, text, busy, error }

  const load = useCallback(async () => {
    if (!start || !end) return;
    try {
      setError(null);
      const data = await fetchPeriods(start, end);
      setPeriods(data.periods || []);
    } catch (err) {
      setError(errorText(err, 'Could not load the month-end status'));
    }
  }, [start, end]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const open = (mode, period) => setDialog({ mode, period, name: rememberedName(), text: '', busy: false, error: null });

  const submit = async () => {
    if (!dialog) return;
    if (dialog.mode === 'reopen' && !dialog.text.trim()) {
      setDialog(d => ({ ...d, error: 'Give a reason for reopening the month.' }));
      return;
    }
    setDialog(d => ({ ...d, busy: true, error: null }));
    try {
      rememberName(dialog.name.trim());
      if (dialog.mode === 'close') {
        await closePeriod(dialog.period, dialog.name.trim(), dialog.text.trim());
      } else {
        await reopenPeriod(dialog.period, dialog.text.trim(), dialog.name.trim());
      }
      setDialog(null);
      await load();
      if (onChanged) onChanged();
    } catch (err) {
      setDialog(d => ({ ...d, busy: false, error: errorText(err, 'Could not save') }));
    }
  };

  const label = dialog ? formatPeriod(dialog.period) : '';

  return (
    <div className="space-y-3" data-testid="actuals-close-panel">
      <p className="text-sm text-gray-600">
        Close a month once its actuals are final. A closed month&rsquo;s actuals cannot be imported, changed, deleted or undone until it is reopened, and reopening needs a reason.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!periods && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {periods && (
        <div className="hidden sm:block overflow-x-auto rounded-md border border-gray-200">
          <table className="min-w-full text-xs" data-testid="actuals-close-table">
            <thead>
              <tr className="bg-gray-100 text-gray-600">
                <th className="px-3 py-2 text-left font-medium">Month</th>
                <th className="px-3 py-2 text-left font-medium">Actuals entered</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Details</th>
                <th className="px-3 py-2" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {periods.map(p => (
                <tr key={p.period} className="border-t border-gray-100 align-top" data-testid={`actuals-month-${p.period}`}>
                  <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-800">{formatPeriod(p.period)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                    {p.lines_entered ? `${p.lines_entered} of ${p.lines_total} lines` : <span className="text-gray-400">None</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {p.closed ? <ClosedBadge /> : <span className="text-gray-600">Open</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {p.closed ? (
                      <>
                        Closed {formatWhen(p.closed_at)}{p.closed_by ? ` by ${p.closed_by}` : ''}
                        {p.note && <div className="text-gray-500">{p.note}</div>}
                      </>
                    ) : (p.note || '')}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {p.closed ? (
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => open('reopen', p.period)}>
                        <LockOpen className="mr-1 h-3 w-3" aria-hidden="true" />Reopen
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => open('close', p.period)}>
                        <Lock className="mr-1 h-3 w-3" aria-hidden="true" />Close month
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {periods && (
        <ul className="sm:hidden space-y-2" data-testid="actuals-close-cards">
          {periods.map(p => (
            <li key={p.period} className="rounded-md border border-gray-200 p-3 text-xs" data-testid={`actuals-month-card-${p.period}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-gray-800">{formatPeriod(p.period)}</span>
                {p.closed ? <ClosedBadge /> : <span className="text-gray-600">Open</span>}
              </div>
              <div className="mt-1 text-gray-600">
                {p.lines_entered ? `${p.lines_entered} of ${p.lines_total} lines entered` : 'No actuals entered'}
              </div>
              {p.closed && (
                <div className="mt-1 text-gray-600">
                  Closed {formatWhen(p.closed_at)}{p.closed_by ? ` by ${p.closed_by}` : ''}
                  {p.note && <div className="text-gray-500">{p.note}</div>}
                </div>
              )}
              {!p.closed && p.note && <div className="mt-1 text-gray-500">{p.note}</div>}
              <div className="mt-2">
                {p.closed ? (
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => open('reopen', p.period)}>
                    <LockOpen className="mr-1 h-3 w-3" aria-hidden="true" />Reopen
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => open('close', p.period)}>
                    <Lock className="mr-1 h-3 w-3" aria-hidden="true" />Close month
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialog && (
        <Modal onClose={() => !dialog.busy && setDialog(null)} className="max-w-md" data-testid="actuals-close-dialog">
          <ModalHeader>
            <ModalTitle>{dialog.mode === 'close' ? `Close ${label}?` : `Reopen ${label}?`}</ModalTitle>
            <ModalClose onClick={() => setDialog(null)} disabled={dialog.busy} />
          </ModalHeader>
          <ModalContent className="space-y-3">
            <p className="text-sm text-gray-600">
              {dialog.mode === 'close'
                ? `${label}'s actuals will be locked: imports, edits, deletes and undo that would change them are refused until the month is reopened.`
                : `${label}'s actuals can be changed again once it is reopened. The reason is kept with the month.`}
            </p>
            <div className="space-y-1">
              <Label htmlFor="close-name">{dialog.mode === 'close' ? 'Closed by' : 'Your name'}</Label>
              <Input id="close-name" value={dialog.name} onChange={e => setDialog(d => ({ ...d, name: e.target.value }))} placeholder="Name" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="close-text">{dialog.mode === 'close' ? 'Note (optional)' : 'Reason'}</Label>
              <Input
                id="close-text"
                value={dialog.text}
                onChange={e => setDialog(d => ({ ...d, text: e.target.value }))}
                placeholder={dialog.mode === 'close' ? 'e.g. Reconciled to the April trial balance' : 'e.g. Late freight invoice'}
              />
            </div>
            {dialog.error && <StatusBox tone="error">{dialog.error}</StatusBox>}
          </ModalContent>
          <ModalFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={dialog.busy}>Cancel</Button>
            <Button onClick={submit} disabled={dialog.busy} data-testid="actuals-close-confirm">
              {dialog.busy ? 'Saving…' : dialog.mode === 'close' ? 'Close month' : 'Reopen month'}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
};

export default PeriodClosePanel;
