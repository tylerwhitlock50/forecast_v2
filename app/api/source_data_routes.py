from fastapi import APIRouter, HTTPException, Query
from typing import Optional, Dict, Any, List
from datetime import datetime
import json

from db.database import db_manager
from db.models import ForecastResponse

router = APIRouter(prefix="/source-data", tags=["source-data"])

@router.get("/sales-forecast", response_model=ForecastResponse)
async def get_sales_forecast_from_source(
    forecast_id: Optional[str] = Query(None, description="Forecast ID to filter sales data"),
    start_period: Optional[str] = Query(None, description="Start period (YYYY-MM)"),
    end_period: Optional[str] = Query(None, description="End period (YYYY-MM)")
):
    """
    Get sales forecast data directly from source tables (sales, customers, units)
    and calculate COGS from BOM, routing, and labor data
    """
    try:
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Build query with optional period and forecast filtering
        query = """
            SELECT s.sale_id, s.customer_id, s.unit_id, s.period, s.quantity,
                   s.unit_price, s.total_revenue, s.forecast_id,
                   c.customer_name, c.customer_type, c.region,
                   u.unit_name, u.unit_description, u.base_price, u.bom_id, u.router_id
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.customer_id
            LEFT JOIN units u ON s.unit_id = u.unit_id
        """

        conditions: List[str] = []
        params: List[Any] = []

        if forecast_id:
            conditions.append("s.forecast_id = ?")
            params.append(forecast_id)
        if start_period:
            conditions.append("s.period >= ?")
            params.append(start_period)
        if end_period:
            conditions.append("s.period <= ?")
            params.append(end_period)

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        query += " ORDER BY s.period, s.customer_id, s.unit_id"
        
        cursor.execute(query, params)
        sales_rows = cursor.fetchall()
        
        columns = [description[0] for description in cursor.description]
        sales_data = [dict(zip(columns, row)) for row in sales_rows]
        
        # Get BOM costs for all units in this forecast
        unit_ids = list(set(sale['unit_id'] for sale in sales_data if sale['unit_id']))
        bom_costs = {}
        
        if unit_ids:
            # Get BOM costs
            placeholders = ','.join(['?' for _ in unit_ids])
            cursor.execute(f"""
                SELECT u.unit_id, u.bom_id, SUM(b.material_cost) as total_material_cost
                FROM units u
                LEFT JOIN bom b ON u.bom_id = b.bom_id
                WHERE u.unit_id IN ({placeholders})
                GROUP BY u.unit_id, u.bom_id
            """, unit_ids)
            
            for row in cursor.fetchall():
                bom_costs[row[0]] = row[2] or 0.0
        
        # Get labor rates for calculations
        cursor.execute("SELECT rate_id, rate_amount FROM labor_rates")
        labor_rates = {row[0]: row[1] for row in cursor.fetchall()}
        
        # Get average labor rate from payroll or use default
        cursor.execute("SELECT AVG(hourly_rate) FROM payroll WHERE hourly_rate > 0")
        avg_labor_rate_result = cursor.fetchone()
        avg_labor_rate = avg_labor_rate_result[0] if avg_labor_rate_result[0] else 35.0
        
        # Get router operations with machine costs
        if unit_ids:
            cursor.execute(f"""
                SELECT u.unit_id, ro.machine_minutes, ro.labor_minutes, 
                       m.machine_rate, ro.labor_type_id
                FROM units u
                LEFT JOIN router_operations ro ON u.router_id = ro.router_id
                LEFT JOIN machines m ON ro.machine_id = m.machine_id
                WHERE u.unit_id IN ({placeholders})
                ORDER BY u.unit_id, ro.sequence
            """, unit_ids)
            
            router_data = cursor.fetchall()
            
            # Calculate costs per unit
            unit_costs = {}
            for row in router_data:
                unit_id = row[0]
                machine_minutes = row[1] or 0.0
                labor_minutes = row[2] or 0.0
                machine_rate = row[3] or 0.0
                labor_type_id = row[4]
                
                if unit_id not in unit_costs:
                    unit_costs[unit_id] = {'machine_cost': 0.0, 'labor_cost': 0.0}
                
                # Machine cost (rate per hour * minutes / 60)
                unit_costs[unit_id]['machine_cost'] += (machine_rate * machine_minutes / 60.0)
                
                # Labor cost (use specific rate or average)
                labor_rate = labor_rates.get(labor_type_id, avg_labor_rate)
                unit_costs[unit_id]['labor_cost'] += (labor_rate * labor_minutes / 60.0)
        
        # Calculate full forecast with costs
        forecast_data = []
        for sale in sales_data:
            unit_id = sale['unit_id']
            quantity = sale['quantity'] or 0
            
            # Material cost
            material_cost_per_unit = bom_costs.get(unit_id, 0.0)
            total_material_cost = material_cost_per_unit * quantity
            
            # Labor and machine costs
            unit_cost_data = unit_costs.get(unit_id, {'machine_cost': 0.0, 'labor_cost': 0.0})
            total_labor_cost = unit_cost_data['labor_cost'] * quantity
            total_machine_cost = unit_cost_data['machine_cost'] * quantity
            
            # Total costs
            total_cogs = total_material_cost + total_labor_cost + total_machine_cost
            
            # Margins
            total_revenue = sale['total_revenue'] or 0.0
            gross_profit = total_revenue - total_cogs
            margin_percentage = (gross_profit / total_revenue * 100) if total_revenue > 0 else 0
            
            forecast_record = {
                **sale,  # Include all original sale data
                'material_cost': total_material_cost,
                'labor_cost': total_labor_cost,
                'machine_cost': total_machine_cost,
                'total_cogs': total_cogs,
                'gross_profit': gross_profit,
                'margin_percentage': margin_percentage,
                'material_cost_per_unit': material_cost_per_unit,
                'labor_cost_per_unit': unit_cost_data['labor_cost'],
                'machine_cost_per_unit': unit_cost_data['machine_cost']
            }
            
            forecast_data.append(forecast_record)
        
        db_manager.close_connection(conn)
        
        # Calculate summary statistics
        total_revenue = sum(f['total_revenue'] or 0 for f in forecast_data)
        total_cogs = sum(f['total_cogs'] or 0 for f in forecast_data)
        total_gross_profit = total_revenue - total_cogs
        overall_margin = (total_gross_profit / total_revenue * 100) if total_revenue > 0 else 0
        
        return ForecastResponse(
            status="success",
            data={
                "sales_forecast": forecast_data,
                "summary": {
                    "total_revenue": total_revenue,
                    "total_cogs": total_cogs,
                    "total_gross_profit": total_gross_profit,
                    "overall_margin_percentage": overall_margin,
                    "record_count": len(forecast_data)
                },
                "metadata": {
                    "forecast_id": forecast_id,
                    "start_period": start_period,
                    "end_period": end_period,
                    "generated_at": datetime.now().isoformat(),
                    "source": "calculated_from_source_tables"
                }
            },
            message=f"Retrieved and calculated forecast data for {forecast_id or 'all forecasts'} with {len(forecast_data)} records"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate sales forecast from source: {str(e)}")

@router.get("/cost-breakdown", response_model=ForecastResponse)
async def get_cost_breakdown_from_source(
    forecast_id: Optional[str] = Query(None, description="Forecast ID to analyze costs"),
    unit_id: Optional[str] = Query(None, description="Specific unit ID to analyze")
):
    """
    Get detailed cost breakdown for products from source tables
    """
    try:
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Get units for this forecast
        query = """
            SELECT DISTINCT u.unit_id, u.unit_name, u.bom_id, u.router_id, u.base_price
            FROM sales s
            JOIN units u ON s.unit_id = u.unit_id
        """

        conditions: List[str] = []
        params: List[Any] = []

        if forecast_id:
            conditions.append("s.forecast_id = ?")
            params.append(forecast_id)
        if unit_id:
            conditions.append("u.unit_id = ?")
            params.append(unit_id)

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        cursor.execute(query, params)
        units = cursor.fetchall()
        
        cost_breakdown_data = []
        
        for unit_row in units:
            unit_id = unit_row[0]
            unit_name = unit_row[1]
            bom_id = unit_row[2]
            router_id = unit_row[3]
            base_price = unit_row[4]
            
            # Get detailed BOM breakdown
            bom_items = []
            total_material_cost = 0.0
            
            if bom_id:
                cursor.execute("""
                    SELECT bom_line, material_description, qty, unit, unit_price, material_cost
                    FROM bom
                    WHERE bom_id = ?
                    ORDER BY bom_line
                """, (bom_id,))
                
                for bom_row in cursor.fetchall():
                    item = {
                        'line': bom_row[0],
                        'description': bom_row[1],
                        'quantity': bom_row[2],
                        'unit': bom_row[3],
                        'unit_price': bom_row[4],
                        'total_cost': bom_row[5]
                    }
                    bom_items.append(item)
                    total_material_cost += bom_row[5] or 0.0
            
            # Get detailed router breakdown
            router_operations = []
            total_labor_cost = 0.0
            total_machine_cost = 0.0
            
            if router_id:
                cursor.execute("""
                    SELECT ro.sequence, ro.operation_description, ro.machine_minutes, ro.labor_minutes,
                           m.machine_name, m.machine_rate, lr.rate_amount, lr.rate_name
                    FROM router_operations ro
                    LEFT JOIN machines m ON ro.machine_id = m.machine_id
                    LEFT JOIN labor_rates lr ON ro.labor_type_id = lr.rate_id
                    WHERE ro.router_id = ?
                    ORDER BY ro.sequence
                """, (router_id,))
                
                for router_row in cursor.fetchall():
                    machine_minutes = router_row[2] or 0.0
                    labor_minutes = router_row[3] or 0.0
                    machine_rate = router_row[5] or 0.0
                    labor_rate = router_row[6] or 35.0  # Default rate
                    
                    operation_machine_cost = (machine_rate * machine_minutes / 60.0)
                    operation_labor_cost = (labor_rate * labor_minutes / 60.0)
                    
                    operation = {
                        'sequence': router_row[0],
                        'description': router_row[1],
                        'machine_minutes': machine_minutes,
                        'labor_minutes': labor_minutes,
                        'machine_name': router_row[4],
                        'machine_rate': machine_rate,
                        'labor_rate': labor_rate,
                        'machine_cost': operation_machine_cost,
                        'labor_cost': operation_labor_cost,
                        'total_operation_cost': operation_machine_cost + operation_labor_cost
                    }
                    router_operations.append(operation)
                    total_machine_cost += operation_machine_cost
                    total_labor_cost += operation_labor_cost
            
            # Calculate totals
            total_unit_cost = total_material_cost + total_labor_cost + total_machine_cost
            margin = (base_price or 0) - total_unit_cost
            margin_percentage = (margin / (base_price or 1) * 100) if base_price else 0
            
            unit_breakdown = {
                'unit_id': unit_id,
                'unit_name': unit_name,
                'base_price': base_price,
                'bom_id': bom_id,
                'router_id': router_id,
                'material_cost': total_material_cost,
                'labor_cost': total_labor_cost,
                'machine_cost': total_machine_cost,
                'total_cost': total_unit_cost,
                'margin': margin,
                'margin_percentage': margin_percentage,
                'bom_items': bom_items,
                'router_operations': router_operations
            }
            
            cost_breakdown_data.append(unit_breakdown)
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={
                "cost_breakdown": cost_breakdown_data,
                "summary": {
                    "units_analyzed": len(cost_breakdown_data),
                    "total_units": len(units)
                }
            },
            message=f"Generated detailed cost breakdown for {len(cost_breakdown_data)} units"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate cost breakdown: {str(e)}")

@router.get("/revenue-summary", response_model=ForecastResponse)
async def get_revenue_summary_from_source(
    forecast_id: Optional[str] = Query(None, description="Forecast ID to summarize"),
    group_by: str = Query("period", description="Group by: period, customer, unit, or customer_unit")
):
    """
    Get revenue summary grouped by different dimensions from source sales data
    """
    try:
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Build different grouping queries
        params: List[Any] = []
        forecast_filter = "WHERE s.forecast_id = ?" if forecast_id else ""
        if forecast_id:
            params.append(forecast_id)

        if group_by == "period":
            query = f"""
                SELECT s.period,
                       SUM(s.quantity) as total_quantity,
                       SUM(s.total_revenue) as total_revenue,
                       COUNT(DISTINCT s.customer_id) as customer_count,
                       COUNT(DISTINCT s.unit_id) as product_count
                FROM sales s
                {forecast_filter}
                GROUP BY s.period
                ORDER BY s.period
            """
        elif group_by == "customer":
            query = f"""
                SELECT s.customer_id, c.customer_name, c.customer_type,
                       SUM(s.quantity) as total_quantity,
                       SUM(s.total_revenue) as total_revenue,
                       COUNT(DISTINCT s.period) as periods_active,
                       COUNT(DISTINCT s.unit_id) as products_ordered
                FROM sales s
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                {forecast_filter}
                GROUP BY s.customer_id, c.customer_name, c.customer_type
                ORDER BY total_revenue DESC
            """
        elif group_by == "unit":
            query = f"""
                SELECT s.unit_id, u.unit_name, u.unit_type,
                       SUM(s.quantity) as total_quantity,
                       SUM(s.total_revenue) as total_revenue,
                       AVG(s.unit_price) as avg_unit_price,
                       COUNT(DISTINCT s.customer_id) as customer_count,
                       COUNT(DISTINCT s.period) as periods_active
                FROM sales s
                LEFT JOIN units u ON s.unit_id = u.unit_id
                {forecast_filter}
                GROUP BY s.unit_id, u.unit_name, u.unit_type
                ORDER BY total_revenue DESC
            """
        elif group_by == "customer_unit":
            query = f"""
                SELECT s.customer_id, c.customer_name, s.unit_id, u.unit_name,
                       SUM(s.quantity) as total_quantity,
                       SUM(s.total_revenue) as total_revenue,
                       AVG(s.unit_price) as avg_unit_price,
                       COUNT(DISTINCT s.period) as periods_active
                FROM sales s
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                LEFT JOIN units u ON s.unit_id = u.unit_id
                {forecast_filter}
                GROUP BY s.customer_id, c.customer_name, s.unit_id, u.unit_name
                ORDER BY total_revenue DESC
            """
        else:
            raise HTTPException(status_code=400, detail="Invalid group_by parameter. Use: period, customer, unit, or customer_unit")

        cursor.execute(query, params)
        summary_rows = cursor.fetchall()
        
        columns = [description[0] for description in cursor.description]
        summary_data = [dict(zip(columns, row)) for row in summary_rows]
        
        # Get overall totals
        totals_query = f"""
            SELECT COUNT(*) as total_records,
                   SUM(quantity) as total_quantity,
                   SUM(total_revenue) as total_revenue,
                   COUNT(DISTINCT customer_id) as unique_customers,
                   COUNT(DISTINCT unit_id) as unique_products,
                   COUNT(DISTINCT period) as periods_covered
            FROM sales
            { 'WHERE forecast_id = ?' if forecast_id else '' }
        """

        cursor.execute(totals_query, params)
        
        totals_row = cursor.fetchone()
        totals = dict(zip([desc[0] for desc in cursor.description], totals_row))
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={
                "revenue_summary": summary_data,
                "totals": totals,
                "group_by": group_by
            },
            message=f"Generated revenue summary grouped by {group_by} for {forecast_id or 'all forecasts'}"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate revenue summary: {str(e)}")