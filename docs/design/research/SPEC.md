# EGX tool — redesign spec for design agents

Read this whole file first. Also skim the three research files beside it (01-tools.md, 02-investor-voice.md, 03-egypt-arabic.md) and the product brief at /mnt/user-data/uploads/egx/docs/design/CLAUDE_DESIGN_BRIEF.md.

## 0. What went wrong last round (do not repeat)
The owner rejected three earlier directions: "they all look the same, you only changed colors, and the tool feels ugly / not practical". So:
- **Colors are NOT ours to choose.** Use ONLY the DeepSeek Harness tokens below, by their real `--dsw-alias-*` names, so the panels are indistinguishable in style from the host app. No custom hex anywhere except inside the token blocks. No webfonts — the harness font stack only.
- Our identity = tool NAME + ICON only.
- "Practical" = every element answers a real investor question fast (research §2). Remove decoration, invented widgets, filler. Calm, native-feeling, dense where it matters, generous where reading happens. Think macOS-native utility inside a chat app, not a trading terminal and not a marketing page.

## 1. Product truths
- Solo Egyptian retail investor, Arabic UI, RTL, Latin digits, English tickers. Desktop panel inside DeepSeek Harness (the harness sidebar + chat are NOT ours; we design the panel content area only, ~1180px wide at 1280 window; must still work down to ~900px).
- AI analyst produces per stock: السعر العادل التقديري (bear/base/bull range), التصنيف (آمن / متوازن / مرتفع المخاطر), سعر الدخول المرجعي (= fair), سعر الحماية (= fair × 0.80, a rule, not a forecast). Most important state: **تحت سعر الحماية — يحتاج مراجعة** (critic auto-reviews; two possibilities shown: the valuation missed something, or the market is more pessimistic than warranted).
- Prices: EODHD end-of-day, delayed, never live. Free plan = 20 requests/day, so some stocks have older closes than others. Every price shows its date; a stale price gets a visible "قديم" chip.
- HARD RULE: valuation and analysis only, never buy/sell. Banned words: شراء/بيع as advice, فرصة، رخيص، هدف سعري، صعود متوقع، upside, target, bargain, stop-loss (وقف خسارة). Use: الفجوة للعادل، هامش الأمان، مرجع، النطاق، حتى تاريخ.
- EGX session: Sun–Thu, continuous 10:00–14:15, closing auction to 14:30. T+2. Daily limit ±20%.

## 2. Design principles distilled from research (ranked)
1. **Valuation ruler on every valued stock** — price dot on a bar spanning protection → fair → bull, with bear–bull range; same component in table (mini), detail (large), portfolio. (Simply Wall St / Morningstar / GuruFocus.) Fair = blue (`--dsw-alias-state-business-primary`), protection = amber (`--dsw-alias-state-warn-*`). Never green/red for valuation (green/red is ONLY daily price change).
2. **Freshness everywhere** — "إغلاق 14/10" next to every price; valuation date next to every fair value; header shows last sync, requests used, session state. Stale chip when a price is older than the last session.
3. **"What changed since last close" digest** at the top of Market — the daily habit loop: stocks that crossed into/out of under-protection, new or revised valuations (with % change of fair value), holdings' moves. Short, max 4 lines, each clickable.
4. **Neutral, defined language** — status labels: أعلى من العادل / بين الحماية والعادل / تحت سعر الحماية. Each label has a tooltip/definition. Footer on every analysis: "تقييم وليس توصية بالشراء أو البيع."
5. **Show how the value was built** (trust) — Analyses detail: methods used + weights, key assumptions (editable-looking list with values), pass/fail sanity checks (auditable, like Simply Wall St checks), risk scores (Altman Z'', Piotroski F, Beneish M, auditor opinion) with thresholds, sources with dates, critic notes, change log with reasons, fair-value history vs price chart with shaded gap.
6. **Dense, sortable, sticky table** for Market (ticker+name on the right, numbers right-aligned, tabular, LTR-isolated with U+2212 minus); row hover; click opens detail. Master–detail is preferred over inline row-expansion for the 4 tabs (decide what is most practical and say why).
7. **Portfolio tied to valuation** — each holding: qty, avg cost, value, P/L (abs + %), share of portfolio, AND its position on the valuation ruler + status. Sort by P/L contribution. Summary bar. Inline add form (stock, buy price, amount OR shares, date, note) — compact. Manual entry; mention CSV import as a secondary action.
8. **Calm states** — loading skeletons (`--dsw-alias-bg-skeleton`), empty (no analyses yet → tells exactly what to type in chat: «قيّم سهم COMI»), error (EODHD failed / limit reached with reset time), stock without price, stock not valued.
9. Numbers: wrap every number/sign/% in `<span class="num">` = `direction:ltr; unicode-bidi:isolate; font-variant-numeric:tabular-nums`. Charts' time axis runs left→right with price axis at the right; mirror only legends/controls.
10. TradingView tabs (Advanced Chart, Financials, Technical Analysis): only the FRAME is ours; draw a framed placeholder box with header "TradingView" and keep its attribution visible. Technical-analysis tab must carry the mandatory notice: "إشارة آلية من TradingView مبنية على مؤشرات فنية فقط — ليست تقييمنا وليست توصية بالشراء أو البيع."

## 3. Tokens (copy this block verbatim into the artboard's `<helmet><style>`)
The panel root gets class `t-light` or `t-dark` from a `theme` tweak. Inside, use ONLY `var(--dsw-alias-…)`, `var(--dsw-radius-…)`, `var(--dsw-font-family)`, `var(--ds-font-family-code)`.

```css
body{margin:0}
.t-light,.t-dark{font-family:var(--dsw-font-family);--dsw-font-family:-apple-system,BlinkMacSystemFont,"SF Arabic","Segoe UI","Geeza Pro",sans-serif;--ds-font-family-code:"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;--dsw-radius-xs:4px;--dsw-radius-sm:8px;--dsw-radius-md:12px;--dsw-radius-lg:16px;--dsw-radius-xl:20px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);min-height:100vh;direction:rtl}
.t-light{--dsw-alias-bg-base:#FFFFFF;--dsw-alias-bg-layer-1:#FFFFFF;--dsw-alias-bg-layer-2:#FFFFFF;--dsw-alias-bg-layer-3:#FFFFFF;--dsw-alias-bg-module-platform:#F5F6F7;--dsw-alias-bg-overlay:#E9ECF2;--dsw-alias-bg-skeleton:rgba(0,0,0,.04);--dsw-alias-border-l1:rgba(0,0,0,.04);--dsw-alias-border-l2:rgba(0,0,0,.10);--dsw-alias-border-l3:rgba(0,0,0,.12);--dsw-alias-border-l4:rgba(0,0,0,.16);--dsw-alias-brand-primary:#0F1115;--dsw-alias-button-primary-fill:#0F1115;--dsw-alias-button-primary-hover:#43454A;--dsw-alias-label-primary-foreground:#FFFFFF;--dsw-alias-button-ghost-active-fill:#EBEEF2;--dsw-alias-button-ghost-active-border:#979DA6;--dsw-alias-interactive-bg-hover:rgba(38,49,72,.06);--dsw-alias-interactive-bg-active:rgba(38,49,72,.10);--dsw-alias-label-primary:#0F1115;--dsw-alias-label-secondary:#61666B;--dsw-alias-label-tertiary:#81858C;--dsw-alias-label-caption:#ADB2B8;--dsw-alias-link:#4176E6;--dsw-alias-state-business-primary:#4176E6;--dsw-alias-state-business-tertiary:#E4EDFD;--dsw-alias-state-success-primary:#22C55E;--dsw-alias-state-success-tertiary:#E6FAED;--dsw-alias-state-error-primary:#EC1313;--dsw-alias-state-warn-primary:#F59E0B;--dsw-alias-state-warn-label:#DD8629;--dsw-alias-state-warn-tertiary:#FEF5E7;--dsw-alias-file-diff-added-marker:#01A241;--dsw-alias-file-diff-deleted-marker:#BA2723;--dsw-alias-markdown-code-block:#F9FAFB;--dsw-alias-markdown-tag:#F1F3F5;--dsw-specific-sidebar-fill:#F9FAFB;--dsw-specific-sidebar-nav-item-active:#EBEEF2;--dsw-specific-sidebar-nav-item-hover:#F1F3F5;--dsw-specific-input-major:#FFFFFF;--dsw-alias-tooltip-bg:#2C2C2E}
.t-dark{--dsw-alias-bg-base:#151517;--dsw-alias-bg-layer-1:#232324;--dsw-alias-bg-layer-2:#2C2C2E;--dsw-alias-bg-layer-3:#353638;--dsw-alias-bg-module-platform:#353638;--dsw-alias-bg-overlay:#61666B;--dsw-alias-bg-skeleton:rgba(255,255,255,.08);--dsw-alias-border-l1:rgba(255,255,255,.06);--dsw-alias-border-l2:rgba(255,255,255,.12);--dsw-alias-border-l3:rgba(255,255,255,.16);--dsw-alias-border-l4:rgba(255,255,255,.20);--dsw-alias-brand-primary:#F9FAFB;--dsw-alias-button-primary-fill:#F9FAFB;--dsw-alias-button-primary-hover:#EBEEF2;--dsw-alias-label-primary-foreground:#0F1115;--dsw-alias-button-ghost-active-fill:#43454A;--dsw-alias-button-ghost-active-border:#81858C;--dsw-alias-interactive-bg-hover:rgba(255,255,255,.08);--dsw-alias-interactive-bg-active:rgba(255,255,255,.14);--dsw-alias-label-primary:#F9FAFB;--dsw-alias-label-secondary:#CFD3D6;--dsw-alias-label-tertiary:#ADB2B8;--dsw-alias-label-caption:#81858C;--dsw-alias-link:#7AAAFF;--dsw-alias-state-business-primary:#7AAAFF;--dsw-alias-state-business-tertiary:#34415B;--dsw-alias-state-success-primary:#22C55E;--dsw-alias-state-success-tertiary:#233C2C;--dsw-alias-state-error-primary:#F25A5A;--dsw-alias-state-warn-primary:#F59E0B;--dsw-alias-state-warn-label:#DD8629;--dsw-alias-state-warn-tertiary:#27241F;--dsw-alias-file-diff-added-marker:#41C977;--dsw-alias-file-diff-deleted-marker:#FA423E;--dsw-alias-markdown-code-block:#1B1B1C;--dsw-alias-markdown-tag:#2C2C2E;--dsw-specific-sidebar-fill:#1B1B1C;--dsw-specific-sidebar-nav-item-active:#43454A;--dsw-specific-sidebar-nav-item-hover:#2C2C2E;--dsw-specific-input-major:#2C2C2E;--dsw-alias-tooltip-bg:#43454A}
.num{font-family:var(--ds-font-family-code);font-variant-numeric:tabular-nums;direction:ltr;unicode-bidi:isolate}
```
Role mapping (use exactly):
- page bg `bg-base`; cards/panels `bg-layer-1` + `border-l2`; sunken areas, table header, chips `bg-module-platform` / `markdown-tag`; hover `interactive-bg-hover`; selected `interactive-bg-active` or `button-ghost-active-fill`.
- text: `label-primary`, secondary `label-secondary`, meta `label-tertiary`. (`label-caption` only for decoration, it fails contrast.)
- primary button: `button-primary-fill` bg + `label-primary-foreground` text (black in light, near-white in dark — this is the harness look). Secondary buttons: transparent + `border-l3`. Links `link`.
- price up text: `file-diff-added-marker`; price down text: `file-diff-deleted-marker` (readable greens/reds); bars/candles may use `state-success-primary` / `state-error-primary`. Always with +/− sign.
- fair value / our valuation: `state-business-primary` (DeepSeek blue), soft bg `state-business-tertiary`.
- protection / under-protection: `state-warn-label` text + `state-warn-primary` marks, bg `state-warn-tertiary`.
- radii: chips `radius-xs`, inputs/buttons/cards `radius-sm`…`radius-md`. No shadows except subtle `0 1px 2px rgba(0,0,0,.04)`.
- Type scale (px): 12 meta, 13 table, 14 body, 16 section title, 20 page title, 28–32 one hero number only. Weights 400/500/600. No letter-spacing on Arabic.

## 4. Sample data (real closes from EODHD to 14 Oct 2026; valuations are DEMO)
Row format: sym, Arabic name, sector, close, chg, chg%, 1M%, 52w low, 52w high, volume, weight%, fair, protection, bear, bull, rating, valuation date, in portfolio.
- COMI البنك التجاري الدولي، بنوك، 122.00, +1.00, +0.83, −8.5, 98.30, 145.01, 6.19M, 28.76 — fair 131.00, prot 104.80, bear 104.80, bull 163.75, آمن, 15/10, holding: 50 shares @ 100.00 (bought 2026-03-02)
- TMGH طلعت مصطفى القابضة، تطوير عقاري، 83.94, −0.06, −0.07, −13.2, 56.20, 103.87, 2.45M, 9.72 — fair 95.00, prot 76.00, bear 76.00, bull 118.75, متوازن, 15/10
- ETEL المصرية للاتصالات، اتصالات، 145.00, −1.80, −1.23, +14.2, 48.00, 156.00, 2.01M, 8.94 — not valued
- FWRY فوري، تكنولوجيا مالية، 18.40, −0.23, −1.23, −2.7, 13.90, 21.66, 3.29M, 5.74 — not valued
- EFIH إي فاينانس، تكنولوجيا مالية، 23.84, +0.23, +0.97, +3.7, 12.91, 25.40, 1.14M, 4.99 — not valued
- EAST الشرقية للدخان، أغذية وتبغ، 27.77, +0.18, +0.65, −16.1, 27.01, 49.99, 0.85M, 4.83 — fair 36.00, prot 28.80, bear 28.80, bull 45.00, مرتفع المخاطر, 15/10 → UNDER PROTECTION (−3.6%)
- ABUK أبوقير للأسمدة، أسمدة، 84.34, +0.01, +0.01, −4.8, 45.18, 96.29, 0.57M, 3.25 — not valued
- HRHO إي إف جي القابضة، خدمات مالية، 25.36, +0.16, +0.63, +0.4, 22.81, 31.50, 1.68M, 3.01 — not valued
- ORAS أوراسكوم كونستراكشون، مقاولات، 907.00, +26.00, +2.95, +6.0, 395.00, 925.00, 0.48M, 2.83 — not valued
- ADIB مصرف أبوظبي الإسلامي، بنوك، 46.76, +2.26, +5.08, −8.9, 22.95, 55.65, 2.20M, 2.64 — not valued, price dated 12/10 (STALE example)
- AMOC الإسكندرية للزيوت المعدنية، 1.33 weight — NO PRICE YET (free-plan limit)
Breadth (15 priced today): up 9, down 6, unchanged 0, no price 16. Requests 14/20. Last sync 09:02. Session closed, opens 10:00 Sun–Thu. Last close Wed 14 Oct 2026.
COMI last 10 closes: 14/10 122.00 +0.83% · 13/10 121.00 −1.22% · 12/10 122.49 −0.17% · 11/10 122.70 −1.56% · 07/10 124.65 −0.41% · 06/10 125.16 −0.71% · 05/10 126.05 −0.74% · 04/10 126.99 −0.55% · 01/10 127.69 +1.10% · 30/09 126.30 −1.34%.
COMI fair-value history: 110.00 (price then 104.00) → 118.00 (+7.3%, reason "نتائج الربع الثالث") → 131.00 (+11.0%, reason "تغير أسعار الفائدة"). Saved valuations: COMI ×3 (full), TMGH full + light update, EAST full.
Candlestick SVG paths (COMI 60 sessions, viewBox 0 0 720 240, domain 100–146: y(140)=31.3, y(130)=83.5, y(120)=135.7, y(110)=187.8, fair 131 → y 78.3, protection 104.8 → y 215, last 122 → y 125.2) are in /tmp/claude-0/-home-claude/9f1a880d-96ec-5ca4-8918-b432dc6aa9de/scratchpad/egx-design/project/Main.dc.html (paths with class cu/cd) — reuse them (class cu = up, cd = down). EAST paths (viewBox 720×260, domain 26–40, fair 36 → y 74.3, prot 28.8 → y 208, last 27.77 → y 227.1) are in C-Cockpit.dc.html in the same folder.
Do NOT invent other numbers (P/E, market cap, assumptions values…) unless clearly marked as an example with brackets, e.g. [مثال] or [قيمة].

## 5. Artboard format (canvas `.dc.html`) — must follow exactly
Full rules: /tmp/claude-0/-home-claude/9f1a880d-96ec-5ca4-8918-b432dc6aa9de/scratchpad/artifact-files/744b5c4f-c921-4d92-860e-0931333410bf/artifact-type/reference/format.md (read it). Working syntax example: Main.dc.html in the egx-design/project folder (copy its structure, NOT its look).
Essentials:
- File skeleton: `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>…</title><script src="./support.js"></script></head><body><x-dc><helmet><style>…</style></helmet> …markup… </x-dc><script type="text/x-dc" data-dc-script data-props='{…}'>class Component extends DCLogic { renderVals(){ return {…}; } }</script></body></html>`. Keep the support.js line exactly.
- Close every element, quote every attribute. `{{hole}}` is a dotted lookup into renderVals() only (no expressions). Loops `<sc-for list="{{rows}}" as="r" hint-placeholder-count="10">`, branches `<sc-if value="{{cond}}" hint-placeholder-val="{{true}}">`. Events `onClick="{{handler}}"` with handlers returned from renderVals; state via this.state / this.setState.
- NEVER use `<table>` (custom elements get hoisted out of tables) — use CSS grid divs. No `<iframe>`, no emoji, no external scripts, no fonts links. Icons = inline stroke SVG.
- Root: `<div class="t-{{theme}}">` with a `theme` enum tweak `{"editor":"enum","options":["light","dark"],"default":"light"}` and `$preview` `{"width":1280,"height":<your height>}`. Layout is a PAGE: fluid (max-width container, %, fr, flex-wrap), works at 900px.
- Real `<button>`, `<a href>`, `<input>`+`<label>`; aria-label on icon-only buttons; contrast ≥4.5:1.
- Write each file with the Write tool, in one go. Do not render, screenshot, or publish — the lead publishes.

## 6. Panel chrome
Each screen = our panel content only. Top: a slim panel header (tool icon 20px + tool name + screen title, right side; actions left). Use the tool name placeholder **«[اسم الأداة]»** and a generic square icon placeholder (the identity agent decides the real name/icon; lead will swap). No fake harness sidebar except in Identity artboard.
