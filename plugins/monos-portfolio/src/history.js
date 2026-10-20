// «تطوّر ثروتي» (docs/تحول.md §13): the ledger's total per day as one small line, with the cost as a
// second faint one. Drawn with inline SVG; the numbers come from Python (/egx/api/history). It loads
// by itself after the page is up, shows nothing until there are two days to draw, and nothing at all
// if the request fails. ES module.
import { N, api, h, useEffect, useState } from '../../shared/runtime.js'
import { fmtDayMonth, fmtPct, toneOf } from '../../shared/format.mjs'
import HISTORY_CSS from './history.css'

const W = 720
const H = 120
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
  return { value: line((p) => p.value_egp), cost: line((p) => p.cost_egp) }
}

export function HistoryChart() {
  const [data, setData] = useState(null)
  useEffect(() => {
    let alive = true
    api('GET', '/egx/api/history?days=365').then((d) => { if (alive) setData(d) }).catch(() => {})
    return () => { alive = false }
  }, [])
  if (!data || !Array.isArray(data.points) || data.points.length < 2) return null
  const { value, cost } = chartPaths(data.points)
  return h('section', { className: 'h-wrap', 'aria-label': 'تطوّر ثروتي' },
    h('style', null, HISTORY_CSS),
    h('svg', { className: 'h-chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'إجمالي السجل يوم بيوم، والتكلفة بخط باهت' },
      h('polyline', { className: 'h-cost', points: cost }),
      h('polyline', { className: 'h-value', points: value })),
    data.change_pct != null
      ? h('p', { className: 'h-line' }, 'من ', N(fmtDayMonth(data.first.date)), ': ', N(fmtPct(data.change_pct, { signed: true }), toneOf(data.change)))
      : null)
}
