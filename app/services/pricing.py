"""
Customer pricing and sales deductions.

Two rule tables drive the revenue side of the model:

* ``price_list`` - what a customer pays for a product. Used to fill in the
  unit price when a sales row is imported without one, and by the
  "apply price list" action. A fixed price or a discount off the product's
  base (list) price, scoped to a customer, a customer type, a product, a
  product type, or combinations of them.
* ``sales_deduction_rules`` - discounts and allowances taken off gross sales
  (terms allowance, chargebacks, other allowances), federal excise tax
  embedded in the price, and sales commissions. The statements engine
  applies them to every sales row, so gross sales -> net sales -> gross
  profit all come from one place.

Rule precedence (both tables)
-----------------------------
A rule matches a row when every scope field it sets (customer_id,
customer_type, unit_id, unit_type) equals the row's value (customer_type and
unit_type compare trimmed and case-insensitively), its period range covers
the row's month, it is active, and it is company-wide (forecast_id NULL) or
belongs to the row's scenario. Among matching rules the most specific wins:

    specificity = 8*customer_id + 4*customer_type + 2*unit_id + 1*unit_type

(the same score for deductions and prices). Ties are broken, in order, by:

1. the scenario-specific rule over the company-wide one;
2. the later start_period (an open start counts as earliest);
3. the earlier end_period (a bounded window beats an open-ended one);
4. the newer rule (created_at; ``2026-10-12 09:00:00`` and
   ``2026-10-12T09:00:00`` compare equal);
5. the higher rule id / price id.

So the outcome never depends on the order rules are listed in. The API
refuses to create a second active rule with the identical scope and periods
(see ``deduction_rule_key`` / ``price_rule_key``), so steps 4-5 only settle
rules that predate that check.

Which rules apply to a sales row
--------------------------------
* terms_allowance, chargebacks, excise_tax, commission: exactly one rule per
  type applies, the most specific (a customer rule overrides the customer
  type rule; a rate of 0 is an exemption).
* other_allowance: each rule belongs to a PROGRAM named by its normalised
  name (trimmed, case-folded, inner whitespace collapsed), e.g. "Co-op
  advertising", "Freight allowance", "Volume rebate". Every program that
  matches the row applies and the programs add up; within one program the
  most specific rule wins, so "Co-op advertising" for one customer replaces
  the Distributor "Co-op advertising" rule for that customer. A rule with no
  name (blank, or the automatic name the API writes when none is given) is
  a program of its own.
* Different deduction types stack. percent_of_net amounts (any type) are
  computed after the others, on gross less the contra-revenue amounts
  computed on gross, per unit or embedded.
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
        "description": "Volume rebates, co-op advertising, freight or returns allowances. Each named rule is a "
                       "separate program: every matching program applies and they add up; within one program "
                       "name the most specific rule wins.",
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

#: Deduction types whose rules stack as independent programs (keyed by the
#: rule's normalised name) instead of one rule per row.
STACKING_TYPES: Tuple[str, ...] = ("other_allowance",)

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


def _month_number(value: Any) -> Optional[int]:
    text = _norm(value)
    if not text or len(text) < 7 or not (text[:4].isdigit() and text[5:7].isdigit()):
        return None
    return int(text[:4]) * 100 + int(text[5:7])


def _timestamp(value: Any) -> str:
    """created_at as comparable text: SQLite's 'YYYY-MM-DD HH:MM:SS' and ISO 'T' forms compare equal."""
    return (_norm(value) or "").replace("T", " ")


def _sort_key(rule: Dict[str, Any], score: int) -> Tuple:
    """
    Precedence key, higher wins (sort with reverse=True): specificity, then
    scenario-specific, later start_period, earlier end_period (bounded beats
    open-ended), newer created_at, higher id. See the module docstring.
    """
    end = _month_number(rule.get("end_period"))
    return (
        score,
        1 if _norm(rule.get("forecast_id")) else 0,
        _norm(rule.get("start_period")) or "",
        -end if end is not None else -999999,
        _timestamp(rule.get("created_at")),
        str(rule.get("rule_id") or rule.get("price_id") or ""),
    )


def precedence_key(rule: Dict[str, Any], kind: str = "deduction") -> Tuple:
    """The full precedence key of a rule (higher wins); ``kind`` is 'deduction' or 'price'."""
    score = price_specificity(rule) if kind == "price" else deduction_specificity(rule)
    return _sort_key(rule, score)


def normalise_rule_name(name: Any) -> Optional[str]:
    """Program name for matching: trimmed, case-folded, inner whitespace collapsed; blank -> None."""
    text = _norm(name)
    return " ".join(text.casefold().split()) if text else None


def default_rule_name(rule: Dict[str, Any]) -> Optional[str]:
    """
    The automatic name the API gives a deduction rule saved without one,
    e.g. "Terms allowance 2% (Dealer)" or "Other discounts & allowances
    $3.00/unit (Distributor)". None when the rule cannot be described.
    """
    info = DEDUCTION_TYPES.get(rule.get("deduction_type") or "")
    if not info:
        return None
    method = rule.get("method") or "percent_of_gross"
    try:
        if method == "per_unit":
            amount = f"${float(rule.get('amount_per_unit') or 0):,.2f}/unit"
        else:
            amount = f"{float(rule.get('rate') or 0) * 100:g}%"
            if method == "embedded_tax":
                amount += " embedded"
            elif method == "percent_of_net":
                amount += " of net"
    except (TypeError, ValueError):
        return None
    scope = [_norm(rule.get(k)) for k in ("customer_id", "customer_type", "unit_id", "unit_type") if _norm(rule.get(k))]
    return f"{info['label']} {amount}" + (f" ({', '.join(scope)})" if scope else "")


def program_name(rule: Dict[str, Any]) -> Optional[str]:
    """
    The normalised name that identifies a rule's program, or None for an
    unnamed rule: a blank name, or the automatic name the API wrote because
    none was given (see ``default_rule_name``).
    """
    name = normalise_rule_name(rule.get("name"))
    if name is None or name == normalise_rule_name(default_rule_name(rule)):
        return None
    return name


def deduction_program(rule: Dict[str, Any]) -> str:
    """
    The program a rule belongs to. other_allowance rules are keyed by their
    normalised name (an unnamed rule, see ``program_name``, is a program of
    its own); every other type has a single program, so one rule per type
    applies.
    """
    dtype = rule.get("deduction_type") or ""
    if dtype in STACKING_TYPES:
        name = program_name(rule)
        return f"name:{name}" if name else f"id:{rule.get('rule_id') or id(rule)}"
    return dtype


def _scope_values(rule: Dict[str, Any]) -> Tuple:
    return (
        _norm(rule.get("forecast_id")),
        _norm(rule.get("customer_id")),
        _norm_ci(rule.get("customer_type")),
        _norm(rule.get("unit_id")),
        _norm_ci(rule.get("unit_type")),
        _norm(rule.get("start_period")),
        _norm(rule.get("end_period")),
    )


def deduction_rule_key(rule: Dict[str, Any]) -> Tuple:
    """
    Identity of a deduction rule's slot: (deduction_type, forecast_id, every
    scope field, start_period, end_period) plus, for other_allowance, the
    normalised program name (None for an unnamed rule, so two unnamed
    other_allowance rules with the same scope share one slot). Two active
    rules with the same key would tie, so the API refuses the second;
    imports should upsert on this key.
    """
    dtype = _norm(rule.get("deduction_type"))
    program = program_name(rule) if dtype in STACKING_TYPES else None
    return (dtype, *_scope_values(rule), program)


def price_rule_key(rule: Dict[str, Any]) -> Tuple:
    """Identity of a price rule's slot: (forecast_id, every scope field, start_period, end_period)."""
    return _scope_values(rule)


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
    Picks the rules that apply to sales rows: one per deduction type, except
    other_allowance where one per program (normalised rule name) applies.

    Built once per report; candidate rules are cached per
    (forecast, customer, customer type, product, product type) so a large
    forecast only filters the rule list once per customer/product pair.
    """

    def __init__(self, rules: Iterable[Dict[str, Any]]):
        self.rules = [r for r in rules if _active(r)]
        self._programs = {id(r): deduction_program(r) for r in self.rules}
        self._cache: Dict[Tuple, Dict[str, Dict[str, List[Tuple[Tuple, Dict[str, Any]]]]]] = {}

    def __bool__(self) -> bool:
        return bool(self.rules)

    def _candidates(self, row: Dict[str, Any]) -> Dict[str, Dict[str, List[Tuple[Tuple, Dict[str, Any]]]]]:
        """{deduction_type: {program: [(sort key, rule), ...] best first}} ignoring the period."""
        key = (_norm(row.get("forecast_id")), _norm(row.get("customer_id")), _norm_ci(row.get("customer_type")),
               _norm(row.get("unit_id")), _norm_ci(row.get("unit_type")))
        cached = self._cache.get(key)
        if cached is None:
            probe = dict(row, period=None)
            cached = {}
            for rule in self.rules:
                if _deduction_matches(rule, probe):
                    entry = (_sort_key(rule, deduction_specificity(rule)), rule)
                    programs = cached.setdefault(rule.get("deduction_type"), {})
                    programs.setdefault(self._programs[id(rule)], []).append(entry)
            for programs in cached.values():
                for entries in programs.values():
                    entries.sort(key=lambda e: e[0], reverse=True)
            self._cache[key] = cached
        return cached

    def applicable(self, row: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
        """
        {deduction_type: [rules that apply]} for one row (period-aware): one
        rule for most types, one per program for other_allowance, most
        specific program first.
        """
        out: Dict[str, List[Dict[str, Any]]] = {}
        period = row.get("period")
        for dtype, programs in self._candidates(row).items():
            chosen = []
            for entries in programs.values():
                for sort_key, rule in entries:
                    if _in_period(rule, period):
                        chosen.append((sort_key, rule))
                        break
            if chosen:
                chosen.sort(key=lambda e: e[0], reverse=True)
                out[dtype] = [rule for _key, rule in chosen]
        return out

    def winners(self, row: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
        """
        {deduction_type: winning rule} for one row (period-aware). For
        other_allowance this is only the most specific program; use
        ``applicable`` (or ``compute``) for every program that applies.
        """
        return {dtype: rules[0] for dtype, rules in self.applicable(row).items()}

    def compute(self, row: Dict[str, Any]) -> Dict[str, Any]:
        """
        Deduction amounts for one sales row.

        ``row`` needs gross_sales and quantity plus the scope fields. Returns
        an amount per deduction type, total contra-revenue deductions, net
        sales, commission, the ids of the rules applied per type and the
        amount per rule (see ``compute_row_deductions``).
        """
        return compute_row_deductions(self.applicable(row), row)


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


def compute_row_deductions(winners: Dict[str, Any], row: Dict[str, Any]) -> Dict[str, Any]:
    """
    Amounts for one row from the rules that apply to it.

    ``winners`` maps deduction_type to one rule or to a list of rules (the
    other_allowance programs; their amounts add up). Returns the amount per
    type, ``total_sales_deductions`` (contra-revenue only), ``net_sales``,
    ``net_base`` (gross less the pass-1 contra-revenue amounts, the base of
    every percent_of_net rule), ``applied_rules`` {type: rule_id, with
    other_allowance ids comma-joined} and ``rule_amounts`` {rule_id: amount}.
    """
    gross = float(row.get("gross_sales") or 0)
    quantity = float(row.get("quantity") or 0)
    amounts = {dtype: 0.0 for dtype in DEDUCTION_TYPES}
    applied: Dict[str, str] = {}
    rule_amounts: Dict[str, float] = {}
    plan: List[Tuple[str, str, Dict[str, Any]]] = []
    for dtype, chosen in winners.items():
        if dtype not in amounts or not chosen:
            continue
        rules = list(chosen) if isinstance(chosen, (list, tuple)) else [chosen]
        applied[dtype] = ",".join(str(r.get("rule_id")) for r in rules)
        for index, rule in enumerate(rules):
            plan.append((dtype, str(rule.get("rule_id") or f"{dtype}#{index + 1}"), rule))

    # Pass 1: everything not computed on net.
    for dtype, rid, rule in plan:
        if (rule.get("method") or "percent_of_gross") != "percent_of_net":
            amount = rule_amount(rule, gross, quantity)
            amounts[dtype] += amount
            rule_amounts[rid] = rule_amounts.get(rid, 0.0) + amount
    # Pass 2: percent_of_net on gross less the pass-1 contra-revenue deductions.
    net_base = gross - sum(amounts[t] for t in CONTRA_REVENUE_TYPES)
    for dtype, rid, rule in plan:
        if (rule.get("method") or "") == "percent_of_net":
            amount = rule_amount(rule, gross, quantity, net_base=net_base)
            amounts[dtype] += amount
            rule_amounts[rid] = rule_amounts.get(rid, 0.0) + amount

    total = sum(amounts[t] for t in CONTRA_REVENUE_TYPES)
    return {
        **amounts,
        "total_sales_deductions": total,
        "net_sales": gross - total,
        "net_base": net_base,
        "applied_rules": applied,
        "rule_amounts": rule_amounts,
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
    """8*customer_id + 4*customer_type + 2*unit_id + 1*unit_type (the same score as deductions)."""
    return (8 * bool(_norm(rule.get("customer_id")))
            + 4 * bool(_norm(rule.get("customer_type")))
            + 2 * bool(_norm(rule.get("unit_id")))
            + 1 * bool(_norm(rule.get("unit_type"))))


def price_source(rule: Optional[Dict[str, Any]]) -> str:
    """
    Where a price comes from: customer_product, customer_product_type,
    customer_all, type_product, type_product_type, type_all, product,
    product_type, all (or none). A product beats a product type.
    """
    if rule is None:
        return "none"
    has_customer = bool(_norm(rule.get("customer_id")))
    has_type = bool(_norm(rule.get("customer_type")))
    if _norm(rule.get("unit_id")):
        products = "product"
    elif _norm(rule.get("unit_type")):
        products = "product_type"
    else:
        products = None
    if has_customer:
        return f"customer_{products}" if products else "customer_all"
    if has_type:
        return f"type_{products}" if products else "type_all"
    return products or "all"


def rule_price(rule: Dict[str, Any], base_price: Optional[float]) -> Optional[float]:
    """Price a rule gives, or None when it cannot price (discount with no base price)."""
    method = rule.get("method") or "fixed"
    if method == "discount_from_base":
        base = float(base_price or 0)
        if base <= 0 or rule.get("discount_pct") is None:
            return None
        # Price lists are quoted in cents: 40% off $1,399.99 is $839.99, not $839.994.
        return round(base * (1 - float(rule.get("discount_pct") or 0)) + 1e-9, 2)
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
    if _norm(rule.get("unit_type")) and _norm_ci(rule.get("unit_type")) != _norm_ci(row.get("unit_type")):
        return False
    return _in_period(rule, row.get("period"))


def resolve_price(rules: Iterable[Dict[str, Any]], row: Dict[str, Any],
                  base_price: Optional[float] = None, fallback_to_base: bool = True) -> Dict[str, Any]:
    """
    Price for a (forecast_id, unit_id, unit_type, customer_id, customer_type,
    period) row. Pass the product's unit_type in ``row``: without it rules
    scoped to a product type cannot match.

    Returns {"price", "source", "price_id"}: the most specific price-list
    rule that can price the row (a discount_from_base rule needs
    ``base_price``), else the product's base price (source 'base_price')
    when ``fallback_to_base`` is true, else {"price": None, "source": "none"}.
    ``fallback_to_base=False`` skips only that last step; discount rules
    still price off ``base_price``.
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
    if fallback_to_base and base_price is not None and float(base_price or 0) > 0:
        return {"price": float(base_price), "source": "base_price", "price_id": None}
    return {"price": None, "source": "none", "price_id": None}


def load_unit_types(cursor) -> Dict[str, Optional[str]]:
    """unit_type by unit_id, for building price-resolution rows."""
    cursor.execute("SELECT unit_id, unit_type FROM units")
    return {uid: ut for uid, ut in cursor.fetchall()}


def load_price_context(cursor, unit_ids: Optional[Iterable[str]] = None) -> Tuple[Dict[str, float], Dict[str, str]]:
    """(base_price by unit_id, customer_type by customer_id) for price resolution."""
    cursor.execute("SELECT unit_id, base_price FROM units")
    base = {uid: bp for uid, bp in cursor.fetchall()}
    cursor.execute("SELECT customer_id, customer_type FROM customers")
    ctypes = {cid: ct for cid, ct in cursor.fetchall()}
    return base, ctypes
