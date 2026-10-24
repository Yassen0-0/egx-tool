// Motion for every Monos screen (docs/الواجهة.md): durations, easings and a few helpers, no
// dependencies. Everything degrades to the final state at once where the engine cannot animate
// (jsdom in the tests has no Web Animations API): no timers, no frames, no state changed later.
import { h, useLayoutEffect, useRef, useState } from './runtime.js'

export const DUR = { press: 80, micro: 120, small: 180, base: 240, large: 320, slow: 600 }
export const EASE = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)', enter: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  exit: 'cubic-bezier(0.3, 0, 0.8, 0.15)', spring: 'cubic-bezier(0.34, 1.3, 0.64, 1)',
}

/** A real engine: the Web Animations API exists and nobody switched motion off
 *  (globalThis.__MONOS_MOTION__ = false). */
export function liveDom() {
  if (globalThis.__MONOS_MOTION__ === false) return false
  const d = globalThis.document
  return Boolean(d && d.documentElement && typeof d.documentElement.animate === 'function')
}
export function reducedMotion() {
  try { return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}
/** Travel, scale, counting and drawing. */
export const canMove = () => liveDom() && !reducedMotion()
/** Opacity only: still allowed when motion is reduced. */
export const canFade = liveDom

/** el.animate, or null where it cannot run. */
export function animate(el, keyframes, options) {
  if (!el || !liveDom()) return null
  try { return el.animate(keyframes, options) } catch { return null }
}

/** Open: mounted and grown to its height. Closed: shrunk, then unmounted (its text leaves the page).
 *  Where nothing can animate it is a plain conditional. The wrapper is the element the caller
 *  places (a row's next sibling stays this wrapper, with the content inside it). */
export function Collapse({ open, className = '', children, ...rest }) {
  const box = useRef(null)
  const kept = useRef(children)
  if (open) kept.current = children
  const [exiting, setExiting] = useState(false)
  const [was, setWas] = useState(open)
  if (was !== open) {  // derived state, set while rendering (React's documented pattern)
    setWas(open)
    setExiting(!open && canFade())
  }
  useLayoutEffect(() => {
    const el = box.current
    if (!el || !canFade()) return undefined
    if (open) {
      el.dataset.state = 'closed'
      void el.offsetHeight  // start from closed, then let the transition run to open
      el.dataset.state = 'open'
      const t = setTimeout(() => { delete el.dataset.state }, DUR.base + 40)
      return () => clearTimeout(t)
    }
    el.dataset.state = 'closed'
    const t = setTimeout(() => setExiting(false), (canMove() ? DUR.base : DUR.micro) + 40)
    return () => clearTimeout(t)
  }, [open])
  if (!open && !exiting) return null
  return h('div', { ref: box, className: `q-collapse${className ? ` ${className}` : ''}`, ...(open ? {} : { inert: '' }), ...rest },
    h('div', { className: 'q-collapse-in' }, open ? children : kept.current))
}

/** A one-shot tint on a row that just arrived or was jumped to (its ::after). */
export function land(el) {
  return animate(el, [{ opacity: canMove() ? 0.55 : 0.35 }, { opacity: 0 }],
    { duration: canMove() ? 1200 : 600, easing: 'ease-out', pseudoElement: '::after' })
}
