"""Database safety and data-quality tools: snapshots, restore, validation."""
from __future__ import annotations

from typing import Annotated, Any, Dict, Optional

from pydantic import Field
from mcp.server.mcpserver.exceptions import ToolError

from mcp_server.core import DESTRUCTIVE, READ, WRITE, call, mcp, require, trim_lists


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
    """Restore the newest named save or autosave (system backups such as
    pre-load / pre-revert copies are skipped). The state it replaces is kept
    as a pre_revert_backup_ snapshot, which forecast_load_database can restore."""
    return await call("POST", "/database/revert-to-last-save")


@mcp.tool(name="forecast_start_clean", annotations=DESTRUCTIVE)
async def start_clean(
    confirm: Annotated[bool, Field(description="Must be true: deletes EVERY row of every table (scenarios, sales, BOMs, prices, rules, payroll, ...)")],
    snapshot_first: Annotated[bool, Field(description="Snapshot the current database first so it can be restored with forecast_load_database")] = True,
    scenario_name: Annotated[Optional[str], Field(description="Optionally create one empty scenario with this name afterwards, e.g. '2027 Budget'")] = None,
) -> Dict[str, Any]:
    """Start from an empty model (keeps the schema). Use it before loading
    the user's real data after a rehearsal with sample files. Only call it
    when the user has asked for it in so many words; it removes all data.
    The response names the snapshot taken first."""
    if confirm is not True:
        raise ToolError("Pass confirm=true to delete all data (ask the user first)")
    body: Dict[str, Any] = {"confirm": True, "snapshot_first": snapshot_first}
    if scenario_name and scenario_name.strip():
        body["scenario_name"] = scenario_name.strip()
    return await call("POST", "/database/start-clean", json=body)


@mcp.tool(name="forecast_data_quality", annotations=READ)
async def data_quality(
    max_examples: Annotated[int, Field(description="Max entries shown per list (counts are always complete)", ge=1, le=500)] = 20,
) -> Dict[str, Any]:
    """Data-quality report from the API: sold products without a usable BOM
    or routing, routing steps whose machine or labor rate is missing,
    employees without a labor rate, incomplete master data. Fix these before
    trusting COGS. Long lists are cut to max_examples entries; `truncated`
    gives the full length of each cut list. Per-product cost gaps for one
    scenario also show in forecast_product_cost_summary warnings."""
    out: Dict[str, Any] = {}
    cut: Dict[str, int] = {}
    for key, path in (("quality", "/database/quality"), ("validation", "/data/validation/issues")):
        try:
            body = await call("GET", path)
        except ToolError as exc:
            out[key] = {"error": str(exc)}
            continue
        body.pop("message", None)
        trimmed, lengths = trim_lists(body, max_examples, path=key)
        out[key] = trimmed
        cut.update(lengths)
    if cut:
        out["truncated"] = cut
    return out
