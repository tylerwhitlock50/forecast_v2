"""Scenario lifecycle tools plus the one-call orientation tool."""
from __future__ import annotations

from typing import Annotated, Any, Dict, List, Optional

from pydantic import Field

from mcp_server.core import DESTRUCTIVE, READ, UPSERT, WRITE, call, mcp, require, strip_none

ForecastId = Annotated[str, Field(description="Scenario id, e.g. 'F001' (see forecast_list_scenarios)")]


@mcp.tool(name="forecast_get_overview", annotations=READ)
async def get_overview() -> Dict[str, Any]:
    """One-call orientation: every scenario with its sales window, row counts and
    whether it is the base, plus database health and the planning conventions
    (period format, scenario scoping, which tools to reach for)."""
    scenarios = await call("GET", "/forecast/scenarios")
    health = await call("GET", "/data/health")
    database = await call("GET", "/database/current")
    base = next((s for s in scenarios.get("scenarios", []) if s.get("is_base")), None)
    return {
        "base_scenario_id": base.get("forecast_id") if base else None,
        "scenarios": scenarios.get("scenarios", []),
        "database": {k: database.get(k) for k in ("filename", "database_path", "modified") if k in database},
        "health": {k: health.get(k) for k in ("database_healthy", "has_data", "key_tables") if k in health},
        "conventions": {
            "period_format": "YYYY-MM; reporting windows are inclusive on both ends",
            "scoping": "sales belong to exactly one scenario; payroll / expenses / capex rows with forecast_id NULL are company-wide and count in every scenario",
            "statements": "forecast_financial_statements is the single source of truth for every reported number",
            "bulk_changes": "forecast_adjust_sales and forecast_adjust_material_costs accept dry_run=true to preview",
            "safety": "forecast_save_database snapshots the database before sweeping changes; the user restores from the Database screen",
        },
    }


@mcp.tool(name="forecast_list_scenarios", annotations=READ)
async def list_scenarios() -> Dict[str, Any]:
    """List all scenarios (base first) with sales row / line counts, sales window,
    revenue total, scenario-specific expense / employee / capex counts and
    whether financial assumptions are saved."""
    return await call("GET", "/forecast/scenarios")


@mcp.tool(name="forecast_get_scenario", annotations=READ)
async def get_scenario(forecast_id: ForecastId) -> Dict[str, Any]:
    """Get one scenario with its counts, notes and sales window."""
    return await call("GET", f"/forecast/scenario/{require(forecast_id, 'forecast_id')}")


@mcp.tool(name="forecast_create_scenario", annotations=WRITE)
async def create_scenario(
    name: Annotated[str, Field(description="Scenario name shown in the UI")],
    description: Optional[str] = None,
    notes: Annotated[Optional[str], Field(description="Free-text planning notes (assumptions, rationale)")] = None,
    is_base: Annotated[bool, Field(description="Mark as the base scenario (exactly one scenario is base)")] = False,
) -> Dict[str, Any]:
    """Create an empty scenario with an auto-generated FXXX id. To copy an
    existing scenario's data use forecast_branch_scenario instead."""
    body = strip_none({"name": require(name, "name"), "description": description, "notes": notes, "is_base": is_base})
    return await call("POST", "/forecast/scenario", json=body)


@mcp.tool(name="forecast_update_scenario", annotations=UPSERT)
async def update_scenario(
    forecast_id: ForecastId,
    name: Optional[str] = None,
    description: Optional[str] = None,
    notes: Optional[str] = None,
    is_base: Annotated[Optional[bool], Field(description="true makes this the base scenario; false un-marks it")] = None,
) -> Dict[str, Any]:
    """Rename a scenario, edit its description or notes, or mark it as base.
    Only the fields given are changed."""
    body = strip_none({"name": name, "description": description, "notes": notes, "is_base": is_base})
    if not body:
        from mcp.server.mcpserver.exceptions import ToolError
        raise ToolError("Give at least one of name, description, notes, is_base")
    return await call("PUT", f"/forecast/scenario/{require(forecast_id, 'forecast_id')}", json=body)


@mcp.tool(name="forecast_branch_scenario", annotations=WRITE)
async def branch_scenario(
    forecast_id: Annotated[str, Field(description="Scenario to copy from")],
    name: Annotated[Optional[str], Field(description="Name for the copy; defaults to '<original> Copy'")] = None,
    description: Optional[str] = None,
    notes: Optional[str] = None,
    price_multiplier: Annotated[Optional[float], Field(description="Scale unit_price on every copied sales row (0.9 = -10%)", gt=0)] = None,
    quantity_multiplier: Annotated[Optional[float], Field(description="Scale quantity on every copied sales row", gt=0)] = None,
    extend_periods: Annotated[int, Field(description="Add N months after the last sales month, repeating each customer/product line from that month", ge=0)] = 0,
    copy_expenses: Annotated[bool, Field(description="Copy scenario-specific expenses (company-wide ones are shared anyway)")] = True,
    copy_payroll: bool = True,
    copy_capex: bool = True,
    copy_assumptions: bool = True,
) -> Dict[str, Any]:
    """Branch a scenario in one transaction: copies sales, scenario-specific
    expenses / payroll / capex, assumptions and notes into a new scenario, with
    optional across-the-board price / quantity multipliers and period extension.
    Use this before experimenting so the user can compare against the original."""
    body = strip_none({
        "name": name, "description": description, "notes": notes,
        "price_multiplier": price_multiplier, "quantity_multiplier": quantity_multiplier,
        "extend_periods": extend_periods, "copy_expenses": copy_expenses, "copy_payroll": copy_payroll,
        "copy_capex": copy_capex, "copy_assumptions": copy_assumptions,
    })
    return await call("POST", f"/forecast/scenario/{require(forecast_id, 'forecast_id')}/duplicate", json=body)


@mcp.tool(name="forecast_delete_scenario", annotations=DESTRUCTIVE)
async def delete_scenario(forecast_id: ForecastId) -> Dict[str, Any]:
    """Delete a scenario and cascade-delete its sales, scenario-specific
    expenses / payroll / capex and assumptions. Company-wide rows are kept.
    Irreversible: consider forecast_save_database first."""
    return await call("DELETE", f"/forecast/scenario/{require(forecast_id, 'forecast_id')}")


@mcp.tool(name="forecast_compare_scenarios", annotations=READ)
async def compare_scenarios(
    forecast_ids: Annotated[List[str], Field(description="Two or more scenario ids to compare", min_length=1)],
    start_period: Annotated[Optional[str], Field(description="YYYY-MM; defaults to the earliest sales month across the selection")] = None,
    end_period: Annotated[Optional[str], Field(description="YYYY-MM; defaults to the latest sales month across the selection")] = None,
) -> Dict[str, Any]:
    """Side-by-side statement totals for several scenarios over a shared window
    (revenue, COGS, gross profit, operating income, net income, closing cash)."""
    return await call("GET", "/forecast/comparison", params={
        "forecast_ids": forecast_ids, "start_period": start_period, "end_period": end_period,
    })
