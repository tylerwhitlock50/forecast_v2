import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, Loader2 } from 'lucide-react';
import api from '../../../lib/apiClient';
import { Card } from '../../ui/card';
import { inputClass, selectClass } from './PricingBits';
import {
  formatMoney,
  invoiceAmount,
  normalizeSimulation,
  readResolvedPrice,
  resolvePriceQuery,
  ruleLabel,
} from './pricingUtils';
import { errorMessage } from '../DataImport/importSteps';

const unitCount = (quantity) => {
  const q = Number(quantity);
  return Number.isFinite(q) && q > 0 ? q : 1;
};

/** Where the invoice amount came from, under the amount and units boxes. */
const PriceNote = ({ priced, quantity, typed, gross, onUsePrice, hasProduct }) => {
  if (!hasProduct) return <>Choose a product to start from its price-list price.</>;
  if (!priced) return null;
  if (priced.loading) return <>Looking up the price…</>;
  if (priced.error) return <span className="text-amber-700">{priced.error}</span>;
  if (priced.price === null) {
    return <span className="text-amber-700">No price for this combination: no price-list entry and no list price. Type an amount.</span>;
  }
  const qty = unitCount(quantity);
  const amount = invoiceAmount(priced.price, qty);
  const fromList = `${formatMoney(priced.price)}${qty !== 1 ? ` × ${qty.toLocaleString('en-US')} units` : ''}`;
  if (typed && Number(gross) !== Number(amount)) {
    return (
      <>
        You typed this amount. The price list gives {fromList} = {formatMoney(amount)} ({priced.label}).{' '}
        <button type="button" onClick={onUsePrice} className="font-medium text-orange-700 underline hover:text-orange-800">Use it</button>
      </>
    );
  }
  return (
    <>
      <span className="font-medium text-gray-700">{fromList}</span> from the price list: {priced.label}
      {priced.rule?.notes ? <span className="text-gray-400"> · {priced.rule.notes}</span> : null}
    </>
  );
};

/**
 * Worked example: one invoice line through the rules, using the server's
 * own matching (POST /pricing/deductions/simulate), so what you see is what
 * the statements will do. The invoice amount starts from the price the
 * price list gives the chosen product and customer (GET /pricing/resolve)
 * times the units, until the user types an amount of their own.
 */
const DeductionExample = ({ customers, products, customerTypes, productTypes, scenario, rules, refreshKey }) => {
  const [inputs, setInputs] = useState({ gross: '1110', quantity: '1', customer_id: '', customer_type: '', unit_id: '', unit_type: '', period: '' });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [priced, setPriced] = useState(null); // {price, source, label, rule, loading?, error?}
  const [amountTyped, setAmountTyped] = useState(false);
  const seeded = useRef(false);
  const requestId = useRef(0);
  const priceRequest = useRef(0);

  // Start from something meaningful: a rifle-like product and the first customer type.
  useEffect(() => {
    if (seeded.current || (products.length === 0 && customerTypes.length === 0)) return;
    seeded.current = true;
    const rifle = products.find((p) => /rifle/i.test(p.unit_type || '')) || products[0];
    setInputs((prev) => ({
      ...prev,
      unit_id: rifle?.unit_id || '',
      customer_type: customerTypes.find((t) => /dealer/i.test(t)) || customerTypes[0] || '',
      gross: rifle?.base_price ? String(Math.round(Number(rifle.base_price) * 100) / 100) : prev.gross,
    }));
  }, [products, customerTypes]);

  const customer = customers.find((c) => c.customer_id === inputs.customer_id);
  const product = products.find((p) => p.unit_id === inputs.unit_id);
  const scenarioId = scenario?.id || null;

  // The price the price list gives this product + customer (or customer type) + month.
  const priceQuery = resolvePriceQuery({
    unitId: inputs.unit_id,
    customerId: inputs.customer_id,
    customerType: inputs.customer_id ? null : inputs.customer_type,
    period: inputs.period,
    forecastId: scenarioId,
  });
  useEffect(() => {
    const id = priceRequest.current + 1;
    priceRequest.current = id;
    if (!priceQuery) {
      setPriced(null);
      return undefined;
    }
    setPriced((prev) => ({ ...(prev || { price: null }), loading: true, error: null }));
    (async () => {
      try {
        const res = await api.get(`/pricing/resolve?${priceQuery}`, { suppressErrorToast: true });
        if (priceRequest.current === id) setPriced(readResolvedPrice(res));
      } catch (err) {
        if (priceRequest.current === id) {
          setPriced({ price: null, source: null, label: '', rule: null, error: errorMessage(err, 'Could not look up the price.') });
        }
      }
    })();
    return undefined;
  }, [priceQuery]);

  // Until the user types an amount, the invoice is the resolved price x units.
  useEffect(() => {
    if (amountTyped || !priced || priced.loading || priced.price === null || priced.price === undefined) return;
    const amount = invoiceAmount(priced.price, unitCount(inputs.quantity));
    if (amount !== '') setInputs((prev) => (prev.gross === amount ? prev : { ...prev, gross: amount }));
  }, [priced, inputs.quantity, amountTyped]);

  const body = useMemo(() => {
    const gross = Number(inputs.gross);
    if (!Number.isFinite(gross) || String(inputs.gross).trim() === '') return null;
    const qty = Number(inputs.quantity);
    return {
      gross,
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
      customer_id: inputs.customer_id || null,
      customer_type: inputs.customer_id ? (customer?.customer_type || null) : (inputs.customer_type || null),
      unit_id: inputs.unit_id || null,
      unit_type: inputs.unit_id ? (product?.unit_type || null) : (inputs.unit_type || null),
      period: inputs.period || null,
      forecast_id: scenario?.id || null,
    };
  }, [inputs, customer, product, scenario]);

  useEffect(() => {
    if (!body) { setResult(null); return undefined; }
    const id = requestId.current + 1;
    requestId.current = id;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.post('/pricing/deductions/simulate', body, { suppressSuccessToast: true, suppressErrorToast: true });
        if (requestId.current !== id) return;
        setResult(normalizeSimulation(res, rules));
        setError(null);
      } catch (err) {
        if (requestId.current !== id) return;
        setError(errorMessage(err, 'Could not run the example.'));
        setResult(null);
      } finally {
        if (requestId.current === id) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [body, rules, refreshKey]);

  const set = (key, value) => setInputs((prev) => ({ ...prev, [key]: value }));
  const contra = result ? result.lines.filter((l) => l.treatment === 'contra_revenue') : [];
  const commission = result ? result.lines.find((l) => l.type === 'commission') : null;
  const pct = (amount) => (result?.gross ? `${((amount / result.gross) * 100).toFixed(2)}%` : '');

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Calculator className="h-4 w-4 text-orange-600" />
        <h3 className="text-base font-semibold text-gray-900">Try an invoice</h3>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
      </div>
      <p className="mt-1 text-sm text-gray-600">See which rule applies and what it takes off, exactly as the forecast will.</p>

      <div className="mt-4 grid gap-5 md:grid-cols-2 min-[1400px]:block">
      <div className="grid grid-cols-2 content-start gap-3">
        <label className="text-xs font-medium text-gray-600">
          Invoice amount
          <div className="relative mt-1">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
            <input
              type="number"
              step="0.01"
              aria-label="Invoice amount"
              className={`${inputClass} pl-6 text-right tabular-nums`}
              value={inputs.gross}
              onChange={(e) => { setAmountTyped(true); set('gross', e.target.value); }}
            />
          </div>
        </label>
        <label className="text-xs font-medium text-gray-600">
          Units
          <input type="number" min="1" step="1" aria-label="Units" className={`${inputClass} mt-1 text-right tabular-nums`} value={inputs.quantity} onChange={(e) => set('quantity', e.target.value)} />
        </label>
        <p className="col-span-2 -mt-1 text-[11px] leading-snug text-gray-500" data-testid="invoice-price-source" aria-live="polite">
          <PriceNote
            priced={priced}
            quantity={inputs.quantity}
            typed={amountTyped}
            gross={inputs.gross}
            hasProduct={Boolean(inputs.unit_id)}
            onUsePrice={() => setAmountTyped(false)}
          />
        </p>
        <label className="text-xs font-medium text-gray-600">
          Customer
          <select aria-label="Customer" className={`${selectClass} mt-1`} value={inputs.customer_id} onChange={(e) => set('customer_id', e.target.value)}>
            <option value="">Any customer</option>
            {customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.customer_name || c.customer_id}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">
          Customer type
          <select aria-label="Customer type" className={`${selectClass} mt-1`} value={inputs.customer_id ? (customer?.customer_type || '') : inputs.customer_type} onChange={(e) => set('customer_type', e.target.value)} disabled={Boolean(inputs.customer_id)} title={inputs.customer_id ? 'Taken from the customer' : ''}>
            <option value="">{inputs.customer_id ? (customer?.customer_type ? customer.customer_type : 'None set') : 'Any type'}</option>
            {!inputs.customer_id && customerTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            {inputs.customer_id && customer?.customer_type && <option value={customer.customer_type}>{customer.customer_type}</option>}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">
          Product
          <select aria-label="Product" className={`${selectClass} mt-1`} value={inputs.unit_id} onChange={(e) => set('unit_id', e.target.value)}>
            <option value="">Any product</option>
            {products.map((p) => <option key={p.unit_id} value={p.unit_id}>{p.unit_name || p.unit_id}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">
          Product type
          <select aria-label="Product type" className={`${selectClass} mt-1`} value={inputs.unit_id ? (product?.unit_type || '') : inputs.unit_type} onChange={(e) => set('unit_type', e.target.value)} disabled={Boolean(inputs.unit_id)} title={inputs.unit_id ? 'Taken from the product' : ''}>
            <option value="">{inputs.unit_id ? (product?.unit_type ? product.unit_type : 'None set') : 'Any type'}</option>
            {!inputs.unit_id && productTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            {inputs.unit_id && product?.unit_type && <option value={product.unit_type}>{product.unit_type}</option>}
          </select>
        </label>
        <label className="col-span-2 text-xs font-medium text-gray-600">
          Month <span className="font-normal text-gray-400">(optional, for rules with dates)</span>
          <input type="month" className={`${inputClass} mt-1`} value={inputs.period} onChange={(e) => set('period', e.target.value)} />
        </label>
      </div>

      <div className="min-[1400px]:mt-4">
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

      {result && (
        <div className="overflow-hidden rounded-md border border-gray-200">
          <table className="min-w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              <tr className="bg-gray-50">
                <td className="px-3 py-2 font-medium text-gray-900">Gross sales</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums text-gray-900">{formatMoney(result.gross)}</td>
              </tr>
              {contra.map((line) => (
                <tr key={line.type}>
                  <td className="px-3 py-1.5">
                    <div className="text-gray-800">− {line.label}</div>
                    <div className="text-[11px] text-gray-500">
                      {line.rules?.length > 1 ? (
                        <ul data-testid={`programs-${line.type}`}>
                          {line.rules.map((r) => (
                            <li key={r.rule_id} className="flex justify-between gap-2">
                              <span>+ {ruleLabel(r)}</span>
                              <span className="tabular-nums">{formatMoney(r.amount)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : line.rule ? ruleLabel(line.rule) : 'No rule applies'}
                      {line.overridden?.length > 0 && <span title={`Also matched: ${line.overridden.join(', ')}`}> · beats {line.overridden.length} broader rule{line.overridden.length === 1 ? '' : 's'}</span>}
                    </div>
                  </td>
                  <td className={`whitespace-nowrap px-3 py-1.5 text-right align-top tabular-nums ${line.amount ? 'text-gray-900' : 'text-gray-400'}`}>
                    {line.amount ? `(${formatMoney(line.amount)})` : '—'}
                    {line.amount ? <div className="text-[11px] text-gray-400">{pct(line.amount)}</div> : null}
                  </td>
                </tr>
              ))}
              <tr className="bg-orange-50/60">
                <td className="px-3 py-2 font-semibold text-gray-900">Net sales</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                  {formatMoney(result.net)}
                  <div className="text-[11px] font-normal text-gray-500">{result.gross ? `${((result.net / result.gross) * 100).toFixed(1)}% of gross` : ''}</div>
                </td>
              </tr>
              {commission && (
                <tr>
                  <td className="px-3 py-1.5">
                    <div className="text-gray-700">Sales commission</div>
                    <div className="text-[11px] text-gray-500">
                      {commission.rule ? ruleLabel(commission.rule) : 'No rule applies'}
                      {' · '}selling expense, below gross profit
                    </div>
                  </td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${commission.amount ? 'text-gray-700' : 'text-gray-400'}`}>
                    {commission.amount ? formatMoney(commission.amount) : '—'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {result?.notes?.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-amber-700">{result.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
      )}
      </div>
      </div>
    </Card>
  );
};

export default DeductionExample;
