# Round 3 fixes (shared rules for all agents)

Same workflow as FIXES.md (read it again; its rules still apply): edit the files in /tmp/claude-0/-home-claude/9f1a880d-96ec-5ca4-8918-b432dc6aa9de/scratchpad/egx-design/project/, verify with `python3 shot.py render shots <Name>` (copy the file into render/ first), look at the PNGs, iterate, set `$preview.height` = rendered height + 40. Round-2 test reports: research/usability-mostafa-r2.md and research/usability-nour-r2.md — read the parts about your screens.

## 1. Icon rule (owner's decision, final)
The «قيمة» icon follows the user's portfolio TODAY:
- portfolio up → green rounded square + up arrow (`file-diff-added-marker`, path `M12 18.5V6M6.5 11.5L12 6l5.5 5.5`, stroke = bg-base).
- portfolio down → red square + down arrow (`file-diff-deleted-marker`, path `M12 5.5V18M6.5 12.5L12 18l5.5-5.5`).
- NEUTRAL in every other case: no change, no prices yet today, OR the user has no holdings at all (just uses the tool for analysis). Neutral = rounded square in `label-primary` with a "valuation ruler" glyph in `bg-base`: horizontal line with end ticks and a centre dot:
```html
<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" style="fill: var(--dsw-alias-label-primary)"></rect><path d="M5.5 12h13M5.5 9v6M18.5 9v6" fill="none" stroke-width="2.2" stroke-linecap="round" style="stroke: var(--dsw-alias-bg-base)"></path><circle cx="12" cy="12" r="2.6" style="fill: var(--dsw-alias-bg-base)"></circle></svg>
```
The neutral version is also the static app logo (icon.svg).
Current demo state: portfolio +50.00 today → headers show the UP icon, EXCEPT the "empty portfolio" and "no prices yet" state cards → NEUTRAL.

## 2. Real prices at valuation dates (fixes data conflict)
COMI closes (real, EODHD): 15/04/2026 137.50 · 20/07/2026 136.60 · 14/10/2026 122.00. Month-end closes: 30/04 135.00 · 25/05 133.00 · 30/06 127.50 · 30/07 141.00 · 31/08 136.30 · 30/09 126.30 · 14/10 122.00.
TMGH closes: 10/09/2026 99.05 · 14/10 83.94. Month-ends: 30/04 94.11 · 25/05 96.00 · 30/06 94.49 · 30/07 97.30 · 31/08 97.00 · 30/09 86.98.
So "price at valuation": COMI v1 (15/04) 137.50 vs fair 110 → was أعلى من العادل; v2 (20/07) 136.60 vs 118 → أعلى; v3 (15/10, using close 14/10) 122.00 vs 131 → أقل بـ 6.9%. TMGH full (10/09) 99.05 vs 95 → أعلى; TMGH light (15/10) 83.94 → أقل بـ 11.6%. Replace every 104/112/83.90 "price then" with these.

## 3. Bear ≠ protection
New scenario ranges (protection stays fair × 0.80):
- COMI: المتشائم 100.00 · العادل 131.00 · المتفائل 163.75 · الحماية 104.80
- TMGH: 70.00 · 95.00 · 118.75 · الحماية 76.00
- EAST: 25.20 · 36.00 · 45.00 · الحماية 28.80
Rulers show the bear–bull range band, protection tick and fair tick separately (no combined "الحماية · المتشائم" label).

## 4. Stale prices
A stale price (ADIB, last close 12/10) is NOT counted in today's change, breadth, or "اليوم" sorting: show its change greyed with "جلسة 12/10". Breadth today = صاعد 8 · هابط 6 · قديم 1 · بدون سعر 16.

## 5. Bidi punctuation
In running Arabic sentences a number must never be the last thing before "." or "،" if it renders as ".26.0%". Either rephrase so the sentence doesn't end on a number, or put the punctuation inside a trailing Arabic word. Check every long text visually (zoom). Percent always "26.0%" inside `.num`. Fix typo "النبغ" → "التبغ". Remove the stray ″ in "Altman Z″" (write Altman Z-Score).

## 6. Beginner explanations
Any abbreviation shown (CAR, CET1, NPL, LCR, EODHD, "تحديث خفيف/كامل") gets an Arabic explanation on first sight (inline short text or (?) toggle). A failed sanity check shows a one-line "هل ده يقلق؟" answer.
