from ..errors import ValuationInputError


def net_asset_value(
    components: list[dict],
    shares_outstanding: float,
    net_debt: float = 0.0,
    other_liabilities: float = 0.0,
    discount: float = 0.0,
) -> dict:
    """Sum-of-the-parts NAV for holdings, or RNAV for real-estate developers.

    Each component is {"name", "value", "stake"} where value is the asset's
    total value and stake is the ownership share (1.0 when wholly owned or
    already attributable). `discount` is the holding/RNAV discount applied to
    the gross NAV (0.25 = 25%).
    """
    if shares_outstanding <= 0:
        raise ValuationInputError("shares_outstanding must be positive")
    if not 0 <= discount < 1:
        raise ValuationInputError("discount must be between 0 and 1")
    if not components:
        raise ValuationInputError("components must not be empty")

    parts = []
    for component in components:
        stake = component.get("stake", 1.0)
        if not 0 < stake <= 1:
            raise ValuationInputError(f"stake for {component.get('name')} must be in (0, 1]")
        attributable = component["value"] * stake
        parts.append({"name": component.get("name"), "attributable_value": attributable})

    gross_assets = sum(p["attributable_value"] for p in parts)
    nav = gross_assets - net_debt - other_liabilities
    discounted = nav * (1 - discount)
    return {
        "method": "nav",
        "value_per_share": discounted / shares_outstanding,
        "nav_per_share_before_discount": nav / shares_outstanding,
        "gross_assets": gross_assets,
        "nav": nav,
        "discount": discount,
        "parts": parts,
    }
