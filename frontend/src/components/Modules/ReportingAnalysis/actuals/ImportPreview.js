import React from 'react';
import { AlertTriangle, CheckCircle, Info, Lock } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { formatAccounting, formatPeriod } from '../utils/formatters';
import { plural } from './actualsApi';

const money = (value) => formatAccounting(value, { decimals: 2 });
const MAX_LIST = 50;

// What the check found, in one sentence a finance person can act on.
export const previewHeadline = (report) => {
  if (!report) return null;
  const { outcome, rejected = 0 } = report;
  if (outcome === 'rejected') {
    if (report.closed_periods?.length) {
      const others = rejected ? ` ${plural(rejected, 'other row')} ${rejected === 1 ? 'has a problem' : 'have problems'} too.` : '';
      return { tone: 'error', title: 'This file changes closed months', text: `Nothing will be imported. Reopen the months below (with a reason) or take their rows out of the file.${others}` };
    }
    if (report.request_errors?.length) {
      return { tone: 'error', title: 'The file does not tie to the control total', text: report.request_errors.join(' ') };
    }
    return {
      tone: 'error',
      title: 'Nothing will be imported until these rows are fixed',
      text: `${plural(rejected, 'row')} ${rejected === 1 ? 'has a problem' : 'have problems'}. Fix the file and check it again, or tick "Import the valid rows" to leave ${rejected === 1 ? 'it' : 'them'} out.`
    };
  }
  if (outcome === 'unchanged') {
    return { tone: 'info', title: 'Nothing to import', text: 'Every amount in the file already matches what is stored.' };
  }
  if (outcome === 'partial') {
    return { tone: 'warning', title: 'Ready to import the valid rows', text: `${plural(rejected, 'row')} with problems will be left out.` };
  }
  return { tone: 'success', title: 'Ready to import', text: 'Every row checked out.' };
};

const TONES = {
  error: { box: 'border-red-200 bg-red-50 text-red-900', Icon: AlertTriangle, icon: 'text-red-600' },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-900', Icon: AlertTriangle, icon: 'text-amber-600' },
  info: { box: 'border-blue-200 bg-blue-50 text-blue-900', Icon: Info, icon: 'text-blue-600' },
  success: { box: 'border-green-200 bg-green-50 text-green-900', Icon: CheckCircle, icon: 'text-green-600' }
};

export const StatusBox = ({ tone = 'info', title, children, testId }) => {
  const style = TONES[tone] || TONES.info;
  const { Icon } = style;
  return (
    <div className={cn('flex gap-3 rounded-md border p-3 text-sm', style.box)} data-testid={testId} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon className={cn('h-5 w-5 flex-none', style.icon)} aria-hidden="true" />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="mt-0.5">{children}</div>}
      </div>
    </div>
  );
};

const Count = ({ label, value, tone }) => (
  <div className={cn('rounded-md border px-3 py-2', tone === 'bad' && value ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white')}>
    <div className="text-xs text-gray-500">{label}</div>
    <div className={cn('text-lg font-semibold tabular-nums', tone === 'bad' && value ? 'text-red-700' : 'text-gray-900')}>{value ?? 0}</div>
  </div>
);

const TotalsTable = ({ title, rows, labelKey, testId, invalidKey }) => (
  <div className="min-w-0">
    <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h5>
    <div className="overflow-x-auto rounded-md border border-gray-200">
      <table className="min-w-full text-xs tabular-nums" data-testid={testId}>
        <thead>
          <tr className="bg-gray-50 text-gray-600">
            <th className="px-2 py-1 text-left font-medium">{labelKey === 'period' ? 'Month' : 'Line'}</th>
            <th className="px-2 py-1 text-right font-medium">Rows</th>
            <th className="px-2 py-1 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const invalid = r[invalidKey] === false;
            return (
              <tr key={`${r[labelKey] ?? ''}|${r.label}`} className="border-t border-gray-100">
                <td className={cn('px-2 py-1 whitespace-nowrap', invalid ? 'text-red-700 italic' : 'text-gray-800')}>
                  {invalid ? `${r.label} (not recognised)` : r.label}
                </td>
                <td className="px-2 py-1 text-right text-gray-600">{r.rows}</td>
                <td className="px-2 py-1 text-right">{money(r.amount)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </div>
);

/** The dry-run (or refused-import) report: counts, problems, control total, totals by line and month. */
const ImportPreview = ({ report }) => {
  if (!report) return null;
  const headline = previewHeadline(report);
  const errors = report.errors || [];
  const totals = report.totals || { by_line_item: [], by_period: [], grand_total: 0 };
  const changed = (report.rows || []).filter(r => r.action === 'updated');
  const hasControl = report.control_total !== null && report.control_total !== undefined;

  return (
    <div className="space-y-4" data-testid="actuals-import-preview">
      <StatusBox tone={headline.tone} title={headline.title} testId="actuals-preview-status">
        {headline.text}
      </StatusBox>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="actuals-preview-counts">
        <Count label="New" value={report.inserted} />
        <Count label="Changed" value={report.updated} />
        <Count label="Unchanged" value={report.unchanged} />
        <Count label="Problems" value={report.rejected} tone="bad" />
      </div>

      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm" data-testid="actuals-control">
        <span className="text-gray-600">File total </span>
        <span className="font-semibold tabular-nums">{money(totals.grand_total)}</span>
        {hasControl ? (
          report.control_matches ? (
            <span className="ml-2 text-green-700">ties to the control total {money(report.control_total)}</span>
          ) : (
            <span className="ml-2 font-medium text-red-700">
              does not tie: control total {money(report.control_total)}, difference {money(report.control_difference)}
            </span>
          )
        ) : (
          <span className="ml-2 text-gray-500">Enter a control total (e.g. from the trial balance) to check it.</span>
        )}
      </div>

      {report.closed_periods?.length > 0 && (
        <StatusBox tone="error" title="Closed months" testId="actuals-preview-closed">
          <ul className="list-inside list-disc">
            {report.closed_periods.map(c => (
              <li key={c.period}><Lock className="mr-1 inline h-3 w-3" aria-hidden="true" />{c.label || formatPeriod(c.period)}: {plural(c.rows, 'row')} would change</li>
            ))}
          </ul>
        </StatusBox>
      )}

      {errors.length > 0 && (
        <div>
          <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Rows with problems</h5>
          <div className="max-h-56 overflow-auto rounded-md border border-red-200">
            <table className="min-w-full text-xs" data-testid="actuals-preview-errors">
              <thead>
                <tr className="bg-red-50 text-red-900">
                  <th className="px-2 py-1 text-left font-medium w-14">Row</th>
                  <th className="px-2 py-1 text-left font-medium">Problem</th>
                </tr>
              </thead>
              <tbody>
                {errors.slice(0, MAX_LIST).map((e, i) => (
                  <tr key={`${e.row}-${i}`} className="border-t border-red-100 align-top">
                    <td className="px-2 py-1 tabular-nums text-gray-700">{e.row}</td>
                    <td className="px-2 py-1 text-gray-800">{e.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {errors.length > MAX_LIST && <p className="mt-1 text-xs text-gray-500">and {errors.length - MAX_LIST} more</p>}
        </div>
      )}

      {report.warnings?.length > 0 && (
        <ul className="space-y-1 text-xs text-amber-800" data-testid="actuals-preview-warnings">
          {report.warnings.map((w, i) => (
            <li key={i} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3 w-3 flex-none" aria-hidden="true" />{w}</li>
          ))}
        </ul>
      )}

      {totals.rows > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <TotalsTable title="Totals by line" rows={totals.by_line_item} labelKey="line_item" invalidKey="recognised" testId="actuals-totals-by-line" />
          <TotalsTable title="Totals by month" rows={totals.by_period} labelKey="period" invalidKey="valid" testId="actuals-totals-by-period" />
        </div>
      )}

      {changed.length > 0 && (
        <div>
          <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Amounts that change</h5>
          <div className="max-h-56 overflow-auto rounded-md border border-gray-200">
            <table className="min-w-full text-xs tabular-nums" data-testid="actuals-preview-changes">
              <thead>
                <tr className="bg-gray-50 text-gray-600">
                  <th className="px-2 py-1 text-left font-medium">Row</th>
                  <th className="px-2 py-1 text-left font-medium">Month</th>
                  <th className="px-2 py-1 text-left font-medium">Line</th>
                  <th className="px-2 py-1 text-right font-medium">Stored now</th>
                  <th className="px-2 py-1 text-right font-medium">From the file</th>
                </tr>
              </thead>
              <tbody>
                {changed.slice(0, MAX_LIST).map(r => (
                  <tr key={r.row} className="border-t border-gray-100">
                    <td className="px-2 py-1">{r.row}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{formatPeriod(r.period)}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{r.label}{r.reference_id ? ` (${r.reference_id})` : ''}</td>
                    <td className="px-2 py-1 text-right">{money(r.previous_amount)}</td>
                    <td className="px-2 py-1 text-right font-medium">{money(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {changed.length > MAX_LIST && <p className="mt-1 text-xs text-gray-500">and {changed.length - MAX_LIST} more</p>}
        </div>
      )}
    </div>
  );
};

export default ImportPreview;
