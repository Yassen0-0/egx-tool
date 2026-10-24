// Small pieces shared by the screens.
import { h } from './runtime.js'

/** A light placeholder bar while data loads. */
export function Skeleton({ width = 80, height, radius }) {
  return h('span', { className: 'q-skel', style: { width, height, borderRadius: radius } })
}

/** A row-shaped placeholder: logo, two lines, a value. */
export function SkeletonRow() {
  return h('div', { className: 'q-skel-row' },
    h(Skeleton, { width: 32, height: 32, radius: '50%' }),
    h('span', { className: 'q-stack', style: { flex: 1, gap: 8 } }, h(Skeleton, { width: 140, height: 12 }), h(Skeleton, { width: 90 })),
    h(Skeleton, { width: 70, height: 12 }))
}

/** The ledger's shape while it loads: the hero, its figures, five rows. */
export function SkeletonPage() {
  return h('div', { className: 'q-skel-page' },
    h('div', { className: 'l-total' }, h(Skeleton, { width: 90 }), h(Skeleton, { width: 240, height: 36 }), h(Skeleton, { width: 180 }),
      h('div', { className: 'q-row', style: { gap: 24, marginTop: 8 } }, h(Skeleton, { width: 90, height: 20 }), h(Skeleton, { width: 90, height: 20 }), h(Skeleton, { width: 90, height: 20 }))),
    h('div', { className: 'l-list', style: { padding: '8px 16px' } }, [0, 1, 2, 3, 4].map((i) => h(SkeletonRow, { key: i }))))
}

/** The row's open/closed mark: points to the inline end when closed, down when open (CSS rotates it). */
export function Chevron() {
  return h('svg', { className: 'l-chev', width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true },
    h('path', { d: 'M3 4.5 6 7.5 9 4.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))
}
