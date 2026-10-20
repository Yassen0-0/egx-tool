"""A stock added by name whose symbol looks like an EGX ticker (SWDY) is priced like an EGX30 stock:
its close is fetched after the session and cached under the ticker. A ticker EODHD does not serve is
tried once per due session and the line stays on the user's own price."""

from datetime import datetime

import pytest

from egx_mcp.catalog import egx_ticker
from egx_mcp.market import store
from egx_mcp.market.calendar import CAIRO
from egx_mcp.market.eodhd import MarketDataError
from egx_mcp.market.sync import held_stocks, sync_market
from egx_mcp.store import portfolio
from egx_mcp.store.db import connect

AFTER_SESSION = datetime(2026, 10, 15, 17, 0, tzinfo=CAIRO)  # Thursday, the session closed at 16:00
LATER = datetime(2026, 10, 15, 17, 30, tzinfo=CAIRO)
NEXT_DAY = datetime(2026, 10, 18, 17, 0, tzinfo=CAIRO)  # Sunday, the next session


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("EGX_DATA_DIR", str(tmp_path))
    connection = connect(tmp_path / "egx.sqlite")
    yield connection
    connection.close()


class Client:
    """Serves the tickers in `bars` (ticker -> close of 2026-10-15); every other ticker is a 404."""

    def __init__(self, bars):
        self.bars, self.calls_made, self.requests = bars, 0, []

    @property
    def stocks(self):
        """The EGX tickers asked for (the dollar feed is asked for whenever anything is held)."""
        return [s for s in self.requests if "." not in s]

    def account(self):
        return {"plan": "free", "used_today": 0, "counted_on": None, "daily_limit": 20}

    def daily_bars(self, symbol, date_from=None):
        self.calls_made += 1
        self.requests.append(symbol)
        if symbol not in self.bars:
            raise MarketDataError("HTTP 404", 404)
        close = self.bars[symbol]
        return [{"date": "2026-10-15", "open": close, "high": close, "low": close, "close": close,
                 "adjusted_close": close, "volume": 1.0}]


def add_custom(conn, name, symbol, price=None, kind="stock"):
    custom = {"kind": kind, "name": name, "symbol": symbol, "currency": "EGP", "price": price}
    return portfolio.add_holding(conn, buy_price=30, quantity=10, custom=custom)["symbol"]


def line(conn, key, at):
    return next(a for g in portfolio.portfolio_summary(conn, at)["groups"] for a in g["assets"] if a["key"] == key)


def test_the_ticker_rule():
    assert egx_ticker("custom:1", "stock", "SWDY") == "SWDY"
    assert egx_ticker("custom:1", "stock", " swdy ") == "SWDY"
    assert egx_ticker("custom:1", "stock", "SWDY.EGX") is None  # a dot: not an EGX ticker
    assert egx_ticker("custom:1", "stock", "S") is None and egx_ticker("custom:1", "stock", "ABCDEFG") is None
    assert egx_ticker("custom:1", "stock", "سويدي") is None and egx_ticker("custom:1", "stock", None) is None
    assert egx_ticker("custom:1", "fund", "SWDY") is None
    assert egx_ticker("COMI", "stock") == "COMI" and egx_ticker("fund:x", "fund") is None


def test_a_custom_stock_is_fetched_after_the_session_and_priced_from_its_bar(db):
    key = add_custom(db, "السويدي إليكتريك", "swdy")
    portfolio.set_price(db, key, 33.0, day="2026-10-15")  # the user's own price, from the session's day
    assert key.startswith("custom:") and held_stocks(db) == ["SWDY"]
    client = Client({"SWDY": 41.5})
    result = sync_market(db, client, at=AFTER_SESSION)
    assert client.stocks == ["SWDY"] and result["bars_updated"] == ["SWDY"]
    assert store.last_bar_date(db, "SWDY") == "2026-10-15"
    held = line(db, key, AFTER_SESSION)
    # The close and the manual price are from the same day: the market wins. The key stays custom:<id>.
    assert held["key"] == key and held["price"] == 41.5 and held["price_source"] == "EODHD"
    assert held["value_egp"] == 415.0 and held["stale"] is False
    # One call per day: the same session is not fetched twice.
    again = Client({"SWDY": 41.5})
    sync_market(db, again, at=LATER)
    assert again.stocks == []


def test_a_newer_manual_price_still_beats_the_close(db):
    key = add_custom(db, "السويدي إليكتريك", "SWDY")
    sync_market(db, Client({"SWDY": 41.5}), at=AFTER_SESSION)
    portfolio.set_price(db, key, 44.0, day="2026-10-16")
    assert line(db, key, datetime(2026, 10, 16, 12, 0, tzinfo=CAIRO))["price"] == 44.0


def test_a_ticker_eodhd_does_not_serve_stays_on_the_manual_price_and_is_tried_once(db):
    key = add_custom(db, "شركة غير مقيدة", "NOPE")
    portfolio.set_price(db, key, 12.0, day="2026-10-14")
    client = Client({})
    result = sync_market(db, client, at=AFTER_SESSION)
    assert client.stocks == ["NOPE"] and "NOPE" in result["errors"]
    held = line(db, key, AFTER_SESSION)
    assert held["price"] == 12.0 and held["price_source"] == "manual" and held["value_egp"] == 120.0
    # Tried once for this session, not on every 5-minute sync.
    again = Client({})
    sync_market(db, again, at=LATER)
    assert again.stocks == []
    # The next due session gets one more try.
    retry = Client({})
    sync_market(db, retry, at=NEXT_DAY)
    assert retry.stocks == ["NOPE"]
    assert line(db, key, NEXT_DAY)["price"] == 12.0


def test_other_custom_lines_cost_no_calls(db):
    add_custom(db, "بدون رمز", None, price=5.0)
    add_custom(db, "رمز بنقطة", "ABC.XY", price=5.0)
    add_custom(db, "رمز عربي", "سهم", price=5.0)
    add_custom(db, "صندوق", "SWDY", kind="fund")
    assert held_stocks(db) == []
    client = Client({})
    sync_market(db, client, at=AFTER_SESSION)
    assert client.stocks == []


def test_a_builtin_and_a_custom_line_with_one_ticker_cost_one_call(db):
    portfolio.add_holding(db, "COMI", buy_price=40, quantity=1)
    add_custom(db, "سي آي بي تانية", "COMI")
    assert held_stocks(db) == ["COMI"]
    client = Client({"COMI": 80.0})
    sync_market(db, client, at=AFTER_SESSION)
    assert client.stocks == ["COMI"]
