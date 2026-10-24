// Run: npm test (node --test plugins/test/*.test.mjs)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MINUS, fmtPrice, fmtNumber, fmtSigned, fmtPct, fmtQty, fmtCount, iconState, toneOf,
  cairoDay, fmtDayMonth, fmtDate,
} from '../shared/format.mjs'

// Every screen source: the shared modules and each plugin's src/ folder.
const pluginsDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDirs = [join(pluginsDir, 'shared'), ...readdirSync(pluginsDir).filter((d) => d.startsWith('monos-'))
  .map((d) => join(pluginsDir, d, 'src')).filter((d) => existsSync(d))]
// Files only: shared/logos/ holds the companies' own brand marks, whose colours are theirs.
const sources = sourceDirs.flatMap((dir) => readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => join(dir, d.name)))

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
  for (const s of [fmtSigned(-5), fmtPct(-0.5, { signed: true })]) {
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
})

test('icon state follows the ledger: no assets or no fresh price is neutral', () => {
  assert.equal(iconState(null), 'neutral')
  assert.equal(iconState({ groups: [], totals: { assets: 0, today_change: 5, today_has_fresh: true } }), 'neutral')
  assert.equal(iconState({ groups: [], totals: { assets: 2, today_change: 5, today_has_fresh: false } }), 'neutral')
  assert.equal(iconState({ groups: [], totals: { assets: 2, today_change: 0.001, today_has_fresh: true } }), 'neutral')
  assert.equal(iconState({ groups: [], totals: { assets: 2, today_change: 50, today_has_fresh: true } }), 'up')
  assert.equal(iconState({ groups: [], totals: { assets: 2, today_change: -3, today_has_fresh: true } }), 'down')
})

test('dates are Cairo calendar days', () => {
  assert.equal(cairoDay('2026-10-14'), '2026-10-14')
  assert.equal(cairoDay('2026-10-14T22:30:00+00:00'), '2026-10-15')
  assert.equal(fmtDayMonth('2026-10-14'), '14/10')
  assert.equal(fmtDate('2026-10-14'), '14/10/2026')
  assert.equal(fmtDate(null), '—')
})

test('tone classes', () => {
  assert.equal(toneOf(0.01), 'q-up')
  assert.equal(toneOf(-1), 'q-down')
  assert.equal(toneOf(0), '')
  assert.equal(toneOf(null), '')
})

test('our CSS and UI source contain no hex colours (tokens only, except the brand icon)', () => {
  // The Monos app icon is a fixed brand asset (plugins/monos-identity/assets/monos/): #37B77A square,
  // #FFFFFF glyph. Those two are the only hex values allowed outside the design tokens.
  const brand = new Set(['#37B77A', '#FFFFFF'])
  for (const name of sources) {
    const text = readFileSync(name, 'utf8')
    const hits = (text.match(/#[0-9a-fA-F]{3,8}\b(?![\w-])/g) || []).filter((h) => !brand.has(h))
    assert.deepEqual(hits, [], `${name} has hex colours`)
  }
})

test('stylesheets have balanced braces', () => {
  for (const name of sources.filter((f) => f.endsWith('.css'))) {
    let depth = 0
    for (const ch of readFileSync(name, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')) {
      if (ch === '{') depth++
      if (ch === '}') depth--
      assert.ok(depth >= 0 && depth <= 2, `${name}: unbalanced braces`)
    }
    assert.equal(depth, 0, `${name}: unclosed rule`)
  }
})

test('form inputs: numbers and dates as people type them', async () => {
  const { parseNumberInput, parseDayInput } = await import('../shared/format.mjs')
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


test('a date field: empty is today, the day words, «من غير تاريخ», and a typed number keeps its decimals', async () => {
  const { resolveDay, parseDayInput, todayCairo, shiftDay, groupTyped, NO_DATE } = await import('../shared/format.mjs')
  const today = todayCairo()
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(resolveDay(''), today)
  assert.equal(resolveDay('النهارده'), today)
  assert.equal(resolveDay('امبارح'), shiftDay(today, -1))
  assert.equal(resolveDay(NO_DATE), null)
  assert.equal(resolveDay('31/02/2026'), undefined)
  assert.equal(parseDayInput(''), null)  // the parser itself still reads empty as nothing
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28')
  assert.equal(groupTyped('100000.5'), '100,000.5')
  assert.equal(groupTyped('١٢٣٤٥'), '12,345')
  assert.equal(groupTyped('abc'), 'abc')
})
