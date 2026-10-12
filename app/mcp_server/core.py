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
* Change history: the in-process client sends ``X-Forecast-Client: mcp``,
  so the API's audit middleware records every REST write a tool makes with
  client 'mcp'. A write tool that changes the database without a REST call
  (the bulk adjusters) is recorded here instead (``ForecastMCPServer.call_tool``).
  A write refused because a scenario is approved and locked comes back as a
  plain explanation, never a bare crash.
"""
from __future__ import annotations

import contextvars
import inspect
import json
import logging
import math
import os
import re
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

import anyio
import httpx
from pydantic import ConfigDict, model_validator
from pydantic_core import PydanticCustomError
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError, UnexpectedToolError
from mcp.server.mcpserver.utilities.func_metadata import FuncMetadata
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import CallToolResult, TextContent, ToolAnnotations

SERVER_NAME = "forecast"

# The tools call the API in-process; one log line per internal request is noise.
logging.getLogger("httpx").setLevel(logging.WARNING)

INSTRUCTIONS = """Financial model of a manufacturer: monthly (YYYY-MM) sales by customer and product, gross-to-net deductions, BOM / routing product costs, payroll, expenses, loans, capex -> income statement, cash flow, balance sheet. Writes go straight to the database; the user sees them after refreshing the web UI.

Start with forecast_get_overview (scenarios, base scenario, sales windows). Sales belong to one scenario (forecast_id, e.g. F001); prices, deduction rules, payroll, expenses and capex are per scenario or company-wide (forecast_id null). Products, BOMs, routings, machines and labor rates are company-wide.

BUILDING A MODEL (in this order; forecast_list_import_templates gives each step's columns and header aliases, forecast_preview_file shows a file's columns first):
1 customers with customer_type (Dealer, Distributor...; drives prices and deductions) -> 2 products (unit_id, unit_name, unit_type e.g. Rifle/Pistol, base_price) -> 3 machines ($/h, monthly capacity) and labor rates ($/h): all forecast_import_records -> 4 forecast_import_routings -> 5 forecast_import_boms (a unit_id column links products) -> 6 prices by customer type / customer (forecast_import_prices or forecast_upsert_prices) -> 7 deduction rules (forecast_import_deductions / forecast_upsert_deduction_rules) -> 8 sales forecast (forecast_import_sales into a scenario; a row per month or a column per month; quarters / weeks rejected; a blank unit_price comes from the price list, then base_price; unknown ids are errors unless auto_create) -> 9 check warnings, forecast_data_quality, forecast_cogs_forecast group_by=unit_costs (missing BOM / routing / rate = understated COGS) -> 10 forecast_cogs_forecast, forecast_labor_forecast, forecast_financial_statements -> 11 forecast_export_workbook (Excel, saved in the data folder's exports/).
Import tools take rows or file_path (relative to the data folder, ./data on the host in Docker; other folders need FORECAST_ALLOW_ABSOLUTE_PATHS=1 on the API).

GROSS TO NET: gross sales (qty x price) - terms allowance - chargebacks - other allowances - excise tax = net sales (the statements' revenue). Commissions are a selling expense below gross profit. Rates are fractions: 2% = 0.02 (imports also accept '2%'). Methods: percent_of_gross; embedded_tax = price x rate / (1 + rate), so FET included in the price at 11% is excise_tax, embedded_tax, rate 0.11 ($1,110 invoice -> $110 tax); percent_of_net; per_unit. Which rule applies: SPECIFICITY FIRST (customer 8 + customer type 4 + product 2 + product type 1; highest wins). Only on equal specificity does a scenario rule beat a company-wide one: a scenario rule for all customers does NOT override a company-wide Dealer rule, so scope it the same (customer_type Dealer). One terms / chargebacks / excise / commission rule per sale; other_allowance rules are programs named by the rule name (Co-op, Freight): matching programs add up. Types stack; rate 0 = exemption (Government exempt from FET). Prices use the same specificity, then the product's base_price. Verify with forecast_simulate_deductions, forecast_resolve_price, forecast_deduction_preview.

ADJUSTING: forecast_branch_scenario to compare; forecast_adjust_sales (e.g. ASP -35% in June => periods=[2026-06], price_multiplier=0.65); forecast_upsert_prices then forecast_apply_price_list; forecast_adjust_material_costs (e.g. steel +12% => material_contains=steel, price_multiplier=1.12) is company-wide, every scenario and month; a change starting in a given month cannot be modelled yet, say so. Show the effect with forecast_financial_statements before and after.

SAFETY: a tool with a dry_run parameter (imports, forecast_apply_price_list, the adjusters) runs with dry_run=true first; show the user the counts and errors; call forecast_save_database before sweeping changes (replace modes delete the lines / rules they replace). Keep responses small: summaries by default, group_by / top_n / sections / limit for detail.
Approved = locked: branch to change."""

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
        f"(an assistant's tool-result limit). Nothing is wrong with the data and nothing was changed; ask for "
        f"less: a smaller limit / top_n, a narrower period window, filters, sections=[...] / fields=[...] where "
        f"the tool offers them, or forecast_sql_query with GROUP BY for an aggregate."
    )


#: List lengths tried, longest first, when a write tool's result must be cut to fit.
_WRITE_TRIM_STEPS = (100, 50, 25, 10, 5, 2, 1, 0)


def _fit_write_result(tool_name: str, text: str) -> str:
    """
    A WRITE tool's oversized result, cut to fit the budget instead of being
    turned into an error: the tool has already run, so an error would invite
    a retry that writes the same data again. Counts and other scalars are
    kept; lists are cut to their first entries (``result_truncated`` gives
    each cut list's full length) and the note says the write was applied.
    """
    try:
        payload = json.loads(text)
    except ValueError:
        payload = None
    dry_run = isinstance(payload, dict) and payload.get("dry_run") is True
    note = (f"{tool_name} completed; its result was cut to fit the {MAX_RESPONSE_CHARS // 1000} KB response "
            f"budget. " + ("This was a dry run: nothing was written." if dry_run else
                           "The write WAS applied: do not call it again for the same rows. Read the details "
                           "with the list / query tools."))
    budget = MAX_RESPONSE_CHARS
    if isinstance(payload, (dict, list)):
        for max_items in _WRITE_TRIM_STEPS:
            trimmed, cut = trim_lists(payload, max_items)
            wrapped = dict(trimmed) if isinstance(trimmed, dict) else {"items": trimmed}
            wrapped["result_truncated"] = {"note": note, "lists_cut": cut}
            candidate = to_json_text(wrapped)
            if len(candidate) <= budget:
                return candidate
        if isinstance(payload, dict):  # long text values: keep the numbers and flags only
            scalars = {k: v for k, v in payload.items() if isinstance(v, (int, float, bool)) or v is None}
            scalars["result_truncated"] = {"note": note, "kept": "numbers and flags only"}
            candidate = to_json_text(scalars)
            if len(candidate) <= budget:
                return candidate
    return to_json_text({"result_truncated": {"note": note}, "result_start": text[:max(0, budget // 2)]})


class _CompactFuncMetadata(FuncMetadata):
    """FuncMetadata whose results are one compact JSON text block.

    The SDK serialises a dict result twice: as indented JSON text AND as
    ``structuredContent``. For an LLM client that doubles the bytes and the
    indentation adds a third on top. The tools' declared return type is a
    plain ``Dict[str, Any]``, so the output schema carries no information
    and is dropped (tools are registered with ``structured_output=False``).

    Over the response budget, a READ-ONLY tool's result becomes an error
    asking for a narrower request (nothing happened, so asking again is
    safe); any other tool's result is cut to fit and stays a success that
    says the write was applied (see ``_fit_write_result``).
    """

    tool_name: str = ""
    read_only: bool = True

    def convert_result(self, result: Any) -> Any:
        if isinstance(result, CallToolResult) or type(result).__name__ == "InputRequiredResult":
            return super().convert_result(result)
        text = result if isinstance(result, str) else to_json_text(result)
        if MAX_RESPONSE_CHARS and len(text) > MAX_RESPONSE_CHARS:
            if not self.read_only:
                return CallToolResult(content=[TextContent(type="text", text=_fit_write_result(self.tool_name, text))])
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
    read_only = bool(tool.annotations is not None and tool.annotations.read_only_hint)
    tool.fn_metadata = _CompactFuncMetadata(arg_model=strict, tool_name=tool.name, read_only=read_only)
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

    async def call_tool(self, name: str, arguments: Dict[str, Any], context: Any = None) -> Any:
        """
        Run a tool, turning a scenario-lock refusal into a plain error and
        recording a write tool that changed the database without a REST call
        (the bulk adjusters) in the change history.
        """
        writes = [0]
        token = _REST_WRITES.set(writes)
        started = time.perf_counter()
        status: Optional[int] = 200
        result = None
        try:
            result = await super().call_tool(name, arguments, context)
            if isinstance(result, CallToolResult) and result.is_error:
                status = None
            return result
        except UnexpectedToolError as exc:
            if _is_lock_error(exc):
                status = 409
                raise ToolError(f"Error executing tool {name}: {_lock_text(arguments)} Nothing was changed.") from exc
            status = 500
            raise
        except ToolError:
            # Refused input (bad arguments, a missing filter ...): nothing ran, nothing to record.
            status = None
            raise
        finally:
            _REST_WRITES.reset(token)
            if writes[0] == 0 and status is not None:
                await self._record_direct_write(name, arguments, status, result, started)

    async def _record_direct_write(self, name: str, arguments: Dict[str, Any], status: int, result: Any,
                                   started: float) -> None:
        tool = self._tool_manager.get_tool(name)
        if tool is None or (tool.annotations is not None and tool.annotations.read_only_hint):
            return
        try:
            from services.governance import body_excerpt, record_audit, utc_now

            payload = _result_payload(result)
            args = arguments if isinstance(arguments, dict) else {}
            fid = args.get("forecast_id")
            if not fid and isinstance(args.get("forecast_ids"), list) and args["forecast_ids"]:
                fid = args["forecast_ids"][0]
            entry = {
                "created_at": utc_now(),
                "client": "mcp",
                "actor": None,
                "method": "TOOL",
                "path": f"/mcp/tools/{name}",
                "query": None,
                "status": status,
                "forecast_id": str(fid)[:40] if fid else None,
                "summary": _tool_summary(name, status, payload),
                "body_excerpt": body_excerpt("application/json", json.dumps(args, default=str).encode(), args),
                "duration_ms": int((time.perf_counter() - started) * 1000),
            }
            await anyio.to_thread.run_sync(record_audit, entry)
        except Exception:  # the history must never break a tool call
            logging.getLogger(__name__).exception("Could not record MCP tool %s in the change history", name)


#: Per tool call: how many REST writes (non-GET requests) it made through ``api``.
_REST_WRITES: contextvars.ContextVar = contextvars.ContextVar("forecast_mcp_rest_writes", default=None)


def _is_lock_error(exc: BaseException) -> bool:
    seen = 0
    while exc is not None and seen < 10:
        if "SCENARIO_LOCKED" in str(exc):
            return True
        exc = exc.__cause__ or exc.__context__
        seen += 1
    return False


def _lock_text(arguments: Any) -> str:
    from services.governance import locked_message, locked_scenario_name

    fid = arguments.get("forecast_id") if isinstance(arguments, dict) else None
    _fid, name = locked_scenario_name(fid)
    return (locked_message(name).replace("branch it", "branch it (forecast_branch_scenario)")
            .replace("unlock it with a reason", "unlock it with the user's reason (forecast_unlock_scenario)"))


def _result_payload(result: Any) -> Any:
    if isinstance(result, CallToolResult):
        text = "".join(getattr(block, "text", "") or "" for block in result.content or [])
        try:
            return json.loads(text)
        except ValueError:
            return text
    return result


def _plain_adjustment(payload: Dict[str, Any]) -> Optional[str]:
    """'Material costs (company-wide): 2 BOM lines changed, $270 -> $302.40 per set' and the like."""
    def money(value: Any) -> str:
        try:
            return f"${float(value):,.2f}"
        except (TypeError, ValueError):
            return "?"
    if "matched_lines" in payload:
        totals = payload.get("material_cost_total") or {}
        phrase = (payload.get("filters") or {}).get("material_contains")
        verb = "would change" if payload.get("dry_run") else "changed"
        return (f"Material costs (company-wide{', ' + repr(phrase) if phrase else ''}): {payload.get('matched_lines')} BOM "
                f"line(s) {verb}, material cost {money(totals.get('before'))} -> {money(totals.get('after'))}")
    if "matched_rows" in payload and "revenue_change" in payload:
        verb = "would change" if payload.get("dry_run") else "changed"
        change = float(payload.get("revenue_change") or 0)
        return (f"Sales of {payload.get('forecast_id')}: {payload.get('matched_rows')} row(s) {verb}, revenue "
                f"{'+' if change >= 0 else '-'}{money(abs(change))}")
    return None


def _tool_summary(name: str, status: int, payload: Any) -> str:
    plain = _plain_adjustment(payload) if isinstance(payload, dict) and status < 400 else None
    if plain:
        return (("Dry run: " if payload.get("dry_run") is True else "") + plain)[:300]
    if isinstance(payload, dict):
        text = payload.get("message") or payload.get("summary")
        if not text:
            numbers = [f"{k}={v}" for k, v in payload.items()
                       if isinstance(v, (int, float)) and not isinstance(v, bool)][:5]
            text = ", ".join(numbers)
        prefix = "Dry run: " if payload.get("dry_run") is True else ""
        text = f"{prefix}{text}" if text else prefix.strip()
    else:
        text = str(payload or "")[:200]
    head = f"MCP tool {name}" + ("" if status < 400 else f" refused ({status})")
    return (f"{head}: {text}" if text else head)[:300]


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
# destructive_hint follows the MCP spec: true unless the tool ONLY adds new
# records, so anything that overwrites or deletes stored values is destructive
# (clients may ask the user before running it).
#: Reads nothing but the model; never changes it.
READ = ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True, open_world_hint=False)
#: Only adds new records (a repeat adds them again).
WRITE = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False, open_world_hint=False)
#: Creates or overwrites records; repeating the same call leaves the same state.
UPSERT = ToolAnnotations(read_only_hint=False, destructive_hint=True, idempotent_hint=True, open_world_hint=False)
#: Deletes records, or changes them relative to their current values (a repeat changes them again).
DESTRUCTIVE = ToolAnnotations(read_only_hint=False, destructive_hint=True, idempotent_hint=False, open_world_hint=False)


# ---------------------------------------------------------------------------
# In-process API client
# ---------------------------------------------------------------------------

_fastapi_app: Any = None

#: Sent with every in-process request: the audit middleware records these calls with client 'mcp'.
CLIENT_HEADERS = {"X-Forecast-Client": "mcp"}


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
    """
    Call a REST endpoint of the running app and return the parsed body.
    Sends ``X-Forecast-Client: mcp`` so the change history records the call
    as made by an MCP tool.
    """
    if str(method).upper() not in ("GET", "HEAD", "OPTIONS"):
        counter = _REST_WRITES.get()
        if counter is not None:
            counter[0] += 1
    transport = httpx.ASGITransport(app=get_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://forecast.internal",
                                 headers=CLIENT_HEADERS) as client:
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


#: Row lists of the generic read tools (forecast_query_table, forecast_sql_query) are cut to fit this many
#: characters, so a default call on a wide table returns a page instead of an over-budget error.
ROWS_BUDGET_CHARS = 40_000


def fit_rows(rows: List[Any], budget: int = ROWS_BUDGET_CHARS) -> int:
    """How many leading ``rows`` fit in ``budget`` characters of compact JSON (always at least one)."""
    total = 2
    for i, row in enumerate(rows):
        total += len(to_json_text(row)) + 1
        if total > budget and i > 0:
            return i
    return len(rows)


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
