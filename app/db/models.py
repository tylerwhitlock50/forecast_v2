from pydantic import BaseModel, Field
from typing import Optional, List
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

# BOM Models (updated structure)
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

class BOMCreate(BOMBase):
    pass

# Router Models (updated structure)
class RouterBase(BaseModel):
    unit_id: str
    machine_id: str
    machine_minutes: float
    labor_minutes: float
    sequence: int

class Router(RouterBase):
    router_id: str

class RouterCreate(RouterBase):
    pass

# Machine Models
class MachineBase(BaseModel):
    machine_name: str
    machine_description: Optional[str] = None
    machine_rate: float
    labor_type: str

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

# Payroll Models
class PayrollBase(BaseModel):
    employee_name: str
    weekly_hours: int
    hourly_rate: float
    labor_type: str
    start_date: str
    end_date: str

class Payroll(PayrollBase):
    employee_id: str

class PayrollCreate(PayrollBase):
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