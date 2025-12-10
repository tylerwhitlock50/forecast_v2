"""
Loan Management API Routes
Provides comprehensive loan management, amortization schedule calculation, and cash flow forecasting
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List
from datetime import datetime, timedelta
import uuid
import math
from decimal import Decimal, ROUND_HALF_UP

from db.models import (
    ForecastResponse, Loan, LoanCreate, LoanUpdate, LoanPayment, LoanPaymentCreate,
    AmortizationSchedule, LoanWithDetails, LoanSummary, CashFlowProjection
)

router = APIRouter(prefix="/loans", tags=["loans"])

def calculate_loan_payment(principal: float, annual_rate: float, term_months: int, payment_type: str = "amortizing") -> float:
    """Calculate monthly loan payment amount"""
    if payment_type == "interest_only":
        return principal * (annual_rate / 12)
    
    # Amortizing loan payment calculation
    if annual_rate == 0:
        return principal / term_months
    
    monthly_rate = annual_rate / 12
    payment = principal * (monthly_rate * (1 + monthly_rate) ** term_months) / ((1 + monthly_rate) ** term_months - 1)
    
    return round(payment, 2)

def generate_amortization_schedule(
    loan_id: str,
    principal: float,
    annual_rate: float,
    term_months: int,
    start_date: str,
    payment_type: str = "amortizing",
    balloon_payment: Optional[float] = None,
    balloon_date: Optional[str] = None,
    payment_frequency: str = "monthly"
) -> List[LoanPayment]:
    """Generate complete amortization schedule for a loan"""
    
    payments = []
    remaining_balance = principal
    start_dt = datetime.strptime(start_date, '%Y-%m-%d')
    
    # Calculate payment frequency multiplier
    frequency_months = {"monthly": 1, "quarterly": 3, "annually": 12}
    freq_months = frequency_months.get(payment_frequency, 1)
    
    # Adjust calculations for payment frequency
    periods_per_year = 12 / freq_months
    period_rate = annual_rate / periods_per_year
    total_periods = term_months // freq_months
    
    if payment_type == "interest_only":
        # Interest-only payments
        interest_payment = principal * period_rate
        principal_payment = 0
        
        for payment_num in range(1, total_periods + 1):
            payment_date = start_dt + timedelta(days=30.44 * freq_months * payment_num)  # Average month length
            
            # Check if this is the balloon payment date
            is_balloon = False
            if balloon_date and payment_date >= datetime.strptime(balloon_date, '%Y-%m-%d'):
                principal_payment = remaining_balance
                is_balloon = True
            
            payment_amount = interest_payment + principal_payment
            remaining_balance -= principal_payment
            
            payment = LoanPayment(
                payment_id=f"{loan_id}-{payment_num:03d}",
                loan_id=loan_id,
                payment_number=payment_num,
                payment_date=payment_date.strftime('%Y-%m-%d'),
                payment_amount=round(payment_amount, 2),
                principal_payment=round(principal_payment, 2),
                interest_payment=round(interest_payment, 2),
                remaining_balance=round(remaining_balance, 2),
                payment_status="scheduled"
            )
            payments.append(payment)
            
            if is_balloon:
                break
            
            # Reset principal payment for next iteration
            principal_payment = 0
    
    else:
        # Amortizing loan
        payment_amount = calculate_loan_payment(principal, annual_rate, term_months, payment_type)
        
        # Adjust payment for frequency
        if payment_frequency != "monthly":
            payment_amount = payment_amount * freq_months
        
        for payment_num in range(1, total_periods + 1):
            payment_date = start_dt + timedelta(days=30.44 * freq_months * payment_num)
            
            interest_payment = remaining_balance * period_rate
            principal_payment = payment_amount - interest_payment
            
            # Ensure we don't pay more principal than remaining balance
            if principal_payment > remaining_balance:
                principal_payment = remaining_balance
                payment_amount = principal_payment + interest_payment
            
            remaining_balance -= principal_payment
            
            payment = LoanPayment(
                payment_id=f"{loan_id}-{payment_num:03d}",
                loan_id=loan_id,
                payment_number=payment_num,
                payment_date=payment_date.strftime('%Y-%m-%d'),
                payment_amount=round(payment_amount, 2),
                principal_payment=round(principal_payment, 2),
                interest_payment=round(interest_payment, 2),
                remaining_balance=round(remaining_balance, 2),
                payment_status="scheduled"
            )
            payments.append(payment)
            
            if remaining_balance <= 0.01:  # Account for rounding
                break
    
    return payments

@router.post("/", response_model=ForecastResponse)
async def create_loan(loan_data: LoanCreate):
    """Create a new loan and generate its amortization schedule"""
    try:
        from db.database import db_manager
        
        # Generate loan ID
        loan_id = f"LOAN-{str(uuid.uuid4())[:8].upper()}"
        
        # Calculate payment amount
        monthly_payment = calculate_loan_payment(
            loan_data.principal_amount,
            loan_data.interest_rate / 100,  # Convert percentage to decimal
            loan_data.loan_term_months,
            loan_data.payment_type
        )
        
        # Calculate next payment date
        start_date = datetime.strptime(loan_data.start_date, '%Y-%m-%d')
        next_payment_date = start_date + timedelta(days=30)  # First payment typically 30 days after start
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Insert loan
        cursor.execute("""
            INSERT INTO loans (
                loan_id, loan_name, lender, loan_type, principal_amount, interest_rate,
                loan_term_months, start_date, payment_type, payment_frequency,
                balloon_payment, balloon_date, description, collateral_description,
                guarantor, loan_officer, account_number, is_active, current_balance,
                next_payment_date, monthly_payment_amount
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            loan_id, loan_data.loan_name, loan_data.lender, loan_data.loan_type,
            loan_data.principal_amount, loan_data.interest_rate, loan_data.loan_term_months,
            loan_data.start_date, loan_data.payment_type, loan_data.payment_frequency,
            loan_data.balloon_payment, loan_data.balloon_date, loan_data.description,
            loan_data.collateral_description, loan_data.guarantor, loan_data.loan_officer,
            loan_data.account_number, loan_data.is_active, loan_data.principal_amount,
            next_payment_date.strftime('%Y-%m-%d'), monthly_payment
        ))
        
        # Generate and insert amortization schedule
        payments = generate_amortization_schedule(
            loan_id,
            loan_data.principal_amount,
            loan_data.interest_rate / 100,
            loan_data.loan_term_months,
            loan_data.start_date,
            loan_data.payment_type,
            loan_data.balloon_payment,
            loan_data.balloon_date,
            loan_data.payment_frequency
        )
        
        for payment in payments:
            cursor.execute("""
                INSERT INTO loan_payments (
                    payment_id, loan_id, payment_number, payment_date, payment_amount,
                    principal_payment, interest_payment, remaining_balance, payment_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                payment.payment_id, payment.loan_id, payment.payment_number,
                payment.payment_date, payment.payment_amount, payment.principal_payment,
                payment.interest_payment, payment.remaining_balance, payment.payment_status
            ))
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"loan_id": loan_id, "payments_generated": len(payments)},
            message=f"Loan '{loan_data.loan_name}' created successfully with {len(payments)} scheduled payments"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating loan: {str(e)}")

@router.get("/", response_model=ForecastResponse)
async def get_loans(active_only: bool = Query(True)):
    """Get all loans with summary information"""
    try:
        from db.database import db_manager
        
        print(f"Getting loans with active_only={active_only}")
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # First, let's check if the loans table exists and has data
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='loans'")
        if not cursor.fetchone():
            print("Loans table does not exist!")
            return ForecastResponse(
                status="success",
                data={"loans": []},
                message="No loans table found"
            )
        
        # Check if there's any data in the loans table
        cursor.execute("SELECT COUNT(*) FROM loans")
        loan_count = cursor.fetchone()[0]
        print(f"Found {loan_count} loans in database")
        
        if loan_count == 0:
            return ForecastResponse(
                status="success",
                data={"loans": []},
                message="No loans found in database"
            )
        
        # Build query
        query = """
            SELECT l.*, 
                   COUNT(lp.payment_id) as total_payments,
                   COUNT(CASE WHEN lp.payment_status = 'paid' THEN 1 END) as payments_made,
                   SUM(CASE WHEN lp.payment_status = 'paid' THEN lp.interest_payment ELSE 0 END) as total_interest_paid,
                   SUM(CASE WHEN lp.payment_status != 'paid' THEN lp.interest_payment ELSE 0 END) as total_interest_remaining
            FROM loans l
            LEFT JOIN loan_payments lp ON l.loan_id = lp.loan_id
        """
        
        params = []
        if active_only:
            query += " WHERE l.is_active = 1"
        
        query += " GROUP BY l.loan_id ORDER BY l.created_date DESC"
        
        print(f"Executing query: {query}")
        cursor.execute(query, params)
        loan_rows = cursor.fetchall()
        
        # Get column names
        columns = [description[0] for description in cursor.description]
        print(f"Columns: {columns}")
        
        loans = []
        for row in loan_rows:
            loan_dict = dict(zip(columns, row))
            print(f"Processing loan: {loan_dict.get('loan_id', 'Unknown')}")
            
            # Calculate payments remaining
            total_payments = loan_dict.get('total_payments', 0)
            payments_made = loan_dict.get('payments_made', 0)
            payments_remaining = total_payments - payments_made
            
            # Normalize nullable DB fields to safe defaults expected by the model/UI
            normalized_payment_type = loan_dict.get('payment_type') or 'amortizing'
            normalized_payment_frequency = loan_dict.get('payment_frequency') or 'monthly'

            # Compute sensible fallbacks for required fields that may be NULL in legacy data
            principal = loan_dict['principal_amount']
            annual_rate_pct = loan_dict['interest_rate']
            term_months = loan_dict['loan_term_months']
            start_date_val = loan_dict['start_date']

            computed_monthly_payment = calculate_loan_payment(
                principal,
                (annual_rate_pct or 0) / 100,
                term_months or 1,
                normalized_payment_type
            )

            current_balance_val = loan_dict.get('current_balance')
            if current_balance_val is None:
                current_balance_val = principal

            monthly_payment_amount_val = loan_dict.get('monthly_payment_amount')
            if monthly_payment_amount_val is None:
                monthly_payment_amount_val = computed_monthly_payment

            next_payment_date_val = loan_dict.get('next_payment_date')
            if not next_payment_date_val and start_date_val:
                next_payment_date_val = (datetime.strptime(start_date_val, '%Y-%m-%d') + timedelta(days=30)).strftime('%Y-%m-%d')

            created_date_val = loan_dict.get('created_date') or start_date_val or ''
            updated_date_val = loan_dict.get('updated_date') or created_date_val

            loan_with_details = LoanWithDetails(
                loan_id=loan_dict['loan_id'],
                loan_name=loan_dict['loan_name'],
                lender=loan_dict['lender'],
                loan_type=loan_dict['loan_type'],
                principal_amount=loan_dict['principal_amount'],
                interest_rate=loan_dict['interest_rate'],
                loan_term_months=loan_dict['loan_term_months'],
                start_date=start_date_val,
                payment_type=normalized_payment_type,
                payment_frequency=normalized_payment_frequency,
                balloon_payment=loan_dict.get('balloon_payment'),
                balloon_date=loan_dict.get('balloon_date'),
                description=loan_dict.get('description'),
                collateral_description=loan_dict.get('collateral_description'),
                guarantor=loan_dict.get('guarantor'),
                loan_officer=loan_dict.get('loan_officer'),
                account_number=loan_dict.get('account_number'),
                is_active=bool(loan_dict['is_active']),
                created_date=created_date_val,
                updated_date=updated_date_val,
                current_balance=current_balance_val,
                next_payment_date=next_payment_date_val,
                monthly_payment_amount=monthly_payment_amount_val,
                payments_made=payments_made,
                payments_remaining=payments_remaining,
                total_interest_paid=loan_dict.get('total_interest_paid', 0) or 0,
                total_interest_remaining=loan_dict.get('total_interest_remaining', 0) or 0
            )
            loans.append(loan_with_details.dict())
        
        db_manager.close_connection(conn)
        
        print(f"Successfully retrieved {len(loans)} loans")
        return ForecastResponse(
            status="success",
            data={"loans": loans},
            message=f"Retrieved {len(loans)} loans"
        )
        
    except Exception as e:
        import traceback
        print(f"Error in get_loans: {str(e)}")
        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Error retrieving loans: {str(e)}")

@router.get("/{loan_id}/schedule", response_model=ForecastResponse)
async def get_amortization_schedule(loan_id: str):
    """Get the complete amortization schedule for a loan"""
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Get loan details
        cursor.execute("SELECT * FROM loans WHERE loan_id = ?", (loan_id,))
        loan_row = cursor.fetchone()
        
        if not loan_row:
            raise HTTPException(status_code=404, detail="Loan not found")
        
        # Get loan column names
        cursor.execute("PRAGMA table_info(loans)")
        loan_columns = [col[1] for col in cursor.fetchall()]
        loan_data = dict(zip(loan_columns, loan_row))
        
        # Get payment schedule
        cursor.execute("""
            SELECT * FROM loan_payments 
            WHERE loan_id = ? 
            ORDER BY payment_number
        """, (loan_id,))
        payment_rows = cursor.fetchall()
        
        # Get payment column names
        cursor.execute("PRAGMA table_info(loan_payments)")
        payment_columns = [col[1] for col in cursor.fetchall()]
        
        payments = []
        for row in payment_rows:
            payment_dict = dict(zip(payment_columns, row))
            payment = LoanPayment(**payment_dict)
            payments.append(payment)
        
        # Calculate totals
        total_payments = sum(p.payment_amount for p in payments)
        total_interest = sum(p.interest_payment for p in payments)
        
        schedule = AmortizationSchedule(
            loan_id=loan_id,
            loan_name=loan_data['loan_name'],
            lender=loan_data['lender'],
            payment_schedule=payments,
            total_payments=total_payments,
            total_interest=total_interest,
            loan_summary={
                "principal_amount": loan_data['principal_amount'],
                "interest_rate": loan_data['interest_rate'],
                "loan_term_months": loan_data['loan_term_months'],
                "payment_type": loan_data['payment_type'],
                "total_payments": total_payments,
                "total_interest": total_interest,
                "average_monthly_payment": total_payments / len(payments) if payments else 0
            }
        )
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data=schedule.dict(),
            message=f"Retrieved amortization schedule with {len(payments)} payments"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving amortization schedule: {str(e)}")

@router.get("/summary", response_model=ForecastResponse)
async def get_loan_summary():
    """Get comprehensive loan portfolio summary"""
    try:
        from db.database import db_manager
        
        print("Getting loan summary...")
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Check if loans table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='loans'")
        if not cursor.fetchone():
            print("Loans table does not exist for summary!")
            return ForecastResponse(
                status="success",
                data={
                    "total_loans": 0,
                    "active_loans": 0,
                    "total_principal": 0,
                    "total_current_balance": 0,
                    "total_monthly_payments": 0,
                    "total_annual_payments": 0,
                    "interest_rate_summary": {"average": 0, "minimum": 0, "maximum": 0},
                    "loans_by_type": [],
                    "upcoming_payments": []
                },
                message="No loans table found"
            )
        
        # Get basic loan statistics
        print("Getting basic statistics...")
        cursor.execute("""
            SELECT 
                COUNT(*) as total_loans,
                COUNT(CASE WHEN is_active = 1 THEN 1 END) as active_loans,
                SUM(principal_amount) as total_principal,
                SUM(current_balance) as total_current_balance,
                SUM(monthly_payment_amount) as total_monthly_payments,
                AVG(interest_rate) as avg_interest_rate,
                MIN(interest_rate) as min_interest_rate,
                MAX(interest_rate) as max_interest_rate
            FROM loans
        """)
        stats = cursor.fetchone()
        print(f"Basic stats: {stats}")
        
        # Get loans by type
        print("Getting loans by type...")
        cursor.execute("""
            SELECT loan_type, 
                   COUNT(*) as count,
                   SUM(current_balance) as total_balance,
                   AVG(interest_rate) as avg_rate
            FROM loans 
            WHERE is_active = 1
            GROUP BY loan_type
        """)
        loans_by_type = []
        for row in cursor.fetchall():
            loans_by_type.append({
                "loan_type": row[0],
                "count": row[1],
                "total_balance": row[2],
                "avg_interest_rate": row[3]
            })
        print(f"Loans by type: {loans_by_type}")
        
        # Get upcoming payments (next 30 days)
        print("Getting upcoming payments...")
        cursor.execute("""
            SELECT l.loan_name, l.lender, lp.payment_date, lp.payment_amount, lp.payment_status
            FROM loan_payments lp
            JOIN loans l ON lp.loan_id = l.loan_id
            WHERE lp.payment_date BETWEEN date('now') AND date('now', '+30 days')
              AND lp.payment_status = 'scheduled'
              AND l.is_active = 1
            ORDER BY lp.payment_date
            LIMIT 10
        """)
        upcoming_payments = []
        for row in cursor.fetchall():
            upcoming_payments.append({
                "loan_name": row[0],
                "lender": row[1],
                "payment_date": row[2],
                "payment_amount": row[3],
                "payment_status": row[4]
            })
        print(f"Upcoming payments: {upcoming_payments}")
        
        db_manager.close_connection(conn)
        
        summary = LoanSummary(
            total_loans=stats[0] or 0,
            active_loans=stats[1] or 0,
            total_principal=stats[2] or 0,
            total_current_balance=stats[3] or 0,
            total_monthly_payments=stats[4] or 0,
            total_annual_payments=(stats[4] or 0) * 12,
            upcoming_payments=upcoming_payments,
            loans_by_type=loans_by_type,
            interest_rate_summary={
                "average": stats[5] or 0,
                "minimum": stats[6] or 0,
                "maximum": stats[7] or 0
            }
        )
        
        print("Successfully retrieved loan summary")
        return ForecastResponse(
            status="success",
            data=summary.dict(),
            message="Retrieved loan portfolio summary"
        )
        
    except Exception as e:
        import traceback
        print(f"Error in get_loan_summary: {str(e)}")
        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Error retrieving loan summary: {str(e)}")

@router.get("/cash-flow", response_model=ForecastResponse)
async def get_loan_cash_flow_projection(
    start_period: str = Query(..., description="Start period in YYYY-MM format"),
    end_period: str = Query(..., description="End period in YYYY-MM format")
):
    """Get loan payment cash flow projection for specified period range"""
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Convert periods to date range
        start_date = f"{start_period}-01"
        end_date = f"{end_period}-31"  # End of month
        
        cursor.execute("""
            SELECT 
                strftime('%Y-%m', lp.payment_date) as period,
                l.loan_name,
                l.lender,
                l.loan_type,
                SUM(lp.principal_payment) as total_principal,
                SUM(lp.interest_payment) as total_interest,
                SUM(lp.payment_amount) as total_payment,
                COUNT(*) as payment_count
            FROM loan_payments lp
            JOIN loans l ON lp.loan_id = l.loan_id
            WHERE lp.payment_date >= ? AND lp.payment_date <= ?
              AND l.is_active = 1
            GROUP BY strftime('%Y-%m', lp.payment_date), l.loan_id
            ORDER BY period, l.loan_name
        """, (start_date, end_date))
        
        payment_data = cursor.fetchall()
        
        # Group by period
        projections = {}
        for row in payment_data:
            period = row[0]
            if period not in projections:
                projections[period] = {
                    "period": period,
                    "loan_payments": [],
                    "total_principal": 0,
                    "total_interest": 0,
                    "total_payment": 0,
                    "remaining_balance": 0
                }
            
            loan_payment = {
                "loan_name": row[1],
                "lender": row[2],
                "loan_type": row[3],
                "principal_payment": row[4],
                "interest_payment": row[5],
                "payment_amount": row[6],
                "payment_count": row[7]
            }
            
            projections[period]["loan_payments"].append(loan_payment)
            projections[period]["total_principal"] += row[4]
            projections[period]["total_interest"] += row[5]
            projections[period]["total_payment"] += row[6]
        
        # Calculate remaining balance for each period
        for period in sorted(projections.keys()):
            cursor.execute("""
                SELECT SUM(l.current_balance) as total_balance
                FROM loans l
                WHERE l.is_active = 1
            """)
            balance_row = cursor.fetchone()
            projections[period]["remaining_balance"] = balance_row[0] if balance_row[0] else 0
        
        db_manager.close_connection(conn)
        
        projection_list = [CashFlowProjection(**data) for data in projections.values()]
        
        return ForecastResponse(
            status="success",
            data={"projections": [p.dict() for p in projection_list]},
            message=f"Retrieved cash flow projections for {len(projection_list)} periods"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving cash flow projection: {str(e)}")

@router.put("/{loan_id}", response_model=ForecastResponse)
async def update_loan(loan_id: str, loan_update: LoanUpdate):
    """Update loan information and regenerate amortization schedule if needed"""
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Check if loan exists
        cursor.execute("SELECT * FROM loans WHERE loan_id = ?", (loan_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Loan not found")
        
        # Build update query
        update_fields = []
        update_values = []
        
        for field, value in loan_update.dict(exclude_unset=True).items():
            if value is not None:
                update_fields.append(f"{field} = ?")
                update_values.append(value)
        
        if not update_fields:
            raise HTTPException(status_code=400, detail="No fields to update")
        
        update_values.append(loan_id)
        update_query = f"UPDATE loans SET {', '.join(update_fields)}, updated_date = CURRENT_TIMESTAMP WHERE loan_id = ?"
        
        cursor.execute(update_query, update_values)
        
        # Check if we need to regenerate the amortization schedule
        schedule_affecting_fields = {'principal_amount', 'interest_rate', 'loan_term_months', 'start_date', 'payment_type', 'payment_frequency', 'balloon_payment', 'balloon_date'}
        if any(field in loan_update.dict(exclude_unset=True) for field in schedule_affecting_fields):
            # Get updated loan data
            cursor.execute("SELECT * FROM loans WHERE loan_id = ?", (loan_id,))
            loan_row = cursor.fetchone()
            cursor.execute("PRAGMA table_info(loans)")
            loan_columns = [col[1] for col in cursor.fetchall()]
            loan_data = dict(zip(loan_columns, loan_row))
            
            # Delete old payment schedule
            cursor.execute("DELETE FROM loan_payments WHERE loan_id = ?", (loan_id,))
            
            # Generate new schedule
            payments = generate_amortization_schedule(
                loan_id,
                loan_data['principal_amount'],
                loan_data['interest_rate'] / 100,
                loan_data['loan_term_months'],
                loan_data['start_date'],
                loan_data['payment_type'],
                loan_data['balloon_payment'],
                loan_data['balloon_date'],
                loan_data['payment_frequency']
            )
            
            # Insert new schedule
            for payment in payments:
                cursor.execute("""
                    INSERT INTO loan_payments (
                        payment_id, loan_id, payment_number, payment_date, payment_amount,
                        principal_payment, interest_payment, remaining_balance, payment_status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    payment.payment_id, payment.loan_id, payment.payment_number,
                    payment.payment_date, payment.payment_amount, payment.principal_payment,
                    payment.interest_payment, payment.remaining_balance, payment.payment_status
                ))
            
            # Update monthly payment amount
            monthly_payment = calculate_loan_payment(
                loan_data['principal_amount'],
                loan_data['interest_rate'] / 100,
                loan_data['loan_term_months'],
                loan_data['payment_type']
            )
            cursor.execute("UPDATE loans SET monthly_payment_amount = ? WHERE loan_id = ?", (monthly_payment, loan_id))
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"loan_id": loan_id},
            message="Loan updated successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating loan: {str(e)}")

@router.delete("/{loan_id}", response_model=ForecastResponse)
async def delete_loan(loan_id: str):
    """Delete a loan and its payment schedule"""
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Check if loan exists
        cursor.execute("SELECT loan_name FROM loans WHERE loan_id = ?", (loan_id,))
        loan_row = cursor.fetchone()
        if not loan_row:
            raise HTTPException(status_code=404, detail="Loan not found")
        
        loan_name = loan_row[0]
        
        # Delete payment schedule first (due to foreign key constraint)
        cursor.execute("DELETE FROM loan_payments WHERE loan_id = ?", (loan_id,))
        
        # Delete loan
        cursor.execute("DELETE FROM loans WHERE loan_id = ?", (loan_id,))
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"loan_id": loan_id},
            message=f"Loan '{loan_name}' deleted successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting loan: {str(e)}")
