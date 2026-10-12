import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import MiniTrendChart from './MiniTrendChart';
import { ALL, materialView, periodLabel } from './costViews';

const Row = ({ label, children }) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className="text-gray-600">{label}</span>
    <span className="text-right font-semibold tabular-nums">{children}</span>
  </div>
);

/**
 * Material quantities and spend, exploded through the BOM version each
 * product actually uses (from /products/materials/usage, which ties to the
 * statements' material COGS).
 */
const MaterialsUsageTab = ({
  materials = [],
  periods = [],
  totalCost = null,
  selectedPeriod,
  formatCurrency,
  formatNumber,
}) => {
  const all = selectedPeriod === ALL;
  const cards = materials
    .map(material => ({ material, view: materialView(material, selectedPeriod) }))
    .filter(({ view }) => all || view.quantity > 0)
    .sort((a, b) => b.view.cost - a.view.cost);
  const shownCost = cards.reduce((sum, c) => sum + c.view.cost, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-xl">
          Materials · {all ? (periods.length ? `${periodLabel(periods[0])} – ${periodLabel(periods[periods.length - 1])}` : 'all months') : periodLabel(selectedPeriod)}
        </CardTitle>
        <p className="text-sm text-gray-600">
          Quantities from the sales forecast × the BOM version each product uses.
          {cards.length > 0 && ` Material spend: ${formatCurrency(all && totalCost !== null ? totalCost : shownCost)}.`}
        </p>
      </CardHeader>
      <CardContent>
        {cards.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">
            No material usage {all ? 'in this scenario' : `in ${periodLabel(selectedPeriod)}`}. Materials come from the BOMs of the products in the sales forecast.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {cards.map(({ material, view }) => (
              <Card key={`${material.material_description}|${material.unit}|${material.unit_price}`}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base leading-snug">{material.material_description}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5 text-sm">
                    <Row label="Quantity">{formatNumber(view.quantity, 2)} {material.unit || ''}</Row>
                    <Row label="Unit price">{formatCurrency(material.unit_price)}</Row>
                    <Row label={all ? 'Spend (window)' : 'Spend'}>{formatCurrency(view.cost)}</Row>
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-medium text-gray-600">Quantity by month</div>
                    <MiniTrendChart
                      data={view.trend}
                      color="blue"
                      highlight={all ? null : selectedPeriod}
                      formatValue={(v) => `${v.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${material.unit || ''}`}
                    />
                  </div>

                  <div className="space-y-1">
                    {Array.isArray(material.products_using) && material.products_using.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {material.products_using.map((product) => (
                          <Badge key={product} variant="secondary" className="text-xs font-normal">{product}</Badge>
                        ))}
                      </div>
                    )}
                    {Array.isArray(material.boms) && material.boms.length > 0 && (
                      <div className="text-xs text-gray-500">BOM: {material.boms.join(', ')}</div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MaterialsUsageTab;
