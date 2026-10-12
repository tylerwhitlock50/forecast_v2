"""
Customer pricing and sales deductions.

Two rule tables drive the revenue side of the model:

* ``price_list`` - what a customer pays for a product. Used to fill in the
  unit price when a sales row is imported without one, and by the
  "apply price list" action. A fixed price or a discount off the product's
  base (list) price, scoped to a customer, a customer type, a product, or
  combinations of them.
* ``sales_deduction_rules`` - discounts and allowances taken off gross sales
  (terms allowance, chargebacks, other allowances), federal excise tax
  embedded in the price, and sales commissions. The statements engine
  applies them to every sales row, so gross sales -> net sales -> gross
  profit all come from one place.

Rule precedence (both tables)
-----------------------------
A rule matches a row when every scope field it sets (customer_id,
customer_type, unit_id, unit_type) equals the row's value, its period range
covers the row's month, it is active, and it is company-wide (forecast_id
NULL) or belongs to the row's scenario. Among matching rules the most
specific wins:

    deductions: 8*customer_id + 4*customer_type + 2*unit_id + 1*unit_type
    prices:     4*customer_id + 2*customer_type + 1*unit_id

Ties go to the scenario-specific rule, then the later start_period, then the
rule id. Exactly one rule per deduction type applies to a row (so a customer
rule overrides the customer-type rule, and a rate of 0 is an exemption);
different deduction types stack.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------

#: Deduction types, in statement order. ``treatment`` says where the amount
#: lands: ``contra_revenue`` lines sit between gross and net sales;
#: ``selling_expense`` is an operating expense below gross profit.
DEDUCTION_TYPES: Dict[str, Dict[str, str]] = {
    "terms_allowance": {
        "label": "Terms allowance",
        "treatment": "contra_revenue",
        "statement_line": "terms_allowance",
        "description": "Early-payment / dating terms discounts customers take (e.g. 2% 10 net 30).",
    },
    "chargebacks": {
        "label": "Chargebacks allowance",
        "treatment": "contra_revenue",
        "statement_line": "chargebacks",
        "description": "Miscellaneous customer chargebacks and deductions taken from payments.",
    },
    "other_allowance": {
        "label": "Other discounts & allowances",
        "treatment": "contra_revenue",
        "statement_line": "other_allowances",
        "description": "Volume rebates, co-op advertising, freight or returns allowances.",
    },
    "excise_tax": {
        "label": "Excise tax (FET)",
        "treatment": "contra_revenue",
        "statement_line": "excise_tax",
        "description": "Federal excise tax included in the selling price and remitted to the government. "
                       "Use method embedded_tax: tax = price x rate / (1 + rate); at 11% a $1,110 invoice carries $110.",
    },
    "commission": {
        "label": "Sales commissions",
        "treatment": "selling_expense",
        "statement_line": "commissions",
        "description": "Commissions paid to reps / agents; an operating expense below gross profit.",
    },
}

CONTRA_REVENUE_TYPES: Tuple[str, ...] = tuple(
    k for k, v in DEDUCTION_TYPES.items() if v["treatment"] == "contra_revenue"
)

DEDUCTION_METHODS: Dict[str, str] = {
    "percent_of_gross": "rate x gross sales of the row",
    "percent_of_net": "rate x (gross sales - the row's contra-revenue deductions computed on gross, per unit or embedded)",
    "embedded_tax": "gross x rate / (1 + rate): a tax already included in the price (11% -> 9.91% of the invoice)",
    "per_unit": "amount_per_unit x quantity",
}

PRICE_METHODS: Dict[str, str] = {
    "fixed": "unit_price is the price",
    "discount_from_base": "price = product base_price x (1 - discount_pct)",
}

DEDUCTION_EXAMPLE = (
    "Example: a $1,110.00 invoice to a dealer with a 2% terms allowance, 1% chargebacks allowance and 11% "
    "embedded FET -> terms $22.20, chargebacks $11.10, FET $110.00 (1,110 x 0.11 / 1.11), net sales $966.70."
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _norm(value: Any) -> Optional[str]:
    """Scope values compare trimmed; blank means 'any'."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _norm_ci(value: Any) -> Optional[str]:
    text = _norm(value)
    return text.lower() if text is not None else None


def _rows(cursor) -> List[Dict[str, Any]]:
    columns = [d[0] for d in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _table_exists(cursor, name: str) -> bool:
    cursor.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,))
    return cursor.fetchone() is not None


def _in_period(rule: Dict[str, Any], period: Optional[str]) -> bool:
    if not period:
        return True
    start = _norm(rule.get("start_period"))
    end = _norm(rule.get("end_period"))
    if start and period < start:
        return False
    if end and period > end:
        return False
    return True


def _active(rule: Dict[str, Any]) -> bool:
    flag = rule.get("is_active")
    if flag is None or isinstance(flag, bool):
        return flag is not False
    text = str(flag).strip().lower()
    return text not in ("0", "false", "no", "off")


def _scenario_ok(rule: Dict[str, Any], forecast_id: Optional[str]) -> bool:
    rule_fid = _norm(rule.get("forecast_id"))
    return rule_fid is None or rule_fid == _norm(forecast_id)


def _sort_key(rule: Dict[str, Any], score: int) -> Tuple:
    return (
        score,
        1 if _norm(rule.get("forecast_id")) else 0,
        _norm(rule.get("start_period")) or "",
        str(rule.get("rule_id") or rule.get("price_id") or ""),
    )


# ---------------------------------------------------------------------------
# Deductions
# ---------------------------------------------------------------------------

def load_deduction_rules(cursor, forecast_ids: Optional[Sequence[str]] = None,
                         include_inactive: bool = False) -> List[Dict[str, Any]]:
    """Rules visible to the given scenarios (theirs + company-wide). None = all rules."""
    if not _table_exists(cursor, "sales_deduction_rules"):
        return []
    where = []
    params: List[Any] = []
    if forecast_ids is not None:
        ids = [f for f in forecast_ids if f]
        if ids:
            where.append(f"(forecast_id IN ({','.join('?' for _ in ids)}) OR forecast_id IS NULL)")
            params.extend(ids)
        else:
            where.append("forecast_id IS NULL")
    if not include_inactive:
        where.append("(is_active IS NULL OR is_active = 1)")
    cursor.execute(
        f"SELECT * FROM sales_deduction_rules {('WHERE ' + ' AND '.join(where)) if where else ''} "
        f"ORDER BY deduction_type, rule_id",
        params,
    )
    return _rows(cursor)


def deduction_specificity(rule: Dict[str, Any]) -> int:
    return (8 * bool(_norm(rule.get("customer_id")))
            + 4 * bool(_norm(rule.get("customer_type")))
            + 2 * bool(_norm(rule.get("unit_id")))
            + 1 * bool(_norm(rule.get("unit_type"))))


def _deduction_matches(rule: Dict[str, Any], row: Dict[str, Any]) -> bool:
    if not _active(rule) or not _scenario_ok(rule, row.get("forecast_id")):
        return False
    if _norm(rule.get("customer_id")) and _norm(rule.get("customer_id")) != _norm(row.get("customer_id")):
        return False
    if _norm(rule.get("unit_id")) and _norm(rule.get("unit_id")) != _norm(row.get("unit_id")):
        return False
    if _norm(rule.get("customer_type")) and _norm_ci(rule.get("customer_type")) != _norm_ci(row.get("customer_type")):
        return False
    if _norm(rule.get("unit_type")) and _norm_ci(rule.get("unit_type")) != _norm_ci(row.get("unit_type")):
        return False
    return _in_period(rule, row.get("period"))


class DeductionResolver:
    """
    Picks the winning rule per deduction type for sales rows.

    Built once per report; candidate rules are cached per
    (forecast, customer, customer type, product, product type) so a large
    forecast only filters the rule list once per customer/product pair.
    """

    def __init__(self, rules: Iterable[Dict[str, Any]]):
        self.rules = [r for r in rules if _active(r)]
        self._cache: Dict[Tuple, Dict[str, List[Tuple[Tuple, Dict[str, Any]]]]] = {}

    def __bool__(self) -> bool:
        return bool(self.rules)

    def _candidates(self, row: Dict[str, Any]) -> Dict[str, List[Tuple[Tuple, Dict[str, Any]]]]:
        key = (_norm(row.get("forecast_id")), _norm(row.get("customer_id")), _norm_ci(row.get("customer_type")),
               _norm(row.get("unit_id")), _norm_ci(row.get("unit_type")))
        cached = self._cache.get(key)
        if cached is None:
            probe = dict(row, period=None)
            cached = {}
            for rule in self.rules:
                if _deduction_matches(rule, probe):
                    entry = (_sort_key(rule, deduction_specificity(rule)), rule)
                    cached.setdefault(rule.get("deduction_type"), []).append(entry)
            for entries in cached.values():
                entries.sort(key=lambda e: e[0], reverse=True)
            self._cache[key] = cached
        return cached

    def winners(self, row: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
        """{deduction_type: winning rule} for one row (period-aware)."""
        out: Dict[str, Dict[str, Any]] = {}
        period = row.get("period")
        for dtype, entries in self._candidates(row).items():
            for _key, rule in entries:
                if _in_period(rule, period):
                    out[dtype] = rule
                    break
        return out

    def compute(self, row: Dict[str, Any]) -> Dict[str, Any]:
        """
        Deduction amounts for one sales row.

        ``row`` needs gross_sales and quantity plus the scope fields. Returns
        an amount per deduction type, total contra-revenue deductions, net
        sales, commission and the id of the rule applied per type.
        """
        return compute_row_deductions(self.winners(row), row)


def rule_amount(rule: Dict[str, Any], gross: float, quantity: float, net_base: Optional[float] = None) -> float:
    method = rule.get("method") or "percent_of_gross"
    rate = float(rule.get("rate") or 0)
    if method == "percent_of_gross":
        return gross * rate
    if method == "embedded_tax":
        return gross * rate / (1 + rate) if rate > -1 else 0.0
    if method == "per_unit":
        return quantity * float(rule.get("amount_per_unit") or 0)
    if method == "percent_of_net":
        return (net_base if net_base is not None else gross) * rate
    return 0.0


def compute_row_deductions(winners: Dict[str, Dict[str, Any]], row: Dict[str, Any]) -> Dict[str, Any]:
    gross = float(row.get("gross_sales") or 0)
    quantity = float(row.get("quantity") or 0)
    amounts = {dtype: 0.0 for dtype in DEDUCTION_TYPES}
    applied: Dict[str, str] = {}

    # Pass 1: everything not computed on net.
    for dtype, rule in winners.items():
        if dtype not in amounts:
            continue
        applied[dtype] = rule.get("rule_id")
        if (rule.get("method") or "percent_of_gross") != "percent_of_net":
            amounts[dtype] = rule_amount(rule, gross, quantity)
    # Pass 2: percent_of_net on gross less the pass-1 contra-revenue deductions.
    net_base = gross - sum(amounts[t] for t in CONTRA_REVENUE_TYPES)
    for dtype, rule in winners.items():
        if dtype in amounts and (rule.get("method") or "") == "percent_of_net":
            amounts[dtype] = rule_amount(rule, gross, quantity, net_base=net_base)

    total = sum(amounts[t] for t in CONTRA_REVENUE_TYPES)
    return {
        **amounts,
        "total_sales_deductions": total,
        "net_sales": gross - total,
        "applied_rules": applied,
    }


# ---------------------------------------------------------------------------
# Prices
# ---------------------------------------------------------------------------

def load_price_rules(cursor, forecast_ids: Optional[Sequence[str]] = None,
                     include_inactive: bool = False) -> List[Dict[str, Any]]:
    if not _table_exists(cursor, "price_list"):
        return []
    where = []
    params: List[Any] = []
    if forecast_ids is not None:
        ids = [f for f in forecast_ids if f]
        if ids:
            where.append(f"(forecast_id IN ({','.join('?' for _ in ids)}) OR forecast_id IS NULL)")
            params.extend(ids)
        else:
            where.append("forecast_id IS NULL")
    if not include_inactive:
        where.append("(is_active IS NULL OR is_active = 1)")
    cursor.execute(
        f"SELECT * FROM price_list {('WHERE ' + ' AND '.join(where)) if where else ''} ORDER BY unit_id, price_id",
        params,
    )
    return _rows(cursor)


def price_specificity(rule: Dict[str, Any]) -> int:
    return (4 * bool(_norm(rule.get("customer_id")))
            + 2 * bool(_norm(rule.get("customer_type")))
            + 1 * bool(_norm(rule.get("unit_id"))))


def price_source(rule: Optional[Dict[str, Any]]) -> str:
    if rule is None:
        return "none"
    has_customer = bool(_norm(rule.get("customer_id")))
    has_type = bool(_norm(rule.get("customer_type")))
    has_unit = bool(_norm(rule.get("unit_id")))
    if has_customer:
        return "customer_product" if has_unit else "customer_all"
    if has_type:
        return "type_product" if has_unit else "type_all"
    return "product" if has_unit else "all"


def rule_price(rule: Dict[str, Any], base_price: Optional[float]) -> Optional[float]:
    """Price a rule gives, or None when it cannot price (discount with no base price)."""
    method = rule.get("method") or "fixed"
    if method == "discount_from_base":
        base = float(base_price or 0)
        if base <= 0 or rule.get("discount_pct") is None:
            return None
        return base * (1 - float(rule.get("discount_pct") or 0))
    if rule.get("unit_price") is None:
        return None
    return float(rule["unit_price"])


def _price_matches(rule: Dict[str, Any], row: Dict[str, Any]) -> bool:
    if not _active(rule) or not _scenario_ok(rule, row.get("forecast_id")):
        return False
    if _norm(rule.get("unit_id")) and _norm(rule.get("unit_id")) != _norm(row.get("unit_id")):
        return False
    if _norm(rule.get("customer_id")) and _norm(rule.get("customer_id")) != _norm(row.get("customer_id")):
        return False
    if _norm(rule.get("customer_type")) and _norm_ci(rule.get("customer_type")) != _norm_ci(row.get("customer_type")):
        return False
    return _in_period(rule, row.get("period"))


def resolve_price(rules: Iterable[Dict[str, Any]], row: Dict[str, Any],
                  base_price: Optional[float] = None) -> Dict[str, Any]:
    """
    Price for a (forecast_id, unit_id, customer_id, customer_type, period) row.

    Returns {"price", "source", "price_id"}: the most specific price-list
    rule that can price the row, else the product's base price
    (source 'base_price'), else {"price": None, "source": "none"}.
    """
    candidates = []
    for rule in rules:
        if _price_matches(rule, row):
            candidates.append((_sort_key(rule, price_specificity(rule)), rule))
    candidates.sort(key=lambda e: e[0], reverse=True)
    for _key, rule in candidates:
        price = rule_price(rule, base_price)
        if price is not None:
            return {"price": price, "source": price_source(rule), "price_id": rule.get("price_id")}
    if base_price is not None and float(base_price or 0) > 0:
        return {"price": float(base_price), "source": "base_price", "price_id": None}
    return {"price": None, "source": "none", "price_id": None}


def load_price_context(cursor, unit_ids: Optional[Iterable[str]] = None) -> Tuple[Dict[str, float], Dict[str, str]]:
    """(base_price by unit_id, customer_type by customer_id) for price resolution."""
    cursor.execute("SELECT unit_id, base_price FROM units")
    base = {uid: bp for uid, bp in cursor.fetchall()}
    cursor.execute("SELECT customer_id, customer_type FROM customers")
    ctypes = {cid: ct for cid, ct in cursor.fetchall()}
    return base, ctypes
