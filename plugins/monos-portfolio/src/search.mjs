// «السجل» search: pure functions over the catalog the screen loads once (/egx/api/catalog), so the
// results follow every keystroke without a round trip. Imported directly by plugins/test/search.test.mjs.

export const MAX_RESULTS = 6

/**
 * Folds what people type to one spelling: Latin lower case; Arabic without diacritics or tatweel;
 * أ/إ/آ/ٱ → ا, ى → ي, ة → ه, ؤ → و, ئ → ي; Arabic-Indic digits as Latin («٢١» finds «21»); and «ال»
 * dropped from the start of a word («التجاري» finds «تجاري»).
 */
export function normalize(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .split(/\s+/).filter(Boolean)
    .map((word) => (word.startsWith('ال') && word.length > 3 ? word.slice(2) : word))
    .join(' ')
}

/** 0 = the symbol, key or an alias exactly; 1 = a name or alias (or one of its words) starts with
 * the query; 2 = it appears inside one; 3 = each of its words starts a word in one; null = no match. */
export function rank(entry, query) {
  const q = normalize(query)
  if (!q) return null
  const exact = [entry.symbol, entry.key, ...(entry.aliases || [])].filter(Boolean).map(normalize)
  if (exact.includes(q)) return 0
  const texts = [entry.name, entry.name_en, ...(entry.aliases || [])].filter(Boolean).map(normalize)
  if (texts.some((t) => t.startsWith(q) || t.split(' ').some((w) => w.startsWith(q)))) return 1
  if (texts.some((t) => t.includes(q))) return 2
  // «بلتون ذهب»: every word starts a word somewhere in the names and aliases.
  const words = texts.flatMap((t) => t.split(' '))
  if (q.includes(' ') && q.split(' ').every((part) => words.some((w) => w.startsWith(part)))) return 3
  return null
}

const KIND_ORDER = { currency: 0, gold: 1, bitcoin: 2, stock: 3, fund: 4 }

/** Up to MAX_RESULTS matches, best first; nothing for an empty query (the list is not a browser). */
export function search(entries, query, limit = MAX_RESULTS) {
  const hits = []
  ;(entries || []).forEach((entry, index) => {
    const r = rank(entry, query)
    if (r !== null) hits.push([r, index, entry])
  })
  // Ties keep the catalog's order, which puts the usual choice first (21 karat gold by the gram first).
  hits.sort((a, b) => a[0] - b[0] || (KIND_ORDER[a[2].kind] ?? 9) - (KIND_ORDER[b[2].kind] ?? 9) || a[1] - b[1])
  return hits.slice(0, limit).map(([, , entry]) => entry)
}
