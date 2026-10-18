"""The EGX30 market list, per-symbol history and the "since the last close" digest, built from the
local cache only (no API calls)."""

import json
import sqlite3
from datetime import date, datetime, timedelta, timezone

from ..pricing import pricing_levels, status_of
from ..store.valuations import latest_valuation
from ..store.watchlist import watched_symbols
from ..universe import constituent, load_universe, normalize_symbol
from . import store
from .calendar import CAIRO, CLOSE, expected_last_bar, next_session_day, now_cairo, previous_trading_day, session_open
from .sync import refresh_plan

PERIODS = {"1w": 7, "1m": 30, "3m": 91, "1y": 365}
DIGEST_LIMIT = 3


FIRST_BAR_TOLERANCE = timedelta(days=10)


def _close_on_or_before(rows: list[dict], target: date) -> float | None:
    """Close on or before target. When history starts just after target (e.g. a one-year
    window that begins a day late), the first bar within a short tolerance stands in."""
    key = target.isoformat()
    candidate = None
    for row in rows:
        if row["date"] > key:
            break
        candidate = row["close"]
    if candidate is None and rows and date.fromisoformat(rows[0]["date"]) - target <= FIRST_BAR_TOLERANCE:
        return rows[0]["close"]
    return candidate


def _returns(rows: list[dict], price: float, as_of: date) -> dict:
    out = {}
    for name, days in PERIODS.items():
        base = _close_on_or_before(rows, as_of - timedelta(days=days))
        out[name] = price / base - 1 if base else None
    year_end = _close_on_or_before(rows, date(as_of.year - 1, 12, 31))
    out["ytd"] = price / year_end - 1 if year_end else None
    return out


def _quote_is_today(quote: dict | None, today: date) -> bool:
    if not quote or not quote.get("price") or quote["price"] <= 0 or not quote.get("quote_time"):
        return False
    return datetime.fromtimestamp(quote["quote_time"], CAIRO).date() == today


def cairo_day(created_at: str) -> str:
    """Calendar day in Cairo of a stored UTC timestamp."""
    return datetime.fromisoformat(created_at).astimezone(CAIRO).date().isoformat()


def price_state(conn: sqlite3.Connection, symbol: str, at: datetime, rows: list[dict] | None = None) -> dict:
    """Latest price, its date, the move against the previous close and whether it is stale
    (older than the session whose bar should already exist). Today's delayed quote wins
    over yesterday's bar."""
    today = at.date()
    if rows is None:
        rows = store.bars(conn, symbol, (today - timedelta(days=10)).isoformat())
    quote = store.quote(conn, symbol)
    state = {"price": None, "previous_close": None, "change": None, "change_pct": None, "price_kind": None,
             "as_of": None, "as_of_day": None, "stale": None, "day_high": None, "day_low": None, "volume": None,
             "source": None}
    if _quote_is_today(quote, today) and (not rows or rows[-1]["date"] < today.isoformat()):
        # Today's move is against the previous session's close. When the cache misses that bar
        # (a budget gap), the quote's own previous close is the right base, not an older bar.
        previous_session = previous_trading_day(today).isoformat()
        if rows and rows[-1]["date"] == previous_session:
            previous_close = rows[-1]["close"]
        else:
            previous_close = quote.get("previous_close") or None
        state.update({
            "price": quote["price"], "previous_close": previous_close,
            "price_kind": "delayed",
            "as_of": datetime.fromtimestamp(quote["quote_time"], CAIRO).isoformat(timespec="minutes"),
            "as_of_day": today.isoformat(), "day_high": quote.get("high"), "day_low": quote.get("low"),
            "volume": quote.get("volume"), "source": quote["source"], "stale": False,
        })
    elif rows:
        last = rows[-1]
        state.update({
            "price": last["close"], "previous_close": rows[-2]["close"] if len(rows) > 1 else None,
            "price_kind": "close", "as_of": last["date"], "as_of_day": last["date"],
            "day_high": last["high"], "day_low": last["low"], "volume": last["volume"], "source": last["source"],
            "stale": date.fromisoformat(last["date"]) < expected_last_bar(at),
        })
    if state["price"] is not None and state["previous_close"]:
        state["change"] = state["price"] - state["previous_close"]
        state["change_pct"] = state["price"] / state["previous_close"] - 1
    return state


def sourced_price(state: dict):
    """The price_state price as a Sourced value (None without one). The one rule for "which price
    is current" that the market list, the portfolio and the analyst tools all share."""
    from ..data.provider import Sourced
    if state.get("price") is None:
        return None
    kind = "delayed quote" if state["price_kind"] == "delayed" else "daily close"
    return Sourced(state["price"], state["as_of"], f"{state['source']} {kind}")


def valuation_steps(conn: sqlite3.Connection, symbol: str) -> list[dict]:
    """Fair and protection by valuation date, oldest first: the chart draws them as step lines
    that start on each valuation's day, so nothing is drawn before a valuation existed."""
    return [
        {"id": r["id"], "date": cairo_day(r["created_at"]), "created_at": r["created_at"], "kind": r["kind"],
         "fair_value": r["fair_value"], "protection_price": r["protection_price"], "bear": r["bear"], "bull": r["bull"],
         "price_at_valuation": r["price_at_valuation"], "risk_rating": r["risk_rating"]}
        for r in conn.execute(
            "SELECT id, created_at, kind, fair_value, protection_price, bear, bull, price_at_valuation, risk_rating"
            " FROM valuations"
            " WHERE symbol = ? ORDER BY created_at, id", (symbol,))
    ]


def valuation_block(valuation: dict, price: float | None) -> dict:
    levels = pricing_levels(valuation["fair_value"], price)
    return {
        "id": valuation["id"], "kind": valuation["kind"], "fair_value": valuation["fair_value"],
        "bear": valuation["bear"], "bull": valuation["bull"], "risk_rating": valuation["risk_rating"],
        "protection_price": levels["protection_price"], "status": levels.get("status"),
        "margin_to_fair": levels.get("margin_to_fair"), "below_protection_by": levels.get("below_protection_by"),
        "upside": levels.get("upside_to_fair_value"),
        "price_at_valuation": valuation["price_at_valuation"],
        "created_at": valuation["created_at"], "valuation_date": cairo_day(valuation["created_at"]),
    }


def symbol_row(conn: sqlite3.Connection, entry: dict, held: set[str], at: datetime,
               watched: frozenset[str] | set[str] = frozenset()) -> dict:
    symbol = entry["symbol"]
    today = at.date()
    rows = store.bars(conn, symbol, (today - timedelta(days=400)).isoformat())
    state = price_state(conn, symbol, at, rows)
    as_of_day = state.pop("as_of_day")
    row = {
        "symbol": symbol, "name": entry["name"], "name_ar": entry.get("name_ar"), "sector": entry["sector"],
        "sector_ar": entry.get("sector_ar"), "weight_pct": entry["weight_pct"], "held": symbol in held,
        "watched": symbol in watched,
        **state, "returns": {}, "high_52w": None, "low_52w": None, "bars_count": len(rows),
    }
    if row["price"] is not None:
        as_of = date.fromisoformat(as_of_day)
        row["returns"] = _returns(rows, row["price"], as_of)
        window = [r for r in rows if r["date"] >= (as_of - timedelta(days=365)).isoformat()]
        highs = [r["high"] for r in window if r["high"] is not None] + [row["price"]]
        lows = [r["low"] for r in window if r["low"] is not None] + [row["price"]]
        row["high_52w"], row["low_52w"] = max(highs), min(lows)

    valuation = latest_valuation(conn, symbol)
    row["valuation"] = valuation_block(valuation, row["price"]) if valuation else None
    row["valuation_history"] = valuation_steps(conn, symbol) if valuation else []
    return row


def holding_quantities(conn: sqlite3.Connection) -> dict[str, float]:
    return {r[0]: r[1] for r in conn.execute("SELECT symbol, SUM(quantity) FROM holdings GROUP BY symbol")}


def portfolio_today(positions: list[tuple[float, dict]]) -> dict:
    """Σ quantity × change over holdings whose price is fresh; % = today / (value − today) over the
    same holdings. Stale or unpriced holdings are left out of both."""
    fresh = [(q, s) for q, s in positions if s.get("price") is not None and s.get("stale") is False
             and s.get("change") is not None]
    if not fresh:
        return {"change": None, "change_pct": None, "has_fresh": False, "fresh_holdings": 0,
                "holdings": len(positions), "as_of": None}
    change = sum(q * s["change"] for q, s in fresh)
    value = sum(q * s["price"] for q, s in fresh)
    base = value - change
    return {
        "change": change, "change_pct": change / base if base else None, "has_fresh": True,
        "fresh_holdings": len(fresh), "holdings": len(positions),
        "as_of": max((s.get("as_of") or "")[:10] for _, s in fresh) or None,
    }


def market_summary(conn: sqlite3.Connection, at: datetime | None = None) -> dict:
    at = at or now_cairo()
    quantities = holding_quantities(conn)
    watched = watched_symbols(conn)
    rows = [symbol_row(conn, c, set(quantities), at, watched) for c in load_universe()["constituents"]]
    fresh = [r for r in rows if r["price"] is not None and not r["stale"] and r["change_pct"] is not None]
    last_run = store.last_sync_run(conn)
    if last_run and last_run.get("summary"):
        last_run["summary"] = json.loads(last_run["summary"])
    return {
        "as_of": at.isoformat(timespec="minutes"),
        "session_open": session_open(at),
        # Holiday-aware (calendar.py): the screens show «تفتح …» from this, not their own calendar.
        "next_session": next_session_day(at).isoformat(),
        "expected_last_bar": expected_last_bar(at).isoformat(),
        # Today's breadth counts fresh prices only: a stale close is not today's move.
        "breadth": {
            "up": sum(1 for r in fresh if r["change_pct"] > 0),
            "down": sum(1 for r in fresh if r["change_pct"] < 0),
            "flat": sum(1 for r in fresh if r["change_pct"] == 0),
            "stale": sum(1 for r in rows if r["price"] is not None and r["stale"]),
            "no_data": sum(1 for r in rows if r["price"] is None),
        },
        "portfolio_today": portfolio_today([(quantities[r["symbol"]], r) for r in rows if r["symbol"] in quantities]),
        "rows": rows,
        "last_sync": last_run,
        # Holdings + «متابعتي» against the daily price budget (the UI warns on overflow).
        "refresh_plan": refresh_plan(conn),
        "universe_as_of": load_universe()["as_of"],
    }


def symbol_history(conn: sqlite3.Connection, symbol: str, days: int = 365) -> dict:
    symbol = normalize_symbol(symbol)
    entry = constituent(symbol)
    if entry is None:
        from ..errors import ValuationInputError
        raise ValuationInputError(f"{symbol} is not an EGX30 constituent")
    days = max(5, min(int(days), 365 * 30))
    since = (now_cairo().date() - timedelta(days=days)).isoformat()
    valuation = latest_valuation(conn, symbol)
    levels = None
    if valuation:
        levels = {
            "fair_value": valuation["fair_value"], "entry_price": valuation["entry_price"],
            "protection_price": valuation["protection_price"], "bear": valuation["bear"], "bull": valuation["bull"],
            "risk_rating": valuation["risk_rating"], "valuation_id": valuation["id"],
            "created_at": valuation["created_at"],
        }
    return {"symbol": symbol, "name": entry["name"], "name_ar": entry.get("name_ar"),
            "bars": store.bars(conn, symbol, since), "quote": store.quote(conn, symbol), "levels": levels,
            "valuation_history": valuation_steps(conn, symbol)}


def _valuation_before(conn: sqlite3.Connection, symbol: str, cutoff_utc: str) -> dict | None:
    row = conn.execute(
        "SELECT * FROM valuations WHERE symbol = ? AND created_at < ? ORDER BY created_at DESC, id DESC LIMIT 1",
        (symbol, cutoff_utc)).fetchone()
    return dict(row) if row else None


def market_digest(conn: sqlite3.Connection, at: datetime | None = None) -> dict:
    """At most three things that changed since the previous session's close, in this order:
    stocks that moved into or out of «under protection», valuations saved since then (with the
    fair-value change), and the largest move among the user's holdings."""
    at = at or now_cairo()
    last_close = expected_last_bar(at)
    since_day = previous_trading_day(last_close)
    since = datetime.combine(since_day, CLOSE, CAIRO)
    # Stored timestamps are UTC ISO strings, so the cutoff compares as text in the same form.
    since_iso = since.astimezone(timezone.utc).isoformat(timespec="seconds")
    quantities = holding_quantities(conn)
    items: list[dict] = []

    symbols = [r[0] for r in conn.execute("SELECT DISTINCT symbol FROM valuations ORDER BY symbol")]
    states = {s: price_state(conn, s, at) for s in set(symbols) | set(quantities)}
    names = {c["symbol"]: c.get("name_ar") for c in load_universe()["constituents"]}

    for symbol in symbols:
        state = states[symbol]
        if state["price"] is None or state["stale"] or not state["previous_close"]:
            continue
        now_val = latest_valuation(conn, symbol)
        then_val = _valuation_before(conn, symbol, since_iso)
        if not now_val or not then_val:
            continue
        now_status = status_of(now_val["fair_value"], now_val["protection_price"], state["price"])
        then_status = status_of(then_val["fair_value"], then_val["protection_price"], state["previous_close"])
        if now_status != then_status and "below_protection" in (now_status, then_status):
            block = valuation_block(now_val, state["price"])
            items.append({"kind": "status", "symbol": symbol, "name_ar": names.get(symbol), "from": then_status,
                          "to": now_status, "price": state["price"], "fair_value": now_val["fair_value"],
                          "below_protection_by": block["below_protection_by"], "valuation_id": now_val["id"]})

    for r in conn.execute(
        "SELECT v.id, v.symbol, v.created_at, v.fair_value, v.price_at_valuation, v.reason, c.previous_fair_value,"
        " c.change_pct FROM valuations v LEFT JOIN change_log c ON c.valuation_id = v.id"
        " WHERE v.kind = 'full' AND v.created_at >= ? ORDER BY v.created_at DESC, v.id DESC", (since_iso,)):
        items.append({"kind": "valuation", "symbol": r["symbol"], "name_ar": names.get(r["symbol"]),
                      "valuation_id": r["id"], "fair_value": r["fair_value"],
                      "previous_fair_value": r["previous_fair_value"], "change_pct": r["change_pct"],
                      "created_at": r["created_at"], "reason": r["reason"]})

    moves = [(abs(states[s]["change_pct"]), s) for s in quantities
             if states[s]["change_pct"] is not None and states[s]["stale"] is False]
    if moves:
        _, symbol = max(moves)
        state = states[symbol]
        items.append({"kind": "holding_move", "symbol": symbol, "name_ar": names.get(symbol),
                      "change": state["change"], "change_pct": state["change_pct"],
                      "position_change": quantities[symbol] * state["change"]})

    return {"since": since.isoformat(timespec="minutes"), "last_close": last_close.isoformat(),
            "items": items[:DIGEST_LIMIT]}
