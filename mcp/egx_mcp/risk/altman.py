from ..errors import ValuationInputError

EM_CONSTANT = 3.25
SAFE_ABOVE = 2.6
DISTRESS_BELOW = 1.1


def altman_z2(
    working_capital: float,
    retained_earnings: float,
    ebit: float,
    book_equity: float,
    total_liabilities: float,
    total_assets: float,
) -> dict:
    """Altman Z''-score for non-manufacturing / emerging-market firms.

    Z'' = 6.56 X1 + 3.26 X2 + 6.72 X3 + 1.05 X4, zones on Z'' (>2.6 safe,
    1.1-2.6 grey, <1.1 distress). The emerging-market score adds 3.25.
    Not meaningful for banks and other financials.
    """
    if total_assets <= 0 or total_liabilities <= 0:
        raise ValuationInputError("total_assets and total_liabilities must be positive")
    x1 = working_capital / total_assets
    x2 = retained_earnings / total_assets
    x3 = ebit / total_assets
    x4 = book_equity / total_liabilities
    z2 = 6.56 * x1 + 3.26 * x2 + 6.72 * x3 + 1.05 * x4
    zone = "safe" if z2 > SAFE_ABOVE else "distress" if z2 < DISTRESS_BELOW else "grey"
    return {
        "z2": z2,
        "em_score": z2 + EM_CONSTANT,
        "zone": zone,
        "components": {"x1": x1, "x2": x2, "x3": x3, "x4": x4},
    }
