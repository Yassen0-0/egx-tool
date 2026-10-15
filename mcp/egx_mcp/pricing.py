from .errors import ValuationInputError

PROTECTION_DISCOUNT = 0.20
# Prices are quoted to the piaster: compare at that precision so a price of 104.80 is not
# "under" a protection of 131 × 0.8 = 104.80000000000001.
EPSILON = 1e-6


def margin_to_fair(fair_value: float, price: float) -> float:
    """Difference from fair as a share of fair: (fair − price) / fair. Positive when price is under fair."""
    return (fair_value - price) / fair_value


def below_protection_by(protection_price: float, price: float) -> float | None:
    """How far price is under protection, as a share of protection; None when it is not under."""
    if price >= protection_price - EPSILON:
        return None
    return (protection_price - price) / protection_price


def status_of(fair_value: float, protection_price: float, price: float) -> str:
    """above_fair_value (price ≥ fair), at_or_below_fair_value (protection ≤ price < fair),
    below_protection (price < protection). The middle name predates the UI wording
    «بين الحماية والعادل» and is kept for the MCP tools."""
    if price >= fair_value - EPSILON:
        return "above_fair_value"
    if price >= protection_price - EPSILON:
        return "at_or_below_fair_value"
    return "below_protection"


def pricing_levels(fair_value: float, current_price: float | None = None) -> dict:
    """Entry price equals fair value; protection price is 20% below it.

    When the market price is already under the protection price the stock is
    flagged for a mandatory critic review instead of being read as cheap.
    """
    if fair_value <= 0:
        raise ValuationInputError("fair_value must be positive")
    entry = fair_value
    protection = fair_value * (1 - PROTECTION_DISCOUNT)
    result = {
        "fair_value": fair_value,
        "entry_price": entry,
        "protection_price": protection,
        "protection_discount": PROTECTION_DISCOUNT,
    }
    if current_price is not None:
        if current_price <= 0:
            raise ValuationInputError("current_price must be positive")
        status = status_of(fair_value, protection, current_price)
        result.update({
            "current_price": current_price,
            # Kept for the MCP tools; the UI shows margin_to_fair, measured against fair value.
            "upside_to_fair_value": fair_value / current_price - 1,
            "margin_to_fair": margin_to_fair(fair_value, current_price),
            "below_protection_by": below_protection_by(protection, current_price),
            "status": status,
            "review_required": status == "below_protection",
        })
    return result
