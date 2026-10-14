"""Default risk thresholds. Levels: 0 = low risk, 1 = medium, 2 = high.

Each entry is (low_bound, high_bound, higher_is_riskier). Values at or beyond
high_bound score 2, between the bounds 1, otherwise 0. These are starting
defaults for EGX30 and are meant to be reviewed, not treated as regulation.
"""

GENERAL = {
    "debt_to_equity": (0.5, 1.5, True),
    "interest_coverage": (5.0, 2.0, False),
    "earnings_cv": (0.25, 0.6, True),
    "avg_daily_traded_value_egp": (20_000_000, 5_000_000, False),
    "annual_volatility": (0.30, 0.50, True),
    "dividend_years_paid_of_5": (5, 3, False),
    "valuation_range_width": (0.4, 0.8, True),
    "top_customer_share": (0.15, 0.30, True),
    "capital_increases_3y": (1, 2, True),
}

BANK = {
    "car": (0.15, 0.125, False),
    "npl_ratio": (0.03, 0.06, True),
    "coverage_ratio": (1.0, 0.7, False),
    "loans_to_deposits": (0.7, 0.9, True),
    "fx_open_position_to_capital": (0.05, 0.10, True),
}


def level(value: float, low_bound: float, high_bound: float, higher_is_riskier: bool) -> int:
    if higher_is_riskier:
        if value >= high_bound:
            return 2
        return 1 if value >= low_bound else 0
    if value <= high_bound:
        return 2
    return 1 if value < low_bound else 0
