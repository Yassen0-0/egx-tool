// Valuation building blocks shared by Market, Analyses and Portfolio (ES module).
import { N, React, h } from './runtime.js'
import { MINUS, RATING_LABEL, RATING_LEVEL, belowProtectionBy, fmtDayMonth, fmtPct, fmtPrice, fmtTime, marginSentence, rangePosition, rulerScale } from './format.mjs'

/** Valuation ruler: bear–bull band, protection tick (amber), fair tick (blue), price dot. */
export function Ruler({ fair, bear, bull, price, large = false }) {
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
export function StatusMark({ status, size = 10 }) {
  const common = { width: size, height: size, viewBox: '0 0 10 10', 'aria-hidden': true, style: { flex: 'none' } }
  if (status === 'under') return h('svg', common, h('path', { d: 'M5 1 9 5 5 9 1 5Z', fill: 'currentColor', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round' }))
  return h('svg', common, h('circle', { cx: 5, cy: 5, r: 3.3, fill: status === 'above' ? 'currentColor' : 'none', stroke: 'currentColor', strokeWidth: 1.4 }))
}

export const STATUS_TIP = {
  under: 'السعر أقل من سعر الحماية (80% من العادل): المحلل يراجع التقييم. تنبيه للمراجعة، مش أمر بيع.',
  between: 'السعر بين سعر الحماية والسعر العادل.',
  above: 'السعر أعلى من السعر العادل أو يساويه.',
}

/** «أقل من العادل بـ 6.9%» with its mark; the number is its own span and ends the sentence. */
export function MarginText({ price, fair, prefix = '', suffix = null, size }) {
  const m = marginSentence(price, fair)
  if (!m) return null
  return h('span', { className: `q-status${m.status === 'under' ? ' under' : ''}`, title: STATUS_TIP[m.status], style: size ? { fontSize: size } : undefined },
    h(StatusMark, { status: m.status, size: size ? Math.round(size * 0.85) : 10 }),
    prefix, m.text, m.value ? ' ' : null, m.value ? N(m.value) : null, suffix)
}

export function RatingChip({ rating }) {
  if (!rating) return h('span', { className: 'q-ter', 'aria-label': 'بدون تصنيف' }, '—')
  return h('span', { className: `q-rating q-r${RATING_LEVEL[rating] || 0}` },
    h('span', { className: 'q-bars', 'aria-hidden': true }, h('i'), h('i'), h('i')), RATING_LABEL[rating] || rating)
}

export function Range52({ low, high, price }) {
  const pos = rangePosition(low, high, price)
  if (pos == null) return h('span', { className: 'q-ter' }, '—')
  return h('span', { style: { display: 'block', width: '100%' } },
    h('span', { className: 'q-b52', style: { display: 'block' }, role: 'img',
      'aria-label': `السعر عند ${Math.round(pos)} بالمئة من نطاق 52 أسبوعًا` },
    h('span', { className: 'fl', style: { width: `${pos}%` } }),
    h('span', { className: 'dt', style: { left: `${pos}%` } })),
    h('span', { className: 'q-b52n num' }, h('span', null, fmtPrice(low)), h('span', null, fmtPrice(high))))
}

export function StaleChip() {
  return h('span', { className: 'q-chip q-chip-warn', title: 'هذا السعر أقدم من آخر جلسة، فلا يدخل في حساب اليوم' }, 'سعر قديم')
}

/** Price + its date, or the stale chip (the stale session date sits in the day-change cell). */
export function PriceCell({ price, asOf, stale, kind }) {
  if (price == null) return h('span', { className: 'q-ter' }, 'بانتظار السعر')
  return h('span', { className: 'q-cell' },
    h('b', { className: 'num', style: { fontWeight: 500 } }, fmtPrice(price)),
    h('small', null, stale ? h(StaleChip) : kind === 'delayed' ? ['متأخر ', N(fmtTime(asOf))] : N(fmtDayMonth(asOf))))
}

/** The ؟ toggle with the protection definition (open by default where protection is shown large). */
export function ProtectionHelp({ open, onToggle }) {
  return h('button', { type: 'button', className: 'q-help', 'aria-label': 'ما هو سعر الحماية؟', 'aria-expanded': open, onClick: onToggle }, '؟')
}

export function ProtectionNote() {
  return h('div', { className: 'q-note', role: 'note' },
    'سعر الحماية = ', N('80%'), ' من السعر العادل. لو السعر نزل تحته، المحلل بيراجع التقييم تلقائيًا. ده تنبيه للمراجعة، مش أمر بيع. ',
    'مرجع الدخول = السعر العادل نفسه، وليس توصية بالشراء.')
}

export const PORTFOLIO_GLYPH = (size = 10) => h('svg', { width: size, height: size, viewBox: '0 0 12 12', 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 },
  h('rect', { x: 1.5, y: 3.5, width: 9, height: 6, rx: 1.5 }), h('path', { d: 'M4 3.5V2.5h4v1' }))

export function MineChip({ long = false }) {
  return h('span', { className: 'q-chip', title: 'في محفظتك' }, PORTFOLIO_GLYPH(10), long ? 'في محفظتك' : 'محفظتي')
}

export function Skeleton({ width = 80 }) {
  return h('span', { className: 'q-skel', style: { width } })
}

/** Free text with every number (and its sign / %) isolated in its own `.num` span. */
export function NumText({ text }) {
  const s = String(text == null ? '' : text)
  const parts = s.split(/([+−-]?\d[\d,]*(?:\.\d+)?%?(?:\/\d+(?:\/\d+)?)?)/)
  return h(React.Fragment, null, parts.map((p, i) => (i % 2 ? h('span', { key: i, className: 'num' }, p.replace(/^-/, MINUS)) : p)))
}

/**
 * The most important state: price under protection. Price vs protection, the gap, the critic's two
 * possibilities (neither is a call to act), a link to the critic notes and the definition.
 */
export function UnderProtectionCard({ price, fair, protection, asOf, onCritic }) {
  const gap = belowProtectionBy(fair, price)
  const box = (n, title, text) => h('div', { className: 'q-card q-pad', style: { flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 4 } },
    h('b', null, N(n), ' · ', title), h('span', { className: 'q-sec', style: { fontSize: 13, lineHeight: 1.7 } }, text))
  return h('section', { className: 'q-note', role: 'note', 'aria-label': 'تحت سعر الحماية', style: { display: 'flex', flexDirection: 'column', gap: 12 } },
    h('div', null,
      h('b', { className: 'q-amber', style: { display: 'flex', alignItems: 'center', gap: 6 } }, h(StatusMark, { status: 'under', size: 12 }), 'تحت سعر الحماية — يحتاج مراجعة'),
      h('span', null, 'آخر إغلاق', asOf ? [' ', N(fmtDayMonth(asOf))] : null, ' عند ', N(fmtPrice(price)), ' أقل من سعر الحماية ', N(fmtPrice(protection)),
        ' بنسبة ', N(fmtPct(gap)), ' تقريبًا، فالمحلل يراجع التقييم تلقائيًا.')),
    h('div', null, h('b', null, 'رأي الناقد: احتمالان')),
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 12 } },
      box('1', 'التقييم فاته شيء', ['عامل لم يدخل النموذج (نتائج، دين، تغيّر في القطاع) يجعل العادل الصحيح أقل من ', N(fmtPrice(fair)), ' جنيه.']),
      box('2', 'السوق متشائم أكثر من اللازم', 'السعر يعكس مخاوف لا تدعمها المعطيات الحالية، فيبقى العادل صحيحًا والسعر دونه.')),
    h('div', { className: 'q-row' },
      onCritic ? h('button', { type: 'button', className: 'q-link', style: { padding: 0 }, onClick: onCritic }, 'عرض ملاحظات الناقد ←') : null,
      h('span', { className: 'q-meta' }, 'لا نعرف أيهما بعد، والمراجعة هي التي تحدد.')),
    h('span', { className: 'q-meta' }, 'سعر الحماية = ', N('80%'), ' من السعر العادل. ده تنبيه للمراجعة، مش أمر بيع.'))
}
