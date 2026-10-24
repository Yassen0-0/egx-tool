// Run: npm test. The «السجل» search (monos-portfolio/src/search.mjs): spelling folds and ranking.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalize, rank, search } from '../monos-portfolio/src/search.mjs'

const CATALOG = [
  { key: 'USD', kind: 'currency', name: 'الدولار الأمريكي', name_en: 'US Dollar', symbol: 'USD', aliases: ['دولار'] },
  { key: 'XAU-G', kind: 'gold', name: 'الذهب (جرام)', name_en: 'Gold (gram)', symbol: 'XAU', aliases: ['ذهب', 'دهب'] },
  { key: 'COMI', kind: 'stock', name: 'البنك التجاري الدولي', name_en: 'Commercial International Bank', symbol: 'COMI', aliases: [] },
  { key: 'CCAP', kind: 'stock', name: 'القلعة للاستثمارات المالية', name_en: 'Qalaa Holdings', symbol: 'CCAP', aliases: [] },
]

test('spelling folds: hamza forms, ta marbuta, alef maqsura, diacritics and «ال»', () => {
  assert.equal(normalize('الإسترليني'), 'استرليني')
  assert.equal(normalize('أُونصة'), 'اونصه')
  assert.equal(normalize('مصطفى'), 'مصطفي')
  assert.equal(normalize('  COMI '), 'comi')
  assert.equal(normalize('دهب ٢١'), 'دهب 21')  // Arabic-Indic digits, as the Python search folds them
})

test('symbol first, then the start of a word, then inside a name', () => {
  assert.equal(rank(CATALOG[2], 'comi'), 0)
  assert.equal(rank(CATALOG[2], 'تجار'), 1)
  assert.equal(rank(CATALOG[3], 'ثمار'), 2)  // «للاستثمارات»
  assert.equal(rank(CATALOG[0], 'يورو'), null)
  assert.deepEqual(search(CATALOG, 'دهب').map((e) => e.key), ['XAU-G'])
  assert.deepEqual(search(CATALOG, ''), [])
  assert.equal(search(CATALOG, 'ال', 1).length, 1)
})
