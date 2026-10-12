"""
MCP server core: the MCPServer instance, the in-process API client every tool
uses, and the helpers that turn API responses into tool results.

Design
------
* One MCP server, ``forecast``, mounted inside the FastAPI app at ``/mcp``
  (streamable HTTP, stateless JSON). It can also run over stdio
  (``scripts/run_mcp_stdio.py``) for a local-only setup.
* Tools do not re-implement business logic. They call the same REST
  endpoints the React UI calls, in-process through an ASGI transport, so
  whatever an assistant changes is exactly what the user sees after a page
  refresh. The two workflow tools that need bulk SQL use
  ``services.model_adjustments``.
* Every tool returns a JSON object. Errors raise ``ToolError`` with the
  API's own detail message so the calling model can correct its input.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

import httpx
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations

SERVER_NAME = "forecast"

# The tools call the API in-process; one log line per internal request is noise.
logging.getLogger("httpx").setLevel(logging.WARNING)

INSTRUCTIONS = """Financial model for a manufacturing business: revenue forecast by customer and product per month (YYYY-MM), product costs from BOMs and routings, payroll, operating expenses, loans, capital expenditures and the resulting income statement, cash flow and balance sheet.

Start with forecast_get_overview to learn the scenarios, their sales windows and which one is the base. Scenarios (forecast_id, e.g. F001) scope the model: sales always belong to exactly one scenario; payroll, expenses and capex rows belong to a scenario or are company-wide (forecast_id NULL) and count in every scenario.

Typical planning flow: (1) read the current state with the list/get tools or forecast_sql_query; (2) optionally branch the base scenario with forecast_branch_scenario so the user can compare; (3) apply changes with the write tools, using dry_run=true first on the bulk adjusters; (4) run forecast_financial_statements to show the effect. All writes go straight to the application's database, so the user sees them by refreshing the web UI.

Workflow tools: forecast_adjust_sales re-prices or re-volumes sales rows for chosen months, customers and products (e.g. ASP down 35% in June, August and September => periods=[2026-06, 2026-08, 2026-09], price_multiplier=0.65). forecast_adjust_material_costs re-prices BOM lines by material name (e.g. steel +12% => material_contains=steel, price_multiplier=1.12). BOM prices are not time-phased; to model a cost increase from a given month, branch a scenario for that horizon or apply the change in a scenario compared against the base.

Before destructive or sweeping changes, call forecast_save_database to take a named snapshot the user can restore from the Database screen."""

mcp = MCPServer(SERVER_NAME, instructions=INSTRUCTIONS)

# DNS-rebinding protection for the HTTP transport: only localhost Host /
# Origin headers are accepted unless MCP_ALLOWED_HOSTS / MCP_ALLOWED_ORIGINS
# add more (comma-separated, e.g. "192.168.1.20:*").
TRANSPORT_SECURITY = TransportSecuritySettings(
    enable_dns_rebinding_protection=True,
    allowed_hosts=["127.0.0.1:*", "localhost:*", "[::1]:*"]
    + [h.strip() for h in os.getenv("MCP_ALLOWED_HOSTS", "").split(",") if h.strip()],
    allowed_origins=["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"]
    + [o.strip() for o in os.getenv("MCP_ALLOWED_ORIGINS", "").split(",") if o.strip()],
)

# Tool annotation presets. Hints only; the API enforces nothing on top.
READ = ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True, open_world_hint=False)
WRITE = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False, open_world_hint=False)
UPSERT = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=True, open_world_hint=False)
DESTRUCTIVE = ToolAnnotations(read_only_hint=False, destructive_hint=True, idempotent_hint=False, open_world_hint=False)


# ---------------------------------------------------------------------------
# In-process API client
# ---------------------------------------------------------------------------

_fastapi_app: Any = None


def set_app(fastapi_app: Any) -> None:
    """Register the FastAPI app the tools call. Done by ``mount_mcp``."""
    global _fastapi_app
    _fastapi_app = fastapi_app


def get_app() -> Any:
    if _fastapi_app is None:
        raise ToolError("MCP server is not attached to the API application")
    return _fastapi_app


def _clean_params(params: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Drop None values and render booleans the way FastAPI parses them."""
    out: Dict[str, Any] = {}
    for key, value in (params or {}).items():
        if value is None:
            continue
        if isinstance(value, bool):
            value = "true" if value else "false"
        if isinstance(value, (list, tuple)):
            value = [str(v) for v in value if v is not None]
            if not value:
                continue
        out[key] = value
    return out


def _error_detail(resp: httpx.Response) -> str:
    try:
        body = resp.json()
    except ValueError:
        return resp.text[:500]
    if isinstance(body, dict):
        detail = body.get("detail") or body.get("error") or body.get("message")
        if detail is not None:
            return detail if isinstance(detail, str) else str(detail)
    return str(body)[:500]


async def api(method: str, path: str, *, params: Optional[Dict[str, Any]] = None,
              json: Any = None) -> Any:
    """Call a REST endpoint of the running app and return the parsed body."""
    transport = httpx.ASGITransport(app=get_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://forecast.internal") as client:
        resp = await client.request(method, path, params=_clean_params(params), json=json)
    if resp.status_code >= 400:
        raise ToolError(f"{method} {path} failed with HTTP {resp.status_code}: {_error_detail(resp)}")
    if not resp.content:
        return {}
    try:
        body = resp.json()
    except ValueError:
        return {"text": resp.text}
    if isinstance(body, dict) and body.get("status") == "error":
        raise ToolError(f"{method} {path} failed: {body.get('error') or body.get('message')}")
    return body


def unwrap(body: Any) -> Dict[str, Any]:
    """Flatten the API's {status, data, message} envelope into one object."""
    if not isinstance(body, dict):
        return {"items": body}
    if "status" in body and ("data" in body or "message" in body):
        data = body.get("data")
        if isinstance(data, dict):
            result = dict(data)
        elif data is None:
            result = {}
        else:
            result = {"items": data}
        for key in ("message", "columns", "metadata"):
            if key in body and key not in result:
                result[key] = body[key]
        return result
    return body


async def call(method: str, path: str, *, params: Optional[Dict[str, Any]] = None,
               json: Any = None) -> Dict[str, Any]:
    """``api`` + ``unwrap`` in one step: what most tools need."""
    return unwrap(await api(method, path, params=params, json=json))


def require(value: Optional[str], name: str) -> str:
    """Reject blank identifiers with an actionable message."""
    if value is None or not str(value).strip():
        raise ToolError(f"{name} is required")
    return str(value).strip()


def strip_none(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in payload.items() if v is not None}
