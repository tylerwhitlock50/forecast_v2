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
* Results go out as ONE compact JSON text block (no indentation, no
  duplicate ``structuredContent``, float noise trimmed) so they fit an
  assistant's context; see ``ForecastMCPServer``.
* Tool arguments are strict: an unknown or misspelled argument is an error
  naming the valid ones, never silently ignored (a guessed filter must not
  turn into "every row").
"""
from __future__ import annotations

import inspect
import json
import logging
import math
import os
import re
from typing import Any, Callable, Dict, List, Optional, Tuple

import httpx
from pydantic import ConfigDict, model_validator
from pydantic_core import PydanticCustomError
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.mcpserver.utilities.func_metadata import FuncMetadata
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import CallToolResult, TextContent, ToolAnnotations

SERVER_NAME = "forecast"

# The tools call the API in-process; one log line per internal request is noise.
logging.getLogger("httpx").setLevel(logging.WARNING)

INSTRUCTIONS = """Financial model of a manufacturer: monthly (YYYY-MM) sales forecast by customer and product, gross-to-net deductions, product cost from BOMs and routings, payroll, expenses, loans, capex, and the resulting income statement, cash flow and balance sheet. Writes go straight to the app's database; the user sees them after refreshing the web UI.

Start with forecast_get_overview (scenarios, base scenario, sales windows). Sales belong to one scenario (forecast_id, e.g. F001); prices, deduction rules, payroll, expenses and capex are per scenario or company-wide (forecast_id null). Products, BOMs, routings, machines and labor rates are company-wide.

BUILDING A MODEL (in this order; forecast_list_import_templates gives each step's columns and header aliases, forecast_preview_file shows a file's columns first):
1 customers with customer_type (Dealer, Distributor, Government...; it drives prices and deductions) -> 2 products (unit_id, unit_name, unit_type e.g. Rifle/Pistol, base_price) -> 3 machines ($/h, monthly capacity) and labor rates ($/h): all forecast_import_records -> 4 forecast_import_routings (minutes per unit per operation) -> 5 forecast_import_boms (a unit_id column links products; version '1' = '1.0') -> 6 prices by customer type / customer (forecast_import_prices or forecast_upsert_prices) -> 7 deduction rules (forecast_import_deductions / forecast_upsert_deduction_rules) -> 8 sales forecast (forecast_import_sales into a scenario; periods 2027-01, 1/2027, Jan-27, Jan 2027 or a date, quarters / weeks are rejected; a blank unit_price is priced from the price list, then base_price; unknown customer / product ids are errors unless auto_create) -> 9 check the tools' warnings, forecast_data_quality and forecast_cogs_forecast group_by=unit_costs (missing BOM, routing or rate = understated COGS) -> 10 forecast_cogs_forecast, forecast_labor_forecast, forecast_financial_statements -> 11 forecast_export_workbook (Excel, saved in the data folder's exports/).
Import tools take rows (objects read from the user's file) or file_path (relative to the data folder; in Docker that is ./data on the host).

GROSS TO NET: gross sales (qty x price) - terms allowance - chargebacks - other allowances - excise tax = net sales (the statements' revenue). Commissions are a selling expense below gross profit. Rates are fractions: 2% = 0.02 (imports also accept '2%'). Methods: percent_of_gross; embedded_tax = price x rate / (1 + rate), so FET included in the price at 11% is excise_tax, embedded_tax, rate 0.11 ($1,110 invoice -> $110 tax); percent_of_net; per_unit. One rule per deduction type applies to a sale: the most specific (customer > customer type > product > product type; scenario beats company-wide); types stack; a 0% rule is an exemption (e.g. Government exempt from FET). Prices: customer+product > customer > type+product > type > product > base_price. Verify with forecast_simulate_deductions, forecast_resolve_price, forecast_deduction_preview.

ADJUSTING: forecast_branch_scenario to compare; forecast_adjust_sales (e.g. ASP -35% in June => periods=[2026-06], price_multiplier=0.65); forecast_upsert_prices then forecast_apply_price_list; forecast_adjust_material_costs (e.g. steel +12% => material_contains=steel, price_multiplier=1.12) is company-wide, every scenario and month; a change starting in a given month cannot be modelled yet, say so. Show the effect with forecast_financial_statements before and after.

SAFETY: a tool with a dry_run parameter (imports, forecast_apply_price_list, the adjusters) runs with dry_run=true first; show the user the counts and errors; call forecast_save_database before sweeping changes (replace modes delete the lines / rules they replace). Keep responses small: summaries by default, group_by / top_n / sections / limit for detail."""

# ---------------------------------------------------------------------------
# Result serialisation: one compact JSON text block
# ---------------------------------------------------------------------------

#: A tool result longer than this (characters of compact JSON) is replaced by
#: an error asking for a narrower request: Claude Code refuses MCP results over
#: ~25k tokens, and a refusal tells the model less than this message does.
#: MCP_MAX_RESPONSE_CHARS=0 switches the guard off.
try:
    MAX_RESPONSE_CHARS = int(os.getenv("MCP_MAX_RESPONSE_CHARS", "60000") or 0)
except ValueError:
    MAX_RESPONSE_CHARS = 60000


def _compact_number(value: float) -> Any:
    """Trim binary noise (30.500000000000004 -> 30.5, 2005668.0000000002 ->
    2005668) while keeping 12 significant digits, enough for any money or
    unit-cost figure in the model. NaN / infinity become null (valid JSON)."""
    if math.isnan(value) or math.isinf(value):
        return None
    trimmed = float(f"{value:.12g}")
    if trimmed.is_integer() and abs(trimmed) < 1e15:
        return int(trimmed)
    return trimmed


def compact(obj: Any) -> Any:
    """Recursively apply ``_compact_number`` to every float."""
    if isinstance(obj, float):
        return _compact_number(obj)
    if isinstance(obj, dict):
        return {k: compact(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [compact(v) for v in obj]
    return obj


def to_json_text(result: Any) -> str:
    """Compact JSON for a tool result (no whitespace, floats trimmed)."""
    return json.dumps(compact(result), separators=(",", ":"), ensure_ascii=False, default=str)


def _too_large_message(tool_name: str, size: int) -> str:
    return (
        f"The {tool_name} result is {size // 1000} KB, over the {MAX_RESPONSE_CHARS // 1000} KB response budget "
        f"(an assistant's tool-result limit). Nothing is wrong with the data; ask for less: a smaller limit, "
        f"a narrower period window, filters, sections=[...] / fields=[...] where the tool offers them, or "
        f"forecast_sql_query with GROUP BY for an aggregate."
    )


class _CompactFuncMetadata(FuncMetadata):
    """FuncMetadata whose results are one compact JSON text block.

    The SDK serialises a dict result twice: as indented JSON text AND as
    ``structuredContent``. For an LLM client that doubles the bytes and the
    indentation adds a third on top. The tools' declared return type is a
    plain ``Dict[str, Any]``, so the output schema carries no information
    and is dropped (tools are registered with ``structured_output=False``).
    """

    tool_name: str = ""

    def convert_result(self, result: Any) -> Any:
        if isinstance(result, CallToolResult) or type(result).__name__ == "InputRequiredResult":
            return super().convert_result(result)
        text = result if isinstance(result, str) else to_json_text(result)
        if MAX_RESPONSE_CHARS and len(text) > MAX_RESPONSE_CHARS:
            return CallToolResult(content=[TextContent(type="text", text=_too_large_message(self.tool_name, len(text)))],
                                  is_error=True)
        return CallToolResult(content=[TextContent(type="text", text=text)])


# ---------------------------------------------------------------------------
# Tool registration: strict arguments, tidy catalog
# ---------------------------------------------------------------------------

def _strict_arg_model(arg_model: Any, tool_name: str) -> Any:
    """Subclass of the SDK's argument model that rejects unknown arguments
    with a message listing the valid ones (and publishes
    ``additionalProperties: false`` in the input schema)."""
    allowed = [field.alias or name for name, field in arg_model.model_fields.items()]
    allowed_set = set(allowed)

    def _reject_unknown(cls, data: Any) -> Any:
        if isinstance(data, dict):
            unknown = [str(k) for k in data if k not in allowed_set]
            if unknown:
                raise PydanticCustomError(
                    "unknown_argument",
                    "unknown argument(s) {unknown}. Valid arguments: {allowed}. Nothing was run.",
                    {"unknown": ", ".join(unknown), "allowed": ", ".join(allowed) or "(none)"},
                )
        return data

    namespace = {
        "__module__": arg_model.__module__,
        # The class name heads pydantic's error text ("1 validation error for <tool>").
        "__qualname__": tool_name,
        # hide_input_in_errors: a rejected call must not echo (possibly thousands of) rows back.
        "model_config": ConfigDict(arbitrary_types_allowed=True, extra="forbid", hide_input_in_errors=True),
        "reject_unknown_arguments": model_validator(mode="before")(_reject_unknown),
    }
    return type(tool_name, (arg_model,), namespace)


_LIST_ITEM = re.compile(r"^([-*\u2022]|\d+[.)])\s")


def _clean_description(text: Optional[str]) -> str:
    """Docstring -> paragraphs with their wrapped lines joined (list items
    keep their own line), without the source indentation."""
    if not text:
        return ""
    paragraphs = []
    for block in re.split(r"\n\s*\n", inspect.cleandoc(text)):
        lines: List[str] = []
        for raw in block.splitlines():
            line = raw.strip()
            if not line:
                continue
            if lines and not _LIST_ITEM.match(line):
                lines[-1] = f"{lines[-1]} {line}"
            else:
                lines.append(line)
        paragraphs.append("\n".join(lines))
    return "\n\n".join(p for p in paragraphs if p).strip()


def _tidy_schema(schema: Dict[str, Any]) -> Dict[str, Any]:
    """Shrink the published input schema without changing what is accepted:
    drop the auto-generated titles ("Forecast Id"), and publish an optional
    ``X | None = None`` parameter as plain ``X`` (leaving it out means None;
    the argument model still accepts an explicit null). Together that is
    roughly a quarter of the tool catalog an assistant has to load."""
    schema.pop("title", None)
    for name, prop in list((schema.get("properties") or {}).items()):
        if not isinstance(prop, dict):
            continue
        prop.pop("title", None)
        variants = prop.get("anyOf")
        if (isinstance(variants, list) and len(variants) == 2 and {"type": "null"} in variants
                and "default" in prop and prop["default"] is None):
            other = next(v for v in variants if v != {"type": "null"})
            schema["properties"][name] = {**other, **{k: v for k, v in prop.items() if k not in ("anyOf", "default")}}
    return schema


def harden_tool(tool: Any) -> None:
    """Strict arguments + compact results + tidy description for one tool."""
    strict = _strict_arg_model(tool.fn_metadata.arg_model, tool.name)
    tool.fn_metadata = _CompactFuncMetadata(arg_model=strict, tool_name=tool.name)
    tool.parameters = _tidy_schema(strict.model_json_schema(by_alias=True))
    tool.description = _clean_description(tool.description)


class ForecastMCPServer(MCPServer):
    """MCPServer whose tools all get strict arguments and compact results.

    Every ``@mcp.tool(...)`` in ``mcp_server.tools`` (including modules added
    later) goes through ``add_tool``, so the behaviour cannot be forgotten
    on a new tool.
    """

    def add_tool(self, fn: Callable[..., Any], name: Optional[str] = None, title: Optional[str] = None,
                 description: Optional[str] = None, annotations: Optional[ToolAnnotations] = None,
                 icons: Optional[list] = None, meta: Optional[Dict[str, Any]] = None,
                 structured_output: Optional[bool] = None) -> None:
        super().add_tool(fn, name=name, title=title, description=description, annotations=annotations,
                         icons=icons, meta=meta, structured_output=False)
        tool = self._tool_manager.get_tool(name or fn.__name__)
        if tool is not None and not isinstance(tool.fn_metadata, _CompactFuncMetadata):
            harden_tool(tool)


mcp = ForecastMCPServer(SERVER_NAME, instructions=INSTRUCTIONS)

# DNS-rebinding protection for the HTTP transport: only localhost Host /
# Origin headers are accepted unless MCP_ALLOWED_HOSTS / MCP_ALLOWED_ORIGINS
# add more (comma-separated, e.g. "192.168.1.20:*", "host.docker.internal:*"
# for a client running in a container). Portless localhost covers a proxy or
# client that drops the default port; behind the bundled nginx (port 3000)
# the Host header keeps its port.
TRANSPORT_SECURITY = TransportSecuritySettings(
    enable_dns_rebinding_protection=True,
    allowed_hosts=["127.0.0.1:*", "localhost:*", "[::1]:*", "127.0.0.1", "localhost", "[::1]"]
    + [h.strip() for h in os.getenv("MCP_ALLOWED_HOSTS", "").split(",") if h.strip()],
    allowed_origins=["http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*",
                     "http://127.0.0.1", "http://localhost", "http://[::1]"]
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


# ---------------------------------------------------------------------------
# Response-size helpers shared by the tools
# ---------------------------------------------------------------------------

def table_columns(rows: List[Dict[str, Any]]) -> List[str]:
    """Union of the rows' keys, in first-seen order."""
    columns: List[str] = []
    seen = set()
    for row in rows:
        for key in row:
            if key not in seen:
                seen.add(key)
                columns.append(key)
    return columns


def as_table(rows: List[Dict[str, Any]], columns: Optional[List[str]] = None) -> Dict[str, Any]:
    """{columns, rows}: one array per row, so keys are not repeated on every
    row (roughly halves a list of records)."""
    cols = list(columns) if columns else table_columns(rows)
    return {"columns": cols, "rows": [[row.get(c) for c in cols] for row in rows]}


def page(rows: List[Any], limit: int, offset: int = 0) -> Dict[str, Any]:
    """Paging metadata for a list the tool slices itself."""
    total = len(rows)
    chunk = rows[offset:offset + limit]
    more = offset + len(chunk) < total
    return {
        "rows": chunk,
        "total_count": total,
        "returned": len(chunk),
        "offset": offset,
        "has_more": more,
        "next_offset": offset + len(chunk) if more else None,
    }


def trim_lists(obj: Any, max_items: int, *, path: str = "", skip: Tuple[str, ...] = ()) -> Tuple[Any, Dict[str, int]]:
    """Cut every list longer than ``max_items`` (at any depth) to its first
    ``max_items`` entries. Returns (trimmed copy, {json path: original length})
    so the caller can tell the model what was cut. Keys in ``skip`` are kept
    whole."""
    cut: Dict[str, int] = {}

    def walk(value: Any, where: str) -> Any:
        if isinstance(value, dict):
            return {k: (v if k in skip else walk(v, f"{where}.{k}" if where else str(k))) for k, v in value.items()}
        if isinstance(value, list):
            if len(value) > max_items:
                cut[where or "$"] = len(value)
                value = value[:max_items]
            return [walk(v, f"{where}[]") for v in value]
        return value

    return walk(obj, path), cut


def drop_keys(obj: Any, keys: Tuple[str, ...]) -> Any:
    """Copy of ``obj`` without the given keys at any depth (e.g. per-month
    arrays the caller did not ask for)."""
    if isinstance(obj, dict):
        return {k: drop_keys(v, keys) for k, v in obj.items() if k not in keys}
    if isinstance(obj, list):
        return [drop_keys(v, keys) for v in obj]
    return obj


def check_row_keys(rows: List[Dict[str, Any]], allowed: Tuple[str, ...], what: str = "rows") -> None:
    """Reject row objects with keys the endpoint would silently ignore."""
    allowed_set = set(allowed)
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            raise ToolError(f"{what}[{i}] must be an object")
        unknown = [k for k in row if k not in allowed_set]
        if unknown:
            raise ToolError(f"{what}[{i}] has unknown field(s) {', '.join(map(str, unknown))}; "
                            f"allowed: {', '.join(allowed)}. Nothing was written.")


def error_list(errors: List[Any], limit: int = 25) -> Dict[str, Any]:
    """First ``limit`` row errors plus the total count."""
    errors = list(errors or [])
    out: Dict[str, Any] = {"errors": errors[:limit], "error_count": len(errors)}
    if len(errors) > limit:
        out["errors_truncated"] = True
    return out


def format_row_errors(errors: List[Dict[str, Any]], limit: int = 15) -> str:
    """'row 3: Customer X does not exist; row 9: ...' for an error message."""
    parts = []
    for err in errors[:limit]:
        if isinstance(err, dict):
            label = f"row {err.get('row')}" if err.get("row") is not None else "row ?"
            parts.append(f"{label}: {err.get('error') or err.get('message') or err}")
        else:
            parts.append(str(err))
    more = f" (+{len(errors) - limit} more)" if len(errors) > limit else ""
    return "; ".join(parts) + more
