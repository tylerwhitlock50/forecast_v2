import React, { useEffect, useState } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';
import { scenarioErrorMessage } from './scenarioErrors';
import { approvalLine, rememberName, rememberedName } from './governance';

/**
 * Unlock an approved scenario (a reason is required and kept in its history).
 *
 * Props:
 *  - open, scenario, onClose
 *  - onSubmit: ({ reason, actor }) => Promise  (rejects with the API error)
 *  - onBranchInstead: optional () => void, offered as the alternative
 */
const UnlockScenarioModal = ({ open, scenario, onClose, onSubmit, onBranchInstead }) => {
  const [reason, setReason] = useState('');
  const [actor, setActor] = useState('');
  const [error, setError] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setActor(rememberedName());
      setError('');
      setReasonError('');
      setSubmitting(false);
    }
  }, [open, scenario]);

  if (!open || !scenario) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!reason.trim()) {
      setReasonError('A reason is required to unlock an approved scenario');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ reason: reason.trim(), actor: actor.trim() || undefined });
      rememberName(actor.trim());
      onClose();
    } catch (err) {
      setError(scenarioErrorMessage(err, 'Could not unlock the scenario'));
    } finally {
      setSubmitting(false);
    }
  };

  const approved = approvalLine(scenario);

  return (
    <Modal onClose={submitting ? undefined : onClose}>
      <ModalHeader>
        <ModalTitle className="pr-8">Unlock “{scenario.name}”?</ModalTitle>
        <ModalClose onClick={onClose} disabled={submitting} />
      </ModalHeader>
      <form onSubmit={handleSubmit}>
        <ModalContent className="space-y-4">
          <p className="text-sm text-gray-700">
            {approved ? `${approved}. ` : ''}Unlocking makes it an editable draft again. The approval, its snapshot and
            workbook stay in the approval history.
          </p>
          {onBranchInstead && (
            <p className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
              Only want to try a change? Branch it instead: the approved version stays as it is.{' '}
              <button
                type="button"
                className="font-medium underline underline-offset-2"
                onClick={() => { onClose(); onBranchInstead(); }}
              >
                Branch “{scenario.name}”
              </button>
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="unlock-reason">Reason *</Label>
            <Textarea
              id="unlock-reason"
              rows={3}
              autoFocus
              value={reason}
              onChange={(e) => { setReason(e.target.value); if (reasonError) setReasonError(''); }}
              placeholder="e.g. Q2 reforecast approved by the CFO"
              aria-invalid={reasonError ? 'true' : undefined}
              aria-describedby={reasonError ? 'unlock-reason-error' : undefined}
              className={reasonError ? 'border-red-500 focus-visible:ring-red-500' : ''}
            />
            {reasonError && <p id="unlock-reason-error" role="alert" className="text-sm text-red-600">{reasonError}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="unlock-actor">Your name</Label>
            <Input id="unlock-actor" value={actor} onChange={(e) => setActor(e.target.value)} placeholder="e.g. Dana Lee" />
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </ModalContent>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" variant="destructive" disabled={submitting}>
            {submitting ? 'Unlocking…' : 'Unlock scenario'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
};

export default UnlockScenarioModal;
