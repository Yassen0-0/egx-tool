// Renders built plugin client.js files in Node, all on one page like the host loads them: jsdom,
// React 18.3.1 (the host's version) and the synthetic /egx/api answers in fixtures/api.json
// (scripts/make-ui-fixtures.py; `fixtures` overrides single answers). Used by render.test.mjs, and to prove a refactor renders exactly
// what the previous build rendered.
// Needs the root dev dependencies: npm install
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const here = dirname(fileURLToPath(import.meta.url))
export const FIXTURES = JSON.parse(readFileSync(join(here, 'fixtures', 'api.json'), 'utf8'))
// The fixtures are frozen at Thursday 2026-10-15 08:00 Cairo; the screens read the clock too.
const NOW = Date.parse('2026-10-15T08:00:00+03:00')

export async function renderClient(clientPaths, { interact, fixtures = {} } = {}) {
  const paths = Array.isArray(clientPaths) ? clientPaths : [clientPaths]
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:3180/', pretendToBeVisual: true, runScripts: 'outside-only' })
  const { window } = dom
  const errors = []
  const unknownRequests = []
  const requests = []
  const RealDate = Date
  class FixedDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [NOW])) }
    static now() { return NOW }
  }
  const saved = {}
  const globals = {
    window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement,
    Node: window.Node, MutationObserver: window.MutationObserver, getComputedStyle: (el, p) => window.getComputedStyle(el, p),
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0), cancelAnimationFrame: clearTimeout,
    Date: FixedDate, IS_REACT_ACT_ENVIRONMENT: true,
  }
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  window.ResizeObserver = globals.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  window.IntersectionObserver = globals.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }
  window.HTMLCanvasElement.prototype.getContext = () => null
  // jsdom does not resolve CSS variables: answer a plain colour so token probes and charts work.
  const realStyle = window.getComputedStyle.bind(window)
  window.getComputedStyle = (el, pseudo) => {
    const style = realStyle(el, pseudo)
    return new Proxy(style, {
      get: (target, prop) => (prop === 'color' && String(target.color).includes('var(') ? 'rgb(20, 20, 20)'
        : typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop]),
    })
  }
  window.scrollTo = () => {}
  window.Element.prototype.scrollIntoView = () => {}
  window.fetch = globals.fetch = async (path, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    requests.push(`${method} ${path}`)
    // Chart ranges differ by screen; every history request is answered from the 1-year fixture.
    const key = path.replace(/\/history\?days=\d+$/, '/history?days=365')
    const body = method === 'GET' ? (fixtures[key] ?? FIXTURES[key]) : { ok: true, bars_updated: [], skipped_for_budget: [] }
    if (body === undefined) unknownRequests.push(path)
    const status = body === undefined ? 404 : 200
    return { ok: status === 200, status, json: async () => body ?? { error: 'not in fixtures' } }
  }
  for (const [k, v] of Object.entries(globals)) { saved[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }) }
  const originalError = console.error
  console.error = (...args) => { errors.push(args.map(String).join(' ')) }

  try {
    const React = (await import('react')).default
    const { createRoot } = await import('react-dom/client')
    const { act } = await import('react')
    const factories = []
    window.__ModuleLoader__ = { load: ({ id, factory }) => { factories.push({ id, factory }) } }
    // Inside the page's own global scope, like the host loads it (location, devicePixelRatio, …).
    for (const path of paths) window.eval(readFileSync(path, 'utf8'))
    const slots = []
    for (const { id, factory } of factories) {
      const plugin = factory((name) => {
        if (name === 'react') return React
        throw new Error(`${id} required ${name}`)
      })
      plugin.apply({
        effect: (fn) => fn(),
        layout: { selectPanel: () => {} },
        slots: {
          inject: (_name, fn) => fn(),
          register: (options, Component) => { slots.push({ options, Component, plugin: id }) },
        },
      })
    }
    const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
    const out = {}
    for (const { options, Component } of slots) {
      const key = options.key || options.id || options.name
      const host = window.document.createElement('div')
      window.document.body.append(host)
      const root = createRoot(host)
      await act(async () => { root.render(React.createElement(Component, { size: 22 })) })
      await settle()
      if (interact) await interact(key, host, { act, settle, window })
      out[`${options.name}:${key}`] = host.innerHTML
      await act(async () => root.unmount())
      host.remove()
    }
    return { html: out, errors, unknownRequests, requests, plugins: factories.map((f) => f.id), slots: slots.map((s) => `${s.options.name}:${s.options.key || s.options.id || s.options.name}`) }
  } finally {
    console.error = originalError
    for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k] }
    window.close()
  }
}
