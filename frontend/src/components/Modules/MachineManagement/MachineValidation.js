import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';

const MachineValidation = ({ machines }) => {
  const validationResults = useMemo(() => {
    const issues = [];
    const warnings = [];
    const stats = {
      total: machines.length,
      valid: 0,
      withIssues: 0,
      withWarnings: 0
    };

    machines.forEach((machine, index) => {
      const machineIssues = [];
      const machineWarnings = [];

      // Required field validation
      if (!machine.machine_name || (typeof machine.machine_name === 'string' && machine.machine_name.trim() === '') || machine.machine_name === null || machine.machine_name === undefined) {
        machineIssues.push('Missing machine name');
      }

      if (!machine.machine_id || (typeof machine.machine_id === 'string' && machine.machine_id.trim() === '') || machine.machine_id === null || machine.machine_id === undefined) {
        machineIssues.push('Missing machine ID');
      }

      // Rate validation
      if (machine.machine_rate !== null && machine.machine_rate !== undefined) {
        if (isNaN(machine.machine_rate) || machine.machine_rate < 0) {
          machineIssues.push('Invalid machine rate (must be a positive number)');
        } else if (machine.machine_rate === 0) {
          machineWarnings.push('Machine rate is zero');
        } else if (machine.machine_rate > 1000) {
          machineWarnings.push('Machine rate seems unusually high (>$1000/hour)');
        }
      } else {
        machineWarnings.push('No machine rate provided');
      }

      // Capacity validation
      if (machine.available_minutes_per_month !== null && machine.available_minutes_per_month !== undefined) {
        if (isNaN(machine.available_minutes_per_month) || machine.available_minutes_per_month < 0) {
          machineIssues.push('Invalid capacity (must be a positive number)');
        } else if (machine.available_minutes_per_month === 0) {
          machineWarnings.push('Machine capacity is zero');
        } else if (machine.available_minutes_per_month > 50000) {
          machineWarnings.push('Machine capacity seems unusually high (>50,000 min/month)');
        }
      } else {
        machineWarnings.push('No capacity information provided');
      }

      // Labor type validation
      if (!machine.labor_type || (typeof machine.labor_type === 'string' && machine.labor_type.trim() === '') || machine.labor_type === null || machine.labor_type === undefined) {
        machineWarnings.push('No labor type specified');
      }

      // Description validation
      if (!machine.machine_description || (typeof machine.machine_description === 'string' && machine.machine_description.trim() === '') || machine.machine_description === null || machine.machine_description === undefined) {
        machineWarnings.push('No machine description provided');
      }

      // Duplicate check
      const duplicateName = machines.find((m, i) => 
        i !== index && 
        m.machine_name && 
        m.machine_name.toLowerCase() === machine.machine_name?.toLowerCase()
      );
      if (duplicateName) {
        machineWarnings.push('Duplicate machine name detected');
      }

      const duplicateId = machines.find((m, i) => 
        i !== index && 
        m.machine_id && 
        m.machine_id.toLowerCase() === machine.machine_id?.toLowerCase()
      );
      if (duplicateId) {
        machineIssues.push('Duplicate machine ID detected');
      }

      // Data completeness check
      const hasCompleteProfile = machine.machine_name && 
                                machine.machine_rate && 
                                machine.labor_type && 
                                machine.available_minutes_per_month;
      if (!hasCompleteProfile) {
        machineWarnings.push('Incomplete profile information');
      }

      // Add to overall stats
      if (machineIssues.length > 0) {
        issues.push({
          machine,
          issues: machineIssues
        });
        stats.withIssues++;
      } else if (machineWarnings.length > 0) {
        warnings.push({
          machine,
          warnings: machineWarnings
        });
        stats.withWarnings++;
      } else {
        stats.valid++;
      }
    });

    return { issues, warnings, stats };
  }, [machines]);

  const getSeverityClass = (type) => {
    return type === 'issue' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800';
  };

  const getSeverityIcon = (type) => {
    return type === 'issue' ? '❌' : '⚠️';
  };

  const formatCurrency = (value) => {
    if (!value) return 'N/A';
    return `$${Number(value).toFixed(2)}`;
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
                      <div>Type: {item.machine.labor_type || 'N/A'}</div>
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
                      <div>Type: {item.machine.labor_type || 'N/A'}</div>
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
                      <div>Rate: {formatCurrency(machine.machine_rate)}</div>
                      <div>Type: {machine.labor_type || 'N/A'}</div>
                      <div>Capacity: {machine.available_minutes_per_month || 'N/A'} min/month</div>
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