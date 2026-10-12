// Approval / lock helpers shared by the Scenarios page, the scenario bar and
// the History page. Pure functions only (no api client), so they and the
// dialogs that use them stay testable without axios.
import React from 'react';

/** True when the scenario is approved and locked (its own rows cannot change). */
export const isLocked = (scenario) => Boolean(scenario?.locked);

/** Badge text and colours for a scenario's status. */
export const statusOf = (scenario) => (isLocked(scenario)
  ? { key: 'approved', label: 'Approved & locked', tone: 'border-emerald-200 bg-emerald-50 text-emerald-800' }
  : { key: 'draft', label: 'Draft', tone: 'border-gray-200 bg-gray-50 text-gray-600' });

/**
 * The API stores times in UTC ('2026-10-12T15:21:51Z'; older rows may lack
 * the 'Z' or use a space). Parse as UTC so the local time shown is right.
 */
export const parseUtc = (value) => {
  if (!value) return null;
  let text = String(value).trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) text += 'T00:00:00Z';
  else if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) text += 'Z';
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** 'Oct 12, 2026, 3:21 PM' in the viewer's time zone ('' for nothing). */
export const formatWhen = (value) => {
  const date = parseUtc(value);
  if (!date) return value ? String(value) : '';
  return date.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
};

/** 'Oct 12, 2026' in the viewer's time zone. */
export const formatDay = (value) => {
  const date = parseUtc(value);
  if (!date) return value ? String(value) : '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** '3:21 PM' in the viewer's time zone. */
export const formatTime = (value) => {
  const date = parseUtc(value);
  if (!date) return '';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

/** $1,234 / -$1,234 */
export const money = (value) => (value === null || value === undefined || value === ''
  ? '–'
  : currency.format(Number(value) || 0));

/** +$1,234 / −$1,234 for a change. */
export const signedMoney = (value) => {
  const n = Number(value) || 0;
  if (n === 0) return '$0';
  return `${n > 0 ? '+' : '−'}${currency.format(Math.abs(n))}`;
};

/** Totals stored with an approval, in statement order. */
export const TOTAL_LINES = [
  ['gross_sales', 'Gross sales'],
  ['net_sales', 'Net sales'],
  ['total_cogs', 'Total COGS'],
  ['gross_profit', 'Gross profit'],
  ['operating_income', 'Operating income'],
  ['net_income', 'Net income'],
  ['closing_cash', 'Closing cash'],
];

/** The lines that moved since approval (empty when nothing moved or it was not checked). */
export const driftItems = (scenario) => (scenario?.drift?.changed ? scenario.drift.items || [] : []);

/** One sentence for a drift warning: 'Gross profit −$3,000, Net income −$2,370 since approval'. */
export const driftSummary = (scenario, max = 3) => {
  const items = driftItems(scenario);
  if (items.length === 0) return '';
  const shown = items.slice(0, max).map((item) => `${item.label || item.line} ${signedMoney(item.delta)}`);
  const more = items.length > max ? ` and ${items.length - max} more` : '';
  return `${shown.join(', ')}${more} since approval`;
};

/** 'Approved by Dana CFO on Oct 12, 2026' */
export const approvalLine = (scenario) => {
  if (!scenario?.approved_by && !scenario?.approved_at) return '';
  const who = scenario.approved_by ? ` by ${scenario.approved_by}` : '';
  const when = scenario.approved_at ? ` on ${formatDay(scenario.approved_at)}` : '';
  return `Approved${who}${when}`;
};

/** Small padlock icon (inherits the text colour). */
export const LockIcon = ({ className = 'h-3.5 w-3.5', title }) => (
  <svg
    className={className}
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden={title ? undefined : 'true'}
    role={title ? 'img' : undefined}
  >
    {title && <title>{title}</title>}
    <path
      fillRule="evenodd"
      d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
      clipRule="evenodd"
    />
  </svg>
);

/** Remembered approver / actor name for the dialogs (per browser; storage may be unavailable). */
const NAME_KEY = 'forecast.approverName';
export const rememberedName = () => {
  try {
    return window.localStorage.getItem(NAME_KEY) || '';
  } catch (err) {
    return '';
  }
};
export const rememberName = (name) => {
  try {
    if (name) window.localStorage.setItem(NAME_KEY, name);
  } catch (err) {
    // Private window or blocked storage: nothing to remember.
  }
};
