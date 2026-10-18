// Renders the built client.js with synthetic data (fixtures/api.json) and checks every screen
// mounts, reads only known endpoints and logs nothing unexpected. Needs `npm install` at the repo
// root (jsdom, React 18.3.1 = the host's version); skipped without it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
let harness = null
try { harness = await import('./harness.mjs') } catch { /* dev dependencies not installed */ }

// React development warnings about list keys, and the chart library finding no <canvas> context in
// jsdom, are known and harmless; anything else is a regression.
const KNOWN = [/unique "key" prop/, /Value is null/, /Not implemented: HTMLCanvasElement/]

test('every screen renders from the built client.js', { skip: !harness && 'run npm install at the repo root' }, async () => {
  const opened = {}
  const r = await harness.renderClient(join(here, '..', 'client.js'), {
    async interact(key, host, { act, settle, window }) {
      const target = key === 'egx-market' ? host.querySelector('.m-row') : null
      if (target) {
        await act(async () => { target.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
        await settle()
        opened[key] = host.textContent
      }
    },
  })
  assert.deepEqual(r.slots, [
    'conversation.hero.brand.mark:conversation.hero.brand.mark',
    'sidebar.panellist:egx-market', 'main:egx-market',
    'sidebar.panellist:egx-analyses', 'main:egx-analyses',
    'sidebar.panellist:egx-portfolio', 'main:egx-portfolio',
  ])
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
})
