"""«السجل»: the EGP total in US dollars at the current USD rate, null when either is unknown."""

from datetime import datetime

import pytest

from egx_mcp.market.calendar import CAIRO
from egx_mcp.store import portfolio
from egx_mcp.store.db import connect

AT = datetime(2026, 10, 15, 8, 0, tzinfo=CAIRO)


@pytest.fixture
def conn(tmp_path):
    connection = connect(tmp_path / "egx.sqlite")
    yield connection
    connection.close()


def test_total_in_dollars_is_the_egp_total_over_the_usd_rate(conn):
    portfolio.add_holding(conn, "USD", buy_price=30, quantity=1000, buy_date="2023-03-01")
    portfolio.set_price(conn, "USD", 50, day="2026-10-15")
    totals = portfolio.portfolio_summary(conn, at=AT)["totals"]
    assert totals["value"] == pytest.approx(50000)
    assert totals["value_usd"] == pytest.approx(1000)
    assert totals["usd_rate"] == pytest.approx(50) and totals["usd_rate_as_of"] == "2026-10-15"


def test_mixed_assets_use_the_same_rate(conn):
    portfolio.add_holding(conn, "EGP", buy_price=1, quantity=25000)
    portfolio.add_holding(conn, "USD", buy_price=30, quantity=500, buy_date="2023-03-01")
    portfolio.set_price(conn, "USD", 50, day="2026-10-15")
    totals = portfolio.portfolio_summary(conn, at=AT)["totals"]
    assert totals["value"] == pytest.approx(50000) and totals["value_usd"] == pytest.approx(1000)


def test_null_when_the_usd_rate_is_unknown(conn):
    portfolio.add_holding(conn, "EGP", buy_price=1, quantity=25000)
    totals = portfolio.portfolio_summary(conn, at=AT)["totals"]
    assert totals["value"] == pytest.approx(25000)
    assert totals["value_usd"] is None and totals["usd_rate"] is None and totals["usd_rate_as_of"] is None


def test_null_when_the_ledger_is_empty(conn):
    portfolio.set_price(conn, "USD", 50, day="2026-10-15")
    totals = portfolio.portfolio_summary(conn, at=AT)["totals"]
    assert totals["value"] is None and totals["value_usd"] is None
