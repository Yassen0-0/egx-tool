"""Valuation calculator for the learning-loop analysts: the project's own pure valuation functions plus
three helpers the loop found missing, behind one JSON command line.

It imports only egx_mcp.valuation (no store, no database), so nothing here can save a valuation or
touch data/egx.sqlite.

    uv run --project /Volumes/ssd-work/egx/mcp python -I tools/calc.py <command> '<json args>'
    uv run --project /Volumes/ssd-work/egx/mcp python -I tools/calc.py list

Rates are decimals (0.2567, not 25.67). Amounts in one currency and unit.
"""
import json
import sys

from egx_mcp.errors import ValuationInputError
from egx_mcp.valuation import bank, dcf, ddm, multiples, nav, rates, sanity, scenarios


def ke_two_stage(risk_free_now: float, risk_free_normal: float, equity_risk_premium: float,
                 beta: float = 1.0) -> dict:
    """Stage 1 (first 3 years) uses today's EGP government yield; stage 2 (terminal) a normalised one
    (inflation target + real rate). Same premium in both, so country risk is counted once."""
    stage1 = rates.capm_cost_of_equity(risk_free_now, beta, equity_risk_premium)
    stage2 = rates.capm_cost_of_equity(risk_free_normal, beta, equity_risk_premium)
    return {"ke_stage1": stage1["cost_of_equity"], "ke_stage2": stage2["cost_of_equity"],
            "stage1": stage1, "stage2": stage2}


def residual_income(book_value_per_share: float, roe_path: list[float], ke_stage1: float,
                    ke_stage2: float, terminal_roe: float, long_term_growth: float,
                    payout_path: list[float], stage1_years: int = 3) -> dict:
    """Equity value per share = BV0 + PV of (ROE - Ke) x BV over the explicit years + PV of a terminal
    residual income growing at g. Years up to stage1_years discount at ke_stage1, later years and the
    terminal value at ke_stage2. Use this instead of a closed-form P/B when Ke changes over time."""
    if ke_stage2 <= long_term_growth:
        raise ValuationInputError("ke_stage2 must be greater than long_term_growth")
    if book_value_per_share <= 0 or not roe_path:
        raise ValuationInputError("book_value_per_share must be positive and roe_path non-empty")
    payout = payout_path
    if len(payout) != len(roe_path):
        raise ValuationInputError("payout_path must have the same length as roe_path")
    bv, factor, pv_ri, rows = book_value_per_share, 1.0, 0.0, []
    for year, (roe, pay) in enumerate(zip(roe_path, payout), start=1):
        ke = ke_stage1 if year <= stage1_years else ke_stage2
        factor /= 1 + ke
        ri = (roe - ke) * bv
        pv_ri += ri * factor
        rows.append({"year": year, "book_value": bv, "roe": roe, "ke": ke, "residual_income": ri,
                     "pv": ri * factor})
        bv += bv * roe * (1 - pay)
    terminal_ri = (terminal_roe - ke_stage2) * bv
    pv_terminal = terminal_ri / (ke_stage2 - long_term_growth) * factor
    value = book_value_per_share + pv_ri + pv_terminal
    return {"method": "residual_income", "value_per_share": value, "pv_explicit": pv_ri,
            "pv_terminal": pv_terminal, "terminal_share": pv_terminal / value if value else None,
            "years": rows}


def implied_ke_pb(price: float, book_value_per_share: float, sustainable_roe: float,
                  long_term_growth: float) -> dict:
    """Cost of equity the market price implies through P/B = (ROE - g) / (Ke - g)."""
    pb = price / book_value_per_share
    if pb <= 0:
        raise ValuationInputError("price and book value must be positive")
    return {"market_pb": pb, "implied_ke": long_term_growth + (sustainable_roe - long_term_growth) / pb}


def implied_ke_pe(price: float, eps_next: float, payout: float, long_term_growth: float) -> dict:
    """Cost of equity the price implies through the Gordon model on next-year dividends."""
    return {"implied_ke": eps_next * payout / price + long_term_growth}


def pv_even_stream(total: float, years: float, rate: float, rate_after: float | None = None,
                   switch_year: int = 3) -> dict:
    """Present value of an amount realised evenly over `years` (e.g. an after-tax backlog margin
    delivered over backlog / trailing development revenue years). Years up to `switch_year` discount at
    `rate` (Ke1); later years at `rate_after` (Ke2) when given, compounding on the stage-1 factor."""
    if years <= 0 or rate <= -1:
        raise ValuationInputError("years must be positive and rate above -100%")
    per_year = total / years
    pv, factor, t = 0.0, 1.0, 0
    remaining = years
    while remaining > 0:
        t += 1
        r = rate if rate_after is None or t <= switch_year else rate_after
        factor /= 1 + r
        share = min(1.0, remaining)
        pv += per_year * share * factor
        remaining -= share
    return {"present_value": pv, "per_year": per_year, "discount_factor": pv / total if total else None}


def margin_of_safety(fair_value: float, price: float) -> dict:
    """(fair value - price) / fair value."""
    if fair_value <= 0:
        raise ValuationInputError("fair_value must be positive")
    return {"margin_of_safety": (fair_value - price) / fair_value}


COMMANDS = {
    "capm_cost_of_equity": rates.capm_cost_of_equity,
    "wacc": rates.wacc,
    "ke_two_stage": ke_two_stage,
    "value_dcf": dcf.fcff_dcf,
    "value_multiples": multiples.value_from_multiples,
    "value_ddm": ddm.dividend_discount,
    "value_nav": nav.net_asset_value,
    "value_bank_pb": bank.justified_pb,
    "residual_income": residual_income,
    "implied_ke_pb": implied_ke_pb,
    "implied_ke_pe": implied_ke_pe,
    "combine_scenarios": scenarios.combine_scenarios,
    "sanity_check": sanity.sanity_check,
    "pv_even_stream": pv_even_stream,
    "margin_of_safety": margin_of_safety,
}


RATE_KEYS = {"risk_free_rate", "risk_free_now", "risk_free_normal", "equity_risk_premium", "cost_of_equity",
             "ke_stage1", "ke_stage2", "long_term_growth", "terminal_growth", "wacc", "rate", "sustainable_roe",
             "terminal_roe", "payout", "discount", "rate_after"}


def _check_rates(args: dict) -> None:
    """Rates must be decimals: 0.2567, not 25.67."""
    for key, value in args.items():
        values = value if isinstance(value, list) else [value]
        if (key in RATE_KEYS or key in ("roe_path", "payout_path")) and any(
                isinstance(v, (int, float)) and abs(v) > 1 for v in values):
            raise ValuationInputError(f"{key} looks like a percentage; pass decimals (0.25 not 25)")


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] == "list":
        import inspect
        print(json.dumps({name: str(inspect.signature(fn)) for name, fn in COMMANDS.items()}, indent=1))
        return
    fn = COMMANDS.get(sys.argv[1])
    if fn is None:
        print(json.dumps({"error": f"unknown command {sys.argv[1]}; run 'list'"}))
        sys.exit(2)
    try:
        args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
        _check_rates(args)
        print(json.dumps(fn(**args), ensure_ascii=False, indent=1))
    except (ValuationInputError, TypeError, KeyError, ValueError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        sys.exit(2)


if __name__ == "__main__":
    main()
