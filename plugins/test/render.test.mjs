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

// The chart library finding no <canvas> context in jsdom is known and harmless; anything else,
// a React list-key warning included, is a regression.
const KNOWN = [/Value is null/, /Not implemented: HTMLCanvasElement/]

// Every plugin with a screen, found the way the build finds them (a new plugin is tested too).
const { plugins } = await import('../build.mjs')
const CLIENTS = plugins().filter((p) => existsSync(join(p.dir, 'client.js'))).map((p) => p.manifest.name)
const clientPath = (name) => join(here, '..', name, 'client.js')

test('every screen renders from the built plugin clients', { skip: !harness && 'run npm install at the repo root' }, async () => {
  const opened = {}
  const r = await harness.renderClient(CLIENTS.map(clientPath), {
    async interact(key, host, { act, settle, window }) {
      const target = key === 'egx-market' ? host.querySelector('.m-row') : null
      if (target) {
        await act(async () => { target.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
        await settle()
        opened[key] = host.textContent
        // The TradingView tabs: each is one cross-origin iframe, never TradingView's script in our page.
        for (const name of ['chart', 'financials', 'technical']) {
          const tab = [...host.querySelectorAll('[role="tab"]')].find((b) => b.textContent === { chart: 'الشارت الفني', financials: 'البيانات المالية', technical: 'التحليل الفني' }[name])
          await act(async () => { tab.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
          await settle()
          opened[name] = { frames: [...host.querySelectorAll('iframe')].map((f) => f.getAttribute('src')), scripts: host.querySelectorAll('script').length }
        }
      }
    },
  })
  for (const slot of [
    'conversation.hero.brand.mark:conversation.hero.brand.mark',
    'sidebar.panellist:egx-market', 'main:egx-market',
    'sidebar.panellist:egx-analyses', 'main:egx-analyses',
    'sidebar.panellist:egx-portfolio', 'main:egx-portfolio',
  ]) assert.ok(r.slots.includes(slot), slot)
  assert.deepEqual(r.unknownRequests, [])
  const unexpected = r.errors.filter((e) => !KNOWN.some((k) => k.test(e)))
  assert.deepEqual(unexpected, [])
  const text = (key) => r.html[key].replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  assert.match(text('main:egx-market'), /Monos \/ السوق/)
  assert.match(text('main:egx-market'), /COMI/)
  assert.match(text('main:egx-portfolio'), /Monos \/ المحفظة/)
  assert.match(text('main:egx-portfolio'), /TMGH/)
  assert.match(text('main:egx-analyses'), /التحليلات/)
  assert.match(r.html['conversation.hero.brand.mark:conversation.hero.brand.mark'], /<svg/)
  assert.ok(opened['egx-market'], 'clicking a market row opens its detail')
  for (const [tab, widget] of [['chart', 'advanced-chart'], ['financials', 'financials'], ['technical', 'technical-analysis']]) {
    assert.equal(opened[tab].scripts, 0, `${tab}: no script injected`)
    assert.equal(opened[tab].frames.length, 1, `${tab}: one iframe`)
    const src = new URL(opened[tab].frames[0])
    assert.equal(`${src.origin}${src.pathname}${src.search}`, `https://www.tradingview-widget.com/embed-widget/${widget}/?locale=ar_AE`)
    const settings = JSON.parse(decodeURIComponent(src.hash.slice(1)))
    assert.match(settings.symbol, /^EGX:/)
    assert.equal(settings.locale, undefined)
  }
})

test('each plugin renders on its own and registers only its own slots', { skip: !harness && 'run npm install at the repo root' }, async () => {
  const own = {
    'monos-identity': ['conversation.hero.brand.mark:conversation.hero.brand.mark'],
    'monos-market': ['sidebar.panellist:egx-market', 'main:egx-market'],
    'monos-analyses': ['sidebar.panellist:egx-analyses', 'main:egx-analyses'],
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

test('the market screen says so when the price budget has not renewed for days', { skip: !harness && 'run npm install at the repo root' }, async () => {
  const market = harness.FIXTURES['/egx/api/market']
  const text = async (priceBudget) => {
    const r = await harness.renderClient([clientPath('monos-market')], { fixtures: { '/egx/api/market': { ...market, price_budget: priceBudget } } })
    assert.deepEqual(r.errors.filter((e) => !KNOWN.some((k) => k.test(e))), [])
    return r.html['main:egx-market'].replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  }
  const stuck = await text({ blocked_since: '2026-10-12T04:53:48+00:00', blocked_days: 3, last_fetch_at: '2026-10-12T04:49:35+00:00' })
  assert.match(stuck, /رصيد EODHD اليومي لا يتجدد/)
  assert.match(stuck, /12\/10/)
  assert.doesNotMatch(stuck, /بلغنا الحد اليومي/)
  const normal = await text({ blocked_since: null, blocked_days: 0, last_fetch_at: '2026-10-15T04:49:35+00:00' })
  assert.doesNotMatch(normal, /لا يتجدد/)
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
