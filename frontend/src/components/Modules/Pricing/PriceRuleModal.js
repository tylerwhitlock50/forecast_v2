import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Field, inputClass, selectClass } from './PricingBits';
import {
  emptyPriceForm,
  formToPrice,
  formatMoney,
  percentToFraction,
  priceToForm,
  ruleIsActive,
  validatePriceForm,
} from './pricingUtils';
import { errorMessage } from '../DataImport/importSteps';

const whoFor = (form) => (form.customer_id ? 'customer' : form.customer_type ? 'type' : 'all');
const whatFor = (form) => (form.unit_id ? 'product' : form.unit_type ? 'type' : form.method === 'fixed' ? 'product' : 'all');

/**
 * Add or edit one price-list entry: a fixed price for a product or a product
 * type, or a discount off list price for one product, a product type or all
 * products, for everyone, a customer type or one customer. An existing
 * entry can be deleted from here (`onDelete(rule)` confirms, deletes and
 * resolves true when it did).
 */
const PriceRuleModal = ({ open, rule, defaults, onClose, onSave, onDelete = null, customers, products, customerTypes, productTypes = [], scenario }) => {
  const [form, setForm] = useState(emptyPriceForm());
  const [who, setWho] = useState('all');
  const [what, setWhat] = useState('product');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [serverError, setServerError] = useState(null);

  useEffect(() => {
    if (!open) return;
    const next = rule ? priceToForm(rule) : emptyPriceForm(defaults || {});
    setForm(next);
    setWho(whoFor(next));
    setWhat(whatFor(next));
    setErrors({});
    setServerError(null);
    setSaving(false);
    setDeleting(false);
  }, [open, rule, defaults]);

  if (!open) return null;

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const product = what === 'product' ? products.find((p) => p.unit_id === form.unit_id) : null;
  const typeProducts = what === 'type' && form.unit_type
    ? products.filter((p) => String(p.unit_type || '').trim().toLowerCase() === form.unit_type.trim().toLowerCase())
    : [];
  const base = Number(product?.base_price) || 0;
  const discount = percentToFraction(form.discountPct);

  const chooseMethod = (value) => {
    set('method', value);
    // a fixed price needs a product or a product type
    if (value === 'fixed' && what === 'all') setWhat('product');
  };

  const chooseWhat = (value) => {
    setWhat(value);
    setForm((prev) => ({
      ...prev,
      unit_id: value === 'product' ? prev.unit_id : '',
      unit_type: value === 'type' ? (prev.unit_type || productTypes[0] || '') : '',
    }));
  };

  const chooseWho = (value) => {
    setWho(value);
    setForm((prev) => ({
      ...prev,
      customer_id: value === 'customer' ? prev.customer_id : '',
      customer_type: value === 'type' ? (prev.customer_type || customerTypes[0] || '') : '',
    }));
  };

  const busy = saving || deleting;
  const switchedOff = Boolean(rule) && !ruleIsActive(rule);

  const remove = async () => {
    if (!rule || !onDelete) return;
    setDeleting(true);
    setServerError(null);
    try {
      const deleted = await onDelete(rule);
      if (deleted) onClose();
      else setDeleting(false);
    } catch (err) {
      setServerError(errorMessage(err, 'Could not delete the price.'));
      setDeleting(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    const found = validatePriceForm(form);
    if (what === 'product' && !form.unit_id) found.unit_id = form.method === 'fixed' ? 'Choose a product.' : 'Choose a product, or pick “All products”.';
    if (what === 'type' && !form.unit_type) found.unit_type = 'Choose a product type.';
    if (who === 'type' && !form.customer_type) found.customer_type = 'Choose a customer type.';
    if (who === 'customer' && !form.customer_id) found.customer_id = 'Choose a customer.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    setServerError(null);
    try {
      await onSave(formToPrice(form, scenario?.id || null), rule);
      onClose();
    } catch (err) {
      setServerError(errorMessage(err, 'Could not save the price.'));
      setSaving(false);
    }
  };

  return (
    <Modal className="max-w-xl" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form onSubmit={submit} noValidate>
        <ModalHeader>
          <div>
            <ModalTitle>{rule ? 'Edit price' : 'Add a price'}</ModalTitle>
            <p className="mt-1 text-sm text-gray-500">Used when a sales row has no price, and by “Apply prices to forecast”.</p>
          </div>
        </ModalHeader>
        <ModalContent className="space-y-5">
          {switchedOff && (
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700" data-testid="price-switched-off">
              This price is switched off, so nothing uses it. Tick <span className="font-medium">Active</span> below to use it again, or delete it.
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Price type">
            {[
              { value: 'fixed', label: 'Fixed price', help: 'A set price per unit for one product or every product of a type.' },
              { value: 'discount_from_base', label: 'Discount off list price', help: 'A % off each product’s list price; can cover a product type or all products.' },
            ].map((m) => (
              <label key={m.value} className={`cursor-pointer rounded-md border p-3 text-sm ${form.method === m.value ? 'border-orange-500 bg-orange-50 ring-1 ring-orange-500' : 'border-gray-200 hover:border-gray-300'}`}>
                <input type="radio" name="price-method" value={m.value} checked={form.method === m.value} onChange={() => chooseMethod(m.value)} className="sr-only" />
                <div className="font-medium text-gray-900">{m.label}</div>
                <div className="mt-0.5 text-xs text-gray-600">{m.help}</div>
              </label>
            ))}
          </div>

          <div>
            <div className="mb-1.5 text-sm font-medium text-gray-800">Which products</div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Which products">
              {[
                { value: 'product', label: 'One product' },
                { value: 'type', label: 'A product type' },
                { value: 'all', label: 'All products', disabled: form.method === 'fixed' },
              ].map((o) => (
                <label key={o.value} title={o.disabled ? 'A fixed price is for one product or a product type' : ''} className={`rounded-md border px-3 py-1.5 text-sm ${o.disabled ? 'cursor-not-allowed border-gray-100 text-gray-300' : 'cursor-pointer'} ${what === o.value ? 'border-orange-500 bg-orange-50 text-orange-900' : o.disabled ? '' : 'border-gray-200 text-gray-700 hover:border-gray-300'}`}>
                  <input type="radio" name="price-what" value={o.value} checked={what === o.value} disabled={o.disabled} onChange={() => chooseWhat(o.value)} className="sr-only" />
                  {o.label}
                </label>
              ))}
            </div>
            {what === 'product' && (
              <Field className="mt-2" htmlFor="price-product" error={errors.unit_id} help={product ? `List price ${base ? formatMoney(base) : 'not set'}` : null}>
                <select id="price-product" aria-label="Product" className={selectClass} value={form.unit_id} onChange={(e) => set('unit_id', e.target.value)}>
                  <option value="">Choose a product…</option>
                  {products.map((p) => <option key={p.unit_id} value={p.unit_id}>{p.unit_name || p.unit_id} ({p.unit_id})</option>)}
                </select>
              </Field>
            )}
            {what === 'type' && (
              <Field className="mt-2" htmlFor="price-ptype" error={errors.unit_type}
                help={form.unit_type ? `${typeProducts.length} product${typeProducts.length === 1 ? '' : 's'} of this type. A price set for one product beats this.` : null}>
                <select id="price-ptype" aria-label="Product type" className={selectClass} value={form.unit_type} onChange={(e) => set('unit_type', e.target.value)}>
                  <option value="">Choose a product type…</option>
                  {productTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                  {form.unit_type && !productTypes.includes(form.unit_type) && <option value={form.unit_type}>{form.unit_type}</option>}
                </select>
              </Field>
            )}
            {what === 'all' && <p className="mt-2 text-xs text-gray-500">Every product. A price for a product type or one product beats this.</p>}
          </div>

          <div>
            <div className="mb-1.5 text-sm font-medium text-gray-800">Who pays this price</div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Who pays this price">
              {[
                { value: 'all', label: 'All customers' },
                { value: 'type', label: 'A customer type' },
                { value: 'customer', label: 'One customer' },
              ].map((o) => (
                <label key={o.value} className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm ${who === o.value ? 'border-orange-500 bg-orange-50 text-orange-900' : 'border-gray-200 text-gray-700 hover:border-gray-300'}`}>
                  <input type="radio" name="price-who" value={o.value} checked={who === o.value} onChange={() => chooseWho(o.value)} className="sr-only" />
                  {o.label}
                </label>
              ))}
            </div>
            {who === 'type' && (
              <Field className="mt-2" htmlFor="price-ctype" error={errors.customer_type}>
                <select id="price-ctype" aria-label="Customer type" className={selectClass} value={form.customer_type} onChange={(e) => set('customer_type', e.target.value)}>
                  <option value="">Choose a customer type…</option>
                  {customerTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                  {form.customer_type && !customerTypes.includes(form.customer_type) && <option value={form.customer_type}>{form.customer_type}</option>}
                </select>
              </Field>
            )}
            {who === 'customer' && (
              <Field className="mt-2" htmlFor="price-customer" error={errors.customer_id}>
                <select id="price-customer" aria-label="Customer" className={selectClass} value={form.customer_id} onChange={(e) => set('customer_id', e.target.value)}>
                  <option value="">Choose a customer…</option>
                  {customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.customer_name || c.customer_id} ({c.customer_id}){c.customer_type ? ` · ${c.customer_type}` : ''}</option>)}
                </select>
              </Field>
            )}
          </div>

          {form.method === 'fixed' ? (
            <Field label="Price per unit" htmlFor="price-amount" error={errors.unit_price}
              help={base && form.unit_price !== '' && Number(form.unit_price) > 0 ? `${(100 - (Number(form.unit_price) / base) * 100).toFixed(1)}% off list price` : 'Include excise tax if your price includes it.'}>
              <div className="relative">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                <input id="price-amount" type="number" step="0.01" min="0" className={`${inputClass} pl-6 text-right tabular-nums`} value={form.unit_price} onChange={(e) => set('unit_price', e.target.value)} />
              </div>
            </Field>
          ) : (
            <Field label="Discount off list price" htmlFor="price-discount" error={errors.discountPct}
              help={discount !== null && base ? `${product?.unit_name || 'This product'}: ${formatMoney(base)} → ${formatMoney(base * (1 - discount))}`
                : discount !== null && typeProducts.length && Number(typeProducts[0].base_price) > 0
                  ? `For example ${typeProducts[0].unit_name || typeProducts[0].unit_id}: ${formatMoney(typeProducts[0].base_price)} → ${formatMoney(Number(typeProducts[0].base_price) * (1 - discount))}`
                  : 'Products without a list price are skipped by this rule.'}>
              <div className="relative">
                <input id="price-discount" type="number" step="0.01" min="0" max="99.99" className={`${inputClass} pr-7 text-right tabular-nums`} value={form.discountPct} onChange={(e) => set('discountPct', e.target.value)} placeholder="40" />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
              </div>
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="From month" htmlFor="price-start" error={errors.start_period} help="Optional">
              <input id="price-start" type="month" className={inputClass} value={form.start_period} onChange={(e) => set('start_period', e.target.value)} />
            </Field>
            <Field label="To month" htmlFor="price-end" error={errors.end_period} help="Optional">
              <input id="price-end" type="month" className={inputClass} value={form.end_period} onChange={(e) => set('end_period', e.target.value)} />
            </Field>
            <div className="space-y-2 pt-7">
              <label className={`flex items-start gap-2 text-sm ${scenario ? 'text-gray-700' : 'text-gray-400'}`}>
                <input type="checkbox" checked={form.scenarioOnly} disabled={!scenario} onChange={(e) => set('scenarioOnly', e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
                <span>Only in this scenario{scenario ? <span className="block text-xs text-gray-500">{scenario.name}</span> : null}</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
                Active
              </label>
            </div>
          </div>

          <Field label="Notes" htmlFor="price-notes">
            <input id="price-notes" className={inputClass} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Optional" />
          </Field>

          {serverError && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{serverError}</div>}
        </ModalContent>
        <ModalFooter className="sticky bottom-0 bg-white">
          {rule && onDelete && (
            <Button
              type="button"
              variant="outline"
              onClick={remove}
              disabled={busy}
              className="mr-auto border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              {deleting ? 'Deleting…' : 'Delete price'}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy} className="bg-orange-600 text-white hover:bg-orange-700">
            {saving ? 'Saving…' : rule ? 'Save changes' : 'Add price'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
};

export default PriceRuleModal;
