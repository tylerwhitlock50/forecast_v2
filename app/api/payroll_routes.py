from fastapi import APIRouter, HTTPException, Query
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
import uuid
import json

from db import get_forecast_data
from db.models import (
    Payroll, PayrollCreate, PayrollBase,
    PayrollConfig, PayrollConfigCreate,
    ForecastResponse
)
from db.database import db_manager

router = APIRouter(prefix="/payroll", tags=["payroll"])

# ========================
# Employee Management
# ========================

@router.get("/employees", response_model=ForecastResponse)
async def get_employees(
    department: Optional[str] = Query(None, description="Filter by department"),
    status: Optional[str] = Query(None, description="Filter by status (active/inactive)"),
    business_unit: Optional[str] = Query(None, description="Filter by business unit allocation")
):
    """
    Get all employees with optional filtering
    """
    try:
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Base query
        query = """
            SELECT employee_id, employee_name, department, weekly_hours, hourly_rate, 
                   rate_type, labor_type, start_date, end_date, next_review_date, 
                   expected_raise, benefits_eligible, allocations
            FROM payroll
        """
        
        conditions = []
        params = []
        
        # Add filters
        if department:
            conditions.append("department = ?")
            params.append(department)
            
        if status:
            if status == "active":
                conditions.append("(end_date IS NULL OR end_date > date('now'))")
            elif status == "inactive":
                conditions.append("end_date IS NOT NULL AND end_date <= date('now')")
        
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
            
        query += " ORDER BY employee_name"
        
        cursor.execute(query, params)
        employees = cursor.fetchall()
        
        # Convert to list of dictionaries
        columns = [description[0] for description in cursor.description]
        employee_list = []
        
        for row in employees:
            employee_dict = dict(zip(columns, row))
            
            # Parse allocations JSON
            if employee_dict.get('allocations'):
                try:
                    employee_dict['allocations'] = json.loads(employee_dict['allocations'])
                except (json.JSONDecodeError, TypeError):
                    employee_dict['allocations'] = {}
            else:
                employee_dict['allocations'] = {}
            
            # Calculate status
            end_date = employee_dict.get('end_date')
            if end_date and datetime.strptime(end_date, '%Y-%m-%d').date() <= datetime.now().date():
                employee_dict['status'] = 'inactive'
            else:
                employee_dict['status'] = 'active'
            
            # Apply business unit filter if specified
            if business_unit:
                allocations = employee_dict.get('allocations', {})
                if business_unit not in allocations or allocations[business_unit] == 0:
                    continue
            
            employee_list.append(employee_dict)
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"employees": employee_list},
            message=f"Retrieved {len(employee_list)} employees"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving employees: {str(e)}")

@router.get("/employees/{employee_id}", response_model=ForecastResponse)
async def get_employee(employee_id: str):
    """
    Get a specific employee by ID
    """
    try:
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT employee_id, employee_name, department, weekly_hours, hourly_rate, 
                   rate_type, labor_type, start_date, end_date, next_review_date, 
                   expected_raise, benefits_eligible, allocations
            FROM payroll WHERE employee_id = ?
        """, (employee_id,))
        
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Employee not found")
        
        columns = [description[0] for description in cursor.description]
        employee = dict(zip(columns, row))
        
        # Parse allocations JSON
        if employee.get('allocations'):
            try:
                employee['allocations'] = json.loads(employee['allocations'])
            except (json.JSONDecodeError, TypeError):
                employee['allocations'] = {}
        else:
            employee['allocations'] = {}
        
        # Calculate status
        end_date = employee.get('end_date')
        if end_date and datetime.strptime(end_date, '%Y-%m-%d').date() <= datetime.now().date():
            employee['status'] = 'inactive'
        else:
            employee['status'] = 'active'
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"employee": employee},
            message="Employee retrieved successfully"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving employee: {str(e)}")

@router.post("/employees", response_model=ForecastResponse)
async def create_employee(employee: PayrollCreate):
    """
    Create a new employee
    """
    try:
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Generate employee ID
        employee_id = f"EMP-{int(datetime.now().timestamp())}"
        
        # Calculate next review date if not provided
        next_review_date = employee.next_review_date
        if not next_review_date:
            start_date = datetime.strptime(employee.start_date, '%Y-%m-%d')
            review_date = start_date + timedelta(days=365)
            next_review_date = review_date.strftime('%Y-%m-%d')
        
        # Convert allocations to JSON
        allocations_json = json.dumps(employee.allocations) if employee.allocations else json.dumps({})
        
        # Insert employee
        cursor.execute("""
            INSERT INTO payroll (
                employee_id, employee_name, department, weekly_hours, hourly_rate,
                rate_type, labor_type, start_date, end_date, next_review_date,
                expected_raise, benefits_eligible, allocations
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            employee_id, employee.employee_name, employee.department,
            employee.weekly_hours, employee.hourly_rate, employee.rate_type,
            employee.labor_type, employee.start_date, employee.end_date,
            next_review_date, employee.expected_raise, employee.benefits_eligible,
            allocations_json
        ))
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"employee_id": employee_id},
            message="Employee created successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating employee: {str(e)}")

@router.put("/employees/{employee_id}", response_model=ForecastResponse)
async def update_employee(employee_id: str, employee: PayrollBase):
    """
    Update an existing employee
    """
    try:
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Check if employee exists
        cursor.execute("SELECT employee_id FROM payroll WHERE employee_id = ?", (employee_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Employee not found")
        
        # Convert allocations to JSON
        allocations_json = json.dumps(employee.allocations) if employee.allocations else json.dumps({})
        
        # Update employee
        cursor.execute("""
            UPDATE payroll SET
                employee_name = ?, department = ?, weekly_hours = ?, hourly_rate = ?,
                rate_type = ?, labor_type = ?, start_date = ?, end_date = ?,
                next_review_date = ?, expected_raise = ?, benefits_eligible = ?, allocations = ?
            WHERE employee_id = ?
        """, (
            employee.employee_name, employee.department, employee.weekly_hours,
            employee.hourly_rate, employee.rate_type, employee.labor_type,
            employee.start_date, employee.end_date, employee.next_review_date,
            employee.expected_raise, employee.benefits_eligible, allocations_json,
            employee_id
        ))
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"employee_id": employee_id},
            message="Employee updated successfully"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating employee: {str(e)}")

@router.delete("/employees/{employee_id}", response_model=ForecastResponse)
async def delete_employee(employee_id: str):
    """
    Delete an employee
    """
    try:
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Check if employee exists
        cursor.execute("SELECT employee_id FROM payroll WHERE employee_id = ?", (employee_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Employee not found")
        
        # Delete employee
        cursor.execute("DELETE FROM payroll WHERE employee_id = ?", (employee_id,))
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"employee_id": employee_id},
            message="Employee deleted successfully"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting employee: {str(e)}")

# ========================
# Payroll Configuration
# ========================

@router.get("/config", response_model=ForecastResponse)
async def get_payroll_config():
    """
    Get payroll tax and benefit configuration
    """
    try:
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        cursor.execute("SELECT * FROM payroll_config ORDER BY config_id DESC LIMIT 1")
        row = cursor.fetchone()
        
        if row:
            columns = [description[0] for description in cursor.description]
            config = dict(zip(columns, row))
        else:
            # Return default configuration
            config = {
                "config_id": "default",
                "federal_tax_rate": 0.22,
                "state_tax_rate": 0.06,
                "social_security_rate": 0.062,
                "medicare_rate": 0.0145,
                "unemployment_rate": 0.006,
                "benefits_rate": 0.25,
                "workers_comp_rate": 0.015
            }
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"config": config},
            message="Payroll configuration retrieved successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving payroll config: {str(e)}")

@router.post("/config", response_model=ForecastResponse)
async def update_payroll_config(config: PayrollConfigCreate):
    """
    Update payroll tax and benefit configuration
    """
    try:
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Generate config ID
        config_id = f"CONFIG-{int(datetime.now().timestamp())}"
        
        # Insert new config (keep history)
        cursor.execute("""
            INSERT INTO payroll_config (
                config_id, federal_tax_rate, state_tax_rate, social_security_rate,
                medicare_rate, unemployment_rate, benefits_rate, workers_comp_rate
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            config_id, config.federal_tax_rate, config.state_tax_rate,
            config.social_security_rate, config.medicare_rate, config.unemployment_rate,
            config.benefits_rate, config.workers_comp_rate
        ))
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"config_id": config_id},
            message="Payroll configuration updated successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating payroll config: {str(e)}")

# ========================
# Payroll Calculations
# ========================

@router.get("/calculations/{employee_id}", response_model=ForecastResponse)
async def calculate_employee_costs(
    employee_id: str,
    pay_periods: int = Query(1, description="Number of pay periods to calculate")
):
    """
    Calculate detailed costs for a specific employee
    """
    try:
        # Get employee data
        employee_response = await get_employee(employee_id)
        employee = employee_response.data["employee"]
        
        # Get payroll config
        config_response = await get_payroll_config()
        config = config_response.data["config"]
        
        # Calculate gross pay
        if employee["rate_type"] == "salary":
            gross_pay = (employee["hourly_rate"] * 40 * 52 / 26) * pay_periods
        else:
            gross_pay = employee["hourly_rate"] * employee["weekly_hours"] * 2 * pay_periods
        
        # Calculate taxes and benefits
        federal_tax = gross_pay * config["federal_tax_rate"]
        state_tax = gross_pay * config["state_tax_rate"]
        social_security = gross_pay * config["social_security_rate"]
        medicare = gross_pay * config["medicare_rate"]
        unemployment = gross_pay * config["unemployment_rate"]
        workers_comp = gross_pay * config["workers_comp_rate"]
        benefits = gross_pay * config["benefits_rate"] if employee["benefits_eligible"] else 0
        
        total_cost = gross_pay + federal_tax + state_tax + social_security + medicare + unemployment + workers_comp + benefits
        
        calculation = {
            "employee_id": employee_id,
            "employee_name": employee["employee_name"],
            "pay_periods": pay_periods,
            "gross_pay": gross_pay,
            "federal_tax": federal_tax,
            "state_tax": state_tax,
            "social_security": social_security,
            "medicare": medicare,
            "unemployment": unemployment,
            "workers_comp": workers_comp,
            "benefits": benefits,
            "total_cost": total_cost,
            "effective_hourly_cost": total_cost / (employee["weekly_hours"] * 2 * pay_periods) if employee["weekly_hours"] > 0 else 0
        }
        
        return ForecastResponse(
            status="success",
            data={"calculation": calculation},
            message="Employee cost calculation completed"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculating employee costs: {str(e)}")

# ========================
# Payroll Forecasting
# ========================

@router.get("/forecast", response_model=ForecastResponse)
async def get_payroll_forecast(
    periods: int = Query(26, description="Number of pay periods to forecast"),
    include_raises: bool = Query(True, description="Include scheduled raises in forecast")
):
    """
    Generate payroll forecast for specified number of pay periods
    """
    try:
        # Get all active employees
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT employee_id, employee_name, department, weekly_hours, hourly_rate, 
                   rate_type, labor_type, start_date, end_date, next_review_date, 
                   expected_raise, benefits_eligible, allocations
            FROM payroll
            WHERE end_date IS NULL OR end_date > date('now')
            ORDER BY employee_name
        """)
        employee_rows = cursor.fetchall()
        
        columns = [description[0] for description in cursor.description]
        employees = []
        
        for row in employee_rows:
            employee_dict = dict(zip(columns, row))
            
            # Parse allocations JSON
            if employee_dict.get('allocations'):
                try:
                    import json
                    employee_dict['allocations'] = json.loads(employee_dict['allocations'])
                except (json.JSONDecodeError, TypeError):
                    employee_dict['allocations'] = {}
            else:
                employee_dict['allocations'] = {}
            
            employees.append(employee_dict)
        
        # Get payroll config
        cursor.execute("SELECT * FROM payroll_config ORDER BY config_id DESC LIMIT 1")
        config_row = cursor.fetchone()
        
        if config_row:
            config_columns = [description[0] for description in cursor.description]
            config = dict(zip(config_columns, config_row))
        else:
            # Return default configuration
            config = {
                "config_id": "default",
                "federal_tax_rate": 0.22,
                "state_tax_rate": 0.06,
                "social_security_rate": 0.062,
                "medicare_rate": 0.0145,
                "unemployment_rate": 0.006,
                "benefits_rate": 0.25,
                "workers_comp_rate": 0.015
            }
        
        # Generate forecast
        forecast = []
        today = datetime.now()
        
        # Find next Friday (payroll day)
        days_until_friday = (4 - today.weekday()) % 7
        if days_until_friday == 0 and today.hour >= 17:  # If it's Friday after 5 PM, go to next Friday
            days_until_friday = 7
        next_payroll_date = today + timedelta(days=days_until_friday)
        
        for period in range(periods):
            payroll_date = next_payroll_date + timedelta(days=period * 14)
            
            period_total = 0
            employee_details = []
            
            for emp in employees:
                # Check if employee is still active on this date
                if emp.get("end_date"):
                    end_date = datetime.strptime(emp["end_date"], '%Y-%m-%d')
                    if payroll_date.date() > end_date.date():
                        continue
                
                # Apply scheduled raises if enabled
                adjusted_rate = emp["hourly_rate"]
                if include_raises and emp.get("next_review_date") and emp.get("expected_raise"):
                    review_date = datetime.strptime(emp["next_review_date"], '%Y-%m-%d')
                    if payroll_date.date() >= review_date.date():
                        if emp["expected_raise"] > 1:  # Flat amount
                            adjusted_rate += emp["expected_raise"]
                        else:  # Percentage
                            adjusted_rate *= (1 + emp["expected_raise"])
                
                # Calculate costs for this employee
                if emp["rate_type"] == "salary":
                    gross_pay = adjusted_rate * 40 * 52 / 26
                else:
                    gross_pay = adjusted_rate * emp["weekly_hours"] * 2
                
                federal_tax = gross_pay * config["federal_tax_rate"]
                state_tax = gross_pay * config["state_tax_rate"]
                social_security = gross_pay * config["social_security_rate"]
                medicare = gross_pay * config["medicare_rate"]
                unemployment = gross_pay * config["unemployment_rate"]
                workers_comp = gross_pay * config["workers_comp_rate"]
                benefits = gross_pay * config["benefits_rate"] if emp["benefits_eligible"] else 0
                
                total_cost = gross_pay + federal_tax + state_tax + social_security + medicare + unemployment + workers_comp + benefits
                
                period_total += total_cost
                employee_details.append({
                    "employee_id": emp["employee_id"],
                    "employee_name": emp["employee_name"],
                    "department": emp["department"],
                    "gross_pay": gross_pay,
                    "total_cost": total_cost,
                    "allocations": emp.get("allocations", {})
                })
            
            forecast.append({
                "period": period + 1,
                "date": payroll_date.strftime('%Y-%m-%d'),
                "total_cost": period_total,
                "employee_count": len(employee_details),
                "employee_details": employee_details
            })
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"forecast": forecast},
            message=f"Generated payroll forecast for {periods} periods"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating payroll forecast: {str(e)}")

# ========================
# Department Analytics
# ========================

@router.get("/departments", response_model=ForecastResponse)
async def get_department_analytics():
    """
    Get payroll analytics by department
    """
    try:
        # Get all active employees
        employees_response = await get_employees(status="active")
        employees = employees_response.data["employees"]
        
        # Get payroll config
        config_response = await get_payroll_config()
        config = config_response.data["config"]
        
        # Calculate department costs
        departments = {}
        
        for emp in employees:
            dept = emp.get("department", "Unassigned")
            
            if dept not in departments:
                departments[dept] = {
                    "department": dept,
                    "employee_count": 0,
                    "total_annual_cost": 0,
                    "avg_hourly_rate": 0,
                    "employees": []
                }
            
            # Calculate annual cost
            if emp["rate_type"] == "salary":
                gross_pay = emp["hourly_rate"] * 40 * 52
            else:
                gross_pay = emp["hourly_rate"] * emp["weekly_hours"] * 52
            
            # Apply taxes and benefits
            federal_tax = gross_pay * config["federal_tax_rate"]
            state_tax = gross_pay * config["state_tax_rate"]
            social_security = gross_pay * config["social_security_rate"]
            medicare = gross_pay * config["medicare_rate"]
            unemployment = gross_pay * config["unemployment_rate"]
            workers_comp = gross_pay * config["workers_comp_rate"]
            benefits = gross_pay * config["benefits_rate"] if emp["benefits_eligible"] else 0
            
            total_annual_cost = gross_pay + federal_tax + state_tax + social_security + medicare + unemployment + workers_comp + benefits
            
            departments[dept]["employee_count"] += 1
            departments[dept]["total_annual_cost"] += total_annual_cost
            departments[dept]["employees"].append({
                "employee_id": emp["employee_id"],
                "employee_name": emp["employee_name"],
                "hourly_rate": emp["hourly_rate"],
                "annual_cost": total_annual_cost
            })
        
        # Calculate averages
        for dept in departments.values():
            if dept["employee_count"] > 0:
                dept["avg_annual_cost"] = dept["total_annual_cost"] / dept["employee_count"]
                dept["avg_hourly_rate"] = sum(emp["hourly_rate"] for emp in dept["employees"]) / dept["employee_count"]
        
        department_list = list(departments.values())
        department_list.sort(key=lambda x: x["total_annual_cost"], reverse=True)
        
        return ForecastResponse(
            status="success",
            data={"departments": department_list},
            message=f"Retrieved analytics for {len(department_list)} departments"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving department analytics: {str(e)}")

# ========================
# Business Unit Allocation
# ========================

@router.get("/business-units", response_model=ForecastResponse)
async def get_business_unit_analytics():
    """
    Get payroll analytics by business unit allocation
    """
    try:
        # Get all active employees
        employees_response = await get_employees(status="active")
        employees = employees_response.data["employees"]
        
        # Get payroll config
        config_response = await get_payroll_config()
        config = config_response.data["config"]
        
        # Standard business units
        business_units = [
            "Customer-Centric Brands",
            "OEM Work", 
            "Internal Operations",
            "Other Projects"
        ]
        
        # Initialize business unit analytics
        unit_analytics = {}
        for unit in business_units:
            unit_analytics[unit] = {
                "business_unit": unit,
                "total_annual_cost": 0,
                "fte_allocation": 0,
                "employee_count": 0,
                "employees": []
            }
        
        # Calculate allocations
        for emp in employees:
            # Calculate annual cost
            if emp["rate_type"] == "salary":
                gross_pay = emp["hourly_rate"] * 40 * 52
            else:
                gross_pay = emp["hourly_rate"] * emp["weekly_hours"] * 52
            
            # Apply taxes and benefits
            federal_tax = gross_pay * config["federal_tax_rate"]
            state_tax = gross_pay * config["state_tax_rate"]
            social_security = gross_pay * config["social_security_rate"]
            medicare = gross_pay * config["medicare_rate"]
            unemployment = gross_pay * config["unemployment_rate"]
            workers_comp = gross_pay * config["workers_comp_rate"]
            benefits = gross_pay * config["benefits_rate"] if emp["benefits_eligible"] else 0
            
            total_annual_cost = gross_pay + federal_tax + state_tax + social_security + medicare + unemployment + workers_comp + benefits
            
            # Distribute cost by allocations
            allocations = emp.get("allocations", {})
            for unit, percentage in allocations.items():
                if unit in unit_analytics and percentage > 0:
                    allocation_decimal = percentage / 100
                    unit_analytics[unit]["total_annual_cost"] += total_annual_cost * allocation_decimal
                    unit_analytics[unit]["fte_allocation"] += allocation_decimal
                    
                    # Add employee if they have allocation to this unit
                    unit_analytics[unit]["employees"].append({
                        "employee_id": emp["employee_id"],
                        "employee_name": emp["employee_name"],
                        "department": emp["department"],
                        "allocation_percentage": percentage,
                        "allocated_cost": total_annual_cost * allocation_decimal
                    })
        
        # Count unique employees per unit
        for unit in unit_analytics.values():
            unit["employee_count"] = len(unit["employees"])
        
        unit_list = list(unit_analytics.values())
        unit_list.sort(key=lambda x: x["total_annual_cost"], reverse=True)
        
        return ForecastResponse(
            status="success",
            data={"business_units": unit_list},
            message=f"Retrieved analytics for {len(unit_list)} business units"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving business unit analytics: {str(e)}")

@router.put("/employees/{employee_id}/allocations", response_model=ForecastResponse)
async def update_employee_allocations(employee_id: str, allocations: Dict[str, float]):
    """
    Update business unit allocations for an employee
    """
    try:
        # Validate allocations sum to 100%
        total_allocation = sum(allocations.values())
        if abs(total_allocation - 100) > 0.01:
            raise HTTPException(
                status_code=400, 
                detail=f"Allocations must sum to 100%, got {total_allocation}%"
            )
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Check if employee exists
        cursor.execute("SELECT employee_id FROM payroll WHERE employee_id = ?", (employee_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Employee not found")
        
        # Update allocations
        allocations_json = json.dumps(allocations)
        cursor.execute(
            "UPDATE payroll SET allocations = ? WHERE employee_id = ?",
            (allocations_json, employee_id)
        )
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"employee_id": employee_id, "allocations": allocations},
            message="Employee allocations updated successfully"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating employee allocations: {str(e)}")

# ========================
# Bulk Operations
# ========================

@router.post("/bulk-update", response_model=ForecastResponse)
async def bulk_update_employees(updates: List[Dict[str, Any]]):
    """
    Bulk update multiple employees
    """
    try:
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        updated_count = 0
        errors = []
        
        for update in updates:
            try:
                employee_id = update.get("employee_id")
                if not employee_id:
                    errors.append("Missing employee_id in update")
                    continue
                
                # Build update query dynamically
                set_clauses = []
                params = []
                
                for field, value in update.items():
                    if field == "employee_id":
                        continue
                    if field == "allocations" and isinstance(value, dict):
                        value = json.dumps(value)
                    set_clauses.append(f"{field} = ?")
                    params.append(value)
                
                if set_clauses:
                    params.append(employee_id)
                    query = f"UPDATE payroll SET {', '.join(set_clauses)} WHERE employee_id = ?"
                    cursor.execute(query, params)
                    updated_count += 1
                
            except Exception as e:
                errors.append(f"Error updating {employee_id}: {str(e)}")
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"updated_count": updated_count, "errors": errors},
            message=f"Bulk updated {updated_count} employees"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error in bulk update: {str(e)}")

# ========================
# Reporting
# ========================

@router.get("/reports/summary", response_model=ForecastResponse)
async def get_payroll_summary():
    """
    Get comprehensive payroll summary report
    """
    try:
        # Get various analytics
        employees_response = await get_employees(status="active")
        dept_response = await get_department_analytics()
        bu_response = await get_business_unit_analytics()
        forecast_response = await get_payroll_forecast(periods=1)
        
        employees = employees_response.data["employees"]
        departments = dept_response.data["departments"]
        business_units = bu_response.data["business_units"]
        current_period = forecast_response.data["forecast"][0] if forecast_response.data["forecast"] else {}
        
        # Calculate summary metrics
        total_employees = len(employees)
        total_annual_cost = sum(dept["total_annual_cost"] for dept in departments)
        avg_employee_cost = total_annual_cost / total_employees if total_employees > 0 else 0
        
        summary = {
            "total_employees": total_employees,
            "total_annual_cost": total_annual_cost,
            "avg_employee_cost": avg_employee_cost,
            "current_period_cost": current_period.get("total_cost", 0),
            "department_count": len(departments),
            "departments": departments,
            "business_units": business_units,
            "top_department": max(departments, key=lambda x: x["total_annual_cost"])["department"] if departments else None,
            "top_business_unit": max(business_units, key=lambda x: x["total_annual_cost"])["business_unit"] if business_units else None
        }
        
        return ForecastResponse(
            status="success",
            data={"summary": summary},
            message="Payroll summary report generated successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating payroll summary: {str(e)}")