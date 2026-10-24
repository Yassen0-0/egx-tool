// Fields shared by the ledger's forms (docs/الواجهة.md): a date with «النهارده / امبارح / من غير
// تاريخ» chips (empty means today), and a number that shows its thousands separators once the field
// is left. Labels wrap their input, so a field is found by its label text.
import { api, frag, h, useEffect, useRef, useState } from './runtime.js'
import { NO_DATE, fmtDate, groupTyped, shiftDay, todayCairo } from './format.mjs'

/** A date field: the chips fill the box, the box takes «يوم/شهر/سنة» or a word. Empty is today. */
export function DateField({ label = 'إمتى؟', value, onChange, name = 'date', invalid = false, noDate = true, error }) {
  const set = (n) => onChange(fmtDate(shiftDay(todayCairo(), n)))
  const chip = (text, on, pressed) => h('button', { type: 'button', className: 'q-chip', 'aria-pressed': pressed, onClick: on }, text)
  const today = fmtDate(todayCairo())
  const bad = invalid || Boolean(error)
  return h('div', { className: 'l-q q-date', 'data-invalid': bad ? '' : undefined },
    h('label', { className: 'l-q-in' }, h('span', { className: 'l-q-label' }, label),
      h('span', { className: 'l-q-box' },
        h('input', { name, value, placeholder: 'النهارده، أو اكتب 15/3/2025', inputMode: 'numeric', 'aria-invalid': bad || undefined,
          onChange: (e) => onChange(e.target.value) }))),
    h('span', { className: 'q-chips' },
      chip('النهارده', () => onChange(''), !value || value === today),
      chip('امبارح', () => set(-1), value === fmtDate(shiftDay(todayCairo(), -1))),
      noDate ? chip(NO_DATE, () => onChange(NO_DATE), value === NO_DATE) : null),
    error ? h('span', { className: 'l-q-err', role: 'alert' }, error) : null)
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

// ── the entry card (docs/الواجهة.md, الموجة ٥) ─────────────────────────────────
// Every form asks questions in plain words, the main one big, the rare ones under «تفاصيل أكتر»,
// reads back what will be saved (worked out by Python: usePreview) and says what its button does.

/** One question: its words, the box (a number with its unit inside, or text), a hint, and the error
 * about it. The label wraps everything, so a field is still found by its label text. */
export function Question({ label, hint, unit, unitControl, name, value, onChange, error, hero = false, chips, numeric = true,
  wide = false, children, ...input }) {
  const box = children || (numeric
    ? h(NumberInput, { name, value, onChange, className: 'num', 'aria-invalid': error ? true : undefined, ...input })
    : h('input', { name, value, onChange: (e) => onChange(e.target.value), 'aria-invalid': error ? true : undefined, ...input }))
  return h('div', { className: `l-q${hero ? ' l-q-hero' : ''}${wide ? ' l-wide' : ''}`, 'data-invalid': error ? '' : undefined },
    h('label', { className: 'l-q-in' },
      h('span', { className: 'l-q-label' }, label),
      h('span', { className: 'l-q-box' }, box, unitControl || (unit ? h('span', { className: 'l-q-unit' }, unit) : null))),
    chips && chips.length ? h('span', { className: 'q-chips' }, chips) : null,
    hint ? h('span', { className: 'l-q-hint' }, hint) : null,
    error ? h('span', { className: 'l-q-err', role: 'alert' }, error) : null)
}

/** A small choice as a segmented row: [value, words] pairs; arrows move between them. */
export function Choice({ label, options, value, onChange, wide = false, error }) {
  const move = (e, i) => {
    const step = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0  // right to left
    if (!step) return
    e.preventDefault()
    const next = options[(i + step + options.length) % options.length][0]
    onChange(next)
    const group = e.currentTarget.parentElement
    setTimeout(() => group && group.querySelector('[aria-checked="true"]')?.focus(), 0)
  }
  return h('div', { className: `l-q${wide ? ' l-wide' : ''}`, 'data-invalid': error ? '' : undefined },
    h('span', { className: 'l-q-label' }, label),
    h('div', { className: 'q-seg l-q-seg', role: 'radiogroup', 'aria-label': label },
      options.map(([v, words], i) => h('button', { key: String(v), type: 'button', role: 'radio', 'aria-checked': value === v,
        tabIndex: value === v || (value == null && i === 0) ? 0 : -1, onClick: () => onChange(v), onKeyDown: (e) => move(e, i) }, words))),
    error ? h('span', { className: 'l-q-err', role: 'alert' }, error) : null)
}

/** The rare questions, folded: the summary line names what is inside. */
export function More({ label = 'تفاصيل أكتر', open, children }) {
  return h('details', { className: 'l-entry-more', open: open || undefined },
    h('summary', null, label), h('div', { className: 'l-entry-grid' }, children))
}

/** The card: head, questions, the read-back, a warning or an error not about one field, and the
 * buttons. `className` keeps the forms' own classes (l-add, l-move) that the tests find them by. */
export function EntryCard({ className = 'l-add', ariaLabel, icon, title, aside, onSubmit, onCancel, busy, alert, warn, summary,
  submitLabel, formRef, children }) {
  return h('form', { ref: formRef, className: `l-entry ${className}`, onSubmit, noValidate: true, 'aria-label': ariaLabel, 'aria-busy': busy || undefined,
      onKeyDown: (e) => { if (e.key === 'Escape' && onCancel) { e.stopPropagation(); onCancel() } } },
    title ? h('div', { className: 'l-entry-head' }, icon || null, h('b', { className: 'l-entry-title' }, title), aside || null) : null,
    children,
    summary || null,
    warn ? h('div', { className: 'l-entry-warn', role: 'status' }, warn) : null,
    alert ? h('div', { className: 'l-entry-alert', role: 'alert' }, alert) : null,
    h('div', { className: 'l-entry-foot' },
      h('button', { type: 'submit', className: 'q-btn q-btn-p q-btn-lg', disabled: busy }, busy ? 'بيتسجّل…' : submitLabel),
      onCancel ? h('button', { type: 'button', className: 'q-btn q-btn-quiet', onClick: onCancel }, 'إلغاء') : null,
      h('span', { className: 'l-entry-keys' }, 'Enter للحفظ · Esc للقفل')))
}

/** «هتسجّل: …»: the read-back, or what is still missing. */
export function Summary({ children, empty, pending }) {
  return h('p', { className: 'l-entry-summary', 'aria-live': 'polite', 'data-empty': children ? undefined : '', 'data-pending': pending ? '' : undefined },
    children ? frag('هتسجّل: ', children) : empty)
}

/** What Python says the form would save, asked again (350 ms after the last keystroke) whenever
 * `body` changes and `ready` is true. Older answers are dropped. {data, error, field, pending}. */
export function usePreview(path, body, ready) {
  const [state, setState] = useState({ data: null, error: '', field: null, pending: false })
  const seq = useRef(0)
  const key = ready ? JSON.stringify(body) : ''
  useEffect(() => {
    const mine = ++seq.current
    if (!key) { setState({ data: null, error: '', field: null, pending: false }); return undefined }
    setState((s) => ({ ...s, pending: true }))
    const timer = setTimeout(() => {
      api('POST', path, { ...JSON.parse(key), preview: true })
        .then((r) => { if (seq.current === mine) setState({ data: r.preview, error: '', field: null, pending: false }) })
        .catch((e) => { if (seq.current === mine) setState({ data: null, error: e.message, field: e.field || null, pending: false }) })
    }, 350)
    return () => { clearTimeout(timer); if (seq.current === mine) seq.current++ }
  }, [path, key])
  return state
}

/** «فين؟»: chips for the places the ledger knows, beside a box to type a new one. */
export function PlaceField({ label = 'فين؟', value, onChange, places, name = 'place', placeholder = 'البنك الأهلي، Thndr، كاش', hint, error }) {
  const known = (places || []).slice(0, 5)
  return h('div', { className: 'l-q', 'data-invalid': error ? '' : undefined },
    h('label', { className: 'l-q-in' }, h('span', { className: 'l-q-label' }, label),
      h('span', { className: 'l-q-box' },
        h('input', { name, value, maxLength: 40, list: 'l-places', placeholder, onChange: (e) => onChange(e.target.value) }))),
    known.length ? h('span', { className: 'q-chips' }, known.map((p) => h('button', { key: p, type: 'button', className: 'q-chip', 'aria-pressed': value === p,
      onClick: () => onChange(value === p ? '' : p) }, p))) : null,
    hint ? h('span', { className: 'l-q-hint' }, hint) : null,
    error ? h('span', { className: 'l-q-err', role: 'alert' }, error) : null)
}
