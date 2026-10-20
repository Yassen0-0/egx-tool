// Monos identity pieces every screen plugin uses: the brand icon, the shared portfolio store the
// icon and the screens read, the sidebar entry, the panel header and the disclaimer.
import { React, api, h, pageShared, useEffect, useState } from './runtime.js'
import { fmtPct, iconState } from './format.mjs'
import { MASK, usePrivacy } from './privacy.js'

// ── Shared portfolio store ─────────────────────────────────────────────────────
// One fetch of /egx/api/portfolio (the ledger, «السجل») feeds the sidebar badge and every screen,
// so they always agree.
// Refreshed on first use, every few minutes (the desktop app syncs prices every 5), after each
// market sync and after any holding change.
// One store for the whole page (pageShared), so the market sidebar icon and the portfolio
// screen agree although they are different plugins.
export const monos = pageShared('portfolio-store', () => ({
  portfolio: undefined, // undefined = not loaded yet, null = unavailable
  listeners: new Set(),
  pending: null,
  set(next) {
    this.portfolio = next
    this.listeners.forEach((listener) => listener())
  },
  refresh() {
    if (!this.pending) {
      this.pending = api('GET', '/egx/api/portfolio')
        .then((p) => this.set(p))
        .catch(() => this.set(this.portfolio || null))
        .finally(() => { this.pending = null })
    }
    return this.pending
  },
}))
export const MONOS_REFRESH_MS = 3 * 60 * 1000

export function useMonos() {
  const [, bump] = useState(0)
  useEffect(() => {
    const listener = () => bump((n) => n + 1)
    monos.listeners.add(listener)
    if (monos.portfolio === undefined) monos.refresh()
    return () => { monos.listeners.delete(listener) }
  }, [])
  return monos.portfolio
}

// ── Icon ─────────────────────────────────────────────────────────────────────
// The Monos app icon: a green rounded square with the white trend line, drawn on the 24-grid.
// Brand colours (green #37B77A, white glyph) come from the asset pack in plugins/monos-identity/assets/monos/,
// which also holds the .icns / .iconset for the macOS app. Static — one version, no up/down/neutral.
export function MonosIcon({ size = 22 }) {
  const dot = (cx, cy, key) => h('circle', { key, cx, cy, r: 1.125, fill: '#FFFFFF' })
  return h('svg', {
    width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, style: { flex: 'none', display: 'block' },
  },
  h('rect', { width: 24, height: 24, rx: 5.39, fill: '#37B77A' }),
  h('path', {
    d: 'M7.05 15.75L10.36 11.86L12.89 13.95L17.11 8.25',
    fill: 'none', stroke: '#FFFFFF', strokeWidth: 2.25, strokeLinecap: 'round', strokeLinejoin: 'round',
  }),
  dot(7.05, 15.75, 'a'), dot(10.36, 11.86, 'b'), dot(12.89, 13.95, 'c'), dot(17.11, 8.25, 'd'))
}

// Empty-conversation mark: fills the host's conversation.hero.brand.mark slot, so the host's
// animated fallback (the DeepSeek whale) never shows. The host passes the size and its own class.
export function HeroMonosMark({ size = 34, className }) {
  return h('span', { className, style: { display: 'inline-flex' } }, h(MonosIcon, { size }))
}

export function todayOf(portfolio) {
  const totals = portfolio && portfolio.totals
  return { state: iconState(portfolio), change: totals && totals.today_change, pct: totals && totals.today_change_pct }
}

// ── Sidebar entry ──────────────────────────────────────────────────────────────
// The host row renders our icon (16px wide, 18px in the collapsed rail) and the static label
// «Monos». When the ledger moved today, the row also shows today's % beside the label. The row's
// tooltip and accessible name say «Monos — السجل».
export const SIDEBAR_PCT_CLASS = 'monos-sidebar-pct'

export function SidebarMonosIcon({ size }) {
  const portfolio = useMonos()
  const ref = React.useRef(null)
  const { state, pct } = todayOf(portfolio)
  const hidden = usePrivacy()
  useEffect(() => {
    const timer = setInterval(() => monos.refresh(), MONOS_REFRESH_MS)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    const row = ref.current && ref.current.closest('button')
    if (!row) return undefined
    const shownPct = hidden ? MASK : fmtPct(pct, { digits: 2, signed: true })
    const name = state === 'neutral' || pct == null ? 'Monos — السجل' : `Monos — السجل، اليوم ${shownPct}`
    row.setAttribute('title', 'Monos — السجل')
    row.setAttribute('aria-label', name)
    const wide = size <= 16
    if (!wide || state === 'neutral' || pct == null) return undefined
    const tag = document.createElement('span')
    tag.className = SIDEBAR_PCT_CLASS
    tag.setAttribute('aria-hidden', 'true')
    tag.textContent = shownPct
    Object.assign(tag.style, {
      marginInlineStart: '8px', direction: 'ltr', unicodeBidi: 'isolate', fontVariantNumeric: 'tabular-nums',
      fontFamily: 'var(--ds-font-family-code)', fontSize: '12px', flex: 'none',
      color: state === 'up' ? 'var(--dsw-alias-file-diff-added-marker)' : 'var(--dsw-alias-file-diff-deleted-marker)',
    })
    row.append(tag)
    return () => tag.remove()
  }, [state, pct, size, hidden])
  return h('span', { ref, style: { display: 'inline-flex' } }, h(MonosIcon, { size }))
}

// ── Panel header ──────────────────────────────────────────────────────────────
// Right: icon 22 + «Monos» / screen (with breadcrumb links before it). Left: actions.
export function PanelHeader({ here, crumbs = [], actions = null, children = null }) {
  return h('header', { className: 'q-head', 'data-window-drag': true },
    h('div', { className: 'q-head-in' },
      h(MonosIcon, { size: 22 }),
      h('nav', { className: 'q-crumbs', 'aria-label': 'المسار' },
        h('span', { className: 'q-brand' }, 'Monos'),
        crumbs.map((c, i) => [
          h('span', { key: `s${i}`, className: 'q-sep', 'aria-hidden': true }, '/'),
          c.onClick ? h('button', { key: `c${i}`, type: 'button', className: 'q-crumb', onClick: c.onClick }, c.label)
            : h('span', { key: `c${i}`, className: 'q-sec' }, c.label),
        ]),
        h('span', { className: 'q-sep', 'aria-hidden': true }, '/'),
        h('h1', { className: 'q-here q-h1', 'aria-current': 'page' }, here)),
      children,
      actions ? h('div', { className: 'q-head-actions' }, actions) : null))
}

export const DISCLAIMER = 'وصف للأرقام، وليس توصية بالشراء أو البيع.'
export function Disclaimer({ extra }) {
  return h('p', { className: 'q-foot' }, extra || null, extra ? ' ' : null, h('b', { style: { fontWeight: 600 } }, DISCLAIMER))
}
