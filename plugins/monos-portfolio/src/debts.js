// «ديون وأقساط» on the ledger screen: the add line for a debt, its row (what is left, the next
// installment, the payments) and the line that pays it from an asset. What is left and the next
// due day come from Python (store/debts.py); a payment is a movement of kind repay. ES module.
import { N, React, api, frag, h, useEffect, useState } from '../../shared/runtime.js'
import { fmtDate, fmtNumber, parseNumberInput, resolveDay } from '../../shared/format.mjs'
import { Choice, DateField, EntryCard, More, PlaceField, Question } from '../../shared/form.js'
import { Logo } from '../../shared/logo.js'
import { Chevron } from '../../shared/components.js'
import { Collapse, canMove, land } from '../../shared/motion.js'
import { deleteWithUndo, usePendingKeys } from '../../shared/undo.js'
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

/** The questions for a new debt and the request they make (`build()` is `{ error, field }` or
 * `{ body }`). `fields(errOf)` renders them, errOf(field) being the error about that field. */
export function useDebtForm({ places } = {}) {
  const [name, setName] = useState('')
  const [principal, setPrincipal] = useState('')
  const [start, setStart] = useState('')
  const [plan, setPlan] = useState('monthly')
  const [installment, setInstallment] = useState('')
  const [dueDay, setDueDay] = useState('')
  const [received, setReceived] = useState(false)
  const [place, setPlace] = useState('')
  const [note, setNote] = useState('')
  const dayChips = ['1', '5', '10', '15'].map((d) => h('button', { key: d, type: 'button', className: 'q-chip', 'aria-pressed': dueDay === d,
    onClick: () => setDueDay(d) }, d))
  const fields = (errOf = () => null) => frag(
    h(Question, { hero: true, name: 'principal', value: principal, onChange: setPrincipal, label: 'عليك كام؟', unit: 'ج.م', autoFocus: true,
      error: errOf('principal') }),
    h('div', { className: 'l-entry-grid' },
      h(Question, { numeric: false, name: 'name', value: name, onChange: setName, label: 'الدين ده لمين؟', maxLength: 80,
        placeholder: 'قرض العربية، جمعية، أحمد', error: errOf('name'), wide: true }),
      h(Choice, { label: 'بتسدّده إزاي؟', value: plan, onChange: setPlan, wide: true,
        options: [['monthly', 'أقساط كل شهر'], ['once', 'مرة واحدة']] }),
      plan === 'monthly' ? h(Question, { name: 'installment', value: installment, onChange: setInstallment, label: 'القسط كام؟', unit: 'ج.م',
        error: errOf('installment') }) : null,
      plan === 'monthly' ? h(Question, { name: 'due', value: dueDay, onChange: setDueDay, label: 'بيتدفع يوم كام في الشهر؟', inputMode: 'numeric',
        placeholder: '1 لـ 28', chips: dayChips, error: errOf('due') }) : null,
      h(DateField, { label: 'من إمتى؟', name: 'start', value: start, onChange: setStart, noDate: false, error: errOf('start') }),
      h(Choice, { label: 'استلمت فلوس الدين ده؟', value: received, onChange: setReceived, wide: true,
        options: [[true, 'أيوه، دخلت عندي'], [false, 'لأ']] }),
      received ? h(PlaceField, { label: 'دخلت فين؟', value: place, onChange: setPlace, places }) : null),
    h(More, { label: 'تفاصيل أكتر · ملاحظة' },
      h(Question, { numeric: false, name: 'note', value: note, onChange: setNote, label: 'ملاحظة', maxLength: 200, wide: true })))

  function build() {
    const p = parseNumberInput(principal), i = parseNumberInput(installment), d = resolveDay(start)
    const day = plan === 'monthly' && dueDay.trim() ? Number(parseNumberInput(dueDay)) : null
    if (!(p > 0)) return { error: 'اكتب عليك كام.', field: 'principal' }
    if (!name.trim()) return { error: 'اكتب الدين ده لمين.', field: 'name' }
    if (plan === 'monthly' && installment.trim() && !(i > 0)) return { error: 'القسط لازم يكون أكبر من صفر.', field: 'installment' }
    if (day !== null && !(Number.isInteger(day) && day >= 1 && day <= 28)) return { error: 'اختار يوم من 1 لـ 28.', field: 'due' }
    if (d === undefined) return { error: 'التاريخ ده مش مظبوط: اكتبه يوم/شهر/سنة، زي 15/3/2025.', field: 'start' }
    return {
      body: { name: name.trim(), principal: p, start_date: d, installment_egp: plan === 'monthly' && i > 0 ? i : null, due_day: day,
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
  const [fromPlace, setFromPlace] = useState('')
  const [day, setDay] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [bad, setBad] = useState(null)
  const source = payable.find((a) => a.key === from)
  const fail = (message, field = null) => { setError(message); setBad(field) }
  const places = (source && source.places || []).map((p) => p.place).filter(Boolean)
  async function submit(e) {
    e.preventDefault()
    fail('')
    const t = parseNumberInput(taken), dn = parseNumberInput(down), d = resolveDay(day)
    if (!source) return fail('مفيش حاجة تسدّد منها.')
    if (!(t > 0)) return fail('اكتب دفعت كام.', 'taken')
    if (from !== 'EGP' && !(dn > 0)) return fail('الدين هيقل كام جنيه؟ اكتبه.', 'arrived')
    if (d === undefined) return fail('التاريخ ده مش مظبوط: اكتبه يوم/شهر/سنة، زي 15/3/2025.', 'date')
    setBusy(true)
    try {
      await api('POST', '/egx/api/movements', { kind: 'repay', from_asset: from, from_quantity: t, to_asset: debt.key,
        to_quantity: dn > 0 ? dn : null, date: d, note: note.trim() || null, from_place: fromPlace || null })
      onDone()
    } catch (err) { fail(err.message, err.field || null) } finally { setBusy(false) }
  }
  const errOf = (f) => (bad === f ? error : null)
  const unit = source && source.key !== 'EGP' ? source.unit : 'ج.م'
  return h(EntryCard, { className: 'l-add l-move', ariaLabel: 'سداد', title: frag(`سداد «${debt.name}»`), onSubmit: submit, onCancel, busy,
    aside: debt.remaining_egp != null ? h('span', { className: 'q-meta l-entry-aside' }, 'باقي ', N(money(debt.remaining_egp)), ' ج.م') : null,
    alert: error && !bad ? error : null, submitLabel: 'سجّل السداد' },
  h(Question, { hero: true, name: 'taken', value: taken, onChange: setTaken, label: 'دفعت كام؟', unit, 'aria-label': 'المبلغ اللي دفعته', error: errOf('taken'),
    chips: debt.installment_egp ? [h('button', { key: 'i', type: 'button', className: 'q-chip', onClick: () => setTaken(String(debt.installment_egp)) },
      'القسط ', N(money(debt.installment_egp)))] : null }),
  h('div', { className: 'l-entry-grid' },
    h(Choice, { label: 'دفعت منين؟', value: from, onChange: (k) => { setFrom(k); setFromPlace('') }, wide: true,
      options: payable.map((a) => [a.key, a.name]) }),
    places.length > 1 ? h(Choice, { label: 'من أنهي مكان؟', value: fromPlace, onChange: setFromPlace, wide: true,
      options: [['', 'أي مكان'], ...places.map((p) => [p, p])] }) : null,
    from !== 'EGP' ? h(Question, { name: 'arrived', value: down, onChange: setDown, label: 'الدين هيقل كام جنيه؟', unit: 'ج.م', error: errOf('arrived') }) : null,
    h(DateField, { value: day, onChange: setDay, noDate: false, error: errOf('date') })),
  h(More, { label: from === 'EGP' ? 'تفاصيل أكتر · الدين قل كام، ملاحظة' : 'تفاصيل أكتر · ملاحظة' },
    from === 'EGP' ? h(Question, { name: 'arrived', value: down, onChange: setDown, label: 'الدين قل كام؟ (لو غير اللي دفعته)', unit: 'ج.م' }) : null,
    h(Question, { numeric: false, name: 'note', value: note, onChange: setNote, label: 'ملاحظة', maxLength: 200, wide: true })))
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
  const waiting = usePendingKeys()
  const removePayment = (id) => deleteWithUndo(`move:${id}`, 'اتمسح السداد', async () => { await api('DELETE', `/egx/api/movements/${id}`, {}); onChanged() })
  const payments = debt.payments.filter((p) => !waiting.has(`move:${p.movement}`))
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
        h('h3', null, payments.length ? `السدادات (${payments.length})` : 'لسه مفيش سدادات'),
        payments.map((p) => {
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
