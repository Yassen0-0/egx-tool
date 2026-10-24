// monos-core host plugin: the JSON API at /egx/api/* the «السجل» screen reads, backed by the same
// Python logic the assistant's MCP tools use (egx-cli → mcp/egx_mcp/commands.py), plus the
// 5-minute price refresh.
// Desktop forwards dsh-app://app requests here after dropping Host and Origin.
//
// The API answers same-origin requests only: mutating requests must carry
// X-EGX-Request and a JSON body (which forces a CORS preflight that this route
// never approves), any Origin header must match the Host, and the Host must be
// a loopback name so DNS rebinding cannot reach it.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'monos-core'
export const inject = ['webServer']

const MAX_BODY_BYTES = 16 * 1024
const MAX_IMPORT_BYTES = 4 * 1024 * 1024  // «استيراد CSV»: a whole exported ledger
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])


function cliCommand() {
  const home = process.env.EGX_HOME
  if (!home) throw new Error('EGX_HOME is not set')
  const direct = join(home, 'mcp', '.venv', 'bin', 'egx-cli')
  if (existsSync(direct)) return { file: direct, prefix: [] }
  return { file: process.env.EGX_UV ?? 'uv', prefix: ['run', '--quiet', '--directory', join(home, 'mcp'), 'egx-cli'] }
}

// A payload goes as one argument, or on stdin when `stdin` is set (an imported file is too large
// for the command line).
function runCli(command, payload, { stdin = false } = {}) {
  const { file, prefix } = cliCommand()
  const args = [...prefix, command]
  if (payload !== undefined) args.push(stdin ? '-' : JSON.stringify(payload))
  const env = { ...process.env }
  if (!env.EGX_DATA_DIR && env.EGX_HOME) env.EGX_DATA_DIR = join(env.EGX_HOME, 'data')
  return new Promise((resolve) => {
    const child = execFile(file, args, { env, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      let body
      try {
        body = JSON.parse(stdout)
      } catch {
        body = { error: (stderr || error?.message || 'egx-cli produced no output').trim().slice(0, 500) }
      }
      const status = body && typeof body === 'object' && 'error' in body ? (error?.code === 2 ? 400 : 500) : 200
      resolve({ status, body })
    })
    if (stdin && payload !== undefined) child.stdin.end(JSON.stringify(payload))
  })
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function hostAllowed(req) {
  const host = (req.headers.host ?? '').toLowerCase()
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  if (!LOOPBACK_HOSTS.has(name)) return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host.toLowerCase() === host
  } catch {
    return false
  }
}

async function readJson(req, limit = MAX_BODY_BYTES) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
  // Every route reads named fields: null, a number or an array is a bad request, not a crash.
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('request body must be a JSON object')
  return body
}

// Asset keys in a path: a ticker, a currency, XAU-G, BTC, fund:<slug> or custom:<id> (URL-encoded).
function assetKey(segment) {
  let key
  try { key = decodeURIComponent(segment) } catch { return null }
  return /^[A-Za-z0-9._:-]{1,64}$/.test(key) ? key : null
}

async function handleApi(req, res, path, query) {
  const method = req.method ?? 'GET'
  if (method === 'GET' && path === '/egx/api/portfolio') {
    const { status, body } = await runCli('portfolio-summary')
    return sendJson(res, status, body)
  }
  // «تصدير CSV»: the ledger as CSV text and a file name, which the screen saves.
  if (method === 'GET' && path === '/egx/api/export') {
    const { status, body } = await runCli('ledger-export')
    return sendJson(res, status, body)
  }
  // «السجل»: the catalog the search filters on the screen, and the EGP rate a purchase would use.
  if (method === 'GET' && path === '/egx/api/catalog') {
    const { status, body } = await runCli('catalog')
    return sendJson(res, status, body)
  }
  if (method === 'GET' && path === '/egx/api/fx') {
    const { status, body } = await runCli('fx-rate', { currency: query.get('currency') || '', date: query.get('date') || null })
    return sendJson(res, status, body)
  }
  // «الحركات»: everything that moved, for a month, a kind or an asset.
  if (method === 'GET' && path === '/egx/api/activity') {
    const { status, body } = await runCli('activity', { month: query.get('month') || null, kind: query.get('kind') || null, asset: query.get('asset') || null })
    return sendJson(res, status, body)
  }
  // «تطوّر ثروتي»: the total per day from the daily snapshots; days is a whole number, anything else is the default.
  if (method === 'GET' && path === '/egx/api/history') {
    const days = Number(query.get('days'))
    const { status, body } = await runCli('history', Number.isInteger(days) && days > 0 ? { days: Math.min(days, 3650) } : {})
    return sendJson(res, status, body)
  }
  const mutating = method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE'
  if (!mutating) return sendJson(res, 405, { error: 'method not allowed' })
  if (req.headers['x-egx-request'] !== '1' || !(req.headers['content-type'] ?? '').startsWith('application/json')) {
    return sendJson(res, 403, { error: 'missing same-origin request headers' })
  }
  let payload
  try {
    payload = await readJson(req, path === '/egx/api/import' ? MAX_IMPORT_BYTES : MAX_BODY_BYTES)
  } catch (error) {
    return sendJson(res, 400, { error: error instanceof Error ? error.message : 'invalid body' })
  }
  // «السجل»: a price the user typed, a fund's components, and removing an asset with all its purchases.
  if (path === '/egx/api/prices') {
    if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
    const { status, body } = await runCli('price-set', payload)
    return sendJson(res, status, body)
  }
  const fund = /^\/egx\/api\/funds\/([^/]{1,96})\/components$/.exec(path)
  if (fund) {
    if (method !== 'PUT') return sendJson(res, 405, { error: 'method not allowed' })
    const key = assetKey(fund[1])
    if (!key) return sendJson(res, 400, { error: 'bad asset key' })
    const { status, body } = await runCli('fund-components-set', { fund: key, components: Array.isArray(payload.components) ? payload.components : [] })
    return sendJson(res, status, body)
  }
  const asset = /^\/egx\/api\/assets\/([^/]{1,96})$/.exec(path)
  if (asset) {
    if (method !== 'DELETE') return sendJson(res, 405, { error: 'method not allowed' })
    const key = assetKey(asset[1])
    if (!key) return sendJson(res, 400, { error: 'bad asset key' })
    const { status, body } = await runCli('asset-remove', { asset: key })
    return sendJson(res, status, body)
  }
  // «استيراد CSV»: the plan for an exported file, or (apply) the file written.
  if (path === '/egx/api/import') {
    if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
    const { status, body } = await runCli('ledger-import', { csv: String(payload.csv || ''), apply: payload.apply === true }, { stdin: true })
    return sendJson(res, status, body)
  }
  // A stock's cash dividend, and its bonus shares or split.
  if (path === '/egx/api/dividends') {
    if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
    const { status, body } = await runCli('dividend-add', payload)
    return sendJson(res, status, body)
  }
  const action = /^\/egx\/api\/actions(?:\/(\d+))?$/.exec(path)
  if (action) {
    const actionId = action[1] === undefined ? undefined : Number(action[1])
    let done
    if (method === 'POST' && actionId === undefined) done = await runCli('action-add', payload)
    else if (method === 'DELETE' && actionId !== undefined) done = await runCli('action-remove', { action_id: actionId })
    else return sendJson(res, 405, { error: 'method not allowed' })
    return sendJson(res, done.status, done.body)
  }
  // «ديون وأقساط»: what the user owes; payments are movements of kind repay.
  const debt = /^\/egx\/api\/debts(?:\/(\d+))?$/.exec(path)
  if (debt) {
    const debtId = debt[1] === undefined ? undefined : Number(debt[1])
    let owed
    if (method === 'POST' && debtId === undefined) owed = await runCli('debt-add', payload)
    else if (method === 'PATCH' && debtId !== undefined) owed = await runCli('debt-update', { ...payload, debt_id: debtId })
    else if (method === 'DELETE' && debtId !== undefined) owed = await runCli('debt-remove', { debt_id: debtId })
    else return sendJson(res, 405, { error: 'method not allowed' })
    return sendJson(res, owed.status, owed.body)
  }
  // «الحركات»: money moving from one asset to another (transfer) or out of the ledger (expense).
  const move = /^\/egx\/api\/movements(?:\/(\d+))?$/.exec(path)
  if (move) {
    const moveId = move[1] === undefined ? undefined : Number(move[1])
    let moved
    if (method === 'POST' && moveId === undefined) moved = await runCli('movement-add', payload)
    else if (method === 'PATCH' && moveId !== undefined) moved = await runCli('movement-update', { ...payload, movement_id: moveId })
    else if (method === 'DELETE' && moveId !== undefined) moved = await runCli('movement-remove', { movement_id: moveId })
    else return sendJson(res, 405, { error: 'method not allowed' })
    return sendJson(res, moved.status, moved.body)
  }
  const match = /^\/egx\/api\/holdings(?:\/(\d+))?$/.exec(path)
  if (!match) return sendJson(res, 404, { error: 'not found' })
  const id = match[1] === undefined ? undefined : Number(match[1])
  let result
  if (method === 'POST' && id === undefined) result = await runCli('portfolio-add', payload)
  else if (method === 'PATCH' && id !== undefined) result = await runCli('portfolio-update', { ...payload, holding_id: id })
  else if (method === 'DELETE' && id !== undefined) result = await runCli('portfolio-remove', { holding_id: id })
  else return sendJson(res, 405, { error: 'method not allowed' })
  return sendJson(res, result.status, result.body)
}

// Price refresh for «السجل»: one run at a time. Each run asks EODHD for the remaining daily budget
// (free) and only spends calls when a close or a feed is due, so a short interval is cheap.
const SYNC_INTERVAL_MS = 5 * 60 * 1000
let syncing = null
// Runs that read the budget and then spend it go one after another, or two could both spend the
// same remaining calls.
let lock = Promise.resolve()
function exclusive(task) {
  const run = lock.then(task, task)
  lock = run.catch(() => {})
  return run
}

function syncPrices() {
  if (!syncing) {
    syncing = exclusive(() => runCli('prices-sync'))
      .then(({ body }) => body)
      .finally(() => { syncing = null })
  }
  return syncing
}

export function apply(ctx) {
  if (process.env.EGX_AUTO_SYNC !== '0') {
    ctx.effect(() => {
      const first = setTimeout(() => { void syncPrices() }, 15_000)
      const every = setInterval(() => { void syncPrices() }, SYNC_INTERVAL_MS)
      return () => { clearTimeout(first); clearInterval(every) }
    })
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/egx/api',
    async handler(req, res) {
      const url = new URL(req.url ?? '/', 'http://local')
      const path = url.pathname.replace(/\/+$/, '')
      if (!hostAllowed(req)) return sendJson(res, 403, { error: 'forbidden host or origin' })
      if (!path.startsWith('/egx/api/')) return sendJson(res, 404, { error: 'not found' })
      try {
        return await handleApi(req, res, path, url.searchParams)
      } catch (error) {
        // An unexpected failure still answers, so the screen shows an error instead of waiting forever.
        if (!res.headersSent) sendJson(res, 500, { error: error instanceof Error ? error.message : 'internal error' })
      }
    },
  }))
}
