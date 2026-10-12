"""
Database Management API Routes: start clean, clear data, verify, info.

Every operation works on the live database the app is using
(``db_manager.database_path``), never a guessed path, and never deletes or
copies database files under the running process: rows are deleted in one
FK-safe transaction (DatabaseManager.clear_all_data), snapshots go through
the SQLite backup API, and the schema is re-applied with the same
initialize_schema() the app runs at startup.
"""

import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import JSONResponse

router = APIRouter()


def _manager():
    """The live DatabaseManager (looked up per call so tests can swap it)."""
    import db.database as dbmod
    return dbmod.db_manager


def _snapshot(prefix: str) -> Dict[str, Any]:
    from api.database_routes import take_system_snapshot
    return take_system_snapshot(prefix)


def _verify_empty() -> Dict[str, Any]:
    counts = _manager().table_counts()
    non_empty = {name: n for name, n in counts.items() if n}
    return {
        "all_empty": not non_empty,
        "total_rows": sum(counts.values()),
        "table_count": len(counts),
        "non_empty_tables": non_empty,
    }


def _wipe(snapshot_first: bool, prefix: str) -> Dict[str, Any]:
    """Optional snapshot, then delete every row of every table and re-apply the schema."""
    mgr = _manager()
    backup = _snapshot(prefix) if snapshot_first else None
    cleared = mgr.clear_all_data()
    mgr.initialize_schema()
    return {
        "database_path": mgr.database_path,
        "backup": backup,
        "backup_path": backup["path"] if backup else None,
        "rows_deleted": cleared["rows_deleted"],
        "tables_cleared": cleared["tables_cleared"],
        "tables": cleared["tables"],
        "verify": _verify_empty(),
    }


@router.post("/database/start-clean")
async def start_clean(body: Optional[Dict[str, Any]] = Body(None)):
    """
    Start from an empty model. Body: ``{"confirm": true, "snapshot_first":
    true, "scenario_name": null}``.

    Snapshots the live database first (``start_clean_backup_<timestamp>.db``
    in saved_databases; restore it with POST /database/load), then deletes
    every row of every table in one FK-safe transaction (scenarios, sales,
    customers, products, BOMs, routings, machines, labor rates, payroll,
    expenses and allocations, loans and schedules, assumptions, capex,
    actuals, price list, deduction rules, logs) and re-applies the schema.
    The tables and columns stay. ``scenario_name`` optionally creates an
    empty base scenario (F001). Refused with 400 unless ``confirm`` is true.
    """
    body = body or {}
    if body.get("confirm") is not True:
        raise HTTPException(status_code=400,
                            detail="This deletes every row in the database. Send {\"confirm\": true} to proceed.")
    snapshot_first = body.get("snapshot_first", True) is not False
    try:
        result = _wipe(snapshot_first, "start_clean_backup_")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start clean (nothing was deleted): {str(e)}")
    scenario = None
    name = str(body.get("scenario_name") or "").strip()
    if name:
        with _manager().connection() as conn:
            conn.execute("INSERT INTO forecast (forecast_id, name, description, is_base) VALUES ('F001', ?, '', 1)",
                         (name,))
            conn.commit()
        scenario = {"forecast_id": "F001", "name": name, "is_base": 1}
        result["verify"] = _verify_empty()
    result["scenario"] = scenario
    backup_note = f" Previous data saved as {result['backup']['filename']}." if result["backup"] else ""
    return JSONResponse(status_code=200, content={
        "status": "success",
        "message": f"Started clean: deleted {result['rows_deleted']} rows from "
                   f"{result['tables_cleared']} tables; schema kept.{backup_note}",
        "data": result,
    })


@router.post("/database/reset-clean")
async def reset_database_clean():
    """
    Empty the live database (every table, schema kept and migrated) after a
    snapshot (``reset_backup_<timestamp>.db``). Same operation as
    /database/start-clean with ``confirm`` implied; kept for older clients.
    """
    try:
        result = _wipe(True, "reset_backup_")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reset database: {str(e)}")
    return JSONResponse(status_code=200, content={
        "status": "success",
        "message": f"Database reset successfully. {result['verify']['table_count']} tables kept with no data "
                   f"({result['rows_deleted']} rows deleted).",
        "database_path": result["database_path"],
        "backup_path": result["backup_path"],
        "table_count": result["verify"]["table_count"],
        "rows_deleted": result["rows_deleted"],
        "tables": result["tables"],
        "verify": result["verify"],
    })


@router.post("/database/clear-data")
async def clear_database_data(snapshot_first: bool = True):
    """
    Delete every row of every table (structure preserved) in one FK-safe
    transaction; any error rolls everything back. A snapshot
    (``clear_data_backup_<timestamp>.db``) is taken first unless
    ``?snapshot_first=false``. Reports rows deleted per table and the
    verify-empty result.
    """
    try:
        result = _wipe(snapshot_first, "clear_data_backup_")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear database (nothing was deleted): {str(e)}")
    return JSONResponse(status_code=200, content={
        "status": "success",
        "message": f"Cleared {result['rows_deleted']} rows from {result['tables_cleared']} tables. Structure preserved.",
        "tables_cleared": result["tables_cleared"],
        "rows_cleared": result["rows_deleted"],
        "tables": result["tables"],
        "backup_path": result["backup_path"],
        "verify": result["verify"],
    })


@router.post("/database/verify-empty")
async def verify_database_empty():
    """Row counts of every table and whether they are all empty."""
    try:
        counts = _manager().table_counts()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to verify database: {str(e)}")
    total_rows = sum(counts.values())
    return JSONResponse(status_code=200, content={
        "status": "success",
        "all_empty": total_rows == 0,
        "total_rows": total_rows,
        "table_count": len(counts),
        "tables": [{"table_name": name, "row_count": n, "is_empty": n == 0} for name, n in counts.items()],
    })


@router.get("/database/info")
async def get_database_info():
    """The live database file (path, size, WAL size), snapshot folder and row counts per table."""
    mgr = _manager()
    try:
        counts = mgr.table_counts()
        with mgr.connection() as conn:
            journal_mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get database info: {str(e)}")
    path = mgr.database_path
    size = os.path.getsize(path) if os.path.exists(path) else 0
    wal_size = os.path.getsize(path + "-wal") if os.path.exists(path + "-wal") else 0
    return JSONResponse(status_code=200, content={
        "status": "success",
        "database_path": path,
        "database_size_bytes": size,
        "wal_size_bytes": wal_size,
        "journal_mode": journal_mode,
        "snapshot_dir": mgr.snapshot_dir,
        "data_dir": mgr.data_dir,
        "table_count": len(counts),
        "total_rows": sum(counts.values()),
        "tables": [{"name": name, "row_count": n} for name, n in counts.items()],
    })
