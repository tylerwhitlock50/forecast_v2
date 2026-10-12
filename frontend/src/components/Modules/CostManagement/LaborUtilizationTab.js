import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import MiniTrendChart from './MiniTrendChart';
import { ALL, laborView, periodLabel } from './costViews';

const Row = ({ label, children, help }) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className={`text-gray-600 ${help ? 'cursor-help border-b border-dotted border-gray-300' : ''}`} title={help}>{label}</span>
    <span className="text-right font-semibold tabular-nums">{children}</span>
  </div>
);

/**
 * Direct labor hours and FTE by labor type. "All months" shows the average
 * month and the busiest month (FTE is a monthly headcount, never the year's
 * hours over one month of hours); a single month shows that month.
 */
const LaborUtilizationTab = ({
  labor = [],
  periods = [],
  hoursPerFte,
  selectedPeriod,
  formatCurrency,
  formatNumber,
}) => {
  const all = selectedPeriod === ALL;
  const cards = labor
    .map(item => ({ item, view: laborView(item, selectedPeriod, periods, hoursPerFte) }))
    .filter(({ view }) => all || view.hours > 0)
    .sort((a, b) => b.view.hours - a.view.hours);
  const totalAvgFte = cards.reduce((sum, c) => sum + (c.view.fte || 0), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-xl">
          Direct labor &amp; FTE · {all ? `average month, ${periods.length ? `${periodLabel(periods[0])} – ${periodLabel(periods[periods.length - 1])}` : 'all months'}` : periodLabel(selectedPeriod)}
        </CardTitle>
        <p className="text-sm text-gray-600">
          FTE = hours in a month ÷ {formatNumber(hoursPerFte, 2)} paid hours per FTE.
          {cards.length > 0 && ` ${all ? 'Average' : 'This month'}: ${formatNumber(totalAvgFte, 1)} FTE across all labor types.`}
        </p>
      </CardHeader>
      <CardContent>
        {cards.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">
            No labor hours {all ? 'in this scenario' : `in ${periodLabel(selectedPeriod)}`}. Labor comes from the routings of the products in the sales forecast.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {cards.map(({ item, view }) => (
              <Card key={item.labor_type_id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="break-words text-lg leading-snug">{item.labor_type_name || item.labor_type_id}</CardTitle>
                      <div className="font-mono text-xs text-gray-500">{item.labor_type_id}</div>
                    </div>
                    <Badge variant="outline" className="flex-none whitespace-nowrap">
                      {formatNumber(view.fte, 1)} {all ? 'avg FTE' : 'FTE'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5 text-sm">
                    <Row label={all ? 'Avg hours / month' : 'Hours'}>{formatNumber(view.hours, 1)}</Row>
                    <Row label={all ? 'Avg FTE' : 'FTE'}>{formatNumber(view.fte, 2)}</Row>
                    {all && (
                      <Row label="Peak month" help="The busiest month in the window">
                        {view.peakPeriod ? `${periodLabel(view.peakPeriod)} · ${formatNumber(view.peakFte, 2)} FTE` : '—'}
                      </Row>
                    )}
                    {all && <Row label="Total hours (window)">{formatNumber(view.totalHours, 0)}</Row>}
                    {item.hourly_rate !== undefined && item.hourly_rate !== null && (
                      <Row label="Hourly rate">{formatCurrency(item.hourly_rate)}</Row>
                    )}
                    <Row label={all ? 'Labor cost (window)' : 'Labor cost'}>{formatCurrency(view.cost)}</Row>
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-medium text-gray-600">FTE by month</div>
                    <MiniTrendChart
                      data={view.trend}
                      color="green"
                      highlight={all ? null : selectedPeriod}
                      formatValue={(v) => `${v.toFixed(2)} FTE`}
                    />
                  </div>

                  {Array.isArray(item.products_involved) && item.products_involved.length > 0 && (
                    <div>
                      <div className="mb-1 text-xs font-medium text-gray-600">Products</div>
                      <div className="flex flex-wrap gap-1">
                        {item.products_involved.map((product) => (
                          <Badge key={product} variant="secondary" className="text-xs font-normal">{product}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default LaborUtilizationTab;
