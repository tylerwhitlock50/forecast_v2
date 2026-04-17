import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import MiniTrendChart from './MiniTrendChart';

const MaterialsUsageTab = ({
  materialsUsage,
  selectedPeriod,
  getDataForPeriod,
  getMonthlyTrends,
  formatCurrency,
  formatNumber,
}) => (
  <div className="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle>
          Materials Usage Forecast - {selectedPeriod === 'all' ? 'All Periods' : selectedPeriod}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {getDataForPeriod(materialsUsage, selectedPeriod).map((material, index) => {
            // Trend charts always use the original per-period data so combined
            // views don't lose the shape of monthly movement.
            const monthlyTrends = getMonthlyTrends(material.material_description, materialsUsage);
            return (
              <Card key={index}>
                <CardHeader>
                  <CardTitle className="text-lg">{material.material_description}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-2">
                      <div className="flex justify-between text-sm">
                        <span>Quantity Needed:</span>
                        <span className="font-semibold">
                          {formatNumber(material.total_quantity_needed, 2)} {material.unit}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Unit Price:</span>
                        <span className="font-semibold">{formatCurrency(material.unit_price)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Total Cost:</span>
                        <span className="font-semibold">{formatCurrency(material.total_cost)}</span>
                      </div>
                    </div>

                    <div>
                      <div className="text-sm font-medium mb-2">Monthly Usage Trend:</div>
                      <MiniTrendChart data={monthlyTrends} color="blue" />
                    </div>

                    <div>
                      <div className="text-sm font-medium mb-2">Used by:</div>
                      <div className="flex flex-wrap gap-1">
                        {material.products_using.map((product, i) => (
                          <Badge key={i} variant="secondary" className="text-xs">
                            {product}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </CardContent>
    </Card>
  </div>
);

export default MaterialsUsageTab;
