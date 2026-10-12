import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../../../lib/utils';
import { formatPeriod, formatPct } from '../utils/formatters';
import { isOverCapacity } from '../utils/cogsLabor';
import { TabIntro, fmt, tableWrap, tableClass, theadRow, stickyName } from './parts';

const utilClass = (u) => {
  if (typeof u !== 'number') return 'text-gray-400';
  if (u > 100) return 'text-red-700 font-semibold';
  if (u >= 85) return 'text-amber-700';
  return 'text-gray-500';
};

/** Machine hours needed per month against each machine's available hours. */
const MachinesTab = ({ labor, loading }) => {
  const machines = labor?.by_machine || [];
  const periods = labor?.periods || [];
  const anyOver = machines.some(m => (m.over_capacity_periods || []).length > 0
    || periods.some(p => isOverCapacity(m.by_period?.[p]?.utilization_pct)));
  const noCapacity = machines.filter(m => !m.available_hours_per_month);

  return (
    <div className="space-y-4">
      <TabIntro>
        Machine hours the plan needs each month (routing machine minutes × units sold) against each machine's available hours.
        Utilization over 100% means the plan needs more machine time than is available.
      </TabIntro>

      {!labor ? (
        <p className="py-8 text-center text-sm text-gray-500">{loading ? 'Loading machine hours…' : 'Machine hours are not available.'}</p>
      ) : machines.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-200 px-3 py-8 text-center text-sm text-gray-500">
          No routing machine minutes for the products sold in this window.
        </p>
      ) : (
        <>
          <div className={tableWrap}>
            <table data-testid="machines-table" className={tableClass}>
              <thead>
                <tr className={theadRow}>
                  <th scope="col" className={cn('px-3 py-2 text-left font-medium bg-gray-100 min-w-[200px]', stickyName)}>Machine</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium whitespace-nowrap" title="available_minutes_per_month ÷ 60, from Machines">Available h / mo</th>
                  {periods.map(p => <th key={p} scope="col" className="px-2 py-2 text-right font-medium whitespace-nowrap min-w-[64px]">{formatPeriod(p)}</th>)}
                  <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap bg-gray-200 text-gray-800">Total hours</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap bg-gray-200 text-gray-800">Peak use</th>
                </tr>
              </thead>
              <tbody>
                {machines.map(m => (
                  <tr key={m.machine_id} className="border-t border-gray-100 align-top">
                    <td className={cn('px-3 py-1.5 text-left whitespace-nowrap bg-white', stickyName)}>
                      <div className="font-medium text-gray-900">{m.machine_name || m.machine_id}</div>
                      <div className="text-[10px] text-gray-400">
                        {m.machine_id}{typeof m.machine_rate === 'number' ? ` · $${fmt(m.machine_rate, 'money2')}/h` : ''}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap text-gray-600">
                      {m.available_hours_per_month ? fmt(m.available_hours_per_month, 'number') : <span className="text-gray-400" title="No capacity set on the machine">—</span>}
                    </td>
                    {periods.map(p => {
                      const b = m.by_period?.[p] || {};
                      const over = isOverCapacity(b.utilization_pct);
                      return (
                        <td key={p} className={cn('px-2 py-1 text-right whitespace-nowrap', over && 'bg-red-50')} data-over={over ? 'true' : undefined}>
                          <div className={cn(over ? 'text-red-800 font-semibold' : 'text-gray-900')}>{fmt(b.hours, 'number')}</div>
                          <div className={cn('text-[10px]', utilClass(b.utilization_pct))}>
                            {typeof b.utilization_pct === 'number' ? formatPct(b.utilization_pct, { decimals: 0 }) : '—'}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-right whitespace-nowrap bg-gray-50 font-medium">{fmt(m.totals?.hours, 'number')}</td>
                    <td className={cn('px-3 py-1.5 text-right whitespace-nowrap bg-gray-50', utilClass(m.totals?.peak_utilization_pct))}>
                      {typeof m.totals?.peak_utilization_pct === 'number' ? formatPct(m.totals.peak_utilization_pct, { decimals: 0 }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-gray-500">
            <span>Each cell: hours needed, and below it % of available hours.</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-100 ring-1 ring-red-300" /> Over 100%: not enough capacity</span>
            <span className="text-amber-700">85–100%: tight</span>
            {anyOver && <Link to="/machines" className="font-medium text-orange-700 hover:underline">Review machine capacity →</Link>}
          </div>
          {noCapacity.length > 0 && (
            <p className="text-xs text-gray-500">
              {noCapacity.map(m => m.machine_name || m.machine_id).join(', ')} {noCapacity.length === 1 ? 'has' : 'have'} no available hours set, so utilization cannot be calculated.{' '}
              <Link to="/machines" className="font-medium text-orange-700 hover:underline">Set capacity on Machines</Link>.
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default MachinesTab;
