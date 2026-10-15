"""Data behind the «قيمة» screens: margin to fair, stale-aware breadth, today's portfolio move,
valuation steps by date, the per-holding fields and the since-last-close digest."""

from datetime import date, datetime, timedelta

import pytest

from egx_mcp.data.cached import CachedMarketProvider
from egx_mcp.data.manual import ManualProvider
from egx_mcp.market import store
from egx_mcp.market.calendar import CAIRO
from egx_mcp.market.summary import market_digest, market_summary, portfolio_today
from egx_mcp.pricing import pricing_levels
from egx_mcp.store import portfolio, valuations
from egx_mcp.store.db import connect

# Thursday 2026-10-15 before the session: Wednesday 14/10 is the latest expected bar.
MORNING = datetime(2026, 10, 15, 8, 0, tzinfo=CAIRO)
SOURCES = [{"item": "test", "value": "1", "source": "fixture", "as_of": "2026-01-01"}]
SANITY = {"overall": "pass", "checks": []}


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = tmp_path / "egx.sqlite"
    monkeypatch.setenv("EGX_DB_PATH", str(path))
    connection = connect(path)
    yield connection
    connection.close()


@pytest.fixture
def provider(tmp_path):
    root = tmp_path / "manual"
    root.mkdir()
    return CachedMarketProvider(ManualProvider(root))


def bars(conn, symbol, closes, last_day=date(2026, 10, 14)):
    """Daily bars ending on last_day (trading days only) with the given closes, oldest first."""
    days, day = [], last_day
    while len(days) < len(closes):
        if day.weekday() in {6, 0, 1, 2, 3}:
            days.append(day)
        day -= timedelta(days=1)
    rows = [{"date": d.isoformat(), "open": c, "high": c + 1, "low": c - 1, "close": c, "adjusted_close": c,
             "volume": 1000.0} for d, c in zip(reversed(days), closes)]
    store.upsert_bars(conn, symbol, rows, "EODHD")


def save(conn, symbol, fair, price, created_at, reason="", critic="checked"):
    saved = valuations.save_full_valuation(
        conn, symbol, fair, fair * 0.76, fair * 1.25, "safe", "FY2025",
        [{"method": "dcf_fcff", "weight": 1.0, "bear": fair * 0.76, "base": fair, "bull": fair * 1.25}],
        {}, SOURCES, SANITY, "thesis", critic, reason, price, report="# r")
    conn.execute("UPDATE valuations SET created_at = ? WHERE id = ?", (created_at, saved["valuation_id"]))
    conn.execute("UPDATE change_log SET created_at = ? WHERE valuation_id = ?", (created_at, saved["valuation_id"]))
    conn.commit()
    return saved["valuation_id"]


def row(summary, symbol):
    return next(r for r in summary["rows"] if r["symbol"] == symbol)


def test_margin_is_against_fair_and_status_boundaries():
    comi = pricing_levels(131.0, 122.0)
    assert round(comi["margin_to_fair"], 3) == 0.069  # not +7.4% (that was price-based)
    assert comi["status"] == "at_or_below_fair_value" and comi["below_protection_by"] is None
    assert pricing_levels(131.0, 131.0)["status"] == "above_fair_value"
    assert pricing_levels(131.0, 104.80)["status"] == "at_or_below_fair_value"
    east = pricing_levels(36.0, 27.77)
    assert east["status"] == "below_protection"
    assert round(east["below_protection_by"], 3) == 0.036


def test_breadth_excludes_stale_and_counts_stale_and_missing(db):
    bars(db, "COMI", [100, 101, 102])                       # fresh, up
    bars(db, "TMGH", [90, 89])                               # fresh, down
    bars(db, "ADIB", [40, 44], last_day=date(2026, 10, 12))  # stale: last close 12/10
    summary = market_summary(db, at=MORNING)
    assert summary["breadth"] == {"up": 1, "down": 1, "flat": 0, "stale": 1, "no_data": 28}
    adib = row(summary, "ADIB")
    assert adib["stale"] is True and adib["change_pct"] > 0  # the move is shown, but not counted today
    assert row(summary, "COMI")["name_ar"] == "البنك التجاري الدولي"


def test_valuation_block_and_steps_by_date(db):
    bars(db, "COMI", [121, 122])
    save(db, "COMI", 118.0, 136.6, "2026-07-20T09:00:00+00:00")
    save(db, "COMI", 131.0, 122.0, "2026-10-14T22:30:00+00:00", reason="rates")  # 15/10 in Cairo
    comi = row(market_summary(db, at=MORNING), "COMI")
    v = comi["valuation"]
    assert v["fair_value"] == 131.0 and round(v["margin_to_fair"], 3) == 0.069
    assert v["below_protection_by"] is None and v["valuation_date"] == "2026-10-15"
    steps = comi["valuation_history"]
    assert [s["date"] for s in steps] == ["2026-07-20", "2026-10-15"]
    assert [s["fair_value"] for s in steps] == [118.0, 131.0]
    assert steps[1]["protection_price"] == pytest.approx(104.8)


def test_portfolio_today_rules():
    fresh_up = {"price": 122.0, "change": 1.0, "stale": False}
    fresh_down = {"price": 27.77, "change": -0.5, "stale": False}
    stale = {"price": 46.0, "change": 2.0, "stale": True}
    assert portfolio_today([])["has_fresh"] is False
    only_stale = portfolio_today([(10, stale)])
    assert only_stale["has_fresh"] is False and only_stale["change"] is None
    up = portfolio_today([(50, fresh_up), (10, stale)])
    assert up["change"] == 50.0 and up["change_pct"] == pytest.approx(50 / (6100 - 50))
    down = portfolio_today([(50, fresh_up), (200, fresh_down)])
    assert down["change"] == pytest.approx(-50.0)


def test_market_summary_portfolio_today(db):
    bars(db, "COMI", [121, 122])
    bars(db, "ADIB", [40, 44], last_day=date(2026, 10, 12))
    assert market_summary(db, at=MORNING)["portfolio_today"]["holdings"] == 0
    portfolio.add_holding(db, "ADIB", buy_price=40, quantity=10)
    stale_only = market_summary(db, at=MORNING)["portfolio_today"]
    assert stale_only["has_fresh"] is False
    portfolio.add_holding(db, "COMI", buy_price=100, quantity=50)
    today = market_summary(db, at=MORNING)["portfolio_today"]
    assert today["has_fresh"] and today["change"] == 50.0 and today["as_of"] == "2026-10-14"


def test_portfolio_summary_today_share_margin_and_order(db, provider):
    bars(db, "COMI", [121, 122])
    bars(db, "EAST", [27.59, 27.77])
    bars(db, "ADIB", [40, 44], last_day=date(2026, 10, 12))
    save(db, "COMI", 131.0, 122.0, "2026-10-14T07:00:00+00:00")
    save(db, "EAST", 36.0, 27.77, "2026-10-14T07:00:00+00:00", critic="below protection: two possibilities")
    portfolio.add_holding(db, "EAST", buy_price=31.0, quantity=200)
    portfolio.add_holding(db, "COMI", buy_price=100.0, quantity=50)
    portfolio.add_holding(db, "ADIB", buy_price=40.0, quantity=10)
    portfolio.add_holding(db, "TMGH", buy_price=80.0, quantity=5)  # no price at all
    summary = portfolio.portfolio_summary(db, provider, at=MORNING)
    order = [r["symbol"] for r in summary["holdings"]]
    assert order == ["COMI", "ADIB", "EAST", "TMGH"]  # P/L contribution, unpriced last
    comi, adib, east = summary["holdings"][0], summary["holdings"][1], summary["holdings"][2]
    assert comi["today_change"] == pytest.approx(50.0) and comi["name_ar"] == "البنك التجاري الدولي"
    assert adib["today_change"] is None and adib["price_stale"] is True
    assert round(comi["margin_to_fair"], 3) == 0.069 and comi["status"] == "at_or_below_fair_value"
    assert east["status"] == "below_protection" and round(east["below_protection_by"], 3) == 0.036
    total_value = 50 * 122 + 200 * 27.77 + 10 * 44
    assert comi["share_of_portfolio"] == pytest.approx(6100 / total_value)
    totals = summary["totals"]
    assert totals["today_change"] == pytest.approx(50 + 200 * 0.18)  # ADIB is stale, TMGH unpriced
    assert totals["today_has_fresh"] is True and totals["below_protection"] == ["EAST"]
    assert totals["unpriced_holdings"] == ["TMGH"]


def test_digest_status_change_new_valuation_and_holding_move(db):
    # EAST closed 29.00 on 13/10 (above protection 28.80) and 27.77 on 14/10 (under it).
    bars(db, "EAST", [29.0, 27.77])
    bars(db, "COMI", [121.0, 122.0])
    save(db, "EAST", 36.0, 30.0, "2026-09-01T07:00:00+00:00")
    save(db, "COMI", 118.0, 136.6, "2026-07-20T09:00:00+00:00")
    new_id = save(db, "COMI", 131.0, 122.0, "2026-10-14T13:00:00+00:00", reason="rates")  # after 13/10 close
    portfolio.add_holding(db, "COMI", buy_price=100, quantity=50)
    portfolio.add_holding(db, "EAST", buy_price=31, quantity=200)
    digest = market_digest(db, at=MORNING)
    kinds = [i["kind"] for i in digest["items"]]
    assert kinds == ["status", "valuation", "holding_move"]
    status, valuation, move = digest["items"]
    assert status["symbol"] == "EAST" and status["from"] == "at_or_below_fair_value" and status["to"] == "below_protection"
    assert valuation["valuation_id"] == new_id and valuation["previous_fair_value"] == 118.0
    assert valuation["change_pct"] == pytest.approx(131 / 118 - 1)
    assert move["symbol"] == "EAST"  # −4.2% beats COMI's +0.8%
    assert digest["last_close"] == "2026-10-14" and digest["since"].startswith("2026-10-13T14:30")


def test_digest_is_empty_without_news_and_capped_at_three(db):
    assert market_digest(db, at=MORNING)["items"] == []
    for symbol in ("COMI", "TMGH", "EAST", "ETEL"):
        save(db, symbol, 50.0, None, "2026-10-14T13:00:00+00:00")
    assert len(market_digest(db, at=MORNING)["items"]) == 3


def test_pinned_clock_for_demos(monkeypatch):
    from egx_mcp.market.calendar import now_cairo
    monkeypatch.setenv("EGX_NOW", "2026-10-15T09:02")
    assert now_cairo() == datetime(2026, 10, 15, 9, 2, tzinfo=CAIRO)
