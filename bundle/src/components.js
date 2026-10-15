// Valuation building blocks shared by Market, Analyses and Portfolio. Inlined into the factory
// scope (h, React, N and the format.mjs helpers are in scope).

/** Valuation ruler: bear–bull band, protection tick (amber), fair tick (blue), price dot. */
function Ruler({ fair, bear, bull, price, large = false }) {
  const s = rulerScale({ bear, bull, fair, price })
  if (!s || s.fair == null) return null
  return h('span', { className: `q-rl${large ? ' q-rl-lg' : ''}`, 'aria-hidden': true },
    h('span', { className: 'tr' }),
    s.bear != null && s.bull != null ? h('span', { className: 'bd', style: { left: `${s.bear}%`, width: `${s.bull - s.bear}%` } }) : null,
    s.protection != null ? h('span', { className: 'tk prot', style: { left: `${s.protection}%` } }) : null,
    h('span', { className: 'tk fair', style: { left: `${s.fair}%` } }),
    s.price != null ? h('span', { className: 'dt', style: { left: `${s.price}%` } }) : null)
}

/** ◆ under protection · ○ under fair · ● above fair (shape carries the meaning, not colour). */
function StatusMark({ status, size = 10 }) {
  const common = { width: size, height: size, viewBox: '0 0 10 10', 'aria-hidden': true, style: { flex: 'none' } }
  if (status === 'under') return h('svg', common, h('path', { d: 'M5 1 9 5 5 9 1 5Z', fill: 'currentColor', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round' }))
  return h('svg', common, h('circle', { cx: 5, cy: 5, r: 3.3, fill: status === 'above' ? 'currentColor' : 'none', stroke: 'currentColor', strokeWidth: 1.4 }))
}

const STATUS_TIP = {
  under: 'السعر أقل من سعر الحماية (80% من العادل): المحلل يراجع التقييم. تنبيه للمراجعة، مش أمر بيع.',
  between: 'السعر بين سعر الحماية والسعر العادل.',
  above: 'السعر أعلى من السعر العادل أو يساويه.',
}

/** «أقل من العادل بـ 6.9%» with its mark; the number is its own span and ends the sentence. */
function MarginText({ price, fair, prefix = '', suffix = null, size }) {
  const m = marginSentence(price, fair)
  if (!m) return null
  return h('span', { className: `q-status${m.status === 'under' ? ' under' : ''}`, title: STATUS_TIP[m.status], style: size ? { fontSize: size } : undefined },
    h(StatusMark, { status: m.status, size: size ? Math.round(size * 0.85) : 10 }),
    prefix, m.text, m.value ? ' ' : null, m.value ? N(m.value) : null, suffix)
}

function RatingChip({ rating }) {
  if (!rating) return h('span', { className: 'q-ter', 'aria-label': 'بدون تصنيف' }, '—')
  return h('span', { className: `q-rating q-r${RATING_LEVEL[rating] || 0}` },
    h('span', { className: 'q-bars', 'aria-hidden': true }, h('i'), h('i'), h('i')), RATING_LABEL[rating] || rating)
}

function Range52({ low, high, price }) {
  const pos = rangePosition(low, high, price)
  if (pos == null) return h('span', { className: 'q-ter' }, '—')
  return h('span', { style: { display: 'block', width: '100%' } },
    h('span', { className: 'q-b52', style: { display: 'block' }, role: 'img',
      'aria-label': `السعر عند ${Math.round(pos)} بالمئة من نطاق 52 أسبوعًا` },
    h('span', { className: 'fl', style: { width: `${pos}%` } }),
    h('span', { className: 'dt', style: { left: `${pos}%` } })),
    h('span', { className: 'q-b52n num' }, h('span', null, fmtPrice(low)), h('span', null, fmtPrice(high))))
}

function StaleChip() {
  return h('span', { className: 'q-chip q-chip-warn', title: 'هذا السعر أقدم من آخر جلسة، فلا يدخل في حساب اليوم' }, 'سعر قديم')
}

/** Price + its date, or the stale chip (the stale session date sits in the day-change cell). */
function PriceCell({ price, asOf, stale, kind }) {
  if (price == null) return h('span', { className: 'q-ter' }, 'بانتظار السعر')
  return h('span', { className: 'q-cell' },
    h('b', { className: 'num', style: { fontWeight: 500 } }, fmtPrice(price)),
    h('small', null, stale ? h(StaleChip) : kind === 'delayed' ? ['متأخر ', N(fmtTime(asOf))] : N(fmtDayMonth(asOf))))
}

/** The ؟ toggle with the protection definition (open by default where protection is shown large). */
function ProtectionHelp({ open, onToggle }) {
  return h('button', { type: 'button', className: 'q-help', 'aria-label': 'ما هو سعر الحماية؟', 'aria-expanded': open, onClick: onToggle }, '؟')
}

function ProtectionNote() {
  return h('div', { className: 'q-note', role: 'note' },
    'سعر الحماية = ', N('80%'), ' من السعر العادل. لو السعر نزل تحته، المحلل بيراجع التقييم تلقائيًا. ده تنبيه للمراجعة، مش أمر بيع. ',
    'مرجع الدخول = السعر العادل نفسه، وليس توصية بالشراء.')
}

const PORTFOLIO_GLYPH = (size = 10) => h('svg', { width: size, height: size, viewBox: '0 0 12 12', 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 },
  h('rect', { x: 1.5, y: 3.5, width: 9, height: 6, rx: 1.5 }), h('path', { d: 'M4 3.5V2.5h4v1' }))

function MineChip({ long = false }) {
  return h('span', { className: 'q-chip', title: 'في محفظتك' }, PORTFOLIO_GLYPH(10), long ? 'في محفظتك' : 'محفظتي')
}

function Skeleton({ width = 80 }) {
  return h('span', { className: 'q-skel', style: { width } })
}

/** Free text with every number (and its sign / %) isolated in its own `.num` span. */
function NumText({ text }) {
  const s = String(text == null ? '' : text)
  const parts = s.split(/([+−-]?\d[\d,]*(?:\.\d+)?%?(?:\/\d+(?:\/\d+)?)?)/)
  return h(React.Fragment, null, parts.map((p, i) => (i % 2 ? h('span', { key: i, className: 'num' }, p.replace(/^-/, MINUS)) : p)))
}
