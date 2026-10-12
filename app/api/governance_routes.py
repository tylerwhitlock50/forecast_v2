"""
Governance routes and middleware: the change history (``GET /audit/log``),
the read-only legacy data checks (``GET /audit/legacy-checks``) and the HTTP
side of scenario locking.

``install_governance(app)`` (called by main.py) adds:

* ``GovernanceMiddleware`` - records every non-GET request in ``audit_log``
  (client, actor, method, path, query, status, scenario, summary, a short
  body excerpt that never contains file contents, duration) and turns any
  error response that mentions ``SCENARIO_LOCKED`` into HTTP 409 with a
  plain explanation. The MCP transport (``/mcp``) itself is not recorded;
  the REST calls the MCP tools make in-process are, with client 'mcp'
  (header ``X-Forecast-Client: mcp``). Logging never breaks a request.
  Restoring a snapshot (load / revert) keeps the history recorded since
  the snapshot was taken.
* an exception handler for ``sqlite3.IntegrityError`` raised by the
  scenario-lock triggers (409).

Approve / unlock / approval history live with the other scenario endpoints
in ``api.forecast_routes``.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import time
from typing import Any, Dict, Optional
from urllib.parse import parse_qs

import anyio
from fastapi import APIRouter, FastAPI, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from db.models import ForecastResponse
from services.governance import (
    LOCK_TOKEN,
    GovernanceError,
    body_excerpt,
    client_kind,
    extract_actor,
    extract_forecast_id,
    history_rows,
    is_lock_error,
    is_preview_request,
    legacy_checks,
    loan_schedule_issue,
    locked_message,
    locked_scenario_name,
    parse_json_body,
    query_audit_log,
    record_audit,
    restore_history,
    summarize,
    utc_now,
    SEVERITY_ORDER,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/audit", tags=["governance"])

#: Request bodies are kept in memory up to this size for the excerpt / scenario id.
MAX_REQUEST_CAPTURE = 8 * 1024 * 1024
#: JSON responses of writes (and error responses) are held up to this size to read their message.
MAX_RESPONSE_CAPTURE = 4 * 1024 * 1024
#: Methods that change nothing and are never recorded.
READ_METHODS = ("GET", "HEAD", "OPTIONS")
#: Requests that restore a snapshot INTO the live database: the history recorded since the snapshot is put back.
RESTORE_PATHS = ("/database/load", "/database/revert-to-last-save")


def _is_mcp_transport(path: str) -> bool:
    return path == "/mcp" or path.startswith("/mcp/")


def lock_response_body(forecast_id: Optional[str]) -> Dict[str, Any]:
    """The 409 body for a write refused by the scenario-lock triggers."""
    fid, name = locked_scenario_name(forecast_id)
    body: Dict[str, Any] = {"detail": locked_message(name), "code": LOCK_TOKEN}
    if fid:
        body["forecast_id"] = fid
    return body


class GovernanceMiddleware:
    """Pure ASGI middleware (no BaseHTTPMiddleware: streaming and the MCP transport pass through untouched)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or _is_mcp_transport(scope.get("path") or ""):
            await self.app(scope, receive, send)
            return

        method = str(scope.get("method") or "GET").upper()
        path = scope.get("path") or ""
        record = method not in READ_METHODS
        started = time.perf_counter()
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers") or []}
        state: Dict[str, Any] = {"body": bytearray(), "truncated": False, "status": None, "started": False,
                                 "response": None}

        async def receive_wrapper():
            message = await receive()
            if record and message.get("type") == "http.request":
                chunk = message.get("body") or b""
                room = MAX_REQUEST_CAPTURE - len(state["body"])
                if room > 0:
                    state["body"].extend(chunk[:room])
                if len(chunk) > max(room, 0):
                    state["truncated"] = True
            return message

        held: Dict[str, Any] = {"start": None, "chunks": [], "size": 0}

        def request_forecast_id() -> Optional[str]:
            parsed = parse_json_body(bytes(state["body"])) if state["body"] and not state["truncated"] else None
            return extract_forecast_id(path, parse_qs(scope.get("query_string", b"").decode("latin-1")),
                                       parsed, bytes(state["body"][:65536]))

        async def flush_held(final_body: bytes, more_body: bool) -> None:
            start = held["start"]
            held["start"] = None
            state["started"] = True
            await send(start)
            await send({"type": "http.response.body", "body": final_body, "more_body": more_body})

        async def send_wrapper(message):
            kind = message.get("type")
            if kind == "http.response.start":
                state["status"] = int(message.get("status") or 500)
                ctype = ""
                for key, value in message.get("headers") or []:
                    if key.decode("latin-1").lower() == "content-type":
                        ctype = value.decode("latin-1").lower()
                hold = "json" in ctype and (state["status"] >= 400 or record)
                if hold:
                    held["start"] = message
                    return
                state["started"] = True
                await send(message)
                return
            if kind == "http.response.body" and held["start"] is not None:
                held["chunks"].append(message.get("body") or b"")
                held["size"] += len(message.get("body") or b"")
                if message.get("more_body"):
                    if held["size"] > MAX_RESPONSE_CAPTURE:   # too big to inspect: stream the rest
                        body = b"".join(held["chunks"])
                        held["chunks"] = []
                        await flush_held(body, True)
                    return
                body = b"".join(held["chunks"])
                held["chunks"] = []
                start = held["start"]
                if state["status"] >= 400 and LOCK_TOKEN.encode() in body:
                    try:
                        new_body = json.dumps(lock_response_body(request_forecast_id())).encode()
                        new_headers = [(k, v) for k, v in start.get("headers") or []
                                       if k.decode("latin-1").lower() != "content-length"]
                        new_headers.append((b"content-length", str(len(new_body)).encode()))
                        held["start"] = {**start, "status": 409, "headers": new_headers}
                        state["status"] = 409
                        body = new_body
                    except Exception:  # pragma: no cover - keep the original error
                        logger.exception("Could not rewrite a scenario-lock error")
                if record:
                    state["response"] = parse_json_body(body)
                await flush_held(body, False)
                return
            await send(message)

        saved_history = None
        if record and path in RESTORE_PATHS:
            saved_history = await anyio.to_thread.run_sync(history_rows)

        error: Optional[BaseException] = None
        try:
            await self.app(scope, receive_wrapper, send_wrapper)
        except Exception as exc:
            if is_lock_error(exc) and not state["started"]:
                # A trigger error nothing else caught: answer 409 instead of a bare 500.
                body = json.dumps(lock_response_body(request_forecast_id())).encode()
                state["status"] = 409
                state["response"] = json.loads(body)
                await send({"type": "http.response.start", "status": 409,
                            "headers": [(b"content-type", b"application/json"),
                                        (b"content-length", str(len(body)).encode())]})
                await send({"type": "http.response.body", "body": body, "more_body": False})
            else:
                error = exc
                state["status"] = state["status"] if state["started"] else 500
        if saved_history and int(state["status"] or 500) < 400:
            await anyio.to_thread.run_sync(restore_history, saved_history)
        if record and self._is_preview(scope, headers, path, state):
            record = False
        if record:
            try:
                entry = self._entry(scope, headers, method, path, state, started)
                await anyio.to_thread.run_sync(record_audit, entry)
            except Exception:  # never break a request over the history
                logger.exception("Could not record %s %s in the change history", method, path)
        if error is not None:
            raise error

    @staticmethod
    def _is_preview(scope, headers: Dict[str, str], path: str, state: Dict[str, Any]) -> bool:
        """A dry run / preview / simulation: it changed nothing, so it is not history."""
        raw = bytes(state["body"])
        ctype = headers.get("content-type", "")
        parsed = parse_json_body(raw) if raw and not state["truncated"] and "multipart" not in ctype else None
        query = parse_qs(scope.get("query_string", b"").decode("latin-1"))
        return is_preview_request(path, query, parsed)

    @staticmethod
    def _entry(scope, headers: Dict[str, str], method: str, path: str, state: Dict[str, Any],
               started: float) -> Dict[str, Any]:
        raw = bytes(state["body"])
        ctype = headers.get("content-type", "")
        parsed = parse_json_body(raw) if raw and not state["truncated"] and "multipart" not in ctype else None
        query_string = scope.get("query_string", b"").decode("latin-1")
        status = int(state["status"] or 500)
        return {
            "created_at": utc_now(),
            "client": client_kind(headers.get("x-forecast-client"), headers.get("user-agent")),
            "actor": extract_actor(headers.get("x-forecast-user"), parsed),
            "method": method,
            "path": path,
            "query": query_string[:500] or None,
            "status": status,
            "forecast_id": extract_forecast_id(path, parse_qs(query_string), parsed,
                                               raw[:65536] if "multipart" not in ctype else b"",
                                               state.get("response")),
            "summary": summarize(method, path, status, state.get("response")),
            "body_excerpt": body_excerpt(ctype, raw, parsed, state["truncated"]),
            "duration_ms": int((time.perf_counter() - started) * 1000),
        }


async def _integrity_error_handler(request: Request, exc: sqlite3.IntegrityError):
    """A scenario-lock trigger error that reached the framework: 409 (the middleware words it)."""
    if is_lock_error(exc):
        return JSONResponse(status_code=409, content={"detail": LOCK_TOKEN, "code": LOCK_TOKEN})
    raise exc


def install_governance(app: FastAPI) -> None:
    """Add the change-history / lock middleware and the lock exception handler to ``app``."""
    app.add_exception_handler(sqlite3.IntegrityError, _integrity_error_handler)
    app.add_middleware(GovernanceMiddleware)


def _http(exc: GovernanceError) -> HTTPException:
    return HTTPException(status_code=exc.status, detail=exc.message)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/log", response_model=ForecastResponse)
async def get_audit_log(
    limit: int = Query(100, ge=1, le=1000, description="Entries per page (newest first)"),
    offset: int = Query(0, ge=0),
    forecast_id: Optional[str] = Query(None, description="Only changes to this scenario"),
    client: Optional[str] = Query(None, description="web | mcp | api"),
    path_contains: Optional[str] = Query(None, description="Text in the path or summary, e.g. 'payroll'"),
    since: Optional[str] = Query(None, description="From this UTC date / time (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)"),
    until: Optional[str] = Query(None, description="Up to this UTC date / time (a bare date includes the whole day)"),
    method: Optional[str] = Query(None, description="POST | PUT | PATCH | DELETE"),
    actor: Optional[str] = Query(None, description="Text in the actor (X-Forecast-User header or approver)"),
    status: Optional[str] = Query(None, description="ok (succeeded) | refused (HTTP 4xx / 5xx)"),
):
    """
    The change history: one entry per write request through the API (web
    UI, MCP tools, scripts), newest first. Each entry has ``created_at``
    (UTC), ``client`` (web / mcp / api), ``actor``, ``method``, ``path``,
    ``query``, ``status`` (HTTP), ``forecast_id``, ``summary`` (the API's
    own message), ``body_excerpt`` (at most 500 characters, long lists shown
    as '[N items]', uploads as file name and size) and ``duration_ms``.
    Start clean keeps the history.
    """
    try:
        data = await run_in_threadpool(
            query_audit_log, limit, offset, forecast_id, client, path_contains, since, until, method, actor, status)
    except GovernanceError as exc:
        raise _http(exc)
    return ForecastResponse(status="success", data=data,
                            message=f"{data['returned']} of {data['total_count']} change(s)")


def _loan_schedule_check(cursor) -> Dict[str, Any]:
    """Loans with schedules to review (api.loan_routes.schedule_audit), or why the check was skipped."""
    try:
        from api.loan_routes import schedule_audit
    except ImportError:
        return {"skipped": "The loan schedule audit is not available in this version."}
    try:
        return {"issue": loan_schedule_issue(schedule_audit(cursor))}
    except Exception as exc:  # a broken check must not hide the others
        logger.exception("Loan schedule audit failed")
        return {"skipped": f"The loan schedule audit failed: {exc}"}


def _run_legacy_checks() -> Dict[str, Any]:
    import db.database as dbmod

    with dbmod.db_manager.connection() as conn:
        cursor = conn.cursor()
        return {"issues": legacy_checks(cursor), "loans": _loan_schedule_check(cursor)}


@router.get("/legacy-checks", response_model=ForecastResponse)
async def get_legacy_checks():
    """
    Read-only checks for data an older version (or an old import) left
    behind, each with a severity (error / warning / info), what it means and
    what to do: scenarios whose opening balances have no opening period,
    loans whose stored payment dates drifted (``GET /loans/schedule-audit``),
    sales rows that are not in a YYYY-MM month or are stored as a date, BOM
    versions with no lines, sold products without a BOM or routing, and
    employees without a labor class. Nothing is changed.
    """
    try:
        result = await run_in_threadpool(_run_legacy_checks)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error running the legacy data checks: {exc}")
    issues, loans = result["issues"], result["loans"]
    skipped = []
    if loans.get("issue"):
        issues.append(loans["issue"])
    if loans.get("skipped"):
        skipped.append({"code": "loan_schedules_drifted", "reason": loans["skipped"]})
    issues.sort(key=lambda i: (SEVERITY_ORDER.get(i["severity"], 9), i["code"]))
    counts = {level: sum(1 for i in issues if i["severity"] == level) for level in ("error", "warning", "info")}
    message = ("No legacy data issues found" if not issues else
               f"{len(issues)} issue(s): {counts['error']} error(s), {counts['warning']} warning(s), "
               f"{counts['info']} note(s)")
    return ForecastResponse(status="success", data={
        "issues": issues,
        "counts": counts,
        "skipped": skipped,
        "checked_at": utc_now(),
    }, message=message)
