// Motion for every Monos screen (docs/الواجهة.md): durations, easings and a few helpers, no
// dependencies. Everything degrades to the final state at once where the engine cannot animate
// (jsdom in the tests has no Web Animations API): no timers, no frames, no state changed later.
import { React, h, useLayoutEffect, useRef, useState } from './runtime.js'

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

/** Counts the one text node of `ref` from the value last shown to `value` (easeOutQuart). React keeps
 *  owning the node: only its nodeValue changes between commits, and it always ends on React's text.
 *  A frame budget ends it even where frame timestamps do not move. */
export function useCountUp(ref, value, format, { duration = DUR.slow, disabled = false } = {}) {
  const shown = useRef(value)
  useLayoutEffect(() => {
    const from = shown.current
    shown.current = value
    const el = ref.current
    const node = el && el.firstChild
    if (disabled || !canMove() || !node || node.nodeType !== 3 || from == null || value == null || Math.abs(value - from) < 1) return undefined
    const end = format(value)
    el.style.minWidth = `${end.length}ch`
    node.nodeValue = format(from)
    let raf = 0
    let t0 = 0
    let frames = 0
    const budget = Math.ceil(duration / 8)
    const step = (now) => {
      t0 ||= now
      const t = Math.min(1, (now - t0) / duration, ++frames / budget)
      node.nodeValue = t < 1 ? format(from + (value - from) * (1 - (1 - t) ** 4)) : end
      if (t < 1) raf = requestAnimationFrame(step)
      else el.style.minWidth = ''
    }
    raf = requestAnimationFrame(step)
    return () => { cancelAnimationFrame(raf); node.nodeValue = end; el.style.minWidth = '' }
  }, [value, disabled])
}

/** Children carrying data-flip="<key>" glide from where they were to where they are whenever
 *  `version` changes; a new one marked data-flip-enter fades in. Positions are read before React
 *  commits (getSnapshotBeforeUpdate) and relative to the nearest data-flip ancestor, so a moving
 *  group does not move its rows twice. */
export class FlipList extends React.Component {
  constructor(props) {
    super(props)
    this.box = React.createRef()
  }

  measure() {
    const root = this.box.current
    const out = new Map()
    if (!root) return out
    const rects = new Map()
    for (const el of root.querySelectorAll('[data-flip]')) rects.set(el, el.getBoundingClientRect())
    const top = root.getBoundingClientRect().top
    for (const [el, r] of rects) {
      const parent = el.parentElement && el.parentElement.closest('[data-flip]')
      out.set(el.dataset.flip, { el, y: r.top - (parent && rects.has(parent) ? rects.get(parent).top : top) })
    }
    return out
  }

  getSnapshotBeforeUpdate(prev) {
    return prev.version !== this.props.version && canMove() ? this.measure() : null
  }

  componentDidUpdate(_props, _state, before) {
    if (!before) return
    let i = 0
    for (const [key, { el, y }] of this.measure()) {
      const was = before.get(key)
      if (was) {
        const dy = was.y - y
        if (Math.abs(dy) >= 1) animate(el, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: DUR.large, easing: EASE.standard })
      } else if (el.hasAttribute('data-flip-enter')) {
        animate(el, [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }],
          { duration: DUR.base, easing: EASE.enter, delay: Math.min(i++, 5) * 30 })
      }
    }
  }

  render() {
    return h('div', { ref: this.box, className: this.props.className }, this.props.children)
  }
}
