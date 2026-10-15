// Source of client.js (run `node build-client.mjs`). EGX panels for the Harness
// Web/Desktop client: sidebar entries plus pages in the main area. Data comes from
// the host half's /egx/api routes, which run the same Python logic as the
// mcp__egx__* tools. LightweightCharts is inlined by the build at the marker below.
window.__ModuleLoader__.load({
  id: 'dsh-egx-bundle',
  factory(require) {
    /* @inline lightweight-charts */
    /* @inline format.mjs */
    const React = require('react')
    const { useState, useEffect, useCallback } = React
    const h = React.createElement
    const PANEL_ID = 'egx-portfolio'
    const ANALYSES_ID = 'egx-analyses'
    const MARKET_ID = 'egx-market'
    // Cross-panel navigation: set by apply() when the layout service is available.
    const nav = { selectPanel: null, pendingAnalysisId: null }

    const QM_CSS = '/* @css styles.css */'
    // One LTR-isolated span per number: sign, digits and % never get split by the bidi algorithm.
    const N = (text, cls) => h('span', { className: cls ? `num ${cls}` : 'num' }, text)
    const num = { format: (v) => fmtNumber(v, 2) }
    const qtyFmt = { format: fmtQty }
    const pct = { format: (v) => fmtPct(v, { signed: true }) }
    const weightFmt = { format: (v) => fmtPct(v) }
    const RATING = { safe: 'آمن', balanced: 'متوازن', high_risk: 'مرتفع المخاطر' }
    const STATUS = {
      above_fair_value: 'أعلى من السعر العادل',
      at_or_below_fair_value: 'بين سعر الحماية والسعر العادل',
      below_protection: 'تحت سعر الحماية — يحتاج مراجعة',
    }
    const money = (v) => (v == null ? '—' : N(fmtPrice(v)))
    const moneySigned = (v) => (v == null ? '—' : N(fmtSigned(v), toneOf(v)))
    const pctSigned = (v) => (v == null ? '—' : N(fmtPct(v, { signed: true }), toneOf(v)))
    const dayFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', timeZone: 'UTC' })
    const fmtDay = (iso) => (iso ? dayFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : '—')
    const tone = toneOf
    // «أقل من العادل بـ 6.9%»: words, then the number in its own span; the sentence ends on it.
    const marginParts = (price, fair) => {
      const m = marginSentence(price, fair)
      if (!m) return []
      return [m.mark, ' ', m.text, m.value ? ' ' : null, m.value ? N(m.value) : null]
    }

    async function api(method, path, body) {
      const init = { method, headers: {} }
      if (body !== undefined) {
        init.headers['content-type'] = 'application/json'
        init.headers['x-egx-request'] = '1'
        init.body = JSON.stringify(body)
      }
      const res = await fetch(path, init)
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (!res.ok || (data && data.error)) throw new Error(data.error || `HTTP ${res.status}`)
      return data
    }

    /* @inline identity.js */

    const CSS = `
.egxp-page { height: 100%; overflow: auto; box-sizing: border-box; padding: 0 clamp(24px, 4vw, 48px) 48px;
  color: var(--dsw-alias-label-primary); display: flex; flex-direction: column; align-items: center; gap: 24px; }
.egxp-page > * { width: 100%; max-width: 1100px; }
.egxp-head { padding-top: 28px; display: flex; flex-direction: column; gap: 4px; }
[data-platform='darwin'] .egxp-head { padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px)); }
.egxp-title { margin: 0; font-size: 20px; font-weight: 500; line-height: 28px; }
.egxp-intro { margin: 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.egxp-cards { display: flex; flex-wrap: wrap; gap: 12px 0; padding: 4px 0 14px; border-bottom: 1px solid var(--dsw-alias-border-l3); }
.egxp-card { padding: 0 20px; border-inline-start: 1px solid var(--dsw-alias-border-l3); min-width: 140px; }
.egxp-card:first-child { padding-inline-start: 0; border-inline-start: 0; }
.egxp-card-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.egxp-card-value { font-size: 18px; font-weight: 500; margin-top: 2px; font-variant-numeric: tabular-nums; }
.egxp-card-note { font-size: 12px; color: var(--dsw-alias-label-tertiary); margin-top: 2px; }
.egxp-section { border: 1px solid var(--dsw-alias-border-l3); border-radius: 12px; padding: 16px; }
.egxp-section-title { margin: 0 0 12px; font-size: 14px; font-weight: 500; }
.egxp-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; align-items: end; }
.egxp-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.egxp-input { font: inherit; font-size: 13px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 6px 10px; min-width: 0; height: 32px; box-sizing: border-box; }
.egxp-input:focus-visible, .egxp-btn:focus-visible, .egxp-seg button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.egxp-seg { display: flex; gap: 2px; padding: 2px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; height: 32px; box-sizing: border-box; }
.egxp-seg button { flex: 1; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.egxp-seg button[aria-pressed='true'] { background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); }
.egxp-btn { font: inherit; font-size: 13px; height: 32px; padding: 0 14px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); }
.egxp-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.egxp-btn-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); border-color: transparent; }
.egxp-btn-primary:hover { background: var(--dsw-alias-button-primary-hover); }
.egxp-btn-small { height: 26px; padding: 0 10px; font-size: 12px; }
.egxp-btn-danger:hover { background: var(--dsw-alias-interactive-bg-hover-danger); color: var(--dsw-alias-state-error-primary); }
.egxp-btn:disabled { opacity: .55; cursor: default; }
.egxp-error { color: var(--dsw-alias-file-diff-deleted-marker); font-size: 13px; margin-top: 8px; }
.egxp-table-wrap { overflow-x: auto; }
.egxp-table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
.egxp-table th { font-weight: 500; font-size: 12px; color: var(--dsw-alias-label-secondary); text-align: start; padding: 8px; white-space: nowrap; border-bottom: 1px solid var(--dsw-alias-border-l3); }
.egxp-table td { padding: 10px 8px; border-bottom: 1px solid var(--dsw-alias-border-l4); white-space: nowrap; vertical-align: middle; }
.egxp-table tr:last-child td { border-bottom: 0; }
.egxp-num { text-align: end !important; }
.egxp-sym { font-weight: 500; }
.egxp-sub { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.egxp-badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 500; border: 1px solid currentColor; }
.egxp-safe, .egxp-balanced, .egxp-high_risk { color: var(--dsw-alias-label-secondary); }
.egxp-status-below_protection { color: var(--dsw-alias-state-warn-label); font-weight: 600; }
.egxp-status-at_or_below_fair_value, .egxp-status-above_fair_value { color: var(--dsw-alias-label-secondary); }
.egxp-empty { padding: 24px 8px; text-align: center; color: var(--dsw-alias-label-tertiary); }
.egxp-actions { display: flex; gap: 6px; }
.egxp-cell-input { width: 90px; }
.egxp-foot { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.egxp-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin-bottom: 12px; }
.egxp-filters .egxp-field { min-width: 140px; }
.egxp-row-link { cursor: pointer; }
.egxp-row-link:hover td { background: var(--dsw-alias-interactive-bg-hover); }
.egxp-reason { max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
.egxp-back { align-self: flex-start; }
.egxp-chart { height: 260px; direction: ltr; }
.egxp-grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
.egxp-kv { width: 100%; border-collapse: collapse; font-size: 13px; }
.egxp-kv td { padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l4); vertical-align: top; }
.egxp-kv td:first-child { color: var(--dsw-alias-label-secondary); white-space: nowrap; width: 40%; }
.egxp-check-pass { color: var(--dsw-alias-label-secondary); }
.egxp-check-warn, .egxp-check-fail { color: var(--dsw-alias-state-warn-label); font-weight: 600; }
.egxp-pre { white-space: pre-wrap; font-size: 13px; line-height: 1.7; margin: 0; }
.egxp-md { font-size: 14px; line-height: 1.8; }
.egxp-md h1 { font-size: 18px; font-weight: 500; margin: 8px 0; }
.egxp-md h2 { font-size: 16px; font-weight: 500; margin: 16px 0 6px; }
.egxp-md h3 { font-size: 14px; font-weight: 500; margin: 12px 0 4px; }
.egxp-md p { margin: 6px 0; }
.egxp-md ul, .egxp-md ol { margin: 6px 0; padding-inline-start: 22px; }
.egxp-md blockquote { margin: 8px 0; padding: 6px 12px; border-inline-start: 3px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }
.egxp-md code { font-size: 12px; padding: 1px 5px; border-radius: 4px; background: var(--dsw-alias-bg-layer-3); }
.egxp-md table { border-collapse: collapse; margin: 8px 0; font-size: 13px; }
.egxp-md th, .egxp-md td { border: 1px solid var(--dsw-alias-border-l3); padding: 4px 10px; text-align: start; }
.egxp-md hr { border: 0; border-top: 1px solid var(--dsw-alias-border-l3); margin: 12px 0; }
.egxp-legend { display: flex; gap: 16px; font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 6px; }
.egxp-swatch { display: inline-block; width: 12px; height: 3px; border-radius: 2px; vertical-align: middle; margin-inline-end: 4px; }
`

    function PortfolioIcon({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      },
      h('path', { d: 'M4 7.5A2.5 2.5 0 0 1 6.5 5H18a1 1 0 0 1 1 1v2' }),
      h('rect', { x: 3.5, y: 8, width: 17, height: 11, rx: 2.5 }),
      h('path', { d: 'M16 13.5h2' }),
      h('path', { d: 'M7 16l2.5-2.5 2 1.5L14 12' }))
    }

    function Cards({ totals }) {
      const unpriced = totals.unpriced_holdings
      return h('div', { className: 'egxp-cards' },
        h('div', { className: 'egxp-card' },
          h('div', { className: 'egxp-card-label' }, 'إجمالي التكلفة'),
          h('div', { className: 'egxp-card-value' }, money(totals.cost), ' ', h('span', { className: 'egxp-sub' }, 'ج.م'))),
        h('div', { className: 'egxp-card' },
          h('div', { className: 'egxp-card-label' }, 'القيمة الحالية'),
          h('div', { className: 'egxp-card-value' }, money(totals.market_value), ' ', h('span', { className: 'egxp-sub' }, 'ج.م'))),
        h('div', { className: 'egxp-card' },
          h('div', { className: 'egxp-card-label' }, 'الربح / الخسارة'),
          h('div', { className: 'egxp-card-value' }, moneySigned(totals.pnl),
            totals.pnl_pct == null ? null : h('span', { className: 'egxp-sub' }, ' ', pctSigned(totals.pnl_pct)))),
        h('div', { className: 'egxp-card' },
          h('div', { className: 'egxp-card-label' }, 'أسهم بدون سعر حالي'),
          h('div', { className: 'egxp-card-value' }, String(unpriced.length)),
          unpriced.length ? h('div', { className: 'egxp-card-note' }, `${unpriced.join('، ')} — بانتظار تحديث السوق`) : null))
    }

    function AddForm({ universe, onAdded }) {
      const [symbol, setSymbol] = useState('')
      const [buyPrice, setBuyPrice] = useState('')
      const [mode, setMode] = useState('amount')
      const [value, setValue] = useState('')
      const [buyDate, setBuyDate] = useState('')
      const [note, setNote] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')

      async function submit(event) {
        event.preventDefault()
        setError('')
        const price = Number(buyPrice), amount = Number(value)
        if (!symbol) return setError('اختر السهم.')
        if (!(price > 0)) return setError('أدخل سعر شراء أكبر من صفر.')
        if (!(amount > 0)) return setError(mode === 'amount' ? 'أدخل المبلغ المستثمر.' : 'أدخل عدد الأسهم.')
        const body = { symbol, buy_price: price, buy_date: buyDate || null, note: note || null }
        body[mode === 'amount' ? 'invested_amount' : 'quantity'] = amount
        setBusy(true)
        try {
          await api('POST', '/egx/api/holdings', body)
          setSymbol(''); setBuyPrice(''); setValue(''); setBuyDate(''); setNote('')
          onAdded()
        } catch (e) {
          setError(e.message)
        } finally {
          setBusy(false)
        }
      }

      const field = (label, control) => h('label', { className: 'egxp-field' }, label, control)
      return h('section', { className: 'egxp-section' },
        h('h2', { className: 'egxp-section-title' }, 'إضافة سهم'),
        h('form', { className: 'egxp-form', onSubmit: submit, noValidate: true },
          field('السهم', h('select', { className: 'egxp-input', value: symbol, onChange: (e) => setSymbol(e.target.value) },
            h('option', { value: '' }, 'اختر سهمًا'),
            universe.map((c) => h('option', { key: c.symbol, value: c.symbol }, `${c.symbol} — ${c.name}`)))),
          field('سعر الشراء (ج.م)', h('input', { className: 'egxp-input', type: 'number', inputMode: 'decimal', min: 0, step: 'any',
            value: buyPrice, onChange: (e) => setBuyPrice(e.target.value) })),
          h('div', { className: 'egxp-field' },
            h('div', { className: 'egxp-seg', role: 'group', 'aria-label': 'طريقة الإدخال' },
              h('button', { type: 'button', 'aria-pressed': mode === 'amount', onClick: () => setMode('amount') }, 'المبلغ المستثمر'),
              h('button', { type: 'button', 'aria-pressed': mode === 'quantity', onClick: () => setMode('quantity') }, 'عدد الأسهم')),
            h('input', { className: 'egxp-input', type: 'number', inputMode: 'decimal', min: 0, step: 'any', value,
              'aria-label': mode === 'amount' ? 'المبلغ المستثمر بالجنيه' : 'عدد الأسهم',
              placeholder: mode === 'amount' ? 'مثال: 5000' : 'مثال: 100', onChange: (e) => setValue(e.target.value) })),
          field('تاريخ الشراء (اختياري)', h('input', { className: 'egxp-input', type: 'date', value: buyDate, onChange: (e) => setBuyDate(e.target.value) })),
          field('ملاحظة (اختياري)', h('input', { className: 'egxp-input', type: 'text', maxLength: 200, value: note, onChange: (e) => setNote(e.target.value) })),
          h('button', { className: 'egxp-btn egxp-btn-primary', type: 'submit', disabled: busy }, busy ? 'جارٍ الإضافة…' : 'إضافة')),
        error ? h('div', { className: 'egxp-error', role: 'alert' }, error) : null)
    }

    function HoldingRow({ row, onChanged, onError }) {
      const [editing, setEditing] = useState(false)
      const [confirming, setConfirming] = useState(false)
      const [quantity, setQuantity] = useState(String(row.quantity))
      const [buyPrice, setBuyPrice] = useState(String(row.buy_price))
      const [busy, setBusy] = useState(false)

      async function run(action) {
        setBusy(true)
        try { await action(); onChanged() } catch (e) { onError(e.message) } finally { setBusy(false) }
      }
      const save = () => run(async () => {
        await api('PATCH', `/egx/api/holdings/${row.id}`, { quantity: Number(quantity), buy_price: Number(buyPrice) })
        setEditing(false)
      })
      const remove = () => run(() => api('DELETE', `/egx/api/holdings/${row.id}`, {}))

      const td = (content, numeric) => h('td', { className: numeric ? 'egxp-num' : undefined }, content)
      const sub = (text, cls) => h('div', { className: `egxp-sub ${cls || ''}` }, text)
      const actions = editing
        ? [h('button', { key: 's', className: 'egxp-btn egxp-btn-small egxp-btn-primary', disabled: busy, onClick: save }, 'حفظ'),
           h('button', { key: 'c', className: 'egxp-btn egxp-btn-small', onClick: () => setEditing(false) }, 'إلغاء')]
        : confirming
          ? [h('button', { key: 'd', className: 'egxp-btn egxp-btn-small egxp-btn-danger', disabled: busy, onClick: remove }, 'تأكيد الحذف'),
             h('button', { key: 'c', className: 'egxp-btn egxp-btn-small', onClick: () => setConfirming(false) }, 'إلغاء')]
          : [h('button', { key: 'e', className: 'egxp-btn egxp-btn-small', onClick: () => setEditing(true) }, 'تعديل'),
             h('button', { key: 'r', className: 'egxp-btn egxp-btn-small egxp-btn-danger', onClick: () => setConfirming(true) }, 'حذف')]

      return h('tr', null,
        td([h('div', { key: 's', className: 'egxp-sym' }, row.symbol), sub(row.name || '')]),
        td(editing ? h('input', { className: 'egxp-input egxp-cell-input', type: 'number', min: 0, step: 'any', value: quantity,
          'aria-label': 'الكمية', onChange: (e) => setQuantity(e.target.value) }) : N(qtyFmt.format(row.quantity)), true),
        td(editing ? h('input', { className: 'egxp-input egxp-cell-input', type: 'number', min: 0, step: 'any', value: buyPrice,
          'aria-label': 'سعر الشراء', onChange: (e) => setBuyPrice(e.target.value) }) : money(row.buy_price), true),
        td(money(row.cost), true),
        td([money(row.current_price), row.price_as_of ? sub(N(fmtDate(row.price_as_of))) : null], true),
        td(money(row.market_value), true),
        td([h('span', { key: 'p' }, moneySigned(row.pnl)),
          row.pnl_pct == null ? null : h('div', { key: 'q', className: 'egxp-sub' }, pctSigned(row.pnl_pct))], true),
        td(row.weight == null ? '—' : N(weightFmt.format(row.weight)), true),
        td(money(row.fair_value), true),
        td(money(row.protection_price), true),
        td(row.risk_rating
          ? h('span', { className: `egxp-badge egxp-${row.risk_rating}` }, RATING[row.risk_rating] || row.risk_rating)
          : h('span', { className: 'egxp-sub' }, 'لم يُقيَّم')),
        td(row.status ? h('span', { className: `egxp-status-${row.status}` }, STATUS[row.status] || row.status) : '—'),
        td(h('div', { className: 'egxp-actions' }, actions)))
    }

    function PortfolioPage() {
      const [data, setData] = useState(null)
      const [universe, setUniverse] = useState([])
      const [error, setError] = useState('')

      const load = useCallback(async () => {
        setError('')
        try {
          const next = await api('GET', '/egx/api/portfolio')
          setData(next)
          qima.set(next)
        } catch (e) { setError(e.message) }
      }, [])

      useEffect(() => {
        load()
        api('GET', '/egx/api/universe')
          .then((u) => setUniverse(u.constituents.slice().sort((a, b) => a.symbol.localeCompare(b.symbol))))
          .catch((e) => setError(`تعذّر تحميل قائمة الأسهم: ${e.message}`))
      }, [load])

      const headers = ['السهم', 'الكمية', 'سعر الشراء', 'التكلفة', 'السعر الحالي', 'القيمة', 'الربح/الخسارة', 'الوزن',
        'السعر العادل', 'سعر الحماية', 'التصنيف', 'الموقع من التقييم', '']
      const numericHeader = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9])

      let body
      if (!data) body = h('tr', null, h('td', { colSpan: 13, className: 'egxp-empty' }, error ? 'تعذّر تحميل المحفظة.' : 'جارٍ التحميل…'))
      else if (!data.holdings.length) body = h('tr', null, h('td', { colSpan: 13, className: 'egxp-empty' }, 'لا توجد أسهم بعد. أضف أول سهم من النموذج أعلاه.'))
      else body = data.holdings.map((row) => h(HoldingRow, { key: `${row.id}:${row.updated_at}`, row, onChanged: load, onError: setError }))

      return h('div', { className: 'qm egxp-page', dir: 'rtl', lang: 'ar' },
        h('style', null, QM_CSS + CSS),
        h(PanelHeader, { here: 'المحفظة', demo: Boolean(data && data.demo_data) }),
        data ? h(Cards, { totals: data.totals }) : null,
        h(AddForm, { universe, onAdded: load }),
        h('section', { className: 'egxp-section' },
          h('h2', { className: 'egxp-section-title' }, 'الأسهم'),
          h('div', { className: 'egxp-table-wrap' },
            h('table', { className: 'egxp-table' },
              h('thead', null, h('tr', null, headers.map((label, i) =>
                h('th', { key: i, className: numericHeader.has(i) ? 'egxp-num' : undefined }, label)))),
              h('tbody', null, body))),
          error ? h('div', { className: 'egxp-error', role: 'alert' }, error) : null),
        h('p', { className: 'egxp-foot' },
          'هذه الصفحة تعرض أرقامًا وتقييمات للفهم والمتابعة، وليست توصية بالشراء أو البيع. القرار قرارك. ',
          'الأسعار من آخر تحديث للسوق (EODHD، إغلاقات يومية)، والتقييمات من آخر تقييم محفوظ لكل سهم.'))
    }

    // ── Analyses archive ─────────────────────────────────────────────────────

    function AnalysesIcon({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      },
      h('path', { d: 'M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1-1.5z' }),
      h('path', { d: 'M14 3.5V8h4' }),
      h('path', { d: 'M9 16.5l2-2.5 1.8 1.4L15.5 12' }))
    }

    // Minimal Markdown → React elements (no HTML injection): headings, paragraphs, lists,
    // tables, blockquotes, rules, **bold**, *italic*, `code`. Links render as plain text.
    function inline(text, keyBase) {
      const parts = []
      const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)]+\))/g
      let last = 0, match, i = 0
      while ((match = pattern.exec(text))) {
        if (match.index > last) parts.push(text.slice(last, match.index))
        const token = match[0], key = `${keyBase}-${i++}`
        if (token.startsWith('**')) parts.push(h('strong', { key }, token.slice(2, -2)))
        else if (token.startsWith('`')) parts.push(h('code', { key }, token.slice(1, -1)))
        else if (token.startsWith('[')) {
          const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
          parts.push(h('span', { key, title: m[2] }, `${m[1]} (${m[2]})`))
        } else parts.push(h('em', { key }, token.slice(1, -1)))
        last = match.index + token.length
      }
      if (last < text.length) parts.push(text.slice(last))
      return parts
    }

    function Markdown({ text }) {
      const lines = String(text || '').replace(/\r/g, '').split('\n')
      const blocks = []
      let i = 0, key = 0
      const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l)
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      while (i < lines.length) {
        const line = lines[i]
        if (!line.trim()) { i++; continue }
        const heading = /^(#{1,3})\s+(.*)$/.exec(line)
        if (heading) { blocks.push(h(`h${heading[1].length}`, { key: key++, dir: 'auto' }, inline(heading[2], key))); i++; continue }
        if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { blocks.push(h('hr', { key: key++ })); i++; continue }
        if (isTableRow(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
          const header = cells(line); i += 2
          const rows = []
          while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]))
          blocks.push(h('div', { key: key++, className: 'egxp-table-wrap' }, h('table', null,
            h('thead', null, h('tr', null, header.map((c, j) => h('th', { key: j }, inline(c, `th${j}`))))),
            h('tbody', null, rows.map((r, ri) => h('tr', { key: ri }, r.map((c, j) => h('td', { key: j, dir: 'auto' }, inline(c, `td${ri}-${j}`)))))))))
          continue
        }
        if (/^\s*>/.test(line)) {
          const quote = []
          while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''))
          blocks.push(h('blockquote', { key: key++, dir: 'auto' }, inline(quote.join(' '), `q${key}`)))
          continue
        }
        const ordered = /^\s*\d+[.)]\s+/, bullet = /^\s*[-*+]\s+/
        if (ordered.test(line) || bullet.test(line)) {
          const isOrdered = ordered.test(line), marker = isOrdered ? ordered : bullet, items = []
          while (i < lines.length && marker.test(lines[i])) items.push(lines[i++].replace(marker, ''))
          blocks.push(h(isOrdered ? 'ol' : 'ul', { key: key++ }, items.map((it, j) => h('li', { key: j, dir: 'auto' }, inline(it, `li${key}-${j}`)))))
          continue
        }
        const para = []
        while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|\s*>|\s*[-*+]\s|\s*\d+[.)]\s|\s*\|)/.test(lines[i])) para.push(lines[i++])
        if (!para.length) para.push(lines[i++])
        blocks.push(h('p', { key: key++, dir: 'auto' }, inline(para.join(' '), `p${key}`)))
      }
      return h('div', { className: 'a-md', dir: 'rtl' }, blocks)
    }

    // Canvas charts can't read CSS variables, so resolve the Harness tokens (set on body) to
    // rgba() strings through a probe element and a 1px canvas; any colour syntax comes out as sRGB.
    function tokenColor(name, alpha = 1) {
      const probe = document.createElement('span')
      probe.style.cssText = `position:absolute;visibility:hidden;color:var(${name})`
      document.body.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const g = canvas.getContext('2d')
      if (!g || !color) return color
      g.fillStyle = color
      g.fillRect(0, 0, 1, 1)
      const [r, gr, b, a] = g.getImageData(0, 0, 1, 1).data
      return `rgba(${r}, ${gr}, ${b}, ${((a / 255) * alpha).toFixed(3)})`
    }

    function chartTheme() {
      return {
        text: tokenColor('--dsw-alias-label-secondary'),
        grid: tokenColor('--dsw-alias-border-l1'),
        fair: tokenColor('--dsw-alias-state-business-primary'),
        price: tokenColor('--dsw-alias-label-primary'),
        band: tokenColor('--dsw-alias-state-business-primary', 0.35),
        protection: tokenColor('--dsw-alias-state-warn-primary'),
        up: tokenColor('--dsw-alias-state-success-primary'),
        down: tokenColor('--dsw-alias-state-error-primary'),
        upSoft: tokenColor('--dsw-alias-state-success-primary', 0.4),
        downSoft: tokenColor('--dsw-alias-state-error-primary', 0.4),
      }
    }


    // ── Shared: Harness theme and TradingView embeds ────────────────────────────

    // The Harness theme can differ from the OS setting, so read it from the host's own
    // label token: light text means a dark surface. Re-evaluated when the root's
    // attributes change (theme switch) or the OS scheme changes.
    function hostTheme() {
      // Resolve the token through a probe element, then read the pixel through a canvas so any
      // color syntax (hex, rgb, oklch, color()) ends up as sRGB bytes.
      const probe = document.createElement('span')
      probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--dsw-alias-label-primary)'
      document.body.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const g = canvas.getContext('2d')
      if (!g || !color) return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      g.fillStyle = color
      g.fillRect(0, 0, 1, 1)
      const [r, gr, b] = g.getImageData(0, 0, 1, 1).data
      return 0.299 * r + 0.587 * gr + 0.114 * b > 140 ? 'dark' : 'light'
    }

    function useHostTheme() {
      const [theme, setTheme] = useState(hostTheme)
      useEffect(() => {
        const update = () => setTheme(hostTheme())
        const observer = new MutationObserver(update)
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme'] })
        observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-ds-dark-theme'] })
        const media = window.matchMedia('(prefers-color-scheme: dark)')
        media.addEventListener('change', update)
        return () => { observer.disconnect(); media.removeEventListener('change', update) }
      }, [])
      return theme
    }

    // A TradingView embed widget (iframe from tradingview-widget.com). Its data stays inside the
    // widget: it is for display only and never feeds valuations. Attribution stays visible.
    function TvWidget({ name, config, height }) {
      const ref = React.useRef(null)
      const key = JSON.stringify(config)
      useEffect(() => {
        const box = ref.current
        const container = document.createElement('div')
        container.className = 'tradingview-widget-container'
        container.style.height = '100%'
        const target = document.createElement('div')
        target.className = 'tradingview-widget-container__widget'
        target.style.height = '100%'
        const script = document.createElement('script')
        script.async = true
        script.src = `https://s3.tradingview.com/external-embedding/embed-widget-${name}.js`
        script.textContent = key
        container.append(target, script)
        box.append(container)
        return () => { box.replaceChildren() }
      }, [name, key])
      return h('div', { ref, className: 'egxm-tv', style: { height } })
    }


    /* @inline labels.mjs */
    /* @inline components.js */
    /* @inline analyses.js */
    /* @inline market.js */

    return {
      inject: ['slots', 'layout'],
      apply(ctx) {
        nav.selectPanel = (id) => ctx.layout.selectPanel(id)
        ctx.effect(() => () => { nav.selectPanel = null })
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: MARKET_ID, order: 8, label: 'قيمة',
        }, SidebarQimaIcon))
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: MARKET_ID }, MarketPage))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: ANALYSES_ID, order: 9, label: 'التحليلات',
        }, AnalysesIcon))
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: ANALYSES_ID }, AnalysesPage))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 10, label: 'المحفظة',
        }, PortfolioIcon))
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, PortfolioPage))
      },
    }
  },
})
