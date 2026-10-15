from datetime import date, datetime, timedelta

import pytest

from egx_mcp.market import store
from egx_mcp.market.calendar import CAIRO, expected_last_bar, session_open
from egx_mcp.market.eodhd import MarketDataError, _key_from_file
from egx_mcp.market.summary import market_summary, symbol_history
from egx_mcp.market.sync import priority_symbols, sync_market
from egx_mcp.store import portfolio
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
            price -= 0.5
        day -= timedelta(days=1)
    return list(reversed(rows))


class FakeClient:
    def __init__(self, limit=20, used=0, quotes=None, fail=None):
        self.limit, self.used, self.calls_made = limit, used, 0
        self.bar_requests, self.quote_batches = [], []
        self._quotes, self._fail = quotes or {}, fail or set()

    def account(self):
        return {"plan": "free" if self.limit <= 20 else "paid", "used_today": self.used, "daily_limit": self.limit}

    def daily_bars(self, symbol, date_from=None):
        self.calls_made += 1
        self.bar_requests.append((symbol, date_from))
        if symbol in self._fail:
            raise MarketDataError(f"EODHD eod/{symbol}.EGX returned HTTP 404")
        return _bars(date(2026, 10, 14), 300)

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
    assert comi["change"] == pytest.approx(0.5)
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
