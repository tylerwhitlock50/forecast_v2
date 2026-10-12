import React, { useEffect, useState } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Select, SelectOption } from '../../ui/select';
import { Textarea } from '../../ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { isDuplicateNameError, scenarioErrorMessage } from './scenarioErrors';

/**
 * BranchScenarioModal
 * Copies a scenario on the server in one transaction (sales, scenario-specific
 * expenses / payroll / capex, assumptions and notes) with optional
 * price / quantity multipliers and a period-extension length applied to the copy.
 *
 * Props:
 *  - open: boolean
 *  - onClose: () => void
 *  - scenarios: { [id]: { id, name, description } }
 *  - activeScenarioId: string | null
 *  - onSubmit: (sourceId, { name, description }, overrides) => Promise
 */
const BranchScenarioModal = ({ open, onClose, scenarios = {}, activeScenarioId, onSubmit }) => {
  const scenarioList = Object.values(scenarios || {}).filter(
    s => s && s.id && s.id !== 'default'
  );

  const [formData, setFormData] = useState({
    sourceId: activeScenarioId || '',
    name: '',
    description: '',
    priceMultiplier: '1.00',
    quantityMultiplier: '1.00',
    extendPeriods: '0',
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // Reset when opened.
  useEffect(() => {
    if (open) {
      setFormData({
        sourceId: activeScenarioId || (scenarioList[0]?.id ?? ''),
        name: '',
        description: '',
        priceMultiplier: '1.00',
        quantityMultiplier: '1.00',
        extendPeriods: '0',
      });
      setErrors({});
      setSubmitting(false);
    }
    // We intentionally exclude scenarioList (derived each render) from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeScenarioId]);

  if (!open) return null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.sourceId) newErrors.sourceId = 'Source scenario is required';
    if (!formData.name.trim()) newErrors.name = 'Name is required';

    const price = Number(formData.priceMultiplier);
    if (!Number.isFinite(price) || price <= 0) {
      newErrors.priceMultiplier = 'Must be a positive number';
    }

    const qty = Number(formData.quantityMultiplier);
    if (!Number.isFinite(qty) || qty <= 0) {
      newErrors.quantityMultiplier = 'Must be a positive number';
    }

    const extendRaw = formData.extendPeriods;
    const extendNum = Number(extendRaw);
    if (
      extendRaw === '' ||
      !Number.isFinite(extendNum) ||
      extendNum < 0 ||
      Math.floor(extendNum) !== extendNum
    ) {
      newErrors.extendPeriods = 'Must be a non-negative integer';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate() || submitting) return;

    setSubmitting(true);
    try {
      await onSubmit(
        formData.sourceId,
        {
          name: formData.name.trim(),
          description: formData.description.trim(),
        },
        {
          priceMultiplier: Number(formData.priceMultiplier),
          quantityMultiplier: Number(formData.quantityMultiplier),
          extendPeriods: parseInt(formData.extendPeriods, 10) || 0,
        }
      );
      onClose();
    } catch (err) {
      // A duplicate name (HTTP 409) goes under the name field; anything else under the form.
      const message = scenarioErrorMessage(err, 'Failed to branch scenario');
      setErrors(prev => (isDuplicateNameError(err) ? { ...prev, name: message } : { ...prev, _submit: message }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal className="max-w-2xl" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <ModalTitle>Branch Scenario</ModalTitle>
          <ModalClose onClick={onClose} />
        </ModalHeader>

        <form onSubmit={handleSubmit}>
          <ModalContent className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Source & Name</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="sourceId">Source scenario *</Label>
                  <Select
                    id="sourceId"
                    name="sourceId"
                    value={formData.sourceId}
                    onChange={handleChange}
                    className={errors.sourceId ? 'border-red-500' : ''}
                  >
                    <SelectOption value="">-- Select a scenario --</SelectOption>
                    {scenarioList.map(s => (
                      <SelectOption key={s.id} value={s.id}>
                        {s.name} {s.id === activeScenarioId ? '(active)' : ''}
                      </SelectOption>
                    ))}
                  </Select>
                  {errors.sourceId && (
                    <p className="text-sm text-red-500">{errors.sourceId}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="name">New scenario name *</Label>
                  <Input
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    placeholder="e.g., Upside +10% price"
                    className={errors.name ? 'border-red-500' : ''}
                    aria-invalid={errors.name ? 'true' : undefined}
                    aria-describedby={errors.name ? 'branch-name-error' : undefined}
                  />
                  {errors.name && (
                    <p id="branch-name-error" role="alert" className="text-sm text-red-600">{errors.name}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    name="description"
                    value={formData.description}
                    onChange={handleChange}
                    placeholder="Optional notes about this branch"
                    rows={2}
                  />
                </div>
              </CardContent>
            </Card>

            <p className="text-xs text-muted-foreground">
              The copy gets the source's sales lines, its scenario-specific expenses, employees and capex,
              its financial assumptions and notes. Company-wide rows stay shared. The new scenario becomes active.
            </p>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Overrides (optional)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="priceMultiplier">Price multiplier</Label>
                    <Input
                      id="priceMultiplier"
                      name="priceMultiplier"
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.priceMultiplier}
                      onChange={handleChange}
                      placeholder="1.00"
                      className={errors.priceMultiplier ? 'border-red-500' : ''}
                    />
                    <p className="text-xs text-gray-500">e.g., 1.10 for +10%</p>
                    {errors.priceMultiplier && (
                      <p className="text-sm text-red-500">{errors.priceMultiplier}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="quantityMultiplier">Quantity multiplier</Label>
                    <Input
                      id="quantityMultiplier"
                      name="quantityMultiplier"
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.quantityMultiplier}
                      onChange={handleChange}
                      placeholder="1.00"
                      className={errors.quantityMultiplier ? 'border-red-500' : ''}
                    />
                    <p className="text-xs text-gray-500">e.g., 0.90 for -10%</p>
                    {errors.quantityMultiplier && (
                      <p className="text-sm text-red-500">{errors.quantityMultiplier}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="extendPeriods">Extend by N periods</Label>
                    <Input
                      id="extendPeriods"
                      name="extendPeriods"
                      type="number"
                      step="1"
                      min="0"
                      value={formData.extendPeriods}
                      onChange={handleChange}
                      placeholder="0"
                      className={errors.extendPeriods ? 'border-red-500' : ''}
                    />
                    <p className="text-xs text-gray-500">Repeats the last month's lines for N more months</p>
                    {errors.extendPeriods && (
                      <p className="text-sm text-red-500">{errors.extendPeriods}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {errors._submit && (
              <p role="alert" className="text-sm text-red-600">{errors._submit}</p>
            )}
          </ModalContent>

          <ModalFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Branching...' : 'Branch Scenario'}
            </Button>
          </ModalFooter>
        </form>
      </div>
    </Modal>
  );
};

export default BranchScenarioModal;
