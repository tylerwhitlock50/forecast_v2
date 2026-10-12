from typing import Any, Dict, List, Optional, Tuple

import db.database as dbmod
from utils.cost_rollup import calculate_unit_costs
from utils.period_normalizer import is_valid_period

# Lists are capped so the report stays readable for a 12-month forecast; counts are always exact.
_LIST_LIMIT = 500
# A line's material_cost may differ from qty x unit_price by rounding only.
_COST_TOLERANCE = 0.01


def _rows(cursor, sql: str, columns: List[str], params: Tuple = ()) -> List[Dict[str, Any]]:
    cursor.execute(sql, params)
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


_BOM_WARNINGS = {"missing_bom", "bom_version_not_found"}


def _bom_reason(cursor, bom_id: Optional[str], costs: Dict[str, Any]) -> Tuple[str, List[str]]:
    """Why calculate_unit_costs could not cost the product's BOM, plus the versions that do have lines."""
    if not bom_id:
        return "no_bom_assigned", []
    versions = costs.get("bom_versions_available")
    if versions is None:
        cursor.execute("SELECT DISTINCT version FROM bom WHERE bom_id = ?", (bom_id,))
        versions = [v for (v,) in cursor.fetchall()]
    versions = sorted((str(v) for v in versions if v is not None))
    if not versions:
        return "bom_has_no_lines", []
    if "bom_version_not_found" in costs["warnings"]:
        return "bom_version_has_no_lines", versions
    return "bom_cost_is_zero", versions


def _router_reason(cursor, router_id: Optional[str]) -> str:
    if not router_id:
        return "no_router_assigned"
    cursor.execute("SELECT 1 FROM router_definitions WHERE router_id = ?", (router_id,))
    return "router_has_no_operations" if cursor.fetchone() else "router_not_defined"


def get_data_quality_issues() -> Dict[str, Any]:
    """
    Master-data checks behind the COGS numbers (GET /database/quality and the
    MCP forecast_data_quality tool).

    Product costs come from ``utils.cost_rollup.calculate_unit_costs``, the
    same function the statements engine uses, so a product is flagged here
    exactly when the reports warn about it. Every list holds row details (up
    to 500 entries); ``summary`` has the exact count of each list and
    ``total_issues``.

    * ``sales_missing_bom`` - sales rows whose product has no usable BOM
    * ``products_missing_bom`` - products with no BOM, a BOM version without
      lines (``available_versions`` lists the ones that exist) or $0 lines;
      ``sales_rows`` says how many sales rows it affects
    * ``products_missing_router`` - products with no routing, or a routing
      without operations / without a header
    * ``product_cost_warnings`` - every cost warning per product
    * ``bom_versions_without_lines`` - BOM headers whose version has no lines
    * ``bom_lines_without_header`` - BOM ids with lines but no header (hidden
      on the BOM screen)
    * ``bom_line_issues`` - lines with no / zero qty, no unit_price, no
      material_cost, or material_cost != qty x unit_price
    * ``routers_without_operations`` - routing headers with no operations
    * ``routers_missing_machine`` - operations whose machine does not exist
    * ``operations_missing_labor_rate`` - operations whose labor type does
      not exist
    * ``operations_labor_without_type`` - operations with labor minutes but
      no labor type (their labor costs $0)
    * ``employees_missing_labor_rate`` - payroll labor types that match no
      labor rate (by id or name)
    """
    conn = dbmod.db_manager.get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SELECT unit_id, COUNT(*) FROM sales GROUP BY unit_id")
        sales_rows = {unit_id: count for unit_id, count in cursor.fetchall()}

        products = _rows(cursor, "SELECT unit_id, unit_name, bom_id, bom_version, router_id FROM units ORDER BY unit_id",
                         ["unit_id", "unit_name", "bom_id", "bom_version", "router_id"])
        cost_cache: Dict[Tuple, Dict[str, Any]] = {}
        products_missing_bom: List[Dict[str, Any]] = []
        products_missing_router: List[Dict[str, Any]] = []
        product_cost_warnings: List[Dict[str, Any]] = []
        units_without_bom: List[str] = []
        for product in products:
            key = (product["bom_id"] or None, product["bom_version"], product["router_id"] or None)
            if key not in cost_cache:
                cost_cache[key] = calculate_unit_costs(cursor, *key)
            costs = cost_cache[key]
            warnings = costs["warnings"]
            if not warnings:
                continue
            count = sales_rows.get(product["unit_id"], 0)
            base = {"unit_id": product["unit_id"], "unit_name": product["unit_name"], "sales_rows": count}
            product_cost_warnings.append({**base, "warnings": list(warnings)})
            if _BOM_WARNINGS.intersection(warnings):
                reason, versions = _bom_reason(cursor, product["bom_id"], costs)
                products_missing_bom.append({**base, "bom_id": product["bom_id"] or None,
                                             "bom_version": product["bom_version"], "reason": reason,
                                             "available_versions": versions})
                units_without_bom.append(product["unit_id"])
            if "missing_router" in warnings:
                products_missing_router.append({**base, "router_id": product["router_id"] or None,
                                                "reason": _router_reason(cursor, product["router_id"])})

        # Sales rows of products without a usable BOM, plus sales of products that do not exist.
        missing_bom_units = set(units_without_bom)
        cursor.execute("SELECT unit_id FROM units")
        known_units = {u for (u,) in cursor.fetchall()}
        sales_missing_bom = [
            row for row in _rows(cursor, "SELECT sale_id, unit_id, customer_id, forecast_id, period FROM sales "
                                         "ORDER BY forecast_id, unit_id, period, customer_id",
                                 ["sale_id", "unit_id", "customer_id", "forecast_id", "period"])
            if row["unit_id"] in missing_bom_units or row["unit_id"] not in known_units
        ]

        bom_versions_without_lines = _rows(cursor, """
            SELECT d.bom_id, d.bom_name, d.version FROM bom_definitions d
            WHERE NOT EXISTS (SELECT 1 FROM bom b WHERE b.bom_id = d.bom_id AND b.version = d.version)
            ORDER BY d.bom_id""", ["bom_id", "bom_name", "version"])
        bom_lines_without_header = _rows(cursor, """
            SELECT b.bom_id, COUNT(*), GROUP_CONCAT(DISTINCT b.version) FROM bom b
            WHERE NOT EXISTS (SELECT 1 FROM bom_definitions d WHERE d.bom_id = b.bom_id)
            GROUP BY b.bom_id ORDER BY b.bom_id""", ["bom_id", "lines", "versions"])

        bom_line_issues = []
        for line in _rows(cursor, "SELECT bom_id, version, bom_line, material_description, qty, unit_price, "
                                  "material_cost FROM bom ORDER BY bom_id, version, bom_line",
                          ["bom_id", "version", "bom_line", "material_description", "qty", "unit_price",
                           "material_cost"]):
            qty, price, cost = line["qty"], line["unit_price"], line["material_cost"]
            if not isinstance(qty, (int, float)) or qty == 0:
                issue = "missing_qty"
            elif not isinstance(price, (int, float)):
                issue = "missing_unit_price"
            elif not isinstance(cost, (int, float)):
                issue = "missing_material_cost"
            elif abs(cost - qty * price) > max(_COST_TOLERANCE, 0.0001 * abs(cost)):
                issue = "material_cost_mismatch"
            else:
                continue
            bom_line_issues.append({**line, "issue": issue,
                                    "expected_material_cost": qty * price
                                    if isinstance(qty, (int, float)) and isinstance(price, (int, float)) else None})

        routers_without_operations = _rows(cursor, """
            SELECT r.router_id, r.router_name FROM router_definitions r
            WHERE NOT EXISTS (SELECT 1 FROM router_operations o WHERE o.router_id = r.router_id)
            ORDER BY r.router_id""", ["router_id", "router_name"])
        routers_missing_machine = _rows(cursor, """
            SELECT o.router_id, o.sequence, o.operation_id, o.machine_id FROM router_operations o
            WHERE o.machine_id IS NOT NULL AND o.machine_id != ''
              AND NOT EXISTS (SELECT 1 FROM machines m WHERE m.machine_id = o.machine_id)
            ORDER BY o.router_id, o.sequence""", ["router_id", "sequence", "operation_id", "machine_id"])
        operations_missing_labor_rate = _rows(cursor, """
            SELECT o.router_id, o.sequence, o.operation_id, o.labor_type_id FROM router_operations o
            WHERE o.labor_type_id IS NOT NULL AND o.labor_type_id != ''
              AND NOT EXISTS (SELECT 1 FROM labor_rates l WHERE l.rate_id = o.labor_type_id)
            ORDER BY o.router_id, o.sequence""", ["router_id", "sequence", "operation_id", "labor_type_id"])
        operations_labor_without_type = _rows(cursor, """
            SELECT router_id, sequence, operation_id, labor_minutes FROM router_operations
            WHERE COALESCE(labor_minutes, 0) > 0 AND (labor_type_id IS NULL OR labor_type_id = '')
            ORDER BY router_id, sequence""", ["router_id", "sequence", "operation_id", "labor_minutes"])
        employees_missing_labor_rate = _rows(cursor, """
            SELECT p.employee_id, p.labor_type FROM payroll p
            WHERE p.labor_type IS NOT NULL AND TRIM(p.labor_type) != ''
              AND NOT EXISTS (SELECT 1 FROM labor_rates l
                              WHERE LOWER(TRIM(l.rate_name)) = LOWER(TRIM(p.labor_type))
                                 OR LOWER(TRIM(l.rate_id)) = LOWER(TRIM(p.labor_type)))
            ORDER BY p.employee_id""", ["employee_id", "labor_type"])

        lists = {
            "sales_missing_bom": sales_missing_bom,
            "products_missing_bom": products_missing_bom,
            "products_missing_router": products_missing_router,
            "product_cost_warnings": product_cost_warnings,
            "bom_versions_without_lines": bom_versions_without_lines,
            "bom_lines_without_header": bom_lines_without_header,
            "bom_line_issues": bom_line_issues,
            "routers_without_operations": routers_without_operations,
            "routers_missing_machine": routers_missing_machine,
            "operations_missing_labor_rate": operations_missing_labor_rate,
            "operations_labor_without_type": operations_labor_without_type,
            "employees_missing_labor_rate": employees_missing_labor_rate,
        }
        summary = {f"{key}_count": len(items) for key, items in lists.items()}
        # product_cost_warnings repeats the product lists; it is not counted twice.
        summary["total_issues"] = sum(len(items) for key, items in lists.items() if key != "product_cost_warnings")
        summary["products_checked"] = len(products)
        result = {
            "status": "success",
            "data": {**{key: items[:_LIST_LIMIT] for key, items in lists.items()}, "summary": summary},
        }
    except Exception as e:
        result = {"status": "error", "error": str(e)}
    finally:
        dbmod.db_manager.close_connection(conn)

    return result


def _blank(value: Any) -> bool:
    return value is None or str(value).strip() == ""


def get_incomplete_items() -> Dict[str, Any]:
    """
    Customers and products missing a field that changes the numbers, sales
    rows pointing at missing records, and sales periods that cannot be read.

    Only fields the model uses count as missing (each row lists them in
    ``missing``):

    * customers: ``customer_type`` (customer-type prices and deduction rules
      cannot apply without it). The region is optional and not checked.
    * products: ``unit_name`` and a ``base_price`` above zero (the fallback
      price when no price-list entry matches). The description is optional
      and not checked.
    """
    conn = dbmod.db_manager.get_connection()
    cursor = conn.cursor()

    try:
        incomplete_customers = []
        for row in _rows(cursor, "SELECT customer_id, customer_name, customer_type, region FROM customers "
                                 "ORDER BY customer_id",
                         ["customer_id", "customer_name", "customer_type", "region"]):
            missing = ["customer_type"] if _blank(row["customer_type"]) else []
            if missing:
                incomplete_customers.append({**row, "missing": missing})

        incomplete_products = []
        for row in _rows(cursor, "SELECT unit_id, unit_name, base_price, unit_description FROM units ORDER BY unit_id",
                         ["unit_id", "unit_name", "base_price", "unit_description"]):
            missing = []
            if _blank(row["unit_name"]):
                missing.append("unit_name")
            price = row["base_price"]
            if not isinstance(price, (int, float)) or isinstance(price, bool) or price <= 0:
                missing.append("base_price")
            if missing:
                incomplete_products.append({**row, "missing": missing})

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
        dbmod.db_manager.close_connection(conn)

    return result
