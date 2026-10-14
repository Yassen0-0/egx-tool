---
name: egx-valuation
description: Full fair-value valuation of one EGX30 stock — macro themes, method choice by sector, sourced assumptions, tool-computed scenarios, sanity checks, risk rating, critic review, then save. Use whenever the user asks what a stock is worth, for its fair value, or to (re)value a company.
---

# EGX30 full valuation

Follow every step in order. Do not skip steps to answer faster. All arithmetic goes through `mcp__egx__*` tools.

## 1. Gather data
- `get_company_data(symbol)`: price, financial periods, macro inputs, events, derived metrics. Note `missing`.
- `get_latest_valuation(symbol)` and `get_valuation_history(symbol)`: know what was concluded before and why.
- If the price, the latest fiscal year, or the EGP risk-free rate is missing, stop and tell the user exactly which file under `data/manual/` to fill (see the templates). Use web search only to locate official documents; every number you take from the web must be listed in `sources` with its URL and date.

## 2. Themes before numbers
Before any calculation, write 3-5 lines answering:
- What is the macro backdrop now (policy rate and T-bill yields, inflation, EGP direction)?
- Which theme does this company sit in, if any: banks in high-rate periods; exporters / USD earners benefiting from a weaker EGP; low debt and net cash; consumer pricing power; defensives (staples, healthcare, education, telecom, utilities)?
- Is the company on the winning or losing side of that backdrop, and why?
This shapes growth and margin assumptions; it does not replace them.

## 3. Choose methods from the universe entry
Read `valuation_model` from `universe_list` and load the matching skill:
- `bank` → `egx-sector-banks`
- `holding`, `nonbank_financial` → `egx-sector-holding`
- `real_estate` → `egx-sector-realestate`
- `operating` → `egx-sector-operating`
If the entry has `needs_review: true`, explain its `note` and confirm the method choice in your report.

## 4. Assumptions with sources
For every input (growth, margins, capex, WACC parts, multiples, ROE, NAV components) state the value, why, and where it came from. Rules:
- Discount EGP cash flows with an EGP rate built from the EGP risk-free rate. Never mix currencies (`sanity_check` fails it).
- Terminal growth must not exceed `long_run_nominal_growth`.
- Multiples come from the company's own history or named peers, never "typical" values.
- Use `capm_cost_of_equity` and `wacc` to compute rates.

## 5. Compute three scenarios
Run each chosen method for bear, base and bull assumptions using the value tools. Then `combine_scenarios` with method weights you justify. The base case is the fair value.

## 6. Sanity check
Call `sanity_check` with everything you have (fair value, current price, terminal growth vs long-run growth, terminal share of EV, implied P/E and EV/EBITDA vs history, currencies).
- `fail` → revise assumptions and recompute. Never save a failing valuation.
- `warn` → keep only if you can explain it; the explanation goes in the report.

## 7. Risk rating
Load `egx-risk-rating` and produce the rating with `risk_rating`.

## 8. Pricing levels
`pricing_levels(fair_value, current_price)`: entry price = fair value, protection price = fair value × 0.80.
If `review_required` is true (price already below protection), the critic step must address it explicitly.

## 9. Critic review (mandatory)
Load `egx-critic` and run it. Revise and recompute if the critic finds a material problem.

## 10. Save
`save_valuation` with methods, assumptions, sources, the sanity result, thesis, critic notes, `macro_snapshot` (the macro values you used, as returned by `get_company_data`), and `reason` (what changed vs the previous valuation, if any).

## 11. Report to the user (in the user's language; Arabic by default)
1. Current price and date; fair value (base) and range (bear-bull).
2. Entry price and protection price, and where the market price sits relative to them.
3. Risk rating with its main drivers and any red flags.
4. Thesis in 3-5 lines and the risks that would break it.
5. Key assumptions table with sources.
6. Sanity warnings and how they were handled; the critic's main points.
7. Change vs the previous valuation and why.
End with: this is a valuation analysis, not a recommendation to buy or sell; the decision is the user's.
