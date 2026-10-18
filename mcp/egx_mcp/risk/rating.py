from .thresholds import BANK, GENERAL, level

LABELS = {
    "safe": "آمن",
    "balanced": "متوازن",
    "high_risk": "مرتفع المخاطر",
}
SAFE_BELOW = 0.67
BALANCED_BELOW = 1.34
MIN_CRITERIA_FOR_CONFIDENCE = 5

Z2_LEVEL = {"safe": 0, "grey": 1, "distress": 2}
BENEISH_LEVEL = {"clear": 0, "watch": 1, "red": 2}


def _piotroski_level(score: int) -> int:
    return 0 if score >= 7 else 2 if score <= 3 else 1


def risk_rating(
    is_bank: bool,
    metrics: dict | None = None,
    z2_zone: str | None = None,
    piotroski_score: int | None = None,
    beneish_flag: str | None = None,
    auditor_qualified_opinion: bool | None = None,
    government_pricing_exposure: bool | None = None,
    any_loss_year_5y: bool | None = None,
    government_ownership_share: float | None = None,
) -> dict:
    """Fixed-rule risk rating: safe / balanced / high_risk.

    `metrics` keys come from thresholds.GENERAL (all companies) and
    thresholds.BANK (banks). Missing values are skipped and reported. Red
    flags force high_risk regardless of the average.
    """
    metrics = metrics or {}
    criteria: list[dict] = []
    red_flags: list[str] = []
    missing: list[str] = []

    def add(name: str, value, lvl: int) -> None:
        criteria.append({"criterion": name, "value": value, "level": lvl})

    table = dict(GENERAL)
    if is_bank:
        table.update(BANK)
        # Leverage and coverage ratios describe industrial balance sheets, not banks.
        table.pop("debt_to_equity")
        table.pop("interest_coverage")

    for name, (low, high, riskier) in table.items():
        value = metrics.get(name)
        if value is None:
            missing.append(name)
            continue
        add(name, value, level(value, low, high, riskier))

    if is_bank and metrics.get("car") is not None and metrics["car"] <= BANK["car"][1]:
        red_flags.append("car_below_regulatory_floor")

    if not is_bank:
        if z2_zone is None:
            missing.append("altman_z2")
        else:
            add("altman_z2", z2_zone, Z2_LEVEL[z2_zone])
            if z2_zone == "distress":
                red_flags.append("altman_distress_zone")
        if piotroski_score is None:
            missing.append("piotroski_f")
        else:
            add("piotroski_f", piotroski_score, _piotroski_level(piotroski_score))
        if beneish_flag is None:
            missing.append("beneish_m")
        else:
            add("beneish_m", beneish_flag, BENEISH_LEVEL[beneish_flag])
            if beneish_flag == "red":
                red_flags.append("beneish_possible_manipulation")

    if auditor_qualified_opinion is None:
        missing.append("auditor_qualified_opinion")
    elif auditor_qualified_opinion:
        add("auditor_qualified_opinion", True, 2)
        red_flags.append("auditor_qualified_opinion")
    else:
        add("auditor_qualified_opinion", False, 0)

    if government_pricing_exposure is not None:
        add("government_pricing_exposure", government_pricing_exposure, 1 if government_pricing_exposure else 0)
    if any_loss_year_5y is not None:
        add("loss_year_in_5y", any_loss_year_5y, 2 if any_loss_year_5y else 0)

    average = sum(c["level"] for c in criteria) / len(criteria) if criteria else None
    if red_flags:
        rating = "high_risk"
    elif average is None:
        rating = None
    elif average < SAFE_BELOW:
        rating = "safe"
    elif average < BALANCED_BELOW:
        rating = "balanced"
    else:
        rating = "high_risk"

    return {
        "rating": rating,
        "label_ar": LABELS.get(rating) if rating else None,
        "average_level": average,
        "red_flags": red_flags,
        "criteria": criteria,
        "missing": missing,
        "confidence": "normal" if len(criteria) >= MIN_CRITERIA_FOR_CONFIDENCE else "low",
        "info": {"government_ownership_share": government_ownership_share},
    }
