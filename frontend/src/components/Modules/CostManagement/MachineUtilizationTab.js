import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import MiniTrendChart from './MiniTrendChart';

const MachineUtilizationTab = ({
  machineUtilization,
  selectedPeriod,
  getDataForPeriod,
  getMonthlyTrends,
  formatCurrency,
  formatNumber,
  formatPercent,
}) => (
  <div className="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle>
          Machine Utilization Details - {selectedPeriod === 'all' ? 'All Periods' : selectedPeriod}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {getDataForPeriod(machineUtilization, selectedPeriod).map((machine, index) => {
            const monthlyTrends = getMonthlyTrends(machine.machine_id, machineUtilization);
            return (
              <Card key={index} className={machine.capacity_exceeded ? 'border-red-500 bg-red-50' : ''}>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-lg">{machine.machine_name}</CardTitle>
                    {machine.capacity_exceeded && (
                      <Badge variant="destructive">Over Capacity</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 gap-2 text-sm">
                      <div className="flex justify-between">
                        <span>Required Minutes:</span>
                        <span className="font-semibold">{formatNumber(machine.total_minutes_required)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Available Minutes:</span>
                        <span className="font-semibold">{formatNumber(machine.available_minutes_per_month)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Utilization:</span>
                        <span className={`font-semibold ${machine.utilization_percent > 100 ? 'text-red-600' : 'text-green-600'}`}>
                          {formatPercent(machine.utilization_percent)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Total Cost:</span>
                        <span className="font-semibold">{formatCurrency(machine.total_cost)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Machine Rate:</span>
                        <span className="font-semibold">{formatCurrency(machine.machine_rate)}/hr</span>
                      </div>
                    </div>

                    <div>
                      <div className="text-sm font-medium mb-2">Monthly Utilization Trend:</div>
                      <MiniTrendChart data={monthlyTrends} color="orange" />
                    </div>

                    {machine.capacity_exceeded && (
                      <div className="p-3 bg-red-100 border border-red-200 rounded text-sm text-red-800">
                        ⚠️ Capacity Exceeded by {formatPercent(machine.utilization_percent - 100)}
                      </div>
                    )}
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

export default MachineUtilizationTab;
