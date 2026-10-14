from ..errors import ValuationInputError


def fcff_dcf(
    fcff_forecast: list[float],
    wacc: float,
    terminal_growth: float,
    net_debt: float,
    shares_outstanding: float,
    minority_interest: float = 0.0,
    non_operating_assets: float = 0.0,
    mid_year: bool = False,
) -> dict:
    """Free-cash-flow-to-firm DCF with a Gordon-growth terminal value.

    fcff_forecast holds explicit-period FCFF, year 1 first. Terminal value is
    FCFF_n * (1 + g) / (wacc - g), discounted with the final explicit year's factor.
    """
    if not fcff_forecast:
        raise ValuationInputError("fcff_forecast must contain at least one year")
    if wacc <= terminal_growth:
        raise ValuationInputError("wacc must be greater than terminal_growth")
    if shares_outstanding <= 0:
        raise ValuationInputError("shares_outstanding must be positive")

    shift = 0.5 if mid_year else 0.0
    pv_years = []
    for year, cash_flow in enumerate(fcff_forecast, start=1):
        factor = (1 + wacc) ** (year - shift)
        pv_years.append(cash_flow / factor)
    pv_explicit = sum(pv_years)

    n = len(fcff_forecast)
    terminal_value = fcff_forecast[-1] * (1 + terminal_growth) / (wacc - terminal_growth)
    pv_terminal = terminal_value / (1 + wacc) ** (n - shift)

    enterprise_value = pv_explicit + pv_terminal
    equity_value = enterprise_value - net_debt - minority_interest + non_operating_assets
    return {
        "method": "dcf_fcff",
        "value_per_share": equity_value / shares_outstanding,
        "equity_value": equity_value,
        "enterprise_value": enterprise_value,
        "pv_explicit": pv_explicit,
        "pv_terminal": pv_terminal,
        "terminal_value": terminal_value,
        "terminal_share_of_ev": pv_terminal / enterprise_value if enterprise_value else None,
        "pv_by_year": pv_years,
    }
