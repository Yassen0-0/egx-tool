def piotroski_f(current: dict, prior: dict) -> dict:
    """Piotroski F-score (0-9) from two consecutive fiscal years.

    Each year needs: net_income, cfo, total_assets_begin, total_assets_end,
    long_term_debt, current_assets, current_liabilities, shares_outstanding,
    revenue, gross_profit.
    """

    def roa(y: dict) -> float:
        return y["net_income"] / y["total_assets_begin"]

    def leverage(y: dict) -> float:
        return y["long_term_debt"] / y["total_assets_end"]

    def current_ratio(y: dict) -> float:
        return y["current_assets"] / y["current_liabilities"]

    def gross_margin(y: dict) -> float:
        return y["gross_profit"] / y["revenue"]

    def asset_turnover(y: dict) -> float:
        return y["revenue"] / y["total_assets_begin"]

    tests = {
        "positive_net_income": current["net_income"] > 0,
        "positive_cfo": current["cfo"] > 0,
        "improving_roa": roa(current) > roa(prior),
        "cfo_exceeds_net_income": current["cfo"] > current["net_income"],
        "lower_leverage": leverage(current) < leverage(prior),
        "higher_current_ratio": current_ratio(current) > current_ratio(prior),
        "no_new_shares": current["shares_outstanding"] <= prior["shares_outstanding"],
        "higher_gross_margin": gross_margin(current) > gross_margin(prior),
        "higher_asset_turnover": asset_turnover(current) > asset_turnover(prior),
    }
    score = sum(tests.values())
    strength = "strong" if score >= 7 else "weak" if score <= 3 else "average"
    return {"score": score, "strength": strength, "tests": tests}
