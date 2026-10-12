import React from 'react';
import { Badge } from '../../../ui/badge';
import { formatPeriod } from '../utils/formatters';

const sortScenarios = (scenarios) =>
  Object.values(scenarios || {}).sort(
    (a, b) => (b.is_base ? 1 : 0) - (a.is_base ? 1 : 0) || (a.name || '').localeCompare(b.name || '')
  );

const WindowLabel = ({ scenario }) =>
  scenario.start_period ? (
    <span className="text-xs text-gray-500">
      {formatPeriod(scenario.start_period)} – {formatPeriod(scenario.end_period)}
    </span>
  ) : (
    <span className="text-xs text-gray-400">no sales yet</span>
  );

/**
 * Picks scenarios for Reporting.
 *
 * mode="single": one scenario (a select), with an optional "consolidate"
 *   switch that turns it into a multi-select whose statements are SUMMED.
 * mode="multi": checkboxes for side-by-side comparison, between `min` and
 *   `max` scenarios.
 */
const ScenarioPicker = ({
  scenarios,
  selected = [],
  onChange,
  mode = 'single',
  consolidate = false,
  onConsolidateChange,
  min = 1,
  max = 4,
}) => {
  const list = sortScenarios(scenarios);

  if (list.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-gray-500">
        No scenarios yet. Create one under Scenarios.
      </div>
    );
  }

  const toggle = (id) => {
    if (selected.includes(id)) {
      if (selected.length <= min) return;
      onChange(selected.filter(x => x !== id));
    } else {
      if (selected.length >= max) return;
      onChange([...selected, id]);
    }
  };

  const multi = mode === 'multi' || consolidate;

  return (
    <div className="space-y-3">
      {mode === 'single' && !consolidate && (
        <select
          aria-label="Scenario"
          value={selected[0] || ''}
          onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}
          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
        >
          <option value="">Select a scenario…</option>
          {list.map(s => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.id}){s.is_base ? ' • base' : ''}
            </option>
          ))}
        </select>
      )}

      {multi && (
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
          {list.map(s => {
            const checked = selected.includes(s.id);
            const disabled = !checked && selected.length >= max;
            return (
              <label
                key={s.id}
                className={`flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-sm ${checked ? 'bg-orange-50' : 'hover:bg-gray-50'} ${disabled ? 'opacity-50' : ''}`}
              >
                <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(s.id)} className="h-4 w-4" />
                <span className="flex-1">
                  <span className="font-medium text-gray-900">{s.name}</span>
                  <span className="ml-2 font-mono text-xs text-gray-500">{s.id}</span>
                  {s.is_base && <Badge variant="secondary" className="ml-2">Base</Badge>}
                  <span className="ml-2"><WindowLabel scenario={s} /></span>
                </span>
              </label>
            );
          })}
        </div>
      )}

      {mode === 'single' && onConsolidateChange && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={consolidate}
            onChange={(e) => onConsolidateChange(e.target.checked)}
          />
          <span>
            <span className="font-medium">Consolidate several scenarios</span>
            <span className="block text-xs text-gray-500">
              Sums the selected scenarios into one set of statements (for example two product lines modelled separately). Assumptions come from the first one.
            </span>
          </span>
        </label>
      )}

      {mode === 'multi' && (
        <p className="text-xs text-gray-500">
          Pick {min} to {max} scenarios. {selected.length} selected.
        </p>
      )}
    </div>
  );
};

export default ScenarioPicker;
