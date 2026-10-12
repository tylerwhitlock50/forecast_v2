import React from 'react';
import api from '../../../lib/apiClient';

// What a customer or product delete would take with it: the sales rows that
// use it, per scenario, so the confirm dialog can say so in plain words.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Sales rows -> { rows, revenue, scenarios: [{ id, name, rows, revenue }] },
 * largest scenario first. Revenue is quantity x unit price.
 */
export const summarizeDependencies = (salesRows, scenarios = {}) => {
  const byScenario = new Map();
  (salesRows || []).forEach(sale => {
    const id = sale?.forecast_id || '(none)';
    const entry = byScenario.get(id) || { id, name: scenarios?.[id]?.name || id, rows: 0, revenue: 0 };
    entry.rows += 1;
    entry.revenue += num(sale.quantity) * num(sale.unit_price);
    byScenario.set(id, entry);
  });
  const list = Array.from(byScenario.values()).sort((a, b) => b.rows - a.rows || String(a.name).localeCompare(String(b.name)));
  return {
    rows: list.reduce((s, x) => s + x.rows, 0),
    revenue: list.reduce((s, x) => s + x.revenue, 0),
    scenarios: list,
  };
};

/** GET every sales row (all scenarios) for one customer_id or unit_id. */
export const fetchSalesDependencies = async (field, id, scenarios) => {
  const res = await api.get(`/data/sales?${field}=${encodeURIComponent(id)}`, { suppressErrorToast: true });
  return summarizeDependencies(res?.data || [], scenarios);
};

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Confirm-dialog body listing the sales rows a delete removes. */
export const DependencyList = ({ name, deps, noun = 'customer' }) => {
  if (!deps || deps.rows === 0) {
    return (
      <p className="text-sm text-gray-600">
        <span className="font-medium text-gray-900">{name}</span> has no sales in any scenario. This cannot be undone.
      </p>
    );
  }
  return (
    <div className="space-y-3 text-sm text-gray-700">
      <p>
        <span className="font-medium text-gray-900">{name}</span> has{' '}
        <span className="font-medium text-gray-900">{deps.rows.toLocaleString('en-US')} sales row{deps.rows === 1 ? '' : 's'}</span>{' '}
        ({money.format(deps.revenue)} gross sales):
      </p>
      <ul className="space-y-1 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
        {deps.scenarios.map(s => (
          <li key={s.id} className="flex justify-between gap-4 tabular-nums">
            <span>{s.name}</span>
            <span className="text-gray-600">{s.rows.toLocaleString('en-US')} rows · {money.format(s.revenue)}</span>
          </li>
        ))}
      </ul>
      <p className="font-medium text-red-700">
        Deleting the {noun} also deletes these sales rows in every scenario listed. This cannot be undone.
      </p>
    </div>
  );
};
