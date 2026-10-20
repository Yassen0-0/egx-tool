// Renders every plugin's built client.js on one page, like the host loads them, with synthetic data
// (fixtures/api.json): every screen mounts, reads only known endpoints and logs nothing unexpected,
// each plugin registers only its own slots, and the page-wide shared state is one object. Needs `npm install` at the repo
// root (jsdom, React 18.3.1 = the host's version); skipped without it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
let harness = null
try { harness = await import('./harness.mjs') } catch { /* dev dependencies not installed */ }

// Anything logged, a React list-key warning included, is a regression.
const KNOWN = []

// Every plugin with a screen, found the way the build finds them (a new plugin is tested too).
const { plugins } = await import('../build.mjs')
const CLIENTS = plugins().filter((p) => existsSync(join(p.dir, 'client.js'))).map((p) => p.manifest.name)
const clientPath = (name) => join(here, '..', name, 'client.js')

test('every screen renders from the built plugin clients', { skip: !harness && 'run npm install at the repo root' }, async () => {
  const r = await harness.renderClient(CLIENTS.map(clientPath))
  assert.deepEqual(r.slots.sort(), [
    'conversation.hero.brand.mark:conversation.hero.brand.mark', 'main:egx-portfolio', 'sidebar.panellist:egx-portfolio',
  ])
  assert.deepEqual(r.unknownRequests, [])
  assert.deepEqual(r.errors.filter((e) => !KNOWN.some((k) => k.test(e))), [])
  const text = r.html['main:egx-portfolio'].replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  assert.match(text, /Monos \/ السجل/)
  for (const heading of ['عملات', 'بتكوين', 'أسهم', 'صناديق']) assert.match(text, new RegExp(heading))
  assert.match(text, /TMGH/)
  assert.match(r.html['conversation.hero.brand.mark:conversation.hero.brand.mark'], /<svg/)
})

test('each plugin renders on its own and registers only its own slots', { skip: !harness && 'run npm install at the repo root' }, async () => {
  const own = {
    'monos-identity': ['conversation.hero.brand.mark:conversation.hero.brand.mark'],
    'monos-portfolio': ['sidebar.panellist:egx-portfolio', 'main:egx-portfolio'],
  }
  for (const name of CLIENTS) {
    const r = await harness.renderClient([clientPath(name)])
    assert.deepEqual(r.plugins, [name], 'the factory id is the package name')
    if (own[name]) assert.deepEqual(r.slots, own[name])
    else assert.ok(r.slots.length > 0, `${name} registers nothing`)
    assert.deepEqual(r.errors.filter((e) => !KNOWN.some((k) => k.test(e))), [], name)
  }
})

// ── «السجل» ──────────────────────────────────────────────────────────────────
const ledgerText = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

test('the ledger shows the total, a logo per row, a stale price date and the unpriced count', { skip: !harness && 'run npm install at the repo root' }, async () => {
  const r = await harness.renderClient([clientPath('monos-portfolio')])
  assert.deepEqual(r.errors.filter((e) => !KNOWN.some((k) => k.test(e))), [])
  assert.deepEqual(r.unknownRequests, [])
  const html = r.html['main:egx-portfolio']
  const t = ledgerText(html)
  assert.match(t, /463,837 جنيه/)
  assert.match(t, /التكلفة 355,393/)
  assert.match(t, /النمو \+32\.0%/)
  assert.match(t, /1 أصل من غير سعر، خارج الإجمالي/)
  assert.match(t, /اليوم \+0\.20%/)
  assert.match(t, /سعر 08\/10/)  // the fund's price is a week old
  assert.match(html, /<img class="l-logo"[^>]*src="data:image\/svg\+xml/)  // a company mark
  assert.match(t, /USD/)  // a currency's letters on the same circle
  assert.ok(r.slots.includes('sidebar.panellist:egx-portfolio'))
})

test('«تطوّر ثروتي» draws the total and the cost under the total, and only with two days or more', { skip: !harness && 'run npm install at the repo root' }, async () => {
  const r = await harness.renderClient([clientPath('monos-portfolio')])
  assert.deepEqual(r.unknownRequests, [])
  const html = r.html['main:egx-portfolio']
  assert.ok(r.requests.includes('GET /egx/api/history?days=365'))
  assert.match(html, /<svg class="h-chart"[^>]*viewBox="0 0 720 120"/)
  assert.match(html, /<polyline class="h-value" points="[\d.]+,[\d.]+ [\d.]+,[\d.]+/)
  assert.match(html, /<polyline class="h-cost"/)
  assert.ok(html.indexOf('l-total') < html.indexOf('h-chart'))
  assert.match(ledgerText(html), /من 08\/10 ?: \+5\.2%/)
  assert.match(html, /<span class="num">08\/10<\/span>/)
  const one = { points: [{ date: '2026-10-14', value_egp: 1, cost_egp: 1 }], first: null, last: null, change: 0, change_pct: 0 }
  for (const body of [one, { points: [], first: null, last: null, change: null, change_pct: null }]) {
    const quiet = await harness.renderClient([clientPath('monos-portfolio')], { fixtures: { '/egx/api/history?days=365': body } })
    assert.doesNotMatch(quiet.html['main:egx-portfolio'], /h-chart/)
    assert.match(ledgerText(quiet.html['main:egx-portfolio']), /463,837 جنيه/)
  }
})

test('the ledger search finds Egyptian spellings and offers adding by name', { skip: !harness && 'run npm install at the repo root' }, async () => {
  const seen = {}
  const r = await harness.renderClient([clientPath('monos-portfolio')], {
    async interact(key, host, { act, settle, window }) {
      const input = host.querySelector('input[role="combobox"]')
      if (!input) return
      const type = async (value) => {
        await act(async () => {
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value)
          input.dispatchEvent(new window.Event('input', { bubbles: true }))
        })
        await settle()
      }
      await type('دهب')
      seen.gold = [...host.querySelectorAll('[role="option"]')].map((o) => o.textContent)
      await type('التجاري')
      seen.bank = [...host.querySelectorAll('[role="option"]')].map((o) => o.textContent)
      await type('دولار')
      const usd = host.querySelector('[role="option"]')
      await act(async () => { usd.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })) })
      await settle()
      seen.add = host.querySelector('form.l-add').textContent
      seen.search = input.value
      await type('زززز')
      seen.none = [...host.querySelectorAll('[role="option"]')].map((o) => o.textContent)
    },
  })
  assert.deepEqual(r.errors.filter((e) => !KNOWN.some((k) => k.test(e))), [])
  assert.ok(seen.gold[0].includes('الذهب (جرام)') && seen.gold[1].includes('الذهب (أونصة)'))  // the gram first
  assert.ok(seen.bank[0].includes('البنك التجاري الدولي'))
  assert.match(seen.add, /الدولار الأمريكي/)
  assert.match(seen.add, /سعر USD بالجنيه وقت الشرا/)
  assert.equal(seen.search, '')
  assert.deepEqual(seen.none, ['+إضافة بالاسم ده: زززز'])
})

test('the empty ledger is a zero, the search and one line', { skip: !harness && 'run npm install at the repo root' }, async () => {
  const empty = { as_of: '2026-10-15T08:00+03:00', groups: [], disclaimer: '',
    totals: { assets: 0, value: null, cost: 0, priced_cost: 0, growth: null, unpriced: [], today_change: null, today_change_pct: null, today_has_fresh: false, today_as_of: null } }
  const r = await harness.renderClient([clientPath('monos-portfolio')], { fixtures: { '/egx/api/portfolio': empty } })
  const t = ledgerText(r.html['main:egx-portfolio'])
  assert.match(t, /0 جنيه/)
  assert.match(t, /ابحث عن أصل وأضفه\./)
  assert.doesNotMatch(t, /التكلفة \d|اليوم/)
})

test('npm run new-plugin scaffolds a plugin that builds and renders', { skip: !harness && 'run npm install at the repo root' }, async () => {
  const root = join(here, '..', '..')
  const dir = join(here, '..', 'monos-scaffold-check')
  rmSync(dir, { recursive: true, force: true })
  try {
    execFileSync(process.execPath, [join(here, '..', 'new-plugin.mjs'), 'scaffold-check', 'تجربة'], { cwd: root })
    execFileSync(process.execPath, [join(here, '..', 'build.mjs'), 'monos-scaffold-check'], { cwd: root })
    const r = await harness.renderClient([join(dir, 'client.js')])
    assert.deepEqual(r.plugins, ['monos-scaffold-check'])
    assert.deepEqual(r.slots, ['sidebar.panellist:monos-scaffold-check', 'main:monos-scaffold-check'])
    assert.match(r.html['main:monos-scaffold-check'], /قيد البناء/)
    assert.deepEqual(r.errors, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
