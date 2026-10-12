import React, { useEffect, useState } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import { Button } from '../../ui/button';
import { scenarioErrorMessage } from './scenarioErrors';
import { TOTAL_LINES, formatWhen, money } from './governance';
import { formatPeriod } from '../ReportingAnalysis/utils/formatters';

/**
 * Approvals and unlocks of one scenario, newest first.
 *
 * Props:
 *  - open, scenario, onClose
 *  - loadApprovals: (forecastId) => Promise<entries>  (GET /forecast/scenario/{id}/approvals)
 */
const ApprovalHistoryModal = ({ open, scenario, onClose, loadApprovals }) => {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !scenario?.id) return undefined;
    let cancelled = false;
    setEntries(null);
    setError('');
    loadApprovals(scenario.id)
      .then((list) => { if (!cancelled) setEntries(list || []); })
      .catch((err) => { if (!cancelled) setError(scenarioErrorMessage(err, 'Could not load the approval history')); });
    return () => { cancelled = true; };
  }, [open, scenario, loadApprovals]);

  if (!open || !scenario) return null;

  return (
    <Modal onClose={onClose} className="max-w-2xl">
      <ModalHeader>
        <ModalTitle className="pr-8">Approval history: {scenario.name}</ModalTitle>
        <ModalClose onClick={onClose} />
      </ModalHeader>
      <ModalContent className="space-y-3">
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {!error && entries === null && <p className="text-sm text-gray-500">Loading…</p>}
        {entries && entries.length === 0 && (
          <p className="text-sm text-gray-600">This scenario has never been approved.</p>
        )}
        {(entries || []).map((entry) => (
          <div key={entry.approval_id} className="rounded-md border border-gray-200 p-3 text-sm" data-testid="approval-entry">
            {entry.action === 'approve' ? (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="font-semibold text-emerald-800">
                    Approved{entry.actor ? ` by ${entry.actor}` : ''}
                  </span>
                  <span className="text-xs text-gray-500">{formatWhen(entry.created_at)}</span>
                </div>
                {entry.start_period && (
                  <div className="mt-0.5 text-xs text-gray-600">
                    {formatPeriod(entry.start_period)} – {formatPeriod(entry.end_period)}
                  </div>
                )}
                {entry.note && <p className="mt-1 text-gray-700">{entry.note}</p>}
                {entry.totals && (
                  <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                    {TOTAL_LINES.filter(([key]) => entry.totals[key] !== undefined).map(([key, label]) => (
                      <div key={key} className="flex justify-between gap-2 border-b border-dashed border-gray-100 py-0.5">
                        <dt className="text-gray-500">{label}</dt>
                        <dd className="tabular-nums text-gray-900">{money(entry.totals[key])}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  {entry.workbook_available ? (
                    <a
                      className="font-medium text-orange-700 hover:underline"
                      href={`/api/forecast/scenario/${encodeURIComponent(entry.forecast_id)}/approvals/${encodeURIComponent(entry.approval_id)}/workbook`}
                    >
                      Download approved workbook
                    </a>
                  ) : entry.workbook_filename ? (
                    <span className="text-gray-400">Workbook {entry.workbook_filename} is no longer on disk</span>
                  ) : null}
                  {entry.snapshot_filename && (
                    <span className="break-all text-gray-500" title="Restore it from Load database in the sidebar">
                      Snapshot: {entry.snapshot_filename}{entry.snapshot_available ? '' : ' (no longer on disk)'}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="font-semibold text-gray-800">Unlocked{entry.actor ? ` by ${entry.actor}` : ''}</span>
                  <span className="text-xs text-gray-500">{formatWhen(entry.created_at)}</span>
                </div>
                {entry.note && <p className="mt-1 text-gray-700">Reason: {entry.note}</p>}
              </>
            )}
          </div>
        ))}
      </ModalContent>
      <ModalFooter>
        <Button type="button" variant="outline" onClick={onClose}>Close</Button>
      </ModalFooter>
    </Modal>
  );
};

export default ApprovalHistoryModal;
