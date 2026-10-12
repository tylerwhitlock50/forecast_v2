import React, { useState, useEffect, useMemo } from 'react';
import { parseLocalDate, toDateOnly, formatDateOnly } from '../../../lib/dates';
import { defaultWindowForScenario } from '../../../lib/scenarioWindow';
import { useForecast } from '../../../context/ForecastContext';
import api, { describeError } from '../../../lib/apiClient';
import { toast } from 'react-hot-toast';
import { useConfirm } from '../../Common/ConfirmDialog';
import './PayrollManagement.css';
import { PageHeader } from '../../ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { StatsCard } from '../../ui/stats-card';
import { Badge } from '../../ui/badge';
import { Label } from '../../ui/label';
import { Select, SelectOption } from '../../ui/select';
import { DataTable } from '../../ui/data-table';
import PayrollForecast from './PayrollForecast';
import BusinessUnitAllocation from './BusinessUnitAllocation';
import DepartmentAnalytics from './DepartmentAnalytics';
import PayrollReports from './PayrollReports';
import { EmployeeModal, AllocationModal, ConfigurationModal } from './PayrollModals';
import { isLocked } from '../Scenarios/governance';
import {
  parseAllocations,
  indexEmployeeCosts,
  summaryToDepartmentCosts,
  summaryToBusinessUnitCosts,
  mergeBusinessUnits,
  serverForecastToView,
  runsPerYearFor,
  formatRate,
  normalizeLaborClass,
  laborClassLabel,
  laborClassHelp,
  payRunQuery,
  bridgeToView,
  LABOR_CLASS_OPTIONS
} from './payrollView';

const LABOR_CLASS_BADGE = { direct: 'info', indirect: 'secondary', admin: 'outline' };
const LOADING = '…';

const serverConfigToForm = (cfg) => ({
  federalTaxRate: Number(cfg.federal_tax_rate ?? 0.22),
  stateTaxRate: Number(cfg.state_tax_rate ?? 0.06),
  socialSecurityRate: Number(cfg.social_security_rate ?? 0.062),
  medicareRate: Number(cfg.medicare_rate ?? 0.0145),
  unemploymentRate: Number(cfg.unemployment_rate ?? 0.006),
  benefitsRate: Number(cfg.benefits_rate ?? 0.25),
  workersCompRate: Number(cfg.workers_comp_rate ?? 0.015),
  payFrequency: cfg.pay_frequency || 'biweekly',
  payAnchorDate: cfg.pay_anchor_date || ''
});

const formConfigToServer = (cfg) => {
  const body = {
    federal_tax_rate: cfg.federalTaxRate,
    state_tax_rate: cfg.stateTaxRate,
    social_security_rate: cfg.socialSecurityRate,
    medicare_rate: cfg.medicareRate,
    unemployment_rate: cfg.unemploymentRate,
    benefits_rate: cfg.benefitsRate,
    workers_comp_rate: cfg.workersCompRate,
    pay_frequency: cfg.payFrequency || 'biweekly'
  };
  // The biweekly pay calendar: a known payday (blank keeps the stored one).
  if (cfg.payAnchorDate) body.pay_anchor_date = cfg.payAnchorDate;
  return body;
};

const PayrollManagement = () => {
  const { data, actions, activeScenario, scenarios, loading, lastUpdated, error: loadError } = useForecast();
  const activeScenarioName = activeScenario && scenarios?.[activeScenario] ? scenarios[activeScenario].name : '';
  // An approved scenario refuses changes to its own rows: new hires default to company-wide.
  const activeScenarioLocked = isLocked(activeScenario ? scenarios?.[activeScenario] : null);
  // First load: no roster yet. Show loading, never 'no employees' or $0 (the sidebar's rule).
  const rosterLoading = !(data?.payroll?.length) && Boolean(loading || (!lastUpdated && !loadError));
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState('employees');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [showAllocationModal, setShowAllocationModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  // null = one year of pay runs for the configured frequency (the API's default).
  const [forecastHorizon, setForecastHorizon] = useState(null);
  const [forecastMeta, setForecastMeta] = useState({ periods: null, runsPerYear: null });
  // Statement vs pay dates: null window = the scenario's budget year(s).
  const [bridgeWindow, setBridgeWindow] = useState(null);
  const [bridge, setBridge] = useState(null);
  const [bridgeLoading, setBridgeLoading] = useState(false);
  const [filters, setFilters] = useState({
    department: '',
    status: 'active',
    scope: '',
    laborClass: ''
  });

  // Configuration state for taxes and benefits
  const [config, setConfig] = useState({
    federalTaxRate: 0.22,
    stateTaxRate: 0.06,
    socialSecurityRate: 0.062,
    medicareRate: 0.0145,
    unemploymentRate: 0.006,
    benefitsRate: 0.25, // 25% of gross pay
    workersCompRate: 0.015,
    payFrequency: 'biweekly'
  });
  const [payrollForecast, setPayrollForecast] = useState([]);
  const [forecastLoading, setForecastLoading] = useState(false);
  // Annual cost per employee, by department and by business unit, from the
  // API (same rules as the income statement) - never re-derived here.
  const [costIndex, setCostIndex] = useState({});
  const [payrollSummary, setPayrollSummary] = useState(null);
  const [summaryLoaded, setSummaryLoaded] = useState(false);

  // Payroll config lives on the server (payroll_config) so the statements
  // engine and this screen burden payroll with the same rates.
  useEffect(() => {
    let cancelled = false;
    api.get('/payroll/config', { suppressErrorToast: true })
      .then((res) => {
        if (cancelled || !res?.data?.config) return;
        setConfig(serverConfigToForm(res.data.config));
      })
      .catch(() => { /* keep defaults */ });
    return () => { cancelled = true; };
  }, []);

  // The forecast tab is served by /payroll/forecast so it matches the
  // reporting module instead of re-computing payroll in the browser.
  useEffect(() => {
    if (activeTab !== 'forecast' && activeTab !== 'reports') return undefined;
    let cancelled = false;
    setForecastLoading(true);
    const query = payRunQuery(forecastHorizon, activeScenario);
    api.get(`/payroll/forecast${query ? `?${query}` : ''}`, { suppressErrorToast: true })
      .then((res) => {
        if (cancelled) return;
        setPayrollForecast(serverForecastToView(res?.data?.forecast || []));
        setForecastMeta({ periods: res?.data?.periods || null, runsPerYear: res?.data?.runs_per_year || null });
      })
      .catch(() => {
        if (!cancelled) {
          setPayrollForecast([]);
          toast.error('Failed to load payroll forecast');
        }
      })
      .finally(() => { if (!cancelled) setForecastLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, forecastHorizon, activeScenario, config, data?.payroll]);

  // Statement payroll (accrued evenly by month) vs cash paid on pay dates.
  const scenarioRecord = activeScenario ? scenarios?.[activeScenario] : null;
  const defaultBridgeWindow = useMemo(
    () => (scenarioRecord ? defaultWindowForScenario(scenarioRecord) : null),
    [scenarioRecord]
  );
  const effectiveBridgeWindow = bridgeWindow || defaultBridgeWindow;
  const bridgeStart = effectiveBridgeWindow?.start;
  const bridgeEnd = effectiveBridgeWindow?.end;
  useEffect(() => {
    if (activeTab !== 'forecast') return undefined;
    let cancelled = false;
    setBridgeLoading(true);
    const params = [];
    if (bridgeStart && bridgeEnd) params.push(`start_period=${bridgeStart}`, `end_period=${bridgeEnd}`);
    if (activeScenario) params.push(`forecast_id=${encodeURIComponent(activeScenario)}`);
    api.get(`/payroll/statement-bridge${params.length ? `?${params.join('&')}` : ''}`, { suppressErrorToast: true })
      .then((res) => { if (!cancelled) setBridge(bridgeToView(res?.data)); })
      .catch(() => { if (!cancelled) setBridge(null); })
      .finally(() => { if (!cancelled) setBridgeLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, bridgeStart, bridgeEnd, activeScenario, config, data?.payroll]);

  // Costs: refetched whenever the roster, the scenario or the rates change.
  useEffect(() => {
    let cancelled = false;
    const scope = activeScenario ? `forecast_id=${encodeURIComponent(activeScenario)}` : '';
    Promise.all([
      api.get(`/payroll/employees${scope ? `?${scope}` : ''}`, { suppressErrorToast: true }),
      // Totals only: per-employee costs come from /payroll/employees above.
      api.get(`/payroll/reports/summary?include_employees=false${scope ? `&${scope}` : ''}`, { suppressErrorToast: true })
    ])
      .then(([employeesRes, summaryRes]) => {
        if (cancelled) return;
        setCostIndex(indexEmployeeCosts(employeesRes?.data?.employees));
        setPayrollSummary(summaryRes?.data?.summary || null);
        setSummaryLoaded(true);
      })
      .catch(() => {
        if (!cancelled) {
          setCostIndex({});
          setPayrollSummary(null);
          setSummaryLoaded(true);
        }
      });
    return () => { cancelled = true; };
  }, [data?.payroll, activeScenario, config]);

  // Business unit definitions
  const [standardBusinessUnits] = useState([
    'Customer-Centric Brands',
    'OEM Work',
    'Internal Operations',
    'Other Projects'
  ]);

  // Calculate next review date (12 months from start date or last review)
  const getNextReviewDate = (startDate) => {
    const date = parseLocalDate(startDate);
    if (!date) return null;
    date.setFullYear(date.getFullYear() + 1);
    return toDateOnly(date);
  };

  // Get current payroll data with enhanced structure
  const employees = useMemo(() => {
    if (!data?.payroll) return [];
    
    return data.payroll.map(emp => {
      const costs = costIndex[emp.employee_id] || {};
      // /data/payroll returns allocations as JSON text; parse to percent.
      const allocations = parseAllocations(costs.allocations || emp.allocations);
      return {
        ...emp,
        department: emp.department || emp.labor_type,
        labor_class: normalizeLaborClass(emp.labor_class),
        rate_type: emp.rate_type || 'hourly',
        next_review_date: emp.next_review_date || getNextReviewDate(emp.start_date),
        expected_raise: emp.expected_raise || 0,
        allocations: Object.keys(allocations).length ? allocations : { 'Customer-Centric Brands': 100 },
        benefits_eligible: !(emp.benefits_eligible === false || emp.benefits_eligible === 0 || emp.benefits_eligible === '0'),
        status: emp.end_date && parseLocalDate(emp.end_date) && parseLocalDate(emp.end_date) < new Date() ? 'inactive' : 'active',
        annual_gross: costs.annual_gross,
        annual_cost: costs.annual_cost,
        rate_basis: costs.rate_basis
      };
    });
  }, [data?.payroll, costIndex]);

  const runsPerYear = payrollSummary?.runs_per_year || runsPerYearFor(config.payFrequency);
  const departmentCosts = useMemo(() => summaryToDepartmentCosts(payrollSummary), [payrollSummary]);
  const businessUnitCosts = useMemo(() => summaryToBusinessUnitCosts(payrollSummary), [payrollSummary]);
  const businessUnits = useMemo(
    () => mergeBusinessUnits(standardBusinessUnits, businessUnitCosts).filter(unit => unit !== 'Unallocated'),
    [standardBusinessUnits, businessUnitCosts]
  );

  // Filter employees based on current filters
  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => {
      if (filters.department && emp.department !== filters.department) return false;
      if (filters.status && emp.status !== filters.status) return false;
      if (filters.scope === 'company' && emp.forecast_id) return false;
      if (filters.scope === 'scenario' && !emp.forecast_id) return false;
      if (filters.laborClass && (emp.labor_class || 'unclassified') !== filters.laborClass) return false;
      return true;
    });
  }, [employees, filters]);

  // Active employees with no labor class: their pay counts as Admin, so a
  // production worker among them would also be in the routing standard.
  const unclassifiedActive = useMemo(
    () => employees.filter(emp => emp.status === 'active' && !emp.labor_class),
    [employees]
  );

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
      start_date: toDateOnly(),
      end_date: '',
      next_review_date: '',
      expected_raise: 0,
      benefits_eligible: true,
      allocations: { 'Customer-Centric Brands': 100 },
      forecast_id: (activeScenario && !activeScenarioLocked) ? activeScenario : null,
      labor_class: ''
    });
    setShowEmployeeModal(true);
  };

  const handleEditEmployee = (employee) => {
    setSelectedEmployee({ ...employee });
    setShowEmployeeModal(true);
  };

  const handleEditAllocations = (employee) => {
    setSelectedEmployee({ ...employee });
    setShowAllocationModal(true);
  };

  const handleSaveEmployee = async (employee) => {
    try {
      // Validate allocations sum to 100%
      const allocationSum = Object.values(employee.allocations || {}).reduce((sum, val) => sum + val, 0);
      if (Math.abs(allocationSum - 100) > 0.01) {
        toast.error('Employee allocations must sum to 100%');
        return;
      }

      // Save employee data (display-only fields stay out of the payload)
      const {
        annual_gross: _annualGross, annual_cost: _annualCost, rate_basis: _rateBasis, status: _status,
        ...fields
      } = employee;
      const payload = {
        ...fields,
        next_review_date: employee.next_review_date || getNextReviewDate(employee.start_date),
        end_date: employee.end_date || null,
      };
      const result = employee.employee_id
        ? await actions.updateEmployee(employee.employee_id, payload)
        : await actions.createEmployee(payload);
      toast.success(employee.employee_id ? 'Employee updated successfully' : 'Employee added successfully');
      (result?.warnings || []).forEach((warning) => toast(warning, { icon: '⚠️' }));

      setShowEmployeeModal(false);
      setShowAllocationModal(false);
      setSelectedEmployee(null);
    } catch (error) {
      // The server's reason (e.g. the scenario is approved and locked), never axios' 'status code 409'.
      toast.error(describeError(error, employee.employee_id ? 'Could not update employee' : 'Could not add employee'));
    }
  };

  const handleDeleteEmployee = async (employeeId) => {
    if (await confirm({
      title: 'Delete employee?',
      body: 'This will also remove their payroll history.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    })) {
      try {
        await actions.deleteEmployee(employeeId);
        toast.success('Employee deleted successfully');
      } catch (error) {
        toast.error(describeError(error, 'Could not delete employee'));
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

  const formatDate = (dateString) => formatDateOnly(dateString, { year: 'numeric', month: 'short', day: 'numeric' }, 'N/A');

  // Define columns for employee table
  const employeeColumns = [
    {
      key: 'employee_name',
      title: 'Employee Name',
      render: (value, row) => (
        <div className="space-y-0.5">
          <div className="font-semibold whitespace-nowrap">{value}</div>
          <div className="max-w-[11rem] truncate text-xs text-muted-foreground" title={`ID: ${row.employee_id}`}>ID: {row.employee_id}</div>
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
        return <Badge variant={variants[dept] || 'default'} className="whitespace-nowrap">{dept}</Badge>;
      }
    },
    {
      key: 'labor_class',
      title: 'Labor class',
      render: (value) => (
        <Badge
          variant={LABOR_CLASS_BADGE[value] || 'warning'}
          title={laborClassHelp(value)}
          className="whitespace-nowrap"
          data-testid="labor-class-badge"
        >
          {laborClassLabel(value)}
        </Badge>
      )
    },
    {
      key: 'forecast_id',
      title: 'Scope',
      render: (value) => (
        value
          ? <Badge variant="warning" className="whitespace-nowrap" title={`Only in scenario ${value}`}>{value === activeScenario ? 'This scenario' : value}</Badge>
          : <Badge variant="secondary" className="whitespace-nowrap" title="Included in every scenario">Company-wide</Badge>
      )
    },
    {
      key: 'rate_type',
      title: 'Pay',
      render: (value, row) => (
        <div className="space-y-1">
          <Badge variant={value === 'salary' ? 'success' : 'info'}>
            {value === 'salary' ? 'Salary' : 'Hourly'}
          </Badge>
          <div className="text-sm whitespace-nowrap">{formatRate(row, formatCurrency)}</div>
          <div className="text-xs text-muted-foreground whitespace-nowrap">{row.weekly_hours || 40} h/week</div>
          {row.rate_basis === 'legacy_hourly_equivalent' && (
            <Badge variant="warning" className="text-xs" title="Salaries under 1,000 are read as an hourly rate x 2,080. Edit the employee and enter the annual salary.">
              Check salary
            </Badge>
          )}
        </div>
      )
    },
    {
      key: 'annual_cost',
      title: 'Annual Cost',
      render: (value, row) => (
        <div className="space-y-1" title="Employer cost: gross pay + employer payroll taxes + benefits (income-tax withholding is not an employer cost)">
          <div className="font-medium">{value === undefined || value === null ? '—' : formatCurrency(value)}</div>
          {row.annual_gross !== undefined && row.annual_gross !== null && (
            <div className="text-xs text-muted-foreground">Gross {formatCurrency(row.annual_gross)}</div>
          )}
        </div>
      )
    },
    {
      key: 'start_date',
      title: 'Start Date',
      render: (value) => <span className="whitespace-nowrap">{formatDate(value)}</span>
    },
    {
      key: 'next_review_date',
      title: 'Next Review',
      render: (value) => {
        const reviewDate = parseLocalDate(value);
        if (!reviewDate) return 'N/A';
        const today = new Date();
        const daysUntil = Math.ceil((reviewDate - today) / (1000 * 60 * 60 * 24));
        
        let variant = 'default';
        if (daysUntil < 0) variant = 'destructive';
        else if (daysUntil < 30) variant = 'warning';
        else if (daysUntil < 90) variant = 'info';
        
        return (
          <div className="space-y-1">
            <div className="whitespace-nowrap">{formatDate(value)}</div>
            <Badge variant={variant} className="text-xs whitespace-nowrap">
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

  // Summary statistics (from /payroll/reports/summary)
  const activeEmployees = employees.filter(emp => emp.status === 'active');
  const totalAnnualCost = payrollSummary?.total_annual_cost || 0;
  const avgHourlyRate = payrollSummary?.avg_hourly_rate || 0;
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8" aria-busy={rosterLoading || !summaryLoaded}>
        <StatsCard
          title="Active Employees"
          value={rosterLoading ? LOADING : activeEmployees.length}
          variant="primary"
        />
        <StatsCard
          title="Total Annual Cost"
          value={summaryLoaded ? formatCurrency(totalAnnualCost) : LOADING}
          subtitle="Gross + employer taxes + benefits"
          help="Annual employer cost at current rates, the same rules as the income statement. Income-tax withholding comes out of gross pay and is not added."
          variant="success"
        />
        <StatsCard
          title="Average Hourly Rate"
          value={summaryLoaded ? formatCurrency(avgHourlyRate) : LOADING}
          subtitle="Salaries as an hourly equivalent"
          variant="info"
        />
        <StatsCard
          title="Departments"
          value={summaryLoaded ? departmentCount : LOADING}
          variant="secondary"
        />
      </div>

      {/* Filter Controls */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Label>Scope:</Label>
          <Select value={filters.scope} onChange={(e) => setFilters(prev => ({ ...prev, scope: e.target.value }))}>
            <SelectOption value="">Company-wide + this scenario</SelectOption>
            <SelectOption value="company">Company-wide only</SelectOption>
            <SelectOption value="scenario">This scenario only</SelectOption>
          </Select>
        </div>
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
          <Label htmlFor="payroll-labor-class-filter" className="whitespace-nowrap">Labor class:</Label>
          <Select
            id="payroll-labor-class-filter"
            value={filters.laborClass}
            onChange={(e) => setFilters(prev => ({ ...prev, laborClass: e.target.value }))}
          >
            <SelectOption value="">All classes</SelectOption>
            {LABOR_CLASS_OPTIONS.map(option => (
              <SelectOption key={option.value} value={option.value}>{option.label}</SelectOption>
            ))}
            <SelectOption value="unclassified">Not classified</SelectOption>
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
          {unclassifiedActive.length > 0 && (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              data-testid="unclassified-note"
            >
              <p>
                {unclassifiedActive.length === 1 ? '1 employee has' : `${unclassifiedActive.length} employees have`} no labor class,
                so their pay is counted as Admin (operating expenses). Class production workers <strong>Direct</strong> and
                factory support <strong>Indirect</strong> so the income statement does not count anyone twice.
              </p>
              {filters.laborClass !== 'unclassified' && (
                <button
                  type="button"
                  className="rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
                  onClick={() => setFilters(prev => ({ ...prev, laborClass: 'unclassified', status: 'active' }))}
                >
                  Show them
                </button>
              )}
            </div>
          )}
          <Card>
            <CardHeader>
              <CardTitle>{rosterLoading ? 'All Employees' : `All Employees (${filteredEmployees.length})`}</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                data={filteredEmployees}
                columns={employeeColumns}
                onEdit={handleEditEmployee}
                onDelete={(employee) => handleDeleteEmployee(employee.employee_id)}
                emptyMessage={rosterLoading ? 'Loading employees…' : "No employees found. Click 'Add Employee' to get started."}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="forecast" className="space-y-6">
          {forecastLoading && (
            <p className="text-sm text-gray-500">Loading payroll forecast…</p>
          )}
          <PayrollForecast
            forecast={payrollForecast}
            loading={forecastLoading && payrollForecast.length === 0}
            forecastHorizon={forecastHorizon ?? forecastMeta.periods ?? (forecastMeta.runsPerYear || runsPerYear)}
            onHorizonChange={setForecastHorizon}
            runsPerYear={forecastMeta.runsPerYear || runsPerYear}
            payFrequency={config.payFrequency}
            bridge={bridge}
            bridgeLoading={bridgeLoading}
            bridgeWindow={effectiveBridgeWindow || (bridge ? { start: bridge.start, end: bridge.end } : null)}
            onBridgeWindowChange={setBridgeWindow}
          />
        </TabsContent>

        <TabsContent value="departments" className="space-y-6">
          <DepartmentAnalytics
            departmentCosts={departmentCosts}
            runsPerYear={runsPerYear}
            payFrequency={config.payFrequency}
          />
        </TabsContent>

        <TabsContent value="allocation" className="space-y-6">
          <BusinessUnitAllocation
            employees={employees}
            businessUnits={businessUnits}
            businessUnitCosts={businessUnitCosts}
            onEditAllocations={handleEditAllocations}
          />
        </TabsContent>

        <TabsContent value="reports" className="space-y-6">
          <PayrollReports
            employees={employees}
            forecast={payrollForecast}
            departmentCosts={departmentCosts}
            businessUnitCosts={businessUnitCosts}
            runsPerYear={runsPerYear}
            payFrequency={config.payFrequency}
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
          activeScenario={activeScenario}
          activeScenarioName={activeScenarioName}
          activeScenarioLocked={activeScenarioLocked}
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
          onSave={(updatedEmployee) => {
            if (selectedEmployee) {
              handleSaveEmployee({ ...selectedEmployee, allocations: updatedEmployee.allocations });
            }
          }}
          onCancel={() => {
            setShowAllocationModal(false);
            setSelectedEmployee(null);
          }}
        />
      )}

      {showConfigModal && (
        <ConfigurationModal
          config={config}
          onSave={async (newConfig) => {
            try {
              await api.post('/payroll/config', formConfigToServer(newConfig));
              // A new pay frequency means a new year of runs: drop a hand-picked horizon.
              if (newConfig.payFrequency !== config.payFrequency) setForecastHorizon(null);
              setConfig(newConfig);
              setShowConfigModal(false);
              actions.fetchAllData?.(activeScenario);
            } catch (error) {
              toast.error(describeError(error, 'Could not save the payroll configuration'));
            }
          }}
          onCancel={() => setShowConfigModal(false)}
        />
      )}
    </div>
  );
};

export default PayrollManagement;