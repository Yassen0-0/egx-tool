// The logo circle beside every asset (search results and ledger rows): the company's own mark when
// shared/logos/ has it, otherwise the asset's letters (USD, Au, ₿, the first letters of a name) on
// the same circle, so the column lines up whatever is missing.
import { h } from './runtime.js'
import { LOGOS } from './logos/index.js'

export function Logo({ symbol, mark, size = 32 }) {
  const svg = symbol ? LOGOS[symbol] : null
  const style = { width: size, height: size }
  if (svg) {
    return h('img', { className: 'l-logo', alt: '', style, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` })
  }
  const text = String(mark || '?')
  return h('span', { className: `l-logo l-mark${text.length > 2 ? ' l-mark-3' : ''}`, 'aria-hidden': true, style }, text)
}
