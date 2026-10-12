import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useForecast } from '../../../context/ForecastContext';
import api from '../../../lib/apiClient';
import { Modal, ModalClose, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import MonthPicker from './MonthPicker';
import { formatMoney, formatPrice, formatQty, monthLabel, monthsBetween, NO_TYPE, yearsInWindow } from './revenueData';

const fieldClass = 'h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500';

const parseAmount = (text) => {
  const cleaned = String(text ?? '').replace(/[$,\s]/g, '');
  if (cleaned === '') return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
};

const OPERATIONS = [
  { value: 'replace', label: 'Set these months to this quantity', help: 'Existing quantities and prices for these months are replaced.' },
  { value: 'add', label: 'Add to the existing quantity', help: 'The quantity is added to what is already forecast; the price is updated.' },
];

/**
 * Add (or overwrite) one customer × product line for a run of months in the
 * active scenario. The unit price is looked up from the price list (customer
 * price, then customer-type price, then the product's list price) and can be
 * overridden.
 */
const ForecastLineModal = ({ isOpen, onClose, onSave, defaultWindow }) => {
  const { data, activeScenario, scenarios } = useForecast();
  const scenarioName = activeScenario ? scenarios?.[activeScenario]?.name || activeScenario : null;

  const [customerId, setCustomerId] = useState('');
  const [productId, setProductId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [priceTouched, setPriceTouched] = useState(false);
  const [priceSource, setPriceSource] = useState(null); // { label } | { missing: true } | null
  const [resolving, setResolving] = useState(false);
  const [operation, setOperation] = useState('replace');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setCustomerId('');
    setProductId('');
    setStart(defaultWindow?.start || '');
    setEnd(defaultWindow?.end || '');
    setQuantity('');
    setPrice('');
    setPriceTouched(false);
    setPriceSource(null);
    setOperation('replace');
    setErrors({});
    setSaveError(null);
    setSaving(false);
    // Reset only when the modal opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const customers = useMemo(() => [...(data.customers || [])]
    .sort((a, b) => String(a.customer_name || a.customer_id).localeCompare(String(b.customer_name || b.customer_id))), [data.customers]);
  const products = useMemo(() => [...(data.products || [])]
    .sort((a, b) => String(a.unit_name || a.unit_id).localeCompare(String(b.unit_name || b.unit_id))), [data.products]);

  const months = useMemo(() => monthsBetween(start, end), [start, end]);
  const years = useMemo(() => {
    const base = yearsInWindow(defaultWindow || {}).map(Number);
    const first = base.length ? Math.min(...base) : new Date().getFullYear();
    return [first - 1, first, first + 1, first + 2, first + 3].map(String);
  }, [defaultWindow]);

  // Look the price up whenever the customer, product or first month changes,
  // unless the user typed their own.
  useEffect(() => {
    if (!isOpen || !customerId || !productId || priceTouched) return undefined;
    let cancelled = false;
    setResolving(true);
    const params = new URLSearchParams({ unit_id: productId, customer_id: customerId });
    if (start) params.set('period', start);
    if (activeScenario) params.set('forecast_id', activeScenario);
    api.get(`/pricing/resolve?${params.toString()}`, { suppressErrorToast: true })
      .then((res) => {
        if (cancelled) return;
        const resolved = Number(res?.data?.price);
        if (Number.isFinite(resolved) && resolved > 0) {
          setPrice(String(resolved));
          setPriceSource({ label: res?.data?.source_label || 'Price list' });
        } else {
          setPrice('');
          setPriceSource({ missing: true });
        }
      })
      .catch(() => { if (!cancelled) setPriceSource({ missing: true }); })
      .finally(() => { if (!cancelled) setResolving(false); });
    return () => { cancelled = true; };
  }, [isOpen, customerId, productId, start, activeScenario, priceTouched]);

  const qty = parseAmount(quantity);
  const unitPrice = parseAmount(price);
  const selectedCustomer = customers.find(c => c.customer_id === customerId);

  const validate = () => {
    const next = {};
    if (!customerId) next.customer = 'Choose a customer';
    if (!productId) next.product = 'Choose a product';
    if (!months.length) next.months = 'The last month must be on or after the first month';
    if (!(qty > 0)) next.quantity = 'Enter units per month (more than 0)';
    if (!(unitPrice > 0)) next.price = 'Enter a unit price (more than $0)';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    const records = months.map(period => ({
      unit_id: productId,
      customer_id: customerId,
      period,
      quantity: qty,
      unit_price: unitPrice,
      total_revenue: qty * unitPrice,
      forecast_id: activeScenario,
    }));
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(records, operation);
      onClose();
    } catch (err) {
      setSaveError(err?.response?.data?.detail || err?.userMessage || err?.message || 'The line could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const opInfo = OPERATIONS.find(o => o.value === operation);

  return (
    <Modal onClick={(e) => e.target === e.currentTarget && !saving && onClose()} className="max-w-2xl">
      <form onSubmit={handleSubmit}>
        <ModalHeader>
          <div>
            <ModalTitle>Add forecast line</ModalTitle>
            <p className="mt-0.5 text-sm text-gray-500">
              {scenarioName ? <>Into <span className="font-medium text-gray-700">{scenarioName}</span>, one row per month.</> : 'Choose a scenario first.'}
            </p>
          </div>
          <ModalClose type="button" onClick={onClose} aria-label="Close" />
        </ModalHeader>
        <ModalContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fl-customer">Customer</Label>
              <select
                id="fl-customer"
                className={`${fieldClass} ${errors.customer ? 'border-red-500' : ''}`}
                value={customerId}
                onChange={(e) => { setCustomerId(e.target.value); setPriceTouched(false); }}
              >
                <option value="">Choose a customer…</option>
                {customers.map(c => (
                  <option key={c.customer_id} value={c.customer_id}>
                    {c.customer_name || c.customer_id}{c.customer_type ? ` — ${c.customer_type}` : ''}
                  </option>
                ))}
              </select>
              {errors.customer && <p className="text-xs text-red-600">{errors.customer}</p>}
              {selectedCustomer && !selectedCustomer.customer_type && (
                <p className="text-xs text-amber-700">{NO_TYPE}: customer-type prices and discounts will not apply.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fl-product">Product</Label>
              <select
                id="fl-product"
                className={`${fieldClass} ${errors.product ? 'border-red-500' : ''}`}
                value={productId}
                onChange={(e) => { setProductId(e.target.value); setPriceTouched(false); }}
              >
                <option value="">Choose a product…</option>
                {products.map(p => (
                  <option key={p.unit_id} value={p.unit_id}>{p.unit_name || p.unit_id} ({p.unit_id})</option>
                ))}
              </select>
              {errors.product && <p className="text-xs text-red-600">{errors.product}</p>}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fl-start">First month</Label>
              <MonthPicker id="fl-start" label="First month" value={start} onChange={setStart} years={years} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fl-end">Last month</Label>
              <MonthPicker id="fl-end" label="Last month" value={end} onChange={setEnd} years={years} />
            </div>
            {errors.months && <p className="text-xs text-red-600 md:col-span-2">{errors.months}</p>}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fl-qty">Units per month</Label>
              <Input
                id="fl-qty"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="e.g. 40"
                className={errors.quantity ? 'border-red-500' : ''}
              />
              {errors.quantity && <p className="text-xs text-red-600">{errors.quantity}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fl-price">Unit price</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                <Input
                  id="fl-price"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => { setPrice(e.target.value); setPriceTouched(true); setPriceSource(null); }}
                  placeholder="0.00"
                  className={`pl-7 ${errors.price ? 'border-red-500' : ''}`}
                />
                {resolving && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />}
              </div>
              {errors.price && <p className="text-xs text-red-600">{errors.price}</p>}
              {!errors.price && priceSource?.label && <p className="text-xs text-gray-500">From the price list: {priceSource.label}.</p>}
              {!errors.price && priceSource?.missing && (
                <p className="text-xs text-amber-700">No price list entry or list price for this product. Enter the price.</p>
              )}
            </div>
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-gray-700">If these months already have a forecast</legend>
            <div className="flex flex-wrap gap-2">
              {OPERATIONS.map(o => (
                <label
                  key={o.value}
                  className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm ${operation === o.value ? 'border-orange-500 bg-orange-50 text-orange-900' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}
                >
                  <input type="radio" name="fl-operation" value={o.value} checked={operation === o.value} onChange={() => setOperation(o.value)} className="sr-only" />
                  {o.label}
                </label>
              ))}
            </div>
            {opInfo && <p className="text-xs text-gray-500">{opInfo.help}</p>}
          </fieldset>

          <div className="grid grid-cols-3 gap-3 rounded-lg bg-gray-50 p-4 text-sm">
            <div>
              <div className="text-gray-500">Months</div>
              <div className="font-semibold tabular-nums text-gray-900">
                {months.length}{months.length ? ` (${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])})` : ''}
              </div>
            </div>
            <div>
              <div className="text-gray-500">Units</div>
              <div className="font-semibold tabular-nums text-gray-900">{qty > 0 ? formatQty(qty * months.length) : '—'}</div>
            </div>
            <div>
              <div className="text-gray-500">Gross sales</div>
              <div className="font-semibold tabular-nums text-gray-900">
                {qty > 0 && unitPrice > 0 ? formatMoney(qty * unitPrice * months.length) : '—'}
                {qty > 0 && unitPrice > 0 && <span className="ml-1 text-xs font-normal text-gray-500">at {formatPrice(unitPrice)}</span>}
              </div>
            </div>
          </div>

          {saveError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{String(saveError)}</div>
          )}
        </ModalContent>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" disabled={saving || !activeScenario} className="bg-orange-600 text-white hover:bg-orange-700">
            {saving ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Saving…</> : `Save ${months.length || ''} month${months.length === 1 ? '' : 's'}`}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
};

export default ForecastLineModal;
