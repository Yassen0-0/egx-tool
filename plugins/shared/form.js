// Fields shared by the ledger's forms (docs/الواجهة.md): a date with «النهارده / امبارح / من غير
// تاريخ» chips (empty means today), and a number that shows its thousands separators once the field
// is left. Labels wrap their input, so a field is found by its label text.
import { h } from './runtime.js'
import { NO_DATE, fmtDate, groupTyped, shiftDay, todayCairo } from './format.mjs'

/** A date field: the chips fill the box, the box takes «يوم/شهر/سنة» or a word. */
export function DateField({ label = 'التاريخ', value, onChange, name = 'date', invalid = false, noDate = true }) {
  const set = (n) => onChange(fmtDate(shiftDay(todayCairo(), n)))
  const chip = (text, on, pressed) => h('button', { type: 'button', className: 'q-chip', 'aria-pressed': pressed, onClick: on }, text)
  const today = fmtDate(todayCairo())
  return h('div', { className: 'q-stack q-date' },
    h('label', { className: 'q-stack' }, h('span', { className: 'q-label' }, label),
      h('input', { className: 'q-input', name, value, placeholder: 'النهارده', inputMode: 'numeric', 'aria-invalid': invalid || undefined,
        onChange: (e) => onChange(e.target.value) })),
    h('span', { className: 'q-chips' },
      chip('النهارده', () => onChange(''), !value || value === today),
      chip('امبارح', () => set(-1), value === fmtDate(shiftDay(todayCairo(), -1))),
      noDate ? chip(NO_DATE, () => onChange(NO_DATE), value === NO_DATE) : null))
}

/** An amount box: decimal keyboard, Latin digits, separators added when the field is left. */
export function NumberInput({ value, onChange, className = 'q-input num', ...rest }) {
  return h('input', { className, inputMode: 'decimal', dir: 'ltr', value, onChange: (e) => onChange(e.target.value),
    onBlur: () => { if (String(value).trim()) onChange(groupTyped(value)) }, ...rest })
}

/** Focus the first field of `form` named `name` (an error points at it). */
export function focusField(form, name) {
  const el = form && name ? form.querySelector(`[name="${name}"]`) : null
  if (el && typeof el.focus === 'function') el.focus()
}
