"""EGX30 analysis tools over MCP (stdio). Exposed in DeepSeek Harness as mcp__egx__<tool>."""

import functools
from contextlib import closing
from typing import Literal

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import BaseModel, Field

from . import pricing
from .config import db_path
from .data import default_provider
from .data.metrics import derived_metrics
from .errors import ValuationInputError
from .risk import rating as rating_mod
from .risk.altman import altman_z2 as altman_z2_calc
from .risk.beneish import beneish_m as beneish_m_calc
from .risk.from_financials import quality_scores
from .risk.piotroski import piotroski_f as piotroski_f_calc
from .store import portfolio, valuations, weekly
from .store.db import connect
from .universe import constituent, load_universe, normalize_symbol
from .valuation import bank, dcf, ddm, multiples, nav, rates, sanity, scenarios

INSTRUCTIONS = """\
Deterministic calculators and storage for valuing EGX30 stocks.
Never do valuation arithmetic yourself: choose and justify assumptions, then call these tools.
Outputs are valuation statements (fair value, risk rating, entry and protection prices), never buy/sell recommendations.
"""

server = MCPServer(name="egx", instructions=INSTRUCTIONS, version="0.1.0")


def tool(fn):
    """Register fn as an MCP tool, returning input errors to the model as readable tool errors."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except ValuationInputError as exc:
            raise ToolError(str(exc)) from exc

    return server.tool()(wrapper)


def _db():
    return closing(connect(db_path()))


def _require_symbol(symbol: str) -> dict:
    entry = constituent(symbol)
    if entry is None:
        raise ValuationInputError(f"{symbol} is not an EGX30 constituent")
    return entry


class ScenarioMethod(BaseModel):
    method: str = Field(description="e.g. dcf_fcff, multiples, ddm, nav, bank_justified_pb")
    weight: float = Field(ge=0, description="relative weight of this method")
    bear: float
    base: float
    bull: float


class NavComponent(BaseModel):
    name: str
    value: float = Field(description="total value of the asset or stake's underlying company")
    stake: float = Field(default=1.0, gt=0, le=1, description="ownership share")


class SourceRef(BaseModel):
    item: str = Field(description="what the number is, e.g. 'FY2025 net income' or 'EGP 10y yield'")
    value: str
    source: str = Field(description="where it came from: document, page, URL, provider")
    as_of: str


class FinancialYear(BaseModel):
    model_config = {"extra": "allow"}


# ── universe and data ────────────────────────────────────────────────────────

@tool
def universe_list() -> dict:
    """List EGX30 constituents with weights and the suggested valuation model for each."""
    return load_universe()


@tool
def get_company_data(symbol: str) -> dict:
    """Everything the provider has for one symbol: price, financial periods, macro inputs, events and
    derived risk metrics. Each value carries its source and date; cite them in the report."""
    entry = _require_symbol(symbol)
    provider = default_provider()
    price = provider.get_price(symbol)
    financials = provider.get_financials(symbol)
    return {
        "company": entry,
        "provider": provider.name,
        "price": price.to_dict() if price else None,
        "financials": None if financials is None else {
            "currency": financials.currency,
            "unit": financials.unit,
            "periods": [p.__dict__ for p in sorted(financials.periods, key=lambda p: p.period_end)],
        },
        "macro": {k: v.to_dict() for k, v in provider.get_macro().items()},
        "events": [e.__dict__ for e in provider.get_events(symbol)],
        "derived_metrics": derived_metrics(provider, symbol),
        "missing": [name for name, value in (("price", price), ("financials", financials)) if value is None],
    }


@tool
def quality_scores_from_financials(symbol: str) -> dict:
    """Altman Z'', Piotroski F and Beneish M computed from the provider's last two fiscal years
    (non-financial companies only). Reports any missing statement fields instead of guessing."""
    entry = _require_symbol(symbol)
    if entry["valuation_model"] in ("bank", "nonbank_financial"):
        return {"symbol": entry["symbol"], "not_applicable": "statement scores are not meaningful for financials"}
    financials = default_provider().get_financials(symbol)
    if financials is None:
        return {"symbol": entry["symbol"], "error": "no financial statements available from the provider"}
    return {"symbol": entry["symbol"], **quality_scores(financials)}


# ── rates and valuation methods ──────────────────────────────────────────────

@tool
def capm_cost_of_equity(risk_free_rate: float, beta: float, equity_risk_premium: float,
                        additional_premium: float = 0.0) -> dict:
    """Cost of equity = Rf + beta * ERP + additional premium. Rates as decimals, in the cash-flow currency."""
    return rates.capm_cost_of_equity(risk_free_rate, beta, equity_risk_premium, additional_premium)


@tool
def wacc(cost_of_equity: float, pre_tax_cost_of_debt: float, tax_rate: float, equity_weight: float) -> dict:
    """Weighted average cost of capital with market-value weights (decimals)."""
    return rates.wacc(cost_of_equity, pre_tax_cost_of_debt, tax_rate, equity_weight)


@tool
def value_dcf(fcff_forecast: list[float], wacc: float, terminal_growth: float, net_debt: float,
              shares_outstanding: float, minority_interest: float = 0.0, non_operating_assets: float = 0.0,
              mid_year: bool = False) -> dict:
    """FCFF DCF with Gordon terminal value. Amounts in one currency and unit; returns value per share."""
    return dcf.fcff_dcf(fcff_forecast, wacc, terminal_growth, net_debt, shares_outstanding,
                        minority_interest, non_operating_assets, mid_year)


@tool
def value_multiples(shares_outstanding: float, net_debt: float = 0.0, eps: float | None = None,
                    pe: float | None = None, ebitda: float | None = None, ev_ebitda: float | None = None,
                    book_value_per_share: float | None = None, pb: float | None = None) -> dict:
    """Apply P/E, EV/EBITDA and/or P/B multiples. State where each multiple came from."""
    return multiples.value_from_multiples(shares_outstanding, net_debt, eps, pe, ebitda, ev_ebitda,
                                          book_value_per_share, pb)


@tool
def value_ddm(dividends_forecast: list[float], cost_of_equity: float, terminal_growth: float) -> dict:
    """Dividend discount model per share; a single dividend is the Gordon model with D1."""
    return ddm.dividend_discount(dividends_forecast, cost_of_equity, terminal_growth)


@tool
def value_nav(components: list[NavComponent], shares_outstanding: float, net_debt: float = 0.0,
              other_liabilities: float = 0.0, discount: float = 0.0) -> dict:
    """Sum-of-the-parts NAV (holdings) or RNAV (real estate) with a holding/RNAV discount."""
    return nav.net_asset_value([c.model_dump() for c in components], shares_outstanding, net_debt,
                               other_liabilities, discount)


@tool
def value_bank_pb(book_value_per_share: float, sustainable_roe: float, cost_of_equity: float,
                  long_term_growth: float) -> dict:
    """Bank value via justified P/B = (ROE - g) / (Ke - g)."""
    return bank.justified_pb(book_value_per_share, sustainable_roe, cost_of_equity, long_term_growth)


@tool
def combine_scenarios(methods: list[ScenarioMethod]) -> dict:
    """Blend per-method bear/base/bull values into the fair value (weighted base) and its range."""
    return scenarios.combine_scenarios([m.model_dump() for m in methods])


@tool
def sanity_check(fair_value: float | None = None, current_price: float | None = None,
                 terminal_growth: float | None = None, long_run_nominal_growth: float | None = None,
                 terminal_share_of_ev: float | None = None, eps: float | None = None,
                 pe_history_range: list[float] | None = None, ebitda_per_share: float | None = None,
                 net_debt_per_share: float | None = None, ev_ebitda_history_range: list[float] | None = None,
                 cash_flow_currency: str | None = None, discount_rate_currency: str | None = None) -> dict:
    """Mandatory checks before saving. 'fail' blocks saving; every 'warn' must be explained to the user."""
    return sanity.sanity_check(fair_value, current_price, terminal_growth, long_run_nominal_growth,
                               terminal_share_of_ev, eps, pe_history_range, ebitda_per_share,
                               net_debt_per_share, ev_ebitda_history_range, cash_flow_currency,
                               discount_rate_currency)


# ── risk ─────────────────────────────────────────────────────────────────────

@tool
def altman_z2(working_capital: float, retained_earnings: float, ebit: float, book_equity: float,
              total_liabilities: float, total_assets: float) -> dict:
    """Altman Z'' (emerging-market variant): >2.6 safe, 1.1-2.6 grey, <1.1 distress. Not for financials."""
    return altman_z2_calc(working_capital, retained_earnings, ebit, book_equity, total_liabilities, total_assets)


@tool
def piotroski_f(current: FinancialYear, prior: FinancialYear) -> dict:
    """Piotroski F-score from two fiscal years (see quality_scores_from_financials for required fields)."""
    return piotroski_f_calc(current.model_dump(), prior.model_dump())


@tool
def beneish_m(current: FinancialYear, prior: FinancialYear) -> dict:
    """Beneish M-score from two fiscal years; above -1.78 is a red flag to investigate, not proof."""
    return beneish_m_calc(current.model_dump(), prior.model_dump())


@tool
def risk_rating(symbol: str, metrics: dict[str, float] | None = None,
                z2_zone: Literal["safe", "grey", "distress"] | None = None,
                piotroski_score: int | None = None,
                beneish_flag: Literal["clear", "watch", "red"] | None = None,
                auditor_qualified_opinion: bool | None = None,
                government_pricing_exposure: bool | None = None,
                any_loss_year_5y: bool | None = None,
                government_ownership_share: float | None = None) -> dict:
    """Fixed-rule rating: safe (آمن) / balanced (متوازن) / high_risk (مرتفع المخاطر).

    metrics keys: debt_to_equity, interest_coverage, earnings_cv, avg_daily_traded_value_egp,
    annual_volatility, dividend_years_paid_of_5, valuation_range_width, top_customer_share,
    capital_increases_3y; banks also car, npl_ratio, coverage_ratio, loans_to_deposits,
    fx_open_position_to_capital. Red flags force high_risk.
    """
    entry = _require_symbol(symbol)
    return {"symbol": entry["symbol"], **rating_mod.risk_rating(
        is_bank=entry["valuation_model"] == "bank", metrics=metrics, z2_zone=z2_zone,
        piotroski_score=piotroski_score, beneish_flag=beneish_flag,
        auditor_qualified_opinion=auditor_qualified_opinion,
        government_pricing_exposure=government_pricing_exposure, any_loss_year_5y=any_loss_year_5y,
        government_ownership_share=government_ownership_share,
    )}


@tool
def pricing_levels(fair_value: float, current_price: float | None = None) -> dict:
    """Entry price = fair value; protection price = fair value x 0.80. Below protection requires critic review."""
    return pricing.pricing_levels(fair_value, current_price)


# ── valuation records ────────────────────────────────────────────────────────

@tool
def save_valuation(symbol: str, fair_value: float, bear: float, bull: float,
                   risk_rating: Literal["safe", "balanced", "high_risk"], financial_period: str,
                   methods: list[ScenarioMethod], assumptions: dict, sources: list[SourceRef],
                   sanity: dict, thesis: str, critic_notes: str, reason: str = "",
                   price_at_valuation: float | None = None, macro_snapshot: dict | None = None,
                   risk_details: dict | None = None) -> dict:
    """Store a full valuation after the critic review. Refused when the sanity check failed, sources are
    missing, or critic_notes are empty. `reason` explains the change versus the previous valuation."""
    entry = _require_symbol(symbol)
    with _db() as conn:
        return valuations.save_full_valuation(
            conn, entry["symbol"], fair_value, bear, bull, risk_rating, financial_period,
            [m.model_dump() for m in methods], assumptions, [s.model_dump() for s in sources], sanity,
            thesis, critic_notes, reason, price_at_valuation, macro_snapshot, risk_details,
        )


@tool
def record_light_update(symbol: str, current_price: float, notes: str) -> dict:
    """Weekly light update: keep the last full fair value, record today's price and what was checked."""
    entry = _require_symbol(symbol)
    with _db() as conn:
        return valuations.record_light_update(conn, entry["symbol"], current_price, notes)


@tool
def get_latest_valuation(symbol: str) -> dict | None:
    """The most recent valuation (full or light) with assumptions, sources and critic notes."""
    with _db() as conn:
        return valuations.latest_valuation(conn, normalize_symbol(symbol))


@tool
def get_valuation_history(symbol: str, limit: int = 20) -> dict:
    """Past valuations and the fair-value change log with the reason for each change."""
    with _db() as conn:
        return valuations.valuation_history(conn, symbol, limit)


@tool
def list_latest_valuations() -> list[dict]:
    """The latest valuation for every symbol that has one."""
    with _db() as conn:
        return valuations.latest_per_symbol(conn)


@tool
def weekly_check(symbol: str) -> dict:
    """Decide light update vs full revaluation: new financial period, rate or FX shifts,
    material events since the last valuation, or price below the protection price."""
    entry = _require_symbol(symbol)
    with _db() as conn:
        return weekly.weekly_check(conn, default_provider(), entry["symbol"])


# ── portfolio (user-entered) ─────────────────────────────────────────────────

@tool
def portfolio_add(symbol: str, buy_price: float, quantity: float | None = None,
                  invested_amount: float | None = None, buy_date: str | None = None,
                  note: str | None = None) -> dict:
    """Add a holding the user entered: give quantity, or the amount invested in EGP."""
    with _db() as conn:
        return portfolio.add_holding(conn, symbol, buy_price, quantity, invested_amount, buy_date, note)


@tool
def portfolio_update(holding_id: int, quantity: float | None = None, buy_price: float | None = None,
                     buy_date: str | None = None, note: str | None = None) -> dict:
    """Edit a holding the user entered."""
    with _db() as conn:
        return portfolio.update_holding(conn, holding_id, quantity, buy_price, buy_date, note)


@tool
def portfolio_remove(holding_id: int) -> dict:
    """Remove a holding the user entered."""
    with _db() as conn:
        return portfolio.remove_holding(conn, holding_id)


@tool
def portfolio_summary() -> dict:
    """Holdings with market value, P/L, weight, fair value, risk rating and protection price."""
    with _db() as conn:
        return portfolio.portfolio_summary(conn, default_provider())


def main() -> None:
    server.run("stdio")


if __name__ == "__main__":
    main()
