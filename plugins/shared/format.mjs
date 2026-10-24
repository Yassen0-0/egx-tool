// Formatting helpers for the «Monos» screens. Pure functions only:
// the build inlines this file into client.js (dropping the `export` keywords) and
// plugins/test/format.test.mjs imports it directly.
//
// Numbers use Latin digits, `,` for thousands and `.` for decimals. Signs are added here,
// never by Intl: the Arabic locale wraps its minus in direction marks and uses a hyphen,
// while the UI needs U+2212 and a sign that stays inside the one LTR-isolated `.num` span.

export const MINUS = '−'
export const DASH = '—'

const formatters = new Map()
function fixed(digits) {
  if (!formatters.has(digits)) {
    formatters.set(digits, new Intl.NumberFormat('ar-EG-u-nu-latn', {
      minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: true,
    }))
  }
  return formatters.get(digits)
}

const missing = (v) => v == null || Number.isNaN(v)

// Rounds first so the sign always matches the digits shown (−0.004 shows as 0.00, unsigned).
function signedParts(v, digits) {
  const factor = 10 ** digits
  const rounded = Math.round(Math.abs(v) * factor) / factor
  const sign = rounded === 0 ? '' : v < 0 ? MINUS : '+'
  return { sign, body: fixed(digits).format(rounded) }
}

/** Plain number, fixed decimals; a negative value gets U+2212. */
export function fmtNumber(v, digits = 2) {
  if (missing(v)) return DASH
  const { sign, body } = signedParts(v, digits)
  return (sign === MINUS ? MINUS : '') + body
}

/** A price: always two decimals. */
export function fmtPrice(v) {
  return fmtNumber(v, 2)
}

/** Shares can be fractional (amount ÷ price); show up to 4 decimals, none when whole. */
export function fmtQty(v) {
  if (missing(v)) return DASH
  return new Intl.NumberFormat('ar-EG-u-nu-latn', { maximumFractionDigits: 4 }).format(v).replace(/[‎‏؜]/g, '').replace('-', MINUS)
}

/** Whole count with thousands separators. */
export function fmtCount(v) {
  return fmtNumber(v, 0)
}

/** Signed amount: +1.00 / −1.80 / 0.00. */
export function fmtSigned(v, digits = 2) {
  if (missing(v)) return DASH
  const { sign, body } = signedParts(v, digits)
  return sign + body
}

/** Percent from a fraction (0.069 → 6.9%). `signed` adds +/− (none at zero). */
export function fmtPct(fraction, { digits = 1, signed = false } = {}) {
  if (missing(fraction)) return DASH
  const { sign, body } = signedParts(fraction * 100, digits)
  return (signed ? sign : sign === MINUS ? MINUS : '') + body + '%'
}

// ── Dates (Africa/Cairo) ──────────────────────────────────────────────────────

const cairoDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' })

/** 'YYYY-MM-DD' in Cairo. A bare date stays as it is; a timestamp is converted. */
export function cairoDay(iso) {
  if (!iso) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : cairoDate.format(d)
}

function parts(iso) {
  const day = cairoDay(iso)
  if (!day) return null
  const [y, m, d] = day.split('-').map(Number)
  return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
}

const two = (n) => String(n).padStart(2, '0')

/** Today in Cairo, 'YYYY-MM-DD'. */
export const todayCairo = () => cairoDate.format(new Date())

/** The calendar day `n` days after `iso` (negative: before). */
export function shiftDay(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + n))
  return `${date.getUTCFullYear()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())}`
}

export const NO_DATE = 'من غير تاريخ'

/** What a date field means: empty is today, «من غير تاريخ» is none (null), anything else as typed
 *  (undefined when it is not a real date). */
export function resolveDay(text) {
  const raw = String(text || '').trim()
  if (!raw) return todayCairo()
  if (raw === NO_DATE) return null
  return parseDayInput(raw) || undefined
}

/** A typed number shown back with thousands separators, its decimals kept («100000.5» → «100,000.5»). */
export function groupTyped(text) {
  const n = parseNumberInput(text)
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 8 }) : text
}

const DAY_WORDS = { النهارده: 0, النهاردة: 0, اليوم: 0, امبارح: -1, إمبارح: -1, أمس: -1, امس: -1 }

/** 14/10 */
export function fmtDayMonth(iso) {
  const p = parts(iso)
  return p ? `${two(p.d)}/${two(p.m)}` : DASH
}

/** 14/10/2026 */
export function fmtDate(iso) {
  const p = parts(iso)
  return p ? `${two(p.d)}/${two(p.m)}/${p.y}` : DASH
}

// ── Ledger today (tone of the sidebar % next to the label) ───────────────────

/**
 * 'up' | 'down' | 'neutral', in the order the spec fixes: no assets → neutral; no fresh
 * price for any asset → neutral; today == 0 (at the shown precision) → neutral.
 */
export function iconState(portfolio) {
  const totals = (portfolio && portfolio.totals) || {}
  const count = totals.assets || 0
  if (!count) return 'neutral'
  if (!totals.today_has_fresh || missing(totals.today_change)) return 'neutral'
  const cents = Math.round(totals.today_change * 100)
  if (cents === 0) return 'neutral'
  return cents > 0 ? 'up' : 'down'
}

/** CSS class for a signed price move (green/red only ever go with a +/− sign). */
export function toneOf(v) {
  if (missing(v)) return ''
  const r = Math.round(v * 10000)
  return r > 0 ? 'q-up' : r < 0 ? 'q-down' : ''
}

// ── Input ─────────────────────────────────────────────────────────────────────

/** Parses what the user types as a number: Arabic-Indic digits, «٫»/«,» decimals and spaces allowed. */
export function parseNumberInput(text) {
  if (text == null) return null
  const latin = String(text).trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/٫/g, '.').replace(/[٬\s]/g, '')
  if (!latin) return null
  const normalized = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(latin) ? latin.replace(/,/g, '') : latin.replace(',', '.')
  const value = Number(normalized)
  return Number.isFinite(value) ? value : NaN
}

/**
 * The execution date typed as «يوم/شهر/سنة» (or ISO), or «النهارده» / «امبارح». Empty → null (the
 * forms send today then; the server keeps an empty date empty). Returns 'YYYY-MM-DD', null, or undefined when it is not a real date.
 */
export function parseDayInput(text) {
  const raw = String(text || '').trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  if (!raw) return null
  if (Object.hasOwn(DAY_WORDS, raw)) return shiftDay(todayCairo(), DAY_WORDS[raw])
  let y, m, d
  let match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(raw)
  if (match) { [, d, m, y] = match.map(Number) } else if ((match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw))) { [, y, m, d] = match.map(Number) } else return undefined
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return undefined
  return `${y}-${two(m)}-${two(d)}`
}
