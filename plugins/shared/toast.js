// A short message after a save («اتسجّلت العملية» · «افتح»), one page-wide store so any form can
// push one. It fades out after 5s where the engine animates; in jsdom it simply stays (no timer runs).
import { h, pageShared, useEffect, useState } from './runtime.js'
import { liveDom } from './motion.js'

const MAX = 3
export const toasts = pageShared('toasts', () => ({
  items: [], next: 1, subscribers: new Set(),
  push(text, action) {
    const id = this.next++
    this.items = [...this.items.slice(-(MAX - 1)), { id, text, action }]
    this.notify()
    if (liveDom()) setTimeout(() => this.dismiss(id), 5000)
    return id
  },
  dismiss(id) { this.items = this.items.filter((t) => t.id !== id); this.notify() },
  notify() { for (const fn of this.subscribers) fn(this.items) },
}))

export function Toasts() {
  const [items, setItems] = useState(toasts.items)
  useEffect(() => { toasts.subscribers.add(setItems); return () => { toasts.subscribers.delete(setItems) } }, [])
  return h('div', { className: 'q-toasts', role: 'status', 'aria-live': 'polite' },
    items.map((t) => h('div', { key: t.id, className: 'q-toast' },
      h('span', null, t.text),
      t.action ? h('button', { type: 'button', className: 'q-link', onClick: () => { toasts.dismiss(t.id); t.action.run() } }, t.action.label) : null,
      h('button', { type: 'button', className: 'q-toast-x', 'aria-label': 'قفل', onClick: () => toasts.dismiss(t.id) }, '×'))))
}
