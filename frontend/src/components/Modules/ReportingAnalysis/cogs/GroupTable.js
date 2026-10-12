import React from 'react';
import { cn } from '../../../../lib/utils';
import { formatPeriod } from '../utils/formatters';
import { GROUPINGS, DISPLAY_GROUP_COLUMNS, MONTHLY_METRICS, groupTotals, monthTotals, monthValue } from '../utils/cogsLabor';
import { SortHeader, fmt, tableWrap, tableClass, theadRow, stickyName } from './parts';

const NameCell = ({ row, className }) => {
  const second = [row.sub, row.type].filter(Boolean).join(' · ');
  return (
    <td className={cn('px-3 py-1 text-left whitespace-nowrap bg-white', stickyName, className)}>
      <div className="font-medium text-gray-900">{row.name}</div>
      {second && <div className="text-[10px] leading-tight text-gray-400">{second}</div>}
    </td>
  );
};

/**
 * Sales and contribution by product / customer / customer type.
 * view 'summary': one row per entity with the GROUP_COLUMNS metrics.
 * view 'monthly': one row per entity, a column per month for `metric`.
 */
const GroupTable = ({ rows, grouping, view = 'summary', metric = 'net_sales', periods = [], sort, onSort, testId }) => {
  const g = GROUPINGS[grouping];

  if (rows.length === 0) {
    return <p className="rounded-md border border-dashed border-gray-200 px-3 py-8 text-center text-sm text-gray-500">No sales in this window.</p>;
  }

  if (view === 'monthly') {
    const metricDef = MONTHLY_METRICS.find(m => m.key === metric) || MONTHLY_METRICS[0];
    const totals = monthTotals(rows, periods, metric);
    const grand = periods.reduce((s, p) => s + totals[p], 0);
    return (
      <div className={tableWrap}>
        <table data-testid={testId} className={tableClass}>
          <thead>
            <tr className={theadRow}>
              <SortHeader label={g.nameHeader} sortKey="name" sort={sort} onSort={onSort} align="left" className={cn(stickyName, 'bg-gray-100 min-w-[180px]')} />
              {periods.map(p => <th key={p} scope="col" className="px-2 py-2 text-right font-medium whitespace-nowrap min-w-[72px]">{formatPeriod(p)}</th>)}
              <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap bg-gray-200 text-gray-800">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const values = periods.map(p => monthValue(r, p, metric));
              return (
                <tr key={r.key} className="border-t border-gray-100 hover:bg-orange-50/40">
                  <NameCell row={r} />
                  {values.map((v, i) => (
                    <td key={periods[i]} className={cn('px-2 py-1.5 text-right whitespace-nowrap', v === 0 && 'text-gray-300')}>{fmt(v, metricDef.format)}</td>
                  ))}
                  <td className="px-3 py-1.5 text-right whitespace-nowrap bg-gray-50 font-medium">{fmt(values.reduce((a, b) => a + b, 0), metricDef.format)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
              <td className={cn('px-3 py-1.5 text-left bg-gray-50', stickyName)}>Total</td>
              {periods.map(p => <td key={p} className="px-2 py-1.5 text-right whitespace-nowrap">{fmt(totals[p], metricDef.format)}</td>)}
              <td className="px-3 py-1.5 text-right whitespace-nowrap bg-gray-100">{fmt(grand, metricDef.format)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  const totals = groupTotals(rows);
  return (
    <div className={tableWrap}>
      <table data-testid={testId} className={tableClass}>
        <thead>
          <tr className={theadRow}>
            <SortHeader label={g.nameHeader} sortKey="name" sort={sort} onSort={onSort} align="left" className={cn(stickyName, 'bg-gray-100 min-w-[180px]')} />
            {DISPLAY_GROUP_COLUMNS.map(c => (
              <SortHeader key={c.key} label={c.label} sortKey={c.key} sort={sort} onSort={onSort} help={c.help} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className="border-t border-gray-100 hover:bg-orange-50/40">
              <NameCell row={r} />
              {DISPLAY_GROUP_COLUMNS.map(c => (
                <td
                  key={c.key}
                  className={cn(
                    'px-2.5 py-1 text-right whitespace-nowrap',
                    c.format === 'deduction' && 'text-gray-600',
                    c.key === 'contribution_margin_pct' && r[c.key] < 0 && 'text-red-600',
                    c.key === 'contribution_margin' && r[c.key] < 0 && 'text-red-600'
                  )}
                >
                  <div>{fmt(r[c.key], c.format)}</div>
                  {c.perUnit && <div className="text-[10px] leading-tight text-gray-400">{fmt(r[c.perUnit], 'money2')} / unit</div>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
            <td className={cn('px-3 py-1.5 text-left bg-gray-50', stickyName)}>Total ({rows.length})</td>
            {DISPLAY_GROUP_COLUMNS.map(c => (
              <td key={c.key} className={cn('px-2.5 py-1 text-right whitespace-nowrap', c.format === 'deduction' && 'text-gray-600')}>
                <div>{fmt(totals[c.key], c.format)}</div>
                {c.perUnit && <div className="text-[10px] font-normal leading-tight text-gray-500">{fmt(totals[c.perUnit], 'money2')} / unit</div>}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

export default GroupTable;
