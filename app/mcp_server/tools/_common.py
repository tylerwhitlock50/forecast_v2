"""
Shared helpers for the build-workflow tool modules (imports, pricing,
forecasts).

* ``register`` registers a tool that returns ONE compact JSON text block
  (no pretty-printing, no duplicate structuredContent: every response goes
  into the calling model's context) and rejects unknown arguments, so a
  misspelled filter (``customer_type`` for ``customer_types``) is an error
  instead of silently widening a write to the whole scenario.
* ``out`` / ``table`` / ``cap`` / ``compact_warnings`` keep responses small.
* ``scenario_window`` fills a reporting window from the scenarios' sales
  windows (GET /forecast/scenario/{id}) when the caller leaves it out.
"""
import json
import math
import re
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import quote

from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import ConfigDict, model_validator
from pydantic_core import PydanticCustomError

from mcp_server.core import call, mcp

MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register(name: str, annotations: ToolAnnotations) -> Callable:
    """
    ``@mcp.tool`` with compact text output and unknown arguments rejected.

    The tools return ``out(...)`` strings, so the result is one compact text
    block whether or not the server itself compacts results. When the server
    already registers tools with strict arguments (``extra='forbid'``) this
    adds nothing; otherwise it installs the strict argument model here.
    """

    def decorator(fn: Callable) -> Callable:
        mcp.tool(name=name, annotations=annotations, structured_output=False)(fn)
        tool = mcp._tool_manager.get_tool(name)  # the SDK has no public accessor for the Tool object
        if tool is not None and tool.fn_metadata.arg_model.model_config.get("extra") != "forbid":
            _forbid_unknown_arguments(tool)
        return fn

    return decorator


def _forbid_unknown_arguments(tool: Any) -> None:
    name = tool.name
    base = tool.fn_metadata.arg_model
    allowed = set()
    for field_name, info in base.model_fields.items():
        allowed.add(field_name)
        if info.alias:
            allowed.add(info.alias)
    listing = ", ".join(sorted(info.alias or n for n, info in base.model_fields.items()))

    class StrictArguments(base):  # type: ignore[misc, valid-type]
        # hide_input_in_errors: a rejected call must not echo (possibly thousands of) rows back.
        model_config = ConfigDict(arbitrary_types_allowed=True, extra="forbid", hide_input_in_errors=True)

        @model_validator(mode="before")
        @classmethod
        def _reject_unknown(cls, data: Any) -> Any:
            if isinstance(data, dict):
                unknown = sorted(str(k) for k in data if k not in allowed)
                if unknown:
                    raise PydanticCustomError(
                        "unknown_argument", "unknown argument(s) {unknown}. This tool takes: {allowed}",
                        {"unknown": ", ".join(unknown), "allowed": listing},
                    )
            return data

    # The class name heads pydantic's error text ("1 validation error for <tool>").
    StrictArguments.__name__ = name
    StrictArguments.__qualname__ = name
    tool.fn_metadata.arg_model = StrictArguments
    tool.parameters["additionalProperties"] = False


# ---------------------------------------------------------------------------
# Compact output
# ---------------------------------------------------------------------------

def _clean(value: Any) -> Any:
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        value = round(value, 4)
        if value == 0:
            return 0
        return int(value) if value.is_integer() and abs(value) < 1e15 else value
    if isinstance(value, dict):
        return {str(k): _clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    return value


def out(payload: Any) -> str:
    """Compact JSON (floats rounded to 4 dp, 1000.0 -> 1000) for the tool result."""
    return json.dumps(_clean(payload), separators=(",", ":"), ensure_ascii=False, default=str)


def table(rows: Iterable[Dict[str, Any]], columns: Sequence[str]) -> Dict[str, Any]:
    """{columns, rows} with one list per row: keys are not repeated on every row."""
    return {"columns": list(columns), "rows": [[row.get(c) for c in columns] for row in rows]}


def cap(items: Optional[List[Any]], limit: int) -> Tuple[List[Any], int]:
    """(first `limit` items, how many were left out)."""
    items = list(items or [])
    return items[:limit], max(0, len(items) - limit)


def put_capped(target: Dict[str, Any], key: str, items: Optional[List[Any]], limit: int) -> None:
    """target[key] = first `limit` items; target[key + '_omitted'] = the rest's count when > 0."""
    kept, omitted = cap(items, limit)
    if kept:
        target[key] = kept
    if omitted:
        target[f"{key}_omitted"] = omitted


def compact_warnings(warnings: Optional[List[Any]], limit: int = 15, products_limit: int = 10) -> List[Any]:
    """Warnings as short strings / {code, message} objects; long product maps are truncated."""
    result: List[Any] = []
    for w in warnings or []:
        if isinstance(w, dict):
            item: Dict[str, Any] = {"code": w.get("code"), "message": w.get("message")}
            if w.get("level") and w.get("level") != "warning":
                item["level"] = w["level"]
            for key in ("machine_id", "rule_id", "periods", "labor_type_ids"):
                if w.get(key):
                    item[key] = w[key]
            products = w.get("products")
            if isinstance(products, dict) and products:
                shown = dict(list(products.items())[:products_limit])
                item["products"] = shown
                if len(products) > products_limit:
                    item["products_omitted"] = len(products) - products_limit
            result.append(item)
        else:
            result.append(w)
    kept, omitted = cap(result, limit)
    if omitted:
        kept.append(f"... {omitted} more warnings")
    return kept


def drop_empty(record: Dict[str, Any], keep: Sequence[str] = ()) -> Dict[str, Any]:
    """Drop None / '' / [] / {} values except the keys in `keep`."""
    return {k: v for k, v in record.items() if k in keep or v not in (None, "", [], {})}


# ---------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------

def clean_ids(values: Optional[Sequence[str]], name: str) -> List[str]:
    ids = [str(v).strip() for v in (values or []) if v is not None and str(v).strip()]
    if not ids:
        raise ToolError(f"{name} needs at least one scenario id, e.g. ['F001'] (see forecast_list_scenarios)")
    return ids


async def scenario_window(forecast_ids: Sequence[str], start_period: Optional[str],
                          end_period: Optional[str]) -> Tuple[str, str, Optional[str]]:
    """
    (start, end, sales_window): the window to report, as given or filled
    from the scenarios' monthly sales windows, plus the sales window as text
    ('2027-01..2027-12', None without sales) for "no sales" hints. Unknown
    scenario ids are an error.
    """
    start = (start_period or "").strip() or None
    end = (end_period or "").strip() or None
    starts: List[str] = []
    ends: List[str] = []
    for fid in forecast_ids:  # also rejects unknown ids (the report endpoints would return zeros)
        try:
            scenario = await call("GET", f"/forecast/scenario/{quote(fid, safe='')}")
        except ToolError as exc:
            if "404" in str(exc):
                raise ToolError(f"Scenario '{fid}' not found; see forecast_list_scenarios")
            raise
        if scenario.get("start_period") and MONTH_RE.match(str(scenario["start_period"])):
            starts.append(scenario["start_period"])
        if scenario.get("end_period") and MONTH_RE.match(str(scenario["end_period"])):
            ends.append(scenario["end_period"])
    sales_window = f"{min(starts)}..{max(ends)}" if starts and ends else None
    start = start or (min(starts) if starts else None)
    end = end or (max(ends) if ends else None)
    if not (start and end):
        raise ToolError(
            f"Scenario(s) {', '.join(forecast_ids)} have no monthly sales yet, so there is no default window; "
            f"give start_period and end_period (YYYY-MM)"
        )
    return start, end, sales_window


def no_sales_hint(sales_lines: Any, start: str, end: str, sales_window: Optional[str]) -> Optional[str]:
    if sales_lines:
        return None
    if sales_window:
        return f"No sales rows in {start}..{end}; this scenario's sales run {sales_window}."
    return "This scenario has no sales rows yet: import the forecast with forecast_import_sales."


# ---------------------------------------------------------------------------
# Sales detail totals: per-line (rounded) vs statement-exact
# ---------------------------------------------------------------------------

ROUNDING_NOTE = ("totals add up the rows as shown (each line rounded to the cent, = SUM in Excel); report_totals "
                 "add up the unrounded lines and match the income statement / COGS forecast exactly; rounding = "
                 "report_totals - totals (per-line cent rounding, usually a few cents). Quote report_totals as "
                 "the scenario's figures.")


def report_totals_block(body: Dict[str, Any]) -> Dict[str, Any]:
    """
    ``report_totals`` (statement-exact) and the non-zero ``rounding`` of a
    /reporting/sales-detail answer, with ``rounding_note``; {} when the
    answer has no report_totals (no rows).
    """
    report = body.get("report_totals")
    if not report:
        return {}
    rounding = {k: v for k, v in (body.get("rounding") or {}).items() if isinstance(v, (int, float)) and v}
    return {"report_totals": report, "rounding": rounding, "rounding_note": ROUNDING_NOTE}
