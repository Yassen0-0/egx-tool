"""«متابعتي»: EGX30 stocks the user follows without holding them. Followed stocks get the daily
price refresh right after holdings (market/sync.py), so on the free EODHD plan the user picks
which prices stay current instead of the index weight deciding."""

import sqlite3

from ..errors import ValuationInputError
from ..universe import constituent, normalize_symbol
from .db import now_iso


def list_watchlist(conn: sqlite3.Connection) -> list[dict]:
    return [dict(r) for r in conn.execute("SELECT symbol, added_at FROM watchlist ORDER BY added_at, symbol")]


def add_to_watchlist(conn: sqlite3.Connection, symbol: str) -> list[dict]:
    """Follow a stock (adding one already followed keeps its original date). Returns the list."""
    symbol = normalize_symbol(symbol)
    if constituent(symbol) is None:
        raise ValuationInputError(f"{symbol} is not in the EGX30 universe")
    conn.execute("INSERT OR IGNORE INTO watchlist (symbol, added_at) VALUES (?, ?)", (symbol, now_iso()))
    conn.commit()
    return list_watchlist(conn)


def remove_from_watchlist(conn: sqlite3.Connection, symbol: str) -> list[dict]:
    """Stop following a stock; removing one not followed is a no-op. Returns the list."""
    conn.execute("DELETE FROM watchlist WHERE symbol = ?", (normalize_symbol(symbol),))
    conn.commit()
    return list_watchlist(conn)


def watched_symbols(conn: sqlite3.Connection) -> set[str]:
    return {r[0] for r in conn.execute("SELECT symbol FROM watchlist")}
