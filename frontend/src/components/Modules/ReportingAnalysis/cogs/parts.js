import React from 'react';
import { cn } from '../../../../lib/utils';
import { formatAccounting, formatPct } from '../utils/formatters';

/** Small segmented toggle (orange when selected). */
export const Segmented = ({ options, value, onChange, label, className }) => (
  <div role="group" aria-label={label} className={cn('inline-flex rounded-md border border-gray-300 bg-white p-0.5', className)}>
    {options.map(o => (
      <button
        key={o.value}
        type="button"
        aria-pressed={value === o.value}
        onClick={() => onChange(o.value)}
        className={cn(
          'rounded px-3 py-1 text-xs font-medium transition-colors',
          value === o.value ? 'bg-orange-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
        )}
      >
        {o.label}
      </button>
    ))}
  </div>
);

/** Format a number for a report cell. */
export const fmt = (value, format = 'money') => {
  switch (format) {
    case 'pct': return formatPct(value);
    case 'money2': return formatAccounting(value, { decimals: 2 });
    case 'deduction': return formatAccounting(typeof value === 'number' && value ? -value : 0);
    case 'decimal1': return formatAccounting(value, { decimals: 1 });
    case 'number':
    case 'money':
    default: return formatAccounting(value);
  }
};

/** Sortable column header. */
export const SortHeader = ({ label, sortKey, sort, onSort, help, align = 'right', className }) => {
  const active = sort?.key === sortKey;
  const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn('px-2.5 py-2 font-medium whitespace-nowrap', align === 'left' ? 'text-left' : 'text-right', className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={help}
        className={cn(
          'inline-flex items-center gap-1 hover:text-gray-900',
          active ? 'text-gray-900' : 'text-gray-600',
          help && 'cursor-help'
        )}
      >
        <span className={help ? 'border-b border-dotted border-gray-400' : undefined}>{label}</span>
        <span className="w-2 text-[10px] text-gray-400" aria-hidden="true">{active ? (sort.direction === 'asc' ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );
};

/** One-line description under the tab bar. */
export const TabIntro = ({ children, right }) => (
  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
    <p className="max-w-3xl text-sm text-gray-600">{children}</p>
    {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
  </div>
);

export const tableWrap = 'overflow-x-auto rounded-md border border-gray-200';
export const tableClass = 'min-w-full text-xs tabular-nums';
export const theadRow = 'bg-gray-100 text-gray-600';
export const stickyName = 'sticky left-0 z-10 border-r border-gray-200';

const KPI_TONES = {
  default: { card: 'border-gray-200 bg-white', value: 'text-gray-900' },
  primary: { card: 'border-blue-200 bg-blue-50/50', value: 'text-blue-600' },
  success: { card: 'border-green-200 bg-green-50/50', value: 'text-green-600' },
  danger: { card: 'border-red-200 bg-red-50/50', value: 'text-red-600' }
};

/** Compact headline figure (same look as ui/stats-card, tighter so five fit in a row). */
export const Kpi = ({ title, value, subtitle, tone = 'default', help }) => {
  const t = KPI_TONES[tone] || KPI_TONES.default;
  return (
    <div className={cn('rounded-lg border px-4 py-3.5 shadow-sm', t.card)} title={help}>
      <div className="text-sm font-medium text-gray-500">{title}</div>
      <div className={cn('mt-1 text-2xl font-bold tabular-nums tracking-tight', t.value)}>{value}</div>
      {subtitle && <div className="mt-0.5 text-xs text-gray-500">{subtitle}</div>}
    </div>
  );
};
