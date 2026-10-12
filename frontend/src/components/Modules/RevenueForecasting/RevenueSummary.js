import React from 'react';
import { cn } from '../../../lib/utils';
import { formatMoney, formatPrice, formatQty } from './revenueData';

const TONES = {
  default: { card: 'border-gray-200 bg-white', value: 'text-gray-900' },
  primary: { card: 'border-blue-200 bg-blue-50/50', value: 'text-blue-700' },
};

const Kpi = ({ title, value, subtitle, tone = 'default', help }) => {
  const t = TONES[tone] || TONES.default;
  return (
    <div className={cn('min-w-0 rounded-lg border px-4 py-3.5 shadow-sm', t.card)} title={help}>
      <div className="text-sm font-medium text-gray-500">{title}</div>
      <div className={cn('mt-1 truncate text-[clamp(1.05rem,1.45vw,1.5rem)] font-bold tabular-nums tracking-tight', t.value)}>{value}</div>
      {subtitle && <div className="mt-0.5 truncate text-xs text-gray-500">{subtitle}</div>}
    </div>
  );
};

/**
 * Headline numbers for the months on screen (and the customer-type filter).
 * `summary` comes from summarizeLines, so the cards always match the matrix,
 * in the monthly and the quarterly view alike.
 */
const RevenueSummary = ({ summary, windowLabel }) => (
  <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="revenue-summary">
    <Kpi
      title="Gross sales"
      tone="primary"
      value={formatMoney(summary.revenue)}
      subtitle={windowLabel}
      help="Quantity × unit price, before terms, chargebacks, other allowances and excise tax. Net sales are on the COGS & Labor Forecast screen."
    />
    <Kpi title="Units" value={formatQty(summary.quantity)} subtitle="Forecast quantity" />
    <Kpi title="Average price" value={formatPrice(summary.averagePrice)} subtitle="Gross sales ÷ units" />
    <Kpi title="Forecast lines" value={formatQty(summary.lines)} subtitle="Customer × product" />
    <Kpi
      title="Customers"
      value={formatQty(summary.customers)}
      subtitle={`${formatQty(summary.products)} product${summary.products === 1 ? '' : 's'} sold`}
      help="Customers and products with units in the months shown"
    />
  </div>
);

export default RevenueSummary;
