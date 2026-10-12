import React, { useState } from 'react';
import api from '../../../lib/apiClient';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import ScheduleChangePreview from './ScheduleChangePreview';
import { describeAuditExample, issueLabel } from './loanScheduleUtils';

const ACTION_TEXT = {
  redate: 'Move the unpaid installments to their calendar dates (amounts unchanged)',
  regenerate: 'Rebuild the unpaid installments after the last paid one',
  fix_loan_terms: 'Edit the loan and enter a valid start date first',
};

/**
 * 'Review & repair' for legacy loan schedules: one card per loan from the
 * schedule audit; Preview runs the repair as a dry run and shows the
 * before / after, Repair saves it. Nothing is repaired without a click.
 */
const ScheduleRepairModal = ({ audit, onClose, onRepaired }) => {
  const loans = audit?.loans || [];
  const [previewing, setPreviewing] = useState(null);   // loan_id being previewed
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const runPreview = async (loanId) => {
    setBusy(true);
    setError('');
    try {
      const res = await api.post(`/loans/${encodeURIComponent(loanId)}/repair-schedule`, { dry_run: true },
        { suppressSuccessToast: true, suppressErrorToast: true });
      setPreviewing(loanId);
      setPreview(res.data);
    } catch (err) {
      setError(err.userMessage || 'Could not preview the repair');
    } finally {
      setBusy(false);
    }
  };

  const runRepair = async () => {
    if (!previewing) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/loans/${encodeURIComponent(previewing)}/repair-schedule`, { dry_run: false });
      setPreviewing(null);
      setPreview(null);
      if (onRepaired) await onRepaired();
    } catch (err) {
      setError(err.userMessage || 'Could not repair the schedule');
    } finally {
      setBusy(false);
    }
  };

  const current = loans.find(l => l.loan_id === previewing);

  return (
    <Modal className="max-w-4xl" onClose={busy ? undefined : onClose}>
      <ModalHeader>
        <div className="pr-8">
          <ModalTitle>Review &amp; repair loan schedules</ModalTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            These schedules were saved before payments were dated on calendar months (the old 30-day steps put some
            payments a day or two off, or in the wrong month). Repairing only touches unpaid installments after the
            last paid one; paid and recorded payments stay exactly as they are.
          </p>
        </div>
        <ModalClose onClick={onClose} disabled={busy} />
      </ModalHeader>

      <ModalContent className="max-h-[60vh] space-y-4 overflow-y-auto">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</div>
        )}

        {loans.length === 0 && (
          <p className="text-sm text-slate-700" data-testid="repair-all-clear">
            All loan schedules are on calendar months. Nothing to repair.
          </p>
        )}

        {!preview && loans.map(loan => (
          <div key={loan.loan_id} className="space-y-3 rounded-md border p-4" data-testid={`audit-loan-${loan.loan_id}`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{loan.loan_name}</span>
                  <span className="text-sm text-muted-foreground">{loan.lender}</span>
                  {!loan.is_active && <Badge variant="secondary">Inactive</Badge>}
                  {loan.statement_impact
                    ? <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-900">Affects the statements</Badge>
                    : <Badge variant="outline">Day of month only</Badge>}
                </div>
                <p className="text-sm text-slate-700">{loan.summary}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={busy || loan.proposed_action === 'fix_loan_terms'}
                onClick={() => runPreview(loan.loan_id)}
              >
                Preview repair
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(loan.issues || []).map(code => (
                <span key={code} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
                  {issueLabel(code)}
                </span>
              ))}
            </div>
            {(loan.examples || []).length > 0 && (
              <ul className="space-y-0.5 text-xs text-slate-600">
                {loan.examples.map(ex => <li key={`${ex.payment_number}-${ex.issue}`}>{describeAuditExample(ex)}</li>)}
              </ul>
            )}
            <p className="text-xs text-slate-500">Repair: {ACTION_TEXT[loan.proposed_action] || loan.proposed_action}</p>
          </div>
        ))}

        {preview && (
          <div className="space-y-3" data-testid="repair-preview">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{current?.loan_name || preview.loan_name}</span>
              <Badge variant="outline">Preview - nothing saved yet</Badge>
            </div>
            <ScheduleChangePreview preview={preview} />
          </div>
        )}
      </ModalContent>

      <ModalFooter>
        {preview ? (
          <>
            <Button type="button" variant="outline" disabled={busy} onClick={() => { setPreview(null); setPreviewing(null); }}>
              Back to the list
            </Button>
            <Button type="button" disabled={busy || preview.action === 'none'} onClick={runRepair}>
              {busy ? 'Repairing...' : 'Repair this schedule'}
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Close</Button>
        )}
      </ModalFooter>
    </Modal>
  );
};

export default ScheduleRepairModal;
