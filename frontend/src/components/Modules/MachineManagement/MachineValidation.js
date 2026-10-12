import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { formatCapacityHours, validateMachines } from './machineHelpers';

const MachineValidation = ({ machines }) => {
  // Only the hourly rate and the monthly capacity matter for cost and
  // capacity; labor type and description are optional.
  const validationResults = useMemo(() => validateMachines(machines), [machines]);

  const formatCurrency = (value) => {
    if (value === null || value === undefined || value === '') return 'not set';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
  };
  const formatCapacity = (minutes) => {
    const hours = formatCapacityHours(minutes);
    return hours === null ? 'not set' : `${hours} h / month`;
  };

  return (
    <div className="space-y-6">
      {/* Validation Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl">🏭</div>
              <div>
                <p className="text-2xl font-bold">{validationResults.stats.total}</p>
                <p className="text-sm text-muted-foreground">Total Machines</p>
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
              <div className="text-3xl text-red-600">❌</div>
              <div>
                <p className="text-2xl font-bold">{validationResults.stats.withIssues}</p>
                <p className="text-sm text-muted-foreground">With Issues</p>
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
      </div>

      {/* Issues */}
      {validationResults.issues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <span className="text-red-600">❌</span>
              <span>Critical Issues ({validationResults.issues.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {validationResults.issues.map((item, index) => (
                <div key={index} className="border border-red-200 rounded-lg p-4 bg-red-50">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="font-semibold text-red-800 mb-2">
                        {item.machine.machine_name || item.machine.machine_id || 'Unknown Machine'}
                      </h4>
                      <div className="space-y-1">
                        {item.issues.map((issue, issueIndex) => (
                          <div key={issueIndex} className="flex items-center space-x-2 text-sm text-red-700">
                            <span>•</span>
                            <span>{issue}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="ml-4 text-right text-sm text-gray-600">
                      <div>ID: {item.machine.machine_id || 'N/A'}</div>
                      <div>Rate: {formatCurrency(item.machine.machine_rate)}</div>
                      <div>Capacity: {formatCapacity(item.machine.available_minutes_per_month)}</div>
                    </div>
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
              <span className="text-yellow-600">⚠️</span>
              <span>Warnings ({validationResults.warnings.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {validationResults.warnings.map((item, index) => (
                <div key={index} className="border border-yellow-200 rounded-lg p-4 bg-yellow-50">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="font-semibold text-yellow-800 mb-2">
                        {item.machine.machine_name || item.machine.machine_id || 'Unknown Machine'}
                      </h4>
                      <div className="space-y-1">
                        {item.warnings.map((warning, warningIndex) => (
                          <div key={warningIndex} className="flex items-center space-x-2 text-sm text-yellow-700">
                            <span>•</span>
                            <span>{warning}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="ml-4 text-right text-sm text-gray-600">
                      <div>ID: {item.machine.machine_id || 'N/A'}</div>
                      <div>Rate: {formatCurrency(item.machine.machine_rate)}</div>
                      <div>Capacity: {formatCapacity(item.machine.available_minutes_per_month)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Valid Machines */}
      {validationResults.stats.valid > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <span className="text-green-600">✅</span>
              <span>Valid Machines ({validationResults.stats.valid})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {machines.filter(machine => {
                const hasIssues = validationResults.issues.some(item => item.machine.machine_id === machine.machine_id);
                const hasWarnings = validationResults.warnings.some(item => item.machine.machine_id === machine.machine_id);
                return !hasIssues && !hasWarnings;
              }).map(machine => (
                <div key={machine.machine_id} className="border border-green-200 rounded-lg p-4 bg-green-50">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-green-800">{machine.machine_name}</h4>
                    <Badge variant="outline" className="bg-green-100 text-green-800">
                      Valid
                    </Badge>
                  </div>
                                      <div className="text-sm text-gray-600 space-y-1">
                      <div>ID: {machine.machine_id}</div>
                      <div>Rate: {formatCurrency(machine.machine_rate)}/hour</div>
                      <div>Capacity: {formatCapacity(machine.available_minutes_per_month)}</div>
                    </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* No Issues Found */}
      {validationResults.stats.total > 0 && validationResults.stats.valid === validationResults.stats.total && (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="text-6xl mb-4">🎉</div>
            <h3 className="text-xl font-semibold text-green-600 mb-2">All Machines Valid!</h3>
            <p className="text-gray-600">All {validationResults.stats.total} machines have passed validation checks.</p>
          </CardContent>
        </Card>
      )}

      {/* No Data */}
      {validationResults.stats.total === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="text-6xl mb-4">🏭</div>
            <h3 className="text-xl font-semibold text-gray-600 mb-2">No Machines Found</h3>
            <p className="text-gray-500">Add some machines to start validation.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default MachineValidation;