import React, { useEffect, useState } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';
import { isDuplicateNameError, scenarioErrorMessage } from './scenarioErrors';

/**
 * Create or edit a scenario's name, description, notes and base flag.
 *
 * Props:
 *  - open: boolean
 *  - scenario: existing scenario object to edit, or null to create
 *  - onClose: () => void
 *  - onSubmit: (values) => Promise  values = { name, description, notes, is_base }
 */
const ScenarioFormModal = ({ open, scenario = null, onClose, onSubmit }) => {
  const [values, setValues] = useState({ name: '', description: '', notes: '', is_base: false });
  const [error, setError] = useState('');
  // A problem with the name itself (blank, or another scenario has it: HTTP 409), shown under the field.
  const [nameError, setNameError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setValues({
        name: scenario?.name || '',
        description: scenario?.description || '',
        notes: scenario?.notes || '',
        is_base: Boolean(scenario?.is_base),
      });
      setError('');
      setNameError('');
      setSubmitting(false);
    }
  }, [open, scenario]);

  if (!open) return null;

  const isEdit = Boolean(scenario?.id);
  const isCurrentBase = isEdit && Boolean(scenario?.is_base);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setNameError('');
    if (!values.name.trim()) {
      setNameError('Name is required');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ ...values, name: values.name.trim() });
      onClose();
    } catch (err) {
      const message = scenarioErrorMessage(err, 'Failed to save scenario');
      if (isDuplicateNameError(err)) setNameError(message);
      else setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <ModalTitle>{isEdit ? `Edit ${scenario.name}` : 'New scenario'}</ModalTitle>
          <ModalClose onClick={onClose} />
        </ModalHeader>
        <form onSubmit={handleSubmit}>
          <ModalContent className="space-y-4">
            {isEdit && (
              <p className="text-xs text-muted-foreground">
                Scenario id <span className="font-mono">{scenario.id}</span>. Renaming does not change the id.
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="scenario-name">Name *</Label>
              <Input
                id="scenario-name"
                value={values.name}
                autoFocus
                onChange={(e) => {
                  const name = e.target.value;
                  setValues(v => ({ ...v, name }));
                  if (nameError) setNameError('');
                }}
                placeholder="e.g. FY27 Plan, Upside +10% price"
                aria-invalid={nameError ? 'true' : undefined}
                aria-describedby={nameError ? 'scenario-name-error' : undefined}
                className={nameError ? 'border-red-500 focus-visible:ring-red-500' : ''}
              />
              {nameError && (
                <p id="scenario-name-error" role="alert" className="text-sm text-red-600">{nameError}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="scenario-description">Description</Label>
              <Input
                id="scenario-description"
                value={values.description}
                onChange={(e) => setValues(v => ({ ...v, description: e.target.value }))}
                placeholder="One line on what this scenario assumes"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="scenario-notes">Notes</Label>
              <Textarea
                id="scenario-notes"
                rows={4}
                value={values.notes}
                onChange={(e) => setValues(v => ({ ...v, notes: e.target.value }))}
                placeholder="Working notes, open questions, sources"
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={values.is_base}
                disabled={isCurrentBase}
                onChange={(e) => setValues(v => ({ ...v, is_base: e.target.checked }))}
              />
              <span>
                <span className="font-medium">Base scenario</span>
                <span className="block text-muted-foreground">
                  {isCurrentBase
                    ? 'This is the base scenario. To change the base, mark another scenario as the base; there is always exactly one.'
                    : 'Compare shows every other scenario as a delta against the base. Only one scenario can be the base.'}
                </span>
              </span>
            </label>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          </ModalContent>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : (isEdit ? 'Save' : 'Create')}</Button>
          </ModalFooter>
        </form>
      </div>
    </Modal>
  );
};

export default ScenarioFormModal;
