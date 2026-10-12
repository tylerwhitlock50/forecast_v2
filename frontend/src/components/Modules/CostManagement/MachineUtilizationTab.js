import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import MiniTrendChart from './MiniTrendChart';
import { ALL, machineView, periodLabel } from './costViews';
import { formatPeriodRanges } from '../ReportingAnalysis/utils/formatters';

const Row = ({ label, children, help, className = '' }) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className={`text-gray-600 ${help ? 'cursor-help border-b border-dotted border-gray-300' : ''}`} title={help}>{label}</span>
    <span className={`text-right font-semibold tabular-nums ${className}`}>{children}</span>
  </div>
);

const utilClass = (pct) => (pct === null || pct === undefined ? 'text-gray-500' : pct > 100 ? 'text-red-600' : pct >= 85 ? 'text-amber-600' : 'text-green-700');

/**
 * Machine hours against MONTHLY capacity. "All months" shows the average
 * month and the busiest month (never the window total over one month of
 * capacity); a single month shows that month.
 */
const MachineUtilizationTab = ({
  machines = [],
  periods = [],
  selectedPeriod,
  machineRates = {},
  formatCurrency,
  formatNumber,
}) => {
  const all = selectedPeriod === ALL;
  const cards = machines
    .map(machine => ({ machine, view: machineView(machine, selectedPeriod, periods) }))
    .filter(({ view }) => all || view.minutes > 0)
    .sort((a, b) => (b.view.peakUtilization ?? -1) - (a.view.peakUtilization ?? -1));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-xl">
          Machine utilization · {all ? `average month, ${periods.length ? `${periodLabel(periods[0])} – ${periodLabel(periods[periods.length - 1])}` : 'all months'}` : periodLabel(selectedPeriod)}
        </CardTitle>
        <p className="text-sm text-gray-600">
          Capacity is per month, so each machine is compared month by month.
          {all ? ' The busiest month is what limits output.' : ''}
        </p>
      </CardHeader>
      <CardContent>
        {cards.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">
            No machine time {all ? 'in this scenario' : `in ${periodLabel(selectedPeriod)}`}. Machine time comes from the routings of the products in the sales forecast.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {cards.map(({ machine, view }) => {
              const noCapacity = !(view.capacity > 0);
              const rate = machineRates[machine.machine_id];
              return (
                <Card key={machine.machine_id} className={view.overCapacity ? 'border-red-300' : ''}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="break-words text-lg leading-snug">{machine.machine_name || machine.machine_id}</CardTitle>
                        <div className="font-mono text-xs text-gray-500">{machine.machine_id}</div>
                      </div>
                      {noCapacity ? (
                        <Badge variant="outline" className="flex-none whitespace-nowrap">No capacity set</Badge>
                      ) : view.overCapacity ? (
                        <Badge variant="destructive" className="flex-none whitespace-nowrap">
                          {all ? `Over capacity ${view.overPeriods.length} mo` : 'Over capacity'}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="flex-none whitespace-nowrap border-green-300 text-green-700">Within capacity</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5 text-sm">
                      <Row label={all ? 'Avg minutes / month' : 'Minutes required'}>{formatNumber(view.minutes)}</Row>
                      <Row label="Capacity / month">{noCapacity ? '—' : formatNumber(view.capacity)}</Row>
                      <Row label={all ? 'Avg utilization' : 'Utilization'} className={utilClass(view.utilization)}>
                        {view.utilization === null ? '—' : `${view.utilization.toFixed(1)}%`}
                      </Row>
                      {all && (
                        <Row label="Peak month" className={utilClass(view.peakUtilization)} help="The busiest month in the window">
                          {view.peakPeriod
                            ? `${periodLabel(view.peakPeriod)}${view.peakUtilization !== null ? ` · ${view.peakUtilization.toFixed(1)}%` : ''}`
                            : '—'}
                        </Row>
                      )}
                      <Row label={all ? 'Machine cost (window)' : 'Machine cost'}>{formatCurrency(view.cost)}</Row>
                      {rate !== undefined && rate !== null && <Row label="Machine rate">{formatCurrency(rate)}/hr</Row>}
                    </div>

                    <div>
                      <div className="mb-1 text-xs font-medium text-gray-600">
                        {noCapacity ? 'Minutes by month' : 'Utilization by month (dashed line = capacity)'}
                      </div>
                      <MiniTrendChart
                        data={view.trend}
                        color="orange"
                        threshold={noCapacity ? null : 100}
                        highlight={all ? null : selectedPeriod}
                        formatValue={(v) => (noCapacity ? `${Math.round(v).toLocaleString('en-US')} min` : `${v.toFixed(1)}%`)}
                      />
                    </div>

                    {all && view.overPeriods.length > 0 && (
                      <div className="rounded border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
                        {view.overPeriods.length >= periods.length && periods.length > 1
                          ? 'Over capacity in every month of the window.'
                          : `Over capacity in ${formatPeriodRanges(view.overPeriods)}.`}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MachineUtilizationTab;
