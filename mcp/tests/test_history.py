"""«تطوّر ثروتي» worked out from the ledger: each day's total at that day's prices, the money that came
in kept apart from the market's move, and the periods in EGP, dollars, gold and against inflation."""

from datetime import datetime

import pytest

from egx_mcp import cli
from egx_mcp.market.calendar import CAIRO
from egx_mcp.store import portfolio, wealth
from egx_mcp.store.db import connect

AT = datetime(2026, 10, 15, 20, 0, tzinfo=CAIRO)


@pytest.fixture
def conn(tmp_path, monkeypatch):
    monkeypatch.setenv("EGX_DATA_DIR", str(tmp_path))
    (tmp_path / "manual").mkdir()
    connection = connect(tmp_path / "egx.sqlite")
    yield connection
    connection.close()


def point(points, day):
    return next(p for p in points if p["date"] == day)


def test_no_purchases_is_an_empty_history(conn):
    assert wealth.wealth_history(conn, 365, at=AT) == {
        "points": [], "first": None, "last": None, "change": None, "change_pct": None, "inflow": None, "periods": []}


def test_each_day_is_valued_at_that_days_price_and_at_cost_before_any(conn):
    portfolio.add_holding(conn, "USD", buy_price=48, quantity=100, buy_date="2026-10-01")
    portfolio.set_price(conn, "USD", 49, day="2026-10-05")
    portfolio.set_price(conn, "USD", 51, day="2026-10-10")
    points = wealth.series(conn, AT)
    assert points[0]["date"] == "2026-10-01" and points[-1]["date"] == "2026-10-15" and len(points) == 15
    assert point(points, "2026-10-03")["value_egp"] == pytest.approx(4800)  # no price yet: at cost
    assert point(points, "2026-10-07")["value_egp"] == pytest.approx(4900)
    assert point(points, "2026-10-12")["value_egp"] == pytest.approx(5100)
    assert point(points, "2026-10-12")["usd_rate"] == 51
    assert points[-1]["value_egp"] == portfolio.portfolio_summary(conn, AT)["totals"]["value"]


def test_new_money_is_not_growth(conn):
    portfolio.add_holding(conn, "EGP", buy_price=1, amount=10000, buy_date="2026-09-01")
    portfolio.add_holding(conn, "EGP", buy_price=1, amount=5000, buy_date="2026-10-01")
    portfolio.add_movement(conn, "expense", "EGP", 3000, date="2026-10-10")
    result = wealth.wealth_history(conn, 365, at=AT)
    assert result["change"] == pytest.approx(2000)
    assert result["inflow"] == pytest.approx(2000) and result["change_pct"] == pytest.approx(0)
    assert point(result["points"], "2026-10-05")["value_egp"] == pytest.approx(15000)


def test_a_period_in_pounds_dollars_and_against_inflation(conn, tmp_path):
    portfolio.set_price(conn, "USD", 50, day="2026-07-01")
    portfolio.set_price(conn, "USD", 55, day="2026-09-15")
    portfolio.add_holding(conn, "EGP", buy_price=1, amount=10000, buy_date="2026-07-01")
    (tmp_path / "manual" / "inflation.csv").write_text(
        "month,monthly_pct,source\n2026-08,0.1,CBE\n2026-09,1.3,CBE\n2026-10,1.0,CBE\n", encoding="utf-8")
    by = {p["period"]: p for p in wealth.wealth_history(conn, 365, at=AT)["periods"]}
    assert set(by) == {"month", "quarter", "all"}  # no year of history yet
    quarter = by["quarter"]
    assert quarter["egp"]["pct"] == pytest.approx(0)
    assert quarter["usd"]["pct"] == pytest.approx(50 / 55 - 1)  # the same pounds bought fewer dollars
    assert quarter["inflation_pct"] == pytest.approx(1.001 * 1.013 * 1.01 - 1)
    assert quarter["real_pct"] == pytest.approx(1 / (1.001 * 1.013 * 1.01) - 1)
    assert by["all"]["inflation_pct"] == pytest.approx(quarter["inflation_pct"])  # July's change predates it
    assert quarter["gold_g"] is None  # no gold price stored
    (tmp_path / "manual" / "inflation.csv").write_text("month,monthly_pct,source\n2026-10,1.0,CBE\n", encoding="utf-8")
    by = {p["period"]: p for p in wealth.wealth_history(conn, 365, at=AT)["periods"]}
    assert by["quarter"]["inflation_pct"] is None and by["quarter"]["real_pct"] is None  # August is missing
    assert by["month"]["inflation_pct"] == pytest.approx(0.01)


def test_dietz_weighs_money_by_the_time_it_was_there(conn):
    portfolio.set_price(conn, "USD", 50, day="2026-09-15")
    portfolio.add_holding(conn, "USD", buy_price=50, quantity=100, buy_date="2026-09-15")
    portfolio.add_holding(conn, "USD", buy_price=50, quantity=100, buy_date="2026-09-30")  # halfway
    portfolio.set_price(conn, "USD", 55, day="2026-10-15")
    result = wealth.wealth_history(conn, 30, at=AT)
    assert result["inflow"] == pytest.approx(5000)
    assert result["change_pct"] == pytest.approx(1000 / (5000 + 5000 * 15 / 30))


def test_a_long_range_is_weekly_until_its_last_400_days(conn):
    portfolio.add_holding(conn, "EGP", buy_price=1, amount=100, buy_date="2024-01-01")
    points = wealth.series(conn, AT)
    assert points[1]["date"] == "2024-01-08" and points[-1]["date"] == "2026-10-15"
    dates = [p["date"] for p in points]
    assert dates[-401:][0] == "2025-09-10" and len(set(dates)) == len(dates)
    assert len(wealth.wealth_history(conn, 30, at=AT)["points"]) == 31  # every day of the month


def test_history_command_is_in_the_cli_and_the_mcp_tools(tmp_path, monkeypatch):
    from egx_mcp import commands
    monkeypatch.setenv("EGX_DB_PATH", str(tmp_path / "cli.sqlite"))
    monkeypatch.setenv("EGX_DATA_DIR", str(tmp_path))
    assert commands.wealth_history in commands.MCP_TOOLS
    assert cli.run("history", '{"days": 30}')["points"] == []
