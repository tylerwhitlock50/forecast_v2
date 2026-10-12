import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '../../ui/modal';
import { Button } from '../../ui/button';
import api from '../../../lib/apiClient';
import { applyPricesRisk, formatMoney, normalizeApplyResult, priceSourceLabel } from './pricingUtils';
import { errorMessage } from '../DataImport/importSteps';
import { formatPeriod } from '../ReportingAnalysis/utils/formatters';

const money0 = (v) => (Number(v) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const FIELD_WORDS = { name: 'name', description: 'description', notes: 'notes' };

const shorten = (text, max = 80) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * Replacing every price in a branch (or in a scenario whose name says its
 * prices were changed) undoes that change. Says so, offers "only fill rows
 * with no price", points at the base scenario, and asks for a tick before
 * the prices are replaced anyway.
 */
const ReplaceWarning = ({ risk, scenario, baseScenario, preview, acknowledged, onAcknowledge, onOnlyMissing }) => {
  const delta = preview ? preview.revenueAfter - preview.revenueBefore : 0;
  const name = scenario?.name || 'this scenario';
  // "name mentions a price change" (the name is already on screen), or the description / notes quoted.
  const mention = risk.mention ? (
    <>
      {FIELD_WORDS[risk.mention.field]} mentions a price change
      {risk.mention.field !== 'name' && <> (<span className="font-medium">“{shorten(risk.mention.text)}”</span>)</>}
    </>
  ) : null;
  const otherBase = baseScenario && baseScenario.id !== scenario?.id ? baseScenario : null;
  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert" data-testid="apply-prices-warning">
      <div className="flex items-start gap-2 font-semibold">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>This replaces every price in {name} with the price list</span>
      </div>
      <div className="space-y-1 pl-6">
        <p>
          {risk.branch ? `${name} is not the base scenario` : null}
          {risk.branch && mention ? ', and its ' : null}
          {!risk.branch && mention ? 'Its ' : null}
          {mention}
          {risk.branch && !mention ? (
            <>. If it was branched with a price change (for example <span className="font-medium">“+5% price”</span>), applying the price list undoes that change</>
          ) : (
            <>. Applying the price list undoes that change</>
          )}
          : every row goes back to the price-list price.
        </p>
        {preview && delta < -0.5 && (
          <p>
            In this preview gross sales fall by <span className="font-semibold tabular-nums">{money0(-delta)}</span>
            {preview.revenueBefore ? ` (${((delta / preview.revenueBefore) * 100).toFixed(1)}%)` : ''}.
          </p>
        )}
        <p>
          To keep this scenario&apos;s prices,{' '}
          <button type="button" onClick={onOnlyMissing} className="font-medium text-amber-950 underline hover:text-orange-800">
            only fill rows with no price
          </button>
          {!risk.branch && '.'}
          {risk.branch && otherBase && <>, or apply prices in the base scenario <span className="font-medium">{otherBase.name}</span> and branch from it again.</>}
          {risk.branch && !otherBase && ', or apply prices in the base scenario and branch from it again.'}
        </p>
        <label className="flex items-start gap-2 pt-1 font-medium">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => onAcknowledge(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-amber-400 text-orange-600 focus:ring-orange-500"
          />
          <span>Replace the prices in {name} anyway</span>
        </label>
      </div>
    </div>
  );
};

/**
 * Re-price the active scenario's sales rows from the price list: a dry run
 * first (what would change, revenue before / after), then apply. In a
 * branch (or a scenario whose name mentions a price change) replacing every
 * price needs an extra tick, because it undoes the branch's price change.
 */
const ApplyPricesModal = ({ open, onClose, scenario, baseScenario = null, customerTypes, products, customers, onApplied }) => {
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [types, setTypes] = useState([]);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const body = useCallback((dryRun) => ({
    forecast_id: scenario?.id,
    only_missing: onlyMissing,
    customer_types: types.length ? types : undefined,
    dry_run: dryRun,
  }), [scenario, onlyMissing, types]);

  // Reset on close so the next open starts clean without a second preview request.
  useEffect(() => {
    if (open) return;
    setOnlyMissing(false);
    setTypes([]);
    setError(null);
    setPreview(null);
    setApplying(false);
    setAcknowledged(false);
  }, [open]);

  useEffect(() => {
    if (!open || !scenario) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.post('/pricing/apply', body(true), { suppressSuccessToast: true, suppressErrorToast: true, timeout: 120000 })
      .then((res) => { if (!cancelled) setPreview(normalizeApplyResult(res)); })
      .catch((err) => { if (!cancelled) { setPreview(null); setError(errorMessage(err, 'Could not preview the change.')); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, scenario, body]);

  if (!open) return null;

  const apply = async () => {
    setApplying(true);
    setError(null);
    try {
      const res = await api.post('/pricing/apply', body(false), { suppressSuccessToast: true, suppressErrorToast: true, timeout: 120000 });
      const done = normalizeApplyResult(res);
      if (onApplied) await onApplied(done);
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not apply the prices.'));
      setApplying(false);
    }
  };

  const toggleType = (t) => setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  const nameOf = (list, idKey, nameKey, id) => list.find((x) => x[idKey] === id)?.[nameKey] || id;
  const delta = preview ? preview.revenueAfter - preview.revenueBefore : 0;
  const risk = applyPricesRisk(scenario);
  // Replacing prices that are already there is what can undo a branch's price change.
  const replacesPrices = Boolean(risk) && !onlyMissing && Boolean(preview) && preview.changed > 0;
  const blockedByWarning = replacesPrices && !acknowledged;
  const chooseOnlyMissing = (value) => {
    setOnlyMissing(value);
    setAcknowledged(false);
  };

  return (
    <Modal className="max-w-3xl" onClick={(e) => e.target === e.currentTarget && !applying && onClose()}>
      <ModalHeader>
        <div>
          <ModalTitle>Apply prices to the forecast</ModalTitle>
          <p className="mt-1 text-sm text-gray-500">
            Re-prices sales rows in <span className="font-medium text-gray-700">{scenario?.name}</span> from the price list
            (falling back to list price) and recalculates revenue. Quantities are not touched.
          </p>
        </div>
      </ModalHeader>
      <ModalContent className="space-y-5">
        <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-4">
          <label className="flex items-start gap-2 text-sm text-gray-800">
            <input type="checkbox" checked={onlyMissing} onChange={(e) => chooseOnlyMissing(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
            <span>
              Only fill rows with no price
              <span className="block text-xs text-gray-500">
                {onlyMissing
                  ? 'Rows that already have a price keep it, including prices from your file and a branch’s price change.'
                  : 'Leave unticked to replace every price in the scenario, including prices that came from your file.'}
              </span>
            </span>
          </label>
          {customerTypes.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-gray-600">Customer types {types.length === 0 && <span className="font-normal text-gray-400">(all)</span>}</div>
              <div className="flex flex-wrap gap-1.5">
                {customerTypes.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleType(t)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${types.includes(t) ? 'border-orange-500 bg-orange-100 text-orange-900' : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {risk && !onlyMissing && (!preview || preview.changed > 0) && (
          <ReplaceWarning
            risk={risk}
            scenario={scenario}
            baseScenario={baseScenario}
            preview={loading ? null : preview}
            acknowledged={acknowledged}
            onAcknowledge={setAcknowledged}
            onOnlyMissing={() => chooseOnlyMissing(true)}
          />
        )}

        {loading && <div className="flex items-center gap-2 text-sm text-gray-600"><Loader2 className="h-4 w-4 animate-spin" /> Working out what would change…</div>}
        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</div>}

        {preview && !loading && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: 'Rows checked', value: preview.matched.toLocaleString('en-US') },
                { label: 'Would change', value: preview.changed.toLocaleString('en-US'), tone: preview.changed ? 'text-orange-700' : '' },
                { label: 'Already right', value: preview.unchanged.toLocaleString('en-US') },
                { label: 'No price found', value: preview.unpriced.toLocaleString('en-US'), tone: preview.unpriced ? 'text-red-700' : '' },
              ].map((t) => (
                <div key={t.label} className="rounded-md border border-gray-200 px-3 py-2">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{t.label}</div>
                  <div className={`text-lg font-semibold tabular-nums ${t.tone || 'text-gray-900'}`}>{t.value}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-md border border-gray-200 px-4 py-3 text-sm">
              <span className="text-gray-600">Gross sales <span className="font-medium tabular-nums text-gray-900">{money0(preview.revenueBefore)}</span></span>
              <span className="text-gray-400">→</span>
              <span className="text-gray-600">after <span className="font-semibold tabular-nums text-gray-900">{money0(preview.revenueAfter)}</span></span>
              <span className={`font-medium tabular-nums ${delta > 0 ? 'text-green-700' : delta < 0 ? 'text-red-700' : 'text-gray-500'}`}>
                {delta > 0 ? '+' : ''}{money0(delta)}{preview.revenueBefore ? ` (${delta > 0 ? '+' : ''}${((delta / preview.revenueBefore) * 100).toFixed(1)}%)` : ''}
              </span>
            </div>
            {preview.bySource.length > 0 && (
              <div className="text-sm text-gray-700">
                <div className="mb-1 font-medium text-gray-900">Where the new prices come from</div>
                <ul className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                  {preview.bySource.map((s) => (
                    <li key={s.source} className="flex justify-between gap-3">
                      <span className={s.source === 'none' ? 'text-red-700' : ''}>{priceSourceLabel(s.source)}</span>
                      <span className="whitespace-nowrap tabular-nums text-gray-600">{s.count.toLocaleString('en-US')} rows</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {preview.samples.length > 0 && (
              <div className="overflow-hidden rounded-md border border-gray-200">
                <div className="bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600">
                  Example changes {preview.changed > preview.samples.length ? `(first ${preview.samples.length} of ${preview.changed.toLocaleString('en-US')})` : ''}
                </div>
                <div className="max-h-60 overflow-y-auto">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-white text-left text-[11px] uppercase tracking-wide text-gray-500 shadow-[0_1px_0_#e5e7eb]">
                      <tr>
                        <th className="px-3 py-1.5">Month</th>
                        <th className="px-3 py-1.5">Customer</th>
                        <th className="px-3 py-1.5">Product</th>
                        <th className="px-3 py-1.5 text-right">Units</th>
                        <th className="px-3 py-1.5 text-right">Price now</th>
                        <th className="px-3 py-1.5 text-right">New price</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {preview.samples.map((c, i) => (
                        <tr key={c.sale_id || i}>
                          <td className="whitespace-nowrap px-3 py-1.5 text-gray-700">{formatPeriod(String(c.period || '').slice(0, 7))}</td>
                          <td className="px-3 py-1.5 text-gray-700">{nameOf(customers, 'customer_id', 'customer_name', c.customer_id)}</td>
                          <td className="px-3 py-1.5 text-gray-700">{nameOf(products, 'unit_id', 'unit_name', c.unit_id)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{Number(c.quantity || 0).toLocaleString('en-US')}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{c.old_price === null || c.old_price === undefined ? 'none' : formatMoney(c.old_price)}</td>
                          <td className="px-3 py-1.5 text-right font-medium tabular-nums text-gray-900">{formatMoney(c.new_price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {onlyMissing && preview.matched === 0 && (
              <p className="text-sm text-gray-700" data-testid="nothing-to-fill">
                Every sales row in {scenario?.name || 'this scenario'} already has a price, so there is nothing to fill. Existing prices are kept.
              </p>
            )}
            {preview.unpriced > 0 && (
              <p className="text-xs text-red-700">
                {preview.unpriced.toLocaleString('en-US')} rows have no price-list entry and no list price; they keep their current price. Add a price or a list price for those products.
              </p>
            )}
          </div>
        )}
      </ModalContent>
      <ModalFooter className="sticky bottom-0 bg-white">
        <Button variant="outline" onClick={onClose} disabled={applying}>Cancel</Button>
        <Button
          onClick={apply}
          disabled={applying || loading || !preview || preview.changed === 0 || blockedByWarning}
          title={blockedByWarning ? `Tick “Replace the prices in ${scenario?.name || 'this scenario'} anyway” first` : ''}
          className="bg-orange-600 text-white hover:bg-orange-700"
        >
          {applying ? 'Applying…' : preview && preview.changed > 0 ? `Update ${preview.changed.toLocaleString('en-US')} rows` : 'Nothing to change'}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default ApplyPricesModal;
