"""
Bulk "what-if" adjustments to the model.

These are the operations an analyst (or an AI assistant driving the MCP
server) reaches for when planning: "cut the selling price 35% in June,
August and September", "steel is going up 12%", "sell 10% more of this
product to that customer". Each function takes a cursor, applies the
change inside the caller's transaction, and returns a preview that works
for both dry runs and committed changes.

Every function keeps the derived columns consistent:

* sales.total_revenue = quantity * unit_price
* bom.material_cost   = qty * unit_price

Nothing here touches the statements engine; the statements pick the new
numbers up on the next build because they read the same tables.
"""
from typing import Any, Dict, List, Optional, Sequence

from utils.period_normalizer import normalize_period


class AdjustmentError(ValueError):
    """Bad arguments for an adjustment (reported to the caller as a 422)."""


PREVIEW_ROWS = 50


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _one_of(**ops: Optional[float]) -> Optional[tuple]:
    """Return (name, value) for the single op that is set, or None if none are."""
    given = [(name, value) for name, value in ops.items() if value is not None]
    if not given:
        return None
    if len(given) > 1:
        names = ", ".join(name for name, _ in given)
        raise AdjustmentError(f"Choose only one of: {names}")
    name, value = given[0]
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise AdjustmentError(f"{name} must be a number")
    if name.endswith("multiplier") and value < 0:
        raise AdjustmentError(f"{name} must be zero or positive")
    if name in ("price", "unit_price", "quantity") and value < 0:
        raise AdjustmentError(f"{name} must be zero or positive")
    return name, value


def _apply(op: Optional[tuple], current: float) -> float:
    if op is None:
        return current
    name, value = op
    if name.endswith("multiplier"):
        return current * value
    if name.endswith("delta"):
        return current + value
    return value  # absolute set


def _normalize_periods(periods: Optional[Sequence[str]]) -> List[str]:
    out: List[str] = []
    for raw in periods or []:
        period = normalize_period(str(raw))
        if not period:
            raise AdjustmentError(f"Invalid period '{raw}'; use YYYY-MM")
        out.append(period)
    return out


def _normalize_period(raw: Optional[str], label: str) -> Optional[str]:
    if raw is None or raw == "":
        return None
    period = normalize_period(str(raw))
    if not period:
        raise AdjustmentError(f"Invalid {label} '{raw}'; use YYYY-MM")
    return period


def _clean_ids(values: Optional[Sequence[str]]) -> List[str]:
    return [str(v).strip() for v in (values or []) if str(v).strip()]


# ---------------------------------------------------------------------------
# Sales (price / volume) adjustments
# ---------------------------------------------------------------------------

def adjust_sales(
    cursor,
    forecast_id: str,
    *,
    periods: Optional[Sequence[str]] = None,
    start_period: Optional[str] = None,
    end_period: Optional[str] = None,
    customer_ids: Optional[Sequence[str]] = None,
    unit_ids: Optional[Sequence[str]] = None,
    price_multiplier: Optional[float] = None,
    price_delta: Optional[float] = None,
    price: Optional[float] = None,
    quantity_multiplier: Optional[float] = None,
    quantity_delta: Optional[float] = None,
    quantity: Optional[float] = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """
    Re-price and/or re-volume the sales rows of one scenario.

    Filters (all optional, combined with AND): an explicit list of periods,
    an inclusive start/end window, customer ids, product (unit) ids.
    Operations: one price op (multiplier, delta or absolute) and/or one
    quantity op (multiplier, delta or absolute). Quantities are rounded to
    whole units because the sales grid works in units.

    With dry_run the rows are matched and the preview computed but nothing
    is written. The caller owns the transaction either way.
    """
    forecast_id = (forecast_id or "").strip()
    if not forecast_id:
        raise AdjustmentError("forecast_id is required; sales always belong to one scenario")
    cursor.execute("SELECT 1 FROM forecast WHERE forecast_id = ?", (forecast_id,))
    if not cursor.fetchone():
        raise AdjustmentError(f"Scenario '{forecast_id}' not found")

    price_op = _one_of(price_multiplier=price_multiplier, price_delta=price_delta, price=price)
    qty_op = _one_of(quantity_multiplier=quantity_multiplier, quantity_delta=quantity_delta, quantity=quantity)
    if price_op is None and qty_op is None:
        raise AdjustmentError(
            "Nothing to do: give a price op (price_multiplier / price_delta / price) "
            "and/or a quantity op (quantity_multiplier / quantity_delta / quantity)"
        )

    period_list = _normalize_periods(periods)
    start = _normalize_period(start_period, "start_period")
    end = _normalize_period(end_period, "end_period")
    if start and end and start > end:
        raise AdjustmentError("start_period must not be after end_period")
    customers = _clean_ids(customer_ids)
    units = _clean_ids(unit_ids)

    where = ["forecast_id = ?"]
    params: List[Any] = [forecast_id]
    if period_list:
        where.append(f"period IN ({', '.join('?' for _ in period_list)})")
        params.extend(period_list)
    if start:
        where.append("period >= ?")
        params.append(start)
    if end:
        where.append("period <= ?")
        params.append(end)
    if customers:
        where.append(f"customer_id IN ({', '.join('?' for _ in customers)})")
        params.extend(customers)
    if units:
        where.append(f"unit_id IN ({', '.join('?' for _ in units)})")
        params.extend(units)

    cursor.execute(
        f"""
        SELECT sale_id, customer_id, unit_id, period, quantity, unit_price, total_revenue
        FROM sales
        WHERE {' AND '.join(where)}
        ORDER BY period, customer_id, unit_id
        """,
        params,
    )
    rows = cursor.fetchall()

    changes: List[Dict[str, Any]] = []
    before = {"revenue": 0.0, "quantity": 0.0}
    after = {"revenue": 0.0, "quantity": 0.0}
    touched_periods = set()
    updates: List[tuple] = []

    for sale_id, customer_id, unit_id, period, old_qty, old_price, old_revenue in rows:
        old_qty_f = float(old_qty or 0)
        old_price_f = float(old_price or 0)
        old_rev = float(old_revenue) if old_revenue is not None else old_qty_f * old_price_f

        new_price = round(_apply(price_op, old_price_f), 4)
        new_qty = int(round(_apply(qty_op, old_qty_f)))
        if new_qty < 0:
            new_qty = 0
        if new_price < 0:
            new_price = 0.0
        new_rev = round(new_qty * new_price, 2)

        before["revenue"] += old_rev
        before["quantity"] += old_qty_f
        after["revenue"] += new_rev
        after["quantity"] += new_qty
        touched_periods.add(str(period))

        updates.append((new_qty, new_price, new_rev, sale_id))
        if len(changes) < PREVIEW_ROWS:
            changes.append({
                "sale_id": sale_id,
                "customer_id": customer_id,
                "unit_id": unit_id,
                "period": period,
                "quantity": {"before": old_qty_f, "after": new_qty},
                "unit_price": {"before": old_price_f, "after": new_price},
                "total_revenue": {"before": round(old_rev, 2), "after": new_rev},
            })

    if updates and not dry_run:
        cursor.executemany(
            "UPDATE sales SET quantity = ?, unit_price = ?, total_revenue = ? WHERE sale_id = ?",
            updates,
        )

    return {
        "forecast_id": forecast_id,
        "dry_run": bool(dry_run),
        "matched_rows": len(rows),
        "updated_rows": 0 if dry_run else len(updates),
        "periods": sorted(touched_periods),
        "filters": {
            "periods": period_list or None,
            "start_period": start,
            "end_period": end,
            "customer_ids": customers or None,
            "unit_ids": units or None,
        },
        "operations": {
            "price": {price_op[0]: price_op[1]} if price_op else None,
            "quantity": {qty_op[0]: qty_op[1]} if qty_op else None,
        },
        "before": {k: round(v, 2) for k, v in before.items()},
        "after": {k: round(v, 2) for k, v in after.items()},
        "revenue_change": round(after["revenue"] - before["revenue"], 2),
        "preview": changes,
        "preview_truncated": len(rows) > len(changes),
    }


# ---------------------------------------------------------------------------
# BOM material cost adjustments
# ---------------------------------------------------------------------------

def adjust_material_costs(
    cursor,
    *,
    material_contains: Optional[str] = None,
    bom_ids: Optional[Sequence[str]] = None,
    bom_version: Optional[str] = None,
    price_multiplier: Optional[float] = None,
    price_delta: Optional[float] = None,
    unit_price: Optional[float] = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """
    Re-price BOM lines whose material description contains a phrase
    (case-insensitive) and/or that belong to the given BOM ids / version.

    Sets bom.unit_price and keeps bom.material_cost = qty * unit_price.
    BOM prices are not time-phased in this model: a change applies to every
    period that uses the BOM. To phase a change in, branch a scenario and
    apply it there, or re-run with the inverse multiplier later.
    """
    op = _one_of(price_multiplier=price_multiplier, price_delta=price_delta, unit_price=unit_price)
    if op is None:
        raise AdjustmentError("Give exactly one of price_multiplier, price_delta or unit_price")

    phrase = (material_contains or "").strip()
    ids = _clean_ids(bom_ids)
    version = (bom_version or "").strip() or None
    if not phrase and not ids:
        raise AdjustmentError("Give material_contains and/or bom_ids so the change is targeted")

    where: List[str] = []
    params: List[Any] = []
    if phrase:
        where.append("LOWER(COALESCE(material_description, '')) LIKE ?")
        params.append(f"%{phrase.lower()}%")
    if ids:
        where.append(f"bom_id IN ({', '.join('?' for _ in ids)})")
        params.extend(ids)
    if version:
        where.append("version = ?")
        params.append(version)

    cursor.execute(
        f"""
        SELECT bom_id, version, bom_line, material_description, qty, unit_price, material_cost
        FROM bom
        WHERE {' AND '.join(where)}
        ORDER BY bom_id, version, bom_line
        """,
        params,
    )
    rows = cursor.fetchall()

    changes: List[Dict[str, Any]] = []
    updates: List[tuple] = []
    before_total = 0.0
    after_total = 0.0
    touched_boms = set()
    delta_by_bom: Dict[tuple, float] = {}

    for bom_id, ver, line, description, qty, old_price, old_cost in rows:
        qty_f = float(qty or 0)
        old_price_f = float(old_price or 0)
        old_cost_f = float(old_cost) if old_cost is not None else qty_f * old_price_f
        new_price = round(_apply(op, old_price_f), 4)
        if new_price < 0:
            new_price = 0.0
        new_cost = round(qty_f * new_price, 4)
        before_total += old_cost_f
        after_total += new_cost
        touched_boms.add((bom_id, ver))
        delta_by_bom[(bom_id, ver)] = delta_by_bom.get((bom_id, ver), 0.0) + (new_cost - old_cost_f)
        updates.append((new_price, new_cost, bom_id, ver, line))
        if len(changes) < PREVIEW_ROWS:
            changes.append({
                "bom_id": bom_id,
                "version": ver,
                "bom_line": line,
                "material_description": description,
                "qty": qty_f,
                "unit_price": {"before": old_price_f, "after": new_price},
                "material_cost": {"before": round(old_cost_f, 4), "after": new_cost},
            })

    if updates and not dry_run:
        cursor.executemany(
            "UPDATE bom SET unit_price = ?, material_cost = ? WHERE bom_id = ? AND version = ? AND bom_line = ?",
            updates,
        )

    # Which products feel this change, and by how much per unit.
    products: List[Dict[str, Any]] = []
    if touched_boms:
        placeholders = ", ".join("(?, ?)" for _ in touched_boms)
        flat: List[Any] = [v for pair in sorted(touched_boms) for v in pair]
        cursor.execute(
            f"""
            SELECT u.unit_id, u.unit_name, u.bom_id, u.bom_version,
                   (SELECT COALESCE(SUM(material_cost), 0) FROM bom b
                     WHERE b.bom_id = u.bom_id AND b.version = u.bom_version) AS material_per_unit
            FROM units u
            WHERE (u.bom_id, u.bom_version) IN ({placeholders})
            ORDER BY u.unit_id
            """,
            flat,
        )
        for unit_id, unit_name, bom_id, ver, material_per_unit in cursor.fetchall():
            current = float(material_per_unit or 0)
            delta = delta_by_bom.get((bom_id, ver), 0.0)
            # On a dry run the table still holds the old numbers.
            before_unit = current if dry_run else current - delta
            after_unit = current + delta if dry_run else current
            products.append({
                "unit_id": unit_id,
                "unit_name": unit_name,
                "bom_id": bom_id,
                "bom_version": ver,
                "material_per_unit": {"before": round(before_unit, 4), "after": round(after_unit, 4)},
            })

    return {
        "dry_run": bool(dry_run),
        "matched_lines": len(rows),
        "updated_lines": 0 if dry_run else len(updates),
        "filters": {"material_contains": phrase or None, "bom_ids": ids or None, "bom_version": version},
        "operation": {op[0]: op[1]},
        "material_cost_total": {"before": round(before_total, 4), "after": round(after_total, 4)},
        "boms_affected": [{"bom_id": b, "version": v} for b, v in sorted(touched_boms)],
        "products_affected": products,
        "preview": changes,
        "preview_truncated": len(rows) > len(changes),
        "note": "BOM prices apply to every period. To phase a cost change in from a given month, branch a scenario for that horizon or apply it in a scenario you compare against the base.",
    }

