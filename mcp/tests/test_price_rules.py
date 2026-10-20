"""v2 audit fixes on the price path: 0 closes, one "current price" rule, the delayed quote's
base, one fetch attempt per symbol per day, the sync clock and runs that always close."""

from datetime import date, datetime, timedelta

import pytest

from egx_mcp.market import store
from egx_mcp.market.calendar import CAIRO
from egx_mcp.market.eodhd import EodhdClient, MarketDataError, _key_from_file
from egx_mcp.market.summary import market_digest, market_summary, price_state
from egx_mcp.market.sync import sync_market
from egx_mcp.store import portfolio, valuations
from egx_mcp.store.db import connect

MORNING = datetime(2026, 10, 15, 8, 0, tzinfo=CAIRO)        # Thursday, before the session
IN_SESSION = datetime(2026, 10, 15, 11, 0, tzinfo=CAIRO)
SOURCES = [{"item": "test", "value": "1", "source": "fixture", "as_of": "2026-01-01"}]
SANITY = {"overall": "pass", "checks": []}


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = tmp_path / "egx.sqlite"
    monkeypatch.setenv("EGX_DB_PATH", str(path))
    connection = connect(path)
    yield connection
    connection.close()


def bars(conn, symbol, closes, last_day=date(2026, 10, 14)):
    days, day = [], last_day
    while len(days) < len(closes):
        if day.weekday() in {6, 0, 1, 2, 3}:
            days.append(day)
        day -= timedelta(days=1)
    rows = [{"date": d.isoformat(), "open": c, "high": c, "low": c, "close": c, "adjusted_close": c,
             "volume": 1000.0} for d, c in zip(reversed(days), closes, strict=False)]
    store.upsert_bars(conn, symbol, rows, "EODHD")


def save(conn, symbol, fair, price):
    return valuations.save_full_valuation(
        conn, symbol, fair, fair * 0.76, fair * 1.25, "safe", "FY2025",
        [{"method": "dcf_fcff", "weight": 1.0, "bear": fair * 0.76, "base": fair, "bull": fair * 1.25}],
        {}, SOURCES, SANITY, "thesis", "checked", "", price, report="# r")["valuation_id"]


def quote(conn, symbol, price, at, previous_close=None):
    store.upsert_quote(conn, {"symbol": symbol, "price": price, "open": None, "high": None, "low": None,
                              "volume": None, "previous_close": previous_close, "change": None, "change_p": None,
                              "quote_time": int(at.timestamp())}, "EODHD")


# ── B1: a 0 close is never a price ─────────────────────────────────────────────

def test_eodhd_drops_zero_closes(monkeypatch):
    client = EodhdClient("k")
    monkeypatch.setattr(client, "_get", lambda *a, **k: [
        {"date": "2026-10-13", "close": 10.0}, {"date": "2026-10-14", "close": 0}, {"date": "2026-10-15", "close": "0.0"}])
    assert [r["date"] for r in client.daily_bars("COMI")] == ["2026-10-13"]


def test_stored_zero_close_does_not_break_the_screens(db):
    # A 0 bar saved before the filter existed: every screen keeps working on the last real close.
    bars(db, "COMI", [50.0, 52.0, 0.0])
    save(db, "COMI", 60.0, 52.0)
    portfolio.add_holding(db, "COMI", buy_price=40, quantity=10)
    row = next(r for r in market_summary(db, at=MORNING)["rows"] if r["symbol"] == "COMI")
    assert row["price"] == 52.0 and row["valuation"]["status"] == "at_or_below_fair_value"
    held = portfolio.portfolio_summary(db, at=MORNING)["groups"][0]["assets"][0]
    assert held["price"] == 52.0
    market_digest(db, at=MORNING)  # must not raise


def db_dir(conn):
    from pathlib import Path
    path = Path(conn.execute("PRAGMA database_list").fetchone()[2]).parent / "manual"
    path.mkdir(exist_ok=True)
    return path


# ── B4: one rule for the current price ────────────────────────────────────────

def test_portfolio_and_market_agree_on_yesterdays_quote(db):
    # Quote from Wednesday 13:00 is newer than the last stored bar (Tuesday), but it is not today's.
    bars(db, "COMI", [50.0, 51.0], last_day=date(2026, 10, 13))
    quote(db, "COMI", 53.0, datetime(2026, 10, 14, 13, 0, tzinfo=CAIRO))
    portfolio.add_holding(db, "COMI", buy_price=40, quantity=1)
    market_price = next(r for r in market_summary(db, at=MORNING)["rows"] if r["symbol"] == "COMI")["price"]
    held = portfolio.portfolio_summary(db, at=MORNING)["groups"][0]["assets"][0]
    assert market_price == held["price"] == 51.0
    assert held["stale"] is True  # the stale flag now applies to the price that is shown


# ── B7: the delayed quote's base is the previous session ─────────────────────

def test_delayed_quote_uses_its_own_previous_close_after_a_gap(db):
    bars(db, "COMI", [40.0, 41.0], last_day=date(2026, 10, 12))  # Monday; Tue+Wed missing
    quote(db, "COMI", 50.0, datetime(2026, 10, 15, 10, 45, tzinfo=CAIRO), previous_close=49.0)
    state = price_state(db, "COMI", IN_SESSION)
    assert state["price_kind"] == "delayed"
    assert state["previous_close"] == 49.0 and state["change"] == pytest.approx(1.0)


def test_delayed_quote_uses_yesterdays_bar_when_present(db):
    bars(db, "COMI", [40.0, 48.0], last_day=date(2026, 10, 14))
    quote(db, "COMI", 50.0, datetime(2026, 10, 15, 10, 45, tzinfo=CAIRO), previous_close=47.0)
    assert price_state(db, "COMI", IN_SESSION)["previous_close"] == 48.0


# ── B5, B6, B11: sync ─────────────────────────────────────────────────────────

class Client:
    def __init__(self, fail=(), empty=(), boom=None, limit=100_000):
        self.fail, self.empty, self.boom, self.limit = set(fail), set(empty), boom, limit
        self.calls_made, self.requests = 0, []

    def account(self):
        return {"plan": "paid", "used_today": 0, "daily_limit": self.limit}

    def daily_bars(self, symbol, date_from=None):
        self.calls_made += 1
        self.requests.append(symbol)
        if self.boom and symbol == self.boom:
            raise ValueError("unexpected payload")
        if symbol in self.fail:
            raise MarketDataError("HTTP 404")
        if symbol in self.empty:
            return []
        return [{"date": "2026-10-14", "open": 1.0, "high": 1.0, "low": 1.0, "close": 1.0,
                 "adjusted_close": 1.0, "volume": 1.0}]

    def quotes(self, symbols):
        self.calls_made += len(symbols)
        return []


def test_failed_and_empty_symbols_are_tried_once_a_day(db):
    sync_market(db, Client(fail={"COMI"}, empty={"EAST"}), at=MORNING)
    again = Client(fail={"COMI"}, empty={"EAST"})
    sync_market(db, again, at=MORNING + timedelta(minutes=5))
    assert "COMI" not in again.requests and "EAST" not in again.requests
    tomorrow = Client()
    sync_market(db, tomorrow, at=MORNING + timedelta(days=3))  # Sunday morning
    assert "COMI" in tomorrow.requests and "EAST" in tomorrow.requests


def test_quote_freshness_follows_the_sync_clock(db):
    class Quotes(Client):
        def __init__(self):
            super().__init__()
            self.batches = 0

        def quotes(self, symbols):
            self.batches += 1
            return []
    first = Quotes()
    sync_market(db, first, at=IN_SESSION)
    stamp = db.execute("SELECT MAX(quote_checked_at) FROM market_sync").fetchone()[0]
    assert stamp.startswith("2026-10-15T11:00")
    second = Quotes()
    sync_market(db, second, at=IN_SESSION + timedelta(minutes=2))
    assert second.batches == 0  # still fresh against the run's own clock
    third = Quotes()
    sync_market(db, third, at=IN_SESSION + timedelta(minutes=10))
    assert third.batches == 1


def test_an_unexpected_error_still_closes_the_run(db):
    with pytest.raises(ValueError):
        sync_market(db, Client(boom="COMI"), at=MORNING)
    run = store.last_sync_run(db)
    assert run["finished_at"] and run["error"].startswith("ValueError")


def test_damaged_docx_key_file_is_a_readable_error(tmp_path):
    bad = tmp_path / "egx-api.docx"
    bad.write_bytes(b"not a zip")
    with pytest.raises(MarketDataError, match="not a readable Word file"):
        _key_from_file(bad)


# ── B16: archive dates are Cairo days ─────────────────────────────────────────

def test_archive_date_filter_uses_cairo_days(db):
    vid = save(db, "COMI", 60.0, 52.0)
    # 00:30 Cairo on 15/10 is 21:30 UTC on 14/10.
    db.execute("UPDATE valuations SET created_at = '2026-10-14T21:30:00+00:00' WHERE id = ?", (vid,))
    db.commit()
    on_15 = valuations.list_valuations(db, date_from="2026-10-15", date_to="2026-10-15")
    on_14 = valuations.list_valuations(db, date_from="2026-10-14", date_to="2026-10-14")
    assert [v["id"] for v in on_15["items"]] == [vid] and on_14["items"] == []


# ── B15: one key for the missing auditor input ────────────────────────────────

def test_missing_auditor_input_uses_the_labelled_key():
    from egx_mcp.risk.rating import risk_rating
    assert "auditor_qualified_opinion" in risk_rating(is_bank=False)["missing"]


# ── B2: exchange holidays ─────────────────────────────────────────────────────

def test_holidays_are_not_trading_days(tmp_path, monkeypatch):
    from egx_mcp.market import calendar
    monkeypatch.setenv("EGX_DATA_DIR", str(tmp_path))
    (tmp_path / "manual").mkdir()
    (tmp_path / "manual" / "holidays.csv").write_text(
        "date,name,source\n2026-10-14,test holiday,fixture\n", encoding="utf-8")
    assert not calendar.is_trading_day(date(2026, 10, 14))
    # Thursday morning: Wednesday was a holiday, so Tuesday's bar is the latest expected one.
    assert calendar.expected_last_bar(MORNING) == date(2026, 10, 13)
    assert not calendar.session_open(datetime(2026, 10, 14, 11, 0, tzinfo=CAIRO))


def test_no_holidays_file_means_weekdays_only(tmp_path, monkeypatch):
    from egx_mcp.market import calendar
    monkeypatch.setenv("EGX_DATA_DIR", str(tmp_path))
    assert calendar.is_trading_day(date(2026, 10, 14))


def test_next_session_skips_holidays(tmp_path, monkeypatch):
    from egx_mcp.market import calendar
    monkeypatch.setenv("EGX_DATA_DIR", str(tmp_path))
    (tmp_path / "manual").mkdir()
    (tmp_path / "manual" / "holidays.csv").write_text("date,name,source\n2026-10-15,h,fixture\n", encoding="utf-8")
    assert calendar.next_session_day(datetime(2026, 10, 14, 15, 0, tzinfo=CAIRO)) == date(2026, 10, 18)
    assert calendar.next_session_day(datetime(2026, 10, 13, 9, 0, tzinfo=CAIRO)) == date(2026, 10, 13)
