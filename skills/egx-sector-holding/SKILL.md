---
name: egx-sector-holding
description: Valuation method for EGX holding companies and non-bank financial groups (sum-of-the-parts NAV with a holding discount). Load from egx-valuation when valuation_model is holding or nonbank_financial.
---

# Holdings and non-bank financial groups

## Primary: sum-of-the-parts NAV
`value_nav(components, shares_outstanding, net_debt, other_liabilities, discount)`
- List each material subsidiary or stake as a component with `value` (the whole business) and `stake` (ownership share).
- Value listed stakes at market price × shares held; cite the price date.
- Value unlisted businesses with the method that fits them (DCF via `value_dcf`, P/B via `value_bank_pb` for a bank or lender, multiples) and record that sub-valuation in `assumptions`.
- Net debt and other liabilities are at the holding (parent) level only; subsidiary debt is already inside each component's equity value.
- Capitalise recurring head-office costs into `other_liabilities` when they are material.

## Holding discount
Choose the discount from the company's own historical discount of market cap to NAV when you can compute it; otherwise justify a range. Higher discount (bear) for: opaque structures, minority stakes without control, cash trapped in subsidiaries, a record of value-destroying deals. Lower (bull) for: listed and liquid stakes, clear cash return to shareholders.

## Non-bank financials (brokerage, asset management, leasing, consumer finance)
- Lending arms: justified P/B like banks (`value_bank_pb`).
- Fee businesses (brokerage, asset management, investment banking): P/E on normalised earnings; trading volumes are cyclical, so do not capitalise a peak year.
- Combine the arms through `value_nav`.

## Statement scores
`quality_scores_from_financials` is not meaningful for financial groups; rate risk with the general metrics, auditor opinion and capital increases.
