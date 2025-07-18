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