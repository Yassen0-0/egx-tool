import pytest

from egx_mcp.pricing import pricing_levels
from egx_mcp.risk.altman import altman_z2
from egx_mcp.risk.beneish import beneish_m
from egx_mcp.risk.piotroski import piotroski_f
from egx_mcp.risk.rating import risk_rating


def test_altman_z2_hand_calculation():
    result = altman_z2(working_capital=20, retained_earnings=30, ebit=10, book_equity=50,
                       total_liabilities=50, total_assets=100)
    assert result["z2"] == pytest.approx(6.56 * 0.2 + 3.26 * 0.3 + 6.72 * 0.1 + 1.05 * 1.0)
    assert result["em_score"] == pytest.approx(result["z2"] + 3.25)
    assert result["zone"] == "safe"


def test_altman_distress_zone():
    result = altman_z2(working_capital=-20, retained_earnings=-10, ebit=1, book_equity=10,
                       total_liabilities=90, total_assets=100)
    assert result["zone"] == "distress"


def _year(**overrides):
    year = {
        "net_income": 10, "cfo": 12, "total_assets_begin": 100, "total_assets_end": 110,
        "long_term_debt": 20, "current_assets": 50, "current_liabilities": 30,
        "shares_outstanding": 100, "revenue": 200, "gross_profit": 60,
    }
    year.update(overrides)
    return year


def test_piotroski_all_tests_pass():
    prior = _year(net_income=5, long_term_debt=30, current_assets=40, gross_profit=40, revenue=150)
    result = piotroski_f(_year(), prior)
    assert result["score"] == 9
    assert result["strength"] == "strong"


def test_piotroski_weak_company():
    prior = _year()
    current = _year(net_income=-5, cfo=-1, long_term_debt=40, current_assets=30,
                    shares_outstanding=120, gross_profit=40, revenue=180)
    assert piotroski_f(current, prior)["score"] <= 3


def _beneish_year(**overrides):
    year = {
        "receivables": 20, "revenue": 200, "cogs": 120, "current_assets": 80, "ppe_net": 60,
        "securities": 0, "total_assets": 200, "depreciation": 10, "sga": 30,
        "current_liabilities": 40, "long_term_debt": 30, "income_continuing_ops": 20, "cfo": 20,
    }
    year.update(overrides)
    return year


def test_beneish_neutral_company_scores_minus_2_48():
    # All indices equal 1 and TATA = 0, the model's documented neutral point.
    result = beneish_m(_beneish_year(), _beneish_year())
    assert result["m_score"] == pytest.approx(-2.48)
    assert result["flag"] == "clear"


def test_beneish_flags_receivable_and_accrual_spike():
    current = _beneish_year(receivables=60, revenue=300, income_continuing_ops=60, cfo=0)
    assert beneish_m(current, _beneish_year())["flag"] == "red"


def test_pricing_levels_below_protection_requires_review():
    result = pricing_levels(100, current_price=70)
    assert result["entry_price"] == 100
    assert result["protection_price"] == pytest.approx(80)
    assert result["status"] == "below_protection"
    assert result["review_required"] is True


def test_pricing_levels_between_protection_and_fair_value():
    result = pricing_levels(100, current_price=90)
    assert result["status"] == "at_or_below_fair_value"
    assert result["upside_to_fair_value"] == pytest.approx(100 / 90 - 1)


def test_rating_safe_company():
    result = risk_rating(
        is_bank=False,
        metrics={"debt_to_equity": 0.2, "interest_coverage": 12, "earnings_cv": 0.1,
                 "avg_daily_traded_value_egp": 50_000_000, "annual_volatility": 0.25,
                 "dividend_years_paid_of_5": 5, "valuation_range_width": 0.3},
        z2_zone="safe", piotroski_score=8, beneish_flag="clear", auditor_qualified_opinion=False,
    )
    assert result["rating"] == "safe"
    assert result["label_ar"] == "آمن"
    assert result["confidence"] == "normal"


def test_rating_red_flag_overrides_good_average():
    result = risk_rating(
        is_bank=False,
        metrics={"debt_to_equity": 0.2, "interest_coverage": 12, "earnings_cv": 0.1},
        z2_zone="safe", piotroski_score=8, beneish_flag="clear", auditor_qualified_opinion=True,
    )
    assert result["rating"] == "high_risk"
    assert "auditor_qualified_opinion" in result["red_flags"]


def test_rating_bank_ignores_industrial_leverage_and_flags_low_car():
    result = risk_rating(
        is_bank=True,
        metrics={"debt_to_equity": 9.0, "car": 0.11, "npl_ratio": 0.02, "coverage_ratio": 1.5},
        auditor_qualified_opinion=False,
    )
    assert "debt_to_equity" not in {c["criterion"] for c in result["criteria"]}
    assert result["red_flags"] == ["car_below_regulatory_floor"]
    assert result["rating"] == "high_risk"


def test_rating_reports_low_confidence_with_little_data():
    result = risk_rating(is_bank=False, metrics={"debt_to_equity": 0.4})
    assert result["confidence"] == "low"
    assert "altman_z2" in result["missing"]
