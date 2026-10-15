# UX patterns from stock-analysis tools (for an EGX30 valuation-only Mac tool)

Evidence tags: [F] fetched/verified this session; [K] from general product knowledge, not re-verified (TradingView, Yahoo, Koyfin/TIKR/Stock Rover details, Finviz screener specifics).

## Per-tool findings

### Simply Wall St
- **Snowflake**: 5 axes (Valuation, Future growth, Past performance, Financial health, Dividend), each = count of 6 pass/fail checks; colour red→green by total; per-axis score on hover; built for fast scan of one stock/group/market. [F] https://support.simplywall.st/hc/en-us/articles/360001740916-How-does-the-Snowflake-work
- **Valuation bar** [K]: horizontal bar with price marker vs fair-value marker and "x% below/above fair value" text; checks list is pass/fail with plain-language sentence each.
- **Explicit rule**: states the Snowflake is "NOT a buy or sell recommendation" and that a low axis score doesn't rule a stock out (context-dependent). [F]
- Learn: decomposed score (checks) the user can audit; one-glance shape + drill-down. Avoid: collapsing everything into a single colour/shape that invites "green = buy"; Snowflakes for non-comparable asset types (they use a different colour for funds) [F].

### Morningstar
- **Fair value estimate (DCF-based) + Price/Fair Value ratio**, moat (none/narrow/wide + trend), **uncertainty rating** (low…extreme) that widens the required margin of safety; fair value drifts up at cost of equity. [F] https://s205.q4cdn.com/437373358/files/doc_downloads/2025/07/Morningstar-Equity-Research-Methodology-2023-06-14.pdf ; https://www.morningstar.com/investing-terms/price-fair-value
- Stars are defined by P/FV thresholds that depend on uncertainty: higher uncertainty → bigger discount needed for same stars. [F]
- Disclosures: stars are "guideposts", not advice; user's goals/risk/time horizon matter. [F]
- Learn: show uncertainty next to fair value (our bear/base/bull range = same idea); define each label in words; P/FV as a single comparable number.
- Avoid: star ratings whose top end ("5 stars", "highly likely appreciation") read as buy signals; stars dominate the page.

### GuruFocus (GF Value)
- **GF Value line chart**: price line (light blue) vs solid GF Value line, dotted future line; area between them shaded green (below value) / red (above), darker = further; ±~10% unshaded "fairly valued" band. Six labels from significantly overvalued to significantly undervalued, plus "possible value trap". [F] https://www.gurufocus.com/news/1474914/behind-the-numbers-the-gf-value-chart
- Caveats are printed: unreliable for investment-portfolio businesses; "data out of date, use caution" for semiannual reporters; future line inherits analyst uncertainty. [F]
- Learn: price-vs-value-over-time with shaded gap and a neutral band; per-stock reliability warnings.
- Avoid: single-line fair value with no range; "value trap" style verdict labels edge toward advice; "undervalued" colour = green invites buying.

### Seeking Alpha (Quant)
- Five factor grades A+…F (Value, Growth, Profitability, Momentum, EPS Revisions) relative to sector peers; overall label Strong Buy…Strong Sell + 1–5 score; refreshed once daily before open; weak factor can cap rating (rule disclosed). [F] https://help.seekingalpha.com/premium/quant-ratings-and-factor-grades-faq
- Learn: sector-relative grades; "updated daily" stated; disclosed capping rules.
- Avoid: the Buy/Sell label — exactly what our rule forbids; also letter grades hide absolute levels.

### Koyfin
- Widget-based customizable dashboards (charts, watchlists, screener output, macro) saved as views; screener shows percentile vs own history/sector. [F] https://quantroutine.com/tools/stockanalysis-vs-koyfin-vs-tikr/
- Learn: saved column sets/views; percentile-vs-history context instead of verdicts.
- Avoid: steep configuration learning curve; empty blank-canvas setup [F]. Solo user needs good defaults.

### TIKR
- Dense, spreadsheet-like financials; deep history; scenario-style valuation/estimates [K for scenarios]. Minimal charting. [F] same quantroutine source.
- Learn: financials as clean multi-year tables with consistent row order, easy copy/export.
- Avoid: wall of numbers with no hierarchy ("not beginner-friendly") [F].

### Finviz
- **Heat map**: box size = market cap, colour = performance, click sector → zoom → stock; time-window dropdown; overlays. Screener: dozens of filters on a dense table. [F] https://thinkinsights.net/insights/finviz-free-analysis-tool
- Learn: colour-coded dense table at small font; sector zoom; a "weekly scan" ritual surface.
- Avoid: red/green on performance only teaches day-trading framing; relies on third-party data without provenance per figure [F].

### Stock Rover
- Brokerage-synced portfolios with daily record, holdings movers by dollar impact, calendar of earnings/income, percentile-rank screening, 800+ metrics. [F] https://www.stockrover.com/?p=46603 (vendor page, biased)
- Learn: portfolio view sorted by contribution ("what moved my P/L"), percentile ranks.
- Avoid: metric overload; "functional, research-first" visuals [F].

### TradingView
- [K] Watchlist = compact rows (symbol, last, chg, chg%) with user sections and colour flags; clicking a row opens detail panel/chart beside it; delayed-data badge ("D"/"15-min delayed") on quotes; indicators/charts are the core.
- Learn: master–detail split; custom sections/flags; delayed badge inline.
- Avoid: signal-style technical summary gauge ("Strong Buy/Sell" dial) — recommendation language.

### Yahoo Finance
- [K] Quote header with price, change, and "At close/Real-time" timestamp; tabs (Summary, Chart, Statistics, Analysis); Morningstar/Argus "Fair Value: Undervalued / Near Fair Value / Overvalued" tag with % in research widgets. Research reports: https://help.yahoo.com/kb/SLN29178.html
- Learn: timestamp phrase attached to price; tag + % for valuation.
- Avoid: ad/news clutter; analyst "Buy" consensus next to valuation.

### stockanalysis.com
- Header: price with "At close: <date, time>" and separate pre-market line; tabs Overview/Financials/Forecast/Statistics/Metrics/Dividends/History; key-stats table; footer cites data sources, delay, and "Last checked" date. [F] https://stockanalysis.com/stocks/aapl/
- Fastest-loading, least clutter among peers [F quantroutine].
- Learn: freshness stated in the header and footer; sparse typographic layout; consistent financial tables.
- Avoid: analyst "Buy" consensus + implied upside % beside price target [F] — advice-adjacent.

## Table stakes (nearly every good tool)
1. Price carries an explicit as-of time/label ("At close", "delayed").
2. Sticky header, sortable columns, right-aligned tabular numerals, % change coloured but sparingly.
3. Master–detail: list row → detail with tabs.
4. Valuation expressed as price vs fair value (ratio or % gap) not just a number.
5. Plain-language definition of every score/label on hover or link.
6. Data-source line and methodology link.
7. Saved/custom column sets.
8. Disclaimer wording near the verdict, not buried.

## Top 12 patterns for OUR tool (ranked by impact)
1. **Price-vs-value bar with bear/base/bull range** (Simply Wall St valuation bar + Morningstar uncertainty). Market row mini-bar and Analyses detail header: price dot on a bear–base–bull track, text "12% below base". Describes position, not action.
2. **Fair-value-history vs price chart with shaded gap and neutral band** (GuruFocus). Shade between price and base value; ±10% unshaded "near fair value" band; Protection price as dashed line at 0.80×. Use blue/amber (not green/red) for below/above so it doesn't read as buy/sell.
3. **Freshness stamp everywhere** (stockanalysis.com, Yahoo, TradingView). "Close, 14 Oct 2026 · delayed" on every price; "Valuation as of 3 Oct" beside fair value; amber chip when valuation is older than N days or price older than 1 session (GuruFocus "data out of date").
4. **Neutral position labels, defined in words** (Morningstar definitions, GuruFocus labels minus "value trap"). e.g. "Below fair value / Near / Above". Never use undervalued-as-good colours; hover shows the exact definition and states "describes price vs estimate, not an instruction". Put one-line "Not a recommendation" next to the label (Simply Wall St).
5. **Uncertainty beside risk** (Morningstar uncertainty, Simply Wall St health checks). Show risk rating (safe/balanced/high) as a quiet chip plus range width ("range ±34%") so wide bear–bull band reads as uncertainty.
6. **Auditable checks list** (Simply Wall St). Analyses detail: sanity checks as pass/fail rows with a one-sentence reason, grouped; critic notes and assumptions in the same pattern; sources inline.
7. **Dense table with saved column views** (Finviz, Koyfin, Stock Rover). Market 31 rows: symbol/name, price, as-of, fair (base), gap %, range mini-bar, risk, valuation age. Sortable; sticky header; tabular numerals; 28px rows; views "Valuation / Technicals / Compact".
8. **Master–detail with tabs that remember state** (TradingView, stockanalysis). Expanded row keeps tab choice (Valuation, TradingView, Financials, Technicals) across stocks; keyboard up/down.
9. **Percentile context over verdicts** (Koyfin, Stock Rover). "Gap to fair value is larger than 80% of this stock's own 3-year history" and EGX30 rank of gap; informs without telling to act.
10. **Portfolio sorted by contribution, with value context** (Stock Rover movers). Holdings: cost, price (as-of), P/L EGP and %, share of portfolio, gap to base fair value and distance to Protection price; "contribution to P/L" sort. Show "Protection price" as a reference level, not a stop-loss instruction.
11. **Methodology + reliability warnings per stock** (GuruFocus caveats, Morningstar methodology). Per-analysis banner for banks/holding companies/low-liquidity names where DCF is weak; link to assumptions; version of the model.
12. **Market overview heat map toggle** (Finviz). Optional tile view of EGX30 sized by market cap, coloured by gap to fair value (diverging blue/amber, neutral mid) rather than daily change; click → expand stock. Low priority for 31 rows but good weekly scan.

### Rule-fit summary
- Safe patterns: 1, 2, 3, 5, 6, 9, 11 (descriptive, sourced, uncertainty-aware).
- Need careful copy/colour: 4, 10, 12 (avoid green=buy, "upside" language, stop-loss framing; call it "reference level").
- Banned from peers: Buy/Sell labels (Seeking Alpha, stockanalysis consensus, TradingView gauge), "5 stars", implied-upside next to target, "value trap" verdicts.

## Words to avoid in UI copy
buy, sell, accumulate, target, upside, opportunity, strong, avoid, cheap, bargain. Prefer: below/near/above fair value, gap, range, reference level, estimate, as of.
