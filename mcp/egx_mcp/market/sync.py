"""Budget-aware refresh of the market cache.

Each run asks EODHD how many calls remain today (the account call is free; its count is for
apiRequestsDate, so a count from an earlier GMT day means a fresh budget), keeps a small reserve, then spends the rest on the holdings first and the user's «متابعتي» watchlist next. The
rest of the index is fetched only when the user asks for one stock (`sync_symbol`, one call), so
what the background leaves stays for those requests; only a plan whose daily limit covers the
whole index refreshes everything in the background. Inside each tier the stalest cache goes first
(index weight breaks ties), so when the budget cannot cover a tier its symbols take turns instead
of the same ones always winning.
Daily bars come first because they are the history the user reads; delayed intraday quotes
are fetched only while the session is open and only on plans with a real daily budget,
since one quote costs one call per symbol.
"""

import json
import sqlite3
from datetime import date, datetime, timedelta, timezone

from ..store.db import now_iso
from ..store.watchlist import watched_symbols
from ..universe import load_universe
from . import store
from .calendar import expected_last_bar, now_cairo, session_open
from .eodhd import LIMIT_STATUSES, SOURCE, EodhdClient, MarketDataError

RESERVE_CALLS = 2
HISTORY_DAYS = 365 * 5
QUOTES_MIN_DAILY_LIMIT = 1000
QUOTE_INTERVAL = timedelta(minutes=4)
KEEP_SYNC_RUNS = 500
# EODHD free plan; used for the refresh plan until a sync has read the real limit.
FREE_DAILY_LIMIT = 20


def calls_used_today(account: dict, at: datetime) -> int:
    """EODHD's count belongs to `counted_on` and is only zeroed by the first counted call after
    midnight GMT. Trusting a count from an earlier day blocks every call, so the count never
    resets (this kept prices frozen from 2026-10-15 to 10-19)."""
    counted_on = account.get("counted_on")
    if counted_on and counted_on < at.astimezone(timezone.utc).date().isoformat():
        return 0
    return account["used_today"]


def budget_status(conn: sqlite3.Connection, at: datetime | None = None) -> dict:
    """Since when the latest syncs have fetched nothing for lack of budget. `blocked_days` counts
    the GMT days (EODHD's reset) in that streak: one is the normal daily limit, two or more means
    the budget is not coming back and the UI says so."""
    days, since = set(), None
    for started_at, calls, summary in conn.execute(
            "SELECT started_at, calls_made, summary FROM sync_runs"
            " WHERE error IS NULL AND summary IS NOT NULL ORDER BY id DESC"):
        summary = json.loads(summary)
        if not summary.get("skipped_for_budget") or (calls and not summary.get("limit_refused")):
            break
        since = started_at
        days.add(started_at[:10])
    last_fetch = conn.execute("SELECT MAX(finished_at) FROM sync_runs WHERE calls_made > 0").fetchone()[0]
    return {"blocked_since": since, "blocked_days": len(days), "last_fetch_at": last_fetch,
            "left_today": left_today(conn, at or now_cairo())}


def left_today(conn: sqlite3.Connection, at: datetime) -> int:
    """Calls a one-stock refresh can still spend today (GMT day, after the reserve), from the last
    run that read the account; a run from an earlier GMT day means a fresh budget."""
    row = conn.execute("SELECT started_at, daily_limit, used_before, calls_made FROM sync_runs"
                       " WHERE daily_limit IS NOT NULL ORDER BY id DESC LIMIT 1").fetchone()
    limit = row[1] if row and row[1] else FREE_DAILY_LIMIT
    used = 0
    if row and row[0][:10] == at.astimezone(timezone.utc).date().isoformat():
        used = (row[2] or 0) + (row[3] or 0)
    return max(0, limit - used - RESERVE_CALLS)


def held_symbols(conn: sqlite3.Connection) -> set[str]:
    return {r[0] for r in conn.execute("SELECT DISTINCT symbol FROM holdings")}


def background_symbols(conn: sqlite3.Connection, daily_limit: int) -> list[str]:
    """What the 5-minute sync refreshes: holdings + «متابعتي», or the whole index when the plan's
    daily limit covers it."""
    order = priority_symbols(conn)
    if daily_limit - RESERVE_CALLS >= len(order):
        return order
    mine = held_symbols(conn) | watched_symbols(conn)
    return [s for s in order if s in mine]


def priority_symbols(conn: sqlite3.Connection) -> list[str]:
    """Holdings, then the watchlist, then the rest; stalest first inside a tier, then weight."""
    held, watched = held_symbols(conn), watched_symbols(conn)
    constituents = load_universe()["constituents"]
    last = {c["symbol"]: store.last_bar_date(conn, c["symbol"]) or "" for c in constituents}

    def key(c: dict) -> tuple:
        tier = 0 if c["symbol"] in held else 1 if c["symbol"] in watched else 2
        return (tier, last[c["symbol"]], -c["weight_pct"])

    return [c["symbol"] for c in sorted(constituents, key=key)]


def refresh_plan(conn: sqlite3.Connection) -> dict:
    """How the daily budget covers holdings + watchlist: `overflow` of them cannot refresh every
    day and take turns. Uses the plan limit seen by the last sync (the free plan until then)."""
    row = conn.execute("SELECT daily_limit FROM sync_runs WHERE daily_limit IS NOT NULL ORDER BY id DESC LIMIT 1").fetchone()
    limit = row[0] if row and row[0] else FREE_DAILY_LIMIT
    budget = max(0, limit - RESERVE_CALLS)
    universe = {c["symbol"] for c in load_universe()["constituents"]}
    held, watched = held_symbols(conn) & universe, watched_symbols(conn) & universe
    priority = len(held | watched)
    return {
        "daily_limit": limit, "daily_budget": budget, "reserve": RESERVE_CALLS,
        "holdings": len(held), "watchlist": len(watched), "priority": priority,
        "overflow": max(0, priority - budget), "all_daily": budget >= len(universe),
    }


def _needs_bars(conn: sqlite3.Connection, symbol: str, due: date, today: date) -> str | None:
    """Return the from-date to fetch, or None when the cache is current or already checked today."""
    last = store.last_bar_date(conn, symbol)
    if last is not None and date.fromisoformat(last) >= due:
        return None
    # One attempt per symbol per day, whether it brought rows, an empty list or an error: a
    # ticker EODHD does not serve would otherwise eat the budget on every 5-minute sync.
    if store.sync_state(conn, symbol)["bars_checked_on"] == today.isoformat():
        return None
    if last is None:
        return (today - timedelta(days=HISTORY_DAYS)).isoformat()
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
        if account.get("counted_on"):
            summary["counted_on"] = account["counted_on"]
        account["used_today"] = calls_used_today(account, at)
        budget = account["daily_limit"] - account["used_today"] - RESERVE_CALLS
        symbols = background_symbols(conn, account["daily_limit"])

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

        quotes_allowed = force_quotes or account["daily_limit"] >= QUOTES_MIN_DAILY_LIMIT
        if quotes_allowed and session_open(at) and budget > 0:
            last_run = conn.execute("SELECT MAX(quote_checked_at) FROM market_sync").fetchone()[0]
            fresh = last_run and datetime.fromisoformat(last_run) > at - QUOTE_INTERVAL
            if force_quotes or not fresh:
                batch = symbols[: max(0, budget)]
                try:
                    for q in client.quotes(batch):
                        if q["symbol"]:
                            store.upsert_quote(conn, q, SOURCE)
                            summary["quotes"] += 1
                    stamp = at.isoformat(timespec="seconds")
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
    except Exception as exc:
        # Never leave a run open: the UI reads the last run to say when prices were refreshed.
        conn.rollback()
        conn.execute("UPDATE sync_runs SET finished_at=?, error=? WHERE id=?",
                     (now_iso(), f"{type(exc).__name__}: {exc}", run_id))
        conn.commit()
        raise

    _finish(conn, run_id, account, client.calls_made, summary)
    return {"ok": True, "plan": account["plan"], "daily_limit": account["daily_limit"],
            "used_today": account["used_today"] + client.calls_made, "calls_made": client.calls_made, **summary}


def _finish(conn: sqlite3.Connection, run_id: int, account: dict, calls: int, summary: dict) -> None:
    conn.execute("DELETE FROM sync_runs WHERE id <= ?", (run_id - KEEP_SYNC_RUNS,))
    conn.execute(
        "UPDATE sync_runs SET finished_at=?, plan=?, daily_limit=?, used_before=?, calls_made=?, summary=? WHERE id=?",
        (now_iso(), account["plan"], account["daily_limit"], account["used_today"], calls,
         json.dumps(summary, ensure_ascii=False), run_id),
    )
    conn.commit()


def sync_symbol(conn: sqlite3.Connection, client: EodhdClient, symbol: str, at: datetime | None = None) -> dict:
    """The user's «حدّث سعر …»: one call for one stock, fetching every close it is missing. Spends
    nothing when its close is already current, or when today's budget (after the reserve) is gone.
    Recorded as a sync run, so the screens' «N من 20» counts it."""
    at = at or now_cairo()
    today = at.date()
    due = expected_last_bar(at)
    last = store.last_bar_date(conn, symbol)
    if last is not None and date.fromisoformat(last) >= due:
        return {"ok": True, "status": "current", "symbol": symbol, "last_bar": last, "calls_made": 0}
    run_id = conn.execute("INSERT INTO sync_runs (started_at) VALUES (?)", (now_iso(),)).lastrowid
    conn.commit()
    summary = {"on_demand": symbol, "bars_updated": [], "bars_current": 0, "quotes": 0,
               "skipped_for_budget": [], "errors": {}}
    try:
        account = client.account()
        if account.get("counted_on"):
            summary["counted_on"] = account["counted_on"]
        account["used_today"] = calls_used_today(account, at)
        if account["daily_limit"] - account["used_today"] - RESERVE_CALLS < 1:
            summary["skipped_for_budget"].append(symbol)
            status = "budget"
        else:
            date_from = (date.fromisoformat(last) + timedelta(days=1)).isoformat() if last else \
                (today - timedelta(days=HISTORY_DAYS)).isoformat()
            try:
                rows = client.daily_bars(symbol, date_from)
                store.upsert_bars(conn, symbol, rows, SOURCE)
                store.mark_checked(conn, symbol, bars_on=today)
                if rows:
                    summary["bars_updated"].append(symbol)
                status = "updated" if rows else "no_new_bars"
            except MarketDataError as exc:
                if exc.status not in LIMIT_STATUSES:
                    raise
                summary["limit_refused"] = str(exc)
                summary["skipped_for_budget"].append(symbol)
                status = "budget"
    except MarketDataError as exc:
        conn.rollback()
        conn.execute("UPDATE sync_runs SET finished_at=?, error=? WHERE id=?", (now_iso(), str(exc), run_id))
        conn.commit()
        return {"ok": False, "status": "error", "symbol": symbol, "error": str(exc), "calls_made": client.calls_made}
    except Exception as exc:
        conn.rollback()
        conn.execute("UPDATE sync_runs SET finished_at=?, error=? WHERE id=?",
                     (now_iso(), f"{type(exc).__name__}: {exc}", run_id))
        conn.commit()
        raise
    _finish(conn, run_id, account, client.calls_made, summary)
    return {"ok": True, "status": status, "symbol": symbol, "last_bar": store.last_bar_date(conn, symbol),
            "calls_made": client.calls_made,
            "left_today": max(0, account["daily_limit"] - account["used_today"] - client.calls_made - RESERVE_CALLS)}
