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
themselves; divergences can no longer creep back in. The line / operation
detail behind the totals comes from `load_bom_lines` and
`load_router_operations`, so a breakdown always adds up to the totals.

The module also holds the scenario + period-window resolution shared by the
cost endpoints (`resolve_forecast_id`, `resolve_cost_window`).
"""
import math
import re
from typing import Any, Dict, List, Optional, Tuple

DEFAULT_BOM_VERSION = "1.0"

_NUMERIC_VERSION_RE = re.compile(r"^[vV]?(\d+)(?:\.(\d+))?$")


# ---------------------------------------------------------------------------
# BOM lines
# ---------------------------------------------------------------------------

def _number(value: Any) -> Optional[float]:
    """float(value), or None when blank, NaN or not a number ('1,250.50' and '$3' parse)."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return None if isinstance(value, float) and math.isnan(value) else float(value)
    text = str(value).strip().replace(",", "").replace("$", "")
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return None if math.isnan(number) else number


def _blank(value: Any) -> bool:
    return value is None or not str(value).strip()


def bom_line_cost(qty: Any, unit_price: Any, material_cost: Any) -> float:
    """
    Material cost of one BOM line per finished unit: qty x unit_price when
    both are present and unit_price is non-zero, else the stored
    material_cost (0 when that is blank too). ERP exports usually carry only
    quantity and unit price, and a stored material_cost goes stale when the
    price is edited, so the extended price wins whenever it can be computed.
    """
    q = _number(qty)
    price = _number(unit_price)
    if q is not None and price:
        return q * price
    return _number(material_cost) or 0.0


def version_key(value: Any) -> str:
    """
    Comparison key for BOM versions: '1', '1.0', '1.00', 'v1' and 1 all give
    '1.0'; '1.5' stays '1.5' ('1.10' is not '1.1'); a blank version is the
    schema default '1.0'; any other text is trimmed and lower-cased.
    """
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if _blank(value):
        return DEFAULT_BOM_VERSION
    text = str(value).strip()
    match = _NUMERIC_VERSION_RE.match(text)
    if match:
        major, minor = int(match.group(1)), match.group(2)
        if minor is None or not minor.strip("0"):
            return f"{major}.0"
        return f"{major}.{minor}"
    return text.lower()


def resolve_bom_version(cursor, bom_id: Optional[str], bom_version: Any) -> Tuple[bool, Any, List[Any]]:
    """
    Which stored version of `bom_id` a product pointing at `bom_version` uses.

    Returns (found, version, versions_available). Matching is tolerant:
    exact text first, then the normalised form (`version_key`: '1' == '1.0'
    == '1.00'), then, when the product has no version and the BOM has
    exactly one, that version. `version` is the stored value (it may be
    NULL), so callers query with `version IS ?`.
    """
    if not bom_id:
        return False, None, []
    cursor.execute("SELECT DISTINCT version FROM bom WHERE bom_id = ?", (bom_id,))
    versions = sorted((row[0] for row in cursor.fetchall()), key=lambda v: (v is not None, str(v)))
    if not versions:
        return False, None, []
    if bom_version in versions:
        return True, bom_version, versions
    wanted = version_key(bom_version)
    matches = [v for v in versions if version_key(v) == wanted]
    if matches:
        return True, matches[0], versions
    if _blank(bom_version) and len(versions) == 1:
        return True, versions[0], versions
    return False, None, versions


def load_bom_lines(cursor, bom_id: Optional[str], bom_version: Any) -> Dict[str, Any]:
    """
    The BOM lines a product with (bom_id, bom_version) is costed from.

    Returns {"found", "version_used", "versions_available", "lines"}; each
    line carries bom_line, material_description, qty, unit, unit_price,
    material_cost (as stored), qty_per_unit (qty as a number, 0 when blank)
    and line_cost (`bom_line_cost`, per finished unit). `lines` is empty when the BOM or the version does not exist.
    """
    found, version, versions = resolve_bom_version(cursor, bom_id, bom_version)
    lines: List[Dict[str, Any]] = []
    if found:
        cursor.execute(
            """
            SELECT bom_line, material_description, qty, unit, unit_price, material_cost
            FROM bom WHERE bom_id = ? AND version IS ?
            ORDER BY bom_line
            """,
            (bom_id, version),
        )
        for bom_line, description, qty, unit, unit_price, material_cost in cursor.fetchall():
            lines.append({
                "bom_line": bom_line,
                "material_description": description,
                "qty": qty,
                "unit": unit,
                "unit_price": unit_price,
                "material_cost": material_cost,
                "qty_per_unit": _number(qty) or 0.0,
                "line_cost": bom_line_cost(qty, unit_price, material_cost),
            })
    return {"found": found, "version_used": version if found else None,
            "versions_available": versions, "lines": lines}


# ---------------------------------------------------------------------------
# Routing operations
# ---------------------------------------------------------------------------

def load_router_operations(cursor, router_id: Optional[str]) -> List[Dict[str, Any]]:
    """
    Routing steps of `router_id` costed per finished unit: minutes x rate / 60
    for labor and machine, a missing machine or labor rate costing $0 (never
    a made-up default). A blank labor_type_id / machine_id is reported as None.
    """
    if not router_id:
        return []
    cursor.execute(
        """
        SELECT
            ro.sequence,
            ro.operation_description,
            ro.labor_minutes,
            ro.machine_minutes,
            m.machine_rate,
            lr.rate_amount,
            ro.labor_type_id,
            ro.machine_id,
            m.machine_id  AS matched_machine_id,
            lr.rate_id    AS matched_rate_id,
            m.machine_name,
            lr.rate_name
        FROM router_operations ro
        LEFT JOIN machines   m  ON ro.machine_id    = m.machine_id
        LEFT JOIN labor_rates lr ON ro.labor_type_id = lr.rate_id
        WHERE ro.router_id = ?
        ORDER BY ro.sequence
        """,
        (router_id,),
    )
    operations: List[Dict[str, Any]] = []
    for (sequence, description, labor_minutes, machine_minutes, machine_rate, rate_amount, labor_type_id,
         machine_id, matched_machine_id, matched_rate_id, machine_name, rate_name) in cursor.fetchall():
        labor_minutes = _number(labor_minutes) or 0.0
        machine_minutes = _number(machine_minutes) or 0.0
        machine_rate = _number(machine_rate) or 0.0
        labor_rate = _number(rate_amount) or 0.0
        operations.append({
            "sequence": sequence,
            "operation_description": description,
            "machine_id": None if _blank(machine_id) else machine_id,
            "machine_name": machine_name,
            "machine_found": matched_machine_id is not None,
            "machine_rate": machine_rate,
            "machine_minutes": machine_minutes,
            "machine_cost": (machine_minutes / 60.0) * machine_rate,
            "labor_type_id": None if _blank(labor_type_id) else labor_type_id,
            "labor_type_name": rate_name,
            "labor_rate_found": matched_rate_id is not None,
            "labor_rate": labor_rate,
            "labor_minutes": labor_minutes,
            "labor_cost": (labor_minutes / 60.0) * labor_rate,
        })
    return operations


# ---------------------------------------------------------------------------
# Per-unit rollup
# ---------------------------------------------------------------------------

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
            "labor_minutes_per_unit":   float,
            "machine_minutes_per_unit": float,
            "labor_by_type":  {labor_type_id: {"minutes": m, "cost": c}},  # per unit
            "machine_by_id":  {machine_id:    {"minutes": m, "cost": c}},  # per unit
            "bom_version_used":       stored BOM version costed (None if none),
            "bom_versions_available": [versions of bom_id in the bom table],
            "warnings":          [str],   # codes, see WARNING_CODES below
        }

    labor_by_type / machine_by_id add up exactly to labor_per_unit /
    machine_per_unit, so a labor or machine-hours forecast built from them
    reconciles to the COGS lines. Operations without a labor type are
    bucketed under "unassigned".

    Material per BOM line is qty x unit_price when both are present and the
    price is non-zero, else the stored material_cost (`bom_line_cost`). The
    BOM version is matched tolerantly (`resolve_bom_version`).

    Warning codes:
      missing_bom                - no BOM assigned, the bom_id has no rows
                                   in the bom table, or its lines cost $0
      bom_version_not_found      - the BOM exists but not in the product's
                                   version; bom_versions_available lists the
                                   versions that do (material cost is 0)
      missing_router             - no router assigned, or router has no
                                   operations
      router_missing_machine     - at least one op references a machine_id
                                   that doesn't exist (its machine cost
                                   for that op is treated as 0)
      router_labor_without_type  - at least one op has labor minutes but
                                   no labor_type_id (its labor cost is 0)
      router_missing_labor_rate  - at least one op references a
                                   labor_type_id not in labor_rates
                                   (its labor cost for that op is 0)
    """
    warnings: List[str] = []

    # --- material ---
    material_per_unit = 0.0
    bom = load_bom_lines(cursor, bom_id, bom_version) if bom_id else None
    if bom is None or not bom["versions_available"]:
        warnings.append("missing_bom")
    elif not bom["found"]:
        warnings.append("bom_version_not_found")
    else:
        material_per_unit = float(sum(line["line_cost"] for line in bom["lines"]))
        if material_per_unit == 0:
            warnings.append("missing_bom")

    # --- labor + machine ---
    labor_per_unit = 0.0
    machine_per_unit = 0.0
    labor_minutes_per_unit = 0.0
    machine_minutes_per_unit = 0.0
    labor_by_type: Dict[str, Dict[str, float]] = {}
    machine_by_id: Dict[str, Dict[str, float]] = {}

    operations = load_router_operations(cursor, router_id)
    if not operations:
        warnings.append("missing_router")
    else:
        saw_missing_machine = False
        saw_missing_rate = False
        saw_unassigned_labor = False
        for op in operations:
            labor_minutes = op["labor_minutes"]
            machine_minutes = op["machine_minutes"]
            labor_per_unit += op["labor_cost"]
            machine_per_unit += op["machine_cost"]
            labor_minutes_per_unit += labor_minutes
            machine_minutes_per_unit += machine_minutes
            if labor_minutes:
                entry = labor_by_type.setdefault(op["labor_type_id"] or "unassigned", {"minutes": 0.0, "cost": 0.0})
                entry["minutes"] += labor_minutes
                entry["cost"] += op["labor_cost"]
            if machine_minutes:
                entry = machine_by_id.setdefault(op["machine_id"] or "unassigned", {"minutes": 0.0, "cost": 0.0})
                entry["minutes"] += machine_minutes
                entry["cost"] += op["machine_cost"]

            if op["machine_id"] and not op["machine_found"]:
                saw_missing_machine = True
            if op["labor_type_id"] and not op["labor_rate_found"]:
                saw_missing_rate = True
            if labor_minutes and not op["labor_type_id"]:
                saw_unassigned_labor = True

        if saw_missing_machine:
            warnings.append("router_missing_machine")
        if saw_missing_rate:
            warnings.append("router_missing_labor_rate")
        if saw_unassigned_labor:
            warnings.append("router_labor_without_type")

    return {
        "material_per_unit": material_per_unit,
        "labor_per_unit": labor_per_unit,
        "machine_per_unit": machine_per_unit,
        "labor_minutes_per_unit": labor_minutes_per_unit,
        "machine_minutes_per_unit": machine_minutes_per_unit,
        "labor_by_type": labor_by_type,
        "machine_by_id": machine_by_id,
        "bom_version_used": bom["version_used"] if bom else None,
        "bom_versions_available": bom["versions_available"] if bom else [],
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Scenario + period window for the cost endpoints
# ---------------------------------------------------------------------------

def resolve_forecast_id(cursor, forecast_id: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """
    The scenario a cost endpoint reports on, and why: (id, "requested") when
    the caller named one; otherwise the base scenario (forecast.is_base = 1,
    "base"), else the lowest forecast_id ("first"; the forecast table, then
    the sales rows). (None, None) when there is none. Scenarios are never
    summed together.
    """
    if forecast_id is not None and str(forecast_id).strip():
        return str(forecast_id).strip(), "requested"
    for sql, source in (
        ("SELECT forecast_id FROM forecast WHERE is_base = 1 ORDER BY forecast_id LIMIT 1", "base"),
        ("SELECT MIN(forecast_id) FROM forecast", "first"),
        ("SELECT MIN(forecast_id) FROM sales", "first"),
    ):
        cursor.execute(sql)
        row = cursor.fetchone()
        if row and row[0] is not None:
            return row[0], source
    return None, None


def month_sql(column: str) -> str:
    """
    SQL condition: the first seven characters of `column` are a real month
    (2027-01 .. 2027-12). '2027-12-01' counts as 2027-12; '2027-Q1',
    '11/1/2027' and '2027-13' do not.
    """
    return (f"substr({column}, 1, 7) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' "
            f"AND CAST(substr({column}, 6, 2) AS INTEGER) BETWEEN 1 AND 12")


def scenario_sales_window(cursor, forecast_id: Optional[str]) -> Dict[str, Any]:
    """
    First and last YYYY-MM month with sales in the scenario (a period stored
    as '2027-12-01' counts as 2027-12), plus the number of rows whose period
    is not a month and so cannot be reported ('2027-Q1', '11/1/2027').
    """
    if not forecast_id:
        return {"start_period": None, "end_period": None, "non_monthly_rows": 0}
    is_month = month_sql("period")
    cursor.execute(
        f"""
        SELECT MIN(CASE WHEN {is_month} THEN substr(period, 1, 7) END),
               MAX(CASE WHEN {is_month} THEN substr(period, 1, 7) END),
               SUM(CASE WHEN period IS NOT NULL AND {is_month} THEN 0 ELSE 1 END)
        FROM sales WHERE forecast_id = ?
        """,
        (forecast_id,),
    )
    start, end, non_monthly = cursor.fetchone()
    return {"start_period": start, "end_period": end, "non_monthly_rows": int(non_monthly or 0)}


def _month_param(value: Optional[str], name: str) -> Optional[str]:
    """A start / end query parameter as YYYY-MM (None when blank); ValueError when it is not a month."""
    if value is None or not str(value).strip():
        return None
    from utils.period_normalizer import normalize_month

    month = normalize_month(str(value).strip())
    if not month:
        raise ValueError(f"{name} must be a month such as 2027-01 (got '{value}')")
    return month


def resolve_cost_window(cursor, forecast_id: Optional[str], start_period: Optional[str],
                        end_period: Optional[str]) -> Dict[str, Any]:
    """
    Scenario and inclusive month window a cost endpoint reports on.

    The scenario comes from `resolve_forecast_id`. A missing start / end
    defaults to the scenario's first / last month with sales, so omitting
    both covers the whole scenario. Returns {"forecast_id",
    "forecast_id_source", "start_period", "end_period", "periods",
    "months_in_window", "scenario_start_period", "scenario_end_period",
    "non_monthly_rows", "window_defaulted"}; periods is empty when the
    scenario has no monthly sales and no window was given. Raises ValueError
    for a period that is not a month or a start after the end.
    """
    from services.financial_statements import period_range

    start = _month_param(start_period, "start_period")
    end = _month_param(end_period, "end_period")
    if start and end and start > end:
        raise ValueError(f"start_period {start} is after end_period {end}")

    fid, source = resolve_forecast_id(cursor, forecast_id)
    window = scenario_sales_window(cursor, fid)
    first, last = window["start_period"], window["end_period"]

    resolved_start = start or (min(first, end) if first and end else first) or end
    resolved_end = end or (max(last, start) if last and start else last) or start
    periods = period_range(resolved_start, resolved_end) if resolved_start and resolved_end else []
    return {
        "forecast_id": fid,
        "forecast_id_source": source,
        "start_period": resolved_start,
        "end_period": resolved_end,
        "periods": periods,
        "months_in_window": len(periods),
        "scenario_start_period": first,
        "scenario_end_period": last,
        "non_monthly_rows": window["non_monthly_rows"],
        "window_defaulted": not (start and end),
    }


def scope_metadata(scope: Dict[str, Any]) -> Dict[str, Any]:
    """The scenario / window fields every cost endpoint echoes in its response."""
    return {key: scope[key] for key in (
        "forecast_id", "forecast_id_source", "start_period", "end_period", "months_in_window",
        "scenario_start_period", "scenario_end_period", "non_monthly_rows", "window_defaulted",
    )}


def load_scope_lines(cursor, scope: Dict[str, Any]) -> Dict[str, Any]:
    """
    services.financial_statements.load_sales_lines for the scope's scenario
    and window (the rows the statements use), or an empty result when the
    scope has no scenario or no months.
    """
    from services.financial_statements import load_sales_lines

    if not scope["forecast_id"] or not scope["periods"]:
        return {"lines": [], "unit_costs": {}, "cost_warnings": {}, "non_monthly_rows": 0,
                "deduction_rule_count": 0, "rows_with_deductions": 0}
    return load_sales_lines(cursor, [scope["forecast_id"]], scope["periods"])


def scope_warnings(cursor, scope: Dict[str, Any], loaded: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """
    Warnings about what a cost endpoint could not include: an unknown or
    missing scenario, sales rows whose period is not a month, and products
    whose BOM / routing data is incomplete (cost understated).
    """
    warnings: List[Dict[str, Any]] = []
    fid = scope["forecast_id"]
    if not fid:
        warnings.append({"code": "no_scenario", "message": "There is no scenario yet, so there is nothing to report."})
    elif scope["forecast_id_source"] == "requested":
        cursor.execute("SELECT 1 FROM forecast WHERE forecast_id = ?", (fid,))
        if cursor.fetchone() is None:
            warnings.append({"code": "unknown_scenario", "message": f"Scenario {fid} does not exist."})
    if scope["non_monthly_rows"]:
        warnings.append({
            "code": "non_monthly_sales_periods",
            "message": f"{scope['non_monthly_rows']} sales row(s) in scenario {fid} have a period that is not a "
                       f"YYYY-MM month and are not included.",
        })
    if loaded and loaded.get("cost_warnings"):
        warnings.append({
            "code": "cost_warnings",
            "message": f"{len(loaded['cost_warnings'])} product(s) have incomplete BOM/routing data; "
                       f"their cost may be understated.",
            "products": loaded["cost_warnings"],
        })
    return warnings
