import React from 'react';
import { Button } from '../../../ui/button';
import { cn } from '../../../../lib/utils';
import { formatPeriod } from '../utils/formatters';
import { monthsInWindow, sameWindow } from '../../../../lib/scenarioWindow';

const MONTHS = [
  { value: '01', label: 'January', short: 'Jan' },
  { value: '02', label: 'February', short: 'Feb' },
  { value: '03', label: 'March', short: 'Mar' },
  { value: '04', label: 'April', short: 'Apr' },
  { value: '05', label: 'May', short: 'May' },
  { value: '06', label: 'June', short: 'Jun' },
  { value: '07', label: 'July', short: 'Jul' },
  { value: '08', label: 'August', short: 'Aug' },
  { value: '09', label: 'September', short: 'Sep' },
  { value: '10', label: 'October', short: 'Oct' },
  { value: '11', label: 'November', short: 'Nov' },
  { value: '12', label: 'December', short: 'Dec' }
];

export const calculateMonthsDifference = (start, end) => monthsInWindow({ start, end });

/**
 * Years offered in the pickers: a band around today plus a band around the
 * selected window, so a 2027 (or 2031) budget is always reachable.
 */
export const yearOptions = (period, now = new Date()) => {
  const current = now.getFullYear();
  const years = new Set();
  for (let y = current - 3; y <= current + 5; y += 1) years.add(y);
  [period?.start, period?.end].forEach(p => {
    const y = parseInt(String(p || '').slice(0, 4), 10);
    if (y) for (let d = -2; d <= 2; d += 1) years.add(y + d);
  });
  return [...years].sort((a, b) => a - b);
};

/** Keep start <= end: moving one bound past the other drags the other along. */
export const orderedWindow = (start, end, changed = 'start') => {
  if (start <= end) return { start, end };
  return changed === 'start' ? { start, end: start } : { start: end, end };
};

const pad = (n) => String(n).padStart(2, '0');

const selectClass = 'block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500';

/** Month + year selects for one end of the window. */
const MonthYear = ({ value, onChange, years, label, compact }) => {
  const [year, month] = value.split('-');
  return (
    <div className={cn('grid gap-2', compact ? 'grid-cols-[5rem_5.5rem]' : 'grid-cols-2')}>
      <select value={month} onChange={e => onChange(`${year}-${e.target.value}`)} className={selectClass} aria-label={`${label} month`}>
        {MONTHS.map(m => <option key={m.value} value={m.value}>{m.short}</option>)}
      </select>
      <select value={year} onChange={e => onChange(`${e.target.value}-${month}`)} className={selectClass} aria-label={`${label} year`}>
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
};

/**
 * Reporting window picker.
 *
 * period:          { start, end } 'YYYY-MM'
 * onPeriodChange:  (period) => void
 * defaultWindow:   the scenario's default window (offered as a quick pick)
 * compact:         one-line layout for page headers
 */
const ReportingControls = ({ period, onPeriodChange, defaultWindow, compact = false }) => {
  const years = yearOptions(period);
  const year = Number(period.start.slice(0, 4));
  const months = calculateMonthsDifference(period.start, period.end);
  const isDefault = sameWindow(period, defaultWindow);

  const setStart = (start) => onPeriodChange(orderedWindow(start, period.end, 'start'));
  const setEnd = (end) => onPeriodChange(orderedWindow(period.start, end, 'end'));
  const setYearRange = (y, m1 = 1, m2 = 12) => onPeriodChange({ start: `${y}-${pad(m1)}`, end: `${y}-${pad(m2)}` });

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <MonthYear value={period.start} onChange={setStart} years={years} label="Start" compact />
        <span className="text-gray-500">to</span>
        <MonthYear value={period.end} onChange={setEnd} years={years} label="End" compact />
        <span className="ml-1 text-xs text-gray-500 tabular-nums">{months} month{months === 1 ? '' : 's'}</span>
        {defaultWindow && !isDefault && (
          <button
            type="button"
            onClick={() => onPeriodChange(defaultWindow)}
            className="ml-1 text-xs font-medium text-orange-700 hover:underline"
          >
            Reset to scenario window
          </button>
        )}
      </div>
    );
  }

  const quick = [
    ...(defaultWindow ? [{
      label: `Scenario window (${formatPeriod(defaultWindow.start)} – ${formatPeriod(defaultWindow.end)})`,
      onClick: () => onPeriodChange(defaultWindow),
      active: isDefault
    }] : []),
    ...(sameWindow(defaultWindow, { start: `${year}-01`, end: `${year}-12` }) ? [] : [
      { label: `Full year ${year}`, onClick: () => setYearRange(year), active: period.start === `${year}-01` && period.end === `${year}-12` }
    ]),
    ...[1, 2, 3, 4].map(q => ({
      label: `Q${q} ${year}`,
      onClick: () => setYearRange(year, q * 3 - 2, q * 3),
      active: period.start === `${year}-${pad(q * 3 - 2)}` && period.end === `${year}-${pad(q * 3)}`
    })),
    { label: `← ${year - 1}`, onClick: () => setYearRange(year - 1), title: 'Previous calendar year' },
    { label: `${year + 1} →`, onClick: () => setYearRange(year + 1), title: 'Next calendar year' }
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">From</label>
          <MonthYear value={period.start} onChange={setStart} years={years} label="Start" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">To</label>
          <MonthYear value={period.end} onChange={setEnd} years={years} label="End" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {quick.map(q => (
          <Button
            key={q.label}
            variant="outline"
            size="sm"
            title={q.title}
            onClick={q.onClick}
            className={cn('h-8 px-2.5 text-xs', q.active && 'border-orange-300 bg-orange-50 text-orange-800 hover:bg-orange-100')}
          >
            {q.label}
          </Button>
        ))}
      </div>

      <p className="text-sm text-gray-600" data-testid="selected-window">
        <span className="font-medium text-gray-900">{formatPeriod(period.start)} – {formatPeriod(period.end)}</span>
        <span className="text-gray-500"> · {months} month{months === 1 ? '' : 's'}</span>
        {defaultWindow && (
          <span className="text-gray-500">{isDefault ? ' · the scenario window' : ' · custom window'}</span>
        )}
      </p>
    </div>
  );
};

export default ReportingControls;
