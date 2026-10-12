"""
Pricing & deductions API.

* ``/pricing/deduction-types`` - the catalog (deduction types, methods, a
  worked example) from services.pricing.
* ``/pricing/deductions`` - sales deduction rules: terms allowance,
  chargebacks, other allowances, embedded excise tax (FET) and commissions.
  CRUD with bulk create, a preview of what the rules do to a scenario's
  forecast, and a simulator for a single invoice.
* ``/pricing/prices`` - the customer / customer-type price list. CRUD with
  bulk create, ``/pricing/resolve`` for one product + customer + month, and
  ``/pricing/apply`` to re-price a scenario's sales rows from the list.

All maths (rule matching, precedence, amounts, price resolution) lives in
services.pricing and, for the preview, services.financial_statements; this
module validates input and persists rules. The validation helpers
(``clean_deduction_rule`` / ``clean_price_rule``) are shared with the CSV
import endpoints in api.import_routes.
"""
import logging
import re
import uuid
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from fastapi import APIRouter, Body, HTTPException, Query

from db.database import db_manager
from db.models import ForecastResponse
from services.financial_statements import load_sales_lines, period_range
from services.pricing import (
    CONTRA_REVENUE_TYPES,
    DEDUCTION_EXAMPLE,
    DEDUCTION_METHODS,
    DEDUCTION_TYPES,
    PRICE_METHODS,
    STACKING_TYPES,
    DeductionResolver,
    compute_row_deductions,
    deduction_rule_key,
    default_rule_name,
    deduction_specificity,
    load_deduction_rules,
    load_price_rules,
    precedence_key,
    program_name,
    price_rule_key,
    price_source,
    price_specificity,
    resolve_price,
    rule_price,
)
from utils.period_normalizer import normalize_month, normalize_period, period_kind

router = APIRouter(prefix="/pricing", tags=["pricing"])
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Field catalogs
# ---------------------------------------------------------------------------

DEDUCTION_FIELDS: Tuple[str, ...] = (
    "forecast_id", "deduction_type", "name", "method", "rate", "amount_per_unit",
    "customer_id", "customer_type", "unit_id", "unit_type", "start_period", "end_period",
    "is_active", "notes",
)
PRICE_FIELDS: Tuple[str, ...] = (
    "forecast_id", "unit_id", "customer_id", "customer_type", "unit_type", "method", "unit_price", "discount_pct",
    "start_period", "end_period", "is_active", "notes",
)
#: Keys a client may round-trip from a listing; ignored on write without a warning.
_READ_ONLY_KEYS = {
    "rule_id", "price_id", "created_at", "updated_at", "deduction_label", "treatment", "statement_line",
    "specificity", "scope", "is_company_wide", "unit_name", "customer_name", "base_price",
    "effective_price", "source", "method_description",
}

PRICE_SOURCE_LABELS: Dict[str, str] = {
    "customer_product": "Customer price for this product",
    "customer_product_type": "Customer price for this product type",
    "customer_all": "Customer discount on every product",
    "type_product": "Customer-type price for this product",
    "type_product_type": "Customer-type price for this product type",
    "type_all": "Customer-type discount on every product",
    "product": "Price for every customer",
    "product_type": "Price for this product type, every customer",
    "all": "Discount for every customer and product",
    "base_price": "Product base (list) price",
    "none": "No price found",
}

TIE_BREAK_TEXT = (
    "Ties go to the scenario-specific rule, then the later start_period, then the earlier end_period "
    "(a bounded window beats an open-ended one), then the newer rule, then the higher id."
)

PRECEDENCE_TEXT = (
    "Terms allowance, chargebacks, excise tax and commission: exactly one rule per type applies to a sales "
    "row, the most specific matching rule (customer > customer type > product > product type; score 8/4/2/1). "
    "Other allowances are separate programs named by the rule name (e.g. 'Co-op advertising', 'Freight "
    "allowance'): every matching program applies and they add up; within one program name the most specific "
    "rule wins, so a customer's 'Co-op advertising' rule replaces the customer-type 'Co-op advertising' rule. "
    "A rule with no name is a program of its own. " + TIE_BREAK_TEXT + " A rule with rate 0 is an exemption. "
    "Different deduction types stack. Contra-revenue deductions are taken off gross sales to give net sales; "
    "commissions are a selling expense below gross profit. A second active rule with the same type, scope, "
    "months (and, for other allowances, program name) is refused with HTTP 409: update the existing rule."
)

PRICE_PRECEDENCE_TEXT = (
    "The most specific matching price wins: customer > customer type > product > product type (score "
    "8/4/2/1), so customer+product > customer+product type > customer > customer type+product > customer "
    "type+product type > customer type > product > product type > every product, then the product's base "
    "(list) price. A discount_from_base rule cannot price a product without a base price and falls through. "
    + TIE_BREAK_TEXT
)


class RuleValidationError(ValueError):
    """A rule failed validation; the message is safe to show to the user."""


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and value != value:  # NaN from spreadsheets
        return True
    return isinstance(value, str) and not value.strip()


def _text(value: Any) -> Optional[str]:
    """Trimmed text; blank -> None (blank scope fields are stored as NULL)."""
    if _blank(value):
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip()


def _rows(cursor) -> List[Dict[str, Any]]:
    columns = [d[0] for d in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _parse_number(value: Any, field: str) -> Optional[float]:
    """A number from JSON or a spreadsheet cell ('$1,234.50', '(12)'); blank -> None."""
    if _blank(value):
        return None
    if isinstance(value, bool):
        raise RuleValidationError(f"{field} must be a number, got {value!r}")
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "").replace("$", "").replace(" ", "")
    negative = text.startswith("(") and text.endswith(")")
    if negative:
        text = text[1:-1]
    try:
        number = float(text)
    except ValueError:
        raise RuleValidationError(f"{field} must be a number, got '{value}'")
    return -number if negative else number


def parse_fraction(value: Any, field: str, percent_input: bool = False) -> Optional[float]:
    """
    A rate / discount as a fraction (0.02 = 2%).

    JSON CRUD (``percent_input=False``) takes fractions only. Imports
    (``percent_input=True``) also take '2%' and percent numbers: any value
    >= 1 is read as a percent (2 -> 0.02, 11 -> 0.11, 1 -> 0.01).
    """
    if _blank(value):
        return None
    if percent_input and isinstance(value, str) and value.strip().endswith("%"):
        number = _parse_number(value.strip()[:-1], field)
        return None if number is None else number / 100.0
    if isinstance(value, str) and value.strip().endswith("%"):
        raise RuleValidationError(
            f"{field} must be a fraction (0.02 = 2%), got '{value}'. Send 0.02 instead of '2%'."
        )
    number = _parse_number(value, field)
    if number is not None and percent_input and number >= 1:
        number = number / 100.0
    return number


def _parse_flag(value: Any, field: str = "is_active") -> int:
    if _blank(value):
        return 1
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, (int, float)):
        return 1 if value else 0
    text = str(value).strip().lower()
    if text in ("1", "true", "yes", "y", "active", "on"):
        return 1
    if text in ("0", "false", "no", "n", "inactive", "off"):
        return 0
    raise RuleValidationError(f"{field} must be true/false, got '{value}'")


def _parse_month(value: Any, field: str) -> Optional[str]:
    if _blank(value):
        return None
    month = normalize_month(value)
    if month is None:
        kind = period_kind(normalize_period(value))
        if kind in ("quarter", "week"):
            raise RuleValidationError(f"{field} '{value}' is a {kind}; rules are monthly, use YYYY-MM (e.g. 2027-01)")
        raise RuleValidationError(f"{field} '{value}' is not a month; use YYYY-MM (e.g. 2027-01)")
    return month


def _forecast_exists(cursor, forecast_id: str) -> bool:
    cursor.execute("SELECT 1 FROM forecast WHERE forecast_id = ?", (forecast_id,))
    return cursor.fetchone() is not None


def _require_forecast(cursor, forecast_id: Optional[str]) -> None:
    if forecast_id and not _forecast_exists(cursor, forecast_id):
        raise HTTPException(status_code=404, detail=f"Forecast scenario '{forecast_id}' not found")


def _exists(cursor, table: str, column: str, value: str) -> bool:
    cursor.execute(f"SELECT 1 FROM {table} WHERE {column} = ? LIMIT 1", (value,))
    return cursor.fetchone() is not None


def _type_exists(cursor, table: str, column: str, value: str) -> bool:
    cursor.execute(f"SELECT 1 FROM {table} WHERE LOWER(TRIM({column})) = LOWER(TRIM(?)) LIMIT 1", (value,))
    return cursor.fetchone() is not None


def _scope_warnings(cursor, clean: Dict[str, Any], label: str) -> List[str]:
    """Non-blocking checks: a scope value that matches nothing makes the rule do nothing."""
    warnings: List[str] = []
    if clean.get("customer_id") and not _exists(cursor, "customers", "customer_id", clean["customer_id"]):
        warnings.append(f"{label}: customer '{clean['customer_id']}' does not exist yet, so the rule matches no sales")
    if clean.get("unit_id") and not _exists(cursor, "units", "unit_id", clean["unit_id"]):
        warnings.append(f"{label}: product '{clean['unit_id']}' does not exist yet, so the rule matches no sales")
    if clean.get("customer_type") and not _type_exists(cursor, "customers", "customer_type", clean["customer_type"]):
        warnings.append(f"{label}: no customer has customer_type '{clean['customer_type']}' yet")
    if clean.get("unit_type") and not _type_exists(cursor, "units", "unit_type", clean["unit_type"]):
        warnings.append(f"{label}: no product has unit_type '{clean['unit_type']}' yet")
    return warnings


def _plausibility_warnings(clean: Dict[str, Any], label: str, is_price: bool) -> List[str]:
    """
    Non-blocking warnings for JSON create / update: a deduction rate over 25%
    (excise_tax over 20%) or a discount over 80% off list is probably a
    fraction-vs-percent slip. Same thresholds and check as the import path
    (api.import_routes._plausibility_warnings); JSON rates are always
    fractions, so the hint says which fraction means the smaller percent.
    """
    from api.import_routes import _plausibility_warnings as check  # lazy: import_routes imports this module

    found = check(clean, {}, label, is_price)
    if is_price:  # JSON takes fractions only ('40%' is refused here)
        found = [w.replace("('40%' or 0.40 = 40% off)", "(discount_pct is a fraction: 0.40 = 40% off)") for w in found]
    elif found:
        rate = float(clean.get("rate") or 0)
        found = [f"{w} (rates are fractions: {rate:g} = {rate * 100:g}%; send {rate / 100:g} for {rate:g}%)"
                 for w in found]
    return found


def _unknown_keys(data: Dict[str, Any], allowed: Iterable[str]) -> List[str]:
    allowed_set = set(allowed) | _READ_ONLY_KEYS
    return sorted(k for k in data if k not in allowed_set)


def _check_window(start: Optional[str], end: Optional[str]) -> None:
    if start and end and start > end:
        raise RuleValidationError(f"start_period {start} is after end_period {end}")


# ---------------------------------------------------------------------------
# Deduction rule validation
# ---------------------------------------------------------------------------

_DEDUCTION_TYPE_ALIASES: Dict[str, str] = {
    "terms": "terms_allowance", "termsallowance": "terms_allowance", "termsdiscount": "terms_allowance",
    "cashdiscount": "terms_allowance", "earlypay": "terms_allowance", "earlypaymentdiscount": "terms_allowance",
    "chargeback": "chargebacks", "chargebacks": "chargebacks", "chargebacksallowance": "chargebacks",
    "chargebackallowance": "chargebacks", "miscchargebacks": "chargebacks",
    "other": "other_allowance", "otherallowance": "other_allowance", "otherallowances": "other_allowance",
    "otherdiscountsallowances": "other_allowance", "otherdiscountsandallowances": "other_allowance",
    "allowance": "other_allowance", "discount": "other_allowance", "rebate": "other_allowance",
    "volumerebate": "other_allowance", "coop": "other_allowance", "freightallowance": "other_allowance",
    "excise": "excise_tax", "excisetax": "excise_tax", "fet": "excise_tax", "federalexcisetax": "excise_tax",
    "excisetaxfet": "excise_tax",
    "commission": "commission", "commissions": "commission", "salescommission": "commission",
    "salescommissions": "commission", "repcommission": "commission",
}
_METHOD_ALIASES: Dict[str, str] = {
    "percentofgross": "percent_of_gross", "percent": "percent_of_gross", "pct": "percent_of_gross",
    "gross": "percent_of_gross", "": "percent_of_gross", "percentgross": "percent_of_gross",
    "percentofnet": "percent_of_net", "net": "percent_of_net", "percentnet": "percent_of_net",
    "embeddedtax": "embedded_tax", "embedded": "embedded_tax", "included": "embedded_tax",
    "taxincluded": "embedded_tax", "inclusive": "embedded_tax", "includedinprice": "embedded_tax",
    "perunit": "per_unit", "unit": "per_unit", "each": "per_unit", "dollarsperunit": "per_unit",
    "fixedperunit": "per_unit",
}
_PRICE_METHOD_ALIASES: Dict[str, str] = {
    "fixed": "fixed", "price": "fixed", "fixedprice": "fixed", "net": "fixed",
    "discountfrombase": "discount_from_base", "discount": "discount_from_base",
    "discountoffbase": "discount_from_base", "discountofflist": "discount_from_base",
    "percentoff": "discount_from_base", "discountfromlist": "discount_from_base",
}


def _alias_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def _deduction_type(value: Any, friendly: bool) -> str:
    text = _text(value)
    if text is None:
        raise RuleValidationError(f"deduction_type is required: one of {', '.join(DEDUCTION_TYPES)}")
    key = text.lower()
    if key in DEDUCTION_TYPES:
        return key
    if friendly:
        alias = _DEDUCTION_TYPE_ALIASES.get(_alias_key(text))
        if alias:
            return alias
    raise RuleValidationError(f"deduction_type '{text}' is not one of {', '.join(DEDUCTION_TYPES)}")


def _deduction_method(value: Any, dtype: str, friendly: bool) -> str:
    text = _text(value)
    if text is None:
        # FET is a tax included in the selling price; everything else is a percent of gross.
        return "embedded_tax" if dtype == "excise_tax" else "percent_of_gross"
    key = text.lower()
    if key in DEDUCTION_METHODS:
        return key
    if friendly:
        alias = _METHOD_ALIASES.get(_alias_key(text))
        if alias:
            return alias
    raise RuleValidationError(f"method '{text}' is not one of {', '.join(DEDUCTION_METHODS)}")


def _default_rule_name(clean: Dict[str, Any]) -> str:
    return default_rule_name(clean) or DEDUCTION_TYPES[clean["deduction_type"]]["label"]


def clean_deduction_rule(cursor, data: Dict[str, Any], *, percent_input: bool = False,
                         label: str = "rule") -> Tuple[Dict[str, Any], List[str]]:
    """
    Validate and normalise one deduction rule.

    ``data`` holds the rule's fields (the merged row on an update). Returns
    ``(values, warnings)`` with every column of DEDUCTION_FIELDS set; raises
    RuleValidationError with a user-facing message when the rule is invalid.
    ``percent_input`` (imports only) accepts '2%' and percent numbers
    (2 -> 0.02) and friendly type / method names ('FET', 'embedded').
    """
    warnings: List[str] = []
    clean: Dict[str, Any] = {}
    clean["deduction_type"] = _deduction_type(data.get("deduction_type"), friendly=percent_input)
    clean["method"] = _deduction_method(data.get("method"), clean["deduction_type"], friendly=percent_input)

    rate = parse_fraction(data.get("rate"), "rate", percent_input=percent_input)
    amount_per_unit = _parse_number(data.get("amount_per_unit"), "amount_per_unit")
    if clean["method"] == "per_unit":
        if amount_per_unit is None:
            raise RuleValidationError("method per_unit needs amount_per_unit (dollars per unit sold, e.g. 5.00)")
        if amount_per_unit < 0:
            raise RuleValidationError("amount_per_unit cannot be negative")
        rate = 0.0 if rate is None else rate
    else:
        if rate is None:
            raise RuleValidationError(
                f"rate is required for method {clean['method']} (a fraction: 0.02 = 2%; use 0 for an exemption)"
            )
        amount_per_unit = 0.0 if amount_per_unit is None else amount_per_unit
    if rate < 0:
        raise RuleValidationError("rate cannot be negative")
    if rate >= 1:
        hint = f" Did you mean {rate / 100:g}?" if rate < 100 and not percent_input else ""
        raise RuleValidationError(
            f"rate {rate:g} is out of range: rates are fractions between 0 and 1 (0.02 = 2%, 0.11 = 11%).{hint}"
        )
    clean["rate"] = rate
    clean["amount_per_unit"] = amount_per_unit

    forecast_id = _text(data.get("forecast_id"))
    if forecast_id and not _forecast_exists(cursor, forecast_id):
        raise RuleValidationError(f"forecast_id '{forecast_id}' does not exist")
    clean["forecast_id"] = forecast_id
    for key in ("customer_id", "customer_type", "unit_id", "unit_type"):
        clean[key] = _text(data.get(key))
    clean["start_period"] = _parse_month(data.get("start_period"), "start_period")
    clean["end_period"] = _parse_month(data.get("end_period"), "end_period")
    _check_window(clean["start_period"], clean["end_period"])
    clean["is_active"] = _parse_flag(data.get("is_active"))
    clean["notes"] = _text(data.get("notes"))
    clean["name"] = _text(data.get("name")) or _default_rule_name(clean)

    if clean["deduction_type"] == "excise_tax" and clean["method"] == "percent_of_gross":
        warnings.append(
            f"{label}: excise tax with percent_of_gross charges the rate on the full invoice; if the tax is "
            f"included in the price use method embedded_tax (price x rate / (1 + rate))"
        )
    warnings.extend(_scope_warnings(cursor, clean, label))
    return clean, warnings


# ---------------------------------------------------------------------------
# Price rule validation
# ---------------------------------------------------------------------------

def clean_price_rule(cursor, data: Dict[str, Any], *, percent_input: bool = False,
                     label: str = "price") -> Tuple[Dict[str, Any], List[str]]:
    """
    Validate and normalise one price-list rule.

    ``fixed`` needs unit_price >= 0 and a product (unit_id) or a product
    type (unit_type: one price for every product of that type);
    ``discount_from_base`` needs 0 <= discount_pct < 1 and may leave both
    empty (every product). When method is omitted it is inferred: a
    discount without a price means discount_from_base. Returns
    ``(values, warnings)``; raises RuleValidationError when invalid.
    ``percent_input`` (imports only) accepts '40%' / 40 for discount_pct.
    """
    warnings: List[str] = []
    clean: Dict[str, Any] = {}
    unit_price = _parse_number(data.get("unit_price"), "unit_price")
    discount = parse_fraction(data.get("discount_pct"), "discount_pct", percent_input=percent_input)

    method_text = _text(data.get("method"))
    if method_text is None:
        method = "discount_from_base" if (discount is not None and unit_price is None) else "fixed"
    elif method_text.lower() in PRICE_METHODS:
        method = method_text.lower()
    elif percent_input and _PRICE_METHOD_ALIASES.get(_alias_key(method_text)):
        method = _PRICE_METHOD_ALIASES[_alias_key(method_text)]
    else:
        raise RuleValidationError(f"method '{method_text}' is not one of {', '.join(PRICE_METHODS)}")
    clean["method"] = method

    clean["unit_id"] = _text(data.get("unit_id"))
    clean["unit_type"] = _text(data.get("unit_type"))
    if method == "fixed":
        if unit_price is None:
            raise RuleValidationError("a fixed price needs unit_price (>= 0)")
        if unit_price < 0:
            raise RuleValidationError("unit_price cannot be negative")
        if not clean["unit_id"] and not clean["unit_type"]:
            raise RuleValidationError(
                "unit_id is required for a fixed price (or unit_type for one price on every product of a "
                "type); to price every product use method discount_from_base with discount_pct"
            )
        clean["unit_price"] = unit_price
        clean["discount_pct"] = None
        if discount:
            warnings.append(f"{label}: discount_pct ignored because the rule has a fixed unit_price")
    else:
        if discount is None:
            raise RuleValidationError("method discount_from_base needs discount_pct (a fraction: 0.40 = 40% off)")
        if discount < 0 or discount >= 1:
            hint = f" Did you mean {discount / 100:g}?" if 1 <= discount < 100 and not percent_input else ""
            raise RuleValidationError(
                f"discount_pct {discount:g} is out of range: use a fraction from 0 up to (not including) 1 "
                f"(0.40 = 40% off).{hint}"
            )
        clean["discount_pct"] = discount
        clean["unit_price"] = None
        if unit_price is not None and method_text is not None:
            warnings.append(f"{label}: unit_price ignored because method is discount_from_base")

    forecast_id = _text(data.get("forecast_id"))
    if forecast_id and not _forecast_exists(cursor, forecast_id):
        raise RuleValidationError(f"forecast_id '{forecast_id}' does not exist")
    clean["forecast_id"] = forecast_id
    clean["customer_id"] = _text(data.get("customer_id"))
    clean["customer_type"] = _text(data.get("customer_type"))
    clean["start_period"] = _parse_month(data.get("start_period"), "start_period")
    clean["end_period"] = _parse_month(data.get("end_period"), "end_period")
    _check_window(clean["start_period"], clean["end_period"])
    clean["is_active"] = _parse_flag(data.get("is_active"))
    clean["notes"] = _text(data.get("notes"))

    warnings.extend(_scope_warnings(cursor, clean, label))
    if clean["unit_id"] and clean["unit_type"]:
        cursor.execute("SELECT unit_type FROM units WHERE unit_id = ?", (clean["unit_id"],))
        row = cursor.fetchone()
        if row is not None and (_text(row[0]) or "").lower() != clean["unit_type"].lower():
            warnings.append(
                f"{label}: product '{clean['unit_id']}' has product type '{_text(row[0]) or 'none'}', not "
                f"'{clean['unit_type']}', so this rule matches no sales; leave unit_type empty for a product price"
            )
    if method == "discount_from_base" and clean["unit_id"]:
        cursor.execute("SELECT base_price FROM units WHERE unit_id = ?", (clean["unit_id"],))
        row = cursor.fetchone()
        if row is not None and not float(row[0] or 0) > 0:
            warnings.append(
                f"{label}: product '{clean['unit_id']}' has no base_price, so this discount cannot price it "
                f"(resolution falls through to the next rule)"
            )
    return clean, warnings


# ---------------------------------------------------------------------------
# Persistence (shared with api.import_routes)
# ---------------------------------------------------------------------------

def insert_deduction_rule(cursor, clean: Dict[str, Any], rule_id: Optional[str] = None) -> str:
    """Insert a validated deduction rule; returns its id."""
    rule_id = rule_id or _new_id("DED")
    now = _now()
    cols = ["rule_id", *DEDUCTION_FIELDS, "created_at", "updated_at"]
    values = [rule_id, *[clean.get(c) for c in DEDUCTION_FIELDS], now, now]
    cursor.execute(
        f"INSERT INTO sales_deduction_rules ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})", values
    )
    return rule_id


def update_deduction_rule(cursor, rule_id: str, clean: Dict[str, Any]) -> None:
    """Overwrite every editable column of an existing deduction rule."""
    cursor.execute(
        f"UPDATE sales_deduction_rules SET {', '.join(f'{c} = ?' for c in DEDUCTION_FIELDS)}, updated_at = ? "
        f"WHERE rule_id = ?",
        [clean.get(c) for c in DEDUCTION_FIELDS] + [_now(), rule_id],
    )


def insert_price_rule(cursor, clean: Dict[str, Any], price_id: Optional[str] = None) -> str:
    """Insert a validated price rule; returns its id."""
    price_id = price_id or _new_id("PRC")
    now = _now()
    cols = ["price_id", *PRICE_FIELDS, "created_at", "updated_at"]
    values = [price_id, *[clean.get(c) for c in PRICE_FIELDS], now, now]
    cursor.execute(f"INSERT INTO price_list ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})", values)
    return price_id


def update_price_rule(cursor, price_id: str, clean: Dict[str, Any]) -> None:
    """Overwrite every editable column of an existing price rule."""
    cursor.execute(
        f"UPDATE price_list SET {', '.join(f'{c} = ?' for c in PRICE_FIELDS)}, updated_at = ? WHERE price_id = ?",
        [clean.get(c) for c in PRICE_FIELDS] + [_now(), price_id],
    )


def get_deduction_rule(cursor, rule_id: str) -> Optional[Dict[str, Any]]:
    cursor.execute("SELECT * FROM sales_deduction_rules WHERE rule_id = ?", (rule_id,))
    rows = _rows(cursor)
    return rows[0] if rows else None


def get_price_rule(cursor, price_id: str) -> Optional[Dict[str, Any]]:
    cursor.execute("SELECT * FROM price_list WHERE price_id = ?", (price_id,))
    rows = _rows(cursor)
    return rows[0] if rows else None


# ---------------------------------------------------------------------------
# Duplicate scopes (shared with api.import_routes)
# ---------------------------------------------------------------------------

class DuplicateRuleError(ValueError):
    """A rule would duplicate an active rule's scope; ``existing_id`` names that rule."""

    def __init__(self, message: str, existing_id: str):
        super().__init__(message)
        self.existing_id = existing_id


def _article(word: str) -> str:
    return "An" if word[:1].lower() in "aeiou" else "A"


def duplicate_rule_message(kind: str, clean: Dict[str, Any], existing_id: str) -> str:
    """'A terms_allowance rule with this scope already exists (DED-1A2B3C4D); update it instead'."""
    if kind == "price":
        return f"A price rule with this scope already exists ({existing_id}); update it instead"
    dtype = clean.get("deduction_type") or "deduction"
    if dtype in STACKING_TYPES:
        if program_name(clean) is None:
            return (f"{_article(dtype)} {dtype} rule with this scope and no program name already exists "
                    f"({existing_id}); update it instead, or name the new program (e.g. 'Freight allowance') so "
                    f"both apply")
        return (f"{_article(dtype)} {dtype} rule with this scope and program name '{clean.get('name')}' already "
                f"exists ({existing_id}); update it instead, or give the new program a different name")
    return f"{_article(dtype)} {dtype} rule with this scope already exists ({existing_id}); update it instead"


def _active_rules(cursor, kind: str) -> List[Dict[str, Any]]:
    if kind == "price":
        cursor.execute("SELECT * FROM price_list WHERE is_active IS NULL OR is_active = 1")
    else:
        cursor.execute("SELECT * FROM sales_deduction_rules WHERE is_active IS NULL OR is_active = 1")
    return _rows(cursor)


def find_duplicate_rule(cursor, kind: str, clean: Dict[str, Any], exclude_id: Optional[str] = None,
                        active_rules: Optional[List[Dict[str, Any]]] = None) -> Optional[Dict[str, Any]]:
    """
    The ACTIVE rule whose slot equals ``clean``'s, or None. ``kind`` is
    'deduction' or 'price'. A deduction slot is (deduction_type, forecast_id,
    every scope field, start_period, end_period, and for other_allowance the
    normalised program name); a price slot is (forecast_id, every scope
    field, start_period, end_period). Of several matches (rules created
    before this check existed) the one that currently wins is returned.
    """
    key_fn = price_rule_key if kind == "price" else deduction_rule_key
    id_col = "price_id" if kind == "price" else "rule_id"
    target = key_fn(clean)
    rules = active_rules if active_rules is not None else _active_rules(cursor, kind)
    matches = [r for r in rules if r.get(id_col) != exclude_id and key_fn(r) == target]
    if not matches:
        return None
    return max(matches, key=lambda r: precedence_key(r, kind))


def check_duplicate_rule(cursor, kind: str, clean: Dict[str, Any], exclude_id: Optional[str] = None,
                         active_rules: Optional[List[Dict[str, Any]]] = None) -> None:
    """Raise DuplicateRuleError when ``clean`` would duplicate an active rule's slot."""
    existing = find_duplicate_rule(cursor, kind, clean, exclude_id=exclude_id, active_rules=active_rules)
    if existing:
        existing_id = existing["price_id" if kind == "price" else "rule_id"]
        raise DuplicateRuleError(duplicate_rule_message(kind, clean, existing_id), existing_id)


def _request_duplicates(kind: str, cleaned: Sequence[Tuple[int, Dict[str, Any]]], label: str) -> List[str]:
    """Pairs of items in one request that define the same slot (both would tie)."""
    key_fn = price_rule_key if kind == "price" else deduction_rule_key
    first_by_key: Dict[Tuple, int] = {}
    problems: List[str] = []
    for index, clean in cleaned:
        key = key_fn(clean)
        if key in first_by_key:
            what = "price" if kind == "price" else (
                f"{clean['deduction_type']} rule" + (" with the same program name" if clean["deduction_type"]
                                                     in STACKING_TYPES else ""))
            problems.append(
                f"{label}s {first_by_key[key]} and {index} define the same {what} for the same scope and months; "
                f"combine them into one {'price' if kind == 'price' else 'rule'} or scope them differently"
            )
        else:
            first_by_key[key] = index
    return problems


# ---------------------------------------------------------------------------
# Presentation
# ---------------------------------------------------------------------------

def _scope_text(rule: Dict[str, Any], fields: Sequence[Tuple[str, str]]) -> str:
    parts = [f"{label} {rule[key]}" for key, label in fields if rule.get(key)]
    return ", ".join(parts) if parts else "All sales"


def describe_deduction_rule(rule: Dict[str, Any]) -> Dict[str, Any]:
    """A stored rule plus catalog labels, a scope summary and its specificity."""
    info = DEDUCTION_TYPES.get(rule.get("deduction_type") or "", {})
    return {
        **rule,
        "deduction_label": info.get("label", rule.get("deduction_type")),
        "treatment": info.get("treatment"),
        "statement_line": info.get("statement_line"),
        "method_description": DEDUCTION_METHODS.get(rule.get("method") or ""),
        "is_active": rule.get("is_active") is None or bool(rule.get("is_active")),
        "is_company_wide": not rule.get("forecast_id"),
        "specificity": deduction_specificity(rule),
        "scope": _scope_text(rule, (("customer_id", "customer"), ("customer_type", "customer type"),
                                    ("unit_id", "product"), ("unit_type", "product type"))),
    }


def _describe_price_rule(rule: Dict[str, Any], units: Dict[str, Dict[str, Any]],
                         customers: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    unit = units.get(rule.get("unit_id") or "") or {}
    customer = customers.get(rule.get("customer_id") or "") or {}
    effective = rule_price(rule, unit.get("base_price")) if rule.get("unit_id") else (
        rule.get("unit_price") if (rule.get("method") or "fixed") == "fixed" else None)
    return {
        **rule,
        "unit_name": unit.get("unit_name"),
        "base_price": unit.get("base_price"),
        "customer_name": customer.get("customer_name"),
        "effective_price": round(effective, 4) if effective is not None else None,
        "source": price_source(rule),
        "is_active": rule.get("is_active") is None or bool(rule.get("is_active")),
        "is_company_wide": not rule.get("forecast_id"),
        "specificity": price_specificity(rule),
        "scope": _scope_text(rule, (("customer_id", "customer"), ("customer_type", "customer type"),
                                    ("unit_id", "product"), ("unit_type", "product type")))
        if (rule.get("customer_id") or rule.get("customer_type") or rule.get("unit_id") or rule.get("unit_type"))
        else "All customers, all products",
    }


def _master_maps(cursor) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    cursor.execute("SELECT unit_id, unit_name, unit_type, base_price FROM units")
    units = {r["unit_id"]: r for r in _rows(cursor)}
    cursor.execute("SELECT customer_id, customer_name, customer_type FROM customers")
    customers = {r["customer_id"]: r for r in _rows(cursor)}
    return units, customers


def _body_items(payload: Any, key: str) -> Tuple[List[Dict[str, Any]], bool]:
    """(items, is_bulk) from a single object, {key: [...]} or a bare list."""
    if isinstance(payload, list):
        items, bulk = payload, True
    elif isinstance(payload, dict) and key in payload:
        items, bulk = payload[key], True
    elif isinstance(payload, dict):
        items, bulk = [payload], False
    else:
        raise HTTPException(status_code=422, detail=f"Body must be an object or {{\"{key}\": [...]}}")
    if not isinstance(items, list) or not items:
        raise HTTPException(status_code=422, detail=f"{key} must be a non-empty list")
    if not all(isinstance(i, dict) for i in items):
        raise HTTPException(status_code=422, detail=f"every entry of {key} must be an object")
    return items, bulk


def _r2(value: float) -> float:
    return round(float(value or 0.0), 2)


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------

@router.get("/deduction-types", response_model=ForecastResponse)
async def get_deduction_types():
    """Deduction types, calculation methods, price methods and a worked example."""
    data = {
        "deduction_types": [
            {"deduction_type": key, **info, "contra_revenue": info["treatment"] == "contra_revenue",
             "stacks": key in STACKING_TYPES}
            for key, info in DEDUCTION_TYPES.items()
        ],
        "stacking_types": list(STACKING_TYPES),
        "methods": [{"method": key, "description": text} for key, text in DEDUCTION_METHODS.items()],
        "price_methods": [{"method": key, "description": text} for key, text in PRICE_METHODS.items()],
        "price_sources": [{"source": key, "label": text} for key, text in PRICE_SOURCE_LABELS.items()],
        "contra_revenue_types": list(CONTRA_REVENUE_TYPES),
        "example": DEDUCTION_EXAMPLE,
        "precedence": PRECEDENCE_TEXT,
        "price_precedence": PRICE_PRECEDENCE_TEXT,
        "rate_format": "Rates are fractions: 0.02 = 2%, 0.11 = 11%. CSV imports also accept '2%' or 2.",
    }
    return ForecastResponse(status="success", data=data, message=f"{len(DEDUCTION_TYPES)} deduction types")


# ---------------------------------------------------------------------------
# Deduction rules
# ---------------------------------------------------------------------------

@router.get("/deductions", response_model=ForecastResponse)
async def list_deduction_rules(
    forecast_id: Optional[str] = Query(None, description="Scenario: its rules plus company-wide ones. Omit for every rule."),
    deduction_type: Optional[str] = Query(None, description="Only this deduction type"),
    include_inactive: bool = Query(True, description="Include rules switched off with is_active = 0"),
):
    """Deduction rules with labels, scope summary and specificity."""
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        rules = load_deduction_rules(cursor, [forecast_id] if forecast_id else None, include_inactive=include_inactive)
    finally:
        db_manager.close_connection(conn)
    if deduction_type:
        rules = [r for r in rules if r.get("deduction_type") == deduction_type]
    order = {k: i for i, k in enumerate(DEDUCTION_TYPES)}
    rules.sort(key=lambda r: (order.get(r.get("deduction_type"), 99), -deduction_specificity(r), r.get("rule_id") or ""))
    described = [describe_deduction_rule(r) for r in rules]
    return ForecastResponse(
        status="success",
        data={"rules": described, "count": len(described), "forecast_id": forecast_id},
        message=f"Retrieved {len(described)} deduction rules",
    )


@router.post("/deductions", response_model=ForecastResponse)
async def create_deduction_rules(payload: Any = Body(...)):
    """
    Create one rule (body = the rule) or several (``{"rules": [...]}``).

    All-or-nothing: if any rule is invalid nothing is written and the 422
    lists every problem. Rates are fractions (0.02 = 2%). A rule whose
    deduction_type, scenario, scope fields, start/end months (and, for
    other_allowance, program name) equal an existing ACTIVE rule's is
    refused with 409 and a detail naming that rule: update it instead.
    """
    items, bulk = _body_items(payload, "rules")
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        cleaned: List[Tuple[int, Dict[str, Any]]] = []
        errors: List[str] = []
        warnings: List[str] = []
        for index, item in enumerate(items, start=1):
            label = f"rule {index}" if bulk else "rule"
            try:
                clean, rule_warnings = clean_deduction_rule(cursor, item, label=label)
            except RuleValidationError as exc:
                errors.append(f"{label}: {exc}" if bulk else str(exc))
                continue
            rule_warnings.extend(_plausibility_warnings(clean, label, is_price=False))
            unknown = _unknown_keys(item, DEDUCTION_FIELDS)
            if unknown:
                rule_warnings.append(f"{label}: ignored unknown fields {', '.join(unknown)}")
            cleaned.append((index, clean))
            warnings.extend(rule_warnings)
        if errors:
            raise HTTPException(status_code=422, detail="; ".join(errors))
        _refuse_duplicates(cursor, "deduction", cleaned, bulk)
        ids = [insert_deduction_rule(cursor, clean) for _index, clean in cleaned]
        conn.commit()
        created = [describe_deduction_rule(get_deduction_rule(cursor, rid)) for rid in ids]
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("Error creating deduction rules")
        raise HTTPException(status_code=500, detail=f"Error creating deduction rules: {exc}")
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(
        status="success",
        data={"rules": created, "created": len(created), "warnings": warnings},
        message=f"Created {len(created)} deduction rule{'s' if len(created) != 1 else ''}",
    )


def _refuse_duplicates(cursor, kind: str, cleaned: Sequence[Tuple[int, Dict[str, Any]]], bulk: bool) -> None:
    """422 when two items of one request share a slot; 409 when an item duplicates an active stored rule."""
    label = "price" if kind == "price" else "rule"
    problems = _request_duplicates(kind, cleaned, label)
    if problems:
        raise HTTPException(status_code=422, detail="; ".join(problems))
    active = _active_rules(cursor, kind)
    conflicts: List[str] = []
    for index, clean in cleaned:
        try:
            check_duplicate_rule(cursor, kind, clean, active_rules=active)
        except DuplicateRuleError as exc:
            conflicts.append(f"{label} {index}: {exc}" if bulk else str(exc))
    if conflicts:
        raise HTTPException(status_code=409, detail="; ".join(conflicts))


@router.get("/deductions/preview", response_model=ForecastResponse)
async def preview_deductions(
    forecast_id: str = Query(..., description="Scenario to preview"),
    start_period: Optional[str] = Query(None, description="YYYY-MM; defaults to the scenario's first sales month"),
    end_period: Optional[str] = Query(None, description="YYYY-MM; defaults to the scenario's last sales month"),
):
    """
    What the deduction rules do to a scenario's forecast: totals per
    deduction type and per customer type, gross -> net, each rule's rows and
    amount, and rules that match nothing. Numbers come from the statements
    engine's sales lines, so they equal the income statement.
    """
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        _require_forecast(cursor, forecast_id)
        window = _resolve_window(cursor, forecast_id, start_period, end_period)
        if window is None:
            return ForecastResponse(
                status="success",
                data={"forecast_id": forecast_id, "start_period": None, "end_period": None, "rows": 0,
                      "totals": _empty_totals(), "by_type": [], "by_customer_type": [], "by_period": [],
                      "rules": [], "warnings": [{"code": "no_sales", "level": "info",
                                                 "message": "This scenario has no monthly sales rows yet"}]},
                message="No sales to preview",
            )
        periods = period_range(*window)
        rules = load_deduction_rules(cursor, [forecast_id])
        loaded = load_sales_lines(cursor, [forecast_id], periods, deduction_rules=rules)
    finally:
        db_manager.close_connection(conn)

    lines = loaded["lines"]
    totals = _empty_totals()
    by_ctype: Dict[str, Dict[str, float]] = {}
    by_period: Dict[str, Dict[str, float]] = {p: _empty_totals() for p in periods}
    rule_usage: Dict[str, Dict[str, float]] = {}
    resolver = DeductionResolver(rules)   # per-rule amounts (other_allowance programs share one line amount)
    for line in lines:
        ctype = line.get("customer_type") or "Unassigned"
        bucket = by_ctype.setdefault(ctype, _empty_totals())
        for target in (totals, bucket, by_period[line["period"]]):
            target["rows"] += 1
            target["quantity"] += line["quantity"]
            target["gross_sales"] += line["gross_sales"]
            for dtype in DEDUCTION_TYPES:
                target[dtype] += line[dtype]
            target["total_sales_deductions"] += line["total_sales_deductions"]
            target["net_sales"] += line["net_sales"]
        if line.get("applied_rules"):
            for rule_id, amount in resolver.compute(line)["rule_amounts"].items():
                usage = rule_usage.setdefault(rule_id, {"rows": 0, "amount": 0.0})
                usage["rows"] += 1
                usage["amount"] += amount

    def _finish(t: Dict[str, float]) -> Dict[str, Any]:
        out = {k: (int(v) if k == "rows" else _r2(v)) for k, v in t.items()}
        gross = t["gross_sales"]
        out["deductions_pct_of_gross"] = round(t["total_sales_deductions"] / gross, 4) if gross else 0.0
        out["net_after_commission"] = _r2(t["net_sales"] - t["commission"])
        return out

    by_type = []
    for dtype, info in DEDUCTION_TYPES.items():
        amount = totals[dtype]
        by_type.append({
            "deduction_type": dtype, "label": info["label"], "treatment": info["treatment"],
            "amount": _r2(amount),
            "pct_of_gross": round(amount / totals["gross_sales"], 4) if totals["gross_sales"] else 0.0,
            "rules_applied": sorted({r["rule_id"] for r in rules if r.get("deduction_type") == dtype
                                     and r["rule_id"] in rule_usage}),
        })

    rule_rows = []
    warnings: List[Dict[str, Any]] = []
    for rule in rules:
        usage = rule_usage.get(rule["rule_id"], {"rows": 0, "amount": 0.0})
        rule_rows.append({**describe_deduction_rule(rule), "rows_applied": int(usage["rows"]),
                          "amount": _r2(usage["amount"])})
        if lines and not usage["rows"]:
            warnings.append({
                "code": "rule_unused", "level": "info", "rule_id": rule["rule_id"],
                "message": f"Rule {rule['rule_id']} ({rule.get('name') or rule['deduction_type']}) applies to no sales "
                           f"row in {window[0]}..{window[1]}: its scope matches nothing or a more specific rule wins",
            })
    if lines and not rules:
        warnings.append({"code": "no_deduction_rules", "level": "info",
                         "message": "No discounts/allowances/excise rules apply; net sales = gross sales"})
    elif lines and not loaded.get("rows_with_deductions"):
        warnings.append({"code": "no_deduction_rules", "level": "info", "rule_count": len(rules),
                         "message": f"{len(rules)} deduction rule{'s are' if len(rules) != 1 else ' is'} set up but "
                                    f"none applies to any sales row in {window[0]}..{window[1]}, so net sales = gross "
                                    f"sales. Check the customers, customer types, products, product types and "
                                    f"months the rules are scoped to."})
    if loaded.get("non_monthly_rows"):
        warnings.append({"code": "non_monthly_sales_periods", "level": "warning",
                         "message": f"{loaded['non_monthly_rows']} sales rows have a period that is not a YYYY-MM "
                                    f"month and are left out"})

    data = {
        "forecast_id": forecast_id,
        "start_period": window[0],
        "end_period": window[1],
        "rows": len(lines),
        "rule_count": len(rules),
        "rows_with_deductions": loaded.get("rows_with_deductions", 0),
        "totals": _finish(totals),
        "by_type": by_type,
        "by_customer_type": sorted(
            ({"customer_type": k, **_finish(v)} for k, v in by_ctype.items()),
            key=lambda r: -r["gross_sales"],
        ),
        "by_period": [{"period": p, **_finish(v)} for p, v in by_period.items()],
        "rules": rule_rows,
        "warnings": warnings,
    }
    return ForecastResponse(
        status="success", data=data,
        message=f"Gross {data['totals']['gross_sales']:,.2f} less deductions "
                f"{data['totals']['total_sales_deductions']:,.2f} = net {data['totals']['net_sales']:,.2f}",
    )


def _empty_totals() -> Dict[str, float]:
    totals = {"rows": 0, "quantity": 0.0, "gross_sales": 0.0}
    totals.update({dtype: 0.0 for dtype in DEDUCTION_TYPES})
    totals.update({"total_sales_deductions": 0.0, "net_sales": 0.0})
    return totals


def _resolve_window(cursor, forecast_id: str, start_period: Optional[str],
                    end_period: Optional[str]) -> Optional[Tuple[str, str]]:
    """Explicit window (validated) or the scenario's monthly sales window; None when it has no sales."""
    start = _text(start_period)
    end = _text(end_period)
    if start or end:
        try:
            start_m = _parse_month(start, "start_period") if start else None
            end_m = _parse_month(end, "end_period") if end else None
        except RuleValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
    else:
        start_m = end_m = None
    if not (start_m and end_m):
        cursor.execute(
            "SELECT MIN(substr(period, 1, 7)), MAX(substr(period, 1, 7)) FROM sales WHERE forecast_id = ? "
            "AND substr(period, 1, 7) GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'",
            (forecast_id,),
        )
        lo, hi = cursor.fetchone()
        start_m = start_m or lo
        end_m = end_m or hi
        if not (start_m and end_m):
            return None
    try:
        period_range(start_m, end_m)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return start_m, end_m


@router.post("/deductions/simulate", response_model=ForecastResponse)
async def simulate_deductions(payload: Dict[str, Any] = Body(...)):
    """
    Which rule applies per deduction type (one per program for other
    allowances, each listed in the line's ``rules``) for one hypothetical
    invoice line and the amounts. Body: ``{gross | unit_price + quantity, quantity?,
    customer_id?, customer_type?, unit_id?, unit_type?, period?,
    forecast_id?}``. customer_type / unit_type are looked up from the
    customer / product when not given.
    """
    try:
        quantity = _parse_number(payload.get("quantity"), "quantity")
        gross = _parse_number(payload.get("gross", payload.get("gross_sales")), "gross")
        unit_price = _parse_number(payload.get("unit_price"), "unit_price")
        period = _parse_month(payload.get("period"), "period")
    except RuleValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if gross is None:
        if unit_price is None:
            raise HTTPException(status_code=422, detail="Give gross (invoice amount) or unit_price and quantity")
        gross = unit_price * (quantity if quantity is not None else 1.0)
    if quantity is None:
        quantity = 1.0

    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        forecast_id = _text(payload.get("forecast_id"))
        _require_forecast(cursor, forecast_id)
        row: Dict[str, Any] = {
            "forecast_id": forecast_id, "period": period, "gross_sales": gross, "quantity": quantity,
            "customer_id": _text(payload.get("customer_id")), "customer_type": _text(payload.get("customer_type")),
            "unit_id": _text(payload.get("unit_id")), "unit_type": _text(payload.get("unit_type")),
        }
        notes: List[str] = []
        if row["customer_id"] and not row["customer_type"]:
            cursor.execute("SELECT customer_type FROM customers WHERE customer_id = ?", (row["customer_id"],))
            found = cursor.fetchone()
            if found:
                row["customer_type"] = found[0]
            else:
                notes.append(f"Customer '{row['customer_id']}' not found; only its id was used for matching")
        if row["unit_id"] and not row["unit_type"]:
            cursor.execute("SELECT unit_type FROM units WHERE unit_id = ?", (row["unit_id"],))
            found = cursor.fetchone()
            if found:
                row["unit_type"] = found[0]
            else:
                notes.append(f"Product '{row['unit_id']}' not found; only its id was used for matching")
        rules = load_deduction_rules(cursor, [forecast_id] if forecast_id else [])
    finally:
        db_manager.close_connection(conn)

    resolver = DeductionResolver(rules)
    applicable = resolver.applicable(row)
    result = compute_row_deductions(applicable, row)
    lines = []
    explanation = []
    for dtype, info in DEDUCTION_TYPES.items():
        applied = applicable.get(dtype, [])
        applied_ids = {r["rule_id"] for r in applied}
        matching = [r["rule_id"] for r in rules
                    if r.get("deduction_type") == dtype and DeductionResolver([r]).applicable(row)]
        entry = {
            "deduction_type": dtype, "label": info["label"], "treatment": info["treatment"],
            "amount": round(result[dtype], 2),
            # the most specific rule applied (other_allowance: of the programs, see "rules")
            "rule": describe_deduction_rule(applied[0]) if applied else None,
            # every rule applied, with its amount: one per program for other_allowance
            "rules": [{**describe_deduction_rule(r), "amount": round(result["rule_amounts"].get(r["rule_id"], 0.0), 2)}
                      for r in applied],
            "overridden_rules": [rid for rid in matching if rid not in applied_ids],
        }
        lines.append(entry)
        for rule in applied:
            explanation.append(_explain(rule, info["label"], gross, quantity,
                                        result["rule_amounts"].get(rule["rule_id"], 0.0), result["net_base"]))
    data = {
        "input": row,
        "gross_sales": round(gross, 2),
        "lines": lines,
        "net_base": round(result["net_base"], 2),
        "total_sales_deductions": round(result["total_sales_deductions"], 2),
        "net_sales": round(result["net_sales"], 2),
        "commission": round(result["commission"], 2),
        "net_after_commission": round(result["net_sales"] - result["commission"], 2),
        "explanation": explanation,
        "notes": notes,
    }
    return ForecastResponse(
        status="success", data=data,
        message=f"Gross {gross:,.2f} - deductions {result['total_sales_deductions']:,.2f} = net {result['net_sales']:,.2f}",
    )


def _explain(rule: Dict[str, Any], label: str, gross: float, quantity: float, amount: float,
             net_base: float) -> str:
    """One line of the worked example; ``net_base`` is the engine's percent_of_net base."""
    method = rule.get("method") or "percent_of_gross"
    rate = float(rule.get("rate") or 0)
    name = rule.get("name") or rule.get("rule_id")
    if method == "embedded_tax":
        maths = f"{gross:,.2f} x {rate:g} / {1 + rate:g}"
    elif method == "per_unit":
        maths = f"{quantity:g} units x {float(rule.get('amount_per_unit') or 0):,.2f}"
    elif method == "percent_of_net":
        maths = f"{net_base:,.2f} net x {rate:g}"
    else:
        maths = f"{gross:,.2f} x {rate:g}"
    return f"{label}: {name} [{rule.get('rule_id')}] {method}: {maths} = {amount:,.2f}"


@router.get("/deductions/{rule_id}", response_model=ForecastResponse)
async def get_deduction(rule_id: str):
    """One deduction rule."""
    conn = db_manager.get_connection()
    try:
        rule = get_deduction_rule(conn.cursor(), rule_id)
    finally:
        db_manager.close_connection(conn)
    if not rule:
        raise HTTPException(status_code=404, detail=f"Deduction rule '{rule_id}' not found")
    return ForecastResponse(status="success", data={"rule": describe_deduction_rule(rule)})


@router.put("/deductions/{rule_id}", response_model=ForecastResponse)
async def update_deduction(rule_id: str, payload: Dict[str, Any] = Body(...)):
    """
    Partial update: only the fields sent change (send null / '' to clear a
    scope field). 409 when the updated rule would be active with the same
    slot as another active rule (see POST).
    """
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        existing = get_deduction_rule(cursor, rule_id)
        if not existing:
            raise HTTPException(status_code=404, detail=f"Deduction rule '{rule_id}' not found")
        merged = {k: existing.get(k) for k in DEDUCTION_FIELDS}
        merged.update({k: v for k, v in payload.items() if k in DEDUCTION_FIELDS})
        if "name" not in payload and _rule_name_is_default(existing):
            merged["name"] = None  # regenerate the default name from the new values
        try:
            clean, warnings = clean_deduction_rule(cursor, merged)
        except RuleValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        warnings.extend(_plausibility_warnings(clean, "rule", is_price=False))
        if clean["is_active"]:
            try:
                check_duplicate_rule(cursor, "deduction", clean, exclude_id=rule_id)
            except DuplicateRuleError as exc:
                raise HTTPException(status_code=409, detail=str(exc))
        unknown = _unknown_keys(payload, DEDUCTION_FIELDS)
        if unknown:
            warnings.append(f"ignored unknown fields {', '.join(unknown)}")
        update_deduction_rule(cursor, rule_id, clean)
        conn.commit()
        rule = describe_deduction_rule(get_deduction_rule(cursor, rule_id))
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("Error updating deduction rule")
        raise HTTPException(status_code=500, detail=f"Error updating deduction rule: {exc}")
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data={"rule": rule, "warnings": warnings},
                            message=f"Deduction rule {rule_id} updated")


def _rule_name_is_default(rule: Dict[str, Any]) -> bool:
    try:
        clean = {k: rule.get(k) for k in DEDUCTION_FIELDS}
        clean["rate"] = float(clean.get("rate") or 0)
        clean["amount_per_unit"] = float(clean.get("amount_per_unit") or 0)
        return rule.get("name") == _default_rule_name(clean)
    except (KeyError, TypeError, ValueError):
        return False


@router.delete("/deductions/{rule_id}", response_model=ForecastResponse)
async def delete_deduction(rule_id: str):
    """Delete one deduction rule."""
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        existing = get_deduction_rule(cursor, rule_id)
        if not existing:
            raise HTTPException(status_code=404, detail=f"Deduction rule '{rule_id}' not found")
        cursor.execute("DELETE FROM sales_deduction_rules WHERE rule_id = ?", (rule_id,))
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data={"deleted": describe_deduction_rule(existing)},
                            message=f"Deduction rule {rule_id} deleted")


# ---------------------------------------------------------------------------
# Price list
# ---------------------------------------------------------------------------

@router.get("/prices", response_model=ForecastResponse)
async def list_prices(
    forecast_id: Optional[str] = Query(None, description="Scenario: its prices plus company-wide ones. Omit for every price."),
    unit_id: Optional[str] = Query(None, description="Prices that apply to this product (its own, its product type's and all-product rules)"),
    customer_id: Optional[str] = Query(None, description="Only rules for this customer"),
    customer_type: Optional[str] = Query(None, description="Only rules for this customer type"),
    include_inactive: bool = Query(True, description="Include rules switched off with is_active = 0"),
):
    """Price-list rules with product / customer names and the price each one gives."""
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        rules = load_price_rules(cursor, [forecast_id] if forecast_id else None, include_inactive=include_inactive)
        units, customers = _master_maps(cursor)
    finally:
        db_manager.close_connection(conn)
    if unit_id:
        unit_type = ((units.get(unit_id) or {}).get("unit_type") or "").strip().lower()
        rules = [r for r in rules if (not r.get("unit_id") or r.get("unit_id") == unit_id)
                 and (not (r.get("unit_type") or "").strip() or r["unit_type"].strip().lower() == unit_type)]
    if customer_id:
        rules = [r for r in rules if r.get("customer_id") == customer_id]
    if customer_type:
        rules = [r for r in rules if (r.get("customer_type") or "").strip().lower() == customer_type.strip().lower()]
    rules.sort(key=lambda r: (r.get("unit_id") or "~", -price_specificity(r), r.get("customer_type") or "",
                              r.get("customer_id") or "", r.get("start_period") or "", r.get("price_id") or ""))
    described = [_describe_price_rule(r, units, customers) for r in rules]
    return ForecastResponse(status="success", data={"prices": described, "count": len(described), "forecast_id": forecast_id},
                            message=f"Retrieved {len(described)} price rules")


@router.post("/prices", response_model=ForecastResponse)
async def create_prices(payload: Any = Body(...)):
    """
    Create one price rule (body = the rule) or several (``{"prices": [...]}``).
    All-or-nothing; the 422 lists every invalid rule. A rule whose scenario,
    scope fields (unit_id, customer_id, customer_type, unit_type) and
    start/end months equal an existing ACTIVE rule's is refused with 409 and
    a detail naming that rule: update it instead.
    """
    items, bulk = _body_items(payload, "prices")
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        cleaned: List[Tuple[int, Dict[str, Any]]] = []
        errors: List[str] = []
        warnings: List[str] = []
        for index, item in enumerate(items, start=1):
            label = f"price {index}" if bulk else "price"
            try:
                clean, price_warnings = clean_price_rule(cursor, item, label=label)
            except RuleValidationError as exc:
                errors.append(f"{label}: {exc}" if bulk else str(exc))
                continue
            price_warnings.extend(_plausibility_warnings(clean, label, is_price=True))
            unknown = _unknown_keys(item, PRICE_FIELDS)
            if unknown:
                price_warnings.append(f"{label}: ignored unknown fields {', '.join(unknown)}")
            cleaned.append((index, clean))
            warnings.extend(price_warnings)
        if errors:
            raise HTTPException(status_code=422, detail="; ".join(errors))
        _refuse_duplicates(cursor, "price", cleaned, bulk)
        ids = [insert_price_rule(cursor, clean) for _index, clean in cleaned]
        conn.commit()
        units, customers = _master_maps(cursor)
        created = [_describe_price_rule(get_price_rule(cursor, pid), units, customers) for pid in ids]
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("Error creating prices")
        raise HTTPException(status_code=500, detail=f"Error creating prices: {exc}")
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data={"prices": created, "created": len(created), "warnings": warnings},
                            message=f"Created {len(created)} price rule{'s' if len(created) != 1 else ''}")


@router.get("/resolve", response_model=ForecastResponse)
async def resolve_price_endpoint(
    unit_id: str = Query(..., description="Product"),
    customer_id: Optional[str] = Query(None, description="Customer (its customer_type is used too)"),
    customer_type: Optional[str] = Query(None, description="Customer type, when pricing without a specific customer"),
    period: Optional[str] = Query(None, description="Month (YYYY-MM); omit to ignore effective dates"),
    forecast_id: Optional[str] = Query(None, description="Scenario; omit for company-wide prices only"),
):
    """The price a customer pays for a product in a month, and which rule gave it."""
    try:
        month = _parse_month(period, "period")
    except RuleValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        _require_forecast(cursor, forecast_id)
        cursor.execute("SELECT unit_name, base_price, unit_type FROM units WHERE unit_id = ?", (unit_id,))
        unit = cursor.fetchone()
        if not unit:
            raise HTTPException(status_code=404, detail=f"Product '{unit_id}' not found")
        ctype = _text(customer_type)
        customer_name = None
        if customer_id:
            cursor.execute("SELECT customer_name, customer_type FROM customers WHERE customer_id = ?", (customer_id,))
            customer = cursor.fetchone()
            if not customer:
                raise HTTPException(status_code=404, detail=f"Customer '{customer_id}' not found")
            customer_name = customer[0]
            ctype = ctype or customer[1]
        rules = load_price_rules(cursor, [forecast_id] if forecast_id else [])
    finally:
        db_manager.close_connection(conn)
    row = {"forecast_id": forecast_id, "unit_id": unit_id, "unit_type": unit[2], "customer_id": customer_id,
           "customer_type": ctype, "period": month}
    resolved = resolve_price(rules, row, base_price=unit[1])
    rule = next((r for r in rules if r.get("price_id") and r.get("price_id") == resolved.get("price_id")), None)
    data = {
        **resolved,
        "price": round(resolved["price"], 4) if resolved["price"] is not None else None,
        "source_label": PRICE_SOURCE_LABELS.get(resolved["source"], resolved["source"]),
        "rule": rule,
        "unit_id": unit_id, "unit_name": unit[0], "base_price": unit[1], "unit_type": unit[2],
        "customer_id": customer_id, "customer_name": customer_name, "customer_type": ctype,
        "period": month, "forecast_id": forecast_id,
    }
    return ForecastResponse(status="success", data=data,
                            message=f"{data['source_label']}: {data['price']}" if data["price"] is not None
                            else "No price: add a price-list entry or a base price for the product")


@router.post("/apply", response_model=ForecastResponse)
async def apply_price_list(payload: Dict[str, Any] = Body(...)):
    """
    Re-price a scenario's sales rows from the price list.

    Body: ``{forecast_id, periods?, start_period?, end_period?, customer_ids?,
    customer_types?, unit_ids?, only_missing?: false,
    fallback_to_base_price?: true, dry_run?: false}``. Each matching row gets
    the resolved price and total_revenue = quantity x unit_price. Rows the
    price list cannot price (source 'none') are left alone and reported.
    ``only_missing`` touches only rows whose price is empty or 0.
    ``fallback_to_base_price: false`` only skips the last step (the
    product's base price when no rule matches); discount-off-list rules
    still price from the base price.
    """
    forecast_id = _text(payload.get("forecast_id"))
    if not forecast_id:
        raise HTTPException(status_code=422, detail="forecast_id is required")
    dry_run = bool(payload.get("dry_run", False))
    only_missing = bool(payload.get("only_missing", False))
    fallback = payload.get("fallback_to_base_price", True)
    fallback = True if fallback is None else bool(fallback)

    def _list(key: str) -> List[str]:
        value = payload.get(key)
        if value is None or value == "":
            return []
        if isinstance(value, str):
            value = value.split(",")
        if not isinstance(value, list):
            raise HTTPException(status_code=422, detail=f"{key} must be a list")
        return [str(v).strip() for v in value if str(v).strip()]

    try:
        periods = []
        for raw in _list("periods"):
            month = _parse_month(raw, "periods")
            periods.append(month)
        start = _parse_month(payload.get("start_period"), "start_period")
        end = _parse_month(payload.get("end_period"), "end_period")
        _check_window(start, end)
    except RuleValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    customer_ids = _list("customer_ids")
    customer_types = [t.lower() for t in _list("customer_types")]
    unit_ids = _list("unit_ids")

    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        _require_forecast(cursor, forecast_id)
        where = ["s.forecast_id = ?"]
        params: List[Any] = [forecast_id]
        if periods:
            where.append(f"substr(s.period, 1, 7) IN ({','.join('?' for _ in periods)})")
            params.extend(periods)
        if start:
            where.append("substr(s.period, 1, 7) >= ?")
            params.append(start)
        if end:
            where.append("substr(s.period, 1, 7) <= ?")
            params.append(end)
        if customer_ids:
            where.append(f"s.customer_id IN ({','.join('?' for _ in customer_ids)})")
            params.extend(customer_ids)
        if unit_ids:
            where.append(f"s.unit_id IN ({','.join('?' for _ in unit_ids)})")
            params.extend(unit_ids)
        if customer_types:
            where.append(f"LOWER(TRIM(c.customer_type)) IN ({','.join('?' for _ in customer_types)})")
            params.extend(customer_types)
        if only_missing:
            where.append("(s.unit_price IS NULL OR s.unit_price = 0)")
        cursor.execute(
            f"""SELECT s.sale_id, s.customer_id, s.unit_id, s.period, s.quantity, s.unit_price, s.total_revenue,
                       c.customer_type, u.base_price, u.unit_type
                FROM sales s
                LEFT JOIN customers c ON s.customer_id = c.customer_id
                LEFT JOIN units u ON s.unit_id = u.unit_id
                WHERE {' AND '.join(where)}
                ORDER BY s.period, s.customer_id, s.unit_id""",
            params,
        )
        rows = cursor.fetchall()
        rules = load_price_rules(cursor, [forecast_id])

        by_source: Dict[str, int] = {}
        changes: List[Dict[str, Any]] = []
        unpriced: List[Dict[str, Any]] = []
        revenue_before = revenue_after = 0.0
        changed = unchanged = 0
        for sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue, ctype, base_price, utype in rows:
            qty = float(quantity or 0)
            old_price = float(unit_price) if unit_price is not None else None
            old_revenue = float(total_revenue) if total_revenue is not None else qty * float(unit_price or 0)
            revenue_before += old_revenue
            month = normalize_month(period)
            resolved = resolve_price(
                rules,
                {"forecast_id": forecast_id, "unit_id": unit_id, "unit_type": utype, "customer_id": customer_id,
                 "customer_type": ctype, "period": month},
                base_price=base_price,
                fallback_to_base=fallback,
            )
            source = resolved["source"]
            by_source[source] = by_source.get(source, 0) + 1
            if resolved["price"] is None:
                revenue_after += old_revenue
                unpriced.append({"sale_id": sale_id, "customer_id": customer_id, "customer_type": ctype,
                                 "unit_id": unit_id, "period": period, "quantity": qty, "unit_price": old_price})
                continue
            new_price = round(float(resolved["price"]), 4)
            new_revenue = qty * new_price
            revenue_after += new_revenue
            if old_price is not None and abs(new_price - old_price) < 1e-9 and abs(new_revenue - old_revenue) < 0.005:
                unchanged += 1
                continue
            changed += 1
            cursor.execute("UPDATE sales SET unit_price = ?, total_revenue = ? WHERE sale_id = ?",
                           (new_price, new_revenue, sale_id))
            changes.append({
                "sale_id": sale_id, "customer_id": customer_id, "customer_type": ctype, "unit_id": unit_id,
                "period": period, "quantity": qty, "old_price": old_price, "new_price": round(new_price, 4),
                "old_revenue": round(old_revenue, 2), "new_revenue": round(new_revenue, 2),
                "source": source, "price_id": resolved["price_id"],
            })
        if dry_run:
            conn.rollback()
        else:
            conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("Error applying price list")
        raise HTTPException(status_code=500, detail=f"Error applying price list: {exc}")
    finally:
        db_manager.close_connection(conn)

    warnings = []
    if unpriced:
        if fallback:
            warnings.append(f"{len(unpriced)} rows have no price-list entry or base price and were left unchanged")
        else:
            warnings.append(f"{len(unpriced)} rows have no price-list entry that can price them (the base-price "
                            f"fallback is off) and were left unchanged")
    data = {
        "forecast_id": forecast_id,
        "dry_run": dry_run,
        "matched": len(rows),
        "priced": len(rows) - len(unpriced),
        "changed": changed,
        "unchanged": unchanged,
        "unpriced": len(unpriced),
        "revenue_before": round(revenue_before, 2),
        "revenue_after": round(revenue_after, 2),
        "revenue_change": round(revenue_after - revenue_before, 2),
        "by_source": by_source,
        "sample_changes": changes[:25],
        "unpriced_rows": unpriced[:50],
        "warnings": warnings,
    }
    verb = "would change" if dry_run else "changed"
    return ForecastResponse(
        status="success", data=data,
        message=f"{'Dry run: ' if dry_run else ''}{changed} of {len(rows)} sales rows {verb}; revenue "
                f"{revenue_before:,.2f} -> {revenue_after:,.2f}",
    )


@router.get("/prices/{price_id}", response_model=ForecastResponse)
async def get_price(price_id: str):
    """One price rule."""
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        rule = get_price_rule(cursor, price_id)
        units, customers = _master_maps(cursor)
    finally:
        db_manager.close_connection(conn)
    if not rule:
        raise HTTPException(status_code=404, detail=f"Price rule '{price_id}' not found")
    return ForecastResponse(status="success", data={"price": _describe_price_rule(rule, units, customers)})


@router.put("/prices/{price_id}", response_model=ForecastResponse)
async def update_price(price_id: str, payload: Dict[str, Any] = Body(...)):
    """
    Partial update of a price rule (send null / '' to clear a scope field).
    409 when the updated rule would be active with the same scope and months
    as another active rule (see POST).
    """
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        existing = get_price_rule(cursor, price_id)
        if not existing:
            raise HTTPException(status_code=404, detail=f"Price rule '{price_id}' not found")
        merged = {k: existing.get(k) for k in PRICE_FIELDS}
        merged.update({k: v for k, v in payload.items() if k in PRICE_FIELDS})
        # Switching method drops the other method's number unless it was sent.
        if "method" in payload:
            if merged.get("method") == "discount_from_base" and "unit_price" not in payload:
                merged["unit_price"] = None
            if merged.get("method") == "fixed" and "discount_pct" not in payload:
                merged["discount_pct"] = None
        try:
            clean, warnings = clean_price_rule(cursor, merged)
        except RuleValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        warnings.extend(_plausibility_warnings(clean, "price", is_price=True))
        if clean["is_active"]:
            try:
                check_duplicate_rule(cursor, "price", clean, exclude_id=price_id)
            except DuplicateRuleError as exc:
                raise HTTPException(status_code=409, detail=str(exc))
        unknown = _unknown_keys(payload, PRICE_FIELDS)
        if unknown:
            warnings.append(f"ignored unknown fields {', '.join(unknown)}")
        update_price_rule(cursor, price_id, clean)
        conn.commit()
        units, customers = _master_maps(cursor)
        rule = _describe_price_rule(get_price_rule(cursor, price_id), units, customers)
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.exception("Error updating price rule")
        raise HTTPException(status_code=500, detail=f"Error updating price rule: {exc}")
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data={"price": rule, "warnings": warnings},
                            message=f"Price rule {price_id} updated")


@router.delete("/prices/{price_id}", response_model=ForecastResponse)
async def delete_price(price_id: str):
    """Delete one price rule."""
    conn = db_manager.get_connection()
    try:
        cursor = conn.cursor()
        existing = get_price_rule(cursor, price_id)
        if not existing:
            raise HTTPException(status_code=404, detail=f"Price rule '{price_id}' not found")
        cursor.execute("DELETE FROM price_list WHERE price_id = ?", (price_id,))
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    finally:
        db_manager.close_connection(conn)
    return ForecastResponse(status="success", data={"deleted": existing}, message=f"Price rule {price_id} deleted")
