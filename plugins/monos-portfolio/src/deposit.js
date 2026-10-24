// Bank certificates and deposits («شهادات وودائع») on the ledger screen: the add line's fields, the
// row's one-line summary and the terms shown when the row is open. Nothing is calculated here: the
// value, the interest per year and the next payout date come from Python (store/deposits.py); the
// form only turns what the user typed into the `deposit` object portfolio_add validates. ES module.
import { N, frag, h, useState } from '../../shared/runtime.js'
import { fmtDate, fmtNumber, parseDayInput, parseNumberInput, resolveDay } from '../../shared/format.mjs'
import { Choice, DateField, More, PlaceField, Question } from '../../shared/form.js'
import { MASK, usePrivacy } from '../../shared/privacy.js'

export const DEPOSIT_KIND = 'deposit'
export const PAYOUT_CHOICES = [['monthly', 'شهري'], ['quarterly', 'ربع سنوي'], ['annual', 'سنوي'], ['maturity', 'في الآخر']]

/** 0.27 → 27%, 0.2725 → 27.25%. */
export const ratePct = (rate) => `${Number((rate * 100).toFixed(2))}%`

/** The questions for a new certificate and the request they make. `fields(errOf)` renders them;
 *  `build()` is `{ error, field }` for the first thing wrong, or `{ body }` for POST /egx/api/holdings. */
const PAYOUT_WORDS = [['monthly', 'كل شهر'], ['quarterly', 'كل 3 شهور'], ['annual', 'كل سنة'], ['maturity', 'في الآخر']]
const TERMS = [[1, 'سنة'], [3, '3 سنين'], [5, '5 سنين'], ['other', 'تاريخ تاني']]

export function useDepositForm({ places } = {}) {
  const [bank, setBank] = useState('')
  const [amount, setAmount] = useState('')
  const [rate, setRate] = useState('')
  const [start, setStart] = useState('')
  const [term, setTerm] = useState(3)
  const [maturity, setMaturity] = useState('')
  const [payout, setPayout] = useState('monthly')
  const [note, setNote] = useState('')
  const [settle, setSettle] = useState(true)
  const [fromEgp, setFromEgp] = useState(false)

  const fields = (errOf = () => null) => frag(
    h(Question, { hero: true, name: 'principal', value: amount, onChange: setAmount, label: 'حطيت كام في الشهادة؟', unit: 'ج.م', autoFocus: true,
      error: errOf('principal') }),
    h('div', { className: 'l-entry-grid' },
      h(Question, { name: 'rate', value: rate, onChange: setRate, label: 'العائد كام في السنة؟', unit: '%', placeholder: '27', error: errOf('rate') }),
      h(PlaceField, { label: 'البنك', name: 'bank', value: bank, onChange: setBank, places, placeholder: 'البنك الأهلي، بنك مصر' }),
      h(DateField, { label: 'اتفتحت إمتى؟', name: 'start', value: start, onChange: setStart, noDate: false, error: errOf('start') }),
      h(Choice, { label: 'مدتها', value: term, onChange: setTerm, options: TERMS, wide: true }),
      term === 'other' ? h(Question, { numeric: false, name: 'maturity', value: maturity, onChange: setMaturity, label: 'بتخلص إمتى؟',
        placeholder: 'يوم/شهر/سنة', inputMode: 'numeric', error: errOf('maturity') }) : null,
      h(Choice, { label: 'العائد بينزل', value: payout, onChange: setPayout, options: PAYOUT_WORDS, wide: true })),
    h(More, { label: 'تفاصيل أكتر · منين اتدفعت، العائد بينزل فين، ملاحظة' },
      h('label', { className: 'l-inline l-wide' }, h('input', { type: 'checkbox', checked: fromEgp, onChange: (e) => setFromEgp(e.target.checked) }),
        'دفعت تمنها من الجنيه اللي في السجل'),
      h('label', { className: 'l-inline l-wide' }, h('input', { type: 'checkbox', checked: settle, onChange: (e) => setSettle(e.target.checked) }),
        'العائد والمبلغ في الآخر ينزلوا على الجنيه اللي في السجل لوحدهم'),
      h(Question, { numeric: false, name: 'note', value: note, onChange: setNote, label: 'ملاحظة', maxLength: 200, wide: true })))

  function build() {
    const principal = parseNumberInput(amount)
    const percent = parseNumberInput(rate)
    const from = resolveDay(start)
    const to = term === 'other' ? parseDayInput(maturity) : null
    if (!(principal > 0)) return { error: 'اكتب مبلغ الشهادة.', field: 'principal' }
    if (!(percent > 0) || percent > 100) return { error: 'اكتب العائد في السنة، زي 27.', field: 'rate' }
    if (!from) return { error: 'التاريخ ده مش مظبوط: اكتبه يوم/شهر/سنة، زي 15/3/2025.', field: 'start' }
    if (term === 'other' && !to) return { error: 'اكتب بتخلص إمتى: يوم/شهر/سنة.', field: 'maturity' }
    if (to && to <= from) return { error: 'تاريخ الخلوص لازم يكون بعد تاريخ الفتح.', field: 'maturity' }
    return {
      body: {
        amount: principal, buy_price: 1, currency: 'EGP', note: note.trim() || null,
        deposit: { rate: Number((percent / 100).toFixed(6)), start_date: from, maturity_date: to, term_years: term === 'other' ? null : term,
          payout, bank: bank.trim() || null, settle_to_egp: settle, from_egp: fromEgp },
      },
    }
  }
  return { fields, build }
}

/** The edit line's extra fields for a certificate's terms (its date box is the start date).
 *  `build(start)` is `{ error }` or `{ deposit }`, the changed terms for PATCH /egx/api/holdings/<id>;
 *  `start` is the date box parsed (null when left empty). */
export function useDepositEdit(terms) {
  const [bank, setBank] = useState(terms?.bank || '')
  const [rate, setRate] = useState(terms ? String(Number((terms.rate * 100).toFixed(4))) : '')
  const [maturity, setMaturity] = useState(terms ? fmtDate(terms.maturity_date) : '')
  const [payout, setPayout] = useState(terms?.payout || 'monthly')

  const field = (label, input) => h('label', { className: 'q-stack' }, h('span', { className: 'q-label' }, label), input)
  const text = (value, set, extra = {}) => h('input', { className: 'q-input', value, onChange: (e) => set(e.target.value), ...extra })
  const fields = frag(
    field('العائد السنوي %', text(rate, setRate, { inputMode: 'decimal', className: 'q-input num', style: { width: 90 } })),
    field('تاريخ الاستحقاق', text(maturity, setMaturity, { placeholder: 'يوم/شهر/سنة', inputMode: 'numeric', style: { width: 120 } })),
    field('صرف العائد', h('select', { className: 'q-input', value: payout, onChange: (e) => setPayout(e.target.value) },
      PAYOUT_CHOICES.map(([value, label]) => h('option', { key: value, value }, label)))),
    field('البنك', text(bank, setBank, { maxLength: 60, style: { width: 120 } })))

  function build(start) {
    const percent = parseNumberInput(rate)
    const to = parseDayInput(maturity)
    if (!(percent > 0) || percent > 100) return { error: 'اكتب العائد السنوي بالنسبة المئوية، زي 27.' }
    if (!to) return { error: 'اكتب تاريخ الاستحقاق بصيغة يوم/شهر/سنة.' }
    if (to <= (start || terms?.start_date || '')) return { error: 'تاريخ الخلوص لازم يكون بعد تاريخ الفتح.' }
    return { deposit: { rate: Number((percent / 100).toFixed(6)), maturity_date: to, payout, bank: bank.trim() || null } }
  }
  return { fields, build }
}

/** The row's second line: «27% · شهري», or «منتهية». */
export function depositSub(asset, hidden = false) {
  const d = asset.deposit
  if (!d) return null
  return frag(
    h('span', null, N(hidden ? MASK : ratePct(d.rate)), ' · ', d.payout_label),
    d.status === 'matured' ? h('span', null, 'منتهية') : null)
}

/** The open row's terms: bank, rate, payout, dates, and what the certificate pays in a year. */
export function DepositInfo({ asset }) {
  const hidden = usePrivacy()
  const d = asset.deposit
  if (!d) return null
  const item = (key, ...children) => h('span', { key }, ...children)
  return h('div', null,
    h('h3', null, 'الشهادة'),
    h('div', { className: 'l-lot' },
      d.bank ? item('bank', d.bank) : null,
      item('rate', 'العائد السنوي ', N(hidden ? MASK : ratePct(d.rate))),
      item('payout', 'صرف ', d.payout_label),
      item('start', 'من ', N(fmtDate(d.start_date))),
      item('maturity', 'الاستحقاق ', N(fmtDate(d.maturity_date)))),
    h('div', { className: 'l-lot' },
      item('year', 'العائد في السنة ', N(hidden ? MASK : fmtNumber(d.interest_per_year, 0)), ' ج.م'),
      d.status === 'matured'
        ? item('state', 'الشهادة انتهت')
        : item('next', d.payout === 'maturity' ? 'العائد يتصرف في ' : 'الصرف الجاي ', N(fmtDate(d.next_payout_date))),
      d.payout === 'maturity' ? item('earned', 'العائد المتراكم داخل القيمة ', N(hidden ? MASK : fmtNumber(d.interest_to_date, 0)), ' ج.م') : null,
      d.settle_to_egp ? item('settle', 'العائد بيدخل الجنيه في مواعيده') : null))
}
