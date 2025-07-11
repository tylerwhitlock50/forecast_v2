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

class Unit(UnitBase):
    unit_id: str

class UnitCreate(UnitBase):
    pass

# Sales Models
class SaleBase(BaseModel):
    customer_id: str
    unit_id: str
    period: str
    quantity: int
    unit_price: float
    total_revenue: float

class Sale(SaleBase):
    sale_id: str

class SaleCreate(SaleBase):
    pass

# BOM Models
class BOMBase(BaseModel):
    unit_id: str
    router_id: str
    material_cost: float

class BOM(BOMBase):
    bom_id: str

class BOMCreate(BOMBase):
    pass

# Router Models
class RouterBase(BaseModel):
    unit_id: str
    machine_id: str
    machine_minutes: int
    labor_minutes: int
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

class BOMWithDetails(BaseModel):
    bom_id: str
    unit_id: str
    unit_name: str
    router_id: str
    material_cost: float

class RouterWithDetails(BaseModel):
    router_id: str
    unit_id: str
    unit_name: str
    machine_id: str
    machine_name: str
    machine_rate: float
    machine_minutes: int
    labor_minutes: int
    sequence: int

class ForecastData(BaseModel):
    sales_forecast: List[SalesWithDetails]
    bom_data: List[BOMWithDetails]
    router_data: List[RouterWithDetails]
    payroll_data: List[Payroll] 