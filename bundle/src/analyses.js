// «قيمة / التحليلات»: the list grouped by stock and the full analysis page (§7.2–7.3). Inlined into
// the factory scope: h, React, api, N, nav, Markdown, the format/labels helpers, identity.js and
// components.js are in scope. Every number about price vs fair uses the same helpers as Market,
// with the current price taken from the same /egx/api/market rows.

const ANALYSES_CSS = '/* @css analyses.css */'
const KIND_LABEL = { full: 'كامل', light: 'خفيف' }
const PERIOD_FILTERS = [['', 'كل الفترات'], ['30', 'آخر 30 يومًا'], ['90', 'آخر 3 شهور'], ['365', 'آخر سنة']]
const KIND_FILTERS = [['', 'الكل'], ['full', 'كامل'], ['light', 'خفيف']]
const STATUS_CHIP = { above: 'أعلى من العادل', between: 'بين الحماية والعادل', under: 'تحت سعر الحماية — يحتاج مراجعة' }
/** «FY2025» → «السنة المالية 2025», «Q2 2026» → «الربع 2 من 2026»; anything else as stored. */
const fiscalPeriod = (p) => String(p).replace(/^FY\s?(\d{4})$/i, 'السنة المالية $1').replace(/^Q([1-4])\s?(\d{4})$/i, 'الربع $1 من $2')
const EXPLAIN_KINDS = 'التقييم الكامل يعيد بناء النموذج من الأرقام الأساسية، والتحديث الخفيف مراجعة أسبوعية للسعر والأخبار بنفس العادل.'

/** Loads the archive (all kinds, newest first) and the market rows for today's prices. */
function useArchive() {
  const [state, setState] = useState({ items: null, market: null, error: '' })
  useEffect(() => {
    let alive = true
    Promise.all([
      api('GET', '/egx/api/valuations?kind=&limit=200'),
      api('GET', '/egx/api/market').catch(() => null),
    ]).then(([list, market]) => alive && setState({ items: list.items, demo: list.demo_data, market, error: '' }))
      .catch((e) => alive && setState({ items: null, market: null, error: e.message }))
    return () => { alive = false }
  }, [])
  return state
}

function marketRow(market, symbol) {
  return market ? market.rows.find((r) => r.symbol === symbol) || null : null
}

/** Versions per symbol, oldest = 1, with each record's predecessor and successor. */
function versionsBySymbol(items) {
  const bySymbol = {}
  items.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id))
    .forEach((v) => { (bySymbol[v.symbol] = bySymbol[v.symbol] || []).push(v) })
  const info = {}
  Object.values(bySymbol).forEach((list) => list.forEach((v, i) => {
    info[v.id] = { version: i + 1, latest: i === list.length - 1, previous: list[i - 1] || null, next: list[i + 1] || null }
  }))
  return { bySymbol, info }
}

function FairDelta({ v, previous }) {
  if (v.kind === 'light') return h('small', { className: 'q-sec' }, 'بلا تغيير عن التقييم الكامل')
  const prevFull = v.previous_fair_value
  if (prevFull == null) return h('small', { className: 'q-ter' }, 'أول تقييم')
  return h('small', { className: 'q-sec' }, N(`${fmtArrow(prevFull, v.fair_value)} (${fmtPct(v.fair_value / prevFull - 1, { signed: true })})`))
}

function ListRow({ v, info, current, onOpen }) {
  const latest = info.latest
  const price = current && current.price
  const status = latest && price != null ? statusOf(price, v.fair_value) : null
  const under = status === 'under'
  const open = () => onOpen(v.id)
  const then = marginSentence(v.price_at_valuation, v.fair_value)
  return h('div', {
    className: `q-grid a-g a-row${latest ? '' : ' old'}${under ? ' q-warn' : ''}`, role: 'row', tabIndex: 0, onClick: open,
    'aria-label': `${v.symbol} ${fmtDate(v.created_at)}`,
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } },
  },
  h('span', { className: 'q-cell', role: 'cell' }, N(fmtDate(v.created_at), 'q-strong'),
    h('small', null, 'النسخة ', N(String(info.version)), latest ? ' · الأحدث' : '')),
  h('span', { role: 'cell' }, h('span', { className: `a-kind${v.kind === 'light' ? ' light' : ''}` }, KIND_LABEL[v.kind])),
  h('span', { className: 'q-cell', role: 'cell' }, N(fmtPrice(v.fair_value), 'q-blue a-fair'), h(FairDelta, { v, previous: info.previous })),
  h('span', { role: 'cell' }, h(RatingChip, { rating: v.risk_rating })),
  h('span', { className: 'q-cell', role: 'cell' },
    latest
      ? (price == null ? h('small', null, 'لا يوجد سعر حالي بعد')
        : [h('span', { key: 's', className: `a-status${under ? ' under' : ''}` }, STATUS_CHIP[status]),
          h(Ruler, { key: 'r', fair: v.fair_value, bear: v.bear, bull: v.bull, price }),
          under ? [h('span', { key: 'm' }, 'أقل من العادل بـ ', N(fmtPct(marginToFair(v.fair_value, price)))),
            h('span', { key: 'p', className: 'q-amber' }, 'تحت سعر الحماية بـ ', N(fmtPct(belowProtectionBy(v.fair_value, price))))]
            : h(MarginText, { key: 'm', price, fair: v.fair_value })])
      : [h('span', { key: 'p' }, 'السعر وقتها ', N(fmtPrice(v.price_at_valuation))),
        then ? h('small', { key: 't' }, 'وقتها: ', then.text, then.value ? ' ' : null, then.value ? N(then.value) : null) : null,
        info.next ? h('small', { key: 'n' }, info.next.kind === 'light' ? 'الأساس الذي بُني عليه التحديث الخفيف' : ['حلّ محلّه تقييم ', N(fmtDayMonth(info.next.created_at))]) : null]),
  h('span', { className: 'a-reason', role: 'cell', dir: 'auto', title: v.reason || '' }, v.reason === 'first valuation' ? 'أول تقييم' : (v.reason || '—')))
}

function AnalysesList({ onOpen }) {
  const { items, market, demo, error } = useArchive()
  const [filters, setFilters] = useState({ symbol: '', rating: '', period: '', kind: '' })
  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target ? e.target.value : e }))
  const dirty = Object.values(filters).some(Boolean)
  const [toastNode, toast] = useToast()

  const { bySymbol, info } = React.useMemo(() => versionsBySymbol(items || []), [items])
  const groups = React.useMemo(() => {
    if (!items) return []
    const since = filters.period ? new Date(Date.now() - Number(filters.period) * 864e5).toISOString() : ''
    const keep = (v) => (!filters.symbol || v.symbol === filters.symbol) && (!filters.rating || v.risk_rating === filters.rating)
      && (!filters.kind || v.kind === filters.kind) && (!since || v.created_at >= since)
    return Object.entries(bySymbol).map(([symbol, list]) => {
      const current = marketRow(market, symbol)
      const latest = list[list.length - 1]
      const under = current && current.price != null && statusOf(current.price, latest.fair_value) === 'under'
      return { symbol, list, rows: list.filter(keep).reverse(), current, under, latestAt: latest.created_at }
    }).filter((g) => g.rows.length)
      // Under-protection stocks first, then the most recently valued.
      .sort((a, b) => (a.under !== b.under ? (a.under ? -1 : 1) : a.latestAt < b.latestAt ? 1 : -1))
  }, [items, bySymbol, market, filters])

  const lastClose = market ? market.rows.reduce((m, r) => (r.price != null && r.as_of > m ? r.as_of.slice(0, 10) : m), '') : ''
  const total = items ? items.length : 0
  const symbols = Object.keys(bySymbol).sort()
  const select = (key, label, options) => h('label', { className: `q-field${filters[key] ? ' on' : ''}` },
    h('span', { className: 'q-label' }, label),
    h('select', { value: filters[key], onChange: set(key) }, options.map(([value, text]) => h('option', { key: value, value }, text))))

  let body
  if (error) body = h('div', { className: 'q-card q-empty', role: 'alert' }, h('span', { className: 'q-h2' }, 'تعذّر تحميل التحليلات'), h('span', null, error))
  else if (!items) body = h('div', { className: 'q-card', 'aria-busy': true }, Array.from({ length: 4 }, (_, i) => h('div', { key: i, className: 'q-grid a-g q-tr' },
    [120, 40, 90, 60, 180, 160].map((w, j) => h('span', { key: j }, h(Skeleton, { width: w }))))))
  else if (!total) body = h('div', { className: 'q-card q-empty' },
    h('span', { className: 'q-h2' }, 'لسه مفيش تحليلات'),
    h('span', null, 'اطلب من المحلل تقييم سهم، وسيظهر هنا بعد الحفظ. اكتب في المحادثة: ', h('b', null, '«قيّم سهم ', h('span', { className: 'q-sym' }, 'COMI'), '»')),
    h('button', { type: 'button', className: 'q-btn', onClick: () => copyValuationPrompt('COMI', toast) }, 'انسخ الرسالة'))
  else if (!groups.length) body = h('div', { className: 'q-card q-empty' }, 'لا توجد تحليلات لهذه التصفية.',
    h('button', { type: 'button', className: 'q-btn', onClick: () => setFilters({ symbol: '', rating: '', period: '', kind: '' }) }, 'إعادة ضبط التصفية'))
  else body = h('div', { className: 'q-scroll' }, h('div', { style: { minWidth: 900, display: 'flex', flexDirection: 'column', gap: 12 } },
    h('div', { className: 'q-grid a-g q-meta', 'aria-hidden': true, style: { borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
      ['تاريخ التقييم', 'النوع', 'السعر العادل', 'التصنيف', 'الحالة مقابل السعر الحالي', 'السبب'].map((t) => h('span', { key: t, style: { paddingBlock: 6 } }, t))),
    groups.map((g) => {
      const latest = g.list[g.list.length - 1]
      const lastFull = g.list.slice().reverse().find((v) => v.kind === 'full')
      return h('section', { key: g.symbol, className: 'q-card a-group', role: 'table', 'aria-label': `تقييمات ${g.symbol}` },
        h('div', { className: 'a-ghead' },
          h('b', { className: 'q-sym' }, g.symbol), h('span', null, g.current ? g.current.name_ar : ''),
          g.current && g.current.price != null ? h('span', { className: 'q-sec' }, 'السعر ', N(fmtPrice(g.current.price)), ' · إغلاق ', N(fmtDayMonth(g.current.as_of)),
            g.current.stale ? [' ', h(StaleChip, { key: 's' })] : null) : null,
          h('span', { className: 'q-grow' }),
          h('span', { className: 'q-sec' }, g.list.length === 1 ? 'تقييم واحد' : [N(String(g.list.length)), ' تقييمات'])),
        latest.kind === 'light' && lastFull ? h('div', { className: 'a-ghead q-meta', style: { background: 'transparent' } }, h('span', null,
          'مقارنة: تقييم كامل يوم ', N(fmtDayMonth(lastFull.created_at)), ' والسعر وقتها ', N(fmtPrice(lastFull.price_at_valuation)), ' ثم تحديث خفيف يوم ',
          N(fmtDayMonth(latest.created_at)), ' والسعر وقتها ', N(fmtPrice(latest.price_at_valuation)), ' بينما العادل لم يتغير وبقي ', N(fmtPrice(latest.fair_value)), ' جنيه.')) : null,
        g.rows.map((v) => h(ListRow, { key: v.id, v, info: info[v.id], current: g.current, onOpen })))
    })))

  return h('div', { className: 'qm', dir: 'rtl', lang: 'ar' },
    h('style', null, QM_CSS + ANALYSES_CSS),
    h(PanelHeader, { here: 'التحليلات', demo: Boolean(demo),
      actions: h('span', { className: 'q-meta' }, 'لإضافة تقييم اكتب في المحادثة: «قيّم سهم ', h('span', { className: 'q-sym' }, 'COMI'), '»') }),
    h('div', { className: 'q-wrap', style: { paddingTop: 8 } },
      h('div', { className: 'a-top' },
        h('span', { className: 'q-meta' },
          N(String(total)), ' تقييمات في ', N(String(symbols.length)), ' أسهم',
          lastClose ? [' · أسعار إغلاق ', N(fmtDate(lastClose)), ' من EODHD (مزوّد بيانات الأسعار) · متأخرة وليست لحظية'] : null),
        h('span', { className: 'q-meta' }, EXPLAIN_KINDS)),
      h('div', { className: 'a-filters' },
        select('symbol', 'السهم', [['', 'الكل'], ...symbols.map((s) => [s, s])]),
        select('rating', 'التصنيف', [['', 'الكل'], ...Object.entries(RATING_LABEL)]),
        select('period', 'التاريخ', PERIOD_FILTERS),
        h('div', { className: 'q-seg', role: 'group', 'aria-label': 'نوع التقييم' },
          KIND_FILTERS.map(([value, label]) => h('button', { key: value, type: 'button', 'aria-pressed': filters.kind === value, onClick: () => set('kind')(value) }, label))),
        h('span', { className: 'q-grow' }),
        h('button', { type: 'button', className: 'q-btn q-btn-quiet', disabled: !dirty, onClick: () => setFilters({ symbol: '', rating: '', period: '', kind: '' }) }, 'إعادة ضبط التصفية')),
      body,
      h('div', { className: 'a-legend' },
        h('span', null, h('span', { className: 'a-sw', style: { background: 'var(--dsw-alias-state-business-primary)' } }), 'السعر العادل'),
        h('span', null, h('span', { className: 'a-sw', style: { background: 'var(--dsw-alias-state-warn-primary)' } }), 'سعر الحماية'),
        h('span', null, h('span', { className: 'a-sw', style: { background: 'var(--dsw-alias-label-primary)', borderRadius: '50%' } }), 'السعر الحالي'),
        h('span', null, h('span', { className: 'a-sw', style: { background: 'var(--dsw-alias-state-business-primary)', opacity: 0.3 } }), 'النطاق (المتشائم – المتفائل)')),
      h('p', { className: 'q-meta', style: { margin: 0, lineHeight: 1.8 } },
        'سعر الحماية = ', N('80%'), ' من السعر العادل: لو السعر نزل تحته يُراجَع التقييم تلقائيًا. مرجع الدخول = السعر العادل نفسه. الأحدث لكل سهم في الأعلى والأقدم أسفله بلون أهدأ.'),
      h(Disclaimer)),
    toastNode)
}

// ── Fair value history chart (SVG): fair and protection as steps, price from month-end closes ──

const DAY_MS = 864e5
const toTime = (day) => Date.parse(`${day}T00:00:00Z`)

function FairHistoryChart({ points, bars }) {
  const dark = useHostTheme() === 'dark'
  const steps = points.map((p) => ({ ...p, day: cairoDay(p.created_at) }))
  if (!steps.length) return null
  if (steps.length === 1) {
    const only = steps[0]
    return h('div', { className: 'q-note-quiet' }, 'تقييم واحد فقط حتى الآن، والشارت يظهر ابتداءً من التقييم الثاني: العادل ',
      N(fmtPrice(only.fair_value), 'q-blue'), ' والسعر وقتها ', N(fmtPrice(only.price_at_valuation)), ' بتاريخ ', N(fmtDate(only.day)))
  }
  const firstDay = steps[0].day
  const lastBar = bars.length ? bars[bars.length - 1].date : null
  // Price: the close of the last session of each month since the first valuation, each valuation
  // day's recorded price, and the latest close. All real closes from the same source as Market.
  const monthEnd = {}
  bars.forEach((b) => { if (b.date >= firstDay) monthEnd[b.date.slice(0, 7)] = b })
  const priceMap = new Map()
  Object.values(monthEnd).forEach((b) => priceMap.set(b.date, b.close))
  steps.forEach((s) => { if (s.price_at_valuation != null) priceMap.set(s.day, s.price_at_valuation) })
  if (lastBar) priceMap.set(lastBar, bars[bars.length - 1].close)
  const prices = [...priceMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([day, value]) => ({ t: toTime(day), value }))

  const t0 = toTime(firstDay) - 12 * DAY_MS
  const tEnd = Math.max(toTime(steps[steps.length - 1].day), lastBar ? toTime(lastBar) : 0)
  const t1 = tEnd + 18 * DAY_MS
  const values = steps.flatMap((s) => [s.fair_value, s.protection_price]).concat(prices.map((p) => p.value))
  let lo = Math.min(...values), hi = Math.max(...values)
  const pad = (hi - lo) * 0.12 || 5
  lo -= pad; hi += pad
  const W = 900, H = 300, L = 16, R = 60, T = 24, B = 40
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R)
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B)
  const fairAt = (t) => { let v = null; for (const s of steps) if (toTime(s.day) <= t) v = s.fair_value; return v }
  const priceAt = (t) => {
    if (!prices.length || t < prices[0].t || t > prices[prices.length - 1].t) return null
    for (let i = 1; i < prices.length; i++) {
      if (t <= prices[i].t) { const a = prices[i - 1], b = prices[i]; return a.value + ((t - a.t) / (b.t - a.t || 1)) * (b.value - a.value) }
    }
    return prices[prices.length - 1].value
  }
  const stepPath = (key) => {
    let d = ''
    steps.forEach((s, i) => {
      const xs = x(toTime(s.day)), yv = y(s[key])
      d += i === 0 ? `M${xs.toFixed(1)} ${yv.toFixed(1)}` : `V${yv.toFixed(1)}`
      const xe = i + 1 < steps.length ? x(toTime(steps[i + 1].day)) : x(tEnd)
      d += `H${xe.toFixed(1)}`
    })
    return d
  }
  // Shade the gap between price and fair: blue where price < fair, amber where price > fair.
  const shades = []
  const N_SAMPLES = 240
  let run = null
  const flush = () => { if (run && run.top.length > 1) shades.push(run); run = null }
  for (let i = 0; i <= N_SAMPLES; i++) {
    const t = toTime(firstDay) + ((tEnd - toTime(firstDay)) * i) / N_SAMPLES
    const f = fairAt(t), p = priceAt(t)
    if (f == null || p == null) { flush(); continue }
    const sign = p < f ? 'below' : 'above'
    if (!run || run.sign !== sign) { flush(); run = { sign, top: [], bottom: [] } }
    run.top.push([x(t), y(p)]); run.bottom.push([x(t), y(f)])
  }
  flush()
  const ticks = []
  const step = (hi - lo) / 5
  const mag = 10 ** Math.floor(Math.log10(step))
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= step) || step
  for (let v = Math.ceil(lo / nice) * nice; v <= hi; v += nice) ticks.push(v)
  const months = []
  const start = new Date(t0)
  for (let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)); d.getTime() <= t1; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.getTime())
  const amberOpacity = dark ? 0.28 : 0.18
  return h('div', { className: 'a-chart' },
    h('svg', { viewBox: `0 0 ${W} ${H + 34}`, role: 'img', 'aria-label': 'تاريخ السعر العادل مقابل السعر، بتواريخ حقيقية' },
      ticks.map((v) => h(React.Fragment, { key: v },
        h('path', { className: 'gl', d: `M${L} ${y(v).toFixed(1)}H${W - R}` }),
        h('text', { className: 'ax', x: W - R + 8, y: y(v) + 4 }, fmtNumber(v, 0)))),
      months.map((t) => h(React.Fragment, { key: t },
        h('path', { className: 'gl', d: `M${x(t).toFixed(1)} ${H - B}v4` }),
        h('text', { className: 'ax', x: x(t), y: H - B + 18, textAnchor: 'middle' }, fmtDayMonth(new Date(t).toISOString().slice(0, 10))))),
      shades.map((s, i) => h('path', {
        key: i, fill: s.sign === 'below' ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-state-warn-primary)',
        opacity: s.sign === 'below' ? 0.12 : amberOpacity,
        d: `M${s.top.map(([a, b]) => `${a.toFixed(1)} ${b.toFixed(1)}`).join('L')}L${s.bottom.slice().reverse().map(([a, b]) => `${a.toFixed(1)} ${b.toFixed(1)}`).join('L')}Z`,
      })),
      h('path', { d: stepPath('protection_price'), fill: 'none', stroke: 'var(--dsw-alias-state-warn-primary)', strokeWidth: 2 }),
      h('path', { d: stepPath('fair_value'), fill: 'none', stroke: 'var(--dsw-alias-state-business-primary)', strokeWidth: 2.4 }),
      prices.length > 1 ? h('path', { d: `M${prices.map((p) => `${x(p.t).toFixed(1)} ${y(p.value).toFixed(1)}`).join('L')}`, fill: 'none', stroke: 'var(--dsw-alias-label-primary)', strokeWidth: 1.6 }) : null,
      prices.map((p) => h('circle', { key: p.t, cx: x(p.t), cy: y(p.value), r: 3, fill: 'var(--dsw-alias-bg-base)', stroke: 'var(--dsw-alias-label-primary)', strokeWidth: 1.4 })),
      steps.map((s, i) => {
        const cx = x(toTime(s.day))
        const prev = steps[i - 1]
        const change = prev && prev.fair_value !== s.fair_value ? ` (${fmtPct(s.fair_value / prev.fair_value - 1, { signed: true })})` : ''
        return h(React.Fragment, { key: s.id },
          s.price_at_valuation != null ? [
            h('circle', { key: 'p', cx, cy: y(s.price_at_valuation), r: 5, fill: 'var(--dsw-alias-label-primary)' }),
            h('text', { key: 'pt', className: 'ax', x: cx + 6, y: y(s.price_at_valuation) - 8, style: { fill: 'var(--dsw-alias-label-primary)', fontWeight: 600 } }, fmtPrice(s.price_at_valuation))] : null,
          h('circle', { cx, cy: y(s.fair_value), r: 4.5, fill: 'var(--dsw-alias-state-business-primary)', stroke: 'var(--dsw-alias-bg-base)', strokeWidth: 2 }),
          !prev || prev.fair_value !== s.fair_value
            ? h('text', { className: 'ax', x: cx + 6, y: y(s.fair_value) + 16, style: { fill: 'var(--dsw-alias-state-business-primary)', fontWeight: 600 } }, fmtPrice(s.fair_value) + change) : null,
          h('text', { className: 'ax', x: cx, y: H + 8, textAnchor: 'middle', style: { fill: 'var(--dsw-alias-label-primary)', fontWeight: 600 } }, fmtDate(s.day)),
          h('text', { className: 'axd', x: cx, y: H + 26, textAnchor: 'middle' }, `النسخة ${i + 1}${s.kind === 'light' ? ' (خفيف)' : ''}`))
      }),
      h('text', { className: 'ax', x: x(tEnd) + 4, y: y(steps[steps.length - 1].protection_price) - 6, style: { fill: 'var(--dsw-alias-state-warn-label)', fontWeight: 600 } },
        fmtPrice(steps[steps.length - 1].protection_price))),
    h('div', { className: 'a-legend', style: { marginTop: 6 } },
      h('span', null, h('span', { className: 'a-sw', style: { background: 'var(--dsw-alias-state-business-primary)', height: 3 } }), 'السعر العادل'),
      h('span', null, h('span', { className: 'a-sw', style: { background: 'var(--dsw-alias-label-primary)', height: 3 } }), 'إغلاق نهاية الشهر وأيام التقييم'),
      h('span', null, h('span', { className: 'a-sw', style: { background: 'var(--dsw-alias-state-warn-primary)', height: 3 } }), 'سعر الحماية'),
      h('span', null, h('span', { className: 'a-sw', style: { background: 'var(--dsw-alias-state-business-primary)', opacity: 0.25 } }), 'السعر أقل من العادل'),
      h('span', null, h('span', { className: 'a-sw', style: { background: 'var(--dsw-alias-state-warn-primary)', opacity: 0.4 } }), 'السعر أعلى من العادل')),
    h('p', { className: 'q-meta', style: { margin: '6px 0 0', lineHeight: 1.7 } },
      'الزمن من اليسار إلى اليمين. الخط الأسود هو إغلاق آخر جلسة في كل شهر من مصدر الأسعار مع إغلاق كل يوم تقييم، وهي نفس أسعار شاشة السوق.'))
}

// ── Analysis detail ───────────────────────────────────────────────────────────

const SECTIONS = [
  ['summary', 'الملخص والأطروحة'], ['methods', 'طرق التقييم'], ['assumptions', 'الافتراضات'], ['checks', 'فحوصات المنطق'],
  ['risk', 'المخاطر'], ['critic', 'ملاحظات الناقد'], ['sources', 'المصادر'], ['report', 'التقرير الكامل'],
]

function Table({ cols, head, rows, foot }) {
  return h('div', { className: 'a-t q-scroll' },
    h('div', { className: 'q-grid q-th', style: { '--cols': cols } }, head.map((t, i) => h('span', { key: i }, t))),
    rows.map((cells, i) => h('div', { key: i, className: 'q-grid q-tr', style: { '--cols': cols } }, cells.map((c, j) => h('span', { key: j, className: 'q-cell' }, c)))),
    foot ? h('div', { className: 'q-grid q-tr a-total', style: { '--cols': cols } }, foot.map((c, j) => h('span', { key: j }, c))) : null)
}

function MethodsSection({ item }) {
  const methods = item.methods || []
  if (!methods.length) return h('p', { className: 'q-sec' }, 'لا توجد طرق محفوظة لهذا التقييم.')
  const totalWeight = methods.reduce((s, m) => s + (m.weight || 0), 0) || 1
  return [
    h(Table, {
      key: 't', cols: 'minmax(220px, 2fr) 70px repeat(3, minmax(80px, 1fr))',
      head: ['الطريقة', 'الوزن', 'المتشائم', 'الأساسي', 'المتفائل'],
      rows: methods.map((m) => {
        const [label, explain] = methodLabel(m.method)
        return [[h('b', { key: 'l', style: { fontWeight: 500 } }, label), explain ? h('small', { key: 'e' }, explain) : null],
          N(fmtPct(m.weight / totalWeight, { digits: 0 })), N(fmtPrice(m.bear)), N(fmtPrice(m.base)), N(fmtPrice(m.bull))]
      }),
      foot: ['النتيجة المجمّعة (متوسط مرجّح)', N('100%'), N(fmtPrice(item.bear)), N(fmtPrice(item.fair_value), 'q-blue'), N(fmtPrice(item.bull))],
    }),
    h('p', { key: 'n', className: 'q-meta', style: { lineHeight: 1.7 } },
      'المتشائم ', N(fmtPrice(item.bear)), ' ناتج أسوأ سيناريو للطرق كلها، أما سعر الحماية ', N(fmtPrice(item.protection_price)),
      ' فهو ', N('80%'), ' من العادل. هما رقمان مختلفان لغرضين مختلفين.'),
  ]
}

function AssumptionsSection({ item }) {
  const rows = assumptionRows(item.assumptions)
  if (!rows.length) return h('p', { className: 'q-sec' }, 'لا توجد افتراضات محفوظة.')
  return h(Table, {
    cols: 'minmax(200px, 2fr) 110px minmax(160px, 2fr)',
    head: ['الافتراض', 'القيمة', 'المصدر'],
    rows: rows.map((r) => [r.known ? r.label : h('span', { dir: 'ltr', className: 'q-sec' }, r.label), N(r.value, 'q-strong'),
      h('span', { className: 'q-sec', dir: 'auto' }, r.source || '—', r.asOf ? [' · ', N(fmtDate(r.asOf))] : null)]),
  })
}

function ChecksSection({ item }) {
  const [all, setAll] = useState(false)
  const checks = (item.sanity && item.sanity.checks) || []
  if (!checks.length) return h('p', { className: 'q-sec' }, 'لا توجد فحوصات محفوظة.')
  const failing = checks.filter((c) => c.status !== 'pass')
  const shown = all || !failing.length ? checks : failing
  const mark = (status) => (status === 'pass'
    ? h('span', { className: 'q-sec', style: { display: 'inline-flex', gap: 6, alignItems: 'center' } }, h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true }, h('circle', { cx: 8, cy: 8, r: 7, fill: 'var(--dsw-alias-label-primary)' }), h('path', { d: 'M5 8.2l2 2 4-4.2', stroke: 'var(--dsw-alias-bg-base)', strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round' })), 'نجح')
    : h('span', { className: 'q-amber', style: { display: 'inline-flex', gap: 6, alignItems: 'center' } }, h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true }, h('circle', { cx: 8, cy: 8, r: 7, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }), h('path', { d: 'M5.5 5.5l5 5M10.5 5.5l-5 5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' })), status === 'fail' ? 'فشل' : 'لم ينجح'))
  return [
    h('div', { key: 'h', className: 'q-row q-meta' },
      N(`${checks.length - failing.length} / ${checks.length}`), ' فحوصات نجحت',
      failing.length ? ' · غير الناجح له ملاحظة عند الناقد' : null,
      h('span', { className: 'q-grow' }),
      failing.length && failing.length < checks.length
        ? h('button', { type: 'button', className: 'q-btn q-btn-sm', onClick: () => setAll(!all) }, all ? 'عرض غير الناجح فقط' : 'عرض كل الفحوصات') : null),
    h(Table, {
      key: 't', cols: 'minmax(220px, 2fr) 96px',
      head: ['الفحص', 'النتيجة'],
      rows: shown.map((c) => {
        const [label, worry] = CHECK_LABEL[c.check] || [c.check, null]
        return [[h('span', { key: 'l' }, label), c.status !== 'pass' && worry ? h('div', { key: 'w', className: 'a-worry' }, h('b', null, 'هل ده يقلق؟ '), worry) : null], mark(c.status)]
      }),
    }),
  ]
}

function RiskSection({ item }) {
  const details = item.risk_details
  if (!details) return h('p', { className: 'q-sec' }, 'لا توجد تفاصيل مخاطر محفوظة لهذا التقييم.')
  const values = { ...(details.metrics || {}) }
  const levels = {}
  ;(details.criteria || []).forEach((c) => {
    const key = c.criterion === 'auditor_qualified_opinion' ? 'auditor_qualified_opinion' : c.criterion
    if (values[key] === undefined) values[key] = c.value
    levels[key] = c.level
  })
  const isBank = 'car' in values || 'npl_ratio' in values
  const order = isBank ? BANK_RISK_ORDER.filter((k) => k in values).concat(Object.keys(values).filter((k) => !BANK_RISK_ORDER.includes(k) && RISK_LABEL[k]))
    : Object.keys(values).filter((k) => RISK_LABEL[k])
  return [
    h('p', { key: 'r', className: 'q-sec' }, 'التصنيف: ', h(RatingChip, { rating: item.risk_rating }),
      details.red_flags && details.red_flags.length ? [' · إشارات حمراء: ', details.red_flags.map((f) => RED_FLAG_LABEL[f] || f).join('، ')] : null),
    h(Table, {
      key: 't', cols: 'minmax(240px, 2.4fr) 100px minmax(140px, 1.2fr)',
      head: ['المقياس وما يعنيه', 'القيمة', 'الحد المرجعي'],
      rows: order.map((key) => {
        const [name, explain, ref, format] = RISK_LABEL[key]
        return [[h('b', { key: 'n', style: { fontWeight: 500 } }, name), h('small', { key: 'e' }, explain)],
          // Only digits go in .num spans; words like «آمن» or «غير متحفّظ» stay plain text.
          h('b', { className: levels[key] === 2 ? 'q-amber' : 'q-strong' }, h(NumText, { text: riskValue(values[key], format) })),
          h('small', null, h(NumText, { text: ref }))]
      }),
    }),
    isBank ? h('div', { key: 'n', className: 'a-callout' },
      h('b', null, 'مؤشرات لا تنطبق على البنوك: '),
      'Altman Z-Score وPiotroski F-Score وBeneish M-Score مقاييس للشركات غير المالية (خطر التعثر، جودة الأداء، والتلاعب المحاسبي)، لذلك لا تُحسب لـ ',
      h('span', { className: 'q-sym' }, item.symbol), ' ولا تدخل في التصنيف.') : null,
    details.missing && details.missing.length ? h('p', { key: 'm', className: 'q-meta' }, 'بيانات ناقصة لم تدخل في التصنيف: ',
      details.missing.map((k) => (RISK_LABEL[k] ? RISK_LABEL[k][0] : k)).join(' · ')) : null,
  ]
}

function SourcesSection({ item }) {
  const sources = item.sources || []
  if (!sources.length) return h('p', { className: 'q-sec' }, 'لا توجد مصادر محفوظة.')
  return h(Table, {
    cols: 'minmax(160px, 1.4fr) minmax(80px, 0.8fr) minmax(200px, 2fr) 110px',
    head: ['البند', 'القيمة', 'المصدر', 'التاريخ'],
    rows: sources.map((s) => [h('span', { dir: 'auto' }, s.item), h('span', { dir: 'auto' }, h(NumText, { text: s.value })), h('span', { dir: 'auto', className: 'q-sec' }, s.source), N(fmtDate(s.as_of))]),
  })
}

function ReportSection({ item, toast }) {
  const [open, setOpen] = useState(false)
  if (!item.report) return h('p', { className: 'q-sec' }, 'لا يوجد تقرير محفوظ لهذا التقييم.')
  const copy = async () => {
    try { await navigator.clipboard.writeText(item.report); toast('اتنسخ التقرير') } catch { toast('تعذّر النسخ') }
  }
  return h('div', { className: 'q-card q-pad', style: { display: 'flex', flexDirection: 'column', gap: 10 } },
    h('div', { className: `a-report${open ? '' : ' closed'}` }, h(Markdown, { text: item.report })),
    h('div', { className: 'q-row' },
      h('button', { type: 'button', className: 'q-btn', 'aria-expanded': open, onClick: () => setOpen(!open) }, open ? 'طيّ التقرير' : 'عرض التقرير الكامل'),
      h('button', { type: 'button', className: 'q-btn', onClick: copy }, 'نسخ النص')))
}

// The panel root is the scroll container; leave room for the sticky header and section nav.
function scrollToSection(key) {
  const target = document.getElementById(`a-${key}`)
  const box = target && target.closest('.qm')
  if (box) box.scrollTo({ top: target.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 100 })
}

function AnalysisDetail({ id, onBack, onOpen, initialSection = null }) {
  const [item, setItem] = useState(null)
  const [series, setSeries] = useState(null)
  const [bars, setBars] = useState([])
  const [market, setMarket] = useState(null)
  const [error, setError] = useState('')
  const [active, setActive] = useState('summary')
  const [help, setHelp] = useState(true)
  const [toastNode, toast] = useToast()
  useEffect(() => {
    let alive = true
    setItem(null); setError('')
    api('GET', `/egx/api/valuations/${id}`).then((v) => {
      if (!alive) return
      setItem(v)
      const sym = encodeURIComponent(v.symbol)
      api('GET', `/egx/api/valuations/series/${sym}`).then((s) => {
        if (!alive) return
        setSeries(s)
        const first = s.points.length ? Date.parse(s.points[0].created_at) : Date.now()
        const days = Math.min(3650, Math.ceil((Date.now() - first) / DAY_MS) + 45)
        return api('GET', `/egx/api/market/${sym}/history?days=${days}`).then((hst) => alive && setBars(hst.bars.filter((b) => b.close != null)))
      }).catch(() => {})
      api('GET', '/egx/api/market').then((m) => alive && setMarket(m)).catch(() => {})
    }).catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [id])

  const jumped = React.useRef(false)
  useEffect(() => {
    // Arriving from «عرض ملاحظات الناقد»: open on that section once the page has its height.
    if (!initialSection || jumped.current || !item || !series) return
    jumped.current = true
    setActive(initialSection)
    requestAnimationFrame(() => scrollToSection(initialSection))
  }, [item, series, initialSection])

  const crumbs = [{ label: 'التحليلات', onClick: onBack }]
  if (!item) return h('div', { className: 'qm', dir: 'rtl', lang: 'ar' }, h('style', null, QM_CSS + ANALYSES_CSS),
    h(PanelHeader, { crumbs, here: error ? 'تعذّر التحميل' : '…' }),
    h('div', { className: 'q-wrap', style: { paddingTop: 16 } }, error
      ? h('div', { className: 'q-card q-empty', role: 'alert' }, h('span', { className: 'q-h2' }, 'تعذّر تحميل التحليل'), h('span', null, error),
        h('button', { type: 'button', className: 'q-btn', onClick: onBack }, 'رجوع إلى التحليلات'))
      : h('div', { className: 'q-card q-pad' }, h(Skeleton, { width: '40%' }), h('br'), h(Skeleton, { width: '70%' }))))

  const current = marketRow(market, item.symbol)
  const price = current && current.price
  const points = series ? series.points : []
  const version = points.findIndex((p) => p.id === item.id) + 1
  const isLatest = points.length && points[points.length - 1].id === item.id
  const status = price != null ? statusOf(price, item.fair_value) : null
  const lastFull = item.kind === 'light' ? points.slice().reverse().find((p) => p.kind === 'full' && p.id < item.id) : null
  const name = current ? current.name_ar : ''
  const go = (key) => { setActive(key); scrollToSection(key) }
  const changes = series ? series.changes : []
  const changeFor = (pid) => changes.find((c) => c.valuation_id === pid)

  const section = (key, title, sub, body) => h('section', { key, id: `a-${key}`, className: 'a-sec', 'aria-labelledby': `a-${key}-t` },
    h('h2', { id: `a-${key}-t`, className: 'q-h2' }, title), sub ? h('p', { className: 'q-meta' }, sub) : null, body)

  return h('div', { className: 'qm', dir: 'rtl', lang: 'ar' },
    h('style', null, QM_CSS + ANALYSES_CSS),
    h(PanelHeader, {
      crumbs, demo: false,
      here: h('span', null, h('span', { className: 'q-sym' }, item.symbol), ' — ', N(fmtDate(item.created_at))),
      actions: h('button', { type: 'button', className: 'q-btn q-btn-p', onClick: () => copyValuationPrompt(item.symbol, toast) }, 'تحديث التقييم من المحادثة'),
    }),
    h('div', { className: 'q-wrap', style: { paddingTop: 12 } },
      h('div', { className: 'q-row' },
        h('span', { className: 'q-h1' }, h('span', { className: 'q-sym' }, item.symbol), ' · ', name),
        h('span', { className: 'a-chips' },
          h('span', { className: `a-kind${item.kind === 'light' ? ' light' : ''}` }, item.kind === 'light' ? 'تحديث خفيف' : 'تقييم كامل'),
          version ? h('span', { className: 'q-chip q-chip-biz' }, 'النسخة ', N(String(version)), isLatest ? ' · الأحدث' : '') : null,
          h('span', { className: 'q-meta' }, 'تاريخ التقييم ', N(fmtDate(item.created_at))),
          item.financial_period ? h('span', { className: 'q-meta' }, '· ', h(NumText, { text: fiscalPeriod(item.financial_period) })) : null)),
      h('p', { className: 'q-meta', style: { margin: 0 } }, EXPLAIN_KINDS),
      item.kind === 'light' && lastFull ? h('div', { className: 'q-note-quiet' },
        'تحديث خفيف: نفس العادل ', N(fmtPrice(item.fair_value)), ' بدون إعادة تقييم. الطرق والافتراضات والمخاطر من التقييم الكامل بتاريخ ', N(fmtDate(lastFull.created_at)), ' ',
        h('button', { type: 'button', className: 'q-link', onClick: () => onOpen(lastFull.id) }, 'افتح التقييم الكامل ←')) : null,

      status === 'under' ? h(UnderProtectionCard, { price, fair: item.fair_value, protection: item.protection_price, asOf: current.as_of, onCritic: () => go('critic') }) : null,

      // Summary strip + large ruler
      h('section', { className: 'q-card', 'aria-label': 'ملخص التقييم', style: { overflow: 'hidden' } },
        h('div', { className: 'a-summary' },
          h('div', null, h('small', null, 'السعر العادل'), N(fmtPrice(item.fair_value), 'q-blue q-hero'),
            h('small', null, 'النطاق (المتشائم – المتفائل) ', N(`${fmtPrice(item.bear)} – ${fmtPrice(item.bull)}`))),
          h('div', null, h('small', null, 'سعر الحماية ', h(ProtectionHelp, { open: help, onToggle: () => setHelp(!help) })),
            h('b', { className: 'num q-amber', style: { fontSize: 20 } }, fmtPrice(item.protection_price)), h('small', null, N('80%'), ' من السعر العادل')),
          h('div', null, h('small', null, 'السعر الآن'),
            price != null ? [h('b', { key: 'p', className: 'num', style: { fontSize: 20, fontWeight: 600 } }, fmtPrice(price)),
              h('small', { key: 'd' }, 'إغلاق ', N(fmtDayMonth(current.as_of)), ' · متأخر وليس لحظيًا', current.stale ? [' ', h(StaleChip, { key: 's' })] : null)]
              : h('small', null, 'لا يوجد سعر حالي بعد')),
          h('div', null, h('small', null, 'التصنيف'), h('b', { style: { fontSize: 16 } }, h(RatingChip, { rating: item.risk_rating })),
            h('small', null, h('button', { type: 'button', className: 'q-link', style: { padding: 0, minHeight: 0, fontSize: 12 }, onClick: () => go('risk') }, 'الأسباب في قسم المخاطر'))),
          h('div', null, h('small', null, 'السعر وقت التقييم'), N(fmtPrice(item.price_at_valuation), 'q-strong'),
            h('small', null, 'إغلاق ', N(fmtDayMonth(item.created_at)))),
          h('div', null, h('small', null, 'الحالة مقابل السعر الحالي'),
            status ? [h('span', { key: 'c', className: `a-status${status === 'under' ? ' under' : ''}`, style: { alignSelf: 'flex-start' } }, STATUS_CHIP[status]),
              h(MarginText, { key: 'm', price, fair: item.fair_value }),
              status !== 'under' ? h('small', { key: 'p' }, 'أعلى من سعر الحماية بـ ', N(fmtPct((price - item.protection_price) / item.protection_price))) : null]
              : h('small', null, '—'))),
        help ? h('div', { className: 'a-helpline', role: 'note' }, h('b', null, 'ما هو سعر الحماية؟'),
          h('span', null, 'سعر الحماية = ', N('80%'), ' من السعر العادل. لو السعر نزل تحته، المحلل بيراجع التقييم تلقائيًا. ده تنبيه للمراجعة، مش أمر بيع. مرجع الدخول = السعر العادل نفسه، وليس توصية بالشراء.')) : null,
        price != null ? h('div', { className: 'a-ruler' }, h(BigRuler, { v: { ...item, protection_price: item.protection_price }, price })) : null),

      // History chart + change log
      h('section', { className: 'q-card q-pad', 'aria-label': 'تاريخ السعر العادل', style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h('h2', { className: 'q-h2' }, 'تاريخ السعر العادل مقابل السعر'),
        series ? h(FairHistoryChart, { points, bars }) : h(Skeleton, { width: '100%' }),
        points.length ? h(Table, {
          cols: '60px 100px minmax(150px, 1.4fr) 70px 90px minmax(150px, 1.4fr) minmax(160px, 1.6fr)',
          head: ['النسخة', 'التاريخ', 'العادل: السابق ← الجديد', 'التغيّر', 'الإغلاق وقتها', 'الحالة وقتها', 'السبب'],
          rows: points.slice().reverse().map((p) => {
            const i = points.findIndex((q) => q.id === p.id)
            const prev = points[i - 1]
            const c = changeFor(p.id)
            return [N(String(i + 1), p.id === item.id ? 'q-strong' : ''), N(fmtDate(p.created_at)),
              prev ? N(fmtArrow(prev.fair_value, p.fair_value)) : h('span', null, '— ← ', N(fmtPrice(p.fair_value))),
              c ? N(fmtPct(c.change_pct, { signed: true })) : h('span', { className: 'q-ter' }, '—'),
              N(fmtPrice(p.price_at_valuation)),
              p.price_at_valuation != null ? h(MarginText, { price: p.price_at_valuation, fair: p.fair_value }) : '—',
              h('span', { dir: 'auto', className: 'q-sec' }, c ? c.reason : p.kind === 'light' ? 'تحديث خفيف' : i === 0 ? 'أول تقييم' : '—')]
          }),
        }) : null),

      // Section nav + sections
      h('nav', { className: 'a-nav', 'aria-label': 'أقسام التحليل' },
        SECTIONS.map(([key, label]) => h('button', { key, type: 'button', 'aria-current': active === key, onClick: () => go(key) }, label))),
      section('summary', 'الملخص والأطروحة', 'الرقم، ولماذا هو عند هذا المستوى، وما الذي قد يغيّره.',
        h('div', { className: 'a-two' },
          h('div', null, h('h3', { className: 'q-h3' }, 'الأطروحة'), h('p', { className: 'a-text', dir: 'auto' }, item.thesis || (lastFull ? 'راجع التقييم الكامل.' : '—'))),
          h('div', null, h('h3', { className: 'q-h3' }, item.kind === 'light' ? 'ما تمت مراجعته' : 'ما الذي تغيّر منذ النسخة السابقة'),
            h('p', { className: 'a-text', dir: 'auto' }, item.reason === 'first valuation' ? 'أول تقييم لهذا السهم.' : (item.reason || '—'))))),
      section('methods', 'طرق التقييم', 'كل طريقة تعطي ثلاث قيم، والعادل هو المتوسط المرجّح بالأوزان.', h(MethodsSection, { item })),
      section('assumptions', 'الافتراضات', 'المدخلات التي بُني عليها الرقم. تعديل أي قيمة يعيد حساب العادل ويُنشئ نسخة جديدة.', h(AssumptionsSection, { item })),
      section('checks', 'فحوصات المنطق', 'اختبارات آلية على الرقم نفسه: ما فُحص، والنتيجة، ولماذا.', h(ChecksSection, { item })),
      section('risk', 'المخاطر', 'المقاييس التي بُني عليها التصنيف، مع معنى كل منها وحدّها المرجعي.', h(RiskSection, { item })),
      section('critic', 'ملاحظات الناقد', 'مراجعة مستقلة للتقييم قبل حفظه.',
        h('p', { className: 'a-text', dir: 'auto' }, item.critic_notes || '—')),
      section('sources', 'المصادر', 'كل رقم مستخدم ومن أين جاء وتاريخه.', h(SourcesSection, { item })),
      section('report', 'التقرير الكامل', 'نص التقرير كما عرضه المحلل في المحادثة.', h(ReportSection, { item, toast })),
      h(Disclaimer, { extra: [h('span', { key: 'v' }, 'النسخة ', N(String(version || 1)), ' · ', N(fmtDate(item.created_at)), ' · الأسعار متأخرة وليست لحظية.')] })),
    toastNode)
}

function AnalysesPage() {
  const [opening] = useState(() => {
    const pending = { id: nav.pendingAnalysisId, section: nav.pendingSection }
    nav.pendingAnalysisId = null
    nav.pendingSection = null
    return pending
  })
  const [openId, setOpenId] = useState(opening.id)
  return openId == null
    ? h(AnalysesList, { onOpen: setOpenId })
    : h(AnalysisDetail, { key: openId, id: openId, onBack: () => setOpenId(null), onOpen: setOpenId,
      initialSection: openId === opening.id ? opening.section : null })
}
