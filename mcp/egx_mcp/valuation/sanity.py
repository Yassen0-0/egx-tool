TERMINAL_SHARE_WARN = 0.75
UPSIDE_WARN = 1.0
DOWNSIDE_WARN = -0.5


def _check(name: str, status: str, message: str) -> dict:
    return {"check": name, "status": status, "message": message}


def sanity_check(
    fair_value: float | None = None,
    current_price: float | None = None,
    terminal_growth: float | None = None,
    long_run_nominal_growth: float | None = None,
    terminal_share_of_ev: float | None = None,
    eps: float | None = None,
    pe_history_range: list[float] | None = None,
    ebitda_per_share: float | None = None,
    net_debt_per_share: float | None = None,
    ev_ebitda_history_range: list[float] | None = None,
    cash_flow_currency: str | None = None,
    discount_rate_currency: str | None = None,
) -> dict:
    """Mandatory checks that stop over-optimistic or inconsistent valuations.

    Any `fail` means the valuation must be revised before it is saved; a
    `warn` must be explained in the report.
    """
    checks: list[dict] = []

    if terminal_growth is not None and long_run_nominal_growth is not None:
        if terminal_growth > long_run_nominal_growth:
            checks.append(_check("terminal_growth", "fail",
                f"terminal growth {terminal_growth:.2%} exceeds long-run nominal growth {long_run_nominal_growth:.2%}"))
        else:
            checks.append(_check("terminal_growth", "pass", "terminal growth within long-run nominal growth"))

    if terminal_share_of_ev is not None:
        if terminal_share_of_ev > TERMINAL_SHARE_WARN:
            checks.append(_check("terminal_share", "warn",
                f"terminal value is {terminal_share_of_ev:.0%} of enterprise value; the valuation leans on the far future"))
        else:
            checks.append(_check("terminal_share", "pass", f"terminal value is {terminal_share_of_ev:.0%} of enterprise value"))

    if cash_flow_currency and discount_rate_currency:
        if cash_flow_currency.upper() != discount_rate_currency.upper():
            checks.append(_check("currency_consistency", "fail",
                f"cash flows in {cash_flow_currency} discounted at a {discount_rate_currency} rate"))
        else:
            checks.append(_check("currency_consistency", "pass", "cash flows and discount rate share a currency"))

    if fair_value is not None and current_price:
        gap = fair_value / current_price - 1
        if gap > UPSIDE_WARN or gap < DOWNSIDE_WARN:
            checks.append(_check("price_gap", "warn",
                f"fair value is {gap:+.0%} from the market price; explain why the market is wrong or revisit assumptions"))
        else:
            checks.append(_check("price_gap", "pass", f"fair value is {gap:+.0%} from the market price"))

    if fair_value is not None and eps and pe_history_range:
        implied_pe = fair_value / eps
        low, high = min(pe_history_range), max(pe_history_range)
        status = "pass" if low <= implied_pe <= high else "warn"
        checks.append(_check("implied_pe", status,
            f"implied P/E {implied_pe:.1f}x vs historical range {low:.1f}x-{high:.1f}x"))

    if fair_value is not None and ebitda_per_share and ev_ebitda_history_range:
        implied_ev_ebitda = (fair_value + (net_debt_per_share or 0.0)) / ebitda_per_share
        low, high = min(ev_ebitda_history_range), max(ev_ebitda_history_range)
        status = "pass" if low <= implied_ev_ebitda <= high else "warn"
        checks.append(_check("implied_ev_ebitda", status,
            f"implied EV/EBITDA {implied_ev_ebitda:.1f}x vs historical range {low:.1f}x-{high:.1f}x"))

    statuses = {c["status"] for c in checks}
    overall = "fail" if "fail" in statuses else "warn" if "warn" in statuses else "pass"
    return {"overall": overall, "checks": checks}
