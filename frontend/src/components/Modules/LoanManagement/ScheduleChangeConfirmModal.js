import React from 'react';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import { Button } from '../../ui/button';
import ScheduleChangePreview from './ScheduleChangePreview';

/**
 * Shown before saving a loan edit that rebuilds the payment schedule: what
 * stays (paid history), what is replaced and the new payoff, with a confirm.
 */
const ScheduleChangeConfirmModal = ({ loanName, preview, saving = false, onConfirm, onBack }) => (
  <Modal className="max-w-3xl" onClose={saving ? undefined : onBack}>
    <ModalHeader>
      <div className="pr-8">
        <ModalTitle>Rebuild the payment schedule?</ModalTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          {loanName ? `${loanName}: ` : ''}the change to the loan terms recalculates the unpaid installments.
          Paid and recorded payments are never changed.
        </p>
      </div>
      <ModalClose onClick={onBack} disabled={saving} />
    </ModalHeader>
    <ModalContent className="max-h-[60vh] overflow-y-auto">
      <ScheduleChangePreview preview={preview} />
    </ModalContent>
    <ModalFooter>
      <Button type="button" variant="outline" onClick={onBack} disabled={saving}>
        Back to edit
      </Button>
      <Button type="button" onClick={onConfirm} disabled={saving}>
        {saving ? 'Saving...' : 'Save and rebuild schedule'}
      </Button>
    </ModalFooter>
  </Modal>
);

export default ScheduleChangeConfirmModal;
