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


#: Snapshot fields kept in forecast_list_saved_databases (the API's list repeats each file in two lists).
SNAPSHOT_FIELDS = ("filename", "kind", "saved_at", "size", "contents", "contents_error")


def _compact_snapshot(item: Dict[str, Any]) -> Dict[str, Any]:
    entry = {k: item.get(k) for k in SNAPSHOT_FIELDS if item.get(k) is not None}
    contents = entry.get("contents")
    if isinstance(contents, dict) and len(contents.get("scenarios") or []) > 10:
        entry["contents"] = {**contents, "scenarios": contents["scenarios"][:10]}
    return entry


@mcp.tool(name="forecast_list_saved_databases", annotations=READ)
async def list_saved_databases(
    limit: Annotated[int, Field(description="Newest snapshots to list", ge=1, le=200)] = 50,
) -> Dict[str, Any]:
    """List saved database snapshots (filename, size, timestamp) and which
    database is active. Each snapshot has `kind` (manual_save | autosave |
    start_clean_backup | before_load_backup | before_revert_backup |
    system_backup) and `contents` ({scenarios: [names], customers, products,
    sales_rows, empty}) so you can tell the user what each one holds."""
    saved = await call("GET", "/database/list")
    current = await call("GET", "/database/current")
    newest_first = sorted(saved.get("databases") or [], key=lambda s: s.get("modified") or "", reverse=True)
    result: Dict[str, Any] = {
        "count": len(newest_first),
        "databases": [_compact_snapshot(s) for s in newest_first[:limit]],
        "snapshot_dir": saved.get("snapshot_dir"),
        "current": current,
    }
    if len(newest_first) > limit:
        result["omitted"] = len(newest_first) - limit
    return result


@mcp.tool(name="forecast_load_database", annotations=DESTRUCTIVE)
async def load_database(
    filename: Annotated[str, Field(description="A filename from forecast_list_saved_databases")],
) -> Dict[str, Any]:
    """Restore a snapshot over the active database. The current state is
    saved first as a current_backup_ snapshot (backup_created), unless the
    active database is empty (backup_skipped: nothing to protect);
    everything since the snapshot is replaced. Each listed snapshot has a
    `kind` and `contents` (scenario names, customer / product / sales-row
    counts, empty) to pick the right one."""
    return await call("POST", "/database/load", json={"filename": require(filename, "filename")})


@mcp.tool(name="forecast_revert_to_last_save", annotations=DESTRUCTIVE)
async def revert_to_last_save() -> Dict[str, Any]:
    """Restore the newest named save or autosave (system backups such as
    pre-load / pre-revert copies are skipped). The state it replaces is kept
    as a pre_revert_backup_ snapshot, which forecast_load_database can
    restore (none is taken when the active database is empty)."""
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
