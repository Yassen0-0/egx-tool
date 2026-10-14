from ..errors import ValuationInputError


def dividend_discount(
    dividends_forecast: list[float],
    cost_of_equity: float,
    terminal_growth: float,
) -> dict:
    """Multi-stage dividend discount model (per share).

    dividends_forecast holds explicit dividends per share, year 1 first; the
    last one grows at terminal_growth forever. A single-element list is the
    Gordon growth model with D1 = dividends_forecast[0].
    """
    if not dividends_forecast:
        raise ValuationInputError("dividends_forecast must contain at least one year")
    if cost_of_equity <= terminal_growth:
        raise ValuationInputError("cost_of_equity must be greater than terminal_growth")

    if len(dividends_forecast) == 1:
        value = dividends_forecast[0] / (cost_of_equity - terminal_growth)
        return {"method": "ddm", "value_per_share": value, "pv_explicit": 0.0, "pv_terminal": value}

    pv_explicit = sum(d / (1 + cost_of_equity) ** t for t, d in enumerate(dividends_forecast, start=1))
    n = len(dividends_forecast)
    terminal = dividends_forecast[-1] * (1 + terminal_growth) / (cost_of_equity - terminal_growth)
    pv_terminal = terminal / (1 + cost_of_equity) ** n
    return {
        "method": "ddm",
        "value_per_share": pv_explicit + pv_terminal,
        "pv_explicit": pv_explicit,
        "pv_terminal": pv_terminal,
    }
