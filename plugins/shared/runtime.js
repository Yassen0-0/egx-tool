// Shared runtime for every Monos screen plugin: React and its hooks, h, the number span N, the
// /egx/api client and the panel id. Each plugin's client.js bundles its own copy (plugins/build.mjs), so anything
// that must be ONE object across plugins lives in pageShared() below.
import React from 'react'
import QM_CSS from './styles.css'

export { React, QM_CSS }

/** State shared by every Monos plugin on the page (each plugin bundles its own copy of this
 * module, so a plain module-level object would exist once per plugin). The first plugin to load
 * creates it; the version suffix keeps an incompatible future shape from being reused. */
export function pageShared(key, create) {
  const store = (globalThis[Symbol.for('monos.page-shared.v1')] ??= {})
  return (store[key] ??= create())
}
export const { useState, useEffect, useCallback, useLayoutEffect, useRef, useMemo } = React
export const h = React.createElement
// The ledger's panel id: kept from the first portfolio screen, so the sidebar row keeps its place.
export const PANEL_ID = 'egx-portfolio'

// One LTR-isolated span per number: sign, digits and % never get split by the bidi algorithm.
export const N = (text, cls) => h('span', { className: cls ? `num ${cls}` : 'num' }, text)
// Inline run of text and numbers as one child; unlike an array literal it needs no keys.
export const frag = (...children) => h(React.Fragment, null, ...children)

export async function api(method, path, body) {
  const init = { method, headers: {} }
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.headers['x-egx-request'] = '1'
    init.body = JSON.stringify(body)
  }
  const res = await fetch(path, init)
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
  if (!res.ok || (data && data.error)) {
    const err = new Error(data.error || `HTTP ${res.status}`)
    if (data && data.field) err.field = data.field  // the form field the error is about
    throw err
  }
  return data
}

