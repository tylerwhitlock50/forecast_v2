import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { StatsCard } from '../../ui/stats-card';
import { Select, SelectOption } from '../../ui/select';
import { Label } from '../../ui/label';

const formatCurrency = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
}).format(amount || 0);

const formatCompact = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact'
}).format(amount || 0);

const DepartmentAnalytics = ({ departmentCosts }) => {
  const safeDepartmentCosts = departmentCosts || {};
  const [sortBy, setSortBy] = useState('totalCost');
  const [sortOrder, setSortOrder] = useState('desc');

  const sortedDepartments = Object.entries(safeDepartmentCosts).sort((a, b) => {
    const [nameA, deptA] = a;
    const [nameB, deptB] = b;
    let valueA, valueB;
    switch (sortBy) {
      case 'name': valueA = nameA; valueB = nameB; break;
      case 'employees': valueA = deptA.employees; valueB = deptB.employees; break;
      case 'avgRate': valueA = deptA.avgRate; valueB = deptB.avgRate; break;
      case 'totalCost':
      default: valueA = deptA.totalCost; valueB = deptB.totalCost;
    }
    if (sortOrder === 'asc') return valueA > valueB ? 1 : -1;
    return valueA < valueB ? 1 : -1;
  });

  const totals = Object.values(safeDepartmentCosts).reduce(
    (acc, dept) => ({
      employees: acc.employees + (dept.employees || 0),
      totalCost: acc.totalCost + (dept.totalCost || 0)
    }),
    { employees: 0, totalCost: 0 }
  );

  const avgCostPerEmployee = totals.employees > 0 ? totals.totalCost / totals.employees : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold">Department Cost Analysis</h2>
        <div className="flex items-center gap-2">
          <Label className="text-sm">Sort by:</Label>
          <Select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="w-40">
            <SelectOption value="totalCost">Total Cost</SelectOption>
            <SelectOption value="employees">Employee Count</SelectOption>
            <SelectOption value="avgRate">Average Rate</SelectOption>
            <SelectOption value="name">Department Name</SelectOption>
          </Select>
          <Select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="w-36">
            <SelectOption value="desc">Highest First</SelectOption>
            <SelectOption value="asc">Lowest First</SelectOption>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Departments"
          value={Object.keys(safeDepartmentCosts).length}
          subtitle="Active departments"
          variant="primary"
        />
        <StatsCard
          title="Total Employees"
          value={totals.employees}
          subtitle="Across all departments"
          variant="success"
        />
        <StatsCard
          title="Total Annual Cost"
          value={formatCurrency(totals.totalCost)}
          subtitle="All departments combined"
          variant="warning"
        />
        <StatsCard
          title="Avg Cost per Employee"
          value={formatCurrency(avgCostPerEmployee)}
          subtitle="Company average"
          variant="default"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Department Cost Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          {sortedDepartments.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No departments yet.</div>
          ) : (
            <div className="space-y-3">
              {sortedDepartments.map(([name, dept]) => {
                const percentage = totals.totalCost > 0 ? (dept.totalCost / totals.totalCost) * 100 : 0;
                return (
                  <div key={name} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-700">{name}</span>
                      <span className="text-gray-500">
                        {percentage.toFixed(1)}% · {formatCompact(dept.totalCost)}
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${percentage}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Department Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-gray-600">
                  <th className="px-3 py-2 font-medium">Department</th>
                  <th className="px-3 py-2 font-medium">Employees</th>
                  <th className="px-3 py-2 font-medium">Annual Cost</th>
                  <th className="px-3 py-2 font-medium">% of Total</th>
                  <th className="px-3 py-2 font-medium">Avg Cost/Employee</th>
                  <th className="px-3 py-2 font-medium">Bi-weekly</th>
                  <th className="px-3 py-2 font-medium">Monthly</th>
                </tr>
              </thead>
              <tbody>
                {sortedDepartments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                      No departments
                    </td>
                  </tr>
                ) : sortedDepartments.map(([deptName, deptData]) => {
                  const percentOfTotal = totals.totalCost > 0 ? (deptData.totalCost / totals.totalCost) * 100 : 0;
                  const costPerEmployee = deptData.employees > 0 ? deptData.totalCost / deptData.employees : 0;
                  return (
                    <tr key={deptName} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        <div className="space-y-1">
                          <div className="font-medium text-gray-800">{deptName}</div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${percentOfTotal}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-700">{deptData.employees}</td>
                      <td className="px-3 py-2 text-gray-700">{formatCurrency(deptData.totalCost)}</td>
                      <td className="px-3 py-2 text-gray-700">{percentOfTotal.toFixed(1)}%</td>
                      <td className="px-3 py-2 text-gray-700">{formatCurrency(costPerEmployee)}</td>
                      <td className="px-3 py-2 text-gray-700">{formatCurrency(deptData.totalCost / 26)}</td>
                      <td className="px-3 py-2 text-gray-700">{formatCurrency(deptData.totalCost / 12)}</td>
                    </tr>
                  );
                })}
              </tbody>
              {sortedDepartments.length > 0 && (
                <tfoot>
                  <tr className="border-t bg-gray-50 font-semibold text-gray-800">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2">{totals.employees}</td>
                    <td className="px-3 py-2">{formatCurrency(totals.totalCost)}</td>
                    <td className="px-3 py-2">100.0%</td>
                    <td className="px-3 py-2">{formatCurrency(avgCostPerEmployee)}</td>
                    <td className="px-3 py-2">{formatCurrency(totals.totalCost / 26)}</td>
                    <td className="px-3 py-2">{formatCurrency(totals.totalCost / 12)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      {sortedDepartments.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-base font-semibold">Department Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedDepartments.map(([deptName, deptData]) => (
              <DepartmentCard
                key={deptName}
                name={deptName}
                data={deptData}
                totalCost={totals.totalCost}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const DepartmentCard = ({ name, data, totalCost }) => {
  const percentOfTotal = totalCost > 0 ? (data.totalCost / totalCost) * 100 : 0;
  const costPerEmployee = data.employees > 0 ? data.totalCost / data.employees : 0;

  const Row = ({ label, value }) => (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-800 font-medium">{value}</span>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{name}</CardTitle>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {percentOfTotal.toFixed(1)}%
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <Row label="Employees" value={data.employees} />
        <Row label="Annual Cost" value={formatCurrency(data.totalCost)} />
        <Row label="Cost per Employee" value={formatCurrency(costPerEmployee)} />
        <Row label="Monthly Cost" value={formatCurrency(data.totalCost / 12)} />
        <Row label="Bi-weekly Cost" value={formatCurrency(data.totalCost / 26)} />
        <div className="h-1.5 mt-2 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-primary" style={{ width: `${percentOfTotal}%` }} />
        </div>
      </CardContent>
    </Card>
  );
};

export default DepartmentAnalytics;
