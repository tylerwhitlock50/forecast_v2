import React, { useEffect, useState } from 'react';
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Field, inputClass, selectClass } from './PricingBits';
import {
  DEDUCTION_TYPES,
  DEDUCTION_TYPE_MAP,
  METHODS,
  embeddedTax,
  emptyRuleForm,
  formToRule,
  formatMoney,
  percentToFraction,
  ruleToForm,
  validateRuleForm,
} from './pricingUtils';
import { errorMessage } from '../DataImport/importSteps';

/**
 * Add or edit one discount / allowance / excise / commission rule. Rates are
 * typed in percent and sent as fractions.
 */
const DeductionRuleModal = ({ open, rule, defaults, onClose, onSave, customers, products, customerTypes, productTypes, scenario }) => {
  const [form, setForm] = useState(emptyRuleForm());
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(rule ? ruleToForm(rule) : emptyRuleForm(defaults || {}));
    setErrors({});
    setServerError(null);
    setSaving(false);
  }, [open, rule, defaults]);

  if (!open) return null;

  const set = (key, value) => setForm((prev) => {
    const next = { ...prev, [key]: value };
    // Excise tax is almost always included in the price; pick that method when switching to it on a new rule.
    if (key === 'deduction_type' && !prev.rule_id) {
      if (value === 'excise_tax' && prev.method === 'percent_of_gross') next.method = 'embedded_tax';
      if (value !== 'excise_tax' && prev.method === 'embedded_tax') next.method = 'percent_of_gross';
    }
    return next;
  });

  const typeInfo = DEDUCTION_TYPE_MAP[form.deduction_type];
  const stacks = Boolean(typeInfo?.stacks);
  const perUnit = form.method === 'per_unit';
  const fraction = percentToFraction(form.ratePct);
  const example = (() => {
    if (perUnit) {
      const amt = Number(form.amount_per_unit);
      return Number.isFinite(amt) && String(form.amount_per_unit).trim() !== '' ? `10 units → ${formatMoney(amt * 10)}` : null;
    }
    if (fraction === null) return null;
    if (form.method === 'embedded_tax') return `On a $1,110.00 invoice → ${formatMoney(embeddedTax(1110, fraction))}`;
    if (form.method === 'percent_of_net') return `On $1,000.00 of net sales → ${formatMoney(1000 * fraction)}`;
    return `On a $1,000.00 invoice → ${formatMoney(1000 * fraction)}`;
  })();

  const submit = async (event) => {
    event.preventDefault();
    const found = validateRuleForm(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    const payload = formToRule(form, scenario?.id || null);
    // On edit, leave the name out unless it changed so the server can refresh an automatic name.
    if (rule && (form.name || '') === (rule.name || '')) delete payload.name;
    setSaving(true);
    setServerError(null);
    try {
      await onSave(payload, rule);
      onClose();
    } catch (err) {
      setServerError(errorMessage(err, 'Could not save the rule.'));
      setSaving(false);
    }
  };

  return (
    <Modal className="max-w-2xl" onClick={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <form onSubmit={submit} noValidate>
        <ModalHeader>
          <div>
            <ModalTitle>{rule ? 'Edit rule' : 'Add a rule'}</ModalTitle>
            <p className="mt-1 text-sm text-gray-500">The most specific matching rule of each kind is applied to every sales row. Other allowances: one rule per program name, and the programs add up.</p>
          </div>
        </ModalHeader>
        <ModalContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Kind" htmlFor="ded-type" help={typeInfo?.description} error={errors.deduction_type}>
              <select id="ded-type" className={selectClass} value={form.deduction_type} onChange={(e) => set('deduction_type', e.target.value)}>
                {DEDUCTION_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
            </Field>
            {stacks ? (
              <Field label="Program name" htmlFor="ded-name" help="Each program (co-op, freight, rebate…) applies on its own and they add up. Rules with the same name are one program: the most specific applies.">
                <input id="ded-name" className={inputClass} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Co-op advertising" />
              </Field>
            ) : (
              <Field label="Name" htmlFor="ded-name" help="Optional. Leave blank for an automatic name.">
                <input id="ded-name" className={inputClass} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. 2% 10 net 30" />
              </Field>
            )}
          </div>

          <div>
            <div className="mb-1.5 text-sm font-medium text-gray-800">How it is calculated</div>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Calculation method">
              {METHODS.map((m) => (
                <label
                  key={m.value}
                  className={`cursor-pointer rounded-md border p-3 text-sm transition ${form.method === m.value ? 'border-orange-500 bg-orange-50 ring-1 ring-orange-500' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  <input type="radio" name="ded-method" value={m.value} checked={form.method === m.value} onChange={() => set('method', m.value)} className="sr-only" />
                  <div className="font-medium text-gray-900">{m.label}</div>
                  <div className="mt-0.5 text-xs text-gray-600">{m.help}</div>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {perUnit ? (
              <Field label="Dollars per unit" htmlFor="ded-amount" error={errors.amount_per_unit} help={example}>
                <div className="relative">
                  <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                  <input id="ded-amount" type="number" step="0.01" min="0" className={`${inputClass} pl-6 text-right tabular-nums`} value={form.amount_per_unit} onChange={(e) => set('amount_per_unit', e.target.value)} />
                </div>
              </Field>
            ) : (
              <Field label="Rate" htmlFor="ded-rate" error={errors.ratePct} help={example || 'In percent. Use 0 to exempt (for example Government from excise tax).'}>
                <div className="relative">
                  <input id="ded-rate" type="number" step="0.01" min="0" max="99.99" className={`${inputClass} pr-7 text-right tabular-nums`} value={form.ratePct} onChange={(e) => set('ratePct', e.target.value)} placeholder="2" />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
                </div>
              </Field>
            )}
            <div className="flex items-end pb-6">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
                Active (switch off to keep the rule without applying it)
              </label>
            </div>
          </div>

          <fieldset className="rounded-md border border-gray-200 p-4">
            <legend className="px-1 text-sm font-medium text-gray-800">Applies to</legend>
            <p className="mb-3 text-xs text-gray-500">
              Leave everything on “Any” to apply to all sales. A customer rule beats a customer-type rule, which beats a product rule, which beats a product-type rule
              {stacks ? ' (for other allowances, among rules with the same program name).' : '.'}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Customer" htmlFor="ded-customer">
                <select id="ded-customer" className={selectClass} value={form.customer_id} onChange={(e) => set('customer_id', e.target.value)}>
                  <option value="">Any customer</option>
                  {customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.customer_name || c.customer_id} ({c.customer_id})</option>)}
                </select>
              </Field>
              <Field label="Customer type" htmlFor="ded-ctype">
                <select id="ded-ctype" className={selectClass} value={form.customer_type} onChange={(e) => set('customer_type', e.target.value)}>
                  <option value="">Any customer type</option>
                  {customerTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                  {form.customer_type && !customerTypes.includes(form.customer_type) && <option value={form.customer_type}>{form.customer_type}</option>}
                </select>
              </Field>
              <Field label="Product" htmlFor="ded-product">
                <select id="ded-product" className={selectClass} value={form.unit_id} onChange={(e) => set('unit_id', e.target.value)}>
                  <option value="">Any product</option>
                  {products.map((p) => <option key={p.unit_id} value={p.unit_id}>{p.unit_name || p.unit_id} ({p.unit_id})</option>)}
                </select>
              </Field>
              <Field label="Product type" htmlFor="ded-ptype">
                <select id="ded-ptype" className={selectClass} value={form.unit_type} onChange={(e) => set('unit_type', e.target.value)}>
                  <option value="">Any product type</option>
                  {productTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                  {form.unit_type && !productTypes.includes(form.unit_type) && <option value={form.unit_type}>{form.unit_type}</option>}
                </select>
              </Field>
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="From month" htmlFor="ded-start" error={errors.start_period} help="Optional">
              <input id="ded-start" type="month" className={inputClass} value={form.start_period} onChange={(e) => set('start_period', e.target.value)} />
            </Field>
            <Field label="To month" htmlFor="ded-end" error={errors.end_period} help="Optional">
              <input id="ded-end" type="month" className={inputClass} value={form.end_period} onChange={(e) => set('end_period', e.target.value)} />
            </Field>
            <div className="flex items-start pt-7">
              <label className={`flex items-start gap-2 text-sm ${scenario ? 'text-gray-700' : 'text-gray-400'}`} title={scenario ? '' : 'No active scenario'}>
                <input
                  type="checkbox"
                  checked={form.scenarioOnly}
                  disabled={!scenario}
                  onChange={(e) => set('scenarioOnly', e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                />
                <span>Only in this scenario{scenario ? <span className="block text-xs text-gray-500">{scenario.name}</span> : null}</span>
              </label>
            </div>
          </div>

          <Field label="Notes" htmlFor="ded-notes">
            <input id="ded-notes" className={inputClass} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Optional" />
          </Field>

          {serverError && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{serverError}</div>}
        </ModalContent>
        <ModalFooter className="sticky bottom-0 bg-white">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" disabled={saving} className="bg-orange-600 text-white hover:bg-orange-700">
            {saving ? 'Saving…' : rule ? 'Save changes' : 'Add rule'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
};

export default DeductionRuleModal;
