---
name: egx-risk-rating
description: How to produce the safe / balanced / high-risk rating for an EGX30 stock from fixed criteria and red flags. Load from egx-valuation step 7, or when the user asks how risky a stock is.
---

# Risk rating (آمن / متوازن / مرتفع المخاطر)

The rating is computed by `risk_rating` from fixed thresholds. Your job is to supply complete, sourced inputs and explain the result; never override it.

## Inputs
1. `get_company_data(symbol).derived_metrics.metrics` → pass as `metrics` (volatility, earnings CV, dividend record, debt/equity, interest coverage) and `any_loss_year_5y`.
2. Add what you can source:
   - `valuation_range_width` from `combine_scenarios.range_width`
   - `avg_daily_traded_value_egp` (exchange data), `top_customer_share` (annual report disclosures), `capital_increases_3y` (rights issues in the last 3 years, from events/disclosures)
   - Banks: `car`, `npl_ratio`, `coverage_ratio`, `loans_to_deposits`, `fx_open_position_to_capital`
3. Non-financials: `quality_scores_from_financials` → `z2_zone`, `piotroski_score`, `beneish_flag`.
4. `auditor_qualified_opinion`: read the auditor's report in the latest annual statements. Treat "emphasis of matter" as not qualified, but mention it.
5. `government_pricing_exposure`, `government_ownership_share` (information only).

## Red flags (force high_risk)
Qualified auditor opinion; Altman distress zone; Beneish M above −1.78; bank CAR at or below the regulatory floor.

## Reporting
- Give the rating with its Arabic label, the 2-3 criteria that drove it, and every red flag.
- If `confidence` is `low`, say the rating rests on few criteria and list `missing` items the user could fill.
- Describe risk; do not translate it into advice (no "avoid", "safe to buy").
