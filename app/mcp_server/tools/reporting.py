"""Reporting tools: statements, variance, actuals, assumptions and capex."""
from __future__ import annotations

from typing import Annotated, Any, Dict, List, Optional

from pydantic import Field
from mcp.server.mcpserver.exceptions import ToolError

from mcp_server.core import DESTRUCTIVE, READ, UPSERT, WRITE, call, mcp, require, strip_none

SECTIONS = ("income_statement", "cash_flow", "balance_sheet", "detail", "assumptions", "warnings")
ASSUMPTION_FIELDS = (
    "opening_period", "opening_cash", "opening_accounts_receivable", "opening_inventory", "opening_fixed_assets",
    "opening_accumulated_depreciation", "opening_fixed_assets_remaining_life_months", "opening_accounts_payable",
    "opening_other_liabilities", "opening_equity", "dso_days", "dio_days", "dpo_days", "income_tax_rate",
    "minimum_cash_balance", "notes",
)
CAPEX_FIELDS = (
    "asset_name", "category", "amount", "purchase_period", "useful_life_months", "salvage_value",
    "depreciation_method", "description", "is_active", "forecast_id",
)

Window = Annotated[str, Field(description="YYYY-MM")]


@mcp.tool(name="forecast_financial_statements", annotations=READ)
async def financial_statements(
    forecast_ids: Annotated[List[str], Field(description="Scenario ids to include (usually one)", min_length=1)],
    start_period: Window,
    end_period: Window,
    include_raises: Annotated[bool, Field(description="Apply scheduled payroll raises")] = True,
    sections: Annotated[Optional[List[str]], Field(description=f"Subset of {', '.join(SECTIONS)}; omit for everything. Totals are always included.")] = None,
) -> Dict[str, Any]:
    """Period-by-period income statement, cash flow and balance sheet for a
    window, built by the statements engine (the single source of truth for
    every reported number). Each statement has by_period rows and totals;
    detail holds revenue by product / customer, expenses by category,
    payroll by department, loans and capex. Use sections to keep the
    response small, e.g. ['income_statement']."""
    body = await call("GET", "/reporting/statements", params={
        "forecast_ids": forecast_ids, "start_period": start_period, "end_period": end_period,
        "include_raises": include_raises,
    })
    if not sections:
        return body
    bad = [s for s in sections if s not in SECTIONS]
    if bad:
        raise ToolError(f"Unknown sections: {', '.join(bad)}. Choose from {', '.join(SECTIONS)}")
    keep = {"forecast_ids", "periods", "start_period", "end_period", "generated_at", "message", *sections}
    out = {k: v for k, v in body.items() if k in keep}
    # Always give the headline totals so a trimmed response still answers "what changed".
    for stmt in ("income_statement", "cash_flow"):
        if stmt not in out and isinstance(body.get(stmt), dict):
            out[f"{stmt}_totals"] = body[stmt].get("totals")
    if "balance_sheet" not in out and isinstance(body.get("balance_sheet"), dict):
        out["balance_sheet_closing"] = body["balance_sheet"].get("closing")
    return out


@mcp.tool(name="forecast_variance", annotations=READ)
async def variance(
    forecast_ids: Annotated[List[str], Field(min_length=1)],
    start_period: Window,
    end_period: Window,
) -> Dict[str, Any]:
    """Budget vs actual by statement line and period: forecast, actual,
    variance and variance %, for periods that have actuals recorded."""
    return await call("GET", "/reporting/variance", params={
        "forecast_ids": forecast_ids, "start_period": start_period, "end_period": end_period,
    })


@mcp.tool(name="forecast_actual_line_items", annotations=READ)
async def actual_line_items() -> Dict[str, Any]:
    """The statement line names actuals can be recorded against."""
    return await call("GET", "/reporting/actuals/line-items")


@mcp.tool(name="forecast_list_actuals", annotations=READ)
async def list_actuals(start_period: Window, end_period: Window) -> Dict[str, Any]:
    """Recorded actual results by period and statement line."""
    return await call("GET", "/reporting/actuals", params={"start_period": start_period, "end_period": end_period})


@mcp.tool(name="forecast_upsert_actuals", annotations=UPSERT)
async def upsert_actuals(
    entries: Annotated[List[Dict[str, Any]], Field(
        description="Rows of {period (YYYY-MM), line_item (see forecast_actual_line_items), amount, reference_id?, source?, notes?}",
        min_length=1)],
) -> Dict[str, Any]:
    """Record or overwrite actual results for budget-vs-actual reporting.
    Matched on period + line_item + reference_id."""
    for i, entry in enumerate(entries):
        for key in ("period", "line_item", "amount"):
            if entry.get(key) is None:
                raise ToolError(f"entries[{i}] is missing {key}")
    return await call("POST", "/reporting/actuals", json={"entries": entries})


@mcp.tool(name="forecast_delete_actuals", annotations=DESTRUCTIVE)
async def delete_actuals(
    period: Annotated[Optional[str], Field(description="Delete every actual in this YYYY-MM")] = None,
    line_item: Annotated[Optional[str], Field(description="With period: only this line")] = None,
    actual_id: Annotated[Optional[str], Field(description="Delete one row by id")] = None,
) -> Dict[str, Any]:
    """Delete recorded actuals by period (and line item) or by id."""
    if not (period or actual_id):
        raise ToolError("Give period (optionally with line_item) or actual_id")
    return await call("DELETE", "/reporting/actuals", params={
        "period": period, "line_item": line_item, "actual_id": actual_id,
    })


@mcp.tool(name="forecast_get_assumptions", annotations=READ)
async def get_assumptions(forecast_id: Annotated[str, Field(description="Scenario id")]) -> Dict[str, Any]:
    """Opening balances (cash, AR, inventory, fixed assets, AP, equity),
    working-capital days (DSO / DIO / DPO), income tax rate and minimum cash
    for a scenario. 'found' is false when defaults are in use."""
    return await call("GET", "/reporting/assumptions", params={"forecast_id": require(forecast_id, "forecast_id")})


@mcp.tool(name="forecast_update_assumptions", annotations=UPSERT)
async def update_assumptions(
    forecast_id: Annotated[str, Field(description="Scenario id")],
    updates: Annotated[Dict[str, Any], Field(description=f"Fields to change; any of {', '.join(ASSUMPTION_FIELDS)}. Rates are fractions (0.21 = 21%), days are numbers.")],
) -> Dict[str, Any]:
    """Save financial assumptions for a scenario. Only the fields given change;
    the rest keep their current (or default) values. opening_equity left null
    is plugged so the opening balance sheet balances."""
    forecast_id = require(forecast_id, "forecast_id")
    unknown = [k for k in updates if k not in ASSUMPTION_FIELDS]
    if unknown:
        raise ToolError(f"Unknown assumption fields: {', '.join(unknown)}. Allowed: {', '.join(ASSUMPTION_FIELDS)}")
    if not updates:
        raise ToolError("updates must contain at least one field")
    current = (await call("GET", "/reporting/assumptions", params={"forecast_id": forecast_id})).get("assumptions") or {}
    merged = {k: current.get(k) for k in ASSUMPTION_FIELDS}
    merged.update(updates)
    for key in ASSUMPTION_FIELDS:
        if merged.get(key) is None and key not in ("opening_period", "opening_equity", "notes"):
            merged[key] = 0 if key == "opening_fixed_assets_remaining_life_months" else 0.0
    return await call("PUT", "/reporting/assumptions", params={"forecast_id": forecast_id}, json=merged)


@mcp.tool(name="forecast_list_capex", annotations=READ)
async def list_capex(
    forecast_id: Annotated[Optional[str], Field(description="Scenario; company-wide (NULL) items are always included")] = None,
) -> Dict[str, Any]:
    """Planned capital expenditures (asset, amount, purchase month, useful
    life). Depreciated straight-line into the statements."""
    return await call("GET", "/reporting/capex", params={"forecast_id": forecast_id})


@mcp.tool(name="forecast_create_capex", annotations=WRITE)
async def create_capex(
    asset_name: str,
    amount: Annotated[float, Field(gt=0)],
    purchase_period: Annotated[str, Field(description="YYYY-MM the cash goes out")],
    useful_life_months: Annotated[int, Field(gt=0)] = 60,
    salvage_value: float = 0.0,
    category: Optional[str] = None,
    description: Optional[str] = None,
    forecast_id: Annotated[Optional[str], Field(description="Scenario; omit for company-wide")] = None,
) -> Dict[str, Any]:
    """Plan an asset purchase. Cash leaves in purchase_period; depreciation
    runs straight-line over useful_life_months from that month."""
    return await call("POST", "/reporting/capex", json=strip_none({
        "asset_name": require(asset_name, "asset_name"), "amount": amount, "purchase_period": purchase_period,
        "useful_life_months": useful_life_months, "salvage_value": salvage_value, "category": category,
        "description": description, "forecast_id": forecast_id,
    }))


@mcp.tool(name="forecast_update_capex", annotations=UPSERT)
async def update_capex(
    capex_id: str,
    updates: Annotated[Dict[str, Any], Field(description=f"Fields to change; any of {', '.join(CAPEX_FIELDS)}")],
) -> Dict[str, Any]:
    """Update a planned capital expenditure (amount, month, life, active flag)."""
    unknown = [k for k in updates if k not in CAPEX_FIELDS]
    if unknown:
        raise ToolError(f"Unknown capex fields: {', '.join(unknown)}. Allowed: {', '.join(CAPEX_FIELDS)}")
    if not updates:
        raise ToolError("updates must contain at least one field")
    return await call("PUT", f"/reporting/capex/{require(capex_id, 'capex_id')}", json=updates)


@mcp.tool(name="forecast_delete_capex", annotations=DESTRUCTIVE)
async def delete_capex(capex_id: str) -> Dict[str, Any]:
    """Delete a planned capital expenditure."""
    return await call("DELETE", f"/reporting/capex/{require(capex_id, 'capex_id')}")
