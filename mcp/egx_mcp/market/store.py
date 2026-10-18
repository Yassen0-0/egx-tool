"""Read and write the local market cache (daily bars, delayed quotes, sync bookkeeping)."""

import sqlite3
from datetime import date

from ..store.db import now_iso


def upsert_bars(conn: sqlite3.Connection, symbol: str, bars: list[dict], source: str) -> int:
    stamp = now_iso()
    conn.executemany(
        "INSERT INTO daily_bars (symbol, date, open, high, low, close, adjusted_close, volume, source, fetched_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        " ON CONFLICT(symbol, date) DO UPDATE SET open=excluded.open, high=excluded.high, low=excluded.low,"
        " close=excluded.close, adjusted_close=excluded.adjusted_close, volume=excluded.volume,"
        " source=excluded.source, fetched_at=excluded.fetched_at",
        [(symbol, b["date"], b["open"], b["high"], b["low"], b["close"], b["adjusted_close"], b["volume"],
          source, stamp) for b in bars],
    )
    return len(bars)


def upsert_quote(conn: sqlite3.Connection, quote: dict, source: str) -> None:
    conn.execute(
        "INSERT INTO quotes (symbol, price, open, high, low, volume, previous_close, change, change_p, quote_time,"
        " source, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        " ON CONFLICT(symbol) DO UPDATE SET price=excluded.price, open=excluded.open, high=excluded.high,"
        " low=excluded.low, volume=excluded.volume, previous_close=excluded.previous_close,"
        " change=excluded.change, change_p=excluded.change_p, quote_time=excluded.quote_time,"
        " source=excluded.source, fetched_at=excluded.fetched_at",
        (quote["symbol"], quote["price"], quote["open"], quote["high"], quote["low"], quote["volume"],
         quote["previous_close"], quote["change"], quote["change_p"], quote["quote_time"], source, now_iso()),
    )


def bars(conn: sqlite3.Connection, symbol: str, since: str | None = None) -> list[dict]:
    # close > 0: bars saved before 0 closes were filtered at the source are skipped, not shown.
    query = ("SELECT date, open, high, low, close, adjusted_close, volume, source FROM daily_bars"
             " WHERE symbol = ? AND close > 0")
    params: list = [symbol]
    if since:
        query += " AND date >= ?"
        params.append(since)
    return [dict(r) for r in conn.execute(query + " ORDER BY date", params)]


def last_bar_date(conn: sqlite3.Connection, symbol: str) -> str | None:
    row = conn.execute("SELECT MAX(date) FROM daily_bars WHERE symbol = ?", (symbol,)).fetchone()
    return row[0] if row else None


def quote(conn: sqlite3.Connection, symbol: str) -> dict | None:
    row = conn.execute("SELECT * FROM quotes WHERE symbol = ?", (symbol,)).fetchone()
    return dict(row) if row else None


def sync_state(conn: sqlite3.Connection, symbol: str) -> dict:
    row = conn.execute("SELECT * FROM market_sync WHERE symbol = ?", (symbol,)).fetchone()
    return dict(row) if row else {"symbol": symbol, "bars_checked_on": None, "quote_checked_at": None, "last_error": None}


def mark_checked(conn: sqlite3.Connection, symbol: str, *, bars_on: date | None = None,
                 quote_at: str | None = None, error: str | None = None) -> None:
    state = sync_state(conn, symbol)
    conn.execute(
        "INSERT INTO market_sync (symbol, bars_checked_on, quote_checked_at, last_error) VALUES (?, ?, ?, ?)"
        " ON CONFLICT(symbol) DO UPDATE SET bars_checked_on=excluded.bars_checked_on,"
        " quote_checked_at=excluded.quote_checked_at, last_error=excluded.last_error",
        (symbol, bars_on.isoformat() if bars_on else state["bars_checked_on"],
         quote_at or state["quote_checked_at"], error),
    )


def last_sync_run(conn: sqlite3.Connection) -> dict | None:
    row = conn.execute("SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1").fetchone()
    return dict(row) if row else None
