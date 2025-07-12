from typing import Dict, Any

from app.db.database import db_manager


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
