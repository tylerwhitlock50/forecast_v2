import React, { useState } from 'react';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import {
  comparisonRows, describeScheduleChange, formatComparisonValue, formatDay, formatMoney, paymentStatusLabel,
} from './loanScheduleUtils';

const SAMPLE_ROWS = 6;

const Section = ({ title, children, testId }) => (
  <div className="space-y-2" data-testid={testId}>
    <h4 className="text-sm font-semibold text-slate-700">{title}</h4>
    {children}
  </div>
);

const KeptRows = ({ rows }) => (
  <div className="overflow-x-auto rounded-md border border-green-200">
    <table className="w-full text-sm">
      <thead className="bg-green-50 text-left text-xs text-green-900">
        <tr>
          <th className="px-3 py-2 font-medium">#</th>
          <th className="px-3 py-2 font-medium">Due</th>
          <th className="px-3 py-2 font-medium">Status</th>
          <th className="px-3 py-2 font-medium">Paid on</th>
          <th className="px-3 py-2 text-right font-medium">Amount</th>
          <th className="px-3 py-2 font-medium">Note</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={`${row.payment_id}-${row.payment_number}`} className="border-t border-green-100 bg-green-50/40">
            <td className="px-3 py-1.5 tabular-nums">{row.payment_number}</td>
            <td className="px-3 py-1.5 whitespace-nowrap">{formatDay(row.payment_date)}</td>
            <td className="px-3 py-1.5">
              <Badge variant={row.recorded ? 'success' : 'secondary'}>{paymentStatusLabel(row)}</Badge>
            </td>
            <td className="px-3 py-1.5 whitespace-nowrap">{formatDay(row.actual_payment_date)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">
              {formatMoney(row.actual_payment_amount ?? row.payment_amount)}
            </td>
            <td className="px-3 py-1.5 text-slate-600">{row.notes || ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const NewRows = ({ rows }) => {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll || rows.length <= SAMPLE_ROWS
    ? rows
    : [...rows.slice(0, SAMPLE_ROWS - 1), null, rows[rows.length - 1]];
  return (
    <div className="space-y-2">
      <div className="max-h-72 overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Due</th>
              <th className="px-3 py-2 text-right font-medium">Payment</th>
              <th className="px-3 py-2 text-right font-medium">Principal</th>
              <th className="px-3 py-2 text-right font-medium">Interest</th>
              <th className="px-3 py-2 text-right font-medium">Balance after</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (row === null ? (
              <tr key="gap" className="border-t">
                <td colSpan={6} className="px-3 py-1.5 text-center text-xs text-slate-500">
                  ... {rows.length - SAMPLE_ROWS} more installments ...
                </td>
              </tr>
            ) : (
              <tr key={`${row.payment_number}-${i}`} className="border-t">
                <td className="px-3 py-1.5 tabular-nums">{row.payment_number}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{formatDay(row.payment_date)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(row.payment_amount)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(row.principal_payment)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(row.interest_payment)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(row.remaining_balance)}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
      {rows.length > SAMPLE_ROWS && (
        <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Show fewer' : `Show all ${rows.length} installments`}
        </Button>
      )}
    </div>
  );
};

const RedatedRows = ({ rows }) => (
  <div className="max-h-60 overflow-auto rounded-md border">
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-600">
        <tr>
          <th className="px-3 py-2 font-medium">#</th>
          <th className="px-3 py-2 font-medium">Saved due date</th>
          <th className="px-3 py-2 font-medium">Calendar due date</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.payment_number} className="border-t">
            <td className="px-3 py-1.5 tabular-nums">{row.payment_number}</td>
            <td className="px-3 py-1.5 whitespace-nowrap text-slate-500 line-through">{formatDay(row.from_date, 'no date')}</td>
            <td className="px-3 py-1.5 whitespace-nowrap font-medium">{formatDay(row.to_date)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/**
 * What a loan edit or a schedule repair does to the payment schedule:
 * plain sentences, a before / after comparison, the history rows that are
 * kept as recorded, and the new or re-dated installments.
 */
const ScheduleChangePreview = ({ preview }) => {
  if (!preview) return null;
  const lines = describeScheduleChange(preview);
  const kept = (preview.kept_rows || []).filter(r => r.recorded);
  const newRows = preview.new_rows || [];
  const redated = preview.redated_rows || [];
  const warnings = preview.warnings || [];

  return (
    <div className="space-y-5" data-testid="schedule-change-preview">
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
        {lines.map(line => <li key={line}>{line}</li>)}
      </ul>

      {warnings.length > 0 && (
        <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
          {warnings.map(w => <p key={w}>{w}</p>)}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm" data-testid="schedule-comparison">
          <thead className="bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium" />
              <th className="px-3 py-2 text-right font-medium">Now</th>
              <th className="px-3 py-2 text-right font-medium">After</th>
            </tr>
          </thead>
          <tbody>
            {comparisonRows(preview).map(row => (
              <tr key={row.key} className="border-t">
                <td className="px-3 py-1.5 text-slate-700">{row.label}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{formatComparisonValue(row.before, row.kind)}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${row.changed ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
                  {formatComparisonValue(row.after, row.kind)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {kept.length > 0 && (
        <Section title="Kept exactly as recorded" testId="kept-rows">
          <KeptRows rows={kept} />
        </Section>
      )}

      {redated.length > 0 && (
        <Section title="Unpaid installments moved to their calendar dates (amounts unchanged)" testId="redated-rows">
          <RedatedRows rows={redated} />
        </Section>
      )}

      {newRows.length > 0 && (
        <Section title="New installments" testId="new-rows">
          <NewRows rows={newRows} />
        </Section>
      )}
    </div>
  );
};

export default ScheduleChangePreview;
