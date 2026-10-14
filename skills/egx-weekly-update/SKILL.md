---
name: egx-weekly-update
description: Weekly review of all EGX30 valuations — light update when nothing material changed, full revaluation when results, rates, FX or material events changed, with a change log. Use for the scheduled weekly run or when the user asks to refresh valuations.
---

# Weekly update

## For each symbol in `universe_list` that has a valuation (`list_latest_valuations`)
1. Before checking, refresh what you can: look for new disclosures, results and material news since the last valuation date (web search of official sources). New events belong in `data/manual/events.csv`, new prices in `prices.csv`; tell the user which rows to add if you cannot write files.
2. `weekly_check(symbol)`.
3. If `needs_full_revaluation` is false: `record_light_update(symbol, current_price, notes)` where notes list what was checked and found (e.g. "no disclosures since 2026-10-01; price 12.40").
4. If true: run the full `egx-valuation` skill. Its `reason` must cite the `weekly_check` reasons (new period, rate shift, FX move, event, below protection).

Symbols without any valuation are listed in the summary as "not yet valued"; do not value all of them in one weekly run unless the user asks.

## Summary to the user
A table: symbol, previous fair value, new fair value, change %, rating, price vs protection, and the reason for each change. Then a short list of stocks that moved below their protection price, each with the critic's two explanations. No recommendations.
