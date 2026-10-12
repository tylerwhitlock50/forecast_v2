import React, { useState, useEffect, useCallback } from 'react';
import { useAssumptions } from '../hooks/useAssumptions';
import { Card } from '../../../ui/card';
import { Button } from '../../../ui/button';
import { Input } from '../../../ui/input';
import { Label } from '../../../ui/label';
import { Select, SelectOption } from '../../../ui/select';
import { Badge } from '../../../ui/badge';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../../ui/modal';
import { formatAccounting, formatPeriod } from '../utils/formatters';

const FIELD_GROUPS = [
  {
    title: 'Opening balances',
    help: 'Balances as of the end of the opening period (the month before the reporting window starts). These seed the balance sheet.',
    fields: [
      { key: 'opening_period', label: 'Opening period', type: 'period', help: 'YYYY-MM. The balance sheet rolls forward from the month after this.' },
      { key: 'opening_cash', label: 'Opening cash', type: 'money' },
      { key: 'opening_accounts_receivable', label: 'Opening accounts receivable', type: 'money' },
      { key: 'opening_inventory', label: 'Opening inventory', type: 'money' },
      { key: 'opening_fixed_assets', label: 'Opening fixed assets (gross)', type: 'money' },
      { key: 'opening_accumulated_depreciation', label: 'Opening accumulated depreciation', type: 'money' },
      { key: 'opening_fixed_assets_remaining_life_months', label: 'Remaining life of opening fixed assets (months)', type: 'int', help: 'Used to depreciate the opening net fixed assets straight-line.' },
      { key: 'opening_accounts_payable', label: 'Opening accounts payable', type: 'money' },
      { key: 'opening_other_liabilities', label: 'Opening other liabilities', type: 'money' },
      { key: 'opening_equity', label: 'Opening equity', type: 'money', nullable: true, help: 'Leave blank to plug it so the opening balance sheet balances.' }
    ]
  },
  {
    title: 'Working capital days',
    help: 'Drive receivables, inventory and payables from revenue and COGS.',
    fields: [
      { key: 'dso_days', label: 'DSO (days sales outstanding)', type: 'int', help: 'Days of revenue held as accounts receivable.' },
      { key: 'dio_days', label: 'DIO (days inventory outstanding)', type: 'int', help: 'Days of COGS held as inventory.' },
      { key: 'dpo_days', label: 'DPO (days payable outstanding)', type: 'int', help: 'Days of COGS and expenses owed as accounts payable.' }
    ]
  },
  {
    title: 'Tax & cash',
    help: 'Income tax is applied to positive pre-tax income; the minimum cash balance only raises a warning.',
    fields: [
      { key: 'income_tax_rate', label: 'Income tax rate (%)', type: 'percent', help: 'Entered as a percent, e.g. 21.' },
      { key: 'minimum_cash_balance', label: 'Minimum cash balance', type: 'money', help: 'Periods where projected cash falls below this are flagged.' },
      { key: 'notes', label: 'Notes', type: 'text' }
    ]
  }
];

const ALL_FIELDS = FIELD_GROUPS.flatMap(g => g.fields);

// API values -> form strings (tax as percent).
export const toForm = (assumptions = {}) => {
  const form = {};
  ALL_FIELDS.forEach(f => {
    const v = assumptions[f.key];
    if (f.type === 'percent') {
      form[f.key] = v === null || v === undefined ? '' : String(Math.round(parseFloat(v) * 100 * 10000) / 10000);
    } else {
      form[f.key] = v === null || v === undefined ? '' : String(v);
    }
  });
  return form;
};

// Form strings -> API payload (tax as decimal, blank nullable -> null).
export const fromForm = (form) => {
  const payload = {};
  ALL_FIELDS.forEach(f => {
    const raw = form[f.key];
    if (f.type === 'text' || f.type === 'period') {
      payload[f.key] = raw === '' || raw === undefined ? null : raw;
    } else if (raw === '' || raw === undefined || raw === null) {
      payload[f.key] = f.nullable ? null : 0;
    } else if (f.type === 'percent') {
      payload[f.key] = parseFloat(raw) / 100;
    } else if (f.type === 'int') {
      payload[f.key] = parseInt(raw, 10) || 0;
    } else {
      payload[f.key] = parseFloat(raw) || 0;
    }
  });
  return payload;
};

const EMPTY_CAPEX = {
  asset_name: '',
  category: '',
  amount: '',
  purchase_period: '',
  useful_life_months: '60',
  salvage_value: '0',
  depreciation_method: 'straight_line',
  description: '',
  is_active: true
};

const CapexModal = ({ item, forecastId, defaultPeriod, onSave, onClose }) => {
  const [form, setForm] = useState(() =>
    item
      ? {
          asset_name: item.asset_name || '',
          category: item.category || '',
          amount: item.amount ?? '',
          purchase_period: item.purchase_period || '',
          useful_life_months: item.useful_life_months ?? '60',
          salvage_value: item.salvage_value ?? '0',
          depreciation_method: item.depreciation_method || 'straight_line',
          description: item.description || '',
          is_active: item.is_active === undefined ? true : Boolean(item.is_active)
        }
      : { ...EMPTY_CAPEX, purchase_period: defaultPeriod || '' }
  );
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const submit = async () => {
    if (!form.asset_name.trim()) return setError('Asset name is required.');
    if (!/^\d{4}-\d{2}$/.test(form.purchase_period)) return setError('Purchase period must be YYYY-MM.');
    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount < 0) return setError('Amount must be a non-negative number.');
    setBusy(true);
    setError(null);
    try {
      await onSave({
        asset_name: form.asset_name.trim(),
        category: form.category || null,
        amount,
        purchase_period: form.purchase_period,
        useful_life_months: parseInt(form.useful_life_months, 10) || 0,
        salvage_value: parseFloat(form.salvage_value) || 0,
        depreciation_method: form.depreciation_method,
        description: form.description || null,
        is_active: form.is_active,
        forecast_id: forecastId
      });
    } catch (err) {
      setError(err.userMessage || err.message || 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal>
      <ModalHeader>
        <ModalTitle>{item ? 'Edit capital expenditure' : 'Add capital expenditure'}</ModalTitle>
        <ModalClose onClick={onClose} />
      </ModalHeader>
      <ModalContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <Label htmlFor="capex-name">Asset name</Label>
            <Input id="capex-name" value={form.asset_name} onChange={e => set('asset_name', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="capex-category">Category</Label>
            <Input id="capex-category" value={form.category} onChange={e => set('category', e.target.value)} placeholder="Equipment, vehicles..." />
          </div>
          <div>
            <Label htmlFor="capex-amount">Amount</Label>
            <Input id="capex-amount" type="number" step="0.01" value={form.amount} onChange={e => set('amount', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="capex-period">Purchase period</Label>
            <Input id="capex-period" placeholder="YYYY-MM" value={form.purchase_period} onChange={e => set('purchase_period', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="capex-life">Useful life (months)</Label>
            <Input id="capex-life" type="number" value={form.useful_life_months} onChange={e => set('useful_life_months', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="capex-salvage">Salvage value</Label>
            <Input id="capex-salvage" type="number" step="0.01" value={form.salvage_value} onChange={e => set('salvage_value', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="capex-method">Depreciation</Label>
            <Select id="capex-method" value={form.depreciation_method} onChange={e => set('depreciation_method', e.target.value)}>
              <SelectOption value="straight_line">Straight line</SelectOption>
              <SelectOption value="none">None</SelectOption>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="capex-desc">Description</Label>
            <Input id="capex-desc" value={form.description} onChange={e => set('description', e.target.value)} />
          </div>
          <div className="sm:col-span-2 flex items-center gap-2">
            <input id="capex-active" type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} className="h-4 w-4" />
            <Label htmlFor="capex-active">Active (included in the statements)</Label>
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </ModalContent>
      <ModalFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={submit} disabled={busy}>{busy ? 'Saving...' : 'Save'}</Button>
      </ModalFooter>
    </Modal>
  );
};

const AssumptionsPanel = ({ forecastId, forecastName, period, onChanged }) => {
  const {
    assumptions, defaults, capex, loading, saving, error,
    loadAssumptions, saveAssumptions, loadCapex, createCapex, updateCapex, deleteCapex
  } = useAssumptions();
  const [form, setForm] = useState(toForm({}));
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState(null);
  const [capexModal, setCapexModal] = useState(null); // null | { item: null|capex }

  const reload = useCallback(() => {
    loadAssumptions(forecastId);
    loadCapex(forecastId);
  }, [forecastId, loadAssumptions, loadCapex]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (assumptions) {
      setForm(toForm(assumptions));
      setDirty(false);
    }
  }, [assumptions]);

  const setField = (key, value) => {
    setForm(f => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    setMessage(null);
    const ok = await saveAssumptions(forecastId, fromForm(form));
    if (ok) {
      setDirty(false);
      setMessage({ type: 'success', text: 'Assumptions saved. Statements refreshed.' });
      if (onChanged) onChanged();
    } else {
      setMessage({ type: 'error', text: 'Failed to save assumptions.' });
    }
  };

  const handleResetToDefaults = () => {
    if (!defaults) return;
    setForm(toForm({ ...defaults, opening_period: form.opening_period }));
    setDirty(true);
  };

  const handleCapexSave = async (body) => {
    if (capexModal?.item) {
      await updateCapex(capexModal.item.capex_id, body);
    } else {
      await createCapex(body);
    }
    setCapexModal(null);
    await loadCapex(forecastId);
    if (onChanged) onChanged();
  };

  const handleCapexDelete = async (item) => {
    if (!window.confirm(`Delete "${item.asset_name}"?`)) return;
    try {
      await deleteCapex(item.capex_id);
      await loadCapex(forecastId);
      if (onChanged) onChanged();
    } catch {
      // toast shown by api client
    }
  };

  if (!forecastId) {
    return <p className="text-sm text-gray-500 py-6 text-center">Select a forecast to edit its assumptions.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-medium">Balance sheet assumptions</h3>
          <p className="text-sm text-gray-600">
            For <span className="font-medium">{forecastName || forecastId}</span>
            {assumptions && !assumptions.found && (
              <Badge variant="warning" className="ml-2">Using defaults — not saved yet</Badge>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleResetToDefaults} disabled={!defaults || saving}>Reset to defaults</Button>
          <Button size="sm" onClick={handleSave} disabled={saving || loading}>{saving ? 'Saving...' : dirty ? 'Save assumptions' : 'Saved'}</Button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && (
        <p className={message.type === 'error' ? 'text-sm text-red-600' : 'text-sm text-green-700'}>{message.text}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {FIELD_GROUPS.map(group => (
          <Card key={group.title} className="p-4 space-y-3">
            <div>
              <h4 className="font-semibold text-gray-800">{group.title}</h4>
              <p className="text-xs text-gray-500">{group.help}</p>
            </div>
            {group.fields.map(f => (
              <div key={f.key}>
                <Label htmlFor={`assump-${f.key}`} className="text-xs text-gray-700">{f.label}</Label>
                <Input
                  id={`assump-${f.key}`}
                  type={f.type === 'text' || f.type === 'period' ? 'text' : 'number'}
                  step={f.type === 'int' ? '1' : '0.01'}
                  placeholder={f.type === 'period' ? 'YYYY-MM' : f.nullable ? 'blank = plug' : ''}
                  className="h-8 mt-1"
                  value={form[f.key] ?? ''}
                  onChange={e => setField(f.key, e.target.value)}
                  disabled={loading}
                />
                {f.help && <p className="text-[11px] text-gray-500 mt-1">{f.help}</p>}
              </div>
            ))}
          </Card>
        ))}
      </div>

      {/* Capital expenditures */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-medium">Capital expenditures</h3>
            <p className="text-sm text-gray-600">Purchases flow through investing cash flow and are depreciated straight-line into operating expenses.</p>
          </div>
          <Button size="sm" onClick={() => setCapexModal({ item: null })}>Add capex</Button>
        </div>
        <div className="overflow-x-auto rounded-md border border-gray-200">
          <table data-testid="capex-table" className="min-w-full text-xs tabular-nums">
            <thead>
              <tr className="bg-gray-100 text-gray-600">
                <th className="px-3 py-2 text-left font-medium">Asset</th>
                <th className="px-3 py-2 text-left font-medium">Category</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-left font-medium">Purchase</th>
                <th className="px-3 py-2 text-right font-medium">Life (mo)</th>
                <th className="px-3 py-2 text-right font-medium">Salvage</th>
                <th className="px-3 py-2 text-left font-medium">Method</th>
                <th className="px-3 py-2 text-center font-medium">Active</th>
                <th className="px-3 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {capex.map(item => (
                <tr key={item.capex_id} className="border-t border-gray-100">
                  <td className="px-3 py-1 whitespace-nowrap font-medium">{item.asset_name}</td>
                  <td className="px-3 py-1 whitespace-nowrap text-gray-600">{item.category || '—'}</td>
                  <td className="px-3 py-1 text-right whitespace-nowrap">{formatAccounting(item.amount)}</td>
                  <td className="px-3 py-1 whitespace-nowrap">{formatPeriod(item.purchase_period)}</td>
                  <td className="px-3 py-1 text-right whitespace-nowrap">{item.useful_life_months}</td>
                  <td className="px-3 py-1 text-right whitespace-nowrap">{formatAccounting(item.salvage_value)}</td>
                  <td className="px-3 py-1 whitespace-nowrap">{item.depreciation_method === 'none' ? 'None' : 'Straight line'}</td>
                  <td className="px-3 py-1 text-center">{item.is_active ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-1 text-right whitespace-nowrap">
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setCapexModal({ item })}>Edit</Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-red-600" onClick={() => handleCapexDelete(item)}>Delete</Button>
                  </td>
                </tr>
              ))}
              {capex.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-500">No capital expenditures for this forecast.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {capexModal && (
        <CapexModal
          item={capexModal.item}
          forecastId={forecastId}
          defaultPeriod={period?.start}
          onSave={handleCapexSave}
          onClose={() => setCapexModal(null)}
        />
      )}
    </div>
  );
};

export default AssumptionsPanel;
