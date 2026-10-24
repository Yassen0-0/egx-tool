// «تطوّر ثروتي» (docs/تحول.md §13): the ledger's total per day as one small line, with the cost as a
// second faint one. Drawn with inline SVG; the numbers come from Python (/egx/api/history). It loads
// by itself after the page is up, shows nothing until there are two days to draw, and nothing at all
// if the request fails. ES module.
import { N, api, frag, h, useEffect, useMemo, useRef, useState } from '../../shared/runtime.js'
import { DASH, fmtDate, fmtDayMonth, fmtNumber, fmtPct, toneOf } from '../../shared/format.mjs'
import { MASK, usePrivacy } from '../../shared/privacy.js'
import HISTORY_CSS from './history.css'

const W = 720
const H = 160
const PAD = 4  // room for the stroke

const dayMs = (iso) => Date.parse(`${iso}T00:00:00Z`)

/** SVG point lists for the value and the cost, scaled together so the gap between them is honest. */
export function chartPaths(points) {
  const times = points.map((p) => dayMs(p.date))
  const t0 = times[0]
  const span = times[times.length - 1] - t0 || 1
  const all = points.flatMap((p) => [p.value_egp, p.cost_egp])
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const range = hi - lo || Math.abs(hi) || 1
  const x = (i) => (PAD + ((times[i] - t0) / span) * (W - 2 * PAD)).toFixed(1)
  const y = (v) => (H - PAD - ((v - lo) / range) * (H - 2 * PAD)).toFixed(1)
  const line = (pick) => points.map((p, i) => `${x(i)},${y(pick(p))}`).join(' ')
  const value = line((p) => p.value_egp)
  // Drawing coordinates only: every figure shown comes from the points themselves (Python's).
  const xs = points.map((_, i) => Number(x(i)))
  const yv = points.map((p) => Number(y(p.value_egp)))
  return { value, cost: line((p) => p.cost_egp), area: `${xs[0]},${H} ${value} ${xs[xs.length - 1]},${H}`, xs, yv, lo, hi }
}

const pct = (hidden, v) => (v == null ? N(DASH, 'q-ter') : hidden ? N(MASK) : N(fmtPct(v, { signed: true }), toneOf(v)))

/** How each period moved without the money that came in: in pounds, dollars, gold and after
 *  inflation, with that money beside it. Every figure comes from Python (store/wealth.py). */
export function Periods({ periods, hidden }) {
  if (!periods || !periods.length) return null
  return h('details', { className: 'h-more' }, h('summary', null, 'الفترات بالتفصيل: بالدولار، وبالدهب، وبعد التضخم'), h('table', { className: 'h-periods' },
    h('thead', null, h('tr', null, ['الفترة', 'بالجنيه', 'بالدولار', 'بالدهب', 'بعد التضخم', 'فلوس جديدة'].map((t) => h('th', { key: t, scope: 'col' }, t)))),
    h('tbody', null, periods.map((p) => h('tr', { key: p.period },
      h('th', { scope: 'row' }, p.label),
      h('td', null, pct(hidden, p.egp && p.egp.pct)),
      h('td', null, pct(hidden, p.usd && p.usd.pct)),
      h('td', null, pct(hidden, p.gold_g && p.gold_g.pct)),
      h('td', null, pct(hidden, p.real_pct)),
      h('td', null, p.egp ? (hidden ? N(MASK) : N(fmtNumber(p.egp.inflow, 0))) : N(DASH, 'q-ter')))))))
}

/** The line itself, with a soft area under it, a dot on today and a read-out that follows the mouse
 *  or the arrow keys (the svg stays an LTR island: time runs left to right). */
function Plot({ points, hidden }) {
  const geo = useMemo(() => chartPaths(points), [points])
  const [at, setAt] = useState(null)
  const box = useRef(null)
  const last = geo.xs.length - 1
  const nearest = (vx) => {
    let lo = 0
    let hi = last
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (geo.xs[m] < vx) lo = m; else hi = m }
    return vx - geo.xs[lo] < geo.xs[hi] - vx ? lo : hi
  }
  const onPointerMove = (e) => {
    const r = box.current.getBoundingClientRect()
    if (r.width) setAt(nearest(((e.clientX - r.left) / r.width) * W))
  }
  const onKeyDown = (e) => {
    const i = at ?? last
    const next = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: last }[e.key]
    if (next != null) { e.preventDefault(); setAt(Math.max(0, Math.min(last, next))) }
  }
  const p = at == null ? null : points[at]
  const left = (i) => `${(geo.xs[i] / W) * 100}%`
  return h('div', { ref: box, className: 'h-plot', tabIndex: 0, onPointerMove, onPointerLeave: () => setAt(null), onKeyDown, onBlur: () => setAt(null),
      'aria-label': 'حرّك الماوس أو الأسهم على الخط علشان تشوف قيمة كل يوم' },
    h('svg', { className: 'h-chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'إجمالي السجل يوم بيوم، والتكلفة بخط باهت' },
      h('polygon', { className: 'h-area', points: geo.area }),
      h('polyline', { className: 'h-cost', points: geo.cost }),
      h('polyline', { className: 'h-value', points: geo.value })),
    h('span', { className: 'h-dot', 'aria-hidden': true, style: { left: left(last), top: `${(geo.yv[last] / H) * 100}%` } }),
    h('span', { className: 'h-range', 'aria-hidden': true }, hidden ? N(MASK) : N(fmtNumber(geo.hi, 0)), hidden ? N(MASK) : N(fmtNumber(geo.lo, 0))),
    p ? h('span', { className: 'h-scrub', 'aria-hidden': true, style: { left: left(at) } }) : null,
    p ? h('div', { className: `h-tip${geo.xs[at] > W * 0.6 ? ' h-tip-flip' : ''}`, role: 'status', dir: 'rtl',
      style: { left: left(at), top: `${(geo.yv[at] / H) * 100}%` } },
      N(fmtDate(p.date)),
      h('div', null, 'القيمة ', hidden ? N(MASK) : N(fmtNumber(p.value_egp, 0)), ' ج.م'),
      h('div', { className: 'q-sec' }, 'التكلفة ', hidden ? N(MASK) : N(fmtNumber(p.cost_egp, 0)), ' ج.م')) : null)
}

export function HistoryChart() {
  const hidden = usePrivacy()
  const [data, setData] = useState(null)
  useEffect(() => {
    let alive = true
    api('GET', '/egx/api/history?days=365').then((d) => { if (alive) setData(d) }).catch(() => {})
    return () => { alive = false }
  }, [])
  if (!data || !Array.isArray(data.points) || data.points.length < 2) return null
  return h('section', { className: 'h-wrap', 'aria-label': 'تطوّر ثروتي' },
    h('style', null, HISTORY_CSS),
    h('h2', { className: 'h-title' }, 'تطوّر ثروتي'),
    h(Plot, { points: data.points, hidden }),
    data.change_pct != null
      ? h('p', { className: 'h-line' }, 'من ', N(fmtDayMonth(data.first.date)), ': ', pct(hidden, data.change_pct), ' من حركة الأسعار',
        data.inflow ? frag('، ودخل ', hidden ? N(MASK) : N(fmtNumber(data.inflow, 0)), ' ج.م فلوس جديدة') : null)
      : null,
    h(Periods, { periods: data.periods, hidden }),
    h('p', { className: 'h-note' }, 'النسب من غير الفلوس الجديدة اللي دخلت أو خرجت. التضخم من أرقام الجهاز المركزي للإحصاء.'))
}
