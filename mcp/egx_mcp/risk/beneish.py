from ..errors import ValuationInputError

LIKELY_MANIPULATOR = -1.78
CONSERVATIVE_THRESHOLD = -2.22


def beneish_m(current: dict, prior: dict) -> dict:
    """Beneish M-score (8-variable model) from two consecutive fiscal years.

    Each year needs: receivables, revenue, cogs, current_assets, ppe_net,
    securities, total_assets, depreciation, sga, current_liabilities,
    long_term_debt. `current` also needs income_continuing_ops and cfo.
    A score above -1.78 is a red flag that needs investigation, not proof.
    """
    for y in (current, prior):
        if y["revenue"] <= 0 or y["total_assets"] <= 0:
            raise ValuationInputError("revenue and total_assets must be positive")

    def gross_margin(y: dict) -> float:
        return (y["revenue"] - y["cogs"]) / y["revenue"]

    def asset_quality(y: dict) -> float:
        return 1 - (y["current_assets"] + y["ppe_net"] + y.get("securities", 0.0)) / y["total_assets"]

    def depreciation_rate(y: dict) -> float:
        return y["depreciation"] / (y["depreciation"] + y["ppe_net"])

    def leverage(y: dict) -> float:
        return (y["current_liabilities"] + y["long_term_debt"]) / y["total_assets"]

    indices = {
        "dsri": (current["receivables"] / current["revenue"]) / (prior["receivables"] / prior["revenue"]),
        "gmi": gross_margin(prior) / gross_margin(current),
        "aqi": asset_quality(current) / asset_quality(prior),
        "sgi": current["revenue"] / prior["revenue"],
        "depi": depreciation_rate(prior) / depreciation_rate(current),
        "sgai": (current["sga"] / current["revenue"]) / (prior["sga"] / prior["revenue"]),
        "tata": (current["income_continuing_ops"] - current["cfo"]) / current["total_assets"],
        "lvgi": leverage(current) / leverage(prior),
    }
    m = (
        -4.84
        + 0.920 * indices["dsri"]
        + 0.528 * indices["gmi"]
        + 0.404 * indices["aqi"]
        + 0.892 * indices["sgi"]
        + 0.115 * indices["depi"]
        - 0.172 * indices["sgai"]
        + 4.679 * indices["tata"]
        - 0.327 * indices["lvgi"]
    )
    if m > LIKELY_MANIPULATOR:
        flag = "red"
    elif m > CONSERVATIVE_THRESHOLD:
        flag = "watch"
    else:
        flag = "clear"
    return {"m_score": m, "flag": flag, "indices": indices}
