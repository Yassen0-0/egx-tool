"""The EGX30 market list and per-symbol history, built from the local cache only (no API calls)."""

import json
import sqlite3
from datetime import date, datetime, timedelta

from ..pricing import pricing_levels
from ..store.valuations import latest_valuation
from ..universe import constituent, load_universe, normalize_symbol
from . import store
from .calendar import CAIRO, expected_last_bar, now_cairo, session_open

PERIODS = {"1w": 7, "1m": 30, "3m": 91, "1y": 365}


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
    if not quote or quote.get("price") is None or not quote.get("quote_time"):
        return False
    return datetime.fromtimestamp(quote["quote_time"], CAIRO).date() == today


def symbol_row(conn: sqlite3.Connection, entry: dict, held: set[str], at: datetime) -> dict:
    symbol = entry["symbol"]
    today = at.date()
    rows = store.bars(conn, symbol, (today - timedelta(days=400)).isoformat())
    quote = store.quote(conn, symbol)
    row = {
        "symbol": symbol, "name": entry["name"], "sector": entry["sector"], "weight_pct": entry["weight_pct"],
        "held": symbol in held, "price": None, "previous_close": None, "change": None, "change_pct": None,
        "price_kind": None, "as_of": None, "stale": None, "day_high": None, "day_low": None, "volume": None,
        "returns": {}, "high_52w": None, "low_52w": None, "bars_count": len(rows), "source": None,
    }
    if _quote_is_today(quote, today) and (not rows or rows[-1]["date"] < today.isoformat()):
        price = quote["price"]
        previous = rows[-1]["close"] if rows else quote.get("previous_close")
        row.update({
            "price": price, "previous_close": previous, "price_kind": "delayed",
            "as_of": datetime.fromtimestamp(quote["quote_time"], CAIRO).isoformat(timespec="minutes"),
            "day_high": quote.get("high"), "day_low": quote.get("low"), "volume": quote.get("volume"),
            "source": quote["source"], "stale": False,
        })
        as_of_day = today
    elif rows:
        last = rows[-1]
        previous = rows[-2]["close"] if len(rows) > 1 else None
        row.update({
            "price": last["close"], "previous_close": previous, "price_kind": "close", "as_of": last["date"],
            "day_high": last["high"], "day_low": last["low"], "volume": last["volume"], "source": last["source"],
            "stale": date.fromisoformat(last["date"]) < expected_last_bar(at),
        })
        as_of_day = date.fromisoformat(last["date"])
    else:
        as_of_day = None

    if row["price"] is not None:
        if row["previous_close"]:
            row["change"] = row["price"] - row["previous_close"]
            row["change_pct"] = row["price"] / row["previous_close"] - 1
        row["returns"] = _returns(rows, row["price"], as_of_day)
        window = [r for r in rows if r["date"] >= (as_of_day - timedelta(days=365)).isoformat()]
        highs = [r["high"] for r in window if r["high"] is not None] + [row["price"]]
        lows = [r["low"] for r in window if r["low"] is not None] + [row["price"]]
        row["high_52w"], row["low_52w"] = max(highs), min(lows)

    valuation = latest_valuation(conn, symbol)
    if valuation:
        levels = pricing_levels(valuation["fair_value"], row["price"])
        row["valuation"] = {
            "id": valuation["id"], "fair_value": valuation["fair_value"], "risk_rating": valuation["risk_rating"],
            "protection_price": levels["protection_price"], "status": levels.get("status"),
            "upside": levels.get("upside_to_fair_value"), "created_at": valuation["created_at"],
        }
    else:
        row["valuation"] = None
    return row


def market_summary(conn: sqlite3.Connection, at: datetime | None = None) -> dict:
    at = at or now_cairo()
    held = {r[0] for r in conn.execute("SELECT DISTINCT symbol FROM holdings")}
    rows = [symbol_row(conn, c, held, at) for c in load_universe()["constituents"]]
    priced = [r for r in rows if r["change_pct"] is not None]
    last_run = store.last_sync_run(conn)
    if last_run and last_run.get("summary"):
        last_run["summary"] = json.loads(last_run["summary"])
    return {
        "as_of": at.isoformat(timespec="minutes"),
        "session_open": session_open(at),
        "expected_last_bar": expected_last_bar(at).isoformat(),
        "breadth": {
            "up": sum(1 for r in priced if r["change_pct"] > 0),
            "down": sum(1 for r in priced if r["change_pct"] < 0),
            "flat": sum(1 for r in priced if r["change_pct"] == 0),
            "no_data": sum(1 for r in rows if r["price"] is None),
        },
        "rows": rows,
        "last_sync": last_run,
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
    return {"symbol": symbol, "name": entry["name"], "bars": store.bars(conn, symbol, since),
            "quote": store.quote(conn, symbol), "levels": levels}
