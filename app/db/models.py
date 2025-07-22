from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import date

# Customer Models
class CustomerBase(BaseModel):
    customer_name: str
    customer_type: Optional[str] = None
    region: Optional[str] = None

class Customer(CustomerBase):
    customer_id: str

class CustomerCreate(CustomerBase):
    pass

# Unit Models
class UnitBase(BaseModel):
    unit_name: str
    unit_description: Optional[str] = None
    base_price: float
    unit_type: Optional[str] = None
    bom: Optional[str] = None
    router: Optional[str] = None

class Unit(UnitBase):
    unit_id: str

class UnitCreate(UnitBase):
    pass

# Forecast Models
class ForecastBase(BaseModel):
    name: str
    description: Optional[str] = None

class Forecast(ForecastBase):
    forecast_id: str

class ForecastCreate(ForecastBase):
    pass

# Sales Models
class SaleBase(BaseModel):
    customer_id: str
    unit_id: str
    period: str
    quantity: int
    unit_price: float
    total_revenue: float
    forecast_id: Optional[str] = None

class Sale(SaleBase):
    sale_id: str

class SaleCreate(SaleBase):
    pass

# BOM Models (updated structure with versioning)
class BOMBase(BaseModel):
    bom_line: int
    material_description: str
    qty: float
    unit: str
    unit_price: float
    material_cost: float
    target_cost: Optional[float] = None

class BOM(BOMBase):
    bom_id: str
    version: str = "1.0"

class BOMCreate(BOMBase):
    bom_id: str
    version: str = "1.0"

class BOMClone(BaseModel):
    bom_id: str
    from_version: str
    to_version: str

# Router Models (updated structure with versioning)
class RouterBase(BaseModel):
    unit_id: str
    machine_id: str
    machine_minutes: float
    labor_minutes: float
    labor_type_id: str
    sequence: int

class Router(RouterBase):
    router_id: str
    version: str = "1.0"

class RouterCreate(RouterBase):
    router_id: str
    version: str = "1.0"

class RouterClone(BaseModel):
    router_id: str
    from_version: str
    to_version: str

# Machine Models
class MachineBase(BaseModel):
    machine_name: str
    machine_description: Optional[str] = None
    machine_rate: float
    labor_type: str
    available_minutes_per_month: int = 0

class Machine(MachineBase):
    machine_id: str

class MachineCreate(MachineBase):
    pass

# Labor Rate Models
class LaborRateBase(BaseModel):
    rate_name: str
    rate_description: Optional[str] = None
    rate_amount: float
    rate_type: str

class LaborRate(LaborRateBase):
    rate_id: str

class LaborRateCreate(LaborRateBase):
    pass

# Enhanced Payroll Models
class PayrollBase(BaseModel):
    employee_name: str
    department: str
    weekly_hours: int
    hourly_rate: float
    rate_type: str = "hourly"  # "hourly" or "salary"
    labor_type: str
    start_date: str
    end_date: Optional[str] = None
    next_review_date: Optional[str] = None
    expected_raise: float = 0.0
    benefits_eligible: bool = True
    allocations: Optional[Dict[str, float]] = None  # Business unit allocations

class Payroll(PayrollBase):
    employee_id: str

class PayrollCreate(PayrollBase):
    pass

# Payroll Configuration Models
class PayrollConfigBase(BaseModel):
    federal_tax_rate: float = 0.22
    state_tax_rate: float = 0.06
    social_security_rate: float = 0.062
    medicare_rate: float = 0.0145
    unemployment_rate: float = 0.006
    benefits_rate: float = 0.25
    workers_comp_rate: float = 0.015

class PayrollConfig(PayrollConfigBase):
    config_id: str

class PayrollConfigCreate(PayrollConfigBase):
    pass

# API Request/Response Models
class ChatRequest(BaseModel):
    message: str
    context: Optional[dict] = None

class SQLApplyRequest(BaseModel):
    sql_statement: str
    description: str
    user_id: Optional[str] = None
    session_id: Optional[str] = None

class ForecastResponse(BaseModel):
    status: str
    data: Optional[dict] = None
    message: Optional[str] = None

# Complex Data Models
class SalesWithDetails(BaseModel):
    sale_id: str
    customer_id: str
    customer_name: str
    unit_id: str
    unit_name: str
    base_price: float
    period: str
    quantity: int
    unit_price: float
    total_revenue: float
    forecast_id: Optional[str] = None

class BOMWithDetails(BaseModel):
    bom_id: str
    bom_line: int
    material_description: str
    qty: float
    unit: str
    unit_price: float
    material_cost: float
    target_cost: Optional[float] = None

class RouterWithDetails(BaseModel):
    router_id: str
    unit_id: str
    unit_name: str
    machine_id: str
    machine_name: str
    machine_rate: float
    machine_minutes: float
    labor_minutes: float
    sequence: int

class ForecastData(BaseModel):
    sales_forecast: List[SalesWithDetails]
    bom_data: List[BOMWithDetails]
    router_data: List[RouterWithDetails]
    payroll_data: List[Payroll]

# Cost Management Models
class ProductCostSummary(BaseModel):
    product_id: str
    product_name: str
    forecasted_revenue: float
    material_cost: float
    labor_cost: float
    machine_cost: float
    total_cogs: float
    gross_margin: float
    gross_margin_percent: float

class MaterialUsage(BaseModel):
    material_description: str
    total_quantity_needed: float
    unit: str
    unit_price: float
    total_cost: float
    products_using: List[str]

class MachineUtilization(BaseModel):
    machine_id: str
    machine_name: str
    total_minutes_required: float
    available_minutes_per_month: int
    utilization_percent: float
    total_cost: float
    capacity_exceeded: bool

class LaborUtilization(BaseModel):
    labor_type_id: str
    labor_type_name: str
    total_minutes_required: float
    hourly_rate: float
    total_cost: float
    products_involved: List[str]

class COGSBreakdown(BaseModel):
    product_id: str
    product_name: str
    materials: List[Dict[str, Any]]
    labor: List[Dict[str, Any]]
    machines: List[Dict[str, Any]]
    total_material_cost: float
    total_labor_cost: float
    total_machine_cost: float
    total_cogs: float

# Expense Management Models

class ExpenseCategory(BaseModel):
    category_id: str
    category_name: str
    category_type: str  # 'factory_overhead', 'admin_expense', 'cogs'
    parent_category_id: Optional[str] = None
    account_code: Optional[str] = None
    description: Optional[str] = None

class ExpenseCategoryCreate(BaseModel):
    category_name: str
    category_type: str  # 'factory_overhead', 'admin_expense', 'cogs'
    parent_category_id: Optional[str] = None
    account_code: Optional[str] = None
    description: Optional[str] = None

class ExpenseBase(BaseModel):
    expense_name: str
    category_id: str
    amount: float
    frequency: str  # 'monthly', 'quarterly', 'biannually', 'annually', 'one_time', 'weekly'
    start_date: str
    end_date: Optional[str] = None
    vendor: Optional[str] = None
    description: Optional[str] = None
    payment_method: Optional[str] = None
    approval_required: bool = False
    approved_by: Optional[str] = None
    approval_date: Optional[str] = None
    expense_allocation: str = 'immediate'  # 'immediate', 'amortized'
    amortization_months: Optional[int] = None
    department: Optional[str] = None
    cost_center: Optional[str] = None
    is_active: bool = True

class Expense(ExpenseBase):
    expense_id: str
    created_date: str
    updated_date: str

class ExpenseCreate(ExpenseBase):
    pass

class ExpenseUpdate(BaseModel):
    expense_name: Optional[str] = None
    category_id: Optional[str] = None
    amount: Optional[float] = None
    frequency: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    vendor: Optional[str] = None
    description: Optional[str] = None
    payment_method: Optional[str] = None
    approval_required: Optional[bool] = None
    approved_by: Optional[str] = None
    approval_date: Optional[str] = None
    expense_allocation: Optional[str] = None
    amortization_months: Optional[int] = None
    department: Optional[str] = None
    cost_center: Optional[str] = None
    is_active: Optional[bool] = None

class ExpenseAllocation(BaseModel):
    allocation_id: str
    expense_id: str
    period: str  # YYYY-MM format
    allocated_amount: float
    allocation_type: str  # 'scheduled', 'amortized', 'one_time'
    payment_status: str  # 'pending', 'scheduled', 'paid', 'overdue'
    payment_date: Optional[str] = None
    actual_amount: Optional[float] = None
    notes: Optional[str] = None

class ExpenseAllocationCreate(BaseModel):
    expense_id: str
    period: str
    allocated_amount: float
    allocation_type: str
    payment_status: str = 'pending'
    payment_date: Optional[str] = None
    actual_amount: Optional[float] = None
    notes: Optional[str] = None

class ExpenseForecast(BaseModel):
    period: str  # YYYY-MM format
    category_id: str
    category_name: str
    category_type: str
    total_scheduled: float
    total_amortized: float
    total_one_time: float
    total_amount: float
    expense_count: int

class ExpenseWithDetails(BaseModel):
    expense_id: str
    expense_name: str
    category_id: str
    category_name: str
    category_type: str
    amount: float
    frequency: str
    start_date: str
    end_date: Optional[str] = None
    vendor: Optional[str] = None
    description: Optional[str] = None
    payment_method: Optional[str] = None
    approval_required: bool
    approved_by: Optional[str] = None
    approval_date: Optional[str] = None
    expense_allocation: str
    amortization_months: Optional[int] = None
    department: Optional[str] = None
    cost_center: Optional[str] = None
    is_active: bool
    created_date: str
    updated_date: str
    next_payment_date: Optional[str] = None
    next_payment_amount: Optional[float] = None
    total_annual_cost: Optional[float] = None

class ExpenseReportSummary(BaseModel):
    total_monthly: float
    total_quarterly: float
    total_annual: float
    total_one_time: float
    factory_overhead_total: float
    admin_expense_total: float
    cogs_total: float
    upcoming_payments: List[Dict[str, Any]]
    overdue_payments: List[Dict[str, Any]]
    top_categories: List[Dict[str, Any]]
    monthly_forecast: List[ExpenseForecast]

# Loan Management Models

class LoanBase(BaseModel):
    loan_name: str
    lender: str
    loan_type: str  # 'term_loan', 'line_of_credit', 'sba_loan', 'equipment_loan', 'real_estate_loan'
    principal_amount: float
    interest_rate: float  # Annual percentage rate
    loan_term_months: int
    start_date: str
    payment_type: str  # 'amortizing', 'interest_only'
    payment_frequency: str = 'monthly'  # 'monthly', 'quarterly', 'annually'
    balloon_payment: Optional[float] = None
    balloon_date: Optional[str] = None
    description: Optional[str] = None
    collateral_description: Optional[str] = None
    guarantor: Optional[str] = None
    loan_officer: Optional[str] = None
    account_number: Optional[str] = None
    is_active: bool = True

class Loan(LoanBase):
    loan_id: str
    created_date: str
    updated_date: str
    current_balance: float
    next_payment_date: str
    monthly_payment_amount: float

class LoanCreate(LoanBase):
    pass

class LoanUpdate(BaseModel):
    loan_name: Optional[str] = None
    lender: Optional[str] = None
    loan_type: Optional[str] = None
    principal_amount: Optional[float] = None
    interest_rate: Optional[float] = None
    loan_term_months: Optional[int] = None
    start_date: Optional[str] = None
    payment_type: Optional[str] = None
    payment_frequency: Optional[str] = None
    balloon_payment: Optional[float] = None
    balloon_date: Optional[str] = None
    description: Optional[str] = None
    collateral_description: Optional[str] = None
    guarantor: Optional[str] = None
    loan_officer: Optional[str] = None
    account_number: Optional[str] = None
    is_active: Optional[bool] = None

class LoanPayment(BaseModel):
    payment_id: str
    loan_id: str
    payment_number: int
    payment_date: str
    payment_amount: float
    principal_payment: float
    interest_payment: float
    remaining_balance: float
    payment_status: str  # 'scheduled', 'paid', 'overdue', 'skipped'
    actual_payment_date: Optional[str] = None
    actual_payment_amount: Optional[float] = None
    notes: Optional[str] = None

class LoanPaymentCreate(BaseModel):
    loan_id: str
    payment_number: int
    payment_date: str
    payment_amount: float
    principal_payment: float
    interest_payment: float
    remaining_balance: float
    payment_status: str = 'scheduled'
    actual_payment_date: Optional[str] = None
    actual_payment_amount: Optional[float] = None
    notes: Optional[str] = None

class AmortizationSchedule(BaseModel):
    loan_id: str
    loan_name: str
    lender: str
    payment_schedule: List[LoanPayment]
    total_payments: float
    total_interest: float
    loan_summary: Dict[str, Any]

class LoanWithDetails(BaseModel):
    loan_id: str
    loan_name: str
    lender: str
    loan_type: str
    principal_amount: float
    interest_rate: float
    loan_term_months: int
    start_date: str
    payment_type: str
    payment_frequency: str
    balloon_payment: Optional[float] = None
    balloon_date: Optional[str] = None
    description: Optional[str] = None
    collateral_description: Optional[str] = None
    guarantor: Optional[str] = None
    loan_officer: Optional[str] = None
    account_number: Optional[str] = None
    is_active: bool
    created_date: str
    updated_date: str
    current_balance: float
    next_payment_date: str
    monthly_payment_amount: float
    payments_made: int
    payments_remaining: int
    total_interest_paid: float
    total_interest_remaining: float

class LoanSummary(BaseModel):
    total_loans: int
    active_loans: int
    total_principal: float
    total_current_balance: float
    total_monthly_payments: float
    total_annual_payments: float
    upcoming_payments: List[Dict[str, Any]]
    loans_by_type: List[Dict[str, Any]]
    interest_rate_summary: Dict[str, float]

class CashFlowProjection(BaseModel):
    period: str  # YYYY-MM format
    loan_payments: List[Dict[str, Any]]
    total_principal: float
    total_interest: float
    total_payment: float
    remaining_balance: float 