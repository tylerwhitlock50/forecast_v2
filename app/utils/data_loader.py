"""
CSV table loader (``POST /database/load_table``) and the value helpers every
master-data write path shares (generic CRUD, bulk imports, the loader).

``load_csv_to_table`` never drops or recreates a table: the schema, primary
keys and foreign keys always survive. Modes:

* ``append``  - insert every row; any bad row (non-numeric value, missing
  required column, duplicate key, unknown reference) rejects the whole file
  with one error per row and nothing is written.
* ``upsert``  - insert new rows and update existing ones (matched on the
  primary key or a unique key such as router_id + sequence); only the cells
  the file fills in are changed.
* ``replace`` - delete every row of the table and insert the file, in one
  transaction. Foreign keys are checked after the reload, so re-loading the
  same machine ids is fine, but a file that would orphan rows elsewhere
  (routing operations on a machine that is no longer in the file, sales of a
  product that is gone) is refused and nothing changes.

Cells are read as text, so ids keep their leading zeros, and converted per
column type: numeric columns accept ``$1,050.00``, ``(12)``, ``5%`` and
reject anything else with the row and column. Column headers are matched to
the table's columns ignoring case and punctuation, plus the import aliases
of ``api.import_routes`` ("Parent Item", "Qty Per", "Unit Cost" ...). BOM
lines get ``material_cost = qty x unit_price``, a normalized version
('1' -> '1.0'), line numbers when the file has none and a ``bom_definitions``
header; sales periods must be months (``YYYY-MM``).
"""
import io
import re
import sqlite3
import uuid
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import pandas as pd

import db.database as dbmod
from api.import_routes import (
    BOM_FIELDS,
    RECORD_TABLES,
    ROUTING_FIELDS,
    SALES_FIELDS,
    FieldMap,
    header_key,
    normalize_version,
)
from utils.period_normalizer import normalize_month, normalize_period, period_kind

LOAD_MODES = ("append", "upsert", "replace")
# Internal tables the loader never writes.
_NOT_LOADABLE = {"execution_log", "forecast_results", "sqlite_sequence"}
_FIELD_MAPS: Dict[str, FieldMap] = {
    "bom": BOM_FIELDS,
    "router_operations": ROUTING_FIELDS,
    "sales": SALES_FIELDS,
    **{table: spec["fields"] for table, spec in RECORD_TABLES.items()},
}
# How a referencing row is named in conflict messages.
_ROW_LABELS = {
    "router_operations": "router_id || ' seq ' || sequence",
    "routers": "router_id || ' seq ' || sequence",
    "bom": "bom_id || ' v' || version || ' line ' || bom_line",
    "sales": "COALESCE(forecast_id, '-') || ' ' || customer_id || ' ' || unit_id || ' ' || period",
}
_MAX_LISTED = 20


class ColumnValueError(ValueError):
    """A value cannot be stored in a column; the message names the column."""

    def __init__(self, column: str, message: str):
        super().__init__(message)
        self.column = column


# ---------------------------------------------------------------------------
# Value helpers (shared with api.crud_routes and the bulk imports)
# ---------------------------------------------------------------------------

def is_blank(value: Any) -> bool:
    """None, NaN and whitespace-only strings are blank."""
    if value is None:
        return True
    if isinstance(value, float) and value != value:
        return True
    return isinstance(value, str) and not value.strip()


def parse_number(value: Any, column: str = "value") -> Optional[float]:
    """
    '$1,050.00' -> 1050.0, '(12)' -> -12.0, '5%' -> 5.0, 3 -> 3.0; blank -> None.

    Raises ColumnValueError naming the column for anything else (text, booleans).
    """
    if is_blank(value):
        return None
    if isinstance(value, bool):
        raise ColumnValueError(column, f"{column} must be a number, got {value!r}")
    if isinstance(value, (int, float)):
        return float(value)
    text = re.sub(r"[\s$,%]", "", str(value))
    negative = text.startswith("(") and text.endswith(")")
    if negative:
        text = text[1:-1]
    try:
        number = float(text)
    except ValueError:
        raise ColumnValueError(column, f"{column} must be a number, got '{value}'")
    if number != number or number in (float("inf"), float("-inf")):
        raise ColumnValueError(column, f"{column} must be a number, got '{value}'")
    return -number if negative else number


def is_numeric_type(declared_type: Optional[str]) -> bool:
    """True for columns with INTEGER or REAL affinity (not NUMERIC / BOOLEAN / TIMESTAMP)."""
    decl = (declared_type or "").upper()
    return any(token in decl for token in ("INT", "REAL", "FLOA", "DOUB"))


def table_info(cursor, table: str) -> List[Tuple]:
    """PRAGMA table_info rows: (cid, name, type, notnull, default, pk)."""
    cursor.execute(f"PRAGMA table_info({table})")
    return cursor.fetchall()


def table_exists(cursor, table: str) -> bool:
    """True when ``table`` is an existing table (guards names interpolated into SQL)."""
    cursor.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,))
    return cursor.fetchone() is not None


def coerce_numeric(values: Dict[str, Any], columns: Sequence[Tuple]) -> Dict[str, Any]:
    """
    Convert the values of INTEGER / REAL columns: numeric text is parsed,
    blanks become None, whole numbers in INTEGER columns become int.
    Other columns are returned unchanged. Raises ColumnValueError.
    """
    types = {col[1]: col[2] for col in columns}
    out: Dict[str, Any] = {}
    for key, value in values.items():
        declared = types.get(key)
        if isinstance(value, bool) and "INT" in (declared or "").upper():
            out[key] = int(value)  # flags such as is_active / is_base
        elif declared is not None and is_numeric_type(declared):
            number = parse_number(value, key)
            if number is not None and "INT" in declared.upper() and float(number).is_integer():
                number = int(number)
            out[key] = number
        else:
            out[key] = value
    return out


def derive_bom_costs(values: Dict[str, Any]) -> Dict[str, Any]:
    """
    Keep a BOM line's material_cost = qty x unit_price.

    ``values`` is the whole line (current row merged with the changes). When
    only the extended cost is known (unit_price blank or 0, material_cost and
    qty set) the unit price is derived from it instead. Returns a copy.
    """
    line = dict(values)
    qty, price, cost = line.get("qty"), line.get("unit_price"), line.get("material_cost")
    if not price and cost and qty:
        line["unit_price"] = round(cost / qty, 6)
    elif qty is not None and price is not None:
        line["material_cost"] = round(qty * price, 4)
    return line


def version_sort_key(version: Any) -> Tuple:
    """Sort key so '10.0' > '9.0' > '2.0' > '1.1' > '1.0' (text parts sort after numbers)."""
    parts = re.split(r"[.\-_\s]+", str(version or "").strip().lstrip("vV"))
    return tuple((0, int(p), "") if p.isdigit() else (1, 0, p.lower()) for p in parts if p)


def sync_bom_header(cursor, bom_id: str, version: Optional[str], name: Optional[str] = None) -> str:
    """
    Make sure ``bom_definitions`` has a header for bom_id that shows its newest
    version (the BOM screen lists headers with the lines of the header's
    version; the lines of every version stay in the bom table and in
    /data/bom). Returns 'created', 'updated' or 'unchanged'.
    """
    version = version or "1.0"
    cursor.execute("SELECT version FROM bom_definitions WHERE bom_id = ?", (bom_id,))
    row = cursor.fetchone()
    if row is None:
        cursor.execute(
            "INSERT INTO bom_definitions (bom_id, bom_name, bom_description, version) VALUES (?, ?, ?, ?)",
            (bom_id, name or bom_id, f"Bill of Materials for {bom_id}", version),
        )
        return "created"
    if version_sort_key(version) > version_sort_key(row[0]):
        cursor.execute(
            "UPDATE bom_definitions SET version = ?, updated_at = CURRENT_TIMESTAMP WHERE bom_id = ?",
            (version, bom_id),
        )
        return "updated"
    return "unchanged"


def next_bom_line(cursor, bom_id: str, version: str) -> int:
    """Next free line number of a BOM version."""
    cursor.execute("SELECT COALESCE(MAX(bom_line), 0) FROM bom WHERE bom_id = ? AND version = ?", (bom_id, version))
    return int(cursor.fetchone()[0] or 0) + 1


def _primary_key(cursor, table: str) -> str:
    pks = [col[1] for col in sorted(table_info(cursor, table), key=lambda c: c[5]) if col[5]]
    return pks[0] if pks else "rowid"


def foreign_keys(cursor, table: str) -> List[Tuple[int, str, str, str]]:
    """(fk id, column, parent_table, parent_column) for every foreign key of table."""
    cursor.execute(f"PRAGMA foreign_key_list({table})")
    rows = cursor.fetchall()
    return [(fk_id, column, parent, parent_column or _primary_key(cursor, parent))
            for fk_id, _seq, parent, column, parent_column, *_rest in rows]


def missing_references(cursor, table: str, values: Dict[str, Any], include_self: bool = True) -> List[str]:
    """
    The foreign-key values in ``values`` that do not exist, as text such as
    "customer_id 'C-TYPO' not found in customers".
    """
    problems = []
    for _fk_id, column, parent, parent_column in foreign_keys(cursor, table):
        value = values.get(column)
        if value is None or (parent == table and not include_self):
            continue
        cursor.execute(f"SELECT 1 FROM {parent} WHERE {parent_column} = ? LIMIT 1", (value,))
        if cursor.fetchone() is None:
            problems.append(f"{column} '{value}' not found in {parent}")
    return problems


def referencing_rows(cursor, table: str, value: Any, column: Optional[str] = None,
                     limit: int = _MAX_LISTED) -> List[Dict[str, Any]]:
    """
    Rows of other tables whose foreign keys point at ``table.column = value``:
    ``[{table, column, count, rows: [label, ...]}]`` with labels such as
    'RTG-BOLT seq 50' for routing operations.
    """
    column = column or _primary_key(cursor, table)
    cursor.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    found = []
    for (child,) in cursor.fetchall():
        for _fk_id, child_column, parent, parent_column in foreign_keys(cursor, child):
            if parent != table or parent_column != column:
                continue
            cursor.execute(f"SELECT COUNT(*) FROM {child} WHERE {child_column} = ?", (value,))
            count = cursor.fetchone()[0]
            if not count:
                continue
            label = _ROW_LABELS.get(child) or _primary_key(cursor, child)
            cursor.execute(f"SELECT {label} FROM {child} WHERE {child_column} = ? ORDER BY 1 LIMIT ?",
                           (value, limit))
            found.append({"table": child, "column": child_column, "count": count,
                          "rows": [str(r[0]) for r in cursor.fetchall()]})
    return found


def describe_references(refs: Iterable[Dict[str, Any]]) -> str:
    """'router_operations (2): RTG-BOLT seq 50, RTG-CUSTOM seq 10; sales (12): ...'."""
    parts = []
    for ref in refs:
        more = ref["count"] - len(ref["rows"])
        parts.append(f"{ref['table']} ({ref['count']}): {', '.join(ref['rows'])}"
                     + (f" and {more} more" if more > 0 else ""))
    return "; ".join(parts)


def summarize_errors(errors: List[Dict[str, Any]], limit: int = _MAX_LISTED) -> str:
    """'row 2: ...; row 5: ...' (the first ``limit`` errors, then 'and N more')."""
    text = "; ".join(f"row {e['row']}: {e['error']}" for e in errors[:limit])
    if len(errors) > limit:
        text += f"; and {len(errors) - limit} more"
    return text


def sales_period_error(raw: Any) -> Optional[str]:
    """None when ``raw`` is a month; otherwise the message to show (sales are monthly)."""
    if is_blank(raw):
        return "period is required (YYYY-MM)"
    kind = period_kind(normalize_period(raw))
    if kind in ("quarter", "week"):
        return f"period '{raw}' is a {kind}; sales periods must be months (YYYY-MM)"
    if normalize_month(raw) is None:
        return f"period '{raw}' is not a month; use YYYY-MM (e.g. 2027-01)"
    return None


# ---------------------------------------------------------------------------
# CSV loader
# ---------------------------------------------------------------------------

def _error(code: int, message: str, errors: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    return {"status": "error", "code": code, "error": message, "errors": errors or []}


def loadable_tables(cursor) -> List[str]:
    """Every table /database/load_table may write (internal tables excluded)."""
    cursor.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    return [name for (name,) in cursor.fetchall()
            if name not in _NOT_LOADABLE and not name.startswith("sqlite_") and not name.endswith("__staging")]


def _map_headers(table: str, headers: List[str], columns: List[str]) -> Tuple[Dict[str, str], List[str]]:
    """CSV header -> table column (exact, then case/punctuation-insensitive, then import aliases)."""
    by_key = {header_key(c): c for c in columns}
    aliases = _FIELD_MAPS.get(table)
    mapping: Dict[str, str] = {}
    ignored: List[str] = []
    taken = set()
    # Real column names first so an alias never steals a column the file names exactly.
    for header in headers:
        column = header if header in columns else by_key.get(header_key(header))
        if column and column not in taken:
            mapping[header] = column
            taken.add(column)
    for header in headers:
        if header in mapping:
            continue
        canonical = aliases.canonical(header) if aliases else None
        if canonical == "bom_name" and table == "bom" and "bom_name" not in taken:
            mapping[header] = "bom_name"  # names the bom_definitions header; not stored on lines
            taken.add("bom_name")
        elif canonical in columns and canonical not in taken:
            mapping[header] = canonical
            taken.add(canonical)
        else:
            ignored.append(header)
    return mapping, ignored


def _conflict_columns(cursor, table: str, columns: Sequence[Tuple], supplied: Iterable[str]) -> Optional[List[str]]:
    """The primary key (or a unique key) the file supplies; upsert matches rows on it."""
    supplied = set(supplied)
    pk = [c[1] for c in sorted(columns, key=lambda c: c[5]) if c[5]]
    if pk and set(pk) <= supplied:
        return pk
    cursor.execute(f"PRAGMA index_list({table})")
    for _seq, name, unique, *_rest in cursor.fetchall():
        if not unique:
            continue
        cursor.execute(f"PRAGMA index_info({name})")
        cols = [r[2] for r in cursor.fetchall()]
        if cols and set(cols) <= supplied:
            return cols
    return None


def _required_columns(columns: Sequence[Tuple], table: str) -> List[str]:
    """Columns a new row must fill: NOT NULL without a default, and text primary keys."""
    pk_count = sum(1 for c in columns if c[5])
    required = []
    for _cid, name, declared, notnull, default, pk in columns:
        if pk and pk_count == 1 and "INT" in (declared or "").upper():
            continue  # INTEGER PRIMARY KEY is generated
        if (notnull and default is None) or pk:
            required.append(name)
    if table == "bom":
        required = [c for c in required if c != "bom_line"]  # numbered automatically
    return required


def _prepare_row(table: str, raw: Dict[str, Any], columns: Sequence[Tuple]) -> Dict[str, Any]:
    """Text cells -> typed values for one row; raises ColumnValueError."""
    values = {k: (None if is_blank(v) else (v.strip() if isinstance(v, str) else v)) for k, v in raw.items()}
    values = coerce_numeric(values, columns)
    if table == "bom":
        values["version"] = normalize_version(values.get("version"))
    elif table == "units":
        for column in ("bom_version", "router_version"):
            if values.get(column) is not None:
                values[column] = normalize_version(values[column])
    elif table == "sales":
        if "period" in values:
            problem = sales_period_error(values["period"])
            if problem:
                raise ColumnValueError("period", problem)
            values["period"] = normalize_month(values["period"])
        if not values.get("sale_id"):
            values["sale_id"] = str(uuid.uuid4())
        if values.get("total_revenue") is None and values.get("quantity") is not None \
                and values.get("unit_price") is not None:
            values["total_revenue"] = round(values["quantity"] * values["unit_price"], 4)
    return values


def _fk_violations(cursor, table: str) -> set:
    """Foreign-key violations in which ``table`` is the child or the parent."""
    cursor.execute("PRAGMA foreign_key_check")
    return {tuple(r) for r in cursor.fetchall() if r[0] == table or r[2] == table}


def _describe_violations(cursor, table: str, violations: Iterable[Tuple]) -> str:
    grouped: Dict[Tuple[str, str], List[str]] = {}
    for child, rowid, parent, fk_id in sorted(violations, key=repr):
        column = next((c for i, c, _p, _pc in foreign_keys(cursor, child) if i == fk_id), None)
        label = _ROW_LABELS.get(child) or _primary_key(cursor, child)
        cursor.execute(f"SELECT {label}, {column} FROM {child} WHERE rowid = ?", (rowid,))
        found = cursor.fetchone()
        if found:
            grouped.setdefault((child, parent), []).append(f"{found[0]} ({column} {found[1]})")
    parts = []
    for (child, parent), rows in grouped.items():
        shown = ", ".join(rows[:_MAX_LISTED]) + (f" and {len(rows) - _MAX_LISTED} more"
                                                  if len(rows) > _MAX_LISTED else "")
        if child == table:
            parts.append(f"{child} rows reference {parent} rows that do not exist: {shown}")
        else:
            parts.append(f"{child} rows still reference {parent} rows that are not in the file: {shown}")
    return "; ".join(parts)


def _number_bom_lines(cursor, rows: List[Tuple[int, Dict[str, Any]]], mode: str) -> None:
    """Give BOM lines without a bom_line the next number of their BOM + version, in file order."""
    next_line: Dict[Tuple[str, str], int] = {}
    for _, values in rows:
        key = (values.get("bom_id"), values.get("version"))
        if values.get("bom_line") is not None:
            next_line[key] = max(next_line.get(key, 1), int(values["bom_line"]) + 1)
    for _, values in rows:
        if values.get("bom_line") is not None:
            continue
        key = (values.get("bom_id"), values.get("version"))
        if key not in next_line:
            next_line[key] = 1 if mode == "replace" else next_bom_line(cursor, *key)
        values["bom_line"] = next_line[key]
        next_line[key] += 1


def _upsert_row(cursor, table: str, values: Dict[str, Any], conflict: List[str]) -> bool:
    """Insert or update one row; blank cells never erase stored values. True when the row existed."""
    where = " AND ".join(f"{c} = ?" for c in conflict)
    key = [values[c] for c in conflict]
    cursor.execute(f"SELECT * FROM {table} WHERE {where}", key)
    current = cursor.fetchone()
    present = {k: v for k, v in values.items() if v is not None}
    if current is not None:
        if table == "bom":  # keep material_cost = qty x unit_price over the merged line
            merged = {**dict(zip([d[0] for d in cursor.description], current)), **present}
            present.update({k: v for k, v in derive_bom_costs(merged).items() if k in ("unit_price", "material_cost")
                            and v is not None})
        changes = {k: v for k, v in present.items() if k not in conflict}
        if changes:
            cursor.execute(f"UPDATE {table} SET {', '.join(f'{k} = ?' for k in changes)} WHERE {where}",
                           [*changes.values(), *key])
        return True
    cols = list(present)
    cursor.execute(f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})",
                   [present[c] for c in cols])
    return False


def _integrity_message(table: str, values: Dict[str, Any], exc: sqlite3.IntegrityError, mode: str) -> str:
    text = str(exc)
    if text.startswith("UNIQUE"):
        cols = [part.split(".", 1)[-1].strip() for part in text.split(":", 1)[-1].split(",")]
        key = ", ".join(f"{c} '{values.get(c)}'" for c in cols if c in values)
        hint = " (use mode=upsert to update existing rows)" if mode != "replace" else " (the file repeats it)"
        return f"{table} row with {key} already exists{hint}"
    if text.startswith("NOT NULL"):
        return f"{text.split('.', 1)[-1]} is required"
    return text


def load_csv_to_table(table_name: str, csv_bytes: bytes, if_exists: str = "append") -> Dict[str, Any]:
    """
    Load a CSV file into an existing table (modes in the module docstring).

    Returns ``{status: 'success', table, mode, rows_loaded, inserted, updated,
    deleted, ignored_columns, column_map, warnings}`` or ``{status: 'error',
    code, error, errors: [{row, error}]}`` where code is 400 (unknown table,
    mode or columns), 409 (the load would orphan rows of another table) or
    422 (row errors). Nothing is written when there is an error.
    """
    mode = (if_exists or "").strip().lower()
    if mode not in LOAD_MODES:
        return _error(400, f"mode must be one of {', '.join(LOAD_MODES)}, got '{if_exists}'")

    conn = dbmod.db_manager.get_connection()
    try:
        cursor = conn.cursor()
        tables = loadable_tables(cursor)
        if table_name not in tables:
            return _error(400, f"Unknown table '{table_name}'. Tables you can load: {', '.join(tables)}")
        columns = table_info(cursor, table_name)
        column_names = [c[1] for c in columns]

        try:
            frame = pd.read_csv(io.BytesIO(csv_bytes), dtype=str, keep_default_na=False, encoding="utf-8-sig")
        except pd.errors.EmptyDataError:
            return _error(422, "The file is empty")
        except Exception as exc:  # malformed CSV
            return _error(422, f"Could not read the CSV file: {exc}")
        frame.columns = [str(c).strip() for c in frame.columns]
        mapping, ignored = _map_headers(table_name, list(frame.columns), column_names)
        if not any(column in column_names for column in mapping.values()):
            return _error(400, f"None of the file's columns ({', '.join(frame.columns)}) match table "
                               f"{table_name} ({', '.join(column_names)})")
        supplied = set(mapping.values()) | ({"version"} if table_name == "bom" else set())  # version defaults to 1.0
        conflict = _conflict_columns(cursor, table_name, columns, supplied) if mode == "upsert" else None
        if mode == "upsert" and not conflict:
            return _error(400, f"upsert needs the key columns of {table_name} in the file "
                               f"({', '.join(c[1] for c in columns if c[5])})")

        warnings: List[str] = []
        if ignored:
            warnings.append(f"Ignored columns (not in {table_name}): {', '.join(ignored)}")
        required = conflict if mode == "upsert" else _required_columns(columns, table_name)
        errors: List[Dict[str, Any]] = []
        rows: List[Tuple[int, Dict[str, Any]]] = []
        for index, record in enumerate(frame.to_dict(orient="records"), start=1):
            raw = {mapping[h]: v for h, v in record.items() if h in mapping}
            if all(is_blank(v) for v in raw.values()):
                continue
            try:
                values = _prepare_row(table_name, raw, columns)
            except ColumnValueError as exc:
                errors.append({"row": index, "error": str(exc)})
                continue
            missing = [c for c in required if values.get(c) is None]
            problems = [f"{', '.join(missing)} is required"] if missing else []
            problems += missing_references(cursor, table_name, values, include_self=False)
            if problems:
                errors.append({"row": index, "error": "; ".join(problems)})
                continue
            rows.append((index, values))
        if not rows:
            if errors:
                return _error(422, f"{len(errors)} row(s) rejected, nothing loaded: {summarize_errors(errors)}",
                              errors)
            return _error(422, "The file has no data rows")

        bom_names: Dict[str, str] = {}
        if table_name == "bom":
            _number_bom_lines(cursor, rows, mode)
            no_qty = []
            for index, values in rows:
                name = values.pop("bom_name", None)
                if name:
                    bom_names.setdefault(values["bom_id"], name)
                if values.get("qty") is None and mode != "upsert":  # as /import/boms: 1 per assembly
                    values["qty"] = 1.0
                    no_qty.append(index)
                values.update(derive_bom_costs(values))
            if no_qty:
                warnings.append(f"No qty on row(s) {', '.join(map(str, no_qty[:_MAX_LISTED]))}; loaded as 1 per assembly")

        before = _fk_violations(cursor, table_name)
        # Foreign keys are checked at the end (a replace may delete a parent row and insert it
        # again). The flag lasts for one transaction, so open it explicitly first.
        if not conn.in_transaction:
            cursor.execute("BEGIN")
        cursor.execute("PRAGMA defer_foreign_keys = ON")
        deleted = inserted = updated = 0
        if mode == "replace":
            cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
            deleted = cursor.fetchone()[0]
            cursor.execute(f"DELETE FROM {table_name}")
        for index, values in rows:
            values = {k: v for k, v in values.items() if k in column_names}
            try:
                if mode == "upsert":
                    if _upsert_row(cursor, table_name, values, conflict):
                        updated += 1
                    else:
                        inserted += 1
                else:
                    cols = list(values)
                    cursor.execute(f"INSERT INTO {table_name} ({', '.join(cols)}) VALUES "
                                   f"({', '.join('?' for _ in cols)})", [values[c] for c in cols])
                    inserted += 1
            except sqlite3.IntegrityError as exc:
                errors.append({"row": index, "error": _integrity_message(table_name, values, exc, mode)})
        if errors:  # validation and database errors of every row, so the file can be fixed in one go
            errors.sort(key=lambda e: e["row"])
            conn.rollback()
            return _error(422, f"{len(errors)} row(s) rejected, nothing loaded: {summarize_errors(errors)}", errors)

        new_violations = _fk_violations(cursor, table_name) - before
        if new_violations:
            message = _describe_violations(cursor, table_name, new_violations)
            conn.rollback()
            hint = (f" Include those {table_name} rows in the file, or use mode=upsert to keep the existing rows."
                    if mode == "replace" else "")
            return _error(409, f"Nothing loaded: {message}.{hint}")

        if table_name == "bom":
            newest: Dict[str, str] = {}
            for _, values in rows:
                bom_id, version = values["bom_id"], values["version"]
                if bom_id not in newest or version_sort_key(version) > version_sort_key(newest[bom_id]):
                    newest[bom_id] = version
            created = [bom_id for bom_id, version in sorted(newest.items())
                       if sync_bom_header(cursor, bom_id, version, bom_names.get(bom_id)) == "created"]
            if created:
                warnings.append(f"Created BOM headers for {', '.join(created)}")
        conn.commit()
        return {
            "status": "success", "table": table_name, "mode": mode, "rows_loaded": len(rows),
            "inserted": inserted, "updated": updated, "deleted": deleted,
            "ignored_columns": ignored, "column_map": mapping, "warnings": warnings,
        }
    except Exception as exc:
        conn.rollback()
        return _error(500, f"Loading {table_name} failed: {exc}")
    finally:
        dbmod.db_manager.close_connection(conn)
