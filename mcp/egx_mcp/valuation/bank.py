from ..errors import ValuationInputError


def justified_pb(
    book_value_per_share: float,
    sustainable_roe: float,
    cost_of_equity: float,
    long_term_growth: float,
) -> dict:
    """Bank valuation via justified P/B = (ROE - g) / (Ke - g)."""
    if cost_of_equity <= long_term_growth:
        raise ValuationInputError("cost_of_equity must be greater than long_term_growth")
    if book_value_per_share <= 0:
        raise ValuationInputError("book_value_per_share must be positive")
    pb = (sustainable_roe - long_term_growth) / (cost_of_equity - long_term_growth)
    return {
        "method": "bank_justified_pb",
        "value_per_share": book_value_per_share * pb,
        "justified_pb": pb,
    }
