import React, { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import {
  formatMoney,
  formatMoneyCompact,
  formatQty,
  formatShare,
  summarizeByCustomer,
  summarizeByProduct,
  summarizeBySegment,
  totalsByPeriod,
} from './revenueData';

const TOP_N = 10;
const BAR = '#ea580c'; // orange-600, the app's accent
const BAR_SOFT = '#fdba74'; // orange-300
const AXIS = { fontSize: 12, fill: '#4b5563' };

const truncate = (text, max = 22) => {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

const MoneyTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-gray-900">{row.name || label}</div>
      <div className="tabular-nums text-gray-700">Gross sales {formatMoney(row.revenue)}</div>
      <div className="tabular-nums text-gray-500">{formatQty(row.quantity)} units{row.share !== undefined ? ` · ${formatShare(row.share)}` : ''}</div>
    </div>
  );
};

/** Top-N horizontal bar chart; the rest are summed into "N others". */
const RankedBars = ({ rows, color = BAR, emptyText }) => {
  const data = useMemo(() => {
    if (rows.length <= TOP_N) return rows;
    const top = rows.slice(0, TOP_N - 1);
    const rest = rows.slice(TOP_N - 1);
    const other = rest.reduce((acc, r) => ({
      ...acc,
      revenue: acc.revenue + r.revenue,
      quantity: acc.quantity + r.quantity,
      share: (acc.share || 0) + (r.share || 0),
    }), { key: '__other', name: `${rest.length} others`, revenue: 0, quantity: 0, share: 0 });
    return [...top, other];
  }, [rows]);

  if (data.length === 0) return <div className="py-16 text-center text-sm text-gray-500">{emptyText}</div>;
  const height = Math.max(160, data.length * 34 + 40);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
        <XAxis type="number" tickFormatter={formatMoneyCompact} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" width={170} tick={AXIS} tickFormatter={(v) => truncate(v)} interval={0} />
        <Tooltip content={<MoneyTooltip />} cursor={{ fill: '#fff7ed' }} />
        <Bar dataKey="revenue" fill={color} radius={[0, 4, 4, 0]} isAnimationActive={false} maxBarSize={22}>
          <LabelList dataKey="revenue" position="right" formatter={formatMoneyCompact} style={{ fontSize: 11, fill: '#374151' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

const ChartCard = ({ title, subtitle, children, className }) => (
  <Card className={className}>
    <CardHeader className="pb-2">
      <CardTitle className="text-base">{title}</CardTitle>
      {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
    </CardHeader>
    <CardContent>{children}</CardContent>
  </Card>
);

/**
 * Charts for the months on screen. Every chart reads the same line
 * aggregation as the matrix, so quarterly and monthly views agree.
 */
const RevenueVisualizations = ({ lines, periods, months }) => {
  const byPeriod = useMemo(() => totalsByPeriod(lines, periods), [lines, periods]);
  const byProduct = useMemo(() => summarizeByProduct(lines, months), [lines, months]);
  const byCustomer = useMemo(() => summarizeByCustomer(lines, months), [lines, months]);
  const bySegment = useMemo(() => summarizeBySegment(lines, months), [lines, months]);
  const empty = byProduct.length === 0;

  if (empty) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-gray-600">No sales in the selected months.</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <ChartCard title="Gross sales by period" subtitle="Quantity × unit price for every line, before deductions.">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={byPeriod} margin={{ top: 20, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis dataKey="short" tick={AXIS} interval={0} tickLine={false} />
            <YAxis tickFormatter={formatMoneyCompact} tick={AXIS} width={64} axisLine={false} tickLine={false} />
            <Tooltip content={<MoneyTooltip />} cursor={{ fill: '#fff7ed' }} />
            <Bar dataKey="revenue" fill={BAR} radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={48}>
              <LabelList dataKey="revenue" position="top" formatter={formatMoneyCompact} style={{ fontSize: 11, fill: '#374151' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ChartCard title="By customer type" subtitle="Share of gross sales in the selected months.">
          <RankedBars rows={bySegment} color={BAR} emptyText="No sales" />
        </ChartCard>
        <ChartCard title="By product" subtitle={byProduct.length > TOP_N ? `Top ${TOP_N - 1} of ${byProduct.length} products` : `${byProduct.length} products`}>
          <RankedBars rows={byProduct} color={BAR_SOFT} emptyText="No sales" />
        </ChartCard>
        <ChartCard
          className="xl:col-span-2"
          title="By customer"
          subtitle={byCustomer.length > TOP_N ? `Top ${TOP_N - 1} of ${byCustomer.length} customers` : `${byCustomer.length} customers`}
        >
          <RankedBars rows={byCustomer} color={BAR_SOFT} emptyText="No sales" />
        </ChartCard>
      </div>
    </div>
  );
};

export default RevenueVisualizations;
