---
name: egx-critic
description: Mandatory adversarial review of a draft EGX valuation before it is saved, including the below-protection-price case. Load from egx-valuation step 9 and whenever weekly_check or pricing_levels reports review_required.
---

# Critic review

Prefer delegating this to a subagent (the `subagent` tool) with the draft valuation as its only context, instructed to attack it: a reviewer that did not write the assumptions finds more. If delegation is unavailable, switch roles explicitly and review your own draft as a hostile reader.

## Questions the critic must answer
1. **Optimism**: which assumption is most generous compared with the company's own history (growth, margins, ROE, sell-out pace, multiple)? What happens to fair value if it reverts to the 5-year average? Recompute with tools if the impact is material.
2. **Currency**: are all cash flows and rates in one currency? Is FX risk in the bear case?
3. **Terminal value**: what share of value is terminal? Is the steady-state reinvestment consistent with the growth?
4. **Missing items**: off-balance-sheet obligations, minority interests, customer advances, land payables, pending litigation, government pricing decisions.
5. **Earnings quality**: do reported profits convert to cash (CFO vs net income)? Any Beneish or auditor warning?
6. **Market disagreement**: why is the market price where it is? State the market's most plausible view in one or two lines.

## Below the protection price (review_required)
When the price is under fair value × 0.80, present both explanations to the user and say which evidence supports each:
- **The valuation missed something** the market sees (name the candidate: earnings downgrade, funding stress, regulatory risk, governance).
- **The market is overly pessimistic** (forced selling, index outflows, sentiment) while the fundamentals behind the fair value still hold.
Do not resolve this into advice; the user decides. The critic notes must contain the word "protection" (or "الحماية") and address this case, or saving is refused.

## Output
Write `critic_notes`: the issues found, what was changed as a result, and what remains uncertain. Keep it factual.
