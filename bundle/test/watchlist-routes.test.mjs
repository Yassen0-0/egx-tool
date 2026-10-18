// Run: node --test bundle/test/
// The /egx/api/watchlist routes, against a stand-in egx-cli that echoes the command it was given.
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
  const host = await import('../host/egx-portfolio.mjs')
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
