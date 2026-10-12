"""Scenario lifecycle tools plus the one-call orientation tool."""
from __future__ import annotations

from typing import Annotated, Any, Dict, List, Optional
from urllib.parse import quote

from pydantic import Field
from mcp.server.mcpserver.exceptions import ToolError

from mcp_server.core import DESTRUCTIVE, READ, UPSERT, WRITE, as_table, call, mcp, require, strip_none

ForecastId = Annotated[str, Field(description="Scenario id, e.g. 'F001' (see forecast_list_scenarios)")]


#: Master-data counts reported by forecast_get_overview: label -> table.
OVERVIEW_TABLES = (
    ("customers", "customers"), ("products", "units"), ("boms", "bom_definitions"), ("bom_lines", "bom"),
    ("routings", "router_definitions"), ("routing_steps", "router_operations"), ("machines", "machines"),
    ("labor_rates", "labor_rates"), ("employees", "payroll"), ("expenses", "expenses"), ("loans", "loans"),
    ("capex_items", "capital_expenditures"), ("price_rules", "price_list"),
    ("deduction_rules", "sales_deduction_rules"),
)
FINANCIAL_KEYS = ("gross_sales", "total_sales_deductions", "net_sales", "total_cogs", "gross_profit",
                  "gross_margin_pct", "units")


async def _optional(method: str, path: str, **kwargs: Any) -> Dict[str, Any]:
    """call() that turns a failure into {'error': ...} so one broken check
    does not hide the rest of the overview."""
    try:
        return await call(method, path, **kwargs)
    except ToolError as exc:
        return {"error": str(exc)}


async def _scenario_readiness(scenario: Dict[str, Any], include_financials: bool) -> Dict[str, Any]:
    fid = scenario.get("forecast_id")
    start, end = scenario.get("start_period"), scenario.get("end_period")
    entry: Dict[str, Any] = {
        "forecast_id": fid,
        "name": scenario.get("name"),
        "is_base": bool(scenario.get("is_base")),
        "status": scenario.get("status") or "draft",
        "locked": bool(scenario.get("locked")),
        "sales_window": f"{start}..{end}" if start and end else None,
        "sales_rows": scenario.get("sales_rows", 0),
        "sales_lines": scenario.get("sales_lines", 0),
        "has_assumptions": bool(scenario.get("has_assumptions")),
        "scenario_employees": scenario.get("employee_count", 0),
        "scenario_expenses": scenario.get("expense_count", 0),
        "scenario_capex": scenario.get("capex_count", 0),
    }
    prices = await _optional("GET", "/pricing/prices", params={"forecast_id": fid, "include_inactive": False})
    deductions = await _optional("GET", "/pricing/deductions", params={"forecast_id": fid, "include_inactive": False})
    entry["price_rules"] = prices.get("count", len(prices.get("prices") or [])) if "error" not in prices else None
    entry["deduction_rules"] = deductions.get("count", len(deductions.get("rules") or [])) if "error" not in deductions else None
    issues: List[str] = []
    if not (start and end):
        issues.append("no monthly sales rows yet")
    elif include_financials:
        cogs = await _optional("GET", "/reporting/cogs-forecast",
                               params={"forecast_ids": [fid], "start_period": start, "end_period": end})
        if "error" in cogs:
            entry["financials_error"] = cogs["error"]
        else:
            totals = (cogs.get("summary") or {}).get("totals") or {}
            entry["financials"] = {k: totals.get(k) for k in FINANCIAL_KEYS if k in totals}
            for label, key in (("products_sold", "by_product"), ("customers_sold", "by_customer")):
                if isinstance(cogs.get(key), list):
                    entry[label] = len(cogs[key])
            cost_products: List[str] = []
            for warning in cogs.get("warnings") or []:
                code = warning.get("code")
                if code == "cost_warnings":
                    cost_products = sorted((warning.get("products") or {}).keys())
                elif code == "non_monthly_sales_periods":
                    issues.append(warning.get("message"))
            entry["cost_warning_products"] = len(cost_products)
            if cost_products:
                entry["cost_warning_examples"] = cost_products[:10]
                issues.append(f"{len(cost_products)} sold product(s) have incomplete BOM / routing costs "
                              f"(check with forecast_unit_cost_preview or forecast_product_cost_summary)")
    if entry["price_rules"] == 0:
        issues.append("no price-list rules (prices come from each sales row or the product base price)")
    if entry["deduction_rules"] == 0:
        issues.append("no deduction rules: net sales = gross sales (no terms, chargebacks, excise or commissions)")
    if not entry["has_assumptions"]:
        issues.append("no saved financial assumptions (statements use defaults)")
    if entry["locked"]:
        entry["approved"] = {"by": scenario.get("approved_by"), "at": scenario.get("approved_at")}
        drift = scenario.get("drift") or {}
        if drift.get("changed"):
            entry["drift"] = drift.get("items")
            issues.append("approved and locked, but shared company-wide inputs have moved its totals since approval "
                          "(see drift)")
    entry["issues"] = issues
    return entry


@mcp.tool(name="forecast_get_overview", annotations=READ)
async def get_overview(
    include_financials: Annotated[bool, Field(description="Compute each scenario's gross / net sales, COGS and cost warnings over its sales window (one COGS run per scenario)")] = True,
) -> Dict[str, Any]:
    """One-call orientation and readiness check: master-data counts
    (customers, products, BOMs, routings, machines, labor rates, price and
    deduction rules, ...) and, per scenario, its status (draft / approved and
    locked, with drift since approval), sales window, row counts, gross
    sales, deductions, net sales, COGS and gross margin, the price /
    deduction rules that apply to it, how many sold products have incomplete
    costs, and a short list of issues to fix before trusting the numbers.
    Also names the base scenario and the active database."""
    scenarios = (await call("GET", "/forecast/scenarios")).get("scenarios", [])
    info = await _optional("GET", "/database/info")
    database = await _optional("GET", "/database/current")
    table_rows = {t.get("name"): t.get("row_count") for t in info.get("tables") or []}
    base = next((s for s in scenarios if s.get("is_base")), None)
    return {
        "base_scenario_id": base.get("forecast_id") if base else None,
        "master_data": {label: table_rows.get(table, 0) for label, table in OVERVIEW_TABLES},
        "scenarios": [await _scenario_readiness(s, include_financials) for s in scenarios],
        "database": {k: database.get(k) for k in ("filename", "database_path", "modified") if k in database},
        "conventions": {
            "periods": "YYYY-MM months; reporting windows are inclusive on both ends",
            "scoping": "sales belong to one scenario; payroll / expenses / capex / price and deduction rules with "
                       "forecast_id NULL are company-wide and count in every scenario; BOMs, routings and products "
                       "are company-wide",
            "numbers": "forecast_financial_statements is the single source of truth; net sales = gross sales - "
                       "sales deductions",
            "safety": "dry_run=true on bulk tools; forecast_save_database before sweeping changes",
            "approvals": "an approved scenario is locked: its rows cannot change (409); branch it to make changes",
        },
    }


@mcp.tool(name="forecast_list_scenarios", annotations=READ)
async def list_scenarios() -> Dict[str, Any]:
    """List all scenarios (base first) with sales row / line counts, sales window,
    revenue total, scenario-specific expense / employee / capex counts,
    whether financial assumptions are saved, and governance: status (draft /
    approved), locked, approved_by / approved_at and, for an approved
    scenario, drift {changed, items: [{line, approved, current, delta}]}:
    shared company-wide inputs (BOMs, company-wide prices, rules, payroll,
    expenses) can still move a locked scenario's totals."""
    return await call("GET", "/forecast/scenarios")


@mcp.tool(name="forecast_get_scenario", annotations=READ)
async def get_scenario(forecast_id: ForecastId) -> Dict[str, Any]:
    """Get one scenario with its counts, notes, sales window, status, lock
    and drift since approval."""
    return await call("GET", f"/forecast/scenario/{require(forecast_id, 'forecast_id')}")


@mcp.tool(name="forecast_create_scenario", annotations=WRITE)
async def create_scenario(
    name: Annotated[str, Field(description="Scenario name shown in the UI")],
    description: Optional[str] = None,
    notes: Annotated[Optional[str], Field(description="Free-text planning notes (assumptions, rationale)")] = None,
    is_base: Annotated[bool, Field(description="Mark as the base scenario (exactly one scenario is base)")] = False,
) -> Dict[str, Any]:
    """Create an empty scenario with an auto-generated FXXX id. Names are
    unique (trimmed, case-insensitive): a name another scenario has is
    refused and the error names that scenario's id (use it instead). To
    copy an existing scenario's data use forecast_branch_scenario instead."""
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
    Only the fields given are changed. An approved (locked) scenario cannot be
    renamed or have its description / notes changed (409); marking it as the
    base is allowed."""
    body = strip_none({"name": name, "description": description, "notes": notes, "is_base": is_base})
    if not body:
        raise ToolError("Give at least one of name, description, notes, is_base")
    return await call("PUT", f"/forecast/scenario/{require(forecast_id, 'forecast_id')}", json=body)


@mcp.tool(name="forecast_branch_scenario", annotations=WRITE)
async def branch_scenario(
    forecast_id: Annotated[str, Field(description="Scenario to copy from")],
    name: Annotated[Optional[str], Field(description="Name for the copy; defaults to '<original> Copy' ('<original> Copy 2' "
                                                     "... when taken). A name another scenario has is refused")] = None,
    description: Optional[str] = None,
    notes: Optional[str] = None,
    price_multiplier: Annotated[Optional[float], Field(description=(
        "Scale unit_price on every copied sales row (0.9 = -10%). Prices are multiplied exactly, NOT rounded to "
        "cents (1399.30 x 0.95 = 1329.335); use a multiplier that gives cents or round afterwards with "
        "forecast_adjust_sales"), gt=0)] = None,
    quantity_multiplier: Annotated[Optional[float], Field(description=(
        "Scale quantity on every copied sales row; quantities are NOT rounded, so 1.05 leaves fractional units "
        "(forecast_adjust_sales rounds to whole units instead)"), gt=0)] = None,
    extend_periods: Annotated[int, Field(description="Add N months after the last sales month, repeating each customer/product line from that month", ge=0)] = 0,
    copy_expenses: Annotated[bool, Field(description="Copy scenario-specific expenses (company-wide ones are shared anyway)")] = True,
    copy_payroll: bool = True,
    copy_capex: bool = True,
    copy_assumptions: bool = True,
) -> Dict[str, Any]:
    """Branch a scenario in one transaction: copies sales, scenario-specific
    expenses / payroll / capex, the scenario's own price-list rules and
    deduction rules, assumptions and notes into a new scenario (company-wide
    rules apply to every scenario and are not copied), with optional
    across-the-board price / quantity multipliers and period extension.
    Use this before experimenting so the user can compare against the original.
    Branching an approved (locked) scenario is how to change it: the copy is
    always an editable draft.
    For whole units and 4-decimal prices, branch without multipliers and then
    run forecast_adjust_sales(all_rows=true, ...) on the copy."""
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
    expenses / payroll / capex, its own price-list rules and deduction rules
    (forecast_id = this scenario) and assumptions. Company-wide rows and
    rules are kept. Irreversible: consider forecast_save_database first.
    An approved (locked) scenario cannot be deleted (unlock it first, with
    the user's reason). `deleted` gives the row count per table."""
    fid = require(forecast_id, "forecast_id")
    before = await call("GET", f"/forecast/scenario/{quote(fid, safe='')}")
    result = await call("DELETE", f"/forecast/scenario/{quote(fid, safe='')}")
    deleted = result.get("deleted")
    if isinstance(deleted, dict):
        for label, key in (("prices", "price_count"), ("deduction_rules", "deduction_rule_count")):
            if label not in deleted and before.get(key) is not None:
                deleted[label] = before[key]
    return result


@mcp.tool(name="forecast_compare_scenarios", annotations=READ)
async def compare_scenarios(
    forecast_ids: Annotated[List[str], Field(description="Two or more scenario ids to compare", min_length=1)],
    start_period: Annotated[Optional[str], Field(description="YYYY-MM; defaults to the earliest sales month across the selection")] = None,
    end_period: Annotated[Optional[str], Field(description="YYYY-MM; defaults to the latest sales month across the selection")] = None,
) -> Dict[str, Any]:
    """Side-by-side statement totals for several scenarios over a shared window
    (revenue, COGS, gross profit, operating income, net income, closing cash).
    An unknown scenario id is an error."""
    ids = [str(f).strip() for f in forecast_ids if f is not None and str(f).strip()]
    if not ids:
        raise ToolError("forecast_ids needs at least one scenario id, e.g. ['F001'] (see forecast_list_scenarios)")
    missing = []
    for fid in ids:
        try:
            await call("GET", f"/forecast/scenario/{quote(fid, safe='')}")
        except ToolError as exc:
            if "404" not in str(exc):
                raise
            missing.append(fid)
    if missing:
        raise ToolError(f"Scenario(s) not found: {', '.join(missing)}; see forecast_list_scenarios. Nothing was compared.")
    forecast_ids = ids
    return await call("GET", "/forecast/comparison", params={
        "forecast_ids": forecast_ids, "start_period": start_period, "end_period": end_period,
    })


# ---------------------------------------------------------------------------
# Approvals, change history and legacy data checks
# ---------------------------------------------------------------------------

@mcp.tool(name="forecast_approve_scenario", annotations=WRITE)
async def approve_scenario(
    forecast_id: ForecastId,
    approved_by: Annotated[str, Field(description="Who approves it (the user's name or role, e.g. 'Dana, CFO')")],
    note: Annotated[Optional[str], Field(description="Why / what was approved, e.g. 'Board approved 2027 budget'")] = None,
) -> Dict[str, Any]:
    """Approve and lock a scenario as a baseline (only when the user asks to
    approve / freeze / sign off a budget). Stores its statement totals over
    its sales window, saves the Excel workbook to the data folder's
    exports/approved/ and a database snapshot (approved_<id>_<timestamp>.db),
    then locks it: every change to its own rows (sales, scenario expenses,
    payroll, capex, assumptions, prices, deduction rules) and deleting it
    are refused until it is unlocked with a reason. Company-wide inputs can
    still move its numbers; forecast_list_scenarios reports that as drift.
    Refused when already locked or when it has no monthly sales."""
    fid = require(forecast_id, "forecast_id")
    body = strip_none({"approved_by": require(approved_by, "approved_by"), "note": note})
    result = await call("POST", f"/forecast/scenario/{quote(fid, safe='')}/approve", json=body)
    keep = ("forecast_id", "name", "status", "locked", "approved_by", "approved_at", "approval_note", "approval",
            "message")
    return {k: result.get(k) for k in keep if k in result}


@mcp.tool(name="forecast_unlock_scenario", annotations=UPSERT)
async def unlock_scenario(
    forecast_id: ForecastId,
    reason: Annotated[str, Field(description="The user's reason for reopening the approved baseline (required, kept in the history)")],
    actor: Annotated[Optional[str], Field(description="Who is unlocking it")] = None,
) -> Dict[str, Any]:
    """Unlock an approved scenario so it can be edited again (status back to
    draft). Only when the user explicitly asks and gives a reason; otherwise
    branch it with forecast_branch_scenario. The approval history, snapshot
    and workbook are kept."""
    fid = require(forecast_id, "forecast_id")
    body = strip_none({"reason": require(reason, "reason"), "actor": actor})
    result = await call("POST", f"/forecast/scenario/{quote(fid, safe='')}/unlock", json=body)
    keep = ("forecast_id", "name", "status", "locked", "unlock", "message")
    return {k: result.get(k) for k in keep if k in result}


@mcp.tool(name="forecast_list_approvals", annotations=READ)
async def list_approvals(
    forecast_id: Annotated[Optional[str], Field(description="One scenario; leave out for every scenario's history")] = None,
) -> Dict[str, Any]:
    """Approval history, newest first: each approval (who, when, note,
    window, stored totals, snapshot and workbook file names) and each unlock
    (who, when, reason), for one scenario or all of them."""
    if forecast_id is None or not str(forecast_id).strip():
        return await call("GET", "/forecast/approvals")
    fid = str(forecast_id).strip()
    return await call("GET", f"/forecast/scenario/{quote(fid, safe='')}/approvals")


AUDIT_COLUMNS = ("log_id", "created_at", "client", "actor", "method", "path", "status", "forecast_id", "summary")


@mcp.tool(name="forecast_audit_log", annotations=READ)
async def audit_log(
    forecast_id: Annotated[Optional[str], Field(description="Only changes to this scenario")] = None,
    client: Annotated[Optional[str], Field(description="web (the UI) | mcp (tools like these) | api (scripts)")] = None,
    path_contains: Annotated[Optional[str], Field(description="Text in the endpoint path or summary, e.g. 'payroll', 'import'")] = None,
    since: Annotated[Optional[str], Field(description="From this UTC date / time, YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS")] = None,
    until: Annotated[Optional[str], Field(description="Up to this UTC date / time (a bare date includes the day)")] = None,
    status: Annotated[Optional[str], Field(description="ok (succeeded) | refused (HTTP 4xx / 5xx)")] = None,
    include_body: Annotated[bool, Field(description="Add each entry's request excerpt (up to 500 characters)")] = False,
    limit: Annotated[int, Field(ge=1, le=200)] = 25,
    offset: Annotated[int, Field(ge=0)] = 0,
) -> Dict[str, Any]:
    """Change history: who changed what, when, newest first. One entry per
    write through the API (web UI, MCP tools, scripts) with the HTTP status
    and the API's own summary; refused writes are included; dry runs, previews and simulations change nothing and are not recorded. Use it to answer
    'what changed since the budget was approved?' (since=<approved_at>)."""
    data = await call("GET", "/audit/log", params={
        "forecast_id": forecast_id, "client": client, "path_contains": path_contains, "since": since,
        "until": until, "status": status, "limit": limit, "offset": offset,
    })
    columns = AUDIT_COLUMNS + (("body_excerpt",) if include_body else ())
    out = {k: data.get(k) for k in ("total_count", "returned", "offset", "has_more", "clients")}
    out["entries"] = as_table(data.get("entries") or [], list(columns))
    if data.get("has_more"):
        out["next_offset"] = (data.get("offset") or 0) + (data.get("returned") or 0)
    return out


@mcp.tool(name="forecast_legacy_checks", annotations=READ)
async def legacy_checks() -> Dict[str, Any]:
    """Read-only checks for data an older version or an old import left
    behind, each with a severity, what it means and the action to take:
    scenarios whose opening balances have no opening period, loans with
    drifted payment dates, sales rows not in a YYYY-MM month (or stored as a
    date), BOM versions without lines, sold products without a BOM or
    routing, employees without a labor class. Nothing is fixed
    automatically: show the user and fix only what they ask."""
    return await call("GET", "/audit/legacy-checks")
