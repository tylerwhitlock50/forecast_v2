import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import './PayrollManagement.css';
import { PageHeader } from '../../ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { StatsCard } from '../../ui/stats-card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Select, SelectOption } from '../../ui/select';
import { DataTable } from '../../ui/data-table';
import PayrollForecast from './PayrollForecast';
import BusinessUnitAllocation from './BusinessUnitAllocation';
import DepartmentAnalytics from './DepartmentAnalytics';
import PayrollReports from './PayrollReports';
import { EmployeeModal, AllocationModal, ConfigurationModal } from './PayrollModals';

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

  // Calculate next review date (12 months from start date or last review)
  const getNextReviewDate = (startDate) => {
    const date = new Date(startDate);
    date.setFullYear(date.getFullYear() + 1);
    return date.toISOString().split('T')[0];
  };

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

  const formatCurrency = (amount) => {
    if (!amount) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Define columns for employee table
  const employeeColumns = [
    {
      key: 'employee_name',
      title: 'Employee Name',
      render: (value, row) => (
        <div className="space-y-1">
          <div className="font-semibold">{value}</div>
          <div className="text-sm text-muted-foreground">ID: {row.employee_id}</div>
        </div>
      )
    },
    {
      key: 'department',
      title: 'Department',
      render: (value) => {
        const dept = value || 'Unassigned';
        const variants = {
          'Engineering': 'success',
          'Manufacturing': 'info',
          'Sales': 'warning',
          'Admin': 'secondary',
          'Unassigned': 'default'
        };
        return <Badge variant={variants[dept] || 'default'}>{dept}</Badge>;
      }
    },
    {
      key: 'rate_type',
      title: 'Rate Type',
      render: (value, row) => (
        <div className="space-y-1">
          <Badge variant={value === 'salary' ? 'success' : 'info'}>
            {value === 'salary' ? 'Salary' : 'Hourly'}
          </Badge>
          <div className="text-sm">
            {value === 'salary' ? 
              formatCurrency(row.hourly_rate * 40 * 52) + '/yr' : 
              formatCurrency(row.hourly_rate) + '/hr'
            }
          </div>
        </div>
      )
    },
    {
      key: 'weekly_hours',
      title: 'Hours/Week',
      render: (value) => `${value || 40}h`
    },
    {
      key: 'start_date',
      title: 'Start Date',
      render: (value) => formatDate(value)
    },
    {
      key: 'next_review_date',
      title: 'Next Review',
      render: (value) => {
        const reviewDate = new Date(value);
        const today = new Date();
        const daysUntil = Math.ceil((reviewDate - today) / (1000 * 60 * 60 * 24));
        
        let variant = 'default';
        if (daysUntil < 0) variant = 'destructive';
        else if (daysUntil < 30) variant = 'warning';
        else if (daysUntil < 90) variant = 'info';
        
        return (
          <div className="space-y-1">
            <div>{formatDate(value)}</div>
            <Badge variant={variant} className="text-xs">
              {daysUntil < 0 ? 'Overdue' : `${daysUntil} days`}
            </Badge>
          </div>
        );
      }
    },
    {
      key: 'status',
      title: 'Status',
      render: (value) => (
        <Badge variant={value === 'active' ? 'success' : 'secondary'}>
          {value === 'active' ? 'Active' : 'Inactive'}
        </Badge>
      )
    }
  ];

  // Calculate summary statistics
  const activeEmployees = employees.filter(emp => emp.status === 'active');
  const totalAnnualCost = activeEmployees.reduce((sum, emp) => {
    const compensation = calculateTotalCompensation(emp, 26);
    return sum + compensation.totalCost;
  }, 0);
  const avgHourlyRate = activeEmployees.length > 0 ? 
    activeEmployees.reduce((sum, emp) => sum + emp.hourly_rate, 0) / activeEmployees.length : 0;
  
  const departmentCosts = getDepartmentCosts();
  const departmentCount = Object.keys(departmentCosts).length;

  const headerActions = [
    {
      label: 'Add Employee',
      onClick: handleAddEmployee,
      variant: 'default'
    },
    {
      label: 'Configure Rates',
      onClick: () => setShowConfigModal(true),
      variant: 'outline'
    }
  ];

  return (
    <div className="container mx-auto px-6 py-8">
      <PageHeader
        title="Payroll Management & Estimation"
        description="Manage employees, forecast payroll costs, and analyze labor allocation"
        actions={headerActions}
      />

      {/* Summary Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatsCard
          title="Active Employees"
          value={activeEmployees.length}
          variant="primary"
        />
        <StatsCard
          title="Total Annual Cost"
          value={formatCurrency(totalAnnualCost)}
          variant="success"
        />
        <StatsCard
          title="Average Hourly Rate"
          value={formatCurrency(avgHourlyRate)}
          variant="info"
        />
        <StatsCard
          title="Departments"
          value={departmentCount}
          variant="secondary"
        />
      </div>

      {/* Filter Controls */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Label>Department:</Label>
          <Select value={filters.department} onChange={(e) => setFilters(prev => ({ ...prev, department: e.target.value }))}>
            <SelectOption value="">All Departments</SelectOption>
            {departments.map(dept => (
              <SelectOption key={dept} value={dept}>{dept}</SelectOption>
            ))}
          </Select>
        </div>
        
        <div className="flex items-center gap-2">
          <Label>Status:</Label>
          <Select value={filters.status} onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}>
            <SelectOption value="">All Status</SelectOption>
            <SelectOption value="active">Active</SelectOption>
            <SelectOption value="inactive">Inactive</SelectOption>
          </Select>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="employees">Employees</TabsTrigger>
          <TabsTrigger value="forecast">Forecast</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="allocation">Business Units</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="employees" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>All Employees ({filteredEmployees.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                data={filteredEmployees}
                columns={employeeColumns}
                onEdit={handleEditEmployee}
                onDelete={(employee) => handleDeleteEmployee(employee.employee_id)}
                emptyMessage="No employees found. Click 'Add Employee' to get started."
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="forecast" className="space-y-6">
          <PayrollForecast
            employees={employees}
            calculateTotalCompensation={calculateTotalCompensation}
            forecastHorizon={forecastHorizon}
            setForecastHorizon={setForecastHorizon}
          />
        </TabsContent>

        <TabsContent value="departments" className="space-y-6">
          <DepartmentAnalytics
            employees={employees}
            departmentCosts={departmentCosts}
            calculateTotalCompensation={calculateTotalCompensation}
          />
        </TabsContent>

        <TabsContent value="allocation" className="space-y-6">
          <BusinessUnitAllocation
            employees={employees}
            businessUnits={businessUnits}
            calculateTotalCompensation={calculateTotalCompensation}
          />
        </TabsContent>

        <TabsContent value="reports" className="space-y-6">
          <PayrollReports
            employees={employees}
            calculateTotalCompensation={calculateTotalCompensation}
            config={config}
          />
        </TabsContent>
      </Tabs>

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
          onSave={(allocations) => {
            if (selectedEmployee) {
              handleSaveEmployee({ ...selectedEmployee, allocations });
            }
          }}
          onCancel={() => setShowAllocationModal(false)}
        />
      )}

      {showConfigModal && (
        <ConfigurationModal
          config={config}
          onSave={(newConfig) => {
            setConfig(newConfig);
            setShowConfigModal(false);
          }}
          onCancel={() => setShowConfigModal(false)}
        />
      )}
    </div>
  );
};

export default PayrollManagement;