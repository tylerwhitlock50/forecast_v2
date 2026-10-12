"""
Bulk import API (JSON rows from CSV / Excel files) and CSV templates.

Endpoints (all under ``/import``):

* ``POST /import/boms``         - bills of materials (replace or append lines per BOM + version)
* ``POST /import/routings``     - routings / router operations (replace or append per router)
* ``POST /import/records``      - customers, products (units), machines, labor rates (upsert or skip)
* ``POST /import/prices``       - customer / customer-type price list
* ``POST /import/deductions``   - discounts, allowances, excise tax and commission rules
* ``GET  /import/templates``    - every template with its columns and aliases
* ``GET  /import/templates/{kind}`` - one CSV template with example rows

Every write endpoint takes ``{rows: [...], mode, dry_run, ...}``. Column names
are matched case-insensitively ignoring spaces, underscores, dashes and other
punctuation, and through per-field aliases ("Qty Per" -> qty). ``dry_run``
runs the whole import in one transaction and rolls it back, so the response
is exactly what a real import would do. Errors reference the 1-based input
row. Responses share the shape ``{created, updated, replaced, skipped,
errors: [{row, error}], warnings: [...], summary, ...}``.

The sales forecast import stays ``POST /forecast/smart_import_sales``; it
uses ``SALES_FIELDS`` from this module for its column aliases.
"""
import csv
import io
import logging
import re
from typing import Any, Dict, List, Optional, Sequence, Tuple

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import Response

from api.pricing_routes import (
    RuleValidationError,
    clean_deduction_rule,
    clean_price_rule,
    insert_deduction_rule,
    insert_price_rule,
    update_deduction_rule,
    update_price_rule,
)
from db.database import db_manager
from db.models import ForecastResponse
from utils.cost_rollup import calculate_unit_costs

router = APIRouter(prefix="/import", tags=["import"])
logger = logging.getLogger(__name__)


class ImportRowError(ValueError):
    """A row cannot be imported; the message is shown next to its row number."""


# ---------------------------------------------------------------------------
# Header aliases
# ---------------------------------------------------------------------------

def header_key(name: Any) -> str:
    """Comparable form of a column name: lower case, letters and digits only."""
    return re.sub(r"[^a-z0-9]", "", str(name).lower())


def _blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and value != value:  # NaN
        return True
    return isinstance(value, str) and not value.strip()


class FieldMap:
    """
    Canonical field -> aliases. ``map_row`` renames a raw row's keys to the
    canonical names; blank cells count as absent (so an upsert never blanks a
    stored value). When several columns map to one field the canonical name
    wins, then the alias listed first.
    """

    def __init__(self, fields: Dict[str, Sequence[str]]):
        self.fields = fields
        self.lookup: Dict[str, Tuple[str, int]] = {}
        for canonical, aliases in fields.items():
            for rank, alias in enumerate((canonical, *aliases)):
                self.lookup.setdefault(header_key(alias), (canonical, rank))

    def canonical(self, column: Any) -> Optional[str]:
        hit = self.lookup.get(header_key(column))
        return hit[0] if hit else None

    def map_row(self, row: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
        out: Dict[str, Any] = {}
        ranks: Dict[str, int] = {}
        unknown: List[str] = []
        for raw_key, value in row.items():
            hit = self.lookup.get(header_key(raw_key))
            if not hit:
                if not _blank(raw_key):
                    unknown.append(str(raw_key))
                continue
            if _blank(value):
                continue
            canonical, rank = hit
            if canonical not in out or rank < ranks[canonical]:
                out[canonical] = value.strip() if isinstance(value, str) else value
                ranks[canonical] = rank
        return out, unknown

    def aliases(self, canonical: str) -> List[str]:
        return list(self.fields.get(canonical, ()))


BOM_FIELDS = FieldMap({
    "bom_id": ("bom", "bom_number", "bom_no", "parent", "parent_part", "parent_item", "parent_part_number",
               "assembly", "assembly_id", "assembly_number"),
    "bom_name": ("assembly_name", "parent_name", "parent_description"),
    "bom_description": (),
    "version": ("bom_version", "rev", "revision"),
    "bom_line": ("line", "line_number", "line_no", "find_number", "find_no"),
    "material_description": ("material", "component_description", "description", "part_description",
                             "item_description", "material_name", "component_name", "component", "item"),
    "part_number": ("part", "pn", "part_no", "component_part", "component_number", "component_id",
                    "component_part_number", "item_number", "material_id", "material_number"),
    "qty": ("quantity", "qty_per", "quantity_per", "qty_per_assembly", "usage", "qty_required"),
    "unit": ("uom", "unit_of_measure"),
    "unit_price": ("unit_cost", "cost", "price", "std_cost", "standard_cost", "cost_each", "each_cost"),
    "material_cost": ("extended_cost", "ext_cost", "line_cost", "total_cost", "extended_price"),
    "target_cost": (),
    "unit_id": ("product_id", "sku", "product", "finished_good", "fg_part_number"),
})

ROUTING_FIELDS = FieldMap({
    "router_id": ("routing", "routing_id", "router", "routing_number", "routing_no", "router_number"),
    "router_name": ("routing_name",),
    "router_description": ("routing_description",),
    "version": ("router_version", "routing_version", "rev", "revision"),
    "sequence": ("seq", "op", "operation", "step", "op_seq", "op_number", "operation_number", "op_no",
                 "operation_seq", "sequence_number"),
    "machine_id": ("machine", "work_center", "workcenter", "work_center_id", "resource", "machine_name"),
    "machine_minutes": ("machine_min", "run_minutes", "machine_time", "machine_mins", "run_time",
                        "cycle_minutes", "cycle_time", "machine_minutes_per_unit"),
    "machine_hours": ("machine_hrs", "run_hours"),
    "labor_minutes": ("labor_min", "labor_time", "labor_mins", "labour_minutes", "labor_minutes_per_unit"),
    "labor_hours": ("labor_hrs", "labour_hours"),
    "labor_type_id": ("labor_type", "labor_rate", "rate_id", "labor_rate_id", "labor_type_name", "labor_class",
                      "labor_category"),
    "operation_description": ("description", "operation_name", "op_description", "operation_desc", "op_name"),
    "unit_id": ("product_id", "sku", "product"),
})

SALES_FIELDS = FieldMap({
    "customer_id": ("customer", "customer_number", "customer_no", "customer_code", "account", "account_number",
                    "account_id", "cust_id"),
    "customer_name": ("account_name",),
    "customer_type": ("type", "channel", "class", "customer_class", "segment"),
    "unit_id": ("product_id", "product", "sku", "item", "item_number", "part_number", "product_code"),
    "unit_name": ("product_name", "item_name", "item_description", "product_description", "description"),
    "unit_type": ("product_type", "product_category", "product_family", "family"),
    "base_price": ("msrp", "list_price"),
    "period": ("month", "date", "period_start", "forecast_month", "ship_month", "year_month"),
    "quantity": ("qty", "units", "volume", "forecast_qty", "forecast_quantity", "forecast_units"),
    "unit_price": ("price", "net_price", "selling_price", "sell_price", "customer_price"),
    "total_revenue": ("revenue", "sales_amount", "sales_dollars", "extended_price", "gross_sales", "dollars"),
    "year": ("fiscal_year", "forecast_year", "yr"),
})

PRICE_IMPORT_FIELDS = FieldMap({
    "price_id": (),
    "forecast_id": ("scenario", "scenario_id"),
    "unit_id": ("product", "product_id", "sku", "item", "item_number", "part_number"),
    "unit_name": ("product_name",),
    "customer_id": ("customer", "customer_number", "account", "account_number", "cust_id"),
    "customer_name": (),
    "customer_type": ("type", "channel", "class", "customer_class", "segment", "price_level", "tier"),
    "method": ("price_method", "pricing_method"),
    "unit_price": ("price", "net_price", "customer_price", "contract_price", "sell_price", "selling_price"),
    "discount_pct": ("discount", "discount_percent", "pct_off", "percent_off", "discount_off_list", "off_list"),
    "start_period": ("start", "effective", "effective_period", "effective_date", "from", "start_date", "valid_from"),
    "end_period": ("end", "expires", "end_date", "to", "valid_to", "expiration"),
    "notes": ("note", "comment", "comments"),
    "is_active": ("active", "enabled"),
})

DEDUCTION_IMPORT_FIELDS = FieldMap({
    "rule_id": (),
    "forecast_id": ("scenario", "scenario_id"),
    "deduction_type": ("type", "deduction", "allowance_type", "deduction_category"),
    "name": ("rule_name", "label", "description"),
    "method": ("calculation", "calc_method", "basis"),
    "rate": ("percent", "pct", "rate_pct", "percentage", "rate_percent"),
    "amount_per_unit": ("per_unit", "per_unit_amount", "amount", "dollars_per_unit"),
    "customer_id": ("customer", "customer_number", "account", "account_number", "cust_id"),
    "customer_name": (),
    "customer_type": ("channel", "class", "customer_class", "segment"),
    "unit_id": ("product", "product_id", "sku", "item"),
    "unit_name": ("product_name",),
    "unit_type": ("product_type", "product_category", "product_family", "family"),
    "start_period": ("start", "effective", "effective_period", "effective_date", "from", "start_date", "valid_from"),
    "end_period": ("end", "expires", "end_date", "to", "valid_to", "expiration"),
    "notes": ("note", "comment", "comments"),
    "is_active": ("active", "enabled"),
})

RECORD_TABLES: Dict[str, Dict[str, Any]] = {
    "customers": {
        "key": "customer_id", "name": "customer_name", "id_format": ("CUST-", 3), "label": "customer",
        "fields": FieldMap({
            "customer_id": ("id", "customer_number", "customer_no", "customer_code", "account", "account_number",
                            "cust_id"),
            "customer_name": ("name", "account_name", "company", "company_name"),
            "customer_type": ("type", "channel", "class", "customer_class", "segment"),
            "region": ("territory", "state", "area", "sales_region"),
        }),
        "numeric": (),
        "defaults": {},
    },
    "units": {
        "key": "unit_id", "name": "unit_name", "id_format": ("PROD-", 3), "label": "product",
        "fields": FieldMap({
            "unit_id": ("product_id", "sku", "item", "item_number", "part_number", "product_code", "id"),
            "unit_name": ("product_name", "name", "description", "item_name"),
            "unit_description": ("product_description", "long_description", "details"),
            "base_price": ("msrp", "list_price", "price", "base", "wholesale_price"),
            "unit_type": ("product_type", "type", "category", "product_category", "family", "product_family"),
            "bom_id": ("bom", "bom_number"),
            "bom_version": ("bom_rev", "bom_revision"),
            "router_id": ("routing", "router", "routing_id", "routing_number"),
            "router_version": ("routing_version", "routing_rev"),
        }),
        "numeric": ("base_price",),
        "defaults": {"bom_version": "1.0", "router_version": "1.0"},
    },
    "machines": {
        "key": "machine_id", "name": "machine_name", "id_format": ("M", 4), "label": "machine",
        "fields": FieldMap({
            "machine_id": ("machine", "work_center", "workcenter", "work_center_id", "id"),
            "machine_name": ("name", "work_center_name"),
            "machine_description": ("description",),
            "machine_rate": ("rate", "hourly_rate", "cost_per_hour", "rate_per_hour", "burden_rate"),
            "labor_type": (),
            "available_minutes_per_month": ("capacity_minutes", "available_minutes", "capacity_minutes_per_month",
                                            "minutes_per_month"),
            "available_hours_per_month": ("capacity_hours", "available_hours", "hours_per_month",
                                          "capacity_hours_per_month", "capacity"),
        }),
        "numeric": ("machine_rate", "available_minutes_per_month", "available_hours_per_month"),
        "defaults": {"available_minutes_per_month": 0},
    },
    "labor_rates": {
        "key": "rate_id", "name": "rate_name", "id_format": ("RATE-", 3), "label": "labor rate",
        "fields": FieldMap({
            "rate_id": ("labor_type_id", "labor_type", "labor_rate_id", "id", "code", "rate_code"),
            "rate_name": ("name", "labor_type_name", "title", "job_title"),
            "rate_description": ("description",),
            "rate_amount": ("rate", "hourly_rate", "amount", "wage", "cost_per_hour", "rate_per_hour"),
            "rate_type": ("type", "pay_type"),
        }),
        "numeric": ("rate_amount",),
        "defaults": {"rate_type": "hourly"},
    },
}
TABLE_ALIASES = {
    "customer": "customers", "customers": "customers",
    "unit": "units", "units": "units", "product": "units", "products": "units",
    "machine": "machines", "machines": "machines", "workcenters": "machines", "workcenter": "machines",
    "laborrate": "labor_rates", "laborrates": "labor_rates", "labortypes": "labor_rates", "labortype": "labor_rates",
    "labor": "labor_rates",
}


# ---------------------------------------------------------------------------
# Value helpers
# ---------------------------------------------------------------------------

def _text(value: Any) -> Optional[str]:
    if _blank(value):
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip()


def _number(value: Any, field: str) -> Optional[float]:
    """'$1,234.50', '(12)', 3 -> float; blank -> None."""
    if _blank(value):
        return None
    if isinstance(value, bool):
        raise ImportRowError(f"{field} must be a number, got {value!r}")
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "").replace("$", "").replace(" ", "")
    negative = text.startswith("(") and text.endswith(")")
    if negative:
        text = text[1:-1]
    try:
        number = float(text)
    except ValueError:
        raise ImportRowError(f"{field} must be a number, got '{value}'")
    return -number if negative else number


def _non_negative(value: Any, field: str) -> Optional[float]:
    number = _number(value, field)
    if number is not None and number < 0:
        raise ImportRowError(f"{field} cannot be negative ({number:g})")
    return number


def _whole(value: Any, field: str) -> Optional[int]:
    number = _number(value, field)
    if number is None:
        return None
    if not float(number).is_integer() or number < 1:
        raise ImportRowError(f"{field} must be a whole number of 1 or more, got '{value}'")
    return int(number)


def normalize_version(value: Any) -> str:
    """'1' -> '1.0', 2 -> '2.0', 'v2' -> '2.0', '1.1' -> '1.1', blank -> '1.0'."""
    if _blank(value):
        return "1.0"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f"{int(value)}.0" if float(value).is_integer() else str(value)
    text = str(value).strip()
    if re.match(r"^[vV]\d", text):
        text = text[1:]
    if re.match(r"^\d+$", text):
        return f"{int(text)}.0"
    return text


def _flag(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in ("1", "true", "yes", "y", "on")


def _parse_body(payload: Any, modes: Sequence[str], default_mode: str) -> Tuple[List[Dict[str, Any]], str, bool]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="Body must be an object: {rows: [...], mode, dry_run}")
    rows = payload.get("rows")
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=422, detail="rows must be a non-empty list of objects (one per CSV row)")
    if not all(isinstance(r, dict) for r in rows):
        raise HTTPException(status_code=422, detail="every entry of rows must be an object of column: value")
    mode = (_text(payload.get("mode")) or default_mode).lower()
    if mode not in modes:
        raise HTTPException(status_code=422, detail=f"mode must be one of {', '.join(modes)}")
    return rows, mode, _flag(payload.get("dry_run"), False)


def _map_rows(rows: List[Dict[str, Any]], fields: FieldMap,
              prepare=None) -> Tuple[List[Tuple[int, Dict[str, Any]]], List[str], int]:
    """[(1-based row number, mapped row)], unknown columns, blank-row count."""
    mapped: List[Tuple[int, Dict[str, Any]]] = []
    unknown: List[str] = []
    blank = 0
    for index, row in enumerate(rows, start=1):
        data, extra = fields.map_row(prepare(row) if prepare else row)
        for column in extra:
            if column not in unknown:
                unknown.append(column)
        if not data:
            if all(_blank(v) for v in row.values()):
                blank += 1
                continue
        mapped.append((index, data))
    return mapped, unknown, blank


def _ignored_columns_warning(unknown: List[str]) -> List[str]:
    return [f"Ignored columns (not recognised): {', '.join(unknown)}"] if unknown else []


def next_sequential_id(cursor, table: str, column: str, prefix: str, width: int) -> str:
    """Next id in the existing style, e.g. CUST-004 / PROD-012 / M0003 / RATE-002."""
    cursor.execute(f"SELECT {column} FROM {table} WHERE {column} LIKE ?", (f"{prefix}%",))
    pattern = re.compile(rf"^{re.escape(prefix)}(\d+)$")
    numbers = [int(m.group(1)) for (value,) in cursor.fetchall() if value and (m := pattern.match(str(value)))]
    return f"{prefix}{(max(numbers) + 1) if numbers else 1:0{width}d}"


def _finish(conn, dry_run: bool) -> None:
    if dry_run:
        conn.rollback()
    else:
        conn.commit()


def _message(kind: str, dry_run: bool, created: int, updated: int, replaced: int, skipped: int, errors: int) -> str:
    parts = [f"{created} created", f"{updated} updated"]
    if replaced:
        parts.append(f"{replaced} replaced")
    if skipped:
        parts.append(f"{skipped} skipped")
    if errors:
        parts.append(f"{errors} error{'s' if errors != 1 else ''}")
    prefix = f"Dry run, nothing written - {kind}: " if dry_run else f"Imported {kind}: "
    return prefix + ", ".join(parts)


def _result(**kwargs: Any) -> Dict[str, Any]:
    base = {"created": 0, "updated": 0, "replaced": 0, "skipped": 0, "errors": [], "warnings": []}
    base.update(kwargs)
    return base


def _lookup_ci(cursor, table: str, key: str, name_col: str, value: str) -> Optional[str]:
    """Id of the row whose id or name matches value (case-insensitive); None when not exactly one."""
    cursor.execute(f"SELECT {key} FROM {table} WHERE {key} = ?", (value,))
    row = cursor.fetchone()
    if row:
        return row[0]
    cursor.execute(
        f"SELECT {key} FROM {table} WHERE LOWER(TRIM({key})) = LOWER(TRIM(?)) OR LOWER(TRIM({name_col})) = LOWER(TRIM(?))",
        (value, value),
    )
    rows = cursor.fetchall()
    return rows[0][0] if len(rows) == 1 else None


# ---------------------------------------------------------------------------
# BOMs
# ---------------------------------------------------------------------------

_BOM_CODE_COLUMNS = ("component", "item", "material")
_BOM_TEXT_COLUMNS = {"description", "componentdescription", "partdescription", "itemdescription",
                     "materialdescription", "materialname", "componentname"}


def _prepare_bom_row(row: Dict[str, Any]) -> Dict[str, Any]:
    """
    ERP exports often carry the component's part number in a "Component" /
    "Item" column next to a "Description" column. When both are present and
    there is no explicit part-number column, the code column is the part
    number (kept as "PN - description") instead of competing with the text.
    """
    keys = {header_key(k): k for k in row}
    if not _BOM_TEXT_COLUMNS.intersection(keys):
        return row
    if any(BOM_FIELDS.canonical(k) == "part_number" for k in row):
        return row
    for code in _BOM_CODE_COLUMNS:
        if code in keys:
            prepared = dict(row)
            prepared["part_number"] = prepared.pop(keys[code])
            return prepared
    return row


def _clean_bom_row(data: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    notes: List[str] = []
    bom_id = _text(data.get("bom_id"))
    if not bom_id:
        raise ImportRowError("bom_id is required (the parent / assembly part number)")
    version = normalize_version(data.get("version"))
    description = _text(data.get("material_description"))
    part_number = _text(data.get("part_number"))
    if part_number and description:
        material = description if description.startswith(part_number) else f"{part_number} - {description}"
    else:
        material = part_number or description
    if not material:
        raise ImportRowError("material_description (or part_number) is required")
    qty = _non_negative(data.get("qty"), "qty")
    if qty is None:
        qty = 1.0
        notes.append("qty_defaulted")
    unit_price = _non_negative(data.get("unit_price"), "unit_price")
    material_cost = _non_negative(data.get("material_cost"), "material_cost")
    if unit_price is None and material_cost is None:
        unit_price, material_cost = 0.0, 0.0
        notes.append("no_cost")
    elif unit_price is None:
        if qty == 0:
            raise ImportRowError("qty is 0, so unit_price cannot be derived from material_cost; give unit_price")
        unit_price = material_cost / qty
    elif material_cost is None:
        material_cost = qty * unit_price
    elif abs(material_cost - qty * unit_price) > max(0.01, 0.005 * abs(material_cost)):
        notes.append("cost_mismatch")
    return {
        "bom_id": bom_id,
        "version": version,
        "bom_line": _whole(data.get("bom_line"), "bom_line"),
        "material_description": material,
        "qty": qty,
        "unit": _text(data.get("unit")),
        "unit_price": unit_price,
        "material_cost": material_cost,
        "target_cost": _non_negative(data.get("target_cost"), "target_cost"),
        "unit_id": _text(data.get("unit_id")),
        "bom_name": _text(data.get("bom_name")),
        "bom_description": _text(data.get("bom_description")),
    }, notes


@router.post("/boms", response_model=ForecastResponse)
async def import_boms(payload: Dict[str, Any] = Body(...)):
    """
    Import bill-of-materials lines.

    Body: ``{rows, mode: 'replace'|'append' = 'replace', link_products = true,
    dry_run = false}``. ``replace`` deletes the existing lines of every BOM +
    version in the file and inserts the file's lines; ``append`` upserts by
    bom_id + version + bom_line. Missing bom_line numbers are assigned in
    file order; version '1' becomes '1.0'. unit_price = material_cost / qty
    when only the extended cost is given (and vice versa). Rows with a
    unit_id (product) link that product to the BOM + version. A BOM with any
    row error is skipped as a whole so it is never half-replaced.
    """
    rows, mode, dry_run = _parse_body(payload, ("replace", "append"), "replace")
    link_products = _flag(payload.get("link_products"), True)
    mapped, unknown, blank_rows = _map_rows(rows, BOM_FIELDS, prepare=_prepare_bom_row)
    errors: List[Dict[str, Any]] = []
    warnings: List[str] = _ignored_columns_warning(unknown)

    groups: Dict[Tuple[str, str], List[Tuple[int, Dict[str, Any]]]] = {}
    bad_groups: Dict[Tuple[str, str], List[int]] = {}
    qty_defaulted: List[int] = []
    no_cost: List[int] = []
    for row_no, data in mapped:
        try:
            line, notes = _clean_bom_row(data)
        except ImportRowError as exc:
            errors.append({"row": row_no, "error": str(exc)})
            bom_id = _text(data.get("bom_id"))
            if bom_id:
                bad_groups.setdefault((bom_id, normalize_version(data.get("version"))), []).append(row_no)
            continue
        key = (line["bom_id"], line["version"])
        groups.setdefault(key, []).append((row_no, line))
        if "qty_defaulted" in notes:
            qty_defaulted.append(row_no)
        if "no_cost" in notes:
            no_cost.append(row_no)
        if "cost_mismatch" in notes:
            warnings.append(f"Row {row_no}: material_cost {line['material_cost']:,.2f} differs from qty x unit_price "
                            f"({line['qty'] * line['unit_price']:,.2f}); the BOM uses material_cost")
    if qty_defaulted:
        warnings.append(f"No qty on rows {_row_list(qty_defaulted)}; imported as 1 per assembly")
    if no_cost:
        warnings.append(f"No unit_price or material_cost on rows {_row_list(no_cost)}; those lines cost $0")

    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        # Line numbers: explicit ones must be unique per BOM + version; the rest are assigned in file order.
        for key, entries in groups.items():
            if key in bad_groups:
                continue
            start = 0
            if mode == "append":
                cursor.execute("SELECT COALESCE(MAX(bom_line), 0) FROM bom WHERE bom_id = ? AND version = ?", key)
                start = int(cursor.fetchone()[0] or 0)
            used: Dict[int, int] = {}
            for row_no, line in entries:
                if line["bom_line"] is not None:
                    if line["bom_line"] in used:
                        errors.append({"row": row_no, "error": f"bom_line {line['bom_line']} repeats row "
                                                               f"{used[line['bom_line']]} for BOM {key[0]} v{key[1]}"})
                        bad_groups.setdefault(key, []).append(row_no)
                    used[line["bom_line"]] = row_no
            next_line = max([start, *used.keys()]) + 1
            for _row_no, line in entries:
                if line["bom_line"] is None:
                    line["bom_line"] = next_line
                    next_line += 1

        skipped = 0
        for key, error_rows in bad_groups.items():
            good_rows = [r for r, _ in groups.get(key, [])]
            skipped_rows = [r for r in good_rows if r not in error_rows]
            skipped += len(skipped_rows)
            warnings.append(f"BOM {key[0]} v{key[1]} was not imported because rows {_row_list(sorted(set(error_rows)))} "
                            f"have errors" + (f" (rows {_row_list(skipped_rows)} skipped)" if skipped_rows else ""))

        created = updated = replaced = lines_deleted = 0
        boms: List[Dict[str, Any]] = []
        links: Dict[str, Tuple[str, str, int]] = {}
        for key, entries in groups.items():
            if key in bad_groups:
                continue
            bom_id, version = key
            bom_name = next((l["bom_name"] for _, l in entries if l["bom_name"]), None)
            bom_description = next((l["bom_description"] for _, l in entries if l["bom_description"]), None)
            cursor.execute("SELECT 1 FROM bom_definitions WHERE bom_id = ?", (bom_id,))
            if cursor.fetchone():
                cursor.execute(
                    """UPDATE bom_definitions SET bom_name = COALESCE(?, bom_name),
                              bom_description = COALESCE(?, bom_description), version = ?,
                              updated_at = CURRENT_TIMESTAMP WHERE bom_id = ?""",
                    (bom_name, bom_description, version, bom_id),
                )
            else:
                cursor.execute(
                    "INSERT INTO bom_definitions (bom_id, bom_name, bom_description, version) VALUES (?, ?, ?, ?)",
                    (bom_id, bom_name or bom_id, bom_description, version),
                )
            action = "created"
            if mode == "replace":
                cursor.execute("SELECT COUNT(*) FROM bom WHERE bom_id = ? AND version = ?", key)
                existing = int(cursor.fetchone()[0] or 0)
                if existing:
                    cursor.execute("DELETE FROM bom WHERE bom_id = ? AND version = ?", key)
                    replaced += 1
                    lines_deleted += existing
                    action = "replaced"
            else:
                cursor.execute("SELECT COUNT(*) FROM bom WHERE bom_id = ? AND version = ?", key)
                if int(cursor.fetchone()[0] or 0):
                    action = "appended"
            for row_no, line in entries:
                values = (line["material_description"], line["qty"], line["unit"], line["unit_price"],
                          line["material_cost"], line["target_cost"])
                cursor.execute("SELECT 1 FROM bom WHERE bom_id = ? AND version = ? AND bom_line = ?",
                               (bom_id, version, line["bom_line"]))
                if cursor.fetchone():
                    cursor.execute(
                        """UPDATE bom SET material_description = ?, qty = ?, unit = ?, unit_price = ?,
                                  material_cost = ?, target_cost = ? WHERE bom_id = ? AND version = ? AND bom_line = ?""",
                        (*values, bom_id, version, line["bom_line"]),
                    )
                    updated += 1
                else:
                    cursor.execute(
                        """INSERT INTO bom (bom_id, version, bom_line, material_description, qty, unit, unit_price,
                                            material_cost, target_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (bom_id, version, line["bom_line"], *values),
                    )
                    created += 1
                if link_products and line["unit_id"]:
                    previous = links.get(line["unit_id"])
                    if previous and previous[:2] != key:
                        warnings.append(f"Row {row_no}: product {line['unit_id']} is also linked to BOM "
                                        f"{previous[0]} v{previous[1]} (row {previous[2]}); the last one wins")
                    links[line["unit_id"]] = (bom_id, version, row_no)
            boms.append({"bom_id": bom_id, "version": version, "action": action, "rows": len(entries)})

        linked: Dict[Tuple[str, str], List[str]] = {}
        for unit_id, (bom_id, version, row_no) in links.items():
            cursor.execute("SELECT 1 FROM units WHERE unit_id = ?", (unit_id,))
            if not cursor.fetchone():
                warnings.append(f"Row {row_no}: product '{unit_id}' does not exist, so it was not linked to BOM "
                                f"{bom_id} (import products first, then re-import or link it on the product)")
                continue
            cursor.execute("UPDATE units SET bom_id = ?, bom_version = ? WHERE unit_id = ?", (bom_id, version, unit_id))
            linked.setdefault((bom_id, version), []).append(unit_id)

        for entry in boms:
            key = (entry["bom_id"], entry["version"])
            cursor.execute("SELECT COUNT(*), COALESCE(SUM(material_cost), 0) FROM bom WHERE bom_id = ? AND version = ?", key)
            count, cost = cursor.fetchone()
            cursor.execute("SELECT unit_id FROM units WHERE bom_id = ? AND bom_version = ? ORDER BY unit_id", key)
            used_by = [r[0] for r in cursor.fetchall()]
            entry.update({"lines": int(count or 0), "material_cost_per_unit": round(float(cost or 0), 4),
                          "linked_products": sorted(linked.get(key, [])), "used_by_products": used_by})
            cursor.execute(
                "SELECT unit_id, bom_version FROM units WHERE bom_id = ? AND COALESCE(bom_version, '') != ?", key
            )
            for unit_id, other_version in cursor.fetchall():
                cursor.execute("SELECT COUNT(*) FROM bom WHERE bom_id = ? AND version = ?", (key[0], other_version))
                if not cursor.fetchone()[0]:
                    warnings.append(f"Product {unit_id} points at BOM {key[0]} version {other_version!s}, which has no "
                                    f"lines, so its material cost is $0; link it to version {key[1]}")
            if not used_by:
                warnings.append(f"BOM {key[0]} v{key[1]} is not used by any product yet (add a unit_id column or set "
                                f"bom_id on the product)")
        _finish(conn, dry_run)
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("BOM import failed")
        raise HTTPException(status_code=500, detail=f"BOM import failed: {exc}")
    finally:
        db_manager.close_connection(conn)

    data = _result(
        kind="boms", dry_run=dry_run, mode=mode, rows=len(rows), created=created, updated=updated,
        replaced=replaced, skipped=skipped, errors=sorted(errors, key=lambda e: e["row"]), warnings=warnings,
        boms=boms,
        summary={"boms": len(boms), "lines_written": created + updated, "lines_deleted": lines_deleted,
                 "products_linked": sum(len(v) for v in linked.values()), "blank_rows": blank_rows,
                 "material_cost_by_bom": {f"{b['bom_id']} v{b['version']}": b["material_cost_per_unit"] for b in boms}},
    )
    return ForecastResponse(status="success", data=data,
                            message=_message("BOM lines", dry_run, created, updated, replaced, skipped, len(errors)))


def _row_list(rows: Sequence[int], limit: int = 12) -> str:
    rows = list(rows)
    text = ", ".join(str(r) for r in rows[:limit])
    return text + (f" and {len(rows) - limit} more" if len(rows) > limit else "")


# ---------------------------------------------------------------------------
# Routings
# ---------------------------------------------------------------------------

MANUAL_MACHINE_ID = "MANUAL"


def _clean_routing_row(data: Dict[str, Any]) -> Dict[str, Any]:
    router_id = _text(data.get("router_id"))
    if not router_id:
        raise ImportRowError("router_id is required (the routing number)")
    machine_minutes = _non_negative(data.get("machine_minutes"), "machine_minutes")
    if machine_minutes is None:
        hours = _non_negative(data.get("machine_hours"), "machine_hours")
        machine_minutes = hours * 60 if hours is not None else 0.0
    labor_minutes = _non_negative(data.get("labor_minutes"), "labor_minutes")
    if labor_minutes is None:
        hours = _non_negative(data.get("labor_hours"), "labor_hours")
        labor_minutes = hours * 60 if hours is not None else 0.0
    return {
        "router_id": router_id,
        "router_name": _text(data.get("router_name")),
        "router_description": _text(data.get("router_description")),
        "version": normalize_version(data.get("version")),
        "sequence": _whole(data.get("sequence"), "sequence"),
        "machine_ref": _text(data.get("machine_id")),
        "machine_minutes": machine_minutes,
        "labor_minutes": labor_minutes,
        "labor_ref": _text(data.get("labor_type_id")),
        "operation_description": _text(data.get("operation_description")),
        "unit_id": _text(data.get("unit_id")),
    }


@router.post("/routings", response_model=ForecastResponse)
async def import_routings(payload: Dict[str, Any] = Body(...)):
    """
    Import routing operations.

    Body: ``{rows, mode: 'replace'|'append' = 'replace', auto_create = false,
    link_products = true, dry_run = false}``. ``replace`` swaps all
    operations of each router in the file; ``append`` upserts by router +
    sequence. Missing sequences are numbered 10, 20, 30 in file order.
    Machines and labor types are matched by id or name; unknown ones are row
    errors unless ``auto_create`` makes $0 placeholders (reported as
    warnings; they show up as cost warnings until rates are set). Rows with a
    unit_id link that product to the routing.
    """
    rows, mode, dry_run = _parse_body(payload, ("replace", "append"), "replace")
    auto_create = _flag(payload.get("auto_create"), False)
    link_products = _flag(payload.get("link_products"), True)
    mapped, unknown, blank_rows = _map_rows(rows, ROUTING_FIELDS)
    errors: List[Dict[str, Any]] = []
    warnings: List[str] = _ignored_columns_warning(unknown)

    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        groups: Dict[str, List[Tuple[int, Dict[str, Any]]]] = {}
        bad_groups: Dict[str, List[int]] = {}
        created_machines: List[str] = []
        created_labor: List[str] = []
        machine_cache: Dict[str, Optional[str]] = {}
        labor_cache: Dict[str, Optional[str]] = {}

        def _machine(ref: Optional[str]) -> str:
            if not ref:
                if not auto_create:
                    raise ImportRowError("machine_id is required (use a work center or bench; pass auto_create to "
                                         f"put labor-only steps on a $0/hr '{MANUAL_MACHINE_ID}' placeholder)")
                ref = MANUAL_MACHINE_ID
            if ref not in machine_cache:
                machine_cache[ref] = _lookup_ci(cursor, "machines", "machine_id", "machine_name", ref)
            if machine_cache[ref] is None:
                if not auto_create:
                    raise ImportRowError(f"Unknown machine '{ref}' (import machines first, or pass auto_create to "
                                         f"create a $0/hr placeholder)")
                name = "Manual / bench work" if ref == MANUAL_MACHINE_ID else ref
                cursor.execute(
                    "INSERT INTO machines (machine_id, machine_name, machine_rate, available_minutes_per_month) "
                    "VALUES (?, ?, 0, 0)", (ref, name))
                created_machines.append(ref)
                machine_cache[ref] = ref
            return machine_cache[ref]

        def _labor(ref: Optional[str]) -> Optional[str]:
            if not ref:
                return None
            if ref not in labor_cache:
                labor_cache[ref] = _lookup_ci(cursor, "labor_rates", "rate_id", "rate_name", ref)
            if labor_cache[ref] is None:
                if not auto_create:
                    raise ImportRowError(f"Unknown labor type '{ref}' (import labor rates first, or pass auto_create "
                                         f"to create a $0/hr placeholder)")
                cursor.execute("INSERT INTO labor_rates (rate_id, rate_name, rate_amount, rate_type) VALUES (?, ?, 0, 'hourly')",
                               (ref, ref))
                created_labor.append(ref)
                labor_cache[ref] = ref
            return labor_cache[ref]

        no_labor_type: List[int] = []
        no_time: List[int] = []
        for row_no, data in mapped:
            try:
                op = _clean_routing_row(data)
                op["machine_id"] = _machine(op["machine_ref"])
                op["labor_type_id"] = _labor(op["labor_ref"])
            except ImportRowError as exc:
                errors.append({"row": row_no, "error": str(exc)})
                router_id = _text(data.get("router_id"))
                if router_id:
                    bad_groups.setdefault(router_id, []).append(row_no)
                continue
            if op["labor_minutes"] and not op["labor_type_id"]:
                no_labor_type.append(row_no)
            if not op["labor_minutes"] and not op["machine_minutes"]:
                no_time.append(row_no)
            groups.setdefault(op["router_id"], []).append((row_no, op))
        if no_labor_type:
            warnings.append(f"Rows {_row_list(no_labor_type)} have labor minutes but no labor type; that labor costs $0")
        if no_time:
            warnings.append(f"Rows {_row_list(no_time)} have no machine or labor minutes")
        if created_machines:
            warnings.append(f"Created placeholder machines at $0/hr: {', '.join(created_machines)} - set their rates "
                            f"and capacity on the Machines page or import machines")
        if created_labor:
            warnings.append(f"Created placeholder labor types at $0/hr: {', '.join(created_labor)} - set their rates "
                            f"on the Labor Rates page or import labor rates")

        for router_id, entries in groups.items():
            if router_id in bad_groups:
                continue
            start = 0
            if mode == "append":
                cursor.execute("SELECT COALESCE(MAX(sequence), 0) FROM router_operations WHERE router_id = ?", (router_id,))
                start = int(cursor.fetchone()[0] or 0)
            used: Dict[int, int] = {}
            for row_no, op in entries:
                if op["sequence"] is not None:
                    if op["sequence"] in used:
                        errors.append({"row": row_no, "error": f"sequence {op['sequence']} repeats row "
                                                               f"{used[op['sequence']]} for routing {router_id}"})
                        bad_groups.setdefault(router_id, []).append(row_no)
                    used[op["sequence"]] = row_no
            next_seq = (max([start, *used.keys()]) // 10 + 1) * 10
            for _row_no, op in entries:
                if op["sequence"] is None:
                    op["sequence"] = next_seq
                    next_seq += 10

        skipped = 0
        for router_id, error_rows in bad_groups.items():
            good_rows = [r for r, _ in groups.get(router_id, [])]
            skipped_rows = [r for r in good_rows if r not in error_rows]
            skipped += len(skipped_rows)
            warnings.append(f"Routing {router_id} was not imported because rows {_row_list(sorted(set(error_rows)))} "
                            f"have errors" + (f" (rows {_row_list(skipped_rows)} skipped)" if skipped_rows else ""))

        created = updated = replaced = ops_deleted = 0
        routings: List[Dict[str, Any]] = []
        links: Dict[str, Tuple[str, str, int]] = {}
        for router_id, entries in groups.items():
            if router_id in bad_groups:
                continue
            version = entries[0][1]["version"]
            name = next((op["router_name"] for _, op in entries if op["router_name"]), None)
            description = next((op["router_description"] for _, op in entries if op["router_description"]), None)
            cursor.execute("SELECT 1 FROM router_definitions WHERE router_id = ?", (router_id,))
            if cursor.fetchone():
                cursor.execute(
                    """UPDATE router_definitions SET router_name = COALESCE(?, router_name),
                              router_description = COALESCE(?, router_description), version = ?,
                              updated_at = CURRENT_TIMESTAMP WHERE router_id = ?""",
                    (name, description, version, router_id),
                )
            else:
                cursor.execute(
                    "INSERT INTO router_definitions (router_id, router_name, router_description, version) VALUES (?, ?, ?, ?)",
                    (router_id, name or router_id, description, version),
                )
            cursor.execute("SELECT COUNT(*) FROM router_operations WHERE router_id = ?", (router_id,))
            existing = int(cursor.fetchone()[0] or 0)
            action = "created"
            if mode == "replace" and existing:
                cursor.execute("DELETE FROM router_operations WHERE router_id = ?", (router_id,))
                replaced += 1
                ops_deleted += existing
                action = "replaced"
            elif existing:
                action = "appended"
            for row_no, op in entries:
                values = (op["machine_id"], op["machine_minutes"], op["labor_minutes"], op["labor_type_id"],
                          op["operation_description"])
                cursor.execute("SELECT 1 FROM router_operations WHERE router_id = ? AND sequence = ?",
                               (router_id, op["sequence"]))
                if cursor.fetchone():
                    cursor.execute(
                        """UPDATE router_operations SET machine_id = ?, machine_minutes = ?, labor_minutes = ?,
                                  labor_type_id = ?, operation_description = ? WHERE router_id = ? AND sequence = ?""",
                        (*values, router_id, op["sequence"]),
                    )
                    updated += 1
                else:
                    cursor.execute(
                        """INSERT INTO router_operations (router_id, sequence, machine_id, machine_minutes, labor_minutes,
                                                          labor_type_id, operation_description) VALUES (?, ?, ?, ?, ?, ?, ?)""",
                        (router_id, op["sequence"], *values),
                    )
                    created += 1
                if link_products and op["unit_id"]:
                    previous = links.get(op["unit_id"])
                    if previous and previous[0] != router_id:
                        warnings.append(f"Row {row_no}: product {op['unit_id']} is also linked to routing "
                                        f"{previous[0]} (row {previous[2]}); the last one wins")
                    links[op["unit_id"]] = (router_id, version, row_no)
            routings.append({"router_id": router_id, "version": version, "action": action, "rows": len(entries)})

        linked: Dict[str, List[str]] = {}
        for unit_id, (router_id, version, row_no) in links.items():
            cursor.execute("SELECT 1 FROM units WHERE unit_id = ?", (unit_id,))
            if not cursor.fetchone():
                warnings.append(f"Row {row_no}: product '{unit_id}' does not exist, so it was not linked to routing "
                                f"{router_id} (import products first)")
                continue
            cursor.execute("UPDATE units SET router_id = ?, router_version = ? WHERE unit_id = ?",
                           (router_id, version, unit_id))
            linked.setdefault(router_id, []).append(unit_id)

        for entry in routings:
            costs = calculate_unit_costs(cursor, None, None, entry["router_id"])
            cursor.execute("SELECT COUNT(*) FROM router_operations WHERE router_id = ?", (entry["router_id"],))
            count = int(cursor.fetchone()[0] or 0)
            cursor.execute("SELECT unit_id FROM units WHERE router_id = ? ORDER BY unit_id", (entry["router_id"],))
            used_by = [r[0] for r in cursor.fetchall()]
            entry.update({
                "operations": count,
                "labor_minutes_per_unit": round(costs["labor_minutes_per_unit"], 4),
                "machine_minutes_per_unit": round(costs["machine_minutes_per_unit"], 4),
                "labor_cost_per_unit": round(costs["labor_per_unit"], 4),
                "machine_cost_per_unit": round(costs["machine_per_unit"], 4),
                "cost_warnings": [w for w in costs["warnings"] if w != "missing_bom"],
                "linked_products": sorted(linked.get(entry["router_id"], [])),
                "used_by_products": used_by,
            })
            if not used_by:
                warnings.append(f"Routing {entry['router_id']} is not used by any product yet (add a unit_id column or "
                                f"set router_id on the product)")
        _finish(conn, dry_run)
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("Routing import failed")
        raise HTTPException(status_code=500, detail=f"Routing import failed: {exc}")
    finally:
        db_manager.close_connection(conn)

    data = _result(
        kind="routings", dry_run=dry_run, mode=mode, rows=len(rows), created=created, updated=updated,
        replaced=replaced, skipped=skipped, errors=sorted(errors, key=lambda e: e["row"]), warnings=warnings,
        routings=routings, created_machines=created_machines, created_labor_types=created_labor,
        summary={"routings": len(routings), "operations_written": created + updated, "operations_deleted": ops_deleted,
                 "products_linked": sum(len(v) for v in linked.values()), "blank_rows": blank_rows},
    )
    return ForecastResponse(status="success", data=data,
                            message=_message("routing operations", dry_run, created, updated, replaced, skipped, len(errors)))


# ---------------------------------------------------------------------------
# Master records: customers, products, machines, labor rates
# ---------------------------------------------------------------------------

def _resolve_table(value: Any) -> str:
    key = header_key(value or "")
    table = TABLE_ALIASES.get(key) or (value if value in RECORD_TABLES else None)
    if not table:
        raise HTTPException(status_code=422,
                            detail=f"table must be one of {', '.join(RECORD_TABLES)} (products = units), got '{value}'")
    return table


@router.post("/records", response_model=ForecastResponse)
async def import_records(payload: Dict[str, Any] = Body(...)):
    """
    Import master data rows into customers, units (products), machines or
    labor_rates.

    Body: ``{table, rows, mode: 'upsert'|'skip' = 'upsert', dry_run}``.
    Rows are matched by id, or by name when the id column is empty;
    ``upsert`` updates only the columns the file fills in (a blank cell never
    erases a stored value), ``skip`` leaves existing rows alone. New rows
    without an id get one in the existing style (CUST-001, PROD-001, M0001,
    RATE-001). Machines accept capacity in hours (x 60) or minutes.
    """
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="Body must be an object: {table, rows, mode, dry_run}")
    table = _resolve_table(payload.get("table"))
    rows, mode, dry_run = _parse_body(payload, ("upsert", "skip"), "upsert")
    spec = RECORD_TABLES[table]
    key_col, name_col = spec["key"], spec["name"]
    mapped, unknown, blank_rows = _map_rows(rows, spec["fields"])
    errors: List[Dict[str, Any]] = []
    warnings: List[str] = _ignored_columns_warning(unknown)
    records: List[Dict[str, Any]] = []
    created = updated = skipped = unchanged = 0

    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(f"PRAGMA table_info({table})")
        columns = [r[1] for r in cursor.fetchall()]
        seen: Dict[str, int] = {}
        for row_no, data in mapped:
            try:
                values = _clean_record(table, spec, data)
            except ImportRowError as exc:
                errors.append({"row": row_no, "error": str(exc)})
                continue
            values = {k: v for k, v in values.items() if k in columns}
            key = values.get(key_col)
            name = values.get(name_col)
            if not key and not name:
                errors.append({"row": row_no, "error": f"{key_col} or {name_col} is required"})
                continue
            existing_id = None
            if key:
                cursor.execute(f"SELECT {key_col} FROM {table} WHERE {key_col} = ?", (key,))
                found = cursor.fetchone()
                existing_id = found[0] if found else None
            else:
                cursor.execute(f"SELECT {key_col} FROM {table} WHERE LOWER(TRIM({name_col})) = LOWER(TRIM(?))", (name,))
                found = cursor.fetchall()
                if len(found) > 1:
                    errors.append({"row": row_no, "error": f"{len(found)} {spec['label']}s are named '{name}'; "
                                                           f"give {key_col} to say which one"})
                    continue
                existing_id = found[0][0] if found else None
            record_id = existing_id or key
            if record_id in seen:
                warnings.append(f"Row {row_no}: {spec['label']} {record_id} already appeared in row {seen[record_id]}; "
                                f"the later row wins")
            if existing_id:
                if mode == "skip":
                    skipped += 1
                    records.append({"row": row_no, key_col: existing_id, "action": "skipped"})
                    seen[existing_id] = row_no
                    continue
                # A row matched by name keeps the stored spelling of that name.
                updates = {k: v for k, v in values.items() if k != key_col and (key or k != name_col)}
                cursor.execute(f"SELECT * FROM {table} WHERE {key_col} = ?", (existing_id,))
                current = dict(zip([d[0] for d in cursor.description], cursor.fetchone()))
                changed = {k: v for k, v in updates.items() if current.get(k) != v}
                if changed:
                    cursor.execute(
                        f"UPDATE {table} SET {', '.join(f'{k} = ?' for k in changed)} WHERE {key_col} = ?",
                        [*changed.values(), existing_id],
                    )
                    updated += 1
                    records.append({"row": row_no, key_col: existing_id, "action": "updated", "fields": sorted(changed)})
                else:
                    unchanged += 1
                    records.append({"row": row_no, key_col: existing_id, "action": "unchanged"})
                seen[existing_id] = row_no
                continue
            if not key:
                prefix, width = spec["id_format"]
                key = next_sequential_id(cursor, table, key_col, prefix, width)
                values[key_col] = key
            if not name:
                values[name_col] = key
                warnings.append(f"Row {row_no}: no {name_col}; used the id '{key}' as the name")
            for column, default in spec["defaults"].items():
                if column in columns and values.get(column) is None:
                    values[column] = default
            cols = list(values)
            cursor.execute(f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})",
                           [values[c] for c in cols])
            created += 1
            seen[key] = row_no
            records.append({"row": row_no, key_col: key, "action": "created"})

        if table == "units":
            warnings.extend(_unit_link_warnings(cursor, [r[key_col] for r in records if r["action"] != "skipped"]))
        _finish(conn, dry_run)
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("Record import failed")
        raise HTTPException(status_code=500, detail=f"Import into {table} failed: {exc}")
    finally:
        db_manager.close_connection(conn)

    data = _result(
        kind="records", table=table, dry_run=dry_run, mode=mode, rows=len(rows), created=created, updated=updated,
        skipped=skipped, errors=errors, warnings=warnings, records=records[:1000],
        summary={"unchanged": unchanged, "blank_rows": blank_rows},
    )
    return ForecastResponse(status="success", data=data,
                            message=_message(table, dry_run, created, updated, 0, skipped, len(errors)))


def _clean_record(table: str, spec: Dict[str, Any], data: Dict[str, Any]) -> Dict[str, Any]:
    values: Dict[str, Any] = {}
    for field in spec["fields"].fields:
        if field not in data:
            continue
        if field in spec["numeric"]:
            values[field] = _non_negative(data[field], field)
        else:
            values[field] = _text(data[field])
    if table == "machines" and "available_hours_per_month" in values:
        hours = values.pop("available_hours_per_month")
        if values.get("available_minutes_per_month") is None and hours is not None:
            values["available_minutes_per_month"] = hours * 60
    if table == "units":
        for column in ("bom_version", "router_version"):
            if values.get(column) is not None:
                values[column] = normalize_version(values[column])
    if table == "machines" and values.get("available_minutes_per_month") is not None:
        minutes = values["available_minutes_per_month"]
        values["available_minutes_per_month"] = int(minutes) if float(minutes).is_integer() else minutes
    return {k: v for k, v in values.items() if v is not None}


def _unit_link_warnings(cursor, unit_ids: List[str]) -> List[str]:
    warnings: List[str] = []
    for unit_id in unit_ids[:500]:
        cursor.execute("SELECT bom_id, bom_version, router_id FROM units WHERE unit_id = ?", (unit_id,))
        row = cursor.fetchone()
        if not row:
            continue
        bom_id, bom_version, router_id = row
        if bom_id:
            cursor.execute("SELECT COUNT(*) FROM bom WHERE bom_id = ? AND version = ?", (bom_id, bom_version))
            if not cursor.fetchone()[0]:
                warnings.append(f"Product {unit_id}: BOM {bom_id} v{bom_version} has no lines yet (import BOMs next)")
        if router_id:
            cursor.execute("SELECT COUNT(*) FROM router_operations WHERE router_id = ?", (router_id,))
            if not cursor.fetchone()[0]:
                warnings.append(f"Product {unit_id}: routing {router_id} has no operations yet (import routings next)")
    return warnings


# ---------------------------------------------------------------------------
# Price list and deduction rules
# ---------------------------------------------------------------------------

def _resolve_reference(cursor, data: Dict[str, Any], id_field: str, name_field: str, table: str,
                       key_col: str, name_col: str, label: str, row_no: int, warnings: List[str]) -> None:
    """Accept a name where an id is expected ('Main Street Guns' -> CUST-001); warn when nothing matches."""
    value = _text(data.get(id_field))
    name = _text(data.get(name_field))
    if value:
        resolved = _lookup_ci(cursor, table, key_col, name_col, value)
        if resolved:
            data[id_field] = resolved
        else:
            warnings.append(f"Row {row_no}: {label} '{value}' does not exist yet, so the rule matches no sales")
    elif name:
        resolved = _lookup_ci(cursor, table, key_col, name_col, name)
        if resolved:
            data[id_field] = resolved
        else:
            raise ImportRowError(f"{label} '{name}' not found; give its id")


def _scope_key(values: Dict[str, Any], fields: Sequence[str]) -> Tuple:
    out = []
    for field in fields:
        value = values.get(field)
        out.append(value.strip().lower() if isinstance(value, str) and field in ("customer_type", "unit_type") else value)
    return tuple(out)


PRICE_KEY_FIELDS = ("forecast_id", "unit_id", "customer_id", "customer_type", "start_period", "end_period")
DEDUCTION_KEY_FIELDS = ("forecast_id", "deduction_type", "customer_id", "customer_type", "unit_id", "unit_type",
                        "start_period", "end_period")


def _import_rules(payload: Dict[str, Any], kind: str) -> ForecastResponse:
    """Shared body of /import/prices and /import/deductions."""
    is_price = kind == "prices"
    fields = PRICE_IMPORT_FIELDS if is_price else DEDUCTION_IMPORT_FIELDS
    table = "price_list" if is_price else "sales_deduction_rules"
    id_col = "price_id" if is_price else "rule_id"
    key_fields = PRICE_KEY_FIELDS if is_price else DEDUCTION_KEY_FIELDS
    clean_fn = clean_price_rule if is_price else clean_deduction_rule
    insert_fn = insert_price_rule if is_price else insert_deduction_rule
    update_fn = update_price_rule if is_price else update_deduction_rule

    rows, mode, dry_run = _parse_body(payload, ("upsert", "append", "replace"), "upsert")
    default_forecast = _text(payload.get("forecast_id"))
    mapped, unknown, blank_rows = _map_rows(rows, fields)
    errors: List[Dict[str, Any]] = []
    warnings: List[str] = _ignored_columns_warning(unknown)
    results: List[Dict[str, Any]] = []
    created = updated = replaced = 0

    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        if default_forecast:
            cursor.execute("SELECT 1 FROM forecast WHERE forecast_id = ?", (default_forecast,))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail=f"Forecast scenario '{default_forecast}' not found")
        cleaned: List[Tuple[int, Dict[str, Any], Optional[str]]] = []
        for row_no, data in mapped:
            data = dict(data)
            if _blank(data.get("forecast_id")) and default_forecast:
                data["forecast_id"] = default_forecast
            try:
                _resolve_reference(cursor, data, "customer_id", "customer_name", "customers", "customer_id",
                                   "customer_name", "customer", row_no, warnings)
                _resolve_reference(cursor, data, "unit_id", "unit_name", "units", "unit_id", "unit_name",
                                   "product", row_no, warnings)
                clean, rule_warnings = clean_fn(cursor, data, percent_input=True, label=f"Row {row_no}")
            except (ImportRowError, RuleValidationError) as exc:
                errors.append({"row": row_no, "error": str(exc)})
                continue
            # Unknown-id warnings were already given by _resolve_reference.
            warnings.extend(w for w in rule_warnings if "does not exist yet" not in w)
            cleaned.append((row_no, clean, _text(data.get(id_col))))

        if mode == "replace" and cleaned:
            scopes = sorted({c[1]["forecast_id"] for c in cleaned}, key=lambda v: v or "")
            for fid in scopes:
                if fid is None:
                    cursor.execute(f"SELECT COUNT(*) FROM {table} WHERE forecast_id IS NULL")
                    replaced += int(cursor.fetchone()[0] or 0)
                    cursor.execute(f"DELETE FROM {table} WHERE forecast_id IS NULL")
                else:
                    cursor.execute(f"SELECT COUNT(*) FROM {table} WHERE forecast_id = ?", (fid,))
                    replaced += int(cursor.fetchone()[0] or 0)
                    cursor.execute(f"DELETE FROM {table} WHERE forecast_id = ?", (fid,))

        # upsert and replace match rows of the same scope (after replace's delete only the file's own
        # earlier rows can match), so a repeated scope updates instead of stacking duplicate rules.
        existing_by_key: Dict[Tuple, str] = {}
        if mode in ("upsert", "replace"):
            cursor.execute(f"SELECT * FROM {table}")
            columns = [d[0] for d in cursor.description]
            for row in cursor.fetchall():
                record = dict(zip(columns, row))
                existing_by_key.setdefault(_scope_key(record, key_fields), record[id_col])

        for row_no, clean, given_id in cleaned:
            target = None
            if mode in ("upsert", "replace"):
                if given_id:
                    cursor.execute(f"SELECT 1 FROM {table} WHERE {id_col} = ?", (given_id,))
                    target = given_id if cursor.fetchone() else None
                if target is None and not given_id:
                    target = existing_by_key.get(_scope_key(clean, key_fields))
            if target:
                update_fn(cursor, target, clean)
                updated += 1
                results.append({"row": row_no, id_col: target, "action": "updated"})
            else:
                keep_id = given_id if given_id and _id_free(cursor, table, id_col, given_id) else None
                new_id = insert_fn(cursor, clean, keep_id)
                created += 1
                existing_by_key[_scope_key(clean, key_fields)] = new_id
                results.append({"row": row_no, id_col: new_id, "action": "created"})
        _finish(conn, dry_run)
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("%s import failed", kind)
        raise HTTPException(status_code=500, detail=f"Import of {kind} failed: {exc}")
    finally:
        db_manager.close_connection(conn)

    data = _result(
        kind=kind, dry_run=dry_run, mode=mode, rows=len(rows), created=created, updated=updated, replaced=replaced,
        skipped=0, errors=errors, warnings=_dedupe(warnings), records=results,
        summary={"blank_rows": blank_rows, "rules_written": created + updated, "rules_deleted": replaced},
    )
    label = "price rules" if is_price else "deduction rules"
    return ForecastResponse(status="success", data=data,
                            message=_message(label, dry_run, created, updated, replaced, 0, len(errors)))


def _id_free(cursor, table: str, id_col: str, value: str) -> bool:
    cursor.execute(f"SELECT 1 FROM {table} WHERE {id_col} = ?", (value,))
    return cursor.fetchone() is None


def _dedupe(items: List[str]) -> List[str]:
    seen = set()
    out = []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


@router.post("/prices", response_model=ForecastResponse)
async def import_prices(payload: Dict[str, Any] = Body(...)):
    """
    Import price-list rules.

    Body: ``{rows, mode: 'upsert'|'append'|'replace' = 'upsert', forecast_id?,
    dry_run}``. ``forecast_id`` (body) applies to rows without one; leave
    both empty for company-wide prices. ``upsert`` updates the rule with the
    same price_id, or the same scope (scenario, product, customer, customer
    type, start, end); ``replace`` first deletes every price rule of the
    scenarios in the file. A row with a discount and no price is a
    discount_from_base rule; discounts accept 0.4, '40%' or 40.
    Customers / products may be given by name.
    """
    return _import_rules(payload, "prices")


@router.post("/deductions", response_model=ForecastResponse)
async def import_deductions(payload: Dict[str, Any] = Body(...)):
    """
    Import sales deduction rules (terms, chargebacks, other allowances,
    excise tax, commission).

    Body as /import/prices. deduction_type accepts friendly names ('terms',
    'chargebacks', 'FET', 'excise', 'commission'); method accepts 'percent',
    'embedded', 'per unit', 'net'; rate accepts 0.02, '2%' or 2 (values >= 1
    are percents). Excise rules default to the embedded_tax method.
    """
    return _import_rules(payload, "deductions")


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

def _col(name: str, required: bool, description: str, fields: Optional[FieldMap] = None) -> Dict[str, Any]:
    return {"name": name, "required": required, "description": description,
            "aliases": fields.aliases(name) if fields else []}


TEMPLATES: Dict[str, Dict[str, Any]] = {
    "customers": {
        "step": 1, "title": "Customers", "endpoint": "POST /import/records (table=customers)",
        "description": "Who you sell to. customer_type (Dealer, Distributor, Government, ...) drives "
                       "customer-type prices and deduction rules.",
        "columns": [
            _col("customer_id", False, "Your customer number; generated (CUST-001) when blank",
                 RECORD_TABLES["customers"]["fields"]),
            _col("customer_name", True, "Customer name", RECORD_TABLES["customers"]["fields"]),
            _col("customer_type", True, "Channel / class used by price and deduction rules",
                 RECORD_TABLES["customers"]["fields"]),
            _col("region", False, "Territory", RECORD_TABLES["customers"]["fields"]),
        ],
        "rows": [
            ["CUST-001", "Main Street Guns", "Dealer", "Midwest"],
            ["CUST-002", "Big Sky Sporting Distributors", "Distributor", "Mountain"],
            ["CUST-003", "County Sheriff's Office", "Government", "Midwest"],
        ],
    },
    "products": {
        "step": 2, "title": "Products", "endpoint": "POST /import/records (table=units)",
        "description": "What you sell. base_price is the list price used when no price-list entry applies; "
                       "bom_id / router_id link the product to its BOM and routing for costing.",
        "columns": [
            _col("unit_id", True, "Product / SKU", RECORD_TABLES["units"]["fields"]),
            _col("unit_name", True, "Product name", RECORD_TABLES["units"]["fields"]),
            _col("unit_type", False, "Product type (Rifle, Pistol, ...) used by deduction rules",
                 RECORD_TABLES["units"]["fields"]),
            _col("base_price", False, "List price (MSRP / dealer list)", RECORD_TABLES["units"]["fields"]),
            _col("bom_id", False, "BOM used to cost the product", RECORD_TABLES["units"]["fields"]),
            _col("bom_version", False, "BOM version (default 1.0)", RECORD_TABLES["units"]["fields"]),
            _col("router_id", False, "Routing used to cost the product", RECORD_TABLES["units"]["fields"]),
            _col("unit_description", False, "Longer description", RECORD_TABLES["units"]["fields"]),
        ],
        "rows": [
            ["RFL-308", "Ridgeline Hunter .308 Rifle", "Rifle", "1499.00", "BOM-RFL308", "1.0", "R-RFL308",
             "Bolt action, 22in barrel"],
            ["PST-9C", "Compact 9mm Pistol", "Pistol", "599.00", "BOM-PST9C", "1.0", "R-PST9C", "Striker fired, 15+1"],
        ],
    },
    "machines": {
        "step": 3, "title": "Machines / work centers", "endpoint": "POST /import/records (table=machines)",
        "description": "Equipment and benches used in routings. machine_rate is $ per machine hour; capacity "
                       "drives the utilization report.",
        "columns": [
            _col("machine_id", True, "Machine / work center id", RECORD_TABLES["machines"]["fields"]),
            _col("machine_name", True, "Name", RECORD_TABLES["machines"]["fields"]),
            _col("machine_rate", True, "$ per machine hour (0 for a manual bench)", RECORD_TABLES["machines"]["fields"]),
            _col("available_hours_per_month", False, "Capacity in hours per month (or available_minutes_per_month)",
                 RECORD_TABLES["machines"]["fields"]),
            _col("machine_description", False, "Description", RECORD_TABLES["machines"]["fields"]),
        ],
        "rows": [
            ["CNC-01", "Haas VF-2 CNC Mill", "85.00", "320", "Receiver and bolt machining"],
            ["LATHE-01", "Barrel Lathe", "70.00", "320", "Barrel turning and chambering"],
            ["ASSY-01", "Assembly Bench", "0", "640", "Manual assembly and test fire"],
        ],
    },
    "labor_rates": {
        "step": 4, "title": "Labor rates", "endpoint": "POST /import/records (table=labor_rates)",
        "description": "Direct labor types and hourly rates used by routings (labor cost = minutes / 60 x rate).",
        "columns": [
            _col("rate_id", True, "Labor type id used in routings", RECORD_TABLES["labor_rates"]["fields"]),
            _col("rate_name", True, "Name", RECORD_TABLES["labor_rates"]["fields"]),
            _col("rate_amount", True, "$ per hour (loaded rate if you want burden in COGS)",
                 RECORD_TABLES["labor_rates"]["fields"]),
            _col("rate_type", False, "hourly (default)", RECORD_TABLES["labor_rates"]["fields"]),
        ],
        "rows": [
            ["MACHINIST", "CNC Machinist", "32.00", "hourly"],
            ["ASSEMBLER", "Gunsmith / Assembler", "26.00", "hourly"],
            ["QC", "Quality Inspector", "28.00", "hourly"],
        ],
    },
    "routings": {
        "step": 5, "title": "Routings", "endpoint": "POST /import/routings",
        "description": "Operations per product: machine minutes and labor minutes per unit. One row per "
                       "operation; mode=replace swaps the routing's operations.",
        "columns": [
            _col("router_id", True, "Routing id", ROUTING_FIELDS),
            _col("router_name", False, "Routing name", ROUTING_FIELDS),
            _col("sequence", False, "Operation number (10, 20, 30 assigned when blank)", ROUTING_FIELDS),
            _col("machine_id", True, "Machine / work center (id or name)", ROUTING_FIELDS),
            _col("machine_minutes", False, "Machine minutes per unit", ROUTING_FIELDS),
            _col("labor_minutes", False, "Labor minutes per unit", ROUTING_FIELDS),
            _col("labor_type_id", False, "Labor type (rate id or name); needed when labor_minutes > 0", ROUTING_FIELDS),
            _col("operation_description", False, "What the step does", ROUTING_FIELDS),
            _col("unit_id", False, "Product to link to this routing", ROUTING_FIELDS),
        ],
        "rows": [
            ["R-RFL308", "Ridgeline .308 routing", "10", "LATHE-01", "45", "15", "MACHINIST", "Turn and chamber barrel", "RFL-308"],
            ["R-RFL308", "Ridgeline .308 routing", "20", "CNC-01", "60", "20", "MACHINIST", "Machine receiver", "RFL-308"],
            ["R-RFL308", "Ridgeline .308 routing", "30", "ASSY-01", "0", "50", "ASSEMBLER", "Assemble, headspace, test fire", "RFL-308"],
        ],
    },
    "boms": {
        "step": 6, "title": "Bills of materials", "endpoint": "POST /import/boms",
        "description": "Components per finished product. One row per component; material cost per unit = "
                       "sum of qty x unit_price. mode=replace swaps the BOM's lines.",
        "columns": [
            _col("bom_id", True, "BOM / parent part number", BOM_FIELDS),
            _col("bom_name", False, "BOM name", BOM_FIELDS),
            _col("version", False, "Version (default 1.0; '1' becomes '1.0')", BOM_FIELDS),
            _col("bom_line", False, "Line number (assigned in file order when blank)", BOM_FIELDS),
            _col("part_number", False, "Component part number", BOM_FIELDS),
            _col("material_description", True, "Component description", BOM_FIELDS),
            _col("qty", True, "Quantity per finished unit", BOM_FIELDS),
            _col("unit", False, "Unit of measure", BOM_FIELDS),
            _col("unit_price", True, "Cost per component unit (or give material_cost)", BOM_FIELDS),
            _col("material_cost", False, "Extended cost (qty x unit_price); derived when blank", BOM_FIELDS),
            _col("unit_id", False, "Product to link to this BOM", BOM_FIELDS),
        ],
        "rows": [
            ["BOM-RFL308", "Ridgeline .308", "1.0", "1", "BRL-308-22", "22in .308 barrel blank", "1", "ea", "185.00", "", "RFL-308"],
            ["BOM-RFL308", "Ridgeline .308", "1.0", "2", "RCV-700", "Receiver forging", "1", "ea", "140.00", "", "RFL-308"],
            ["BOM-RFL308", "Ridgeline .308", "1.0", "3", "STK-SYN", "Synthetic stock", "1", "ea", "95.00", "", "RFL-308"],
        ],
    },
    "prices": {
        "step": 7, "title": "Price list", "endpoint": "POST /import/prices",
        "description": "What each customer type or customer pays. Most specific wins: customer + product > "
                       "customer (all products) > type + product > type (all products) > product > base price.",
        "columns": [
            _col("unit_id", False, "Product (blank = every product, discount rules only)", PRICE_IMPORT_FIELDS),
            _col("customer_type", False, "Customer type the price applies to", PRICE_IMPORT_FIELDS),
            _col("customer_id", False, "A single customer (overrides its type)", PRICE_IMPORT_FIELDS),
            _col("unit_price", False, "Fixed price per unit", PRICE_IMPORT_FIELDS),
            _col("discount_pct", False, "Discount off base_price instead of a fixed price (40% or 0.40)",
                 PRICE_IMPORT_FIELDS),
            _col("start_period", False, "First month (YYYY-MM); blank = always", PRICE_IMPORT_FIELDS),
            _col("end_period", False, "Last month (YYYY-MM); blank = open", PRICE_IMPORT_FIELDS),
            _col("forecast_id", False, "Scenario; blank = company-wide (or set forecast_id on the request)",
                 PRICE_IMPORT_FIELDS),
            _col("notes", False, "Notes", PRICE_IMPORT_FIELDS),
        ],
        "rows": [
            ["RFL-308", "Dealer", "", "1199.00", "", "2027-01", "2027-12", "", "2027 dealer price"],
            ["RFL-308", "Distributor", "", "1049.00", "", "2027-01", "2027-12", "", "2027 distributor price"],
            ["", "", "CUST-003", "", "20%", "2027-01", "2027-12", "", "Sheriff contract: 20% off list"],
        ],
    },
    "deductions": {
        "step": 8, "title": "Discounts, allowances & excise", "endpoint": "POST /import/deductions",
        "description": "Rules taken off gross sales (terms, chargebacks, other allowances, excise tax) and "
                       "commissions. One rule per type applies to each sale: the most specific. Excise is "
                       "embedded in the price: tax = price x 11% / 1.11.",
        "columns": [
            _col("deduction_type", True, "terms_allowance, chargebacks, other_allowance, excise_tax or commission",
                 DEDUCTION_IMPORT_FIELDS),
            _col("name", False, "Label", DEDUCTION_IMPORT_FIELDS),
            _col("method", False, "percent_of_gross (default), embedded_tax (default for excise), percent_of_net, "
                                  "per_unit", DEDUCTION_IMPORT_FIELDS),
            _col("rate", False, "Rate: 2%, 0.02 or 2", DEDUCTION_IMPORT_FIELDS),
            _col("amount_per_unit", False, "$ per unit for method per_unit", DEDUCTION_IMPORT_FIELDS),
            _col("customer_type", False, "Limit to a customer type", DEDUCTION_IMPORT_FIELDS),
            _col("customer_id", False, "Limit to one customer", DEDUCTION_IMPORT_FIELDS),
            _col("unit_type", False, "Limit to a product type", DEDUCTION_IMPORT_FIELDS),
            _col("unit_id", False, "Limit to one product", DEDUCTION_IMPORT_FIELDS),
            _col("start_period", False, "First month (YYYY-MM)", DEDUCTION_IMPORT_FIELDS),
            _col("end_period", False, "Last month (YYYY-MM)", DEDUCTION_IMPORT_FIELDS),
        ],
        "rows": [
            ["terms_allowance", "2% 10 net 30 - dealers", "percent_of_gross", "2%", "", "Dealer", "", "", "", "2027-01", ""],
            ["chargebacks", "Misc chargebacks", "percent_of_gross", "1%", "", "", "", "", "", "2027-01", ""],
            ["excise_tax", "FET 11% (all other firearms)", "embedded_tax", "11%", "", "", "", "", "", "2027-01", ""],
            ["excise_tax", "FET 10% (pistols)", "embedded_tax", "10%", "", "", "", "Pistol", "", "2027-01", ""],
            ["excise_tax", "Government sales exempt", "embedded_tax", "0%", "", "Government", "", "", "", "2027-01", ""],
            ["commission", "Rep commission - distributors", "percent_of_net", "3%", "", "Distributor", "", "", "", "2027-01", ""],
        ],
    },
    "sales": {
        "step": 9, "title": "Sales forecast", "endpoint": "POST /forecast/smart_import_sales",
        "description": "Monthly units by customer and product for the active scenario. Leave unit_price blank to "
                       "price from the price list (then the product's base price). Periods: 2027-01, 1/2027, "
                       "Jan-27, Jan 2027 or a date. One column per month (Jan-27, Feb-27, ...) also works.",
        "columns": [
            _col("customer_id", True, "Customer (id; unknown ids are created when autoCreate)", SALES_FIELDS),
            _col("customer_name", False, "Used when the customer is created", SALES_FIELDS),
            _col("customer_type", False, "Used when the customer is created", SALES_FIELDS),
            _col("unit_id", True, "Product (id; unknown ids are created when autoCreate)", SALES_FIELDS),
            _col("unit_name", False, "Used when the product is created", SALES_FIELDS),
            _col("period", True, "Month: 2027-01, 1/2027, Jan-27 ...", SALES_FIELDS),
            _col("quantity", True, "Units (decimals kept)", SALES_FIELDS),
            _col("unit_price", False, "Blank = price list / base price", SALES_FIELDS),
        ],
        "rows": [
            ["CUST-001", "Main Street Guns", "Dealer", "RFL-308", "Ridgeline Hunter .308 Rifle", "2027-01", "12", ""],
            ["CUST-002", "Big Sky Sporting Distributors", "Distributor", "RFL-308", "Ridgeline Hunter .308 Rifle",
             "2027-01", "40", "1049.00"],
            ["CUST-003", "County Sheriff's Office", "Government", "PST-9C", "Compact 9mm Pistol", "2027-02", "25", ""],
        ],
    },
}
TEMPLATE_ALIASES = {"units": "products", "product": "products", "laborrates": "labor_rates", "labor": "labor_rates",
                    "bom": "boms", "routing": "routings", "routers": "routings", "price": "prices",
                    "pricelist": "prices", "deduction": "deductions", "customer": "customers", "machine": "machines",
                    "salesforecast": "sales", "forecast": "sales"}


def _template_kind(kind: str) -> str:
    if kind in TEMPLATES:
        return kind
    alias = TEMPLATE_ALIASES.get(header_key(kind))
    if alias:
        return alias
    raise HTTPException(status_code=404, detail=f"Unknown template '{kind}'; one of {', '.join(TEMPLATES)}")


@router.get("/templates", response_model=ForecastResponse)
async def list_templates():
    """Every import template in setup order, with columns, aliases and the endpoint that takes it."""
    templates = []
    for kind, spec in sorted(TEMPLATES.items(), key=lambda kv: kv[1]["step"]):
        templates.append({
            "kind": kind, "step": spec["step"], "title": spec["title"], "description": spec["description"],
            "endpoint": spec["endpoint"], "download_url": f"/import/templates/{kind}",
            "columns": spec["columns"],
        })
    return ForecastResponse(
        status="success",
        data={"templates": templates,
              "notes": ["Column names are matched ignoring case, spaces, underscores and dashes, and through the "
                        "aliases listed per column.",
                        "Send dry_run: true first to preview created / updated rows and errors without writing.",
                        "Errors reference the 1-based data row (row 1 = first row under the header)."]},
        message=f"{len(templates)} import templates",
    )


@router.get("/templates/{kind}")
async def download_template(kind: str):
    """A CSV template (header + example rows) for one import kind."""
    spec = TEMPLATES[_template_kind(kind)]
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow([c["name"] for c in spec["columns"]])
    for row in spec["rows"]:
        writer.writerow(row)
    filename = f"{_template_kind(kind)}_template.csv"
    return Response(content=buffer.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})
