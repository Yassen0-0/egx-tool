"""Which price is current, from the local cache only (no API calls).

- EGX stocks: the daily close of `<SYMBOL>` (EGX calendar), or today's delayed quote when one was
  stored; stale = older than the session whose bar should already exist.
- Currencies, gold and bitcoin: formulas over EODHD feeds stored under their full ticker
  (USDEGP.FOREX, XAUUSD.FOREX, BTC-USD.CC, ...). FOREX and crypto bars exist every day, including
  today's unfinished one, so a feed is fresh when its last bar is from yesterday (UTC) or later.
- US funds (SPY.US, IVV.US, VOO.US): the daily close in dollars, a feed of their own; they trade
  Monday to Friday, so one is fresh when its last bar is from the last weekday before today (UTC).
  US holidays are not listed: the day after one, the close shows as stale with its date.
"""

import sqlite3
from datetime import date, datetime, timedelta, timezone

from ..catalog import US_FUNDS
from . import store
from .calendar import CAIRO, expected_last_bar, previous_trading_day

TROY_OUNCE_GRAMS = 31.1034768
USD_EGP = "USDEGP.FOREX"
# Asset key → (price currency, ((feed, power), ...), factor): price = factor × Π feed^power.
# EUR and GBP go through the major pair and the dollar: their direct EGP crosses jump around.
# SAR and AED are pegged to the dollar by their central banks, so they need no call of their own.
FORMULAS: dict[str, tuple[str, tuple[tuple[str, int], ...], float]] = {
    "USD": ("EGP", ((USD_EGP, 1),), 1.0),
    "EUR": ("EGP", (("EURUSD.FOREX", 1), (USD_EGP, 1)), 1.0),
    "GBP": ("EGP", (("GBPUSD.FOREX", 1), (USD_EGP, 1)), 1.0),
    "SAR": ("EGP", ((USD_EGP, 1),), 1 / 3.75),
    "AED": ("EGP", ((USD_EGP, 1),), 1 / 3.6725),
    "XAU-OZ": ("EGP", (("XAUUSD.FOREX", 1), (USD_EGP, 1)), 1.0),
    # A gram of each karat is its pure share (karat / 24) of the world price; the gold pound is 8 g
    # of 21 karat. The jeweller's making charge is not in it: it is part of what the user paid.
    **{key: ("EGP", (("XAUUSD.FOREX", 1), (USD_EGP, 1)), grams * karat / 24 / TROY_OUNCE_GRAMS)
       for key, grams, karat in (("XAU-G", 1, 24), ("XAU-G22", 1, 22), ("XAU-G21", 1, 21), ("XAU-G18", 1, 18),
                                 ("XAU-G14", 1, 14), ("XAU-COIN", 8, 21))},
    "BTC": ("USD", (("BTC-USD.CC", 1),), 1.0),
}
# S&P 500 funds listed in New York (catalog US_FUNDS), priced by their own close.
FORMULAS.update({key: ("USD", ((key, 1),), 1.0) for key, *_ in US_FUNDS})
FEED_TOLERANCE = timedelta(days=7)  # a past day's rate may come from a bar up to a week earlier


def is_feed(ticker: str) -> bool:
    return "." in ticker


def feed_due(at: datetime, ticker: str = "") -> date:
    """The newest finished day a feed's bar should already exist for: yesterday (UTC) for FOREX and
    crypto, the last weekday before today for a US listing."""
    due = at.astimezone(timezone.utc).date() - timedelta(days=1)
    if ticker.endswith(".US"):
        while due.weekday() >= 5:
            due -= timedelta(days=1)
    return due


def price_state(conn: sqlite3.Connection, symbol: str, at: datetime, rows: list[dict] | None = None) -> dict:
    """An EGX stock's latest price, its date, the move against the previous close and whether it is
    stale. Today's delayed quote wins over yesterday's bar."""
    today = at.date()
    if rows is None:
        rows = store.last_bars(conn, symbol, 2)
    quote = store.quote(conn, symbol)
    state = {"price": None, "previous_close": None, "change": None, "change_pct": None, "price_kind": None,
             "as_of": None, "as_of_day": None, "stale": None, "source": None}
    quote_today = bool(quote and quote.get("price") and quote["price"] > 0 and quote.get("quote_time")
                       and datetime.fromtimestamp(quote["quote_time"], CAIRO).date() == today)
    if quote_today and (not rows or rows[-1]["date"] < today.isoformat()):
        # Today's move is against the previous session's close. When the cache misses that bar
        # (a budget gap), the quote's own previous close is the right base, not an older bar.
        previous_session = previous_trading_day(today).isoformat()
        previous_close = rows[-1]["close"] if rows and rows[-1]["date"] == previous_session \
            else quote.get("previous_close") or None
        state.update({
            "price": quote["price"], "previous_close": previous_close, "price_kind": "delayed",
            "as_of": datetime.fromtimestamp(quote["quote_time"], CAIRO).isoformat(timespec="minutes"),
            "as_of_day": today.isoformat(), "source": quote["source"], "stale": False,
        })
    elif rows:
        last = rows[-1]
        state.update({
            "price": last["close"], "previous_close": rows[-2]["close"] if len(rows) > 1 else None,
            "price_kind": "close", "as_of": last["date"], "as_of_day": last["date"], "source": last["source"],
            "stale": date.fromisoformat(last["date"]) < expected_last_bar(at),
        })
    if state["price"] is not None and state["previous_close"]:
        state["change"] = state["price"] - state["previous_close"]
        state["change_pct"] = state["price"] / state["previous_close"] - 1
    return state


def formula_price(conn: sqlite3.Connection, key: str, at: datetime) -> dict | None:
    """The asset's price from its feeds, dated by its oldest feed. The day's move counts the feeds
    that are fresh only (a stale feed contributes its last value to both ends)."""
    formula = FORMULAS.get(key)
    if formula is None:
        return None
    currency, parts, factor = formula
    now = before = factor
    days, fresh_any, stale_any = [], False, False
    for ticker, power in parts:
        rows = store.last_bars(conn, ticker, 2)
        if not rows:
            return None
        last = rows[-1]
        fresh = date.fromisoformat(last["date"]) >= feed_due(at, ticker)
        stale_any = stale_any or not fresh
        previous = rows[-2]["close"] if fresh and len(rows) > 1 else last["close"]
        fresh_any = fresh_any or (fresh and len(rows) > 1)
        now *= last["close"] ** power
        before *= previous ** power
        days.append(last["date"])
    day = min(days)
    return {"price": now, "currency": currency, "as_of": day, "day": day, "source": "EODHD",
            "stale": stale_any, "change": now - before if fresh_any else None}


def close_on(conn: sqlite3.Connection, ticker: str, day: str) -> tuple[float, str] | None:
    row = conn.execute("SELECT close, date FROM daily_bars WHERE symbol = ? AND date <= ? AND close > 0"
                       " ORDER BY date DESC LIMIT 1", (ticker, day)).fetchone()
    if row is None or date.fromisoformat(row[1]) < date.fromisoformat(day) - FEED_TOLERANCE:
        return None
    return row[0], row[1]


def formula_price_on(conn: sqlite3.Connection, key: str, day: str) -> dict | None:
    """The asset's price on a past day from stored bars (each feed's close on or before it)."""
    formula = FORMULAS.get(key)
    if formula is None:
        return None
    currency, parts, factor = formula
    value, days = factor, []
    for ticker, power in parts:
        found = close_on(conn, ticker, day)
        if found is None:
            return None
        value *= found[0] ** power
        days.append(found[1])
    return {"price": value, "currency": currency, "as_of": min(days)}


def feeds_of(key: str) -> list[str]:
    formula = FORMULAS.get(key)
    return [ticker for ticker, _ in formula[1]] if formula else []
