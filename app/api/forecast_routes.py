from fastapi import APIRouter, HTTPException, Query
from typing import Optional, Dict, Any, List
from db import get_forecast_data, get_saved_forecast_results
from db.models import ForecastResponse, SQLApplyRequest
from db import execute_sql
from utils.period_normalizer import normalize_period
import uuid
import sqlite3
from datetime import datetime

router = APIRouter(prefix="/forecast", tags=["forecast"])

@router.get("", response_model=ForecastResponse)
async def get_forecast(forecast_id: Optional[str] = Query(None, description="Filter by forecast ID")):
    """
    Returns computed forecast state with joined data
    """
    result = get_forecast_data()
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["error"])
    
    # If forecast_id is provided, filter the sales data
    if forecast_id and result["data"].get("sales_forecast"):
        result["data"]["sales_forecast"] = [
            sale for sale in result["data"]["sales_forecast"] 
            if sale.get("forecast_id") == forecast_id
        ]
    
    return ForecastResponse(
        status="success",
        data=result["data"]
    )

@router.get("/scenarios", response_model=ForecastResponse)
async def get_forecast_scenarios():
    """
    Get all available forecast scenarios
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        cursor.execute("SELECT * FROM forecast ORDER BY name")
        forecasts = cursor.fetchall()
        
        # Convert to dictionaries
        columns = [description[0] for description in cursor.description]
        forecast_list = [dict(zip(columns, row)) for row in forecasts]
        
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={"scenarios": forecast_list},
            message=f"Retrieved {len(forecast_list)} forecast scenarios"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving forecast scenarios: {str(e)}")

@router.post("/scenario", response_model=ForecastResponse)
async def create_forecast_scenario(scenario_data: Dict[str, Any]):
    """
    Create a new forecast scenario with auto-generated FXXX ID
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        # Get the next available FXXX ID
        cursor.execute("SELECT forecast_id FROM forecast WHERE forecast_id LIKE 'F%' ORDER BY forecast_id DESC LIMIT 1")
        last_forecast = cursor.fetchone()
        
        if last_forecast:
            # Extract the number from the last forecast_id (e.g., "F003" -> 3)
            last_number = int(last_forecast[0][1:])
            next_number = last_number + 1
        else:
            next_number = 1
        
        # Generate new forecast_id with FXXX format
        forecast_id = f"F{next_number:03d}"  # F001, F002, F003, etc.
        
        name = scenario_data.get('name', 'New Scenario')
        description = scenario_data.get('description', '')
        notes = scenario_data.get('notes', '')

        cursor.execute("""
            INSERT INTO forecast (forecast_id, name, description, notes)
            VALUES (?, ?, ?, ?)
        """, (forecast_id, name, description, notes))

        conn.commit()
        db_manager.close_connection(conn)

        return ForecastResponse(
            status="success",
            data={"forecast_id": forecast_id, "name": name, "description": description, "notes": notes},
            message=f"Forecast scenario {forecast_id} created successfully"
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating forecast scenario: {str(e)}")

@router.post("/scenario/{forecast_id}/duplicate", response_model=ForecastResponse)
async def duplicate_forecast_scenario(forecast_id: str, scenario_data: Dict[str, Any] = None):
    """Duplicate an existing forecast scenario and its related data"""
    try:
        from db.database import db_manager

        conn = db_manager.get_connection()
        cursor = conn.cursor()

        # Verify source scenario exists
        cursor.execute("SELECT name, description FROM forecast WHERE forecast_id = ?", (forecast_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Forecast scenario not found")

        original_name, original_description = row

        # Generate new forecast ID
        cursor.execute("SELECT forecast_id FROM forecast WHERE forecast_id LIKE 'F%' ORDER BY forecast_id DESC LIMIT 1")
        last_forecast = cursor.fetchone()
        next_number = int(last_forecast[0][1:]) + 1 if last_forecast else 1
        new_forecast_id = f"F{next_number:03d}"

        name = (scenario_data or {}).get('name', f"{original_name} Copy")
        description = (scenario_data or {}).get('description', original_description)

        cursor.execute(
            "INSERT INTO forecast (forecast_id, name, description) VALUES (?, ?, ?)",
            (new_forecast_id, name, description)
        )

        # Duplicate sales (normalize periods during duplication)
        cursor.execute("SELECT customer_id, unit_id, period, quantity, unit_price, total_revenue FROM sales WHERE forecast_id = ?", (forecast_id,))
        for s in cursor.fetchall():
            # Normalize period if needed
            period = s[2]  # period is at index 2
            if period:
                normalized_period = normalize_period(period)
                if normalized_period:
                    period = normalized_period
            
            cursor.execute(
                """
                INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (f"SAL-{uuid.uuid4().hex[:8].upper()}", s[0], s[1], period, s[3], s[4], s[5], new_forecast_id)
            )

        # Duplicate expenses
        cursor.execute("SELECT expense_name, category_id, amount, frequency, start_date, end_date, vendor, description, payment_method, approval_required, approved_by, approval_date, expense_allocation, amortization_months, department, cost_center, is_active FROM expenses WHERE forecast_id = ?", (forecast_id,))
        for e in cursor.fetchall():
            cursor.execute(
                """
                INSERT INTO expenses (expense_id, expense_name, category_id, amount, frequency, start_date, end_date, vendor, description, payment_method, approval_required, approved_by, approval_date, expense_allocation, amortization_months, department, cost_center, is_active, forecast_id, created_date, updated_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"EXP-{uuid.uuid4().hex[:8].upper()}", e[0], e[1], e[2], e[3], e[4], e[5], e[6], e[7], e[8], e[9], e[10], e[11], e[12], e[13], e[14], e[15], e[16], new_forecast_id, datetime.now().isoformat(), datetime.now().isoformat()
                )
            )

        # Duplicate payroll
        cursor.execute("SELECT employee_name, department, weekly_hours, hourly_rate, rate_type, labor_type, start_date, end_date, next_review_date, expected_raise, benefits_eligible, allocations FROM payroll WHERE forecast_id = ?", (forecast_id,))
        for p in cursor.fetchall():
            cursor.execute(
                """
                INSERT INTO payroll (employee_id, employee_name, department, weekly_hours, hourly_rate, rate_type, labor_type, start_date, end_date, next_review_date, expected_raise, benefits_eligible, allocations, forecast_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"EMP-{int(datetime.now().timestamp())}{uuid.uuid4().hex[:4]}", p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], new_forecast_id
                )
            )

        conn.commit()
        db_manager.close_connection(conn)

        return ForecastResponse(
            status="success",
            data={"forecast_id": new_forecast_id, "name": name, "description": description},
            message=f"Forecast scenario {forecast_id} duplicated as {new_forecast_id}"
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error duplicating forecast scenario: {str(e)}")

@router.delete("/scenario/{forecast_id}", response_model=ForecastResponse)
async def delete_forecast_scenario(forecast_id: str):
    """Delete a forecast scenario and its related data"""
    try:
        from db.database import db_manager

        conn = db_manager.get_connection()
        cursor = conn.cursor()

        # Delete related data
        for table in ["sales", "expenses", "payroll"]:
            cursor.execute(f"DELETE FROM {table} WHERE forecast_id = ?", (forecast_id,))

        # Delete scenario
        cursor.execute("DELETE FROM forecast WHERE forecast_id = ?", (forecast_id,))

        conn.commit()
        db_manager.close_connection(conn)

        return ForecastResponse(
            status="success",
            message=f"Forecast scenario {forecast_id} deleted successfully"
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting forecast scenario: {str(e)}")

@router.get("/comparison", response_model=ForecastResponse)
async def compare_forecast_scenarios(
    forecast_ids: List[str] = Query(..., description="Forecast IDs to compare")
):
    """Return aggregate metrics for multiple forecast scenarios"""
    try:
        from db.database import db_manager

        conn = db_manager.get_connection()
        cursor = conn.cursor()

        placeholders = ",".join("?" for _ in forecast_ids)

        cursor.execute(
            f"SELECT forecast_id, SUM(total_revenue) FROM sales WHERE forecast_id IN ({placeholders}) GROUP BY forecast_id",
            forecast_ids,
        )
        sales = {row[0]: row[1] or 0 for row in cursor.fetchall()}

        cursor.execute(
            f"SELECT forecast_id, SUM(amount) FROM expenses WHERE forecast_id IN ({placeholders}) GROUP BY forecast_id",
            forecast_ids,
        )
        expenses = {row[0]: row[1] or 0 for row in cursor.fetchall()}

        cursor.execute(
            f"SELECT forecast_id, SUM(weekly_hours * hourly_rate * 52) FROM payroll WHERE forecast_id IN ({placeholders}) GROUP BY forecast_id",
            forecast_ids,
        )
        payroll = {row[0]: row[1] or 0 for row in cursor.fetchall()}

        db_manager.close_connection(conn)

        comparison = [
            {
                "forecast_id": fid,
                "revenue": float(sales.get(fid, 0) or 0),
                "expenses": float(expenses.get(fid, 0) or 0),
                "payroll": float(payroll.get(fid, 0) or 0),
            }
            for fid in forecast_ids
        ]

        return ForecastResponse(
            status="success",
            data={"comparison": comparison},
            message=f"Compared {len(comparison)} forecast scenarios",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error comparing forecast scenarios: {str(e)}"
        )

@router.get("/results", response_model=ForecastResponse)
async def get_saved_forecast_results_endpoint(
    period: Optional[str] = Query(None, description="Filter by period (e.g., '2024-01')"),
    limit: Optional[int] = Query(None, description="Limit number of results")
):
    """
    Get saved forecast results from the database
    """
    result = get_saved_forecast_results(period=period, limit=limit)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["error"])
    
    return ForecastResponse(
        status="success",
        data={
            "results": result["data"],
            "columns": result.get("columns"),
            "summary": result.get("summary"),
        },
        message=f"Retrieved {len(result['data'])} forecast results"
    )

@router.post("/bulk_create_customers", response_model=ForecastResponse)
async def bulk_create_customers(customers_data: Dict[str, Any]):
    """
    Bulk create customers from CSV import
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        customers = customers_data.get('customers', [])
        options = customers_data.get('options', {})
        merge_strategy = options.get('merge_strategy', 'skip')  # 'skip', 'update', 'create_new'
        
        if not customers:
            raise HTTPException(status_code=400, detail="No customer data provided")
        
        created_count = 0
        updated_count = 0
        skipped_count = 0
        errors = []
        
        for idx, customer in enumerate(customers):
            try:
                customer_id = customer.get('customer_id')
                customer_name = customer.get('customer_name', '')
                
                if not customer_id or not customer_name:
                    errors.append({
                        'row': idx + 1,
                        'error': 'Missing customer_id or customer_name'
                    })
                    continue
                
                # Check if customer exists
                cursor.execute("SELECT customer_id FROM customers WHERE customer_id = ?", (customer_id,))
                exists = cursor.fetchone()
                
                if exists:
                    if merge_strategy == 'skip':
                        skipped_count += 1
                        continue
                    elif merge_strategy == 'update':
                        cursor.execute("""
                            UPDATE customers 
                            SET customer_name = ?, customer_type = ?, region = ?
                            WHERE customer_id = ?
                        """, (
                            customer_name,
                            customer.get('customer_type', ''),
                            customer.get('region', ''),
                            customer_id
                        ))
                        updated_count += 1
                    elif merge_strategy == 'create_new':
                        # Generate new ID
                        cursor.execute("SELECT customer_id FROM customers ORDER BY customer_id DESC LIMIT 1")
                        last = cursor.fetchone()
                        if last and last[0].startswith('CUST-'):
                            num = int(last[0].split('-')[1]) + 1
                            customer_id = f"CUST-{num:03d}"
                        else:
                            customer_id = "CUST-001"
                        cursor.execute("""
                            INSERT INTO customers (customer_id, customer_name, customer_type, region)
                            VALUES (?, ?, ?, ?)
                        """, (
                            customer_id,
                            customer_name,
                            customer.get('customer_type', ''),
                            customer.get('region', '')
                        ))
                        created_count += 1
                else:
                    cursor.execute("""
                        INSERT INTO customers (customer_id, customer_name, customer_type, region)
                        VALUES (?, ?, ?, ?)
                    """, (
                        customer_id,
                        customer_name,
                        customer.get('customer_type', ''),
                        customer.get('region', '')
                    ))
                    created_count += 1
            except Exception as e:
                errors.append({
                    'row': idx + 1,
                    'error': str(e)
                })
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={
                'created': created_count,
                'updated': updated_count,
                'skipped': skipped_count,
                'errors': errors
            },
            message=f"Processed {len(customers)} customers: {created_count} created, {updated_count} updated, {skipped_count} skipped"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error bulk creating customers: {str(e)}")

@router.post("/bulk_create_products", response_model=ForecastResponse)
async def bulk_create_products(products_data: Dict[str, Any]):
    """
    Bulk create products from CSV import
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        products = products_data.get('products', [])
        options = products_data.get('options', {})
        merge_strategy = options.get('merge_strategy', 'skip')  # 'skip', 'update', 'create_new'
        
        if not products:
            raise HTTPException(status_code=400, detail="No product data provided")
        
        created_count = 0
        updated_count = 0
        skipped_count = 0
        errors = []
        
        for idx, product in enumerate(products):
            try:
                unit_id = product.get('unit_id') or product.get('product_id')
                unit_name = product.get('unit_name') or product.get('product_name', '')
                
                if not unit_id or not unit_name:
                    errors.append({
                        'row': idx + 1,
                        'error': 'Missing unit_id or unit_name'
                    })
                    continue
                
                # Check if product exists
                cursor.execute("SELECT unit_id FROM units WHERE unit_id = ?", (unit_id,))
                exists = cursor.fetchone()
                
                if exists:
                    if merge_strategy == 'skip':
                        skipped_count += 1
                        continue
                    elif merge_strategy == 'update':
                        cursor.execute("""
                            UPDATE units 
                            SET unit_name = ?, unit_description = ?, base_price = ?, unit_type = ?, bom_id = ?, router_id = ?
                            WHERE unit_id = ?
                        """, (
                            unit_name,
                            product.get('unit_description', ''),
                            product.get('base_price', 0) or 0,
                            product.get('unit_type', ''),
                            product.get('bom_id', ''),
                            product.get('router_id', ''),
                            unit_id
                        ))
                        updated_count += 1
                    elif merge_strategy == 'create_new':
                        # Generate new ID
                        cursor.execute("SELECT unit_id FROM units ORDER BY unit_id DESC LIMIT 1")
                        last = cursor.fetchone()
                        if last and last[0].startswith('PROD-'):
                            num = int(last[0].split('-')[1]) + 1
                            unit_id = f"PROD-{num:03d}"
                        else:
                            unit_id = "PROD-001"
                        cursor.execute("""
                            INSERT INTO units (unit_id, unit_name, unit_description, base_price, unit_type, bom_id, router_id)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, (
                            unit_id,
                            unit_name,
                            product.get('unit_description', ''),
                            product.get('base_price', 0) or 0,
                            product.get('unit_type', ''),
                            product.get('bom_id', ''),
                            product.get('router_id', '')
                        ))
                        created_count += 1
                else:
                    cursor.execute("""
                        INSERT INTO units (unit_id, unit_name, unit_description, base_price, unit_type, bom_id, router_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, (
                        unit_id,
                        unit_name,
                        product.get('unit_description', ''),
                        product.get('base_price', 0) or 0,
                        product.get('unit_type', ''),
                        product.get('bom_id', ''),
                        product.get('router_id', '')
                    ))
                    created_count += 1
            except Exception as e:
                errors.append({
                    'row': idx + 1,
                    'error': str(e)
                })
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={
                'created': created_count,
                'updated': updated_count,
                'skipped': skipped_count,
                'errors': errors
            },
            message=f"Processed {len(products)} products: {created_count} created, {updated_count} updated, {skipped_count} skipped"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error bulk creating products: {str(e)}")

@router.post("/smart_import_sales", response_model=ForecastResponse)
async def smart_import_sales(sales_data: Dict[str, Any]):
    """
    Smart import sales forecast with auto-creation of missing customers/products
    """
    try:
        from db.database import db_manager
        
        conn = db_manager.get_connection()
        cursor = conn.cursor()
        
        sales = sales_data.get('sales', [])
        options = sales_data.get('options', {})
        auto_create = options.get('autoCreate', True)
        forecast_id = sales_data.get('forecast_id')

        if not sales:
            raise HTTPException(status_code=400, detail="No sales data provided")
        if not forecast_id:
            raise HTTPException(status_code=400, detail="forecast_id is required")
        
        # Get existing customers and products
        cursor.execute("SELECT customer_id, customer_name FROM customers")
        existing_customers = {row[0]: row[1] for row in cursor.fetchall()}
        
        cursor.execute("SELECT unit_id, unit_name FROM units")
        existing_products = {row[0]: row[1] for row in cursor.fetchall()}
        
        # Detect missing items
        missing_customers = {}
        missing_products = {}
        
        for sale in sales:
            customer_id = sale.get('customer_id')
            product_id = sale.get('product_id') or sale.get('unit_id')
            
            if customer_id and customer_id not in existing_customers:
                if customer_id not in missing_customers:
                    missing_customers[customer_id] = customer_id
            
            if product_id and product_id not in existing_products:
                if product_id not in missing_products:
                    missing_products[product_id] = product_id
        
        # Auto-create missing items if enabled
        created_customers = []
        created_products = []
        
        if auto_create and missing_customers:
            for customer_id in missing_customers.keys():
                try:
                    cursor.execute("""
                        INSERT INTO customers (customer_id, customer_name, customer_type, region)
                        VALUES (?, ?, ?, ?)
                    """, (customer_id, customer_id, 'Unknown', 'Unknown'))
                    created_customers.append(customer_id)
                    existing_customers[customer_id] = customer_id
                except sqlite3.IntegrityError:
                    pass  # Already exists
        
        if auto_create and missing_products:
            for product_id in missing_products.keys():
                try:
                    cursor.execute("""
                        INSERT INTO units (unit_id, unit_name, base_price)
                        VALUES (?, ?, ?)
                    """, (product_id, product_id, 0))
                    created_products.append(product_id)
                    existing_products[product_id] = product_id
                except sqlite3.IntegrityError:
                    pass  # Already exists
        
        # Import sales data
        imported_count = 0
        errors = []
        
        for idx, sale in enumerate(sales):
            try:
                customer_id = sale.get('customer_id')
                product_id = sale.get('product_id') or sale.get('unit_id')
                period = sale.get('period', '')
                quantity = float(sale.get('quantity', 0))
                price = float(sale.get('price') or sale.get('unit_price', 0))
                
                # Validate
                if not customer_id or not product_id or not period:
                    errors.append({
                        'row': idx + 1,
                        'error': 'Missing required fields'
                    })
                    continue
                
                if customer_id not in existing_customers:
                    errors.append({
                        'row': idx + 1,
                        'error': f'Customer {customer_id} does not exist'
                    })
                    continue
                
                if product_id not in existing_products:
                    errors.append({
                        'row': idx + 1,
                        'error': f'Product {product_id} does not exist'
                    })
                    continue
                
                # Normalize period to standard format (YYYY-MM, YYYY-QX, or YYYY-WXX)
                from utils.period_normalizer import normalize_period
                normalized_period = normalize_period(period)
                if normalized_period:
                    period = normalized_period
                else:
                    errors.append({
                        'row': idx + 1,
                        'error': f'Invalid period format: {period}'
                    })
                    continue
                
                sale_id = f"SAL-{uuid.uuid4().hex[:8].upper()}"
                total_revenue = quantity * price
                
                # Check if exists
                cursor.execute("""
                    SELECT sale_id FROM sales 
                    WHERE customer_id = ? AND unit_id = ? AND period = ? AND forecast_id = ?
                """, (customer_id, product_id, period, forecast_id))
                
                if cursor.fetchone():
                    # Update existing
                    cursor.execute("""
                        UPDATE sales 
                        SET quantity = ?, unit_price = ?, total_revenue = ?
                        WHERE customer_id = ? AND unit_id = ? AND period = ? AND forecast_id = ?
                    """, (quantity, price, total_revenue, customer_id, product_id, period, forecast_id))
                else:
                    # Insert new
                    cursor.execute("""
                        INSERT INTO sales (sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, forecast_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (sale_id, customer_id, product_id, period, quantity, price, total_revenue, forecast_id))
                
                imported_count += 1
            except Exception as e:
                errors.append({
                    'row': idx + 1,
                    'error': str(e)
                })
        
        conn.commit()
        db_manager.close_connection(conn)
        
        return ForecastResponse(
            status="success",
            data={
                'imported': imported_count,
                'created_customers': created_customers,
                'created_products': created_products,
                'errors': errors
            },
            message=f"Imported {imported_count} sales records. Created {len(created_customers)} customers and {len(created_products)} products."
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error smart importing sales: {str(e)}")