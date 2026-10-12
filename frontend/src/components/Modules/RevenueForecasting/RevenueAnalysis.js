import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { formatMoney, formatPrice, formatQty, formatShare, summarizeBySegment } from './revenueData';

/**
 * Revenue by customer type for the months on screen. Counts include only
 * customers and products that actually have units in the window.
 */
const RevenueAnalysis = ({ lines, months }) => {
  const segments = useMemo(() => summarizeBySegment(lines, months), [lines, months]);
  const totals = useMemo(() => segments.reduce((acc, s) => ({
    revenue: acc.revenue + s.revenue,
    quantity: acc.quantity + s.quantity,
    lines: acc.lines + s.lines,
  }), { revenue: 0, quantity: 0, lines: 0 }), [segments]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle className="text-lg">Revenue by customer type</CardTitle>
          <Link to="/reporting/cogs-labor" className="text-sm font-medium text-orange-700 hover:underline">
            Net sales and gross margin by customer type →
          </Link>
        </div>
        <p className="text-sm text-gray-600">
          Gross sales (quantity × unit price) in the selected months. Customer type comes from Customer Setup and drives the price list and discounts.
        </p>
      </CardHeader>
      <CardContent>
        {segments.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-600">No sales in the selected months.</div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-gray-200">
            <table className="min-w-full text-sm tabular-nums">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium">Customer type</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Gross sales</th>
                  <th scope="col" className="w-48 px-3 py-2 text-left font-medium">Share</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Units</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Avg price</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Customers</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Products</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Lines</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {segments.map(s => (
                  <tr key={s.key} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-900">{s.name}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(s.revenue)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.max(1, s.share * 100)}%` }} />
                        </div>
                        <span className="w-12 text-right text-xs text-gray-600">{formatShare(s.share)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">{formatQty(s.quantity)}</td>
                    <td className="px-3 py-2 text-right">{formatPrice(s.averagePrice)}</td>
                    <td className="px-3 py-2 text-right">{s.customers}</td>
                    <td className="px-3 py-2 text-right">{s.products}</td>
                    <td className="px-3 py-2 text-right">{s.lines}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-gray-900">
                <tr>
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right">{formatMoney(totals.revenue)}</td>
                  <td className="px-3 py-2 text-xs font-normal text-gray-500">100%</td>
                  <td className="px-3 py-2 text-right">{formatQty(totals.quantity)}</td>
                  <td className="px-3 py-2 text-right">{formatPrice(totals.quantity > 0 ? totals.revenue / totals.quantity : 0)}</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right">{totals.lines}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default RevenueAnalysis;
