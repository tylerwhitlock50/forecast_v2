"""
Pricing and sales-deduction tools: the customer / customer-type price list
and the deduction rules (terms allowance, chargebacks, other allowances,
embedded excise tax, commissions). Thin wrappers over /pricing/*; all rule
matching and maths live in services.pricing and the statements engine.

Rates are fractions: 0.02 = 2%. Federal excise tax included in the price at
11% is deduction_type excise_tax, method embedded_tax, rate 0.11: tax =
price x 0.11 / 1.11 (a $1,110 invoice carries $110 of FET).
"""
from typing import Annotated, Any, Dict, List, Literal, Optional
from urllib.parse import quote

from mcp.server.mcpserver.exceptions import ToolError
from pydantic import Field

from mcp_server.core import DESTRUCTIVE, READ, UPSERT, WRITE, call, require
from mcp_server.tools._common import cap, compact_warnings, drop_empty, out, put_capped, register

DEDUCTION_TYPES = ("terms_allowance", "chargebacks", "other_allowance", "excise_tax", "commission")
RULE_FIELDS = ("forecast_id", "deduction_type", "name", "method", "rate", "amount_per_unit", "customer_id",
               "customer_type", "unit_id", "unit_type", "start_period", "end_period", "is_active", "notes")
PRICE_FIELDS = ("forecast_id", "unit_id", "customer_id", "customer_type", "method", "unit_price", "discount_pct",
                "start_period", "end_period", "is_active", "notes")
#: Keys a listing returns that are not editable; dropped when a listed rule is sent back.
READ_ONLY_KEYS = {"scope", "specificity", "company_wide", "is_company_wide", "deduction_label", "treatment",
                  "statement_line", "method_description", "created_at", "updated_at", "unit_name", "customer_name",
                  "base_price", "effective_price", "source"}

Period = Annotated[Optional[str], Field(description="YYYY-MM")]
Scenario = Annotated[Optional[str], Field(
    description="Scenario id: its own rules plus company-wide ones. Omit for company-wide only "
                "(list tools: omit for every rule)")]


# ---------------------------------------------------------------------------
# Shaping
# ---------------------------------------------------------------------------

def compact_rule(rule: Dict[str, Any]) -> Dict[str, Any]:
    """A deduction rule without labels, timestamps or empty scope fields."""
    item = {k: rule.get(k) for k in ("rule_id", "deduction_type", "name", "method")}
    if rule.get("method") == "per_unit":
        item["amount_per_unit"] = rule.get("amount_per_unit")
    else:
        item["rate"] = rule.get("rate")
    for key in ("customer_id", "customer_type", "unit_id", "unit_type", "start_period", "end_period", "notes"):
        if rule.get(key) not in (None, ""):
            item[key] = rule[key]
    item["scope"] = rule.get("scope")
    item["forecast_id"] = rule.get("forecast_id")  # null = company-wide
    if rule.get("is_active") is False or rule.get("is_active") == 0:
        item["is_active"] = False
    if rule.get("specificity") is not None:
        item["specificity"] = rule["specificity"]
    return item


def compact_price(price: Dict[str, Any]) -> Dict[str, Any]:
    item = {"price_id": price.get("price_id"), "unit_id": price.get("unit_id"), "unit_name": price.get("unit_name")}
    for key in ("customer_id", "customer_name", "customer_type"):
        if price.get(key):
            item[key] = price[key]
    item["method"] = price.get("method")
    if price.get("method") == "discount_from_base":
        item["discount_pct"] = price.get("discount_pct")
    else:
        item["unit_price"] = price.get("unit_price")
    item["effective_price"] = price.get("effective_price")
    if price.get("base_price") is not None:
        item["base_price"] = price["base_price"]
    item["source"] = price.get("source")
    for key in ("start_period", "end_period", "notes"):
        if price.get(key):
            item[key] = price[key]
    item["forecast_id"] = price.get("forecast_id")
    if price.get("is_active") is False or price.get("is_active") == 0:
        item["is_active"] = False
    return item


def _check_fields(item: Dict[str, Any], allowed: tuple, label: str, id_key: str) -> None:
    unknown = sorted(k for k in item if k not in allowed and k != id_key)
    if unknown:
        raise ToolError(f"{label}: unknown field(s) {', '.join(unknown)}. Allowed: {id_key}, {', '.join(allowed)}")


async def _upsert(items: List[Dict[str, Any]], *, id_key: str, allowed: tuple, path: str, bulk_key: str,
                  label: str, shape) -> Dict[str, Any]:
    """Create the items without an id in one all-or-nothing call, then update the others one by one."""
    for index, item in enumerate(items):
        if not isinstance(item, dict) or not item:
            raise ToolError(f"{label} {index}: must be a non-empty object")
    items = [{k: v for k, v in item.items() if k not in READ_ONLY_KEYS} for item in items]
    for index, item in enumerate(items):
        _check_fields(item, allowed, f"{label} {index}", id_key)
        if item.get(id_key) and len(item) == 1:
            raise ToolError(f"{label} {index}: only {id_key} given; add the fields to change")
    creates = [(i, item) for i, item in enumerate(items) if not item.get(id_key)]
    updates = [(i, item) for i, item in enumerate(items) if item.get(id_key)]
    result: Dict[str, Any] = {"created": [], "updated": [], "warnings": []}
    if creates:
        body = await call("POST", path, json={bulk_key: [item for _, item in creates]})
        result["created"] = [shape(r) for r in body.get(bulk_key) or []]
        result["warnings"].extend(body.get("warnings") or [])
    errors = []
    for index, item in updates:
        item_id = str(item[id_key]).strip()
        changes = {k: v for k, v in item.items() if k != id_key}
        try:
            body = await call("PUT", f"{path}/{quote(item_id, safe='')}", json=changes)
        except ToolError as exc:
            errors.append({"index": index, id_key: item_id, "error": str(exc)})
            continue
        record = body.get("rule") or body.get("price") or {}
        result["updated"].append(shape(record))
        result["warnings"].extend(body.get("warnings") or [])
    if errors and not (result["created"] or result["updated"]):
        raise ToolError("Nothing was changed: " + "; ".join(f"{label} {e['index']} ({e[id_key]}): {e['error']}"
                                                            for e in errors[:10]))
    if errors:
        result["errors"] = errors
        result["status"] = "partial"
    if not result["warnings"]:
        result.pop("warnings")
    else:
        result["warnings"] = compact_warnings(result["warnings"], 20)
    return result


# ---------------------------------------------------------------------------
# Deduction rules
# ---------------------------------------------------------------------------

@register("forecast_list_deduction_rules", READ)
async def list_deduction_rules(
    forecast_id: Scenario = None,
    deduction_type: Annotated[Optional[Literal["terms_allowance", "chargebacks", "other_allowance", "excise_tax",
                                               "commission"]], Field(description="Only this type")] = None,
    include_inactive: Annotated[bool, Field(description="Include rules switched off with is_active=false")] = True,
    include_catalog: Annotated[bool, Field(
        description="Also return the deduction types (statement treatment), methods and the worked example")] = False,
) -> str:
    """Sales deduction rules (terms allowance, chargebacks, other allowances,
    excise tax, commissions) with their scope and specificity (customer 8 +
    customer type 4 + product 2 + product type 1; the most specific matching
    rule of each type applies to a sale, a rate of 0 is an exemption).
    Rates are fractions (0.02 = 2%). forecast_id null = company-wide."""
    body = await call("GET", "/pricing/deductions", params={
        "forecast_id": forecast_id, "deduction_type": deduction_type, "include_inactive": include_inactive,
    })
    rules = [compact_rule(r) for r in body.get("rules") or []]
    counts: Dict[str, int] = {}
    for r in rules:
        counts[r["deduction_type"]] = counts.get(r["deduction_type"], 0) + 1
    result: Dict[str, Any] = {"forecast_id": forecast_id, "count": len(rules), "by_type": counts, "rules": rules}
    if include_catalog:
        catalog = await call("GET", "/pricing/deduction-types")
        result["catalog"] = {
            "types": {t["deduction_type"]: f"{t.get('label')}: {t.get('treatment')}" for t in catalog.get("deduction_types") or []},
            "methods": {m["method"]: m.get("description") for m in catalog.get("methods") or []},
            "example": catalog.get("example"),
            "precedence": catalog.get("precedence"),
        }
    return out(result)


@register("forecast_upsert_deduction_rules", UPSERT)
async def upsert_deduction_rules(
    rules: Annotated[List[Dict[str, Any]], Field(
        description="Rules to create (no rule_id) or partially update (rule_id + only the fields to change; null "
                    "clears a scope field). Fields: deduction_type (terms_allowance | chargebacks | other_allowance | "
                    "excise_tax | commission), method (percent_of_gross default; embedded_tax default for excise; "
                    "percent_of_net; per_unit), rate as a FRACTION (2% = 0.02; FET 11% embedded = method "
                    "embedded_tax, rate 0.11; 0 = exemption), amount_per_unit ($ per unit, per_unit only), name, "
                    "customer_id, customer_type, unit_id, unit_type (scope; omit = any), start_period, end_period "
                    "(YYYY-MM), forecast_id (omit = company-wide), is_active, notes.",
        min_length=1)],
) -> str:
    """Create or update sales deduction rules. Creations are all-or-nothing
    (any invalid rule -> nothing created, every problem listed); updates are
    applied rule by rule and failures are reported. Examples: dealer terms
    2% => {deduction_type: terms_allowance, customer_type: Dealer, rate:
    0.02}; FET => {deduction_type: excise_tax, method: embedded_tax, rate:
    0.11}; government exempt from FET => {deduction_type: excise_tax,
    customer_type: Government, rate: 0}; distributor commission 3% of net =>
    {deduction_type: commission, method: percent_of_net, customer_type:
    Distributor, rate: 0.03}. Verify with forecast_simulate_deductions."""
    result = await _upsert(rules, id_key="rule_id", allowed=RULE_FIELDS, path="/pricing/deductions",
                           bulk_key="rules", label="rules", shape=compact_rule)
    return out(result)


@register("forecast_delete_deduction_rule", DESTRUCTIVE)
async def delete_deduction_rule(
    rule_id: Annotated[str, Field(description="rule_id from forecast_list_deduction_rules, e.g. 'DED-1A2B3C4D'")],
) -> str:
    """Delete one deduction rule. To switch a rule off but keep it, upsert
    it with is_active=false instead."""
    body = await call("DELETE", f"/pricing/deductions/{quote(require(rule_id, 'rule_id'), safe='')}")
    deleted = body.get("deleted") or {}
    return out({"deleted": compact_rule(deleted) if deleted else rule_id, "message": body.get("message")})


@register("forecast_simulate_deductions", READ)
async def simulate_deductions(
    gross: Annotated[Optional[float], Field(description="Invoice amount (gross sales) of the line, e.g. 1110")] = None,
    unit_price: Annotated[Optional[float], Field(description="Instead of gross: price per unit (x quantity)")] = None,
    quantity: Annotated[Optional[float], Field(description="Units (per_unit rules; default 1)")] = None,
    customer_id: Annotated[Optional[str], Field(description="Customer; its customer_type is looked up")] = None,
    customer_type: Annotated[Optional[str], Field(description="Customer type when no specific customer")] = None,
    unit_id: Annotated[Optional[str], Field(description="Product; its unit_type is looked up")] = None,
    unit_type: Annotated[Optional[str], Field(description="Product type when no specific product")] = None,
    period: Period = None,
    forecast_id: Annotated[Optional[str], Field(
        description="Scenario whose rules apply (plus company-wide); omit for company-wide rules only")] = None,
) -> str:
    """Which deduction rule wins for one hypothetical invoice line and what
    it deducts: per type the winning rule, the amount and the rules it
    overrides, then gross -> total deductions -> net sales -> commission,
    with the arithmetic spelled out. Example: gross 1110 with an 11%
    embedded FET rule -> excise 110, net 1000."""
    if gross is None and unit_price is None:
        raise ToolError("Give gross (invoice amount) or unit_price (and quantity)")
    payload = {k: v for k, v in {
        "gross": gross, "unit_price": unit_price, "quantity": quantity, "customer_id": customer_id,
        "customer_type": customer_type, "unit_id": unit_id, "unit_type": unit_type, "period": period,
        "forecast_id": forecast_id,
    }.items() if v is not None}
    body = await call("POST", "/pricing/deductions/simulate", json=payload)
    lines = []
    for line in body.get("lines") or []:
        rule = line.get("rule")
        if not rule and not line.get("amount"):
            continue
        item = {"deduction_type": line.get("deduction_type"), "treatment": line.get("treatment"),
                "amount": line.get("amount")}
        if rule:
            item["rule"] = {k: rule.get(k) for k in ("rule_id", "name", "method", "rate", "amount_per_unit", "scope")
                            if rule.get(k) not in (None, "") and not (k == "amount_per_unit" and rule.get("method") != "per_unit")}
        if line.get("overridden_rules"):
            item["overridden_rules"] = line["overridden_rules"]
        lines.append(item)
    inputs = drop_empty(body.get("input") or {})
    return out({
        "input": inputs,
        "gross_sales": body.get("gross_sales"),
        "deductions": lines,
        "total_sales_deductions": body.get("total_sales_deductions"),
        "net_sales": body.get("net_sales"),
        "commission": body.get("commission"),
        "net_after_commission": body.get("net_after_commission"),
        "explanation": body.get("explanation"),
        **({"notes": body["notes"]} if body.get("notes") else {}),
        **({"no_rules_apply": True} if not lines else {}),
    })


@register("forecast_deduction_preview", READ)
async def deduction_preview(
    forecast_id: Annotated[str, Field(description="Scenario to preview")],
    start_period: Annotated[Optional[str], Field(description="YYYY-MM; default the scenario's first sales month")] = None,
    end_period: Annotated[Optional[str], Field(description="YYYY-MM; default the scenario's last sales month")] = None,
    include_periods: Annotated[bool, Field(description="Add gross / deductions / net by month")] = False,
    include_rules: Annotated[bool, Field(description="Add each rule's rows and amount (and unused rules)")] = True,
) -> str:
    """What the deduction rules do to a scenario's sales forecast: gross ->
    each deduction type -> net sales (and commissions), by customer type,
    optionally by month, and how much each rule applied (rules that apply
    to nothing are flagged). Same numbers as the income statement; *_pct
    fields are percent of gross sales."""
    body = await call("GET", "/pricing/deductions/preview", params={
        "forecast_id": require(forecast_id, "forecast_id"), "start_period": start_period, "end_period": end_period,
    })
    metric_keys = ("gross_sales", "terms_allowance", "chargebacks", "other_allowance", "excise_tax",
                   "total_sales_deductions", "net_sales", "commission", "deductions_pct_of_gross")

    def percent(record: Dict[str, Any]) -> Dict[str, Any]:
        """The API gives shares of gross as fractions; report them in percent like the other *_pct fields."""
        record = dict(record)
        for key in ("deductions_pct_of_gross", "pct_of_gross"):
            if isinstance(record.get(key), (int, float)):
                record[key] = round(record[key] * 100, 2)
        return record

    body = {**body, "totals": percent(body.get("totals") or {}),
            "by_type": [percent(t) for t in body.get("by_type") or []],
            "by_customer_type": [percent(c) for c in body.get("by_customer_type") or []],
            "by_period": [percent(p) for p in body.get("by_period") or []]}
    result: Dict[str, Any] = {
        "forecast_id": body.get("forecast_id"), "start_period": body.get("start_period"),
        "end_period": body.get("end_period"), "rows": body.get("rows"), "rule_count": body.get("rule_count"),
        "totals": {k: (body.get("totals") or {}).get(k) for k in ("quantity", *metric_keys, "net_after_commission")},
        "by_type": [{k: t.get(k) for k in ("deduction_type", "treatment", "amount", "pct_of_gross", "rules_applied")}
                    for t in body.get("by_type") or []],
        "by_customer_type": {
            "columns": ["customer_type", "rows", *metric_keys],
            "rows": [[c.get("customer_type"), c.get("rows"), *[c.get(k) for k in metric_keys]]
                     for c in body.get("by_customer_type") or []],
        },
    }
    if include_periods:
        result["by_period"] = {
            "columns": ["period", *metric_keys],
            "rows": [[p.get("period"), *[p.get(k) for k in metric_keys]] for p in body.get("by_period") or []],
        }
    if include_rules:
        rules = [{"rule_id": r.get("rule_id"), "deduction_type": r.get("deduction_type"), "name": r.get("name"),
                  "rows_applied": r.get("rows_applied"), "amount": r.get("amount")} for r in body.get("rules") or []]
        put_capped(result, "rules", rules, 100)
    warnings = compact_warnings(body.get("warnings"), 15)
    if warnings:
        result["warnings"] = warnings
    result["message"] = body.get("message")
    return out(result)


# ---------------------------------------------------------------------------
# Price list
# ---------------------------------------------------------------------------

@register("forecast_list_prices", READ)
async def list_prices(
    forecast_id: Scenario = None,
    unit_id: Annotated[Optional[str], Field(description="Rules that apply to this product (its own and all-product discounts)")] = None,
    customer_id: Annotated[Optional[str], Field(description="Only rules for this customer")] = None,
    customer_type: Annotated[Optional[str], Field(description="Only rules for this customer type")] = None,
    include_inactive: bool = True,
    limit: Annotated[int, Field(ge=1, le=2000)] = 200,
    offset: Annotated[int, Field(ge=0)] = 0,
) -> str:
    """The price list: per rule the product, customer / customer type, fixed
    unit_price or discount_pct off base_price (fraction: 0.40 = 40% off), the
    effective price, effective months and scope (source: customer_product,
    customer_all, type_product, type_all, product, all). forecast_id null =
    company-wide."""
    body = await call("GET", "/pricing/prices", params={
        "forecast_id": forecast_id, "unit_id": unit_id, "customer_id": customer_id,
        "customer_type": customer_type, "include_inactive": include_inactive,
    })
    prices = body.get("prices") or []
    page = prices[offset:offset + limit]
    return out({
        "forecast_id": forecast_id, "total_count": len(prices), "returned": len(page), "offset": offset,
        "next_offset": offset + len(page) if offset + len(page) < len(prices) else None,
        "prices": [compact_price(p) for p in page],
    })


@register("forecast_upsert_prices", UPSERT)
async def upsert_prices(
    prices: Annotated[List[Dict[str, Any]], Field(
        description="Price rules to create (no price_id) or partially update (price_id + fields to change). "
                    "Fields: unit_id (required for a fixed price; omit with discount_from_base = every product), "
                    "customer_type and/or customer_id (omit = every customer), method (fixed | discount_from_base; "
                    "inferred), unit_price (fixed), discount_pct as a FRACTION off the product's base_price "
                    "(0.40 = 40% off), start_period / end_period (YYYY-MM), forecast_id (omit = company-wide), "
                    "is_active, notes.",
        min_length=1)],
) -> str:
    """Create or update price-list rules (what a customer type / customer
    pays per product). Creations are all-or-nothing; updates are applied one
    by one with failures reported. Example: dealers pay 1199 for RFL-308 in
    2027 => {unit_id: RFL-308, customer_type: Dealer, unit_price: 1199,
    start_period: 2027-01, end_period: 2027-12}. New sales rows without a
    price use this list; run forecast_apply_price_list to re-price existing
    rows."""
    result = await _upsert(prices, id_key="price_id", allowed=PRICE_FIELDS, path="/pricing/prices",
                           bulk_key="prices", label="prices", shape=compact_price)
    return out(result)


@register("forecast_delete_price", DESTRUCTIVE)
async def delete_price(
    price_id: Annotated[str, Field(description="price_id from forecast_list_prices, e.g. 'PRC-1A2B3C4D'")],
) -> str:
    """Delete one price-list rule. Existing sales rows keep their price until
    forecast_apply_price_list re-prices them."""
    body = await call("DELETE", f"/pricing/prices/{quote(require(price_id, 'price_id'), safe='')}")
    deleted = body.get("deleted") or {}
    return out({"deleted": compact_price(deleted) if deleted else price_id, "message": body.get("message")})


@register("forecast_resolve_price", READ)
async def resolve_price(
    unit_id: Annotated[str, Field(description="Product")],
    customer_id: Annotated[Optional[str], Field(description="Customer (its customer_type is used too)")] = None,
    customer_type: Annotated[Optional[str], Field(description="Customer type, when pricing without a specific customer")] = None,
    period: Period = None,
    forecast_id: Annotated[Optional[str], Field(description="Scenario; omit for company-wide prices only")] = None,
) -> str:
    """The price a customer (or customer type) pays for a product in a month
    and which rule gave it (source customer_product > customer_all >
    type_product > type_all > product > base_price > none)."""
    body = await call("GET", "/pricing/resolve", params={
        "unit_id": require(unit_id, "unit_id"), "customer_id": customer_id, "customer_type": customer_type,
        "period": period, "forecast_id": forecast_id,
    })
    keep = ("price", "source", "source_label", "price_id", "unit_id", "unit_name", "base_price", "customer_id",
            "customer_type", "period", "forecast_id")
    return out(drop_empty({k: body.get(k) for k in keep}, keep=("price", "source")))


@register("forecast_apply_price_list", WRITE)
async def apply_price_list(
    forecast_id: Annotated[str, Field(description="Scenario whose sales rows are re-priced")],
    periods: Annotated[Optional[List[str]], Field(description="Only these months (YYYY-MM)")] = None,
    start_period: Annotated[Optional[str], Field(description="Inclusive window start YYYY-MM")] = None,
    end_period: Annotated[Optional[str], Field(description="Inclusive window end YYYY-MM")] = None,
    customer_ids: Annotated[Optional[List[str]], Field(description="Only these customers")] = None,
    customer_types: Annotated[Optional[List[str]], Field(description="Only customers of these types")] = None,
    unit_ids: Annotated[Optional[List[str]], Field(description="Only these products")] = None,
    only_missing: Annotated[bool, Field(description="Only rows whose price is empty or 0")] = False,
    fallback_to_base_price: Annotated[bool, Field(
        description="Use the product's base_price when no price rule matches")] = True,
    dry_run: Annotated[bool, Field(description="Preview the changes and revenue impact without writing. Do this first.")] = False,
    sample_size: Annotated[int, Field(description="Changed / unpriced rows to show", ge=0, le=50)] = 10,
) -> str:
    """Re-price a scenario's sales rows from the price list (each row gets
    the most specific price; total_revenue = quantity x price). Rows the
    list cannot price are left alone and reported. Returns matched / changed
    counts, revenue before -> after and rows by price source. Run with
    dry_run=true first and show the user the revenue change."""
    body = await call("POST", "/pricing/apply", json={k: v for k, v in {
        "forecast_id": require(forecast_id, "forecast_id"), "periods": periods, "start_period": start_period,
        "end_period": end_period, "customer_ids": customer_ids, "customer_types": customer_types,
        "unit_ids": unit_ids, "only_missing": only_missing, "fallback_to_base_price": fallback_to_base_price,
        "dry_run": dry_run,
    }.items() if v is not None})
    result = {k: body.get(k) for k in ("forecast_id", "dry_run", "matched", "priced", "changed", "unchanged",
                                       "unpriced", "revenue_before", "revenue_after", "revenue_change", "by_source")}
    changes = [{k: c.get(k) for k in ("sale_id", "customer_id", "unit_id", "period", "quantity", "old_price",
                                      "new_price", "source")} for c in body.get("sample_changes") or []]
    shown, _ = cap(changes, sample_size)
    if shown:
        result["sample_changes"] = shown
    unpriced, _ = cap(body.get("unpriced_rows") or [], sample_size)
    if unpriced:
        result["unpriced_rows"] = [drop_empty(u) for u in unpriced]
    if body.get("warnings"):
        result["warnings"] = body["warnings"]
    if not body.get("matched"):
        result["hint"] = "No sales rows matched: check forecast_id, periods (YYYY-MM) and the id / type filters"
    elif dry_run:
        result["next"] = "Dry run only: call again with dry_run=false to apply."
    result["message"] = body.get("message")
    return out(result)
