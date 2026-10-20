// Small pieces shared by the screens.
import { h } from './runtime.js'

/** A light placeholder bar while data loads. */
export function Skeleton({ width = 80 }) {
  return h('span', { className: 'q-skel', style: { width } })
}
