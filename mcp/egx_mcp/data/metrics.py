"""Risk metrics derived from provider data, so the model does not compute them by hand."""

import math
import statistics

from .provider import DataProvider

MIN_PRICES_FOR_VOLATILITY = 20
TRADING_DAYS = 252


def annual_volatility(prices: list[float]) -> float | None:
    if len(prices) < MIN_PRICES_FOR_VOLATILITY:
        return None
    returns = [math.log(b / a) for a, b in zip(prices, prices[1:], strict=False) if a > 0 and b > 0]
    if len(returns) < 2:
        return None
    return statistics.stdev(returns) * math.sqrt(TRADING_DAYS)


def derived_metrics(provider: DataProvider, symbol: str) -> dict:
    """Metrics keyed like risk.thresholds, plus what could not be computed and why."""
    metrics: dict[str, float] = {}
    unavailable: dict[str, str] = {}

    history = provider.get_price_history(symbol)
    vol = annual_volatility([p.value for p in history])
    if vol is None:
        unavailable["annual_volatility"] = f"needs at least {MIN_PRICES_FOR_VOLATILITY} price observations"
    else:
        metrics["annual_volatility"] = vol

    financials = provider.get_financials(symbol)
    periods = sorted(financials.periods, key=lambda p: p.period_end) if financials else []
    annual = [p for p in periods if p.period.upper().startswith("FY")][-5:]

    incomes = [p.data["net_income"] for p in annual if "net_income" in p.data]
    if len(incomes) >= 3 and statistics.mean(incomes) > 0:
        metrics["earnings_cv"] = statistics.pstdev(incomes) / statistics.mean(incomes)
    else:
        unavailable["earnings_cv"] = "needs net_income for at least 3 fiscal years with a positive average"

    dividends = [p.data.get("dividend_per_share") for p in annual]
    if len(annual) == 5 and all(d is not None for d in dividends):
        metrics["dividend_years_paid_of_5"] = sum(1 for d in dividends if d > 0)
    else:
        unavailable["dividend_years_paid_of_5"] = "needs dividend_per_share for the last 5 fiscal years"

    latest = annual[-1].data if annual else {}
    if latest.get("total_equity") and "total_debt" in latest:
        metrics["debt_to_equity"] = latest["total_debt"] / latest["total_equity"]
    else:
        unavailable["debt_to_equity"] = "needs total_debt and total_equity in the latest fiscal year"
    if latest.get("interest_expense") and "ebit" in latest:
        metrics["interest_coverage"] = latest["ebit"] / latest["interest_expense"]
    else:
        unavailable["interest_coverage"] = "needs ebit and interest_expense in the latest fiscal year"

    return {
        "metrics": metrics,
        "unavailable": unavailable,
        "any_loss_year_5y": any(i < 0 for i in incomes) if incomes else None,
    }
