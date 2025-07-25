import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';

const MachineSummary = ({ machines }) => {
  const summaryData = useMemo(() => {
    const totalMachines = machines.length;
    
    // Labor type breakdown
    const laborTypeBreakdown = machines.reduce((acc, machine) => {
      const type = machine.labor_type || 'General';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    
    // Rate statistics
    const ratesWithValues = machines.filter(m => m.machine_rate && m.machine_rate > 0);
    const avgRate = ratesWithValues.length > 0 
      ? ratesWithValues.reduce((sum, m) => sum + m.machine_rate, 0) / ratesWithValues.length 
      : 0;
    const minRate = ratesWithValues.length > 0 
      ? Math.min(...ratesWithValues.map(m => m.machine_rate)) 
      : 0;
    const maxRate = ratesWithValues.length > 0 
      ? Math.max(...ratesWithValues.map(m => m.machine_rate)) 
      : 0;
    
    // Capacity statistics
    const capacityWithValues = machines.filter(m => m.available_minutes_per_month && m.available_minutes_per_month > 0);
    const totalCapacity = capacityWithValues.reduce((sum, m) => sum + m.available_minutes_per_month, 0);
    const avgCapacity = capacityWithValues.length > 0 
      ? totalCapacity / capacityWithValues.length 
      : 0;
    
    // Data completeness
    const withRates = machines.filter(m => m.machine_rate && m.machine_rate > 0).length;
    const withCapacity = machines.filter(m => m.available_minutes_per_month && m.available_minutes_per_month > 0).length;
    const withDescription = machines.filter(m => m.machine_description && (typeof m.machine_description === 'string' ? m.machine_description.trim() : true)).length;
    const withLaborType = machines.filter(m => m.labor_type && (typeof m.labor_type === 'string' ? m.labor_type.trim() : true)).length;
    
    // Data quality metrics
    const completeProfiles = machines.filter(m => 
      m.machine_name && m.machine_rate && m.labor_type && m.available_minutes_per_month
    ).length;
    
    return {
      totalMachines,
      laborTypeBreakdown,
      rateStats: {
        avgRate,
        minRate,
        maxRate,
        withRates
      },
      capacityStats: {
        totalCapacity,
        avgCapacity,
        withCapacity
      },
      completeness: {
        withRates,
        withCapacity,
        withDescription,
        withLaborType
      },
      dataQuality: {
        completeProfiles,
        incompleteProfiles: totalMachines - completeProfiles
      }
    };
  }, [machines]);

  const topLaborTypes = Object.entries(summaryData.laborTypeBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const formatCurrency = (value) => {
    return `$${value.toFixed(2)}`;
  };

  const getLaborTypeColor = (type) => {
    const colors = {
      'CNC': 'bg-blue-100 text-blue-800',
      'Manual': 'bg-yellow-100 text-yellow-800',
      'Assembly': 'bg-green-100 text-green-800',
      'Inspection': 'bg-purple-100 text-purple-800',
      'Shipping': 'bg-orange-100 text-orange-800',
      'General': 'bg-gray-100 text-gray-800',
      'MACHINE SHOP': 'bg-indigo-100 text-indigo-800'
    };
    return colors[type] || colors['General'];
  };

  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl">🏭</div>
              <div>
                <p className="text-2xl font-bold">{summaryData.totalMachines}</p>
                <p className="text-sm text-muted-foreground">Total Machines</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl">✅</div>
              <div>
                <p className="text-2xl font-bold">{summaryData.dataQuality.completeProfiles}</p>
                <p className="text-sm text-muted-foreground">Complete Profiles</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl">💰</div>
              <div>
                <p className="text-2xl font-bold">{formatCurrency(summaryData.rateStats.avgRate)}</p>
                <p className="text-sm text-muted-foreground">Avg Rate/Hour</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl">⏰</div>
              <div>
                <p className="text-2xl font-bold">{summaryData.capacityStats.totalCapacity.toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">Total Capacity (min/month)</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Labor Type Distribution */}
      <Card>
        <CardHeader>
          <CardTitle>Labor Type Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {topLaborTypes.map(([type, count]) => (
              <div key={type} className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Badge variant="outline" className={getLaborTypeColor(type)}>
                    {type}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{count} machines</span>
                </div>
                <div className="flex-1 mx-4">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-orange-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(count / summaryData.totalMachines) * 100}%` }}
                    ></div>
                  </div>
                </div>
                <span className="text-sm font-medium">
                  {((count / summaryData.totalMachines) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Rate Analysis */}
      <Card>
        <CardHeader>
          <CardTitle>Rate Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-sm font-medium">Minimum Rate</span>
              <span className="text-lg font-bold text-green-600">{formatCurrency(summaryData.rateStats.minRate)}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-sm font-medium">Maximum Rate</span>
              <span className="text-lg font-bold text-red-600">{formatCurrency(summaryData.rateStats.maxRate)}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-sm font-medium">Average Rate</span>
              <span className="text-lg font-bold text-blue-600">{formatCurrency(summaryData.rateStats.avgRate)}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-sm font-medium">Machines with Rates</span>
              <span className="text-lg font-bold">{summaryData.rateStats.withRates} of {summaryData.totalMachines}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data Completeness */}
      <Card>
        <CardHeader>
          <CardTitle>Data Completeness</CardTitle>
        </CardHeader>
        <CardContent>
                      <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Complete Profiles</span>
                  <span className="font-medium">{summaryData.dataQuality.completeProfiles} of {summaryData.totalMachines}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-green-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(summaryData.dataQuality.completeProfiles / summaryData.totalMachines) * 100}%` }}
                  ></div>
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>With Rates</span>
                  <span className="font-medium">{summaryData.completeness.withRates} of {summaryData.totalMachines}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(summaryData.completeness.withRates / summaryData.totalMachines) * 100}%` }}
                  ></div>
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>With Capacity</span>
                  <span className="font-medium">{summaryData.completeness.withCapacity} of {summaryData.totalMachines}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-orange-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(summaryData.completeness.withCapacity / summaryData.totalMachines) * 100}%` }}
                  ></div>
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>With Descriptions</span>
                  <span className="font-medium">{summaryData.completeness.withDescription} of {summaryData.totalMachines}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(summaryData.completeness.withDescription / summaryData.totalMachines) * 100}%` }}
                  ></div>
                </div>
              </div>
            </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default MachineSummary;