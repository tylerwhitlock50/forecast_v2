import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Info, X } from 'lucide-react';
import { formatPeriodRanges } from '../utils/formatters';
import { COST_WARNING_LABELS } from '../utils/costWarnings';

// Plain-English titles for the warning codes the reporting API returns.
export const WARNING_TITLES = {
  cost_warnings: 'Incomplete product costs',
  no_deduction_rules: 'No sales deductions set up',
  non_monthly_sales_periods: 'Sales rows left out',
  default_assumptions: 'Default assumptions',
  opening_period_unset: 'No opening balance date',
  opening_period_invalid: 'Invalid opening balance date',
  window_before_opening: 'Window starts before the opening balances',
  opening_imbalance: 'Opening balances do not balance',
  cash_below_minimum: 'Cash below minimum',
  machine_over_capacity: 'Machine over capacity',
  labor_without_type: 'Labor without a labor type',
  missing_labor_rates: 'Labor types without a rate'
};

// Where to go to fix each warning.
export const WARNING_LINKS = {
  cost_warnings: [{ to: '/bom', label: 'Review BOMs' }, { to: '/routing', label: 'Review routings' }],
  no_deduction_rules: [{ to: '/pricing', label: 'Pricing & Deductions' }],
  non_monthly_sales_periods: [{ to: '/sales-forecast', label: 'Open the sales forecast' }],
  machine_over_capacity: [{ to: '/machines', label: 'Machines' }, { to: '/routing', label: 'Routings' }],
  labor_without_type: [{ to: '/routing', label: 'Review routings' }],
  missing_labor_rates: [{ to: '/labor-rates', label: 'Labor rates' }]
};

export const warningTitle = (w) => WARNING_TITLES[w?.code] || String(w?.code || 'Warning').replace(/_/g, ' ');

export const isInfoWarning = (w) => w?.level === 'info';

/** Split API warnings into info notes and real warnings (dropping any codes in `hide`). */
export const splitWarnings = (warnings, hide = []) => {
  const list = (warnings || []).filter(w => w && !hide.includes(w.code));
  return { info: list.filter(isInfoWarning), warnings: list.filter(w => !isInfoWarning(w)) };
};

const Links = ({ code }) => (
  (WARNING_LINKS[code] || []).map(link => (
    <Link key={link.to} to={link.to} className="whitespace-nowrap font-medium underline-offset-2 hover:underline">
      {link.label} →
    </Link>
  ))
);

const ProductList = ({ products }) => {
  const entries = Object.entries(products || {});
  if (entries.length === 0) return null;
  return (
    <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
      {entries.map(([unitId, codes]) => (
        <li key={unitId}>
          <span className="font-medium">{unitId}</span>
          <span className="text-amber-800">: {(codes || []).map(c => COST_WARNING_LABELS[c] || c).join(', ')}</span>
        </li>
      ))}
    </ul>
  );
};

const WarningItem = ({ w }) => {
  const [open, setOpen] = useState(false);
  const hasProducts = w.products && Object.keys(w.products).length > 0;
  return (
    <li className="text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold text-amber-900">{warningTitle(w)}</span>
        <span className="text-amber-900">{w.message}</span>
        {Array.isArray(w.periods) && w.periods.length > 0 && (
          <span className="text-amber-700">({formatPeriodRanges(w.periods)})</span>
        )}
        <span className="flex flex-wrap gap-3 text-amber-800"><Links code={w.code} /></span>
        {hasProducts && (
          <button type="button" className="text-xs font-medium text-amber-800 underline-offset-2 hover:underline" onClick={() => setOpen(o => !o)}>
            {open ? 'Hide products' : 'Show products'}
          </button>
        )}
      </div>
      {open && <ProductList products={w.products} />}
    </li>
  );
};

/**
 * Report warnings. Warnings render in an amber panel (dismissible); info-level
 * notes (level: 'info') render as a quiet slate note, because they explain the
 * numbers rather than flag a problem.
 */
const ReportWarnings = ({ warnings, hide = [], onDismiss, className = '' }) => {
  const { info, warnings: real } = splitWarnings(warnings, hide);
  if (info.length === 0 && real.length === 0) return null;
  return (
    <div className={`space-y-2 ${className}`} data-testid="report-warnings">
      {real.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-600" aria-hidden="true" />
          <ul className="flex-1 space-y-1.5">
            {real.map((w, i) => <WarningItem key={`${w.code}-${i}`} w={w} />)}
          </ul>
          {onDismiss && (
            <button type="button" onClick={onDismiss} className="rounded p-1 text-amber-700 hover:bg-amber-100" aria-label="Dismiss warnings">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      {info.map((w, i) => (
        <div key={`${w.code}-${i}`} className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" data-level="info">
          <Info className="mt-0.5 h-4 w-4 flex-none text-slate-500" aria-hidden="true" />
          <span className="flex-1">
            {w.message}{' '}
            <span className="ml-1 inline-flex flex-wrap gap-3 text-orange-700"><Links code={w.code} /></span>
          </span>
        </div>
      ))}
    </div>
  );
};

export default ReportWarnings;
