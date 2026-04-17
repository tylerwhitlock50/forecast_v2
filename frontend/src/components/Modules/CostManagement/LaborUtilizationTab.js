import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import MiniTrendChart from './MiniTrendChart';

const LaborUtilizationTab = ({
  laborUtilization,
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
          Labor Utilization & FTE - {selectedPeriod === 'all' ? 'All Periods' : selectedPeriod}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {getDataForPeriod(laborUtilization, selectedPeriod).map((labor, index) => {
            const monthlyTrends = getMonthlyTrends(labor.labor_type_id, laborUtilization);
            return (
              <Card key={index}>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-lg">{labor.labor_type_name}</CardTitle>
                    <Badge variant="outline">{labor.labor_type}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-2 text-sm">
                      <div className="flex justify-between">
                        <span>Required Minutes:</span>
                        <span className="font-semibold">{formatNumber(labor.total_minutes_required)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Required Hours:</span>
                        <span className="font-semibold">{formatNumber(labor.total_hours_required)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>FTE Required:</span>
                        <span className="font-semibold">{formatNumber(labor.fte_required, 2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Hourly Rate:</span>
                        <span className="font-semibold">{formatCurrency(labor.hourly_rate)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Total Cost:</span>
                        <span className="font-semibold">{formatCurrency(labor.total_cost)}</span>
                      </div>
                    </div>

                    <div>
                      <div className="text-sm font-medium mb-2">Monthly FTE Trend:</div>
                      <MiniTrendChart data={monthlyTrends} color="green" />
                    </div>

                    <div>
                      <div className="text-sm font-medium mb-2">Products:</div>
                      <div className="flex flex-wrap gap-1">
                        {labor.products_involved.map((product, i) => (
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

export default LaborUtilizationTab;
