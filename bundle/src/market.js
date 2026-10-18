// «Monos / السوق»: status strip, «منذ آخر إغلاق» digest, toolbar, the 7-column grid table and the
// docked detail for the selected stock (docs/design/CLAUDE_CODE.md §7.1). Inlined into the factory
// scope: h, React, api, N, nav, the format.mjs helpers, identity.js and components.js are in scope.

const MARKET_CSS = '/* @css market.css */'
const MARKET_TOTAL = 31

const PERIOD_OPTIONS = [['1m', 'شهر'], ['3m', '3 شهور'], ['1y', 'سنة']]
const SORT_OPTIONS = [
  ['weight', 'الوزن في المؤشر'], ['symbol', 'الرمز'], ['price', 'آخر سعر'], ['day', 'التغير اليوم'],
  ['period', 'أداء الفترة'], ['margin', 'الفرق عن العادل'], ['rating', 'التصنيف'], ['r52', 'موضع 52 أسبوعًا'],
]
const FILTERS = [
  ['all', 'الكل'], ['valued', 'مقيَّم'], ['under', 'تحت الحماية'], ['unvalued', 'لم يُقيَّم'], ['noprice', 'بدون سعر'], ['stale', 'قديم'],
]

const isUnder = (r) => Boolean(r.valuation && r.valuation.status === 'below_protection')
const FILTER_TEST = {
  all: () => true,
  valued: (r) => Boolean(r.valuation),
  under: isUnder,
  unvalued: (r) => r.price != null && !r.valuation,
  noprice: (r) => r.price == null,
  stale: (r) => r.stale === true,
}

// Sort values; null always sorts last whatever the direction. A stale day change is not today's
// move, so it is left out of the «اليوم» sort.
const SORT_VALUE = {
  weight: (r) => r.weight_pct,
  symbol: (r) => r.symbol,
  price: (r) => r.price,
  day: (r) => (r.stale ? null : r.change_pct),
  period: (r, period) => (r.returns || {})[period],
  margin: (r) => (r.valuation ? marginToFair(r.valuation.fair_value, r.price) : null),
  rating: (r) => (r.valuation ? RATING_LEVEL[r.valuation.risk_rating] || null : null),
  r52: (r) => rangePosition(r.low_52w, r.high_52w, r.price),
}

function sortRows(rows, key, desc, period) {
  const value = SORT_VALUE[key] || SORT_VALUE.weight
  return rows.slice().sort((a, b) => {
    const x = value(a, period), y = value(b, period)
    if (x == null && y == null) return a.symbol.localeCompare(b.symbol)
    if (x == null) return 1
    if (y == null) return -1
    const c = typeof x === 'string' ? x.localeCompare(y) : x - y
    return desc ? -c : c
  })
}

const lastCloseOf = (data) => data.rows.reduce((m, r) => (r.price != null && r.as_of && r.as_of.slice(0, 10) > m ? r.as_of.slice(0, 10) : m), '')

function openAnalysis(id, section = null) {
  if (id == null || !nav.selectPanel) return
  nav.pendingAnalysisId = id
  nav.pendingSection = section
  nav.selectPanel(ANALYSES_ID)
}

// ── «متابعتي»: followed stocks get the daily price refresh right after holdings ─

const STAR_PATH = 'M8 1.6l1.95 3.95 4.35.63-3.15 3.07.74 4.33L8 11.53l-3.89 2.05.74-4.33L1.7 6.18l4.35-.63Z'
const StarGlyph = ({ on, size = 16 }) => h('svg', { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true },
  h('path', { d: STAR_PATH, fill: on ? 'currentColor' : 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round' }))

/** Star toggle in a table row (icon only) or the detail header (with text). */
function WatchToggle({ row, onWatch, withText = false }) {
  const on = Boolean(row.watched)
  const label = on ? `إزالة ${row.symbol} من متابعتي` : `أضف ${row.symbol} إلى متابعتي`
  const toggle = (e) => { e.stopPropagation(); onWatch(row.symbol, !on) }
  const keep = (e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }
  if (withText) {
    return h('button', { type: 'button', className: `q-btn q-btn-sm m-watch${on ? ' on' : ''}`, 'aria-pressed': on, title: label, onClick: toggle },
      h(StarGlyph, { on, size: 14 }), on ? 'في متابعتي' : 'أضف إلى متابعتي')
  }
  return h('button', { type: 'button', className: `m-star${on ? ' on' : ''}`, 'aria-pressed': on, 'aria-label': label, title: label,
    onClick: toggle, onKeyDown: keep }, h(StarGlyph, { on }))
}

/** «سهم واحد» · «سهمان» · «5 أسهم» · «18 سهمًا» (Arabic counted-noun agreement). */
const stockCount = (n) => (n === 1 ? 'سهم واحد' : n === 2 ? 'سهمان' : [N(fmtCount(n)), n <= 10 ? ' أسهم' : ' سهمًا'])

/** Holdings + «متابعتي» counted live from the rows, against the plan's daily budget. */
function refreshCoverage(data) {
  const plan = data.refresh_plan || {}
  const priority = data.rows.filter((r) => r.held || r.watched).length
  const budget = plan.daily_budget == null ? null : plan.daily_budget
  return {
    priority, budget, allDaily: Boolean(plan.all_daily),
    watched: data.rows.filter((r) => r.watched).length,
    overflow: budget == null || plan.all_daily ? 0 : Math.max(0, priority - budget),
  }
}

function SortArrow({ desc }) {
  return h('svg', { width: 10, height: 10, viewBox: '0 0 12 12', 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h('path', { d: desc ? 'M6 2v8M3 7l3 3 3-3' : 'M6 10V2M3 5l3-3 3 3' }))
}

// ── Status strip ─────────────────────────────────────────────────────────────

function StatusStrip({ data, portfolio }) {
  const cover = refreshCoverage(data)
  const session = sessionLine(data.as_of, data.session_open)
  const lastClose = data.rows.reduce((m, r) => (r.price != null && r.as_of && r.as_of.slice(0, 10) > m ? r.as_of.slice(0, 10) : m), '')
  const run = data.last_sync
  const used = run && run.daily_limit ? (run.used_before || 0) + (run.calls_made || 0) : null
  const b = data.breadth
  const holdings = portfolio && portfolio.holdings && portfolio.holdings.length
  const totals = portfolio && portfolio.totals
  return h('section', { className: 'q-card m-strip', 'aria-label': 'حالة الجلسة والبيانات' },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
      h('span', { className: 'm-ring', 'aria-hidden': true }),
      h('div', { className: 'm-kv' },
        h('b', null, h('span', null, session.text, session.time ? ' ' : null, session.time ? N(session.time) : null)),
        lastClose ? h('small', null, `آخر إغلاق ${weekdayName(lastClose)} `, N(fmtDate(lastClose))) : h('small', null, 'لا توجد إغلاقات محفوظة بعد'))),
    h('div', { className: 'm-kv' },
      h('small', null, 'تحديثات الأسعار اليوم · المصدر EODHD (أسعار نهاية اليوم)'),
      h('b', null,
        used == null ? h('span', { className: 'q-sec' }, 'لم يتم تحديث اليوم بعد')
          : [h('span', { key: 'n' }, N(fmtCount(used)), ' من ', N(fmtCount(run.daily_limit))),
            h('span', { key: 'b', className: 'q-mini-bar', 'aria-hidden': true },
              h('span', { style: { width: `${Math.min(100, (used / run.daily_limit) * 100)}%`, background: 'var(--dsw-alias-label-secondary)' } }))],
        run && run.finished_at ? h('span', { className: 'q-sec', style: { fontWeight: 400, fontSize: 12 } }, 'آخر تحديث ', N(fmtTime(run.finished_at))) : null)),
    h('div', { className: 'm-kv' },
      h('small', null, 'صاعد / هابط اليوم'),
      h('b', null,
        h('span', { className: 'm-stack', 'aria-hidden': true },
          h('span', { style: { flex: b.up, background: 'var(--dsw-alias-state-success-primary)' } }),
          h('span', { style: { flex: b.down, background: 'var(--dsw-alias-state-error-primary)' } }),
          h('span', { style: { flex: b.flat + b.stale, background: 'var(--dsw-alias-label-tertiary)' } }),
          h('span', { style: { flex: b.no_data, background: 'var(--dsw-alias-border-l4)' } })),
        h('span', { className: 'q-up' }, 'صاعد ', N(fmtCount(b.up))),
        h('span', { className: 'q-down' }, 'هابط ', N(fmtCount(b.down))),
        b.flat ? h('span', { className: 'q-sec' }, 'ثابت ', N(fmtCount(b.flat))) : null,
        b.stale ? h('span', { className: 'q-sec', title: 'آخر سعر له من جلسة سابقة، فلا يدخل في حساب اليوم' }, 'قديم ', N(fmtCount(b.stale))) : null,
        b.no_data ? h('span', { className: 'q-sec' }, 'بدون سعر ', N(fmtCount(b.no_data))) : null)),
    holdings ? h('div', { className: 'm-kv' },
      h('small', null, 'محفظتي اليوم'),
      totals.today_has_fresh
        ? h('b', null, N(fmtChange(totals.today_change, totals.today_change_pct), toneOf(totals.today_change)))
        : h('b', { className: 'q-sec', title: 'لا يوجد سعر جديد اليوم لأي سهم في محفظتك' }, 'لا تغيّر محسوب اليوم')) : null,
    cover.allDaily ? null : h('p', { className: 'm-plan' }, h(StarGlyph, { on: cover.priority > 0, size: 12 }),
      cover.overflow ? 'الأسهم في متابعتي ومحفظتك لها الأولوية في التحديث، والباقي بالتناوب'
        : cover.priority ? 'الأسهم في متابعتي ومحفظتك تتحدّث يوميًا، والباقي بالتناوب'
        : 'ميّز الأسهم التي تهمك بالنجمة لتتحدّث يوميًا، والباقي بالتناوب'))
}

/** Holdings + «متابعتي» larger than the daily budget: say how many fall back to every other day. */
function WatchBudgetNote({ data }) {
  const cover = refreshCoverage(data)
  if (!cover.overflow) return null
  const title = cover.watched ? 'متابعتي ومحفظتك أكبر من رصيد التحديث اليومي' : 'محفظتك أكبر من رصيد التحديث اليومي'
  return h('section', { className: 'q-card q-pad', role: 'status',
    style: { borderInlineStart: '3px solid var(--dsw-alias-label-tertiary)', display: 'flex', flexDirection: 'column', gap: 4 } },
  h('b', null, title),
  h('span', { className: 'q-sec', style: { lineHeight: 1.7 } },
    cover.watched ? 'فيهما ' : 'فيها ', stockCount(cover.priority), '، والرصيد اليومي يكفي ', stockCount(cover.budget),
    ' فقط، لذلك سيتحدّث ', stockCount(cover.overflow), ' منها يومًا بعد يوم بالتناوب،',
    ' ولن يبقى رصيد لباقي أسهم المؤشر إلا في عطلة نهاية الأسبوع.',
    cover.watched ? ' لتتحدّث كلها يوميًا أزل النجمة عن بعض أسهم متابعتي.' : null))
}

// ── Sync alerts: failed refresh, daily limit, no fresh prices yet ───────────

function SyncAlerts({ data, failure, syncing, onRetry, lastClose }) {
  const [why, setWhy] = useState(false)
  const run = data.last_sync
  const now = data.as_of
  const used = run && run.daily_limit ? (run.used_before || 0) + (run.calls_made || 0) : null
  const sinceReset = Boolean(run && run.finished_at && new Date(run.finished_at) >= lastLimitReset(now))
  const skipped = run && run.summary && run.summary.skipped_for_budget ? run.summary.skipped_for_budget.length : 0
  const limitReached = sinceReset && used != null && (used >= run.daily_limit || skipped > 0)
  const error = failure || (run && run.error)
  const goodData = h('span', { className: 'q-meta' }, 'آخر بيانات سليمة: ',
    lastClose ? ['إغلاق ', N(fmtDayMonth(lastClose))] : 'لا يوجد', run && run.finished_at && !run.error ? [' · مزامنة ', N(fmtTime(run.finished_at))] : null)
  const card = (key, role, edge, children) => h('section', { key, className: 'q-card q-pad', role,
    style: { borderInlineStart: `3px solid var(${edge})`, display: 'flex', flexDirection: 'column', gap: 6 } }, children)
  const cards = []
  if (error) {
    cards.push(card('e', 'alert', '--dsw-alias-file-diff-deleted-marker', [
      h('b', { key: 't' }, 'تعذّر تحديث الأسعار'),
      h('span', { key: 'x', className: 'q-sec' }, 'فشل تحديث الأسعار من مزوّد الأسعار EODHD، والأسعار المعروضة من آخر مزامنة ناجحة. ',
        h('span', { className: 'q-ter', dir: 'auto' }, `(${String(error).slice(0, 140)})`)),
      h(React.Fragment, { key: 'g' }, goodData),
      h('div', { key: 'b' }, h('button', { type: 'button', className: 'q-btn q-btn-sm', disabled: syncing, onClick: onRetry }, syncing ? 'جارٍ المحاولة…' : 'إعادة المحاولة'))]))
  }
  if (limitReached) {
    const reset = nextLimitReset(now)
    cards.push(card('l', 'status', '--dsw-alias-label-tertiary', [
      h('b', { key: 't' }, 'بلغنا الحد اليومي لتحديثات الأسعار (', N(fmtCount(used)), ' من ', N(fmtCount(run.daily_limit)), ')'),
      h('span', { key: 'x', className: 'q-sec' }, 'الخطة المجانية تسمح بـ', N(fmtCount(run.daily_limit)), ' تحديثًا في اليوم، ويتجدد الحد ', reset.when, ' الساعة ', N(reset.time),
        ' بتوقيت القاهرة. حتى ذلك الحين تبقى الأسعار الأقدم معروضة بوسم «سعر قديم».'),
      h(React.Fragment, { key: 'g' }, goodData),
      h('div', { key: 'b', className: 'q-row' },
        h('button', { type: 'button', className: 'q-btn q-btn-sm', disabled: true }, 'إعادة المحاولة'),
        h('button', { type: 'button', className: 'q-link', 'aria-expanded': why, onClick: () => setWhy(!why) }, 'لماذا هناك حد؟')),
      why ? h('span', { key: 'w', className: 'q-meta', style: { lineHeight: 1.7 } },
        'الأسعار تأتي من EODHD على الخطة المجانية: كل سهم يستهلك تحديثًا واحدًا، فلا يكفي الرصيد اليومي كل أسهم المؤشر. الأولوية لأسهم محفظتك ثم أسهم متابعتي، والباقي بالتناوب.') : null]))
  }
  const b = data.breadth
  const priced = data.rows.some((r) => r.price != null)
  if (!error && !limitReached && priced && b.up + b.down + b.flat === 0) {
    cards.push(card('f', 'status', '--dsw-alias-label-tertiary', [
      h('b', { key: 't' }, 'لا أسعار محدّثة بعد'),
      h('span', { key: 'x', className: 'q-sec' }, 'إغلاق جلسة ', N(fmtDayMonth(data.expected_last_bar)), ' لم يُجلب بعد، والمعروض هو إغلاق ',
        N(fmtDayMonth(lastClose)), ' بوسم «سعر قديم» ولا يُحتسب كتغيّر لليوم.')]))
  }
  return cards.length ? h(React.Fragment, null, cards) : null
}

// ── Digest ─────────────────────────────────────────────────────────────────────

const DIGEST_ICON = {
  status: ['w', h('svg', { width: 10, height: 10, viewBox: '0 0 12 12', 'aria-hidden': true }, h('path', { d: 'M6 1.5 10.5 6 6 10.5 1.5 6Z', fill: 'currentColor' }))],
  valuation: ['b', h('svg', { width: 10, height: 10, viewBox: '0 0 12 12', 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }, h('path', { d: 'M2 9l3-3 2 2 3-4' }))],
  holding_move: ['', PORTFOLIO_GLYPH(10)],
}

function Digest({ items, onSelect }) {
  if (!items || !items.length) return null
  return h('section', { className: 'q-card m-digest', 'aria-label': 'منذ آخر إغلاق' },
    h('span', { className: 'm-digest-t' }, 'منذ آخر إغلاق'),
    items.map((item, i) => {
      const [tone, glyph] = DIGEST_ICON[item.kind]
      const sym = h('b', { className: 'q-sym' }, item.symbol)
      let body, onClick, title
      if (item.kind === 'status') {
        onClick = () => onSelect(item.symbol)
        title = item.name_ar || item.symbol
        body = item.to === 'below_protection'
          ? [sym, ' ', h('span', { key: 'a', className: 'q-amber' }, 'تحت سعر الحماية بـ ', N(fmtPct(item.below_protection_by)))]
          : [sym, ' ', h('span', { key: 'a', className: 'q-sec' }, 'خرج من تحت سعر الحماية')]
      } else if (item.kind === 'valuation') {
        onClick = () => openAnalysis(item.valuation_id)
        title = item.reason || ''
        body = ['تقييم ', sym, ' ', item.previous_fair_value != null
          ? N(fmtArrow(item.previous_fair_value, item.fair_value), 'q-blue')
          : [h('span', { key: 'n', className: 'q-sec' }, 'جديد '), N(fmtPrice(item.fair_value), 'q-blue')]]
      } else {
        onClick = () => onSelect(item.symbol)
        title = item.name_ar || item.symbol
        body = ['سهمك ', sym, ' ', N(fmtChange(item.change, item.change_pct), toneOf(item.change))]
      }
      return h('button', { key: i, type: 'button', className: 'm-di', onClick, title },
        h('span', { className: `m-ic ${tone}` }, glyph), body)
    }))
}

// ── Table ──────────────────────────────────────────────────────────────────────

const COLUMNS = [
  ['symbol', 'السهم'], ['price', 'آخر سعر'], ['day', 'اليوم'], ['period', null], ['margin', 'التقييم'], ['rating', 'التصنيف'], ['r52', 'نطاق 52 أسبوعًا'],
]

function MarketRow({ row, period, selected, onSelect, onValue, onWatch }) {
  const v = row.valuation
  const per = (row.returns || {})[period]
  const select = () => onSelect(row.symbol)
  const cls = ['q-grid', 'm-g', 'q-tr', 'm-row', isUnder(row) ? 'q-warn' : '', selected ? 'q-sel' : ''].join(' ')
  return h('div', {
    className: cls, role: 'row', tabIndex: 0, 'aria-selected': selected, onClick: select,
    onKeyDown: (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select() } },
  },
  h('span', { className: 'm-symw', role: 'cell' },
    h(WatchToggle, { row, onWatch }),
    h('span', { className: 'q-cell m-sym' },
      h('span', { className: 'l1' }, h('b', { className: 'q-sym' }, row.symbol), h('span', { className: 'nm' }, row.name_ar || row.name),
        row.held ? h(MineChip) : null),
      h('small', null, row.sector_ar || row.sector, ' · ', N(fmtPct(row.weight_pct / 100, { digits: 2 })), ' من المؤشر'))),
  h('span', { role: 'cell' }, h(PriceCell, { price: row.price, asOf: row.as_of, stale: row.stale, kind: row.price_kind })),
  h('span', { className: 'q-cell', role: 'cell' },
    row.change == null ? h('span', { className: 'q-ter' }, '—')
      : N(fmtChange(row.change, row.change_pct), row.stale ? 'q-ter' : toneOf(row.change)),
    row.stale ? h('small', null, 'جلسة ', N(fmtDayMonth(row.as_of))) : null),
  h('span', { role: 'cell' }, per == null ? h('span', { className: 'q-ter' }, '—') : N(fmtPct(per, { signed: true }), toneOf(per))),
  v ? h('span', { className: 'm-vc', role: 'cell' },
    h(Ruler, { fair: v.fair_value, bear: v.bear, bull: v.bull, price: row.price }),
    h('span', { className: 'q-vline' },
      h('span', null, h('span', { className: 'q-sec' }, 'عادل '), N(fmtPrice(v.fair_value), 'q-blue q-strong')),
      row.price != null ? h(MarginText, { price: row.price, fair: v.fair_value }) : null))
    : h('span', { className: 'm-vc', role: 'cell' },
      h('span', { className: 'm-unvalued' },
        h('span', { className: 'q-sec', style: { fontSize: 12 } }, 'لم يُقيَّم بعد'),
        h('button', { type: 'button', className: 'm-qbtn', 'aria-label': `قيّم سهم ${row.symbol} في المحادثة`,
          onClick: (e) => { e.stopPropagation(); onValue(row.symbol) } }, 'قيّم'))),
  h('span', { role: 'cell' }, v ? h(RatingChip, { rating: v.risk_rating }) : h('span', { className: 'q-ter', 'aria-hidden': true }, '—')),
  h('span', { className: 'm-c52', role: 'cell' }, h(Range52, { low: row.low_52w, high: row.high_52w, price: row.price })))
}

function TableHead({ sort, desc, period, onSort }) {
  const periodLabel = PERIOD_OPTIONS.find(([k]) => k === period)[1]
  return h('div', { className: 'q-grid m-g q-th', role: 'row' },
    COLUMNS.map(([key, label]) => {
      const on = sort === key
      return h('span', { key, role: 'columnheader', className: key === 'r52' ? 'm-c52' : undefined,
        'aria-sort': on ? (desc ? 'descending' : 'ascending') : 'none' },
      h('button', { type: 'button', className: on ? 'on' : '', onClick: () => onSort(key) }, label || periodLabel, on ? h(SortArrow, { desc }) : null))
    }))
}

function NoPriceGroup({ rows, open, onToggle, selected, onSelect }) {
  if (!rows.length) return null
  const preview = rows.slice(0, 8).map((r) => r.symbol).join(' · ') + (rows.length > 8 ? ' …' : '')
  return h(React.Fragment, null,
    h('button', { type: 'button', className: 'm-grp', 'aria-expanded': open, onClick: onToggle },
      h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', style: { flex: 'none' } },
        h('path', { d: open ? 'M2.5 4.5 6 8l3.5-3.5' : 'M7.5 2.5 4 6l3.5 3.5' })),
      h('b', { style: { fontWeight: 600 } }, N(fmtCount(rows.length)), ' سهمًا بانتظار السعر'),
      h('span', { className: 'q-sec' }, '— تُستكمل في التحديث القادم'),
      open ? null : h('span', { className: 'q-ter num', style: { fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 } }, preview),
      h('span', { className: 'q-grow' }),
      h('span', { className: 'q-link', style: { minHeight: 0 } }, open ? 'إخفاء' : 'عرض الأسماء')),
    open ? h('div', { className: 'm-tkgrid' }, rows.map((r) => h('button', {
      key: r.symbol, type: 'button', className: selected === r.symbol ? 'q-sel' : '', onClick: () => onSelect(r.symbol),
    }, h('b', { className: 'q-sym' }, r.symbol), h('span', { className: 'q-sec', style: { fontSize: 12 } }, r.name_ar || r.name),
      r.watched ? h('span', { title: 'في متابعتي', style: { alignSelf: 'center', display: 'inline-flex' } }, h(StarGlyph, { on: true, size: 12 }),
        h('span', { className: 'q-sr' }, 'في متابعتي')) : null))) : null)
}

function RulerLegend() {
  const key = (swatch, label) => h('span', { className: 'm-key' }, swatch, label)
  return [
    h('span', { key: 't' }, 'المسطرة لكل سهم بمقياسه:'),
    key(h('span', { style: { width: 10, height: 10, borderRadius: '50%', background: 'var(--dsw-alias-label-primary)', display: 'inline-block' } }), 'السعر'),
    key(h('span', { style: { width: 3, height: 14, borderRadius: 1, background: 'var(--dsw-alias-state-warn-primary)', display: 'inline-block' } }), 'سعر الحماية'),
    key(h('span', { style: { width: 3, height: 14, borderRadius: 1, background: 'var(--dsw-alias-state-business-primary)', display: 'inline-block' } }), 'السعر العادل'),
    key(h('span', { style: { width: 18, height: 6, borderRadius: 3, background: 'var(--dsw-alias-state-business-primary)', opacity: 0.35, display: 'inline-block' } }), 'من المتشائم إلى المتفائل'),
  ].map((node, i) => React.cloneElement(node, { key: i }))
}

// ── Detail: our valuation ─────────────────────────────────────────────────────

function BigRuler({ v, price }) {
  const s = rulerScale({ bear: v.bear, bull: v.bull, fair: v.fair_value, price })
  if (!s) return null
  // Labels can collide when marks are close: nudge the bottom labels apart (min 14% gap).
  const bottom = [['bear', s.bear], ['prot', s.protection], ['fair', s.fair], ['bull', s.bull]].filter(([, p]) => p != null).sort((a, b) => a[1] - b[1])
  const placed = {}
  let last = -100
  bottom.forEach(([k, p]) => { const q = Math.max(p, last + 14); placed[k] = q; last = q })
  const over = last - 100
  if (over > 0) Object.keys(placed).forEach((k) => { placed[k] -= over })
  const label = (key, title, value, cls) => (placed[key] == null ? null
    : h('div', { key, className: 'lg', style: { left: `${placed[key]}%`, top: 72 } }, h('span', { className: cls }, title), h('br'), N(fmtPrice(value))))
  return h('div', { className: 'm-bigruler', role: 'img',
    'aria-label': `مسطرة التقييم: المتشائم ${fmtPrice(v.bear)}، الحماية ${fmtPrice(v.protection_price)}، السعر ${fmtPrice(price)}، العادل ${fmtPrice(v.fair_value)}، المتفائل ${fmtPrice(v.bull)}` },
  s.price != null ? h('div', { className: 'lg', style: { left: `${s.price}%`, top: 0 } }, N(fmtPrice(price), 'q-strong'), h('br'), h('span', { className: 'q-sec' }, 'السعر')) : null,
  h('div', { className: 'bar', style: { left: 0, right: 0, background: 'var(--dsw-alias-border-l4)' } }),
  s.bear != null && s.bull != null ? [
    h('div', { key: 'band', className: 'bar', style: { left: `${s.bear}%`, width: `${s.bull - s.bear}%`, background: 'var(--dsw-alias-state-business-primary)', opacity: 0.3 } }),
    h('div', { key: 'e1', className: 'edge', style: { left: `${s.bear}%` } }), h('div', { key: 'e2', className: 'edge', style: { left: `${s.bull}%` } })] : null,
  h('div', { className: 'tk', style: { left: `${s.protection}%`, background: 'var(--dsw-alias-state-warn-primary)' } }),
  h('div', { className: 'tk', style: { left: `${s.fair}%`, background: 'var(--dsw-alias-state-business-primary)' } }),
  s.price != null ? h('div', { className: 'dt', style: { left: `${s.price}%` } }) : null,
  label('bear', 'المتشائم', v.bear, 'q-sec'), label('prot', 'سعر الحماية', v.protection_price, 'q-amber'),
  label('fair', 'السعر العادل', v.fair_value, 'q-blue q-strong'), label('bull', 'المتفائل', v.bull, 'q-sec'))
}

const lastFullId = (row) => {
  const full = (row.valuation_history || []).filter((s) => s.kind === 'full')
  return full.length ? full[full.length - 1].id : row.valuation && row.valuation.id
}

function ValuationCard({ row }) {
  const v = row.valuation
  const [help, setHelp] = useState(true)
  const steps = (row.valuation_history || []).slice().reverse()
  const lastFull = steps.find((s) => s.kind === 'full')
  const light = v.kind === 'light'
  const m = marginSentence(row.price, v.fair_value)
  const fact = (label, value, extra) => h('div', { className: 'q-kv' }, h('small', null, label), h('b', null, value), extra || null)
  return h('div', { className: 'm-box' },
    h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' } },
      h('span', { className: 'q-sec' }, 'السعر العادل'),
      h('span', { className: 'q-meta' }, 'تاريخ التقييم ', N(fmtDate(lastFull ? lastFull.date : v.valuation_date)),
        light ? [' · تحديث خفيف ', N(fmtDayMonth(v.valuation_date))] : null)),
    h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginTop: -8 } },
      N(fmtPrice(v.fair_value), 'q-blue q-hero'),
      row.price != null ? h(MarginText, { price: row.price, fair: v.fair_value, prefix: m && m.status !== 'under' ? 'السعر ' : '', size: 14 }) : null),
    row.price != null ? h(BigRuler, { v, price: row.price }) : null,
    h('div', { className: 'm-facts' },
      fact('السعر العادل', N(fmtPrice(v.fair_value), 'q-blue')),
      fact('النطاق (المتشائم – المتفائل)', N(`${fmtPrice(v.bear)} – ${fmtPrice(v.bull)}`)),
      h('div', { className: 'q-kv' }, h('small', null, 'سعر الحماية ', h(ProtectionHelp, { open: help, onToggle: () => setHelp(!help) })),
        h('b', null, N(fmtPrice(v.protection_price), 'q-amber'))),
      fact('الفرق عن العادل', row.price == null ? '—' : (() => {
        // Always measured against fair (the protection gap has its own line above).
        const margin = marginToFair(v.fair_value, row.price)
        if (Math.round(Math.abs(margin) * 1000) === 0) return 'عند السعر العادل'
        return h('span', { style: { fontSize: 13 } }, margin > 0 ? 'أقل من العادل بـ ' : 'أعلى من العادل بـ ', N(fmtPct(Math.abs(margin))))
      })()),
      fact('التصنيف', h(RatingChip, { rating: v.risk_rating })),
      fact('تاريخ التقييم', N(fmtDate(v.valuation_date))),
      fact('السعر وقت التقييم', N(fmtPrice(v.price_at_valuation)), h('small', { className: 'q-meta' }, 'إغلاق ', N(fmtDayMonth(v.valuation_date))))),
    help ? h(ProtectionNote) : null,
    steps.length ? h('div', null,
      h('div', { className: 'q-meta', style: { marginBottom: 4 } }, 'كل التقييمات والسعر وقت كل واحد'),
      h('div', { className: 'm-hist h' }, h('span', null, 'التاريخ'), h('span', null, 'العادل'), h('span', null, 'السعر وقتها'), h('span', null, 'الحالة وقتها')),
      steps.map((s) => h('div', { key: s.id, className: 'm-hist' },
        h('span', { className: 'q-sec' }, N(fmtDate(s.date)), s.kind === 'light' ? h('small', { className: 'q-ter' }, ' خفيف') : null),
        N(fmtPrice(s.fair_value), 'q-blue q-strong'),
        N(fmtPrice(s.price_at_valuation)),
        s.price_at_valuation != null ? h(MarginText, { price: s.price_at_valuation, fair: s.fair_value }) : h('span', { className: 'q-ter' }, '—'))),
      light ? h('p', { className: 'q-meta', style: { margin: '6px 0 0', lineHeight: 1.7 } },
        'التحديث الخفيف = مراجعة أسبوعية سريعة للأخبار والأسعار بدون إعادة تقييم كامل، والسعر العادل فيه لم يتغير.') : null) : null,
    h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
      h('button', { type: 'button', className: 'q-link', onClick: () => openAnalysis(lastFull ? lastFull.id : v.id) }, 'افتح التحليل الكامل ←')))
}

// ── Detail: candles with fair / protection as step lines by valuation date ────

function ValuationCandles({ bars, steps }) {
  const ref = React.useRef(null)
  useEffect(() => {
    if (!bars.length) return undefined
    const theme = chartTheme()
    const chart = LightweightCharts.createChart(ref.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: theme.text, attributionLogo: true },
      grid: { vertLines: { visible: false }, horzLines: { color: theme.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, rightOffset: 2 },
      localization: { locale: 'en-US', dateFormat: 'dd/MM' },
      crosshair: { mode: 0 },
      handleScroll: false, handleScale: false,
    })
    const candles = chart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor: theme.up, downColor: theme.down, wickUpColor: theme.up, wickDownColor: theme.down, borderVisible: false,
      priceLineVisible: false, lastValueVisible: true,
    })
    candles.setData(bars.map((b) => ({ time: b.date, open: b.open, high: b.high, low: b.low, close: b.close })))
    const first = bars[0].date, last = bars[bars.length - 1].date
    // A valuation dated after the last candle extends the axis to its own day (right-edge marker).
    const timeline = bars.map((b) => b.date).concat([...new Set(steps.filter((s) => s.date > last).map((s) => s.date))])
    const valueAt = (day, key) => { let value = null; for (const s of steps) if (s.date <= day) value = s[key]; return value }
    const stepLine = (key, color, style) => {
      const points = timeline.map((t) => ({ time: t, value: valueAt(t, key) })).filter((p) => p.value != null)
      if (!points.length) return null
      const series = chart.addSeries(LightweightCharts.LineSeries, {
        color, lineWidth: 2, lineStyle: style, lineType: LightweightCharts.LineType.WithSteps,
        priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, pointMarkersVisible: points.length === 1,
      })
      series.setData(points)
      return series
    }
    const fair = stepLine('fair_value', theme.fair, LightweightCharts.LineStyle.Dashed)
    stepLine('protection_price', theme.protection, LightweightCharts.LineStyle.Solid)
    if (fair) {
      const snap = (day) => timeline.find((t) => t >= day)
      const marks = steps.filter((s) => s.date >= first && snap(s.date)).map((s) => ({
        time: snap(s.date), position: 'aboveBar', shape: 'circle', color: theme.price, size: 0.6,
        text: s.date > last ? `تقييم ${fmtDayMonth(s.date)}` : '',
      }))
      if (marks.length) LightweightCharts.createSeriesMarkers(fair, marks)
    }
    chart.timeScale().fitContent()
    return () => chart.remove()
  }, [bars, steps])
  return h('div', { ref, className: 'm-chart', role: 'img', 'aria-label': 'شارت شموع يومية مع السعر العادل وسعر الحماية حسب تاريخ كل تقييم' })
}

function chartExplanation(steps, bars) {
  if (!bars.length) return null
  const first = bars[0].date, last = bars[bars.length - 1].date
  const shown = steps.filter((s, i) => s.date >= first || (steps[i + 1] ? steps[i + 1].date > first : true))
    .filter((s, i, all) => i === 0 || s.fair_value !== all[i - 1].fair_value)
  if (!shown.length) return 'لا يوجد تقييم لهذا السهم، فلا خطوط للسعر العادل أو الحماية'
  const parts = []
  shown.forEach((s, i) => {
    if (i) parts.push(' ثم ')
    parts.push(N(fmtPrice(s.fair_value), 'q-blue'), ' من ', N(fmtDayMonth(s.date > first ? s.date : first)))
  })
  const after = shown.some((s) => s.date > last)
  return ['لا نرسم أي تقييم على أيام سبقته', after ? '، وتقييم ما بعد آخر شمعة يظهر عند الحافة اليمنى. ' : '. ', 'العادل ', ...parts]
}

function CandlesPanel({ row, history }) {
  const bars = React.useMemo(() => (history ? history.bars.filter((b) => b.open != null).slice(-60) : []), [history])
  const steps = React.useMemo(() => (history ? history.valuation_history || [] : []), [history])
  const recent = history ? history.bars.slice(-11) : []
  const sessions = recent.slice(1).map((b, i) => ({ ...b, chg: recent[i].close ? b.close / recent[i].close - 1 : null })).reverse()
  const legendLine = (dash, color, label) => h('span', { className: 'q-sec', style: { display: 'flex', alignItems: 'center', gap: 6 } },
    h('svg', { width: 20, height: 4, 'aria-hidden': true }, h('path', { d: 'M0 2h20', stroke: color, strokeWidth: 2, strokeDasharray: dash ? '4 3' : undefined })), label)
  let body
  if (!history) body = h('div', { className: 'm-chart', style: { display: 'grid', placeItems: 'center' } }, h(Skeleton, { width: '60%' }))
  else if (!bars.length) body = h('div', { className: 'q-empty q-sunken', style: { minHeight: 240, borderRadius: 'var(--dsw-radius-sm)' } },
    h('span', null, 'لا توجد شموع محمّلة لـ ', h('span', { className: 'q-sym' }, row.symbol), ' بعد'),
    h('span', { className: 'q-meta' }, 'يُحمَّل تاريخ الأسعار في التحديث القادم حسب حد التحديثات اليومي.'))
  else body = [h(ValuationCandles, { key: 'c', bars, steps }), h('div', { key: 'x', className: 'q-meta', style: { lineHeight: 1.7 } }, chartExplanation(steps, bars))]
  return h('div', { className: 'm-box', style: { gap: 12 } },
    h('div', { className: 'm-legend' },
      h('b', { style: { fontWeight: 600, fontSize: 14 } }, h('span', { className: 'q-sym' }, row.symbol), ' · شموع يومية'),
      bars.length ? h('span', { className: 'q-sec' }, N(fmtCount(bars.length)), ' جلسة من ', N(fmtDayMonth(bars[0].date)), ' إلى ', N(fmtDayMonth(bars[bars.length - 1].date))) : null,
      h('span', { className: 'q-grow' }),
      legendLine(true, 'var(--dsw-alias-state-business-primary)', 'السعر العادل'),
      legendLine(false, 'var(--dsw-alias-state-warn-primary)', 'سعر الحماية'),
      h('span', { className: 'q-sec', style: { display: 'flex', alignItems: 'center', gap: 6 } },
        h('svg', { width: 12, height: 12, 'aria-hidden': true }, h('circle', { cx: 6, cy: 6, r: 4.5, fill: 'var(--dsw-alias-label-primary)' })), 'تاريخ تقييم')),
    body,
    sessions.length ? h('div', null,
      h('div', { className: 'q-h3', style: { marginBottom: 8 } }, 'آخر 10 جلسات'),
      h('div', { className: 'm-sk' }, sessions.map((s) => h('div', { key: s.date },
        N(fmtDayMonth(s.date), 'q-sec'), N(fmtPrice(s.close), 'q-strong'),
        s.chg == null ? h('span', { className: 'q-ter' }, '—') : N(fmtPct(s.chg, { digits: 2, signed: true }), toneOf(s.chg)))))) : null,
    h('div', { className: 'q-meta', style: { display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 } },
      h('span', null, 'الأسعار يومية ومتأخرة وليست لحظية'),
      h('a', { href: 'https://www.tradingview.com/lightweight-charts/', target: '_blank', rel: 'noreferrer', style: { color: 'inherit' } }, 'Lightweight Charts™ · TradingView')))
}

// ── Detail: TradingView tabs (display only; never feeds our numbers) ──────────

function TvFrame({ title, symbol, children }) {
  return h('div', { className: 'm-tv' },
    h('div', { className: 'm-tvh' }, h('span', null, `TradingView · ${title} · `, h('span', { className: 'q-sym' }, symbol)),
      h('a', { href: 'https://www.tradingview.com/', target: '_blank', rel: 'noreferrer' }, 'TradingView®')),
    h('div', { className: 'm-tvbody' }, children))
}

const DETAIL_TABS = [['ours', 'تقييمنا'], ['chart', 'الشارت الفني'], ['financials', 'البيانات المالية'], ['technical', 'التحليل الفني']]

function SymbolDetail({ row, period, onValue, onWatch }) {
  const [tab, setTab] = useState('ours')
  const theme = useHostTheme()
  const [history, setHistory] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    setHistory(null); setError('')
    api('GET', `/egx/api/market/${encodeURIComponent(row.symbol)}/history?days=130`)
      .then((d) => alive && setHistory(d)).catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [row.symbol])

  const v = row.valuation
  const per = (row.returns || {})[period]
  const periodLabel = PERIOD_OPTIONS.find(([k]) => k === period)[1]
  const tvSym = `EGX:${row.symbol}`
  const shared = { colorTheme: theme, isTransparent: true, width: '100%', height: '100%', locale: 'ar_AE' }

  let panel
  if (tab === 'ours') {
    let left
    if (row.price == null) left = h('div', { className: 'm-dashed' },
      h('span', { className: 'q-h2' }, h('span', { className: 'q-sym' }, row.symbol), ' بانتظار السعر'),
      h('span', { className: 'q-sec' }, 'وصلنا للحد اليومي من التحديثات قبل ما نجيب سعر السهم ده. هيتحدّث في التحديث القادم، وبعدها تقدر تطلب تقييمه.'))
    else if (!v) left = h('div', { className: 'm-dashed' },
      h('span', { className: 'q-h2' }, 'لم يُقيَّم ', h('span', { className: 'q-sym' }, row.symbol), ' بعد'),
      h('span', { className: 'q-sec' }, 'لا يوجد سعر عادل ولا سعر حماية. اكتب في المحادثة: ', h('b', { style: { fontWeight: 500 } }, 'قيّم سهم ', h('span', { className: 'q-sym' }, row.symbol))),
      h('div', { className: 'q-row' },
        h('button', { type: 'button', className: 'q-btn q-btn-p', onClick: () => onValue(row.symbol) }, 'قيّم في المحادثة'),
        h('span', { className: 'q-chip q-chip-line' }, '«قيّم سهم ', h('span', { className: 'q-sym' }, row.symbol), '»')))
    else left = [
      isUnder(row) ? h(UnderProtectionCard, { key: 'u', price: row.price, fair: v.fair_value, protection: v.protection_price, asOf: row.as_of,
        onCritic: () => openAnalysis(lastFullId(row), 'critic') }) : null,
      h(ValuationCard, { key: 'v', row })]
    panel = h('div', { className: 'm-panes' },
      h('div', { className: 'm-left' }, left),
      h('div', { className: 'm-right' }, error ? h('div', { className: 'q-error', role: 'alert' }, error) : h(CandlesPanel, { row, history })))
  } else if (tab === 'chart') {
    panel = h('div', { style: { padding: 16 } }, h(TvFrame, { title: 'Advanced Chart', symbol: row.symbol },
      h(TvWidget, { name: 'advanced-chart', height: 520, config: {
        autosize: true, symbol: tvSym, interval: 'D', timezone: 'Africa/Cairo', theme, style: '1', locale: 'ar_AE',
        allow_symbol_change: false, withdateranges: true, details: false, width: '100%', height: '100%' } })),
    h('p', { className: 'q-meta', style: { margin: '8px 0 0' } }, 'بيانات TradingView متأخرة وللعرض فقط، ولا تدخل في حساباتنا.'))
  } else if (tab === 'financials') {
    panel = h('div', { style: { padding: 16 } }, h(TvFrame, { title: 'Financials', symbol: row.symbol },
      h(TvWidget, { name: 'financials', height: 560, config: { ...shared, symbol: tvSym, displayMode: 'adaptive', largeChartUrl: '' } })),
    h('p', { className: 'q-meta', style: { margin: '8px 0 0' } }, 'للعرض والمقارنة فقط. تقييمنا يعتمد على القوائم المالية المحفوظة بمصادرها.'))
  } else {
    panel = h('div', { style: { padding: 16, display: 'flex', flexDirection: 'column', gap: 16 } },
      h('div', { className: 'q-note', role: 'note', style: { display: 'flex', gap: 12 } }, h('b', { className: 'q-amber' }, 'تنبيه'),
        h('span', null, 'إشارة آلية من TradingView مبنية على مؤشرات فنية فقط — ليست تقييمنا وليست توصية بالشراء أو البيع.')),
      h(TvFrame, { title: 'Technical Analysis', symbol: row.symbol },
        h(TvWidget, { name: 'technical-analysis', height: 420, config: { ...shared, symbol: tvSym, interval: '1D', displayMode: 'single', showIntervalTabs: true } })))
  }

  const onTabKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const i = DETAIL_TABS.findIndex(([k]) => k === tab)
    const step = e.key === 'ArrowLeft' ? 1 : -1 // right-to-left: ArrowLeft moves forward
    const next = DETAIL_TABS[(i + step + DETAIL_TABS.length) % DETAIL_TABS.length][0]
    setTab(next)
    const tabs = e.currentTarget.parentElement.querySelectorAll('[role=tab]')
    tabs[DETAIL_TABS.findIndex(([k]) => k === next)].focus()
  }

  return h('section', { className: 'q-card', 'aria-label': `تفاصيل ${row.symbol}`, style: { overflow: 'hidden' } },
    h('div', { className: 'm-dhead' },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('b', { className: 'q-sym', style: { fontSize: 20 } }, row.symbol), h('span', { style: { fontSize: 16, fontWeight: 500 } }, row.name_ar || row.name),
          v ? h(RatingChip, { rating: v.risk_rating }) : null, row.held ? h(MineChip, { long: true }) : null,
          h(WatchToggle, { row, onWatch, withText: true })),
        h('span', { className: 'q-meta' }, row.sector_ar || row.sector, ' · حصته ', N(fmtPct(row.weight_pct / 100, { digits: 2 })), ' من المؤشر')),
      row.price != null ? [
        h('div', { key: 'p', className: 'q-kv' },
          h('small', null, row.price_kind === 'delayed' ? ['متأخر ', N(fmtTime(row.as_of))] : ['إغلاق ', N(fmtDayMonth(row.as_of)), ' · سعر متأخر']),
          h('span', { className: 'num q-strong', style: { fontSize: 20 } }, fmtPrice(row.price))),
        h('div', { key: 'c', className: 'q-kv' }, h('small', null, row.stale ? ['جلسة ', N(fmtDayMonth(row.as_of))] : 'التغير اليوم'),
          row.change == null ? '—' : N(fmtChange(row.change, row.change_pct), row.stale ? 'q-ter' : toneOf(row.change))),
        row.stale ? h(StaleChip, { key: 's' }) : null]
        : h('span', { className: 'q-chip q-chip-line' }, 'لا يوجد سعر بعد · يُستكمل في التحديث القادم'),
      h('span', { className: 'q-grow' }),
      v && row.price != null ? h(MarginText, { price: row.price, fair: v.fair_value, size: 14, suffix: isUnder(row) ? ' — يحتاج مراجعة' : null }) : null),
    row.price != null ? h('div', { className: 'm-dstrip' },
      h('div', { className: 'q-kv', style: { minWidth: 240, flex: '0 1 280px' } }, h('small', null, 'موضع السعر في نطاق 52 أسبوعًا'),
        h(Range52, { low: row.low_52w, high: row.high_52w, price: row.price })),
      h('div', { className: 'q-kv' }, h('small', null, 'حجم تداول آخر جلسة'), N(fmtCompact(row.volume), 'q-strong')),
      h('div', { className: 'q-kv' }, h('small', null, `أداء ${periodLabel}`), per == null ? '—' : N(fmtPct(per, { signed: true }), toneOf(per)))) : null,
    h('div', { className: 'q-tabs', role: 'tablist', 'aria-label': `أقسام ${row.symbol}` },
      DETAIL_TABS.map(([key, label]) => h('button', {
        key, type: 'button', role: 'tab', className: 'q-tab', 'aria-selected': tab === key, tabIndex: tab === key ? 0 : -1,
        onClick: () => setTab(key), onKeyDown: onTabKey,
      }, label))),
    h('div', { role: 'tabpanel' }, panel))
}

// ── Page ─────────────────────────────────────────────────────────────────────

function MarketPage() {
  const portfolio = useMonos()
  const [data, setData] = useState(null)
  const [digest, setDigest] = useState(null)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncNote, setSyncNote] = useState('')
  const [syncFailure, setSyncFailure] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  // Scope chips «محفظتي» / «متابعتي»: at most one on, on top of the status filter.
  const [scope, setScope] = useState(null)
  const [period, setPeriod] = useState('1m')
  const [sort, setSort] = useState('weight')
  const [desc, setDesc] = useState(true)
  const [selected, setSelected] = useState(null)
  const [groupOpen, setGroupOpen] = useState(false)
  const [toastNode, toast] = useToast()
  const lastSyncSeen = React.useRef(undefined)

  const load = useCallback(async () => {
    try {
      const next = await api('GET', '/egx/api/market')
      setData(next); setError('')
      // A finished sync means new prices: refresh the shared portfolio (icon + strip) and the digest.
      const finished = next.last_sync && next.last_sync.finished_at
      if (lastSyncSeen.current !== undefined && finished !== lastSyncSeen.current) monos.refresh()
      lastSyncSeen.current = finished
      api('GET', '/egx/api/market/digest').then(setDigest).catch(() => setDigest(null))
    } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => {
    load()
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [load])

  async function sync() {
    setSyncing(true); setSyncNote(''); setSyncFailure('')
    try {
      const r = await api('POST', '/egx/api/market/sync', {})
      if (r.ok === false && r.error === 'no_key') setSyncNote('لم يتم العثور على مفتاح EODHD')
      else if (r.ok === false) setSyncFailure(r.error || 'خطأ غير معروف')
      else {
        const parts = [r.bars_updated.length ? `حُدّثت أسعار ${r.bars_updated.length} سهمًا` : 'الأسعار محدّثة بالفعل']
        if (r.skipped_for_budget.length) parts.push(`${r.skipped_for_budget.length} بانتظار رصيد تحديثات الغد`)
        setSyncNote(parts.join(' · '))
      }
      await load()
      monos.refresh()
    } catch (e) {
      setSyncFailure(e.message)
    } finally {
      setSyncing(false)
    }
  }

  const all = data ? data.rows : []
  const counts = React.useMemo(() => Object.fromEntries(FILTERS.map(([k]) => [k, all.filter(FILTER_TEST[k]).length])), [all])
  const heldCount = all.filter((r) => r.held).length
  const watchedCount = all.filter((r) => r.watched).length
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter((r) => FILTER_TEST[filter](r) && (scope !== 'mine' || r.held) && (scope !== 'watch' || r.watched)
      && (!q || r.symbol.toLowerCase().includes(q) || (r.name_ar || '').includes(query.trim()) || r.name.toLowerCase().includes(q)))
  }, [all, query, filter, scope])
  const priced = React.useMemo(() => sortRows(filtered.filter((r) => r.price != null), sort, desc, period), [filtered, sort, desc, period])
  const waiting = filtered.filter((r) => r.price == null)
  const groupExpanded = groupOpen || filter === 'noprice'
  const shown = priced.length + (groupExpanded ? waiting.length : 0)
  const selectedRow = all.find((r) => r.symbol === selected) || priced[0] || null

  const pickSort = (key) => {
    if (key === sort) setDesc(!desc)
    else { setSort(key); setDesc(key !== 'symbol') }
  }
  const onValue = (symbol) => copyValuationPrompt(symbol, toast)
  const markWatched = (symbols, plan) => setData((d) => d && {
    ...d, refresh_plan: plan || d.refresh_plan,
    rows: d.rows.map((r) => (symbols.has(r.symbol) === Boolean(r.watched) ? r : { ...r, watched: symbols.has(r.symbol) })),
  })
  // Optimistic: the star flips at once, then follows the server's list (or flips back on failure).
  const onWatch = async (symbol, on) => {
    const before = new Set(all.filter((r) => r.watched).map((r) => r.symbol))
    const next = new Set(before)
    if (on) next.add(symbol); else next.delete(symbol)
    markWatched(next)
    try {
      const res = on ? await api('POST', '/egx/api/watchlist', { symbol })
        : await api('DELETE', `/egx/api/watchlist/${encodeURIComponent(symbol)}`, {})
      markWatched(new Set(res.watchlist.map((w) => w.symbol)), res.refresh_plan)
      const plan = res.refresh_plan || {}
      if (on) {
        toast(plan.overflow > 0 ? `أُضيف ${symbol} إلى متابعتي. متابعتي ومحفظتك تجاوزتا رصيد التحديث اليومي، فبعضها سيتحدّث يومًا بعد يوم`
          : plan.all_daily ? `أُضيف ${symbol} إلى متابعتي` : `أُضيف ${symbol} إلى متابعتي، وسعره سيتحدّث يوميًا`)
      }
    } catch (e) {
      markWatched(before)
      toast(`تعذّر تعديل متابعتي: ${e.message}`)
    }
  }
  const selectSymbol = (symbol) => setSelected(symbol)

  const noKey = data && !data.last_sync && data.breadth.no_data === all.length
  let tableBody
  if (!data && !error) tableBody = Array.from({ length: 8 }, (_, i) => h('div', { key: i, className: 'q-grid m-g q-tr m-row', 'aria-hidden': true },
    COLUMNS.map(([key], j) => h('span', { key, className: key === 'r52' ? 'm-c52' : undefined }, h(Skeleton, { width: j === 4 ? 180 : j ? 56 : 120 })))))
  else if (!data) tableBody = h('div', { className: 'q-empty', role: 'alert' }, h('span', { className: 'q-h2' }, 'تعذّر تحميل السوق'), h('span', null, error))
  else if (!priced.length && !waiting.length) tableBody = h('div', { className: 'q-empty' }, 'لا توجد أسهم مطابقة. جرّب إزالة البحث أو تغيير التصفية.')
  else tableBody = [
    ...priced.map((r) => h(MarketRow, { key: r.symbol, row: r, period, selected: selectedRow && selectedRow.symbol === r.symbol, onSelect: selectSymbol, onValue, onWatch })),
    h(NoPriceGroup, { key: 'grp', rows: waiting, open: groupExpanded, onToggle: () => setGroupOpen(!groupExpanded), selected: selectedRow && selectedRow.symbol, onSelect: selectSymbol }),
  ]

  return h('div', { className: 'qm', dir: 'rtl', lang: 'ar' },
    h('style', null, QM_CSS + MARKET_CSS),
    h(PanelHeader, {
      here: 'السوق',
      actions: h('button', { type: 'button', className: 'q-btn q-btn-p', disabled: syncing, onClick: sync },
        h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' },
          h('path', { d: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3' })),
        syncing ? 'جارٍ التحديث…' : 'تحديث الأسعار الآن'),
    }),
    h('div', { className: 'q-wrap', style: { paddingTop: 8, gap: 8 } },
      data ? h(StatusStrip, { data, portfolio }) : null,
      data ? h(SyncAlerts, { data, failure: syncFailure, syncing, onRetry: sync, lastClose: lastCloseOf(data) }) : null,
      data ? h(WatchBudgetNote, { data }) : null,
      noKey ? h('section', { className: 'q-card q-pad q-sec', role: 'note' },
        h('b', { style: { color: 'var(--dsw-alias-label-primary)' } }, 'لا توجد أسعار بعد. '),
        'التطبيق يجلب الأسعار تلقائيًا من EODHD كل بضع دقائق. تأكد من وجود المفتاح في ',
        h('code', { dir: 'ltr' }, '~/.dsh/.env'), ' (EODHD_API_KEY) أو في ملف ', h('code', { dir: 'ltr' }, 'egx-api.docx'),
        ' داخل مجلد المشروع، ثم اضغط «تحديث الأسعار الآن».') : null,
      h(Digest, { items: digest && digest.items, onSelect: selectSymbol }),
      h('div', { className: 'm-toolbar' },
        h('label', { className: 'q-field' },
          h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, fill: 'none', stroke: 'var(--dsw-alias-label-secondary)', strokeWidth: 1.6, strokeLinecap: 'round' },
            h('circle', { cx: 7, cy: 7, r: 5 }), h('path', { d: 'M11 11l3.5 3.5' })),
          h('span', { className: 'q-sr' }, 'بحث'),
          h('input', { type: 'search', placeholder: 'ابحث بالرمز أو الاسم', value: query, onChange: (e) => setQuery(e.target.value) })),
        h('div', { className: 'm-chips', role: 'group', 'aria-label': 'تصفية سريعة' },
          FILTERS.map(([key, label]) => h('button', {
            key, type: 'button', className: `q-fchip${key === 'under' ? ' warn' : ''}`, 'aria-pressed': filter === key, onClick: () => setFilter(key),
          }, label, ' ', N(fmtCount(counts[key] || 0)))),
          h('button', { type: 'button', className: 'q-fchip', 'aria-pressed': scope === 'mine', onClick: () => setScope(scope === 'mine' ? null : 'mine') }, 'محفظتي ', N(fmtCount(heldCount))),
          h('button', { type: 'button', className: 'q-fchip', 'aria-pressed': scope === 'watch', title: 'الأسهم التي ميّزتها بالنجمة', onClick: () => setScope(scope === 'watch' ? null : 'watch') },
            h(StarGlyph, { on: scope === 'watch' || watchedCount > 0, size: 12 }), 'متابعتي ', N(fmtCount(watchedCount)))),
        h('span', { className: 'q-grow' }),
        h('div', { className: 'q-seg', role: 'group', 'aria-label': 'فترة الأداء' },
          PERIOD_OPTIONS.map(([key, label]) => h('button', { key, type: 'button', 'aria-pressed': period === key, onClick: () => setPeriod(key) }, label))),
        h('label', { className: 'q-field', title: 'ترتيب حسب' },
          h('span', { className: 'q-sr' }, 'ترتيب حسب'),
          h('select', { value: sort, onChange: (e) => { setSort(e.target.value); setDesc(e.target.value !== 'symbol') } },
            SORT_OPTIONS.map(([key, label]) => h('option', { key, value: key }, label)))),
        h('button', { type: 'button', className: 'q-btn q-icon-btn', onClick: () => setDesc(!desc),
          'aria-label': desc ? 'ترتيب تنازلي، اضغط للتصاعدي' : 'ترتيب تصاعدي، اضغط للتنازلي', title: desc ? 'تنازلي' : 'تصاعدي' }, h(SortArrow, { desc })),
        syncNote ? h('span', { className: 'q-chip q-chip-biz', role: 'status' }, syncNote) : null),
      h('section', { className: 'q-card m-table', 'aria-label': 'جدول الأسهم' },
        h('div', { className: 'q-scroll', role: 'table', 'aria-label': 'أسهم EGX30' },
          h(TableHead, { sort, desc, period, onSort: pickSort }),
          tableBody),
        h('div', { className: 'm-foot' },
          h('span', null, 'عرض ', N(fmtCount(shown)), ' من ', N(fmtCount(MARKET_TOTAL)),
            waiting.length && !groupExpanded ? [' · ', N(fmtCount(waiting.length)), ' مطويّة بانتظار السعر'] : null),
          h(RulerLegend),
          h('span', { className: 'q-grow' }),
          h('span', null, 'اضغط على أي صف لعرض تفاصيله أسفل الجدول'))),
      selectedRow ? h(SymbolDetail, { key: selectedRow.symbol, row: selectedRow, period, onValue, onWatch }) : null,
      h(Disclaimer, { extra: 'الأسعار من EODHD (مزوّد بيانات أسعار نهاية اليوم) ومتأخرة، وليست لحظية. كل سعر يظهر بتاريخ إغلاقه.' })),
    toastNode)
}
