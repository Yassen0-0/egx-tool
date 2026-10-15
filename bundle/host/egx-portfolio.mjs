// Host half of the EGX portfolio panel: a small JSON API at /egx/api/*, backed by
// the same Python portfolio logic the MCP tools use (egx-cli). The panel itself is
// client.js, rendered in the sidebar and main area of the Web and Desktop client.
// Desktop forwards dsh-app://app requests here after dropping Host and Origin.
//
// The API answers same-origin requests only: mutating requests must carry
// X-EGX-Request and a JSON body (which forces a CORS preflight that this route
// never approves), any Origin header must match the Host, and the Host must be
// a loopback name so DNS rebinding cannot reach it.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'dsh-egx-bundle'
export const inject = ['webServer']

const MAX_BODY_BYTES = 16 * 1024
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])


function cliCommand() {
  const home = process.env.EGX_HOME
  if (!home) throw new Error('EGX_HOME is not set')
  const direct = join(home, 'mcp', '.venv', 'bin', 'egx-cli')
  if (existsSync(direct)) return { file: direct, prefix: [] }
  return { file: process.env.EGX_UV ?? 'uv', prefix: ['run', '--quiet', '--directory', join(home, 'mcp'), 'egx-cli'] }
}

function runCli(command, payload) {
  const { file, prefix } = cliCommand()
  const args = [...prefix, command]
  if (payload !== undefined) args.push(JSON.stringify(payload))
  const env = { ...process.env }
  if (!env.EGX_DATA_DIR && env.EGX_HOME) env.EGX_DATA_DIR = join(env.EGX_HOME, 'data')
  return new Promise((resolve) => {
    execFile(file, args, { env, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      let body
      try {
        body = JSON.parse(stdout)
      } catch {
        body = { error: (stderr || error?.message || 'egx-cli produced no output').trim().slice(0, 500) }
      }
      const status = body && typeof body === 'object' && 'error' in body ? (error?.code === 2 ? 400 : 500) : 200
      resolve({ status, body })
    })
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

async function readJson(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

async function handleApi(req, res, path) {
  const method = req.method ?? 'GET'
  if (method === 'GET' && path === '/egx/api/portfolio') {
    const { status, body } = await runCli('portfolio-summary')
    return sendJson(res, status, body)
  }
  if (method === 'GET' && path === '/egx/api/universe') {
    const { status, body } = await runCli('universe')
    return sendJson(res, status, body)
  }
  const mutating = method === 'POST' || method === 'PATCH' || method === 'DELETE'
  if (!mutating) return sendJson(res, 405, { error: 'method not allowed' })
  if (req.headers['x-egx-request'] !== '1' || !(req.headers['content-type'] ?? '').startsWith('application/json')) {
    return sendJson(res, 403, { error: 'missing same-origin request headers' })
  }
  let payload
  try {
    payload = await readJson(req)
  } catch (error) {
    return sendJson(res, 400, { error: error instanceof Error ? error.message : 'invalid body' })
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

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/egx/api',
    async handler(req, res) {
      const path = new URL(req.url ?? '/', 'http://local').pathname.replace(/\/+$/, '')
      if (!hostAllowed(req)) return sendJson(res, 403, { error: 'forbidden host or origin' })
      if (path.startsWith('/egx/api/')) return handleApi(req, res, path)
      return sendJson(res, 404, { error: 'not found' })
    },
  }))
}
