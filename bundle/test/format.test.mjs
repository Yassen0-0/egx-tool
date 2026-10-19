// Run: node --test bundle/test/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MINUS, fmtPrice, fmtNumber, fmtSigned, fmtPct, fmtChange, fmtArrow, fmtQty, fmtCount,
  marginToFair, belowProtectionBy, statusOf, marginSentence, rulerScale, iconState, toneOf,
  cairoDay, fmtDayMonth, fmtDate, fmtLongDay, fmtTime, lastCloseOf, callsUsed,
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

test('our CSS and UI source contain no hex colours (tokens only, except the brand icon)', () => {
  // The Monos app icon is a fixed brand asset (bundle/assets/monos/): #37B77A square,
  // #FFFFFF glyph. Those two are the only hex values allowed outside the design tokens.
  const brand = new Set(['#37B77A', '#FFFFFF'])
  for (const name of readdirSync(src)) {
    const text = readFileSync(join(src, name), 'utf8')
    const hits = (text.match(/#[0-9a-fA-F]{3,8}\b(?![\w-])/g) || []).filter((h) => !brand.has(h))
    assert.deepEqual(hits, [], `${name} has hex colours`)
  }
})

test('compact volumes', async () => {
  const { fmtCompact } = await import('../src/format.mjs')
  assert.equal(fmtCompact(6190000), '6.19M')
  assert.equal(fmtCompact(850000), '850K')
  assert.equal(fmtCompact(12), '12')
})

test('session line', async () => {
  const { sessionLine, rangePosition } = await import('../src/format.mjs')
  assert.deepEqual(sessionLine('2026-10-15T09:02+03:00', false), { text: 'الجلسة مغلقة · تفتح اليوم', time: '10:00' })
  assert.deepEqual(sessionLine('2026-10-15T15:00+03:00', false), { text: 'الجلسة مغلقة · تفتح الأحد', time: '10:00' })
  assert.deepEqual(sessionLine('2026-10-14T15:00+03:00', false), { text: 'الجلسة مغلقة · تفتح غدًا', time: '10:00' })
  assert.deepEqual(sessionLine('2026-10-15T11:00+03:00', true), { text: 'الجلسة مفتوحة · تغلق', time: '14:30' })
  // with the server's holiday-aware next session: Wednesday evening before a Thursday holiday
  assert.deepEqual(sessionLine('2026-10-14T15:00+03:00', false, '2026-10-18'), { text: 'الجلسة مغلقة · تفتح الأحد', time: '10:00' })
  assert.deepEqual(sessionLine('2026-10-15T09:02+03:00', false, '2026-10-15'), { text: 'الجلسة مغلقة · تفتح اليوم', time: '10:00' })
  assert.deepEqual(sessionLine('2026-10-14T15:00+03:00', false, '2026-10-15'), { text: 'الجلسة مغلقة · تفتح غدًا', time: '10:00' })
  assert.equal(rangePosition(98.3, 145.01, 122), (122 - 98.3) / (145.01 - 98.3) * 100)
  assert.equal(rangePosition(null, 1, 1), null)
})

test('labels: every abbreviation is spelled out and values read naturally', async () => {
  const L = await import('../src/labels.mjs')
  for (const [key, [name, explain]] of Object.entries(L.RISK_LABEL)) {
    assert.ok(/[\u0600-\u06FF]/.test(name) && explain.length > 10, key)
  }
  assert.ok(L.RISK_LABEL.npl_ratio[0].includes('القروض المتعثرة'))
  assert.equal(L.riskValue(0.198, 'pct'), '19.8%')
  assert.equal(L.riskValue(false, 'auditor'), 'غير متحفّظ')
  assert.equal(L.riskValue('grey', 'zone'), 'منطقة رمادية')
  const rows = L.assumptionRows({ cost_of_equity: { value: 0.245, source: 'x' }, beta: 0.8, note: 'n' })
  assert.deepEqual(rows.map((r) => [r.label, r.value]), [['تكلفة حقوق الملكية', '24.5%'], ['بيتا السهم (حساسيته لحركة السوق)', '0.80'], ['ملاحظة', 'n']])
  assert.ok(rows.every((r) => r.known))
  assert.equal(L.methodLabel('bank_justified_pb')[0], 'مضاعف القيمة الدفترية المبرَّر')
  for (const word of ['شراء', 'بيع', 'فرصة', 'رخيص', 'هدف سعري']) {
    assert.ok(!JSON.stringify([L.RISK_LABEL, L.CHECK_LABEL, L.METHOD_LABEL]).includes(word), word)
  }
})

test('stylesheets have balanced braces', () => {
  for (const name of readdirSync(src).filter((f) => f.endsWith('.css'))) {
    let depth = 0
    for (const ch of readFileSync(join(src, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')) {
      if (ch === '{') depth++
      if (ch === '}') depth--
      assert.ok(depth >= 0 && depth <= 2, `${name}: unbalanced braces`)
    }
    assert.equal(depth, 0, `${name}: unclosed rule`)
  }
})

test('form inputs: numbers and dates as people type them', async () => {
  const { parseNumberInput, parseDayInput } = await import('../src/format.mjs')
  assert.equal(parseNumberInput('80'), 80)
  assert.equal(parseNumberInput('٨٠٫٥'), 80.5)
  assert.equal(parseNumberInput('8,000'), 8000)
  assert.equal(parseNumberInput('80,5'), 80.5)
  assert.equal(parseNumberInput(''), null)
  assert.ok(Number.isNaN(parseNumberInput('abc')))
  assert.equal(parseDayInput('2/3/2026'), '2026-03-02')
  assert.equal(parseDayInput('٠٢/٠٣/٢٠٢٦'), '2026-03-02')
  assert.equal(parseDayInput('2026-03-02'), '2026-03-02')
  assert.equal(parseDayInput(''), null)
  assert.equal(parseDayInput('31/02/2026'), undefined)
})

test('EODHD limit resets at midnight GMT, shown in Cairo time', async () => {
  const { nextLimitReset, lastLimitReset } = await import('../src/format.mjs')
  assert.deepEqual(nextLimitReset('2026-10-15T06:02:00Z'), { when: 'بكره', time: '03:00' }) // 09:02 Cairo, summer time
  assert.deepEqual(nextLimitReset('2026-11-05T10:00:00Z'), { when: 'بكره', time: '02:00' }) // winter time
  assert.deepEqual(nextLimitReset('2026-10-15T22:30:00Z'), { when: 'اليوم', time: '03:00' }) // 01:30 Cairo, reset later today
  assert.equal(lastLimitReset('2026-10-15T06:02:00Z').toISOString(), '2026-10-15T00:00:00.000Z')
})

test('last close: latest priced as_of day, timestamps cut to the date', () => {
  const rows = [
    { price: 10, as_of: '2026-10-14' },
    { price: 11, as_of: '2026-10-15T14:30:00+03:00' },
    { price: null, as_of: '2026-10-16' },
    { price: 12, as_of: null },
  ]
  assert.equal(lastCloseOf(rows), '2026-10-15')
  assert.equal(lastCloseOf([{ price: null, as_of: '2026-10-15' }]), '')
  assert.equal(lastCloseOf([]), '')
  assert.equal(lastCloseOf(null), '')
})

test('calls used: before the run plus the run, null without a daily limit', () => {
  assert.equal(callsUsed({ daily_limit: 20, used_before: 5, calls_made: 3 }), 8)
  assert.equal(callsUsed({ daily_limit: 20, calls_made: 3 }), 3)
  assert.equal(callsUsed({ daily_limit: 20 }), 0)
  assert.equal(callsUsed({ daily_limit: 0, calls_made: 3 }), null)
  assert.equal(callsUsed(null), null)
})
