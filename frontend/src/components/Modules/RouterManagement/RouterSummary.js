import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';

const RouterSummary = ({ routers, routerOperations, machines, products = [], laborRates }) => {
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
    
    // Per routing (= per finished unit of a product using it)
    const routingCount = routerDefs.length;
    const avgMachinePerRouting = routingCount > 0 ? totalMachineMinutes / routingCount : 0;
    const avgLaborPerRouting = routingCount > 0 ? totalLaborMinutes / routingCount : 0;
    const avgOpsPerRouting = routingCount > 0 ? totalOperations / routingCount : 0;
    const usedRoutings = routerDefs.filter(r => (products || []).some(p => (p.router ?? p.router_id) === r.router_id)).length;
    
    // Data completeness from operations
    const withMachine = operations.filter(op => op.machine_id).length;
    const withLaborRate = operations.filter(op => op.labor_type_id).length;
    const withMachineMinutes = operations.filter(op => op.machine_minutes && op.machine_minutes > 0).length;
    const withLaborMinutes = operations.filter(op => op.labor_minutes && op.labor_minutes > 0).length;
    const withAnyTime = operations.filter(op => (op.machine_minutes > 0) || (op.labor_minutes > 0)).length;
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
      routingStats: {
        avgMachinePerRouting,
        avgLaborPerRouting,
        avgOpsPerRouting,
        usedRoutings
      },
      completeness: {
        withMachine,
        withLaborRate,
        withMachineMinutes,
        withLaborMinutes,
        withAnyTime,
        withDescription
      },
      dataQuality: {
        completeProfiles,
        incompleteProfiles: totalOperations - completeProfiles
      }
    };
  }, [routers, routerOperations, products]);

  const topVersions = Object.entries(summaryData.versionBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);

  const topRouters = Object.entries(summaryData.routerBreakdown)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 12);

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

  const recommendations = [];
  if (summaryData.dataQuality.incompleteProfiles > 0) {
    recommendations.push({
      key: 'incomplete', icon: '⚠️', tone: 'bg-yellow-50',
      text: `${summaryData.dataQuality.incompleteProfiles} ${summaryData.dataQuality.incompleteProfiles === 1 ? 'operation is' : 'operations are'} missing a machine, a labor type or minutes. See Data Validation.`,
    });
  }
  if (summaryData.totalRouters > 0 && summaryData.routingStats.usedRoutings < summaryData.totalRouters) {
    const unused = summaryData.totalRouters - summaryData.routingStats.usedRoutings;
    recommendations.push({
      key: 'unused', icon: '🔗', tone: 'bg-blue-50',
      text: `${unused} ${unused === 1 ? 'routing is' : 'routings are'} not linked to a product, so ${unused === 1 ? 'its' : 'their'} labor and machine cost does not reach COGS.`,
    });
  }

  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl">🔄</div>
              <div>
                <p className="text-2xl font-bold">{summaryData.totalRouters}</p>
                <p className="text-sm text-muted-foreground">Routings · {summaryData.routingStats.usedRoutings} used by products</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl">✅</div>
              <div>
                <p className="text-2xl font-bold">{summaryData.totalOperations}</p>
                <p className="text-sm text-muted-foreground">Operations · {summaryData.dataQuality.completeProfiles} complete</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl">🏭</div>
              <div>
                <p className="text-2xl font-bold">{formatMinutes(summaryData.routingStats.avgMachinePerRouting)}</p>
                <p className="text-sm text-muted-foreground" title="Machine minutes per finished unit, averaged over the routings">Avg machine time / unit</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl">👷</div>
              <div>
                <p className="text-2xl font-bold">{formatMinutes(summaryData.routingStats.avgLaborPerRouting)}</p>
                <p className="text-sm text-muted-foreground" title="Labor minutes per finished unit, averaged over the routings">Avg labor time / unit</p>
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
                  <span className="text-sm text-muted-foreground">{count} {count === 1 ? 'routing' : 'routings'}</span>
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
          <CardTitle>Operations per Routing</CardTitle>
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
          <CardTitle>Machine Minutes per Unit, by Machine <span className="text-sm font-normal text-gray-500">(all routings)</span></CardTitle>
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
          <CardTitle>Labor Minutes per Unit, by Labor Type <span className="text-sm font-normal text-gray-500">(all routings)</span></CardTitle>
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
              <span className="text-sm font-medium">Average machine minutes per operation</span>
              <span className="text-lg font-bold text-blue-600">{summaryData.timeStats.avgMachineMinutes.toFixed(1)} min</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-sm font-medium">Average labor minutes per operation</span>
              <span className="text-lg font-bold text-green-600">{summaryData.timeStats.avgLaborMinutes.toFixed(1)} min</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-sm font-medium">Average operations per routing</span>
              <span className="text-lg font-bold text-orange-600">{summaryData.routingStats.avgOpsPerRouting.toFixed(1)}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <span className="text-sm font-medium">Routings used by a product</span>
              <span className="text-lg font-bold text-purple-600">{summaryData.routingStats.usedRoutings} of {summaryData.totalRouters}</span>
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
                <span>With Machine or Labor Minutes</span>
                <span className="font-medium">{summaryData.completeness.withAnyTime} of {summaryData.totalOperations}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(summaryData.completeness.withAnyTime / summaryData.totalOperations) * 100}%` }}
                ></div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recommendations (only when there is something to do) */}
      {recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recommendations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recommendations.map((r) => (
                <div key={r.key} className={`flex items-start space-x-3 p-3 rounded-lg ${r.tone}`}>
                  <span className="text-xl">{r.icon}</span>
                  <span className="text-sm">{r.text}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default RouterSummary;