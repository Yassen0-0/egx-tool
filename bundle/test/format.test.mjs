// Run: node --test bundle/test/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MINUS, fmtPrice, fmtNumber, fmtSigned, fmtPct, fmtChange, fmtArrow, fmtQty, fmtCount,
  marginToFair, belowProtectionBy, statusOf, marginSentence, rulerScale, iconState, toneOf,
  cairoDay, fmtDayMonth, fmtDate, fmtLongDay, fmtTime,
} from '../src/format.mjs'

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

test('prices: two decimals, Latin digits, comma thousands, U+2212', () => {
  assert.equal(fmtPrice(122), '122.00')
  assert.equal(fmtPrice(14554), '14,554.00')
  assert.equal(fmtPrice(-1.8), `${MINUS}1.80`)
  assert.equal(fmtPrice(null), '—')
  assert.equal(fmtNumber(1234.5678, 1), '1,234.6')
  assert.equal(fmtCount(16), '16')
  assert.equal(fmtQty(100), '100')
  assert.equal(fmtQty(62.5), '62.5')
})

test('signed values keep the sign with the digits and never use a hyphen or bidi marks', () => {
  assert.equal(fmtSigned(1), '+1.00')
  assert.equal(fmtSigned(-0.06), `${MINUS}0.06`)
  assert.equal(fmtSigned(0), '0.00')
  assert.equal(fmtSigned(-0.004), '0.00')
  for (const s of [fmtSigned(-5), fmtPct(-0.5, { signed: true }), fmtChange(-1.8, -0.0123)]) {
    assert.ok(!s.includes('-'), s)
    assert.ok(!/[‎‏؜]/.test(s), s)
  }
})

test('percent from fractions', () => {
  assert.equal(fmtPct(0.069), '6.9%')
  assert.equal(fmtPct(0.0083, { digits: 2, signed: true }), '+0.83%')
  assert.equal(fmtPct(-0.085, { signed: true }), `${MINUS}8.5%`)
  assert.equal(fmtPct(-0.085), `${MINUS}8.5%`)
  assert.equal(fmtPct(0, { signed: true }), '0.0%')
  assert.equal(fmtChange(1, 0.0083), '+1.00 (+0.83%)')
  assert.equal(fmtChange(-1.8, -0.0123), `${MINUS}1.80 (${MINUS}1.23%)`)
  assert.equal(fmtArrow(118, 131), '118.00 → 131.00')
})

test('margin is measured against fair value, not price (COMI 122 vs 131 → 6.9%)', () => {
  assert.equal(fmtPct(marginToFair(131, 122)), '6.9%')
  assert.equal(marginToFair(null, 122), null)
  assert.equal(fmtPct(belowProtectionBy(36, 27.77)), '3.6%')
  assert.equal(belowProtectionBy(131, 122), null)
})

test('status boundaries', () => {
  assert.equal(statusOf(131, 131), 'above')
  assert.equal(statusOf(136.6, 118), 'above')
  assert.equal(statusOf(122, 131), 'between')
  assert.equal(statusOf(104.8, 131), 'between')
  assert.equal(statusOf(104.79, 131), 'under')
  assert.equal(statusOf(null, 131), null)
})

test('margin sentences', () => {
  assert.deepEqual(marginSentence(122, 131), { status: 'between', mark: '○', text: 'أقل من العادل بـ', value: '6.9%' })
  assert.deepEqual(marginSentence(136.6, 118), { status: 'above', mark: '○', text: 'أعلى من العادل بـ', value: '15.8%' })
  assert.deepEqual(marginSentence(27.77, 36), { status: 'under', mark: '◆', text: 'تحت سعر الحماية بـ', value: '3.6%' })
  assert.equal(marginSentence(131, 131).text, 'عند السعر العادل')
  assert.equal(marginSentence(null, 131), null)
})

test('ruler keeps every mark on the track and in value order', () => {
  const r = rulerScale({ bear: 100, bull: 163.75, fair: 131, price: 122 })
  for (const k of ['bear', 'bull', 'fair', 'protection', 'price']) assert.ok(r[k] > 0 && r[k] < 100, k)
  assert.ok(r.bear < r.protection && r.protection < r.price && r.price < r.fair && r.fair < r.bull)
  assert.equal(rulerScale({}), null)
})

test('icon state follows the §6 check order', () => {
  assert.equal(iconState(null), 'neutral')
  assert.equal(iconState({ holdings: [], totals: { today_change: 5, today_has_fresh: true } }), 'neutral')
  const one = [{ symbol: 'COMI' }]
  assert.equal(iconState({ holdings: one, totals: { today_change: 5, today_has_fresh: false } }), 'neutral')
  assert.equal(iconState({ holdings: one, totals: { today_change: 0.001, today_has_fresh: true } }), 'neutral')
  assert.equal(iconState({ holdings: one, totals: { today_change: 50, today_has_fresh: true } }), 'up')
  assert.equal(iconState({ holdings: one, totals: { today_change: -3, today_has_fresh: true } }), 'down')
})

test('tone classes', () => {
  assert.equal(toneOf(0.01), 'q-up')
  assert.equal(toneOf(-1), 'q-down')
  assert.equal(toneOf(0), '')
  assert.equal(toneOf(null), '')
})

test('dates are Cairo calendar days', () => {
  assert.equal(cairoDay('2026-10-14'), '2026-10-14')
  assert.equal(cairoDay('2026-10-14T22:30:00+00:00'), '2026-10-15')
  assert.equal(fmtDayMonth('2026-10-14'), '14/10')
  assert.equal(fmtDate('2026-10-14'), '14/10/2026')
  assert.equal(fmtLongDay('2026-10-14'), 'الأربعاء 14 أكتوبر')
  assert.equal(fmtTime('2026-10-15T06:02:00+00:00'), '09:02')
  assert.equal(fmtDate(null), '—')
})

test('our CSS and UI source contain no hex colours (tokens only)', () => {
  for (const name of readdirSync(src)) {
    const text = readFileSync(join(src, name), 'utf8')
    const hits = text.match(/#[0-9a-fA-F]{3,8}\b(?![\w-])/g) || []
    assert.deepEqual(hits, [], `${name} has hex colours`)
  }
})

test('compact volumes', async () => {
  const { fmtCompact } = await import('../src/format.mjs')
  assert.equal(fmtCompact(6190000), '6.19M')
  assert.equal(fmtCompact(850000), '850K')
  assert.equal(fmtCompact(12), '12')
})
