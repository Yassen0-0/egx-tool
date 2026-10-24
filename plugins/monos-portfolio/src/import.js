// «استيراد CSV»: a quiet button beside «تصدير CSV». The chosen file is read as text and sent to Python
// (/egx/api/import → mcp/egx_mcp/store/importer.py), which answers with what it would add and leave
// out; nothing is written until «ضيفهم» sends the same file again with apply. ES module.
import { N, api, frag, h, useState } from '../../shared/runtime.js'

export function ImportButton({ onDone }) {
  const [file, setFile] = useState(null)
  const [plan, setPlan] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const send = (text, apply) => api('POST', '/egx/api/import', { csv: text, apply })
  const pick = async (e) => {
    const chosen = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!chosen) return
    setError(''); setPlan(null); setBusy(true)
    try {
      const text = await chosen.text()
      setFile(text)
      setPlan(await send(text, false))
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const apply = async () => {
    setBusy(true); setError('')
    try { await send(file, true); setPlan(null); setFile(null); onDone() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const close = () => { setPlan(null); setFile(null); setError('') }
  const c = plan && plan.counts
  return frag(
    error ? h('span', { className: 'q-error', role: 'alert' }, error) : null,
    h('label', { className: 'q-btn q-btn-sm q-btn-quiet l-import', 'aria-disabled': busy },
      'استيراد CSV', h('input', { type: 'file', accept: '.csv,text/csv', onChange: pick, disabled: busy, 'aria-label': 'اختار ملف CSV' })),
    plan ? h('div', { className: 'l-import-plan', role: 'dialog', 'aria-label': 'استيراد CSV' },
      h('b', null, 'اللي في الملف'),
      h('p', null, 'هيتضاف ', N(String(c.lots)), ' عملية شرا و', N(String(c.movements)), ' حركة',
        c.new_assets ? frag(' و', N(String(c.new_assets)), ' أصل جديد بالاسم') : null, '.'),
      c.skipped ? h('details', null, h('summary', null, 'هيتساب ', N(String(c.skipped))),
        h('ul', null, plan.skipped.map((s, i) => h('li', { key: i }, s.what ? `${s.what}: ` : '', s.reason)))) : null,
      h('div', { className: 'l-actions' },
        c.lots || c.movements ? h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-p', disabled: busy, onClick: apply }, 'ضيفهم') : null,
        h('button', { type: 'button', className: 'q-btn q-btn-sm q-btn-quiet', onClick: close }, c.lots || c.movements ? 'إلغاء' : 'تمام'))) : null)
}
