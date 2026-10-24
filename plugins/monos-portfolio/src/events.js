// Phase 5 on the ledger screen: what a certificate paid into the pounds, a stock's dividends, its
// bonus shares and splits, and «الجاي قريب» (payouts, maturities, installments in the coming weeks).
// Every amount and date comes from Python (store/deposits.py, store/portfolio.py). ES module.
import { N, api, frag, h, useState } from '../../shared/runtime.js'
import { fmtDate, fmtQty, parseNumberInput, resolveDay } from '../../shared/format.mjs'
import { DateField, EntryCard, More, PlaceField, Question, Summary } from '../../shared/form.js'
import { MASK, usePrivacy } from '../../shared/privacy.js'
import { deleteWithUndo, usePending } from '../../shared/undo.js'
import { money } from './units.mjs'


/** A payout or a principal a certificate paid into the pounds: worked out from its terms, never typed. */
export function PaidItem({ event, onOpen }) {
  const hidden = usePrivacy()
  return h('div', { className: 'l-lot l-move-item', 'data-kind': 'paid' },
    h('span', null, '+', hidden ? N(MASK) : N(money(event.quantity)), ' ج.م ',
      h('button', { type: 'button', className: 'q-link', onClick: () => onOpen(event.origin) }, event.note)),
    h('span', { className: 'q-sec' }, N(fmtDate(event.date))),
    h('span', { className: 'q-sec' }, 'الرصيد بعدها ', hidden ? N(MASK) : N(money(event.balance)), ' ج.م'))
}

/** Bonus shares or a split in a stock's timeline. */
export function ActionItem({ event, asset, onChanged }) {
  const hidden = usePrivacy()
  const gone = usePending(`action:${event.id}`)
  const remove = () => deleteWithUndo(`action:${event.id}`, event.kind === 'bonus' ? 'اتشالت الأسهم المجانية' : 'اتشال التقسيم',
    async () => { await api('DELETE', `/egx/api/actions/${event.id}`, {}); onChanged() })
  if (gone) return null
  return h('div', { className: 'l-lot l-move-item', 'data-kind': event.kind },
    h('span', null, '+', hidden ? N(MASK) : N(fmtQty(event.quantity)), ' ', asset.unit,
      event.kind === 'bonus' ? ' أسهم مجانية' : frag(' تقسيم (كل سهم بقى ', N(fmtQty(event.ratio)), ')')),
    h('span', { className: 'q-sec' }, N(fmtDate(event.date))),
    h('span', { className: 'q-sec' }, 'الرصيد بعدها ', hidden ? N(MASK) : N(fmtQty(event.balance))),
    event.note ? h('span', { className: 'q-sec' }, event.note) : null,
    h('span', { className: 'l-lot-actions' },
      h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-quiet q-btn-danger', onClick: remove }, 'حذف')))
}

/** A stock's or fund's cash dividend, or its bonus shares or split. `kind` is dividend, bonus or split. */
export function StockEventForm({ asset, kind, places, onDone, onCancel }) {
  const [value, setValue] = useState('')
  const [day, setDay] = useState('')
  const [note, setNote] = useState('')
  const [place, setPlace] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [bad, setBad] = useState(null)
  const fail = (message, field = null) => { setError(message); setBad(field) }
  const words = {
    dividend: { q: 'قبضت كام؟', unit: 'ج.م', empty: 'اكتب قبضت كام.', title: `قبضت توزيعات ${asset.name}`, button: 'سجّل التوزيعات' },
    bonus: { q: 'جالك كام سهم مجاني؟', unit: asset.unit, empty: 'اكتب جالك كام سهم.', title: `أسهم مجانية من ${asset.name}`, button: 'سجّل الأسهم المجانية' },
    split: { q: 'كل سهم بقى كام سهم؟', unit: 'سهم', empty: 'اكتب كل سهم بقى كام، زي 2.', title: `تقسيم ${asset.name}`, button: 'سجّل التقسيم' },
  }[kind]
  const v = parseNumberInput(value), d = resolveDay(day)
  async function submit(e) {
    e.preventDefault()
    fail('')
    if (!(v > 0)) return fail(words.empty, 'value')
    if (d === undefined) return fail('التاريخ ده مش مظبوط: اكتبه يوم/شهر/سنة، زي 15/3/2025.', 'date')
    setBusy(true)
    try {
      if (kind === 'dividend') await api('POST', '/egx/api/dividends', { asset: asset.key, amount_egp: v, date: d, note: note.trim() || null, place: place.trim() || null })
      else await api('POST', '/egx/api/actions', { asset: asset.key, kind, date: d, note: note.trim() || null, [kind === 'bonus' ? 'quantity' : 'ratio']: v })
      onDone()
    } catch (err) { fail(err.message, err.field || null) } finally { setBusy(false) }
  }
  const errOf = (f) => (bad === f ? error : null)
  const chips = kind === 'split' ? ['2', '3', '5'].map((n) => h('button', { key: n, type: 'button', className: 'q-chip', 'aria-pressed': value === n,
    onClick: () => setValue(n) }, n)) : null
  const say = v > 0 ? (kind === 'dividend'
    ? frag(h('b', null, N(money(v)), ' ج.م'), ` توزيعات من ${asset.name}`, place.trim() ? `، دخلت ${place.trim()}` : '، دخلت الجنيه', '.')
    : kind === 'bonus' ? frag(h('b', null, N(fmtQty(v)), ' ', asset.unit), ` مجانية من ${asset.name}، بنفس التكلفة.`)
      : frag(`كل سهم من ${asset.name} بقى `, h('b', null, N(fmtQty(v))), ' سهم، بنفس التكلفة.')) : null
  return h(EntryCard, { className: 'l-add l-move', ariaLabel: kind === 'dividend' ? 'توزيعات' : 'أسهم مجانية أو تقسيم', title: words.title,
    onSubmit: submit, onCancel, busy, alert: error && !bad ? error : null, submitLabel: words.button,
    summary: h(Summary, { empty: 'اكتب الرقم، وهتشوف هنا اللي هيتسجّل' }, say) },
  h(Question, { hero: true, name: 'value', value, onChange: setValue, label: words.q, unit: words.unit, 'aria-label': words.q, autoFocus: true,
    chips, error: errOf('value') }),
  h('div', { className: 'l-entry-grid' },
    kind === 'dividend' ? h(PlaceField, { label: 'نزلت فين؟', value: place, onChange: setPlace, places }) : null,
    h(DateField, { value: day, onChange: setDay, noDate: false, error: errOf('date') })),
  h(More, { label: 'تفاصيل أكتر · ملاحظة' },
    h(Question, { numeric: false, name: 'note', value: note, onChange: setNote, label: 'ملاحظة', maxLength: 200, wide: true })))
}

/** «الجاي قريب»: certificate payouts and maturities and debt installments in the coming weeks. */
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
const SHOWN = 4

/** «بعد 12 يوم» from Python's in_days. */
const inDays = (n) => (n == null ? null : n <= 0 ? 'النهارده' : n === 1 ? 'بكرة' : `بعد ${n} يوم`)

export function Upcoming({ items, onOpen }) {
  const hidden = usePrivacy()
  const [all, setAll] = useState(false)
  if (!items || !items.length) return null
  const shown = all ? items : items.slice(0, SHOWN)
  return h('section', { className: 'l-upcoming', 'aria-label': 'الجاي قريب' },
    h('h2', null, 'الجاي قريب'),
    shown.map((u) => h('button', { key: `${u.kind}:${u.key}:${u.date}`, type: 'button', className: 'l-due', onClick: () => onOpen(u.key),
      title: fmtDate(u.date) },
      h('span', { className: 'l-due-tile', 'aria-hidden': true }, N(String(Number(u.date.slice(8, 10)))), h('small', null, MONTHS[Number(u.date.slice(5, 7)) - 1])),
      h('span', { className: 'l-due-label' }, u.label),
      u.amount_egp != null ? h('span', { className: 'l-due-amount' }, hidden ? N(MASK) : N(money(u.amount_egp)), ' ج.م') : null,
      h('span', { className: 'l-due-when' }, inDays(u.in_days)))),
    items.length > SHOWN ? h('button', { type: 'button', className: 'q-link', onClick: () => setAll(!all) },
      all ? 'أقل' : frag('كمان ', N(String(items.length - SHOWN)))) : null)
}
