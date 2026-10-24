// «ديون وأقساط» on the ledger screen: the add line for a debt, its row (what is left, the next
// installment, the payments) and the line that pays it from an asset. What is left and the next
// due day come from Python (store/debts.py); a payment is a movement of kind repay. ES module.
import { N, React, api, frag, h, useEffect, useState } from '../../shared/runtime.js'
import { fmtDate, fmtNumber, parseDayInput, parseNumberInput, resolveDay } from '../../shared/format.mjs'
import { DateField } from '../../shared/form.js'
import { Logo } from '../../shared/logo.js'
import { Chevron } from '../../shared/components.js'
import { Collapse, canMove, land } from '../../shared/motion.js'
import { MASK, usePrivacy } from '../../shared/privacy.js'
import { amount } from './moves.js'
import { money } from './units.mjs'

export const DEBT_KIND = 'debt'

const field = (label, input) => h('label', { className: 'q-stack' }, h('span', { className: 'q-label' }, label), input)
const text = (value, set, extra = {}) => h('input', { className: 'q-input', value, onChange: (e) => set(e.target.value), ...extra })

/** A datalist of the places the ledger already knows, so a place is typed the same way twice. */
export function PlaceList({ id, places }) {
  return h('datalist', { id }, (places || []).map((p) => h('option', { key: p, value: p })))
}

/** The add line's fields for a debt and the request they make (`build()` is `{ error }` or `{ body }`). */
export function useDebtForm() {
  const [name, setName] = useState('')
  const [principal, setPrincipal] = useState('')
  const [start, setStart] = useState('')
  const [installment, setInstallment] = useState('')
  const [dueDay, setDueDay] = useState('')
  const [received, setReceived] = useState(false)
  const [place, setPlace] = useState('')
  const [note, setNote] = useState('')
  const fields = h('div', { className: 'l-fields' },
    field('اسمه (لمين أو إيه هو)', text(name, setName, { maxLength: 80 })),
    field('المبلغ اللي عليك (ج.م)', text(principal, setPrincipal, { inputMode: 'decimal', className: 'q-input num' })),
    field('من تاريخ (اختياري)', text(start, setStart, { placeholder: 'يوم/شهر/سنة', inputMode: 'numeric' })),
    field('القسط الشهري (اختياري)', text(installment, setInstallment, { inputMode: 'decimal', className: 'q-input num' })),
    field('يوم القسط في الشهر (اختياري)', text(dueDay, setDueDay, { inputMode: 'numeric', className: 'q-input num', placeholder: '1 لـ 28' })),
    field('ملاحظة (اختياري)', text(note, setNote, { maxLength: 200 })),
    h('label', { className: 'l-inline q-sec' },
      h('input', { type: 'checkbox', checked: received, onChange: (e) => setReceived(e.target.checked) }),
      'الفلوس دي دخلت عندي بالجنيه (سجّلها دخل)'),
    received ? field('في مكان (اختياري)', text(place, setPlace, { maxLength: 40, list: 'l-places' })) : null)

  function build() {
    const p = parseNumberInput(principal), i = parseNumberInput(installment), d = parseDayInput(start)
    const day = dueDay.trim() ? Number(parseNumberInput(dueDay)) : null
    if (!name.trim()) return { error: 'اكتب اسم الدين.' }
    if (!(p > 0)) return { error: 'اكتب المبلغ اللي عليك.' }
    if (d === undefined) return { error: 'اكتب التاريخ بصيغة يوم/شهر/سنة، أو سيبه فاضي.' }
    if (installment.trim() && !(i > 0)) return { error: 'القسط لازم يكون أكبر من صفر.' }
    if (day !== null && !(Number.isInteger(day) && day >= 1 && day <= 28)) return { error: 'يوم القسط من 1 لـ 28.' }
    return {
      body: { name: name.trim(), principal: p, start_date: d, installment_egp: i > 0 ? i : null, due_day: day,
        note: note.trim() || null, received_into_egp: received, place: received ? place.trim() || null : null },
    }
  }
  return { fields, build }
}

/** Pay a debt from an asset: what left it, what the debt went down by (the same when it is pounds). */
export function RepayForm({ debt, assets, onDone, onCancel }) {
  const payable = assets.filter((a) => a.quantity > 0 && a.kind !== 'deposit')
  const [from, setFrom] = useState(payable.find((a) => a.key === 'EGP') ? 'EGP' : (payable[0] && payable[0].key) || '')
  const [taken, setTaken] = useState(debt.installment_egp ? String(debt.installment_egp) : '')
  const [down, setDown] = useState('')
  const [day, setDay] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const source = payable.find((a) => a.key === from)
  async function submit(e) {
    e.preventDefault()
    setError('')
    const t = parseNumberInput(taken), dn = parseNumberInput(down), d = resolveDay(day)
    if (!source) return setError('مفيش أصل تسدّد منه.')
    if (!(t > 0)) return setError('اكتب المبلغ اللي دفعته.')
    if (from !== 'EGP' && !(dn > 0)) return setError('اكتب الدين قل قد إيه بالجنيه.')
    if (d === undefined) return setError('اكتب التاريخ بصيغة يوم/شهر/سنة، أو سيبه فاضي.')
    setBusy(true)
    try {
      await api('POST', '/egx/api/movements', { kind: 'repay', from_asset: from, from_quantity: t, to_asset: debt.key,
        to_quantity: dn > 0 ? dn : null, date: d, note: note.trim() || null })
      onDone()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return h('form', { className: 'l-add l-move', onSubmit: submit, noValidate: true, 'aria-label': 'سداد',
      onKeyDown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } } },
    h('b', null, `سداد «${debt.name}»`),
    h('div', { className: 'l-fields' },
      field('من', h('select', { className: 'q-input', value: from, onChange: (e) => setFrom(e.target.value) },
        payable.map((a) => h('option', { key: a.key, value: a.key }, a.name)))),
      field(`دفعت كام (${source && source.key !== 'EGP' ? source.unit : 'ج.م'})`, text(taken, setTaken, { inputMode: 'decimal', className: 'q-input num', 'aria-label': 'المبلغ اللي دفعته' })),
      field(from === 'EGP' ? 'الدين قل كام (اختياري: نفس المبلغ)' : 'الدين قل كام (ج.م)', text(down, setDown, { inputMode: 'decimal', className: 'q-input num' })),
      h(DateField, { value: day, onChange: setDay, noDate: false }),
      field('ملاحظة (اختياري)', text(note, setNote, { maxLength: 200 }))),
    h('div', { className: 'l-actions' },
      h('button', { type: 'submit', className: 'q-btn q-btn-p', disabled: busy }, busy ? 'جارٍ التسجيل…' : 'سجّل السداد'),
      h('button', { type: 'button', className: 'q-btn q-btn-quiet', onClick: onCancel }, 'إلغاء'),
      error ? h('span', { className: 'q-error', role: 'alert' }, error) : null))
}

function DebtEdit({ debt, onDone, onCancel }) {
  const [name, setName] = useState(debt.name)
  const [principal, setPrincipal] = useState(String(debt.principal))
  const [installment, setInstallment] = useState(debt.installment_egp ? String(debt.installment_egp) : '')
  const [dueDay, setDueDay] = useState(debt.due_day ? String(debt.due_day) : '')
  const [error, setError] = useState('')
  const save = async () => {
    const p = parseNumberInput(principal), i = parseNumberInput(installment)
    const day = dueDay.trim() ? Number(parseNumberInput(dueDay)) : null
    if (!(p > 0)) return setError('المبلغ لازم يكون أكبر من صفر')
    try {
      await api('PATCH', `/egx/api/debts/${debt.id}`, { name, principal: p, installment_egp: i > 0 ? i : null, due_day: day })
      onDone()
    } catch (err) { setError(err.message) }
    return undefined
  }
  return h('div', { className: 'l-lot' },
    field('الاسم', text(name, setName, { maxLength: 80, style: { width: 160 } })),
    field('المبلغ', text(principal, setPrincipal, { inputMode: 'decimal', className: 'q-input num', style: { width: 110 } })),
    field('القسط', text(installment, setInstallment, { inputMode: 'decimal', className: 'q-input num', style: { width: 100 } })),
    field('يومه', text(dueDay, setDueDay, { inputMode: 'numeric', className: 'q-input num', style: { width: 60 } })),
    h('span', { className: 'l-lot-actions' },
      h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-p', onClick: save }, 'حفظ'),
      h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-quiet', onClick: onCancel }, 'إلغاء')),
    error ? h('span', { className: 'q-error', role: 'alert' }, error) : null)
}

export function DebtRow({ debt, assets, focused, onChanged, onOpen }) {
  const hidden = usePrivacy()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState(null)
  const [error, setError] = useState('')
  const rowRef = React.useRef(null)
  useEffect(() => {
    if (!focused) return
    setOpen(true)
    rowRef.current?.scrollIntoView?.({ block: 'nearest', behavior: canMove() ? 'smooth' : 'auto' })
    land(rowRef.current)
  }, [focused])
  const done = () => { setMode(null); onChanged() }
  const remove = async () => {
    try { await api('DELETE', `/egx/api/debts/${debt.id}`, {}); onChanged() } catch (e) { setError(e.message) }
  }
  const removePayment = async (id) => {
    try { await api('DELETE', `/egx/api/movements/${id}`, {}); onChanged() } catch (e) { setError(e.message) }
  }
  const byKey = Object.fromEntries(assets.map((a) => [a.key, a]))
  return h(React.Fragment, null,
    h('button', { type: 'button', ref: rowRef, className: 'l-row', 'aria-expanded': open, onClick: () => setOpen(!open) },
      h(Logo, { mark: 'دين' }),
      h('span', { className: 'q-stack' },
        h('span', { className: 'l-name' }, debt.name),
        h('span', { className: 'l-sub' },
          debt.settled ? h('span', null, 'اتسدّد') : null,
          debt.installment_egp ? h('span', null, 'قسط ', hidden ? N(MASK) : N(money(debt.installment_egp))) : null,
          debt.next_due_date ? h('span', null, 'الجاي ', N(fmtDate(debt.next_due_date))) : null)),
      h('span', { className: 'l-value' },
        hidden ? N(MASK) : N(money(debt.remaining_egp)),
        h('span', { className: 'l-growth q-sec' }, 'باقي من ', hidden ? N(MASK) : N(money(debt.principal)))),
      h(Chevron)),
    h(Collapse, { open }, h('div', { className: 'l-detail' },
      h('div', null,
        h('h3', null, debt.payments.length ? `السدادات (${debt.payments.length})` : 'لسه مفيش سدادات'),
        debt.payments.map((p) => {
          const source = byKey[p.from_asset]
          return h('div', { key: p.movement, className: 'l-lot' },
            h('span', null, '−', hidden ? N(MASK) : N(fmtNumber(p.paid_egp, 0)), ' ج.م من الدين'),
            h('span', { className: 'q-sec' }, 'دفعت ', amount(p.from_quantity, p.from_asset, source ? source.unit : '', hidden), ' من ',
              h('button', { type: 'button', className: 'q-link', onClick: () => onOpen(p.from_asset) }, source ? source.name : p.from_asset)),
            h('span', { className: 'q-sec' }, N(fmtDate(p.date))),
            p.note ? h('span', { className: 'q-sec' }, p.note) : null,
            h('span', { className: 'l-lot-actions' },
              h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-quiet q-btn-danger', onClick: () => removePayment(p.movement) }, 'حذف')))
        })),
      h('p', { className: 'l-hint' }, 'من ', N(fmtDate(debt.start_date)), ' · دفعت ', hidden ? N(MASK) : N(money(debt.paid_egp)), ' ج.م',
        debt.note ? frag(' · ', debt.note) : null),
      mode === 'repay' ? h(RepayForm, { debt, assets, onDone: done, onCancel: () => setMode(null) })
        : mode === 'edit' ? h(DebtEdit, { debt, onDone: done, onCancel: () => setMode(null) })
          : h('div', { className: 'l-inline' },
            debt.settled ? null : h('button', { type: 'button', className: 'q-btn q-btn-sm', onClick: () => setMode('repay') }, 'سدّد'),
            h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-quiet', onClick: () => setMode('edit') }, 'تعديل'),
            h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-quiet q-btn-danger', onClick: remove }, 'حذف الدين')),
      error ? h('span', { className: 'q-error', role: 'alert' }, error) : null)))
}
