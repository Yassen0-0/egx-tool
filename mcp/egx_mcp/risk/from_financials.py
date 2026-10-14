"""Run the statement-based scores straight from provider periods, reporting missing fields."""

from ..data.provider import Financials
from .altman import altman_z2
from .beneish import beneish_m
from .piotroski import piotroski_f

ALTMAN_FIELDS = ("working_capital", "retained_earnings", "ebit", "total_equity", "total_liabilities", "total_assets")
PIOTROSKI_FIELDS = ("net_income", "cfo", "total_assets_begin", "total_assets_end", "long_term_debt",
                    "current_assets", "current_liabilities", "shares_outstanding", "revenue", "gross_profit")
BENEISH_FIELDS = ("receivables", "revenue", "cogs", "current_assets", "ppe_net", "total_assets", "depreciation",
                  "sga", "current_liabilities", "long_term_debt")
BENEISH_CURRENT_ONLY = ("income_continuing_ops", "cfo")


def _missing(data: dict, fields: tuple[str, ...]) -> list[str]:
    return [f for f in fields if f not in data]


def quality_scores(financials: Financials) -> dict:
    annual = sorted((p for p in financials.periods if p.period.upper().startswith("FY")), key=lambda p: p.period_end)
    result: dict = {"periods_used": [p.period for p in annual[-2:]]}
    if not annual:
        return {**result, "error": "no fiscal-year periods available"}
    current = dict(annual[-1].data)
    current.setdefault("total_assets_end", current.get("total_assets"))
    if "working_capital" not in current and {"current_assets", "current_liabilities"} <= current.keys():
        current["working_capital"] = current["current_assets"] - current["current_liabilities"]

    missing = _missing(current, ALTMAN_FIELDS)
    if missing:
        result["altman_z2"] = {"missing": missing}
    else:
        result["altman_z2"] = altman_z2(current["working_capital"], current["retained_earnings"], current["ebit"],
                                        current["total_equity"], current["total_liabilities"], current["total_assets"])

    if len(annual) < 2:
        result["piotroski_f"] = result["beneish_m"] = {"missing": ["a second fiscal year"]}
        return result
    prior = dict(annual[-2].data)
    prior.setdefault("total_assets_end", prior.get("total_assets"))

    missing = _missing(current, PIOTROSKI_FIELDS) + [f"prior.{f}" for f in _missing(prior, PIOTROSKI_FIELDS)]
    result["piotroski_f"] = {"missing": missing} if missing else piotroski_f(current, prior)

    missing = (_missing(current, BENEISH_FIELDS + BENEISH_CURRENT_ONLY)
               + [f"prior.{f}" for f in _missing(prior, BENEISH_FIELDS)])
    result["beneish_m"] = {"missing": missing} if missing else beneish_m(current, prior)
    return result
