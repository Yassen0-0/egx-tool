// «قيمة» identity: the dynamic icon (UP / DOWN / NEUTRAL from today's portfolio move), the
// shared portfolio store the icon and the screens read, the sidebar entry and the panel header.
// Inlined into client.js's factory scope (h, React, api, N and the format.mjs helpers are in scope).

// ── Shared portfolio store ─────────────────────────────────────────────────────
// One fetch of /egx/api/portfolio feeds the sidebar icon and every screen, so they always agree.
// Refreshed on first use, every few minutes (the desktop app syncs prices every 5), after each
// market sync and after any holding change.
const qima = {
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
}
const QIMA_REFRESH_MS = 3 * 60 * 1000

function useQima() {
  const [, bump] = useState(0)
  useEffect(() => {
    const listener = () => bump((n) => n + 1)
    qima.listeners.add(listener)
    if (qima.portfolio === undefined) qima.refresh()
    return () => { qima.listeners.delete(listener) }
  }, [])
  return qima.portfolio
}

// ── Icon ─────────────────────────────────────────────────────────────────────
// A rounded square with the glyph cut out in the page background. 16px uses the hand-tuned
// 16-grid glyphs (2px strokes on whole pixels); larger sizes use the 24-grid ones.
const ICON_FILL = {
  up: 'var(--dsw-alias-file-diff-added-marker)',
  down: 'var(--dsw-alias-file-diff-deleted-marker)',
  neutral: 'var(--dsw-alias-label-primary)',
}

function QimaIcon({ state = 'neutral', size = 22 }) {
  const cut = { fill: 'none', stroke: 'var(--dsw-alias-bg-base)', strokeLinecap: 'round', strokeLinejoin: 'round' }
  const small = size <= 16
  const arrowWidth = size >= 64 ? 2.6 : size >= 28 ? 2.8 : 3
  let glyph
  if (small) {
    glyph = state === 'up' ? h('path', { ...cut, d: 'M8 12V4M4 8l4-4 4 4', strokeWidth: 2 })
      : state === 'down' ? h('path', { ...cut, d: 'M8 4v8M4 8l4 4 4-4', strokeWidth: 2 })
        : [h('path', { key: 'p', ...cut, d: 'M4 8h8M4 5.5v5M12 5.5v5', strokeWidth: 2 }),
          h('circle', { key: 'c', cx: 8, cy: 8, r: 2, fill: 'var(--dsw-alias-bg-base)' })]
  } else {
    glyph = state === 'up' ? h('path', { ...cut, d: 'M12 18.5V6M6.5 11.5L12 6l5.5 5.5', strokeWidth: arrowWidth })
      : state === 'down' ? h('path', { ...cut, d: 'M12 5.5V18M6.5 12.5L12 18l5.5-5.5', strokeWidth: arrowWidth })
        : [h('path', { key: 'p', ...cut, d: 'M5.5 12h13M5.5 9v6M18.5 9v6', strokeWidth: size >= 28 ? 2.2 : 2.4 }),
          h('circle', { key: 'c', cx: 12, cy: 12, r: 2.6, fill: 'var(--dsw-alias-bg-base)' })]
  }
  const box = small ? 16 : 24
  return h('svg', {
    width: size, height: size, viewBox: `0 0 ${box} ${box}`, 'aria-hidden': true, style: { flex: 'none', display: 'block' },
    shapeRendering: small ? 'geometricPrecision' : undefined,
  },
  h('rect', { width: box, height: box, rx: small ? 4 : 6, fill: ICON_FILL[state] }), glyph)
}

function todayOf(portfolio) {
  const totals = portfolio && portfolio.totals
  return { state: iconState(portfolio), change: totals && totals.today_change, pct: totals && totals.today_change_pct }
}

// ── Sidebar entry ──────────────────────────────────────────────────────────────
// The Harness row renders our icon (16px wide, 18px in the collapsed rail) and the static label
// «قيمة». In the up/down states the row also shows today's % beside the label, and the row's
// tooltip and accessible name become «قيمة — السوق».
const SIDEBAR_PCT_CLASS = 'qima-sidebar-pct'

function SidebarQimaIcon({ size }) {
  const portfolio = useQima()
  const ref = React.useRef(null)
  const { state, pct } = todayOf(portfolio)
  useEffect(() => {
    const timer = setInterval(() => qima.refresh(), QIMA_REFRESH_MS)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    const row = ref.current && ref.current.closest('button')
    if (!row) return undefined
    const name = state === 'neutral' || pct == null ? 'قيمة — السوق' : `قيمة — السوق، محفظتي اليوم ${fmtPct(pct, { digits: 2, signed: true })}`
    row.setAttribute('title', 'قيمة — السوق')
    row.setAttribute('aria-label', name)
    const wide = size <= 16
    if (!wide || state === 'neutral' || pct == null) return undefined
    const tag = document.createElement('span')
    tag.className = SIDEBAR_PCT_CLASS
    tag.setAttribute('aria-hidden', 'true')
    tag.textContent = fmtPct(pct, { digits: 2, signed: true })
    Object.assign(tag.style, {
      marginInlineStart: '8px', direction: 'ltr', unicodeBidi: 'isolate', fontVariantNumeric: 'tabular-nums',
      fontFamily: 'var(--ds-font-family-code)', fontSize: '12px', flex: 'none',
      color: state === 'up' ? 'var(--dsw-alias-file-diff-added-marker)' : 'var(--dsw-alias-file-diff-deleted-marker)',
    })
    row.append(tag)
    return () => tag.remove()
  }, [state, pct, size])
  return h('span', { ref, style: { display: 'inline-flex' } }, h(QimaIcon, { state, size }))
}

// ── Panel header ──────────────────────────────────────────────────────────────
// Right: icon 22 + «قيمة» / screen (with breadcrumb links before it). Left: actions.
function PanelHeader({ here, crumbs = [], actions = null, demo = false, children = null }) {
  const portfolio = useQima()
  const { state } = todayOf(portfolio)
  return h('header', { className: 'q-head', 'data-window-drag': true },
    h('div', { className: 'q-head-in' },
      h(QimaIcon, { state, size: 22 }),
      h('nav', { className: 'q-crumbs', 'aria-label': 'المسار' },
        h('span', { className: 'q-brand' }, 'قيمة'),
        crumbs.map((c, i) => [
          h('span', { key: `s${i}`, className: 'q-sep', 'aria-hidden': true }, '/'),
          c.onClick ? h('button', { key: `c${i}`, type: 'button', className: 'q-crumb', onClick: c.onClick }, c.label)
            : h('span', { key: `c${i}`, className: 'q-sec' }, c.label),
        ]),
        h('span', { className: 'q-sep', 'aria-hidden': true }, '/'),
        h('h1', { className: 'q-here q-h1', 'aria-current': 'page' }, here)),
      demo ? h('span', { className: 'q-chip', title: 'البيانات من قاعدة التطوير (scripts/seed-dev.py)' }, 'بيانات تجريبية') : null,
      children,
      actions ? h('div', { className: 'q-head-actions' }, actions) : null))
}

const DISCLAIMER = 'تقييم وليس توصية بالشراء أو البيع.'
function Disclaimer({ extra }) {
  return h('p', { className: 'q-foot' }, extra || null, extra ? ' ' : null, h('b', { style: { fontWeight: 600 } }, DISCLAIMER))
}

// ── «قيّم سهم X» ──────────────────────────────────────────────────────────────
// The Harness exposes the composer's draft only to components rendered inside the chat, and our
// panels replace the chat while open, so the message is copied for the user to paste there.
function useToast() {
  const [text, setText] = useState('')
  useEffect(() => {
    if (!text) return undefined
    const timer = setTimeout(() => setText(''), 4000)
    return () => clearTimeout(timer)
  }, [text])
  const node = text ? h('div', { className: 'q-toast', role: 'status' }, text) : null
  return [node, setText]
}

async function copyValuationPrompt(symbol, toast) {
  const message = `قيّم سهم ${symbol}`
  try {
    await navigator.clipboard.writeText(message)
    toast(`اتنسخت الرسالة «${message}» — الصقها في المحادثة`)
  } catch {
    toast(`اكتب في المحادثة: «${message}»`)
  }
}
