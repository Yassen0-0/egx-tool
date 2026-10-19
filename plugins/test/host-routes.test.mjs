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

test('GET lists the watchlist', async () => {
  const r = await call('GET', '/egx/api/watchlist')
  assert.equal(r.status, 200)
  assert.equal(r.body.command, 'watchlist-list')
})

test('POST follows a stock, DELETE unfollows it', async () => {
  const add = await call('POST', '/egx/api/watchlist', { body: { symbol: 'FWRY' }, headers: SAME_ORIGIN })
  assert.equal(add.status, 200)
  assert.deepEqual(add.body, { command: 'watchlist-add', payload: { symbol: 'FWRY' } })
  const remove = await call('DELETE', '/egx/api/watchlist/FWRY', { body: {}, headers: SAME_ORIGIN })
  assert.deepEqual(remove.body, { command: 'watchlist-remove', payload: { symbol: 'FWRY' } })
})

test('mutations need the same-origin headers, a loopback host and a matching origin', async () => {
  const bare = await call('POST', '/egx/api/watchlist', { body: { symbol: 'FWRY' }, headers: { 'content-type': 'application/json' } })
  assert.equal(bare.status, 403)
  const form = await call('DELETE', '/egx/api/watchlist/FWRY', { headers: { 'x-egx-request': '1', 'content-type': 'text/plain' } })
  assert.equal(form.status, 403)
  const foreign = await call('POST', '/egx/api/watchlist', { body: { symbol: 'FWRY' }, headers: { ...SAME_ORIGIN, origin: 'https://evil.example' } })
  assert.equal(foreign.status, 403)
  const rebound = await call('GET', '/egx/api/watchlist', { headers: { host: 'evil.example' } })
  assert.equal(rebound.status, 403)
})

test('wrong method or shape is refused', async () => {
  assert.equal((await call('DELETE', '/egx/api/watchlist', { body: {}, headers: SAME_ORIGIN })).status, 405)
  assert.equal((await call('POST', '/egx/api/watchlist/FWRY', { body: {}, headers: SAME_ORIGIN })).status, 405)
  assert.equal((await call('PATCH', '/egx/api/watchlist', { body: {}, headers: SAME_ORIGIN })).status, 405)
})

test('a body that is not a JSON object is a 400, never a hung request', async () => {
  for (const body of [null, 5, ['FWRY']]) {
    const r = await call('POST', '/egx/api/watchlist', { body, headers: SAME_ORIGIN })
    assert.equal(r.status, 400)
  }
  const sync = await call('POST', '/egx/api/market/sync', { body: null, headers: SAME_ORIGIN })
  assert.equal(sync.status, 400)
})

// Every /egx/api route reaches the egx-cli command (commands.py) the screens rely on.
test('each route maps to its egx-cli command and arguments', async () => {
  const get = async (url) => (await call('GET', url)).body
  assert.equal((await get('/egx/api/portfolio')).command, 'portfolio-summary')
  assert.equal((await get('/egx/api/universe')).command, 'universe')
  assert.equal((await get('/egx/api/market')).command, 'market-summary')
  assert.equal((await get('/egx/api/market/digest')).command, 'market-digest')
  assert.deepEqual(await get('/egx/api/market/COMI/history?days=90'), { command: 'market-history', payload: { symbol: 'COMI', days: 90 } })
  assert.deepEqual(await get('/egx/api/valuations/series/COMI'), { command: 'valuation-series', payload: { symbol: 'COMI' } })
  assert.deepEqual(await get('/egx/api/valuations/7'), { command: 'valuation-get', payload: { valuation_id: 7 } })
  const list = await get('/egx/api/valuations?kind=&limit=200&offset=200')
  assert.equal(list.command, 'valuations-list')
  assert.deepEqual([list.payload.kind, list.payload.limit, list.payload.offset], [null, 200, 200])
  const add = await call('POST', '/egx/api/holdings', { body: { symbol: 'COMI', buy_price: 80, quantity: 5 }, headers: SAME_ORIGIN })
  assert.deepEqual(add.body, { command: 'portfolio-add', payload: { symbol: 'COMI', buy_price: 80, quantity: 5 } })
  const edit = await call('PATCH', '/egx/api/holdings/3', { body: { quantity: 6 }, headers: SAME_ORIGIN })
  assert.deepEqual(edit.body, { command: 'portfolio-update', payload: { quantity: 6, holding_id: 3 } })
  const remove = await call('DELETE', '/egx/api/holdings/3', { body: {}, headers: SAME_ORIGIN })
  const one = await call('POST', '/egx/api/market/CLHO/sync', { body: {}, headers: SAME_ORIGIN })
  assert.deepEqual(one.body, { command: 'market-sync-symbol', payload: { symbol: 'CLHO' } })
  assert.deepEqual(remove.body, { command: 'portfolio-remove', payload: { holding_id: 3 } })
  assert.equal((await call('GET', '/egx/api/nothing')).status, 405)
  assert.equal((await call('POST', '/egx/api/nothing', { body: {}, headers: SAME_ORIGIN })).status, 404)
})
