// «Monos / السجل» (docs/تحول.md): the total in EGP first and biggest, the search under it, and the
// assets in four quiet groups, one row per asset with its logo. Everything is computed in Python
// (/egx/api/portfolio); this screen only shows it and sends what the user types. ES module.
// The ledger comes from the shared store (identity.js), so the sidebar's «Monos» row agrees with it.
import { N, QM_CSS, React, api, frag, h, useEffect, useState } from '../../shared/runtime.js'
import { DASH, fmtDate, fmtDayMonth, fmtPct, fmtPrice, fmtQty, fmtSigned, parseDayInput, parseNumberInput, resolveDay, todayCairo, toneOf } from '../../shared/format.mjs'
import { Choice, DateField, EntryCard, More, PlaceField, Question, Summary, focusField, usePreview } from '../../shared/form.js'
import { PanelHeader, monos, useMonos } from '../../shared/identity.js'
import { Chevron, SkeletonPage } from '../../shared/components.js'
import { Collapse, FlipList, canMove, land } from '../../shared/motion.js'
import { Logo } from '../../shared/logo.js'
import { CountNum, MASK, PrivacyToggle, usePrivacy } from '../../shared/privacy.js'
import { HistoryChart } from './history.js'
import { rank, search } from './search.mjs'
import { ExportButton } from './export.js'
import { ImportButton } from './import.js'
import { Composer } from './composer.js'
import { Toasts, toasts } from '../../shared/toast.js'
import { deleteWithUndo, usePending } from '../../shared/undo.js'
import { DEPOSIT_KIND, DepositInfo, depositSub, useDepositEdit, useDepositForm } from './deposit.js'
import { MoveForm, MoveItem } from './moves.js'
import { ActivityView } from './activity.js'
import { DEBT_KIND, DebtRow, PlaceList, useDebtForm } from './debts.js'
import { ActionItem, PaidItem, StockEventForm, Upcoming } from './events.js'
import { CURRENCY_SIGN, money, sign } from './units.mjs'
import LEDGER_CSS from './ledger.css'

export { CURRENCY_SIGN, money }
export const KIND_CHOICES = [['currency', 'عملة'], ['gold', 'ذهب'], ['bitcoin', 'بتكوين'], ['stock', 'سهم'], ['fund', 'صندوق'], [DEPOSIT_KIND, 'شهادة/وديعة'], [DEBT_KIND, 'دين أو قسط']]
const priceWithSign = (v, currency) => frag(N(fmtPrice(v)), ' ', sign(currency))
/** A number span that reads «•••••» while the numbers are hidden (shared/privacy.js); the tone
 * colour is dropped too, so a red or green figure does not give the sign away. */
const hid = (hidden, text, cls) => (hidden ? N(MASK, 'q-swap') : N(text, cls ? `${cls} q-swap` : 'q-swap'))

/** «12 جرام» / «150 سهم» / «1,000 USD». */
function quantityText(asset) {
  return frag(N(fmtQty(asset.quantity)), ' ', asset.unit)
}

// ── catalog (loaded once; search filters it on every keystroke) ──────────────
function useCatalog() {
  const [items, setItems] = useState(null)
  const load = () => api('GET', '/egx/api/catalog').then((d) => setItems(d.assets)).catch(() => setItems((prev) => prev || []))
  useEffect(() => { load() }, [])
  return [items, load]
}

// ── search ───────────────────────────────────────────────────────────────────
export function Search({ catalog, onPick, onCustom, autoFocus = false, placeholder = 'سجّل حاجة… اكتب أصل: دولار، دهب 21، بتكوين، COMI، أو اسم صندوق' }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const text = query.trim()
  // Until the catalog arrives nothing is offered: «إضافة بالاسم ده» for «جنيه» would make a copy
  // of the pound.
  const loading = catalog === null
  const results = text && !loading ? search(catalog, text) : []
  // The «add by name» line has its own marker: catalog entries the user added carry `custom` too. It
  // shows when nothing matched, and under guesses at a typo: a new asset can look like a known one.
  const sure = results.some((e) => rank(e, text) < 4)
  const options = text && !loading ? (sure ? results : [...results, { addByName: true, key: '+add' }]) : []
  const pick = (option) => {
    if (!option) return
    if (option.addByName) onCustom(text)
    else onPick(option)
    setQuery('')
    setActive(0)
  }
  const onKeyDown = (e) => {
    if (!options.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((active + 1) % options.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((active - 1 + options.length) % options.length) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(options[active]) }
    else if (e.key === 'Escape') { setQuery(''); setActive(0) }
  }
  const at = Math.min(active, Math.max(0, options.length - 1))
  return h('div', { className: 'l-search' },
    h('input', {
      type: 'search', value: query, placeholder, autoFocus,
      role: 'combobox', 'aria-label': 'ابحث عن أصل', 'aria-autocomplete': 'list', 'aria-expanded': options.length > 0,
      'aria-controls': 'l-results', 'aria-activedescendant': options.length ? `l-opt-${at}` : undefined, autoComplete: 'off',
      onChange: (e) => { setQuery(e.target.value); setActive(0) }, onKeyDown,
    }),
    options.length ? h('ul', { id: 'l-results', className: 'l-results', role: 'listbox', 'aria-label': 'نتايج البحث' },
      options.map((o, i) => h('li', {
        key: o.key, id: `l-opt-${i}`, role: 'option', 'aria-selected': i === at, className: 'l-option',
        onMouseDown: (e) => { e.preventDefault(); pick(o) }, onMouseEnter: () => setActive(i),
      }, o.addByName
        ? [h(Logo, { key: 'l', mark: '+' }), h('span', { key: 't' }, 'مش لاقيه؟ إضافة بالاسم ده: ', h('b', null, text))]
        : [h(Logo, { key: 'l', symbol: o.kind === 'stock' ? o.symbol : null, mark: o.mark }),
          h('span', { key: 't', className: 'l-name' }, o.name),
          h('span', { key: 'k', className: 'l-kind' }, o.kind_label, o.symbol ? h('span', { className: 'q-sym' }, o.symbol) : null)]))) : null,
    text && loading ? h('p', { className: 'l-hint', role: 'status', style: { marginTop: 6 } }, 'جارٍ تحميل القائمة…') : null)
}

// ── the add line ─────────────────────────────────────────────────────────────
const ASSET_KIND_WORDS = [['currency', 'عملة'], ['gold', 'دهب'], ['bitcoin', 'بتكوين'], ['stock', 'سهم'], ['fund', 'صندوق']]
const UNIT_OF_KIND = { stock: 'سهم', fund: 'وثيقة', bitcoin: 'بتكوين', gold: 'جرام', currency: 'وحدة' }
const b = (...children) => h('b', null, ...children)
/** «النهارده» / «يوم 15/03/2025», from Python's preview. */
const whenText = (d) => (d.date === todayCairo() ? 'النهارده' : frag('يوم ', N(fmtDate(d.date))))

/** «هتسجّل: …» for a purchase, from Python's preview: the screen only formats it. */
function purchaseSummary(d, isPound) {
  if (isPound) return frag(b(N(money(d.quantity)), ' ج.م'), ' دخلوا ', d.place ? `في ${d.place} ` : '', whenText(d), '.')
  const unit = d.unit_name || d.unit
  return frag('اشتريت ', b(N(fmtQty(d.quantity)), ' ', unit), ' ', d.name, ' بـ ', b(N(fmtPrice(d.buy_price)), ' ', sign(d.currency)), ` لل${unit}`,
    ' = ', b(N(fmtPrice(d.paid)), ' ', sign(d.currency)),
    d.currency !== 'EGP' ? frag(' ≈ ', b(N(money(d.cost_egp)), ' ج.م'), ' (الـ', sign(d.currency), ' بـ ', N(fmtPrice(d.fx)), ' ج.م)') : null,
    '، ', whenText(d), d.place ? `، في ${d.place}` : '', '.')
}

export function AddLine({ entry, customName, onDone, onCancel, initialKind, lockKind = false, places }) {
  const custom = !entry
  const [kind, setKind] = useState(initialKind || null)
  const [name, setName] = useState(customName || '')
  const [symbol, setSymbol] = useState('')
  const [current, setCurrent] = useState('')
  const kindNow = custom ? kind : entry.kind
  const isDeposit = custom && kind === DEPOSIT_KIND
  const isDebt = custom && kind === DEBT_KIND
  const dep = useDepositForm({ places })
  const debt = useDebtForm({ places })
  const [place, setPlace] = useState('')
  const isPound = !custom && entry.key === 'EGP'
  const fixedEgp = kindNow === 'currency'
  const [currency, setCurrency] = useState(custom || fixedEgp ? 'EGP' : entry.currency)
  const [mode, setMode] = useState(kindNow === 'fund' || kindNow === 'bitcoin' ? 'amount' : 'qty')
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [cost, setCost] = useState('')
  const [day, setDay] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setErrorText] = useState('')
  const [bad, setBad] = useState(null)  // the field the error is about
  const formRef = React.useRef(null)
  const setError = (message, fieldName = null) => {
    setErrorText(message)
    setBad(message ? fieldName : null)
    if (message && fieldName) setTimeout(() => focusField(formRef.current, fieldName), 0)
  }
  const cur = fixedEgp || isPound ? 'EGP' : currency
  const parsedDay = resolveDay(day)
  const unitName = custom ? UNIT_OF_KIND[kind] || 'وحدة' : entry.unit_name || entry.unit
  const currencies = ['EGP', 'USD', ...(entry && !['EGP', 'USD'].includes(entry.currency) ? [entry.currency] : [])]

  const q = parseNumberInput(qty)
  const p = isPound ? 1 : parseNumberInput(price)
  const costValue = parseNumberInput(cost)
  const body = { buy_price: p, currency: cur, buy_date: parsedDay, note: note.trim() || null, place: place.trim() || null }
  body[mode === 'qty' || isPound || fixedEgp ? 'quantity' : 'amount'] = q
  if (cur !== 'EGP' && costValue > 0) body.cost_egp = costValue
  if (custom) {
    const now = parseNumberInput(current)
    body.custom = { kind, name: name.trim(), symbol: symbol.trim() || null, currency: cur, price: now > 0 ? now : null }
  } else body.asset = entry.key
  const ready = !isDeposit && !isDebt && q > 0 && p > 0 && parsedDay !== undefined && (!custom || (kind && name.trim()))
  const seen = usePreview('/egx/api/holdings', body, ready)
  const needsCost = cur !== 'EGP' && (seen.field === 'cost' || bad === 'cost' || costValue > 0)

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (isDebt || isDeposit) {
      const built = (isDebt ? debt : dep).build()
      if (built.error) return setError(built.error, built.field)
      setBusy(true)
      try {
        const made = await api('POST', isDebt ? '/egx/api/debts' : '/egx/api/holdings', built.body)
        onDone(isDebt ? `debt:${made.id}` : made.symbol)
      } catch (err) {
        setError(err.message, err.field)
      } finally {
        setBusy(false)
      }
      return undefined
    }
    if (custom && !kind) return setError('اختار نوعه الأول.', 'kind')
    if (custom && !name.trim()) return setError('اكتب اسمه.', 'name')
    if (!(q > 0)) return setError(isPound ? 'اكتب المبلغ اللي دخل.' : mode === 'qty' ? 'اكتب الكمية اللي اشتريتها.' : 'اكتب المبلغ اللي دفعته.', 'qty')
    if (!isPound && !(p > 0)) return setError('اكتب اشتريتها بكام.', 'price')
    if (parsedDay === undefined) return setError('التاريخ ده مش مظبوط: اكتبه يوم/شهر/سنة، زي 15/3/2025.', 'date')
    setBusy(true)
    try {
      const lot = await api('POST', '/egx/api/holdings', body)
      onDone(lot.symbol)
    } catch (err) {
      setError(err.message, err.field)
    } finally {
      setBusy(false)
    }
  }

  const errOf = (fieldName) => (bad === fieldName ? error : null)
  const nextCurrency = () => { setCurrency(currencies[(currencies.indexOf(cur) + 1) % currencies.length]); setCost('') }
  const unitToggle = fixedEgp ? null : h('button', { type: 'button', className: 'l-q-unit', 'aria-label': 'عملة السعر', title: 'غيّر عملة السعر', onClick: nextCurrency }, sign(cur), ' ⇄')
  const title = custom
    ? (isDeposit ? 'فتحت شهادة أو وديعة' : isDebt ? 'عليّ دين' : `حاجة جديدة: ${name.trim() || '…'}`)
    : isPound ? 'فلوس دخلت: الجنيه المصري' : `اشتريت ${entry.name}`
  const icon = custom ? h(Logo, { mark: '+' }) : h(Logo, { symbol: entry.kind === 'stock' ? entry.symbol : null, mark: entry.mark })
  const fieldAlert = error && !bad ? error : null
  const previewAlert = !error && seen.error && seen.field !== 'cost' ? seen.error : null

  let questions
  if (isDebt) questions = debt.fields(errOf)
  else if (isDeposit) questions = dep.fields(errOf)
  else {
    questions = frag(
      custom ? h(Choice, { label: `${name.trim() || 'ده'} يبقى إيه؟`, options: ASSET_KIND_WORDS, value: kind, error: errOf('kind'),
        onChange: (k) => { setKind(k); setMode(k === 'fund' || k === 'bitcoin' ? 'amount' : 'qty') } }) : null,
      isPound || fixedEgp ? null : h(Choice, { label: 'هتكتب إيه؟', value: mode, onChange: setMode,
        options: [['qty', `عدد ال${unitName}`], ['amount', 'المبلغ اللي دفعته']] }),
      h(Question, { hero: true, name: 'qty', value: qty, onChange: setQty, autoFocus: true, error: errOf('qty'),
        label: isPound ? 'جالك كام جنيه؟' : mode === 'qty' || fixedEgp ? `اشتريت كام ${unitName}؟` : 'دفعت كام؟',
        unit: isPound ? 'ج.م' : mode === 'qty' || fixedEgp ? unitName : sign(cur) }),
      h('div', { className: 'l-entry-grid' },
        isPound ? null : h(Question, { name: 'price', value: price, onChange: setPrice, error: errOf('price'),
          label: fixedEgp ? `بكام ال${unitName}؟` : `بكام ال${unitName}؟`, unit: fixedEgp ? 'ج.م' : null, unitControl: unitToggle,
          chips: entry && entry.price != null ? [h('button', { key: 'last', type: 'button', className: 'q-chip', title: 'حط آخر سعر في الخانة',
            onClick: () => { setPrice(String(entry.price)); if (!fixedEgp) setCurrency(entry.price_currency) } }, 'آخر سعر ', priceWithSign(entry.price, entry.price_currency))] : null }),
        custom ? h(Question, { name: 'price-now', value: current, onChange: setCurrent, label: 'سعره النهارده كام؟ (لو تعرفه)', unit: sign(cur),
          hint: 'لو سبته فاضي، هيبان من غير قيمة لحد ما تكتب سعره' }) : null,
        needsCost ? h(Question, { name: 'cost', value: cost, onChange: setCost, error: errOf('cost') || (seen.field === 'cost' ? seen.error : null),
          label: 'دفعت كام بالجنيه بالظبط؟', unit: 'ج.م', wide: true }) : null,
        h(DateField, { value: day, onChange: setDay, error: errOf('date') }),
        h(PlaceField, { value: place, onChange: setPlace, places, label: 'فين؟' })),
      h(More, { label: custom ? 'تفاصيل أكتر · الاسم، الرمز، ملاحظة' : 'تفاصيل أكتر · المبلغ بالجنيه، ملاحظة', open: bad === 'name' },
        custom ? h(Question, { numeric: false, name: 'name', value: name, onChange: setName, label: 'اسمه', maxLength: 80, error: errOf('name') }) : null,
        custom ? h(Question, { numeric: false, name: 'symbol', value: symbol, onChange: setSymbol, label: 'رمزه في البورصة (لو تعرفه)', maxLength: 16, dir: 'ltr',
          hint: 'لو كتبته، سعر السهم هيتحدّث لوحده بعد الجلسة' }) : null,
        cur !== 'EGP' && !needsCost ? h(Question, { name: 'cost', value: cost, onChange: setCost, label: 'دفعت كام بالجنيه بالظبط؟', unit: 'ج.م',
          hint: seen.data && seen.data.cost_egp ? frag('لو سبته، هيتحسب بسعر اليوم: ', N(money(seen.data.cost_egp)), ' ج.م') : null }) : null,
        h(Question, { numeric: false, name: 'note', value: note, onChange: setNote, label: 'ملاحظة', maxLength: 200, wide: true })))
  }
  const summary = isDebt || isDeposit ? null : h(Summary, { pending: seen.pending,
    empty: isPound ? 'اكتب المبلغ، وهتشوف هنا اللي هيتسجّل' : 'اكتب الكمية والسعر، وهتشوف هنا اللي هيتسجّل' },
  seen.data ? purchaseSummary(seen.data, isPound) : null)
  const warn = seen.data && seen.data.far_from_last
    ? frag('السعر ده بعيد قوي عن آخر سعر (', N(money(seen.data.last_price_egp)), ` ج.م لل${unitName}). اتأكد إنه سعر ال${unitName} وبالعملة الصح.`) : null

  return h(EntryCard, { formRef, className: 'l-add', ariaLabel: isDebt ? 'دين' : isDeposit ? 'شهادة' : 'إضافة أصل', icon, title,
    aside: custom ? null : h('span', { className: 'q-meta l-entry-aside' }, entry.kind_label),
    onSubmit: submit, onCancel, busy, alert: fieldAlert || previewAlert, warn, summary,
    submitLabel: isDebt ? 'سجّل الدين' : isDeposit ? 'سجّل الشهادة' : isPound ? 'سجّل الفلوس' : 'سجّل الشرا' }, questions)
}

// ── one asset: its row and, when open, its purchases, price and components ───
function LotItem({ lot, asset, onChanged }) {
  const hidden = usePrivacy()
  const [mode, setMode] = useState('view')
  const [qty, setQty] = useState(String(lot.quantity))
  const [price, setPrice] = useState(String(lot.buy_price))
  const [day, setDay] = useState(lot.buy_date ? fmtDate(lot.buy_date) : '')
  const [note, setNote] = useState(lot.note || '')
  const [place, setPlace] = useState(lot.place || '')
  const [cost, setCost] = useState(lot.cost_egp == null ? '' : String(Math.round(lot.cost_egp * 100) / 100))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isDeposit = asset.kind === DEPOSIT_KIND
  const terms = useDepositEdit(asset.deposit)
  const run = async (action) => {
    setBusy(true); setError('')
    try { await action(); setMode('view'); onChanged() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const save = () => {
    const q = parseNumberInput(qty), p = parseNumberInput(price), d = parseDayInput(day), c = parseNumberInput(cost)
    if (!(q > 0) || !(p > 0)) return setError('الكمية والسعر لازم يكونوا أكبر من صفر')
    if (d === undefined) return setError('اكتب التاريخ بصيغة يوم/شهر/سنة')
    const body = { quantity: q, buy_price: p, buy_date: d, note, place }
    if (isDeposit && asset.deposit) {
      const changed = terms.build(d)
      if (changed.error) return setError(changed.error)
      body.deposit = changed.deposit
    }
    if (lot.currency !== 'EGP' && c > 0 && (lot.cost_egp == null || Math.abs(c - lot.cost_egp) > 0.005)) body.cost_egp = c
    return run(() => api('PATCH', `/egx/api/holdings/${lot.id}`, body))
  }
  const gone = usePending(`lot:${lot.id}`)
  const remove = () => deleteWithUndo(`lot:${lot.id}`, 'اتمسحت العملية', async () => { await api('DELETE', `/egx/api/holdings/${lot.id}`, {}); onChanged() })
  if (gone) return null
  if (mode === 'edit') {
    const box = (label, value, set, extra = {}) => h('label', { className: 'q-stack' }, h('span', { className: 'q-label' }, label),
      h('input', { className: 'q-input num', value, onChange: (e) => set(e.target.value), ...extra }))
    return h('div', { className: 'l-lot' },
      box(asset.kind === DEPOSIT_KIND ? 'المبلغ' : 'الكمية', qty, setQty, { inputMode: 'decimal', style: { width: 110 } }),
      asset.key === 'EGP' || asset.kind === DEPOSIT_KIND ? null : box(`السعر (${sign(lot.currency)})`, price, setPrice, { inputMode: 'decimal', style: { width: 110 } }),
      lot.currency !== 'EGP' ? box('المدفوع بالجنيه', cost, setCost, { inputMode: 'decimal', style: { width: 120 } }) : null,
      box(isDeposit ? 'تاريخ البداية' : 'التاريخ', day, setDay, { placeholder: 'يوم/شهر/سنة', style: { width: 120 } }),
      isDeposit && asset.deposit ? terms.fields : null,
      isDeposit ? null : h('label', { className: 'q-stack' }, h('span', { className: 'q-label' }, 'المكان'),
        h('input', { className: 'q-input', value: place, maxLength: 40, list: 'l-places', style: { width: 110 }, onChange: (e) => setPlace(e.target.value) })),
      h('label', { className: 'q-stack' }, h('span', { className: 'q-label' }, 'ملاحظة'),
        h('input', { className: 'q-input', value: note, maxLength: 200, onChange: (e) => setNote(e.target.value) })),
      h('span', { className: 'l-lot-actions' },
        h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-p', disabled: busy, onClick: save }, 'حفظ'),
        h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-quiet', onClick: () => setMode('view') }, 'إلغاء')),
      error ? h('span', { className: 'q-error', role: 'alert' }, error) : null)
  }
  return h('div', { className: 'l-lot', 'data-kind': lot.origin && lot.origin.startsWith('dividend:') ? 'dividend' : 'lot' },
    asset.key === 'EGP' || asset.kind === DEPOSIT_KIND ? h('span', null, hid(hidden, money(lot.quantity)), ' ج.م')
      : h('span', null, hid(hidden, fmtQty(lot.quantity)), ' ', asset.unit, ' × ', hidden ? frag(N(MASK), ' ', sign(lot.currency)) : priceWithSign(lot.buy_price, lot.currency)),
    lot.currency !== 'EGP' ? h('span', { className: 'q-sec' }, lot.cost_egp == null ? 'التكلفة بالجنيه مش معروفة: عدّل العملية واكتبها' : frag('التكلفة ', hid(hidden, money(lot.cost_egp)), ' ج.م')) : null,
    h('span', { className: 'q-sec' }, lot.buy_date ? N(fmtDate(lot.buy_date)) : 'من غير تاريخ'),
    lot.place ? h('span', { className: 'q-sec' }, lot.place) : null,
    lot.note ? h('span', { className: 'q-sec' }, lot.note) : null,
    h('span', { className: 'l-lot-actions' },
      h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-quiet', onClick: () => setMode('edit') }, 'تعديل'),
      h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-quiet q-btn-danger', onClick: remove }, 'حذف')),
    error ? h('span', { className: 'q-error', role: 'alert' }, error) : null)
}

function PriceForm({ asset, onChanged }) {
  const fixed = asset.kind === 'currency'
  const [value, setValue] = useState('')
  const [currency, setCurrency] = useState(fixed ? 'EGP' : asset.price_currency || 'EGP')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(e) {
    e.preventDefault()
    const v = parseNumberInput(value)
    if (!(v > 0)) return setError('اكتب السعر.')
    setBusy(true); setError('')
    try { await api('POST', '/egx/api/prices', { asset: asset.key, price: v, currency }); setValue(''); onChanged() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const toggle = fixed ? null : h('button', { type: 'button', className: 'l-q-unit', 'aria-label': 'عملة السعر', title: 'غيّر عملة السعر',
    onClick: () => setCurrency(currency === 'EGP' ? 'USD' : 'EGP') }, sign(currency), ' ⇄')
  return h('form', { className: 'l-price-form', onSubmit: save, noValidate: true },
    h(Question, { name: 'price-now', value, onChange: setValue, label: `سعر ال${asset.unit_name || asset.unit} النهارده كام؟`, unit: fixed ? 'ج.م' : null,
      unitControl: toggle, 'aria-label': `السعر الحالي لـ ${asset.name}`, error }),
    h('button', { type: 'submit', className: 'q-btn', disabled: busy }, busy ? 'بيتحفظ…' : 'حدّث السعر'))
}

function Components({ asset, catalog, onChanged }) {
  const hidden = usePrivacy()
  const stocks = (catalog || []).filter((e) => e.kind === 'stock')
  const [pick, setPick] = useState('')
  const [weight, setWeight] = useState('')
  const [error, setError] = useState('')
  const send = async (list) => {
    setError('')
    try {
      await api('PUT', `/egx/api/funds/${encodeURIComponent(asset.key)}/components`, { components: list })
      setPick(''); setWeight(''); onChanged()
    } catch (err) { setError(err.message) }
  }
  const current = asset.components.map((c) => ({ asset: c.asset, weight: c.weight }))
  const add = (e) => {
    e.preventDefault()
    const w = parseNumberInput(weight)
    if (!pick || !(w > 0)) return setError('اختار السهم واكتب نسبته')
    return send([...current.filter((c) => c.asset !== pick), { asset: pick, weight: w / 100 }])
  }
  return h('div', null,
    h('h3', null, 'مكونات الصندوق (للعرض، مش داخلة في الإجمالي)'),
    asset.components.map((c) => h('div', { key: c.asset, className: 'l-part' },
      h(Logo, { symbol: c.symbol, mark: c.mark, size: 24 }), h('span', null, c.name),
      h('span', { className: 'q-sec' }, hid(hidden, fmtPct(c.weight)), ' من الصندوق'),
      h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-quiet q-btn-danger', 'aria-label': `شيل ${c.name}`, onClick: () => send(current.filter((x) => x.asset !== c.asset)) }, 'شيل'))),
    h('form', { className: 'l-inline', onSubmit: add, noValidate: true },
      h('select', { className: 'q-input', style: { width: 220 }, value: pick, 'aria-label': 'السهم', onChange: (e) => setPick(e.target.value) },
        h('option', { value: '' }, 'اختار سهم'), stocks.map((s) => h('option', { key: s.key, value: s.key }, `${s.symbol} — ${s.name}`))),
      h('input', { className: 'q-input num', inputMode: 'decimal', value: weight, placeholder: '%', style: { width: 70 }, 'aria-label': 'النسبة من الصندوق', onChange: (e) => setWeight(e.target.value) }),
      h('button', { type: 'submit', className: 'q-btn q-btn-sm' }, 'إضافة مكون'),
      error ? h('span', { className: 'q-error', role: 'alert' }, error) : null))
}

/** The asset's purchases and movements in order (Python's `events`); a certificate has its lots. */
function Timeline({ asset, onChanged, onOpen }) {
  const events = asset.events.length ? asset.events : asset.lots.map((lot) => ({ type: 'lot', id: lot.id }))
  const lots = Object.fromEntries(asset.lots.map((lot) => [lot.id, lot]))
  const moved = events.some((e) => e.type !== 'lot')
  return h('div', null,
    h('h3', null, moved ? `الحركات (${events.length})` : events.length > 1 ? `العمليات (${events.length})` : 'العملية'),
    events.map((e) => e.type === 'lot' && e.id < 0
      ? h(PaidItem, { key: `p${e.id}`, event: e, onOpen })
      : e.type === 'lot'
        ? h(LotItem, { key: `l${e.id}:${lots[e.id].updated_at}`, lot: lots[e.id], asset, onChanged })
        : e.type === 'action'
          ? h(ActionItem, { key: `a${e.id}`, event: e, asset, onChanged })
          : h(MoveItem, { key: `m${e.movement}:${e.type}:${e.from_quantity}:${e.to_quantity}:${e.date}:${e.note}`, event: e, asset, onChanged, onOpen })))
}

/** Two actions in sight, the rest in «كمان» (a native disclosure: its buttons stay in the page). */
const ASSET_KINDS = KIND_CHOICES.slice(0, 5)  // an asset added by name: not a certificate or a debt

/** What an asset added by name is: it decides the heading it shows under. Python checks and saves it. */
function KindForm({ asset, onDone, onCancel }) {
  const [kind, setKind] = useState(asset.kind)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await api('PATCH', `/egx/api/assets/${encodeURIComponent(asset.key)}`, { kind })
      onDone()
    } catch (err) { setError(err.message); setBusy(false) }
  }
  return h('form', { className: 'l-add l-move', onSubmit: submit, 'aria-label': 'نوع الأصل',
      onKeyDown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } } },
    h('b', null, `${asset.name} يبقى إيه؟`),
    h('div', { className: 'q-seg', role: 'radiogroup', 'aria-label': 'النوع' },
      ASSET_KINDS.map(([k, label]) => h('button', { key: k, type: 'button', role: 'radio', 'aria-checked': kind === k, onClick: () => setKind(k) }, label))),
    h('div', { className: 'l-actions' },
      h('button', { type: 'submit', className: 'q-btn q-btn-p', disabled: busy || kind === asset.kind }, busy ? 'بيتحفظ…' : 'احفظ النوع'),
      h('button', { type: 'button', className: 'q-btn q-btn-quiet', onClick: onCancel }, 'إلغاء'),
      error ? h('span', { className: 'q-error', role: 'alert' }, error) : null))
}

function Actions({ asset, entry, onPick }) {
  const stockLike = asset.kind === 'stock' || asset.kind === 'fund'
  const all = [
    entry && asset.kind !== 'currency' ? ['buy', 'اشتريت تاني'] : null,
    ['transfer', 'تحويل منه'],
    ['expense', 'خروج', 'صرفت أو سحبت'],
    ['place', 'نقل لمكان تاني'],
    stockLike ? ['dividend', 'توزيعات'] : null,
    stockLike ? ['bonus', 'أسهم مجانية'] : null,
    stockLike ? ['split', 'تقسيم'] : null,
    entry && entry.custom ? ['kind', 'غيّر النوع', 'سهم ولا صندوق ولا عملة…: تحت أنهي عنوان يظهر'] : null,
  ].filter(Boolean)
  const shown = all.slice(0, 2)
  const more = all.slice(2)
  const menu = React.useRef(null)
  const pick = (id) => { if (menu.current) menu.current.open = false; onPick(id) }
  useEffect(() => {  // a click anywhere else closes «كمان»
    const away = (e) => { if (menu.current && menu.current.open && !menu.current.contains(e.target)) menu.current.open = false }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [])
  return h('div', { className: 'l-inline l-actions-bar' },
    shown.map(([id, label, title], i) => h('button', { key: id, type: 'button', className: `q-btn q-btn-sm${i ? ' q-btn-quiet' : ''}`, title, onClick: () => pick(id) }, label)),
    more.length ? h('details', { ref: menu, className: 'q-menu' },
      h('summary', { className: 'q-btn q-btn-sm q-btn-quiet' }, 'كمان ▾'),
      h('div', { className: 'q-menu-list' }, more.map(([id, label, title]) => h('button', { key: id, type: 'button', className: 'q-btn q-btn-sm', title, onClick: () => pick(id) }, label)))) : null)
}

export function AssetRow({ asset, catalog, places, fresh, focused, onChanged, onOpen }) {
  const entry = (catalog || []).find((e) => e.key === asset.key) || null
  const hidden = usePrivacy()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [moving, setMoving] = useState(null)
  const [error, setError] = useState('')
  const rowRef = React.useRef(null)
  useEffect(() => {
    if (!focused) return
    setOpen(true)
    rowRef.current?.scrollIntoView?.({ block: 'nearest', behavior: canMove() ? 'smooth' : 'auto' })
    land(rowRef.current)
  }, [focused])
  useEffect(() => { if (fresh) land(rowRef.current) }, [fresh])
  const detailId = `l-detail-${asset.key.replace(/[^A-Za-z0-9_-]/g, '_')}`
  const closed = asset.group === 'closed'
  const movable = asset.kind !== DEPOSIT_KIND && asset.quantity > 0
  const priced = asset.value_egp != null
  const removeAll = async () => {
    try { await api('DELETE', `/egx/api/assets/${encodeURIComponent(asset.key)}`, {}); onChanged() } catch (e) { setError(e.message) }
  }
  const sourceText = asset.price_source === 'manual' ? 'كتبته أنت' : asset.price_source === 'EODHD' ? 'إغلاق EODHD' : null
  return h(React.Fragment, null,
    h('button', { type: 'button', ref: rowRef, className: `l-row${fresh ? ' l-new' : ''}`, 'aria-expanded': open, 'data-flip': asset.key, 'data-flip-enter': '',
      'aria-controls': open ? detailId : undefined, onClick: () => setOpen(!open) },
      h(Logo, { symbol: asset.kind === 'stock' ? asset.symbol : null, mark: asset.mark }),
      h('span', { className: 'q-stack' },
        h('span', { className: 'l-name' }, asset.name),
        h('span', { className: 'l-sub' },
          asset.key === 'EGP' || closed ? null : h('span', null, hidden ? frag(N(MASK), ' ', asset.unit) : quantityText(asset)),
          closed ? h('span', null, 'اتحوّل أو اتصرف كله') : null,
          asset.kind === 'stock' && asset.symbol ? h('span', { className: 'q-sym' }, asset.symbol) : null,
          asset.kind === DEPOSIT_KIND ? depositSub(asset, hidden) : null,
          closed ? null : !priced ? h('span', null, 'من غير سعر') : asset.stale && asset.price_as_of ? h('span', null, 'سعر ', N(fmtDayMonth(asset.price_as_of))) : null)),
      h('span', { className: 'l-value' },
        priced ? h(CountNum, { value: asset.value_egp, format: money, hidden, duration: 400 }) : h('span', { className: 'num q-ter' }, DASH),
        priced && asset.growth != null ? hid(hidden, fmtPct(asset.growth, { signed: true }), `l-growth ${toneOf(asset.growth)}`) : null),
      h(Chevron)),
    h(Collapse, { open, id: detailId, 'data-flip': `${asset.key}:d` }, h('div', { className: 'l-detail' },
      asset.places && asset.places.length
        ? h('p', { className: 'l-hint' }, 'فين: ', asset.places.map((p, i) => h(React.Fragment, { key: p.place || '' }, i ? ' · ' : '', p.place || 'من غير مكان', ' ', hid(hidden, asset.key === 'EGP' ? money(p.quantity) : fmtQty(p.quantity))))) : null,
      h(Timeline, { asset, onChanged, onOpen }),
      asset.realized_egp && Math.abs(asset.realized_egp) >= 1
        ? h('p', { className: 'l-hint' }, 'ربح محقق من اللي اتحوّل ', hid(hidden, fmtSigned(asset.realized_egp, 0), toneOf(asset.realized_egp)), ' ج.م') : null,
      asset.dividends_egp >= 1
        ? h('p', { className: 'l-hint' }, 'توزيعات استلمتها ', hid(hidden, money(asset.dividends_egp)), ' ج.م') : null,
      movable ? (['dividend', 'bonus', 'split'].includes(moving)
        ? h(StockEventForm, { asset, kind: moving, places, onDone: () => { setMoving(null); onChanged() }, onCancel: () => setMoving(null) })
        : moving === 'kind'
        ? h(KindForm, { asset, onDone: () => { setMoving(null); onChanged() }, onCancel: () => setMoving(null) })
        : moving === 'buy' && entry
        ? h(AddLine, { entry, places, onDone: () => { setMoving(null); onChanged() }, onCancel: () => setMoving(null) })
        : moving
        ? h(MoveForm, { asset, kind: moving, catalog, SearchBox: Search, onDone: () => { setMoving(null); onChanged() }, onCancel: () => setMoving(null) })
        : h(Actions, { asset, entry, onPick: setMoving })) : null,
      asset.kind === DEPOSIT_KIND ? h(DepositInfo, { asset }) : null,
      asset.key === 'EGP' || asset.kind === DEPOSIT_KIND || closed ? null : h('div', null,
        h('h3', null, 'السعر'),
        priced || asset.price != null
          ? h('p', { className: 'l-hint' }, 'آخر سعر ', hidden ? frag(N(MASK), ' ', sign(asset.price_currency)) : priceWithSign(asset.price, asset.price_currency),
            asset.price_as_of ? frag(' · ', N(fmtDate(asset.price_as_of.slice(0, 10)))) : null, sourceText ? ` · ${sourceText}` : null,
            asset.price_currency !== 'EGP' && asset.price_egp != null ? frag(' · ', hid(hidden, fmtPrice(asset.price_egp)), ' ج.م') : null)
          : h('p', { className: 'l-hint' }, asset.price != null ? 'مفيش سعر دولار معروف للتحويل.' : 'لسه مفيش سعر للأصل ده.'),
        h(PriceForm, { asset, onChanged })),
      asset.kind === 'fund' ? h(Components, { asset, catalog, onChanged }) : null,
      h('div', { className: 'l-inline' },
        confirm
          ? [h('span', { key: 't' }, `حذف «${asset.name}» وكل عملياته؟`),
            h('button', { key: 'd', type: 'button', className: 'q-btn q-btn-sm q-btn-danger', onClick: removeAll }, 'احذف'),
            h('button', { key: 'c', type: 'button', className: 'q-btn q-btn-sm q-btn-quiet', onClick: () => setConfirm(false) }, 'إلغاء')]
          : h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-quiet q-btn-danger', onClick: () => setConfirm(true) }, 'حذف الأصل'),
        error ? h('span', { className: 'q-error', role: 'alert' }, error) : null))))
}

// ── the page ─────────────────────────────────────────────────────────────────
function UsdLine({ totals, hidden }) {
  if (totals.value_usd == null && totals.value_gold_g == null) return null
  const rate = totals.usd_rate != null ? `سعر الدولار ${fmtPrice(totals.usd_rate)} ج.م` : ''
  const day = totals.usd_rate_as_of ? ` · ${fmtDate(totals.usd_rate_as_of.slice(0, 10))}` : ''
  const gram = totals.gold_gram_egp != null ? `جرام الدهب عيار 24 بـ ${fmtPrice(totals.gold_gram_egp)} ج.م` : ''
  return h('div', { className: 'l-usd' },
    totals.value_usd != null ? h('span', { title: rate + day }, '≈ ', hid(hidden, money(Math.round(totals.value_usd))), ' دولار') : null,
    totals.value_usd != null && totals.value_gold_g != null ? ' · ' : null,
    totals.value_gold_g != null ? h('span', { title: gram }, '≈ ', hid(hidden, fmtQty(Math.round(totals.value_gold_g * 10) / 10)), ' جرام دهب خالص') : null)
}

// A step lighter per group: the host's accent mixed into the page colour, never below about 3:1.
const ALLOC_MIX = [100, 74, 54, 40, 30, 24]

/** Each group's share of the total as one bar (one colour, a lighter step per group) and a legend
 *  whose chips scroll to their group. */
export function Allocation({ allocation, hidden }) {
  if (!allocation || allocation.length < 2) return null
  const mix = (i) => ({ '--mix': `${ALLOC_MIX[Math.min(i, ALLOC_MIX.length - 1)]}%` })
  const go = (group) => document.getElementById(`l-g-${group}`)?.scrollIntoView?.({ block: 'start', behavior: canMove() ? 'smooth' : 'auto' })
  return h('div', { className: 'l-alloc' },
    h('div', { className: 'l-alloc-bar', role: 'img', 'aria-label': `التوزيع: ${allocation.map((a) => `${a.label} ${fmtPct(a.share, { digits: 0 })}`).join('، ')}` },
      allocation.map((a, i) => h('span', { key: a.group, style: { flexGrow: a.share, ...mix(i) },
        title: hidden ? a.label : `${a.label} · ${money(a.value_egp)} ج.م · ${fmtPct(a.share, { digits: 0 })}` }))),
    h('div', { className: 'l-alloc-keys' },
      allocation.map((a, i) => h('button', { key: a.group, type: 'button', className: 'l-alloc-key', onClick: () => go(a.group) },
        h('i', { style: mix(i) }), a.label, ' ', hid(hidden, fmtPct(a.share, { digits: 0 }))))))
}

/** «اليوم +0.20%»: the move of the day's fresh market prices, beside the number it moves. */
function Today({ totals, hidden }) {
  if (!totals.today_has_fresh) return null
  return h('span', { className: 'l-today', title: totals.today_as_of ? `حتى إغلاق ${fmtDate(totals.today_as_of)}` : undefined },
    'اليوم', ' ', hid(hidden, fmtPct(totals.today_change_pct, { digits: 2, signed: true }), toneOf(totals.today_change)))
}

const kpi = (label, value) => h('div', { className: 'l-kpi' }, h('span', { className: 'l-kpi-label' }, label), ' ', value)

export function TotalBlock({ totals, onFixPrice }) {
  const hidden = usePrivacy()
  const unpriced = totals.unpriced.length
  const owes = totals.debts > 0
  return h('section', { className: 'l-total', 'aria-label': 'الإجمالي' },
    h('div', { className: 'l-eyebrow' }, h('span', null, owes ? 'صافي ثروتك بعد الديون' : 'صافي ثروتك'), h(Today, { totals, hidden })),
    h('span', { className: 'l-hero' }, h(CountNum, { value: owes ? totals.net_worth : totals.value || 0, format: money, hidden, className: 'l-big' }), ' ',
      h('span', { className: 'l-unit' }, owes ? 'جنيه صافي (بعد الديون)' : 'جنيه')),
    h(UsdLine, { totals, hidden }),
    totals.assets ? h('div', { className: 'l-kpis' },
      owes ? kpi('أصول', hid(hidden, money(totals.value || 0))) : null,
      owes ? kpi('ديون', hid(hidden, money(totals.debts))) : null,
      kpi('التكلفة', hid(hidden, money(totals.cost))),
      totals.growth != null ? kpi('النمو', hid(hidden, fmtPct(totals.growth, { signed: true }), toneOf(totals.growth))) : null,
      totals.realized && Math.abs(totals.realized) >= 1 ? kpi('ربح محقق', hid(hidden, fmtSigned(totals.realized, 0), toneOf(totals.realized))) : null) : null,
    h(Allocation, { allocation: totals.allocation, hidden }),
    unpriced ? h('button', { type: 'button', className: 'l-warn', onClick: onFixPrice },
      N(String(unpriced)), unpriced === 1 ? ' أصل من غير سعر، خارج الإجمالي' : ' أصول من غير سعر، خارج الإجمالي', ' · اكتب سعره') : null)
}

/** «الأصول» / «الحركات»: real tabs (arrow keys move between them) with an underline that slides. */
function Tabs({ view, setView }) {
  const bar = React.useRef(null)
  const ink = React.useRef(null)
  const first = React.useRef(true)
  React.useLayoutEffect(() => {
    const on = bar.current && bar.current.querySelector('[aria-selected="true"]')
    if (!on || !on.offsetWidth || !ink.current) return  // nothing measured (jsdom): the border underline stays
    ink.current.style.transition = !first.current && canMove() ? '' : 'none'
    ink.current.style.transform = `translateX(${on.offsetLeft}px) scaleX(${on.offsetWidth})`
    bar.current.classList.add('has-ink')
    first.current = false
  }, [view])
  const tab = (id, label) => h('button', {
    key: id, id: `l-tab-${id}`, type: 'button', role: 'tab', 'aria-selected': view === id, 'aria-controls': `l-panel-${id}`,
    tabIndex: view === id ? 0 : -1, className: `l-tab${view === id ? ' l-tab-on' : ''}`, onClick: () => setView(id),
    onKeyDown: (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setView(view === 'assets' ? 'activity' : 'assets') } },
  }, label)
  return h('div', { ref: bar, className: 'l-tabs', role: 'tablist', 'aria-label': 'العرض' },
    tab('assets', 'الأصول'), tab('activity', 'الحركات'), h('span', { ref: ink, className: 'l-tab-ink', 'aria-hidden': true }))
}

export function PortfolioPage() {
  const ledger = useMonos()
  const hidden = usePrivacy()
  const [catalog, reloadCatalog] = useCatalog()
  const [picked, setPicked] = useState(null)
  const [fresh, setFresh] = useState(null)
  const [focus, setFocus] = useState(null)
  const [view, setView] = useState('assets')
  const [composer, setComposer] = useState(null)
  const openAsset = (key) => { setView('assets'); setFocus({ key, at: Date.now() }) }
  useEffect(() => { monos.refresh() }, [])
  const refresh = () => monos.refresh()
  const added = (key, text = 'اتسجّلت العملية') => {
    setPicked(null)
    setComposer(null)
    setFresh(key)
    reloadCatalog()
    refresh()
    toasts.push(text, key ? { label: 'افتح', run: () => openAsset(key) } : null)
  }
  const compose = (type = 'buy') => { setView('assets'); setPicked(null); setComposer({ type, at: Date.now() }) }
  // «/» goes to the search, «N» opens «سجّل» (by key position, whatever the keyboard's language).
  const onKeys = (e) => {
    const t = e.target
    if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return
    const root = e.currentTarget
    if (e.code === 'Slash') { e.preventDefault(); setView('assets'); setTimeout(() => root.querySelector('input[role="combobox"]')?.focus(), 0) }
    else if (e.code === 'KeyN') { e.preventDefault(); compose() }
  }
  const loading = ledger === undefined
  const failed = ledger === null
  const totals = ledger && ledger.totals
  let body
  if (loading) {
    body = h('div', { className: 'l-col', 'aria-busy': true }, h(SkeletonPage))
  } else if (failed) {
    body = h('div', { className: 'l-col' }, h('div', { className: 'q-empty', role: 'alert' },
      h('span', { className: 'q-h2' }, 'تعذّر تحميل السجل'),
      h('button', { type: 'button', className: 'q-btn', onClick: refresh }, 'حاول مرة تانية')))
  } else {
    const assets = ledger.groups.flatMap((g) => g.assets)
    const shares = Object.fromEntries((totals.allocation || []).map((a) => [a.group, a]))
    const unpricedAsset = assets.find((a) => a.value_egp == null)

    body = h('div', { className: 'l-col' },
      h(PlaceList, { id: 'l-places', places: totals.places }),
      h(TotalBlock, { totals, onFixPrice: unpricedAsset ? () => openAsset(unpricedAsset.key) : undefined }),
      h(HistoryChart),
      h(Upcoming, { items: ledger.upcoming, onOpen: openAsset }),
      h(Tabs, { view, setView }),
      view === 'activity' ? h('div', { id: 'l-panel-activity', role: 'tabpanel', 'aria-labelledby': 'l-tab-activity', className: 'l-panel' },
        h(ActivityView, { onOpen: openAsset, onCompose: compose })) : null,
      view === 'activity' ? null : h('div', { id: 'l-panel-assets', role: 'tabpanel', 'aria-labelledby': 'l-tab-assets', className: 'l-panel' },
      h(Collapse, { open: Boolean(composer) }, composer ? h(Composer, { key: composer.at, ledger, catalog, places: totals.places, initial: composer.type,
        AddLine, SearchBox: Search, onDone: added, onCancel: () => setComposer(null) }) : null),
      h('div', null,
        h(Search, { catalog, onPick: (entry) => setPicked({ entry }), onCustom: (name) => setPicked({ name }) }),
        h(Collapse, { open: Boolean(picked) }, picked ? h(AddLine, { key: picked.entry ? picked.entry.key : `custom:${picked.name}`, entry: picked.entry || null, customName: picked.name,
          places: totals.places, onDone: (key) => added(key), onCancel: () => setPicked(null) }) : null)),
      ledger.groups.length || (ledger.debts && ledger.debts.length)
        ? h(FlipList, { version: ledger, className: 'l-list' },
          ledger.groups.map((g) => h('section', { key: g.group, id: `l-g-${g.group}`, className: 'l-group', 'aria-label': g.label, 'data-flip': `g:${g.group}` },
            h('h2', null, h('span', null, g.label), shares[g.group]
              ? h('span', { className: 'l-group-total' }, hid(hidden, money(shares[g.group].value_egp)), ' · ', hid(hidden, fmtPct(shares[g.group].share, { digits: 0 }))) : null),
            g.assets.map((a) => h(AssetRow, { key: a.key, asset: a, catalog, places: totals.places, fresh: a.key === fresh, onChanged: refresh,
              focused: focus && focus.key === a.key ? focus.at : null, onOpen: openAsset })))),
          !ledger.debts || !ledger.debts.length ? null : h('section', { id: 'l-g-debts', className: 'l-group', 'aria-label': 'ديون وأقساط' },
            h('h2', null, h('span', null, 'ديون وأقساط')),
            ledger.debts.map((d) => h(DebtRow, { key: d.key, debt: d, assets, onChanged: refresh, onOpen: openAsset,
              focused: focus && focus.key === d.key ? focus.at : null }))))
        : h('div', { className: 'l-empty' }, h('b', null, 'سجلك لسه فاضي'), h('p', { className: 'l-hint' }, 'ابحث عن أصل وأضفه.'),
          h('span', { className: 'q-chips', style: { justifyContent: 'center' } },
            h('button', { type: 'button', className: 'q-chip', onClick: () => compose('buy') }, 'فلوس أو دهب أو سهم'),
            h('button', { type: 'button', className: 'q-chip', onClick: () => compose('deposit') }, 'شهادة بنك'),
            h('button', { type: 'button', className: 'q-chip', onClick: () => compose('debt') }, 'دين أو قسط')))),
      h('p', { className: 'l-foot' }, 'الأرقام كما أدخلتها، والأسعار إغلاق متأخر أو سعر كتبته أنت، وكل سعر بتاريخه. ',
        'القيمة والتكلفة بالجنيه، والنمو من تكلفة الشرا. وصف للأرقام، وليس توصية بالشراء أو البيع.'))
  }
  const recordButton = ledger ? h('button', { type: 'button', className: 'q-btn q-btn-p', title: 'سجّل حاجة (N)', onClick: () => compose() }, '+ سجّل') : null
  return h('div', { className: 'qm', dir: 'rtl', lang: 'ar', onKeyDown: onKeys },
    h('style', null, QM_CSS + LEDGER_CSS),
    h(PanelHeader, { here: 'السجل', actions: frag(recordButton, h(ImportButton, { onDone: () => { reloadCatalog(); refresh() } }), h(ExportButton), h(PrivacyToggle)) }),
    body,
    h(Toasts))
}
