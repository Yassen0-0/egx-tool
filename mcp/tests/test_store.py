import json

import pytest

from egx_mcp.data.manual import ManualProvider
from egx_mcp.data.metrics import derived_metrics
from egx_mcp.errors import ValuationInputError
from egx_mcp.risk.from_financials import quality_scores
from egx_mcp.store import portfolio, valuations, weekly
from egx_mcp.store.db import connect

PASSING_SANITY = {"overall": "pass", "checks": []}
SOURCES = [{"item": "test", "value": "1", "source": "fixture", "as_of": "2026-01-01"}]
METHODS = [{"method": "dcf_fcff", "weight": 1, "bear": 8, "base": 10, "bull": 12}]


@pytest.fixture
def conn(tmp_path):
    connection = connect(tmp_path / "egx.sqlite")
    yield connection
    connection.close()


@pytest.fixture
def provider(tmp_path):
    root = tmp_path / "manual"
    (root / "financials").mkdir(parents=True)
    (root / "prices.csv").write_text(
        "symbol,price,date,source\n"
        "EAST,9.0,2026-10-01,fixture\n"
        "EAST,7.5,2026-10-08,fixture\n"
        "COMI,50,2026-10-08,fixture\n",
        encoding="utf-8",
    )
    (root / "macro.json").write_text(json.dumps({
        "risk_free_rate_egp": {"value": 0.22, "as_of": "2026-10-08", "source": "fixture"},
        "usd_egp": {"value": 50.0, "as_of": "2026-10-08", "source": "fixture"},
    }), encoding="utf-8")
    (root / "events.csv").write_text(
        "symbol,date,type,description,source\n"
        "EAST,2026-10-05,earnings,Q3 results,fixture\n",
        encoding="utf-8",
    )
    year = {
        "net_income": 10, "cfo": 12, "total_assets": 110, "total_assets_begin": 100, "long_term_debt": 20,
        "current_assets": 50, "current_liabilities": 30, "shares_outstanding": 100, "revenue": 200,
        "gross_profit": 60, "retained_earnings": 30, "ebit": 15, "total_equity": 60, "total_liabilities": 50,
        "receivables": 20, "cogs": 140, "ppe_net": 40, "depreciation": 5, "sga": 20,
        "income_continuing_ops": 10, "total_debt": 25, "interest_expense": 3, "dividend_per_share": 0.5,
    }
    periods = [
        {"period": f"FY{y}", "period_end": f"{y}-12-31", "source": "fixture", "data": year}
        for y in range(2021, 2026)
    ]
    (root / "financials" / "EAST.json").write_text(
        json.dumps({"currency": "EGP", "unit": "EGP millions", "periods": periods}), encoding="utf-8"
    )
    return ManualProvider(root)


def _save(conn, fair_value=10.0, reason="", price=None, critic="checked assumptions", period="FY2025",
          macro=None):
    return valuations.save_full_valuation(
        conn, "EAST", fair_value, fair_value * 0.8, fair_value * 1.2, "balanced", period, METHODS,
        {"wacc": 0.25}, SOURCES, PASSING_SANITY, "thesis", critic, reason, price, macro,
        report=f"# EAST\nFair value {fair_value}",
    )


def test_save_and_change_log(conn):
    first = _save(conn, 10.0)
    assert first["change"] is None
    assert first["pricing"]["protection_price"] == pytest.approx(8.0)
    second = _save(conn, 12.0, reason="FY2025 results beat")
    assert second["change"]["change_pct"] == pytest.approx(0.2)
    history = valuations.valuation_history(conn, "EAST.CA")
    assert [c["reason"] for c in history["changes"]] == ["FY2025 results beat"]


def test_save_refuses_failed_sanity_missing_critic_and_missing_reason(conn):
    with pytest.raises(ValuationInputError):
        valuations.save_full_valuation(conn, "EAST", 10, 8, 12, "safe", "FY2025", METHODS, {}, SOURCES,
                                       {"overall": "fail"}, "t", "c", "", report="r")
    with pytest.raises(ValuationInputError):
        valuations.save_full_valuation(conn, "EAST", 10, 8, 12, "safe", "FY2025", METHODS, {}, SOURCES,
                                       PASSING_SANITY, "t", "c", "", report="  ")
    with pytest.raises(ValuationInputError):
        _save(conn, critic="  ")
    _save(conn, 10.0)
    with pytest.raises(ValuationInputError):
        _save(conn, 11.0, reason="")


def test_below_protection_requires_critic_to_address_it(conn):
    with pytest.raises(ValuationInputError):
        _save(conn, 10.0, price=7.0, critic="looks fine")
    saved = _save(conn, 10.0, price=7.0, critic="Below protection: market prices a contract loss the model ignores")
    assert saved["pricing"]["review_required"] is True


def test_light_update_carries_fair_value(conn):
    with pytest.raises(ValuationInputError):
        valuations.record_light_update(conn, "EAST", 9.5, "no news")
    _save(conn, 10.0)
    light = valuations.record_light_update(conn, "EAST", 9.5, "no news")
    assert light["pricing"]["fair_value"] == 10.0
    assert valuations.latest_valuation(conn, "EAST")["kind"] == "light"


def test_portfolio_from_invested_amount(conn, provider):
    holding = portfolio.add_holding(conn, "east.ca", buy_price=10.0, invested_amount=50.0)
    assert holding["symbol"] == "EAST"
    assert holding["quantity"] == pytest.approx(5.0)
    _save(conn, 10.0)
    summary = portfolio.portfolio_summary(conn, provider)
    row = summary["holdings"][0]
    assert row["market_value"] == pytest.approx(37.5)
    assert row["pnl"] == pytest.approx(-12.5)
    assert row["status"] == "below_protection"
    assert row["weight"] == pytest.approx(1.0)


def test_portfolio_rejects_unknown_symbol_and_ambiguous_input(conn):
    with pytest.raises(ValuationInputError):
        portfolio.add_holding(conn, "XXXX", buy_price=1, quantity=1)
    with pytest.raises(ValuationInputError):
        portfolio.add_holding(conn, "EAST", buy_price=1, quantity=1, invested_amount=1)


def test_portfolio_unpriced_holding(conn, provider):
    portfolio.add_holding(conn, "TMGH", buy_price=50, quantity=10)
    summary = portfolio.portfolio_summary(conn, provider)
    assert summary["totals"]["unpriced_holdings"] == ["TMGH"]
    assert summary["totals"]["market_value"] is None


def test_weekly_check_flags_new_period_rate_shift_events_and_protection(conn, provider):
    _save(conn, 10.0, period="FY2024", macro={"risk_free_rate_egp": {"value": 0.25}, "usd_egp": {"value": 48.0}})
    result = weekly.weekly_check(conn, provider, "EAST")
    assert result["needs_full_revaluation"] is True
    joined = " | ".join(result["reasons"])
    assert "FY2025" in joined
    assert "risk-free" in joined
    assert "below the protection price" in joined


def test_weekly_check_without_changes_is_light(conn, provider):
    conn.execute("DELETE FROM valuations")
    _save(conn, 8.0, period="FY2025", macro={"risk_free_rate_egp": {"value": 0.22}, "usd_egp": {"value": 50.0}})
    # The fixture event predates today's valuation, so nothing material is new.
    result = weekly.weekly_check(conn, provider, "EAST")
    assert result["needs_full_revaluation"] is False


def test_derived_metrics_and_quality_scores(provider):
    metrics = derived_metrics(provider, "EAST")
    assert metrics["metrics"]["earnings_cv"] == pytest.approx(0.0)
    assert metrics["metrics"]["dividend_years_paid_of_5"] == 5
    assert metrics["metrics"]["debt_to_equity"] == pytest.approx(25 / 60)
    assert "annual_volatility" in metrics["unavailable"]
    scores = quality_scores(provider.get_financials("EAST"))
    assert scores["altman_z2"]["zone"] == "safe"
    assert 0 <= scores["piotroski_f"]["score"] <= 9
    assert "m_score" in scores["beneish_m"]


def test_archive_listing_filters_and_change(conn):
    _save(conn, 10.0)
    _save(conn, 12.0, reason="results")
    valuations.record_light_update(conn, "EAST", 11.0, "weekly check")
    listing = valuations.list_valuations(conn)
    assert listing["total"] == 2
    assert [i["fair_value"] for i in listing["items"]] == [12.0, 10.0]
    assert listing["items"][0]["change_pct"] == pytest.approx(0.2)
    assert listing["items"][1]["change_pct"] is None
    assert listing["symbols"] == ["EAST"]
    assert valuations.list_valuations(conn, kind=None)["total"] == 3
    assert valuations.list_valuations(conn, risk_rating="safe")["total"] == 0
    assert valuations.list_valuations(conn, symbol="comi.ca")["total"] == 0
    assert valuations.list_valuations(conn, date_from="2099-01-01")["total"] == 0
    with pytest.raises(ValuationInputError):
        valuations.list_valuations(conn, risk_rating="cheap")


def test_get_valuation_returns_report_and_change(conn):
    _save(conn, 10.0)
    second = _save(conn, 11.0, reason="new period")
    full = valuations.get_valuation(conn, second["valuation_id"])
    assert full["report"].startswith("# EAST")
    assert full["assumptions"] == {"wacc": 0.25}
    assert full["change"]["reason"] == "new period"
    with pytest.raises(ValuationInputError):
        valuations.get_valuation(conn, 999)


def test_fair_value_series_in_time_order(conn):
    _save(conn, 10.0, price=9.0)
    _save(conn, 12.0, reason="results", price=11.0)
    series = valuations.fair_value_series(conn, "EAST")
    assert [p["fair_value"] for p in series["points"]] == [10.0, 12.0]
    assert [p["price_at_valuation"] for p in series["points"]] == [9.0, 11.0]
    assert len(series["changes"]) == 1


def test_migration_adds_report_column_to_old_database(tmp_path):
    import sqlite3
    path = tmp_path / "old.sqlite"
    old = sqlite3.connect(path)
    old.execute("CREATE TABLE valuations (id INTEGER PRIMARY KEY, symbol TEXT NOT NULL, created_at TEXT NOT NULL,"
                " kind TEXT NOT NULL, fair_value REAL NOT NULL, entry_price REAL NOT NULL,"
                " protection_price REAL NOT NULL)")
    old.execute("INSERT INTO valuations VALUES (1, 'EAST', '2026-01-01T00:00:00+00:00', 'full', 10, 10, 8)")
    old.commit()
    old.close()
    conn = connect(path)
    columns = {r["name"] for r in conn.execute("PRAGMA table_info(valuations)")}
    assert "report" in columns
    assert conn.execute("SELECT report FROM valuations WHERE id = 1").fetchone()[0] is None
    conn.close()
