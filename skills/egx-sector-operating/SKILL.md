---
name: egx-sector-operating
description: Valuation method for EGX operating companies — industrials, consumer, healthcare, telecom, fintech, commodities (FCFF DCF with multiples and optional DDM cross-checks, currency and government-pricing handling). Load from egx-valuation when valuation_model is operating.
---

# Operating companies

## Primary: FCFF DCF
`value_dcf(fcff_forecast, wacc, terminal_growth, net_debt, shares_outstanding, minority_interest, non_operating_assets)`
- Forecast 5 years (FCFF = EBIT × (1 − tax) + depreciation − capex − change in working capital). Show the table in `assumptions`.
- WACC from `capm_cost_of_equity` and `wacc`, in the same currency as the cash flows.
- Terminal growth ≤ `long_run_nominal_growth`; terminal FCFF must reflect a steady-state reinvestment, not a capex holiday.
- Use `mid_year=true` when cash flows accrue through the year.

## Cross-checks
- `value_multiples` with P/E and EV/EBITDA from the company's own history or named peers.
- `value_ddm` for stable, high-payout companies (tobacco, mature consumer, telecom with a steady dividend policy).
Weight the DCF highest unless forecasts are unreliable; say why when you change that.

## Currency and Egypt specifics
- **Exporters and commodity producers** (fertilizers, petrochemicals, aluminium, refining): revenue is USD-linked. Either model in USD with a USD discount rate and convert at the current rate, or model in EGP with an explicit FX path. Never discount USD cash flows at an EGP rate. Run FX scenarios (bear: EGP stronger than expected for exporters).
- **Importers and USD debt**: FX weakness hurts margins and inflates debt; include it in the bear case.
- **Government pricing exposure** (regulated product prices, energy/feedstock prices set by the state, e.g. tobacco, pharma, fertilizer gas): margins depend on decisions outside the company. Model a bear case with an adverse price decision and pass `government_pricing_exposure=true` to `risk_rating`.
- **Companies reporting in USD**: check the currency in `get_company_data().financials.currency` before anything else.
- **Stakes in other companies** (e.g. a telecom holding a stake in another operator): value them separately and add through `non_operating_assets`.

## Statement scores
Run `quality_scores_from_financials(symbol)` and pass Altman zone, Piotroski score and Beneish flag to `risk_rating`. If fields are missing, list them for the user rather than estimating.
