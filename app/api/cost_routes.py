from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from db.models import ForecastResponse

router = APIRouter(prefix="/products", tags=["cost"])

@router.get("/cost-summary", response_model=ForecastResponse)
async def get_products_cost_summary(forecast_id: Optional[str] = Query(None)):
    """
    Get cost summary for all products including COGS calculation
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Get products with their BOM and routing versions
        cursor.execute("""
            SELECT u.unit_id, u.unit_name, u.bom_id, u.bom_version, u.router_id, u.router_version, u.base_price
            FROM units u
        """)
        products = cursor.fetchall()
        
        cost_summaries = []
        for product in products:
            unit_id, unit_name, bom_id, bom_version, router_id, router_version, base_price = product
            
            # Calculate forecasted revenue
            revenue_query = """
                SELECT SUM(total_revenue) as total_revenue, SUM(quantity) as total_quantity
                FROM sales 
                WHERE unit_id = ?
            """
            params = [unit_id]
            if forecast_id:
                revenue_query += " AND forecast_id = ?"
                params.append(forecast_id)
            
            cursor.execute(revenue_query, params)
            revenue_data = cursor.fetchone()
            forecasted_revenue = revenue_data[0] if revenue_data[0] else 0
            forecasted_quantity = revenue_data[1] if revenue_data[1] else 0
            
            # Calculate material costs from BOM
            material_cost = 0
            if bom_id:
                cursor.execute("""
                    SELECT SUM(material_cost) as total_material_cost
                    FROM bom 
                    WHERE bom_id = ? AND version = ?
                """, (bom_id, bom_version))
                bom_data = cursor.fetchone()
                material_cost = (bom_data[0] if bom_data[0] else 0) * forecasted_quantity
            
            # Calculate labor and machine costs from routing
            labor_cost = 0
            machine_cost = 0
            if router_id:
                cursor.execute("""
                    SELECT r.labor_minutes, r.machine_minutes, m.machine_rate, lr.rate_amount
                    FROM routers r
                    JOIN machines m ON r.machine_id = m.machine_id
                    LEFT JOIN labor_rates lr ON r.labor_type_id = lr.rate_id
                    WHERE r.router_id = ? AND r.version = ?
                """, (router_id, router_version))
                routing_data = cursor.fetchall()
                
                for route in routing_data:
                    labor_minutes, machine_minutes, machine_rate, hourly_rate = route
                    labor_cost += (labor_minutes / 60) * (hourly_rate if hourly_rate else 0) * forecasted_quantity
                    machine_cost += (machine_minutes / 60) * (machine_rate if machine_rate else 0) * forecasted_quantity
            
            total_cogs = material_cost + labor_cost + machine_cost
            gross_margin = forecasted_revenue - total_cogs
            gross_margin_percent = (gross_margin / forecasted_revenue * 100) if forecasted_revenue > 0 else 0
            
            cost_summaries.append({
                "product_id": unit_id,
                "product_name": unit_name,
                "forecasted_revenue": forecasted_revenue,
                "material_cost": material_cost,
                "labor_cost": labor_cost,
                "machine_cost": machine_cost,
                "total_cogs": total_cogs,
                "gross_margin": gross_margin,
                "gross_margin_percent": gross_margin_percent
            })
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"products": cost_summaries},
            message=f"Retrieved cost summary for {len(cost_summaries)} products"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving cost summary: {str(e)}")

@router.get("/materials/usage", response_model=ForecastResponse)
async def get_materials_usage(forecast_id: Optional[str] = Query(None)):
    """
    Get material usage forecast for purchasing decisions
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Get material usage by joining sales forecast with BOM
        usage_query = """
            SELECT b.material_description, b.unit, b.unit_price, 
                   SUM(s.quantity * b.qty) as total_quantity_needed,
                   SUM(s.quantity * b.material_cost) as total_cost,
                   GROUP_CONCAT(DISTINCT u.unit_name) as products_using
            FROM sales s
            JOIN units u ON s.unit_id = u.unit_id
            JOIN bom b ON u.bom_id = b.bom_id AND u.bom_version = b.version
        """
        
        params = []
        if forecast_id:
            usage_query += " WHERE s.forecast_id = ?"
            params.append(forecast_id)
        
        usage_query += " GROUP BY b.material_description, b.unit, b.unit_price"
        
        cursor.execute(usage_query, params)
        material_data = cursor.fetchall()
        
        materials_usage = []
        for material in material_data:
            materials_usage.append({
                "material_description": material[0],
                "unit": material[1],
                "unit_price": material[2],
                "total_quantity_needed": material[3],
                "total_cost": material[4],
                "products_using": material[5].split(',') if material[5] else []
            })
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"materials": materials_usage},
            message=f"Retrieved material usage for {len(materials_usage)} materials"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving material usage: {str(e)}")

@router.get("/machines/utilization", response_model=ForecastResponse)
async def get_machines_utilization(forecast_id: Optional[str] = Query(None)):
    """
    Get machine utilization forecast and capacity analysis
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Get machine utilization by joining sales forecast with routing
        utilization_query = """
            SELECT m.machine_id, m.machine_name, m.available_minutes_per_month, m.machine_rate,
                   SUM(s.quantity * r.machine_minutes) as total_minutes_required,
                   SUM(s.quantity * r.machine_minutes * m.machine_rate / 60) as total_cost
            FROM sales s
            JOIN units u ON s.unit_id = u.unit_id
            JOIN routers r ON u.router_id = r.router_id AND u.router_version = r.version
            JOIN machines m ON r.machine_id = m.machine_id
        """
        
        params = []
        if forecast_id:
            utilization_query += " WHERE s.forecast_id = ?"
            params.append(forecast_id)
        
        utilization_query += " GROUP BY m.machine_id, m.machine_name, m.available_minutes_per_month, m.machine_rate"
        
        cursor.execute(utilization_query, params)
        machine_data = cursor.fetchall()
        
        machines_utilization = []
        for machine in machine_data:
            machine_id, machine_name, available_minutes, machine_rate, total_minutes, total_cost = machine
            utilization_percent = (total_minutes / available_minutes * 100) if available_minutes > 0 else 0
            capacity_exceeded = total_minutes > available_minutes
            
            machines_utilization.append({
                "machine_id": machine_id,
                "machine_name": machine_name,
                "total_minutes_required": total_minutes,
                "available_minutes_per_month": available_minutes,
                "utilization_percent": utilization_percent,
                "total_cost": total_cost,
                "capacity_exceeded": capacity_exceeded
            })
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"machines": machines_utilization},
            message=f"Retrieved utilization for {len(machines_utilization)} machines"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving machine utilization: {str(e)}")

@router.get("/labor/utilization", response_model=ForecastResponse)
async def get_labor_utilization(forecast_id: Optional[str] = Query(None)):
    """
    Get labor utilization forecast and cost analysis
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Get labor utilization by joining sales forecast with routing and labor rates
        utilization_query = """
            SELECT lr.rate_id, lr.rate_name, lr.rate_amount,
                   SUM(s.quantity * r.labor_minutes) as total_minutes_required,
                   SUM(s.quantity * r.labor_minutes * lr.rate_amount / 60) as total_cost,
                   GROUP_CONCAT(DISTINCT u.unit_name) as products_involved
            FROM sales s
            JOIN units u ON s.unit_id = u.unit_id
            JOIN routers r ON u.router_id = r.router_id AND u.router_version = r.version
            JOIN labor_rates lr ON r.labor_type_id = lr.rate_id
        """
        
        params = []
        if forecast_id:
            utilization_query += " WHERE s.forecast_id = ?"
            params.append(forecast_id)
        
        utilization_query += " GROUP BY lr.rate_id, lr.rate_name, lr.rate_amount"
        
        cursor.execute(utilization_query, params)
        labor_data = cursor.fetchall()
        
        labor_utilization = []
        for labor in labor_data:
            labor_utilization.append({
                "labor_type_id": labor[0],
                "labor_type_name": labor[1],
                "hourly_rate": labor[2],
                "total_minutes_required": labor[3],
                "total_cost": labor[4],
                "products_involved": labor[5].split(',') if labor[5] else []
            })
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"labor": labor_utilization},
            message=f"Retrieved utilization for {len(labor_utilization)} labor types"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving labor utilization: {str(e)}")