"""
Single source of truth for per-unit cost math.

Both /products/cost-summary and /source-data/sales-forecast need the same
per-unit breakdown of material, labor, and machine cost. Previously each
endpoint rolled its own SQL — they diverged on:

  * bom_version (cost-summary respected it, source-data ignored it)
  * missing labor rate (cost-summary -> $0, source-data -> avg payroll rate)
  * missing machine (cost-summary INNER JOIN dropped the op,
                     source-data LEFT JOIN kept it with rate 0)

Route handlers now call `calculate_unit_costs` instead of rolling SQL
themselves; divergences can no longer creep back in.
"""
from typing import Dict, List, Optional


def calculate_unit_costs(
    cursor,
    bom_id: Optional[str],
    bom_version: Optional[str],
    router_id: Optional[str],
) -> Dict:
    """
    Return per-unit cost decomposition for a product plus data-quality
    warnings. Callers multiply by forecast quantity to get absolute cost.

    Returns::

        {
            "material_per_unit": float,
            "labor_per_unit":    float,
            "machine_per_unit":  float,
            "warnings":          [str],   # codes, see WARNING_CODES below
        }

    Warning codes:
      missing_bom                - no BOM assigned, or bom_id+version has
                                   no rows in the bom table
      missing_router             - no router assigned, or router has no
                                   operations
      router_missing_machine     - at least one op references a machine_id
                                   that doesn't exist (its machine cost
                                   for that op is treated as 0)
      router_missing_labor_rate  - at least one op references a
                                   labor_type_id not in labor_rates
                                   (its labor cost for that op is 0)
    """
    warnings: List[str] = []

    # --- material ---
    material_per_unit = 0.0
    if not bom_id:
        warnings.append("missing_bom")
    else:
        cursor.execute(
            "SELECT COALESCE(SUM(material_cost), 0) "
            "FROM bom WHERE bom_id = ? AND version = ?",
            (bom_id, bom_version),
        )
        row = cursor.fetchone()
        total = row[0] if row else 0
        if total == 0:
            warnings.append("missing_bom")
        material_per_unit = float(total or 0)

    # --- labor + machine ---
    labor_per_unit = 0.0
    machine_per_unit = 0.0

    if not router_id:
        warnings.append("missing_router")
    else:
        cursor.execute(
            """
            SELECT
                ro.labor_minutes,
                ro.machine_minutes,
                m.machine_rate,
                lr.rate_amount,
                ro.labor_type_id,
                ro.machine_id,
                m.machine_id  AS matched_machine_id,
                lr.rate_id    AS matched_rate_id
            FROM router_operations ro
            LEFT JOIN machines   m  ON ro.machine_id    = m.machine_id
            LEFT JOIN labor_rates lr ON ro.labor_type_id = lr.rate_id
            WHERE ro.router_id = ?
            ORDER BY ro.sequence
            """,
            (router_id,),
        )
        rows = cursor.fetchall()

        if not rows:
            warnings.append("missing_router")
        else:
            saw_missing_machine = False
            saw_missing_rate = False
            for (
                labor_minutes,
                machine_minutes,
                machine_rate,
                rate_amount,
                labor_type_id,
                machine_id,
                matched_machine_id,
                matched_rate_id,
            ) in rows:
                labor_minutes = labor_minutes or 0
                machine_minutes = machine_minutes or 0
                machine_rate = machine_rate or 0
                rate_amount = rate_amount or 0

                labor_per_unit += (labor_minutes / 60.0) * rate_amount
                machine_per_unit += (machine_minutes / 60.0) * machine_rate

                if machine_id and not matched_machine_id:
                    saw_missing_machine = True
                if labor_type_id and not matched_rate_id:
                    saw_missing_rate = True

            if saw_missing_machine:
                warnings.append("router_missing_machine")
            if saw_missing_rate:
                warnings.append("router_missing_labor_rate")

    return {
        "material_per_unit": material_per_unit,
        "labor_per_unit": labor_per_unit,
        "machine_per_unit": machine_per_unit,
        "warnings": warnings,
    }
