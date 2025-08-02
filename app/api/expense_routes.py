from fastapi import APIRouter, HTTPException, Query
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta, date
import uuid
import json
import calendar

from db import get_forecast_data
from db.models import (
    ExpenseCategory, ExpenseCategoryCreate,
    Expense, ExpenseCreate, ExpenseUpdate,
    ExpenseAllocation, ExpenseAllocationCreate,
    ExpenseForecast, ExpenseWithDetails, ExpenseReportSummary,
    ForecastResponse
)
from db.database import db_manager

router = APIRouter(prefix="/expenses", tags=["expenses"])

# ========================
# Expense Category Management
# ========================

@router.get("/categories", response_model=ForecastResponse)
async def get_expense_categories(
    category_type: Optional[str] = Query(None, description="Filter by category type"),
    parent_category_id: Optional[str] = Query(None, description="Filter by parent category")
):
    """
    Get all expense categories with optional filtering
    """
    try:
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Base query
        query = """
            SELECT category_id, category_name, category_type, parent_category_id, 
                   account_code, description
            FROM expense_categories
        """
        
        conditions = []
        params = []
        
        # Add filters
        if category_type:
            conditions.append("category_type = ?")
            params.append(category_type)
            
        if parent_category_id:
            conditions.append("parent_category_id = ?")
            params.append(parent_category_id)
        
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
            
        query += " ORDER BY category_type, category_name"
        
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        categories = []
        for row in results:
            categories.append({
                'category_id': row[0],
                'category_name': row[1],
                'category_type': row[2],
                'parent_category_id': row[3],
                'account_code': row[4],
                'description': row[5]
            })
        
        return ForecastResponse(
            status="success",
            data=categories,
            message=f"Retrieved {len(categories)} expense categories"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve expense categories: {str(e)}")
    finally:
        db_manager.close_connection(conn)

@router.post("/categories", response_model=ForecastResponse)
async def create_expense_category(category: ExpenseCategoryCreate):
    """
    Create a new expense category
    """
    try:
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Generate category ID
        category_id = f"CAT-{str(uuid.uuid4())[:8].upper()}"
        
        cursor.execute("""
            INSERT INTO expense_categories 
            (category_id, category_name, category_type, parent_category_id, account_code, description)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            category_id, category.category_name, category.category_type,
            category.parent_category_id, category.account_code, category.description
        ))
        
        conn.commit()
        
        return ForecastResponse(
            status="success",
            data={"category_id": category_id},
            message=f"Expense category '{category.category_name}' created successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create expense category: {str(e)}")
    finally:
        db_manager.close_connection(conn)

# ========================
# Expense Management
# ========================

@router.get("/", response_model=ForecastResponse)
async def get_expenses(
    category_id: Optional[str] = Query(None, description="Filter by category"),
    frequency: Optional[str] = Query(None, description="Filter by frequency"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    department: Optional[str] = Query(None, description="Filter by department"),
    vendor: Optional[str] = Query(None, description="Filter by vendor")
):
    """
    Get all expenses with optional filtering and category details
    """
    try:
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Query with JOIN to get category details
        query = """
            SELECT e.expense_id, e.expense_name, e.category_id, c.category_name, c.category_type,
                   e.amount, e.frequency, e.start_date, e.end_date, e.vendor, e.description,
                   e.payment_method, e.approval_required, e.approved_by, e.approval_date,
                   e.expense_allocation, e.amortization_months, e.department, e.cost_center,
                   e.is_active, e.created_date, e.updated_date
            FROM expenses e
            JOIN expense_categories c ON e.category_id = c.category_id
        """
        
        conditions = []
        params = []
        
        # Add filters
        if category_id:
            conditions.append("e.category_id = ?")
            params.append(category_id)
            
        if frequency:
            conditions.append("e.frequency = ?")
            params.append(frequency)
            
        if is_active is not None:
            conditions.append("e.is_active = ?")
            params.append(is_active)
            
        if department:
            conditions.append("e.department = ?")
            params.append(department)
            
        if vendor:
            conditions.append("e.vendor LIKE ?")
            params.append(f"%{vendor}%")
        
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
            
        query += " ORDER BY e.expense_name"
        
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        expenses = []
        for row in results:
            # Calculate next payment info
            next_payment_date, next_payment_amount = calculate_next_payment(
                row[7], row[6], row[5], row[8]  # start_date, frequency, amount, end_date
            )
            
            # Calculate annual cost
            annual_cost = calculate_annual_cost(row[5], row[6])  # amount, frequency
            
            expense = ExpenseWithDetails(
                expense_id=row[0],
                expense_name=row[1],
                category_id=row[2],
                category_name=row[3],
                category_type=row[4],
                amount=row[5],
                frequency=row[6],
                start_date=row[7],
                end_date=row[8],
                vendor=row[9],
                description=row[10],
                payment_method=row[11],
                approval_required=bool(row[12]),
                approved_by=row[13],
                approval_date=row[14],
                expense_allocation=row[15],
                amortization_months=row[16],
                department=row[17],
                cost_center=row[18],
                is_active=bool(row[19]),
                created_date=row[20],
                updated_date=row[21],
                next_payment_date=next_payment_date,
                next_payment_amount=next_payment_amount,
                total_annual_cost=annual_cost
            )
            expenses.append(expense.dict())
        
        return ForecastResponse(
            status="success",
            data=expenses,
            message=f"Retrieved {len(expenses)} expenses"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve expenses: {str(e)}")
    finally:
        db_manager.close_connection(conn)

@router.post("/", response_model=ForecastResponse)
async def create_expense(expense: ExpenseCreate):
    """
    Create a new expense and generate allocations
    """
    try:
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Generate expense ID
        expense_id = f"EXP-{str(uuid.uuid4())[:8].upper()}"
        current_time = datetime.now().isoformat()
        
        # Insert expense
        cursor.execute("""
            INSERT INTO expenses 
            (expense_id, expense_name, category_id, amount, frequency, start_date, end_date,
             vendor, description, payment_method, approval_required, approved_by, approval_date,
             expense_allocation, amortization_months, department, cost_center, is_active,
             created_date, updated_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            expense_id, expense.expense_name, expense.category_id, expense.amount,
            expense.frequency, expense.start_date, expense.end_date, expense.vendor,
            expense.description, expense.payment_method, expense.approval_required,
            expense.approved_by, expense.approval_date, expense.expense_allocation,
            expense.amortization_months, expense.department, expense.cost_center,
            expense.is_active, current_time, current_time
        ))
        
        # Generate allocations
        allocations = generate_expense_allocations(expense_id, expense)
        
        for allocation in allocations:
            allocation_id = f"ALLOC-{str(uuid.uuid4())[:8].upper()}"
            cursor.execute("""
                INSERT INTO expense_allocations
                (allocation_id, expense_id, period, allocated_amount, allocation_type, payment_status)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                allocation_id, expense_id, allocation['period'], allocation['amount'],
                allocation['type'], 'pending'
            ))
        
        conn.commit()
        
        return ForecastResponse(
            status="success",
            data={"expense_id": expense_id, "allocations_created": len(allocations)},
            message=f"Expense '{expense.expense_name}' created successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create expense: {str(e)}")
    finally:
        db_manager.close_connection(conn)

@router.put("/{expense_id}", response_model=ForecastResponse)
async def update_expense(expense_id: str, expense_update: ExpenseUpdate):
    """
    Update an existing expense and regenerate allocations if necessary
    """
    try:
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Build update query dynamically
        updates = []
        params = []
        
        for field, value in expense_update.dict(exclude_unset=True).items():
            if value is not None:
                updates.append(f"{field} = ?")
                params.append(value)
        
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        # Add updated_date
        updates.append("updated_date = ?")
        params.append(datetime.now().isoformat())
        params.append(expense_id)
        
        query = f"UPDATE expenses SET {', '.join(updates)} WHERE expense_id = ?"
        cursor.execute(query, params)
        
        # If critical fields changed, regenerate allocations
        critical_fields = ['amount', 'frequency', 'start_date', 'end_date', 'expense_allocation', 'amortization_months']
        if any(field in expense_update.dict(exclude_unset=True) for field in critical_fields):
            # Delete existing allocations
            cursor.execute("DELETE FROM expense_allocations WHERE expense_id = ?", (expense_id,))
            
            # Get updated expense data
            cursor.execute("""
                SELECT expense_name, category_id, amount, frequency, start_date, end_date,
                       expense_allocation, amortization_months
                FROM expenses WHERE expense_id = ?
            """, (expense_id,))
            row = cursor.fetchone()
            
            if row:
                # Create expense object for allocation generation
                expense_data = ExpenseCreate(
                    expense_name=row[0],
                    category_id=row[1],
                    amount=row[2],
                    frequency=row[3],
                    start_date=row[4],
                    end_date=row[5],
                    expense_allocation=row[6],
                    amortization_months=row[7]
                )
                
                # Generate new allocations
                allocations = generate_expense_allocations(expense_id, expense_data)
                
                for allocation in allocations:
                    allocation_id = f"ALLOC-{str(uuid.uuid4())[:8].upper()}"
                    cursor.execute("""
                        INSERT INTO expense_allocations
                        (allocation_id, expense_id, period, allocated_amount, allocation_type, payment_status)
                        VALUES (?, ?, ?, ?, ?, ?)
                    """, (
                        allocation_id, expense_id, allocation['period'], allocation['amount'],
                        allocation['type'], 'pending'
                    ))
        
        conn.commit()
        
        return ForecastResponse(
            status="success",
            data={"expense_id": expense_id},
            message="Expense updated successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update expense: {str(e)}")
    finally:
        db_manager.close_connection(conn)

@router.delete("/{expense_id}", response_model=ForecastResponse)
async def delete_expense(expense_id: str):
    """
    Delete an expense and its allocations
    """
    try:
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Delete allocations first (foreign key constraint)
        cursor.execute("DELETE FROM expense_allocations WHERE expense_id = ?", (expense_id,))
        
        # Delete expense
        cursor.execute("DELETE FROM expenses WHERE expense_id = ?", (expense_id,))
        
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Expense not found")
        
        conn.commit()
        
        return ForecastResponse(
            status="success",
            data={"expense_id": expense_id},
            message="Expense deleted successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete expense: {str(e)}")
    finally:
        db_manager.close_connection(conn)

# ========================
# Expense Allocations
# ========================

@router.get("/allocations", response_model=ForecastResponse)
async def get_expense_allocations(
    expense_id: Optional[str] = Query(None, description="Filter by expense"),
    period: Optional[str] = Query(None, description="Filter by period (YYYY-MM)"),
    payment_status: Optional[str] = Query(None, description="Filter by payment status")
):
    """
    Get expense allocations with filtering
    """
    try:
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        query = """
            SELECT a.allocation_id, a.expense_id, e.expense_name, a.period, 
                   a.allocated_amount, a.allocation_type, a.payment_status,
                   a.payment_date, a.actual_amount, a.notes,
                   c.category_name, c.category_type
            FROM expense_allocations a
            JOIN expenses e ON a.expense_id = e.expense_id
            JOIN expense_categories c ON e.category_id = c.category_id
        """
        
        conditions = []
        params = []
        
        if expense_id:
            conditions.append("a.expense_id = ?")
            params.append(expense_id)
            
        if period:
            conditions.append("a.period = ?")
            params.append(period)
            
        if payment_status:
            conditions.append("a.payment_status = ?")
            params.append(payment_status)
        
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
            
        query += " ORDER BY a.period, e.expense_name"
        
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        allocations = []
        for row in results:
            allocations.append({
                'allocation_id': row[0],
                'expense_id': row[1],
                'expense_name': row[2],
                'period': row[3],
                'allocated_amount': row[4],
                'allocation_type': row[5],
                'payment_status': row[6],
                'payment_date': row[7],
                'actual_amount': row[8],
                'notes': row[9],
                'category_name': row[10],
                'category_type': row[11]
            })
        
        return ForecastResponse(
            status="success",
            data=allocations,
            message=f"Retrieved {len(allocations)} expense allocations"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve expense allocations: {str(e)}")
    finally:
        db_manager.close_connection(conn)

# ========================
# Expense Reporting
# ========================

@router.get("/forecast", response_model=ForecastResponse)
async def get_expense_forecast(
    start_period: str = Query(..., description="Start period (YYYY-MM)"),
    end_period: str = Query(..., description="End period (YYYY-MM)"),
    category_type: Optional[str] = Query(None, description="Filter by category type")
):
    """
    Get expense forecast for a period range
    """
    try:
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        query = """
            SELECT a.period, c.category_id, c.category_name, c.category_type,
                   SUM(CASE WHEN a.allocation_type = 'scheduled' THEN a.allocated_amount ELSE 0 END) as total_scheduled,
                   SUM(CASE WHEN a.allocation_type = 'amortized' THEN a.allocated_amount ELSE 0 END) as total_amortized,
                   SUM(CASE WHEN a.allocation_type = 'one_time' THEN a.allocated_amount ELSE 0 END) as total_one_time,
                   SUM(a.allocated_amount) as total_amount,
                   COUNT(DISTINCT a.expense_id) as expense_count
            FROM expense_allocations a
            JOIN expenses e ON a.expense_id = e.expense_id
            JOIN expense_categories c ON e.category_id = c.category_id
            WHERE a.period >= ? AND a.period <= ?
        """
        
        params = [start_period, end_period]
        
        if category_type:
            query += " AND c.category_type = ?"
            params.append(category_type)
            
        query += """
            GROUP BY a.period, c.category_id, c.category_name, c.category_type
            ORDER BY a.period, c.category_type, c.category_name
        """
        
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        forecasts = []
        for row in results:
            forecasts.append(ExpenseForecast(
                period=row[0],
                category_id=row[1],
                category_name=row[2],
                category_type=row[3],
                total_scheduled=row[4],
                total_amortized=row[5],
                total_one_time=row[6],
                total_amount=row[7],
                expense_count=row[8]
            ).dict())
        
        return ForecastResponse(
            status="success",
            data={"forecasts": forecasts},
            message=f"Retrieved expense forecast for {start_period} to {end_period}"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve expense forecast: {str(e)}")
    finally:
        db_manager.close_connection(conn)

@router.get("/report", response_model=ForecastResponse)
async def get_expense_report():
    """
    Get comprehensive expense report with summary statistics
    """
    try:
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Calculate totals by frequency
        cursor.execute("""
            SELECT 
                SUM(CASE WHEN frequency = 'monthly' THEN amount * 12 ELSE 0 END) as monthly_annual,
                SUM(CASE WHEN frequency = 'quarterly' THEN amount * 4 ELSE 0 END) as quarterly_annual,
                SUM(CASE WHEN frequency = 'annually' THEN amount ELSE 0 END) as annual_total,
                SUM(CASE WHEN frequency = 'one_time' THEN amount ELSE 0 END) as one_time_total
            FROM expenses WHERE is_active = 1
        """)
        totals = cursor.fetchone()
        
        # Calculate totals by category type
        cursor.execute("""
            SELECT c.category_type, SUM(
                CASE 
                    WHEN e.frequency = 'monthly' THEN e.amount * 12
                    WHEN e.frequency = 'quarterly' THEN e.amount * 4
                    WHEN e.frequency = 'biannually' THEN e.amount * 2
                    WHEN e.frequency = 'annually' THEN e.amount
                    WHEN e.frequency = 'weekly' THEN e.amount * 52
                    ELSE e.amount
                END
            ) as annual_total
            FROM expenses e
            JOIN expense_categories c ON e.category_id = c.category_id
            WHERE e.is_active = 1
            GROUP BY c.category_type
        """)
        category_totals = {row[0]: row[1] for row in cursor.fetchall()}
        
        # Get upcoming payments (next 30 days)
        today = date.today()
        next_month = today + timedelta(days=30)
        current_period = today.strftime("%Y-%m")
        next_period = next_month.strftime("%Y-%m")
        
        cursor.execute("""
            SELECT e.expense_name, a.allocated_amount, a.period, c.category_name
            FROM expense_allocations a
            JOIN expenses e ON a.expense_id = e.expense_id
            JOIN expense_categories c ON e.category_id = c.category_id
            WHERE a.period IN (?, ?) AND a.payment_status = 'pending'
            ORDER BY a.period, e.expense_name
        """, (current_period, next_period))
        upcoming_payments = [
            {
                'expense_name': row[0],
                'amount': row[1],
                'period': row[2],
                'category_name': row[3]
            } for row in cursor.fetchall()
        ]
        
        # Get overdue payments
        cursor.execute("""
            SELECT e.expense_name, a.allocated_amount, a.period, c.category_name
            FROM expense_allocations a
            JOIN expenses e ON a.expense_id = e.expense_id
            JOIN expense_categories c ON e.category_id = c.category_id
            WHERE a.period < ? AND a.payment_status = 'pending'
            ORDER BY a.period, e.expense_name
        """, (current_period,))
        overdue_payments = [
            {
                'expense_name': row[0],
                'amount': row[1],
                'period': row[2],
                'category_name': row[3]
            } for row in cursor.fetchall()
        ]
        
        # Get top categories by total annual cost
        cursor.execute("""
            SELECT c.category_name, c.category_type, SUM(
                CASE 
                    WHEN e.frequency = 'monthly' THEN e.amount * 12
                    WHEN e.frequency = 'quarterly' THEN e.amount * 4
                    WHEN e.frequency = 'biannually' THEN e.amount * 2
                    WHEN e.frequency = 'annually' THEN e.amount
                    WHEN e.frequency = 'weekly' THEN e.amount * 52
                    ELSE e.amount
                END
            ) as annual_total,
            COUNT(e.expense_id) as expense_count
            FROM expenses e
            JOIN expense_categories c ON e.category_id = c.category_id
            WHERE e.is_active = 1
            GROUP BY c.category_id, c.category_name, c.category_type
            ORDER BY annual_total DESC
            LIMIT 10
        """)
        top_categories = [
            {
                'category_name': row[0],
                'category_type': row[1],
                'annual_total': row[2],
                'expense_count': row[3]
            } for row in cursor.fetchall()
        ]
        
        # Get monthly forecast for next 12 months
        monthly_forecasts = []
        for i in range(12):
            forecast_date = today + timedelta(days=30*i)
            period = forecast_date.strftime("%Y-%m")
            
            cursor.execute("""
                SELECT c.category_id, c.category_name, c.category_type,
                       SUM(CASE WHEN a.allocation_type = 'scheduled' THEN a.allocated_amount ELSE 0 END) as total_scheduled,
                       SUM(CASE WHEN a.allocation_type = 'amortized' THEN a.allocated_amount ELSE 0 END) as total_amortized,
                       SUM(CASE WHEN a.allocation_type = 'one_time' THEN a.allocated_amount ELSE 0 END) as total_one_time,
                       SUM(a.allocated_amount) as total_amount,
                       COUNT(DISTINCT a.expense_id) as expense_count
                FROM expense_allocations a
                JOIN expenses e ON a.expense_id = e.expense_id
                JOIN expense_categories c ON e.category_id = c.category_id
                WHERE a.period = ?
                GROUP BY c.category_id, c.category_name, c.category_type
            """, (period,))
            
            for row in cursor.fetchall():
                monthly_forecasts.append(ExpenseForecast(
                    period=period,
                    category_id=row[0],
                    category_name=row[1],
                    category_type=row[2],
                    total_scheduled=row[3],
                    total_amortized=row[4],
                    total_one_time=row[5],
                    total_amount=row[6],
                    expense_count=row[7]
                ).dict())
        
        report = ExpenseReportSummary(
            total_monthly=totals[0] or 0,
            total_quarterly=totals[1] or 0,
            total_annual=totals[2] or 0,
            total_one_time=totals[3] or 0,
            factory_overhead_total=category_totals.get('factory_overhead', 0),
            admin_expense_total=category_totals.get('admin_expense', 0),
            cogs_total=category_totals.get('cogs', 0),
            upcoming_payments=upcoming_payments,
            overdue_payments=overdue_payments,
            top_categories=top_categories,
            monthly_forecast=monthly_forecasts
        )
        
        return ForecastResponse(
            status="success",
            data=report.dict(),
            message="Expense report generated successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate expense report: {str(e)}")
    finally:
        db_manager.close_connection(conn)

# ========================
# Helper Functions
# ========================

def calculate_next_payment(start_date: str, frequency: str, amount: float, end_date: str = None) -> tuple:
    """Calculate the next payment date and amount for an expense"""
    try:
        start = datetime.strptime(start_date, "%Y-%m-%d").date()
        today = date.today()
        
        if end_date:
            end = datetime.strptime(end_date, "%Y-%m-%d").date()
            if today > end:
                return None, None
        
        if frequency == 'one_time':
            if today <= start:
                return start_date, amount
            else:
                return None, None
        
        # Calculate next occurrence
        current = start
        while current <= today:
            if frequency == 'weekly':
                current += timedelta(weeks=1)
            elif frequency == 'monthly':
                if current.month == 12:
                    current = current.replace(year=current.year + 1, month=1)
                else:
                    current = current.replace(month=current.month + 1)
            elif frequency == 'quarterly':
                month = current.month + 3
                year = current.year
                if month > 12:
                    month -= 12
                    year += 1
                current = current.replace(year=year, month=month)
            elif frequency == 'biannually':
                month = current.month + 6
                year = current.year
                if month > 12:
                    month -= 12
                    year += 1
                current = current.replace(year=year, month=month)
            elif frequency == 'annually':
                current = current.replace(year=current.year + 1)
        
        return current.strftime("%Y-%m-%d"), amount
        
    except Exception as e:
        return None, None

def calculate_annual_cost(amount: float, frequency: str) -> float:
    """Calculate the annual cost of an expense based on its frequency"""
    multipliers = {
        'weekly': 52,
        'monthly': 12,
        'quarterly': 4,
        'biannually': 2,
        'annually': 1,
        'one_time': 0  # Not annualized
    }
    return amount * multipliers.get(frequency, 0)

def generate_expense_allocations(expense_id: str, expense: ExpenseCreate) -> List[Dict[str, Any]]:
    """Generate expense allocations based on frequency and allocation method"""
    allocations = []
    start_date = datetime.strptime(expense.start_date, "%Y-%m-%d").date()
    
    if expense.end_date:
        end_date = datetime.strptime(expense.end_date, "%Y-%m-%d").date()
    else:
        # Default to 2 years from start if no end date
        end_date = start_date.replace(year=start_date.year + 2)
    
    if expense.frequency == 'one_time':
        period = start_date.strftime("%Y-%m")
        if expense.expense_allocation == 'amortized' and expense.amortization_months:
            # Spread over multiple months
            monthly_amount = expense.amount / expense.amortization_months
            current_date = start_date
            for _ in range(expense.amortization_months):
                allocations.append({
                    'period': current_date.strftime("%Y-%m"),
                    'amount': monthly_amount,
                    'type': 'amortized'
                })
                # Move to next month
                if current_date.month == 12:
                    current_date = current_date.replace(year=current_date.year + 1, month=1)
                else:
                    current_date = current_date.replace(month=current_date.month + 1)
        else:
            # All at once
            allocations.append({
                'period': period,
                'amount': expense.amount,
                'type': 'one_time'
            })
    else:
        # Recurring expense
        current_date = start_date
        while current_date <= end_date:
            if expense.expense_allocation == 'amortized' and expense.amortization_months:
                # For recurring expenses, amortize each payment
                periods_to_amortize = min(expense.amortization_months, 
                                        (end_date.year - current_date.year) * 12 + end_date.month - current_date.month + 1)
                monthly_amount = expense.amount / periods_to_amortize
                
                amortize_date = current_date
                for _ in range(periods_to_amortize):
                    allocations.append({
                        'period': amortize_date.strftime("%Y-%m"),
                        'amount': monthly_amount,
                        'type': 'amortized'
                    })
                    # Move to next month for amortization
                    if amortize_date.month == 12:
                        amortize_date = amortize_date.replace(year=amortize_date.year + 1, month=1)
                    else:
                        amortize_date = amortize_date.replace(month=amortize_date.month + 1)
            else:
                # Immediate allocation
                allocations.append({
                    'period': current_date.strftime("%Y-%m"),
                    'amount': expense.amount,
                    'type': 'scheduled'
                })
            
            # Move to next payment date
            if expense.frequency == 'weekly':
                current_date += timedelta(weeks=1)
            elif expense.frequency == 'monthly':
                if current_date.month == 12:
                    current_date = current_date.replace(year=current_date.year + 1, month=1)
                else:
                    current_date = current_date.replace(month=current_date.month + 1)
            elif expense.frequency == 'quarterly':
                month = current_date.month + 3
                year = current_date.year
                if month > 12:
                    month -= 12
                    year += 1
                current_date = current_date.replace(year=year, month=month)
            elif expense.frequency == 'biannually':
                month = current_date.month + 6
                year = current_date.year
                if month > 12:
                    month -= 12
                    year += 1
                current_date = current_date.replace(year=year, month=month)
            elif expense.frequency == 'annually':
                current_date = current_date.replace(year=current_date.year + 1)
    
    return allocations