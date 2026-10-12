import React from 'react';
import { CalendarDays, Info } from 'lucide-react';
import { compactPeriodRange, describePeriodRange, scopeChips } from './pricingUtils';

const CHIP_TONES = {
  customer: 'border-purple-200 bg-purple-50 text-purple-800',
  customer_type: 'border-blue-200 bg-blue-50 text-blue-800',
  product: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  product_type: 'border-teal-200 bg-teal-50 text-teal-800',
  everyone: 'border-gray-200 bg-gray-50 text-gray-600',
};

const CHIP_PREFIX = {
  customer: 'Customer',
  customer_type: 'Customer type',
  product: 'Product',
  product_type: 'Product type',
  everyone: null,
};

/** "Applies to" chips: customer / customer type / product / product type, or Everyone; plus months and scenario when limited. */
export const ScopeChips = ({ rule, customers, products, scenarios, showLimits = false }) => (
  <div className="flex flex-wrap gap-1">
    {scopeChips(rule, { customers, products }).map((chip) => (
      <span
        key={`${chip.kind}-${chip.value}`}
        className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${CHIP_TONES[chip.kind]}`}
        title={CHIP_PREFIX[chip.kind] ? `${CHIP_PREFIX[chip.kind]}: ${chip.value}` : 'Every customer and product'}
      >
        {CHIP_PREFIX[chip.kind] && <span className="mr-1 opacity-60">{CHIP_PREFIX[chip.kind]}</span>}
        {chip.label}
      </span>
    ))}
    {showLimits && (rule.start_period || rule.end_period) && (
      <span className="inline-flex items-center whitespace-nowrap rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600" title={`Only for ${describePeriodRange(rule.start_period, rule.end_period)}`}>
        <CalendarDays className="mr-1 h-3 w-3 opacity-60" />{compactPeriodRange(rule.start_period, rule.end_period)}
      </span>
    )}
    {showLimits && rule.forecast_id && <ScopeBadge forecastId={rule.forecast_id} scenarios={scenarios} />}
  </div>
);

/** Company-wide vs this-scenario-only badge. */
export const ScopeBadge = ({ forecastId, scenarios }) => {
  if (!forecastId) {
    return <span className="inline-flex whitespace-nowrap rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600" title="Applies in every scenario">Company-wide</span>;
  }
  const name = scenarios?.[forecastId]?.name || forecastId;
  return (
    <span className="inline-flex max-w-[180px] truncate whitespace-nowrap rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] text-orange-800" title={`Only in scenario ${name} (${forecastId})`}>
      {name} only
    </span>
  );
};

/** Small on/off switch. */
export const Toggle = ({ checked, onChange, disabled, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={Boolean(checked)}
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-50 ${checked ? 'bg-orange-500' : 'bg-gray-300'}`}
  >
    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
  </button>
);

/** Labelled form field with an optional help line and error. */
export const Field = ({ label, htmlFor, help, error, children, className = '' }) => (
  <div className={`space-y-1 ${className}`}>
    {label && <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-800">{label}</label>}
    {children}
    {error ? <p className="text-xs text-red-600">{error}</p> : help ? <p className="text-xs text-gray-500">{help}</p> : null}
  </div>
);

/** An (i) icon with a native tooltip. */
export const HelpTip = ({ text }) => (
  <span className="inline-flex cursor-help align-middle text-gray-400 hover:text-gray-600" title={text} aria-label={text}>
    <Info className="h-3.5 w-3.5" />
  </span>
);

export const selectClass = 'h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:bg-gray-50';
export const inputClass = 'h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500';
