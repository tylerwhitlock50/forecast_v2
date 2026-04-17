import React, { useState } from 'react';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { Select, SelectOption } from '../../ui/select';

const formatCurrency = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
}).format(amount || 0);

const formatCompact = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact'
}).format(amount || 0);

const BusinessUnitAllocation = ({
  employees,
  businessUnits,
  businessUnitCosts,
  onEditAllocations
}) => {
  const safeEmployees = employees || [];
  const safeBusinessUnits = businessUnits || [];
  const safeBusinessUnitCosts = businessUnitCosts || {};

  const [viewMode, setViewMode] = useState('overview');
  const [selectedBusinessUnit, setSelectedBusinessUnit] = useState('');

  const getEmployeesForBusinessUnit = (businessUnit) =>
    safeEmployees.filter(emp =>
      emp.status === 'active' &&
      emp.allocations &&
      emp.allocations[businessUnit] > 0
    );

  const allocationMatrix = safeEmployees
    .filter(emp => emp.status === 'active')
    .map(emp => {
      const row = { employee: emp, allocations: {} };
      safeBusinessUnits.forEach(unit => {
        row.allocations[unit] = emp.allocations?.[unit] || 0;
      });
      return row;
    });

  const allocationIssues = safeEmployees
    .filter(emp => emp.status === 'active')
    .map(emp => {
      const total = Object.values(emp.allocations || {}).reduce((sum, val) => sum + val, 0);
      if (Math.abs(total - 100) > 0.01) {
        return {
          employee: emp.employee_name,
          employeeRef: emp,
          total,
          issue: total < 100 ? 'Under-allocated' : 'Over-allocated'
        };
      }
      return null;
    })
    .filter(Boolean);

  const viewTabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'employee', label: 'By Employee' },
    { id: 'matrix', label: 'Allocation Matrix' }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Business Unit Allocation</h2>
        <div className="inline-flex rounded-md border bg-white">
          {viewTabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setViewMode(tab.id)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                viewMode === tab.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {allocationIssues.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-base text-amber-800">
              ⚠️ Allocation Issues ({allocationIssues.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {allocationIssues.map((issue, index) => (
              <div key={index} className="flex items-center gap-3 rounded border border-amber-200 bg-white px-3 py-2">
                <span className="font-medium text-gray-800">{issue.employee}</span>
                <Badge variant={issue.issue === 'Over-allocated' ? 'destructive' : 'secondary'}>
                  {issue.issue}
                </Badge>
                <span className="text-sm text-gray-600">{issue.total.toFixed(1)}%</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => onEditAllocations(issue.employeeRef)}
                >
                  Fix
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {viewMode === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {safeBusinessUnits.map(unit => {
              const unitData = safeBusinessUnitCosts[unit] || { employees: 0, totalCost: 0 };
              const unitEmployees = getEmployeesForBusinessUnit(unit);

              return (
                <Card key={unit}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">{unit}</CardTitle>
                      <div className="flex gap-2 text-xs">
                        <Badge variant="secondary">{unitData.employees.toFixed(1)} FTE</Badge>
                        <Badge variant="outline">{formatCurrency(unitData.totalCost)}</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-gray-500">Annual Cost</div>
                        <div className="font-medium text-gray-800">{formatCurrency(unitData.totalCost)}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">FTE Allocation</div>
                        <div className="font-medium text-gray-800">{unitData.employees.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Employees</div>
                        <div className="font-medium text-gray-800">{unitEmployees.length}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Avg per FTE</div>
                        <div className="font-medium text-gray-800">
                          {unitData.employees > 0
                            ? formatCurrency(unitData.totalCost / unitData.employees)
                            : '$0'}
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-sm font-medium text-gray-700">Key Contributors</div>
                      <div className="flex flex-wrap gap-2">
                        {unitEmployees
                          .sort((a, b) => (b.allocations[unit] || 0) - (a.allocations[unit] || 0))
                          .slice(0, 5)
                          .map(emp => (
                            <span
                              key={emp.employee_id}
                              className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700"
                            >
                              <span className="font-medium">{emp.employee_name}</span>
                              <span className="text-gray-500">{emp.allocations[unit]}%</span>
                            </span>
                          ))}
                        {unitEmployees.length > 5 && (
                          <span className="inline-flex items-center rounded-full bg-gray-200 px-3 py-1 text-xs text-gray-600">
                            +{unitEmployees.length - 5} more
                          </span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cost Distribution by Business Unit</CardTitle>
              </CardHeader>
              <CardContent>
                <DistributionList data={safeBusinessUnitCosts} metric="totalCost" formatValue={formatCompact} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">FTE Distribution by Business Unit</CardTitle>
              </CardHeader>
              <CardContent>
                <DistributionList
                  data={safeBusinessUnitCosts}
                  metric="employees"
                  formatValue={(v) => `${(v || 0).toFixed(2)} FTE`}
                  barClass="bg-blue-500"
                />
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {viewMode === 'employee' && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-gray-600">
                    <th className="px-3 py-2 font-medium">Employee</th>
                    <th className="px-3 py-2 font-medium">Department</th>
                    <th className="px-3 py-2 font-medium">Annual Cost</th>
                    {safeBusinessUnits.map(unit => (
                      <th key={unit} className="px-3 py-2 font-medium">{unit}</th>
                    ))}
                    <th className="px-3 py-2 font-medium">Total</th>
                    <th className="px-3 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {safeEmployees
                    .filter(emp => emp.status === 'active')
                    .map(emp => {
                      const totalAllocation = Object.values(emp.allocations || {})
                        .reduce((sum, val) => sum + val, 0);
                      const isValid = Math.abs(totalAllocation - 100) <= 0.01;

                      return (
                        <tr key={emp.employee_id} className={`border-b last:border-0 ${!isValid ? 'bg-red-50' : ''}`}>
                          <td className="px-3 py-2 text-gray-800">{emp.employee_name}</td>
                          <td className="px-3 py-2 text-gray-600">{emp.department}</td>
                          <td className="px-3 py-2 text-gray-700">
                            {formatCurrency((emp.hourly_rate || 0) * (emp.weekly_hours || 0) * 52 * 1.4)}
                          </td>
                          {safeBusinessUnits.map(unit => (
                            <td key={unit} className="px-3 py-2 text-gray-700">
                              {emp.allocations?.[unit] || 0}%
                            </td>
                          ))}
                          <td className={`px-3 py-2 font-medium ${isValid ? 'text-green-700' : 'text-red-700'}`}>
                            {totalAllocation.toFixed(1)}%
                          </td>
                          <td className="px-3 py-2">
                            <Button size="sm" variant="outline" onClick={() => onEditAllocations(emp)}>
                              Edit
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {viewMode === 'matrix' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Select
              value={selectedBusinessUnit}
              onChange={(e) => setSelectedBusinessUnit(e.target.value)}
              className="w-64"
            >
              <SelectOption value="">All Business Units</SelectOption>
              {safeBusinessUnits.map(unit => (
                <SelectOption key={unit} value={unit}>{unit}</SelectOption>
              ))}
            </Select>
          </div>

          <AllocationMatrix
            matrix={allocationMatrix}
            businessUnits={safeBusinessUnits}
            selectedBusinessUnit={selectedBusinessUnit}
            onEditAllocations={onEditAllocations}
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Business Unit Totals</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {safeBusinessUnits.map(unit => {
                  const unitData = safeBusinessUnitCosts[unit] || { employees: 0, totalCost: 0 };
                  return (
                    <div key={unit} className="rounded border p-3">
                      <div className="text-sm font-medium text-gray-800">{unit}</div>
                      <div className="text-xs text-gray-500">{unitData.employees.toFixed(2)} FTE</div>
                      <div className="text-sm font-semibold text-gray-700">{formatCurrency(unitData.totalCost)}</div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

const DistributionList = ({ data, metric, formatValue, barClass = 'bg-primary' }) => {
  const total = Object.values(data).reduce((sum, unit) => sum + (unit?.[metric] || 0), 0);
  const entries = Object.entries(data);

  if (entries.length === 0) {
    return <div className="text-sm text-gray-500">No data available</div>;
  }

  return (
    <div className="space-y-3">
      {entries.map(([unit, unitData]) => {
        const value = unitData?.[metric] || 0;
        const percentage = total > 0 ? (value / total) * 100 : 0;
        return (
          <div key={unit} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-gray-700">{unit}</span>
              <span className="text-gray-500">
                {percentage.toFixed(1)}% · {formatValue(value)}
              </span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full ${barClass}`} style={{ width: `${percentage}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const AllocationMatrix = ({ matrix, businessUnits, selectedBusinessUnit, onEditAllocations }) => {
  const filteredMatrix = selectedBusinessUnit
    ? matrix.filter(row => row.allocations[selectedBusinessUnit] > 0)
    : matrix;

  if (filteredMatrix.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          No employees to display.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-gray-600">
                <th className="px-3 py-2 font-medium">Employee</th>
                {businessUnits.map(unit => (
                  <th
                    key={unit}
                    className={`px-3 py-2 font-medium ${
                      selectedBusinessUnit === unit ? 'bg-primary/10 text-primary' : ''
                    }`}
                  >
                    {unit}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredMatrix.map(row => {
                const total = Object.values(row.allocations).reduce((sum, val) => sum + val, 0);
                const isValid = Math.abs(total - 100) <= 0.01;

                return (
                  <tr
                    key={row.employee.employee_id}
                    className={`border-b last:border-0 ${!isValid ? 'bg-red-50' : ''}`}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-800">{row.employee.employee_name}</div>
                      <div className="text-xs text-gray-500">{row.employee.department}</div>
                    </td>
                    {businessUnits.map(unit => {
                      const value = row.allocations[unit];
                      return (
                        <td
                          key={unit}
                          className={`px-3 py-2 ${
                            selectedBusinessUnit === unit ? 'bg-primary/5' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="w-10 text-sm text-gray-700">{value}%</span>
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-primary" style={{ width: `${value}%` }} />
                            </div>
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2">
                      <Button size="sm" variant="outline" onClick={() => onEditAllocations(row.employee)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
};

export default BusinessUnitAllocation;
