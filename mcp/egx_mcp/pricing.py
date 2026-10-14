from .errors import ValuationInputError

PROTECTION_DISCOUNT = 0.20


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
        if current_price < protection:
            status = "below_protection"
        elif current_price <= entry:
            status = "at_or_below_fair_value"
        else:
            status = "above_fair_value"
        result.update({
            "current_price": current_price,
            "upside_to_fair_value": fair_value / current_price - 1,
            "status": status,
            "review_required": status == "below_protection",
        })
    return result
