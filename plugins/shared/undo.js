// Deleting a line with «تراجع» (docs/الواجهة.md §٦): the line hides at once, a toast offers «تراجع»
// for 6 seconds, and only then is it deleted. Leaving the page (or hiding it) deletes what is
// waiting, so nothing is lost silently. Where nothing animates (the tests) the delete happens at
// once, unless globalThis.__MONOS_UNDO_MS__ sets a window.
import { pageShared, useEffect, useState } from './runtime.js'
import { liveDom } from './motion.js'
import { toasts } from './toast.js'

export const UNDO_MS = 6000
const undoMs = () => globalThis.__MONOS_UNDO_MS__ ?? (liveDom() ? UNDO_MS : 0)

export const pending = pageShared('pending-deletes', () => {
  const store = {
    keys: new Set(), subscribers: new Set(), waiting: new Map(),
    notify() { for (const fn of this.subscribers) fn(new Set(this.keys)) },
    flush() { for (const run of [...this.waiting.values()]) run() },
  }
  globalThis.document?.addEventListener?.('visibilitychange', () => { if (document.visibilityState === 'hidden') store.flush() })
  globalThis.addEventListener?.('pagehide', () => store.flush())
  return store
})

/** Hide `key` now, run `commit` after the undo window; a failed commit brings it back with its reason. */
export function deleteWithUndo(key, text, commit) {
  const ms = undoMs()
  const fail = (e) => toasts.push(`مش هينفع تتمسح: ${e.message}`, null, 8000)
  if (!ms) return Promise.resolve().then(commit).catch(fail)
  pending.keys.add(key)
  pending.notify()
  let timer = 0
  const done = () => { clearTimeout(timer); pending.waiting.delete(key); pending.keys.delete(key); pending.notify() }
  const run = () => { pending.waiting.delete(key); Promise.resolve().then(commit).catch(fail).finally(done) }
  timer = setTimeout(run, ms)
  pending.waiting.set(key, () => { clearTimeout(timer); run() })
  toasts.push(text, { label: 'تراجع', run: done }, ms)
  return Promise.resolve()
}

/** The keys waiting to be deleted (their lines hide). */
export function usePendingKeys() {
  const [keys, setKeys] = useState(pending.keys)
  useEffect(() => { pending.subscribers.add(setKeys); return () => { pending.subscribers.delete(setKeys) } }, [])
  return keys
}

export const usePending = (key) => usePendingKeys().has(key)
