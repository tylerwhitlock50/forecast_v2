import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import api from '../../../lib/apiClient';
import { useConfirm } from '../../Common/ConfirmDialog';
import { Card } from '../../ui/card';
import { Button } from '../../ui/button';
import PriceRuleModal from './PriceRuleModal';
import ApplyPricesModal from './ApplyPricesModal';
import { HelpTip, ScopeBadge, Toggle } from './PricingBits';
import {
  cellRules,
  compactPeriodRange,
  describePeriodRange,
  extractList,
  formatMoney,
  formatRatePct,
  partitionPriceRules,
  priceSourceLabel,
  resolveCellPrice,
  ruleIsActive,
  rulePrice,
} from './pricingUtils';
import { errorMessage } from '../DataImport/importSteps';

const SHORT_SOURCE = {
  type_all: 'type discount',
  type_product_type: 'product-type price',
  product: 'all customers',
  product_type: 'product-type price',
  all: 'all customers',
  base_price: 'list price',
};

/** 'Hunter Rifle', 'Product type Accessory' or 'All products'. */
const describeProducts = (rule) => {
  if (rule.unit_id) return rule.unit_name || rule.unit_id;
  if (rule.unit_type) return `Product type ${rule.unit_type}`;
  return 'All products';
};

const describePrice = (rule) => {
  if (!rule) return '—';
  if ((rule.method || 'fixed') === 'discount_from_base') return `${formatRatePct(rule.discount_pct)} off list`;
  return formatMoney(rule.unit_price);
};

/**
 * One matrix cell: the explicit price (bold) or the inherited one (grey, with
 * where it comes from). With `showInactive`, a switched-off price set here
 * shows struck through; when it is the only price set here, clicking the
 * cell opens it (to switch it back on or delete it).
 */
const PriceCell = ({ rules, product, customerType, scenarioId, onOpen, showInactive = false }) => {
  const inCell = cellRules(rules, product.unit_id, customerType);
  const explicit = inCell.filter(ruleIsActive);
  const off = showInactive ? inCell.filter((r) => !ruleIsActive(r)) : [];
  const own = explicit[0] || null;
  const resolved = resolveCellPrice(rules, { unitId: product.unit_id, unitType: product.unit_type, basePrice: product.base_price, customerType, forecastId: scenarioId });
  const extra = explicit.length - 1;
  const ownPrice = own ? rulePrice(own, product.base_price) : null;
  const dated = own && (own.start_period || own.end_period);
  const offRule = off[0] || null;
  const offPrice = offRule ? rulePrice(offRule, product.base_price) : null;
  const title = own
    ? `${describePrice(own)}${dated ? ` · ${describePeriodRange(own.start_period, own.end_period)}` : ''}${own.forecast_id ? ' · this scenario only' : ''}. Click to edit.`
    : offRule
      ? `${describePrice(offRule)} is set here but switched off${resolved.price !== null ? `; uses the ${priceSourceLabel(resolved.source).toLowerCase()} (${formatMoney(resolved.price)})` : ''}. Click to edit or delete it.`
      : resolved.price !== null
        ? `No price set here; uses the ${priceSourceLabel(resolved.source).toLowerCase()} (${formatMoney(resolved.price)}). Click to set one.`
        : 'No price. Click to set one.';
  return (
    <button
      type="button"
      onClick={() => onOpen(own || offRule, product, customerType)}
      title={title}
      className="group flex w-full flex-col items-end rounded px-2 py-1 text-right hover:bg-orange-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
    >
      {own ? (
        <>
          <span className="font-semibold tabular-nums text-gray-900">
            {ownPrice !== null ? formatMoney(ownPrice) : describePrice(own)}
            {extra > 0 && <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] font-medium text-gray-500">+{extra}</span>}
          </span>
          <span className="whitespace-nowrap text-[10px] text-gray-500">
            {own.method === 'discount_from_base' ? `${formatRatePct(own.discount_pct)} off list` : 'set here'}
            {dated ? ` · ${compactPeriodRange(own.start_period, own.end_period)}` : ''}{own.forecast_id ? ' · this scenario' : ''}
          </span>
        </>
      ) : resolved.price !== null ? (
        <>
          <span className="tabular-nums text-gray-400">{formatMoney(resolved.price)}</span>
          <span className="text-[10px] text-gray-400 group-hover:text-orange-700">{SHORT_SOURCE[resolved.source] || 'inherited'}</span>
        </>
      ) : (
        <span className="text-gray-300 group-hover:text-orange-700">—</span>
      )}
      {offRule && (
        <span className="whitespace-nowrap text-[10px] text-gray-400" data-testid="cell-switched-off">
          off: <span className="line-through">{offPrice !== null ? formatMoney(offPrice) : describePrice(offRule)}</span>
          {off.length > 1 ? ` +${off.length - 1}` : ''}
        </span>
      )}
    </button>
  );
};

const RuleList = ({ title, help, rules, empty, customers, scenarios, onEdit, onDelete, busyId, showProduct = true }) => (
  <Card className="overflow-hidden">
    <div className="border-b border-gray-100 px-5 py-3">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <p className="text-xs text-gray-500">{help}</p>
    </div>
    {rules.length === 0 ? (
      <div className="px-5 py-4 text-sm text-gray-500">{empty}</div>
    ) : (
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-[11px] font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-5 py-2">Who pays</th>
              {showProduct && <th className="px-3 py-2">Products</th>}
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2">Months</th>
              <th className="px-3 py-2">Scenario</th>
              <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rules.map((r) => {
              const active = ruleIsActive(r);
              const customer = customers.find((c) => c.customer_id === r.customer_id);
              return (
                <tr key={r.price_id} className={active ? 'hover:bg-gray-50' : 'bg-gray-50/60 text-gray-400'}>
                  <td className="px-5 py-2">
                    <div className={active ? 'font-medium text-gray-900' : 'line-through'}>
                      {r.customer_id ? (customer?.customer_name || r.customer_name || r.customer_id) : r.customer_type || 'All customers'}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      {r.customer_id ? `Customer ${r.customer_id}${customer?.customer_type ? ` · ${customer.customer_type}` : ''}` : r.customer_type ? 'Customer type' : 'Everyone'}
                      {!active && ' · switched off'}
                    </div>
                  </td>
                  {showProduct && (
                    <td className="px-3 py-2 text-gray-700">
                      {r.unit_type && !r.unit_id ? (
                        <span className="inline-flex items-center whitespace-nowrap rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-800" title={`Every product with product type ${r.unit_type}`}>
                          <span className="mr-1 opacity-60">Product type</span>{r.unit_type}
                        </span>
                      ) : describeProducts(r)}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    <div className="font-medium text-gray-900">{describePrice(r)}</div>
                    {r.method === 'discount_from_base' && r.unit_id && r.effective_price !== null && r.effective_price !== undefined && (
                      <div className="text-[11px] text-gray-500">= {formatMoney(r.effective_price)}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600">{describePeriodRange(r.start_period, r.end_period)}</td>
                  <td className="px-3 py-2"><ScopeBadge forecastId={r.forecast_id} scenarios={scenarios} /></td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => onEdit(r)} aria-label="Edit price" title="Edit"><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-600 hover:text-red-700" onClick={() => onDelete(r)} disabled={busyId === r.price_id} aria-label="Delete price" title="Delete"><Trash2 className="h-4 w-4" /></Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}
  </Card>
);

/**
 * Price list: product x customer-type matrix, customer-specific prices,
 * all-product discounts, and "apply to forecast".
 */
const PriceListTab = ({ customers, products, customerTypes, productTypes = [], scenario, scenarios, onChanged }) => {
  const confirm = useConfirm();
  const [rules, setRules] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [modal, setModal] = useState({ open: false, rule: null, defaults: null });
  const [applyOpen, setApplyOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [showInactive, setShowInactive] = useState(false);

  const scenarioId = scenario?.id || null;
  const baseScenario = useMemo(() => Object.values(scenarios || {}).find((s) => s.is_base) || null, [scenarios]);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/pricing/prices${scenarioId ? `?forecast_id=${encodeURIComponent(scenarioId)}` : ''}`, { suppressErrorToast: true });
      setRules(extractList(res, ['prices']));
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, 'Could not load the price list.'));
    } finally {
      setLoaded(true);
    }
  }, [scenarioId]);

  useEffect(() => { load(); }, [load]);

  const parts = useMemo(() => partitionPriceRules(rules), [rules]);
  // The lists show rules in use; switched-off ones are listed together behind "Show switched-off prices".
  const activeParts = useMemo(() => partitionPriceRules(rules.filter(ruleIsActive)), [rules]);
  const inactiveRules = useMemo(() => rules.filter((r) => !ruleIsActive(r)), [rules]);
  const columns = useMemo(() => {
    const fromRules = rules.map((r) => r.customer_type).filter(Boolean);
    const all = [...customerTypes];
    fromRules.forEach((t) => { if (!all.some((x) => x.toLowerCase() === String(t).toLowerCase())) all.push(t); });
    return all;
  }, [rules, customerTypes]);
  const sortedProducts = useMemo(
    () => [...products].sort((a, b) => String(a.unit_type || '~').localeCompare(String(b.unit_type || '~')) || String(a.unit_name || a.unit_id).localeCompare(String(b.unit_name || b.unit_id))),
    [products]
  );

  const save = async (payload, existing) => {
    const opts = { suppressSuccessToast: true, suppressErrorToast: true };
    const res = existing
      ? await api.put(`/pricing/prices/${encodeURIComponent(existing.price_id)}`, payload, opts)
      : await api.post('/pricing/prices', payload, opts);
    if (!payload.is_active) {
      // Keep a price that was just switched off in view instead of letting it vanish.
      setShowInactive(true);
      toast.success(`${existing ? 'Price' : 'Price added and'} switched off. It is listed under “Switched-off prices”.`);
    } else {
      toast.success(existing ? 'Price updated' : 'Price added');
    }
    (res?.data?.warnings || []).forEach((w) => toast(String(w), { icon: '⚠️', duration: 6000 }));
    await load();
    if (onChanged) onChanged();
  };

  /** Confirm, then DELETE /pricing/prices/{price_id}. Resolves true when the price was deleted. */
  const remove = async (rule) => {
    const who = rule.customer_id
      ? (rule.customer_name || customers.find((c) => c.customer_id === rule.customer_id)?.customer_name || rule.customer_id)
      : rule.customer_type || 'all customers';
    const what = rule.unit_id
      ? (rule.unit_name || products.find((p) => p.unit_id === rule.unit_id)?.unit_name || rule.unit_id)
      : rule.unit_type ? `every ${rule.unit_type} product` : 'all products';
    const dated = rule.start_period || rule.end_period ? ` (${describePeriodRange(rule.start_period, rule.end_period)})` : '';
    const ok = await confirm({
      title: 'Delete this price?',
      body: `${describePrice(rule)} for ${who} on ${what}${dated}${ruleIsActive(rule) ? '' : ', switched off'}. Sales rows already priced keep their price until you apply prices again.`,
      confirmLabel: 'Delete price',
      variant: 'destructive',
    });
    if (!ok) return false;
    setBusyId(rule.price_id);
    try {
      await api.delete(`/pricing/prices/${encodeURIComponent(rule.price_id)}`, { suppressSuccessToast: true, suppressErrorToast: true });
      toast.success('Price deleted');
      await load();
      if (onChanged) onChanged();
      return true;
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete the price.'));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const openCell = (rule, product, customerType) => {
    if (rule) setModal({ open: true, rule, defaults: null });
    else setModal({ open: true, rule: null, defaults: { unit_id: product.unit_id, customer_type: customerType || '', method: 'fixed' } });
  };

  const hasSales = Boolean(scenario && (scenario.sales_rows || 0) > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="flex items-center gap-1.5 text-lg font-semibold text-gray-900">
            Price list
            <HelpTip text="For each sale the most specific price wins: a price for that customer, then for its customer type, then for all customers, then the product list price. Within each, a price for the product beats one for its product type, which beats one for every product." />
          </h2>
          <p className="text-sm text-gray-600">
            What each customer type pays per product. Sales rows imported without a price get their price from here;
            “Apply prices to forecast” re-prices rows already in the scenario.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setApplyOpen(true)} disabled={!hasSales} title={hasSales ? '' : 'The active scenario has no sales rows yet'}>
            <RefreshCw className="mr-1.5 h-4 w-4" /> Apply prices to forecast
          </Button>
          <Button size="sm" onClick={() => setModal({ open: true, rule: null, defaults: null })} disabled={products.length === 0} className="bg-orange-600 text-white hover:bg-orange-700">
            <Plus className="mr-1.5 h-4 w-4" /> Add price
          </Button>
        </div>
      </div>

      {loadError && <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-800">{loadError}</Card>}

      {products.length === 0 ? (
        <Card className="border-dashed p-8 text-center">
          <h3 className="text-base font-semibold text-gray-900">No products yet</h3>
          <p className="mx-auto mt-1 max-w-lg text-sm text-gray-600">Prices are set per product. Import your products (with their list price) first.</p>
          <Link to="/import" className="mt-4 inline-flex h-9 items-center rounded-md bg-orange-600 px-4 text-sm font-medium text-white hover:bg-orange-700">Go to Import data</Link>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Prices by customer type</h3>
              <p className="text-xs text-gray-500">
                <span className="font-semibold text-gray-700">Bold</span> = set here. <span className="text-gray-400">Grey</span> = inherited (from a product-type or all-products discount, the all-customers price or list price). Click any cell to set a price.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {columns.length === 0 && (
                <span className="text-xs text-amber-700">Give customers a type (Dealer, Distributor…) to price by type. <Link to="/customers" className="underline">Customers</Link></span>
              )}
              {inactiveRules.length > 0 && (
                <label className="flex items-center gap-2 text-xs text-gray-700" title="Prices switched off (Active unticked) are kept but not used. Show them to switch them back on or delete them.">
                  <Toggle checked={showInactive} onChange={setShowInactive} label="Show switched-off prices" />
                  <span>
                    Show switched-off prices
                    <span className="ml-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">{inactiveRules.length}</span>
                  </span>
                </label>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="sticky left-0 z-10 bg-gray-50 px-5 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-right">List price</th>
                  <th className="px-3 py-2 text-right">All customers</th>
                  {columns.map((t) => <th key={t} className="px-3 py-2 text-right" title="Customer type">{t}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedProducts.map((p) => (
                  <tr key={p.unit_id} className="hover:bg-gray-50/60">
                    <td className="sticky left-0 z-10 bg-white px-5 py-1.5">
                      <div className="font-medium text-gray-900">{p.unit_name || p.unit_id}</div>
                      <div className="text-[11px] text-gray-500">{p.unit_id}{p.unit_type ? ` · ${p.unit_type}` : ''}</div>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-700" title="Edit on the Products screen">
                      {Number(p.base_price) > 0 ? formatMoney(p.base_price) : <span className="text-amber-600" title="No list price: rows for this product need a price-list entry">not set</span>}
                    </td>
                    <td className="px-1 py-1"><PriceCell rules={parts.matrix.concat(parts.allProducts)} product={p} customerType={null} scenarioId={scenarioId} onOpen={openCell} showInactive={showInactive} /></td>
                    {columns.map((t) => (
                      <td key={t} className="px-1 py-1">
                        <PriceCell rules={parts.matrix.concat(parts.allProducts)} product={p} customerType={t} scenarioId={scenarioId} onOpen={openCell} showInactive={showInactive} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {products.length > 0 && loaded && (
        <div className="space-y-6">
          <RuleList
            title="Prices for a product type or every product"
            help="For example: Distributor 40% off list on every product, or 40% off list for product type Accessory. A product-type price beats an every-product one; a price set for a product beats both."
            rules={activeParts.allProducts}
            empty="None. Add one with “Add price” → Discount off list price → A product type or All products."
            customers={customers}
            scenarios={scenarios}
            onEdit={(r) => setModal({ open: true, rule: r, defaults: null })}
            onDelete={remove}
            busyId={busyId}
          />
          <RuleList
            title="Customer-specific prices"
            help="Beat every customer-type and all-customer price for that customer."
            rules={activeParts.customer}
            empty="None. Use these for contract prices with one account."
            customers={customers}
            scenarios={scenarios}
            onEdit={(r) => setModal({ open: true, rule: r, defaults: null })}
            onDelete={remove}
            busyId={busyId}
          />
          {showInactive && inactiveRules.length > 0 && (
            <RuleList
              title="Switched-off prices"
              help="Kept but not used for any sale. Edit one and tick Active to use it again, or delete it."
              rules={inactiveRules}
              empty="None."
              customers={customers}
              scenarios={scenarios}
              onEdit={(r) => setModal({ open: true, rule: r, defaults: null })}
              onDelete={remove}
              busyId={busyId}
            />
          )}
        </div>
      )}

      <PriceRuleModal
        open={modal.open}
        rule={modal.rule}
        defaults={modal.defaults}
        onClose={() => setModal({ open: false, rule: null, defaults: null })}
        onSave={save}
        onDelete={remove}
        customers={customers}
        products={products}
        customerTypes={columns}
        productTypes={productTypes}
        scenario={scenario}
      />
      <ApplyPricesModal
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        scenario={scenario}
        baseScenario={baseScenario}
        customerTypes={columns}
        products={products}
        customers={customers}
        onApplied={async (done) => {
          toast.success(`Updated ${done.changed.toLocaleString('en-US')} sales rows`);
          if (onChanged) await onChanged({ salesChanged: true });
        }}
      />
    </div>
  );
};

export default PriceListTab;
