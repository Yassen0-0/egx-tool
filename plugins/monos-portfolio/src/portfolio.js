// «Monos / السجل» (docs/تحول.md): the total in EGP first and biggest, the search under it, and the
// assets in four quiet groups, one row per asset with its logo. Everything is computed in Python
// (/egx/api/portfolio); this screen only shows it and sends what the user types. ES module.
// The ledger comes from the shared store (identity.js), so the sidebar's «Monos» row agrees with it.
import { N, QM_CSS, React, api, frag, h, useEffect, useState } from '../../shared/runtime.js'
import { DASH, fmtDate, fmtDayMonth, fmtPct, fmtPrice, fmtQty, fmtSigned, parseDayInput, parseNumberInput, toneOf } from '../../shared/format.mjs'
import { PanelHeader, monos, useMonos } from '../../shared/identity.js'
import { Skeleton } from '../../shared/components.js'
import { Logo } from '../../shared/logo.js'
import { MASK, PrivacyToggle, usePrivacy } from '../../shared/privacy.js'
import { HistoryChart } from './history.js'
import { search } from './search.mjs'
import { ExportButton } from './export.js'
import { DEPOSIT_KIND, DepositInfo, depositSub, useDepositEdit, useDepositForm } from './deposit.js'
import { MoveForm, MoveItem } from './moves.js'
import { ActivityView } from './activity.js'
import { DEBT_KIND, DebtRow, PlaceList, useDebtForm } from './debts.js'
import { ActionItem, PaidItem, StockEventForm, Upcoming } from './events.js'
import { CURRENCY_SIGN, money, sign } from './units.mjs'
import LEDGER_CSS from './ledger.css'

export { CURRENCY_SIGN, money }
export const KIND_CHOICES = [['currency', 'عملة'], ['gold', 'ذهب'], ['bitcoin', 'بتكوين'], ['stock', 'سهم'], ['fund', 'صندوق'], [DEPOSIT_KIND, 'شهادة/وديعة'], [DEBT_KIND, 'دين أو قسط']]
const QTY_LABEL = { stock: 'عدد الأسهم', fund: 'عدد الوثائق' }

const priceWithSign = (v, currency) => frag(N(fmtPrice(v)), ' ', sign(currency))
/** A number span that reads «•••••» while the numbers are hidden (shared/privacy.js); the tone
 * colour is dropped too, so a red or green figure does not give the sign away. */
const hid = (hidden, text, cls) => (hidden ? N(MASK) : N(text, cls))

/** «سعر الجرام وقت الشرا», so a gram is never priced as an ounce. */
function priceLabel(kind, unit, key) {
  if (kind === 'currency') return `سعر ${key} بالجنيه وقت الشرا`
  if (kind === 'gold') return `سعر ال${unit} وقت الشرا`
  return { stock: 'سعر السهم وقت الشرا', fund: 'سعر الوثيقة وقت الشرا', bitcoin: 'سعر البتكوين وقت الشرا' }[kind] || 'سعر الوحدة وقت الشرا'
}

// A buy price more than 3× away from the latest known price is most likely the wrong unit.
export const UNIT_MISMATCH = 3

function quantityLabel(kind, unit, key) {
  if (kind === 'currency') return `المبلغ (${key})`
  return QTY_LABEL[kind] || `الكمية (${unit})`
}

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
export function Search({ catalog, onPick, onCustom }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const text = query.trim()
  // Until the catalog arrives nothing is offered: «إضافة بالاسم ده» for «جنيه» would make a copy
  // of the pound.
  const loading = catalog === null
  const results = text && !loading ? search(catalog, text) : []
  // The «add by name» line has its own marker: catalog entries the user added carry `custom` too.
  const options = text && !loading ? (results.length ? results : [{ addByName: true, key: '+add' }]) : []
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
      type: 'search', value: query, placeholder: 'ابحث عن أصل… دولار، دهب، بتكوين، COMI، أو اسم صندوق',
      role: 'combobox', 'aria-label': 'ابحث عن أصل', 'aria-autocomplete': 'list', 'aria-expanded': options.length > 0,
      'aria-controls': 'l-results', 'aria-activedescendant': options.length ? `l-opt-${at}` : undefined, autoComplete: 'off',
      onChange: (e) => { setQuery(e.target.value); setActive(0) }, onKeyDown,
    }),
    options.length ? h('ul', { id: 'l-results', className: 'l-results', role: 'listbox', 'aria-label': 'نتايج البحث' },
      options.map((o, i) => h('li', {
        key: o.key, id: `l-opt-${i}`, role: 'option', 'aria-selected': i === at, className: 'l-option',
        onMouseDown: (e) => { e.preventDefault(); pick(o) }, onMouseEnter: () => setActive(i),
      }, o.addByName
        ? [h(Logo, { key: 'l', mark: '+' }), h('span', { key: 't' }, 'إضافة بالاسم ده: ', h('b', null, text))]
        : [h(Logo, { key: 'l', symbol: o.kind === 'stock' ? o.symbol : null, mark: o.mark }),
          h('span', { key: 't', className: 'l-name' }, o.name),
          h('span', { key: 'k', className: 'l-kind' }, o.kind_label, o.symbol ? h('span', { className: 'q-sym' }, o.symbol) : null)]))) : null,
    text && loading ? h('p', { className: 'l-hint', role: 'status', style: { marginTop: 6 } }, 'جارٍ تحميل القائمة…') : null)
}

// ── the add line ─────────────────────────────────────────────────────────────
export function AddLine({ entry, customName, onDone, onCancel }) {
  const custom = !entry
  const [kind, setKind] = useState('stock')
  const [name, setName] = useState(customName || '')
  const [symbol, setSymbol] = useState('')
  const [current, setCurrent] = useState('')
  const kindNow = custom ? kind : entry.kind
  const isDeposit = custom && kind === DEPOSIT_KIND
  const isDebt = custom && kind === DEBT_KIND
  const dep = useDepositForm()
  const debt = useDebtForm()
  const [place, setPlace] = useState('')
  const isPound = !custom && entry.key === 'EGP'
  const fixedEgp = kindNow === 'currency'
  const [currency, setCurrency] = useState(custom || fixedEgp ? 'EGP' : entry.currency)
  const [mode, setMode] = useState('qty')
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [cost, setCost] = useState('')
  const [costTouched, setCostTouched] = useState(false)
  const [day, setDay] = useState('')
  const [note, setNote] = useState('')
  const [rate, setRate] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cur = fixedEgp || isPound ? 'EGP' : currency
  const parsedDay = parseDayInput(day)

  useEffect(() => {
    if (cur === 'EGP' || parsedDay === undefined) { setRate(null); return undefined }
    let live = true
    api('GET', `/egx/api/fx?currency=${encodeURIComponent(cur)}&date=${parsedDay || ''}`)
      .then((r) => { if (live) setRate(r.rate) }).catch(() => { if (live) setRate(null) })
    return () => { live = false }
  }, [cur, parsedDay])

  const q = parseNumberInput(qty)
  const p = isPound ? 1 : parseNumberInput(price)
  const quantity = q > 0 && p > 0 ? (mode === 'qty' ? q : q / p) : null
  const paid = quantity != null ? quantity * p : null
  const suggested = cur !== 'EGP' && rate && paid != null ? Math.round(paid * rate * 100) / 100 : null
  const costShown = costTouched ? cost : (suggested != null ? String(suggested) : '')
  const typedEgp = p > 0 ? (cur === 'EGP' ? p : rate ? p * rate : null) : null
  const known = entry && entry.price_egp
  const farOff = typedEgp && known ? typedEgp / known > UNIT_MISMATCH || known / typedEgp > UNIT_MISMATCH : false

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (isDebt) {
      const built = debt.build()
      if (built.error) return setError(built.error)
      setBusy(true)
      try {
        const made = await api('POST', '/egx/api/debts', built.body)
        onDone(`debt:${made.id}`)
      } catch (err) {
        setError(err.message)
      } finally {
        setBusy(false)
      }
      return undefined
    }
    if (isDeposit) {
      const built = dep.build()
      if (built.error) return setError(built.error)
      setBusy(true)
      try {
        const lot = await api('POST', '/egx/api/holdings', built.body)
        onDone(lot.symbol)
      } catch (err) {
        setError(err.message)
      } finally {
        setBusy(false)
      }
      return undefined
    }
    if (custom && !name.trim()) return setError('اكتب اسم الأصل.')
    if (!(q > 0)) return setError(mode === 'qty' ? 'اكتب الكمية.' : 'اكتب المبلغ.')
    if (!isPound && !(p > 0)) return setError('اكتب سعر الشرا.')
    if (parsedDay === undefined) return setError('اكتب التاريخ بصيغة يوم/شهر/سنة، أو سيبه فاضي.')
    const costValue = parseNumberInput(costShown)
    if (cur !== 'EGP' && !(costValue > 0)) return setError('مفيش سعر تحويل معروف لليوم ده: اكتب المبلغ اللي دفعته بالجنيه.')
    const body = { buy_price: p, currency: cur, buy_date: parsedDay, note: note.trim() || null, place: place.trim() || null }
    body[mode === 'qty' ? 'quantity' : 'amount'] = q
    if (cur !== 'EGP') body.cost_egp = costValue
    if (custom) {
      const now = parseNumberInput(current)
      body.custom = { kind, name: name.trim(), symbol: symbol.trim() || null, currency: cur, price: now > 0 ? now : null }
    } else body.asset = entry.key
    setBusy(true)
    try {
      const lot = await api('POST', '/egx/api/holdings', body)
      onDone(lot.symbol)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const field = (label, input) => h('label', { className: 'q-stack' }, h('span', { className: 'q-label' }, label), input)
  const input = (value, set, extra = {}) => h('input', { className: 'q-input', value, onChange: (e) => set(e.target.value), ...extra })
  const currencySelect = h('select', { className: 'q-input', value: cur, 'aria-label': 'عملة سعر الشرا', onChange: (e) => { setCurrency(e.target.value); setCostTouched(false) } },
    ['EGP', 'USD', ...(entry && !['EGP', 'USD'].includes(entry.currency) ? [entry.currency] : [])].map((c) => h('option', { key: c, value: c }, sign(c))))

  return h('form', { className: 'l-add', onSubmit: submit, noValidate: true, 'aria-label': 'إضافة أصل' },
    h('div', { className: 'l-add-head' },
      custom ? h(Logo, { mark: '+' }) : h(Logo, { symbol: entry.kind === 'stock' ? entry.symbol : null, mark: entry.mark }),
      h('b', null, custom ? (isDeposit ? 'شهادة أو وديعة جديدة' : isDebt ? 'دين أو قسط' : 'أصل جديد بالاسم') : entry.name),
      custom ? null : h('span', { className: 'q-meta' }, entry.kind_label)),
    custom ? h('div', { className: 'l-fields' },
      field('النوع', h('select', { className: 'q-input', value: kind, onChange: (e) => setKind(e.target.value) },
        KIND_CHOICES.map(([k, l]) => h('option', { key: k, value: k }, l)))),
      isDeposit || isDebt ? null : field('الاسم', input(name, setName, { maxLength: 80 })),
      isDeposit || isDebt ? null : h('label', { className: 'q-stack' }, h('span', { className: 'q-label' }, 'الرمز (اختياري)'),
        input(symbol, setSymbol, { maxLength: 16, dir: 'ltr' }),
        kind === 'stock' ? h('small', { className: 'q-meta' }, 'لو كتبت رمز البورصة المصرية، السعر هيتحدّث لوحده بعد الجلسة') : null),
      isDeposit || isDebt ? null : field('السعر الحالي للوحدة (اختياري)', input(current, setCurrent, { inputMode: 'decimal', className: 'q-input num' }))) : null,
    isDebt ? debt.fields : isDeposit ? dep.fields : h('div', { className: 'l-fields' },
      h('div', { className: 'q-stack' },
        h('span', { className: 'q-label' }, isPound ? 'المبلغ (EGP)' : mode === 'qty' ? quantityLabel(kindNow, entry ? entry.unit : '', entry ? entry.key : '') : `المبلغ المدفوع (${sign(cur)})`),
        h('input', { className: 'q-input num', inputMode: 'decimal', value: qty, 'aria-label': 'الكمية أو المبلغ', onChange: (e) => setQty(e.target.value) }),
        isPound ? null : h('button', { type: 'button', className: 'q-link', style: { padding: 0, minHeight: 24, fontSize: 12 }, onClick: () => setMode(mode === 'qty' ? 'amount' : 'qty') },
          mode === 'qty' ? 'أو اكتب المبلغ المدفوع' : 'أو اكتب الكمية')),
      isPound ? null : h('div', { className: 'q-stack' },
        h('span', { className: 'q-label' }, priceLabel(kindNow, entry ? entry.unit : '', entry ? entry.key : '')),
        h('div', { className: 'q-row', style: { flexWrap: 'nowrap', gap: 6 } },
          h('input', { className: 'q-input num', inputMode: 'decimal', value: price, style: { flex: 1 }, 'aria-label': 'سعر الشرا', onChange: (e) => setPrice(e.target.value) }),
          fixedEgp ? h('span', { className: 'q-meta' }, 'ج.م') : currencySelect),
        entry && entry.price != null ? h('small', { className: 'q-meta' }, 'آخر سعر ', priceWithSign(entry.price, entry.price_currency)) : null,
        farOff ? h('small', { className: 'q-amber', role: 'status' }, 'السعر ده بعيد جدًا عن آخر سعر: راجع الوحدة والعملة') : null),
      cur !== 'EGP' ? field('المبلغ اللي دفعته بالجنيه',
        h('input', { className: 'q-input num', inputMode: 'decimal', value: costShown, placeholder: 'ج.م', onChange: (e) => { setCost(e.target.value); setCostTouched(true) } })) : null,
      field('التاريخ (اختياري)', input(day, setDay, { placeholder: 'يوم/شهر/سنة', inputMode: 'numeric' })),
      field('المكان (اختياري)', input(place, setPlace, { maxLength: 40, list: 'l-places', placeholder: 'البنك الأهلي، Thndr، كاش' })),
      field('ملاحظة (اختياري)', input(note, setNote, { maxLength: 200 }))),
    h('div', { className: 'l-actions' },
      h('button', { type: 'submit', className: 'q-btn q-btn-p', disabled: busy }, busy ? 'جارٍ الإضافة…' : 'إضافة'),
      h('button', { type: 'button', className: 'q-btn q-btn-quiet', onClick: onCancel }, 'إلغاء'),
      paid != null && !isPound ? h('span', { className: 'q-meta' }, 'الإجمالي ', N(`${fmtQty(Math.round(quantity * 10000) / 10000)} × ${fmtPrice(p)} = ${fmtPrice(paid)}`), ' ', sign(cur),
        cur !== 'EGP' && rate ? frag(' · سعر التحويل ', N(fmtPrice(rate)), ' ج.م') : null) : null,
      error ? h('span', { className: 'q-error', role: 'alert' }, error) : null))
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
  const remove = () => run(() => api('DELETE', `/egx/api/holdings/${lot.id}`, {}))
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
  return h('div', { className: 'l-lot' },
    asset.key === 'EGP' || asset.kind === DEPOSIT_KIND ? h('span', null, hid(hidden, money(lot.quantity)), ' ج.م')
      : h('span', null, hid(hidden, fmtQty(lot.quantity)), ' ', asset.unit, ' × ', hidden ? frag(N(MASK), ' ', sign(lot.currency)) : priceWithSign(lot.buy_price, lot.currency)),
    lot.currency !== 'EGP' ? h('span', { className: 'q-sec' }, lot.cost_egp == null ? 'التكلفة بالجنيه مش معروفة: عدّل العملية واكتبها' : frag('التكلفة ', hid(hidden, money(lot.cost_egp)), ' ج.م')) : null,
    h('span', { className: 'q-sec' }, lot.buy_date ? N(fmtDate(lot.buy_date)) : 'من غير تاريخ'),
    lot.place ? h('span', { className: 'q-sec' }, lot.place) : null,
    lot.note ? h('span', { className: 'q-sec' }, lot.note) : null,
    h('span', { className: 'l-lot-actions' },
      mode === 'confirm'
        ? [h('button', { key: 'd', type: 'button', className: 'q-btn q-btn-sm q-btn-danger', disabled: busy, onClick: remove }, 'احذف العملية'),
          h('button', { key: 'c', type: 'button', className: 'q-btn q-btn-sm q-btn-quiet', onClick: () => setMode('view') }, 'إلغاء')]
        : [h('button', { key: 'e', type: 'button', className: 'q-btn q-btn-sm q-btn-quiet', onClick: () => setMode('edit') }, 'تعديل'),
          h('button', { key: 'r', type: 'button', className: 'q-btn q-btn-sm q-btn-quiet q-btn-danger', onClick: () => setMode('confirm') }, 'حذف')]),
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
    if (!(v > 0)) return setError('اكتب السعر')
    setBusy(true); setError('')
    try { await api('POST', '/egx/api/prices', { asset: asset.key, price: v, currency }); setValue(''); onChanged() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return h('form', { className: 'l-inline', onSubmit: save, noValidate: true },
    h('span', { className: 'q-sec' }, 'تحديث السعر للوحدة'),
    h('input', { className: 'q-input num', inputMode: 'decimal', value, 'aria-label': `السعر الحالي لـ ${asset.name}`, onChange: (e) => setValue(e.target.value) }),
    fixed ? h('span', { className: 'q-meta' }, 'ج.م') : h('select', { className: 'q-input', style: { width: 80 }, value: currency, 'aria-label': 'عملة السعر', onChange: (e) => setCurrency(e.target.value) },
      ['EGP', 'USD'].map((c) => h('option', { key: c, value: c }, sign(c)))),
    h('button', { type: 'submit', className: 'q-btn q-btn-sm', disabled: busy }, 'حفظ السعر'),
    error ? h('span', { className: 'q-error', role: 'alert' }, error) : null)
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

export function AssetRow({ asset, catalog, fresh, focused, onChanged, onOpen }) {
  const hidden = usePrivacy()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [moving, setMoving] = useState(null)
  const [error, setError] = useState('')
  const rowRef = React.useRef(null)
  useEffect(() => {
    if (!focused) return
    setOpen(true)
    rowRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [focused])
  const closed = asset.group === 'closed'
  const movable = asset.kind !== DEPOSIT_KIND && asset.quantity > 0
  const priced = asset.value_egp != null
  const removeAll = async () => {
    try { await api('DELETE', `/egx/api/assets/${encodeURIComponent(asset.key)}`, {}); onChanged() } catch (e) { setError(e.message) }
  }
  const sourceText = asset.price_source === 'manual' ? 'كتبته أنت' : asset.price_source === 'EODHD' ? 'إغلاق EODHD' : null
  return h(React.Fragment, null,
    h('button', { type: 'button', ref: rowRef, className: `l-row${fresh ? ' l-new' : ''}`, 'aria-expanded': open, onClick: () => setOpen(!open) },
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
        priced ? hid(hidden, money(asset.value_egp)) : h('span', { className: 'num q-ter' }, DASH),
        priced && asset.growth != null ? hid(hidden, fmtPct(asset.growth, { signed: true }), `l-growth ${toneOf(asset.growth)}`) : null)),
    open ? h('div', { className: 'l-detail' },
      asset.places && asset.places.length
        ? h('p', { className: 'l-hint' }, 'فين: ', asset.places.map((p, i) => h(React.Fragment, { key: p.place || '' }, i ? ' · ' : '', p.place || 'من غير مكان', ' ', hid(hidden, asset.key === 'EGP' ? money(p.quantity) : fmtQty(p.quantity))))) : null,
      h(Timeline, { asset, onChanged, onOpen }),
      asset.realized_egp && Math.abs(asset.realized_egp) >= 1
        ? h('p', { className: 'l-hint' }, 'ربح محقق من اللي اتحوّل ', hid(hidden, fmtSigned(asset.realized_egp, 0), toneOf(asset.realized_egp)), ' ج.م') : null,
      asset.dividends_egp >= 1
        ? h('p', { className: 'l-hint' }, 'توزيعات استلمتها ', hid(hidden, money(asset.dividends_egp)), ' ج.م') : null,
      movable ? (['dividend', 'bonus', 'split'].includes(moving)
        ? h(StockEventForm, { asset, kind: moving, onDone: () => { setMoving(null); onChanged() }, onCancel: () => setMoving(null) })
        : moving
        ? h(MoveForm, { asset, kind: moving, catalog, SearchBox: Search, onDone: () => { setMoving(null); onChanged() }, onCancel: () => setMoving(null) })
        : h('div', { className: 'l-inline' },
          h('button', { type: 'button', className: 'q-btn q-btn-sm', onClick: () => setMoving('transfer') }, 'تحويل منه'),
          h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-quiet', onClick: () => setMoving('expense') }, 'خروج (صرفت أو سحبت)'),
          h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-quiet', onClick: () => setMoving('place') }, 'نقل لمكان تاني'),
          asset.kind === 'stock' || asset.kind === 'fund' ? frag(
            h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-quiet', onClick: () => setMoving('dividend') }, 'توزيعات'),
            h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-quiet', onClick: () => setMoving('bonus') }, 'أسهم مجانية'),
            h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-quiet', onClick: () => setMoving('split') }, 'تقسيم')) : null)) : null,
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
        error ? h('span', { className: 'q-error', role: 'alert' }, error) : null)) : null)
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

/** Each group's share of the total as one bar (one colour, a lighter step per group) and a legend. */
export function Allocation({ allocation, hidden }) {
  if (!allocation || allocation.length < 2) return null
  const step = (i) => Math.max(0.25, 1 - i * 0.18)
  return h('div', { className: 'l-alloc', role: 'img', 'aria-label': `التوزيع: ${allocation.map((a) => `${a.label} ${fmtPct(a.share, { digits: 0 })}`).join('، ')}` },
    h('div', { className: 'l-alloc-bar' },
      allocation.map((a, i) => h('span', { key: a.group, style: { flexGrow: a.share, opacity: step(i) } }))),
    h('div', { className: 'l-alloc-keys' },
      allocation.map((a, i) => h('span', { key: a.group },
        h('i', { style: { opacity: step(i) } }), a.label, ' ', hid(hidden, fmtPct(a.share, { digits: 0 }))))))
}

export function TotalBlock({ totals }) {
  const hidden = usePrivacy()
  const unpriced = totals.unpriced.length
  const owes = totals.debts > 0
  return h('section', { className: 'l-total', 'aria-label': 'الإجمالي' },
    h('span', null, hid(hidden, money(owes ? totals.net_worth : totals.value || 0), 'l-big'), ' ',
      h('span', { className: 'l-unit' }, owes ? 'جنيه صافي (بعد الديون)' : 'جنيه')),
    owes ? h('div', { className: 'l-usd' }, 'أصول ', hid(hidden, money(totals.value || 0)), ' · ديون ', hid(hidden, money(totals.debts))) : null,
    h(UsdLine, { totals, hidden }),
    h(Allocation, { allocation: totals.allocation, hidden }),
    totals.assets ? h('div', { className: 'l-line' },
      h('span', null, 'التكلفة ', hid(hidden, money(totals.cost))),
      totals.growth != null ? h('span', null, 'النمو ', hid(hidden, fmtPct(totals.growth, { signed: true }), toneOf(totals.growth))) : null,
      totals.realized && Math.abs(totals.realized) >= 1 ? h('span', null, 'ربح محقق ', hid(hidden, fmtSigned(totals.realized, 0), toneOf(totals.realized))) : null,
      unpriced ? h('span', null, N(String(unpriced)), unpriced === 1 ? ' أصل من غير سعر، خارج الإجمالي' : ' أصول من غير سعر، خارج الإجمالي') : null) : null)
}

export function PortfolioPage() {
  const ledger = useMonos()
  const hidden = usePrivacy()
  const [catalog, reloadCatalog] = useCatalog()
  const [picked, setPicked] = useState(null)
  const [fresh, setFresh] = useState(null)
  const [focus, setFocus] = useState(null)
  const [view, setView] = useState('assets')
  const openAsset = (key) => { setView('assets'); setFocus({ key, at: Date.now() }) }
  useEffect(() => { monos.refresh() }, [])
  const refresh = () => monos.refresh()
  const added = (key) => {
    setPicked(null)
    setFresh(key)
    reloadCatalog()
    refresh()
  }
  const loading = ledger === undefined
  const failed = ledger === null
  const totals = ledger && ledger.totals
  const today = totals && totals.today_has_fresh
    ? h('span', { className: 'l-today', title: totals.today_as_of ? `حتى إغلاق ${fmtDate(totals.today_as_of)}` : undefined },
      'اليوم', hid(hidden, fmtPct(totals.today_change_pct, { digits: 2, signed: true }), toneOf(totals.today_change)))
    : null

  let body
  if (loading) {
    body = h('div', { className: 'l-col', 'aria-busy': true },
      h('div', { className: 'l-total' }, h(Skeleton, { width: 220 }), h(Skeleton, { width: 160 })),
      h(Skeleton, { width: '100%' }), h(Skeleton, { width: '90%' }), h(Skeleton, { width: '80%' }))
  } else if (failed) {
    body = h('div', { className: 'l-col' }, h('div', { className: 'q-empty', role: 'alert' },
      h('span', { className: 'q-h2' }, 'تعذّر تحميل السجل'),
      h('button', { type: 'button', className: 'q-btn', onClick: refresh }, 'حاول مرة تانية')))
  } else {
    const assets = ledger.groups.flatMap((g) => g.assets)
    body = h('div', { className: 'l-col' },
      h(PlaceList, { id: 'l-places', places: totals.places }),
      h(TotalBlock, { totals }),
      h(HistoryChart),
      h(Upcoming, { items: ledger.upcoming, onOpen: openAsset }),
      h('div', { className: 'l-tabs', role: 'tablist', 'aria-label': 'العرض' },
        [['assets', 'الأصول'], ['activity', 'الحركات']].map(([id, label]) => h('button', {
          key: id, type: 'button', role: 'tab', 'aria-selected': view === id, className: `l-tab${view === id ? ' l-tab-on' : ''}`, onClick: () => setView(id),
        }, label))),
      view === 'activity' ? h(ActivityView, { onOpen: openAsset }) : null,
      view === 'activity' ? null : h('div', null,
        h(Search, { catalog, onPick: (entry) => setPicked({ entry }), onCustom: (name) => setPicked({ name }) }),
        picked ? h(AddLine, { key: picked.entry ? picked.entry.key : `custom:${picked.name}`, entry: picked.entry || null, customName: picked.name,
          onDone: added, onCancel: () => setPicked(null) }) : null),
      view === 'activity' ? null : ledger.groups.length || (ledger.debts && ledger.debts.length)
        ? ledger.groups.map((g) => h('section', { key: g.group, className: 'l-group', 'aria-label': g.label },
          h('h2', null, g.label),
          g.assets.map((a) => h(AssetRow, { key: a.key, asset: a, catalog, fresh: a.key === fresh, onChanged: refresh,
            focused: focus && focus.key === a.key ? focus.at : null, onOpen: openAsset }))))
        : h('p', { className: 'l-hint' }, 'ابحث عن أصل وأضفه.'),
      view === 'activity' || !ledger.debts || !ledger.debts.length ? null : h('section', { className: 'l-group', 'aria-label': 'ديون وأقساط' },
        h('h2', null, 'ديون وأقساط'),
        ledger.debts.map((d) => h(DebtRow, { key: d.key, debt: d, assets, onChanged: refresh, onOpen: openAsset,
          focused: focus && focus.key === d.key ? focus.at : null }))),
      h('p', { className: 'l-foot' }, 'الأرقام كما أدخلتها، والأسعار إغلاق متأخر أو سعر كتبته أنت، وكل سعر بتاريخه. ',
        'القيمة والتكلفة بالجنيه، والنمو من تكلفة الشرا. وصف للأرقام، وليس توصية بالشراء أو البيع.'))
  }
  return h('div', { className: 'qm', dir: 'rtl', lang: 'ar' },
    h('style', null, QM_CSS + LEDGER_CSS),
    h(PanelHeader, { here: 'السجل', actions: frag(today, h(ExportButton), h(PrivacyToggle)) }),
    body)
}
