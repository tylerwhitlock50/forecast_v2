import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';

const RouterSummary = ({ routers, routerOperations, machines, units, laborRates }) => {
  const summaryData = useMemo(() => {
    // Use router operations for analysis since that's where the actual data is
    const operations = Array.isArray(routerOperations) ? routerOperations : [];
    const routerDefs = Array.isArray(routers) ? routers : [];
    const totalOperations = operations.length;
    
    // Router breakdown by router ID
    const routerBreakdown = operations.reduce((acc, op) => {
      const routerId = op.router_id || 'Unknown';
      acc[routerId] = (acc[routerId] || 0) + 1;
      return acc;
    }, {});
    
    // Version breakdown from router definitions
    const versionBreakdown = routerDefs.reduce((acc, router) => {
      const version = router.version || '1.0';
      acc[version] = (acc[version] || 0) + 1;
      return acc;
    }, {});
    
    // Machine utilization from operations
    const machineUtilization = operations.reduce((acc, op) => {
      const machineId = op.machine_id || 'Unknown';
      acc[machineId] = (acc[machineId] || 0) + (op.machine_minutes || 0);
      return acc;
    }, {});
    
    // Labor utilization from operations
    const laborUtilization = operations.reduce((acc, op) => {
      const laborId = op.labor_type_id || 'Unknown';
      acc[laborId] = (acc[laborId] || 0) + (op.labor_minutes || 0);
      return acc;
    }, {});
    
    // Time statistics from operations
    const totalMachineMinutes = operations.reduce((sum, op) => sum + (op.machine_minutes || 0), 0);
    const totalLaborMinutes = operations.reduce((sum, op) => sum + (op.labor_minutes || 0), 0);
    const avgMachineMinutes = totalOperations > 0 ? totalMachineMinutes / totalOperations : 0;
    const avgLaborMinutes = totalOperations > 0 ? totalLaborMinutes / totalOperations : 0;
    
    // Sequence analysis from operations
    const maxSequence = operations.reduce((max, op) => Math.max(max, op.sequence || 0), 0);
    const avgSequence = totalOperations > 0 ? 
      operations.reduce((sum, op) => sum + (op.sequence || 0), 0) / totalOperations : 0;
    
    // Data completeness from operations
    const withMachine = operations.filter(op => op.machine_id).length;
    const withLaborRate = operations.filter(op => op.labor_type_id).length;
    const withMachineMinutes = operations.filter(op => op.machine_minutes && op.machine_minutes > 0).length;
    const withLaborMinutes = operations.filter(op => op.labor_minutes && op.labor_minutes > 0).length;
    const withDescription = operations.filter(op => op.operation_description).length;
    
    // Complete operation profiles
    const completeProfiles = operations.filter(op => 
      op.router_id && op.machine_id && op.sequence && op.labor_type_id &&
      (op.machine_minutes > 0 || op.labor_minutes > 0)
    ).length;
    
    return {
      totalOperations,
      totalRouters: routerDefs.length,
      versionBreakdown,
      routerBreakdown,
      machineUtilization,
      laborUtilization,
      timeStats: {
        totalMachineMinutes,
        totalLaborMinutes,
        avgMachineMinutes,
        avgLaborMinutes
      },
      sequenceStats: {
        maxSequence,
        avgSequence
      },
      completeness: {
        withMachine,
        withLaborRate,
        withMachineMinutes,
        withLaborMinutes,
        withDescription
      },
      dataQuality: {
        completeProfiles,
        incompleteProfiles: totalOperations - completeProfiles
      }
    };
  }, [routers, routerOperations]);

  const topVersions = Object.entries(summaryData.versionBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const topRouters = Object.entries(summaryData.routerBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const topMachines = Object.entries(summaryData.machineUtilization)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const topLaborRates = Object.entries(summaryData.laborUtilization)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const formatMinutes = (minutes) => {
    if (!minutes || minutes === 0) return '0 min';
    if (minutes < 60) return `${minutes.toFixed(1)} min`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes.toFixed(0)}m`;
  };

  const getMachineName = (machineId) => {
    const machine = machines.find(m => m.machine_id === machineId);
    return machine ? machine.machine_name : machineId;
  };

  const getRouterName = (routerId) => {
    const router = routers.find(r => r.router_id === routerId);
    return router ? router.router_name : routerId;
  };

  const getLaborRateName = (rateId) => {
    const rate = laborRates.find(r => r.rate_id === rateId);
    return rate ? rate.rate_name : rateId;
  };

  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl">🔄</div>
              <div>
                <p className="text-2xl font-bold">{summaryData.totalOperations}</p>
                <p className="text-sm text-muted-foreground">Total Operations</p>
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
                <p className="text-sm text-muted-foreground">Complete Operations</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl">🏭</div>
              <div>
                <p className="text-2xl font-bold">{formatMinutes(summaryData.timeStats.totalMachineMinutes)}</p>
                <p className="text-sm text-muted-foreground">Total Machine Time</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl">👷</div>
              <div>
                <p className="text-2xl font-bold">{formatMinutes(summaryData.timeStats.totalLaborMinutes)}</p>
                <p className="text-sm text-muted-foreground">Total Labor Time</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Version Distribution */}
      <Card>
        <CardHeader>
          <CardTitle>Version Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {topVersions.map(([version, count]) => (
              <div key={version} className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Badge variant="outline" className="bg-blue-100 text-blue-800">
                    {version}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{count} operations</span>
                </div>
                <div className="flex-1 mx-4">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(count / summaryData.totalRouters) * 100}%` }}
                    ></div>
                  </div>
                </div>
                <span className="text-sm font-medium">
                  {((count / summaryData.totalRouters) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Router Distribution */}
      <Card>
        <CardHeader>
          <CardTitle>Router Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {topRouters.map(([routerId, count]) => (
              <div key={routerId} className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Badge variant="outline" className="bg-green-100 text-green-800">
                    {getRouterName(routerId)}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{count} operations</span>
                </div>
                <div className="flex-1 mx-4">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-green-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(count / summaryData.totalOperations) * 100}%` }}
                    ></div>
                  </div>
                </div>
                <span className="text-sm font-medium">
                  {((count / summaryData.totalOperations) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Machine Utilization */}
      <Card>
        <CardHeader>
          <CardTitle>Machine Utilization (Minutes)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {topMachines.map(([machineId, minutes]) => (
              <div key={machineId} className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Badge variant="outline" className="bg-yellow-100 text-yellow-800">
                    {getMachineName(machineId)}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{minutes.toFixed(1)} min</span>
                </div>
                <div className="flex-1 mx-4">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-yellow-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(minutes / summaryData.timeStats.totalMachineMinutes) * 100}%` }}
                    ></div>
                  </div>
                </div>
                <span className="text-sm font-medium">
                  {((minutes / summaryData.timeStats.totalMachineMinutes) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Labor Utilization */}
      <Card>
        <CardHeader>
          <CardTitle>Labor Utilization (Minutes)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {topLaborRates.map(([rateId, minutes]) => (
              <div key={rateId} className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Badge variant="outline" className="bg-purple-100 text-purple-800">
                    {getLaborRateName(rateId)}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{minutes.toFixed(1)} min</span>
                </div>
                <div className="flex-1 mx-4">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(minutes / summaryData.timeStats.totalLaborMinutes) * 100}%` }}
                    ></div>
                  </div>
                </div>
                <span className="text-sm font-medium">
                  {((minutes / summaryData.timeStats.totalLaborMinutes) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Time Analysis */}
      <Card>
        <CardHeader>
          <CardTitle>Time Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-sm font-medium">Avg Machine Time</span>
              <span className="text-lg font-bold text-blue-600">{summaryData.timeStats.avgMachineMinutes.toFixed(1)} min</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-sm font-medium">Avg Labor Time</span>
              <span className="text-lg font-bold text-green-600">{summaryData.timeStats.avgLaborMinutes.toFixed(1)} min</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-sm font-medium">Max Sequence</span>
              <span className="text-lg font-bold text-orange-600">{summaryData.sequenceStats.maxSequence}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-sm font-medium">Avg Sequence</span>
              <span className="text-lg font-bold text-purple-600">{summaryData.sequenceStats.avgSequence.toFixed(1)}</span>
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
                <span>Complete Operations</span>
                <span className="font-medium">{summaryData.dataQuality.completeProfiles} of {summaryData.totalOperations}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-green-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(summaryData.dataQuality.completeProfiles / summaryData.totalOperations) * 100}%` }}
                ></div>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>With Machine</span>
                <span className="font-medium">{summaryData.completeness.withMachine} of {summaryData.totalOperations}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(summaryData.completeness.withMachine / summaryData.totalOperations) * 100}%` }}
                ></div>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>With Labor Rate</span>
                <span className="font-medium">{summaryData.completeness.withLaborRate} of {summaryData.totalOperations}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-yellow-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(summaryData.completeness.withLaborRate / summaryData.totalOperations) * 100}%` }}
                ></div>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>With Description</span>
                <span className="font-medium">{summaryData.completeness.withDescription} of {summaryData.totalOperations}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-cyan-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(summaryData.completeness.withDescription / summaryData.totalOperations) * 100}%` }}
                ></div>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>With Time Data</span>
                <span className="font-medium">{summaryData.completeness.withMachineMinutes + summaryData.completeness.withLaborMinutes} of {summaryData.totalOperations * 2}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${((summaryData.completeness.withMachineMinutes + summaryData.completeness.withLaborMinutes) / (summaryData.totalOperations * 2)) * 100}%` }}
                ></div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle>Recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {summaryData.dataQuality.incompleteProfiles > 0 && (
              <div className="flex items-start space-x-3 p-3 bg-yellow-50 rounded-lg">
                <span className="text-xl">⚠️</span>
                <span className="text-sm">
                  {summaryData.dataQuality.incompleteProfiles} router operations have incomplete data. 
                  Consider adding missing machine assignments or time estimates.
                </span>
              </div>
            )}
            
            {summaryData.completeness.withMachineMinutes < summaryData.totalOperations * 0.8 && (
              <div className="flex items-start space-x-3 p-3 bg-blue-50 rounded-lg">
                <span className="text-xl">⏰</span>
                <span className="text-sm">
                  Only {Math.round((summaryData.completeness.withMachineMinutes / summaryData.totalOperations) * 100)}% of operations have machine time data. 
                  Machine time is crucial for capacity planning.
                </span>
              </div>
            )}
            
            {summaryData.completeness.withLaborMinutes < summaryData.totalOperations * 0.8 && (
              <div className="flex items-start space-x-3 p-3 bg-green-50 rounded-lg">
                <span className="text-xl">👷</span>
                <span className="text-sm">
                  Only {Math.round((summaryData.completeness.withLaborMinutes / summaryData.totalOperations) * 100)}% of operations have labor time data. 
                  Labor time is essential for cost calculations.
                </span>
              </div>
            )}
            
            {summaryData.sequenceStats.maxSequence > 10 && (
              <div className="flex items-start space-x-3 p-3 bg-orange-50 rounded-lg">
                <span className="text-xl">🔄</span>
                <span className="text-sm">
                  Some routers have long sequences (max: {summaryData.sequenceStats.maxSequence}). 
                  Consider breaking down complex operations for better tracking.
                </span>
              </div>
            )}
            
            {Object.keys(summaryData.versionBreakdown).length > 5 && (
              <div className="flex items-start space-x-3 p-3 bg-purple-50 rounded-lg">
                <span className="text-xl">🏷️</span>
                <span className="text-sm">
                  Multiple router versions detected. Consider consolidating or archiving older versions.
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default RouterSummary;