---
name: egx-sector-realestate
description: Valuation method for EGX real-estate developers (RNAV of land bank, backlog and recurring assets, with P/B cross-check). Load from egx-valuation when valuation_model is real_estate.
---

# Real-estate developers

Accounting earnings lag sales (revenue is recognised on delivery), so P/E misleads. Value what the company owns and has already sold.

## Primary: RNAV
Build components for `value_nav`:
- **Backlog / unrecognised sales**: contracted sales not yet recognised × expected margin, discounted over the delivery schedule (use `value_dcf` on the expected cash flows, shares_outstanding=1, to get a present value).
- **Land bank**: remaining sellable area × expected margin per sqm, discounted over a realistic sell-out period. Long sell-out periods in an EGP-inflation environment make discounting decisive; state both the sell-out years and the rate.
- **Recurring-income assets** (hotels, malls, offices): DCF of rental/operating income or a cap-rate value.
- **Net cash or net debt** at parent level, **customer advances** treated as liabilities already funded by buyers.
Apply an RNAV discount for execution risk and long sell-out horizons; justify it.

## Cross-check
`value_multiples` with P/B against the company's own history.

## Scenario drivers
Sales velocity (pre-sales pace), price increases vs construction-cost inflation, collection quality (cancellations, instalment defaults), land payment obligations, FX-linked costs.

## Risk notes
Pass `capital_increases_3y`, liquidity and volatility metrics to `risk_rating`. Heavy instalment receivables and land payables increase risk even when reported debt is low; say so in the report.
