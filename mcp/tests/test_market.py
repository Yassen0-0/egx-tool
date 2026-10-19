from datetime import date, datetime, timedelta, timezone

import pytest

from egx_mcp.market import store
from egx_mcp.market.calendar import CAIRO, expected_last_bar, is_trading_day, session_open
from egx_mcp.market.eodhd import EodhdClient, MarketDataError, _key_from_file
from egx_mcp.market.summary import market_summary, symbol_history
from egx_mcp.market.sync import RESERVE_CALLS, budget_status, priority_symbols, refresh_plan, sync_market
from egx_mcp.store import portfolio, watchlist
from egx_mcp.store.db import connect

# Thursday 2026-10-15, before the session; Wednesday's bar is the latest expected.
MORNING = datetime(2026, 10, 15, 8, 0, tzinfo=CAIRO)
IN_SESSION = datetime(2026, 10, 15, 11, 0, tzinfo=CAIRO)


@pytest.fixture
def conn(tmp_path):
    connection = connect(tmp_path / "egx.sqlite")
    yield connection
    connection.close()


def _bars(last_day: date, n: int, start_price: float = 100.0) -> list[dict]:
    rows, day, price = [], last_day, start_price
    while len(rows) < n:
        if day.weekday() in {6, 0, 1, 2, 3}:
            rows.append({"date": day.isoformat(), "open": price, "high": price + 1, "low": price - 1,
                         "close": price, "adjusted_close": price, "volume": 1000.0})
            price -= 0.25  # stays positive over 300 bars (0 or negative closes are filtered)
        day -= timedelta(days=1)
    return list(reversed(rows))


class FakeClient:
    def __init__(self, limit=20, used=0, quotes=None, fail=None, counted_on=None, refuse_after=None):
        self.limit, self.used, self.calls_made = limit, used, 0
        self.counted_on, self.refuse_after = counted_on, refuse_after
        self.bar_requests, self.quote_batches = [], []
        self._quotes, self._fail = quotes or {}, fail or set()

    def account(self):
        return {"plan": "free" if self.limit <= 20 else "paid", "used_today": self.used,
                "counted_on": self.counted_on, "daily_limit": self.limit}

    last_day = date(2026, 10, 14)

    def daily_bars(self, symbol, date_from=None):
        self.calls_made += 1
        self.bar_requests.append((symbol, date_from))
        if self.refuse_after is not None and len(self.bar_requests) > self.refuse_after:
            raise MarketDataError("EODHD eod/X.EGX returned HTTP 402: API Rate Limit Exceeded", 402)
        if symbol in self._fail:
            raise MarketDataError(f"EODHD eod/{symbol}.EGX returned HTTP 404")
        return _bars(self.last_day, 300)

    def quotes(self, symbols):
        self.calls_made += len(symbols)
        self.quote_batches.append(list(symbols))
        return [{"symbol": s, "price": self._quotes.get(s, 50.0), "open": 49.0, "high": 51.0, "low": 48.0,
                 "volume": 10.0, "previous_close": 49.0, "change": 1.0, "change_p": 2.0,
                 "quote_time": int(datetime(2026, 10, 15, 10, 45, tzinfo=CAIRO).timestamp())} for s in symbols]


def test_calendar():
    assert expected_last_bar(MORNING) == date(2026, 10, 14)
    assert expected_last_bar(datetime(2026, 10, 15, 17, 0, tzinfo=CAIRO)) == date(2026, 10, 15)
    # Saturday -> Thursday's bar; Sunday morning -> Thursday's bar.
    assert expected_last_bar(datetime(2026, 10, 17, 12, 0, tzinfo=CAIRO)) == date(2026, 10, 15)
    assert expected_last_bar(datetime(2026, 10, 18, 9, 0, tzinfo=CAIRO)) == date(2026, 10, 15)
    assert session_open(IN_SESSION) and not session_open(MORNING)
    assert not session_open(datetime(2026, 10, 16, 11, 0, tzinfo=CAIRO))  # Friday


def test_priority_puts_holdings_first_then_weight(conn):
    portfolio.add_holding(conn, "EAST", buy_price=10, quantity=1)
    order = priority_symbols(conn)
    assert order[0] == "EAST"
    assert order[1] == "COMI"  # largest index weight
    assert len(order) == 31


def test_priority_puts_watchlist_after_holdings_before_weight(conn):
    portfolio.add_holding(conn, "EAST", buy_price=10, quantity=1)
    watchlist.add_to_watchlist(conn, "FWRY")
    watchlist.add_to_watchlist(conn, "EAST")  # held and followed: still a holding
    order = priority_symbols(conn)
    assert order[:3] == ["EAST", "FWRY", "COMI"]
    assert len(order) == 31


def _free_days(conn, first: date, days: int):
    """Run the morning sync on each trading day from `first` on the free plan (fresh budget daily);
    yields (day, expected last bar, client)."""
    day = first
    while days:
        if is_trading_day(day):
            at = datetime(day.year, day.month, day.day, 8, 0, tzinfo=CAIRO)
            due = expected_last_bar(at)
            client = FakeClient(limit=20)
            client.last_day = due
            sync_market(conn, client, at=at)
            yield day, due, client
            days -= 1
        day += timedelta(days=1)


def _seed_all_bars(conn):
    # Every symbol has bars up to 14/10, written directly so no sync run records a plan limit.
    for symbol in priority_symbols(conn):
        store.upsert_bars(conn, symbol, _bars(date(2026, 10, 14), 300), "test")
    conn.commit()


def test_free_budget_refreshes_holdings_and_watchlist_every_day(conn):
    budget = 20 - RESERVE_CALLS
    assert budget == 18
    _seed_all_bars(conn)
    universe = priority_symbols(conn)
    held = ["EAST", "ETEL", "COMI"]
    for symbol in held:
        portfolio.add_holding(conn, symbol, buy_price=10, quantity=1)
    # The smallest index weights, so the watchlist never rides on the weight order.
    followed = [s for s in reversed(universe) if s not in held][: budget - len(held)]
    for symbol in followed:
        watchlist.add_to_watchlist(conn, symbol)
    plan = refresh_plan(conn)
    assert plan["daily_budget"] == 18 and plan["priority"] == 18 and plan["overflow"] == 0
    for day, due, client in _free_days(conn, date(2026, 10, 18), 5):
        assert client.calls_made == budget
        for symbol in held + followed:
            assert store.last_bar_date(conn, symbol) == due.isoformat(), (day, symbol)


def test_rest_of_the_index_takes_turns(conn):
    _seed_all_bars(conn)
    portfolio.add_holding(conn, "EAST", buy_price=10, quantity=1)
    watchlist.add_to_watchlist(conn, "FWRY")
    days = list(_free_days(conn, date(2026, 10, 18), 2))
    first_due = days[0][1]
    # 16 calls a day for the other 29 stocks: within two trading days every one is refreshed.
    for symbol in priority_symbols(conn):
        assert store.last_bar_date(conn, symbol) >= first_due.isoformat(), symbol


def test_watchlist_over_budget_falls_back_to_every_other_day(conn):
    _seed_all_bars(conn)
    universe = priority_symbols(conn)
    for symbol in universe[:20]:
        watchlist.add_to_watchlist(conn, symbol)
    plan = refresh_plan(conn)
    assert plan["priority"] == 20 and plan["overflow"] == 2
    seen = {}
    for day, due, _ in _free_days(conn, date(2026, 10, 18), 4):
        for symbol in universe[:20]:
            if store.last_bar_date(conn, symbol) == due.isoformat():
                seen.setdefault(symbol, []).append(day)
    # Each followed stock is refreshed at least every other trading day.
    assert all(len(seen.get(s, [])) >= 2 for s in universe[:20])


def test_market_summary_marks_watched_rows_and_plan(conn):
    watchlist.add_to_watchlist(conn, "FWRY")
    summary = market_summary(conn, at=MORNING)
    assert next(r for r in summary["rows"] if r["symbol"] == "FWRY")["watched"] is True
    assert next(r for r in summary["rows"] if r["symbol"] == "COMI")["watched"] is False
    assert summary["refresh_plan"]["daily_limit"] == 20  # free plan until a sync reads the limit
    assert summary["refresh_plan"]["watchlist"] == 1
    sync_market(conn, FakeClient(limit=100_000), at=MORNING)
    assert market_summary(conn, at=MORNING)["refresh_plan"]["all_daily"] is True


def test_sync_respects_free_budget_and_skips_quotes(conn):
    client = FakeClient(limit=20, used=3)
    result = sync_market(conn, client, at=IN_SESSION)
    assert result["ok"]
    assert client.calls_made == 15  # 20 - 3 used - 2 reserve
    assert len(result["bars_updated"]) == 15
    assert len(result["skipped_for_budget"]) == 16
    assert client.quote_batches == []
    assert "quotes_note" in result


def test_second_run_only_fetches_stale_symbols(conn):
    sync_market(conn, FakeClient(limit=20), at=MORNING)
    client = FakeClient(limit=20)
    sync_market(conn, client, at=MORNING)
    fetched_again = {s for s, _ in client.bar_requests}
    first_batch = set(priority_symbols(conn)[:18])
    assert not fetched_again & first_batch
    assert len(fetched_again) == 13


def test_paid_plan_fetches_all_bars_and_quotes_in_session(conn):
    client = FakeClient(limit=100_000)
    result = sync_market(conn, client, at=IN_SESSION)
    assert len(result["bars_updated"]) == 31
    assert result["quotes"] == 31
    assert len(client.quote_batches[0]) == 31


def test_errors_are_recorded_not_fatal(conn):
    result = sync_market(conn, FakeClient(limit=100_000, fail={"COMI"}), at=MORNING)
    assert "COMI" in result["errors"]
    assert store.sync_state(conn, "COMI")["last_error"].startswith("EODHD")
    assert len(result["bars_updated"]) == 30


def test_market_summary_prices_returns_and_staleness(conn):
    sync_market(conn, FakeClient(limit=100_000), at=MORNING)
    summary = market_summary(conn, at=MORNING)
    comi = next(r for r in summary["rows"] if r["symbol"] == "COMI")
    assert comi["price_kind"] == "close"
    assert comi["as_of"] == "2026-10-14"
    assert comi["stale"] is False
    assert comi["change"] == pytest.approx(0.25)
    assert comi["returns"]["1w"] is not None and comi["returns"]["1w"] > 0
    assert comi["high_52w"] >= comi["price"] >= comi["low_52w"]
    assert summary["breadth"]["up"] == 31
    # Next day after the bars should exist, the same data is stale.
    later = market_summary(conn, at=datetime(2026, 10, 18, 17, 0, tzinfo=CAIRO))
    assert next(r for r in later["rows"] if r["symbol"] == "COMI")["stale"] is True


def test_market_summary_prefers_todays_delayed_quote(conn):
    sync_market(conn, FakeClient(limit=100_000, quotes={"COMI": 120.0}), at=IN_SESSION)
    comi = next(r for r in market_summary(conn, at=IN_SESSION)["rows"] if r["symbol"] == "COMI")
    assert comi["price_kind"] == "delayed"
    assert comi["price"] == 120.0
    assert comi["previous_close"] == 100.0


def test_symbols_without_data(conn):
    summary = market_summary(conn, at=MORNING)
    assert summary["breadth"]["no_data"] == 31
    assert all(r["price"] is None for r in summary["rows"])


def test_symbol_history_includes_levels(conn):
    sync_market(conn, FakeClient(limit=100_000), at=MORNING)
    history = symbol_history(conn, "comi", days=30)
    assert history["symbol"] == "COMI"
    assert 15 <= len(history["bars"]) <= 25
    assert history["levels"] is None


def test_key_file_reading(tmp_path):
    plain = tmp_path / "key.txt"
    plain.write_text("my key: 0123456789abcd.12345678\n", encoding="utf-8")
    assert _key_from_file(plain) == "0123456789abcd.12345678"
    two = tmp_path / "two.txt"
    two.write_text("0123456789abcd.12345678 and fedcba9876543210.87654321", encoding="utf-8")
    with pytest.raises(MarketDataError):
        _key_from_file(two)
    assert _key_from_file(tmp_path / "missing.txt") is None


def test_cached_provider_prefers_market_cache(tmp_path, monkeypatch):
    from egx_mcp.data.cached import CachedMarketProvider
    from egx_mcp.data.manual import ManualProvider

    db = tmp_path / "egx.sqlite"
    monkeypatch.setenv("EGX_DB_PATH", str(db))
    manual_root = tmp_path / "manual"
    manual_root.mkdir()
    (manual_root / "prices.csv").write_text("symbol,price,date,source\nCOMI,1.0,2020-01-01,manual\n", encoding="utf-8")
    provider = CachedMarketProvider(ManualProvider(manual_root))
    assert provider.get_price("COMI").source == "manual"
    with connect(db) as c:
        sync_market(c, FakeClient(limit=100_000), at=MORNING)
    price = provider.get_price("COMI")
    assert price.source == "EODHD daily close" and price.as_of == "2026-10-14"
    assert len(provider.get_price_history("COMI")) == 300
    assert provider.get_price("EAST").source == "EODHD daily close"


# ── EODHD's lazy daily counter ───────────────────────────────────────────────

MONDAY = datetime(2026, 10, 19, 8, 0, tzinfo=CAIRO)


def test_account_reads_the_counter_day(monkeypatch):
    client = EodhdClient("k")
    monkeypatch.setattr(client, "_get", lambda path, cost=1, **params: {
        "subscriptionType": "free", "apiRequests": 20, "apiRequestsDate": "2026-10-15", "dailyRateLimit": 20})
    assert client.account() == {"plan": "free", "used_today": 20, "counted_on": "2026-10-15", "daily_limit": 20}


def test_count_from_an_earlier_day_is_a_fresh_budget(conn):
    # The real 2026-10-15..19 freeze: /user kept saying 20 of 20 for 10-15, because EODHD only zeroes
    # the count on the first counted call after midnight GMT and the sync never made one.
    client = FakeClient(limit=20, used=20, counted_on="2026-10-15")
    result = sync_market(conn, client, at=MONDAY)
    assert result["ok"] and client.calls_made == 20 - RESERVE_CALLS
    assert len(result["bars_updated"]) == 20 - RESERVE_CALLS
    run = store.last_sync_run(conn)
    assert run["used_before"] == 0 and run["calls_made"] == 18


def test_count_from_today_is_respected_in_gmt(conn):
    # 01:00 Cairo on the 19th is still the 18th in GMT, so a count for the 18th is today's count.
    late = datetime(2026, 10, 19, 1, 0, tzinfo=CAIRO)
    client = FakeClient(limit=20, used=20, counted_on="2026-10-18")
    result = sync_market(conn, client, at=late)
    assert client.calls_made == 0 and len(result["skipped_for_budget"]) == 31
    client = FakeClient(limit=20, used=5, counted_on="2026-10-19")
    sync_market(conn, client, at=MONDAY)
    assert client.calls_made == 20 - 5 - RESERVE_CALLS


def test_limit_refusal_stops_the_run_and_retries_later(conn):
    client = FakeClient(limit=20, refuse_after=3)
    result = sync_market(conn, client, at=MONDAY)
    assert len(client.bar_requests) == 4  # three served, the fourth refused, nothing after it
    assert len(result["bars_updated"]) == 3 and not result["errors"]
    assert len(result["skipped_for_budget"]) == 31 - 3 and "402" in result["limit_refused"]
    refused = client.bar_requests[3][0]
    assert store.sync_state(conn, refused)["bars_checked_on"] is None
    # Next day's budget picks the refused symbol up again.
    client = FakeClient(limit=20)
    sync_market(conn, client, at=MONDAY + timedelta(days=1))
    assert refused in [s for s, _ in client.bar_requests]


def test_budget_status_counts_blocked_days(conn, monkeypatch):
    def run(at, **kw):
        # sync_runs stamps the wall clock; pin it to the simulated moment.
        monkeypatch.setattr("egx_mcp.market.sync.now_iso",
                            lambda: at.astimezone(timezone.utc).isoformat(timespec="seconds"))
        return sync_market(conn, FakeClient(limit=20, **kw), at=at)

    assert budget_status(conn)["blocked_days"] == 0
    run(MONDAY)
    status = budget_status(conn)
    assert status["blocked_days"] == 0 and status["last_fetch_at"]
    # Two more GMT days where EODHD reports today's budget as spent: a block that outlasts a day.
    for day in (20, 21):
        at = datetime(2026, 10, day, 8, 0, tzinfo=CAIRO)
        run(at, used=20, counted_on=f"2026-10-{day}")
        run(at + timedelta(minutes=5), used=20, counted_on=f"2026-10-{day}")
    status = budget_status(conn)
    assert status["blocked_days"] == 2 and status["blocked_since"].startswith("2026-10-20")
    assert market_summary(conn, at=MONDAY + timedelta(days=2))["price_budget"]["blocked_days"] == 2
    # A run that fetches again ends the streak.
    run(datetime(2026, 10, 22, 8, 0, tzinfo=CAIRO))
    assert budget_status(conn)["blocked_days"] == 0
