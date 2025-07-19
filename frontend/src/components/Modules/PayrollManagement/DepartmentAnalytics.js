import React, { useState } from 'react';

const DepartmentAnalytics = ({ departmentCosts }) => {
  const [sortBy, setSortBy] = useState('totalCost');
  const [sortOrder, setSortOrder] = useState('desc');

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  // Sort departments based on selected criteria
  const sortedDepartments = Object.entries(departmentCosts).sort((a, b) => {
    const [, deptA] = a;
    const [, deptB] = b;
    
    let valueA, valueB;
    
    switch (sortBy) {
      case 'name':
        valueA = a[0];
        valueB = b[0];
        break;
      case 'employees':
        valueA = deptA.employees;
        valueB = deptB.employees;
        break;
      case 'totalCost':
        valueA = deptA.totalCost;
        valueB = deptB.totalCost;
        break;
      case 'avgRate':
        valueA = deptA.avgRate;
        valueB = deptB.avgRate;
        break;
      default:
        valueA = deptA.totalCost;
        valueB = deptB.totalCost;
    }
    
    if (sortOrder === 'asc') {
      return valueA > valueB ? 1 : -1;
    } else {
      return valueA < valueB ? 1 : -1;
    }
  });

  // Calculate totals across all departments
  const totals = Object.values(departmentCosts).reduce(
    (acc, dept) => ({
      employees: acc.employees + dept.employees,
      totalCost: acc.totalCost + dept.totalCost
    }),
    { employees: 0, totalCost: 0 }
  );

  const avgCostPerEmployee = totals.employees > 0 ? totals.totalCost / totals.employees : 0;

  return (
    <div className="department-analytics">
      <div className="analytics-header">
        <h2>Department Cost Analysis</h2>
        <div className="analytics-controls">
          <div className="sort-controls">
            <label>Sort by:</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="totalCost">Total Cost</option>
              <option value="employees">Employee Count</option>
              <option value="avgRate">Average Rate</option>
              <option value="name">Department Name</option>
            </select>
            <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
              <option value="desc">Highest First</option>
              <option value="asc">Lowest First</option>
            </select>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="analytics-summary">
        <div className="summary-card">
          <h3>Total Departments</h3>
          <div className="summary-value">{Object.keys(departmentCosts).length}</div>
          <div className="summary-detail">Active departments</div>
        </div>
        
        <div className="summary-card">
          <h3>Total Employees</h3>
          <div className="summary-value">{totals.employees}</div>
          <div className="summary-detail">Across all departments</div>
        </div>
        
        <div className="summary-card">
          <h3>Total Annual Cost</h3>
          <div className="summary-value">{formatCurrency(totals.totalCost)}</div>
          <div className="summary-detail">All departments combined</div>
        </div>
        
        <div className="summary-card">
          <h3>Avg Cost per Employee</h3>
          <div className="summary-value">{formatCurrency(avgCostPerEmployee)}</div>
          <div className="summary-detail">Company average</div>
        </div>
      </div>

      {/* Department Cost Chart */}
      <div className="department-chart">
        <h3>Department Cost Distribution</h3>
        <DepartmentCostChart departments={sortedDepartments} totalCost={totals.totalCost} />
      </div>

      {/* Department Table */}
      <div className="department-table">
        <table>
          <thead>
            <tr>
              <th>Department</th>
              <th>Employees</th>
              <th>Annual Cost</th>
              <th>% of Total</th>
              <th>Avg Cost/Employee</th>
              <th>Cost per Period</th>
              <th>Monthly Cost</th>
            </tr>
          </thead>
          <tbody>
            {sortedDepartments.map(([deptName, deptData]) => {
              const percentOfTotal = totals.totalCost > 0 ? (deptData.totalCost / totals.totalCost * 100) : 0;
              const costPerEmployee = deptData.employees > 0 ? deptData.totalCost / deptData.employees : 0;
              const biWeeklyCost = deptData.totalCost / 26; // 26 pay periods
              const monthlyCost = deptData.totalCost / 12; // 12 months
              
              return (
                <tr key={deptName}>
                  <td className="department-name">
                    <div className="dept-info">
                      <span className="name">{deptName}</span>
                      <div className="dept-bar">
                        <div 
                          className="dept-fill"
                          style={{ width: `${percentOfTotal}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td>{deptData.employees}</td>
                  <td>{formatCurrency(deptData.totalCost)}</td>
                  <td>{percentOfTotal.toFixed(1)}%</td>
                  <td>{formatCurrency(costPerEmployee)}</td>
                  <td>{formatCurrency(biWeeklyCost)}</td>
                  <td>{formatCurrency(monthlyCost)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="totals-row">
              <td><strong>Total</strong></td>
              <td><strong>{totals.employees}</strong></td>
              <td><strong>{formatCurrency(totals.totalCost)}</strong></td>
              <td><strong>100.0%</strong></td>
              <td><strong>{formatCurrency(avgCostPerEmployee)}</strong></td>
              <td><strong>{formatCurrency(totals.totalCost / 26)}</strong></td>
              <td><strong>{formatCurrency(totals.totalCost / 12)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Department Details Cards */}
      <div className="department-details">
        <h3>Department Details</h3>
        <div className="department-cards">
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
    </div>
  );
};

// Department Cost Chart Component
const DepartmentCostChart = ({ departments, totalCost }) => {
  return (
    <div className="cost-chart">
      <div className="chart-bars">
        {departments.map(([deptName, deptData]) => {
          const percentage = totalCost > 0 ? (deptData.totalCost / totalCost * 100) : 0;
          const height = Math.max(percentage * 3, 20); // Scale height for visibility
          
          return (
            <div key={deptName} className="chart-bar-container">
              <div 
                className="chart-bar"
                style={{ height: `${height}px` }}
                title={`${deptName}: ${new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: 'USD',
                  notation: 'compact'
                }).format(deptData.totalCost)} (${percentage.toFixed(1)}%)`}
              />
              <div className="bar-label">{deptName}</div>
              <div className="bar-value">{percentage.toFixed(1)}%</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Individual Department Card Component
const DepartmentCard = ({ name, data, totalCost }) => {
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const percentOfTotal = totalCost > 0 ? (data.totalCost / totalCost * 100) : 0;
  const costPerEmployee = data.employees > 0 ? data.totalCost / data.employees : 0;

  return (
    <div className="department-card">
      <div className="card-header">
        <h4>{name}</h4>
        <div className="dept-percentage">{percentOfTotal.toFixed(1)}%</div>
      </div>
      
      <div className="card-content">
        <div className="metric-row">
          <span className="metric-label">Employees:</span>
          <span className="metric-value">{data.employees}</span>
        </div>
        
        <div className="metric-row">
          <span className="metric-label">Annual Cost:</span>
          <span className="metric-value">{formatCurrency(data.totalCost)}</span>
        </div>
        
        <div className="metric-row">
          <span className="metric-label">Cost per Employee:</span>
          <span className="metric-value">{formatCurrency(costPerEmployee)}</span>
        </div>
        
        <div className="metric-row">
          <span className="metric-label">Monthly Cost:</span>
          <span className="metric-value">{formatCurrency(data.totalCost / 12)}</span>
        </div>
        
        <div className="metric-row">
          <span className="metric-label">Bi-weekly Cost:</span>
          <span className="metric-value">{formatCurrency(data.totalCost / 26)}</span>
        </div>
      </div>
      
      <div className="card-footer">
        <div className="progress-bar">
          <div 
            className="progress-fill"
            style={{ width: `${percentOfTotal}%` }}
          />
        </div>
      </div>
    </div>
  );
};

export default DepartmentAnalytics;