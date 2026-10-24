// Phase 5 on the ledger screen: what a certificate paid into the pounds, a stock's dividends, its
// bonus shares and splits, and «الجاي قريب» (payouts, maturities, installments in the coming weeks).
// Every amount and date comes from Python (store/deposits.py, store/portfolio.py). ES module.
import { N, api, frag, h, useState } from '../../shared/runtime.js'
import { fmtDate, fmtQty, parseDayInput, parseNumberInput } from '../../shared/format.mjs'
import { MASK, usePrivacy } from '../../shared/privacy.js'
import { money } from './units.mjs'

const field = (label, input) => h('label', { className: 'q-stack' }, h('span', { className: 'q-label' }, label), input)
const text = (value, set, extra = {}) => h('input', { className: 'q-input', value, onChange: (e) => set(e.target.value), ...extra })

/** A payout or a principal a certificate paid into the pounds: worked out from its terms, never typed. */
export function PaidItem({ event, onOpen }) {
  const hidden = usePrivacy()
  return h('div', { className: 'l-lot l-move-item' },
    h('span', null, '+', hidden ? N(MASK) : N(money(event.quantity)), ' ج.م ',
      h('button', { type: 'button', className: 'q-link', onClick: () => onOpen(event.origin) }, event.note)),
    h('span', { className: 'q-sec' }, N(fmtDate(event.date))),
    h('span', { className: 'q-sec' }, 'الرصيد بعدها ', hidden ? N(MASK) : N(money(event.balance)), ' ج.م'))
}

/** Bonus shares or a split in a stock's timeline. */
export function ActionItem({ event, asset, onChanged }) {
  const hidden = usePrivacy()
  const [error, setError] = useState('')
  const remove = async () => {
    try { await api('DELETE', `/egx/api/actions/${event.id}`, {}); onChanged() } catch (e) { setError(e.message) }
  }
  return h('div', { className: 'l-lot l-move-item' },
    h('span', null, '+', hidden ? N(MASK) : N(fmtQty(event.quantity)), ' ', asset.unit,
      event.kind === 'bonus' ? ' أسهم مجانية' : frag(' تقسيم (كل سهم بقى ', N(fmtQty(event.ratio)), ')')),
    h('span', { className: 'q-sec' }, N(fmtDate(event.date))),
    h('span', { className: 'q-sec' }, 'الرصيد بعدها ', hidden ? N(MASK) : N(fmtQty(event.balance))),
    event.note ? h('span', { className: 'q-sec' }, event.note) : null,
    h('span', { className: 'l-lot-actions' },
      h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-quiet q-btn-danger', onClick: remove }, 'حذف')),
    error ? h('span', { className: 'q-error', role: 'alert' }, error) : null)
}

/** A stock's or fund's cash dividend, or its bonus shares or split. `kind` is dividend, bonus or split. */
export function StockEventForm({ asset, kind, onDone, onCancel }) {
  const [value, setValue] = useState('')
  const [day, setDay] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const label = { dividend: 'المبلغ اللي دخلك (ج.م)', bonus: `عدد الأسهم المجانية (${asset.unit})`, split: 'كل سهم بقى كام سهم' }[kind]
  async function submit(e) {
    e.preventDefault()
    setError('')
    const v = parseNumberInput(value), d = parseDayInput(day)
    if (!(v > 0)) return setError('اكتب الرقم.')
    if (d === undefined) return setError('اكتب التاريخ بصيغة يوم/شهر/سنة، أو سيبه فاضي.')
    setBusy(true)
    try {
      if (kind === 'dividend') await api('POST', '/egx/api/dividends', { asset: asset.key, amount_egp: v, date: d, note: note.trim() || null })
      else await api('POST', '/egx/api/actions', { asset: asset.key, kind, date: d, note: note.trim() || null, [kind === 'bonus' ? 'quantity' : 'ratio']: v })
      onDone()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return h('form', { className: 'l-add l-move', onSubmit: submit, noValidate: true, 'aria-label': kind === 'dividend' ? 'توزيعات' : 'أسهم مجانية أو تقسيم' },
    h('b', null, kind === 'dividend' ? `توزيعات ${asset.name}` : kind === 'bonus' ? `أسهم مجانية من ${asset.name}` : `تقسيم ${asset.name}`),
    h('div', { className: 'l-fields' },
      field(label, text(value, setValue, { inputMode: 'decimal', className: 'q-input num', 'aria-label': label })),
      field('التاريخ (اختياري)', text(day, setDay, { placeholder: 'يوم/شهر/سنة', inputMode: 'numeric' })),
      field('ملاحظة (اختياري)', text(note, setNote, { maxLength: 200 }))),
    h('div', { className: 'l-actions' },
      h('button', { type: 'submit', className: 'q-btn q-btn-p', disabled: busy }, busy ? 'جارٍ التسجيل…' : 'سجّل'),
      h('button', { type: 'button', className: 'q-btn q-btn-quiet', onClick: onCancel }, 'إلغاء'),
      error ? h('span', { className: 'q-error', role: 'alert' }, error) : null))
}

/** «الجاي قريب»: certificate payouts and maturities and debt installments in the coming weeks. */
export function Upcoming({ items, onOpen }) {
  const hidden = usePrivacy()
  if (!items || !items.length) return null
  return h('section', { className: 'l-upcoming', 'aria-label': 'الجاي قريب' },
    h('h2', null, 'الجاي قريب'),
    items.map((u) => h('div', { key: `${u.kind}:${u.key}:${u.date}`, className: 'l-lot' },
      h('span', { className: 'q-sec' }, N(fmtDate(u.date))),
      h('button', { type: 'button', className: 'q-link', onClick: () => onOpen(u.key) }, u.label),
      u.amount_egp != null ? h('span', null, hidden ? N(MASK) : N(money(u.amount_egp)), ' ج.م') : null)))
}
