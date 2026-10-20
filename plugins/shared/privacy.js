// «إخفاء الأرقام»: one switch for the whole page, for screen sharing. When it is on, every amount,
// percentage and quantity of the ledger (and the sidebar row's today %) reads «•••••»; names, logos
// and layout stay. One store for the page (pageShared), so the header button and the sidebar row
// agree although they are different plugins. The choice is remembered across restarts in
// localStorage; without storage (a private window) it simply lives until the page closes.
import { h, pageShared, useEffect, useState } from './runtime.js'

export const MASK = '•••••'
const STORAGE_KEY = 'monos.privacy.hidden'

function readStored() {
  try { return globalThis.localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}
function writeStored(hidden) {
  try { globalThis.localStorage.setItem(STORAGE_KEY, hidden ? '1' : '0') } catch { /* no storage: the choice lasts until the page closes */ }
}

export const privacy = pageShared('privacy', () => ({
  hidden: readStored(),
  listeners: new Set(),
  set(next) {
    const hidden = Boolean(next)
    if (hidden === this.hidden) return
    this.hidden = hidden
    writeStored(hidden)
    this.listeners.forEach((listener) => listener())
  },
  toggle() { this.set(!this.hidden) },
}))

/** True while the numbers are hidden; the component re-renders when the switch flips. */
export function usePrivacy() {
  const [, bump] = useState(0)
  useEffect(() => {
    const listener = () => bump((n) => n + 1)
    privacy.listeners.add(listener)
    return () => { privacy.listeners.delete(listener) }
  }, [])
  return privacy.hidden
}

/** The text to show for `shown`: the mask while hidden, `shown` itself otherwise. */
export const masked = (hidden, shown) => (hidden ? MASK : shown)

const EYE = 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z'

/** The eye button for the panel header: pressed = numbers hidden. */
export function PrivacyToggle() {
  const hidden = usePrivacy()
  const label = hidden ? 'إظهار الأرقام' : 'إخفاء الأرقام'
  return h('button', {
    type: 'button', className: 'q-btn q-btn-quiet', 'aria-pressed': hidden, 'aria-label': label, title: label,
    style: { width: 32, padding: 0, display: 'inline-grid', placeItems: 'center' },
    onClick: () => privacy.toggle(),
  },
  h('svg', {
    width: 18, height: 18, viewBox: '0 0 24 24', 'aria-hidden': true, fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'block' },
  },
  h('path', { d: EYE }), h('circle', { cx: 12, cy: 12, r: 3 }),
  hidden ? h('path', { d: 'M4 4l16 16' }) : null))
}
