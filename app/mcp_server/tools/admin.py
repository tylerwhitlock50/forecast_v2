"""Database safety and data-quality tools: snapshots, restore, validation."""
from __future__ import annotations

from typing import Annotated, Any, Dict, Optional

from pydantic import Field

from mcp_server.core import DESTRUCTIVE, READ, WRITE, call, mcp, require


@mcp.tool(name="forecast_save_database", annotations=WRITE)
async def save_database(
    name: Annotated[Optional[str], Field(description="Snapshot name, e.g. 'before-june-discount'; letters, digits, dashes, underscores and spaces")] = None,
) -> Dict[str, Any]:
    """Take a named snapshot of the whole model database. Do this before
    sweeping changes so the user can restore from the Database screen or
    with forecast_load_database."""
    return await call("POST", "/database/save", json={"name": name or ""})


@mcp.tool(name="forecast_list_saved_databases", annotations=READ)
async def list_saved_databases() -> Dict[str, Any]:
    """List saved database snapshots (filename, size, timestamp) and which
    database is active."""
    saved = await call("GET", "/database/list")
    current = await call("GET", "/database/current")
    saved["current"] = current
    return saved


@mcp.tool(name="forecast_load_database", annotations=DESTRUCTIVE)
async def load_database(
    filename: Annotated[str, Field(description="A filename from forecast_list_saved_databases")],
) -> Dict[str, Any]:
    """Restore a snapshot over the active database. The current state is
    autosaved first, but everything since the snapshot is replaced."""
    return await call("POST", "/database/load", json={"filename": require(filename, "filename")})


@mcp.tool(name="forecast_revert_to_last_save", annotations=DESTRUCTIVE)
async def revert_to_last_save() -> Dict[str, Any]:
    """Undo back to the most recent autosave."""
    return await call("POST", "/database/revert-to-last-save")


@mcp.tool(name="forecast_data_quality", annotations=READ)
async def data_quality() -> Dict[str, Any]:
    """Data-quality report: sales rows whose product has no BOM, routings
    referencing missing machines, employees without a labor rate, and
    incomplete master data. Fix these before trusting COGS."""
    quality = await call("GET", "/database/quality")
    issues = await call("GET", "/data/validation/issues")
    return {"quality": quality, "validation": issues}
