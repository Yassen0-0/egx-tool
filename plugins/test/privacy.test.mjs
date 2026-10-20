// «إخفاء الأرقام»: the eye button in the ledger's header replaces every amount and percentage of
// the screen with «•••••» and brings them back on the second click. Synthetic data (fixtures/api.json).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
let harness = null
try { harness = await import('./harness.mjs') } catch { /* dev dependencies not installed */ }
const skip = !harness && 'run npm install at the repo root'
const client = join(here, '..', 'monos-portfolio', 'client.js')
const text = (el) => el.textContent.replace(/\s+/g, ' ')
// The page-wide store outlives one render in this process: every test starts from «shown».
const resetStore = () => { delete (globalThis[Symbol.for('monos.page-shared.v1')] || {}).privacy }
const isLedger = (key, host) => key === 'egx-portfolio' && host.querySelector('.l-total')

test('the eye button hides every amount of the ledger and shows them again', { skip }, async () => {
  resetStore()
  const seen = {}
  const r = await harness.renderClient([client], {
    async interact(key, host, { act, settle, window }) {
      if (!isLedger(key, host)) return
      const button = () => host.querySelector('button[aria-pressed]')
      const press = async (el) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) }); await settle() }
      const snap = () => ({
        total: text(host.querySelector('.l-total')),
        header: text(host.querySelector('header')),
        rows: [...host.querySelectorAll('.l-row')].map((row) => ({ name: row.querySelector('.l-name').textContent, nums: [...row.querySelectorAll('.num')].map((n) => n.textContent) })),
        detail: host.querySelector('.l-detail') ? text(host.querySelector('.l-detail')) : '',
        label: button().getAttribute('aria-label'), pressed: button().getAttribute('aria-pressed'),
      })
      seen.before = snap()
      await press(button())
      seen.hidden = snap()
      await press(host.querySelector('.l-row'))
      seen.hiddenOpen = snap()
      await press(button())
      seen.after = snap()
    },
  })
  resetStore()
  assert.deepEqual(r.errors, [])
  const { before, hidden, hiddenOpen, after } = seen
  assert.equal(before.pressed, 'false')
  assert.equal(before.label, 'إخفاء الأرقام')
  assert.match(before.total, /463,837/)
  assert.match(before.header, /\+0\.20%/)

  assert.equal(hidden.pressed, 'true')
  assert.equal(hidden.label, 'إظهار الأرقام')
  // the total, cost and growth carry no digit but the count of unpriced assets; the header's today % none at all
  assert.match(hidden.total, /•••••/)
  assert.doesNotMatch(hidden.total.replace(/\d+ أصل.*$/, ''), /\d/)
  assert.match(hidden.header, /•••••/)
  assert.doesNotMatch(hidden.header, /\d/)
  // names stay; every number of a row is masked (the date of a stale price is not an amount)
  assert.deepEqual(hidden.rows.map((x) => x.name), before.rows.map((x) => x.name))
  for (const row of hidden.rows) {
    for (const n of row.nums) assert.ok(n === '•••••' || n === '—' || /^\d{2}\/\d{2}$/.test(n), `${row.name}: ${n}`)
  }
  assert.ok(hidden.rows.some((x) => x.nums.includes('•••••')))
  // the opened row's purchases and prices are masked too (dates stay)
  assert.match(hiddenOpen.detail, /•••••/)
  assert.doesNotMatch(hiddenOpen.detail.replace(/\d{2}\/\d{2}\/\d{4}|\d{2}\/\d{2}/g, ''), /\d/)

  // the second click brings everything back
  assert.equal(after.pressed, 'false')
  assert.equal(after.label, 'إخفاء الأرقام')
  assert.equal(after.total, before.total)
  assert.equal(after.header, before.header)
  assert.deepEqual(after.rows.map((x) => x.nums), before.rows.map((x) => x.nums))
})

test('the choice is written to localStorage on every click', { skip }, async () => {
  resetStore()
  const stored = []
  await harness.renderClient([client], {
    async interact(key, host, { act, settle, window }) {
      if (!isLedger(key, host)) return
      for (let i = 0; i < 2; i++) {
        await act(async () => { host.querySelector('button[aria-pressed]').dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
        await settle()
        stored.push(window.localStorage.getItem('monos.privacy.hidden'))
      }
    },
  })
  resetStore()
  assert.deepEqual(stored, ['1', '0'])
})
