// «الحركات» on the ledger screen (docs/الحركات.md): an asset's movements in its timeline, and the line
// that records money leaving it, into another asset (تحويل) or out of the ledger (خروج). Every balance,
// cost and gain comes from Python (store/movements.py); this only shows them and sends what the user
// typed. The search comes in as a prop, so this file does not import portfolio.js back. ES module.
import { N, api, frag, h, useState } from '../../shared/runtime.js'
import { fmtDate, fmtNumber, fmtQty, fmtSigned, parseDayInput, parseNumberInput, toneOf } from '../../shared/format.mjs'
import { MASK, usePrivacy } from '../../shared/privacy.js'
import { money } from './units.mjs'

/** «1,000 ج.م» for pounds, «20 USD» / «1.5 وثيقة» for anything else. */
export function amount(quantity, key, unit, hidden) {
  return frag(hidden ? N(MASK) : N(key === 'EGP' ? money(quantity) : fmtQty(quantity)), ' ', key === 'EGP' ? 'ج.م' : unit)
}

const unitOf = (entry) => (entry.key === 'EGP' ? 'ج.م' : entry.unit)

/** «سعرك 50 ج.م للـ USD» when one side is pounds: what the user paid or got per unit. */
function rateText(from, taken, to, arrived) {
  if (!(taken > 0) || !(arrived > 0)) return null
  if (from.key === 'EGP') return frag('سعرك ', N(fmtNumber(taken / arrived, 2)), ` ج.م للـ ${unitOf(to)}`)
  if (to.key === 'EGP') return frag('سعرك ', N(fmtNumber(arrived / taken, 2)), ` ج.م للـ ${unitOf(from)}`)
  return null
}

const field = (label, input) => h('label', { className: 'q-stack' }, h('span', { className: 'q-label' }, label), input)
const text = (value, set, extra = {}) => h('input', { className: 'q-input', value, onChange: (e) => set(e.target.value), ...extra })

/** The line under an open asset that records money leaving it. `kind` is 'transfer' or 'expense'. */
export function MoveForm({ asset, kind, catalog, SearchBox, onDone, onCancel }) {
  const [to, setTo] = useState(null)
  const [taken, setTaken] = useState('')
  const [arrived, setArrived] = useState('')
  const [day, setDay] = useState('')
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [topUp, setTopUp] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fromPlace, setFromPlace] = useState('')
  const [toPlace, setToPlace] = useState('')
  const within = kind === 'place'  // the same asset from one place to another
  const transfer = kind === 'transfer' || within
  const dest = within ? asset : to
  // null while the catalog loads, so the search waits instead of offering «add by name».
  const others = catalog ? catalog.filter((e) => e.key !== asset.key && e.kind !== 'deposit') : null
  const t = parseNumberInput(taken), a = parseNumberInput(arrived), d = parseDayInput(day), v = parseNumberInput(value)
  const neitherPound = kind === 'transfer' && to && asset.key !== 'EGP' && to.key !== 'EGP'

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!(t > 0)) return setError('اكتب الكمية اللي خرجت.')
    if (transfer && !dest) return setError('اختار الأصل اللي الفلوس راحت له.')
    if (within && !toPlace.trim()) return setError('اكتب المكان اللي الفلوس راحت له.')
    if (transfer && !(a > 0)) return setError('اكتب الكمية اللي دخلت.')
    if (d === undefined) return setError('اكتب التاريخ بصيغة يوم/شهر/سنة، أو سيبه فاضي.')
    const body = { kind: within ? 'transfer' : kind, from_asset: asset.key, from_quantity: t, date: d, note: note.trim() || null,
      top_up: topUp, from_place: fromPlace || null }
    if (transfer) Object.assign(body, { to_asset: dest.key, to_quantity: a, value_egp: neitherPound && v > 0 ? v : null, to_place: toPlace.trim() || null })
    setBusy(true)
    try {
      await api('POST', '/egx/api/movements', body)
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const title = within ? `نقل ${asset.name} لمكان تاني` : transfer ? `تحويل من ${asset.name}` : `خروج من ${asset.name}`
  return h('form', { className: 'l-add l-move', onSubmit: submit, noValidate: true, 'aria-label': within ? 'نقل' : transfer ? 'تحويل' : 'خروج' },
    h('b', null, title),
    kind === 'transfer' ? (to
      ? h('div', { className: 'l-inline' }, h('span', null, 'لـ ', h('b', null, to.name)),
        h('button', { type: 'button', className: 'q-link', onClick: () => { setTo(null); setArrived('') } }, 'تغيير'))
      : h(SearchBox, { catalog: others, onPick: (entry) => { setTo(entry); setError('') },
        onCustom: () => setError('الأصل ده مش في القايمة: أضفه الأول من البحث فوق بالاسم، وبعدين حوّل له.') })) : null,
    h('div', { className: 'l-fields' },
      h('div', { className: 'q-stack' },
        h('span', { className: 'q-label' }, `خرج كام (${unitOf(asset)})`),
        h('input', { className: 'q-input num', inputMode: 'decimal', value: taken, 'aria-label': 'الكمية اللي خرجت', onChange: (e) => setTaken(e.target.value) }),
        asset.quantity > 0 ? h('button', { type: 'button', className: 'q-link', style: { padding: 0, minHeight: 24, fontSize: 12 }, onClick: () => setTaken(String(asset.quantity)) }, 'الكل') : null),
      asset.places && asset.places.length ? field('من مكان', h('select', { className: 'q-input', value: fromPlace, onChange: (e) => setFromPlace(e.target.value) },
        h('option', { value: '' }, within ? 'اختار' : 'أي مكان'), asset.places.filter((p) => p.place).map((p) => h('option', { key: p.place, value: p.place }, p.place)))) : null,
      transfer && dest ? field(`دخل كام (${unitOf(dest)})`, text(arrived, setArrived, { inputMode: 'decimal', className: 'q-input num', 'aria-label': 'الكمية اللي دخلت' })) : null,
      transfer && dest ? field(within ? 'لمكان' : 'لمكان (اختياري)', text(toPlace, setToPlace, { maxLength: 40, list: 'l-places' })) : null,
      field('التاريخ (اختياري)', text(day, setDay, { placeholder: 'يوم/شهر/سنة', inputMode: 'numeric' })),
      neitherPound ? field('كانت تساوي كام بالجنيه (اختياري)', text(value, setValue, { inputMode: 'decimal', className: 'q-input num', placeholder: 'ج.م' })) : null,
      field('ملاحظة (اختياري)', text(note, setNote, { maxLength: 200 }))),
    h('label', { className: 'l-inline q-sec' },
      h('input', { type: 'checkbox', checked: topUp, onChange: (e) => setTopUp(e.target.checked) }),
      'لو الرصيد مش كفاية، سجّل الفرق كدخل (فلوس جت من بره)'),
    h('div', { className: 'l-actions' },
      h('button', { type: 'submit', className: 'q-btn q-btn-p', disabled: busy }, busy ? 'جارٍ التسجيل…' : 'سجّل'),
      h('button', { type: 'button', className: 'q-btn q-btn-quiet', onClick: onCancel }, 'إلغاء'),
      kind === 'transfer' && to ? h('span', { className: 'q-meta' }, rateText(asset, t, to, a)) : null,
      error ? h('span', { className: 'q-error', role: 'alert' }, error) : null))
}

/** One movement in an asset's timeline: where the money came from or went, what it was worth, the
 *  gain it realised, the balance after it; the other asset opens with `onOpen`. */
export function MoveItem({ event, asset, onChanged, onOpen }) {
  const hidden = usePrivacy()
  const [mode, setMode] = useState('view')
  const [taken, setTaken] = useState(String(event.from_quantity))
  const [arrived, setArrived] = useState(event.to_quantity == null ? '' : String(event.to_quantity))
  const [day, setDay] = useState(fmtDate(event.date))
  const [value, setValue] = useState(event.value_given ? String(event.value_egp) : '')
  const [note, setNote] = useState(event.note || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const incoming = event.type === 'in'
  const other = event.other
  const within = other && other.key === asset.key
  const placeText = frag(event.from_place ? ` من ${event.from_place}` : '', event.to_place ? ` لـ ${event.to_place}` : '')
  const run = async (action) => {
    setBusy(true); setError('')
    try { await action(); setMode('view'); onChanged() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const save = () => {
    const t = parseNumberInput(taken), a = parseNumberInput(arrived), d = parseDayInput(day), v = parseNumberInput(value)
    if (!(t > 0) || (event.kind === 'transfer' && !(a > 0))) return setError('الكميات لازم تكون أكبر من صفر')
    if (!d) return setError('اكتب التاريخ بصيغة يوم/شهر/سنة')
    const body = { from_quantity: t, date: d, note }
    if (event.kind === 'transfer') body.to_quantity = a
    if (v > 0) body.value_egp = v
    return run(() => api('PATCH', `/egx/api/movements/${event.movement}`, body))
  }
  const remove = () => run(() => api('DELETE', `/egx/api/movements/${event.movement}`, {}))
  const link = other ? h('button', { type: 'button', className: 'q-link', onClick: () => onOpen(other.key) }, other.name) : null

  if (mode === 'edit') {
    const box = (label, val, set, extra = {}) => h('label', { className: 'q-stack' }, h('span', { className: 'q-label' }, label),
      h('input', { className: 'q-input num', value: val, onChange: (e) => set(e.target.value), ...extra }))
    const fromUnit = incoming ? (other.key === 'EGP' ? 'ج.م' : other.unit) : unitOf(asset)
    const toUnit = incoming ? unitOf(asset) : other && (other.key === 'EGP' ? 'ج.م' : other.unit)
    return h('div', { className: 'l-lot' },
      box(`خرج (${fromUnit})`, taken, setTaken, { inputMode: 'decimal', style: { width: 110 } }),
      event.kind === 'transfer' ? box(`دخل (${toUnit})`, arrived, setArrived, { inputMode: 'decimal', style: { width: 110 } }) : null,
      box('التاريخ', day, setDay, { placeholder: 'يوم/شهر/سنة', style: { width: 120 } }),
      event.kind === 'transfer' && !within && asset.key !== 'EGP' && other.key !== 'EGP'
        ? box('القيمة بالجنيه', value, setValue, { inputMode: 'decimal', style: { width: 110 } }) : null,
      h('label', { className: 'q-stack' }, h('span', { className: 'q-label' }, 'ملاحظة'),
        h('input', { className: 'q-input', value: note, maxLength: 200, onChange: (e) => setNote(e.target.value) })),
      h('span', { className: 'l-lot-actions' },
        h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-p', disabled: busy, onClick: save }, 'حفظ'),
        h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-quiet', onClick: () => setMode('view') }, 'إلغاء')),
      error ? h('span', { className: 'q-error', role: 'alert' }, error) : null)
  }

  const spread = incoming && event.market_value_egp != null && event.value_egp != null && Math.abs(event.value_egp - event.market_value_egp) >= 1
  return h('div', { className: 'l-lot l-move-item' },
    within
      ? h('span', null, incoming ? '+' : '−', amount(incoming ? event.to_quantity : event.from_quantity, asset.key, asset.unit, hidden), ' نقل', placeText)
      : incoming
        ? h('span', null, '+', amount(event.quantity, asset.key, asset.unit, hidden), ' من ', link, ' (', amount(event.from_quantity, other.key, other.unit, hidden), ')', placeText)
        : event.kind === 'expense'
          ? h('span', null, '−', amount(event.from_quantity, asset.key, asset.unit, hidden), ' خروج', placeText)
          : event.kind === 'repay'
            ? h('span', null, '−', amount(event.from_quantity, asset.key, asset.unit, hidden), ' سداد ', link, placeText)
            : h('span', null, '−', amount(event.from_quantity, asset.key, asset.unit, hidden), ' لـ ', link, ' (', amount(event.to_quantity, other.key, other.unit, hidden), ')', placeText),
    event.value_egp != null && !within && asset.key !== 'EGP' && !(other && other.key === 'EGP')
      ? h('span', { className: 'q-sec' }, 'بقيمة ', hidden ? N(MASK) : N(money(event.value_egp)), ' ج.م') : null,
    spread ? h('span', { className: 'q-sec' }, 'سعر السوق يومها ', hidden ? N(MASK) : N(money(event.market_value_egp)), ' ج.م') : null,
    event.realized != null && Math.abs(event.realized) >= 1
      ? h('span', { className: 'q-sec' }, 'ربح محقق ', hidden ? N(MASK) : N(fmtSigned(event.realized, 0), toneOf(event.realized)), ' ج.م') : null,
    h('span', { className: 'q-sec' }, N(fmtDate(event.date))),
    h('span', { className: 'q-sec' }, 'الرصيد بعدها ', amount(event.balance, asset.key, asset.unit, hidden)),
    event.note ? h('span', { className: 'q-sec' }, event.note) : null,
    h('span', { className: 'l-lot-actions' },
      mode === 'confirm'
        ? [h('button', { key: 'd', type: 'button', className: 'q-btn q-btn-sm q-btn-danger', disabled: busy, onClick: remove }, 'احذف الحركة'),
          h('button', { key: 'c', type: 'button', className: 'q-btn q-btn-sm q-btn-quiet', onClick: () => setMode('view') }, 'إلغاء')]
        : [h('button', { key: 'e', type: 'button', className: 'q-btn q-btn-sm q-btn-quiet', onClick: () => setMode('edit') }, 'تعديل'),
          h('button', { key: 'r', type: 'button', className: 'q-btn q-btn-sm q-btn-quiet q-btn-danger', onClick: () => setMode('confirm') }, 'حذف')]),
    error ? h('span', { className: 'q-error', role: 'alert' }, error) : null)
}
