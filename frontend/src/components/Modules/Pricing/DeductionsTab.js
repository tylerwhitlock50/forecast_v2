import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import api from '../../../lib/apiClient';
import { useConfirm } from '../../Common/ConfirmDialog';
import { Card } from '../../ui/card';
import { Button } from '../../ui/button';
import DeductionRuleModal from './DeductionRuleModal';
import StandardRulesModal from './StandardRulesModal';
import DeductionExample from './DeductionExample';
import { HelpTip, ScopeChips, Toggle } from './PricingBits';
import {
  DEDUCTION_TYPES,
  describeRate,
  extractList,
  formatMoney,
  groupRulesByType,
  normalizePreview,
  ruleIsActive,
} from './pricingUtils';
import { errorMessage } from '../DataImport/importSteps';
import { formatPeriod } from '../ReportingAnalysis/utils/formatters';

const compactMoney = (value) => {
  const n = Number(value) || 0;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
};

const PRECEDENCE = 'When several rules of the same kind match a sale, only the most specific one applies: customer, then customer type, then product, then product type. Different kinds add up. A 0% rule is an exemption (for example Government customers and excise tax).';

/** Gross → deductions → net for the active scenario's forecast. */
const TotalsStrip = ({ preview, scenario, loading }) => {
  const hasSales = preview && preview.rowCount > 0;
  const tiles = [
    { key: 'gross', label: 'Gross sales', value: preview?.gross, strong: true },
    ...DEDUCTION_TYPES.filter((t) => t.treatment === 'contra_revenue').map((t) => ({ key: t.type, label: t.short, value: preview?.byType?.[t.type], minus: true })),
    { key: 'net', label: 'Net sales', value: preview?.net, strong: true, accent: true },
  ];
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-gray-900">How net sales is calculated</h2>
          <p className="mt-0.5 text-sm text-gray-600">
            Gross sales (what you invoice) less terms, chargebacks, other allowances and excise tax = net sales.
            Commissions are a selling expense below gross profit, so they do not reduce net sales.
          </p>
        </div>
        {scenario && hasSales && (
          <span className="text-xs text-gray-500">
            {scenario.name} · {formatPeriod(preview.startPeriod)} – {formatPeriod(preview.endPeriod)} · {Number(preview.rowCount).toLocaleString('en-US')} sales rows
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <div key={t.key} className={`rounded-md border px-3 py-2 ${t.accent ? 'border-orange-200 bg-orange-50' : 'border-gray-200 bg-white'}`}>
            <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{t.minus ? `− ${t.label}` : t.label}</div>
            <div className={`mt-0.5 tabular-nums ${t.strong ? 'text-lg font-semibold text-gray-900' : 'text-base font-medium text-gray-800'}`}>
              {hasSales ? (t.minus ? (t.value ? `(${compactMoney(t.value)})` : '—') : compactMoney(t.value)) : '—'}
            </div>
            <div className="text-[11px] tabular-nums text-gray-400">
              {hasSales && preview.gross && t.key !== 'gross' ? `${(((t.value || 0) / preview.gross) * 100).toFixed(2)}% of gross` : ' '}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
        <span>
          {hasSales
            ? <>Sales commissions: <span className="font-medium tabular-nums text-gray-700">{compactMoney(preview.commission)}</span> (operating expense)</>
            : loading ? 'Loading totals…' : scenario
              ? <>No sales in {scenario.name} yet. <Link to="/import" className="font-medium text-orange-700 underline">Import a sales forecast</Link> to see totals here.</>
              : <>Pick or <Link to="/scenarios" className="font-medium text-orange-700 underline">create a scenario</Link> to see totals for its forecast.</>}
        </span>
      </div>
    </Card>
  );
};

const RuleGroup = ({ group, customers, products, scenarios, usage, hasSales, onAdd, onEdit, onDelete, onToggle, busyId }) => (
  <Card className="overflow-hidden" data-testid={`rule-group-${group.type}`}>
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-900">{group.label}</h3>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${group.treatment === 'contra_revenue' ? 'bg-gray-100 text-gray-600' : 'bg-blue-50 text-blue-700'}`}>
            {group.treatment === 'contra_revenue' ? 'Comes off gross sales' : 'Selling expense'}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-gray-500">{group.description}</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => onAdd(group.type)}>
        <Plus className="mr-1 h-3.5 w-3.5" /> Add
      </Button>
    </div>
    {group.rules.length === 0 ? (
      <div className="px-5 py-3 text-sm text-gray-500">No rule: nothing is {group.treatment === 'contra_revenue' ? 'deducted' : 'charged'} for {group.label.toLowerCase()}.</div>
    ) : (
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-[11px] font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-5 py-2">Rule · applies to</th>
              <th className="w-28 whitespace-nowrap px-3 py-2 text-right">Rate</th>
              <th className="w-36 whitespace-nowrap px-3 py-2 text-right">
                <span className="inline-flex items-center gap-1">In this forecast <HelpTip text="Sales rows this rule is applied to in the active scenario, and the amount. A rule can match nothing if a more specific rule wins." /></span>
              </th>
              <th className="w-16 px-3 py-2 text-center">Active</th>
              <th className="w-24 px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {group.rules.map((rule) => {
              const active = ruleIsActive(rule);
              const used = usage?.[rule.rule_id];
              return (
                <tr key={rule.rule_id} className={active ? 'hover:bg-gray-50' : 'bg-gray-50/50 text-gray-400'}>
                  <td className="px-5 py-2.5 align-top">
                    <div className={`font-medium ${active ? 'text-gray-900' : 'text-gray-500 line-through'}`}>{rule.name || rule.rule_id}</div>
                    <div className="mt-1"><ScopeChips rule={rule} customers={customers} products={products} scenarios={scenarios} showLimits /></div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right align-top font-medium tabular-nums text-gray-900">{describeRate(rule)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right align-top tabular-nums">
                    {!hasSales ? <span className="text-gray-300">—</span>
                      : used && used.rows > 0 ? (
                        <>
                          <div className="text-gray-900">{compactMoney(used.amount)}</div>
                          <div className="text-[11px] text-gray-500">{used.rows.toLocaleString('en-US')} rows</div>
                        </>
                      ) : <span className="text-xs text-amber-700" title="No sales row uses this rule: its scope matches nothing, it is switched off, or a more specific rule wins.">Not used</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center align-top">
                    <Toggle checked={active} disabled={busyId === rule.rule_id} onChange={(v) => onToggle(rule, v)} label={active ? 'Switch off' : 'Switch on'} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right align-top">
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => onEdit(rule)} aria-label={`Edit ${rule.name || rule.rule_id}`} title="Edit">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-600 hover:text-red-700" onClick={() => onDelete(rule)} disabled={busyId === rule.rule_id} aria-label={`Delete ${rule.name || rule.rule_id}`} title="Delete">
                      <Trash2 className="h-4 w-4" />
                    </Button>
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
 * Discounts & allowances: the rules that turn gross sales into net sales,
 * a worked example, and what they add up to in the active scenario.
 */
const DeductionsTab = ({ customers, products, customerTypes, productTypes, scenario, scenarios, onChanged }) => {
  const confirm = useConfirm();
  const [rules, setRules] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [modal, setModal] = useState({ open: false, rule: null, defaults: null });
  const [standardOpen, setStandardOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [version, setVersion] = useState(0);

  const scenarioId = scenario?.id || null;

  const loadRules = useCallback(async () => {
    try {
      const res = await api.get(`/pricing/deductions${scenarioId ? `?forecast_id=${encodeURIComponent(scenarioId)}` : ''}`, { suppressErrorToast: true });
      setRules(extractList(res, ['rules']));
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, 'Could not load the rules.'));
    } finally {
      setLoaded(true);
    }
  }, [scenarioId]);

  const loadPreview = useCallback(async () => {
    if (!scenarioId) { setPreview(null); return; }
    setPreviewLoading(true);
    try {
      const res = await api.get(`/pricing/deductions/preview?forecast_id=${encodeURIComponent(scenarioId)}`, { suppressErrorToast: true });
      setPreview(normalizePreview(res));
    } catch {
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [scenarioId]);

  useEffect(() => { loadRules(); }, [loadRules]);
  useEffect(() => { loadPreview(); }, [loadPreview, version]);

  const refresh = async () => {
    await loadRules();
    setVersion((v) => v + 1);
    if (onChanged) onChanged();
  };

  const groups = useMemo(() => groupRulesByType(rules), [rules]);
  const hasSales = Boolean(preview && preview.rowCount > 0);

  const saveRule = async (payload, existing) => {
    const opts = { suppressSuccessToast: true, suppressErrorToast: true };
    const res = existing
      ? await api.put(`/pricing/deductions/${encodeURIComponent(existing.rule_id)}`, payload, opts)
      : await api.post('/pricing/deductions', payload, opts);
    const warnings = res?.data?.warnings || [];
    toast.success(existing ? 'Rule updated' : 'Rule added');
    warnings.forEach((w) => toast(String(w), { icon: '⚠️', duration: 6000 }));
    await refresh();
  };

  const createStandard = async (list) => {
    const res = await api.post('/pricing/deductions', { rules: list }, { suppressSuccessToast: true, suppressErrorToast: true });
    toast.success(`Added ${list.length} rule${list.length === 1 ? '' : 's'}`);
    (res?.data?.warnings || []).forEach((w) => toast(String(w), { icon: '⚠️', duration: 6000 }));
    await refresh();
  };

  const toggle = async (rule, value) => {
    setBusyId(rule.rule_id);
    try {
      await api.put(`/pricing/deductions/${encodeURIComponent(rule.rule_id)}`, { is_active: value ? 1 : 0 }, { suppressSuccessToast: true, suppressErrorToast: true });
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update the rule.'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (rule) => {
    const ok = await confirm({
      title: `Delete "${rule.name || rule.rule_id}"?`,
      body: rule.forecast_id
        ? 'This rule only applies to one scenario. Deleting it changes that scenario\'s net sales.'
        : 'This rule is company-wide. Deleting it changes net sales in every scenario.',
      confirmLabel: 'Delete rule',
      variant: 'destructive',
    });
    if (!ok) return;
    setBusyId(rule.rule_id);
    try {
      await api.delete(`/pricing/deductions/${encodeURIComponent(rule.rule_id)}`, { suppressSuccessToast: true, suppressErrorToast: true });
      toast.success('Rule deleted');
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete the rule.'));
    } finally {
      setBusyId(null);
    }
  };

  const openAdd = (type = 'terms_allowance') => setModal({
    open: true,
    rule: null,
    defaults: { deduction_type: type, method: type === 'excise_tax' ? 'embedded_tax' : 'percent_of_gross' },
  });

  return (
    <div className="space-y-6">
      <TotalsStrip preview={preview} scenario={scenario} loading={previewLoading} />

      <div className="grid gap-6 min-[1400px]:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-1.5 text-lg font-semibold text-gray-900">Rules <HelpTip text={PRECEDENCE} /></h2>
              <p className="text-sm text-gray-600">One rule of each kind applies per sale (the most specific match wins) and kinds add up. Rules apply in every scenario unless tagged with one.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setStandardOpen(true)}>
                <Sparkles className="mr-1.5 h-4 w-4" /> Add standard rules
              </Button>
              <Button size="sm" onClick={() => openAdd()} className="bg-orange-600 text-white hover:bg-orange-700">
                <Plus className="mr-1.5 h-4 w-4" /> Add rule
              </Button>
            </div>
          </div>

          {loadError && <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-800">{loadError}</Card>}

          {loaded && !loadError && rules.length === 0 && (
            <Card className="border-dashed p-8 text-center">
              <h3 className="text-base font-semibold text-gray-900">No discounts or allowances yet</h3>
              <p className="mx-auto mt-1 max-w-xl text-sm text-gray-600">
                Right now net sales equals gross sales. Start with the standard rules (2% terms, 1% chargebacks,
                excise tax included in the price on rifles and pistols) and adjust them, or add your own.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <Button onClick={() => setStandardOpen(true)} className="bg-orange-600 text-white hover:bg-orange-700">
                  <Sparkles className="mr-1.5 h-4 w-4" /> Add standard rules
                </Button>
                <Button variant="outline" onClick={() => openAdd()}>Add a rule</Button>
              </div>
            </Card>
          )}

          {rules.length > 0 && groups.map((group) => (
            <RuleGroup
              key={group.type}
              group={group}
              customers={customers}
              products={products}
              scenarios={scenarios}
              usage={preview?.ruleUsage}
              hasSales={hasSales}
              onAdd={openAdd}
              onEdit={(rule) => setModal({ open: true, rule, defaults: null })}
              onDelete={remove}
              onToggle={toggle}
              busyId={busyId}
            />
          ))}
        </div>

        <div className="min-[1400px]:sticky min-[1400px]:top-16 min-[1400px]:self-start">
          <DeductionExample
            customers={customers}
            products={products}
            customerTypes={customerTypes}
            productTypes={productTypes}
            scenario={scenario}
            rules={rules}
            refreshKey={version}
          />
          <p className="mt-3 px-1 text-xs text-gray-500">
            Excise tax included in the price: tax = invoice × rate ÷ (1 + rate). At 11%, a {formatMoney(1110)} invoice carries {formatMoney(110)} of tax and {formatMoney(1000)} of sales.
          </p>
        </div>
      </div>

      {hasSales && preview.byCustomerType.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-gray-100 px-5 py-3">
            <h3 className="text-sm font-semibold text-gray-900">By customer type</h3>
            <p className="text-xs text-gray-500">What the rules take off each customer type in {scenario?.name}.</p>
          </div>
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-[11px] font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-5 py-2">Customer type</th>
                <th className="px-3 py-2 text-right">Gross sales</th>
                <th className="px-3 py-2 text-right">Deductions</th>
                <th className="px-3 py-2 text-right">% of gross</th>
                <th className="px-3 py-2 text-right">Net sales</th>
                <th className="px-5 py-2 text-right">Commissions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {preview.byCustomerType.map((r) => (
                <tr key={r.customer_type}>
                  <td className="px-5 py-2 text-gray-900">{r.customer_type}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{compactMoney(r.gross)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.deductions ? `(${compactMoney(r.deductions)})` : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">{r.gross ? `${((r.deductions / r.gross) * 100).toFixed(1)}%` : '—'}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{compactMoney(r.net)}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-gray-600">{r.commission ? compactMoney(r.commission) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <DeductionRuleModal
        open={modal.open}
        rule={modal.rule}
        defaults={modal.defaults}
        onClose={() => setModal({ open: false, rule: null, defaults: null })}
        onSave={saveRule}
        customers={customers}
        products={products}
        customerTypes={customerTypes}
        productTypes={productTypes}
        scenario={scenario}
      />
      <StandardRulesModal
        open={standardOpen}
        onClose={() => setStandardOpen(false)}
        onCreate={createStandard}
        productTypes={productTypes}
        existingRules={rules}
      />
    </div>
  );
};

export default DeductionsTab;
