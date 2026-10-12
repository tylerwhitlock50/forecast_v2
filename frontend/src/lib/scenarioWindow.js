// Default reporting windows.
//
// Every report with a period picker opens on the active scenario's sales
// window instead of the current calendar year, so a 2027 budget opens on
// Jan–Dec 2027 rather than an empty 2026.
//
// A window is { start: 'YYYY-MM', end: 'YYYY-MM' }, inclusive on both ends.

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])/;

/** 'YYYY-MM' (or a longer 'YYYY-MM-DD') -> 'YYYY-MM'; anything else -> null. */
export const toPeriod = (value) => {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(PERIOD_RE);
  return m ? `${m[1]}-${m[2]}` : null;
};

export const isPeriod = (value) => toPeriod(value) !== null;

export const calendarYearWindow = (year) => ({ start: `${year}-01`, end: `${year}-12` });

export const currentYearWindow = (now = new Date()) => calendarYearWindow(now.getFullYear());

/**
 * The window a report should open on for a scenario:
 *   - its sales window (start_period..end_period) widened to the whole
 *     calendar year when it falls inside one year (2027-03..2027-10 -> 2027-01..2027-12);
 *   - the sales window as-is when it spans more than one calendar year;
 *   - the current calendar year when the scenario has no sales yet.
 */
export const defaultWindowForScenario = (scenario, now = new Date()) => {
  let start = toPeriod(scenario?.start_period);
  let end = toPeriod(scenario?.end_period);
  if (!start && !end) return currentYearWindow(now);
  if (!start) start = end;
  if (!end) end = start;
  if (start > end) [start, end] = [end, start];
  if (start.slice(0, 4) === end.slice(0, 4)) return calendarYearWindow(start.slice(0, 4));
  return { start, end };
};

/** Same rule over the union of several scenarios' sales windows (consolidation / comparison). */
export const defaultWindowForScenarios = (scenarios, now = new Date()) => {
  const list = (scenarios || []).filter(Boolean);
  const starts = list.map(s => toPeriod(s.start_period) || toPeriod(s.end_period)).filter(Boolean).sort();
  const ends = list.map(s => toPeriod(s.end_period) || toPeriod(s.start_period)).filter(Boolean).sort();
  if (starts.length === 0) return currentYearWindow(now);
  return defaultWindowForScenario({ start_period: starts[0], end_period: ends[ends.length - 1] }, now);
};

export const sameWindow = (a, b) => Boolean(a && b && a.start === b.start && a.end === b.end);

/** Inclusive month count of a window (0 when invalid). */
export const monthsInWindow = (window) => {
  const s = toPeriod(window?.start);
  const e = toPeriod(window?.end);
  if (!s || !e) return 0;
  const months = (Number(e.slice(0, 4)) - Number(s.slice(0, 4))) * 12 + (Number(e.slice(5, 7)) - Number(s.slice(5, 7))) + 1;
  return Math.max(months, 0);
};
