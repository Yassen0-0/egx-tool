"""Budget-aware refresh of the prices «السجل» needs, and nothing else.

- EGX stocks the user holds: the daily close, due after 16:00 Cairo (or the next time the app runs);
  inside the holdings the stalest cache goes first, so a book larger than the daily budget takes
  turns.
- Feeds behind the other assets (prices.FORMULAS) plus USDEGP, which converts every dollar price and
  values purchases in dollars: one call per feed per Cairo day, fetching from the last stored day
  again, because today's FOREX or crypto bar is still moving when it is first stored.

Each run asks EODHD how many calls remain today (the account call is free; its count is for
apiRequestsDate, so a count from an earlier GMT day means a fresh budget) and keeps a small reserve.
"""

import json
import sqlite3
from datetime import date, datetime, timedelta, timezone

from ..store.db import now_iso
from . import store
from .calendar import expected_last_bar, now_cairo
from .eodhd import LIMIT_STATUSES, SOURCE, EodhdClient, MarketDataError
from .prices import USD_EGP, feeds_of, is_feed

RESERVE_CALLS = 2
HISTORY_DAYS = 365 * 5  # the free plan answers with its one year
KEEP_SYNC_RUNS = 500
FREE_DAILY_LIMIT = 20


def _stamp(at: datetime) -> str:
    """A run starts at `at` (now in the app): the day's budget is counted from it, so a run judged
    at a given time must not be stamped with the wall clock."""
    return at.astimezone(timezone.utc).isoformat(timespec="seconds")


def calls_used_today(account: dict, at: datetime) -> int:
    """EODHD's count belongs to `counted_on` and is only zeroed by the first counted call after
    midnight GMT. Trusting a count from an earlier day blocks every call, so the count never
    resets (this kept prices frozen from 2026-10-15 to 10-19)."""
    counted_on = account.get("counted_on")
    if counted_on and counted_on < at.astimezone(timezone.utc).date().isoformat():
        return 0
    return account["used_today"]


def held_stocks(conn: sqlite3.Connection) -> list[str]:
    """EGX tickers in the ledger, stalest cache first."""
    symbols = [r[0] for r in conn.execute("SELECT DISTINCT symbol FROM holdings WHERE kind = 'stock'")
               if ":" not in r[0] and "." not in r[0]]
    return sorted(symbols, key=lambda s: (store.last_bar_date(conn, s) or "", s))


def ledger_feeds(conn: sqlite3.Connection) -> list[str]:
    """The FOREX and crypto feeds the ledger's assets need, USDEGP first (whenever anything is held)."""
    keys = [r[0] for r in conn.execute("SELECT DISTINCT symbol FROM holdings")]
    if not keys:
        return []
    feeds = [USD_EGP]
    for key in keys:
        feeds += [f for f in feeds_of(key) if f not in feeds]
    return feeds


def refresh_plan(conn: sqlite3.Connection) -> dict:
    """How the daily budget covers the ledger: `overflow` of the calls cannot happen every day."""
    row = conn.execute("SELECT daily_limit FROM sync_runs WHERE daily_limit IS NOT NULL ORDER BY id DESC LIMIT 1").fetchone()
    limit = row[0] if row and row[0] else FREE_DAILY_LIMIT
    budget = max(0, limit - RESERVE_CALLS)
    need = len(held_stocks(conn)) + len(ledger_feeds(conn))
    return {"daily_limit": limit, "daily_budget": budget, "reserve": RESERVE_CALLS, "stocks": len(held_stocks(conn)),
            "feeds": len(ledger_feeds(conn)), "overflow": max(0, need - budget), "all_daily": budget >= need}


def _from_date(conn: sqlite3.Connection, symbol: str, at: datetime) -> str | None:
    """The from-date to fetch, or None when the cache is current or the symbol was tried today. One
    attempt per symbol per day whatever came back, so a ticker EODHD does not serve cannot eat the
    budget on every 5-minute sync."""
    today = at.date()
    if store.sync_state(conn, symbol)["bars_checked_on"] == today.isoformat():
        return None
    last = store.last_bar_date(conn, symbol)
    if last is None:
        return (today - timedelta(days=HISTORY_DAYS)).isoformat()
    if is_feed(symbol):
        return last  # the last stored day may have been an unfinished one
    if date.fromisoformat(last) >= expected_last_bar(at):
        return None
    return (date.fromisoformat(last) + timedelta(days=1)).isoformat()


def sync_market(conn: sqlite3.Connection, client: EodhdClient, at: datetime | None = None) -> dict:
    at = at or now_cairo()
    today = at.date()
    run_id = conn.execute("INSERT INTO sync_runs (started_at) VALUES (?)", (_stamp(at),)).lastrowid
    conn.commit()
    summary = {"bars_updated": [], "bars_current": 0, "skipped_for_budget": [], "errors": {}}
    account = {"plan": None, "used_today": 0, "daily_limit": 0}
    try:
        symbols = held_stocks(conn) + ledger_feeds(conn)
        due = [(s, d) for s in symbols if (d := _from_date(conn, s, at)) is not None]
        summary["bars_current"] = len(symbols) - len(due)
        if due:
            account = client.account()
            if account.get("counted_on"):
                summary["counted_on"] = account["counted_on"]
            account["used_today"] = calls_used_today(account, at)
        budget = account["daily_limit"] - account["used_today"] - RESERVE_CALLS
        for symbol, date_from in due:
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
                if exc.status in LIMIT_STATUSES:
                    # EODHD refused for budget, not for this symbol: leave it unchecked so it is
                    # retried, and spend nothing more this run.
                    summary["limit_refused"] = str(exc)
                    summary["skipped_for_budget"].append(symbol)
                    budget = 0
                    continue
                store.mark_checked(conn, symbol, bars_on=today, error=str(exc))
                summary["errors"][symbol] = str(exc)
            conn.commit()
    except MarketDataError as exc:
        conn.execute("UPDATE sync_runs SET finished_at=?, error=? WHERE id=?", (now_iso(), str(exc), run_id))
        conn.commit()
        return {"ok": False, "error": str(exc), **summary}
    except Exception as exc:
        # Never leave a run open: the last run says when prices were refreshed.
        conn.rollback()
        conn.execute("UPDATE sync_runs SET finished_at=?, error=? WHERE id=?",
                     (now_iso(), f"{type(exc).__name__}: {exc}", run_id))
        conn.commit()
        raise

    conn.execute("DELETE FROM sync_runs WHERE id <= ?", (run_id - KEEP_SYNC_RUNS,))
    conn.execute(
        "UPDATE sync_runs SET finished_at=?, plan=?, daily_limit=?, used_before=?, calls_made=?, summary=? WHERE id=?",
        (now_iso(), account["plan"], account["daily_limit"] or None, account["used_today"], client.calls_made,
         json.dumps(summary, ensure_ascii=False), run_id),
    )
    conn.commit()
    return {"ok": True, "plan": account["plan"], "daily_limit": account["daily_limit"],
            "used_today": account["used_today"] + client.calls_made, "calls_made": client.calls_made, **summary}


def last_sync(conn: sqlite3.Connection) -> dict | None:
    run = store.last_sync_run(conn)
    if run and run.get("summary"):
        run["summary"] = json.loads(run["summary"])
    return run
