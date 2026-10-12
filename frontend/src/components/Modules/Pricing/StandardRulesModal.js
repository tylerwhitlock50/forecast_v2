import React, { useEffect, useState } from 'react';
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '../../ui/modal';
import { Button } from '../../ui/button';
import { inputClass, selectClass } from './PricingBits';
import { DEDUCTION_TYPE_MAP, METHOD_MAP, percentToFraction, standardRules } from './pricingUtils';
import { errorMessage } from '../DataImport/importSteps';

/**
 * Quick start: the usual terms, chargebacks and excise (FET) rules, each
 * editable before they are created in one request.
 */
const StandardRulesModal = ({ open, onClose, onCreate, productTypes, existingRules }) => {
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    const existingTypes = new Set((existingRules || []).map((r) => `${r.deduction_type}|${(r.unit_type || '').toLowerCase()}|${r.customer_type || ''}|${r.customer_id || ''}|${r.unit_id || ''}`));
    setRows(standardRules(productTypes).map((r) => {
      const duplicate = existingTypes.has(`${r.deduction_type}|${(r.unit_type || '').toLowerCase()}|||`);
      return { ...r, selected: !duplicate, duplicate };
    }));
    setError(null);
    setSaving(false);
  }, [open, productTypes, existingRules]);

  if (!open) return null;

  const update = (key, field, value) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const chosen = rows.filter((r) => r.selected);
  const invalid = chosen.some((r) => {
    const f = percentToFraction(r.ratePct);
    return f === null || f < 0 || f >= 1 || (r.deduction_type === 'excise_tax' && !String(r.unit_type || '').trim());
  });

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      await onCreate(chosen.map((r) => ({
        deduction_type: r.deduction_type,
        name: r.deduction_type === 'excise_tax' ? `FET – ${String(r.unit_type || '').trim()}` : r.name,
        method: r.method,
        rate: percentToFraction(r.ratePct),
        unit_type: r.unit_type ? String(r.unit_type).trim() : null,
        forecast_id: null,
        is_active: 1,
      })));
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not create the rules.'));
      setSaving(false);
    }
  };

  return (
    <Modal className="max-w-2xl" onClick={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <ModalHeader>
        <div>
          <ModalTitle>Add standard rules</ModalTitle>
          <p className="mt-1 text-sm text-gray-500">Common starting points. Adjust the rates, untick what you don't need, and refine by customer later.</p>
        </div>
      </ModalHeader>
      <ModalContent className="space-y-3">
        {rows.map((r) => (
          <div key={r.key} className={`rounded-md border p-3 ${r.selected ? 'border-orange-300 bg-orange-50/40' : 'border-gray-200'}`}>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="checkbox"
                checked={r.selected}
                onChange={(e) => update(r.key, 'selected', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                aria-label={`Include ${DEDUCTION_TYPE_MAP[r.deduction_type].label}`}
              />
              <div className="min-w-[180px] flex-1">
                <div className="text-sm font-medium text-gray-900">{DEDUCTION_TYPE_MAP[r.deduction_type].label}</div>
                <div className="text-xs text-gray-500">{METHOD_MAP[r.method].label}</div>
              </div>
              {r.deduction_type === 'excise_tax' && (
                <div className="w-36">
                  <label className="sr-only" htmlFor={`std-type-${r.key}`}>Product type</label>
                  {productTypes.length > 0 ? (
                    <select id={`std-type-${r.key}`} className={selectClass} value={r.unit_type || ''} onChange={(e) => update(r.key, 'unit_type', e.target.value)} disabled={!r.selected}>
                      {!productTypes.includes(r.unit_type) && <option value={r.unit_type}>{r.unit_type}</option>}
                      {productTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  ) : (
                    <input id={`std-type-${r.key}`} className={inputClass} value={r.unit_type || ''} onChange={(e) => update(r.key, 'unit_type', e.target.value)} disabled={!r.selected} />
                  )}
                </div>
              )}
              <div className="relative w-24">
                <label className="sr-only" htmlFor={`std-rate-${r.key}`}>Rate</label>
                <input
                  id={`std-rate-${r.key}`}
                  type="number"
                  step="0.01"
                  min="0"
                  className={`${inputClass} pr-6 text-right tabular-nums`}
                  value={r.ratePct}
                  onChange={(e) => update(r.key, 'ratePct', e.target.value)}
                  disabled={!r.selected}
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
              </div>
            </div>
            <div className="ml-7 mt-1 text-xs text-gray-500">
              {r.deduction_type === 'excise_tax' ? `Products with type "${r.unit_type}". Tax is already in the price: amount = price × rate ÷ (1 + rate).` : r.note}
              {r.deduction_type === 'excise_tax' && r.typeFound === false && productTypes.length > 0 && (
                <span className="ml-1 text-amber-700">No products have this type yet; pick one of your product types.</span>
              )}
              {r.duplicate && <span className="ml-1 text-amber-700">A rule like this already exists.</span>}
            </div>
          </div>
        ))}
        <p className="text-xs text-gray-500">All of these are company-wide (every scenario). Exempt a customer or customer type later with a 0% rule for them.</p>
        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</div>}
      </ModalContent>
      <ModalFooter className="sticky bottom-0 bg-white">
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={create} disabled={saving || chosen.length === 0 || invalid} className="bg-orange-600 text-white hover:bg-orange-700">
          {saving ? 'Adding…' : `Add ${chosen.length} rule${chosen.length === 1 ? '' : 's'}`}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default StandardRulesModal;
