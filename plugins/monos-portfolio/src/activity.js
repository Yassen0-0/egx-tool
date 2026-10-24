// «الحركات» view of the ledger screen (docs/الحركات.md): everything that moved, newest first, for a
// month and a kind, with what the month adds up to. Python builds the list and the totals
// (/egx/api/activity → store/activity.py); this only shows them. An asset's name opens its row. ES module.
import { N, api, frag, h, useEffect, useState } from '../../shared/runtime.js'
import { fmtDate, fmtSigned, toneOf } from '../../shared/format.mjs'
import { Skeleton } from '../../shared/components.js'
import { MASK, usePrivacy } from '../../shared/privacy.js'
import { amount } from './moves.js'
import { money } from './units.mjs'

const KIND_CHOICES = [['', 'الكل'], ['income', 'دخل'], ['transfer', 'تحويل'], ['expense', 'خروج'], ['repay', 'سداد']]
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

/** «أكتوبر 2026» for 2026-10. */
export const monthName = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`

/** The items grouped by day, newest first (Python sorted them). */
function byDay(items) {
  const days = []
  for (const i of items) {
    const last = days[days.length - 1]
    if (last && last.date === i.date) last.items.push(i)
    else days.push({ date: i.date, items: [i] })
  }
  return days
}

export function ActivityView({ onOpen, onCompose }) {
  const hidden = usePrivacy()
  const [month, setMonth] = useState('')
  const [kind, setKind] = useState('')
  const [data, setData] = useState(undefined)
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let live = true
    const query = new URLSearchParams({ month, kind }).toString()
    api('GET', `/egx/api/activity?${query}`).then((d) => { if (live) setData(d) }).catch(() => { if (live) setData(null) })
    return () => { live = false }
  }, [month, kind, tries])

  if (data === undefined) return h('div', { 'aria-busy': true, className: 'q-stack', style: { gap: 12 } }, h(Skeleton, { width: '100%', height: 14 }), h(Skeleton, { width: '80%', height: 14 }), h(Skeleton, { width: '60%', height: 14 }))
  if (data === null) {
    return h('div', { className: 'l-inline', role: 'alert' }, h('span', { className: 'q-error' }, 'تعذّر تحميل الحركات'),
      h('button', { type: 'button', className: 'q-btn q-btn-sm', onClick: () => { setData(undefined); setTries(tries + 1) } }, 'حاول مرة تانية'))
  }
  const t = data.totals
  const sum = (label, v, cls) => h('span', null, label, ' ', hidden ? N(MASK) : N(money(v), cls), ' ج.م')
  const link = (side) => h('button', { type: 'button', className: 'q-link', onClick: () => onOpen(side.key) }, side.name)
  return h('div', { className: 'l-activity' },
    h('div', { className: 'l-inline' },
      h('select', { className: 'q-input', style: { width: 160 }, value: month, 'aria-label': 'الشهر', onChange: (e) => setMonth(e.target.value) },
        h('option', { value: '' }, 'كل الشهور'), data.months.map((m) => h('option', { key: m, value: m }, monthName(m)))),
      h('div', { className: 'q-seg', role: 'radiogroup', 'aria-label': 'النوع' },
        KIND_CHOICES.map(([value, label]) => h('button', { key: value, type: 'button', role: 'radio', 'aria-checked': kind === value,
          tabIndex: kind === value ? 0 : -1, onClick: () => setKind(value) }, label)))),
    h('div', { className: 'l-line', role: 'status' },
      sum('دخل', t.income_egp), sum('خروج', t.expense_egp), sum('اتحوّل', t.transfer_egp),
      t.repay_egp ? sum('سداد', t.repay_egp) : null,
      Math.abs(t.realized_egp) >= 1 ? h('span', null, 'ربح محقق ', hidden ? N(MASK) : N(fmtSigned(t.realized_egp, 0), toneOf(t.realized_egp)), ' ج.م') : null),
    data.items.length
      ? byDay(data.items).map((d) => h('div', { key: d.date, className: 'l-day' },
        h('h3', { className: 'l-day-head' }, N(fmtDate(d.date))),
        d.items.map((i) => h('div', { key: i.id, className: 'l-lot l-act' },
        h('b', null, i.kind_label),
        i.kind === 'income'
          ? h('span', null, amount(i.to_quantity, i.to.key, i.to.unit, hidden), ' في ', link(i.to))
          : i.kind === 'expense' || i.kind === 'repay'
            ? h('span', null, amount(i.from_quantity, i.from.key, i.from.unit, hidden), ' من ', link(i.from), i.kind === 'repay' && i.to ? frag(' لـ ', link(i.to)) : null)
            : h('span', null, amount(i.from_quantity, i.from.key, i.from.unit, hidden), ' من ', link(i.from), ' ← ',
              amount(i.to_quantity, i.to.key, i.to.unit, hidden), ' في ', link(i.to)),
        i.value_egp != null && !(i.to && i.to.key === 'EGP' && i.kind === 'income')
          ? h('span', { className: 'q-sec' }, 'بقيمة ', hidden ? N(MASK) : N(money(i.value_egp)), ' ج.م') : null,
        i.realized_egp != null && Math.abs(i.realized_egp) >= 1
          ? h('span', { className: 'q-sec' }, 'ربح محقق ', hidden ? N(MASK) : N(fmtSigned(i.realized_egp, 0), toneOf(i.realized_egp))) : null,
        i.note ? h('span', { className: 'q-sec' }, i.note) : null))))
      : h('div', { className: 'l-empty' }, h('p', { className: 'l-hint' }, 'مفيش حركات في الفترة دي.'),
        onCompose ? h('span', { className: 'q-chips', style: { justifyContent: 'center' } },
          h('button', { type: 'button', className: 'q-chip', onClick: () => onCompose('expense') }, '+ سجّل خروج'),
          h('button', { type: 'button', className: 'q-chip', onClick: () => onCompose('transfer') }, '+ سجّل تحويل')) : null))
}
