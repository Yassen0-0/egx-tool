"""Holdings the user types in. The tool never checks them against a broker: the user owns their accuracy."""

import sqlite3

from ..data.provider import DataProvider
from ..errors import ValuationInputError
from ..pricing import pricing_levels
from ..universe import constituent, normalize_symbol
from .db import now_iso
from .valuations import latest_valuation


def add_holding(
    conn: sqlite3.Connection,
    symbol: str,
    buy_price: float,
    quantity: float | None = None,
    invested_amount: float | None = None,
    buy_date: str | None = None,
    note: str | None = None,
) -> dict:
    """Add a holding from quantity, or from the amount invested (quantity = amount / buy price)."""
    symbol = normalize_symbol(symbol)
    if constituent(symbol) is None:
        raise ValuationInputError(f"{symbol} is not in the EGX30 universe")
    if buy_price <= 0:
        raise ValuationInputError("buy_price must be positive")
    if (quantity is None) == (invested_amount is None):
        raise ValuationInputError("give exactly one of quantity or invested_amount")
    if quantity is None:
        if invested_amount <= 0:
            raise ValuationInputError("invested_amount must be positive")
        quantity = invested_amount / buy_price
    if quantity <= 0:
        raise ValuationInputError("quantity must be positive")
    stamp = now_iso()
    cursor = conn.execute(
        "INSERT INTO holdings (symbol, quantity, buy_price, buy_date, note, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (symbol, quantity, buy_price, buy_date, note, stamp, stamp),
    )
    conn.commit()
    return get_holding(conn, cursor.lastrowid)


def get_holding(conn: sqlite3.Connection, holding_id: int) -> dict:
    row = conn.execute("SELECT * FROM holdings WHERE id = ?", (holding_id,)).fetchone()
    if row is None:
        raise ValuationInputError(f"holding {holding_id} not found")
    return dict(row)


def update_holding(
    conn: sqlite3.Connection,
    holding_id: int,
    quantity: float | None = None,
    buy_price: float | None = None,
    buy_date: str | None = None,
    note: str | None = None,
) -> dict:
    current = get_holding(conn, holding_id)
    quantity = current["quantity"] if quantity is None else quantity
    buy_price = current["buy_price"] if buy_price is None else buy_price
    if quantity <= 0 or buy_price <= 0:
        raise ValuationInputError("quantity and buy_price must be positive")
    conn.execute(
        "UPDATE holdings SET quantity = ?, buy_price = ?, buy_date = ?, note = ?, updated_at = ? WHERE id = ?",
        (
            quantity, buy_price,
            current["buy_date"] if buy_date is None else buy_date,
            current["note"] if note is None else note,
            now_iso(), holding_id,
        ),
    )
    conn.commit()
    return get_holding(conn, holding_id)


def remove_holding(conn: sqlite3.Connection, holding_id: int) -> dict:
    holding = get_holding(conn, holding_id)
    conn.execute("DELETE FROM holdings WHERE id = ?", (holding_id,))
    conn.commit()
    return {"removed": holding}


def portfolio_summary(conn: sqlite3.Connection, provider: DataProvider) -> dict:
    """Value, P/L and weight per holding, alongside the latest fair value, rating and protection price."""
    holdings = [dict(r) for r in conn.execute("SELECT * FROM holdings ORDER BY symbol, id")]
    rows = []
    for h in holdings:
        cost = h["quantity"] * h["buy_price"]
        price = provider.get_price(h["symbol"])
        valuation = latest_valuation(conn, h["symbol"])
        entry = constituent(h["symbol"]) or {}
        row = {
            **h,
            "name": entry.get("name"),
            "name_ar": entry.get("name_ar"),
            "sector_ar": entry.get("sector_ar"),
            "cost": cost,
            "current_price": price.value if price else None,
            "price_as_of": price.as_of if price else None,
            "price_source": price.source if price else None,
            "market_value": h["quantity"] * price.value if price else None,
            "pnl": h["quantity"] * price.value - cost if price else None,
            "pnl_pct": price.value / h["buy_price"] - 1 if price else None,
            "fair_value": None,
            "risk_rating": None,
            "protection_price": None,
            "status": None,
            "valuation_date": None,
        }
        if valuation:
            levels = pricing_levels(valuation["fair_value"], price.value if price else None)
            row.update({
                "fair_value": valuation["fair_value"],
                "risk_rating": valuation["risk_rating"],
                "protection_price": levels["protection_price"],
                "status": levels.get("status"),
                "valuation_date": valuation["created_at"],
            })
        rows.append(row)

    priced = [r for r in rows if r["market_value"] is not None]
    total_value = sum(r["market_value"] for r in priced)
    total_cost_priced = sum(r["cost"] for r in priced)
    for r in rows:
        r["weight"] = r["market_value"] / total_value if r["market_value"] is not None and total_value else None
    return {
        "holdings": rows,
        "totals": {
            "cost": sum(r["cost"] for r in rows),
            "market_value": total_value if priced else None,
            "pnl": total_value - total_cost_priced if priced else None,
            "pnl_pct": total_value / total_cost_priced - 1 if priced and total_cost_priced else None,
            "unpriced_holdings": [r["symbol"] for r in rows if r["market_value"] is None],
        },
        "disclaimer": "Values are based on the amounts and prices the user entered; the user is responsible for their accuracy.",
    }
