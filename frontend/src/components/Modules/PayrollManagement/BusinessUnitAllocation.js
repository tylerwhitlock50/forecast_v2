import React, { useState } from 'react';

const BusinessUnitAllocation = ({ 
  employees, 
  businessUnits, 
  businessUnitCosts, 
  onEditAllocations 
}) => {
  const [viewMode, setViewMode] = useState('overview'); // 'overview', 'employee', 'matrix'
  const [selectedBusinessUnit, setSelectedBusinessUnit] = useState('');

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  // Get employees allocated to a specific business unit
  const getEmployeesForBusinessUnit = (businessUnit) => {
    return employees.filter(emp => 
      emp.status === 'active' && 
      emp.allocations && 
      emp.allocations[businessUnit] > 0
    );
  };

  // Calculate allocation matrix data
  const getAllocationMatrix = () => {
    const matrix = [];
    
    employees.forEach(emp => {
      if (emp.status === 'active') {
        const row = {
          employee: emp,
          allocations: {}
        };
        
        businessUnits.forEach(unit => {
          row.allocations[unit] = emp.allocations?.[unit] || 0;
        });
        
        matrix.push(row);
      }
    });
    
    return matrix;
  };

  const allocationMatrix = getAllocationMatrix();

  // Validate allocation percentages
  const validateAllocations = () => {
    const issues = [];
    
    employees.forEach(emp => {
      if (emp.status === 'active') {
        const total = Object.values(emp.allocations || {}).reduce((sum, val) => sum + val, 0);
        if (Math.abs(total - 100) > 0.01) {
          issues.push({
            employee: emp.employee_name,
            total: total,
            issue: total < 100 ? 'Under-allocated' : 'Over-allocated'
          });
        }
      }
    });
    
    return issues;
  };

  const allocationIssues = validateAllocations();

  return (
    <div className="business-unit-allocation">
      <div className="allocation-header">
        <h2>Business Unit Allocation</h2>
        <div className="allocation-controls">
          <div className="view-toggle">
            <button 
              className={viewMode === 'overview' ? 'active' : ''}
              onClick={() => setViewMode('overview')}
            >
              Overview
            </button>
            <button 
              className={viewMode === 'employee' ? 'active' : ''}
              onClick={() => setViewMode('employee')}
            >
              By Employee
            </button>
            <button 
              className={viewMode === 'matrix' ? 'active' : ''}
              onClick={() => setViewMode('matrix')}
            >
              Allocation Matrix
            </button>
          </div>
        </div>
      </div>

      {/* Validation Issues Alert */}
      {allocationIssues.length > 0 && (
        <div className="allocation-issues">
          <h3>⚠️ Allocation Issues ({allocationIssues.length})</h3>
          <div className="issues-list">
            {allocationIssues.map((issue, index) => (
              <div key={index} className="issue-item">
                <span className="employee-name">{issue.employee}</span>
                <span className={`issue-type ${issue.issue.toLowerCase().replace('-', '')}`}>
                  {issue.issue}
                </span>
                <span className="issue-total">{issue.total.toFixed(1)}%</span>
                <button 
                  className="btn-small"
                  onClick={() => {
                    const emp = employees.find(e => e.employee_name === issue.employee);
                    if (emp) onEditAllocations(emp);
                  }}
                >
                  Fix
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {viewMode === 'overview' && (
        <div className="allocation-overview">
          <div className="business-unit-cards">
            {businessUnits.map(unit => {
              const unitData = businessUnitCosts[unit];
              const unitEmployees = getEmployeesForBusinessUnit(unit);
              
              return (
                <div key={unit} className="business-unit-card">
                  <div className="unit-header">
                    <h3>{unit}</h3>
                    <div className="unit-metrics">
                      <span className="metric">
                        {unitData.employees.toFixed(1)} FTE
                      </span>
                      <span className="metric">
                        {formatCurrency(unitData.totalCost)}
                      </span>
                    </div>
                  </div>
                  
                  <div className="unit-content">
                    <div className="allocation-summary">
                      <div className="summary-item">
                        <label>Annual Cost:</label>
                        <span>{formatCurrency(unitData.totalCost)}</span>
                      </div>
                      <div className="summary-item">
                        <label>FTE Allocation:</label>
                        <span>{unitData.employees.toFixed(2)}</span>
                      </div>
                      <div className="summary-item">
                        <label>Employees Involved:</label>
                        <span>{unitEmployees.length}</span>
                      </div>
                      <div className="summary-item">
                        <label>Avg Cost per FTE:</label>
                        <span>
                          {unitData.employees > 0 ? 
                            formatCurrency(unitData.totalCost / unitData.employees) : 
                            '$0'
                          }
                        </span>
                      </div>
                    </div>
                    
                    <div className="unit-employees">
                      <h4>Key Contributors</h4>
                      <div className="employee-chips">
                        {unitEmployees
                          .sort((a, b) => (b.allocations[unit] || 0) - (a.allocations[unit] || 0))
                          .slice(0, 5)
                          .map(emp => (
                            <div key={emp.employee_id} className="employee-chip">
                              <span className="emp-name">{emp.employee_name}</span>
                              <span className="emp-allocation">{emp.allocations[unit]}%</span>
                            </div>
                          ))
                        }
                        {unitEmployees.length > 5 && (
                          <div className="employee-chip more">
                            +{unitEmployees.length - 5} more
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="allocation-charts">
            <div className="chart-container">
              <h3>Cost Distribution by Business Unit</h3>
              <CostDistributionChart businessUnitCosts={businessUnitCosts} />
            </div>
            
            <div className="chart-container">
              <h3>FTE Distribution by Business Unit</h3>
              <FTEDistributionChart businessUnitCosts={businessUnitCosts} />
            </div>
          </div>
        </div>
      )}

      {viewMode === 'employee' && (
        <div className="employee-allocations">
          <div className="employee-allocation-table">
            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Annual Cost</th>
                  {businessUnits.map(unit => (
                    <th key={unit} className="allocation-column">
                      {unit}
                    </th>
                  ))}
                  <th>Total</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {employees
                  .filter(emp => emp.status === 'active')
                  .map(emp => {
                    const totalAllocation = Object.values(emp.allocations || {})
                      .reduce((sum, val) => sum + val, 0);
                    const isValid = Math.abs(totalAllocation - 100) <= 0.01;
                    
                    return (
                      <tr key={emp.employee_id} className={!isValid ? 'invalid-allocation' : ''}>
                        <td>{emp.employee_name}</td>
                        <td>{emp.department}</td>
                        <td>{formatCurrency(emp.hourly_rate * emp.weekly_hours * 52 * 1.4)}</td>
                        {businessUnits.map(unit => (
                          <td key={unit} className="allocation-cell">
                            <span className="allocation-value">
                              {emp.allocations?.[unit] || 0}%
                            </span>
                          </td>
                        ))}
                        <td className={`total-cell ${!isValid ? 'invalid' : 'valid'}`}>
                          {totalAllocation.toFixed(1)}%
                        </td>
                        <td>
                          <button 
                            className="btn-small"
                            onClick={() => onEditAllocations(emp)}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })
                }
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewMode === 'matrix' && (
        <div className="allocation-matrix">
          <div className="matrix-controls">
            <select 
              value={selectedBusinessUnit}
              onChange={(e) => setSelectedBusinessUnit(e.target.value)}
            >
              <option value="">All Business Units</option>
              {businessUnits.map(unit => (
                <option key={unit} value={unit}>{unit}</option>
              ))}
            </select>
          </div>

          <div className="matrix-view">
            <AllocationMatrix 
              matrix={allocationMatrix}
              businessUnits={businessUnits}
              selectedBusinessUnit={selectedBusinessUnit}
              onEditAllocations={onEditAllocations}
            />
          </div>

          <div className="matrix-summary">
            <h3>Business Unit Totals</h3>
            <div className="unit-totals">
              {businessUnits.map(unit => {
                const unitData = businessUnitCosts[unit];
                return (
                  <div key={unit} className="unit-total">
                    <div className="unit-name">{unit}</div>
                    <div className="unit-fte">{unitData.employees.toFixed(2)} FTE</div>
                    <div className="unit-cost">{formatCurrency(unitData.totalCost)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Allocation Matrix Component
const AllocationMatrix = ({ matrix, businessUnits, selectedBusinessUnit, onEditAllocations }) => {
  const filteredMatrix = selectedBusinessUnit 
    ? matrix.filter(row => row.allocations[selectedBusinessUnit] > 0)
    : matrix;

  return (
    <div className="matrix-table-container">
      <table className="matrix-table">
        <thead>
          <tr>
            <th className="employee-column">Employee</th>
            {businessUnits.map(unit => (
              <th key={unit} className={`unit-column ${selectedBusinessUnit === unit ? 'highlighted' : ''}`}>
                {unit}
              </th>
            ))}
            <th className="actions-column">Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredMatrix.map(row => {
            const total = Object.values(row.allocations).reduce((sum, val) => sum + val, 0);
            const isValid = Math.abs(total - 100) <= 0.01;
            
            return (
              <tr key={row.employee.employee_id} className={!isValid ? 'invalid' : ''}>
                <td className="employee-cell">
                  <div className="employee-info">
                    <div className="employee-name">{row.employee.employee_name}</div>
                    <div className="employee-dept">{row.employee.department}</div>
                  </div>
                </td>
                {businessUnits.map(unit => (
                  <td 
                    key={unit} 
                    className={`allocation-matrix-cell ${selectedBusinessUnit === unit ? 'highlighted' : ''}`}
                  >
                    <div className="allocation-display">
                      <span className="percentage">{row.allocations[unit]}%</span>
                      <div 
                        className="allocation-bar"
                        style={{ width: `${row.allocations[unit]}%` }}
                      />
                    </div>
                  </td>
                ))}
                <td className="actions-cell">
                  <button 
                    className="btn-small"
                    onClick={() => onEditAllocations(row.employee)}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// Cost Distribution Chart Component
const CostDistributionChart = ({ businessUnitCosts }) => {
  const totalCost = Object.values(businessUnitCosts)
    .reduce((sum, unit) => sum + unit.totalCost, 0);

  return (
    <div className="distribution-chart">
      {Object.entries(businessUnitCosts).map(([unit, data]) => {
        const percentage = totalCost > 0 ? (data.totalCost / totalCost * 100) : 0;
        
        return (
          <div key={unit} className="chart-segment">
            <div className="segment-bar">
              <div 
                className="segment-fill"
                style={{ width: `${percentage}%` }}
              />
            </div>
            <div className="segment-label">
              <span className="unit-name">{unit}</span>
              <span className="percentage">{percentage.toFixed(1)}%</span>
              <span className="amount">{new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                notation: 'compact'
              }).format(data.totalCost)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// FTE Distribution Chart Component
const FTEDistributionChart = ({ businessUnitCosts }) => {
  const totalFTE = Object.values(businessUnitCosts)
    .reduce((sum, unit) => sum + unit.employees, 0);

  return (
    <div className="distribution-chart">
      {Object.entries(businessUnitCosts).map(([unit, data]) => {
        const percentage = totalFTE > 0 ? (data.employees / totalFTE * 100) : 0;
        
        return (
          <div key={unit} className="chart-segment">
            <div className="segment-bar">
              <div 
                className="segment-fill fte-fill"
                style={{ width: `${percentage}%` }}
              />
            </div>
            <div className="segment-label">
              <span className="unit-name">{unit}</span>
              <span className="percentage">{percentage.toFixed(1)}%</span>
              <span className="amount">{data.employees.toFixed(2)} FTE</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default BusinessUnitAllocation;