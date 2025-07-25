import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';

const RouterValidation = ({ routers, routerOperations, machines, units, laborRates }) => {
  const validationResults = useMemo(() => {
    const issues = [];
    const warnings = [];
    const stats = {
      total: (routers?.length || 0) + (routerOperations?.length || 0),
      valid: 0,
      withIssues: 0,
      withWarnings: 0
    };

    // Create lookup maps for faster validation
    const machineIds = new Set(machines.map(m => m.machine_id));
    const unitIds = new Set(units.map(u => u.unit_id));
    const laborRateIds = new Set(laborRates.map(r => r.rate_id));

    // Validate router definitions
    if (routers && routers.length > 0) {
      routers.forEach((router, index) => {
      const routerIssues = [];
      const routerWarnings = [];

      // Required field validation
      if (!router.router_id || (typeof router.router_id === 'string' && router.router_id.trim() === '') || router.router_id === null || router.router_id === undefined) {
        routerIssues.push('Missing router ID');
      }

      if (!router.unit_id || (typeof router.unit_id === 'string' && router.unit_id.trim() === '') || router.unit_id === null || router.unit_id === undefined) {
        routerIssues.push('Missing unit ID');
      }

      if (!router.machine_id || (typeof router.machine_id === 'string' && router.machine_id.trim() === '') || router.machine_id === null || router.machine_id === undefined) {
        routerIssues.push('Missing machine ID');
      }

      if (!router.sequence || router.sequence < 1) {
        routerIssues.push('Missing or invalid sequence number');
      }

      // Foreign key validation
      if (router.unit_id && !unitIds.has(router.unit_id)) {
        routerIssues.push(`Unit '${router.unit_id}' does not exist`);
      }

      if (router.machine_id && !machineIds.has(router.machine_id)) {
        routerIssues.push(`Machine '${router.machine_id}' does not exist`);
      }

      if (router.labor_type_id && !laborRateIds.has(router.labor_type_id)) {
        routerIssues.push(`Labor rate '${router.labor_type_id}' does not exist`);
      }

      // Time validation
      if (router.machine_minutes !== null && router.machine_minutes !== undefined) {
        if (isNaN(router.machine_minutes) || router.machine_minutes < 0) {
          routerIssues.push('Invalid machine minutes (must be a positive number)');
        } else if (router.machine_minutes === 0) {
          routerWarnings.push('Machine minutes is zero');
        } else if (router.machine_minutes > 1440) {
          routerWarnings.push('Machine minutes exceeds 24 hours');
        }
      } else {
        routerWarnings.push('No machine minutes specified');
      }

      if (router.labor_minutes !== null && router.labor_minutes !== undefined) {
        if (isNaN(router.labor_minutes) || router.labor_minutes < 0) {
          routerIssues.push('Invalid labor minutes (must be a positive number)');
        } else if (router.labor_minutes === 0) {
          routerWarnings.push('Labor minutes is zero');
        } else if (router.labor_minutes > 1440) {
          routerWarnings.push('Labor minutes exceeds 24 hours');
        }
      } else {
        routerWarnings.push('No labor minutes specified');
      }

      // Version validation
      if (!router.version || (typeof router.version === 'string' && router.version.trim() === '') || router.version === null || router.version === undefined) {
        routerWarnings.push('No version specified (defaulting to 1.0)');
      }

      // Labor rate consistency
      if (!router.labor_type_id && router.labor_minutes && router.labor_minutes > 0) {
        routerWarnings.push('Labor minutes specified but no labor rate assigned');
      }

      // Efficiency warnings
      if (router.machine_minutes && router.labor_minutes && 
          router.machine_minutes > 0 && router.labor_minutes > 0) {
        const ratio = router.labor_minutes / router.machine_minutes;
        if (ratio > 3) {
          routerWarnings.push('Labor time significantly exceeds machine time');
        } else if (ratio < 0.1) {
          routerWarnings.push('Machine time significantly exceeds labor time');
        }
      }

      // Add to overall stats
      if (routerIssues.length > 0) {
        issues.push({
          router,
          issues: routerIssues
        });
        stats.withIssues++;
      } else if (routerWarnings.length > 0) {
        warnings.push({
          router,
          warnings: routerWarnings
        });
        stats.withWarnings++;
      } else {
        stats.valid++;
      }
    });
    }

    // Validate router operations
    if (routerOperations && routerOperations.length > 0) {
      routerOperations.forEach((operation, index) => {
        const operationIssues = [];
        const operationWarnings = [];

        // Required field validation
        if (!operation.router_id || (typeof operation.router_id === 'string' && operation.router_id.trim() === '') || operation.router_id === null || operation.router_id === undefined) {
          operationIssues.push('Missing router ID');
        }

        if (!operation.sequence || operation.sequence < 1) {
          operationIssues.push('Missing or invalid sequence number');
        }

        // Foreign key validation
        if (operation.machine_id && !machineIds.has(operation.machine_id)) {
          operationIssues.push(`Machine '${operation.machine_id}' does not exist`);
        }

        if (operation.labor_type_id && !laborRateIds.has(operation.labor_type_id)) {
          operationIssues.push(`Labor rate '${operation.labor_type_id}' does not exist`);
        }

        // Time validation
        if (operation.machine_minutes !== null && operation.machine_minutes !== undefined) {
          if (isNaN(operation.machine_minutes) || operation.machine_minutes < 0) {
            operationIssues.push('Invalid machine minutes (must be a positive number)');
          } else if (operation.machine_minutes === 0) {
            operationWarnings.push('Machine minutes is zero');
          } else if (operation.machine_minutes > 1440) {
            operationWarnings.push('Machine minutes exceeds 24 hours');
          }
        } else {
          operationWarnings.push('No machine minutes specified');
        }

        if (operation.labor_minutes !== null && operation.labor_minutes !== undefined) {
          if (isNaN(operation.labor_minutes) || operation.labor_minutes < 0) {
            operationIssues.push('Invalid labor minutes (must be a positive number)');
          } else if (operation.labor_minutes === 0) {
            operationWarnings.push('Labor minutes is zero');
          } else if (operation.labor_minutes > 1440) {
            operationWarnings.push('Labor minutes exceeds 24 hours');
          }
        } else {
          operationWarnings.push('No labor minutes specified');
        }

        // Add to overall stats
        if (operationIssues.length > 0) {
          issues.push({
            router: operation,
            issues: operationIssues
          });
          stats.withIssues++;
        } else if (operationWarnings.length > 0) {
          warnings.push({
            router: operation,
            warnings: operationWarnings
          });
          stats.withWarnings++;
        } else {
          stats.valid++;
        }
      });
    }

    return { issues, warnings, stats };
  }, [routers, routerOperations, machines, units, laborRates]);

  const getSeverityClass = (type) => {
    return type === 'error' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800';
  };

  const getSeverityIcon = (type) => {
    return type === 'error' ? '❌' : '⚠️';
  };

  const getRouterDisplayName = (router) => {
    // Handle both router definitions and router operations
    if (router.version !== null && router.version !== undefined) {
      // Router definition
      const versionStr = String(router.version);
      return `${router.router_id} v${versionStr} seq${router.sequence || 'N/A'}`;
    } else {
      // Router operation
      return `${router.router_id} seq${router.sequence}`;
    }
  };

  return (
    <div className="space-y-6">
      {/* Validation Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl">🔄</div>
              <div>
                <p className="text-2xl font-bold">{validationResults.stats.total}</p>
                <p className="text-sm text-muted-foreground">Total Operations</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl text-green-600">✅</div>
              <div>
                <p className="text-2xl font-bold">{validationResults.stats.valid}</p>
                <p className="text-sm text-muted-foreground">Valid</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl text-yellow-600">⚠️</div>
              <div>
                <p className="text-2xl font-bold">{validationResults.stats.withWarnings}</p>
                <p className="text-sm text-muted-foreground">With Warnings</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl text-red-600">❌</div>
              <div>
                <p className="text-2xl font-bold">{validationResults.stats.withIssues}</p>
                <p className="text-sm text-muted-foreground">With Issues</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Critical Issues */}
      {validationResults.issues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <span>❌</span>
              <span>Critical Issues ({validationResults.issues.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {validationResults.issues.map((item, index) => (
                <div key={index} className="p-4 border border-red-200 rounded-lg bg-red-50">
                  <div className="flex items-center space-x-2 mb-2">
                    <Badge variant="destructive" className="bg-red-100 text-red-800">
                      {getSeverityIcon('error')}
                    </Badge>
                    <span className="font-semibold">{getRouterDisplayName(item.router)}</span>
                    <span className="text-sm text-muted-foreground">
                      {item.router.unit_id ? 
                        `(${item.router.unit_id} → ${item.router.machine_id})` : 
                        `(${item.router.machine_id})`
                      }
                    </span>
                  </div>
                  <div className="space-y-1">
                    {item.issues.map((issue, issueIndex) => (
                      <div key={issueIndex} className="flex items-start space-x-2 text-sm">
                        <span className="text-red-600 mt-1">•</span>
                        <span>{issue}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Warnings */}
      {validationResults.warnings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <span>⚠️</span>
              <span>Warnings ({validationResults.warnings.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {validationResults.warnings.map((item, index) => (
                <div key={index} className="p-4 border border-yellow-200 rounded-lg bg-yellow-50">
                  <div className="flex items-center space-x-2 mb-2">
                    <Badge variant="outline" className="bg-yellow-100 text-yellow-800">
                      {getSeverityIcon('warning')}
                    </Badge>
                    <span className="font-semibold">{getRouterDisplayName(item.router)}</span>
                    <span className="text-sm text-muted-foreground">
                      {item.router.unit_id ? 
                        `(${item.router.unit_id} → ${item.router.machine_id})` : 
                        `(${item.router.machine_id})`
                      }
                    </span>
                  </div>
                  <div className="space-y-1">
                    {item.warnings.map((warning, warningIndex) => (
                      <div key={warningIndex} className="flex items-start space-x-2 text-sm">
                        <span className="text-yellow-600 mt-1">•</span>
                        <span>{warning}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Clear Message */}
      {validationResults.issues.length === 0 && validationResults.warnings.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="space-y-4">
              <div className="text-6xl">🎉</div>
              <h3 className="text-2xl font-bold text-green-600">All Clear!</h3>
              <p className="text-muted-foreground">Your router database looks great! All operations are valid and complete.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Quality Score */}
      <Card>
        <CardHeader>
          <CardTitle>Data Quality Score</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-8">
            <div className="flex-shrink-0">
              <div className="w-24 h-24 rounded-full bg-gradient-to-r from-green-400 to-blue-500 flex items-center justify-center">
                <div className="text-center text-white">
                  <div className="text-2xl font-bold">
                    {Math.round((validationResults.stats.valid / validationResults.stats.total) * 100)}%
                  </div>
                  <div className="text-xs">Quality</div>
                </div>
              </div>
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex justify-between">
                <span className="text-sm">Valid Operations:</span>
                <span className="font-medium">{validationResults.stats.valid}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Operations with Issues:</span>
                <span className="font-medium text-red-600">{validationResults.stats.withIssues}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Operations with Warnings:</span>
                <span className="font-medium text-yellow-600">{validationResults.stats.withWarnings}</span>
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
            {validationResults.issues.length > 0 && (
              <div className="flex items-start space-x-3 p-3 bg-red-50 rounded-lg">
                <span className="text-xl">🔧</span>
                <span className="text-sm">
                  Fix {validationResults.issues.length} critical issues to improve data quality. 
                  Focus on missing required fields and invalid foreign key references.
                </span>
              </div>
            )}
            
            {validationResults.warnings.length > 0 && (
              <div className="flex items-start space-x-3 p-3 bg-yellow-50 rounded-lg">
                <span className="text-xl">📝</span>
                <span className="text-sm">
                  Address {validationResults.warnings.length} warnings to enhance data completeness. 
                  Consider adding missing time estimates and labor rate assignments.
                </span>
              </div>
            )}
            
            {validationResults.stats.valid < validationResults.stats.total * 0.8 && (
              <div className="flex items-start space-x-3 p-3 bg-blue-50 rounded-lg">
                <span className="text-xl">📊</span>
                <span className="text-sm">
                  Data quality is below 80%. Consider implementing validation rules and 
                  regular data quality checks to maintain router accuracy.
                </span>
              </div>
            )}
            
            {validationResults.stats.valid === validationResults.stats.total && (
              <div className="flex items-start space-x-3 p-3 bg-green-50 rounded-lg">
                <span className="text-xl">🌟</span>
                <span className="text-sm">
                  Excellent data quality! Consider setting up automated validation checks 
                  to maintain this high standard as your routing data grows.
                </span>
              </div>
            )}
            
            {machines.length === 0 && (
              <div className="flex items-start space-x-3 p-3 bg-orange-50 rounded-lg">
                <span className="text-xl">🏭</span>
                <span className="text-sm">
                  No machines found in the database. Router operations require machine assignments 
                  for proper scheduling and costing.
                </span>
              </div>
            )}
            
            {units.length === 0 && (
              <div className="flex items-start space-x-3 p-3 bg-purple-50 rounded-lg">
                <span className="text-xl">📦</span>
                <span className="text-sm">
                  No units found in the database. Router operations must be linked to units 
                  for production planning.
                </span>
              </div>
            )}
            
            {laborRates.length === 0 && (
              <div className="flex items-start space-x-3 p-3 bg-indigo-50 rounded-lg">
                <span className="text-xl">💰</span>
                <span className="text-sm">
                  No labor rates found in the database. Labor rates are essential for 
                  accurate cost calculations in router operations.
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default RouterValidation;