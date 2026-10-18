# CLAUDE_CODE.md — UI redesign handoff for the EGX tool («قيمة»)

> **For Claude Code.** This file is the complete record of the design meeting between Yassen (owner) and Claude (UI designer) on 15 Oct 2026. Every decision below is FINAL unless Yassen changes it. You should be able to implement everything without asking anyone. When something is not covered, follow the hard rules in §2 and the closest existing pattern in the reference screens.
>
> **ملخص بالعربي لياسين:** الملف ده محضر الاجتماع كله: إيه اللي اترفض، وإيه اللي اتقرر، والبحث، ونتايج اختبارين سهولة استخدام، ومواصفات كل شاشة، والتغييرات المطلوبة في الباك إند، وخطة تنفيذ بمراحل ومعايير قبول. Claude Code يقدر يشتغل منه على طول.

---

## 0. Where everything is (all paths relative to repo root)

| Path | What |
|---|---|
| `docs/design/CLAUDE_CODE.md` | this file |
| `docs/design/CLAUDE_DESIGN_BRIEF.md` | the original brief (still valid for product facts) |
| `docs/design/screens/*.dc.html` | **reference design source** for each screen (HTML + CSS + a small `renderVals()` JS with demo data). Read them for exact layout, CSS, copy and SVG. They use a design-canvas template syntax (`{{hole}}`, `<sc-for>`, `<sc-if>`), so they do NOT run as-is; treat them as a spec, not as code to copy blindly. |
| `docs/design/screenshots/*-light.png`, `*-dark.png` | full-page renders of every screen in both themes: **the visual source of truth** |
| `docs/design/research/` | the research (`01-tools.md`, `02-investor-voice.md`, `03-egypt-arabic.md`), the design spec given to the designers (`SPEC.md`, `FIXES.md`, `FIXES-R3.md`), and the usability reports (`usability-*.md`, round 1 and `-r2`) |
| `bundle/src/client.src.js` | the UI you will change (React via `h()`, no UI libs, CSS string inside the file, classes `egxp-*` / `egxm-*`). Rebuild with `node bundle/build-client.mjs` |
| `bundle/host/egx-portfolio.mjs` | the host API routes `/egx/api/*` |
| `mcp/egx_mcp/` | the Python logic behind the API (`market/summary.py`, `store/portfolio.py`, `server.py`, `universe/egx30.json`) |
| `bundle/icon.svg`, `bundle/locale/*.json` | app logo and app title |

The designs also live on a private claude.ai design canvas ("قيمة — تصميم أداة EGX"). You don't need it: the screens and screenshots in `docs/design/` are complete.

---

## 1. Meeting minutes (what happened, in order)

1. **Brief read.** The product is a DeepSeek Harness plugin. Our panels are Market (السوق), Analyses (التحليلات) and Portfolio (المحفظة). The sidebar, chat and settings belong to DeepSeek and are not ours.
2. **Round 0 (rejected).** Claude made 3 directions (Terminal / Ledger / Cockpit) with their own colour palettes and Google fonts. **Yassen rejected all three**: "they all look the same, only the colours changed; the tool looks ugly and impractical."
   - **Decision 1:** use **DeepSeek Harness colours exactly** (`--dsw-alias-*`). Our identity = **name + icon only**.
   - **Decision 2:** redesign from research on what investors and analysts actually love, not from taste.
3. **Research.** 3 agents studied Simply Wall St, Morningstar, GuruFocus, Seeking Alpha, Koyfin, TIKR, Finviz, Stock Rover, TradingView, Yahoo and stockanalysis.com, plus investor voice (Reddit, Trustpilot, HN) and the Egyptian/Arab tools (Thndr, Mubasher, Argaam, EFG). Key findings are in §3.
4. **Round 1 design.** 3 agents built Market, Analyses + Analysis, Portfolio + States + Identity on Harness tokens.
   - **Name chosen: «قيمة».** It was recommended, and both test users later picked it independently.
5. **Icon decision (Yassen).** The icon is a rounded square with an arrow:
   - **green up** when the user's portfolio is up today, **red down** when it is down;
   - **neutral** when there is no change, no prices yet, or the user has no portfolio at all (analysis-only users).
   - Claude warned that test users read green/red arrows as buy/sell signals. **Yassen kept the decision.** Implement it as specified in §6.
6. **Usability test round 1.** Two agents role-played beginner users:
   - **Mostafa:** 26, accountant, uses Thndr.
   - **Nour:** 23, junior analyst, uses TradingView.
   - Average score was about **6/10**. Top problems:
     - the gap % was inconsistent between screens (+7.4% vs −6.9%);
     - visible `[placeholder]` text;
     - no "portfolio today" figure;
     - a broken 52-week bar;
     - 12 crowded columns;
     - wrong row counts;
     - RTL sign and percent flipping;
     - "entry price" read as "buy at";
     - unexplained jargon;
     - example rows counted in totals.
7. **Round 2 fixes**, then **usability test round 2**. The average rose to about **8–8.5/10** (Mostafa 6→8, Nour about 6→8.5). Remaining issues:
   - fair line drawn with look-ahead on the candle chart;
   - stale ADIB counted in today's breadth;
   - bidi punctuation;
   - long top area on Market;
   - bear value equal to protection (suspicious);
   - demo "price at valuation" contradicting the real candles.
8. **Round 3 fixes**, all done:
   - no look-ahead (fair and protection are step lines by valuation date);
   - stale prices excluded from today's numbers;
   - compact Market top (first row at about 254px);
   - real closes used for "price at valuation";
   - bear ≠ protection;
   - beginner explanations for every abbreviation;
   - final icon rule.
9. **Final ask (Yassen):** prepare everything so Claude Code can implement it without coming back. → this file.

---

## 2. Hard rules (never break)

1. **Valuation, never recommendation.** Never show buy/sell advice.
   - **Banned in UI copy:** شراء/بيع as advice, فرصة, رخيص, هدف سعري, صعود متوقع, upside, target, bargain, stop-loss / وقف خسارة, "سعر الدخول المقترح".
   - The words شراء/بيع may appear ONLY in the disclaimer: «تقييم وليس توصية بالشراء أو البيع.» (footer of every screen).
   - In the Portfolio form, the factual field is **«سعر التنفيذ»**. Don't label it «سعر الشراء».
2. **Prices are never live.** Every price shows its date: «14/10», or «إغلاق الأربعاء 14 أكتوبر». A price older than the expected last session gets the chip **«سعر قديم»** and its date, e.g. «جلسة 12/10». No pulsing dots and no "live" styling.
3. **Colours = Harness tokens only** (§5). No custom hex in our CSS. Fonts: the Harness stack (`var(--dsw-font-family)`, `var(--ds-font-family-code)`). No webfonts.
4. **Green/red only for price change and the portfolio icon.**
   - Blue (`state-business-primary`) = our valuation (fair value).
   - Amber (`state-warn-*`) = protection.
   - Valuation status never uses green/red.
5. **Numbers in RTL.** Every number, sign and `%` sits inside ONE LTR-isolated element: `class="num"` → `direction:ltr; unicode-bidi:isolate; font-variant-numeric:tabular-nums; font-family: var(--ds-font-family-code)`. Rules:
   - The minus is U+2212 `−`.
   - Old→new values: `<span class="num">118.00 → 131.00</span>`.
   - Never end an Arabic sentence with a number followed by `.` or `،` (it renders as ".26.0%"). Rephrase so the sentence ends on a word.
   - Formatting: Latin digits (`ar-EG-u-nu-latn`, already used in `client.src.js`), thousands `,`, decimals `.`, 2 decimals for prices.
6. **Every abbreviation is explained in Arabic on first sight**: CAR, CET1, NPL, LCR, EODHD, full/light update, Z/F/M scores.
7. **Accessibility:**
   - real `<button>`, `<a>`, `<input>` with `<label>`;
   - `aria-label` on icon-only buttons;
   - rows ≥36px, controls ≥32px;
   - green/red always paired with a +/− sign.

---

## 3. Research → design principles (why the screens look like this)

1. **Valuation ruler everywhere** (from Simply Wall St, Morningstar and GuruFocus). One component draws:
   - the bear–bull band (light blue);
   - a protection tick (amber);
   - a fair tick (blue);
   - a price dot (label-primary).

   It appears in the Market row (mini), the stock detail (large), the Analysis summary, the Analyses list and Portfolio rows.
2. **Freshness everywhere:** price date, valuation date, last sync, updates used, session state.
3. **Daily habit loop:** "منذ آخر إغلاق" digest (max 3 lines) plus "محفظتي اليوم" at the top of Market. The portfolio icon colour supports it.
4. **Neutral language with definitions:** «أقل من العادل بـ 6.9%», «أعلى من العادل بـ 4.3%», «تحت سعر الحماية بـ 3.6%», «لم يُقيَّم بعد».
5. **Trust = show how the value was built:** methods + weights, assumptions, pass/fail checks (with «هل ده يقلق؟» on failures), risk metrics explained, critic notes, dated sources, change log with reasons, fair-value history vs price.
6. **Dense but calm tables:** ≤7 columns, ticker + Arabic name on the right, numbers right-aligned, sort arrows, filter chips with counts.
7. **Egypt specifics:**
   - EGX session Sun–Thu, continuous trading 10:00–14:15, closing auction to 14:30, T+2;
   - daily limit ±20%;
   - EODHD free plan = 20 updates/day, so some stocks are missing or stale and the UI must say so plainly.

---

## 4. Definitions and formulas (use the same everywhere: UI and API)

| Concept | Formula | Arabic copy |
|---|---|---|
| Difference from fair (هامش) | `margin = (fair − price) / fair` | price < fair: «أقل من العادل بـ {margin}%»; price > fair: «أعلى من العادل بـ {abs}%» |
| Under protection by | `(protection − price) / protection` | «تحت سعر الحماية بـ 3.6%» |
| Protection | `fair × 0.80` (a rule, not a forecast) | definition (show under a ؟ toggle, open by default where protection is shown large): «سعر الحماية = 80% من السعر العادل. لو السعر نزل تحته، المحلل بيراجع التقييم تلقائيًا. ده تنبيه للمراجعة، مش أمر بيع.» |
| Entry reference | = fair. **Do not show as a separate number.** | once, inside the ؟ text: «مرجع الدخول = السعر العادل نفسه، وليس توصية بالشراء.» |
| Status | `price ≥ fair` → above; `protection ≤ price < fair` → between; `price < protection` → under | «أعلى من العادل» / «بين الحماية والعادل» / «تحت سعر الحماية — يحتاج مراجعة» |
| Scenario range | bear … bull (independent of protection) | «النطاق (المتشائم – المتفائل)» |
| Stale price | `as_of < expected_last_bar` (already computed in `market/summary.py` as `stale`) | chip «سعر قديم» + «جلسة dd/mm» |
| Breadth today | count only rows with `price` and `stale == false` | «صاعد 8 · هابط 6 · قديم 1 · بدون سعر 16» |
| Portfolio today | `Σ quantity × change` over holdings with a fresh price; `% = today / (value − today)` | «محفظتي اليوم +50.00 (+0.34%)» |

⚠️ **The current code disagrees.** `market/summary.py` returns `upside` (`upside_to_fair_value`, probably `(fair−price)/price`, which gives +7.4% for COMI). Switch the UI to `margin` as defined above: COMI 122 vs 131 → **6.9%**. Keep `upside` in the API only if the MCP tools need it, but never show it.

---

## 5. Design tokens (Harness)

Use the real Harness CSS variables. They already exist on `body` and switch with `body[data-ds-dark-theme]`. Do not redefine them in our CSS. Source: `ui-theme/src/styles/design-platform.css` in the DeepSeek Harness repo.

| Role | Token |
|---|---|
| page background | `--dsw-alias-bg-base` |
| card / panel | `--dsw-alias-bg-layer-1` + border `--dsw-alias-border-l2` |
| sunken: table header, chips, tracks | `--dsw-alias-bg-module-platform`, `--dsw-alias-markdown-tag` |
| hover / selected | `--dsw-alias-interactive-bg-hover` / `--dsw-alias-interactive-bg-active` |
| text | `--dsw-alias-label-primary` / `-secondary` / `-tertiary` (caption only for decoration) |
| primary button | bg `--dsw-alias-button-primary-fill`, text `--dsw-alias-label-primary-foreground` (black in light) |
| secondary button | transparent + `--dsw-alias-border-l3` |
| link | `--dsw-alias-link` |
| fair value / our valuation | `--dsw-alias-state-business-primary`, soft `--dsw-alias-state-business-tertiary` |
| protection / warning | text `--dsw-alias-state-warn-label`, marks `--dsw-alias-state-warn-primary`, bg `--dsw-alias-state-warn-tertiary` |
| price up / down **text** | `--dsw-alias-file-diff-added-marker` / `--dsw-alias-file-diff-deleted-marker` (readable greens/reds) |
| candles / bars | `--dsw-alias-state-success-primary` / `--dsw-alias-state-error-primary` |
| skeleton | `--dsw-alias-bg-skeleton` |
| radii | `--dsw-radius-xs` 4 (chips), `-sm` 8 (inputs/buttons), `-md` 12 (cards) |

- **Type scale (px):** 12 meta · 13 table · 14 body · 16 section title · 20 page title · 28–32 one hero number. Weights 400/500/600. No letter-spacing on Arabic.
- **Note:** the current CSS in `client.src.js` uses `--dsw-alias-state-success-primary` for gain TEXT (`.egxp-gain`). Change text colours to the `file-diff-*-marker` tokens. The success/error primaries are too light for text on white.
- **Known limitation (accepted):** amber `state-warn-label` text on `state-warn-tertiary` is about 2.7:1 contrast in light mode. Compensate with weight 600, an amber border and a ◆ marker. Never rely on colour alone.

---

## 6. Identity: name and icon

- **Name:** «قيمة» (Latin: Qima). Update `bundle/locale/ar.json` `meta.title` → «قيمة», en → "Qima". Keep the description's "not investment advice" sentence. The name must never contain "DeepSeek Harness" (trademark; "DSH" is allowed).
- **Icon states.** All are a 24×24 viewBox rounded square (`rx=6`) with the glyph stroked in `--dsw-alias-bg-base`:

| State | When | Square fill | Glyph |
|---|---|---|---|
| UP | portfolio today > 0 | `--dsw-alias-file-diff-added-marker` | `<path d="M12 18.5V6M6.5 11.5L12 6l5.5 5.5" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` |
| DOWN | portfolio today < 0 | `--dsw-alias-file-diff-deleted-marker` | `<path d="M12 5.5V18M6.5 12.5L12 18l5.5-5.5" …same/>` |
| NEUTRAL | today = 0, OR no fresh prices today, OR no holdings, OR data unavailable | `--dsw-alias-label-primary` | `<path d="M5.5 12h13M5.5 9v6M18.5 9v6" stroke-width="2.2" stroke-linecap="round" fill="none"/><circle cx="12" cy="12" r="2.6" fill="var(--dsw-alias-bg-base)"/>` |

- **Check order:** no holdings → NEUTRAL; no fresh price for any holding → NEUTRAL; today == 0 → NEUTRAL; else UP or DOWN.
- **16px:** stroke 2.0–2.2 on whole pixels. The hand-tuned 16-grid version is in `screens/Identity.dc.html`.
- **Where:**
  - `bundle/icon.svg` (static app logo) = **NEUTRAL**, using `#0F1115` fill and `#FFFFFF` glyph, because a static file can't read CSS variables.
  - The sidebar entry for the Market panel (`MarketIcon`) becomes the dynamic «قيمة» icon: it reads today's portfolio change and re-renders.
  - Per the design (sidebar mock in `screens/Identity.dc.html`), the Market entry's **label becomes «قيمة»** (it is the tool's home). Its tooltip / aria-label is «قيمة — السوق».
  - التحليلات and المحفظة keep their own monochrome icons (current `AnalysesIcon` / `PortfolioIcon`, stroked in `currentColor`).
  - In the up/down states the sidebar shows today's % next to «قيمة» (e.g. `+0.34%` in the green token); nothing in neutral.
  - **Data source:** fetch `/egx/api/portfolio` (lightweight) on mount and after each market sync, and share it through a tiny module-level store (pattern: `nav` object already in the file) so the icon and the Market header agree.
- **Panel headers** (every screen): icon 22px + «قيمة» + «/» + screen name (+ breadcrumb for Analysis) on the right; actions on the left. Demo builds may show the chip «بيانات تجريبية». In production, show it only when the data comes from `seed-dev.py` (dev DB).

---

## 7. Screen specs

Open the matching screenshot and `.dc.html` side by side while implementing. The table below is the checklist; the files hold exact spacing and copy.

### 7.1 Market (`screens/Market.dc.html`, `screenshots/Market-*.png`), replaces `MarketPage` / `MarketRow` / `SymbolDetail`

1. **Header row:** icon + «قيمة / السوق»; left: primary button «تحديث الأسعار الآن» (disabled with «جارٍ التحديث…» while syncing).
2. **Status strip** (one compact card, wraps):
   - «الجلسة مغلقة · تفتح اليوم 10:00» or «الجلسة مفتوحة · تغلق 14:30»;
   - «آخر إغلاق الأربعاء 14/10/2026»;
   - «تحديثات الأسعار اليوم 14 من 20» with a mini bar, plus «المصدر EODHD (أسعار نهاية اليوم)»;
   - «آخر تحديث 09:02»;
   - breadth «صاعد 8 · هابط 6 · قديم 1 · بدون سعر 16» with a stacked mini bar;
   - «محفظتي اليوم +50.00 (+0.34%)» (hidden if no holdings).
3. **«منذ آخر إغلاق» digest:** ONE row of ≤3 clickable items. Each item selects the stock or opens the analysis. Sources:
   - stocks whose status changed to/from under-protection;
   - valuations created since the previous session (with `old → new` fair);
   - the biggest move among holdings.

   Hide the digest when there is nothing to show.
4. **Toolbar (one wrapping row):**
   - search;
   - filter chips with counts: الكل · مقيَّم · تحت الحماية · لم يُقيَّم · بدون سعر · قديم · محفظتي;
   - period segmented: شهر · 3 شهور · سنة (the API has `returns` for 1w/1m/3m/ytd/1y; show the 3 in the design and keep ytd/1w in the select if wanted);
   - sort select + direction button. Header cells are also sort buttons with ▲/▼ on the active column.
5. **Table: 7 columns, CSS grid (not `<table>`), sticky header.**
   1. **السهم:** ticker (code font, 600) + Arabic name; sub-line «القطاع · 28.76% من المؤشر»; chip «محفظتي» if held.
   2. **آخر سعر:** price + «14/10», or the chip «سعر قديم» + date.
   3. **اليوم:** one span `+1.00 (+0.83%)`. For stale rows the text is grey with «جلسة 12/10» and excluded from sort.
   4. **الفترة %** for the selected period.
   5. **التقييم** (widest): mini valuation ruler + «عادل 131.00 ○ أقل من العادل بـ 6.9%» / «◆ تحت سعر الحماية بـ 3.6%». Unvalued: «لم يُقيَّم بعد» + a small «قيّم» button that pre-fills the chat with «قيّم سهم {SYMBOL}». Use the harness chat input if an API exists; otherwise copy to the clipboard and show a toast «اتنسخت الرسالة — الصقها في المحادثة».
   6. **التصنيف:** chip with 3 rising bars (1 = آمن, 2 = متوازن, 3 = مرتفع المخاطر) + text. Empty for unvalued.
   7. **نطاق 52 أسبوعًا:** track, filled part, price dot, low/high under it.
   - Under-protection row: `state-warn-tertiary` background.
   - Selected row: `interactive-bg-active` + an inset edge in `state-business-primary`.
   - No-price stocks are one collapsible group row at the end: «16 سهمًا بانتظار السعر — تُستكمل في التحديث القادم», previewing tickers, expanding to a list.
   - Footer: «عرض N من 31» (N = rows really visible) + a legend of the ruler marks.
6. **Detail (docked below the table, not inline expansion)** for the selected row:
   - header: name, ticker, sector, weight, rating chip, «محفظتي»; price large + change + «إغلاق … · سعر متأخر»;
   - tabs: **تقييمنا · الشارت الفني · البيانات المالية · التحليل الفني**.
7. **تقييمنا tab:**
   - **Large ruler** labelled المتشائم / الحماية / السعر / العادل / المتفائل.
   - **Fact cells:** السعر العادل · النطاق · سعر الحماية (with ؟ definition) · الفرق عن العادل · التصنيف · تاريخ التقييم · السعر وقت التقييم.
   - **Candle chart** (Lightweight Charts, existing `SymbolChart`), last 60 sessions. **No look-ahead:** draw fair and protection as **step series by valuation date** from `/egx/api/valuations/series/{symbol}`. Before the first valuation in range, draw nothing. A valuation dated after the last candle shows as a right-edge marker «تقييم 15/10» + price tags. Hide axis labels within 12px of a price tag. Fair line = blue dashed; protection = amber solid.
   - **One-line chart legend** explaining the lines.
   - **Last 10 sessions** strip (date, close, change).
   - **Table of all valuations** of this stock (date, fair, price then, status then).
   - Link «افتح التحليل الكامل ←» opens the Analyses panel on that valuation (`nav.selectPanel` + `pendingAnalysisId`, already in code).
8. **TradingView tabs:** keep the existing `TvWidget` iframes, framed, with the TradingView attribution visible. The **التحليل الفني** tab ALWAYS shows above the widget: «إشارة آلية من TradingView مبنية على مؤشرات فنية فقط — ليست تقييمنا وليست توصية بالشراء أو البيع.»
9. **Footer disclaimer.**

### 7.2 Analyses list (`screens/Analyses.dc.html`), replaces `AnalysesList`

- **Filters:** stock select, rating select, period select, type segmented (الكل / كامل / خفيف), reset button (disabled when nothing is set). Subtitle explains full vs light update and EODHD once.
- **Grouped by stock.** Under-protection stocks go first, then the latest date. The group head is the latest valuation:
  - larger row: fair (blue), Δ vs previous (`118.00 → 131.00 +11.0%`);
  - rating chip, status chip, mini ruler, the margin sentence, a one-line reason, date, type.
- Older versions are smaller and grey: «حلّ محلّه تقييم أحدث», «السعر وقتها 136.60 · أعلى من العادل بـ 15.8%».
- A light update shows «تحديث خفيف: نفس العادل 95.00».
- Every row opens the detail.

### 7.3 Analysis detail (`screens/Analysis.dc.html`), replaces `AnalysisDetail`

1. **Breadcrumb:** «قيمة / التحليلات / COMI — 15/10/2026».
2. **Summary strip:** fair (hero, blue), النطاق, سعر الحماية, السعر وقت التقييم, السعر الآن (dated), التصنيف, الحالة. Large ruler underneath. Helper line with the protection definition + entry-reference sentence.
3. **Fair-value history chart** (rework `FairValueChart`):
   - x = real dates;
   - fair step line;
   - price line from month-end closes + valuation-day points;
   - protection step line (amber);
   - gap shaded blue where price < fair and amber where price > fair;
   - markers at valuation dates.
4. **Change log:** date, `old → new`, Δ%, price then, status then, reason.
5. **Sections with a sticky horizontal nav:** الملخص · الأطروحة · طرق التقييم · الافتراضات · فحوصات المنطق · المخاطر · ملاحظات الناقد · المصادر · التقرير الكامل.
   - **Methods table:** weight, low / base / high per method; weighted totals = bear / fair / bull.
   - **Assumptions:** value + source.
   - **Checks:** pass/fail list, collapsed to the failing ones + «عرض الكل». Each failure has «هل ده يقلق؟ …».
   - **Risk:** for banks CAR, CET1, NPL, coverage, LCR, auditor opinion, each with a one-line Arabic explanation and its threshold; note that Altman Z-Score / Piotroski F-Score / Beneish M-Score don't apply to banks. Non-banks show those three with explanations.
   - **Critic notes.**
   - **Sources** with dates.
   - **Full report** (existing `Markdown`) collapsed with an excerpt.
6. **Footer disclaimer.**

All this data already exists in the valuation record (`methods`, `assumptions`, `sanity`, `risk_details`, `critic_notes`, `sources`, `thesis`, `report`). Map the keys; don't invent.

### 7.4 Portfolio (`screens/Portfolio.dc.html`), replaces `PortfolioPage` / `Cards` / `AddForm` / `HoldingRow`

1. **Summary bar, today first and biggest:** «اليوم +50.00 (+0.34%) · حتى إغلاق 14/10», then القيمة 14,554.00, الربح/الخسارة +954.00 (+7.0%), التكلفة 13,600.00, and a valuation-status cell (e.g. «سهم واحد تحت سعر الحماية»).
2. **Add form ABOVE the holdings,** collapsible «+ أضف سهمًا»:
   - stock search (datalist: ticker + Arabic name);
   - quantity mode toggle **عدد الأسهم** (default) / المبلغ بالجنيه;
   - **سعر التنفيذ**;
   - date (text «يوم/شهر/سنة», «(اختياري، الافتراضي اليوم)»);
   - note;
   - live total «الإجمالي: 100 × 80.00 = 8,000.00 ج.م» (in amount mode: shares = amount ÷ price);
   - primary button «أضف إلى المحفظة»;
   - secondary «استيراد CSV» (explained in one line; can be a later phase).
3. **Holdings grid:**
   - السهم (qty × avg cost under it), آخر سعر (dated / stale chip), اليوم, القيمة, الربح/الخسارة, **نسبة من المحفظة** (not "الوزن", to avoid confusion with index weight), التقييم (mini ruler + sentence), row actions (edit / delete icon buttons with aria-labels; inline edit).
   - Sort by P/L contribution by default.
4. **Empty state** (see States).

### 7.5 States (`screens/States.dc.html`): implement all of them

| # | State | Content |
|---|---|---|
| 1 | Loading | skeleton rows (`bg-skeleton`) |
| 2 | Empty analyses | «لسه مفيش تحليلات» + exactly what to type: «قيّم سهم COMI» |
| 3 | Error / daily limit | «وصلت للحد اليومي (20 تحديث)، يتجدد بكره 03:00 ص بتوقيت القاهرة»; last good data date |
| 4 | Stock without price | AMOC |
| 5 | Stock not valued | ETEL, with «قيّم في المحادثة» |
| 6 | Under protection | EAST header: price vs protection, «تحت سعر الحماية بـ 3.6%», the critic's two possibilities («التقييم فاته شيء» / «السوق متشائم أكثر من اللازم»), link to the critic notes, the protection definition |
| 7 | Stale price chip | — |
| 8 | Empty portfolio | NEUTRAL icon, «تقدر تستخدم قيمة للتحليل بس» |
| 9 | No prices yet today | NEUTRAL icon |

Assumed EODHD daily reset 00:00 UTC = 03:00 Cairo (UTC+3) — **verify in EODHD docs**, then compute it; don't hard-code it.

---

## 8. Backend / data changes needed

1. **Arabic names and sectors.** `mcp/egx_mcp/universe/egx30.json` has English names only. Add `name_ar` and `sector_ar` for all 31 constituents and return them in `/egx/api/market`, `/universe` and `/portfolio`. Names used in the designs: COMI البنك التجاري الدولي · TMGH طلعت مصطفى القابضة · ETEL المصرية للاتصالات · FWRY فوري · EFIH إي فاينانس · EAST الشرقية للدخان · ABUK أبوقير للأسمدة · HRHO إي إف جي القابضة · ORAS أوراسكوم كونستراكشون · ADIB مصرف أبوظبي الإسلامي · AMOC الإسكندرية للزيوت المعدنية · SWDY السويدي إليكتريك · MFPC موبكو · ESRS حديد عز · CIEB كريدي أجريكول مصر · EGCH الصناعات الكيماوية المصرية. **Verify every Arabic name against EGX/Mubasher before shipping, and check that SWDY / ESRS / CIEB / EGCH are actually in the current `egx30.json` list (as of 13/10/2026).** If a ticker isn't there, don't add it.
2. **Market summary** (`market/summary.py`):
   - add `margin_to_fair = (fair − price)/fair` and `below_protection_by` to each row's valuation block;
   - breadth must exclude `stale` rows and add `stale` and `no_data` counts;
   - add `portfolio_today {change, change_pct, has_fresh}` (or expose it in `/portfolio`);
   - add `valuation_history` (fair and protection by date) so the Market chart can draw step lines without an extra call. Optional: the UI can call `/valuations/series/{symbol}`.
   - Unit tests for each.
3. **Portfolio summary** (`store/portfolio.py`):
   - `totals.today_change` and `today_change_pct` (fresh prices only);
   - per-holding `today_change`, `share_of_portfolio`, `margin_to_fair`, `status`;
   - default sort by P/L contribution.
4. **Digest:** add `GET /egx/api/market/digest` → ≤3 items since the previous session: status changes (needs the previous status; store a daily snapshot or compare `price_at_valuation` and the previous close), new valuations (from the `valuations` + `change_log` tables), and the largest holding move.
5. **Price at valuation must be real.** It is already stored (`price_at_valuation`). The dev seed (`scripts/seed-dev.py`) currently uses fake prices (104/112) that contradict the real candles. Update the seed to the design's demo data, which is consistent with the real EODHD closes:
   - **COMI:** v1 2026-04-15 fair 110, price 137.50 · v2 2026-07-20 fair 118, price 136.60, reason «نتائج الربع الثاني» · v3 2026-10-15 fair 131, bear 100, bull 163.75, price 122.00, reason «خفض أسعار الفائدة من البنك المركزي».
   - **TMGH:** full 2026-09-10 fair 95, bear 70, bull 118.75, price 99.05 · light 2026-10-15 fair 95, price 83.94.
   - **EAST:** full 2026-10-15 fair 36, bear 25.20, bull 45, price 27.77, rating high_risk (→ under protection).
   - **Holdings (demo):** COMI 50 @ 100.00, EAST 200 @ 31.00, ETEL 20 @ 120.00.
6. **Do not hard-code demo numbers in the UI.** The `.dc.html` files contain invented demo rows (e.g. prices for SWDY / MFPC / ESRS / CIEB / EGCH, 3-month and 1-year returns, and the methods / assumptions / risk values of the COMI report). They exist only to show layout.

---

## 9. Implementation plan (phases + acceptance criteria)

> **Update 18 Oct 2026:** the browser dev mode (`run-dev.sh`, `seed-dev.py`) was removed. Verify in the desktop app (Monos), which loads `main` from `/Volumes/ssd-work/egx`. See `CLAUDE.md`.

Work on a branch `ui-qima`. After each phase, run `uv run --project mcp pytest -q` and `node bundle/build-client.mjs`, and check both themes in the browser dev mode (`./scripts/run-dev.sh`, seeded with `scripts/seed-dev.py`). Commit per phase.

| Phase | Scope | Done when |
|---|---|---|
| **P1 Foundations** | shared CSS: tokens per §5, `.num` rule, type scale, chips, buttons, cards, grid table, skeleton; helpers `fmtPrice`, `fmtSigned` (U+2212, signs inside), `fmtPct`, `marginSentence`, `statusOf`; Arabic names (§8.1) | no hex colours in our CSS (grep); every signed number renders inside one `.num` element; unit tests for helpers |
| **P2 Backend** | §8.2–8.5 + tests + seed update | pytest green; `/egx/api/market` returns margin, stale-aware breadth and portfolio_today; seed matches §8.5 |
| **P3 Identity** | locale name, neutral `icon.svg`, dynamic sidebar icon + label «قيمة», shared header component | icon is UP/DOWN/NEUTRAL according to the §6 check order (test with an empty portfolio, a stale-only portfolio, up and down) |
| **P4 Market** | §7.1 | 7 columns; filters and counts correct; «عرض N من 31» true; stale excluded from today and breadth; no look-ahead lines; first row ≤ ~300px from the panel top at 1280px; works at 900px width |
| **P5 Analyses + Analysis** | §7.2–7.3 | same margin numbers as Market for the same stock; history chart uses real prices; every abbreviation explained; no raw keys or `[brackets]` visible |
| **P6 Portfolio** | §7.4 | today shown first; live total in the form; «سعر التنفيذ»; share-of-portfolio column; sorting |
| **P7 States + polish** | §7.5, empty/error/loading everywhere; keyboard and focus; final RTL/bidi pass (zoom on every long text) | all 9 states reachable; no sentence ends on a number before punctuation |

**Visual QA:** compare each screen with `docs/design/screenshots/<Screen>-{light,dark}.png`. Layout and copy should match closely. Exact pixel spacing can follow the existing Harness feel.

---

## 10. Open items / known caveats

- The amber-on-amber contrast (§5) is a Harness palette limit and is accepted.
- The static app logo can't be dynamic, so it uses the NEUTRAL glyph (§6).
- The green/red icon may be read as buy/sell by some users (test finding). Yassen decided to keep it. Don't change it without asking him.
- Dark mode: the amber "price above fair" shading in the Analysis history chart is faint. Raise its opacity a little if needed, staying within the token.
- Check whether the Harness chat exposes an API to pre-fill the input for «قيّم سهم X». If it doesn't, use the clipboard + toast fallback (§7.1).
- Product facts (EGX hours, limits, the EODHD plan) are as of October 2026.
