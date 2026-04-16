from typing import Dict, Any, List

from db.database import db_manager
from utils.period_normalizer import normalize_period, is_valid_period


def get_data_quality_issues() -> Dict[str, Any]:
    """Identify basic data quality issues in the database."""
    conn = db_manager.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute(
            """
            SELECT sale_id, unit_id, customer_id
            FROM sales
            WHERE unit_id NOT IN (SELECT unit_id FROM bom)
            """
        )
        missing_bom = [dict(zip(["sale_id", "unit_id", "customer_id"], row)) for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT router_id, unit_id, machine_id
            FROM routers
            WHERE machine_id NOT IN (SELECT machine_id FROM machines)
            """
        )
        missing_machines = [dict(zip(["router_id", "unit_id", "machine_id"], row)) for row in cursor.fetchall()]

        cursor.execute(
            """
            SELECT employee_id, labor_type
            FROM payroll
            WHERE labor_type NOT IN (SELECT rate_name FROM labor_rates)
            """
        )
        missing_labor_rates = [dict(zip(["employee_id", "labor_type"], row)) for row in cursor.fetchall()]

        result = {
            "status": "success",
            "data": {
                "sales_missing_bom": missing_bom,
                "routers_missing_machine": missing_machines,
                "employees_missing_labor_rate": missing_labor_rates,
            },
        }
    except Exception as e:
        result = {"status": "error", "error": str(e)}
    finally:
        db_manager.close_connection(conn)

    return result


def get_incomplete_items() -> Dict[str, Any]:
    """Get customers and products with missing required fields."""
    conn = db_manager.get_connection()
    cursor = conn.cursor()

    try:
        # Incomplete customers (missing type or region)
        cursor.execute("""
            SELECT customer_id, customer_name, customer_type, region
            FROM customers
            WHERE customer_type IS NULL OR customer_type = '' 
               OR region IS NULL OR region = ''
        """)
        incomplete_customers = [
            dict(zip(["customer_id", "customer_name", "customer_type", "region"], row))
            for row in cursor.fetchall()
        ]

        # Incomplete products (missing price or description)
        cursor.execute("""
            SELECT unit_id, unit_name, base_price, unit_description
            FROM units
            WHERE base_price IS NULL OR base_price = 0
               OR unit_description IS NULL OR unit_description = ''
        """)
        incomplete_products = [
            dict(zip(["unit_id", "unit_name", "base_price", "unit_description"], row))
            for row in cursor.fetchall()
        ]

        # Orphaned sales (customer or product deleted)
        cursor.execute("""
            SELECT s.sale_id, s.customer_id, s.unit_id, s.period
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.customer_id
            LEFT JOIN units u ON s.unit_id = u.unit_id
            WHERE c.customer_id IS NULL OR u.unit_id IS NULL
        """)
        orphaned_sales = [
            dict(zip(["sale_id", "customer_id", "unit_id", "period"], row))
            for row in cursor.fetchall()
        ]

        # Sales with invalid periods (after normalization attempt)
        cursor.execute("""
            SELECT sale_id, customer_id, unit_id, period
            FROM sales
        """)
        all_sales = cursor.fetchall()
        invalid_periods = []
        
        for row in all_sales:
            sale_id, customer_id, unit_id, period = row
            if not period:
                invalid_periods.append(dict(zip(["sale_id", "customer_id", "unit_id", "period"], row)))
                continue
            
            # Check if period can be normalized to valid format
            # Accepts: YYYY-MM, YYYY-MM-DD, YYYY-QX, YYYY-WXX, YYYY-WXX-DD
            if not is_valid_period(str(period)):
                invalid_periods.append(dict(zip(["sale_id", "customer_id", "unit_id", "period"], row)))

        result = {
            "status": "success",
            "data": {
                "incomplete_customers": incomplete_customers,
                "incomplete_products": incomplete_products,
                "orphaned_sales": orphaned_sales,
                "invalid_periods": invalid_periods,
                "summary": {
                    "incomplete_customers_count": len(incomplete_customers),
                    "incomplete_products_count": len(incomplete_products),
                    "orphaned_sales_count": len(orphaned_sales),
                    "invalid_periods_count": len(invalid_periods),
                    "total_issues": len(incomplete_customers) + len(incomplete_products) + len(orphaned_sales) + len(invalid_periods)
                }
            },
        }
    except Exception as e:
        result = {"status": "error", "error": str(e)}
    finally:
        db_manager.close_connection(conn)

    return result
