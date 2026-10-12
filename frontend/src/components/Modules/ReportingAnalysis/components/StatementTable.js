import React from 'react';
import { cn } from '../../../../lib/utils';
import { formatAccounting, formatPct, formatPeriod } from '../utils/formatters';

/**
 * Reusable financial statement table.
 *
 * rows:    [{ key, label, kind: 'header'|'line'|'subtotal'|'total'|'pct', indent?, negate?, deduction?,
 *            format?: 'currency'|'number'|'pct', decimals?, help? }]
 *          negate:    show the value with the opposite sign (red when that is negative).
 *          deduction: an amount taken off the line above (sales deductions); shown in
 *                     parentheses in gray, never red, because it is expected, not a loss.
 *          neutral:   a signed adjustment (e.g. a variance) whose negative values are
 *                     favourable: parentheses, but not red.
 *          help:      tooltip on the row label explaining the line.
 * columns: [{ key, label?, values: { [rowKey]: number }, emphasis?: bool }]
 *          label defaults to formatPeriod(key) so plain 'YYYY-MM' keys render as "Jan 2026".
 *
 * Horizontally scrollable with a sticky first column, right-aligned numbers,
 * negatives in parentheses and red, percentages for 'pct' rows.
 */
const KIND_ROW_CLASS = {
  header: 'bg-gray-50',
  line: '',
  subtotal: 'font-semibold border-t border-gray-300',
  total: 'font-bold border-t-2 border-gray-800 bg-gray-50',
  pct: 'text-gray-500 italic'
};

const INDENT_CLASS = ['', 'pl-6', 'pl-10', 'pl-14'];

export const formatCell = (value, row) => {
  if (row.kind === 'header') return '';
  const format = row.format || (row.kind === 'pct' ? 'pct' : 'currency');
  if (format === 'pct') return formatPct(value);
  let v = value;
  if ((row.negate || row.deduction) && typeof v === 'number') v = -v;
  return formatAccounting(v, { decimals: row.decimals || 0 });
};

const isNegative = (value, row) => {
  if (typeof value !== 'number' || row.deduction || row.neutral) return false;
  const v = row.negate ? -value : value;
  return v < 0 && Number(Math.abs(v).toFixed(2)) !== 0;
};

const StatementTable = ({ rows, columns, className, firstColumnLabel = '', testId = 'statement-table' }) => {
  if (!rows || !columns) return null;

  return (
    <div className={cn('overflow-x-auto rounded-md border border-gray-200', className)}>
      <table data-testid={testId} className="min-w-full text-xs leading-tight tabular-nums">
        <thead>
          <tr className="bg-gray-100 text-gray-600">
            <th
              scope="col"
              className="sticky left-0 z-10 bg-gray-100 px-3 py-2 text-left font-medium min-w-[200px] border-r border-gray-200"
            >
              {firstColumnLabel}
            </th>
            {columns.map(col => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  'px-2 py-2 text-right font-medium whitespace-nowrap min-w-[84px]',
                  col.emphasis && 'bg-gray-200 text-gray-800 border-l border-gray-300'
                )}
              >
                {col.label !== undefined ? col.label : formatPeriod(col.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const rowClass = KIND_ROW_CLASS[row.kind] || '';
            const isHeader = row.kind === 'header';
            return (
              <tr
                key={row.key}
                data-kind={row.kind}
                data-row={row.key}
                className={cn('border-b border-gray-100 hover:bg-blue-50/40', rowClass)}
              >
                <th
                  scope="row"
                  className={cn(
                    'sticky left-0 z-10 px-3 py-1 text-left whitespace-nowrap border-r border-gray-200',
                    isHeader ? 'font-semibold text-gray-800 uppercase tracking-wide text-[11px] bg-gray-50' : 'font-normal bg-white',
                    row.kind === 'subtotal' && 'font-semibold',
                    row.kind === 'total' && 'font-bold bg-gray-50',
                    INDENT_CLASS[row.indent || 0] || ''
                  )}
                  title={row.help}
                >
                  {row.help ? (
                    <span className="cursor-help border-b border-dotted border-gray-300">{row.label}</span>
                  ) : row.label}
                </th>
                {columns.map(col => {
                  const value = col.values ? col.values[row.key] : undefined;
                  const negative = !isHeader && isNegative(value, row);
                  return (
                    <td
                      key={col.key}
                      className={cn(
                        'px-2 py-1 text-right whitespace-nowrap',
                        negative && 'text-red-600',
                        row.deduction && 'text-gray-600',
                        col.emphasis && 'bg-gray-50 border-l border-gray-200',
                        row.kind === 'total' && col.emphasis && 'bg-gray-100'
                      )}
                    >
                      {isHeader ? '' : formatCell(value, row)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// Helper: build period columns (+ optional Total column) from by_period rows.
export const periodColumns = (byPeriod = [], totals = null, totalLabel = 'Total') => {
  const cols = byPeriod.map(row => ({ key: row.period, values: row }));
  if (totals) cols.push({ key: 'total', label: totalLabel, values: totals, emphasis: true });
  return cols;
};

export default StatementTable;
