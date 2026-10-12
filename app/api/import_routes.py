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
from api import pricing_routes
from db.database import db_manager
from db.models import ForecastResponse
from services.pricing import STACKING_TYPES, deduction_rule_key, precedence_key, price_rule_key, program_name
from utils.cost_rollup import calculate_unit_costs, load_bom_lines, resolve_bom_version
from utils.period_normalizer import month_from_name, normalize_month

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

    def source_column(self, row: Dict[str, Any], canonical: str) -> Optional[str]:
        """The raw column ``map_row`` takes ``canonical`` from (None when no filled column maps to it)."""
        best: Optional[Tuple[str, int]] = None
        for raw_key, value in row.items():
            hit = self.lookup.get(header_key(raw_key))
            if not hit or hit[0] != canonical or _blank(value):
                continue
            if best is None or hit[1] < best[1]:
                best = (raw_key, hit[1])
        return best[0] if best else None


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
                        "cycle_minutes", "cycle_time", "machine_minutes_per_unit", "run_min", "run_mins",
                        "run_min_per_unit", "run_minutes_per_unit", "run_time_min", "run_time_mins",
                        "run_time_minutes", "cycle_min", "cycle_mins", "cycle_time_min", "machine_run_minutes",
                        "machine_run_min", "machine_time_min"),
    "machine_hours": ("machine_hrs", "run_hours", "run_hrs", "run_hr", "run_time_hrs", "run_time_hours",
                      "machine_hr"),
    "labor_minutes": ("labor_min", "labor_time", "labor_mins", "labour_minutes", "labor_minutes_per_unit",
                      "labour_min", "labour_mins", "labor_time_min", "direct_labor_min", "direct_labor_minutes",
                      "labor_min_per_unit", "labor_run_min"),
    "labor_hours": ("labor_hrs", "labour_hours", "labor_hr", "labour_hrs"),
    "labor_type_id": ("labor_type", "labor_rate", "rate_id", "labor_rate_id", "labor_type_name", "labor_class",
                      "labor_category"),
    "operation_description": ("description", "operation_name", "op_description", "operation_desc", "op_name"),
    "unit_id": ("product_id", "sku", "product", "item_number", "item", "part_number", "product_code", "item_no",
                "part_no"),
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
    "unit_id": ("product", "product_id", "sku", "item", "item_number", "part_number", "product_code", "model"),
    "unit_name": ("product_name",),
    "unit_type": ("product_type", "product_category", "product_family", "family", "category"),
    "customer_id": ("customer", "customer_number", "account", "account_number", "cust_id", "customer_no",
                    "customer_code", "cust_no", "customer_num", "account_no", "cust"),
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
    "customer_id": ("customer", "customer_number", "account", "account_number", "cust_id", "customer_no",
                    "customer_code", "cust_no", "customer_num", "account_no", "cust"),
    "customer_name": (),
    "customer_type": ("channel", "class", "customer_class", "segment"),
    "unit_id": ("product", "product_id", "sku", "item", "item_number", "part_number", "product_code"),
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
                            "cust_id", "customer", "cust", "cust_no", "cust_number", "customer_num", "account_no",
                            "acct", "acct_no"),
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
            "unit_id": ("product_id", "sku", "item", "item_number", "part_number", "product_code", "id", "product",
                        "model", "item_no", "part", "part_no", "product_number", "product_no", "model_number"),
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
        # No bom_version default: a blank version is resolved against the BOM's stored versions (or left
        # NULL), so a product on a single-version BOM is costed from it whatever the version is called.
        "defaults": {"router_version": "1.0"},
    },
    "machines": {
        "key": "machine_id", "name": "machine_name", "id_format": ("M", 4), "label": "machine",
        "fields": FieldMap({
            "machine_id": ("machine", "work_center", "workcenter", "work_center_id", "id"),
            "machine_name": ("name", "work_center_name"),
            "machine_description": ("description",),
            "machine_rate": ("rate", "hourly_rate", "cost_per_hour", "rate_per_hour", "burden_rate", "rate_hr",
                             "rate_per_hr", "cost_per_hr", "hourly", "hourly_cost"),
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
            "rate_amount": ("rate", "hourly_rate", "amount", "wage", "cost_per_hour", "rate_per_hour", "rate_hr",
                            "rate_per_hr", "cost_per_hr", "hourly", "hourly_wage", "pay_rate"),
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


#: Accounting-format zero: Excel's accounting style shows 0 as '-' (or ' $ - ').
_ACCOUNTING_ZEROS = {"-", "--", "\u2013", "\u2014", "\u2212"}


def _number(value: Any, field: str) -> Optional[float]:
    """'$1,234.50', '(12)', 3 -> float; an accounting zero ('-', ' - ', '\u2014') -> 0; blank -> None."""
    if _blank(value):
        return None
    if isinstance(value, bool):
        raise ImportRowError(f"{field} must be a number, got {value!r}")
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "").replace("$", "").replace(" ", "")
    if text in _ACCOUNTING_ZEROS:
        return 0.0
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


#: An ERP subtotal / total line ('Total', 'Grand Total', 'Subtotal:', 'Total for SRA-R100').
_TOTAL_RE = re.compile(r"^(grand\s+|sub-?\s*)?totals?(\s*(:|-|for\b).*)?$", re.IGNORECASE)


def note_or_total_row(row: Dict[str, Any]) -> Optional[str]:
    """
    The text of a row that is a footnote or a total line rather than data, else None: its first filled
    cell is 'Total' / 'Grand Total' / 'Subtotal' ..., or its only filled cell is a note ('Note: ...' or a
    sentence of five words or more). Such rows are skipped (and reported) instead of being imported as a
    component / price / customer named 'Total'.
    """
    cells = [v for v in row.values() if not _blank(v)]
    if not cells or not isinstance(cells[0], str):
        return None
    text = cells[0].strip()
    if _TOTAL_RE.match(text):
        return text
    if len(cells) == 1 and (text.lower().startswith(("note:", "notes:", "note -", "*")) or len(text.split()) >= 5):
        return text
    return None


def _skipped_rows_warning(skipped: List[Tuple[int, str]]) -> List[str]:
    if not skipped:
        return []
    shown = "; ".join(f"row {r} ('{t[:60]}{'...' if len(t) > 60 else ''}')" for r, t in skipped[:5])
    many = len(skipped) != 1
    return [f"Skipped {len(skipped)} row{'s' if many else ''} that look{'' if many else 's'} like notes or totals, "
            f"not data: {shown}" + (f" and {len(skipped) - 5} more" if len(skipped) > 5 else "")]


def _map_rows(rows: List[Dict[str, Any]], fields: FieldMap, prepare=None,
              skipped: Optional[List[Tuple[int, str]]] = None) -> Tuple[List[Tuple[int, Dict[str, Any]]], List[str], int]:
    """[(1-based row number, mapped row)], unknown columns, blank-row count. Note / total rows go to ``skipped``."""
    mapped: List[Tuple[int, Dict[str, Any]]] = []
    unknown: List[str] = []
    blank = 0
    for index, row in enumerate(rows, start=1):
        note = note_or_total_row(row)
        if note is not None:
            if skipped is not None:
                skipped.append((index, note))
            continue
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


# ---------------------------------------------------------------------------
# Header row detection and continuation rows
# ---------------------------------------------------------------------------

def _all_field_maps() -> List[FieldMap]:
    return [BOM_FIELDS, ROUTING_FIELDS, SALES_FIELDS, PRICE_IMPORT_FIELDS, DEDUCTION_IMPORT_FIELDS,
            *(spec["fields"] for spec in RECORD_TABLES.values())]


def _is_column_name(cell: Any, maps: Sequence[FieldMap]) -> bool:
    """A cell that is a known column name or alias (any import), or a month label (Jan-27, 2027-01, Jan)."""
    if not isinstance(cell, str) or not cell.strip():
        return False
    key = header_key(cell)
    return (any(key in m.lookup for m in maps) or normalize_month(cell) is not None
            or month_from_name(cell) is not None)


def guess_header_row(grid: Sequence[Sequence[Any]], scan: int = 30) -> Optional[int]:
    """
    0-based index of the row of a sheet that holds the column names.

    A report title ('Costed Bill of Material ... Run date: 10/12/2026') often
    sits above the real header. The first row (of the first ``scan``) in
    which at least two cells, and at least half of the filled cells, are
    known column names or aliases of any import wins; otherwise the first row
    with two filled cells, then the first non-empty row; None when the grid
    is empty. File readers (the MCP file tools, scripts) use this to pick
    ``header_row``.
    """
    maps = _all_field_maps()
    first_two = first_one = None
    for index, row in enumerate(list(grid)[:scan]):
        cells = [c for c in (row or []) if not _blank(c)]
        if not cells:
            continue
        if first_one is None:
            first_one = index
        if len(cells) >= 2 and first_two is None:
            first_two = index
        known = sum(1 for c in cells if _is_column_name(c, maps))
        if known >= 2 and known * 2 >= len(cells):
            return index
    return first_two if first_two is not None else first_one


def _header_problem(rows: List[Dict[str, Any]], fields: FieldMap, mapped: List[Tuple[int, Dict[str, Any]]],
                    expected: Sequence[str]) -> Optional[Dict[str, Any]]:
    """
    One file-level error when no column of the file is recognised (nothing
    could be imported): usually a title row above the header was read as the
    header. Points at the data row that looks like the real header.
    """
    if any(data for _, data in mapped):
        return None
    columns: List[str] = []
    for row in rows:
        for key in row:
            if not _blank(key) and str(key) not in columns:
                columns.append(str(key))
    shown = ", ".join(f"'{c}'" for c in columns[:6]) + (" ..." if len(columns) > 6 else "")
    message = f"No column name was recognised (the columns are {shown})"
    for index, row in enumerate(rows[:30], start=1):
        names = [str(v).strip() for v in row.values() if isinstance(v, str) and fields.canonical(v)]
        if len(names) >= 2:
            listed = ", ".join(f"'{n}'" for n in names[:6])
            return {"row": index, "error": (
                f"{message}, so the header was probably taken from a title row. Data row {index} looks like the "
                f"real header ({listed}): read the file again with header_row set to the row that holds the column "
                f"names (nothing was imported)")}
    return {"row": 1, "error": (
        f"{message}. Check that the header row holds the column names (pass header_row when a title sits above "
        f"it); expected columns such as {', '.join(expected)} (nothing was imported)")}


def _fill_down(mapped: List[Tuple[int, Dict[str, Any]]], id_field: str, parent_fields: Sequence[str],
               child_fields: Sequence[str]) -> Tuple[List[Tuple[int, Dict[str, Any]]], List[int]]:
    """
    ERP exports often put the parent id (and its name / version / product)
    only on the first row of each block. A row with a blank parent id but
    component / operation data takes the parent fields of the row above.
    Returns the rows and the row numbers that were filled.
    """
    out: List[Tuple[int, Dict[str, Any]]] = []
    filled: List[int] = []
    last: Optional[Dict[str, Any]] = None
    for row_no, data in mapped:
        if _blank(data.get(id_field)):
            if last is not None and any(not _blank(data.get(f)) for f in child_fields):
                data = dict(data)
                for field in parent_fields:
                    if _blank(data.get(field)) and not _blank(last.get(field)):
                        data[field] = last[field]
                filled.append(row_no)
        else:
            last = {f: data.get(f) for f in parent_fields}
        out.append((row_no, data))
    return out, filled


def _lookup_unit_by_id(cursor, value: str) -> Optional[str]:
    """The product whose unit_id is value (exact, else the one case-insensitive match); never by name."""
    cursor.execute("SELECT unit_id FROM units WHERE unit_id = ?", (value,))
    row = cursor.fetchone()
    if row:
        return row[0]
    cursor.execute("SELECT unit_id FROM units WHERE LOWER(TRIM(unit_id)) = LOWER(TRIM(?))", (value,))
    rows = cursor.fetchall()
    return rows[0][0] if len(rows) == 1 else None


def _header_problem_result(problem: Dict[str, Any], kind: str, rows: List[Dict[str, Any]], mode: str,
                           dry_run: bool, unknown: List[str], **extra: Any) -> ForecastResponse:
    data = _result(kind=kind, dry_run=dry_run, mode=mode, rows=len(rows), errors=[problem],
                   warnings=_ignored_columns_warning(unknown), **extra)
    return ForecastResponse(status="success", data=data, message=f"Nothing imported: {problem['error']}")


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


def _message(kind: str, dry_run: bool, created: int, updated: int, replaced: int, skipped: int, errors: int,
             unchanged: int = 0) -> str:
    parts = [f"{created} created", f"{updated} updated"]
    if unchanged:
        parts.append(f"{unchanged} unchanged")
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
#: Columns that are the component in most BOM exports but sometimes name the finished product.
_BOM_LINK_KEYS = {"itemnumber", "item", "partnumber", "itemno", "partno"}
_BOM_PARENT_FIELDS = ("bom_id", "version", "bom_name", "bom_description", "unit_id")
_BOM_CHILD_FIELDS = ("material_description", "part_number", "qty", "unit", "unit_price", "material_cost",
                     "target_cost", "bom_line")


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


def _bom_link_columns(rows: List[Dict[str, Any]], product_ids: set) -> List[str]:
    """
    'Item Number' / 'Item' / 'Part Number' columns that name the finished
    product (the BOM's unit_id) instead of a component: another column gives
    the component, the value is the same on every row of a BOM (or blank on
    continuation rows), every value is an existing product id and at least
    one BOM has two or more rows. Otherwise the column stays the component.
    """
    headers: List[str] = []
    for row in rows:
        for key in row:
            if key not in headers:
                headers.append(key)
    links: List[str] = []
    for column in (h for h in headers if header_key(h) in _BOM_LINK_KEYS):
        others = [h for h in headers if h != column]
        if not any(BOM_FIELDS.canonical(h) in ("part_number", "material_description")
                   or header_key(h) in _BOM_CODE_COLUMNS for h in others):
            continue
        values: Dict[str, set] = {}
        sizes: Dict[str, int] = {}
        last_bom: Optional[str] = None
        is_link = True
        for row in rows:
            data, _ = BOM_FIELDS.map_row({k: v for k, v in row.items() if k != column})
            bom = _text(data.get("bom_id"))
            if bom:
                last_bom = bom
            elif any(not _blank(data.get(f)) for f in _BOM_CHILD_FIELDS):
                bom = last_bom
            if not bom:
                continue
            sizes[bom] = sizes.get(bom, 0) + 1
            value = _text(row.get(column))
            if value is None:
                continue
            if value.lower() not in product_ids:
                is_link = False
                break
            values.setdefault(bom, set()).add(value.lower())
        if (is_link and values and all(len(v) == 1 for v in values.values())
                and any(n >= 2 for n in sizes.values())):
            links.append(column)
    return links


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
    given_cost: Optional[float] = None
    if unit_price is None and material_cost is None:
        unit_price, material_cost = 0.0, 0.0
        notes.append("no_cost")
    elif not unit_price and material_cost:
        # Only the extended cost (or a zero unit cost next to it): costing falls back to it, so the
        # unit price is derived from it and the two stored fields agree.
        if qty == 0:
            raise ImportRowError("qty is 0, so unit_price cannot be derived from material_cost; give unit_price")
        unit_price = material_cost / qty
    elif unit_price is None:
        unit_price = 0.0                       # material_cost 0
    else:
        # Costing (utils.cost_rollup.bom_line_cost) uses qty x unit_price whenever the unit price is set,
        # so that is what is stored; a different extended cost in the file is reported.
        computed = qty * unit_price
        if material_cost is not None and round(abs(material_cost - computed), 6) > 0.01:
            notes.append("cost_mismatch")
            given_cost = material_cost
        material_cost = computed
    return {
        "bom_id": bom_id,
        "version": version,
        "bom_line": _whole(data.get("bom_line"), "bom_line"),
        "material_description": material,
        "qty": qty,
        "unit": _text(data.get("unit")),
        "unit_price": unit_price,
        "material_cost": material_cost,
        "given_material_cost": given_cost,
        "target_cost": _non_negative(data.get("target_cost"), "target_cost"),
        "unit_id": _text(data.get("unit_id")),
        "bom_name": _text(data.get("bom_name")),
        "bom_description": _text(data.get("bom_description")),
    }, notes


def _all_unit_ids() -> set:
    conn = db_manager.get_connection()
    try:
        return {str(r[0]).strip().lower() for r in conn.execute("SELECT unit_id FROM units").fetchall() if r[0]}
    finally:
        db_manager.close_connection(conn)


@router.post("/boms", response_model=ForecastResponse)
async def import_boms(payload: Dict[str, Any] = Body(...)):
    """
    Import bill-of-materials lines.

    Body: ``{rows, mode: 'replace'|'append' = 'replace', link_products = true,
    dry_run = false}``. ``replace`` deletes the existing lines of every BOM +
    version in the file and inserts the file's lines; ``append`` upserts by
    bom_id + version + bom_line. Missing bom_line numbers are assigned in
    file order; version '1' becomes '1.0'. A row with a blank bom_id but
    component data belongs to the BOM above it (ERP layouts that show the
    parent once per block). Costing uses qty x unit_price, so that is what is
    stored as material_cost; unit_price = material_cost / qty when only the
    extended cost is given, and an extended cost that differs from qty x
    unit_price by more than a cent is reported. Rows with a unit_id (product)
    link that product to the BOM + version; a BOM whose id is an existing
    product's id links that product when it has no BOM yet. A BOM with any
    row error is skipped as a whole so it is never half-replaced. The
    bom_definitions header only ever moves to a newer version.
    ``boms_replaced`` (= ``replaced``) counts whole BOMs + versions replaced
    and ``lines_deleted`` their old lines; ``created`` / ``updated`` count
    the file's lines.
    """
    from utils.data_loader import version_sort_key  # data_loader imports this module

    rows, mode, dry_run = _parse_body(payload, ("replace", "append"), "replace")
    link_products = _flag(payload.get("link_products"), True)
    link_columns: List[str] = []
    if any(header_key(k) in _BOM_LINK_KEYS for row in rows for k in row):
        link_columns = _bom_link_columns(rows, _all_unit_ids())

    def _prepare(row: Dict[str, Any]) -> Dict[str, Any]:
        if link_columns:
            row = {("unit_id" if k in link_columns else k): v for k, v in row.items()}
        return _prepare_bom_row(row)

    notes: List[Tuple[int, str]] = []
    mapped, unknown, blank_rows = _map_rows(rows, BOM_FIELDS, prepare=_prepare, skipped=notes)
    problem = _header_problem(rows, BOM_FIELDS, mapped, ("bom_id", "material_description", "qty", "unit_price"))
    if problem:
        return _header_problem_result(problem, "boms", rows, mode, dry_run, unknown, boms=[], boms_replaced=0,
                                      lines_deleted=0)
    mapped, filled = _fill_down(mapped, "bom_id", _BOM_PARENT_FIELDS, _BOM_CHILD_FIELDS)
    errors: List[Dict[str, Any]] = []
    warnings: List[str] = _ignored_columns_warning(unknown) + _skipped_rows_warning(notes)
    if link_columns:
        warnings.append(f"Read {', '.join(link_columns)} as the finished product of each BOM (the same product on "
                        f"every line of a BOM); the component comes from the other columns")
    if filled:
        warnings.append(f"{len(filled)} rows had no bom_id, so each was given the BOM of the row above "
                        f"(continuation rows {_row_list(filled)})")

    groups: Dict[Tuple[str, str], List[Tuple[int, Dict[str, Any]]]] = {}
    bad_groups: Dict[Tuple[str, str], List[int]] = {}
    qty_defaulted: List[int] = []
    no_cost: List[int] = []
    mismatches: List[Tuple[int, float, float]] = []
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
            mismatches.append((row_no, line["given_material_cost"], line["material_cost"]))
    if mismatches:
        details = "; ".join(f"row {r}: {given:,.2f} in the file, qty x unit_price {stored:,.2f}"
                            for r, given, stored in mismatches[:12])
        warnings.append(
            f"Material cost differs from qty x unit_price by more than 1 cent on rows "
            f"{_row_list([m[0] for m in mismatches])}; material_cost is stored as qty x unit_price, which is what "
            f"costing uses ({details}). Fix unit_price, or leave it blank to cost the line from the extended cost")
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
            cursor.execute("SELECT version FROM bom_definitions WHERE bom_id = ?", (bom_id,))
            header = cursor.fetchone()
            if header:
                # The header shows the newest version; importing an older one never moves it back.
                newest = version if _blank(header[0]) or version_sort_key(version) > version_sort_key(header[0]) \
                    else header[0]
                cursor.execute(
                    """UPDATE bom_definitions SET bom_name = COALESCE(?, bom_name),
                              bom_description = COALESCE(?, bom_description), version = ?,
                              updated_at = CURRENT_TIMESTAMP WHERE bom_id = ?""",
                    (bom_name, bom_description, newest, bom_id),
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

        # A BOM numbered like the product it builds (Parent Item = SKU) costs that product when the
        # product has no BOM yet.
        auto_linked: List[str] = []
        if link_products:
            explicit = {u.lower() for u in links}
            for entry in boms:
                unit_id = _lookup_unit_by_id(cursor, entry["bom_id"])
                if not unit_id or unit_id.lower() in explicit:
                    continue
                cursor.execute("SELECT bom_id FROM units WHERE unit_id = ?", (unit_id,))
                if _blank(cursor.fetchone()[0]):
                    cursor.execute("UPDATE units SET bom_id = ?, bom_version = ? WHERE unit_id = ?",
                                   (entry["bom_id"], entry["version"], unit_id))
                    linked.setdefault((entry["bom_id"], entry["version"]), []).append(unit_id)
                    auto_linked.append(unit_id)
        if auto_linked:
            warnings.append(f"Linked {len(auto_linked)} products to the BOM with the same id (they had no BOM): "
                            f"{_row_list(auto_linked)}")

        for entry in boms:
            key = (entry["bom_id"], entry["version"])
            bom_lines = load_bom_lines(cursor, key[0], key[1])["lines"]
            cost = sum(line["line_cost"] for line in bom_lines)          # what costing uses
            cursor.execute("SELECT unit_id, bom_version FROM units WHERE bom_id = ? ORDER BY unit_id", (key[0],))
            used_by: List[str] = []
            for unit_id, unit_version in cursor.fetchall():
                found, version_used, _versions = resolve_bom_version(cursor, key[0], unit_version)
                if found and version_used == key[1]:
                    used_by.append(unit_id)
                elif not found:
                    warnings.append(f"Product {unit_id} points at BOM {key[0]} version {unit_version!s}, which has no "
                                    f"lines, so its material cost is $0; link it to version {key[1]}")
            entry.update({"lines": len(bom_lines), "material_cost_per_unit": round(float(cost), 4),
                          "linked_products": sorted(linked.get(key, [])), "used_by_products": used_by})
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
        replaced=replaced, boms_replaced=replaced, lines_deleted=lines_deleted,
        skipped=skipped, errors=sorted(errors, key=lambda e: e["row"]), warnings=_dedupe(warnings),
        boms=boms,
        summary={"boms": len(boms), "boms_replaced": replaced, "lines_written": created + updated,
                 "lines_deleted": lines_deleted,
                 "products_linked": sum(len(v) for v in linked.values()), "blank_rows": blank_rows,
                 "auto_linked_products": auto_linked, "continuation_rows": len(filled),
                 "material_cost_by_bom": {f"{b['bom_id']} v{b['version']}": b["material_cost_per_unit"] for b in boms}},
    )
    message = _message("BOM lines", dry_run, created, updated, 0, skipped, len(errors))
    if replaced:
        message += (f"; {replaced} existing BOM{'s' if replaced != 1 else ''} replaced as a whole ({lines_deleted} old "
                    f"line{'s' if lines_deleted != 1 else ''} deleted)")
    return ForecastResponse(status="success", data=data, message=message)


def _row_list(rows: Sequence[int], limit: int = 12) -> str:
    rows = list(rows)
    text = ", ".join(str(r) for r in rows[:limit])
    return text + (f" and {len(rows) - limit} more" if len(rows) > limit else "")


# ---------------------------------------------------------------------------
# Routings
# ---------------------------------------------------------------------------

MANUAL_MACHINE_ID = "MANUAL"
_ROUTING_PARENT_FIELDS = ("router_id", "router_name", "router_description", "version", "unit_id")
_ROUTING_CHILD_FIELDS = ("sequence", "machine_id", "machine_minutes", "machine_hours", "labor_minutes", "labor_hours",
                         "labor_type_id", "operation_description")


def _routing_column_warnings(unknown: List[str], mapped: List[Tuple[int, Dict[str, Any]]]) -> List[str]:
    """
    Ignored-column warnings for a routing file. Setup time is per batch, not
    per unit, so a setup column is ignored on purpose (and said so); when no
    machine-time column was recognised, a time-like ignored column is named.
    """
    setup = [c for c in unknown if header_key(c).startswith("setup")]
    other = [c for c in unknown if c not in setup]
    warnings = _ignored_columns_warning(other)
    if setup:
        warnings.append(f"Ignored {', '.join(setup)}: setup time is per batch, not per unit, so it is not part of the "
                        f"per-unit routing cost (only run / machine and labor minutes are)")
    has_machine_time = any(not _blank(d.get("machine_minutes")) or not _blank(d.get("machine_hours"))
                           for _, d in mapped)
    has_machine = any(not _blank(d.get("machine_id")) for _, d in mapped)
    timeish = [c for c in other if any(t in header_key(c) for t in ("min", "time", "hr", "hour"))]
    if has_machine and not has_machine_time and timeish:
        warnings.append(f"No machine minutes column was recognised ({', '.join(timeish)} ignored), so machine cost is "
                        f"$0: rename the run-time column to machine_minutes (or machine_hours)")
    return warnings


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
    unit_id (product / item number) link that product to the routing; a
    routing whose id is an existing product's id links that product when it
    has no routing yet. A row with a blank router_id but operation data
    belongs to the routing above it. Run time aliases include 'Run Min',
    'Run Time (min)' and 'Cycle Time'; setup minutes are ignored (per batch).
    """
    rows, mode, dry_run = _parse_body(payload, ("replace", "append"), "replace")
    auto_create = _flag(payload.get("auto_create"), False)
    link_products = _flag(payload.get("link_products"), True)
    notes: List[Tuple[int, str]] = []
    mapped, unknown, blank_rows = _map_rows(rows, ROUTING_FIELDS, skipped=notes)
    problem = _header_problem(rows, ROUTING_FIELDS, mapped, ("router_id", "machine_id", "machine_minutes",
                                                             "labor_minutes"))
    if problem:
        return _header_problem_result(problem, "routings", rows, mode, dry_run, unknown, routings=[],
                                      routings_replaced=0, operations_deleted=0)
    mapped, filled = _fill_down(mapped, "router_id", _ROUTING_PARENT_FIELDS, _ROUTING_CHILD_FIELDS)
    errors: List[Dict[str, Any]] = []
    warnings: List[str] = _routing_column_warnings(unknown, mapped) + _skipped_rows_warning(notes)
    if filled:
        warnings.append(f"{len(filled)} rows had no router_id, so each was given the routing of the row above "
                        f"(continuation rows {_row_list(filled)})")

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

        # A routing numbered like the product it makes costs that product when it has no routing yet.
        auto_linked: List[str] = []
        if link_products:
            explicit = {u.lower() for u in links}
            for entry in routings:
                unit_id = _lookup_unit_by_id(cursor, entry["router_id"])
                if not unit_id or unit_id.lower() in explicit:
                    continue
                cursor.execute("SELECT router_id FROM units WHERE unit_id = ?", (unit_id,))
                if _blank(cursor.fetchone()[0]):
                    cursor.execute("UPDATE units SET router_id = ?, router_version = ? WHERE unit_id = ?",
                                   (entry["router_id"], entry["version"], unit_id))
                    linked.setdefault(entry["router_id"], []).append(unit_id)
                    auto_linked.append(unit_id)
        if auto_linked:
            warnings.append(f"Linked {len(auto_linked)} products to the routing with the same id (they had no "
                            f"routing): {_row_list(auto_linked)}")

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
        replaced=replaced, routings_replaced=replaced, operations_deleted=ops_deleted,
        skipped=skipped, errors=sorted(errors, key=lambda e: e["row"]), warnings=warnings,
        routings=routings, created_machines=created_machines, created_labor_types=created_labor,
        summary={"routings": len(routings), "routings_replaced": replaced, "operations_written": created + updated,
                 "operations_deleted": ops_deleted,
                 "products_linked": sum(len(v) for v in linked.values()), "blank_rows": blank_rows,
                 "auto_linked_products": auto_linked, "continuation_rows": len(filled)},
    )
    message = _message("routing operations", dry_run, created, updated, 0, skipped, len(errors))
    if replaced:
        message += (f"; {replaced} existing routing{'s' if replaced != 1 else ''} replaced as a whole ({ops_deleted} "
                    f"old operation{'s' if ops_deleted != 1 else ''} deleted)")
    return ForecastResponse(status="success", data=data, message=message)


# ---------------------------------------------------------------------------
# Master records: customers, products, machines, labor rates
# ---------------------------------------------------------------------------

#: Headers that may hold either the id or the name of a customer / product ('Customer', 'Product', 'Item').
#: With '#' ('Customer #', 'Item #') or a separate name column they are the id; with no name column a
#: column whose values read like names ('Main Street Guns') is the name.
_AMBIGUOUS_ID_COLUMNS: Dict[str, set] = {
    "customers": {"customer", "cust", "account", "acct"},
    "units": {"product", "item", "model"},
}


def _record_column_overrides(table: str, spec: Dict[str, Any], rows: List[Dict[str, Any]]) -> Dict[str, str]:
    """Raw column -> canonical field for an ambiguous id column that holds names (decided per file)."""
    ambiguous_keys = _AMBIGUOUS_ID_COLUMNS.get(table)
    if not ambiguous_keys:
        return {}
    fields: FieldMap = spec["fields"]
    headers: List[str] = []
    for row in rows:
        for key in row:
            if key not in headers:
                headers.append(key)
    ambiguous = [h for h in headers if header_key(h) in ambiguous_keys and "#" not in str(h)]
    if not ambiguous:
        return {}
    others = [h for h in headers if h not in ambiguous]
    if any(fields.canonical(h) == spec["name"] for h in others):
        return {}                                   # a name column exists: the ambiguous column is the id
    has_id = any(fields.canonical(h) == spec["key"] for h in others)
    for column in ambiguous:
        values = [str(r[column]).strip() for r in rows if not _blank(r.get(column))]
        names = sum(1 for v in values if " " in v)
        if has_id or (values and names * 2 > len(values)):
            return {column: spec["name"]}
    return {}


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
    'Customer' / 'Customer #' / 'Account' and 'Product' / 'Item' / 'SKU'
    columns are the id when the file has a name column (a 'Customer' column
    of names with no name column is the name). A product given a bom_id
    without a bom_version takes the BOM's version when it has one (or the
    one matching '1.0'), else NULL; never a made-up '1.0'.
    """
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="Body must be an object: {table, rows, mode, dry_run}")
    table = _resolve_table(payload.get("table"))
    rows, mode, dry_run = _parse_body(payload, ("upsert", "skip"), "upsert")
    spec = RECORD_TABLES[table]
    key_col, name_col = spec["key"], spec["name"]
    overrides = _record_column_overrides(table, spec, rows)

    def _prepare(row: Dict[str, Any]) -> Dict[str, Any]:
        return {overrides.get(k, k): v for k, v in row.items()} if overrides else row

    notes: List[Tuple[int, str]] = []
    mapped, unknown, blank_rows = _map_rows(rows, spec["fields"], prepare=_prepare, skipped=notes)
    problem = _header_problem(rows, spec["fields"], mapped, (key_col, name_col))
    if problem:
        return _header_problem_result(problem, "records", rows, mode, dry_run, unknown, table=table, records=[],
                                      summary={"unchanged": 0, "blank_rows": blank_rows})
    errors: List[Dict[str, Any]] = []
    warnings: List[str] = _ignored_columns_warning(unknown) + _skipped_rows_warning(notes)
    records: List[Dict[str, Any]] = []
    created = updated = skipped = unchanged = 0

    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(f"PRAGMA table_info({table})")
        columns = [r[1] for r in cursor.fetchall()]
        # Customer / product types group the reports and select price and
        # deduction rules: keep one spelling per type ('dealer' -> 'Dealer').
        type_col = {"customers": "customer_type", "units": "unit_type"}.get(table)
        type_spelling: Dict[str, str] = {}
        if type_col and type_col in columns:
            cursor.execute(f"SELECT DISTINCT {type_col} FROM {table} WHERE {type_col} IS NOT NULL")
            for (existing_type,) in cursor.fetchall():
                type_spelling.setdefault(str(existing_type).strip().lower(), str(existing_type).strip())
        seen: Dict[str, int] = {}
        for row_no, data in mapped:
            try:
                values = _clean_record(table, spec, data)
            except ImportRowError as exc:
                errors.append({"row": row_no, "error": str(exc)})
                continue
            values = {k: v for k, v in values.items() if k in columns}
            if type_col and isinstance(values.get(type_col), str) and values[type_col].strip():
                values[type_col] = type_spelling.setdefault(values[type_col].strip().lower(), values[type_col].strip())
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
            if table == "units" and values.get("bom_id") and values.get("bom_version") is None:
                # A new BOM without a version: use the version the BOM has (the single-version / '1.0'
                # fallback of costing), else NULL. A stored version of a different BOM never carries over.
                keep = False
                if existing_id:
                    cursor.execute("SELECT bom_id FROM units WHERE unit_id = ?", (existing_id,))
                    keep = (cursor.fetchone() or (None,))[0] == values["bom_id"]
                if not keep:
                    found_version, version, _versions = resolve_bom_version(cursor, values["bom_id"], None)
                    values["bom_version"] = version if found_version else None
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
            found, _version, versions = resolve_bom_version(cursor, bom_id, bom_version)
            if not found and versions:
                warnings.append(f"Product {unit_id}: BOM {bom_id} has no version {bom_version} (it has "
                                f"{', '.join(str(v) for v in versions)}), so its material cost is $0")
            elif not found:
                label = f"{bom_id} v{bom_version}" if bom_version else bom_id
                warnings.append(f"Product {unit_id}: BOM {label} has no lines yet (import BOMs next)")
        if router_id:
            cursor.execute("SELECT COUNT(*) FROM router_operations WHERE router_id = ?", (router_id,))
            if not cursor.fetchone()[0]:
                warnings.append(f"Product {unit_id}: routing {router_id} has no operations yet (import routings next)")
    return warnings


# ---------------------------------------------------------------------------
# Price list and deduction rules
# ---------------------------------------------------------------------------

def _resolve_reference(cursor, data: Dict[str, Any], id_field: str, name_field: str, table: str,
                       key_col: str, name_col: str, label: str, row_label: str, warnings: List[str]) -> None:
    """Accept a name where an id is expected ('Main Street Guns' -> CUST-001); warn when nothing matches."""
    value = _text(data.get(id_field))
    name = _text(data.get(name_field))
    if value:
        resolved = _lookup_ci(cursor, table, key_col, name_col, value)
        if resolved:
            data[id_field] = resolved
        else:
            warnings.append(f"{row_label}: {label} '{value}' does not exist yet, so the rule matches no sales")
    elif name:
        resolved = _lookup_ci(cursor, table, key_col, name_col, name)
        if resolved:
            data[id_field] = resolved
        else:
            raise ImportRowError(f"{label} '{name}' not found; give its id")


# Rates and discounts: a '2%' string is always a percent. Plain numbers are decided per file column: if
# any plain number in the column is >= 1 the column holds percents (2 -> 2%, 0.5 -> 0.5%), otherwise
# fractions (0.02 = 2%; Excel percent-formatted cells arrive as fractions).
_PERCENT_TEXT_RE = re.compile(r"^\s*([-+]?(?:\d[\d,]*(?:\.\d*)?|\.\d+))\s*%\s*(?:off\b.*)?$", re.IGNORECASE)
_RATE_WARN_ABOVE = 0.25
_EXCISE_WARN_ABOVE = 0.20          # FET is 10% / 11%; state excise can add a little
_DISCOUNT_WARN_ABOVE = 0.80
_METHOD_WORDS: Dict[str, str] = {
    "percentofgross": "percent_of_gross", "percentgross": "percent_of_gross", "percentofgrosssales": "percent_of_gross",
    "percentgrosssales": "percent_of_gross", "percentofsales": "percent_of_gross", "percentofinvoice": "percent_of_gross",
    "percentofprice": "percent_of_gross", "percentoflist": "percent_of_gross",
    "percentofnet": "percent_of_net", "percentnet": "percent_of_net", "percentofnetsales": "percent_of_net",
    "percentnetsales": "percent_of_net", "percentofnetprice": "percent_of_net",
    "dollarsperunit": "per_unit", "dollarsunit": "per_unit", "dollarseach": "per_unit", "dollarsea": "per_unit",
    "perunit": "per_unit", "perea": "per_unit", "peritem": "per_unit", "flatperunit": "per_unit",
    "percentembedded": "embedded_tax", "embeddedpercent": "embedded_tax",
}
_MATRIX_BLANKS = {"n/a", "na", "none"} | _ACCOUNTING_ZEROS
_LIST_PRICE_KEYS = {"listprice", "msrp", "baseprice", "list", "retailprice", "retail", "suggestedretail", "map"}


def _bare_number(value: Any) -> Optional[float]:
    """A plain number cell (no '%' sign) as a float; None for blanks, '%' strings and text."""
    if _blank(value) or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if "%" in text:
        return None
    try:
        return _number(text, "rate")
    except ImportRowError:
        return None


def _percent_columns(rows: List[Dict[str, Any]], fields: FieldMap, canonical: str) -> Dict[str, bool]:
    """Raw column -> True when its plain numbers are percents (some plain number in it is >= 1)."""
    scale: Dict[str, bool] = {}
    for row in rows:
        for raw, value in row.items():
            if fields.canonical(raw) != canonical:
                continue
            number = _bare_number(value)
            if number is not None:
                scale[raw] = scale.get(raw, False) or abs(number) >= 1
    return scale


def _friendly_method(value: Any) -> Any:
    """'% of gross' -> percent_of_gross, '% of net sales' -> percent_of_net, '$ per unit' -> per_unit."""
    text = _text(value)
    if text is None:
        return value
    key = re.sub(r"[^a-z0-9%$]", "", text.lower()).replace("%", "percent").replace("$", "dollars")
    return _METHOD_WORDS.get(key, value)


def _prepare_rule_row(row: Dict[str, Any], fields: FieldMap, percent_field: str, scale: Dict[str, bool],
                      is_price: bool) -> Dict[str, Any]:
    out = dict(row)
    for raw, value in row.items():
        canonical = fields.canonical(raw)
        if canonical == percent_field:
            if isinstance(value, str):
                match = _PERCENT_TEXT_RE.match(value)
                if match:                                    # '40% off list' -> '40%'
                    out[raw] = f"{match.group(1)}%"
                    continue
            number = _bare_number(value)
            if number is not None and scale.get(raw):
                out[raw] = f"{number!r}%"
        elif canonical == "method" and not is_price:
            out[raw] = _friendly_method(value)
    return out


def _matrix_columns(cursor, unknown: List[str]) -> Dict[str, str]:
    """
    Price-matrix columns: an unrecognised column named after an existing
    customer type ('Dealer', 'Distributor', 'Dealer Price') holds that
    type's price for the row's product. Raw column -> customer type.
    """
    cursor.execute("SELECT DISTINCT customer_type FROM customers WHERE customer_type IS NOT NULL")
    types: Dict[str, str] = {}
    for (value,) in cursor.fetchall():
        key = header_key(value)
        if key:
            types.setdefault(key, str(value).strip())
    columns: Dict[str, str] = {}
    for raw in unknown:
        key = header_key(raw)
        match = types.get(key)
        if match is None:
            for suffix in ("netprice", "price", "pricing", "cost"):
                if key.endswith(suffix) and types.get(key[:-len(suffix)]):
                    match = types[key[:-len(suffix)]]
                    break
        if match:
            columns[raw] = match
    return columns


def _matrix_blank(value: Any) -> bool:
    return _blank(value) or (isinstance(value, str) and value.strip().lower() in _MATRIX_BLANKS)


def _numeric_columns(rows: List[Dict[str, Any]], columns: Sequence[str]) -> List[str]:
    """Columns whose filled cells are mostly numbers or percents (an unrecognised price matrix)."""
    out = []
    for column in columns:
        values = [r.get(column) for r in rows if not _matrix_blank(r.get(column))]
        numeric = sum(1 for v in values if _bare_number(v) is not None
                      or (isinstance(v, str) and _PERCENT_TEXT_RE.match(v)))
        if values and numeric * 2 > len(values):
            out.append(column)
    return out


def _expand_matrix(mapped: List[Tuple[int, Dict[str, Any]]], rows: List[Dict[str, Any]],
                   matrix: Dict[str, str]) -> List[Tuple[int, Optional[str], Dict[str, Any]]]:
    """(row, matrix column or None, rule data): one price rule per filled matrix cell, plus the row's own price."""
    items: List[Tuple[int, Optional[str], Dict[str, Any]]] = []
    scope_fields = ("customer_id", "customer_name", "customer_type", "unit_price", "discount_pct", "method")
    for row_no, data in mapped:
        raw = rows[row_no - 1]
        cells = [(column, ctype, raw.get(column)) for column, ctype in matrix.items()
                 if not _matrix_blank(raw.get(column))]
        if not cells:
            items.append((row_no, None, data))
            continue
        base = {k: v for k, v in data.items() if k not in scope_fields}
        for column, ctype, value in cells:
            item = {**base, "customer_type": ctype}
            if isinstance(value, str) and "%" in value:
                match = _PERCENT_TEXT_RE.match(value)
                item["discount_pct"] = f"{match.group(1)}%" if match else value
            else:
                item["unit_price"] = value
            items.append((row_no, column, item))
        if not _blank(data.get("unit_price")) or not _blank(data.get("discount_pct")):
            items.append((row_no, None, data))
    return items


def _plausibility_warnings(clean: Dict[str, Any], data: Dict[str, Any], label: str, is_price: bool) -> List[str]:
    """Rates / discounts that are probably a fraction-vs-percent mix-up (0.5 meant as 0.5%)."""
    if is_price:
        discount = clean.get("discount_pct")
        if discount is not None and discount > _DISCOUNT_WARN_ABOVE:
            return [f"{label}: a discount of {discount * 100:g}% off list is unusually high (over "
                    f"{_DISCOUNT_WARN_ABOVE * 100:g}%); check it ('40%' or 0.40 = 40% off)"]
        return []
    if clean.get("method") == "per_unit":
        return []
    rate = float(clean.get("rate") or 0)
    limit = _EXCISE_WARN_ABOVE if clean.get("deduction_type") == "excise_tax" else _RATE_WARN_ABOVE
    if rate <= limit:
        return []
    hint = ""
    number = _bare_number(data.get("rate"))
    if number is not None and number < 1:
        hint = (f"; the plain number {number:g} was read as a fraction ({rate * 100:g}%): write '{number:g}%' "
                f"if you meant {number:g} percent")
    return [f"{label}: {clean.get('deduction_type')} rate {rate * 100:g}% is unusually high (over {limit * 100:g}%)"
            f"{hint}; check it"]


def _echo(clean: Dict[str, Any], is_price: bool) -> Dict[str, Any]:
    """What a record stores, so a dry run shows how each rate / discount / price was read."""
    if is_price:
        return {"method": clean.get("method"), "unit_price": clean.get("unit_price"),
                "discount_pct": clean.get("discount_pct")}
    return {"deduction_type": clean.get("deduction_type"), "method": clean.get("method"), "rate": clean.get("rate"),
            "amount_per_unit": clean.get("amount_per_unit")}


def _row_ref(row_no: int, column: Optional[str]) -> str:
    return f"{row_no} ({column})" if column else str(row_no)


def _duplicate_in_file(is_price: bool, clean: Dict[str, Any], first: str, second: str) -> str:
    if is_price:
        return (f"rows {first} and {second} both price the same product / customer scope for the same months; keep "
                f"one row (the later row would replace the earlier)")
    dtype = clean.get("deduction_type")
    if dtype in STACKING_TYPES:
        if program_name(clean) is None:
            return (f"rows {first} and {second} are both {dtype} rules with no name for the same scope and months; "
                    f"other allowances stack as separate programs, so give each row a name (e.g. 'Co-op "
                    f"advertising', 'Freight allowance') or combine them into one row")
        return (f"rows {first} and {second} define the same {dtype} program '{clean.get('name')}' for the same "
                f"scope and months; combine them into one row")
    return (f"rows {first} and {second} both define {dtype} for the same scope and months; one {dtype} rule "
            f"applies to a sale, so the later row would replace the earlier: combine them into one row or scope "
            f"them differently")


def _import_rules(payload: Dict[str, Any], kind: str) -> ForecastResponse:
    """Shared body of /import/prices and /import/deductions."""
    is_price = kind == "prices"
    fields = PRICE_IMPORT_FIELDS if is_price else DEDUCTION_IMPORT_FIELDS
    table = "price_list" if is_price else "sales_deduction_rules"
    id_col = "price_id" if is_price else "rule_id"
    rule_kind = "price" if is_price else "deduction"
    key_fn = price_rule_key if is_price else deduction_rule_key
    clean_fn = clean_price_rule if is_price else clean_deduction_rule
    insert_fn = insert_price_rule if is_price else insert_deduction_rule
    update_fn = update_price_rule if is_price else update_deduction_rule
    percent_field = "discount_pct" if is_price else "rate"

    rows, mode, dry_run = _parse_body(payload, ("upsert", "append", "replace"), "upsert")
    default_forecast = _text(payload.get("forecast_id"))
    scale = _percent_columns(rows, fields, percent_field)
    notes: List[Tuple[int, str]] = []
    mapped, unknown, blank_rows = _map_rows(
        rows, fields, prepare=lambda row: _prepare_rule_row(row, fields, percent_field, scale, is_price), skipped=notes)
    errors: List[Dict[str, Any]] = []
    warnings: List[str] = _skipped_rows_warning(notes)
    results: List[Dict[str, Any]] = []
    created = updated = replaced = unchanged = 0
    replace_blocked = False
    editable = pricing_routes.PRICE_FIELDS if is_price else pricing_routes.DEDUCTION_FIELDS

    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        if default_forecast:
            cursor.execute("SELECT 1 FROM forecast WHERE forecast_id = ?", (default_forecast,))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail=f"Forecast scenario '{default_forecast}' not found")
        matrix = _matrix_columns(cursor, unknown) if is_price else {}
        problem = None if matrix else _header_problem(
            rows, fields, mapped, ("unit_id", "customer_type", "unit_price") if is_price
            else ("deduction_type", "rate", "customer_type"))
        if problem:
            conn.rollback()
            return _header_problem_result(problem, kind, rows, mode, dry_run, unknown, records=[],
                                          replace_blocked=False, unchanged=0,
                                          summary={"blank_rows": blank_rows, "rules_written": 0, "rules_deleted": 0})
        ignored = [c for c in unknown if c not in matrix]
        warnings.extend(_ignored_columns_warning(ignored))
        numeric_unknown: List[str] = []
        if is_price:
            list_columns = [c for c in ignored if header_key(c) in _LIST_PRICE_KEYS]
            if list_columns:
                warnings.append(f"{', '.join(list_columns)} ignored: the list (base) price is set on the product "
                                f"(base_price in the product import); this file sets customer / customer-type prices")
            if matrix:
                warnings.append(f"Read {', '.join(matrix)} as one price per customer type: each filled cell is a "
                                f"price rule for that customer type and the row's product ('40% off' cells are a "
                                f"discount off the list price)")
            numeric_unknown = _numeric_columns(rows, [c for c in ignored if header_key(c) not in _LIST_PRICE_KEYS])

        items = _expand_matrix(mapped, rows, matrix) if matrix else [(r, None, d) for r, d in mapped]
        cleaned: List[Tuple[int, Optional[str], Dict[str, Any], Optional[str]]] = []
        for row_no, column, data in items:
            label = f"Row {_row_ref(row_no, column)}"
            data = dict(data)
            if _blank(data.get("forecast_id")) and default_forecast:
                data["forecast_id"] = default_forecast
            try:
                _resolve_reference(cursor, data, "customer_id", "customer_name", "customers", "customer_id",
                                   "customer_name", "customer", f"Row {row_no}", warnings)
                _resolve_reference(cursor, data, "unit_id", "unit_name", "units", "unit_id", "unit_name",
                                   "product", f"Row {row_no}", warnings)
                if is_price and not _blank(data.get("unit_type")) and "unit_type" not in pricing_routes.PRICE_FIELDS:
                    raise ImportRowError("this price list has no product type (unit_type) scope yet; give one row per "
                                         "product (unit_id) instead")
                clean, rule_warnings = clean_fn(cursor, data, percent_input=True, label=label)
            except (ImportRowError, RuleValidationError) as exc:
                message = str(exc)
                if is_price and column is None and len(numeric_unknown) >= 2 and "needs unit_price" in message:
                    message = (f"no unit_price: columns {', '.join(numeric_unknown)} look like one price per customer "
                               f"type, but no customer has those customer types (import customers with these types "
                               f"first, or use the columns unit_id, customer_type, unit_price)")
                errors.append({"row": row_no, **({"column": column} if column else {}), "error": message})
                continue
            # Unknown-id warnings were already given by _resolve_reference.
            warnings.extend(w for w in rule_warnings if "does not exist yet" not in w)
            warnings.extend(_plausibility_warnings(clean, data, label, is_price))
            cleaned.append((row_no, column, clean, _text(data.get(id_col))))

        # The same slot twice in one file: the later row would silently replace the earlier.
        first_by_key: Dict[Tuple, str] = {}
        kept: List[Tuple[int, Optional[str], Dict[str, Any], Optional[str]]] = []
        for row_no, column, clean, given_id in cleaned:
            if not given_id and clean.get("is_active", 1):
                key = key_fn(clean)
                if key in first_by_key:
                    errors.append({"row": row_no, **({"column": column} if column else {}),
                                   "error": _duplicate_in_file(is_price, clean, first_by_key[key],
                                                               _row_ref(row_no, column))})
                    continue
                first_by_key[key] = _row_ref(row_no, column)
            kept.append((row_no, column, clean, given_id))

        if mode == "replace" and kept:
            scopes = sorted({c[2]["forecast_id"] for c in kept}, key=lambda v: v or "")
            for fid in scopes:
                if fid is None:
                    cursor.execute(f"SELECT COUNT(*) FROM {table} WHERE forecast_id IS NULL")
                    replaced += int(cursor.fetchone()[0] or 0)
                    cursor.execute(f"DELETE FROM {table} WHERE forecast_id IS NULL")
                else:
                    cursor.execute(f"SELECT COUNT(*) FROM {table} WHERE forecast_id = ?", (fid,))
                    replaced += int(cursor.fetchone()[0] or 0)
                    cursor.execute(f"DELETE FROM {table} WHERE forecast_id = ?", (fid,))

        # Stored rules by slot (services.pricing deduction_rule_key / price_rule_key: scenario, scope, months
        # and, for other allowances, the program name). An active rule, then the winning one, holds a slot.
        existing_by_key: Dict[Tuple, Tuple[str, bool]] = {}
        ranks: Dict[Tuple, Tuple] = {}
        cursor.execute(f"SELECT * FROM {table}")
        columns = [d[0] for d in cursor.description]
        for row in cursor.fetchall():
            record = dict(zip(columns, row))
            active = record.get("is_active") is None or bool(record.get("is_active"))
            key = key_fn(record)
            rank = (active, precedence_key(record, rule_kind))
            if key not in ranks or rank > ranks[key]:
                ranks[key] = rank
                existing_by_key[key] = (record[id_col], active)

        for row_no, column, clean, given_id in kept:
            ref = {"row": row_no, **({"column": column} if column else {})}
            key = key_fn(clean)
            target = None
            if mode in ("upsert", "replace"):
                if given_id:
                    cursor.execute(f"SELECT 1 FROM {table} WHERE {id_col} = ?", (given_id,))
                    target = given_id if cursor.fetchone() else None
                if target is None and key in existing_by_key:
                    target = existing_by_key[key][0]
            elif clean.get("is_active", 1) and existing_by_key.get(key, (None, False))[1]:
                # append: a second active rule in the same slot would tie with the stored one.
                what = "price rule" if is_price else f"{clean.get('deduction_type')} rule"
                errors.append({**ref, "error": f"an active {what} with this scope and months already exists "
                                               f"({existing_by_key[key][0]}); a second one would never apply: import "
                                               f"with mode upsert to update it"})
                continue
            if target:
                cursor.execute(f"SELECT * FROM {table} WHERE {id_col} = ?", (target,))
                stored_row = cursor.fetchone()
                stored = dict(zip([d[0] for d in cursor.description], stored_row)) if stored_row else {}
                if stored and _same_rule(stored, clean, editable):
                    unchanged += 1           # the file repeats what is stored: nothing to write
                    results.append({**ref, id_col: target, "action": "unchanged", **_echo(clean, is_price)})
                    continue
                update_fn(cursor, target, clean)
                updated += 1
                results.append({**ref, id_col: target, "action": "updated", **_echo(clean, is_price)})
            else:
                keep_id = given_id if given_id and _id_free(cursor, table, id_col, given_id) else None
                new_id = insert_fn(cursor, clean, keep_id)
                created += 1
                existing_by_key[key] = (new_id, bool(clean.get("is_active", 1)))
                results.append({**ref, id_col: new_id, "action": "created", **_echo(clean, is_price)})

        # Replacing is all-or-nothing: never delete a scenario's rules on the strength of a file that did
        # not fully import.
        replace_blocked = mode == "replace" and bool(errors)
        if replace_blocked:
            conn.rollback()
        else:
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
        unchanged=unchanged,
        skipped=0, errors=sorted(errors, key=lambda e: e["row"]), warnings=_dedupe(warnings), records=results,
        replace_blocked=replace_blocked,
        summary={"blank_rows": blank_rows, "rules_written": created + updated, "rules_deleted": replaced,
                 "unchanged": unchanged, "matrix_columns": matrix},
    )
    label = "price rules" if is_price else "deduction rules"
    message = _message(label, dry_run, created, updated, replaced, 0, len(errors), unchanged)
    if replace_blocked:
        message = (f"Nothing was changed: {len(errors)} row{'s' if len(errors) != 1 else ''} had errors, and a replace "
                   f"import only runs when every row is valid. Fix the rows (or import with mode=upsert) and try again.")
        if dry_run:
            message = "Dry run, nothing written: " + message
    return ForecastResponse(status="success", data=data, message=message)


def _same_rule(stored: Dict[str, Any], clean: Dict[str, Any], fields: Sequence[str]) -> bool:
    """True when writing ``clean`` over ``stored`` would change no editable column (numbers to a millionth)."""
    for field in fields:
        old, new = stored.get(field), clean.get(field)
        if field == "is_active":
            old = 1 if old is None else int(bool(old))
            new = 1 if new is None else int(bool(new))
        if isinstance(old, str):
            old = old.strip() or None
        if isinstance(new, str):
            new = new.strip() or None
        if old is None or new is None:
            if old is not new:
                return False
            continue
        if isinstance(old, (int, float)) and isinstance(new, (int, float)):
            if abs(float(old) - float(new)) > 1e-6 * max(1.0, abs(float(old)), abs(float(new))):
                return False
        elif str(old) != str(new):
            return False
    return True


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
    same price_id, or the same scope (scenario, product, product type,
    customer, customer type, start, end); ``replace`` first deletes every
    price rule of the scenarios in the file and is all-or-nothing (any row
    error -> nothing changes, ``replace_blocked``). A row with a discount and
    no price is a discount_from_base rule; discounts accept '40%', '40% off
    list' or a plain number, read per column: a column with any plain number
    >= 1 is percents (40 -> 40%, 0.5 -> 0.5%), otherwise fractions (0.4).
    Discounts over 80% are flagged. A unit_type / product_type column prices
    every product of that type. A wide price matrix (Product | Dealer |
    Distributor | ...: columns named after existing customer types) makes
    one rule per filled cell (records / errors carry the ``column``). The
    same scope twice in one file is a row error. Customers / products may
    be given by name. A row identical to the stored rule is counted as
    ``unchanged`` (records action 'unchanged') and not rewritten.
    """
    return _import_rules(payload, "prices")


@router.post("/deductions", response_model=ForecastResponse)
async def import_deductions(payload: Dict[str, Any] = Body(...)):
    """
    Import sales deduction rules (terms, chargebacks, other allowances,
    excise tax, commission).

    Body as /import/prices. deduction_type accepts friendly names ('terms',
    'chargebacks', 'FET', 'excise', 'commission'); method accepts 'percent',
    '% of gross', '% of net sales', 'embedded', 'per unit', '$ per unit';
    rate accepts '2%' (always a percent) or a plain number read per column:
    a column with any plain number >= 1 is percents (2 -> 2%, 0.5 -> 0.5%),
    otherwise fractions (0.02 = 2%). Rates over 25% (excise over 20%) are
    flagged. Excise rules default to the embedded_tax method. Rows upsert
    on the rule's slot (type, scenario, scope, months; for other_allowance
    also the program name, so 'Co-op' and 'Freight allowance' are separate
    programs that both apply). The same slot twice in one file is a row
    error; in append mode a row that would duplicate an active rule is a
    row error. A row identical to the stored rule is counted as
    ``unchanged``, not ``updated``.
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
            _col("machine_minutes", False, "Machine (run) minutes per unit; setup minutes are not used",
                 ROUTING_FIELDS),
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
            _col("bom_id", True, "BOM / parent part number (blank on a row = the BOM above; equal to a product "
                                 "id = that product's BOM)", BOM_FIELDS),
            _col("bom_name", False, "BOM name", BOM_FIELDS),
            _col("version", False, "Version (default 1.0; '1' becomes '1.0')", BOM_FIELDS),
            _col("bom_line", False, "Line number (assigned in file order when blank)", BOM_FIELDS),
            _col("part_number", False, "Component part number", BOM_FIELDS),
            _col("material_description", True, "Component description", BOM_FIELDS),
            _col("qty", True, "Quantity per finished unit", BOM_FIELDS),
            _col("unit", False, "Unit of measure", BOM_FIELDS),
            _col("unit_price", True, "Cost per component unit (or give material_cost)", BOM_FIELDS),
            _col("material_cost", False, "Extended cost; stored as qty x unit_price when unit_price is given (a "
                                         "different value is reported), else unit_price = material_cost / qty",
                 BOM_FIELDS),
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
            _col("discount_pct", False, "Discount off base_price instead of a fixed price ('40%'; plain numbers "
                                        "are percents when the column has any number >= 1, else fractions)",
                 PRICE_IMPORT_FIELDS),
            _col("unit_type", False, "Product type: one price for every product of the type", PRICE_IMPORT_FIELDS),
            _col("start_period", False, "First month (YYYY-MM); blank = always", PRICE_IMPORT_FIELDS),
            _col("end_period", False, "Last month (YYYY-MM); blank = open", PRICE_IMPORT_FIELDS),
            _col("forecast_id", False, "Scenario; blank = company-wide (or set forecast_id on the request)",
                 PRICE_IMPORT_FIELDS),
            _col("notes", False, "Notes", PRICE_IMPORT_FIELDS),
        ],
        "rows": [
            ["RFL-308", "Dealer", "", "1199.00", "", "", "2027-01", "2027-12", "", "2027 dealer price"],
            ["RFL-308", "Distributor", "", "1049.00", "", "", "2027-01", "2027-12", "", "2027 distributor price"],
            ["", "", "CUST-003", "", "20%", "", "2027-01", "2027-12", "", "Sheriff contract: 20% off list"],
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
            _col("rate", False, "Rate: '2%' (safest), or plain numbers: percents when the column has any number "
                                ">= 1 (2, 0.5 = 0.5%), else fractions (0.02)", DEDUCTION_IMPORT_FIELDS),
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
