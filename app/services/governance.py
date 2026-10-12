"""
Governance: approved (locked) scenario baselines, the change history and the
read-only legacy data checks.

Approving a scenario
--------------------
``approve_scenario`` freezes a scenario as a baseline:

1. ``forecast.status = 'approved'``, ``locked = 1`` and the approver, time
   and note are stored, with a ``scenario_approvals`` row.
2. The statement totals over the scenario's sales window (gross sales, net
   sales, total COGS, gross profit, operating income, net income, closing
   cash) are stored in ``scenario_approvals.totals_json``.
3. The Excel workbook for that window is saved to
   ``<data_dir>/exports/approved/`` and a snapshot of the whole database
   (SQLite backup API) to ``saved_databases/approved_<id>_<YYYYMMDD_HHMMSS>.db``.

If the workbook or the snapshot cannot be written the approval is undone:
an approval without its evidence is not an approval.

While a scenario is locked the SQLite triggers created by
``DatabaseManager.migrate_governance_and_controls`` refuse every insert,
update and delete of its rows (sales, expenses and their allocations,
payroll, capex, assumptions, price list, deduction rules) and its deletion,
raising ``SCENARIO_LOCKED``; the API turns that into HTTP 409 (see
``api.governance_routes``). Company-wide inputs (BOMs, routings, rates,
company-wide prices / rules / payroll / expenses) are shared and can still
move a locked scenario's numbers: ``scenario_drift`` compares the current
totals with the approved ones.

``unlock_scenario`` (reason required) sets ``locked = 0`` and ``status =
'draft'`` and records an 'unlock' row, so the history shows who reopened a
baseline and why.

Change history
--------------
``record_audit`` writes one ``audit_log`` row per non-GET API request
except dry runs, previews and simulations (``is_preview_request``), which
change nothing (the middleware in ``api.governance_routes`` calls it); ``query_audit_log`` reads
them back. Logging never raises. Start clean keeps the history
(``KEEP_ON_CLEAR``) and restoring a snapshot carries it over
(``history_rows`` / ``restore_history``), so the record of who changed what
outlives both.
"""
from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

#: Text the scenario-lock triggers raise (RAISE(ABORT, 'SCENARIO_LOCKED')).
LOCK_TOKEN = "SCENARIO_LOCKED"

#: A current total differing from the approved one by more than this (in dollars) is drift.
DRIFT_TOLERANCE = 0.5

#: Statement totals stored with an approval and compared for drift: (key, label).
TOTAL_LINES: Tuple[Tuple[str, str], ...] = (
    ("gross_sales", "Gross sales"),
    ("net_sales", "Net sales"),
    ("total_cogs", "Total COGS"),
    ("gross_profit", "Gross profit"),
    ("operating_income", "Operating income"),
    ("net_income", "Net income"),
    ("closing_cash", "Closing cash"),
)

MONTH_GLOB = "[0-9][0-9][0-9][0-9]-[0-9][0-9]"


class GovernanceError(Exception):
    """A refused governance action; ``status`` is the HTTP status the API returns."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _manager():
    """The live DatabaseManager, looked up per call (tests and /database/switch repoint it)."""
    import db.database as dbmod
    return dbmod.db_manager


def utc_now() -> str:
    """'2026-10-12T15:21:51Z': UTC, second precision, sorts as text and parses as UTC in a browser."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _clean_text(value: Any, limit: int = 500) -> str:
    return " ".join(str(value or "").split())[:limit]


# ---------------------------------------------------------------------------
# Lock messages
# ---------------------------------------------------------------------------

def is_lock_error(value: Any) -> bool:
    """True when an exception or message comes from the scenario-lock triggers."""
    return LOCK_TOKEN in str(value or "")


def locked_message(name: Optional[str] = None) -> str:
    """The 409 explanation for a write refused because a scenario is approved and locked."""
    who = f"Scenario '{name}'" if name else "This scenario"
    return f"{who} is approved and locked: branch it to make changes, or unlock it with a reason."


def locked_scenario_name(forecast_id: Optional[str] = None) -> Tuple[Optional[str], Optional[str]]:
    """
    (forecast_id, name) of the locked scenario a refused write most likely
    touched: ``forecast_id`` when it is locked, else the only locked
    scenario, else (None, None). Never raises.
    """
    try:
        with _manager().connection() as conn:
            if forecast_id:
                row = conn.execute("SELECT forecast_id, name FROM forecast WHERE forecast_id = ? AND locked = 1",
                                   (forecast_id,)).fetchone()
                if row:
                    return row[0], row[1]
            rows = conn.execute("SELECT forecast_id, name FROM forecast WHERE locked = 1").fetchall()
            if len(rows) == 1:
                return rows[0][0], rows[0][1]
    except Exception:  # pragma: no cover - a message lookup must never fail a request
        pass
    return None, None


# ---------------------------------------------------------------------------
# Scenario totals and drift
# ---------------------------------------------------------------------------

def sales_window(cursor, forecast_id: str) -> Tuple[Optional[str], Optional[str]]:
    """First and last monthly (YYYY-MM) sales period of a scenario, or (None, None)."""
    cursor.execute(
        f"SELECT MIN(substr(period, 1, 7)), MAX(substr(period, 1, 7)) FROM sales "
        f"WHERE forecast_id = ? AND substr(period, 1, 7) GLOB '{MONTH_GLOB}'",
        (forecast_id,),
    )
    lo, hi = cursor.fetchone()
    return (str(lo)[:7], str(hi)[:7]) if lo and hi else (None, None)


def statement_totals(cursor, forecast_id: str, start_period: str, end_period: str) -> Dict[str, float]:
    """The approval totals of one scenario over a window, from the statements engine."""
    from services.financial_statements import build_statements

    stmt = build_statements(cursor, [forecast_id], start_period, end_period)
    t = stmt["income_statement"]["totals"]
    values = {
        "gross_sales": t.get("gross_sales", t.get("revenue", 0.0)),
        "net_sales": t.get("revenue", 0.0),
        "total_cogs": t.get("total_cogs", 0.0),
        "gross_profit": t.get("gross_profit", 0.0),
        "operating_income": t.get("operating_income", 0.0),
        "net_income": t.get("net_income", 0.0),
        "closing_cash": stmt["cash_flow"]["totals"].get("closing_cash"),
    }
    return {k: (round(float(v), 2) if v is not None else None) for k, v in values.items()}


def compare_totals(approved: Dict[str, Any], current: Dict[str, Any],
                   tolerance: float = DRIFT_TOLERANCE) -> Dict[str, Any]:
    """{changed, items: [{line, label, approved, current, delta}]} for lines that moved by more than ``tolerance``."""
    items = []
    for key, label in TOTAL_LINES:
        a, c = (approved or {}).get(key), (current or {}).get(key)
        if a is None and c is None:
            continue
        a, c = float(a or 0.0), float(c or 0.0)
        if abs(c - a) > tolerance:
            items.append({"line": key, "label": label, "approved": round(a, 2), "current": round(c, 2),
                          "delta": round(c - a, 2)})
    return {"changed": bool(items), "items": items}


def _parse_totals(raw: Any) -> Dict[str, Any]:
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def latest_approval(cursor, forecast_id: str) -> Optional[Dict[str, Any]]:
    cursor.execute(
        "SELECT * FROM scenario_approvals WHERE forecast_id = ? AND action = 'approve' "
        "ORDER BY created_at DESC, rowid DESC LIMIT 1",
        (forecast_id,),
    )
    row = cursor.fetchone()
    return _approval_record(cursor, row) if row else None


def scenario_drift(cursor, forecast_id: str) -> Optional[Dict[str, Any]]:
    """
    Current statement totals vs the totals stored when the scenario was
    approved, over the approved window: ``{changed, items, approved_at,
    start_period, end_period}`` (``items`` lists only the lines that moved by
    more than DRIFT_TOLERANCE). None when the scenario has no approval.
    """
    approval = latest_approval(cursor, forecast_id)
    if not approval:
        return None
    start, end = approval.get("start_period"), approval.get("end_period")
    base = {"approved_at": approval.get("created_at"), "start_period": start, "end_period": end}
    if not (start and end and approval.get("totals")):
        return {**base, "changed": None, "items": [], "error": "The approval has no stored totals to compare."}
    try:
        current = statement_totals(cursor, forecast_id, start, end)
    except Exception as exc:
        return {**base, "changed": None, "items": [], "error": f"Could not compute current totals: {exc}"}
    return {**base, **compare_totals(approval["totals"], current)}


def governance_fields(record: Dict[str, Any], cursor=None, with_drift: bool = True) -> Dict[str, Any]:
    """
    Normalise a scenario record's governance columns in place: ``status``
    ('draft' / 'approved'), ``locked`` (bool), ``approved_by``,
    ``approved_at``, ``approval_note`` and, for an approved scenario,
    ``drift`` (None otherwise).
    """
    record["locked"] = bool(record.get("locked"))
    record["status"] = record.get("status") or "draft"
    for key in ("approved_by", "approved_at", "approval_note"):
        record.setdefault(key, None)
    record["drift"] = None
    if with_drift and cursor is not None and record["status"] == "approved":
        try:
            record["drift"] = scenario_drift(cursor, record["forecast_id"])
        except Exception as exc:  # never fail the scenario list over the drift check
            record["drift"] = {"changed": None, "items": [], "error": str(exc)}
    return record


# ---------------------------------------------------------------------------
# Approve / unlock / history
# ---------------------------------------------------------------------------

def _approval_record(cursor, row: Sequence[Any]) -> Dict[str, Any]:
    record = dict(zip([d[0] for d in cursor.description], row))
    stored = _parse_totals(record.pop("totals_json", None))
    record["totals"] = stored.get("totals") or None
    record["start_period"] = stored.get("start_period")
    record["end_period"] = stored.get("end_period")
    return record


def _with_file_flags(record: Dict[str, Any]) -> Dict[str, Any]:
    mgr = _manager()
    snap = record.get("snapshot_filename")
    book = record.get("workbook_filename")
    record["snapshot_available"] = bool(snap) and os.path.exists(os.path.join(mgr.snapshot_dir, snap))
    record["workbook_available"] = bool(book) and os.path.exists(approved_workbook_path(book))
    return record


def approved_exports_dir() -> str:
    return os.path.join(_manager().data_dir, "exports", "approved")


def approved_workbook_path(filename: str) -> str:
    """Where an approval's workbook lives (base name only: no folders accepted)."""
    return os.path.join(approved_exports_dir(), os.path.basename(str(filename or "")))


def _safe(text: Any) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "-", str(text or "")).strip("-")[:40] or "scenario"


def _unique(directory: str, stem: str, ext: str) -> str:
    path = os.path.join(directory, f"{stem}{ext}")
    n = 2
    while os.path.exists(path):
        path = os.path.join(directory, f"{stem}_{n}{ext}")
        n += 1
    return path


def _scenario(cursor, forecast_id: str) -> Dict[str, Any]:
    cursor.execute("SELECT * FROM forecast WHERE forecast_id = ?", (forecast_id,))
    row = cursor.fetchone()
    if not row:
        raise GovernanceError(404, f"Scenario '{forecast_id}' not found")
    return dict(zip([d[0] for d in cursor.description], row))


def approve_scenario(forecast_id: str, approved_by: Any, note: Any = None) -> Dict[str, Any]:
    """
    Approve and lock a scenario (see the module docstring). Returns
    ``{approval, scenario_status}``. Raises GovernanceError: 404 unknown
    scenario, 422 no approver / no monthly sales, 409 already locked, 500
    when the workbook or snapshot could not be written (nothing is left
    locked then).
    """
    from services.workbook_export import write_workbook

    approver = _clean_text(approved_by, 100)
    if not approver:
        raise GovernanceError(422, "approved_by is required: who is approving this scenario?")
    note_text = str(note or "").strip()[:2000] or None
    mgr = _manager()
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    approval_id = f"APR-{uuid.uuid4().hex[:8].upper()}"
    created_at = utc_now()

    conn = mgr.get_connection()
    try:
        cursor = conn.cursor()
        scenario = _scenario(cursor, forecast_id)
        if scenario.get("locked"):
            raise GovernanceError(
                409,
                f"Scenario '{scenario['name']}' is already approved and locked"
                + (f" (by {scenario['approved_by']}, {scenario['approved_at']})" if scenario.get("approved_by") else "")
                + ". Unlock it with a reason first to approve it again.",
            )
        start, end = sales_window(cursor, forecast_id)
        if not (start and end):
            raise GovernanceError(422, f"Scenario '{scenario['name']}' has no monthly sales yet, so there is nothing "
                                       f"to approve. Import or enter its sales forecast first.")
        previous = {k: scenario.get(k) for k in ("status", "approved_by", "approved_at", "approval_note")}

        # 1. Lock first, so nothing in the scenario changes while the evidence is written.
        cursor.execute(
            "UPDATE forecast SET status = 'approved', locked = 1, approved_by = ?, approved_at = ?, approval_note = ? "
            "WHERE forecast_id = ?",
            (approver, created_at, note_text, forecast_id),
        )
        cursor.execute(
            "INSERT INTO scenario_approvals (approval_id, forecast_id, action, actor, note, created_at) "
            "VALUES (?, ?, 'approve', ?, ?, ?)",
            (approval_id, forecast_id, approver, note_text, created_at),
        )
        conn.commit()
    except GovernanceError:
        conn.rollback()
        mgr.close_connection(conn)
        raise
    except Exception:
        conn.rollback()
        mgr.close_connection(conn)
        raise

    workbook_path = None
    snapshot_path = None
    try:
        cursor = conn.cursor()
        # 2. Totals and workbook over the sales window.
        totals = statement_totals(cursor, forecast_id, start, end)
        os.makedirs(approved_exports_dir(), exist_ok=True)
        workbook_path = _unique(approved_exports_dir(),
                                f"approved_{_safe(forecast_id)}_{_safe(scenario['name']).lower()}_{start}_{end}_{stamp}",
                                ".xlsx")
        workbook = write_workbook(workbook_path, cursor, [forecast_id], start, end)
        os.makedirs(mgr.snapshot_dir, exist_ok=True)
        snapshot_path = _unique(mgr.snapshot_dir, f"approved_{_safe(forecast_id)}_{stamp}", ".db")
        stored = {"start_period": start, "end_period": end, "totals": totals}
        cursor.execute(
            "UPDATE scenario_approvals SET totals_json = ?, workbook_filename = ?, snapshot_filename = ? "
            "WHERE approval_id = ?",
            (json.dumps(stored), workbook["filename"], os.path.basename(snapshot_path), approval_id),
        )
        conn.commit()
        # 3. Snapshot of the approved state (the approval row included).
        mgr.backup_to(snapshot_path)
    except Exception as exc:
        conn.rollback()
        _undo_approval(conn, forecast_id, approval_id, previous)
        for path in (workbook_path, snapshot_path):
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                except OSError:
                    pass
        mgr.close_connection(conn)
        logger.exception("Approving scenario %s failed", forecast_id)
        raise GovernanceError(500, f"Could not save the approval evidence ({exc}); scenario '{scenario['name']}' "
                                   f"was NOT approved and is still editable.")
    try:
        approval = _with_file_flags(_approval_record(cursor, cursor.execute(
            "SELECT * FROM scenario_approvals WHERE approval_id = ?", (approval_id,)).fetchone()))
    finally:
        mgr.close_connection(conn)
    return approval


def _undo_approval(conn, forecast_id: str, approval_id: str, previous: Dict[str, Any]) -> None:
    try:
        conn.execute(
            "UPDATE forecast SET status = ?, locked = 0, approved_by = ?, approved_at = ?, approval_note = ? "
            "WHERE forecast_id = ?",
            (previous.get("status") or "draft", previous.get("approved_by"), previous.get("approved_at"),
             previous.get("approval_note"), forecast_id),
        )
        conn.execute("DELETE FROM scenario_approvals WHERE approval_id = ?", (approval_id,))
        conn.commit()
    except Exception:  # pragma: no cover - best effort; logged
        logger.exception("Could not undo the approval of %s", forecast_id)


def unlock_scenario(forecast_id: str, actor: Any, reason: Any) -> Dict[str, Any]:
    """
    Unlock an approved scenario: ``locked = 0``, ``status = 'draft'`` and an
    'unlock' history row with the actor and reason (required: 422 without
    one). 409 when the scenario is not locked. The approval history and its
    snapshot / workbook are kept.
    """
    reason_text = str(reason or "").strip()[:2000]
    if not reason_text:
        raise GovernanceError(422, "A reason is required to unlock an approved scenario (it is kept in the history).")
    who = _clean_text(actor, 100) or None
    mgr = _manager()
    unlock_id = f"APR-{uuid.uuid4().hex[:8].upper()}"
    with mgr.connection() as conn:
        cursor = conn.cursor()
        scenario = _scenario(cursor, forecast_id)
        if not scenario.get("locked"):
            raise GovernanceError(409, f"Scenario '{scenario['name']}' is not locked; there is nothing to unlock.")
        try:
            cursor.execute("UPDATE forecast SET locked = 0, status = 'draft' WHERE forecast_id = ?", (forecast_id,))
            cursor.execute(
                "INSERT INTO scenario_approvals (approval_id, forecast_id, action, actor, note, created_at) "
                "VALUES (?, ?, 'unlock', ?, ?, ?)",
                (unlock_id, forecast_id, who, reason_text, utc_now()),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        row = cursor.execute("SELECT * FROM scenario_approvals WHERE approval_id = ?", (unlock_id,)).fetchone()
        return _approval_record(cursor, row)


def list_approvals(forecast_id: Optional[str] = None, limit: int = 200) -> List[Dict[str, Any]]:
    """
    Approvals and unlocks of a scenario (404 for an unknown scenario), or of
    every scenario when ``forecast_id`` is None (each entry then carries
    ``scenario_name``), newest first.
    """
    with _manager().connection() as conn:
        cursor = conn.cursor()
        if forecast_id is not None:
            _scenario(cursor, forecast_id)
            cursor.execute("SELECT a.*, f.name AS scenario_name FROM scenario_approvals a "
                           "LEFT JOIN forecast f ON f.forecast_id = a.forecast_id "
                           "WHERE a.forecast_id = ? ORDER BY a.created_at DESC, a.rowid DESC LIMIT ?",
                           (forecast_id, limit))
        else:
            cursor.execute("SELECT a.*, f.name AS scenario_name FROM scenario_approvals a "
                           "LEFT JOIN forecast f ON f.forecast_id = a.forecast_id "
                           "ORDER BY a.created_at DESC, a.rowid DESC LIMIT ?", (limit,))
        rows = cursor.fetchall()
        return [_with_file_flags(_approval_record(cursor, row)) for row in rows]


def approval_workbook(forecast_id: str, approval_id: str) -> str:
    """Path of an approval's saved workbook (404 when unknown or the file is gone)."""
    with _manager().connection() as conn:
        row = conn.execute("SELECT workbook_filename FROM scenario_approvals WHERE approval_id = ? AND forecast_id = ?",
                           (approval_id, forecast_id)).fetchone()
    if not row or not row[0]:
        raise GovernanceError(404, f"Approval {approval_id} of {forecast_id} has no saved workbook")
    path = approved_workbook_path(row[0])
    if not os.path.exists(path):
        raise GovernanceError(404, f"The workbook {row[0]} is no longer in {approved_exports_dir()}")
    return path


# ---------------------------------------------------------------------------
# Change history (audit_log)
# ---------------------------------------------------------------------------

AUDIT_COLUMNS = ("created_at", "client", "actor", "method", "path", "query", "status", "forecast_id", "summary",
                 "body_excerpt", "duration_ms")

#: Body keys that name who did something (used as the actor when no X-Forecast-User header is sent).
ACTOR_KEYS = ("actor", "approved_by", "closed_by", "user", "changed_by")

_BROWSER_UA = re.compile(r"Mozilla/|AppleWebKit|Chrome/|Safari/|Firefox/|Edg/", re.I)


def client_kind(header: Optional[str], user_agent: Optional[str]) -> str:
    """
    Who sent a request: the X-Forecast-Client header ('mcp' for the MCP
    tools' in-process calls), else 'web' for a browser User-Agent, else 'api'
    (scripts, curl, tests).
    """
    value = re.sub(r"[^a-z0-9_-]", "", str(header or "").strip().lower())[:20]
    if value:
        return value
    return "web" if _BROWSER_UA.search(str(user_agent or "")) else "api"


def _shrink(value: Any, depth: int = 0) -> Any:
    """Make a request body readable in a few hundred characters: long lists become '[N items]'."""
    if isinstance(value, dict):
        if depth > 3:
            return "{...}"
        return {str(k): _shrink(v, depth + 1) for k, v in value.items()}
    if isinstance(value, list):
        if len(value) > 3 or depth > 3:
            return f"[{len(value)} items]"
        return [_shrink(v, depth + 1) for v in value]
    if isinstance(value, str) and len(value) > 120:
        return value[:117] + "..."
    return value


def parse_json_body(body: bytes) -> Any:
    try:
        return json.loads(body.decode("utf-8")) if body else None
    except (UnicodeDecodeError, ValueError):
        return None


def body_excerpt(content_type: str, body: bytes, parsed: Any = None, truncated: bool = False,
                 limit: int = 500) -> Optional[str]:
    """
    What a request sent, in at most ``limit`` characters, never file
    contents: JSON with long lists shown as '[N items]', an upload as its
    file name(s) and size, a form as its fields.
    """
    if not body:
        return None
    ctype = (content_type or "").lower()
    if "multipart/form-data" in ctype:
        names = re.findall(rb'filename="([^"]{0,200})"', body[:200000])
        fields = re.findall(rb'name="([^"]{1,60})"\r\n\r\n([^\r]{0,80})\r\n', body[:200000])
        parts = [f"upload {', '.join(n.decode('utf-8', 'replace') for n in names) or '(no file name)'} "
                 f"({len(body):,} bytes{'+' if truncated else ''})"]
        parts += [f"{k.decode('utf-8', 'replace')}={v.decode('utf-8', 'replace')}" for k, v in fields
                  if b"filename=" not in k][:10]
        return "; ".join(parts)[:limit]
    if "json" in ctype or (parsed is not None):
        if parsed is not None:
            text = json.dumps(_shrink(parsed), ensure_ascii=False, separators=(", ", ": "), default=str)
        else:
            text = f"[JSON body, {len(body):,} bytes{'+' if truncated else ''}]"
        return text if len(text) <= limit else text[:limit - 3] + "..."
    if "x-www-form-urlencoded" in ctype:
        text = body[:limit].decode("utf-8", "replace")
        return text
    return f"[{ctype or 'body'}, {len(body):,} bytes]"[:limit]


_SCENARIO_PATH = re.compile(r"/scenarios?/([^/?#]+)")
_ID_RE = re.compile(r'"forecast_id"\s*:\s*"([^"]{1,40})"')


def extract_forecast_id(path: str, query: Dict[str, List[str]], parsed_body: Any = None,
                        raw_body: bytes = b"", response: Any = None) -> Optional[str]:
    """The scenario a request is about: the path, ``forecast_id`` / ``forecast_ids`` in the query or body, else the response."""
    match = _SCENARIO_PATH.search(path or "")
    if match and match.group(1) not in ("compare", "comparison"):
        return match.group(1)[:40]
    for key in ("forecast_id", "forecast_ids"):
        values = query.get(key) or []
        for value in values:
            first = str(value).split(",")[0].strip()
            if first:
                return first[:40]
    if isinstance(parsed_body, dict):
        for key in ("forecast_id", "forecast_ids"):
            value = parsed_body.get(key)
            if isinstance(value, list):
                value = value[0] if value else None
            if value not in (None, ""):
                return str(value)[:40]
    elif raw_body and parsed_body is None:
        found = _ID_RE.search(raw_body[:65536].decode("utf-8", "replace"))
        if found:
            return found.group(1)
    if isinstance(response, dict):
        data = response.get("data")
        if isinstance(data, dict) and data.get("forecast_id") not in (None, ""):
            return str(data["forecast_id"])[:40]
    return None


def extract_actor(header: Optional[str], parsed_body: Any = None) -> Optional[str]:
    actor = _clean_text(header, 100)
    if actor:
        return actor
    if isinstance(parsed_body, dict):
        for key in ACTOR_KEYS:
            value = _clean_text(parsed_body.get(key), 100)
            if value:
                return value
    return None


#: Write-method endpoints that only ever answer a question (never change anything).
PREVIEW_PATH_SUFFIXES = ("/simulate",)
#: Endpoints whose ``dry_run`` defaults to true when the body leaves it out.
DRY_RUN_BY_DEFAULT = re.compile(r"^/loans/[^/]+/repair-schedule/?$")

_TRUE = ("1", "true", "yes", "on")


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in _TRUE if value is not None else False


def is_preview_request(path: str, query: Dict[str, List[str]], parsed_body: Any = None) -> bool:
    """
    A POST / PUT that changes nothing: ``dry_run`` or ``preview`` in the
    query or the JSON body (also ``options.dry_run`` / ``options.dryRun``),
    a /simulate endpoint, or a loan schedule repair without ``dry_run:
    false``. The change history leaves these out.
    """
    path = path or ""
    if path.rstrip("/").endswith(PREVIEW_PATH_SUFFIXES):
        return True
    for key in ("dry_run", "preview"):
        if any(_truthy(v) for v in query.get(key) or []):
            return True
    body = parsed_body if isinstance(parsed_body, dict) else {}
    options = body.get("options") if isinstance(body.get("options"), dict) else {}
    for source, keys in ((body, ("dry_run", "dryRun", "preview")), (options, ("dry_run", "dryRun"))):
        if any(_truthy(source.get(k)) for k in keys):
            return True
    if DRY_RUN_BY_DEFAULT.match(path) and "dry_run" not in body and not query.get("dry_run"):
        return True
    return False


def summarize(method: str, path: str, status: int, response: Any) -> str:
    """One line for the history: the API's own message (or error detail), else 'METHOD path'."""
    text = None
    if isinstance(response, dict):
        if status >= 400:
            detail = response.get("detail")
            if isinstance(detail, list):
                detail = "; ".join(str(d.get("msg", d)) if isinstance(d, dict) else str(d) for d in detail[:3])
            elif isinstance(detail, dict):
                detail = detail.get("message") or detail.get("detail") or json.dumps(detail)[:200]
            text = detail or response.get("message") or response.get("error")
            if text:
                text = f"Refused ({status}): {text}" if status < 500 else f"Failed ({status}): {text}"
        else:
            text = response.get("message")
            if not text and isinstance(response.get("data"), dict):
                text = response["data"].get("message")
    if not text:
        text = f"{method} {path}" + (f" ({status})" if status >= 400 else "")
    text = " ".join(str(text).split())
    return text if len(text) <= 300 else text[:297] + "..."


def record_audit(entry: Dict[str, Any]) -> bool:
    """Insert one audit_log row. Never raises (returns False when it could not be written)."""
    try:
        values = {k: entry.get(k) for k in AUDIT_COLUMNS}
        values["created_at"] = values.get("created_at") or utc_now()
        with _manager().connection() as conn:
            conn.execute(
                f"INSERT INTO audit_log ({', '.join(AUDIT_COLUMNS)}) VALUES ({', '.join('?' for _ in AUDIT_COLUMNS)})",
                [values[k] for k in AUDIT_COLUMNS],
            )
            conn.commit()
        return True
    except Exception as exc:
        logger.warning("Could not write the change history entry for %s %s: %s",
                       entry.get("method"), entry.get("path"), exc)
        return False


def history_rows() -> Optional[List[Tuple[Any, ...]]]:
    """Every audit_log row (without log_id), to carry the history across a snapshot restore. None on error."""
    try:
        with _manager().connection() as conn:
            return conn.execute(f"SELECT {', '.join(AUDIT_COLUMNS)} FROM audit_log ORDER BY log_id").fetchall()
    except Exception as exc:
        logger.warning("Could not read the change history before a restore: %s", exc)
        return None


def restore_history(rows: Optional[List[Tuple[Any, ...]]]) -> int:
    """
    Put back the history entries a snapshot restore replaced (the restored
    file holds the history as it was when the snapshot was taken). Entries
    already in the restored history are not duplicated. Returns the number
    added; never raises.
    """
    if not rows:
        return 0
    key_index = [AUDIT_COLUMNS.index(k) for k in ("created_at", "method", "path", "status", "summary", "duration_ms")]
    try:
        with _manager().connection() as conn:
            present = {tuple(r) for r in conn.execute(
                "SELECT created_at, method, path, status, summary, duration_ms FROM audit_log").fetchall()}
            missing = [r for r in rows if tuple(r[i] for i in key_index) not in present]
            conn.executemany(
                f"INSERT INTO audit_log ({', '.join(AUDIT_COLUMNS)}) VALUES ({', '.join('?' for _ in AUDIT_COLUMNS)})",
                missing)
            conn.commit()
            return len(missing)
    except Exception as exc:
        logger.warning("Could not carry the change history across the restore: %s", exc)
        return 0


def _normalise_since(value: Optional[str]) -> Optional[str]:
    """'2026-10-12' / '2026-10-12 08:00' / '2026-10-12T08:00:00Z' -> comparable UTC text."""
    if value is None or not str(value).strip():
        return None
    text = str(value).strip().replace(" ", "T")
    if not re.match(r"^\d{4}-\d{2}-\d{2}(T\d{2}(:\d{2}(:\d{2})?)?)?Z?$", text):
        raise GovernanceError(422, f"since / until must be a date (YYYY-MM-DD) or a UTC time (YYYY-MM-DDTHH:MM:SS), "
                                   f"got '{value}'")
    return text.rstrip("Z")


def query_audit_log(limit: int = 100, offset: int = 0, forecast_id: Optional[str] = None,
                    client: Optional[str] = None, path_contains: Optional[str] = None,
                    since: Optional[str] = None, until: Optional[str] = None,
                    method: Optional[str] = None, actor: Optional[str] = None,
                    status: Optional[str] = None) -> Dict[str, Any]:
    """
    Change history, newest first, filtered. ``status``: 'ok' (< 400) or
    'refused' (>= 400). Returns {entries, total_count, returned, offset,
    limit, has_more, clients}.
    """
    limit = max(1, min(int(limit or 100), 1000))
    offset = max(0, int(offset or 0))
    where, params = [], []
    if forecast_id:
        where.append("forecast_id = ?")
        params.append(str(forecast_id).strip())
    if client:
        where.append("client = ?")
        params.append(str(client).strip().lower())
    if path_contains:
        where.append("(path LIKE ? OR summary LIKE ?)")
        params += [f"%{path_contains.strip()}%"] * 2
    if method:
        where.append("method = ?")
        params.append(str(method).strip().upper())
    if actor:
        where.append("actor LIKE ?")
        params.append(f"%{actor.strip()}%")
    if status:
        flag = str(status).strip().lower()
        if flag in ("ok", "success", "succeeded"):
            where.append("status < 400")
        elif flag in ("refused", "error", "failed"):
            where.append("status >= 400")
        else:
            raise GovernanceError(422, "status must be 'ok' or 'refused'")
    since_text, until_text = _normalise_since(since), _normalise_since(until)
    if since_text:
        where.append("created_at >= ?")
        params.append(since_text)
    if until_text:
        where.append("created_at <= ?")
        # A bare date includes the whole day.
        params.append(until_text + ("T23:59:59Z" if len(until_text) == 10 else "Z"))
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    with _manager().connection() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM audit_log {clause}", params).fetchone()[0]
        cursor = conn.execute(
            f"SELECT log_id, {', '.join(AUDIT_COLUMNS)} FROM audit_log {clause} "
            f"ORDER BY created_at DESC, log_id DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        )
        columns = [d[0] for d in cursor.description]
        entries = [dict(zip(columns, row)) for row in cursor.fetchall()]
        clients = [r[0] for r in conn.execute("SELECT DISTINCT client FROM audit_log WHERE client IS NOT NULL "
                                              "ORDER BY client").fetchall()]
    return {
        "entries": entries,
        "total_count": total,
        "returned": len(entries),
        "offset": offset,
        "limit": limit,
        "has_more": offset + len(entries) < total,
        "clients": clients,
    }


# ---------------------------------------------------------------------------
# Legacy data checks (read-only)
# ---------------------------------------------------------------------------

SEVERITY_ORDER = {"error": 0, "warning": 1, "info": 2}


def _issue(code: str, severity: str, title: str, detail: str, action: str, count: int,
           examples: Iterable[Any] = (), link: Optional[str] = None) -> Dict[str, Any]:
    examples = list(examples)
    return {"code": code, "severity": severity, "title": title, "detail": detail, "action": action,
            "count": count, "examples": examples[:10], "link": link}


def _table_columns(cursor, table: str) -> set:
    try:
        return {r[1] for r in cursor.execute(f'PRAGMA table_info("{table}")').fetchall()}
    except Exception:
        return set()


def legacy_checks(cursor) -> List[Dict[str, Any]]:
    """
    Read-only checks for data older versions of the app left behind (or a
    file import that slipped through). Each issue says how serious it is and
    what to do; nothing is changed. Loan schedules are checked by the route
    (``GET /loans/schedule-audit``).
    """
    issues: List[Dict[str, Any]] = []

    # 1. Scenarios whose opening balances have no date.
    cursor.execute(
        """SELECT f.forecast_id, f.name, a.forecast_id IS NOT NULL AS has_row, a.opening_period,
                  (SELECT COUNT(*) FROM sales s WHERE s.forecast_id = f.forecast_id) AS sales_rows
           FROM forecast f LEFT JOIN financial_assumptions a ON a.forecast_id = f.forecast_id
           ORDER BY f.forecast_id"""
    )
    no_period, no_assumptions = [], []
    for fid, name, has_row, opening_period, sales_rows in cursor.fetchall():
        if not sales_rows:
            continue
        label = f"{name} ({fid})"
        if not has_row:
            no_assumptions.append(label)
        elif not str(opening_period or "").strip():
            no_period.append(label)
    if no_period:
        issues.append(_issue(
            "assumptions_without_opening_period", "warning",
            "Opening balances have no date",
            "These scenarios have saved opening balances but no opening period, so the balances are applied at the "
            "start of whatever window a report shows: a March report and a full-year report start March from "
            "different balances.",
            "Open Reporting > Assumptions for each scenario and set the opening period (the month the balances are "
            "stated at the end of).",
            len(no_period), no_period, "/reporting"))
    if no_assumptions:
        issues.append(_issue(
            "scenarios_without_assumptions", "info",
            "Scenarios using default assumptions",
            "These scenarios have sales but no saved financial assumptions: reports use zero opening balances, "
            "30/60/30 day working capital and a 21% tax rate.",
            "Save assumptions (with an opening period) under Reporting > Assumptions, or ignore this for a "
            "what-if scenario.",
            len(no_assumptions), no_assumptions, "/reporting"))

    # 2. Sales rows the monthly model cannot place, or stored as a date.
    cursor.execute(
        f"""SELECT forecast_id, period, COUNT(*) FROM sales
            WHERE period IS NULL OR substr(period, 1, 7) NOT GLOB '{MONTH_GLOB}'
            GROUP BY forecast_id, period ORDER BY COUNT(*) DESC"""
    )
    rows = cursor.fetchall()
    if rows:
        issues.append(_issue(
            "sales_non_monthly_periods", "error",
            "Sales rows that are not in a month",
            "These sales rows have a period that is not a YYYY-MM month (a quarter, a week, a blank or text), so "
            "they are left out of every statement and report.",
            "Re-import the scenario's sales forecast by month (the importer rejects quarters and weeks), then delete "
            "the old rows on the Sales Forecast screen.",
            sum(r[2] for r in rows), [f"{fid}: '{p}' x {n}" for fid, p, n in rows]))
    cursor.execute(
        f"""SELECT forecast_id, period, COUNT(*) FROM sales
            WHERE period IS NOT NULL AND length(period) > 7 AND substr(period, 1, 7) GLOB '{MONTH_GLOB}'
            GROUP BY forecast_id, period ORDER BY COUNT(*) DESC"""
    )
    rows = cursor.fetchall()
    if rows:
        issues.append(_issue(
            "sales_dated_periods", "warning",
            "Sales rows stored with a date instead of a month",
            "These rows are counted in their month, but a re-import of that month will not update them (it matches "
            "'2027-01', not '2027-01-15'), so the month can end up counted twice.",
            "Branch or re-import the scenario (both store plain months), or delete and re-enter these rows.",
            sum(r[2] for r in rows), [f"{fid}: '{p}' x {n}" for fid, p, n in rows]))

    # 3. BOM versions without lines.
    from utils.cost_rollup import resolve_bom_version

    empty_boms = []
    cursor.execute("SELECT bom_id, bom_name, version FROM bom_definitions ORDER BY bom_id")
    for bom_id, bom_name, version in cursor.fetchall():
        found, _version, _available = resolve_bom_version(cursor, bom_id, version)
        if not found:
            empty_boms.append(f"{bom_id} v{version or '?'}" + (f" ({bom_name})" if bom_name else ""))
    if empty_boms:
        issues.append(_issue(
            "bom_versions_without_lines", "warning",
            "BOM versions with no lines",
            "These BOM headers have no component lines for their version, so a product pointing at them has no "
            "material cost.",
            "Import the BOM lines (Get Started > Import Data > BOMs) or point the products at a version that has lines.",
            len(empty_boms), empty_boms, "/bom"))

    # 4. Products that are sold but cannot be costed.
    cursor.execute(
        """SELECT u.unit_id, u.unit_name, u.bom_id, u.bom_version, u.router_id, COUNT(s.sale_id)
           FROM units u JOIN sales s ON s.unit_id = u.unit_id
           GROUP BY u.unit_id ORDER BY u.unit_id"""
    )
    uncosted = []
    for unit_id, unit_name, bom_id, bom_version, router_id, _n in cursor.fetchall():
        missing = []
        if not str(bom_id or "").strip():
            missing.append("no BOM")
        elif not resolve_bom_version(cursor, bom_id, bom_version)[0]:
            missing.append(f"BOM {bom_id} has no lines for version {bom_version or '?'}")
        if not str(router_id or "").strip():
            missing.append("no routing")
        else:
            ops = cursor.execute("SELECT COUNT(*) FROM router_operations WHERE router_id = ?", (router_id,)).fetchone()[0]
            if not ops:
                missing.append(f"routing {router_id} has no operations")
        if missing:
            uncosted.append(f"{unit_id}" + (f" ({unit_name})" if unit_name else "") + ": " + ", ".join(missing))
    if uncosted:
        issues.append(_issue(
            "sold_products_without_cost", "warning",
            "Products sold without a BOM or routing",
            "These products have sales but no BOM and / or routing, so their material, labor and machine cost is "
            "$0 and COGS is understated.",
            "Link a BOM and routing on Product Setup, or import them (Get Started > Import Data).",
            len(uncosted), uncosted, "/products"))

    # 5. Employees without a labor class (direct / indirect / admin).
    if "labor_class" in _table_columns(cursor, "payroll"):
        cursor.execute(
            "SELECT employee_id, employee_name, forecast_id FROM payroll "
            "WHERE labor_class IS NULL OR trim(labor_class) = '' ORDER BY employee_name"
        )
        rows = cursor.fetchall()
        if rows:
            issues.append(_issue(
                "employees_without_labor_class", "info",
                "Employees without a labor class",
                "Unclassified employees are treated as admin payroll (an operating expense). Production workers "
                "left unclassified are counted twice: once in direct labor from the routings and again in payroll.",
                "On the Payroll screen, set each employee's labor class: direct (production), indirect (factory "
                "support) or admin.",
                len(rows), [f"{name or eid}" + (f" ({fid})" if fid else " (company-wide)") for eid, name, fid in rows],
                "/payroll"))

    issues.sort(key=lambda i: (SEVERITY_ORDER.get(i["severity"], 9), i["code"]))
    return issues


def loan_schedule_issue(entries: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    One issue for the loans ``api.loan_routes.schedule_audit`` flags (unpaid
    installments off their calendar dates, missing / out-of-order dates,
    broken balances, short or missing schedules), or None when every
    schedule is fine. Each entry carries loan_id, loan_name, summary,
    wrong_month / out_of_order / missing_dates counts, issues and
    statement_impact (payments land in the wrong month or are missing on the
    statements, or the loan is not fully repaid there; never for an
    inactive loan). The detail names each of those impacts with its count.
    """
    flagged = [e for e in entries or [] if isinstance(e, dict)]
    if not flagged:
        return None
    affecting = [e for e in flagged if e.get("statement_impact")]
    wrong_month = sum(1 for e in affecting if e.get("wrong_month") or e.get("out_of_order"))
    missing = sum(1 for e in affecting
                  if e.get("missing_dates")
                  or set(e.get("issues") or ()) & {"no_schedule", "incomplete", "numbering_gap", "balance_break"})
    unchecked = sum(1 for e in affecting if "bad_start_date" in (e.get("issues") or ()))
    impacts = []
    if wrong_month:
        impacts.append(f"{wrong_month} put interest and principal in the wrong month on the statements")
    if missing:
        impacts.append(f"{missing} leave payments missing from the statements or the loan not fully repaid there")
    if unchecked:
        impacts.append(f"{unchecked} cannot be checked (the start date is not a date)")
    examples = []
    for entry in flagged:
        name = entry.get("loan_name") or entry.get("loan_id")
        label = f"{name} ({entry['loan_id']})" if entry.get("loan_id") and name != entry.get("loan_id") else str(name)
        examples.append(f"{label}: {entry['summary']}" if entry.get("summary") else label)
    return _issue(
        "loan_schedules_drifted", "warning" if affecting else "info",
        "Loan schedules to review",
        "These loans' saved payment schedules are not on calendar-month dates (older versions stepped 30.44 days "
        "per payment) or are incomplete"
        + (f"; {'; '.join(impacts)}." if impacts else "."),
        "On Loan Schedules, open 'Review & repair', check each loan's preview and repair it. Paid installments are "
        "kept exactly as recorded.",
        len(flagged), examples, "/loans")
