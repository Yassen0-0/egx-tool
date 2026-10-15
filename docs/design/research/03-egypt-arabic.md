# Egyptian/Arab investing tools and Arabic/RTL financial UI: research notes

Coverage caveat: search was thin. Verified directly: Mubasher stock page, EGX rules via EFG Hermes, EGX divisions (Enterprise), Thndr Play Store, Argaam homepage, CLDR thread. NOT verified (no accessible content): EFG ONE reviews, Reddit/Facebook threads, Sahm Capital, Arqaam, Aljazira. Items marked (inferred) are my judgment.

## 1. Landscape

**Thndr** (brokerage-licensed, FRA-regulated; stocks, funds, gold). Play Store ~3.9/5 from ~28.6K reviews, 5M+ downloads. Visible complaints: slow withdrawals (100 EGP pending 5 days), no human support (AI chatbot only), settings that reset after an update, "delays and losses" blamed partly on MCDR (settlement depository), and trust erosion. Praise: same-day onboarding, no minimum, Instapay/Vodafone Cash funding, Thndr Learn simulator, and a risk-quiz starter plan ("Alpha"). Positioning is execution and simplicity; analysis depth is not its pitch. https://play.google.com/store/apps/details?id=com.axismarkets.thndr · https://support.thndr.app/en/?p=1125 (fees are a separate "Pricing & Fees" article, "know exactly what you pay")

**Mubasher (mubasher.info)**, the closest Arabic data portal. Stock page structure: header with name + ticker, last price, change, % change, then open / previous close / high / low. Tabs include السهم، أخبار السهم، القيم العادلة، المؤشرات المالية، القوائم المالية، الدعم والمقاومة. Labels: القيمة السوقية، القيمة الدفترية، مضاعف القيمة الدفترية، ربحية السهم، مضاعف الربحية، حجم التداول، قيمة التداول، عدد أسهم الشركة الحالي. Delay is stated in the header and footer: "جميع البيانات متأخرة 15 دقيقة أثناء الجلسة" plus "آخر تحديث: 12:26 م بتوقيت السوق". Digits are Western with `,` thousands and `.` decimals (4,375,144; 122.95). Percentages use two decimals + `%`. Dates are mixed: Arabic months ("20 أغسطس 08:49 ص") and ISO ("2026-06-27") on the same page. The page even mixes Arabic-Indic (١٥) and Western (15) in the delay notice, which is the inconsistency to avoid. https://www.mubasher.info/markets/EGX/stocks/COMI

**Argaam (أرقام, Saudi)**: news-led, with a market snapshot (index, % change), calendar of dividends/assemblies/earnings calls, 52-week-low counts, research-house forecasts, and a community forum. Strength: an event calendar and Arabic editorial voice. https://www.argaam.com/ar

**Others** (not verified): EFG Hermes ONE (broker + research), Investing.com Arabic, Al Mal/Amwal Al Ghad (news-first), Sahm/Arqaam/Aljazira (research PDFs). (inferred) Arabic content in Egypt is news or brokerage-execution; structured valuation is mostly in English PDFs behind broker logins.

**EGX market facts for UI copy** (https://tg.efghermes.com/Market/GetById/1103, https://enterpriseam.com/egypt/2024/02/21/egx-to-implement-four-new-stock-divisions-next-week-to-regulate-trading/):
- Sun–Thu. Pre-open 08:30–10:00, continuous 10:00–14:15, closing auction 14:15–14:30. The official close is the auction match price or the 30-minute moving VWAP.
- Daily limit ±20%. A 10% move from the previous close gives a 10-minute stock halt. Inactive/D-list stocks have a ±5% limit with no halt. SME (Nile/Tamayuz) stocks have a ±5% halt and ±10% limit.
- Settlement T+2 by default; T+0/T+1 exists for the active divisions. Failed sales face a buy-in at T+5.
- Tick size 0.01 (price ≥ 2.00) and 0.001 (below 2.00). Prices therefore need 2–3 decimals depending on the price.
- (inferred) Retail complaints, in descending likelihood: withdrawal/settlement delays, support access, fees (commission plus stamp/clearing, shown separately), stale or wrong data, thin-liquidity stocks that are hard to exit. Hence trust and transparency matter more than features.

## 2. Arabic/RTL conventions

- **Digits.** Egyptian finance sites (Mubasher, brokers) use Western/Latin digits 0-9 for prices. Arabic-Indic (٠-٩) appears in news prose and government text. Your Latin-digit choice matches the sector norm. Never mix within a screen. Force it with `font-variant-numeric: tabular-nums` and `lang="ar-EG-u-nu-latn"` (or `Intl.NumberFormat('ar-EG-u-nu-latn')`), because `ar-EG` alone yields Arabic-Indic digits.
- **Separators.** Use `,` thousands and `.` decimals (Mubasher standard). The Arabic separators `٬ ٫` are not used on EGX portals.
- **Numbers stay LTR inside RTL text.** Digits are weak/neutral in bidi. A number run reads left-to-right, and the `%` stays attached to its digits in LTR order (Unicode list consensus: the symbol "belongs with the digits"; read aloud after, displayed in digit order). https://corp.unicode.org/pipermail/cldr-users/2015-March/000258.html. Practical rule: render `+2.35%` as one `<bdi dir="ltr">` or `<span dir="ltr">` unit. Do not rely on the surrounding RTL context, or the sign/percent will jump sides (`%2.35+`).
- **Sign.** Put `+`/`−` at the left, immediately before the digits, inside the LTR run. Use the real minus U+2212, not hyphen. Always add color AND an arrow/sign (red/green alone is insufficient). Egypt convention is green up / red down (matches Mubasher and global).
- **Currency.** `ج.م` (short) or `جنيه`. Pattern: `45.20 ج.م` (number then unit, number remains LTR block). Use the unit in headers/column titles ("السعر (ج.م)") to avoid repeating it in every cell. (inferred)
- **Tables.** First column (name/ticker) right-aligned at the right edge. Numeric columns right-aligned with tabular figures so decimals line up (Western digits are LTR; right-align is the visual standard for numbers even in RTL, because decimal alignment matters more than mirroring). Column order reads right→left: السهم | السعر | التغير | ... Ticker `COMI` stays Latin; wrap in `dir="ltr"` with a small gap.
- **Charts.** Convention is split: Arabic broker charts (Mubasher, TradingView Arabic) keep the time axis LEFT→RIGHT (oldest left), because financial charts are treated as numeric/universal. Recommendation (inferred): keep time LTR, price axis on the right side of the plot, and mirror only the surrounding chrome (legend, range pickers, titles). Mirroring time confuses users who also use TradingView/Thndr.
- **Dates.** Use Gregorian, day-month-year. Short form `15/10/2026` or `15 أكتوبر 2026`. Use the Egyptian month names (يناير، فبراير، مارس، أبريل، مايو، يونيو، يوليو، أغسطس، سبتمبر، أكتوبر، نوفمبر، ديسمبر) not the Levant ones (كانون/تشرين). Times: 12-hour with ص/م is how Mubasher shows it; 24-hour is fine for a pro tool. Market time: "بتوقيت القاهرة".
- **Fonts.** macOS system Arabic is SF Arabic (via `-apple-system`; Arabic coverage built in; digits in SF are Latin tabular via the `tnum` feature). IBM Plex Sans Arabic (Google Fonts) lists numerals, tabular figures and multiple weights, with Latin glyphs matching Plex Sans, so tickers and numbers look consistent: the best bundled choice for an Electron/web shell. https://fonts.google.com/specimen/IBM%2BPlex%2BSans%2BArabic/about. Alternatives: Noto Sans Arabic / Cairo / Tajawal (Tajawal and Cairo are popular in Egyptian UI; Cairo's Latin is weaker for tickers). Use body 14-15px minimum: Arabic needs larger sizes (about +1-2px) than Latin to look equal; line-height ≥1.6 for prose, 1.3 in tables. Avoid letter-spacing on Arabic (breaks joining). Avoid italic and avoid faux bold.
- **Terminology** (Mubasher/Argaam-attested unless marked): القيمة السوقية (market cap), مكرر/مضاعف الربحية (P/E; Egyptian press says "مكرر الربحية", Mubasher says "مضاعف"), ربحية السهم (EPS), القيمة الدفترية (book value), مضاعف القيمة الدفترية (P/B), حجم التداول (volume, shares), قيمة التداول (turnover, EGP), إغلاق سابق، أعلى/أدنى، توزيعات الأرباح (dividends), عائد التوزيعات (dividend yield), الدعم والمقاومة, القيم العادلة (Mubasher tab for fair values). Not verified on a source page but standard: السعر العادل / القيمة العادلة (fair value), هامش الأمان (margin of safety), نطاق القيمة العادلة (fair-value range), وقف الخسارة (stop loss).

## 3. Gaps your tool can own

1. **Valuation in Arabic with visible assumptions.** Mubasher has a "القيم العادلة" tab (aggregated analyst targets, opaque). Nobody (verified) shows a range + the assumptions (growth, discount rate, multiples) in Arabic, editable.
2. **Honest data freshness.** Competitors state "15 min delay" generically. Your EODHD free plan updates only some stocks daily, so per-stock "آخر تحديث" date is a real differentiator and a trust builder.
3. **Non-advisory framing**: risk and protection levels without buy/sell. Brokers must push trading; you can be neutral.
4. **Liquidity and limit awareness** per stock: ±20% limit, tick size, thin trading flag, which retail apps rarely surface.
5. **Portfolio vs. fair value**: position gain/loss against entry/protection/fair-value (no one in Arabic connects holdings to valuation).
6. **Calm, no-gamification UI** (Thndr-style trade-first flows are the norm).

## 4. Ten design/copy implications (ranked)

1. **Per-stock freshness label, always visible**: `آخر سعر إغلاق: 14 أكتوبر 2026` + a stale chip `بيانات قديمة (3 أيام)` when the date lags the last session. Page-level: `أسعار نهاية اليوم · متأخرة`. Never show "اليوم" for a stale price.
2. **Render every number as an LTR unit with Latin tabular digits** (`dir=ltr`, `tnum`, `ar-EG-u-nu-latn`), U+2212 minus, `%` attached. This is the most common RTL finance bug.
3. **Fair value as a range bar, not a point**: label `النطاق العادل` (or `القيمة العادلة التقديرية`), showing low–high with the current price marker; caption `هامش الأمان` = distance from price to the low end of the range, as a % with a plain-language explanation. Avoid wording that reads as a target price.
4. **Risk badge labels exactly**: `آمن` / `متوازن` / `مرتفع المخاطر`; tooltip with the 2–3 reasons (e.g. تذبذب السعر، سيولة ضعيفة، ديون). Don't use red/green alone since green "آمن" next to a red price drop confuses; use a neutral palette for risk and reserve green/red for price change.
5. **Entry and protection price**: `سعر الدخول المقترح` is advisory-sounding; safer: `سعر الدخول المرجعي` and `سعر الحماية` (as in the spec), with a one-line disclaimer `ليست توصية بالشراء أو البيع`. Explain protection price: `إذا نزل السعر تحته، تنهار فرضية التحليل` (when it falls below, the thesis is invalidated).
6. **Assumptions drawer in every analysis**: `الافتراضات` (growth, discount, multiple, source of financials, date), `آخر مراجعة`, and `ما الذي قد يغيّر هذا التقدير`. Transparency is your trust moat given Thndr's trust complaints.
7. **Tables**: RTL with ticker/name at the right; columns السهم | آخر سعر | التغير % | النطاق العادل | هامش الأمان | المخاطر. Numbers right-aligned, tabular. Show the ticker in Latin with the Arabic name beneath. Sort by header with a visible arrow. Sticky header.
8. **Charts: time axis left→right, price axis on the right**, Arabic tooltips with Latin digits, range picker `١ شهر` → write `1 شهر`, `3 شهور`, `سنة`, `الكل`. Mirror only legend/controls.
9. **Market context strip** (Market screen): `السوق مغلق · يفتح الأحد 10:00` with session times (pre-open 08:30, continuous 10:00–14:15, auction to 14:30, Sun–Thu) and per-stock chips for ±20% limit when relevant (e.g. `قريب من حد الصعود`). Settlement note T+2 appears in Portfolio ("تُسوّى بعد يومين عمل"), only if you track cash.
10. **Portfolio screen vocabulary**: `المحفظة`, `متوسط التكلفة`, `الربح/الخسارة غير المحققة`, `القيمة الحالية`, `الوزن`, `بعد الرسوم` toggle (commission + stamp, labelled `العمولات والرسوم`). Show P/L against your entry/protection lines. Fonts: IBM Plex Sans Arabic (or SF Arabic fallback), 14-15px body, 1.6 line height, no letter-spacing. Avoid hype copy ("ارتفاع صاروخي"); neutral, measured Modern Standard Arabic with Egyptian-friendly simple words.

## Core label table
| Concept | Recommended AR | Note |
|---|---|---|
| Fair value range | النطاق العادل / القيمة العادلة التقديرية | "تقديرية" signals estimate |
| Margin of safety | هامش الأمان | % below low end |
| Risk | الخطر: آمن / متوازن / مرتفع المخاطر | neutral color |
| Entry | سعر الدخول المرجعي | not "اشترِ" |
| Protection | سعر الحماية | invalidation level |
| Market cap | القيمة السوقية | |
| P/E | مكرر الربحية | familiar to Egyptians |
| Volume / turnover | حجم التداول / قيمة التداول | shares / EGP |
| Last update | آخر تحديث / آخر إغلاق | per stock |
| Disclaimer | ليست توصية بالشراء أو البيع | footer on every analysis |

## Sources
- https://www.mubasher.info/markets/EGX/stocks/COMI
- https://tg.efghermes.com/Market/GetById/1103
- https://enterpriseam.com/egypt/2024/02/21/egx-to-implement-four-new-stock-divisions-next-week-to-regulate-trading/
- https://play.google.com/store/apps/details?id=com.axismarkets.thndr
- https://support.thndr.app/en/?p=1125
- https://www.argaam.com/ar
- https://corp.unicode.org/pipermail/cldr-users/2015-March/000258.html
- https://fonts.google.com/specimen/IBM%2BPlex%2BSans%2BArabic/about
