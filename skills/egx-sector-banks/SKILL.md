---
name: egx-sector-banks
description: Valuation method for EGX banks (justified P/B with P/E cross-check, bank-specific risk metrics). Load from egx-valuation when the universe entry's valuation_model is bank.
---

# Banks

DCF and EV-based multiples do not fit banks: debt is raw material, not financing. Do not use `value_dcf`, `altman_z2`, `piotroski_f` or `beneish_m` for banks.

## Primary: justified P/B
`value_bank_pb(book_value_per_share, sustainable_roe, cost_of_equity, long_term_growth)`
- Book value per share: latest reported equity attributable to shareholders ÷ shares. Exclude perpetual/AT1 instruments if reported inside equity.
- Sustainable ROE: not the peak year. Look at 3-5 years and ask how much of current ROE comes from unusually high rates or FX revaluation gains that will fade as rates normalise. Bear case uses a normalised (lower) ROE.
- Cost of equity: `capm_cost_of_equity` with the EGP risk-free rate.
- Long-term growth: at most `long_run_nominal_growth`.

## Cross-check: P/E
`value_multiples(eps=..., pe=...)` with the bank's own historical P/E range or named listed peers. Weight it lower than P/B unless earnings are clearly normalised.

## Scenario drivers
- Rate cycle: margin compression when rates fall (bear) vs sustained margins (bull).
- Asset quality: NPL ratio and cost of risk rising (bear).
- Capital: CAR headroom limits growth and dividends.
- FX: open position gains or losses.

## Bank risk metrics for `risk_rating`
Pass in `metrics`: `car`, `npl_ratio`, `coverage_ratio`, `loans_to_deposits`, `fx_open_position_to_capital`, plus the general ones that apply (`earnings_cv`, `annual_volatility`, `avg_daily_traded_value_egp`, `dividend_years_paid_of_5`, `valuation_range_width`). A CAR at or below the regulatory floor is a red flag.
