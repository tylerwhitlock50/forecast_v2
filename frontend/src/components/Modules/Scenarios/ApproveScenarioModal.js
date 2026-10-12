import React, { useEffect, useState } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';
import { scenarioErrorMessage } from './scenarioErrors';
import { LockIcon, rememberName, rememberedName } from './governance';
import { formatPeriod } from '../ReportingAnalysis/utils/formatters';

/**
 * Approve & lock a scenario as a baseline.
 *
 * Props:
 *  - open, scenario, onClose
 *  - onSubmit: ({ approved_by, note }) => Promise  (rejects with the API error)
 */
const ApproveScenarioModal = ({ open, scenario, onClose, onSubmit }) => {
  const [approvedBy, setApprovedBy] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [nameError, setNameError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setApprovedBy(rememberedName());
      setNote('');
      setError('');
      setNameError('');
      setSubmitting(false);
    }
  }, [open, scenario]);

  if (!open || !scenario) return null;

  const salesWindow = scenario.start_period
    ? `${formatPeriod(scenario.start_period)} – ${formatPeriod(scenario.end_period)}`
    : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!approvedBy.trim()) {
      setNameError('Enter who is approving this scenario');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ approved_by: approvedBy.trim(), note: note.trim() || undefined });
      rememberName(approvedBy.trim());
      onClose();
    } catch (err) {
      setError(scenarioErrorMessage(err, 'Could not approve the scenario'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal onClose={submitting ? undefined : onClose}>
      <ModalHeader>
        <ModalTitle className="flex items-center gap-2 pr-8">
          <LockIcon className="h-4 w-4 text-emerald-700" />
          Approve &amp; lock “{scenario.name}”
        </ModalTitle>
        <ModalClose onClick={onClose} disabled={submitting} />
      </ModalHeader>
      <form onSubmit={handleSubmit}>
        <ModalContent className="space-y-4">
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <p className="font-medium">What approving does</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>
                Saves the approved numbers{salesWindow ? <> for <span className="whitespace-nowrap">{salesWindow}</span></> : null}:
                a snapshot of the whole database and the Excel workbook.
              </li>
              <li>
                Locks this scenario: its sales, prices, deduction rules and its own payroll, expenses, capex and
                assumptions can no longer be changed, renamed or deleted.
              </li>
              <li>
                To change it later, branch it into a new draft, or unlock it with a reason (kept in the history).
              </li>
            </ul>
          </div>
          <p className="text-xs text-gray-600">
            Company-wide data (BOMs, routings, rates, company-wide prices, payroll and expenses) stays editable and can
            still move this scenario&apos;s numbers; the Scenarios page flags any difference from the approved totals.
          </p>
          <div className="space-y-2">
            <Label htmlFor="approve-by">Approved by *</Label>
            <Input
              id="approve-by"
              value={approvedBy}
              autoFocus
              onChange={(e) => { setApprovedBy(e.target.value); if (nameError) setNameError(''); }}
              placeholder="e.g. Dana Lee, CFO"
              aria-invalid={nameError ? 'true' : undefined}
              aria-describedby={nameError ? 'approve-by-error' : undefined}
              className={nameError ? 'border-red-500 focus-visible:ring-red-500' : ''}
            />
            {nameError && <p id="approve-by-error" role="alert" className="text-sm text-red-600">{nameError}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="approve-note">Note</Label>
            <Textarea
              id="approve-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Approved by the board on Oct 12"
            />
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </ModalContent>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" disabled={submitting} className="bg-emerald-700 text-white hover:bg-emerald-800">
            {submitting ? 'Approving… (saving snapshot and workbook)' : 'Approve & lock'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
};

export default ApproveScenarioModal;
