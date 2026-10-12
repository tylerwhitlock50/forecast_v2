import React, { useState } from 'react';
import { formatDateOnly, parseLocalDate, toDateOnly } from '../../../lib/dates';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { StatsCard } from '../../ui/stats-card';
import { Badge } from '../../ui/badge';
import { PAY_FREQUENCY_LABELS, formatRate, runTotal } from './payrollView';

const formatCurrency = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
}).format(amount || 0);

const formatDate = (dateStr) => formatDateOnly(dateStr, { year: 'numeric', month: 'short', day: 'numeric' }, '—');

// All costs come from the payroll API (annual employer cost = gross + employer
// payroll taxes + benefits, the income statement's rules). Withholding is
// shown for information only; it is part of gross pay, not an extra cost.
const PayrollReports = ({
  employees,
  forecast,
  departmentCosts,
  businessUnitCosts,
  runsPerYear = 26,
  payFrequency = 'biweekly'
}) => {
  const runLabel = PAY_FREQUENCY_LABELS[payFrequency] || 'Per pay run';
  const runsPerQuarter = Math.max(1, Math.round(runsPerYear / 4));
  const safeEmployees = employees || [];
  const safeForecast = forecast || [];
  const safeDepartmentCosts = departmentCosts || {};
  const safeBusinessUnitCosts = businessUnitCosts || {};

  const [activeReport, setActiveReport] = useState('summary');
  const [dateRange, setDateRange] = useState({
    start: toDateOnly(),
    end: toDateOnly(new Date(new Date().getFullYear() + 1, new Date().getMonth(), new Date().getDate()))
  });

  const activeEmployees = safeEmployees.filter(emp => emp.status === 'active');
  const totalAnnualCost = Object.values(safeDepartmentCosts).reduce((sum, dept) => sum + (dept.totalCost || 0), 0);
  const avgSalary = activeEmployees.length > 0 ? totalAnnualCost / activeEmployees.length : 0;
  const upcomingReviewsCount = activeEmployees.filter(emp => {
    if (!emp.next_review_date) return false;
    const reviewDate = parseLocalDate(emp.next_review_date);
    if (!reviewDate) return false;
    if (isNaN(reviewDate.getTime())) return false;
    const now = new Date();
    const threeMonthsFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    return reviewDate >= now && reviewDate <= threeMonthsFromNow;
  }).length;
  const summary = {
    totalEmployees: activeEmployees.length,
    totalAnnualCost,
    avgSalary,
    monthlyAverageCost: totalAnnualCost / 12,
    perRunCost: totalAnnualCost / runsPerYear,
    upcomingReviews: upcomingReviewsCount
  };

  const largestDept = Object.entries(safeDepartmentCosts)
    .sort((a, b) => (b[1].totalCost || 0) - (a[1].totalCost || 0))[0];
  const highestBU = Object.entries(safeBusinessUnitCosts)
    .sort((a, b) => (b[1].totalCost || 0) - (a[1].totalCost || 0))[0];
  const nextQuarterForecast = safeForecast.slice(0, runsPerQuarter).reduce((sum, period) => sum + (period.totalCost || 0), 0);

  const reportTabs = [
    { id: 'summary', label: 'Executive Summary' },
    { id: 'employee', label: 'Employee Report' },
    { id: 'department', label: 'Department Report' },
    { id: 'business-unit', label: 'Business Unit Report' },
    { id: 'forecast', label: 'Forecast Report' }
  ];

  const exportToCSV = (data, filename) => {
    if (!data.length) return;
    const headers = Object.keys(data[0]);
    const escape = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csvContent = [
      headers.join(','),
      ...data.map(row => headers.map(h => escape(row[h])).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const exportEmployeeReport = () => {
    exportToCSV(safeEmployees.map(emp => ({
      'Employee Name': emp.employee_name,
      'Department': emp.department,
      'Rate Type': emp.rate_type,
      'Rate': emp.hourly_rate,
      'Rate Basis': emp.rate_type === 'salary' ? 'Annual salary' : 'Per hour',
      'Annual Gross': emp.annual_gross ?? '',
      'Annual Cost': emp.annual_cost ?? '',
      'Weekly Hours': emp.weekly_hours,
      'Start Date': emp.start_date,
      'End Date': emp.end_date || 'Active',
      'Next Review': emp.next_review_date,
      'Expected Raise': emp.expected_raise,
      'Status': emp.status,
      'Customer-Centric Brands %': emp.allocations?.['Customer-Centric Brands'] || 0,
      'OEM Work %': emp.allocations?.['OEM Work'] || 0,
      'Internal Operations %': emp.allocations?.['Internal Operations'] || 0,
      'Other Projects %': emp.allocations?.['Other Projects'] || 0
    })), 'employee_report.csv');
  };

  const exportDepartmentReport = () => {
    exportToCSV(Object.entries(safeDepartmentCosts).map(([dept, costs]) => ({
      'Department': dept,
      'Employee Count': costs.employees,
      'Annual Cost': costs.totalCost,
      'Average Cost per Employee': costs.employees > 0 ? costs.totalCost / costs.employees : 0,
      'Monthly Cost': costs.totalCost / 12,
      [`${runLabel} Run Cost`]: costs.totalCost / runsPerYear
    })), 'department_costs.csv');
  };

  const exportBusinessUnitReport = () => {
    exportToCSV(Object.entries(safeBusinessUnitCosts).map(([unit, costs]) => ({
      'Business Unit': unit,
      'FTE Allocation': costs.employees,
      'Annual Cost': costs.totalCost,
      'Monthly Cost': costs.totalCost / 12,
      [`${runLabel} Run Cost`]: costs.totalCost / runsPerYear
    })), 'business_unit_allocation.csv');
  };

  const exportForecastReport = () => {
    exportToCSV(safeForecast.map(period => ({
      'Period': period.period,
      'Date': period.date,
      'Employee Count': period.employeeCount,
      'Gross Pay': runTotal(period, 'grossPay'),
      'Employer Taxes': runTotal(period, 'employerTaxes'),
      'Benefits': runTotal(period, 'benefits'),
      'Total Employer Cost': period.totalCost,
      'Employee Withholding (info)': runTotal(period, 'withholding'),
      'Net Pay (info)': runTotal(period, 'netPay')
    })), 'payroll_forecast.csv');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold">Payroll Reports & Analytics</h2>
        <div className="flex items-center gap-2">
          <Label className="text-sm">Report Period:</Label>
          <Input
            type="date"
            value={dateRange.start}
            onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
            className="w-40"
          />
          <span className="text-sm text-gray-500">to</span>
          <Input
            type="date"
            value={dateRange.end}
            onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
            className="w-40"
          />
        </div>
      </div>

      <div className="inline-flex flex-wrap rounded-md border bg-white">
        {reportTabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveReport(tab.id)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              activeReport === tab.id
                ? 'bg-primary text-primary-foreground'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeReport === 'summary' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <StatsCard title="Total Workforce" value={summary.totalEmployees} subtitle="Active employees" variant="primary" />
            <StatsCard title="Annual Payroll Cost" value={formatCurrency(summary.totalAnnualCost)} subtitle="Gross + employer taxes + benefits" variant="success" />
            <StatsCard title="Average Employee Cost" value={formatCurrency(summary.avgSalary)} subtitle="Per employee annually" variant="default" />
            <StatsCard title="Monthly Payroll" value={formatCurrency(summary.monthlyAverageCost)} subtitle="Average per month" variant="warning" />
            <StatsCard title={`${runLabel} Payroll`} value={formatCurrency(summary.perRunCost)} subtitle={`Average per pay run (${runsPerYear} a year)`} variant="warning" />
            <StatsCard title="Upcoming Reviews" value={summary.upcomingReviews} subtitle="Next 90 days" variant="danger" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Key Insights</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="font-medium text-gray-800">Largest Department:</span>{' '}
                <span className="text-gray-700">
                  {largestDept ? `${largestDept[0]} (${formatCurrency(largestDept[1].totalCost)})` : 'N/A'}
                </span>
              </div>
              <div>
                <span className="font-medium text-gray-800">Highest Business Unit Cost:</span>{' '}
                <span className="text-gray-700">
                  {highestBU ? `${highestBU[0]} (${formatCurrency(highestBU[1].totalCost)})` : 'N/A'}
                </span>
              </div>
              <div>
                <span className="font-medium text-gray-800">Next Quarter Forecast:</span>{' '}
                <span className="text-gray-700">{formatCurrency(nextQuarterForecast)} ({runsPerQuarter} pay periods)</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeReport === 'employee' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Employee Detail Report</CardTitle>
            <Button variant="outline" size="sm" onClick={exportEmployeeReport}>
              Export Employee Data
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <ReportTable>
              <thead>
                <tr className="border-b bg-gray-50 text-left text-gray-600">
                  <Th>Employee</Th>
                  <Th>Department</Th>
                  <Th>Rate</Th>
                  <Th>Annual Cost</Th>
                  <Th>Status</Th>
                  <Th>Next Review</Th>
                  <Th>Business Unit Distribution</Th>
                </tr>
              </thead>
              <tbody>
                {safeEmployees.length === 0 ? (
                  <EmptyRow colSpan={7} message="No employees" />
                ) : safeEmployees.map(emp => (
                  <tr key={emp.employee_id} className="border-b last:border-0">
                    <Td>{emp.employee_name}</Td>
                    <Td>{emp.department}</Td>
                    <Td>{formatRate(emp, formatCurrency)}</Td>
                    <Td>{emp.annual_cost === undefined || emp.annual_cost === null ? '—' : formatCurrency(emp.annual_cost)}</Td>
                    <Td>
                      <Badge variant={emp.status === 'active' ? 'success' : 'secondary'}>
                        {emp.status || 'unknown'}
                      </Badge>
                    </Td>
                    <Td>{emp.next_review_date || '—'}</Td>
                    <Td>
                      <div className="space-y-0.5 text-xs">
                        {Object.entries(emp.allocations || {}).map(([unit, percent]) => (
                          <div key={unit} className="flex justify-between gap-4">
                            <span className="text-gray-600">{unit}:</span>
                            <span className="text-gray-800 font-medium">{percent}%</span>
                          </div>
                        ))}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </ReportTable>
          </CardContent>
        </Card>
      )}

      {activeReport === 'department' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Department Cost Analysis</CardTitle>
            <Button variant="outline" size="sm" onClick={exportDepartmentReport}>
              Export Department Costs
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <DepartmentReportTable departmentCosts={safeDepartmentCosts} />
          </CardContent>
        </Card>
      )}

      {activeReport === 'business-unit' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Business Unit Cost Allocation</CardTitle>
            <Button variant="outline" size="sm" onClick={exportBusinessUnitReport}>
              Export Business Unit Data
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <BusinessUnitReportTable
              businessUnitCosts={safeBusinessUnitCosts}
              employees={safeEmployees}
            />
          </CardContent>
        </Card>
      )}

      {activeReport === 'forecast' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Payroll Forecast Report (Next {safeForecast.length} Pay Runs)</CardTitle>
            <Button variant="outline" size="sm" onClick={exportForecastReport}>
              Export Forecast Data
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <ForecastReportTable forecast={safeForecast} />
          </CardContent>
        </Card>
      )}
    </div>
  );
};

const ReportTable = ({ children }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">{children}</table>
  </div>
);

const Th = ({ children }) => <th className="px-3 py-2 font-medium">{children}</th>;
const Td = ({ children }) => <td className="px-3 py-2 text-gray-700 align-top">{children}</td>;

const EmptyRow = ({ colSpan, message }) => (
  <tr>
    <td colSpan={colSpan} className="px-3 py-8 text-center text-muted-foreground">
      {message}
    </td>
  </tr>
);

const DepartmentReportTable = ({ departmentCosts }) => {
  const entries = Object.entries(departmentCosts);
  const totalCost = entries.reduce((sum, [, data]) => sum + (data.totalCost || 0), 0);

  return (
    <ReportTable>
      <thead>
        <tr className="border-b bg-gray-50 text-left text-gray-600">
          <Th>Department</Th>
          <Th>Employees</Th>
          <Th>Annual Cost</Th>
          <Th>% of Total</Th>
          <Th>Cost per Employee</Th>
          <Th>Monthly Cost</Th>
        </tr>
      </thead>
      <tbody>
        {entries.length === 0 ? (
          <EmptyRow colSpan={6} message="No departments" />
        ) : entries.map(([dept, data]) => {
          const percentOfTotal = totalCost > 0 ? (data.totalCost / totalCost) * 100 : 0;
          const costPerEmployee = data.employees > 0 ? data.totalCost / data.employees : 0;
          return (
            <tr key={dept} className="border-b last:border-0">
              <Td>{dept}</Td>
              <Td>{data.employees}</Td>
              <Td>{formatCurrency(data.totalCost)}</Td>
              <Td>{percentOfTotal.toFixed(1)}%</Td>
              <Td>{formatCurrency(costPerEmployee)}</Td>
              <Td>{formatCurrency(data.totalCost / 12)}</Td>
            </tr>
          );
        })}
      </tbody>
    </ReportTable>
  );
};

const BusinessUnitReportTable = ({ businessUnitCosts, employees }) => {
  const entries = Object.entries(businessUnitCosts);
  const totalCost = entries.reduce((sum, [, data]) => sum + (data.totalCost || 0), 0);

  return (
    <ReportTable>
      <thead>
        <tr className="border-b bg-gray-50 text-left text-gray-600">
          <Th>Business Unit</Th>
          <Th>FTE Allocation</Th>
          <Th>Annual Cost</Th>
          <Th>% of Total</Th>
          <Th>Cost per FTE</Th>
          <Th>Contributing Employees</Th>
        </tr>
      </thead>
      <tbody>
        {entries.length === 0 ? (
          <EmptyRow colSpan={6} message="No business units" />
        ) : entries.map(([unit, data]) => {
          const percentOfTotal = totalCost > 0 ? (data.totalCost / totalCost) * 100 : 0;
          const costPerFTE = data.employees > 0 ? data.totalCost / data.employees : 0;
          const contributingEmployees = employees.filter(emp =>
            emp.allocations && emp.allocations[unit] > 0
          ).length;
          return (
            <tr key={unit} className="border-b last:border-0">
              <Td>{unit}</Td>
              <Td>{data.employees.toFixed(2)}</Td>
              <Td>{formatCurrency(data.totalCost)}</Td>
              <Td>{percentOfTotal.toFixed(1)}%</Td>
              <Td>{formatCurrency(costPerFTE)}</Td>
              <Td>{contributingEmployees}</Td>
            </tr>
          );
        })}
      </tbody>
    </ReportTable>
  );
};

const ForecastReportTable = ({ forecast }) => (
  <ReportTable>
    <thead>
      <tr className="border-b bg-gray-50 text-left text-gray-600">
        <Th>Period</Th>
        <Th>Date</Th>
        <Th>Employees</Th>
        <Th>Gross Pay</Th>
        <Th>Employer Taxes</Th>
        <Th>Benefits</Th>
        <Th>Total Employer Cost</Th>
        <Th>Employee Withholding (info)</Th>
      </tr>
    </thead>
    <tbody>
      {forecast.length === 0 ? (
        <EmptyRow colSpan={8} message="No forecast data" />
      ) : forecast.map(period => (
        <tr key={period.period} className="border-b last:border-0">
          <Td>{period.period}</Td>
          <Td>{formatDate(period.date)}</Td>
          <Td>{period.employeeCount}</Td>
          <Td>{formatCurrency(runTotal(period, 'grossPay'))}</Td>
          <Td>{formatCurrency(runTotal(period, 'employerTaxes'))}</Td>
          <Td>{formatCurrency(runTotal(period, 'benefits'))}</Td>
          <Td>{formatCurrency(period.totalCost)}</Td>
          <Td>{formatCurrency(runTotal(period, 'withholding'))}</Td>
        </tr>
      ))}
    </tbody>
  </ReportTable>
);

export default PayrollReports;
