import sqlite3
import os
import re
import uuid
from contextlib import contextmanager
from pathlib import Path
from datetime import datetime
import pandas as pd
from typing import Dict, Any, Iterator, List, Optional, Tuple

# Prefixes of the snapshot files the app writes on its own (before a load,
# a revert, a reset ...). /database/list reports them as "system_backup".
SYSTEM_BACKUP_PREFIXES = (
    'current_backup_', 'pre_revert_backup_', 'reset_backup_', 'start_clean_backup_',
    'clear_data_backup_', 'force_reload_backup_',
)
AUTOSAVE_PREFIX = 'autosave_'
SQLITE_HEADER = b'SQLite format 3\x00'
#: The copy services.governance.approve_scenario writes: approved_<id>_<YYYYMMDD_HHMMSS>[_n].db. Matched
#: exactly, so a user's own save called 'approved_budget' stays a named save.
APPROVAL_SNAPSHOT_RE = re.compile(r'^approved_[A-Za-z0-9_-]+_\d{8}_\d{6}(?:_\d+)?\.db$')


def is_approval_snapshot(filename: str) -> bool:
    """True for the snapshot an approval writes (``approved_<id>_<YYYYMMDD_HHMMSS>[_n].db``)."""
    return bool(APPROVAL_SNAPSHOT_RE.match(filename or ''))


def snapshot_kind(filename: str) -> str:
    """manual_save / autosave / system_backup, from a snapshot's file name."""
    if filename.startswith(AUTOSAVE_PREFIX):
        return 'autosave'
    if filename.startswith(SYSTEM_BACKUP_PREFIXES) or is_approval_snapshot(filename):
        return 'system_backup'
    return 'manual_save'


#: Finer snapshot kinds by file-name prefix, for /database/list ``kind``.
#: Other system backups (reset_backup_, clear_data_backup_, ...) are 'system_backup'.
SNAPSHOT_KIND_PREFIXES = (
    ('autosave_', 'autosave'),
    ('start_clean_backup_', 'start_clean_backup'),
    ('current_backup_', 'before_load_backup'),
    ('pre_revert_backup_', 'before_revert_backup'),
)
SNAPSHOT_KIND_LABELS = {
    'manual_save': 'Named save',
    'autosave': 'Autosave',
    'start_clean_backup': 'Automatic backup taken before Start clean',
    'before_load_backup': 'Automatic backup taken before a load',
    'before_revert_backup': 'Automatic backup taken before a revert',
    'approval_snapshot': 'Copy taken when a scenario was approved',
    'system_backup': 'Automatic backup taken before a reset or clear',
}
#: Tables that hold logs, caches or the change history, not model data: ignored when deciding whether a database is empty.
NON_DATA_TABLES = ('execution_log', 'forecast_results', 'audit_log')

#: One-row switch the approve / unlock paths (and clear_all_data) set INSIDE their own transaction and clear
#: before it commits, so no other connection ever sees it: while it holds a row the forecast triggers let the
#: governance columns change. Every other writer is refused (migrate_governance_guards).
GOVERNANCE_GUARD_TABLE = 'governance_guard'
#: Text the forecast triggers raise when status / locked / approved_* would change outside approve / unlock.
GOVERNANCE_TOKEN = 'SCENARIO_GOVERNED'


#: Tables a replayed execution_log statement may never write (replay_execution_logs): the governance records
#: (services.governance.GOVERNED_TABLES: change history, approvals, actuals and their batches / close), the
#: approve / unlock switch and the internal log / cache tables.
REPLAY_PROTECTED_TABLES = frozenset({
    'audit_log', 'scenario_approvals', 'actuals', 'actuals_batches', 'actuals_batch_changes', 'actuals_batch_entries',
    'actuals_periods',
    GOVERNANCE_GUARD_TABLE, 'execution_log', 'forecast_results',
})
#: forecast columns a replay may never change: they move only through approve / unlock
#: (services.governance.GOVERNED_FORECAST_COLUMNS).
REPLAY_PROTECTED_FORECAST_COLUMNS = ('locked', 'status', 'approved_by', 'approved_at', 'approval_note')


#: Schema actions of the SQLite authorizer: action code -> (verb, object). arg1 names the object
#: (ALTER TABLE: arg2), so a refusal reads "change the schema (drop trigger trg_lock_sales_update)".
_SCHEMA_ACTIONS = {
    getattr(sqlite3, f"SQLITE_{name}"): (verb, obj)
    for name, verb, obj in (
        ('CREATE_INDEX', 'create', 'index'), ('CREATE_TABLE', 'create', 'table'),
        ('CREATE_TEMP_INDEX', 'create', 'temporary index'), ('CREATE_TEMP_TABLE', 'create', 'temporary table'),
        ('CREATE_TEMP_TRIGGER', 'create', 'temporary trigger'), ('CREATE_TEMP_VIEW', 'create', 'temporary view'),
        ('CREATE_TRIGGER', 'create', 'trigger'), ('CREATE_VIEW', 'create', 'view'),
        ('CREATE_VTABLE', 'create', 'virtual table'),
        ('DROP_INDEX', 'drop', 'index'), ('DROP_TABLE', 'drop', 'table'),
        ('DROP_TEMP_INDEX', 'drop', 'temporary index'), ('DROP_TEMP_TABLE', 'drop', 'temporary table'),
        ('DROP_TEMP_TRIGGER', 'drop', 'temporary trigger'), ('DROP_TEMP_VIEW', 'drop', 'temporary view'),
        ('DROP_TRIGGER', 'drop', 'trigger'), ('DROP_VIEW', 'drop', 'view'), ('DROP_VTABLE', 'drop', 'virtual table'),
        ('ALTER_TABLE', 'alter', 'table'), ('REINDEX', 'reindex', 'index'), ('ANALYZE', 'analyze', 'table'),
    )
    if hasattr(sqlite3, f"SQLITE_{name}")
}


def _denied_action(action: int, arg1: Any, arg2: Any) -> str:
    """What a statement the replay authorizer refuses would do, as a verb phrase that reads after
    'would' ("drop trigger ...", "run PRAGMA foreign_keys ...")."""
    def named(*parts: Any) -> str:
        return " ".join(str(p) for p in parts if p not in (None, ""))

    if action in _SCHEMA_ACTIONS:
        verb, obj = _SCHEMA_ACTIONS[action]
        name = arg2 if action == sqlite3.SQLITE_ALTER_TABLE else arg1
        return f"change the schema ({named(verb, obj, name)})"
    if action == sqlite3.SQLITE_PRAGMA:
        return f"run {named('PRAGMA', arg1, '=' if arg2 not in (None, '') else '', arg2)}"
    if action == sqlite3.SQLITE_TRANSACTION:
        return f"run transaction control ({named(arg1) or 'BEGIN / COMMIT / ROLLBACK'})"
    if action == getattr(sqlite3, 'SQLITE_SAVEPOINT', None):
        operation = {'BEGIN': 'SAVEPOINT', 'ROLLBACK': 'ROLLBACK TO'}.get(str(arg1 or '').upper(), arg1)
        return f"run savepoint control ({named(operation, arg2)})"
    if action == sqlite3.SQLITE_ATTACH:
        # VACUUM attaches a temporary database with an empty file name.
        return f"attach another database ({arg1})" if arg1 else "run VACUUM (rebuilds the database file)"
    if action == sqlite3.SQLITE_DETACH:
        return f"detach database {arg1}"
    return "change the schema or run a PRAGMA, ATTACH / DETACH or transaction-control statement"


def replay_authorizer(denied: List[str]):
    """
    SQLite authorizer for replayed SQL: reads and plain row writes only. It
    denies (and appends why to ``denied``) any write to
    REPLAY_PROTECTED_TABLES or SQLite's own tables, any change to the forecast
    approval columns, and everything that is not a row read or write: schema
    changes (CREATE / DROP / ALTER of tables, triggers, views, indexes),
    PRAGMA, ATTACH / DETACH, transaction control and savepoints. Every reason
    is a verb phrase that reads after "would" (the replay's 409 says
    "log N: would <reason>").
    """
    reads = (sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION, sqlite3.SQLITE_RECURSIVE)
    writes = {sqlite3.SQLITE_INSERT: 'insert into', sqlite3.SQLITE_UPDATE: 'update',
              sqlite3.SQLITE_DELETE: 'delete from'}

    def authorize(action: int, arg1: Any, arg2: Any, _db: Any, _trigger: Any) -> int:
        if action in reads:
            return sqlite3.SQLITE_OK
        if action in writes:
            table = str(arg1 or '')
            if table.lower() in ('sqlite_master', 'sqlite_schema', 'sqlite_temp_master', 'sqlite_temp_schema'):
                # CREATE / DROP of a table, index, view or trigger writes SQLite's own catalogue first.
                denied.append(f"change the schema ({writes[action]} {table})")
                return sqlite3.SQLITE_DENY
            if table.lower().startswith('sqlite_'):
                denied.append(f"{writes[action]} {table} (SQLite's own bookkeeping)")
                return sqlite3.SQLITE_DENY
            if table in REPLAY_PROTECTED_TABLES:
                denied.append(f"{writes[action]} {table}")
                return sqlite3.SQLITE_DENY
            if action == sqlite3.SQLITE_UPDATE and table == 'forecast' and arg2 in REPLAY_PROTECTED_FORECAST_COLUMNS:
                denied.append(f"change forecast.{arg2} (approve / unlock only)")
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK
        denied.append(_denied_action(action, arg1, arg2))
        return sqlite3.SQLITE_DENY

    return authorize


def _approval_state(cursor) -> Dict[Any, Tuple]:
    """forecast_id -> its approval columns (REPLAY_PROTECTED_FORECAST_COLUMNS)."""
    cursor.execute(f"SELECT forecast_id, {', '.join(REPLAY_PROTECTED_FORECAST_COLUMNS)} FROM forecast")
    return {row[0]: tuple(row[1:]) for row in cursor.fetchall()}


def _approval_state_change(before: Dict[Any, Tuple], after: Dict[Any, Tuple]) -> Optional[str]:
    """
    Why a replayed statement's effect on the scenario approval columns is
    refused, or None: an existing scenario's columns changed (INSERT OR
    REPLACE re-creates a row without an UPDATE), or a new scenario was
    created other than as a plain unlocked draft with no approver.
    """
    for forecast_id, values in after.items():
        if forecast_id in before:
            if values != before[forecast_id]:
                return f"change the approval fields of scenario {forecast_id} (approve / unlock only)"
            continue
        locked, status, *approval = values
        if str(locked if locked is not None else 0).strip() not in ('0', '') \
                or str(status or 'draft').strip().lower() != 'draft' \
                or any(v not in (None, '') for v in approval):
            return f"create scenario {forecast_id} approved, locked or with an approver (approve / unlock only)"
    return None


def governance_guard_on(conn: sqlite3.Connection) -> None:
    """Let the forecast governance columns change in the CURRENT transaction (pair with governance_guard_off)."""
    conn.execute(f"INSERT INTO {GOVERNANCE_GUARD_TABLE} (active) VALUES (1)")


def governance_guard_off(conn: sqlite3.Connection) -> None:
    """Close the switch again, before the transaction commits."""
    conn.execute(f"DELETE FROM {GOVERNANCE_GUARD_TABLE}")


def snapshot_detail_kind(filename: str) -> str:
    """manual_save / autosave / start_clean_backup / before_load_backup / before_revert_backup / approval_snapshot / system_backup."""
    if is_approval_snapshot(filename):
        return 'approval_snapshot'
    for prefix, kind in SNAPSHOT_KIND_PREFIXES:
        if filename.startswith(prefix):
            return kind
    return 'system_backup' if snapshot_kind(filename) == 'system_backup' else 'manual_save'


def database_contents(conn: sqlite3.Connection, scenario_limit: int = 50) -> Dict[str, Any]:
    """
    What a database holds, for the snapshot list and the "is there anything
    to protect" check: scenario names (base first), customer / product /
    sales-row counts, the rows of every data table, and ``empty`` - no model
    data at all (scenario names alone, as right after Start clean, count as
    empty; logs are ignored). Missing tables (an old schema) count as 0.
    Read-only.
    """
    names = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")]
    counts: Dict[str, int] = {}
    for name in names:
        try:
            counts[name] = int(conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0] or 0)
        except sqlite3.Error:
            counts[name] = 0
    scenarios: List[str] = []
    if 'forecast' in counts:
        try:
            columns = {r[1] for r in conn.execute('PRAGMA table_info("forecast")')}
            order = "is_base DESC, forecast_id" if 'is_base' in columns else "forecast_id"
            select = "forecast_id, name" if 'name' in columns else "forecast_id, NULL"
            for fid, name in conn.execute(f"SELECT {select} FROM forecast ORDER BY {order}"):
                scenarios.append(str(name).strip() if name is not None and str(name).strip() else str(fid))
        except sqlite3.Error:
            pass
    data_rows = sum(n for name, n in counts.items() if name not in NON_DATA_TABLES)
    return {
        "scenarios": scenarios[:scenario_limit],
        "scenario_count": len(scenarios),
        "customers": counts.get('customers', 0),
        "products": counts.get('units', 0),
        "sales_rows": counts.get('sales', 0),
        "total_rows": data_rows,
        "empty": data_rows - counts.get('forecast', 0) == 0,
    }


def snapshot_contents(path: str) -> Dict[str, Any]:
    """
    ``database_contents`` of a snapshot file, opened read-only (never
    written; a WAL-mode file without a -wal sidecar is opened immutable so
    no -wal / -shm files are created next to it). Raises ValueError when the
    file is not a SQLite database, sqlite3.Error when it cannot be read.
    """
    if not is_sqlite_file(path):
        raise ValueError(f"{os.path.basename(path)} is not a SQLite database")
    with open(path, 'rb') as handle:
        header = handle.read(20)
    wal_mode = len(header) >= 20 and header[18] == 2
    uri = Path(os.path.abspath(path)).as_uri()
    uri += "?immutable=1" if wal_mode and not os.path.exists(path + '-wal') else "?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=5.0)
    try:
        return database_contents(conn)
    finally:
        conn.close()


def timestamp_slug() -> str:
    """Sortable local timestamp with milliseconds, for snapshot file names."""
    return datetime.now().strftime('%Y%m%d_%H%M%S_%f')[:-3]


def is_sqlite_file(path: str) -> bool:
    try:
        with open(path, 'rb') as handle:
            return handle.read(16) == SQLITE_HEADER
    except OSError:
        return False


def _remove_sidecars(path: str) -> None:
    """Delete a database file's -wal / -shm / -journal leftovers, if any."""
    for suffix in ('-wal', '-shm', '-journal'):
        try:
            os.remove(path + suffix)
        except FileNotFoundError:
            pass


def _remove_db_file(path: str) -> None:
    for candidate in (path, path + '-wal', path + '-shm', path + '-journal'):
        try:
            os.remove(candidate)
        except FileNotFoundError:
            pass
        except OSError as exc:  # pragma: no cover - best effort clean-up
            print(f"Warning: could not remove {candidate}: {exc}")


def _normalize_bom_version(value: Any) -> str:
    """BOM version as stored: 1 / '1' / 1.0 / 'v1' -> '1.0', '1.5' -> '1.5', blank -> '1.0'."""
    if value is None or (isinstance(value, float) and value != value) or not str(value).strip():
        return '1.0'
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f"{int(value)}.0" if float(value).is_integer() else str(value)
    text = str(value).strip()
    if re.match(r"^[vV]\d", text):
        text = text[1:]
    return f"{int(text)}.0" if text.isdigit() else text


def _bom_version_key(version: Any) -> Tuple:
    """Sort key so '10.0' > '9.0' > '2.0' > '1.0' (text parts sort after numbers)."""
    parts = re.split(r"[.\-_\s]+", str(version or "").strip().lstrip("vV"))
    return tuple((0, int(p), "") if p.isdigit() else (1, 0, p.lower()) for p in parts if p)


class _ReloadRefused(Exception):
    """A seed-CSV reload would orphan rows; the whole reload is rolled back."""


class DatabaseManager:
    def __init__(self, database_path: str = None, data_dir: str = None):
        """
        Resolve where the database and CSV data live.

        Precedence: explicit arguments, then the DATABASE_PATH / DATA_DIR
        environment variables, then auto-detection (/data inside the Docker
        container, ./data for local development). Explicit arguments always
        win so a test or script that names its own database can never be
        redirected to the production file by the environment.
        """
        env_db_path = os.getenv('DATABASE_PATH')
        env_data_dir = os.getenv('DATA_DIR')

        if database_path is not None:
            # Explicit path provided by the caller
            self.database_path = database_path
            self.data_dir = data_dir if data_dir is not None else os.path.dirname(database_path)
        elif env_db_path:
            # Full explicit path provided by the environment
            self.database_path = env_db_path
            self.data_dir = data_dir or env_data_dir or os.path.dirname(env_db_path)
        elif env_data_dir or data_dir:
            # Data directory provided; place DB inside it
            self.data_dir = data_dir or env_data_dir
            self.database_path = os.path.join(self.data_dir, 'forecast.db')
        elif os.path.isdir('/data'):  # Docker environment
            self.database_path = '/data/forecast.db'
            self.data_dir = '/data'
        else:  # Local development
            self.database_path = './data/forecast.db'
            self.data_dir = './data'
        
        # Ensure data directory exists
        os.makedirs(os.path.dirname(self.database_path), exist_ok=True)
        os.makedirs(self.data_dir, exist_ok=True)
    
    def get_connection(self):
        """Get a new database connection with timeout and proper settings"""
        import time
        max_retries = 3
        retry_delay = 1.0
        
        for attempt in range(max_retries):
            try:
                conn = sqlite3.connect(self.database_path, timeout=30.0)
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("PRAGMA synchronous=NORMAL")
                conn.execute("PRAGMA cache_size=10000")
                conn.execute("PRAGMA temp_store=MEMORY")
                # Enforce FK constraints for data integrity
                conn.execute("PRAGMA foreign_keys=ON")
                return conn
            except sqlite3.OperationalError as e:
                if "database is locked" in str(e) and attempt < max_retries - 1:
                    time.sleep(retry_delay)
                    retry_delay *= 2  # Exponential backoff
                    continue
                else:
                    raise
    
    def close_connection(self, conn):
        """Close a database connection"""
        if conn:
            conn.close()

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        """``with db_manager.connection() as conn:`` - always closed, even on error."""
        conn = self.get_connection()
        try:
            yield conn
        finally:
            conn.close()
    
    def close_all_connections(self):
        """Close all database connections - placeholder for SQLite"""
        # SQLite doesn't need explicit connection pooling management
        # This method is here for API compatibility
        # For SQLite, we can't force close all connections, but we can
        # ensure any cached connections are cleared
        pass
    
    def create_tables(self):
        """Create every table and index that does not exist yet (idempotent)."""
        conn = self.get_connection()
        try:
            self._create_tables(conn.cursor())
            conn.commit()
        finally:
            conn.close()

    def _create_tables(self, cursor):
        # Create customers table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS customers (
                customer_id TEXT PRIMARY KEY,
                customer_name TEXT NOT NULL,
                customer_type TEXT,
                region TEXT
            )
        ''')
        
        # Create units table (updated - added bom and router columns with versioning)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS units (
                unit_id TEXT PRIMARY KEY,
                unit_name TEXT NOT NULL,
                unit_description TEXT,
                base_price REAL,
                unit_type TEXT,
                bom_id TEXT,
                bom_version TEXT DEFAULT '1.0',
                router_id TEXT,
                router_version TEXT DEFAULT '1.0'
            )
        ''')
        
        # Create forecast table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS forecast (
                forecast_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                notes TEXT,
                is_base INTEGER DEFAULT 0,
                status TEXT DEFAULT 'draft',
                locked INTEGER DEFAULT 0,
                approved_by TEXT,
                approved_at TEXT,
                approval_note TEXT
            )
        ''')
        
        # Create sales table (updated - with forecast_id FK)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS sales (
                sale_id TEXT PRIMARY KEY,
                customer_id TEXT,
                unit_id TEXT,
                period TEXT,
                quantity INTEGER,
                unit_price REAL,
                total_revenue REAL,
                forecast_id TEXT,
                FOREIGN KEY (customer_id) REFERENCES customers (customer_id),
                FOREIGN KEY (unit_id) REFERENCES units (unit_id),
                FOREIGN KEY (forecast_id) REFERENCES forecast (forecast_id)
            )
        ''')
        
        # Create BOM definitions table for BOM metadata
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS bom_definitions (
                bom_id TEXT PRIMARY KEY,
                bom_name TEXT NOT NULL,
                bom_description TEXT,
                version TEXT DEFAULT '1.0',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Create BOM table (updated - new structure with versioning)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS bom (
                bom_id TEXT,
                version TEXT DEFAULT '1.0',
                bom_line INTEGER,
                material_description TEXT,
                qty REAL,
                unit TEXT,
                unit_price REAL,
                material_cost REAL,
                target_cost REAL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (bom_id, version, bom_line)
            )
        ''')
        
        # Create routers table (updated - new structure with versioning)
        # Create router_definitions table for router metadata
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS router_definitions (
                router_id TEXT PRIMARY KEY,
                router_name TEXT NOT NULL,
                router_description TEXT,
                version TEXT DEFAULT '1.0',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Create router_operations table for individual operations
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS router_operations (
                operation_id INTEGER PRIMARY KEY AUTOINCREMENT,
                router_id TEXT NOT NULL,
                sequence INTEGER NOT NULL,
                machine_id TEXT NOT NULL,
                machine_minutes REAL DEFAULT 0,
                labor_minutes REAL DEFAULT 0,
                labor_type_id TEXT,
                operation_description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (router_id) REFERENCES router_definitions (router_id),
                FOREIGN KEY (machine_id) REFERENCES machines (machine_id),
                FOREIGN KEY (labor_type_id) REFERENCES labor_rates (rate_id),
                UNIQUE(router_id, sequence)
            )
        ''')
        
        # Keep the old routers table for backward compatibility during migration
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS routers (
                router_id TEXT,
                version TEXT DEFAULT '1.0',
                unit_id TEXT,
                machine_id TEXT,
                machine_minutes REAL,
                labor_minutes REAL,
                labor_type_id TEXT,
                sequence INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (router_id, version, sequence),
                FOREIGN KEY (unit_id) REFERENCES units (unit_id),
                FOREIGN KEY (machine_id) REFERENCES machines (machine_id),
                FOREIGN KEY (labor_type_id) REFERENCES labor_rates (rate_id)
            )
        ''')
        
        # Create machines table (updated - renamed from work_centers, added capacity)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS machines (
                machine_id TEXT PRIMARY KEY,
                machine_name TEXT NOT NULL,
                machine_description TEXT,
                machine_rate REAL,
                labor_type TEXT,
                available_minutes_per_month INTEGER DEFAULT 0
            )
        ''')
        
        # Create labor_rates table (updated)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS labor_rates (
                rate_id TEXT PRIMARY KEY,
                rate_name TEXT NOT NULL,
                rate_description TEXT,
                rate_amount REAL,
                rate_type TEXT
            )
        ''')
        
        # Create enhanced payroll table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS payroll (
                employee_id TEXT PRIMARY KEY,
                employee_name TEXT NOT NULL,
                department TEXT,
                weekly_hours INTEGER,
                hourly_rate REAL,
                rate_type TEXT DEFAULT 'hourly',
                labor_type TEXT,
                start_date TEXT,
                end_date TEXT,
                next_review_date TEXT,
                expected_raise REAL DEFAULT 0.0,
                benefits_eligible BOOLEAN DEFAULT 1,
                allocations TEXT,  -- JSON string for business unit allocations
                labor_class TEXT,  -- direct / indirect / admin (NULL = not classified, treated as admin)
                forecast_id TEXT,
                FOREIGN KEY (forecast_id) REFERENCES forecast (forecast_id)
            )
        ''')
        
        # Create payroll configuration table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS payroll_config (
                config_id TEXT PRIMARY KEY,
                federal_tax_rate REAL DEFAULT 0.22,
                state_tax_rate REAL DEFAULT 0.06,
                social_security_rate REAL DEFAULT 0.062,
                medicare_rate REAL DEFAULT 0.0145,
                unemployment_rate REAL DEFAULT 0.006,
                benefits_rate REAL DEFAULT 0.25,
                workers_comp_rate REAL DEFAULT 0.015,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                pay_frequency TEXT DEFAULT 'biweekly',
                pay_anchor_date TEXT  -- a known biweekly payday (a Friday); NULL = the default calendar
            )
        ''')
        
        # Create forecast_results table to store computed forecasts
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS forecast_results (
                forecast_id INTEGER PRIMARY KEY AUTOINCREMENT,
                forecast_date TEXT NOT NULL,
                period TEXT NOT NULL,
                customer_id TEXT,
                customer_name TEXT,
                unit_id TEXT,
                unit_name TEXT,
                quantity INTEGER,
                unit_price REAL,
                total_revenue REAL,
                material_cost REAL,
                labor_cost REAL,
                machine_cost REAL,
                total_cost REAL,
                gross_margin REAL,
                margin_percentage REAL,
                FOREIGN KEY (customer_id) REFERENCES customers (customer_id),
                FOREIGN KEY (unit_id) REFERENCES units (unit_id)
            )
        ''')
        
        # Create execution_log table to track SQL statements for audit and rollback
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS execution_log (
                log_id INTEGER PRIMARY KEY AUTOINCREMENT,
                execution_date TEXT NOT NULL,
                sql_statement TEXT NOT NULL,
                description TEXT,
                user_id TEXT,
                session_id TEXT,
                execution_status TEXT DEFAULT 'success',
                error_message TEXT,
                rows_affected INTEGER,
                execution_time_ms INTEGER
            )
        ''')
        
        # Create expense_categories table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS expense_categories (
                category_id TEXT PRIMARY KEY,
                category_name TEXT NOT NULL,
                category_type TEXT NOT NULL CHECK (category_type IN ('factory_overhead', 'admin_expense', 'cogs')),
                parent_category_id TEXT,
                account_code TEXT,
                description TEXT,
                FOREIGN KEY (parent_category_id) REFERENCES expense_categories (category_id)
            )
        ''')
        
        # Create expenses table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS expenses (
                expense_id TEXT PRIMARY KEY,
                expense_name TEXT NOT NULL,
                category_id TEXT NOT NULL,
                amount REAL NOT NULL,
                frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'biannually', 'annually', 'one_time')),
                start_date TEXT NOT NULL,
                end_date TEXT,
                vendor TEXT,
                description TEXT,
                payment_method TEXT,
                approval_required BOOLEAN DEFAULT 0,
                approved_by TEXT,
                approval_date TEXT,
                expense_allocation TEXT DEFAULT 'immediate' CHECK (expense_allocation IN ('immediate', 'amortized')),
                amortization_months INTEGER,
                department TEXT,
                cost_center TEXT,
                is_active BOOLEAN DEFAULT 1,
                forecast_id TEXT,
                created_date TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_date TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (category_id) REFERENCES expense_categories (category_id),
                FOREIGN KEY (forecast_id) REFERENCES forecast (forecast_id)
            )
        ''')
        
        # Create expense_allocations table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS expense_allocations (
                allocation_id TEXT PRIMARY KEY,
                expense_id TEXT NOT NULL,
                period TEXT NOT NULL,
                allocated_amount REAL NOT NULL,
                allocation_type TEXT NOT NULL CHECK (allocation_type IN ('scheduled', 'amortized', 'one_time')),
                payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'scheduled', 'paid', 'overdue')),
                payment_date TEXT,
                actual_amount REAL,
                notes TEXT,
                FOREIGN KEY (expense_id) REFERENCES expenses (expense_id)
            )
        ''')
        
        # Create loans table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS loans (
                loan_id TEXT PRIMARY KEY,
                loan_name TEXT NOT NULL,
                lender TEXT NOT NULL,
                loan_type TEXT NOT NULL CHECK (loan_type IN ('term_loan', 'line_of_credit', 'sba_loan', 'equipment_loan', 'real_estate_loan')),
                principal_amount REAL NOT NULL,
                interest_rate REAL NOT NULL,
                loan_term_months INTEGER NOT NULL,
                start_date TEXT NOT NULL,
                payment_type TEXT NOT NULL CHECK (payment_type IN ('amortizing', 'interest_only')),
                payment_frequency TEXT DEFAULT 'monthly' CHECK (payment_frequency IN ('monthly', 'quarterly', 'annually')),
                balloon_payment REAL,
                balloon_date TEXT,
                description TEXT,
                collateral_description TEXT,
                guarantor TEXT,
                loan_officer TEXT,
                account_number TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_date TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_date TEXT DEFAULT CURRENT_TIMESTAMP,
                current_balance REAL NOT NULL,
                next_payment_date TEXT NOT NULL,
                monthly_payment_amount REAL NOT NULL
            )
        ''')
        
        # Create loan_payments table for amortization schedules
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS loan_payments (
                payment_id TEXT PRIMARY KEY,
                loan_id TEXT NOT NULL,
                payment_number INTEGER NOT NULL,
                payment_date TEXT NOT NULL,
                payment_amount REAL NOT NULL,
                principal_payment REAL NOT NULL,
                interest_payment REAL NOT NULL,
                remaining_balance REAL NOT NULL,
                payment_status TEXT DEFAULT 'scheduled' CHECK (payment_status IN ('scheduled', 'paid', 'overdue', 'skipped')),
                actual_payment_date TEXT,
                actual_payment_amount REAL,
                notes TEXT,
                FOREIGN KEY (loan_id) REFERENCES loans (loan_id),
                UNIQUE(loan_id, payment_number)
            )
        ''')

        # ---- Financial planning tables (reporting engine) ----

        # Opening balances and working-capital / tax assumptions, one row per
        # forecast scenario. A missing row falls back to engine defaults.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS financial_assumptions (
                forecast_id TEXT PRIMARY KEY,
                opening_period TEXT,
                opening_cash REAL DEFAULT 0,
                opening_accounts_receivable REAL DEFAULT 0,
                opening_inventory REAL DEFAULT 0,
                opening_fixed_assets REAL DEFAULT 0,
                opening_accumulated_depreciation REAL DEFAULT 0,
                opening_fixed_assets_remaining_life_months INTEGER DEFAULT 0,
                opening_accounts_payable REAL DEFAULT 0,
                opening_other_liabilities REAL DEFAULT 0,
                opening_equity REAL,
                dso_days REAL DEFAULT 30,
                dio_days REAL DEFAULT 60,
                dpo_days REAL DEFAULT 30,
                income_tax_rate REAL DEFAULT 0.21,
                minimum_cash_balance REAL DEFAULT 0,
                excise_payable_days REAL DEFAULT 30,
                notes TEXT,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (forecast_id) REFERENCES forecast (forecast_id)
            )
        ''')

        # Planned capital purchases, depreciated straight-line from the
        # purchase period over useful_life_months.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS capital_expenditures (
                capex_id TEXT PRIMARY KEY,
                forecast_id TEXT,
                asset_name TEXT NOT NULL,
                category TEXT,
                amount REAL NOT NULL,
                purchase_period TEXT NOT NULL,
                useful_life_months INTEGER NOT NULL DEFAULT 60,
                salvage_value REAL DEFAULT 0,
                depreciation_method TEXT DEFAULT 'straight_line' CHECK (depreciation_method IN ('straight_line', 'none')),
                description TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (forecast_id) REFERENCES forecast (forecast_id)
            )
        ''')

        # Actual results by period and statement line, for budget-vs-actual.
        # line_item values are the keys of
        # services.financial_statements.VARIANCE_LINE_ITEMS.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS actuals (
                actual_id TEXT PRIMARY KEY,
                period TEXT NOT NULL,
                line_item TEXT NOT NULL,
                amount REAL NOT NULL,
                reference_id TEXT DEFAULT '',
                source TEXT,
                notes TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                batch_id TEXT,
                UNIQUE(period, line_item, reference_id)
            )
        ''')
        # One row per actuals import / save: who, what file, row counts and
        # the control total the file was reconciled against.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS actuals_batches (
                batch_id TEXT PRIMARY KEY,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                source TEXT,
                filename TEXT,
                rows_in_file INTEGER DEFAULT 0,
                inserted INTEGER DEFAULT 0,
                updated INTEGER DEFAULT 0,
                unchanged INTEGER DEFAULT 0,
                rejected INTEGER DEFAULT 0,
                file_total REAL,
                control_total REAL,
                status TEXT,
                note TEXT,
                replaced INTEGER DEFAULT 0,
                replace_lines INTEGER DEFAULT 0,
                entries_logged INTEGER DEFAULT 0
            )
        ''')
        # What each batch asked for, entry by entry (insert / update /
        # unchanged with the amount, notes and source as sent; 'keep' for the
        # other references a replace_lines request named; 'delete' for a
        # deletion's filter), so undo can replay the batches still in place.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS actuals_batch_entries (
                batch_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                action TEXT NOT NULL,
                period TEXT,
                line_item TEXT,
                reference_id TEXT,
                amount REAL,
                notes TEXT,
                source TEXT,
                actual_id TEXT,
                PRIMARY KEY (batch_id, seq)
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_actuals_batch_entries_pair '
                       'ON actuals_batch_entries (period, line_item)')
        # What each import overwrote ('updated'), removed with replace_lines
        # ('removed'), found already stored ('confirmed') or deleted
        # ('deleted'), so undoing it restores the earlier amounts and puts the
        # removed rows back exactly instead of deleting the rows it changed.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS actuals_batch_changes (
                batch_id TEXT NOT NULL,
                actual_id TEXT NOT NULL,
                previous_amount REAL,
                previous_notes TEXT,
                previous_source TEXT,
                previous_batch_id TEXT,
                previous_updated_at TEXT,
                change_type TEXT DEFAULT 'updated',
                previous_period TEXT,
                previous_line_item TEXT,
                previous_reference_id TEXT,
                previous_created_at TEXT,
                PRIMARY KEY (batch_id, actual_id)
            )
        ''')
        # Month-end close: a closed period's actuals cannot be changed until
        # it is reopened (with a reason).
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS actuals_periods (
                period TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
                closed_at TEXT,
                closed_by TEXT,
                note TEXT,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        # Scenario approvals and unlocks (the baseline history).
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS scenario_approvals (
                approval_id TEXT PRIMARY KEY,
                forecast_id TEXT NOT NULL,
                action TEXT NOT NULL CHECK (action IN ('approve', 'unlock')),
                actor TEXT,
                note TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                snapshot_filename TEXT,
                workbook_filename TEXT,
                totals_json TEXT
            )
        ''')
        # Request-level change history: every write through the API (web UI,
        # MCP, scripts) with who / what / when.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS audit_log (
                log_id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                client TEXT,
                actor TEXT,
                method TEXT,
                path TEXT,
                query TEXT,
                status INTEGER,
                forecast_id TEXT,
                summary TEXT,
                body_excerpt TEXT,
                duration_ms INTEGER
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at)')
        # Always empty outside a transaction: see migrate_governance_guards.
        cursor.execute(f'CREATE TABLE IF NOT EXISTS {GOVERNANCE_GUARD_TABLE} (active INTEGER NOT NULL DEFAULT 1)')
        # Discounts and allowances off gross sales, embedded excise tax and
        # commissions (see services.pricing for matching and precedence).
        # forecast_id NULL = company-wide; NULL scope fields mean "any".
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS sales_deduction_rules (
                rule_id TEXT PRIMARY KEY,
                forecast_id TEXT,
                deduction_type TEXT NOT NULL CHECK (deduction_type IN
                    ('terms_allowance', 'chargebacks', 'other_allowance', 'excise_tax', 'commission')),
                name TEXT,
                method TEXT NOT NULL DEFAULT 'percent_of_gross' CHECK (method IN
                    ('percent_of_gross', 'percent_of_net', 'embedded_tax', 'per_unit')),
                rate REAL DEFAULT 0,
                amount_per_unit REAL DEFAULT 0,
                customer_id TEXT,
                customer_type TEXT,
                unit_id TEXT,
                unit_type TEXT,
                start_period TEXT,
                end_period TEXT,
                is_active INTEGER DEFAULT 1,
                notes TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (forecast_id) REFERENCES forecast (forecast_id)
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_deduction_rules_type ON sales_deduction_rules (deduction_type)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_deduction_rules_forecast ON sales_deduction_rules (forecast_id)')

        # Customer / customer-type price list: a fixed price or a discount off
        # the product's base_price. unit_id NULL = every product; unit_type
        # (product type) narrows it, e.g. Distributor 40% off Accessory.
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS price_list (
                price_id TEXT PRIMARY KEY,
                forecast_id TEXT,
                unit_id TEXT,
                customer_id TEXT,
                customer_type TEXT,
                unit_type TEXT,
                method TEXT NOT NULL DEFAULT 'fixed' CHECK (method IN ('fixed', 'discount_from_base')),
                unit_price REAL,
                discount_pct REAL,
                start_period TEXT,
                end_period TEXT,
                is_active INTEGER DEFAULT 1,
                notes TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (forecast_id) REFERENCES forecast (forecast_id)
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_price_list_unit ON price_list (unit_id)')

        cursor.execute('CREATE INDEX IF NOT EXISTS idx_actuals_period ON actuals (period)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_sales_forecast_period ON sales (forecast_id, period)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_expense_alloc_period ON expense_allocations (period)')

    def migrate_financial_assumptions_table(self):
        """Add excise_payable_days to financial_assumptions if missing (idempotent)."""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("PRAGMA table_info(financial_assumptions)")
            columns = [col[1] for col in cursor.fetchall()]
            if 'excise_payable_days' not in columns:
                try:
                    cursor.execute("ALTER TABLE financial_assumptions ADD COLUMN excise_payable_days REAL DEFAULT 30")
                except sqlite3.OperationalError as alter_err:
                    if 'duplicate column name' not in str(alter_err).lower():
                        raise
            conn.commit()
        except Exception as e:
            print(f"Error migrating financial_assumptions table: {e}")
            conn.rollback()
        finally:
            self.close_connection(conn)

    #: Tables whose rows belong to a scenario through forecast_id. Rows of an
    #: approved (locked) scenario cannot be inserted, changed or deleted; the
    #: triggers raise SCENARIO_LOCKED, which the API turns into HTTP 409.
    LOCKED_SCENARIO_TABLES = ("sales", "expenses", "payroll", "capital_expenditures", "financial_assumptions",
                              "price_list", "sales_deduction_rules")

    def migrate_governance_and_controls(self):
        """
        Columns and triggers for scenario approval / locking, actuals batches
        and payroll labor class (idempotent). Tables are created by
        create_tables; this adds the columns older databases lack and
        (re)creates the scenario-lock triggers.
        """
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            additions = {
                "forecast": (("status", "TEXT DEFAULT 'draft'"), ("locked", "INTEGER DEFAULT 0"),
                             ("approved_by", "TEXT"), ("approved_at", "TEXT"), ("approval_note", "TEXT")),
                "actuals": (("batch_id", "TEXT"),),
                "payroll": (("labor_class", "TEXT"),),
            }
            for table, cols in additions.items():
                cursor.execute(f"PRAGMA table_info({table})")
                existing = {col[1] for col in cursor.fetchall()}
                for name, ddl in cols:
                    if name not in existing:
                        try:
                            cursor.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
                        except sqlite3.OperationalError as alter_err:
                            if 'duplicate column name' not in str(alter_err).lower():
                                raise
            locked = "EXISTS (SELECT 1 FROM forecast f WHERE f.forecast_id = {ref}.forecast_id AND f.locked = 1)"
            for table in self.LOCKED_SCENARIO_TABLES:
                cursor.execute(f"""
                    CREATE TRIGGER IF NOT EXISTS trg_lock_{table}_insert BEFORE INSERT ON {table}
                    WHEN NEW.forecast_id IS NOT NULL AND {locked.format(ref='NEW')}
                    BEGIN SELECT RAISE(ABORT, 'SCENARIO_LOCKED'); END
                """)
                cursor.execute(f"""
                    CREATE TRIGGER IF NOT EXISTS trg_lock_{table}_update BEFORE UPDATE ON {table}
                    WHEN (OLD.forecast_id IS NOT NULL AND {locked.format(ref='OLD')})
                      OR (NEW.forecast_id IS NOT NULL AND {locked.format(ref='NEW')})
                    BEGIN SELECT RAISE(ABORT, 'SCENARIO_LOCKED'); END
                """)
                cursor.execute(f"""
                    CREATE TRIGGER IF NOT EXISTS trg_lock_{table}_delete BEFORE DELETE ON {table}
                    WHEN OLD.forecast_id IS NOT NULL AND {locked.format(ref='OLD')}
                    BEGIN SELECT RAISE(ABORT, 'SCENARIO_LOCKED'); END
                """)
            alloc_locked = ("EXISTS (SELECT 1 FROM expenses e JOIN forecast f ON f.forecast_id = e.forecast_id "
                            "WHERE e.expense_id = {ref}.expense_id AND f.locked = 1)")
            # An UPDATE checks both sides: moving an allocation INTO a locked expense changes it too.
            alloc_when = {
                "INSERT": alloc_locked.format(ref="NEW"),
                "UPDATE": f"{alloc_locked.format(ref='OLD')} OR {alloc_locked.format(ref='NEW')}",
                "DELETE": alloc_locked.format(ref="OLD"),
            }
            # The first version of the UPDATE trigger checked OLD only: replace it where it is still installed.
            cursor.execute("SELECT sql FROM sqlite_master WHERE type = 'trigger' "
                           "AND name = 'trg_lock_expense_allocations_update'")
            installed = cursor.fetchone()
            if installed and "NEW.expense_id" not in (installed[0] or ""):
                cursor.execute("DROP TRIGGER trg_lock_expense_allocations_update")
            for event, when in alloc_when.items():
                cursor.execute(f"""
                    CREATE TRIGGER IF NOT EXISTS trg_lock_expense_allocations_{event.lower()}
                    BEFORE {event} ON expense_allocations
                    WHEN {when}
                    BEGIN SELECT RAISE(ABORT, 'SCENARIO_LOCKED'); END
                """)
            cursor.execute("""
                CREATE TRIGGER IF NOT EXISTS trg_lock_forecast_delete BEFORE DELETE ON forecast
                WHEN OLD.locked = 1
                BEGIN SELECT RAISE(ABORT, 'SCENARIO_LOCKED'); END
            """)
            conn.commit()
        except Exception as e:
            print(f"Error migrating governance / controls schema: {e}")
            conn.rollback()
        finally:
            self.close_connection(conn)

    def migrate_actuals_undo_tracking(self):
        """
        Columns undo needs to put back rows an actuals import removed with
        replace_lines (the row's key and created_at in actuals_batch_changes),
        the per-batch count of replaced rows, whether a batch used
        replace_lines and whether its entries are logged in
        actuals_batch_entries (batches from before the log have 0 and are
        undone from their change records), and the key of change records
        written before the key columns existed (idempotent).
        """
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            additions = {
                "actuals_batch_changes": (("change_type", "TEXT DEFAULT 'updated'"), ("previous_period", "TEXT"),
                                          ("previous_line_item", "TEXT"), ("previous_reference_id", "TEXT"),
                                          ("previous_created_at", "TEXT")),
                "actuals_batches": (("replaced", "INTEGER DEFAULT 0"), ("replace_lines", "INTEGER DEFAULT 0"),
                                    ("entries_logged", "INTEGER DEFAULT 0")),
            }
            for table, cols in additions.items():
                cursor.execute(f"PRAGMA table_info({table})")
                existing = {col[1] for col in cursor.fetchall()}
                if not existing:
                    continue
                for name, ddl in cols:
                    if name not in existing:
                        try:
                            cursor.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
                        except sqlite3.OperationalError as alter_err:
                            if 'duplicate column name' not in str(alter_err).lower():
                                raise
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS actuals_batch_entries (
                    batch_id TEXT NOT NULL,
                    seq INTEGER NOT NULL,
                    action TEXT NOT NULL,
                    period TEXT,
                    line_item TEXT,
                    reference_id TEXT,
                    amount REAL,
                    notes TEXT,
                    source TEXT,
                    actual_id TEXT,
                    PRIMARY KEY (batch_id, seq)
                )
            ''')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_actuals_batch_entries_pair '
                           'ON actuals_batch_entries (period, line_item)')
            # Change records from before the key columns: take the key from the row they changed.
            cursor.execute("PRAGMA table_info(actuals_batch_changes)")
            if "previous_period" in {col[1] for col in cursor.fetchall()}:
                cursor.execute("""
                    UPDATE actuals_batch_changes SET
                        previous_period = (SELECT a.period FROM actuals a
                                           WHERE a.actual_id = actuals_batch_changes.actual_id),
                        previous_line_item = (SELECT a.line_item FROM actuals a
                                              WHERE a.actual_id = actuals_batch_changes.actual_id),
                        previous_reference_id = (SELECT COALESCE(a.reference_id, '') FROM actuals a
                                                 WHERE a.actual_id = actuals_batch_changes.actual_id)
                    WHERE previous_period IS NULL
                      AND actual_id IN (SELECT actual_id FROM actuals)""")
            conn.commit()
        except Exception as e:
            print(f"Error migrating actuals undo tracking: {e}")
            conn.rollback()
        finally:
            self.close_connection(conn)

    def migrate_governance_guards(self):
        """
        Triggers that keep a scenario's approval state in the hands of
        approve / unlock (idempotent; after migrate_governance_and_controls,
        which adds the columns):

        * ``status``, ``locked``, ``approved_by``, ``approved_at`` and
          ``approval_note`` change, and a scenario is created approved or
          locked, only while ``governance_guard`` holds a row: the approve /
          unlock paths of services.governance (and clear_all_data) set it
          inside their own transaction and clear it before committing.
          Anything else raises ``SCENARIO_GOVERNED``.
        * A locked scenario keeps its id, name, description and notes
          (``SCENARIO_LOCKED``); its base flag can still move.

        A guard row left by a crashed writer cannot survive: it is cleared
        here on every start.
        """
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(f"CREATE TABLE IF NOT EXISTS {GOVERNANCE_GUARD_TABLE} (active INTEGER NOT NULL DEFAULT 1)")
            cursor.execute(f"DELETE FROM {GOVERNANCE_GUARD_TABLE}")
            unguarded = f"NOT EXISTS (SELECT 1 FROM {GOVERNANCE_GUARD_TABLE})"
            message = (f"{GOVERNANCE_TOKEN}: the status, lock and approval fields of a scenario change only "
                       f"through POST /forecast/scenario/{{id}}/approve and /unlock")
            changed = " OR ".join(f"NEW.{c} IS NOT OLD.{c}"
                                  for c in ("locked", "status", "approved_by", "approved_at", "approval_note"))
            cursor.execute(f"""
                CREATE TRIGGER IF NOT EXISTS trg_guard_forecast_governance BEFORE UPDATE ON forecast
                WHEN {unguarded} AND ({changed})
                BEGIN SELECT RAISE(ABORT, '{message}'); END
            """)
            cursor.execute(f"""
                CREATE TRIGGER IF NOT EXISTS trg_guard_forecast_insert BEFORE INSERT ON forecast
                WHEN {unguarded} AND (COALESCE(NEW.locked, 0) <> 0 OR NEW.status = 'approved')
                BEGIN SELECT RAISE(ABORT, '{message}'); END
            """)
            identity = " OR ".join(f"NEW.{c} IS NOT OLD.{c}" for c in ("forecast_id", "name", "description", "notes"))
            cursor.execute(f"""
                CREATE TRIGGER IF NOT EXISTS trg_lock_forecast_update BEFORE UPDATE ON forecast
                WHEN OLD.locked = 1 AND {unguarded} AND ({identity})
                BEGIN SELECT RAISE(ABORT, 'SCENARIO_LOCKED'); END
            """)
            conn.commit()
        except Exception as e:
            print(f"Error migrating the scenario governance triggers: {e}")
            conn.rollback()
        finally:
            self.close_connection(conn)

    def migrate_price_list_table(self):
        """Add the unit_type (product type) scope to price_list if missing (idempotent)."""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("PRAGMA table_info(price_list)")
            columns = [col[1] for col in cursor.fetchall()]
            if columns and 'unit_type' not in columns:
                try:
                    cursor.execute("ALTER TABLE price_list ADD COLUMN unit_type TEXT")
                except sqlite3.OperationalError as alter_err:
                    if 'duplicate column name' not in str(alter_err).lower():
                        raise
            conn.commit()
        except Exception as e:
            print(f"Error migrating price_list table: {e}")
            conn.rollback()
        finally:
            self.close_connection(conn)

    def migrate_payroll_config_table(self):
        """Add pay_frequency and pay_anchor_date to payroll_config if missing (idempotent)."""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("PRAGMA table_info(payroll_config)")
            columns = [col[1] for col in cursor.fetchall()]
            # pay_anchor_date: a known biweekly payday. NULL reads as the fixed default calendar
            # (financial_statements.DEFAULT_PAY_ANCHOR_DATE), so older databases keep stable paydays.
            for column, ddl in (("pay_frequency", "TEXT DEFAULT 'biweekly'"), ("pay_anchor_date", "TEXT")):
                if column in columns:
                    continue
                try:
                    cursor.execute(f"ALTER TABLE payroll_config ADD COLUMN {column} {ddl}")
                except sqlite3.OperationalError as alter_err:
                    if 'duplicate column name' not in str(alter_err).lower():
                        raise
            conn.commit()
        except Exception as e:
            print(f"Error migrating payroll_config table: {e}")
            conn.rollback()
        finally:
            self.close_connection(conn)

    def migrate_payroll_table(self):
        """Migrate existing payroll table to new schema"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        try:
            # Check if new columns exist
            cursor.execute("PRAGMA table_info(payroll)")
            columns = [col[1] for col in cursor.fetchall()]
            
            # Add missing columns
            if 'department' not in columns:
                cursor.execute('ALTER TABLE payroll ADD COLUMN department TEXT')
            if 'rate_type' not in columns:
                cursor.execute('ALTER TABLE payroll ADD COLUMN rate_type TEXT DEFAULT "hourly"')
            if 'next_review_date' not in columns:
                cursor.execute('ALTER TABLE payroll ADD COLUMN next_review_date TEXT')
            if 'expected_raise' not in columns:
                cursor.execute('ALTER TABLE payroll ADD COLUMN expected_raise REAL DEFAULT 0.0')
            if 'benefits_eligible' not in columns:
                cursor.execute('ALTER TABLE payroll ADD COLUMN benefits_eligible BOOLEAN DEFAULT 1')
            if 'allocations' not in columns:
                cursor.execute('ALTER TABLE payroll ADD COLUMN allocations TEXT')
            if 'forecast_id' not in columns:
                cursor.execute('ALTER TABLE payroll ADD COLUMN forecast_id TEXT')
            
            # Update department field with labor_type if empty
            cursor.execute('''
                UPDATE payroll 
                SET department = labor_type 
                WHERE department IS NULL OR department = ""
            ''')
            
            # Set default allocations for existing employees
            cursor.execute('''
                UPDATE payroll 
                SET allocations = '{"Customer-Centric Brands": 100}' 
                WHERE allocations IS NULL OR allocations = ""
            ''')
            
            conn.commit()
            print("Payroll table migration completed successfully")
            
        except Exception as e:
            print(f"Error migrating payroll table: {e}")
            conn.rollback()
        finally:
            self.close_connection(conn)

    def migrate_expenses_table(self):
        """Add forecast_id column to expenses table if missing"""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("PRAGMA table_info(expenses)")
            columns = [col[1] for col in cursor.fetchall()]
            if 'forecast_id' not in columns:
                cursor.execute('ALTER TABLE expenses ADD COLUMN forecast_id TEXT')
            conn.commit()
            print("Expenses table migration completed successfully")
        except Exception as e:
            print(f"Error migrating expenses table: {e}")
            conn.rollback()
        finally:
            self.close_connection(conn)

    def migrate_forecast_table(self):
        """Add notes / is_base columns to the forecast table if missing (idempotent)"""
        conn = self.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("PRAGMA table_info(forecast)")
            columns = [col[1] for col in cursor.fetchall()]
            for column, ddl in (
                ('notes', 'ALTER TABLE forecast ADD COLUMN notes TEXT'),
                # Exactly one scenario may be flagged as the base; the
                # comparison screen shows deltas against it.
                ('is_base', 'ALTER TABLE forecast ADD COLUMN is_base INTEGER DEFAULT 0'),
            ):
                if column not in columns:
                    try:
                        cursor.execute(ddl)
                    except sqlite3.OperationalError as alter_err:
                        # Column may already exist under a concurrent startup; ignore
                        if 'duplicate column name' not in str(alter_err).lower():
                            raise
            conn.commit()
            print("Forecast table migration completed successfully")
        except Exception as e:
            print(f"Error migrating forecast table: {e}")
            conn.rollback()
        finally:
            self.close_connection(conn)
        # Upgraded databases: scenarios may exist with none flagged as base.
        self.ensure_base_scenario()

    def ensure_base_scenario(self):
        """
        Keep the single-base invariant: if scenarios exist and none is flagged
        as the base, the lowest forecast_id becomes the base. Idempotent. Runs
        after the schema migration and after every CSV load, since a legacy
        forecast.csv has no is_base column.
        """
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM forecast WHERE is_base = 1")
            if cursor.fetchone()[0] == 0:
                cursor.execute(
                    "UPDATE forecast SET is_base = 1 WHERE forecast_id = "
                    "(SELECT forecast_id FROM forecast ORDER BY forecast_id LIMIT 1)"
                )
                conn.commit()
        except Exception as e:
            print(f"Error ensuring a base scenario: {e}")
            conn.rollback()
        finally:
            self.close_connection(conn)

    # Seed CSV file -> table. Parents come before the tables that reference
    # them; with foreign keys suspended during the load the order only
    # matters for the per-table reference check, which needs parents loaded.
    CSV_TABLES = (
        # 1. Root tables (no FK dependencies)
        ('customers.csv', 'customers'),
        ('units.csv', 'units'),
        ('forecast.csv', 'forecast'),
        ('machines.csv', 'machines'),
        ('labor_rates.csv', 'labor_rates'),
        ('bom_definitions.csv', 'bom_definitions'),
        ('routers.csv', 'router_definitions'),
        ('expense_categories.csv', 'expense_categories'),
        ('loans.csv', 'loans'),
        ('payroll_config.csv', 'payroll_config'),
        # 2. Tables that depend on the roots
        ('bom.csv', 'bom'),
        ('router_operations.csv', 'router_operations'),   # -> router_definitions, machines, labor_rates
        ('routers_legacy.csv', 'routers'),                # -> units, machines, labor_rates
        ('sales.csv', 'sales'),                           # -> customers, units, forecast
        ('payroll.csv', 'payroll'),                       # -> forecast
        ('expenses.csv', 'expenses'),                     # -> expense_categories
        ('loan_payments.csv', 'loan_payments'),           # -> loans
        # 3. Tables that depend on the layer above
        ('expense_allocations.csv', 'expense_allocations'),  # -> expenses
    )

    @staticmethod
    def _prepare_csv_frame(table_name: str, df: pd.DataFrame, bom_names: Dict[str, str]) -> pd.DataFrame:
        """Per-table clean-up of a seed CSV (read as text) before it is inserted."""
        if table_name == 'bom':
            # '1' / 1 / 1.0 -> '1.0' so lines match units.bom_version
            df['version'] = (df['version'].map(_normalize_bom_version)
                             if 'version' in df.columns else '1.0')
            # material_cost = qty x unit_price unless the file gives it
            if {'qty', 'unit_price'} <= set(df.columns):
                extended = (pd.to_numeric(df['qty'], errors='coerce')
                            * pd.to_numeric(df['unit_price'], errors='coerce'))
                df['material_cost'] = (pd.to_numeric(df['material_cost'], errors='coerce').fillna(extended)
                                       if 'material_cost' in df.columns else extended)
            # An optional bom_name column names the auto-created headers
            if 'bom_name' in df.columns:
                for bom_id, name in zip(df['bom_id'], df['bom_name']):
                    if isinstance(name, str) and name.strip() and bom_id not in bom_names:
                        bom_names[bom_id] = name.strip()
        elif table_name == 'sales':
            # Every sale needs an id: the UI and MCP edit / delete rows by sale_id.
            if 'sale_id' not in df.columns:
                df['sale_id'] = None
            missing = df['sale_id'].isna() | (df['sale_id'].astype(str).str.strip() == '')
            if missing.any():
                df.loc[missing, 'sale_id'] = [str(uuid.uuid4()) for _ in range(int(missing.sum()))]
            if {'quantity', 'unit_price'} <= set(df.columns):
                extended = (pd.to_numeric(df['quantity'], errors='coerce')
                            * pd.to_numeric(df['unit_price'], errors='coerce'))
                df['total_revenue'] = (pd.to_numeric(df['total_revenue'], errors='coerce').fillna(extended)
                                       if 'total_revenue' in df.columns else extended)
        elif table_name == 'routers':
            if 'version' not in df.columns:
                df['version'] = '1.0'
            if 'labor_type_id' not in df.columns:
                df['labor_type_id'] = 'RATE-001'  # Default to general rate
        elif table_name == 'loans':
            # Normalize critical fields to avoid NULLs breaking API models
            df['payment_frequency'] = df['payment_frequency'].fillna('monthly') if 'payment_frequency' in df.columns else 'monthly'
            df['payment_type'] = df['payment_type'].fillna('amortizing') if 'payment_type' in df.columns else 'amortizing'
            if 'is_active' in df.columns:
                flags = {'true': 1, 'yes': 1, '1': 1, '1.0': 1, 'false': 0, 'no': 0, '0': 0, '0.0': 0}
                df['is_active'] = df['is_active'].map(
                    lambda v: 1 if v is None or (isinstance(v, float) and v != v)
                    else flags.get(str(v).strip().lower(), v))
            if 'current_balance' in df.columns and 'principal_amount' in df.columns:
                df['current_balance'] = df['current_balance'].fillna(df['principal_amount'])
            if 'monthly_payment_amount' in df.columns:
                df['monthly_payment_amount'] = df['monthly_payment_amount'].fillna(0)
        elif table_name == 'units':
            if 'bom_id' not in df.columns and 'bom' in df.columns:
                df['bom_id'] = df['bom']
            if 'router_id' not in df.columns and 'router' in df.columns:
                df['router_id'] = df['router']
            if 'bom_version' not in df.columns:
                df['bom_version'] = '1.0'
            if 'router_version' not in df.columns:
                df['router_version'] = '1.0'
        elif table_name == 'machines':
            if 'available_minutes_per_month' not in df.columns:
                df['available_minutes_per_month'] = 10000  # Default capacity
        return df

    def _seed_csv_files(self) -> List[Tuple[str, str]]:
        """(csv file, table) for every seed CSV present in data_dir, parents first."""
        return [(csv_file, table) for csv_file, table in self.CSV_TABLES
                if os.path.exists(os.path.join(self.data_dir, csv_file))]

    @staticmethod
    def _fk_violations(cursor, table: Optional[str] = None) -> List[Tuple]:
        sql = f'PRAGMA foreign_key_check("{table}")' if table else 'PRAGMA foreign_key_check'
        return [tuple(row) for row in cursor.execute(sql).fetchall()]

    def load_csv_data(self) -> Dict[str, Any]:
        """
        Load the seed CSVs in ``data_dir`` into their tables (each file
        replaces its table's rows), all in ONE transaction with foreign keys
        suspended, so parents and children reload together:

        * a table whose own rows reference a missing parent (a sale of an
          unknown product, ...) is not loaded and keeps its previous rows; the
          error names the table;
        * if replacing a parent would orphan rows of a table that is not being
          reloaded (an existing sale of a customer that customers.csv no longer
          has, assumptions of a scenario forecast.csv drops, ...), the whole
          reload is refused and nothing changes (``status: refused``).

        Sales without a sale_id get a generated one; missing total_revenue is
        quantity x unit_price. Returns ``{status, loaded, errors, refused}``.
        """
        present = self._seed_csv_files()
        result: Dict[str, Any] = {"status": "success", "loaded": {}, "errors": {}, "refused": None}
        if not present:
            print(f"No seed CSV files in {self.data_dir} - nothing to load")
            return result

        conn = sqlite3.connect(self.database_path, timeout=30.0)
        conn.isolation_level = None          # explicit BEGIN / COMMIT below
        cursor = conn.cursor()
        bom_names: Dict[str, str] = {}
        try:
            # Must be set outside a transaction, or SQLite ignores it.
            cursor.execute("PRAGMA foreign_keys=OFF")
            cursor.execute("BEGIN IMMEDIATE")
            baseline = set(self._fk_violations(cursor))
            try:
                for csv_file, table_name in present:
                    csv_path = os.path.join(self.data_dir, csv_file)
                    cursor.execute("SAVEPOINT load_table")
                    try:
                        df = pd.read_csv(csv_path, dtype=str, encoding='utf-8-sig')
                        df = self._prepare_csv_frame(table_name, df, bom_names)

                        existing_cols = [col[1] for col in cursor.execute(f'PRAGMA table_info("{table_name}")')]
                        dropped_cols = [c for c in df.columns if c not in existing_cols]
                        if dropped_cols:
                            print(f"Warning: The following columns in {csv_file} are not present in the "
                                  f"{table_name} table schema and will be dropped: {dropped_cols}")
                        df = df[[c for c in df.columns if c in existing_cols]]
                        if df.columns.empty:
                            raise ValueError(f"no column of {csv_file} matches the {table_name} table")

                        rows = df.astype(object).where(pd.notna(df), None).values.tolist()
                        cols_sql = ', '.join(f'"{c}"' for c in df.columns)
                        marks = ', '.join('?' for _ in df.columns)
                        cursor.execute(f'DELETE FROM "{table_name}"')
                        cursor.executemany(f'INSERT INTO "{table_name}" ({cols_sql}) VALUES ({marks})', rows)

                        own = self._fk_violations(cursor, table_name)
                        if own:
                            parents = sorted({v[2] for v in own})
                            raise ValueError(f"{len(own)} row(s) reference missing {', '.join(parents)} rows")
                        cursor.execute("RELEASE load_table")
                        result["loaded"][table_name] = len(rows)
                        print(f"Loaded {csv_file} into {table_name} table ({len(rows)} rows)")
                    except Exception as e:
                        cursor.execute("ROLLBACK TO load_table")
                        cursor.execute("RELEASE load_table")
                        result["errors"][csv_file] = str(e)
                        print(f"Error loading {csv_file}: {str(e)} - {table_name} keeps its previous rows")

                # One header per BOM, named after the BOM (or a bom_name column),
                # showing its newest version.
                newest: Dict[str, str] = {}
                for bom_id, version in cursor.execute(
                        "SELECT DISTINCT bom_id, version FROM bom WHERE bom_id IS NOT NULL").fetchall():
                    version = version or '1.0'
                    if bom_id not in newest or _bom_version_key(version) > _bom_version_key(newest[bom_id]):
                        newest[bom_id] = version
                for bom_id, version in sorted(newest.items()):
                    cursor.execute(
                        "INSERT OR IGNORE INTO bom_definitions (bom_id, bom_name, bom_description, version) "
                        "VALUES (?, ?, ?, ?)",
                        (bom_id, bom_names.get(bom_id, bom_id), f"Bill of Materials for {bom_id}", version))

                orphaned = [v for v in self._fk_violations(cursor) if v not in baseline]
                if orphaned:
                    by_table: Dict[Tuple[str, str], int] = {}
                    for child, _rowid, parent, _fk in orphaned:
                        by_table[(child, parent)] = by_table.get((child, parent), 0) + 1
                    detail = '; '.join(f"{n} {child} row(s) would lose their {parent} row"
                                       for (child, parent), n in sorted(by_table.items()))
                    raise _ReloadRefused(
                        "CSV reload refused, nothing changed: " + detail +
                        ". Add the missing rows to the CSVs (or start clean with "
                        "POST /database/start-clean) and restart.")
                cursor.execute("COMMIT")
            except _ReloadRefused as refused:
                cursor.execute("ROLLBACK")
                result.update(status="refused", refused=str(refused), loaded={})
                print("=" * 72 + f"\n{refused}\n" + "=" * 72)
            except Exception:
                cursor.execute("ROLLBACK")
                raise
        finally:
            conn.close()

        if result["status"] == "success":
            print("Created BOM definitions from existing BOM data")
            # A legacy forecast.csv has no is_base column; keep exactly one base.
            self.ensure_base_scenario()
        return result
    
    def get_table_data(
        self,
        table_name: str,
        forecast_id: str = None,
        filters: Dict[str, Any] = None,
        limit: int = None,
        offset: int = None,
    ) -> Dict[str, Any]:
        """Get data from a specific table with optional filtering"""
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            # Get column names
            cursor.execute(f"PRAGMA table_info({table_name})")
            columns = [col[1] for col in cursor.fetchall()]

            # Build base query
            query = f"SELECT * FROM {table_name}"
            params = []
            where_clauses = []

            # Apply forecast filtering when column exists. Sales always belong
            # to one scenario; every other table treats NULL as company-wide
            # (included in every scenario), matching the statements engine.
            if forecast_id and "forecast_id" in columns:
                if table_name == "sales":
                    where_clauses.append("forecast_id = ?")
                else:
                    where_clauses.append("(forecast_id = ? OR forecast_id IS NULL)")
                params.append(forecast_id)

            # Apply column filters
            if filters:
                for col, val in filters.items():
                    if col in columns:
                        where_clauses.append(f"{col} = ?")
                        params.append(val)

            if where_clauses:
                query += " WHERE " + " AND ".join(where_clauses)

            # Add pagination
            if limit is not None:
                query += " LIMIT ?"
                params.append(limit)
                if offset:
                    query += " OFFSET ?"
                    params.append(offset)
            elif offset is not None:
                query += " LIMIT -1 OFFSET ?"
                params.append(offset)

            # Get data
            cursor.execute(query, params)
            rows = cursor.fetchall()

            # Convert to list of dictionaries
            data = [dict(zip(columns, row)) for row in rows]

            result = {
                "status": "success",
                "data": data,
                "columns": columns,
            }
        except Exception as e:
            result = {
                "status": "error",
                "error": str(e),
            }
        finally:
            conn.close()

        return result
    
    # Columns of a legacy forecast result row (the old forecast_results table plus sale_id / warnings).
    FORECAST_RESULT_COLUMNS = [
        "forecast_id", "sale_id", "forecast_date", "period", "customer_id", "customer_name", "unit_id",
        "unit_name", "quantity", "unit_price", "total_revenue", "material_cost", "labor_cost",
        "machine_cost", "total_cost", "gross_margin", "margin_percentage", "cost_warnings",
    ]

    def _compute_forecast_results(self, cursor, forecast_id: Optional[str] = None,
                                  period: Optional[str] = None) -> Dict[str, Any]:
        """
        Per-sales-row cost and margin, computed on request with
        utils.cost_rollup.calculate_unit_costs (the BOM version the product
        uses, routing operations x machine and labor rates) - the same unit
        costs the statements engine uses. Read-only: nothing is stored.
        ``forecast_id`` in each result is the sale's scenario.
        """
        try:
            from utils.cost_rollup import calculate_unit_costs
        except ImportError:  # imported as app.db.database without app/ on sys.path
            from app.utils.cost_rollup import calculate_unit_costs
        from datetime import datetime

        where, params = [], []
        if forecast_id:
            where.append("s.forecast_id = ?")
            params.append(forecast_id)
        if period:
            where.append("s.period = ?")
            params.append(period)
        cursor.execute(f'''
            SELECT s.sale_id, s.customer_id, s.unit_id, s.period, s.quantity,
                   s.unit_price, s.total_revenue, s.forecast_id,
                   c.customer_name, u.unit_name, u.base_price, u.bom_id, u.router_id, u.bom_version
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.customer_id
            LEFT JOIN units u ON s.unit_id = u.unit_id
            {"WHERE " + " AND ".join(where) if where else ""}
            ORDER BY s.period, s.customer_id, s.unit_id
        ''', params)
        sales_columns = ['sale_id', 'customer_id', 'unit_id', 'period', 'quantity',
                         'unit_price', 'total_revenue', 'forecast_id', 'customer_name',
                         'unit_name', 'base_price', 'bom_id', 'router_id', 'bom_version']
        sales_data = [dict(zip(sales_columns, row)) for row in cursor.fetchall()]

        forecast_date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        unit_costs: Dict[Tuple, Dict[str, Any]] = {}
        results = []
        for sale in sales_data:
            key = (sale['bom_id'] or None, sale['bom_version'], sale['router_id'] or None)
            if key not in unit_costs:
                unit_costs[key] = calculate_unit_costs(cursor, *key)
            costs = unit_costs[key]
            quantity = sale['quantity'] or 0
            revenue = sale['total_revenue']
            if revenue is None:
                revenue = quantity * (sale['unit_price'] or 0)
            material_cost = costs['material_per_unit'] * quantity
            labor_cost = costs['labor_per_unit'] * quantity
            machine_cost = costs['machine_per_unit'] * quantity
            total_cost = material_cost + labor_cost + machine_cost
            gross_margin = revenue - total_cost
            results.append({
                "forecast_id": sale['forecast_id'], "sale_id": sale['sale_id'], "forecast_date": forecast_date,
                "period": sale['period'], "customer_id": sale['customer_id'],
                "customer_name": sale['customer_name'], "unit_id": sale['unit_id'], "unit_name": sale['unit_name'],
                "quantity": sale['quantity'], "unit_price": sale['unit_price'], "total_revenue": revenue,
                "material_cost": material_cost, "labor_cost": labor_cost, "machine_cost": machine_cost,
                "total_cost": total_cost, "gross_margin": gross_margin,
                "margin_percentage": (gross_margin / revenue * 100) if revenue > 0 else 0,
                "cost_warnings": list(costs['warnings']),
            })
        return {"sales": sales_data, "results": results, "forecast_date": forecast_date}

    def get_forecast_data(self, forecast_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Legacy forecast view (GET /forecast): sales joined with customers and
        products, BOM lines, routing operations, payroll, and per-sale cost /
        margin rows (``forecast_results``) from utils.cost_rollup.

        Read-only: the forecast_results table is no longer rewritten. Pass
        ``forecast_id`` to limit sales and results to one scenario. The
        statements engine (services.financial_statements) remains the source
        of truth for reporting.
        """
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            computed = self._compute_forecast_results(cursor, forecast_id=forecast_id)
            sales_data = [{k: v for k, v in sale.items() if k != 'bom_version'} for sale in computed["sales"]]

            # BOM lines of every version, and each BOM's material cost per unit for its header version
            cursor.execute('SELECT * FROM bom ORDER BY bom_id, version, bom_line')
            bom_columns = [d[0] for d in cursor.description]
            bom_data = [dict(zip(bom_columns, row)) for row in cursor.fetchall()]
            cursor.execute('''
                SELECT b.bom_id, SUM(b.material_cost)
                FROM bom b LEFT JOIN bom_definitions d ON d.bom_id = b.bom_id
                WHERE b.version = COALESCE(d.version, b.version)
                GROUP BY b.bom_id
            ''')
            bom_costs = {row[0]: row[1] for row in cursor.fetchall()}

            # Routing operations with their machine and labor cost per unit
            cursor.execute('''
                SELECT ro.router_id, ro.sequence, ro.machine_id, ro.machine_minutes, ro.labor_minutes,
                       ro.labor_type_id, ro.operation_description, m.machine_name, m.machine_rate,
                       COALESCE(ro.machine_minutes, 0) * COALESCE(m.machine_rate, 0) / 60.0,
                       lr.rate_amount,
                       COALESCE(ro.labor_minutes, 0) * COALESCE(lr.rate_amount, 0) / 60.0
                FROM router_operations ro
                LEFT JOIN machines m ON ro.machine_id = m.machine_id
                LEFT JOIN labor_rates lr ON ro.labor_type_id = lr.rate_id
                ORDER BY ro.router_id, ro.sequence
            ''')
            router_columns = ['router_id', 'sequence', 'machine_id', 'machine_minutes', 'labor_minutes',
                              'labor_type_id', 'operation_description', 'machine_name', 'machine_rate',
                              'machine_cost_per_unit', 'labor_rate', 'labor_cost_per_unit']
            router_data = [dict(zip(router_columns, row)) for row in cursor.fetchall()]

            cursor.execute('SELECT rate_type, AVG(rate_amount) as avg_rate FROM labor_rates GROUP BY rate_type')
            labor_rates = {row[0]: row[1] for row in cursor.fetchall()}

            cursor.execute('SELECT * FROM payroll ORDER BY employee_id')
            payroll_columns = [d[0] for d in cursor.description]
            payroll_data = [dict(zip(payroll_columns, row)) for row in cursor.fetchall()]

            # Informational only: product labor cost comes from routing labor rates.
            avg_labor_rate = 35.0
            rates = [row['hourly_rate'] for row in payroll_data if row.get('hourly_rate') is not None]
            if rates:
                avg_labor_rate = sum(rates) / len(rates)
            elif 'Hourly' in labor_rates:
                avg_labor_rate = labor_rates['Hourly']

            result = {
                "status": "success",
                "data": {
                    "sales_forecast": sales_data,
                    "bom_data": bom_data,
                    "bom_costs": bom_costs,
                    "router_data": router_data,
                    "payroll_data": payroll_data,
                    "labor_rates": labor_rates,
                    "forecast_results": computed["results"],
                    "forecast_columns": list(self.FORECAST_RESULT_COLUMNS),
                    "forecast_date": computed["forecast_date"],
                    "avg_labor_rate": avg_labor_rate,
                }
            }
        except Exception as e:
            result = {
                "status": "error",
                "error": str(e)
            }
        finally:
            conn.close()

        return result

    def get_saved_forecast_results(self, period: str = None, limit: int = None,
                                   forecast_id: str = None) -> Dict[str, Any]:
        """
        Per-sale cost / margin rows (GET /forecast/results), computed on
        request like get_forecast_data (read-only; always current). Optional
        filters: ``period`` (exact), ``forecast_id``, ``limit``. ``summary``
        covers the filtered rows before the limit.
        """
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            data = self._compute_forecast_results(cursor, forecast_id=forecast_id, period=period)["results"]
            total_revenue = sum(r["total_revenue"] or 0 for r in data)
            total_cost = sum(r["total_cost"] for r in data)
            summary_data = {
                "total_records": len(data),
                "total_revenue": total_revenue,
                "total_cost": total_cost,
                "total_margin": total_revenue - total_cost,
                "avg_margin_percentage": (sum(r["margin_percentage"] for r in data) / len(data)) if data else None,
            }
            if limit:
                data = data[:int(limit)]

            result = {
                "status": "success",
                "data": data,
                "columns": list(self.FORECAST_RESULT_COLUMNS),
                "summary": summary_data
            }
        except Exception as e:
            result = {
                "status": "error",
                "error": str(e)
            }
        finally:
            conn.close()

        return result
    
    def execute_sql(self, sql_statement: str, description: str = None, user_id: str = None, session_id: str = None) -> Dict[str, Any]:
        """Execute SQL statement and return results"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        # Record execution start time
        import time
        start_time = time.time()
        
        try:
            cursor.execute(sql_statement)
            
            # Calculate execution time
            execution_time_ms = int((time.time() - start_time) * 1000)
            
            # Check if it's a SELECT statement
            if sql_statement.strip().upper().startswith('SELECT'):
                columns = [description[0] for description in cursor.description]
                rows = cursor.fetchall()
                data = [dict(zip(columns, row)) for row in rows]
                rows_affected = len(data)
                result = {
                    "status": "success",
                    "data": data,
                    "columns": columns
                }
            else:
                # For INSERT, UPDATE, DELETE statements
                conn.commit()
                rows_affected = cursor.rowcount
                result = {
                    "status": "success",
                    "message": f"SQL executed successfully. Rows affected: {rows_affected}"
                }
            
            # Log the successful execution
            self._log_sql_execution(
                conn, sql_statement, description, user_id, session_id,
                "success", None, rows_affected, execution_time_ms
            )
            
        except Exception as e:
            # Calculate execution time for failed queries
            execution_time_ms = int((time.time() - start_time) * 1000)
            
            # Log the failed execution
            self._log_sql_execution(
                conn, sql_statement, description, user_id, session_id,
                "error", str(e), 0, execution_time_ms
            )
            
            result = {
                "status": "error",
                "error": str(e)
            }
        finally:
            conn.close()
        
        return result
    
    def _log_sql_execution(self, conn, sql_statement: str, description: str, user_id: str, 
                          session_id: str, status: str, error_message: str, 
                          rows_affected: int, execution_time_ms: int):
        """Log SQL execution to the execution_log table"""
        from datetime import datetime
        
        cursor = conn.cursor()
        execution_date = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        cursor.execute('''
            INSERT INTO execution_log (
                execution_date, sql_statement, description, user_id, session_id,
                execution_status, error_message, rows_affected, execution_time_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            execution_date, sql_statement, description, user_id, session_id,
            status, error_message, rows_affected, execution_time_ms
        ))
        
        conn.commit()
    
    def initialize_schema(self):
        """
        Bring the live database to the current schema: create missing tables
        and indexes, run every column migration and keep exactly one base
        scenario. Idempotent; runs at startup and after every snapshot load,
        revert, switch and reset, so an older snapshot is upgraded on load.
        """
        self.create_tables()
        self.migrate_payroll_table()
        self.migrate_expenses_table()
        self.migrate_forecast_table()          # also ensures a base scenario
        self.migrate_payroll_config_table()
        self.migrate_financial_assumptions_table()
        self.migrate_price_list_table()
        self.migrate_governance_and_controls()
        self.migrate_actuals_undo_tracking()
        self.migrate_governance_guards()
        self.ensure_base_scenario()

    def _has_seed_data(self) -> bool:
        """True when any of customers / units / sales / bom has rows."""
        if not os.path.exists(self.database_path):
            return False
        try:
            with self.connection() as conn:
                for table in ['customers', 'units', 'sales', 'bom']:
                    try:
                        if conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] > 0:
                            return True
                    except sqlite3.Error:
                        continue  # Table might not exist yet
        except sqlite3.Error:
            pass  # Database might be corrupted or inaccessible
        return False

    def initialize(self):
        """Startup: bring the schema up to date, then load seed CSVs into an empty database."""
        print(f"Initializing database at: {self.database_path}")
        print(f"Data directory: {self.data_dir}")

        has_existing_data = self._has_seed_data()
        self.initialize_schema()
        print("Schema created / migrated")

        # Check for force reload environment variable
        force_reload = os.getenv('FORCE_DB_RELOAD', 'false').lower() == 'true'

        if has_existing_data and not force_reload:
            print("Database already contains data - skipping CSV data loading")
            print("Database initialization complete (existing data preserved)")
            return

        if not self._seed_csv_files():
            print(f"No seed CSV files in {self.data_dir} - starting with the database as it is")
            return

        if force_reload and has_existing_data:
            print("!" * 72)
            print("FORCE_DB_RELOAD=true: replacing tables from the CSVs in "
                  f"{self.data_dir}. This runs on EVERY start (and every --reload restart); "
                  "set FORCE_DB_RELOAD=false once the reload is done.")
            try:
                backup = os.path.join(self.snapshot_dir, f"force_reload_backup_{timestamp_slug()}.db")
                self.backup_to(backup)
                print(f"Snapshot of the database before the reload: {backup}")
            except Exception as e:
                print(f"Could not snapshot before the reload ({e}) - reload skipped, data unchanged")
                print("!" * 72)
                return
            print("!" * 72)
        else:
            print("Loading fresh data from CSV files")
        self.load_csv_data()
        print("Database initialization complete")

    def get_execution_logs(self, limit: int = None, user_id: str = None, 
                          session_id: str = None, status: str = None) -> Dict[str, Any]:
        """Get execution logs with optional filtering"""
        conn = self.get_connection()
        cursor = conn.cursor()
        
        try:
            # Build query with optional filters
            query = "SELECT * FROM execution_log"
            params = []
            conditions = []
            
            if user_id:
                conditions.append("user_id = ?")
                params.append(user_id)
            
            if session_id:
                conditions.append("session_id = ?")
                params.append(session_id)
            
            if status:
                conditions.append("execution_status = ?")
                params.append(status)
            
            if conditions:
                query += " WHERE " + " AND ".join(conditions)
            
            query += " ORDER BY execution_date DESC, log_id DESC"
            
            if limit:
                query += f" LIMIT {limit}"
            
            cursor.execute(query, params)
            logs = cursor.fetchall()
            
            # Get column names
            cursor.execute("PRAGMA table_info(execution_log)")
            columns = [col[1] for col in cursor.fetchall()]
            
            # Convert to list of dictionaries
            data = []
            for row in logs:
                data.append(dict(zip(columns, row)))
            
            # Get summary statistics
            cursor.execute('''
                SELECT 
                    COUNT(*) as total_executions,
                    COUNT(CASE WHEN execution_status = 'success' THEN 1 END) as successful_executions,
                    COUNT(CASE WHEN execution_status = 'error' THEN 1 END) as failed_executions,
                    AVG(execution_time_ms) as avg_execution_time_ms,
                    SUM(rows_affected) as total_rows_affected
                FROM execution_log
            ''')
            summary = cursor.fetchone()
            summary_data = {
                "total_executions": summary[0],
                "successful_executions": summary[1],
                "failed_executions": summary[2],
                "avg_execution_time_ms": summary[3],
                "total_rows_affected": summary[4]
            }
            
            result = {
                "status": "success",
                "data": data,
                "columns": columns,
                "summary": summary_data
            }
        except Exception as e:
            result = {
                "status": "error",
                "error": str(e)
            }
        finally:
            conn.close()
        
        return result
    
    def replay_execution_logs(self, target_date: str = None, max_log_id: int = None,
                             user_id: str = None, session_id: str = None) -> Dict[str, Any]:
        """
        Replay SQL statements from execution log up to a specific point in time.

        The statements run in ONE transaction under ``replay_authorizer``: a
        replay never writes the governance records (change history,
        approvals, actuals and their batches / close), the approve / unlock
        switch, the internal log / cache tables or a scenario's approval
        columns, never changes the schema (tables, triggers ...), and never
        runs PRAGMA / ATTACH / transaction control. Recursive triggers are on,
        so a REPLACE that deletes a locked scenario's row meets the lock
        triggers, and the approval columns are compared after every
        statement (a re-created or new scenario cannot arrive approved). If
        any statement tries any of that, or hits an approved (locked)
        scenario, the whole replay is refused (``status: 'refused'``,
        ``code: 409``, ``refused: [{log_id, sql_statement, reason}]``) and
        nothing is changed. Other failing statements are reported in
        ``errors`` and the rest is committed.
        """
        conn = self.get_connection()
        cursor = conn.cursor()

        try:
            # Build query to get logs to replay
            query = "SELECT * FROM execution_log WHERE execution_status = 'success'"
            params = []
            
            if target_date:
                query += " AND execution_date <= ?"
                params.append(target_date)
            
            if max_log_id:
                query += " AND log_id <= ?"
                params.append(max_log_id)
            
            if user_id:
                query += " AND user_id = ?"
                params.append(user_id)
            
            if session_id:
                query += " AND session_id = ?"
                params.append(session_id)
            
            query += " ORDER BY execution_date ASC, log_id ASC"
            
            cursor.execute(query, params)
            logs_to_replay = cursor.fetchall()
            
            # Get column names
            cursor.execute("PRAGMA table_info(execution_log)")
            columns = [col[1] for col in cursor.fetchall()]
            
            # Replay each SQL statement, in one transaction, under the replay authorizer
            replayed_count = 0
            failed_count = 0
            errors = []
            refused = []
            denied: List[str] = []

            # REPLACE deletes a conflicting row; only with recursive triggers do the lock triggers see that delete.
            cursor.execute("PRAGMA recursive_triggers = ON")
            if not conn.in_transaction:
                cursor.execute("BEGIN")
            approvals = _approval_state(cursor)
            conn.set_authorizer(replay_authorizer(denied))
            try:
                for log_row in logs_to_replay:
                    log_entry = dict(zip(columns, log_row))
                    sql_statement = str(log_entry.get("sql_statement") or "")

                    # Skip SELECT statements (and blanks) as they don't modify data
                    if not sql_statement.strip() or sql_statement.strip().upper().startswith('SELECT'):
                        continue
                    denied.clear()
                    try:
                        cursor.execute(sql_statement)
                        replayed_count += 1
                        after = _approval_state(cursor)
                        change = _approval_state_change(approvals, after)
                        if change:
                            refused.append({"log_id": log_entry.get("log_id"), "sql_statement": sql_statement,
                                            "reason": change})
                        approvals = after
                    except Exception as e:
                        text = str(e)
                        if denied or GOVERNANCE_TOKEN in text or 'SCENARIO_LOCKED' in text:
                            if denied:
                                reason = " and ".join(dict.fromkeys(denied))
                            elif GOVERNANCE_TOKEN in text:
                                reason = "change a scenario's approval fields (approve / unlock only)"
                            else:
                                reason = "change rows of an approved (locked) scenario"
                            refused.append({"log_id": log_entry.get("log_id"), "sql_statement": sql_statement,
                                            "reason": reason})
                            continue
                        failed_count += 1
                        errors.append({
                            "log_id": log_entry.get("log_id"),
                            "sql_statement": sql_statement,
                            "error": text
                        })
            finally:
                conn.set_authorizer(None)

            if not refused:
                cursor.execute(f"SELECT COUNT(*) FROM {GOVERNANCE_GUARD_TABLE}")
                if cursor.fetchone()[0]:  # belt and braces: the approve / unlock switch is never left on
                    refused.append({"log_id": None, "sql_statement": None,
                                    "reason": f"leave {GOVERNANCE_GUARD_TABLE} set"})
            if refused:
                conn.rollback()
                shown = "; ".join(f"log {r['log_id']}: would {r['reason']}" for r in refused[:10])
                more = f"; and {len(refused) - 10} more" if len(refused) > 10 else ""
                return {
                    "status": "refused",
                    "code": 409,
                    "error": (f"Nothing replayed: {len(refused)} logged statement(s) would change the governance "
                              f"records, the schema or an approved scenario ({shown}{more}). A replay only "
                              f"re-applies plain data changes; approvals, the change history, actuals and "
                              f"month-end close change only through their own endpoints. Nothing was changed."),
                    "refused": refused,
                    "replayed_count": 0,
                    "failed_count": failed_count,
                    "errors": errors,
                }

            # Commit all changes
            conn.commit()

            result = {
                "status": "success",
                "message": f"Replayed {replayed_count} SQL statements successfully",
                "replayed_count": replayed_count,
                "failed_count": failed_count,
                "errors": errors
            }
        except Exception as e:
            result = {
                "status": "error",
                "error": str(e)
            }
        finally:
            conn.close()
        
        return result
    
    # ------------------------------------------------------------------
    # Data lifecycle: snapshots, restore, clear, reset, switch
    # ------------------------------------------------------------------

    @property
    def snapshot_dir(self) -> str:
        """Folder of saved snapshots: ``saved_databases`` next to the live
        database (kept fixed when /database/switch points at another file)."""
        pinned = getattr(self, '_snapshot_dir', None)
        return pinned or os.path.join(os.path.dirname(self.database_path), 'saved_databases')

    def repoint(self, database_path: str, data_dir: Optional[str] = None) -> None:
        """Point THIS instance at another database file, in place, so every
        module holding a reference to it (``from db.database import
        db_manager``) follows. The snapshot folder stays where it was."""
        self._snapshot_dir = self.snapshot_dir
        self.database_path = database_path
        if data_dir:
            self.data_dir = data_dir
        os.makedirs(os.path.dirname(os.path.abspath(database_path)), exist_ok=True)

    @staticmethod
    def tables_children_first(conn) -> List[str]:
        """Every user table, ordered so a table comes before the tables it references."""
        names = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        known = set(names)
        parents = {
            name: {row[2] for row in conn.execute(f'PRAGMA foreign_key_list("{name}")')} & known - {name}
            for name in names
        }
        ordered: List[str] = []           # parents first
        remaining = list(names)
        while remaining:
            ready = [n for n in remaining if parents[n] <= set(ordered)]
            if not ready:                 # reference cycle: keep the rest alphabetical
                ready = remaining[:]
            for n in ready:
                ordered.append(n)
                remaining.remove(n)
        return list(reversed(ordered))

    def table_counts(self) -> Dict[str, int]:
        with self.connection() as conn:
            return {name: conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
                    for name in sorted(self.tables_children_first(conn))}

    #: Tables a "start clean" keeps: the change history survives a reset.
    KEEP_ON_CLEAR = ("audit_log",)

    def clear_all_data(self, exclude: Tuple[str, ...] = ()) -> Dict[str, Any]:
        """
        Delete every row of every table (the schema stays), children first,
        in one transaction. Foreign keys are suspended on a fresh connection
        BEFORE the transaction starts (inside one SQLite ignores the pragma)
        and checked before commit; any error rolls everything back.
        Returns ``{tables: {name: rows_deleted}, rows_deleted, tables_cleared}``.
        """
        conn = sqlite3.connect(self.database_path, timeout=30.0)
        conn.isolation_level = None
        try:
            conn.execute("PRAGMA foreign_keys=OFF")
            conn.execute("BEGIN IMMEDIATE")
            try:
                # Approved scenarios are locked by triggers; a reset clears them too.
                if any(r[1] == "locked" for r in conn.execute("PRAGMA table_info(forecast)")):
                    guarded = conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
                                           (GOVERNANCE_GUARD_TABLE,)).fetchone() is not None
                    if guarded:
                        governance_guard_on(conn)
                    conn.execute("UPDATE forecast SET locked = 0")
                    if guarded:
                        governance_guard_off(conn)
                counts: Dict[str, int] = {}
                for name in self.tables_children_first(conn):
                    if name in exclude or name in self.KEEP_ON_CLEAR:
                        continue
                    counts[name] = conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
                    conn.execute(f'DELETE FROM "{name}"')
                if conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_sequence'").fetchone():
                    conn.execute("DELETE FROM sqlite_sequence")   # restart AUTOINCREMENT ids
                left = conn.execute("PRAGMA foreign_key_check").fetchall()
                if left:
                    raise RuntimeError(f"rows would be left referencing deleted rows: {left[:5]}")
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
        finally:
            conn.close()
        return {
            "tables": counts,
            "rows_deleted": sum(counts.values()),
            "tables_cleared": len(counts),
        }

    def backup_to(self, dest_path: str) -> Dict[str, Any]:
        """
        Consistent copy of the live database, WAL included, through SQLite's
        online backup API (never a file copy). Written to a temp file and
        renamed into place, in rollback-journal mode so the snapshot is a
        single self-contained .db file.
        """
        if os.path.abspath(dest_path) == os.path.abspath(self.database_path):
            raise ValueError("cannot write a snapshot over the live database file")
        dest_dir = os.path.dirname(os.path.abspath(dest_path))
        os.makedirs(dest_dir, exist_ok=True)
        tmp_path = os.path.join(dest_dir, f".{os.path.basename(dest_path)}.{uuid.uuid4().hex}.tmp")
        try:
            src = self.get_connection()
            try:
                dst = sqlite3.connect(tmp_path)
                try:
                    src.backup(dst)
                    dst.execute("PRAGMA journal_mode=DELETE")
                finally:
                    dst.close()
            finally:
                src.close()
            _remove_sidecars(dest_path)
            os.replace(tmp_path, dest_path)
        except Exception:
            _remove_db_file(tmp_path)
            raise
        return {"path": dest_path, "size": os.path.getsize(dest_path)}

    def restore_from(self, source_path: str) -> Dict[str, Any]:
        """
        Replace the live database's contents with a snapshot, through SQLite's
        backup API INTO the live database (never a file copy over an open WAL
        database), so open connections and the WAL stay consistent. The
        snapshot is staged first (integrity-checked, page size matched to the
        live file) and the snapshot file itself is never modified. The schema
        is then migrated, so a snapshot taken before an upgrade loads cleanly.
        """
        if not is_sqlite_file(source_path):
            raise ValueError(f"{os.path.basename(source_path)} is not a SQLite database")
        live_dir = os.path.dirname(os.path.abspath(self.database_path))
        stage_path = os.path.join(live_dir, f".restore-{uuid.uuid4().hex}.tmp")
        try:
            src = sqlite3.connect(source_path, timeout=30.0)
            try:
                stage = sqlite3.connect(stage_path)
                try:
                    src.backup(stage)
                finally:
                    stage.close()
            finally:
                src.close()

            stage = sqlite3.connect(stage_path)
            live = self.get_connection()
            try:
                stage.execute("PRAGMA journal_mode=DELETE")
                check = stage.execute("PRAGMA quick_check").fetchone()[0]
                if check != 'ok':
                    raise ValueError(f"snapshot failed its integrity check: {check}")
                live_page = live.execute("PRAGMA page_size").fetchone()[0]
                if stage.execute("PRAGMA page_size").fetchone()[0] != live_page:
                    # A WAL database cannot change page size during a backup.
                    stage.execute(f"PRAGMA page_size={int(live_page)}")
                    stage.execute("VACUUM")
                # Wait (up to the busy timeout) for any writer to finish, so the
                # backup below does not spin on a locked database.
                live.execute("BEGIN IMMEDIATE")
                live.execute("ROLLBACK")
                stage.backup(live)
            finally:
                stage.close()
                live.close()
        finally:
            _remove_db_file(stage_path)

        self.initialize_schema()
        return {"restored_from": source_path, "database_path": self.database_path}

    def reset_to_initial_state(self) -> Dict[str, Any]:
        """
        Empty every table (FK-safe, one transaction) and reload the seed CSVs
        in data_dir, if any, then re-apply the schema. A snapshot of the
        previous state is written to saved_databases first
        (``reset_backup_<timestamp>.db``).
        """
        try:
            backup_name = f"reset_backup_{timestamp_slug()}.db"
            self.backup_to(os.path.join(self.snapshot_dir, backup_name))
            cleared = self.clear_all_data()
            self.initialize_schema()
            loaded = self.load_csv_data()
            message = (f"Database reset: {cleared['rows_deleted']} rows deleted from "
                       f"{cleared['tables_cleared']} tables")
            if loaded["loaded"]:
                message += f", {sum(loaded['loaded'].values())} rows reloaded from CSV"
            result = {
                "status": "success",
                "message": message,
                "backup_created": backup_name,
                "cleared": cleared,
                "csv_load": loaded,
            }
        except Exception as e:
            result = {
                "status": "error",
                "error": str(e),
            }

        return result

# Global database manager instance
db_manager = DatabaseManager()

def initialize_database():
    """Initialize the database"""
    db_manager.initialize()

def switch_database(new_database_path: str, data_dir: Optional[str] = None) -> DatabaseManager:
    """
    Point the app at another database file. The EXISTING DatabaseManager is
    repointed in place (never replaced), so every module that imported
    ``db_manager`` follows; the schema of the target is then brought up to
    date (tables + every migration).
    """
    db_manager.repoint(new_database_path, data_dir)
    db_manager.initialize_schema()
    print(f"Switched to database: {new_database_path}")
    return db_manager

def get_current_database_path() -> str:
    """Get the current database path"""
    return db_manager.database_path

def get_table_data(
    table_name: str,
    forecast_id: str = None,
    filters: Dict[str, Any] = None,
    limit: int = None,
    offset: int = None,
) -> Dict[str, Any]:
    """Get data from a specific table"""
    return db_manager.get_table_data(table_name, forecast_id, filters, limit, offset)

def get_forecast_data(forecast_id: str = None) -> Dict[str, Any]:
    """Legacy read-only forecast view (optionally one scenario)"""
    return db_manager.get_forecast_data(forecast_id)

def get_saved_forecast_results(period: str = None, limit: int = None, forecast_id: str = None) -> Dict[str, Any]:
    """Per-sale cost / margin rows, computed on request"""
    return db_manager.get_saved_forecast_results(period, limit, forecast_id)

def execute_sql(sql_statement: str, description: str = None, user_id: str = None, session_id: str = None) -> Dict[str, Any]:
    """Execute SQL statement with logging"""
    return db_manager.execute_sql(sql_statement, description, user_id, session_id)

def get_execution_logs(limit: int = None, user_id: str = None, session_id: str = None, status: str = None) -> Dict[str, Any]:
    """Get execution logs with optional filtering"""
    return db_manager.get_execution_logs(limit, user_id, session_id, status)

def replay_execution_logs(target_date: str = None, max_log_id: int = None, user_id: str = None, session_id: str = None) -> Dict[str, Any]:
    """Replay SQL statements from execution log up to a specific point in time"""
    return db_manager.replay_execution_logs(target_date, max_log_id, user_id, session_id)

def reset_to_initial_state() -> Dict[str, Any]:
    """Reset database to initial state by reloading CSV data"""
    return db_manager.reset_to_initial_state() 
