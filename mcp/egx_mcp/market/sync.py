"""Budget-aware refresh of the market cache.

Each run asks EODHD how many calls remain today (the account call is free), keeps a small
reserve, then spends the rest in priority order: holdings first, then EGX30 weight.
Daily bars come first because they are the history the user reads; delayed intraday quotes
are fetched only while the session is open and only on plans with a real daily budget,
since one quote costs one call per symbol.
"""

import json
import sqlite3
from datetime import date, datetime, timedelta

from ..store.db import now_iso
from ..universe import load_universe
from . import store
from .calendar import expected_last_bar, now_cairo, session_open
from .eodhd import SOURCE, EodhdClient, MarketDataError

RESERVE_CALLS = 2
HISTORY_DAYS = 365 * 5
QUOTES_MIN_DAILY_LIMIT = 1000
QUOTE_INTERVAL = timedelta(minutes=4)
KEEP_SYNC_RUNS = 500


def priority_symbols(conn: sqlite3.Connection) -> list[str]:
    held = {r[0] for r in conn.execute("SELECT DISTINCT symbol FROM holdings")}
    constituents = sorted(load_universe()["constituents"], key=lambda c: -c["weight_pct"])
    symbols = [c["symbol"] for c in constituents]
    return [s for s in symbols if s in held] + [s for s in symbols if s not in held]


def _needs_bars(conn: sqlite3.Connection, symbol: str, due: date, today: date) -> str | None:
    """Return the from-date to fetch, or None when the cache is current or already checked today."""
    last = store.last_bar_date(conn, symbol)
    if last is None:
        return (today - timedelta(days=HISTORY_DAYS)).isoformat()
    if date.fromisoformat(last) >= due:
        return None
    if store.sync_state(conn, symbol)["bars_checked_on"] == today.isoformat():
        return None
    return (date.fromisoformat(last) + timedelta(days=1)).isoformat()


def sync_market(conn: sqlite3.Connection, client: EodhdClient, at: datetime | None = None,
                force_quotes: bool = False) -> dict:
    at = at or now_cairo()
    today = at.date()
    due = expected_last_bar(at)
    run_id = conn.execute("INSERT INTO sync_runs (started_at) VALUES (?)", (now_iso(),)).lastrowid
    conn.commit()
    summary = {"bars_updated": [], "bars_current": 0, "quotes": 0, "skipped_for_budget": [], "errors": {}}
    account = {"plan": None, "used_today": 0, "daily_limit": 0}
    try:
        account = client.account()
        budget = account["daily_limit"] - account["used_today"] - RESERVE_CALLS
        symbols = priority_symbols(conn)

        for symbol in symbols:
            date_from = _needs_bars(conn, symbol, due, today)
            if date_from is None:
                summary["bars_current"] += 1
                continue
            if budget < 1:
                summary["skipped_for_budget"].append(symbol)
                continue
            budget -= 1
            try:
                rows = client.daily_bars(symbol, date_from)
                store.upsert_bars(conn, symbol, rows, SOURCE)
                store.mark_checked(conn, symbol, bars_on=today)
                if rows:
                    summary["bars_updated"].append(symbol)
            except MarketDataError as exc:
                store.mark_checked(conn, symbol, error=str(exc))
                summary["errors"][symbol] = str(exc)
            conn.commit()

        quotes_allowed = force_quotes or account["daily_limit"] >= QUOTES_MIN_DAILY_LIMIT
        if quotes_allowed and session_open(at) and budget > 0:
            last_run = conn.execute("SELECT MAX(quote_checked_at) FROM market_sync").fetchone()[0]
            fresh = last_run and datetime.fromisoformat(last_run) > datetime.now(at.tzinfo) - QUOTE_INTERVAL
            if force_quotes or not fresh:
                batch = symbols[: max(0, budget)]
                try:
                    for q in client.quotes(batch):
                        if q["symbol"]:
                            store.upsert_quote(conn, q, SOURCE)
                            summary["quotes"] += 1
                    stamp = datetime.now(at.tzinfo).isoformat(timespec="seconds")
                    for symbol in batch:
                        store.mark_checked(conn, symbol, quote_at=stamp)
                except MarketDataError as exc:
                    summary["errors"]["quotes"] = str(exc)
                conn.commit()
        elif not quotes_allowed:
            summary["quotes_note"] = "delayed intraday quotes need a paid plan budget; showing daily closes"
    except MarketDataError as exc:
        conn.execute("UPDATE sync_runs SET finished_at=?, error=? WHERE id=?", (now_iso(), str(exc), run_id))
        conn.commit()
        return {"ok": False, "error": str(exc), **summary}

    calls = client.calls_made
    conn.execute("DELETE FROM sync_runs WHERE id <= ?", (run_id - KEEP_SYNC_RUNS,))
    conn.execute(
        "UPDATE sync_runs SET finished_at=?, plan=?, daily_limit=?, used_before=?, calls_made=?, summary=? WHERE id=?",
        (now_iso(), account["plan"], account["daily_limit"], account["used_today"], calls,
         json.dumps(summary, ensure_ascii=False), run_id),
    )
    conn.commit()
    return {"ok": True, "plan": account["plan"], "daily_limit": account["daily_limit"],
            "used_today": account["used_today"] + calls, "calls_made": calls, **summary}
