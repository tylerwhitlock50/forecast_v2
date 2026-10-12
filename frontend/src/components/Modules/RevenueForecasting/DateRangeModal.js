import React, { useEffect, useMemo, useState } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Label } from '../../ui/label';
import MonthPicker from './MonthPicker';
import { describeWindow, monthsBetween, yearsInWindow } from './revenueData';

/** Pick the first and last month to show. currentRange / onApply use { start: 'YYYY-MM', end: 'YYYY-MM' }. */
const DateRangeModal = ({ isOpen, onClose, onApply, currentRange, scenarioWindow }) => {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const base = currentRange || scenarioWindow;
    setStart(base?.start || '');
    setEnd(base?.end || '');
  }, [isOpen, currentRange, scenarioWindow]);

  const years = useMemo(() => {
    const ys = yearsInWindow(scenarioWindow || currentRange || {}).map(Number);
    const first = ys.length ? Math.min(...ys) : new Date().getFullYear();
    const last = ys.length ? Math.max(...ys) : first;
    const out = [];
    for (let y = first - 2; y <= last + 3; y += 1) out.push(String(y));
    return out;
  }, [scenarioWindow, currentRange]);

  const valid = monthsBetween(start, end).length > 0;

  if (!isOpen) return null;

  return (
    <Modal onClick={(e) => e.target === e.currentTarget && onClose()}>
      <ModalHeader>
        <ModalTitle>Choose months to show</ModalTitle>
        <ModalClose onClick={onClose} aria-label="Close" />
      </ModalHeader>
      <ModalContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="range-start">From</Label>
            <MonthPicker id="range-start" label="From" value={start} onChange={setStart} years={years} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="range-end">To</Label>
            <MonthPicker id="range-end" label="To" value={end} onChange={setEnd} years={years} />
          </div>
        </div>
        <p className={`text-sm ${valid ? 'text-gray-600' : 'text-red-700'}`}>
          {valid ? describeWindow({ start, end }) : 'The last month must be on or after the first month.'}
        </p>
      </ModalContent>
      <ModalFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button
          onClick={() => { onApply({ start, end }); onClose(); }}
          disabled={!valid}
          className="bg-orange-600 text-white hover:bg-orange-700"
        >
          Show these months
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default DateRangeModal;
