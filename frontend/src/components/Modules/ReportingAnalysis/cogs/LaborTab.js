import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Info } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { formatCurrency, formatPeriod } from '../utils/formatters';
import { LABOR_METRICS, laborMatrix, laborChartData } from '../utils/cogsLabor';
import { Segmented, TabIntro, fmt, tableWrap, tableClass, theadRow, stickyName } from './parts';

// Categorical series colors in fixed order (assigned by labor type id, never by rank).
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const UNASSIGNED_COLOR = '#9ca3af';

/** Stable color per labor type: sorted ids take the palette in order; 'unassigned' is gray. */
export const laborColors = (types) => {
  const ids = [...new Set((types || []).map(t => t.labor_type_id))].filter(id => id !== 'unassigned').sort();
  const map = { unassigned: UNASSIGNED_COLOR };
  ids.forEach((id, i) => { map[id] = SERIES_COLORS[i % SERIES_COLORS.length]; });
  return map;
};

const hoursFmt = (v) => `${Math.round(v || 0).toLocaleString('en-US')} h`;

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-gray-900">{label}</div>
      {[...payload].reverse().map(p => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-gray-600">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="tabular-nums text-gray-900">{hoursFmt(p.value)}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between gap-4 border-t border-gray-100 pt-1 font-medium text-gray-900">
        <span>Total</span><span className="tabular-nums">{hoursFmt(total)}</span>
      </div>
    </div>
  );
};

const LaborTab = ({ labor, loading, metric, onMetricChange, hoursPerFteInput, onHoursPerFteInput, onHoursPerFteCommit, hoursPerFteError }) => {
  const types = useMemo(() => labor?.by_labor_type || [], [labor]);
  const colors = useMemo(() => laborColors(types), [types]);
  const chartData = useMemo(() => laborChartData(labor), [labor]);
  const matrix = useMemo(() => laborMatrix(labor, metric), [labor, metric]);
  const metricDef = LABOR_METRICS.find(m => m.key === metric) || LABOR_METRICS[0];
  const cellFormat = metric === 'fte' ? 'decimal1' : 'number';
  const byProduct = labor?.by_product || [];
  const showMachineHours = byProduct.some(p => typeof p.machine_hours === 'number');
  const note = labor?.payroll_note;

  const controls = (
    <>
      <Segmented
        label="Show"
        options={LABOR_METRICS.map(m => ({ value: m.key, label: m.label }))}
        value={metric}
        onChange={onMetricChange}
      />
      <label className="flex items-center gap-2 text-xs text-gray-600" title="Paid hours per person per month: 40 h × 52 weeks ÷ 12 = 173.33">
        <span className="cursor-help border-b border-dotted border-gray-400">Hours per FTE</span>
        <input
          type="number"
          min="1"
          step="0.01"
          aria-label="Hours per FTE"
          value={hoursPerFteInput}
          onChange={e => onHoursPerFteInput(e.target.value)}
          onBlur={onHoursPerFteCommit}
          onKeyDown={e => { if (e.key === 'Enter') onHoursPerFteCommit(); }}
          className={cn('h-8 w-24 rounded-md border px-2 text-right text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-orange-500',
            hoursPerFteError ? 'border-red-400' : 'border-gray-300')}
        />
      </label>
    </>
  );

  if (!labor) {
    return (
      <>
        <TabIntro right={controls}>Direct labor hours, cost and full-time equivalents (FTE) needed to build the forecast, by labor type.</TabIntro>
        <p className="py-8 text-center text-sm text-gray-500">{loading ? 'Loading the labor forecast…' : 'The labor forecast is not available.'}</p>
      </>
    );
  }

  return (
    <div className="space-y-5">
      <TabIntro right={controls}>
        Direct labor hours, cost and full-time equivalents (FTE) needed to build the forecast: routing labor minutes × units sold, by labor type.
        FTE = hours ÷ {labor.hours_per_fte} paid hours per person per month.
      </TabIntro>
      {hoursPerFteError && <p className="-mt-3 text-xs text-red-600">{hoursPerFteError}</p>}

      {types.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-200 px-3 py-8 text-center text-sm text-gray-500">
          No routing labor minutes for the products sold in this window. Add labor minutes and a labor type to each routing step to see the labor plan.
        </p>
      ) : (
        <>
          <div className="rounded-md border border-gray-200 bg-white p-4" data-testid="labor-chart">
            <div className="mb-2 flex items-baseline justify-between">
              <h4 className="text-sm font-semibold text-gray-800">Direct labor hours by month</h4>
              <span className="text-xs text-gray-500">Stacked by labor type</span>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
                  <CartesianGrid vertical={false} stroke="#eef0f3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#d1d5db' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={56}
                    tickFormatter={v => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : v)} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(234, 88, 12, 0.06)' }} />
                  <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} formatter={value => <span className="text-gray-700">{value}</span>} />
                  {types.map((t, i) => (
                    <Bar
                      key={t.labor_type_id}
                      dataKey={t.labor_type_id}
                      name={t.labor_type_name}
                      stackId="hours"
                      fill={colors[t.labor_type_id]}
                      stroke="#ffffff"
                      strokeWidth={1}
                      radius={i === types.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className={tableWrap}>
            <table data-testid="labor-table" className={tableClass}>
              <thead>
                <tr className={theadRow}>
                  <th scope="col" className={cn('px-3 py-2 text-left font-medium bg-gray-100 min-w-[200px]', stickyName)}>
                    Labor type <span className="font-normal text-gray-500">({metricDef.label.toLowerCase()})</span>
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium whitespace-nowrap">Rate / hr</th>
                  {matrix.periods.map(p => <th key={p} scope="col" className="px-2 py-2 text-right font-medium whitespace-nowrap min-w-[64px]">{formatPeriod(p)}</th>)}
                  <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap bg-gray-200 text-gray-800">{matrix.totalLabel}</th>
                  {metric === 'fte' && <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap bg-gray-200 text-gray-800">Peak</th>}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map(r => (
                  <tr key={r.key} className="border-t border-gray-100 hover:bg-orange-50/40">
                    <td className={cn('px-3 py-1.5 text-left whitespace-nowrap bg-white', stickyName)}>
                      <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: colors[r.key] }} aria-hidden="true" />
                      <span className="font-medium text-gray-900">{r.name}</span>
                    </td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap text-gray-600">{r.rate === null || r.rate === undefined ? '—' : fmt(r.rate, 'money2')}</td>
                    {matrix.periods.map(p => <td key={p} className="px-2 py-1.5 text-right whitespace-nowrap">{fmt(r.values[p], cellFormat)}</td>)}
                    <td className="px-3 py-1.5 text-right whitespace-nowrap bg-gray-50 font-medium">{fmt(r.total, cellFormat)}</td>
                    {metric === 'fte' && <td className="px-3 py-1.5 text-right whitespace-nowrap bg-gray-50">{fmt(r.peak, cellFormat)}</td>}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                  <td className={cn('px-3 py-1.5 text-left bg-gray-50', stickyName)}>Total direct labor</td>
                  <td />
                  {matrix.periods.map(p => <td key={p} className="px-2 py-1.5 text-right whitespace-nowrap">{fmt(matrix.totalsRow.values[p], cellFormat)}</td>)}
                  <td className="px-3 py-1.5 text-right whitespace-nowrap bg-gray-100">{fmt(matrix.totalsRow.total, cellFormat)}</td>
                  {metric === 'fte' && <td className="px-3 py-1.5 text-right whitespace-nowrap bg-gray-100">{fmt(matrix.totalsRow.peak, cellFormat)}</td>}
                </tr>
              </tfoot>
            </table>
          </div>
          {metric === 'fte' && (
            <p className="-mt-3 text-xs text-gray-500">FTE does not add across months: the Average column is the mean monthly FTE and Peak the busiest month.</p>
          )}
        </>
      )}

      {note && (
        <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700" data-testid="payroll-note">
          <Info className="mt-0.5 h-4 w-4 flex-none text-slate-500" aria-hidden="true" />
          <div>
            <p>
              <span className="font-medium">Direct labor in COGS: {formatCurrency(note.direct_labor_cost, { maximumFractionDigits: 0, minimumFractionDigits: 0 })}</span>
              <span className="mx-2 text-slate-400">·</span>
              <span className="font-medium">Payroll (operating expense): {formatCurrency(note.payroll_cost, { maximumFractionDigits: 0, minimumFractionDigits: 0 })}</span>
            </p>
            <p className="mt-0.5 text-slate-600">{note.message}</p>
          </div>
        </div>
      )}

      {byProduct.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-gray-800">Labor by product</h4>
          <div className={tableWrap}>
            <table data-testid="labor-by-product" className={tableClass}>
              <thead>
                <tr className={theadRow}>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Product</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Units</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium" title="Routing labor minutes per unit ÷ 60">Labor hours / unit</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Labor hours</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Labor cost</th>
                  {showMachineHours && <th scope="col" className="px-3 py-2 text-right font-medium">Machine hours</th>}
                </tr>
              </thead>
              <tbody>
                {byProduct.map(p => (
                  <tr key={p.unit_id || p.unit_name} className="border-t border-gray-100 hover:bg-orange-50/40">
                    <td className="px-3 py-1.5 text-left whitespace-nowrap">
                      <span className="font-medium text-gray-900">{p.unit_name || p.unit_id}</span>
                      {p.unit_name && p.unit_id && <span className="ml-2 font-mono text-[10px] text-gray-400">{p.unit_id}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right">{fmt(p.units, 'number')}</td>
                    <td className="px-3 py-1.5 text-right">{fmt(p.labor_hours_per_unit, 'money2')}</td>
                    <td className="px-3 py-1.5 text-right">{fmt(p.labor_hours, 'number')}</td>
                    <td className="px-3 py-1.5 text-right">{fmt(p.labor_cost, 'money')}</td>
                    {showMachineHours && <td className="px-3 py-1.5 text-right">{fmt(p.machine_hours, 'number')}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default LaborTab;
