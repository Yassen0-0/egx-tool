// Run: npm test (node --test plugins/test/*.test.mjs)
// The /egx/api routes (plugins/monos-core/host/api.mjs), against a stand-in egx-cli that echoes the
// command it was given.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

let handler

before(async () => {
  const home = mkdtempSync(join(tmpdir(), 'egx-routes-'))
  const bin = join(home, 'mcp', '.venv', 'bin')
  mkdirSync(bin, { recursive: true })
  const cli = join(bin, 'egx-cli')
  writeFileSync(cli, `#!${process.execPath}
const [command, raw] = process.argv.slice(2)
console.log(JSON.stringify({ command, payload: raw ? JSON.parse(raw) : null }))
`)
  chmodSync(cli, 0o755)
  process.env.EGX_HOME = home
  process.env.EGX_AUTO_SYNC = '0'
  const host = await import('../monos-core/host/api.mjs')
  host.apply({
    effect: (fn) => fn(),
    webServer: { register: (route) => { handler = route.handler } },
  })
})

function call(method, url, { body, headers = {} } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  Object.assign(req, { method, url, headers: { host: '127.0.0.1:3180', ...headers } })
  return new Promise((resolve) => {
    let status
    handler(req, {
      writeHead: (s) => { status = s },
      end: (text) => resolve({ status, body: JSON.parse(text) }),
    })
  })
}

const SAME_ORIGIN = { 'x-egx-request': '1', 'content-type': 'application/json' }

test('mutations need the same-origin headers, a loopback host and a matching origin', async () => {
  const body = { asset: 'USD', price: 48.5 }
  const bare = await call('POST', '/egx/api/prices', { body, headers: { 'content-type': 'application/json' } })
  assert.equal(bare.status, 403)
  const form = await call('DELETE', '/egx/api/holdings/3', { headers: { 'x-egx-request': '1', 'content-type': 'text/plain' } })
  assert.equal(form.status, 403)
  const foreign = await call('POST', '/egx/api/prices', { body, headers: { ...SAME_ORIGIN, origin: 'https://evil.example' } })
  assert.equal(foreign.status, 403)
  const rebound = await call('GET', '/egx/api/portfolio', { headers: { host: 'evil.example' } })
  assert.equal(rebound.status, 403)
})

test('wrong method or shape is refused, and a body that is not a JSON object is a 400', async () => {
  assert.equal((await call('DELETE', '/egx/api/holdings', { body: {}, headers: SAME_ORIGIN })).status, 405)
  assert.equal((await call('POST', '/egx/api/holdings/3', { body: {}, headers: SAME_ORIGIN })).status, 405)
  for (const body of [null, 5, ['USD']]) {
    assert.equal((await call('POST', '/egx/api/holdings', { body, headers: SAME_ORIGIN })).status, 400)
  }
})

test('each holdings route maps to its egx-cli command, and the old screens\' routes are gone', async () => {
  assert.equal((await call('GET', '/egx/api/portfolio')).body.command, 'portfolio-summary')
  const add = await call('POST', '/egx/api/holdings', { body: { asset: 'COMI', buy_price: 80, quantity: 5 }, headers: SAME_ORIGIN })
  assert.deepEqual(add.body, { command: 'portfolio-add', payload: { asset: 'COMI', buy_price: 80, quantity: 5 } })
  const edit = await call('PATCH', '/egx/api/holdings/3', { body: { quantity: 6 }, headers: SAME_ORIGIN })
  assert.deepEqual(edit.body, { command: 'portfolio-update', payload: { quantity: 6, holding_id: 3 } })
  const remove = await call('DELETE', '/egx/api/holdings/3', { body: {}, headers: SAME_ORIGIN })
  assert.deepEqual(remove.body, { command: 'portfolio-remove', payload: { holding_id: 3 } })
  for (const url of ['/egx/api/market', '/egx/api/watchlist', '/egx/api/valuations', '/egx/api/universe']) {
    assert.equal((await call('GET', url)).status, 405, url)
  }
  assert.equal((await call('POST', '/egx/api/market/sync', { body: {}, headers: SAME_ORIGIN })).status, 404)
})

test('the history route asks for a whole number of days and falls back to the default', async () => {
  assert.deepEqual((await call('GET', '/egx/api/history?days=90')).body, { command: 'history', payload: { days: 90 } })
  assert.deepEqual((await call('GET', '/egx/api/history')).body, { command: 'history', payload: {} })
  assert.deepEqual((await call('GET', '/egx/api/history?days=x')).body, { command: 'history', payload: {} })
  assert.deepEqual((await call('GET', '/egx/api/history?days=99999')).body.payload, { days: 3650 })
  assert.equal((await call('GET', '/egx/api/history', { headers: { host: 'evil.example' } })).status, 403)
  assert.equal((await call('POST', '/egx/api/history', { body: {}, headers: SAME_ORIGIN })).status, 404)
})

test('ledger routes: catalog, rate, manual price, fund components and removing an asset', async () => {
  assert.equal((await call('GET', '/egx/api/catalog')).body.command, 'catalog')
  assert.deepEqual((await call('GET', '/egx/api/export')).body, { command: 'ledger-export', payload: null })
  assert.deepEqual((await call('GET', '/egx/api/fx?currency=USD&date=2026-10-01')).body,
    { command: 'fx-rate', payload: { currency: 'USD', date: '2026-10-01' } })
  const price = await call('POST', '/egx/api/prices', { body: { asset: 'USD', price: 48.5 }, headers: SAME_ORIGIN })
  assert.deepEqual(price.body, { command: 'price-set', payload: { asset: 'USD', price: 48.5 } })
  const parts = await call('PUT', `/egx/api/funds/${encodeURIComponent('custom:4')}/components`,
    { body: { components: [{ asset: 'COMI', weight: 0.3 }] }, headers: SAME_ORIGIN })
  assert.deepEqual(parts.body, { command: 'fund-components-set', payload: { fund: 'custom:4', components: [{ asset: 'COMI', weight: 0.3 }] } })
  const gone = await call('DELETE', '/egx/api/assets/XAU-G', { body: {}, headers: SAME_ORIGIN })
  assert.deepEqual(gone.body, { command: 'asset-remove', payload: { asset: 'XAU-G' } })
  assert.equal((await call('DELETE', '/egx/api/assets/%2Fetc', { body: {}, headers: SAME_ORIGIN })).status, 400)
  assert.equal((await call('GET', '/egx/api/prices')).status, 405)
  assert.equal((await call('PUT', '/egx/api/funds/x/components', { body: {}, headers: { 'content-type': 'application/json' } })).status, 403)
})
