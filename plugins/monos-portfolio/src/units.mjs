// «السجل»: how amounts read on the ledger screen (portfolio.js, moves.js). ES module.
import { fmtNumber } from '../../shared/format.mjs'

export const CURRENCY_SIGN = { EGP: 'ج.م', USD: '$', EUR: '€', GBP: '£', SAR: 'ر.س', AED: 'د.إ' }

/** Whole pounds for values and costs: the column reads as amounts, not prices. */
export const money = (v) => fmtNumber(v, 0)
export const sign = (currency) => CURRENCY_SIGN[currency] || currency
