"""Prices behind «السجل»: EGX closes and delayed quotes, the FOREX / crypto formulas (gold, bitcoin,
currencies through the dollar, the riyal and dirham pegs), past-day rates for purchase costs, and
the budget-aware sync that only fetches what the ledger holds."""

from datetime import date, datetime, timedelta

import pytest

from egx_mcp.market import store
from egx_mcp.market.calendar import CAIRO
from egx_mcp.market.eodhd import EodhdClient, MarketDataError, _key_from_file, ticker
from egx_mcp.market.prices import TROY_OUNCE_GRAMS, formula_price, price_state
from egx_mcp.market.sync import RESERVE_CALLS, ledger_feeds, sync_market
from egx_mcp.store import portfolio
from egx_mcp.store.db import connect

MORNING = datetime(2026, 10, 15, 8, 0, tzinfo=CAIRO)  # Thursday, before the session
IN_SESSION = datetime(2026, 10, 15, 11, 0, tzinfo=CAIRO)
MONDAY = datetime(2026, 10, 19, 17, 0, tzinfo=CAIRO)


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("EGX_DATA_DIR", str(tmp_path))
    connection = connect(tmp_path / "egx.sqlite")
    yield connection
    connection.close()


def put(conn, symbol, closes, last_day=date(2026, 10, 14), every_day=False):
    """Bars ending on last_day: EGX trading days, or every day for a FOREX / crypto feed."""
    days, day = [], last_day
    while len(days) < len(closes):
        if every_day or day.weekday() in {6, 0, 1, 2, 3}:
            days.append(day)
        day -= timedelta(days=1)
    store.upsert_bars(conn, symbol, [{"date": d.isoformat(), "open": c, "high": c, "low": c, "close": c,
                                      "adjusted_close": c, "volume": 1.0}
                                     for d, c in zip(reversed(days), closes, strict=True)], "EODHD")


def quote(conn, symbol, price, at, previous_close=None):
    store.upsert_quote(conn, {"symbol": symbol, "price": price, "open": None, "high": None, "low": None,
                              "volume": None, "previous_close": previous_close, "change": None, "change_p": None,
                              "quote_time": int(at.timestamp())}, "EODHD")


def asset(conn, key, at):
    return next(a for g in portfolio.portfolio_summary(conn, at)["groups"] for a in g["assets"] if a["key"] == key)


# ── EGX closes ───────────────────────────────────────────────────────────────

def test_eodhd_drops_zero_closes_and_builds_tickers(monkeypatch):
    client = EodhdClient("k")
    monkeypatch.setattr(client, "_get", lambda *a, **k: [
        {"date": "2026-10-13", "close": 10.0}, {"date": "2026-10-14", "close": 0}, {"date": "2026-10-15", "close": "0.0"}])
    assert [r["date"] for r in client.daily_bars("COMI")] == ["2026-10-13"]
    assert ticker("comi") == "COMI.EGX" and ticker("USDEGP.FOREX") == "USDEGP.FOREX"


def test_a_stored_zero_close_is_skipped_and_an_old_close_is_still_a_price(db):
    put(db, "COMI", [50.0, 52.0, 0.0])
    put(db, "ADIB", [40.0, 44.0], last_day=date(2026, 9, 1))  # weeks old: stale, but still the price
    portfolio.add_holding(db, "COMI", buy_price=40, quantity=10)
    portfolio.add_holding(db, "ADIB", buy_price=40, quantity=10)
    assert asset(db, "COMI", MORNING)["price"] == 52.0
    adib = asset(db, "ADIB", MORNING)
    assert adib["value_egp"] == 440 and adib["stale"] is True and adib["today_change"] is None


def test_delayed_quote_rules(db):
    put(db, "COMI", [40.0, 41.0], last_day=date(2026, 10, 12))  # Tue+Wed missing
    quote(db, "COMI", 50.0, datetime(2026, 10, 15, 10, 45, tzinfo=CAIRO), previous_close=49.0)
    state = price_state(db, "COMI", IN_SESSION)
    assert state["price_kind"] == "delayed" and state["previous_close"] == 49.0
    put(db, "EAST", [40.0, 48.0])
    quote(db, "EAST", 50.0, datetime(2026, 10, 15, 10, 45, tzinfo=CAIRO), previous_close=47.0)
    assert price_state(db, "EAST", IN_SESSION)["previous_close"] == 48.0
    # Yesterday's quote is not today's price: the last close is, and it is stale.
    quote(db, "EAST", 53.0, datetime(2026, 10, 14, 13, 0, tzinfo=CAIRO))
    put(db, "EAST", [50.0, 51.0], last_day=date(2026, 10, 13))
    db.execute("DELETE FROM daily_bars WHERE symbol = 'EAST' AND date = '2026-10-14'")
    state = price_state(db, "EAST", MORNING)
    assert state["price"] == 51.0 and state["stale"] is True


# ── feed formulas ────────────────────────────────────────────────────────────

def test_gold_bitcoin_and_currencies_from_feeds(db):
    put(db, "USDEGP.FOREX", [50.0, 52.0], every_day=True)
    put(db, "XAUUSD.FOREX", [4000.0, 4100.0], every_day=True)
    put(db, "BTC-USD.CC", [80000.0, 82000.0], every_day=True)
    put(db, "EURUSD.FOREX", [1.10, 1.15], every_day=True)
    gram = formula_price(db, "XAU-G", MORNING)
    assert gram["price"] == pytest.approx(4100 * 52 / TROY_OUNCE_GRAMS) and gram["currency"] == "EGP"
    assert gram["change"] == pytest.approx((4100 * 52 - 4000 * 50) / TROY_OUNCE_GRAMS)
    assert formula_price(db, "XAU-OZ", MORNING)["price"] == pytest.approx(4100 * 52)
    # Each karat is its pure share of the gram; the gold pound is 8 g of 21 karat.
    for key, factor in (("XAU-G22", 22 / 24), ("XAU-G21", 21 / 24), ("XAU-G18", 18 / 24), ("XAU-G14", 14 / 24),
                        ("XAU-COIN", 8 * 21 / 24)):
        assert formula_price(db, key, MORNING)["price"] == pytest.approx(gram["price"] * factor)
    assert formula_price(db, "EUR", MORNING)["price"] == pytest.approx(1.15 * 52)
    assert formula_price(db, "SAR", MORNING)["price"] == pytest.approx(52 / 3.75)
    assert formula_price(db, "AED", MORNING)["price"] == pytest.approx(52 / 3.6725)
    assert formula_price(db, "GBP", MORNING) is None  # no GBPUSD bars yet

    portfolio.add_holding(db, "BTC", buy_price=60000, quantity=0.01, cost_egp=30000)
    btc = asset(db, "BTC", MORNING)
    assert btc["price"] == 82000 and btc["price_currency"] == "USD"
    assert btc["value_egp"] == pytest.approx(0.01 * 82000 * 52) and btc["today_change"] is not None


def test_a_stale_feed_does_not_count_as_todays_move(db):
    put(db, "USDEGP.FOREX", [50.0, 52.0], last_day=date(2026, 10, 1), every_day=True)
    usd = formula_price(db, "USD", MORNING)
    assert usd["price"] == 52.0 and usd["stale"] is True and usd["change"] is None


def test_a_purchase_cost_uses_the_rate_of_its_day(db):
    put(db, "USDEGP.FOREX", [47.0, 47.5, 48.0], last_day=date(2026, 9, 12), every_day=True)
    lot = portfolio.add_holding(db, "BTC", buy_price=60000, quantity=0.01, buy_date="2026-09-11")
    assert lot["fx_egp"] == 47.5
    with pytest.raises(Exception, match="بالجنيه"):  # a year before any stored rate
        portfolio.add_holding(db, "BTC", buy_price=20000, quantity=0.01, buy_date="2024-01-01")
    assert portfolio.fx_rate(db, "USD", "2026-09-30")["rate"] is None  # beyond the week's tolerance


def test_manual_rate_newer_than_the_market_wins(db):
    put(db, "USDEGP.FOREX", [48.0], last_day=date(2026, 10, 10), every_day=True)
    portfolio.set_price(db, "USD", 49.0, day="2026-10-12")
    assert portfolio.fx_rate(db, "USD", "2026-10-13")["rate"] == 49.0
    assert asset_rate(db) == 49.0


def asset_rate(db):
    portfolio.add_holding(db, "USD", buy_price=30, quantity=1)
    return asset(db, "USD", MORNING)["price"]


# ── sync ─────────────────────────────────────────────────────────────────────

class Client:
    def __init__(self, limit=20, used=0, counted_on=None, fail=(), refuse_after=None, boom=None):
        self.limit, self.used, self.counted_on = limit, used, counted_on
        self.fail, self.refuse_after, self.boom = set(fail), refuse_after, boom
        self.calls_made, self.requests = 0, []

    def account(self):
        return {"plan": "free", "used_today": self.used, "counted_on": self.counted_on, "daily_limit": self.limit}

    def daily_bars(self, symbol, date_from=None):
        self.calls_made += 1
        self.requests.append((symbol, date_from))
        if self.boom == symbol:
            raise ValueError("unexpected payload")
        if self.refuse_after is not None and len(self.requests) > self.refuse_after:
            raise MarketDataError("HTTP 402: limit", 402)
        if symbol in self.fail:
            raise MarketDataError("HTTP 404")
        return [{"date": "2026-10-14", "open": 1.0, "high": 1.0, "low": 1.0, "close": 2.0, "adjusted_close": 2.0,
                 "volume": 1.0}]


def test_sync_fetches_held_stocks_and_the_feeds_they_need_only(db):
    assert ledger_feeds(db) == []
    portfolio.add_holding(db, "COMI", buy_price=40, quantity=1)
    portfolio.add_holding(db, "XAU-G", buy_price=4000, quantity=1)
    portfolio.add_holding(db, "BTC", buy_price=60000, quantity=0.01, cost_egp=30000)
    client = Client()
    sync_market(db, client, at=MORNING)
    # Feeds first, so many stocks can never starve the dollar or gold.
    assert [s for s, _ in client.requests] == ["USDEGP.FOREX", "XAUUSD.FOREX", "BTC-USD.CC", "COMI"]
    # Same day: nothing again. Next day: the feeds come back from their last stored day.
    again = Client()
    sync_market(db, again, at=MORNING + timedelta(minutes=5))
    assert again.requests == []
    tomorrow = Client()
    sync_market(db, tomorrow, at=MORNING + timedelta(days=1))
    assert ("USDEGP.FOREX", "2026-10-14") in tomorrow.requests
    assert ("COMI", "2026-10-15") in tomorrow.requests  # Thursday's close, due by Friday morning


def test_failures_are_tried_once_a_day_and_errors_close_the_run(db):
    portfolio.add_holding(db, "COMI", buy_price=40, quantity=1)
    result = sync_market(db, Client(fail={"COMI"}), at=MORNING)
    assert "COMI" in result["errors"]
    again = Client(fail={"COMI"})
    sync_market(db, again, at=MORNING + timedelta(minutes=5))
    assert again.requests == []
    portfolio.add_holding(db, "EAST", buy_price=40, quantity=1)
    with pytest.raises(ValueError):
        sync_market(db, Client(boom="EAST"), at=MORNING + timedelta(minutes=10))
    run = store.last_sync_run(db)
    assert run["finished_at"] and run["error"].startswith("ValueError")


def test_budget_from_an_earlier_gmt_day_is_fresh_and_a_refusal_stops_the_run(db):
    for symbol in ("COMI", "EAST", "ADIB", "ETEL"):
        portfolio.add_holding(db, symbol, buy_price=40, quantity=1)
    client = Client(limit=20, used=20, counted_on="2026-10-15")
    sync_market(db, client, at=MONDAY)  # the 2026-10-15..19 freeze: an old count is not today's
    assert client.calls_made == 5
    portfolio.add_holding(db, "FWRY", buy_price=40, quantity=1)
    tight = Client(limit=3 + RESERVE_CALLS, used=0, counted_on="2026-10-20")
    result = sync_market(db, tight, at=MONDAY + timedelta(days=1))
    assert tight.calls_made == 3 and len(result["skipped_for_budget"]) == 3
    refusing = Client(refuse_after=1)
    result = sync_market(db, refusing, at=MONDAY + timedelta(days=2))
    assert len(refusing.requests) == 2 and "limit_refused" in result
    refused = refusing.requests[1][0]
    assert store.sync_state(db, refused)["bars_checked_on"] != "2026-10-21"  # not marked: retried later


def test_the_days_total_is_recorded_once_per_day(db):
    put(db, "COMI", [100.0, 110.0])
    portfolio.add_holding(db, "COMI", buy_price=100, quantity=2)
    portfolio.record_snapshot(db, MORNING)
    portfolio.record_snapshot(db, MORNING + timedelta(hours=2))
    rows = db.execute("SELECT date, value_egp, cost_egp FROM ledger_snapshots").fetchall()
    assert [tuple(r) for r in rows] == [("2026-10-15", 220.0, 200.0)]


# ── key file and calendar ────────────────────────────────────────────────────

def test_key_file_reading(tmp_path):
    plain = tmp_path / "key.txt"
    plain.write_text("my key: 0123456789abcd.12345678\n", encoding="utf-8")
    assert _key_from_file(plain) == "0123456789abcd.12345678"
    two = tmp_path / "two.txt"
    two.write_text("0123456789abcd.12345678 and fedcba9876543210.87654321", encoding="utf-8")
    with pytest.raises(MarketDataError):
        _key_from_file(two)
    bad = tmp_path / "egx-api.docx"
    bad.write_bytes(b"not a zip")
    with pytest.raises(MarketDataError, match="not a readable Word file"):
        _key_from_file(bad)


def test_holidays_are_not_trading_days(tmp_path, monkeypatch):
    from egx_mcp.market import calendar
    monkeypatch.setenv("EGX_DATA_DIR", str(tmp_path))
    (tmp_path / "manual").mkdir()
    (tmp_path / "manual" / "holidays.csv").write_text(
        "date,name,source\n2026-10-14,test holiday,fixture\n", encoding="utf-8")
    assert not calendar.is_trading_day(date(2026, 10, 14))
    assert calendar.expected_last_bar(MORNING) == date(2026, 10, 13)
    assert calendar.next_session_day(datetime(2026, 10, 13, 15, 0, tzinfo=CAIRO)) == date(2026, 10, 15)


def test_a_morning_check_does_not_hold_back_the_close_due_at_four(db):
    put(db, "COMI", [120.0], last_day=date(2026, 10, 12))
    portfolio.add_holding(db, "COMI", buy_price=100, quantity=1)
    morning = Client()
    sync_market(db, morning, at=datetime(2026, 10, 15, 11, 0, tzinfo=CAIRO))  # due: Wednesday
    assert ("COMI", "2026-10-13") in morning.requests
    evening = Client()
    sync_market(db, evening, at=datetime(2026, 10, 15, 16, 30, tzinfo=CAIRO))  # due: Thursday
    assert "COMI" in [s for s, _ in evening.requests]
    again = Client()
    sync_market(db, again, at=datetime(2026, 10, 15, 16, 35, tzinfo=CAIRO))
    assert "COMI" not in [s for s, _ in again.requests]


def test_todays_move_includes_the_dollars_own_move(db):
    put(db, "USDEGP.FOREX", [50.0, 51.0], every_day=True)
    put(db, "BTC-USD.CC", [60000.0, 66000.0], every_day=True)
    portfolio.add_holding(db, "BTC", buy_price=60000, quantity=1, cost_egp=3_000_000)
    totals = portfolio.portfolio_summary(db, MORNING)["totals"]
    assert totals["today_change"] == pytest.approx(66000 * 51 - 60000 * 50)
    assert totals["today_change_pct"] == pytest.approx((66000 * 51) / (60000 * 50) - 1)


# ── S&P 500 funds listed in New York ─────────────────────────────────────────

def us_bars(conn, ticker, closes, last_day):
    """Weekday bars (New York trades Monday to Friday) ending on last_day."""
    days, day = [], last_day
    while len(days) < len(closes):
        if day.weekday() < 5:
            days.append(day)
        day -= timedelta(days=1)
    store.upsert_bars(conn, ticker, [{"date": d.isoformat(), "open": c, "high": c, "low": c, "close": c,
                                      "adjusted_close": c, "volume": 1.0}
                                     for d, c in zip(reversed(days), closes, strict=True)], "EODHD")


def test_a_us_fund_is_its_close_in_dollars_and_a_weekend_is_not_stale(db):
    from egx_mcp.catalog import search
    assert [e["key"] for e in search(db, "s&p 500")[:3]] == ["SPY.US", "IVV.US", "VOO.US"]
    assert search(db, "SPY")[0]["key"] == "SPY.US" and search(db, "اس اند بي")[0]["currency"] == "USD"
    us_bars(db, "SPY.US", [690.0, 700.0], last_day=date(2026, 10, 16))  # Thursday, Friday
    put(db, "USDEGP.FOREX", [50.0, 52.0], last_day=date(2026, 10, 18), every_day=True)
    monday = datetime(2026, 10, 19, 9, 0, tzinfo=CAIRO)
    price = formula_price(db, "SPY.US", monday)
    assert price["price"] == 700.0 and price["currency"] == "USD" and price["stale"] is False
    assert price["change"] == pytest.approx(10.0)
    assert formula_price(db, "SPY.US", datetime(2026, 10, 21, 9, 0, tzinfo=CAIRO))["stale"] is True  # Tuesday's missing
    portfolio.add_holding(db, "SPY.US", buy_price=690, quantity=2, cost_egp=69000)
    spy = asset(db, "SPY.US", monday)
    assert spy["group"] == "funds" and spy["value_egp"] == pytest.approx(2 * 700 * 52)
    assert ledger_feeds(db) == ["USDEGP.FOREX", "SPY.US"]
