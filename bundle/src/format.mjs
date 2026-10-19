// Formatting and valuation helpers shared by every «Monos» screen. Pure functions only:
// the build inlines this file into client.js (dropping the `export` keywords) and
// bundle/test/format.test.mjs imports it directly.
//
// Numbers use Latin digits, `,` for thousands and `.` for decimals. Signs are added here,
// never by Intl: the Arabic locale wraps its minus in direction marks and uses a hyphen,
// while the UI needs U+2212 and a sign that stays inside the one LTR-isolated `.num` span.

export const MINUS = '−'
export const DASH = '—'
// Mirror of mcp/egx_mcp/pricing.py (protection = fair × (1 − PROTECTION_DISCOUNT)); the Python value
// is the rule and mcp/tests/test_rules_in_sync.py fails when this copy, the skills or the preset differ.
export const PROTECTION_RATIO = 0.8
export const PROTECTION_PCT = `${Math.round(PROTECTION_RATIO * 100)}%`

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

/** Day change as one string for one `.num` span: +1.00 (+0.83%). */
export function fmtChange(change, changePct) {
  if (missing(change)) return DASH
  if (missing(changePct)) return fmtSigned(change)
  return `${fmtSigned(change)} (${fmtPct(changePct, { digits: 2, signed: true })})`
}

/** Old → new value pair for one `.num` span: 118.00 → 131.00. */
export function fmtArrow(from, to) {
  return `${fmtPrice(from)} → ${fmtPrice(to)}`
}

// ── Valuation (docs/design/CLAUDE_CODE.md §4) ─────────────────────────────────

// Prices are quoted to the piaster, so compare at that precision: 131 × 0.8 is
// 104.80000000000001 in floating point, and a price of 104.80 is not under it.
const EPS = 1e-6

export function protectionOf(fair) {
  return missing(fair) ? null : fair * PROTECTION_RATIO
}

/** Difference from fair as a share of fair: (fair − price) / fair. Positive = price under fair. */
export function marginToFair(fair, price) {
  if (missing(fair) || missing(price) || fair <= 0) return null
  return (fair - price) / fair
}

/** How far the price is under protection, as a share of protection; null when it is not under. */
export function belowProtectionBy(fair, price) {
  const protection = protectionOf(fair)
  if (protection == null || missing(price) || price >= protection - EPS) return null
  return (protection - price) / protection
}

/** 'above' (price ≥ fair), 'between' (protection ≤ price < fair), 'under' (price < protection). */
export function statusOf(price, fair) {
  if (missing(price) || missing(fair) || fair <= 0) return null
  if (price >= fair - EPS) return 'above'
  if (price >= protectionOf(fair) - EPS) return 'between'
  return 'under'
}

export const STATUS_LABEL = {
  above: 'أعلى من العادل',
  between: 'بين الحماية والعادل',
  under: 'تحت سعر الحماية — يحتاج مراجعة',
}

/** Maps the API's pricing status names onto statusOf()'s. */
export const API_STATUS = { above_fair_value: 'above', at_or_below_fair_value: 'between', below_protection: 'under' }

/**
 * The neutral sentence about price vs fair value, split so the number can sit in its own
 * `.num` span and the sentence ends on it (never on punctuation after a number).
 * Returns { status, mark, text, value } or null when either input is missing.
 */
export function marginSentence(price, fair) {
  const status = statusOf(price, fair)
  if (!status) return null
  if (status === 'under') {
    return { status, mark: '◆', text: 'تحت سعر الحماية بـ', value: fmtPct(belowProtectionBy(fair, price)) }
  }
  const margin = marginToFair(fair, price)
  if (Math.round(Math.abs(margin) * 1000) === 0) return { status, mark: '○', text: 'عند السعر العادل', value: null }
  return status === 'between'
    ? { status, mark: '○', text: 'أقل من العادل بـ', value: fmtPct(margin) }
    : { status, mark: '○', text: 'أعلى من العادل بـ', value: fmtPct(-margin) }
}

/**
 * Positions (0–100, left to right) for the valuation ruler. The scale spans the bear–bull band,
 * protection, fair and price with a little padding, so every mark stays on the track.
 */
export function rulerScale({ bear, bull, fair, price }) {
  const protection = protectionOf(fair)
  const values = [bear, bull, fair, protection, price].filter((v) => !missing(v))
  if (!values.length) return null
  let lo = Math.min(...values), hi = Math.max(...values)
  if (hi === lo) { lo -= 1; hi += 1 }
  const pad = (hi - lo) * 0.06
  lo -= pad; hi += pad
  const at = (v) => (missing(v) ? null : ((v - lo) / (hi - lo)) * 100)
  return { at, bear: at(bear), bull: at(bull), fair: at(fair), protection: at(protection), price: at(price) }
}

// ── Dates (Africa/Cairo) ──────────────────────────────────────────────────────

const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
const cairoDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' })
const cairoTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

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

/** الأربعاء 14 أكتوبر (digits stay Latin; callers wrap the number part if they split it). */
export function fmtLongDay(iso) {
  const p = parts(iso)
  return p ? `${WEEKDAYS[p.weekday]} ${p.d} ${MONTHS[p.m - 1]}` : DASH
}

export function weekdayName(iso) {
  const p = parts(iso)
  return p ? WEEKDAYS[p.weekday] : DASH
}

/** 09:02 (Cairo, 24h). */
export function fmtTime(iso) {
  if (!iso) return DASH
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? DASH : cairoTime.format(d)
}

// ── Portfolio today (tone of the sidebar % next to the label) ────────────────

/**
 * 'up' | 'down' | 'neutral', in the order the spec fixes: no holdings → neutral; no fresh
 * price for any holding → neutral; today == 0 (at the shown precision) → neutral.
 */
export function iconState(portfolio) {
  const holdings = portfolio && portfolio.holdings
  if (!holdings || !holdings.length) return 'neutral'
  const totals = portfolio.totals || {}
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

/** Volume and other large counts: 6.19M, 850K. */
export function fmtCompact(v) {
  if (missing(v)) return DASH
  const abs = Math.abs(v)
  const [div, unit] = abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'K'] : [1, '']
  const scaled = v / div
  return fmtNumber(scaled, !unit ? 0 : Math.abs(scaled) < 10 ? 2 : Math.abs(scaled) < 100 ? 1 : 0) + unit
}

// ── EGX session (Sun–Thu, 10:00–14:30 Cairo) ─────────────────────────────────

// Fallback only: the market API sends next_session from the holiday-aware Python calendar.
const TRADING = new Set([0, 1, 2, 3, 4]) // Sunday..Thursday (getUTCDay)

/**
 * The session line for the status strip, from the server's Cairo timestamp ("2026-10-15T09:02+03:00"):
 * { text, time } → «الجلسة مغلقة · تفتح اليوم» + «10:00», or «الجلسة مفتوحة · تغلق» + «14:30».
 */
export function sessionLine(asOf, open, nextSession) {
  if (open) return { text: 'الجلسة مفتوحة · تغلق', time: '14:30' }
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(asOf || '')
  if (!m) return { text: 'الجلسة مغلقة', time: null }
  const day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  const n = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nextSession || '')
  if (n) {
    const next = new Date(Date.UTC(+n[1], +n[2] - 1, +n[3]))
    const ahead = Math.round((next - day) / 86_400_000)
    const when = ahead <= 0 ? 'اليوم' : ahead === 1 ? 'غدًا' : WEEKDAYS[next.getUTCDay()]
    return { text: `الجلسة مغلقة · تفتح ${when}`, time: '10:00' }
  }
  const minutes = +m[4] * 60 + +m[5]
  if (TRADING.has(day.getUTCDay()) && minutes < 10 * 60) return { text: 'الجلسة مغلقة · تفتح اليوم', time: '10:00' }
  let ahead = 1
  const next = new Date(day)
  next.setUTCDate(next.getUTCDate() + 1)
  while (!TRADING.has(next.getUTCDay())) { next.setUTCDate(next.getUTCDate() + 1); ahead++ }
  const when = ahead === 1 ? 'غدًا' : WEEKDAYS[next.getUTCDay()]
  return { text: `الجلسة مغلقة · تفتح ${when}`, time: '10:00' }
}

/** Price position (0–100) inside its 52-week range; null when the range is unknown. */
export function rangePosition(low, high, price) {
  if (missing(low) || missing(high) || missing(price) || high <= low) return null
  return Math.min(100, Math.max(0, ((price - low) / (high - low)) * 100))
}

export const RATING_LEVEL = { safe: 1, balanced: 2, high_risk: 3 }
export const RATING_LABEL = { safe: 'آمن', balanced: 'متوازن', high_risk: 'مرتفع المخاطر' }

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
 * The execution date typed as «يوم/شهر/سنة» (or ISO). Empty → null (the server keeps it empty and
 * the UI reads that as today). Returns 'YYYY-MM-DD', null, or undefined when it is not a real date.
 */
export function parseDayInput(text) {
  const raw = String(text || '').trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  if (!raw) return null
  let y, m, d
  let match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(raw)
  if (match) { [, d, m, y] = match.map(Number) } else if ((match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw))) { [, y, m, d] = match.map(Number) } else return undefined
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return undefined
  return `${y}-${two(m)}-${two(d)}`
}

// ── EODHD daily limit ────────────────────────────────────────────────────────
// EODHD resets the daily API-call counter at midnight GMT (eodhd.com/financial-apis/api-limits).
// The Cairo clock time of that reset moves with Egypt's daylight saving, so it is computed.

/** The last reset before `now` (a Date or ISO string), as a Date. */
export function lastLimitReset(now) {
  const t = new Date(now)
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()))
}

/** { when: 'اليوم' | 'بكره', time: 'HH:MM' } for the next reset, in Cairo time. */
export function nextLimitReset(now) {
  const next = new Date(lastLimitReset(now).getTime() + 864e5)
  const today = cairoDay(new Date(now).toISOString())
  return { when: cairoDay(next.toISOString()) === today ? 'اليوم' : 'بكره', time: fmtTime(next.toISOString()) }
}

// ── Market data (/egx/api/market) ─────────────────────────────────────────────

/** Latest close date (YYYY-MM-DD) among the priced rows; '' when none is priced. */
export function lastCloseOf(rows) {
  return (rows || []).reduce((m, r) => (r.price != null && r.as_of && r.as_of.slice(0, 10) > m ? r.as_of.slice(0, 10) : m), '')
}

/** Price-provider calls used today by the last sync run (before it + by it); null without a run or limit. */
export function callsUsed(run) {
  return run && run.daily_limit ? (run.used_before || 0) + (run.calls_made || 0) : null
}
