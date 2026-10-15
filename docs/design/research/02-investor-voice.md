# Investor voice: what retail investors love/hate in research and portfolio tools

**Evidence caveat.** Reddit is blocked to the fetcher and search surfaced almost no thread text. Direct voice below comes from Reddit-aggregated quotes (GummySearch), Trustpilot (Simply Wall St, Sharesight) and review/comparison blogs. Items marked *[inferred]* are my synthesis of well-known patterns, not sourced quotes. Treat rankings as directional, not counted.

## 1. What users love (ranked by frequency in sources)
1. **Instant orientation / one-glance summary.** Simply Wall St's Snowflake "gives a fast, structured overview", good for "unfamiliar names"; reports are "plain-language" (https://quantroutine.com/tools/simply-wall-st/, https://curvedtrading.com/articles/en/reviews/best-stock-analysis-app-investors-2026). Trustpilot: "Very informative and easy to navigate", "Makes researching stocks and markets a lot easier" (https://www.trustpilot.com/review/simplywall.st?page=3).
2. **Alerts on holdings.** "I also like getting alerts sent to my phone updating me on any developments with my holdings" (same Trustpilot page). Review also credits "watchlist alerts... for passive monitoring".
3. **Portfolio clarity incl. dividends/income/currency.** Sharesight reviewers: "see capital gain and currency and dividend pa which is great", praise for the future-income report and calendar, and replacing "error-prone and time-consuming" spreadsheets (https://www.trustpilot.com/review/sharesight.com).
4. **Free tier that's real + fair price.** "I also like using the free Koyfin screener"; "Finviz has a great free general screener"; Sharesight cost "a very small percentage of my portfolio value" (https://gummysearch.com/tools/best-products/stock-screeners/).
5. **Historical depth / data trust.** "TIKR... has data starting in 2005 for pretty much all companies" (GummySearch). Blogs repeatedly advise cross-checking against filings, i.e. source visibility matters.
6. **Explanatory affordances.** "Love the legend pop up descriptions on the statements" (Stockanalysis.com, GummySearch). Cheap to build, loved.
7. **Density for table-first users** (TIKR "spreadsheet-oriented and dense", suits table-first users; Koyfin customizable dashboards but "steeper learning curve") (curvedtrading, traderhq.com/koyfin-vs-tikr/). Keyboard speed: no sourced quotes found *[inferred: valued by power users, e.g. HN's Stonks-CLI show-and-tells]* (https://github.com/igoropaniuk/stonks-cli).

## 2. What makes people open it daily
Sourced: phone alerts about holdings; income calendar / upcoming dividends (Sharesight); watchlist monitoring. *[Inferred]*: "how is my portfolio today" glance, earnings dates, a "what changed since yesterday" feed. For an end-of-day tool, the daily hook is a single post-close digest: total P/L, biggest movers, any stock that crossed its entry or protection price, any analysis updated. HN shows demand for "true performance (TWR/XIRR)" trackers (https://klynda.com/) and encrypted/private trackers (HN Ask thread 43102510), which fits a local-first Mac app.

## 3. Top frustrations / abandonment reasons
1. **Paywalls and usage caps.** "5 free screens /month then there is a annual fee" (GummySearch); SWS free = ~5 reports/month, 5 portfolio companies (quantroutine); Sharesight: advanced reports "on the top paywall tier". Finviz Premium "great but costly".
2. **Untrusted/bad data.** "They are auto generating bad information" (SWS 1-star); Sharesight missing securities/bonds; "Future growth axis unreliable for small caps with thin coverage"; automated reports "miss M&A, restructuring, one-offs" (quantroutine). Directly relevant to EGX: thin coverage + manual gaps.
3. **Slow.** "Takes a long time before the app opens." (SWS Trustpilot).
4. **Regional coverage gaps.** "Koyfin is more polished but primarily US" (GummySearch).
5. **Complexity / learning curve.** "steep learning curve" (StreetSmart Edge); onboarding confusion about portfolios (SWS). Over-simplification is also hated: Sharesight's new app "way too simple with far more clicks required to get relevant information".
6. **Billing surprises.** "No reminder that ones subscription is about to expire" (SWS).
7. **Manual-entry pain.** "no bulk transfer options at all and you can only import buy and sell trades" (Sharesight). Ads/clutter: no quotes found *[inferred]*.

## 4. Attitudes to fair value / black-box ratings
- Strongest sourced criticism: SWS fair value is "an opinion, not a calculation you can interrogate or modify"; growth and discount rate "set automatically and generally can't be changed" (quantroutine). Advanced investors find this "limiting".
- Intrinsic values "depend heavily on assumptions about growth, discount rates, and terminal values" (curvedtrading). Morningstar ratings treated by DIY users "as just one input".
- All apps "draw on the same public filings", so differentiation is workflow and presentation, and cross-checking against filings is advised (curvedtrading).
- What builds trust *[synthesis of the above]*: show the key assumptions behind the number; show a range not a point; show the data source and as-of date; allow the user to see why the value moved (change log); show when coverage is thin; expose a simple "what would change my mind" (bull/bear inputs). Margin-of-safety framing (Graham-style) is familiar to value investors (https://en.wikipedia.org/wiki/Margin_of_safety_(financial)); a fixed 20% protection discount is intuitive but must be labelled as a rule, not a forecast.

## 5. Portfolio must-haves for manual entry
Sourced/derived: fast add of buys/sells/dividends with bulk or CSV import (Sharesight complaint); dividends + income calendar; per-position and total P/L with cost basis and currency; replacing spreadsheets means export/paste-friendly tables. *[Inferred but standard]*: edit/undo, multiple lots, fees, split handling, cash balance, TWR vs simple return explanation (HN Klynda), private local storage (HN encrypted tracker ask), clear "prices as of close DD-MMM" label, and a value-vs-fair/entry/protection column linking portfolio to analysis.

## 6. Ten design implications (ranked)
1. **One-glance verdict row on every stock:** price vs fair-value range bar with entry and protection markers, risk chip. Mirrors the Snowflake's appeal without being a black box.
2. **Show assumptions and sources on the report page** (growth, margin, discount, peers, filing dates) in a collapsible "How this value was built". Directly answers the "opinion, not calculation" criticism.
3. **Fair value as a range, with a visible history of changes** (date, old to new, one-line reason) in the Analyses archive. Builds trust over time.
4. **Always stamp data freshness** ("Close 14 Oct 2026", analysis date, age warning when stale). Stale/untrusted data is a top abandonment reason; delayed EOD is fine if honest.
5. **Speed and density first:** instant launch, local cache, dense sortable/filterable market table, keyboard navigation (j/k, /, g-then-key), saved views. Slowness and clutter are repeat complaints.
6. **Daily digest on launch:** "since last close" strip with portfolio change, movers, stocks that crossed entry or protection, new/updated analyses. This is the habit loop for an EOD tool.
7. **Portfolio tied to analysis:** per holding show P/L, distance to fair value, distance to protection price, dividends. Fast manual entry (keyboard-only add, paste/CSV import, lots, fees, dividends, splits), plus export.
8. **Alerts on state changes, not prices only:** crossing entry/protection, rating change, analysis revised. Local notifications; no account needed.
9. **Be generous and never nag:** no paywall mechanics, no ads, no usage caps; plain-language one-line explanations and hover legends on every metric (cheap, loved).
10. **Honest limits:** flag thin-coverage or low-confidence analyses, state "not a recommendation" once and clearly, and label protection price as a rule (fair x 0.8) rather than a prediction. Resist over-simplifying: keep a power-user path (full numbers one click away).

## Sources
- https://gummysearch.com/tools/best-products/stock-screeners/ (Reddit-sourced quotes)
- https://quantroutine.com/tools/simply-wall-st/
- https://curvedtrading.com/articles/en/reviews/best-stock-analysis-app-investors-2026
- https://www.trustpilot.com/review/simplywall.st?page=3
- https://www.trustpilot.com/review/sharesight.com
- https://traderhq.com/koyfin-vs-tikr/
- HN: https://klynda.com/, https://github.com/igoropaniuk/stonks-cli, HN item 43102510 (encrypted tracker)
