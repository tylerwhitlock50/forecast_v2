import React, { useState } from 'react';
import './PayrollManagement.css';

const PayrollReports = ({ 
  employees, 
  forecast, 
  departmentCosts, 
  businessUnitCosts 
}) => {
  // Ensure arrays and objects are defined
  const safeEmployees = employees || [];
  const safeForecast = forecast || [];
  const safeDepartmentCosts = departmentCosts || {};
  const safeBusinessUnitCosts = businessUnitCosts || {};
  const [activeReport, setActiveReport] = useState('summary');
  const [dateRange, setDateRange] = useState({
    start: new Date().toISOString().split('T')[0],
    end: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  });

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Generate comprehensive payroll summary
  const generateSummaryReport = () => {
    const activeEmployees = safeEmployees.filter(emp => emp.status === 'active');
    const totalAnnualCost = Object.values(safeDepartmentCosts).reduce((sum, dept) => sum + dept.totalCost, 0);
    const avgSalary = activeEmployees.length > 0 ? totalAnnualCost / activeEmployees.length : 0;
    
    const upcomingReviews = activeEmployees.filter(emp => {
      const reviewDate = new Date(emp.next_review_date);
      const now = new Date();
      const threeMonthsFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
      return reviewDate >= now && reviewDate <= threeMonthsFromNow;
    });

    return {
      totalEmployees: activeEmployees.length,
      totalAnnualCost,
      avgSalary,
      totalDepartments: Object.keys(safeDepartmentCosts).length,
      upcomingReviews: upcomingReviews.length,
      monthlyAverageCost: totalAnnualCost / 12,
      biweeklyAverageCost: totalAnnualCost / 26
    };
  };

  const summaryData = generateSummaryReport();

  // Export functions
  const exportToCSV = (data, filename) => {
    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map(row => headers.map(header => row[header]).join(','))
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
    const data = safeEmployees.map(emp => ({
      'Employee Name': emp.employee_name,
      'Department': emp.department,
      'Rate Type': emp.rate_type,
      'Rate': emp.hourly_rate,
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
    }));
    
    exportToCSV(data, 'employee_report.csv');
  };

  const exportDepartmentReport = () => {
    const data = Object.entries(safeDepartmentCosts).map(([dept, costs]) => ({
      'Department': dept,
      'Employee Count': costs.employees,
      'Annual Cost': costs.totalCost,
      'Average Cost per Employee': costs.employees > 0 ? costs.totalCost / costs.employees : 0,
      'Monthly Cost': costs.totalCost / 12,
      'Bi-weekly Cost': costs.totalCost / 26
    }));
    
    exportToCSV(data, 'department_costs.csv');
  };

  const exportBusinessUnitReport = () => {
    const data = Object.entries(safeBusinessUnitCosts).map(([unit, costs]) => ({
      'Business Unit': unit,
      'FTE Allocation': costs.employees,
      'Annual Cost': costs.totalCost,
      'Monthly Cost': costs.totalCost / 12,
      'Bi-weekly Cost': costs.totalCost / 26
    }));
    
    exportToCSV(data, 'business_unit_allocation.csv');
  };

  const exportForecastReport = () => {
    const data = safeForecast.slice(0, 26).map(period => ({
      'Period': period.period,
      'Date': period.date,
      'Employee Count': period.employeeCount,
      'Total Cost': period.totalCost,
      'Gross Pay': period.employeeDetails.reduce((sum, emp) => sum + emp.compensation.grossPay, 0),
      'Total Taxes': period.employeeDetails.reduce((sum, emp) => 
        sum + emp.compensation.federalTax + emp.compensation.stateTax + 
        emp.compensation.socialSecurity + emp.compensation.medicare + emp.compensation.unemployment, 0),
      'Benefits': period.employeeDetails.reduce((sum, emp) => sum + emp.compensation.benefits, 0)
    }));
    
    exportToCSV(data, 'payroll_forecast.csv');
  };

  return (
    <div className="payroll-reports">
      <div className="reports-header">
        <h2>Payroll Reports & Analytics</h2>
        <div className="date-range">
          <label>Report Period:</label>
          <input 
            type="date" 
            value={dateRange.start}
            onChange={(e) => setDateRange({...dateRange, start: e.target.value})}
          />
          <span>to</span>
          <input 
            type="date" 
            value={dateRange.end}
            onChange={(e) => setDateRange({...dateRange, end: e.target.value})}
          />
        </div>
      </div>

      <div className="reports-tabs">
        <button 
          className={`tab ${activeReport === 'summary' ? 'active' : ''}`}
          onClick={() => setActiveReport('summary')}
        >
          Executive Summary
        </button>
        <button 
          className={`tab ${activeReport === 'employee' ? 'active' : ''}`}
          onClick={() => setActiveReport('employee')}
        >
          Employee Report
        </button>
        <button 
          className={`tab ${activeReport === 'department' ? 'active' : ''}`}
          onClick={() => setActiveReport('department')}
        >
          Department Report
        </button>
        <button 
          className={`tab ${activeReport === 'business-unit' ? 'active' : ''}`}
          onClick={() => setActiveReport('business-unit')}
        >
          Business Unit Report
        </button>
        <button 
          className={`tab ${activeReport === 'forecast' ? 'active' : ''}`}
          onClick={() => setActiveReport('forecast')}
        >
          Forecast Report
        </button>
      </div>

      <div className="reports-content">
        {activeReport === 'summary' && (
          <div className="summary-report">
            <div className="report-section">
              <h3>Executive Summary</h3>
              
              <div className="summary-grid">
                <div className="summary-metric">
                  <h4>Total Workforce</h4>
                  <div className="metric-value">{summaryData.totalEmployees}</div>
                  <div className="metric-detail">Active employees</div>
                </div>
                
                <div className="summary-metric">
                  <h4>Annual Payroll Cost</h4>
                  <div className="metric-value">{formatCurrency(summaryData.totalAnnualCost)}</div>
                  <div className="metric-detail">All employees & benefits</div>
                </div>
                
                <div className="summary-metric">
                  <h4>Average Employee Cost</h4>
                  <div className="metric-value">{formatCurrency(summaryData.avgSalary)}</div>
                  <div className="metric-detail">Per employee annually</div>
                </div>
                
                <div className="summary-metric">
                  <h4>Monthly Payroll</h4>
                  <div className="metric-value">{formatCurrency(summaryData.monthlyAverageCost)}</div>
                  <div className="metric-detail">Average per month</div>
                </div>
                
                <div className="summary-metric">
                  <h4>Bi-weekly Payroll</h4>
                  <div className="metric-value">{formatCurrency(summaryData.biweeklyAverageCost)}</div>
                  <div className="metric-detail">Average per period</div>
                </div>
                
                <div className="summary-metric">
                  <h4>Upcoming Reviews</h4>
                  <div className="metric-value">{summaryData.upcomingReviews}</div>
                  <div className="metric-detail">Next 90 days</div>
                </div>
              </div>

              <div className="key-insights">
                <h4>Key Insights</h4>
                <div className="insights-list">
                  <div className="insight">
                    <strong>Largest Department:</strong> {
                      Object.entries(safeDepartmentCosts)
                        .sort((a, b) => b[1].totalCost - a[1].totalCost)[0]?.[0] || 'N/A'
                    } ({formatCurrency(
                      Object.entries(safeDepartmentCosts)
                        .sort((a, b) => b[1].totalCost - a[1].totalCost)[0]?.[1]?.totalCost || 0
                    )})
                  </div>
                  
                  <div className="insight">
                    <strong>Highest Business Unit Cost:</strong> {
                      Object.entries(safeBusinessUnitCosts)
                        .sort((a, b) => b[1].totalCost - a[1].totalCost)[0]?.[0] || 'N/A'
                    } ({formatCurrency(
                      Object.entries(safeBusinessUnitCosts)
                        .sort((a, b) => b[1].totalCost - a[1].totalCost)[0]?.[1]?.totalCost || 0
                    )})
                  </div>
                  
                  <div className="insight">
                    <strong>Next Quarter Forecast:</strong> {formatCurrency(
                      safeForecast.slice(0, 6).reduce((sum, period) => sum + period.totalCost, 0)
                    )} (6 pay periods)
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeReport === 'employee' && (
          <div className="employee-report">
            <div className="report-actions">
              <button onClick={exportEmployeeReport} className="btn-secondary">
                Export Employee Data
              </button>
            </div>
            
            <EmployeeDetailReport employees={safeEmployees} />
          </div>
        )}

        {activeReport === 'department' && (
          <div className="department-report">
            <div className="report-actions">
              <button onClick={exportDepartmentReport} className="btn-secondary">
                Export Department Costs
              </button>
            </div>
            
            <DepartmentCostReport departmentCosts={safeDepartmentCosts} />
          </div>
        )}

        {activeReport === 'business-unit' && (
          <div className="business-unit-report">
            <div className="report-actions">
              <button onClick={exportBusinessUnitReport} className="btn-secondary">
                Export Business Unit Data
              </button>
            </div>
            
            <BusinessUnitReport businessUnitCosts={safeBusinessUnitCosts} employees={safeEmployees} />
          </div>
        )}

        {activeReport === 'forecast' && (
          <div className="forecast-report">
            <div className="report-actions">
              <button onClick={exportForecastReport} className="btn-secondary">
                Export Forecast Data
              </button>
            </div>
            
            <ForecastDetailReport forecast={safeForecast} />
          </div>
        )}
      </div>
    </div>
  );
};

// Employee Detail Report Component
const EmployeeDetailReport = ({ employees }) => {
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  return (
    <div className="employee-detail-report">
      <h3>Employee Detail Report</h3>
      <table className="report-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Department</th>
            <th>Rate</th>
            <th>Annual Cost</th>
            <th>Status</th>
            <th>Next Review</th>
            <th>Business Unit Distribution</th>
          </tr>
        </thead>
        <tbody>
          {employees.map(emp => (
            <tr key={emp.employee_id}>
              <td>{emp.employee_name}</td>
              <td>{emp.department}</td>
              <td>
                {emp.rate_type === 'salary' ? 
                  formatCurrency(emp.hourly_rate * 40 * 52) + '/year' :
                  formatCurrency(emp.hourly_rate) + '/hour'
                }
              </td>
              <td>{formatCurrency(emp.hourly_rate * emp.weekly_hours * 52 * 1.4)}</td>
              <td>
                <span className={`status ${emp.status}`}>{emp.status}</span>
              </td>
              <td>{emp.next_review_date}</td>
              <td>
                <div className="allocation-summary">
                  {Object.entries(emp.allocations || {}).map(([unit, percent]) => (
                    <div key={unit} className="allocation-item">
                      <span className="unit">{unit}:</span>
                      <span className="percent">{percent}%</span>
                    </div>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// Department Cost Report Component
const DepartmentCostReport = ({ departmentCosts }) => {
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const totalCost = Object.values(departmentCosts).reduce((sum, dept) => sum + dept.totalCost, 0);

  return (
    <div className="department-cost-report">
      <h3>Department Cost Analysis</h3>
      <table className="report-table">
        <thead>
          <tr>
            <th>Department</th>
            <th>Employees</th>
            <th>Annual Cost</th>
            <th>% of Total</th>
            <th>Cost per Employee</th>
            <th>Monthly Cost</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(departmentCosts).map(([dept, data]) => {
            const percentOfTotal = totalCost > 0 ? (data.totalCost / totalCost * 100) : 0;
            const costPerEmployee = data.employees > 0 ? data.totalCost / data.employees : 0;
            
            return (
              <tr key={dept}>
                <td>{dept}</td>
                <td>{data.employees}</td>
                <td>{formatCurrency(data.totalCost)}</td>
                <td>{percentOfTotal.toFixed(1)}%</td>
                <td>{formatCurrency(costPerEmployee)}</td>
                <td>{formatCurrency(data.totalCost / 12)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// Business Unit Report Component
const BusinessUnitReport = ({ businessUnitCosts, employees }) => {
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const totalCost = Object.values(businessUnitCosts).reduce((sum, unit) => sum + unit.totalCost, 0);

  return (
    <div className="business-unit-report">
      <h3>Business Unit Cost Allocation</h3>
      <table className="report-table">
        <thead>
          <tr>
            <th>Business Unit</th>
            <th>FTE Allocation</th>
            <th>Annual Cost</th>
            <th>% of Total</th>
            <th>Cost per FTE</th>
            <th>Contributing Employees</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(businessUnitCosts).map(([unit, data]) => {
            const percentOfTotal = totalCost > 0 ? (data.totalCost / totalCost * 100) : 0;
            const costPerFTE = data.employees > 0 ? data.totalCost / data.employees : 0;
            const contributingEmployees = employees.filter(emp => 
              emp.allocations && emp.allocations[unit] > 0
            ).length;
            
            return (
              <tr key={unit}>
                <td>{unit}</td>
                <td>{data.employees.toFixed(2)}</td>
                <td>{formatCurrency(data.totalCost)}</td>
                <td>{percentOfTotal.toFixed(1)}%</td>
                <td>{formatCurrency(costPerFTE)}</td>
                <td>{contributingEmployees}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// Forecast Detail Report Component
const ForecastDetailReport = ({ forecast }) => {
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <div className="forecast-detail-report">
      <h3>Payroll Forecast Report (Next 26 Periods)</h3>
      <table className="report-table">
        <thead>
          <tr>
            <th>Period</th>
            <th>Date</th>
            <th>Employees</th>
            <th>Gross Pay</th>
            <th>Total Taxes</th>
            <th>Benefits</th>
            <th>Total Cost</th>
          </tr>
        </thead>
        <tbody>
          {forecast.slice(0, 26).map(period => {
            const grossPay = period.employeeDetails.reduce((sum, emp) => sum + emp.compensation.grossPay, 0);
            const totalTaxes = period.employeeDetails.reduce((sum, emp) => 
              sum + emp.compensation.federalTax + emp.compensation.stateTax + 
              emp.compensation.socialSecurity + emp.compensation.medicare + emp.compensation.unemployment, 0);
            const benefits = period.employeeDetails.reduce((sum, emp) => sum + emp.compensation.benefits, 0);
            
            return (
              <tr key={period.period}>
                <td>{period.period}</td>
                <td>{formatDate(period.date)}</td>
                <td>{period.employeeCount}</td>
                <td>{formatCurrency(grossPay)}</td>
                <td>{formatCurrency(totalTaxes)}</td>
                <td>{formatCurrency(benefits)}</td>
                <td>{formatCurrency(period.totalCost)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default PayrollReports;