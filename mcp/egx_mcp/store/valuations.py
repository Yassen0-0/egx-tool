import sqlite3

from ..errors import ValuationInputError
from ..pricing import pricing_levels
from ..universe import normalize_symbol
from .db import dumps, now_iso, row_to_dict

MATERIAL_CHANGE = 0.0  # every fair-value change is logged; the reason explains it


def latest_valuation(conn: sqlite3.Connection, symbol: str, kind: str | None = None) -> dict | None:
    query = "SELECT * FROM valuations WHERE symbol = ?"
    params: list = [normalize_symbol(symbol)]
    if kind:
        query += " AND kind = ?"
        params.append(kind)
    query += " ORDER BY created_at DESC, id DESC LIMIT 1"
    return row_to_dict(conn.execute(query, params).fetchone())


def valuation_history(conn: sqlite3.Connection, symbol: str, limit: int = 20) -> dict:
    symbol = normalize_symbol(symbol)
    valuations = [
        row_to_dict(r) for r in conn.execute(
            "SELECT id, symbol, created_at, kind, fair_value, bear, bull, entry_price, protection_price,"
            " price_at_valuation, risk_rating, financial_period, reason"
            " FROM valuations WHERE symbol = ? ORDER BY created_at DESC, id DESC LIMIT ?",
            (symbol, limit),
        )
    ]
    changes = [
        dict(r) for r in conn.execute(
            "SELECT * FROM change_log WHERE symbol = ? ORDER BY created_at DESC, id DESC LIMIT ?",
            (symbol, limit),
        )
    ]
    return {"symbol": symbol, "valuations": valuations, "changes": changes}


def latest_per_symbol(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        "SELECT v.* FROM valuations v JOIN ("
        "  SELECT symbol, MAX(id) AS id FROM valuations GROUP BY symbol"
        ") last ON v.id = last.id ORDER BY v.symbol"
    )
    return [row_to_dict(r) for r in rows]


def save_full_valuation(
    conn: sqlite3.Connection,
    symbol: str,
    fair_value: float,
    bear: float,
    bull: float,
    risk_rating: str,
    financial_period: str,
    methods: list[dict],
    assumptions: dict,
    sources: list[dict],
    sanity: dict,
    thesis: str,
    critic_notes: str,
    reason: str,
    price_at_valuation: float | None = None,
    macro_snapshot: dict | None = None,
    risk_details: dict | None = None,
) -> dict:
    """Persist a full valuation and log the fair-value change against the previous one.

    Refuses valuations whose sanity check failed, that skipped the critic, or
    that cite no sources: those are the failure modes the tool exists to stop.
    """
    symbol = normalize_symbol(symbol)
    if sanity.get("overall") == "fail":
        raise ValuationInputError("sanity check failed; revise the assumptions before saving")
    if not critic_notes.strip():
        raise ValuationInputError("critic_notes are required: run the critic review before saving")
    if not sources:
        raise ValuationInputError("sources are required for every number used")
    if not bear <= fair_value <= bull:
        raise ValuationInputError("expected bear <= fair_value <= bull")

    levels = pricing_levels(fair_value, price_at_valuation)
    if levels.get("review_required") and "protection" not in critic_notes.lower() and "الحماية" not in critic_notes:
        raise ValuationInputError(
            "price is below the protection price: critic_notes must address the below-protection review"
        )

    previous = latest_valuation(conn, symbol, kind="full")
    if previous and not reason.strip():
        raise ValuationInputError("reason is required when a previous valuation exists")

    created_at = now_iso()
    cursor = conn.execute(
        "INSERT INTO valuations (symbol, created_at, kind, fair_value, bear, bull, entry_price, protection_price,"
        " price_at_valuation, risk_rating, financial_period, macro_snapshot, methods, assumptions, sources,"
        " risk_details, sanity, thesis, critic_notes, reason)"
        " VALUES (?, ?, 'full', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            symbol, created_at, fair_value, bear, bull, levels["entry_price"], levels["protection_price"],
            price_at_valuation, risk_rating, financial_period, dumps(macro_snapshot), dumps(methods),
            dumps(assumptions), dumps(sources), dumps(risk_details), dumps(sanity), thesis, critic_notes,
            reason or "first valuation",
        ),
    )
    valuation_id = cursor.lastrowid
    change = None
    if previous and abs(fair_value - previous["fair_value"]) > MATERIAL_CHANGE:
        change_pct = fair_value / previous["fair_value"] - 1
        conn.execute(
            "INSERT INTO change_log (symbol, created_at, valuation_id, previous_fair_value, new_fair_value,"
            " change_pct, reason) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (symbol, created_at, valuation_id, previous["fair_value"], fair_value, change_pct, reason),
        )
        change = {"previous_fair_value": previous["fair_value"], "new_fair_value": fair_value,
                  "change_pct": change_pct, "reason": reason}
    conn.commit()
    return {"valuation_id": valuation_id, "symbol": symbol, "pricing": levels, "change": change}


def record_light_update(conn: sqlite3.Connection, symbol: str, current_price: float, notes: str) -> dict:
    """Weekly light update: carries the last full fair value forward with today's price."""
    symbol = normalize_symbol(symbol)
    last_full = latest_valuation(conn, symbol, kind="full")
    if not last_full:
        raise ValuationInputError(f"{symbol} has no full valuation yet; run a full valuation first")
    levels = pricing_levels(last_full["fair_value"], current_price)
    cursor = conn.execute(
        "INSERT INTO valuations (symbol, created_at, kind, fair_value, bear, bull, entry_price, protection_price,"
        " price_at_valuation, risk_rating, financial_period, reason)"
        " VALUES (?, ?, 'light', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            symbol, now_iso(), last_full["fair_value"], last_full["bear"], last_full["bull"],
            levels["entry_price"], levels["protection_price"], current_price, last_full["risk_rating"],
            last_full["financial_period"], notes,
        ),
    )
    conn.commit()
    return {"valuation_id": cursor.lastrowid, "symbol": symbol, "pricing": levels}
