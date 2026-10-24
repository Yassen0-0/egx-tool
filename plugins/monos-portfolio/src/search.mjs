// «السجل» search: pure functions over the catalog the screen loads once (/egx/api/catalog), so the
// results follow every keystroke without a round trip. The same rules as the assistant's search
// (mcp/egx_mcp/catalog/__init__.py). Imported directly by plugins/test/search.test.mjs.

export const MAX_RESULTS = 6

/**
 * Folds what people type to one spelling: Latin lower case; Arabic without diacritics or tatweel;
 * أ/إ/آ/ٱ → ا, ى → ي, ة → ه, ؤ → و, ئ → ي; Arabic-Indic digits as Latin («٢١» finds «21»); «ال»
 * dropped from the start of a word («التجاري» finds «تجاري»); dashes, dots, slashes and brackets as
 * spaces («b-secure» finds «B Secure»).
 */
export function normalize(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[-_./\\()[\],،:؛;]+/g, ' ')
    .split(/\s+/).filter(Boolean)
    .map((word) => (word.startsWith('ال') && word.length > 3 ? word.slice(2) : word))
    .join(' ')
}

// Words that say what kind of thing it is, not which: dropped from a longer query («صندوق بلتون»).
const FILLER = new Set(['صندوق', 'fund', 'سهم', 'شركه', 'وثيقه', 'وثايق'])
// The same key on the Arabic and the English keyboard: «ؤخةه» is «comi» typed in the wrong language.
const AR_KEYS = 'ضصثقفغعهخحجدشسيبلاتنمكطئءؤرىةوزظ'
const EN_KEYS = "qwertyuiop[]asdfghjkl;'zxcvnm,./"
const LAYOUT = new Map([...[...AR_KEYS].map((c, i) => [c, EN_KEYS[i]]), ...[...EN_KEYS].map((c, i) => [c, AR_KEYS[i]]), ['b', 'لا']])

/** Edit distance counting a swap of two neighbours as one edit («بلتنو» → «بلتون»). */
function osa(a, b) {
  let prev2 = null
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1)
    }
    prev2 = prev
    prev = cur
  }
  return prev[b.length]
}

/** How many edits a typo is from the word or its start; null when it is too far to be one (one edit
 * in a short word, two in a long one, nothing under three letters). */
function typo(part, word) {
  if (word.startsWith(part)) return 0
  if (part.length < 3) return null
  const d = Math.min(osa(part, word), osa(part, word.slice(0, part.length)))
  return d <= (part.length <= 5 ? 1 : 2) ? d : null
}

/** 0 = the symbol, key or an alias exactly; 1 = a name, alias or tag has the query from the start of
 * one of its words; 2 = it appears inside one; 3 = each of its words starts a word in one; 4 and up =
 * a typo away, the fewer edits the better; null = no match. */
export function rank(entry, query) {
  const q = normalize(query)
  if (!q) return null
  const exact = [entry.symbol, entry.key, ...(entry.aliases || [])].filter(Boolean).map(normalize)
  if (exact.includes(q)) return 0
  const texts = [entry.name, entry.name_en, ...(entry.aliases || []), ...(entry.tags || [])].filter(Boolean).map(normalize)
  if (texts.some((t) => ` ${t}`.includes(` ${q}`))) return 1
  if (texts.some((t) => t.includes(q))) return 2
  const words = [...new Set([...texts, ...exact].flatMap((t) => t.split(' ')))]
  const all = q.split(' ')
  const parts = all.filter((p) => !FILLER.has(p))
  const asked = parts.length ? parts : all
  // «بلتون ذهب»: every word starts a word somewhere in the names and aliases.
  if (asked.every((p) => words.some((w) => w.startsWith(p)))) return 3
  // Typos: «بلتوون», «سبايك», «azimot»; and the spaces left out or added («ميامية»).
  const edits = asked.map((p) => {
    const ds = words.map((w) => typo(p, w)).filter((d) => d !== null)
    return ds.length ? Math.min(...ds) : null
  })
  if (!edits.includes(null)) return 4 + edits.reduce((s, d) => s + d, 0) / 10
  const joined = q.replace(/ /g, '')
  const spaced = joined.length >= 4 ? texts.map((t) => typo(joined, t.replace(/ /g, ''))).filter((d) => d !== null) : []
  return spaced.length ? 4 + Math.min(...spaced) / 10 : null
}

const KIND_ORDER = { currency: 0, gold: 1, bitcoin: 2, stock: 3, fund: 4 }

function ranked(entries, query) {
  const hits = []
  ;(entries || []).forEach((entry, index) => {
    const r = rank(entry, query)
    if (r !== null) hits.push([r, index, entry])
  })
  return hits
}

/** Up to MAX_RESULTS matches, best first; nothing for an empty query (the list is not a browser). */
export function search(entries, query, limit = MAX_RESULTS) {
  if (!normalize(query)) return []
  let hits = ranked(entries, query)
  // Nothing at all: maybe it was typed with the keyboard in the other language.
  if (!hits.length) hits = ranked(entries, [...String(query).toLowerCase()].map((c) => LAYOUT.get(c) ?? c).join(''))
  if (hits.some(([r]) => r <= 2)) hits = hits.filter(([r]) => r < 4)  // a close match makes the typo guesses noise
  // Ties keep the catalog's order, which puts the usual choice first (21 karat gold by the gram first).
  hits.sort((a, b) => a[0] - b[0] || (KIND_ORDER[a[2].kind] ?? 9) - (KIND_ORDER[b[2].kind] ?? 9) || a[1] - b[1])
  return hits.slice(0, limit).map(([, , entry]) => entry)
}
