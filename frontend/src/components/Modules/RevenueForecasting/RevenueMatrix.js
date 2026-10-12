import React, { useCallback, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import ForecastGrid from '../../Common/ForecastGrid';
import { useForecast } from '../../../context/ForecastContext';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';

const MEASURES = [
  { key: 'quantity', label: 'Quantity', short: 'Qty' },
  { key: 'price', label: 'Unit price', short: 'Price' },
  { key: 'revenue', label: 'Revenue', short: 'Revenue' },
];

const money0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

const fmtQty = (v) => (v ? int0.format(v) : '');
const fmtPrice = (v) => (v ? money2.format(v) : '');
const fmtRevenue = (v) => (v ? money0.format(v) : '');

// Short column label: "Jan 26" for monthly keys, "Q1 26" for quarters.
const shortPeriodLabel = (period) => {
  const m = /^(\d{4})-(\d{2})$/.exec(period.key);
  if (m) {
    const date = new Date(Number(m[1]), Number(m[2]) - 1, 1);
    return `${date.toLocaleDateString('en-US', { month: 'short' })} ${m[1].slice(2)}`;
  }
  const q = /^(\d{4})-Q([1-4])$/.exec(period.key);
  if (q) return `Q${q[2]} ${q[1].slice(2)}`;
  return period.label || period.key;
};

// Months that make up a column: the month itself, or the three months of a quarter.
const monthsForPeriod = (period) => {
  if (/^\d{4}-\d{2}$/.test(period.key)) return [period.key];
  const q = /^(\d{4})-Q([1-4])$/.exec(period.key);
  if (q) {
    const first = (Number(q[2]) - 1) * 3 + 1;
    return [0, 1, 2].map(i => `${q[1]}-${String(first + i).padStart(2, '0')}`);
  }
  return [];
};

/**
 * Customer × product lines for the active scenario, one column per period,
 * showing one measure at a time. Quantity and price are edited inline in the
 * monthly view and saved per cell; revenue is always derived.
 */
const RevenueMatrix = ({ data, timePeriods, selectedSegment, onAddForecastLine, periodType = 'monthly' }) => {
  const { actions, activeScenario, scenarios } = useForecast();
  const [measure, setMeasure] = useState('quantity');
  const editable = periodType === 'monthly' && Boolean(activeScenario);
  const scenarioName = activeScenario && scenarios?.[activeScenario] ? scenarios[activeScenario].name : activeScenario;

  // (unit, customer, month) -> sale, for the active scenario only.
  const salesIndex = useMemo(() => {
    const index = new Map();
    (Array.isArray(data.sales_forecast) ? data.sales_forecast : []).forEach(sale => {
      if (sale.forecast_id !== activeScenario) return;
      index.set(`${sale.unit_id}|${sale.customer_id}|${sale.period}`, sale);
    });
    return index;
  }, [data.sales_forecast, activeScenario]);

  const rows = useMemo(() => {
    const products = Array.isArray(data.products) ? data.products : [];
    const customers = Array.isArray(data.customers) ? data.customers : [];
    const productById = new Map(products.map(p => [p.unit_id || p.id, p]));
    const customerById = new Map(customers.map(c => [c.customer_id, c]));

    // Only combinations that have at least one sales row in this scenario.
    const combos = new Map();
    salesIndex.forEach(sale => {
      const key = `${sale.unit_id}|${sale.customer_id}`;
      if (!combos.has(key)) combos.set(key, { unit_id: sale.unit_id, customer_id: sale.customer_id });
    });

    const out = [];
    combos.forEach(({ unit_id, customer_id }) => {
      const product = productById.get(unit_id);
      const customer = customerById.get(customer_id);
      const row = {
        id: `${unit_id}|${customer_id}`,
        product_id: unit_id,
        customer_id,
        product_name: product?.unit_name || product?.name || unit_id,
        customer_name: customer?.customer_name || customer_id,
        segment: customer?.customer_type || customer?.region || 'General',
        total_quantity: 0,
        total_revenue: 0,
      };
      timePeriods.forEach(period => {
        let qty = 0;
        let revenue = 0;
        let price = 0;
        monthsForPeriod(period).forEach(month => {
          const sale = salesIndex.get(`${unit_id}|${customer_id}|${month}`);
          if (!sale) return;
          const q = Number(sale.quantity || 0);
          const p = Number(sale.unit_price || 0);
          qty += q;
          revenue += q * p;
          price = p;
        });
        if (qty > 0 && monthsForPeriod(period).length > 1) price = revenue / qty;
        row[`quantity_${period.key}`] = qty;
        row[`price_${period.key}`] = price;
        row[`revenue_${period.key}`] = revenue;
        row.total_quantity += qty;
        row.total_revenue += revenue;
      });
      out.push(row);
    });
    out.sort((a, b) => a.customer_name.localeCompare(b.customer_name) || a.product_name.localeCompare(b.product_name));
    return out;
  }, [data.products, data.customers, salesIndex, timePeriods]);

  const visibleRows = useMemo(
    () => (selectedSegment === 'all' ? rows : rows.filter(r => r.segment === selectedSegment)),
    [rows, selectedSegment]
  );

  const columns = useMemo(() => {
    const measureDef = MEASURES.find(m => m.key === measure);
    const format = measure === 'quantity' ? fmtQty : measure === 'price' ? fmtPrice : fmtRevenue;
    const cols = [
      { key: 'customer_name', title: 'Customer', width: 170, sticky: true },
      { key: 'product_name', title: 'Product', width: 160, sticky: true },
      { key: 'segment', title: 'Segment', width: 110 },
    ];
    timePeriods.forEach(period => {
      cols.push({
        key: `${measure}_${period.key}`,
        title: shortPeriodLabel(period),
        headerTitle: `${measureDef.label} — ${period.label}`,
        width: measure === 'revenue' ? 104 : 92,
        align: 'right',
        type: 'number',
        editable: editable && measure !== 'revenue',
        format,
        validate: (v) => (v < 0 ? 'Must be 0 or more' : null),
      });
    });
    cols.push(
      { key: 'total_quantity', title: 'Total qty', width: 100, align: 'right', type: 'number', format: fmtQty },
      { key: 'total_revenue', title: 'Total revenue', width: 120, align: 'right', type: 'number', format: fmtRevenue },
    );
    return cols;
  }, [timePeriods, measure, editable]);

  const footer = useMemo(() => {
    const totals = { customer_name: `${visibleRows.length} line${visibleRows.length === 1 ? '' : 's'}` };
    let totalQty = 0;
    let totalRev = 0;
    timePeriods.forEach(period => {
      let q = 0;
      let r = 0;
      visibleRows.forEach(row => {
        q += row[`quantity_${period.key}`] || 0;
        r += row[`revenue_${period.key}`] || 0;
      });
      totals[`quantity_${period.key}`] = fmtQty(q);
      totals[`revenue_${period.key}`] = fmtRevenue(r);
      totals[`price_${period.key}`] = q > 0 ? fmtPrice(r / q) : '';
      totalQty += q;
      totalRev += r;
    });
    totals.total_quantity = fmtQty(totalQty);
    totals.total_revenue = fmtRevenue(totalRev);
    return totals;
  }, [visibleRows, timePeriods]);

  // Save one cell: send a single replace for that (customer, product, month).
  const handleCommit = useCallback(async (rowId, columnKey, value, row) => {
    const match = /^(quantity|price)_(.+)$/.exec(columnKey);
    if (!match || !activeScenario) return;
    const [, field, period] = match;
    const quantity = field === 'quantity' ? value : Number(row[`quantity_${period}`] || 0);
    const unitPrice = field === 'price' ? value : Number(row[`price_${period}`] || 0);
    await actions.bulkUpdateForecast([{
      unit_id: row.product_id,
      customer_id: row.customer_id,
      period,
      quantity,
      unit_price: unitPrice,
      total_revenue: quantity * unitPrice,
      forecast_id: activeScenario,
    }], 'replace');
  }, [actions, activeScenario]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            Revenue matrix
            <Badge variant="secondary">{visibleRows.length} lines</Badge>
            {!editable && periodType !== 'monthly' && (
              <Badge variant="outline" title="Switch the period type to Monthly to edit">read-only in {periodType} view</Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5" role="tablist" aria-label="Measure">
              {MEASURES.map(m => (
                <button
                  key={m.key}
                  type="button"
                  role="tab"
                  aria-selected={measure === m.key}
                  onClick={() => setMeasure(m.key)}
                  className={`rounded px-3 py-1 text-sm font-medium transition-colors ${measure === m.key ? 'bg-white text-orange-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {onAddForecastLine && (
              <Button onClick={onAddForecastLine} className="bg-orange-600 hover:bg-orange-700 text-white">
                Add forecast line
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="py-12 text-center">
            <h3 className="mb-2 text-xl font-semibold text-gray-900">No forecast lines yet</h3>
            <p className="mb-4 text-gray-600">
              {activeScenario
                ? <>Nothing is forecast in <span className="font-medium">{scenarioName}</span> yet.</>
                : 'Select a scenario in the bar above first.'}
            </p>
            {onAddForecastLine && activeScenario && (
              <Button onClick={onAddForecastLine} className="bg-orange-600 hover:bg-orange-700 text-white">Add your first forecast line</Button>
            )}
          </div>
        ) : (
          <ForecastGrid
            columns={columns}
            rows={visibleRows}
            footer={footer}
            onCommit={async (...args) => {
              try {
                await handleCommit(...args);
              } catch (err) {
                toast.error('Failed to save cell');
                throw err;
              }
            }}
            emptyMessage="No lines in this segment"
          />
        )}
      </CardContent>
    </Card>
  );
};

export default RevenueMatrix;
