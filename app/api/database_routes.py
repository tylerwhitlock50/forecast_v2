"""
Database management and utility API routes
"""

import os
import tempfile
import threading
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.background import BackgroundTask

# Import database functions and models
from db import (
    ForecastResponse,
    get_execution_logs,
    replay_execution_logs,
    switch_database,
    get_current_database_path
)
from db.database import (
    AUTOSAVE_PREFIX,
    SNAPSHOT_KIND_LABELS,
    SYSTEM_BACKUP_PREFIXES,
    database_contents,
    is_approval_snapshot,
    is_sqlite_file,
    snapshot_contents,
    snapshot_detail_kind,
    snapshot_kind,
    timestamp_slug,
)

# Import utilities
from utils.data_loader import load_csv_to_table
from utils.data_quality import get_data_quality_issues

router = APIRouter(prefix="/database", tags=["Database Management"])

# =============================================================================
# DATA LOADING AND QUALITY ENDPOINTS
# =============================================================================

@router.post("/load_table", response_model=ForecastResponse)
async def load_table_endpoint(
    table_name: str = Query(..., description="Destination table (must already exist)"),
    mode: str = Query("append", description="append (insert; any bad row rejects the file), "
                                            "upsert (insert or update by key) or "
                                            "replace (delete the table's rows, then insert the file)"),
    csv_file: UploadFile = File(...),
):
    """
    Load a CSV file into an existing table. The table is never dropped or
    recreated. Errors: 400 unknown table / mode / columns, 409 the load would
    orphan rows of another table or touch an approved scenario (the body's
    ``forecast_id`` names it), 422 row errors (``row N: ...`` for every bad
    row); nothing is written on error. ``data.forecast_id`` is the scenario
    every loaded row belongs to (null when they differ or the table has
    none). See utils.data_loader for details.
    """
    try:
        csv_bytes = await csv_file.read()
        result = load_csv_to_table(table_name, csv_bytes, if_exists=mode)
        if result["status"] == "error":
            if result.get("forecast_id"):
                # A refusal about a stored scenario names it (the change history files the load under it).
                return JSONResponse(status_code=result.get("code", 500),
                                    content={"detail": result["error"], "forecast_id": result["forecast_id"]})
            raise HTTPException(status_code=result.get("code", 500), detail=result["error"])
        if table_name == "forecast":
            # An uploaded scenario list may lack is_base; keep exactly one base.
            import db.database as dbmod
            dbmod.db_manager.ensure_base_scenario()
        data = {k: v for k, v in result.items() if k != "status"}
        verb = {"replace": "Replaced", "upsert": "Upserted"}.get(result["mode"], "Loaded")
        return ForecastResponse(
            status="success",
            data=data,
            message=f"{verb} {result['rows_loaded']} rows into {table_name}"
                    + (f" ({result['deleted']} previous rows deleted)" if result["mode"] == "replace" else "")
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/quality", response_model=ForecastResponse)
async def data_quality_endpoint():
    """
    Master-data checks behind COGS (products without a usable BOM / routing,
    BOM lines with missing or inconsistent costs, operations on missing
    machines / labor rates, ...) with row details and ``summary`` counts.
    See utils.data_quality.get_data_quality_issues for every list.
    """
    result = get_data_quality_issues()
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["error"])
    return ForecastResponse(status="success", data=result["data"], message="Data quality check complete")

# =============================================================================
# EXECUTION LOG ENDPOINTS
# =============================================================================

@router.get("/logs/execution", response_model=ForecastResponse)
async def get_execution_logs_endpoint(
    limit: Optional[int] = Query(None, description="Limit number of logs"),
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    session_id: Optional[str] = Query(None, description="Filter by session ID"),
    status: Optional[str] = Query(None, description="Filter by status (success/error)")
):
    """
    Get execution logs with optional filtering
    """
    result = get_execution_logs(limit=limit, user_id=user_id, session_id=session_id, status=status)
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["error"])
    
    return ForecastResponse(
        status="success",
        data={
            "logs": result["data"],
            "columns": result.get("columns"),
            "summary": result.get("summary")
        },
        message=f"Retrieved {len(result['data'])} execution logs"
    )

@router.post("/rollback/replay", response_model=ForecastResponse)
async def replay_execution_logs_endpoint(
    target_date: Optional[str] = Query(None, description="Replay up to this date (YYYY-MM-DD HH:MM:SS)"),
    max_log_id: Optional[int] = Query(None, description="Replay up to this log ID"),
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    session_id: Optional[str] = Query(None, description="Filter by session ID")
):
    """
    Replay SQL statements from execution log up to a specific point in time,
    in one transaction. A replay re-applies plain data changes only: a
    statement that would write the change history, approvals, actuals or
    month-end close, change a scenario's approval fields or rows of an
    approved scenario, change the schema (tables, triggers ...) or run
    PRAGMA / ATTACH / transaction control refuses the whole replay with 409
    and nothing is changed (see DatabaseManager.replay_execution_logs).
    """
    result = replay_execution_logs(
        target_date=target_date,
        max_log_id=max_log_id,
        user_id=user_id,
        session_id=session_id
    )
    if result["status"] == "refused":
        raise HTTPException(status_code=409, detail=result["error"])
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["error"])
    
    return ForecastResponse(
        status="success",
        data=result,
        message=result["message"]
    )

@router.post("/rollback/reset", response_model=ForecastResponse)
async def reset_database_endpoint():
    """
    Reset to the seed CSVs: snapshot the live database
    (``reset_backup_<timestamp>.db``), empty EVERY table in one FK-safe
    transaction (scenarios, assumptions, capex, actuals, price list,
    deduction rules, allocations, loan schedules ...), re-apply the schema and
    reload the CSVs in the data folder, if any. ``data`` reports the rows
    deleted per table and the rows reloaded.
    """
    result = _manager().reset_to_initial_state()
    if result["status"] == "error":
        raise HTTPException(status_code=500, detail=result["error"])

    return ForecastResponse(
        status="success",
        data={k: v for k, v in result.items() if k not in ("status", "message")},
        message=result["message"]
    )

# =============================================================================
# SNAPSHOTS: SAVE / LIST / LOAD / REVERT / EXPORT
#
# Every copy goes through SQLite's online backup API (DatabaseManager.backup_to
# / restore_from), never a file copy: the live database runs in WAL mode, so a
# file copy can miss committed writes, and copying over the live file lets old
# WAL frames replay onto the restored data. A load restores INTO the live
# database inside the app and then migrates the schema.
# =============================================================================

def _manager():
    """The live DatabaseManager (looked up per call so tests can swap it)."""
    import db.database as dbmod
    return dbmod.db_manager


def _safe_name(raw: Any) -> str:
    """Letters, digits, '-', '_' and spaces only (no paths)."""
    return "".join(c for c in str(raw or "") if c.isalnum() or c in ('-', '_', ' ')).strip()


#: File-name prefixes of the copies the app makes on its own; a user's save may not start with one.
RESERVED_SNAPSHOT_PREFIXES = (AUTOSAVE_PREFIX,) + SYSTEM_BACKUP_PREFIXES


def _reserved_name_problem(save_name: str) -> Optional[str]:
    """Why a user's save name is reserved for a copy the app makes itself, or None."""
    filename = f"{save_name}.db"
    lowered = filename.lower()
    prefix = next((p for p in RESERVED_SNAPSHOT_PREFIXES if lowered.startswith(p)), None)
    if prefix:
        return (f"Names starting with '{prefix}' are reserved for the copies the app makes on its own "
                f"(autosaves and automatic backups). Choose another name, e.g. 'my {save_name}'.")
    if is_approval_snapshot(filename) or is_approval_snapshot(lowered):
        return ("Names of the form approved_<scenario>_<YYYYMMDD_HHMMSS> are reserved for the copy taken when a "
                "scenario is approved. Choose another name, e.g. 'approved budget'.")
    return None


def _snapshot_path(filename: str) -> str:
    """Path of a saved snapshot by file name (with or without .db); 400 on anything path-like."""
    name = str(filename or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Filename is required")
    if not name.endswith('.db'):
        name += '.db'
    if os.path.basename(name) != name or name.startswith('.') or '..' in name:
        raise HTTPException(status_code=400, detail=f"Invalid snapshot filename: {filename}")
    return os.path.join(_manager().snapshot_dir, name)


def _unique_path(directory: str, stem: str) -> str:
    path = os.path.join(directory, f"{stem}.db")
    n = 2
    while os.path.exists(path):
        path = os.path.join(directory, f"{stem}_{n}.db")
        n += 1
    return path


def take_system_snapshot(prefix: str) -> Dict[str, Any]:
    """Consistent snapshot named ``<prefix><timestamp>.db`` in saved_databases."""
    mgr = _manager()
    path = _unique_path(mgr.snapshot_dir, f"{prefix}{timestamp_slug()}")
    info = mgr.backup_to(path)
    return {"filename": os.path.basename(path), "path": path, "size": info["size"]}


#: Snapshot contents by (path, mtime_ns, size): reading a file's counts is cheap but the list is polled.
_CONTENTS_CACHE: Dict[Tuple[str, int, int], Dict[str, Any]] = {}
_CONTENTS_LOCK = threading.Lock()


def _cached_contents(path: str, stat_info: os.stat_result) -> Dict[str, Any]:
    """``snapshot_contents`` of a file, cached until the file changes; None + error when unreadable."""
    wal = path + "-wal"
    wal_stamp = os.stat(wal).st_mtime_ns if os.path.exists(wal) else 0   # the live file after /switch
    key = (os.path.abspath(path), stat_info.st_mtime_ns + wal_stamp, stat_info.st_size)
    cached = _CONTENTS_CACHE.get(key)
    if cached is None:
        try:
            cached = {"contents": snapshot_contents(path), "contents_error": None}
        except Exception as exc:  # not a database, corrupt, locked: list it anyway
            cached = {"contents": None, "contents_error": str(exc)}
        with _CONTENTS_LOCK:
            for stale in [k for k in _CONTENTS_CACHE if k[0] == key[0]]:
                _CONTENTS_CACHE.pop(stale, None)
            _CONTENTS_CACHE[key] = cached
    return cached


def _snapshot_info(path: str, with_contents: bool = False) -> Dict[str, Any]:
    stat_info = os.stat(path)
    filename = os.path.basename(path)
    saved_at = datetime.fromtimestamp(stat_info.st_mtime).isoformat(timespec="seconds")
    kind = snapshot_detail_kind(filename)
    info = {
        "filename": filename,
        "name": filename[:-3],
        "type": snapshot_kind(filename),
        "kind": kind,
        "kind_label": SNAPSHOT_KIND_LABELS.get(kind, kind),
        "size": stat_info.st_size,
        "saved_at": saved_at,
        "created": datetime.fromtimestamp(stat_info.st_ctime).isoformat(),
        "modified": datetime.fromtimestamp(stat_info.st_mtime).isoformat(),
        "_mtime_ns": stat_info.st_mtime_ns,
    }
    if with_contents:
        info.update(_cached_contents(path, stat_info))
    return info


def _list_snapshots(with_contents: bool = False) -> List[Dict[str, Any]]:
    """Every saved snapshot, newest first (``with_contents``: plus what each one holds)."""
    directory = _manager().snapshot_dir
    if not os.path.isdir(directory):
        return []
    snapshots = [_snapshot_info(os.path.join(directory, f), with_contents)
                 for f in os.listdir(directory) if f.endswith('.db') and not f.startswith('.')]
    snapshots.sort(key=lambda s: (s["_mtime_ns"], s["filename"]), reverse=True)
    return snapshots


def _public(info: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in info.items() if not k.startswith('_')}


@router.get("/snapshot")
async def export_snapshot(
    filename: Optional[str] = Query(None, description="A saved snapshot to download; omit for the live database"),
):
    """
    Download a database as a ``.db`` file: the live database (a consistent
    copy taken now with the SQLite backup API) or, with ``filename``, a saved
    snapshot from /database/list.
    """
    mgr = _manager()
    if filename:
        path = _snapshot_path(filename)
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail=f"Database file {os.path.basename(path)} not found")
        return FileResponse(path, media_type="application/vnd.sqlite3", filename=os.path.basename(path))
    if not os.path.exists(mgr.database_path):
        raise HTTPException(status_code=404, detail="Database not found")
    try:
        fd, tmp_path = tempfile.mkstemp(prefix="forecast_export_", suffix=".db")
        os.close(fd)
        mgr.backup_to(tmp_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export database: {str(e)}")
    download = f"forecast_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
    return FileResponse(tmp_path, media_type="application/vnd.sqlite3", filename=download,
                        background=BackgroundTask(os.remove, tmp_path))


@router.post("/save")
async def save_database(request: dict):
    """
    Save a named snapshot of the live database to saved_databases/<name>.db.
    Body: ``{"name": "before-june-cut", "overwrite": false}``. A name that is
    already taken is refused with 409 unless ``overwrite`` is true. Without a
    name a ``database_backup_<timestamp>`` name is used. Names the app uses
    for its own copies are refused with 400 (``autosave_``,
    ``current_backup_``, ``pre_revert_backup_``, ``reset_backup_``,
    ``start_clean_backup_``, ``clear_data_backup_``, ``force_reload_backup_``
    and ``approved_<scenario>_<YYYYMMDD_HHMMSS>``), so a user's save is
    always listed and reverted to as a named save and never replaces an
    approval's evidence; 'approved budget' is an ordinary name.
    """
    try:
        mgr = _manager()
        save_name = _safe_name(request.get("name"))
        overwrite = bool(request.get("overwrite", False))
        if save_name:
            reserved = _reserved_name_problem(save_name)
            if reserved:
                raise HTTPException(status_code=400, detail=reserved)
        else:
            save_name = f"database_backup_{timestamp_slug()}"
        backup_filename = f"{save_name}.db"
        backup_path = os.path.join(mgr.snapshot_dir, backup_filename)
        if os.path.abspath(backup_path) == os.path.abspath(mgr.database_path):
            raise HTTPException(status_code=409,
                                detail=f"{backup_filename} is the live database (after /database/switch); "
                                       f"choose another name")
        existed = os.path.exists(backup_path)
        if existed and not overwrite:
            raise HTTPException(
                status_code=409,
                detail=f"A snapshot named {backup_filename} already exists. Choose another name "
                       f"or save again with overwrite=true to replace it.")
        info = mgr.backup_to(backup_path)
        return {
            "status": "success",
            "message": f"Database {'overwritten' if existed else 'saved'} as {backup_filename}",
            "data": {
                "filename": backup_filename,
                "path": backup_path,
                "size": info["size"],
                "overwritten": existed,
                "saved_at": datetime.now().isoformat(timespec="seconds"),
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save database: {str(e)}")

@router.post("/save-current")
async def save_current_state():
    """
    Save the live database as ``autosave_<timestamp>.db`` (no name needed).
    Take one right before a bulk change; /database/revert-to-last-save
    restores the newest named save or autosave.
    """
    try:
        mgr = _manager()
        path = _unique_path(mgr.snapshot_dir, f"autosave_{timestamp_slug()}")
        info = mgr.backup_to(path)
        auto_filename = os.path.basename(path)
        now = datetime.now()
        return {
            "status": "success",
            "message": f"Current state saved automatically as {auto_filename}",
            "data": {
                "filename": auto_filename,
                "path": path,
                "size": info["size"],
                "timestamp": now.strftime('%Y%m%d_%H%M%S'),
                "readable_time": now.strftime('%Y-%m-%d %H:%M:%S')
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save current state: {str(e)}")

@router.get("/list")
async def list_saved_databases():
    """
    Saved snapshots, newest first. ``type`` is manual_save (POST /save),
    autosave (POST /save-current) or system_backup (taken automatically
    before a load, revert, reset or start-clean). ``kind`` is finer:
    manual_save | autosave | start_clean_backup | before_load_backup |
    before_revert_backup | system_backup (reset / clear / force-reload
    backups), with a readable ``kind_label``. ``contents`` is what the file
    holds, read without opening it for writing: ``{scenarios: [names],
    scenario_count, customers, products, sales_rows, total_rows, empty}``
    (``empty``: no model data, scenario names alone count as empty); null
    with ``contents_error`` when the file cannot be read.
    """
    try:
        snapshots = [_public(s) for s in await run_in_threadpool(_list_snapshots, True)]
        manual_saves = [s for s in snapshots if s["type"] == "manual_save"]
        autosaves = [s for s in snapshots if s["type"] != "manual_save"]
        all_databases = manual_saves + autosaves
        return {
            "status": "success",
            "data": {
                "databases": all_databases,
                "manual_saves": manual_saves,
                "autosaves": autosaves,
                "latest": snapshots[0] if snapshots else None,
                "count": len(all_databases),
                "manual_count": len(manual_saves),
                "autosave_count": len(autosaves),
                "snapshot_dir": _manager().snapshot_dir,
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list databases: {str(e)}")


def live_database_is_empty() -> bool:
    """True when the live database holds no model data (scenario names alone, logs ignored)."""
    try:
        with _manager().connection() as conn:
            return bool(database_contents(conn)["empty"])
    except Exception:
        return False          # when in doubt, protect it


#: Why a load / revert took no backup (the live database had nothing to protect).
NO_BACKUP_REASON = "the live database was empty (no model data), so there was nothing to back up"


def _restore(snapshot_path: str, backup_prefix: str) -> Optional[Dict[str, Any]]:
    """
    Snapshot the live database, then restore ``snapshot_path`` into it.
    No snapshot is taken when the live database is empty (nothing to
    protect; e.g. right after Start clean): returns None then.
    """
    mgr = _manager()
    backup = None if live_database_is_empty() else take_system_snapshot(backup_prefix)
    try:
        mgr.restore_from(snapshot_path)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"{e}. The live database was not changed.")
    return backup


@router.post("/load")
async def load_database(request: dict):
    """
    Restore a saved snapshot INTO the live database. Body: ``{"filename":
    "before-june-cut.db"}`` (the .db is optional). The live state is first
    saved as ``current_backup_<timestamp>.db`` unless the live database is
    empty (then ``backup_created`` is null and ``backup_skipped`` true);
    afterwards the schema is migrated, so a snapshot from an older version
    loads cleanly.
    """
    try:
        mgr = _manager()
        snapshot_path = _snapshot_path(request.get("filename", ""))
        filename = os.path.basename(snapshot_path)
        if not os.path.exists(snapshot_path):
            raise HTTPException(status_code=404, detail=f"Database file {filename} not found")
        backup = _restore(snapshot_path, "current_backup_")
        if backup:
            message = (f"Database loaded from {filename}. The state before the load was kept as "
                       f"{backup['filename']}.")
        else:
            message = f"Database loaded from {filename}. No backup was taken: {NO_BACKUP_REASON}."
        return {
            "status": "success",
            "message": message,
            "data": {
                "loaded_filename": filename,
                "backup_created": backup["filename"] if backup else None,
                "backup_skipped": backup is None,
                "backup_skipped_reason": None if backup else NO_BACKUP_REASON,
                "current_db_path": mgr.database_path,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to load database: {str(e)}")

@router.post("/switch")
async def switch_database_endpoint(request: dict):
    """
    Make a saved snapshot file the live database (no copy; later writes go
    to that file). The app's one DatabaseManager is repointed in place, so
    every screen, report and MCP tool follows, and the file's schema is
    migrated. Prefer /database/load, which keeps the live file and its path.
    """
    try:
        filename = request.get("filename", "")
        target_db_path = _snapshot_path(filename)
        if not os.path.exists(target_db_path):
            raise HTTPException(status_code=404, detail=f"Database file {os.path.basename(target_db_path)} not found")
        if not is_sqlite_file(target_db_path):
            raise HTTPException(status_code=422, detail=f"{os.path.basename(target_db_path)} is not a SQLite database")
        current_db_path = get_current_database_path()
        switch_database(target_db_path)
        return {
            "status": "success",
            "message": f"Switched to database {os.path.basename(target_db_path)}",
            "data": {
                "previous_db_path": current_db_path,
                "new_db_path": target_db_path,
                "filename": os.path.basename(target_db_path)
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to switch database: {str(e)}")

@router.delete("/delete/{filename}")
async def delete_saved_database(filename: str):
    """
    Delete a saved snapshot file
    """
    try:
        file_path = _snapshot_path(filename)
        if os.path.abspath(file_path) == os.path.abspath(_manager().database_path):
            raise HTTPException(status_code=409, detail="That file is the live database; switch away from it first")
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail=f"Database file {os.path.basename(file_path)} not found")
        os.remove(file_path)
        for suffix in ('-wal', '-shm', '-journal'):
            if os.path.exists(file_path + suffix):
                os.remove(file_path + suffix)
        return {
            "status": "success",
            "message": f"Database {os.path.basename(file_path)} deleted successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete database: {str(e)}")

#: Snapshot kinds the user made (POST /save and /save-current); revert-to-last-save only restores these.
USER_SNAPSHOT_KINDS = ("manual_save", "autosave")


@router.post("/revert-to-last-save")
async def revert_to_last_save():
    """
    Restore the newest snapshot the USER made: a named save (POST /save) or
    an autosave (POST /save-current), newest by save time. System backups
    taken automatically before a load, revert, reset or start-clean
    (current_backup_*, pre_revert_backup_*, reset_backup_*, ...) are never
    picked, so reverting twice restores the same save instead of toggling
    back. The live state is first saved as ``pre_revert_backup_<timestamp>.db``
    (unless the live database is empty: then ``backup_created`` is null and
    ``backup_skipped`` true); to undo a revert, load that file with POST
    /database/load. ``data.reverted_from`` names the file restored. 404 when
    there is no named save or autosave.
    """
    try:
        snapshots = [s for s in _list_snapshots() if s["type"] in USER_SNAPSHOT_KINDS]
        if not snapshots:
            raise HTTPException(
                status_code=404,
                detail="No named save or autosave found to revert to (system backups are not used); "
                       "save one with POST /database/save or /database/save-current")
        latest = snapshots[0]
        path = os.path.join(_manager().snapshot_dir, latest["filename"])
        print(f"Reverting to latest snapshot: {latest['filename']}")
        backup = _restore(path, "pre_revert_backup_")
        kept = (f"The state before the revert was kept as {backup['filename']}." if backup
                else f"No backup was taken: {NO_BACKUP_REASON}.")
        return {
            "status": "success",
            "message": f"Reverted to {latest['filename']} ({latest['type'].replace('_', ' ')}, saved "
                       f"{latest['saved_at']}). {kept}",
            "data": {
                "reverted_from": latest["filename"],
                "snapshot_type": latest["type"],
                "saved_at": latest["saved_at"],
                "backup_created": backup["filename"] if backup else None,
                "backup_skipped": backup is None,
                "backup_skipped_reason": None if backup else NO_BACKUP_REASON,
                "reverted_time": datetime.fromtimestamp(latest["_mtime_ns"] / 1e9).strftime('%Y-%m-%d %H:%M:%S')
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error reverting to last save: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to revert to last save: {str(e)}")

@router.get("/current")
async def get_current_database_info():
    """
    Get information about the currently active database
    """
    try:
        current_db_path = get_current_database_path()
        if os.path.exists(current_db_path):
            stat_info = os.stat(current_db_path)
            return {
                "status": "success",
                "data": {
                    "database_path": current_db_path,
                    "filename": os.path.basename(current_db_path),
                    "size": stat_info.st_size,
                    "created": datetime.fromtimestamp(stat_info.st_ctime).isoformat(),
                    "modified": datetime.fromtimestamp(stat_info.st_mtime).isoformat(),
                    "snapshot_dir": _manager().snapshot_dir,
                    "exists": True
                }
            }
        return {
            "status": "success",
            "data": {
                "database_path": current_db_path,
                "filename": os.path.basename(current_db_path),
                "snapshot_dir": _manager().snapshot_dir,
                "exists": False
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get current database info: {str(e)}")
