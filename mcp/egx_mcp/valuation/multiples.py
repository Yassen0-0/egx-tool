from ..errors import ValuationInputError


def value_from_multiples(
    shares_outstanding: float,
    net_debt: float = 0.0,
    eps: float | None = None,
    pe: float | None = None,
    ebitda: float | None = None,
    ev_ebitda: float | None = None,
    book_value_per_share: float | None = None,
    pb: float | None = None,
) -> dict:
    """Per-share values from whichever multiple pairs are supplied.

    The model supplies the multiples (peer median, own history) and must state
    where they came from; this function only applies them.
    """
    if shares_outstanding <= 0:
        raise ValuationInputError("shares_outstanding must be positive")
    results: dict[str, float] = {}
    if eps is not None and pe is not None:
        results["pe"] = eps * pe
    if ebitda is not None and ev_ebitda is not None:
        results["ev_ebitda"] = (ebitda * ev_ebitda - net_debt) / shares_outstanding
    if book_value_per_share is not None and pb is not None:
        results["pb"] = book_value_per_share * pb
    if not results:
        raise ValuationInputError("supply at least one complete multiple pair (eps+pe, ebitda+ev_ebitda, bvps+pb)")
    return {
        "method": "multiples",
        "values_per_share": results,
        "value_per_share": sum(results.values()) / len(results),
    }
