import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import PayrollForecast from './PayrollForecast';
import BusinessUnitAllocation from './BusinessUnitAllocation';
import DepartmentAnalytics from './DepartmentAnalytics';
import PayrollReports from './PayrollReports';
import { EmployeeModal, AllocationModal, ConfigurationModal } from './PayrollModals';
import './PayrollManagement.css';

const PayrollManagement = () => {
  const { data, actions } = useForecast();
  const [activeTab, setActiveTab] = useState('employees');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [showAllocationModal, setShowAllocationModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showRaiseModal, setShowRaiseModal] = useState(false);
  const [forecastHorizon, setForecastHorizon] = useState(26); // 26 pay periods = 1 year
  const [filters, setFilters] = useState({
    department: '',
    status: 'active'
  });

  // Configuration state for taxes and benefits
  const [config, setConfig] = useState({
    federalTaxRate: 0.22,
    stateTaxRate: 0.06,
    socialSecurityRate: 0.062,
    medicareRate: 0.0145,
    unemploymentRate: 0.006,
    benefitsRate: 0.25, // 25% of gross pay
    workersCompRate: 0.015
  });

  // Business unit definitions
  const [businessUnits] = useState([
    'Customer-Centric Brands',
    'OEM Work',
    'Internal Operations',
    'Other Projects'
  ]);

  // Get current payroll data with enhanced structure
  const employees = useMemo(() => {
    if (!data?.payroll) return [];
    
    return data.payroll.map(emp => ({
      ...emp,
      department: emp.department || emp.labor_type,
      rate_type: emp.rate_type || 'hourly',
      next_review_date: emp.next_review_date || getNextReviewDate(emp.start_date),
      expected_raise: emp.expected_raise || 0,
      allocations: emp.allocations || { 'Customer-Centric Brands': 100 },
      benefits_eligible: emp.benefits_eligible !== false,
      status: emp.end_date && new Date(emp.end_date) < new Date() ? 'inactive' : 'active'
    }));
  }, [data?.payroll]);

  // Calculate next review date (12 months from start date or last review)
  const getNextReviewDate = (startDate) => {
    const date = new Date(startDate);
    date.setFullYear(date.getFullYear() + 1);
    return date.toISOString().split('T')[0];
  };

  // Calculate gross pay for an employee
  const calculateGrossPay = (employee, payPeriods = 1) => {
    if (employee.rate_type === 'salary') {
      return (employee.hourly_rate * 40 * 52 / 26) * payPeriods; // Annual salary / 26 pay periods
    } else {
      return employee.hourly_rate * employee.weekly_hours * 2 * payPeriods; // Bi-weekly
    }
  };

  // Calculate total compensation including taxes and benefits
  const calculateTotalCompensation = (employee, payPeriods = 1) => {
    const grossPay = calculateGrossPay(employee, payPeriods);
    const federalTax = grossPay * config.federalTaxRate;
    const stateTax = grossPay * config.stateTaxRate;
    const socialSecurity = grossPay * config.socialSecurityRate;
    const medicare = grossPay * config.medicareRate;
    const unemployment = grossPay * config.unemploymentRate;
    const workersComp = grossPay * config.workersCompRate;
    const benefits = employee.benefits_eligible ? grossPay * config.benefitsRate : 0;

    return {
      grossPay,
      federalTax,
      stateTax,
      socialSecurity,
      medicare,
      unemployment,
      workersComp,
      benefits,
      totalCost: grossPay + federalTax + stateTax + socialSecurity + medicare + unemployment + workersComp + benefits
    };
  };

  // Generate payroll forecast for next N pay periods
  const generatePayrollForecast = () => {
    const forecast = [];
    const today = new Date();
    
    // Find next Friday (payroll day)
    const nextPayrollDate = new Date(today);
    const dayOfWeek = today.getDay();
    const daysUntilFriday = dayOfWeek <= 5 ? 5 - dayOfWeek : 7 - dayOfWeek + 5;
    nextPayrollDate.setDate(today.getDate() + daysUntilFriday);

    for (let i = 0; i < forecastHorizon; i++) {
      const payrollDate = new Date(nextPayrollDate);
      payrollDate.setDate(nextPayrollDate.getDate() + (i * 14)); // Bi-weekly

      let totalCost = 0;
      const employeeDetails = [];

      employees.forEach(emp => {
        if (emp.status === 'active') {
          // Factor in scheduled raises
          let adjustedEmployee = { ...emp };
          if (emp.expected_raise && new Date(emp.next_review_date) <= payrollDate) {
            if (emp.expected_raise > 1) {
              // Flat amount
              adjustedEmployee.hourly_rate += emp.expected_raise;
            } else {
              // Percentage
              adjustedEmployee.hourly_rate *= (1 + emp.expected_raise);
            }
          }

          const compensation = calculateTotalCompensation(adjustedEmployee);
          totalCost += compensation.totalCost;
          employeeDetails.push({
            ...adjustedEmployee,
            compensation
          });
        }
      });

      forecast.push({
        date: payrollDate.toISOString().split('T')[0],
        period: i + 1,
        totalCost,
        employeeCount: employeeDetails.length,
        employeeDetails
      });
    }

    return forecast;
  };

  // Calculate costs by department
  const getDepartmentCosts = () => {
    const departments = {};
    
    employees.forEach(emp => {
      if (emp.status === 'active') {
        const dept = emp.department || 'Unassigned';
        if (!departments[dept]) {
          departments[dept] = {
            employees: 0,
            totalCost: 0,
            avgRate: 0
          };
        }
        
        departments[dept].employees++;
        const compensation = calculateTotalCompensation(emp, 26); // Annual
        departments[dept].totalCost += compensation.totalCost;
      }
    });

    // Calculate average rates
    Object.keys(departments).forEach(dept => {
      departments[dept].avgRate = departments[dept].totalCost / departments[dept].employees / 26;
    });

    return departments;
  };

  // Calculate costs by business unit allocation
  const getBusinessUnitCosts = () => {
    const businessUnitCosts = {};
    
    businessUnits.forEach(unit => {
      businessUnitCosts[unit] = {
        employees: 0,
        totalCost: 0,
        allocation: 0
      };
    });

    employees.forEach(emp => {
      if (emp.status === 'active' && emp.allocations) {
        const compensation = calculateTotalCompensation(emp, 26); // Annual
        
        Object.keys(emp.allocations).forEach(unit => {
          const percentage = emp.allocations[unit] / 100;
          if (businessUnitCosts[unit]) {
            businessUnitCosts[unit].allocation += percentage;
            businessUnitCosts[unit].totalCost += compensation.totalCost * percentage;
          }
        });
      }
    });

    // Calculate effective employee count
    Object.keys(businessUnitCosts).forEach(unit => {
      businessUnitCosts[unit].employees = businessUnitCosts[unit].allocation;
    });

    return businessUnitCosts;
  };

  // Filter employees based on current filters
  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => {
      if (filters.department && emp.department !== filters.department) return false;
      if (filters.status && emp.status !== filters.status) return false;
      return true;
    });
  }, [employees, filters]);

  // Get unique departments
  const departments = useMemo(() => {
    const depts = [...new Set(employees.map(emp => emp.department || emp.labor_type))];
    return depts.sort();
  }, [employees]);

  const handleAddEmployee = () => {
    setSelectedEmployee({
      employee_name: '',
      department: '',
      hourly_rate: 0,
      rate_type: 'hourly',
      weekly_hours: 40,
      start_date: new Date().toISOString().split('T')[0],
      end_date: '',
      next_review_date: '',
      expected_raise: 0,
      benefits_eligible: true,
      allocations: { 'Customer-Centric Brands': 100 }
    });
    setShowEmployeeModal(true);
  };

  const handleEditEmployee = (employee) => {
    setSelectedEmployee({ ...employee });
    setShowEmployeeModal(true);
  };

  const handleSaveEmployee = async (employee) => {
    try {
      // Validate allocations sum to 100%
      const allocationSum = Object.values(employee.allocations || {}).reduce((sum, val) => sum + val, 0);
      if (Math.abs(allocationSum - 100) > 0.01) {
        toast.error('Employee allocations must sum to 100%');
        return;
      }

      // Save employee data
      if (employee.employee_id) {
        // Update existing
        await actions.updateData('payroll', employee.employee_id, employee);
        toast.success('Employee updated successfully');
      } else {
        // Create new
        const newEmployee = {
          ...employee,
          employee_id: `EMP-${Date.now()}`,
          next_review_date: employee.next_review_date || getNextReviewDate(employee.start_date)
        };
        await actions.addData('payroll', newEmployee);
        toast.success('Employee added successfully');
      }
      
      setShowEmployeeModal(false);
      setSelectedEmployee(null);
    } catch (error) {
      toast.error('Error saving employee: ' + error.message);
    }
  };

  const handleDeleteEmployee = async (employeeId) => {
    if (window.confirm('Are you sure you want to delete this employee?')) {
      try {
        await actions.deleteData('payroll', employeeId);
        toast.success('Employee deleted successfully');
      } catch (error) {
        toast.error('Error deleting employee: ' + error.message);
      }
    }
  };

  return (
    <div className="payroll-management">
      <div className="payroll-header">
        <h1>Payroll Management & Estimation</h1>
        <div className="payroll-actions">
          <button onClick={() => setShowConfigModal(true)} className="btn-secondary">
            Configure Rates
          </button>
          <button onClick={handleAddEmployee} className="btn-primary">
            Add Employee
          </button>
        </div>
      </div>

      <div className="payroll-tabs">
        <button 
          className={`tab ${activeTab === 'employees' ? 'active' : ''}`}
          onClick={() => setActiveTab('employees')}
        >
          Employee Management
        </button>
        <button 
          className={`tab ${activeTab === 'forecast' ? 'active' : ''}`}
          onClick={() => setActiveTab('forecast')}
        >
          Payroll Forecast
        </button>
        <button 
          className={`tab ${activeTab === 'departments' ? 'active' : ''}`}
          onClick={() => setActiveTab('departments')}
        >
          Department Analytics
        </button>
        <button 
          className={`tab ${activeTab === 'allocations' ? 'active' : ''}`}
          onClick={() => setActiveTab('allocations')}
        >
          Business Unit Allocation
        </button>
        <button 
          className={`tab ${activeTab === 'reports' ? 'active' : ''}`}
          onClick={() => setActiveTab('reports')}
        >
          Reports
        </button>
      </div>

      <div className="payroll-content">
        {activeTab === 'employees' && (
          <EmployeeManagement 
            employees={filteredEmployees}
            departments={departments}
            filters={filters}
            onFiltersChange={setFilters}
            onEditEmployee={handleEditEmployee}
            onDeleteEmployee={handleDeleteEmployee}
            calculateTotalCompensation={calculateTotalCompensation}
          />
        )}

        {activeTab === 'forecast' && (
          <PayrollForecast 
            forecast={generatePayrollForecast()}
            forecastHorizon={forecastHorizon}
            onHorizonChange={setForecastHorizon}
          />
        )}

        {activeTab === 'departments' && (
          <DepartmentAnalytics 
            departmentCosts={getDepartmentCosts()}
          />
        )}

        {activeTab === 'allocations' && (
          <BusinessUnitAllocation 
            employees={employees}
            businessUnits={businessUnits}
            businessUnitCosts={getBusinessUnitCosts()}
            onEditAllocations={(emp) => {
              setSelectedEmployee(emp);
              setShowAllocationModal(true);
            }}
          />
        )}

        {activeTab === 'reports' && (
          <PayrollReports 
            employees={employees}
            forecast={generatePayrollForecast()}
            departmentCosts={getDepartmentCosts()}
            businessUnitCosts={getBusinessUnitCosts()}
          />
        )}
      </div>

      {/* Modals */}
      {showEmployeeModal && (
        <EmployeeModal
          employee={selectedEmployee}
          departments={departments}
          businessUnits={businessUnits}
          onSave={handleSaveEmployee}
          onCancel={() => {
            setShowEmployeeModal(false);
            setSelectedEmployee(null);
          }}
        />
      )}

      {showAllocationModal && (
        <AllocationModal
          employee={selectedEmployee}
          businessUnits={businessUnits}
          onSave={handleSaveEmployee}
          onCancel={() => {
            setShowAllocationModal(false);
            setSelectedEmployee(null);
          }}
        />
      )}

      {showConfigModal && (
        <ConfigurationModal
          config={config}
          onSave={setConfig}
          onCancel={() => setShowConfigModal(false)}
        />
      )}
    </div>
  );
};

// Employee Management Tab Component
const EmployeeManagement = ({ 
  employees, 
  departments, 
  filters, 
  onFiltersChange, 
  onEditEmployee, 
  onDeleteEmployee,
  calculateTotalCompensation 
}) => {
  return (
    <div className="employee-management">
      <div className="filters">
        <select 
          value={filters.department} 
          onChange={(e) => onFiltersChange({...filters, department: e.target.value})}
        >
          <option value="">All Departments</option>
          {departments.map(dept => (
            <option key={dept} value={dept}>{dept}</option>
          ))}
        </select>
        
        <select 
          value={filters.status} 
          onChange={(e) => onFiltersChange({...filters, status: e.target.value})}
        >
          <option value="">All Employees</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className="employee-table">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Department</th>
              <th>Rate</th>
              <th>Hours/Week</th>
              <th>Annual Cost</th>
              <th>Next Review</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {employees.map(emp => {
              const compensation = calculateTotalCompensation(emp, 26);
              return (
                <tr key={emp.employee_id}>
                  <td>{emp.employee_name}</td>
                  <td>{emp.department}</td>
                  <td>
                    {emp.rate_type === 'salary' ? 
                      `$${(emp.hourly_rate * 40 * 52).toLocaleString()}/year` :
                      `$${emp.hourly_rate}/hour`
                    }
                  </td>
                  <td>{emp.weekly_hours}</td>
                  <td>${compensation.totalCost.toLocaleString()}</td>
                  <td>{emp.next_review_date}</td>
                  <td>
                    <span className={`status ${emp.status}`}>
                      {emp.status}
                    </span>
                  </td>
                  <td>
                    <button onClick={() => onEditEmployee(emp)} className="btn-small">
                      Edit
                    </button>
                    <button 
                      onClick={() => onDeleteEmployee(emp.employee_id)} 
                      className="btn-small btn-danger"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Additional component exports would continue here...
// Due to length constraints, I'll create the remaining components in separate files

export default PayrollManagement;