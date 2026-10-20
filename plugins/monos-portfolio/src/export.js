// «تصدير CSV»: a quiet button in the ledger's header. The CSV text is built in Python
// (/egx/api/export, mcp/egx_mcp/store/export.py); here it is only handed to the browser as a download.
import { api, frag, h, useState } from '../../shared/runtime.js'

/** Saves `text` as `filename` through a Blob and a temporary link. */
function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ExportButton() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async () => {
    setBusy(true)
    setError('')
    try {
      const { filename, csv } = await api('GET', '/egx/api/export')
      if (typeof csv !== 'string') throw new Error('empty')
      download(filename || 'monos-ledger.csv', csv)
    } catch {
      setError('تعذّر التصدير، حاول مرة تانية')
    } finally {
      setBusy(false)
    }
  }
  return frag(
    error ? h('span', { className: 'q-error', role: 'alert' }, error) : null,
    h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-quiet', disabled: busy, onClick: run }, 'تصدير CSV'))
}
