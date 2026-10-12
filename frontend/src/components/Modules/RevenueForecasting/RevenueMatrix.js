import React, { useCallback, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import ForecastGrid from '../../Common/ForecastGrid';
import api from '../../../lib/apiClient';
import { useForecast } from '../../../context/ForecastContext';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import {
  buildMatrixRows,
  carriedPrice,
  formatMoney,
  formatPrice,
  formatQty,
  monthLabel,
} from './revenueData';

const MEASURES = [
  { key: 'quantity', label: 'Quantity' },
  { key: 'price', label: 'Unit price' },
  { key: 'revenue', label: 'Revenue' },
];

const blankIfZero = (format) => (v) => (v ? format(v) : '');
const fmtQty = blankIfZero(formatQty);
const fmtPrice = blankIfZero(formatPrice);
const fmtRevenue = blankIfZero(formatMoney);

// Hides ForecastGrid's "Click a cell, type to edit" hint when nothing is editable.
const READ_ONLY_GRID = '[&>div:last-child>span:last-child]:invisible';

/** Price list price for a line and month (customer price, customer-type price, then list price). */
const resolveListPrice = async ({ unitId, customerId, period, forecastId }) => {
  const params = new URLSearchParams({ unit_id: unitId, customer_id: customerId, period });
  if (forecastId) params.set('forecast_id', forecastId);
  try {
    const res = await api.get(`/pricing/resolve?${params.toString()}`, { suppressErrorToast: true });
    const price = Number(res?.data?.price);
    return Number.isFinite(price) && price > 0 ? { price, label: res?.data?.source_label || 'price list' } : null;
  } catch {
    return null;
  }
};

/**
 * Customer × product lines for the active scenario, one column per period,
 * showing one measure at a time. Quantity and price are edited inline in the
 * monthly view and saved per cell; revenue is always derived.
 */
const RevenueMatrix = ({ lines, periods, selectedSegment, onAddForecastLine, periodType = 'monthly' }) => {
  const { actions, activeScenario, scenarios } = useForecast();
  const [measure, setMeasure] = useState('quantity');
  const editable = periodType === 'monthly' && Boolean(activeScenario);
  const scenarioName = activeScenario && scenarios?.[activeScenario] ? scenarios[activeScenario].name : activeScenario;

  const lineById = useMemo(() => new Map((lines || []).map(l => [l.id, l])), [lines]);

  const visibleLines = useMemo(
    () => (selectedSegment === 'all' ? lines : lines.filter(l => l.segment === selectedSegment)),
    [lines, selectedSegment]
  );

  const rows = useMemo(() => buildMatrixRows(visibleLines, periods), [visibleLines, periods]);

  const columns = useMemo(() => {
    const measureDef = MEASURES.find(m => m.key === measure);
    const format = measure === 'quantity' ? fmtQty : measure === 'price' ? fmtPrice : fmtRevenue;
    const cols = [
      { key: 'customer_name', title: 'Customer', width: 180, sticky: true },
      { key: 'product_name', title: 'Product', width: 170, sticky: true },
      { key: 'segment', title: 'Customer type', width: 120 },
    ];
    periods.forEach(period => {
      cols.push({
        key: `${measure}_${period.key}`,
        title: period.short,
        headerTitle: `${measureDef.label} — ${period.label}`,
        width: measure === 'revenue' ? 108 : 92,
        align: 'right',
        type: 'number',
        editable: editable && measure !== 'revenue',
        format,
        validate: (v) => (Number.isNaN(v) ? 'Enter a number' : v < 0 ? 'Must be 0 or more' : null),
      });
    });
    cols.push(
      { key: 'total_quantity', title: 'Total units', width: 100, align: 'right', type: 'number', format: fmtQty },
      { key: 'total_revenue', title: 'Total revenue', width: 124, align: 'right', type: 'number', format: fmtRevenue },
    );
    return cols;
  }, [periods, measure, editable]);

  const footer = useMemo(() => {
    const totals = { customer_name: `${rows.length} line${rows.length === 1 ? '' : 's'}` };
    let totalQty = 0;
    let totalRev = 0;
    periods.forEach(period => {
      let q = 0;
      let r = 0;
      rows.forEach(row => {
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
  }, [rows, periods]);

  // Save one cell: a single replace for that (customer, product, month).
  const handleCommit = useCallback(async (rowId, columnKey, value, row) => {
    const match = /^(quantity|price)_(\d{4}-\d{2})$/.exec(columnKey);
    if (!match || !activeScenario) return;
    const [, field, period] = match;
    const line = lineById.get(rowId);
    const cell = line?.months.get(period);
    const quantity = field === 'quantity' ? value : Number(cell?.quantity || 0);
    let unitPrice = field === 'price' ? value : Number(cell?.unit_price || 0);

    // A quantity typed into a month with no price takes the line's price
    // from the nearest month, else from the price list; never a silent $0.
    if (field === 'quantity' && quantity > 0 && !(unitPrice > 0)) {
      const carried = carriedPrice(line, period);
      if (carried) {
        unitPrice = carried.price;
        toast(`Price ${formatPrice(unitPrice)} carried from ${monthLabel(carried.from)}`, { icon: 'ℹ️' });
      } else {
        const listed = await resolveListPrice({ unitId: row.product_id, customerId: row.customer_id, period, forecastId: activeScenario });
        if (listed) {
          unitPrice = listed.price;
          toast(`Priced at ${formatPrice(unitPrice)} (${listed.label})`, { icon: 'ℹ️' });
        } else {
          toast.error(`No price for ${row.product_name} in ${monthLabel(period)}. Switch to Unit price and enter one.`);
        }
      }
    }

    await actions.bulkUpdateForecast([{
      unit_id: row.product_id,
      customer_id: row.customer_id,
      period,
      quantity,
      unit_price: unitPrice,
      total_revenue: quantity * unitPrice,
      forecast_id: activeScenario,
    }], 'replace');
  }, [actions, activeScenario, lineById]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            Forecast lines
            <Badge variant="secondary">{rows.length}</Badge>
            {!editable && periodType !== 'monthly' && (
              <Badge variant="outline" title="Switch the period to Monthly to edit">Totals only · switch to Monthly to edit</Badge>
            )}
          </CardTitle>
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
        </div>
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <div className="py-12 text-center">
            <h3 className="mb-2 text-lg font-semibold text-gray-900">No forecast lines in these months</h3>
            <p className="mb-4 text-sm text-gray-600">
              {activeScenario
                ? <>Nothing is forecast in <span className="font-medium">{scenarioName}</span> for the selected months. Import a sales file or add a line.</>
                : 'Select a scenario in the bar above first.'}
            </p>
            {onAddForecastLine && activeScenario && (
              <Button variant="outline" onClick={onAddForecastLine}>Add a forecast line</Button>
            )}
          </div>
        ) : (
          <ForecastGrid
            className={editable && measure !== 'revenue' ? undefined : READ_ONLY_GRID}
            columns={columns}
            rows={rows}
            footer={footer}
            onCommit={async (...args) => {
              try {
                await handleCommit(...args);
              } catch (err) {
                toast.error('Could not save that cell');
                throw err;
              }
            }}
            emptyMessage="No lines for this customer type"
          />
        )}
      </CardContent>
    </Card>
  );
};

export default RevenueMatrix;
