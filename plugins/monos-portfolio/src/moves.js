// «الحركات» on the ledger screen (docs/الحركات.md): an asset's movements in its timeline, and the line
// that records money leaving it, into another asset (تحويل) or out of the ledger (خروج). Every balance,
// cost and gain comes from Python (store/movements.py); this only shows them and sends what the user
// typed. The search comes in as a prop, so this file does not import portfolio.js back. ES module.
import { N, api, frag, h, useState } from '../../shared/runtime.js'
import { fmtDate, fmtNumber, fmtQty, fmtSigned, parseDayInput, parseNumberInput, resolveDay, todayCairo, toneOf } from '../../shared/format.mjs'
import { Choice, DateField, EntryCard, More, PlaceField, Question, Summary, usePreview } from '../../shared/form.js'
import { MASK, usePrivacy } from '../../shared/privacy.js'
import { deleteWithUndo, usePending } from '../../shared/undo.js'
import { money } from './units.mjs'

/** «1,000 ج.م» for pounds, «20 USD» / «1.5 وثيقة» for anything else. */
export function amount(quantity, key, unit, hidden) {
  return frag(hidden ? N(MASK) : N(key === 'EGP' ? money(quantity) : fmtQty(quantity)), ' ', key === 'EGP' ? 'ج.م' : unit)
}

const unitOf = (entry) => (entry.key === 'EGP' ? 'ج.م' : entry.unit)

const b = (...children) => h('b', null, ...children)
const whenText = (day) => (day === todayCairo() ? 'النهارده' : frag('يوم ', N(fmtDate(day))))

/** «هتسجّل: …» for a movement, from Python's preview: the screen only formats it. */
function moveSummary(d, within) {
  const from = b(amount(d.from.quantity, d.from.key, d.from.unit))
  if (within) return frag('نقلت ', from, ` من ${d.from.place || 'كل الأماكن'} لـ ${d.to.place}، `, whenText(d.date), '.')
  if (d.kind === 'expense') return frag('صرفت ', from, ` من ${d.from.name}${d.from.place ? ` (${d.from.place})` : ''}، `, whenText(d.date), '.')
  const toUnit = d.to.key === 'EGP' ? 'ج.م' : d.to.unit
  return frag(from, ` من ${d.from.name} ← `, b(amount(d.to.quantity, d.to.key, d.to.unit)), ` ${d.to.key === 'EGP' ? 'جنيه' : d.to.name}`,
    d.egp_per_unit ? frag(' (الـ', d.from.key === 'EGP' ? toUnit : d.from.unit, ' بـ ', b(N(fmtNumber(d.egp_per_unit, 2)), ' ج.م'), ')') : null,
    '، ', whenText(d.date), '.')
}

/** The card under an open asset that records money leaving it: 'expense' (صرفت), 'transfer'
 * (حوّلت) or 'place' (the same asset to another place). */
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
  const [bad, setBad] = useState(null)
  const [fromPlace, setFromPlace] = useState('')
  const [toPlace, setToPlace] = useState('')
  const within = kind === 'place'  // the same asset from one place to another
  const transfer = kind === 'transfer' || within
  const dest = within ? asset : to
  // null while the catalog loads, so the search waits instead of offering «add by name».
  const others = catalog ? catalog.filter((e) => e.key !== asset.key && e.kind !== 'deposit') : null
  const t = parseNumberInput(taken), d = resolveDay(day), v = parseNumberInput(value)
  const a = within && !arrived.trim() ? t : parseNumberInput(arrived)
  const neitherPound = kind === 'transfer' && to && asset.key !== 'EGP' && to.key !== 'EGP'
  const places = (asset.places || []).filter((p) => p.place)
  const fail = (message, field = null) => { setError(message); setBad(field) }

  const body = { kind: within ? 'transfer' : kind, from_asset: asset.key, from_quantity: t, date: d, note: note.trim() || null,
    top_up: topUp, from_place: fromPlace || null }
  if (transfer && dest) Object.assign(body, { to_asset: dest.key, to_quantity: a, value_egp: neitherPound && v > 0 ? v : null, to_place: toPlace.trim() || null })
  const ready = t > 0 && d !== undefined && (!transfer || (dest && a > 0)) && (!within || toPlace.trim())
  const seen = usePreview('/egx/api/movements', body, ready)
  const short = (seen.data && seen.data.short) || (/ناقص/.test(error) ? { text: error } : null)

  async function submit(e) {
    e.preventDefault()
    fail('')
    if (!(t > 0)) return fail(kind === 'expense' ? 'اكتب صرفت كام.' : within ? 'اكتب نقلت كام.' : 'اكتب حوّلت كام.', 'taken')
    if (transfer && !dest) return fail('حوّلت لإيه؟ اختاره من البحث.')
    if (within && !toPlace.trim()) return fail('نقلتها لفين؟ اكتب المكان.', 'to_place')
    if (transfer && !(a > 0)) return fail('اكتب وصلك كام.', 'arrived')
    if (d === undefined) return fail('التاريخ ده مش مظبوط: اكتبه يوم/شهر/سنة، زي 15/3/2025.', 'date')
    setBusy(true)
    try {
      await api('POST', '/egx/api/movements', body)
      onDone()
    } catch (err) {
      fail(err.message, err.field || null)
    } finally {
      setBusy(false)
    }
  }

  const errOf = (f) => (bad === f ? error : null)
  const all = asset.quantity > 0 ? [h('button', { key: 'all', type: 'button', className: 'q-chip', onClick: () => setTaken(String(asset.quantity)) },
    'الكل (', amount(asset.quantity, asset.key, asset.unit), ')')] : null
  const title = within ? `نقلت ${asset.name} لمكان تاني` : transfer ? `حوّلت من ${asset.name}` : `صرفت من ${asset.name}`
  const fromPlaces = places.length ? h(Choice, { label: within ? 'من فين؟' : 'من أنهي مكان؟', value: fromPlace, onChange: setFromPlace, wide: true,
    options: [...(within ? [] : [['', 'أي مكان']]), ...places.map((p) => [p.place, p.place])] }) : null
  return h(EntryCard, { className: 'l-add l-move', ariaLabel: within ? 'نقل' : transfer ? 'تحويل' : 'صرفت', title, onSubmit: submit, onCancel, busy,
    alert: error && !bad && !short ? error : !error && seen.error && !seen.field ? seen.error : null,
    warn: short ? frag(short.text.replace(/ لو الفرق ده.*$/, ''), ' ',
      h('label', null, h('input', { type: 'checkbox', checked: topUp, onChange: (e) => setTopUp(e.target.checked) }),
        'الفرق ده فلوس جت من بره (سجّلها دخل)')) : null,
    summary: h(Summary, { pending: seen.pending,
      empty: kind === 'expense' ? 'اكتب صرفت كام، وهتشوف هنا اللي هيتسجّل' : 'اكتب المبالغ، وهتشوف هنا اللي هيتسجّل' },
    seen.data ? moveSummary(seen.data, within) : null),
    submitLabel: within ? 'سجّل النقل' : transfer ? 'سجّل التحويل' : 'سجّل المصروف' },
  within ? fromPlaces : null,
  h(Question, { hero: true, name: 'taken', value: taken, onChange: setTaken, autoFocus: true, error: errOf('taken'), chips: all,
    label: within ? 'نقلت كام؟' : transfer ? 'حوّلت كام؟' : 'صرفت كام؟', unit: unitOf(asset),
    'aria-label': within ? 'نقلت كام؟' : transfer ? 'حوّلت كام؟' : 'صرفت كام؟' }),
  kind === 'transfer' ? h('div', { className: 'l-q' },
    h('span', { className: 'l-q-label' }, 'لإيه؟'),
    to
      ? h('div', { className: 'l-entry-chosen' }, h('b', null, to.name), h('span', { className: 'q-meta' }, to.kind_label),
        h('button', { type: 'button', className: 'q-link', onClick: () => { setTo(null); setArrived('') } }, 'تغيير'))
      : h(SearchBox, { catalog: others, placeholder: 'دولار، دهب، COMI، صندوق…', onPick: (entry) => { setTo(entry); fail('') },
        onCustom: () => fail('مش لاقيه في القايمة؟ سجّله الأول من «+ سجّل» ← «اشتريت»، وبعدين حوّل له.') })) : null,
  h('div', { className: 'l-entry-grid' },
    kind === 'transfer' && to ? h(Question, { name: 'arrived', value: arrived, onChange: setArrived, label: 'وصلك كام؟', unit: unitOf(to),
      'aria-label': 'وصلك كام؟', error: errOf('arrived') }) : null,
    within ? h(PlaceField, { label: 'لفين؟', name: 'to_place', value: toPlace, onChange: setToPlace, error: errOf('to_place'),
      places: places.map((p) => p.place).filter((p) => p !== fromPlace) }) : null,
    kind === 'expense' ? h(Question, { numeric: false, name: 'note', value: note, onChange: setNote, label: 'على إيه؟ (لو حابب)', maxLength: 200,
      placeholder: 'إيجار، مصاريف البيت، سحب كاش' }) : null,
    h(DateField, { value: day, onChange: setDay, noDate: false, error: errOf('date') })),
  h(More, { label: 'تفاصيل أكتر' },
    within ? null : fromPlaces,
    kind === 'transfer' && to ? h(PlaceField, { label: 'لمكان', name: 'to_place', value: toPlace, onChange: setToPlace, places: [] }) : null,
    within ? h(Question, { name: 'arrived', value: arrived, onChange: setArrived, label: 'وصل كام؟ (لو فيه مصاريف)', unit: unitOf(asset) }) : null,
    neitherPound ? h(Question, { name: 'value', value, onChange: setValue, label: 'كانت تساوي كام بالجنيه؟', unit: 'ج.م' }) : null,
    kind === 'expense' ? null : h(Question, { numeric: false, name: 'note', value: note, onChange: setNote, label: 'ملاحظة', maxLength: 200, wide: true })))
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
  const gone = usePending(`move:${event.movement}`)
  const remove = () => deleteWithUndo(`move:${event.movement}`, 'اتمسحت الحركة', async () => { await api('DELETE', `/egx/api/movements/${event.movement}`, {}); onChanged() })
  const link = other ? h('button', { type: 'button', className: 'q-link', onClick: () => onOpen(other.key) }, other.name) : null

  if (gone) return null
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
  return h('div', { className: 'l-lot l-move-item', 'data-kind': within ? 'place' : incoming ? 'in' : event.kind },
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
      h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-quiet', onClick: () => setMode('edit') }, 'تعديل'),
      h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-quiet q-btn-danger', onClick: remove }, 'حذف')),
    error ? h('span', { className: 'q-error', role: 'alert' }, error) : null)
}
