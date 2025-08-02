from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional, Dict, Any
from db.models import ForecastResponse
from db import get_forecast_data
import logging

router = APIRouter(prefix="/reporting", tags=["reporting"])

@router.get("/combined-forecast", response_model=ForecastResponse)
async def get_combined_forecast_data(
    forecast_ids: List[str] = Query(..., description="List of forecast IDs to combine"),
    start_period: Optional[str] = Query(None, description="Start period (YYYY-MM)"),
    end_period: Optional[str] = Query(None, description="End period (YYYY-MM)")
):
    """
    Get combined data from multiple forecasts for financial statement generation
    """
    try:
        from db.database import db_manager
        import api.cost_routes as cost_routes
        import api.payroll_routes as payroll_routes
        import api.expense_routes as expense_routes
        import api.loan_routes as loan_routes
        
        combined_data = {
            "forecast_ids": forecast_ids,
            "revenue": {"total": 0, "by_period": {}, "by_product": {}, "by_customer": {}},
            "costs": {"materials": 0, "labor": 0, "manufacturing": 0, "total": 0, "by_product": {}},
            "payroll": {"total_cost": 0, "by_period": {}, "by_department": {}, "by_business_unit": {}},
            "expenses": {"total": 0, "by_category": {}, "by_period": {}, "operating": 0, "admin": 0, "factory_overhead": 0},
            "loans": {"total_payments": 0, "principal": 0, "interest": 0, "by_period": {}},
            "metadata": {
                "generated_at": "2024-01-01T00:00:00Z",
                "period_filter": {"start": start_period, "end": end_period}
            }
        }
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Combine revenue data from multiple forecasts
        for forecast_id in forecast_ids:
            # Get sales data for this forecast
            cursor.execute("""
                SELECT unit_id, customer_id, period, quantity, unit_price, total_revenue
                FROM sales 
                WHERE forecast_id = ?
                AND (? IS NULL OR period >= ?)
                AND (? IS NULL OR period <= ?)
            """, (forecast_id, start_period, start_period, end_period, end_period))
            
            sales_data = cursor.fetchall()
            
            for sale in sales_data:
                unit_id, customer_id, period, quantity, unit_price, total_revenue = sale
                
                # Aggregate revenue
                combined_data["revenue"]["total"] += total_revenue or 0
                
                # By period
                period_key = str(period)[:7] if period else "unknown"  # Convert to YYYY-MM
                combined_data["revenue"]["by_period"][period_key] = \
                    combined_data["revenue"]["by_period"].get(period_key, 0) + (total_revenue or 0)
                
                # By product
                combined_data["revenue"]["by_product"][unit_id] = \
                    combined_data["revenue"]["by_product"].get(unit_id, 0) + (total_revenue or 0)
                
                # By customer
                combined_data["revenue"]["by_customer"][customer_id] = \
                    combined_data["revenue"]["by_customer"].get(customer_id, 0) + (total_revenue or 0)
        
        # Get cost data for combined forecasts
        # This would ideally call the cost calculation endpoints, but for simplicity we'll calculate here
        for forecast_id in forecast_ids:
            cursor.execute("""
                SELECT u.unit_id, u.unit_name, u.bom_id, u.bom_version, u.router_id, u.router_version,
                       SUM(s.quantity) as total_quantity
                FROM sales s
                JOIN units u ON s.unit_id = u.unit_id
                WHERE s.forecast_id = ?
                GROUP BY u.unit_id, u.unit_name, u.bom_id, u.bom_version, u.router_id, u.router_version
            """, (forecast_id,))
            
            products = cursor.fetchall()
            
            for product in products:
                unit_id, unit_name, bom_id, bom_version, router_id, router_version, quantity = product
                
                # Calculate material costs from BOM
                if bom_id and quantity:
                    cursor.execute("""
                        SELECT SUM(material_cost) as total_material_cost
                        FROM bom 
                        WHERE bom_id = ? AND version = ?
                    """, (bom_id, bom_version))
                    bom_data = cursor.fetchone()
                    material_cost = (bom_data[0] if bom_data and bom_data[0] else 0) * quantity
                    combined_data["costs"]["materials"] += material_cost
                
                # Calculate labor and machine costs from routing
                if router_id and quantity:
                    cursor.execute("""
                        SELECT ro.labor_minutes, ro.machine_minutes, m.machine_rate, lr.rate_amount
                        FROM router_operations ro
                        JOIN machines m ON ro.machine_id = m.machine_id
                        LEFT JOIN labor_rates lr ON ro.labor_type_id = lr.rate_id
                        WHERE ro.router_id = ?
                    """, (router_id,))
                    routing_data = cursor.fetchall()
                    
                    for route in routing_data:
                        labor_minutes, machine_minutes, machine_rate, hourly_rate = route
                        labor_cost = (labor_minutes / 60) * (hourly_rate if hourly_rate else 0) * quantity
                        machine_cost = (machine_minutes / 60) * (machine_rate if machine_rate else 0) * quantity
                        
                        combined_data["costs"]["labor"] += labor_cost
                        combined_data["costs"]["manufacturing"] += machine_cost
        
        combined_data["costs"]["total"] = (
            combined_data["costs"]["materials"] + 
            combined_data["costs"]["labor"] + 
            combined_data["costs"]["manufacturing"]
        )
        
        # Get payroll data (company-wide, not forecast-specific)
        cursor.execute("""
            SELECT SUM(weekly_hours * hourly_rate * 52) as annual_cost,
                   department,
                   allocations
            FROM payroll 
            WHERE end_date IS NULL OR end_date > date('now')
            GROUP BY department, allocations
        """)
        payroll_data = cursor.fetchall()
        
        for payroll in payroll_data:
            annual_cost, department, allocations = payroll
            if annual_cost:
                combined_data["payroll"]["total_cost"] += annual_cost
                combined_data["payroll"]["by_department"][department or "Unassigned"] = \
                    combined_data["payroll"]["by_department"].get(department or "Unassigned", 0) + annual_cost
        
        # Get expense data for the period
        if start_period and end_period:
            cursor.execute("""
                SELECT c.category_type, c.category_name, 
                       SUM(a.allocated_amount) as total_amount,
                       a.period
                FROM expense_allocations a
                JOIN expenses e ON a.expense_id = e.expense_id
                JOIN expense_categories c ON e.category_id = c.category_id
                WHERE a.period >= ? AND a.period <= ?
                GROUP BY c.category_type, c.category_name, a.period
            """, (start_period, end_period))
            expense_data = cursor.fetchall()
            
            for expense in expense_data:
                category_type, category_name, amount, period = expense
                combined_data["expenses"]["total"] += amount or 0
                combined_data["expenses"]["by_category"][category_type or "Other"] = \
                    combined_data["expenses"]["by_category"].get(category_type or "Other", 0) + (amount or 0)
                combined_data["expenses"]["by_period"][period] = \
                    combined_data["expenses"]["by_period"].get(period, 0) + (amount or 0)
                
                # Categorize expenses
                if category_type == "admin_expense":
                    combined_data["expenses"]["admin"] += amount or 0
                elif category_type == "factory_overhead":
                    combined_data["expenses"]["factory_overhead"] += amount or 0
                else:
                    combined_data["expenses"]["operating"] += amount or 0
        
        # Get loan data for the period
        if start_period and end_period:
            cursor.execute("""
                SELECT strftime('%Y-%m', lp.payment_date) as period,
                       SUM(lp.principal_payment) as total_principal,
                       SUM(lp.interest_payment) as total_interest,
                       SUM(lp.payment_amount) as total_payment
                FROM loan_payments lp
                JOIN loans l ON lp.loan_id = l.loan_id
                WHERE strftime('%Y-%m', lp.payment_date) >= ? 
                  AND strftime('%Y-%m', lp.payment_date) <= ?
                  AND l.is_active = 1
                GROUP BY strftime('%Y-%m', lp.payment_date)
            """, (start_period, end_period))
            loan_data = cursor.fetchall()
            
            for loan in loan_data:
                period, principal, interest, payment = loan
                combined_data["loans"]["total_payments"] += payment or 0
                combined_data["loans"]["principal"] += principal or 0
                combined_data["loans"]["interest"] += interest or 0
                combined_data["loans"]["by_period"][period] = {
                    "total_payment": payment or 0,
                    "principal": principal or 0,
                    "interest": interest or 0
                }
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data=combined_data,
            message=f"Combined data from {len(forecast_ids)} forecasts"
        )
        
    except Exception as e:
        logging.error(f"Error combining forecast data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error combining forecast data: {str(e)}")

@router.get("/financial-statements", response_model=ForecastResponse)
async def generate_financial_statements(
    forecast_ids: List[str] = Query(..., description="List of forecast IDs"),
    start_period: str = Query(..., description="Start period (YYYY-MM)"),
    end_period: str = Query(..., description="End period (YYYY-MM)")
):
    """
    Generate complete financial statements from combined forecast data
    """
    try:
        # Get combined data
        combined_response = await get_combined_forecast_data(forecast_ids, start_period, end_period)
        combined_data = combined_response.data
        
        # Calculate financial statements
        statements = calculate_financial_statements(combined_data, start_period, end_period)
        
        return ForecastResponse(
            status="success",
            data=statements,
            message="Financial statements generated successfully"
        )
        
    except Exception as e:
        logging.error(f"Error generating financial statements: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error generating financial statements: {str(e)}")

def calculate_financial_statements(data: Dict[str, Any], start_period: str, end_period: str) -> Dict[str, Any]:
    """
    Calculate income statement, balance sheet, and cash flow statement from combined data
    """
    # Income Statement
    gross_revenue = data["revenue"]["total"]
    total_cogs = data["costs"]["total"] + data["expenses"]["factory_overhead"]
    gross_profit = gross_revenue - total_cogs
    gross_margin = (gross_profit / gross_revenue * 100) if gross_revenue > 0 else 0
    
    # Operating expenses
    operating_expenses = (
        data["payroll"]["total_cost"] + 
        data["expenses"]["operating"] + 
        data["expenses"]["admin"]
    )
    operating_income = gross_profit - operating_expenses
    operating_margin = (operating_income / gross_revenue * 100) if gross_revenue > 0 else 0
    
    # Net income
    interest_expense = data["loans"]["interest"]
    net_income = operating_income - interest_expense
    net_margin = (net_income / gross_revenue * 100) if gross_revenue > 0 else 0
    
    income_statement = {
        "period": {"start": start_period, "end": end_period},
        "revenue": {
            "gross_revenue": gross_revenue,
            "by_period": data["revenue"]["by_period"],
            "by_product": data["revenue"]["by_product"],
            "by_customer": data["revenue"]["by_customer"]
        },
        "cost_of_goods_sold": {
            "materials": data["costs"]["materials"],
            "labor": data["costs"]["labor"],
            "manufacturing": data["costs"]["manufacturing"],
            "factory_overhead": data["expenses"]["factory_overhead"],
            "total": total_cogs
        },
        "gross_profit": gross_profit,
        "gross_margin": gross_margin,
        "operating_expenses": {
            "payroll": data["payroll"]["total_cost"],
            "admin_expenses": data["expenses"]["admin"],
            "operating_expenses": data["expenses"]["operating"],
            "total": operating_expenses
        },
        "operating_income": operating_income,
        "operating_margin": operating_margin,
        "other_expenses": {
            "interest_expense": interest_expense
        },
        "net_income": net_income,
        "net_margin": net_margin,
        "metadata": data["metadata"]
    }
    
    # Balance Sheet (simplified)
    accounts_receivable = gross_revenue / 12  # 1 month of revenue
    inventory = (data["costs"]["total"] * 2) / 12  # 2 months of COGS
    current_assets = accounts_receivable + inventory
    
    accounts_payable = (data["expenses"]["total"] + data["payroll"]["total_cost"]) / 12
    current_portion_debt = data["loans"]["principal"]
    current_liabilities = accounts_payable + current_portion_debt
    
    working_capital = current_assets - current_liabilities
    total_equity = working_capital  # Simplified
    
    balance_sheet = {
        "period": end_period,
        "assets": {
            "current_assets": {
                "accounts_receivable": accounts_receivable,
                "inventory": inventory,
                "total": current_assets
            },
            "total_assets": current_assets
        },
        "liabilities": {
            "current_liabilities": {
                "accounts_payable": accounts_payable,
                "current_portion_long_term_debt": current_portion_debt,
                "total": current_liabilities
            },
            "total_liabilities": current_liabilities
        },
        "equity": {
            "retained_earnings": total_equity,
            "total_equity": total_equity
        },
        "working_capital": working_capital,
        "metadata": data["metadata"]
    }
    
    # Cash Flow Statement
    operating_cash_flow = net_income  # Simplified
    investing_cash_flow = 0  # Placeholder
    financing_cash_flow = -data["loans"]["total_payments"]
    net_cash_flow = operating_cash_flow + investing_cash_flow + financing_cash_flow
    
    cash_flow_statement = {
        "period": {"start": start_period, "end": end_period},
        "operating_activities": {
            "net_income": net_income,
            "adjustments": {},
            "operating_cash_flow": operating_cash_flow
        },
        "investing_activities": {
            "capital_expenditures": 0,
            "investing_cash_flow": investing_cash_flow
        },
        "financing_activities": {
            "loan_payments": -data["loans"]["total_payments"],
            "principal_payments": -data["loans"]["principal"],
            "interest_payments": -data["loans"]["interest"],
            "financing_cash_flow": financing_cash_flow
        },
        "net_cash_flow": net_cash_flow,
        "by_period": data["loans"]["by_period"],
        "metadata": data["metadata"]
    }
    
    return {
        "income_statement": income_statement,
        "balance_sheet": balance_sheet,
        "cash_flow_statement": cash_flow_statement,
        "combined_data": data
    }