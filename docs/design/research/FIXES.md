# Round 2 fixes — shared rules for all fix agents

Read first: SPEC.md (same folder), the two usability reports usability-mostafa.md and usability-nour.md (same folder). Your files are in /tmp/claude-0/-home-claude/9f1a880d-96ec-5ca4-8918-b432dc6aa9de/scratchpad/egx-design/project/. Edit in place (Edit tool or a full rewrite with Write). Keep the Harness tokens / format rules from SPEC.md.

## Verify visually (you MUST do this)
Render your files and look at the PNGs:
```
cd /tmp/claude-0/-home-claude/9f1a880d-96ec-5ca4-8918-b432dc6aa9de/scratchpad && cp egx-design/project/<Name>.dc.html render/ && python3 shot.py render shots <Name>
```
That writes shots/<Name>-light.png and shots/<Name>-dark.png (full page). Read them with the Read tool (crop tall ones first with PIL into ≤1300px slices). Fix what you see, re-render, repeat until clean. Then set `$preview.height` in data-props to the real rendered height (+40px) and report it. Console errors about `{{...}}` in an SVG `d` attribute are pre-render warnings; avoid them anyway by putting the whole `<path>` choice in `<sc-if>` branches instead of a `d="{{hole}}"`.

## One set of definitions across ALL screens (biggest bug last round)
- **الفرق عن العادل** = (fair − price) / fair. COMI 122.00 vs 131.00 → "أقل من العادل بـ 6.9%". TMGH 83.94 vs 95.00 → 11.6%. EAST 27.77 vs 36.00 → 22.9%. If price > fair → "أعلى من العادل بـ x%". Never show a bare signed gap; always the sentence form or a compact "أقل 6.9%" with the word.
- **تحت سعر الحماية بـ** = (protection − price) / protection: EAST 27.77 vs 28.80 → 3.6%.
- Labels, exactly: السعر العادل · النطاق (المتشائم – المتفائل) · سعر الحماية · التصنيف · تاريخ التقييم. Drop "سعر الدخول المرجعي" as a separate number (it duplicates fair). Where the concept is needed write once: "مرجع الدخول = السعر العادل نفسه، وليس توصية بالشراء."
- Protection definition (show via a small (?) button/tooltip or one helper line wherever protection appears big): "سعر الحماية = 80% من السعر العادل. لو السعر نزل تحته، المحلل بيراجع التقييم تلقائيًا. ده تنبيه للمراجعة، مش أمر بيع."
- Spelling: المتفائل (not المتقائل). Session: today is Thursday 15 Oct 2026, 09:02 → "الجلسة مغلقة · تفتح اليوم 10:00".
- Replace jargon for beginners: "اتساع السوق" → "صاعد / هابط اليوم"; "طلبات EODHD 14/20" → "تحديثات الأسعار اليوم 14 من 20" with source "المصدر: EODHD" in small text; Lightweight Charts attribution stays but small and quiet.

## Numbers in RTL (second biggest bug)
- Every signed value is ONE element: `<span class="num">+1.00 (+0.83%)</span>` — sign, digits and % inside the same LTR span. Never put % or the sign in surrounding Arabic text. Minus = U+2212 "−".
- Arrows between numbers inside LTR span, old → new: `<span class="num">118.00 → 131.00</span>`.
- Thousands separators: 6,100.00.

## No visible bracket placeholders
Last round the reports were full of [قيمة] [تاريخ] [المصدر]. Replace them with realistic, clearly DEMO content and add ONE small chip in the panel header: "بيانات تجريبية" (style: bg-module-platform, label-secondary, radius-xs). Demo content must be plausible for an Egyptian bank / developer / tobacco company and internally consistent with the sample numbers. Valuation dates: COMI v1 2026-04-15 (price then 104.00), v2 2026-07-20 (price 112.00), v3 2026-10-15 (price 122.00). TMGH full 2026-09-10 (price 88.00, fair 95.00), TMGH light 2026-10-15 (price 83.90, fair unchanged 95.00, reason "تحديث أسبوعي: لا تغيير جوهري"). EAST full 2026-10-15 (price 27.77).

## Header icon (owner's decision)
Tool name «قيمة». Icon = rounded square with an arrow, colored by today's portfolio change. Today the portfolio is UP (+50.00), so use the up state everywhere:
```html
<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" style="fill: var(--dsw-alias-file-diff-added-marker)"></rect><path d="M12 18.5V6M6.5 11.5L12 6l5.5 5.5" fill="none" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" style="stroke: var(--dsw-alias-bg-base)"></path></svg>
```
(down state: red `file-diff-deleted-marker`, path `M12 5.5V18M6.5 12.5L12 18l5.5-5.5`.) Add `--dsw-alias-file-diff-added-marker` / `-deleted-marker` to your token blocks if missing (light #01A241/#BA2723, dark #41C977/#FA423E).

## Portfolio demo holdings (treat all as demo; totals include all three)
COMI 50 @ 100.00, close 122.00 (14/10), day +1.00 → day +50.00. EAST 200 @ 31.00, close 27.77, day +0.18 → +36.00. ETEL 20 @ 120.00, close 145.00, day −1.80 → −36.00. Totals: cost 13,600.00; value 14,554.00; P/L +954.00 (+7.0%); TODAY +50.00 (+0.34%).

## Quality bar
Calm, native DeepSeek Harness look. Fewer things per row, bigger click targets (≥36px rows, ≥32px controls), consistent 8px rhythm, same header pattern on every screen (icon 22px + «قيمة» + "/" + screen name + demo chip on the right; actions on the left). Text ≥12px; secondary text uses label-secondary (not tertiary) when it carries information. Dark mode: make sure bars, rulers and borders stay visible (use border-l3/l4 for tracks).
