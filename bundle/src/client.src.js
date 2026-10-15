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

    const KIND = { full: 'تقييم كامل', light: 'مراجعة أسبوعية' }
    // Numeric ranges and pairs keep their reading order inside right-to-left text.
    const ltr = (text) => N(text)
    const range = (a, b) => N(`${fmtPrice(a)} – ${fmtPrice(b)}`)

    // Seconds to add to a UTC timestamp so the chart's time axis reads in Cairo time.
    const cairoParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    function cairoOffsetSeconds(date) {
      const parts = Object.fromEntries(cairoParts.formatToParts(date).map((p) => [p.type, p.value]))
      const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
      return Math.round((asUtc - date.getTime()) / 1000)
    }

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
      return h('div', { className: 'egxp-md', dir: 'rtl' }, blocks)
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

    function FairValueChart({ points }) {
      const ref = React.useRef(null)
      useEffect(() => {
        if (!points.length) return undefined
        const theme = chartTheme()
        const chart = LightweightCharts.createChart(ref.current, {
          autoSize: true,
          layout: { background: { color: 'transparent' }, textColor: theme.text },
          grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
          timeScale: { timeVisible: true, secondsVisible: false },
          localization: { locale: 'en-US' },
        })
        // Lightweight Charts needs strictly increasing times; nudge same-second records apart.
        let lastTime = 0
        const rows = points.map((p) => {
          const at = new Date(p.created_at)
          let t = Math.floor(at.getTime() / 1000) + cairoOffsetSeconds(at)
          if (t <= lastTime) t = lastTime + 1
          lastTime = t
          return { ...p, time: t }
        })
        const line = (color, width, style, title) => chart.addSeries(LightweightCharts.LineSeries, {
          color, lineWidth: width, lineStyle: style, title, lastValueVisible: true, priceLineVisible: false,
          pointMarkersVisible: rows.length < 40,
        })
        line(theme.fair, 2, 0, 'السعر العادل').setData(rows.map((r) => ({ time: r.time, value: r.fair_value })))
        line(theme.band, 1, 2, 'متشائم').setData(rows.filter((r) => r.bear != null).map((r) => ({ time: r.time, value: r.bear })))
        line(theme.band, 1, 2, 'متفائل').setData(rows.filter((r) => r.bull != null).map((r) => ({ time: r.time, value: r.bull })))
        line(theme.protection, 1, 1, 'الحماية').setData(rows.map((r) => ({ time: r.time, value: r.protection_price })))
        line(theme.price, 2, 0, 'السعر').setData(rows.filter((r) => r.price_at_valuation != null).map((r) => ({ time: r.time, value: r.price_at_valuation })))
        chart.timeScale().fitContent()
        return () => chart.remove()
      }, [points])
      if (!points.length) return null
      const theme = chartTheme()
      const swatch = (color, label) => h('span', null, h('span', { className: 'egxp-swatch', style: { background: color } }), label)
      return h('div', null,
        h('div', { ref, className: 'egxp-chart' }),
        h('div', { className: 'egxp-legend' },
          swatch(theme.fair, 'السعر العادل'), swatch(theme.price, 'السعر وقت التقييم'),
          swatch(theme.band, 'نطاق المتشائم/المتفائل'), swatch(theme.protection, 'سعر الحماية')))
    }

    function KeyValues({ data }) {
      const rows = []
      const walk = (value, path) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          Object.entries(value).forEach(([k, v]) => walk(v, path ? `${path}.${k}` : k))
        } else {
          rows.push([path, Array.isArray(value) ? value.join('، ') : typeof value === 'number' ? N(fmtNumber(value, 4).replace(/\.?0+$/, '')) : String(value)])
        }
      }
      walk(data || {}, '')
      if (!rows.length) return h('div', { className: 'egxp-sub' }, '—')
      return h('table', { className: 'egxp-kv' }, h('tbody', null,
        rows.map(([k, v], i) => h('tr', { key: i }, h('td', { dir: 'ltr' }, k), h('td', { dir: 'auto' }, v)))))
    }

    function Section({ title, children }) {
      return h('section', { className: 'egxp-section' }, h('h2', { className: 'egxp-section-title' }, title), children)
    }

    function AnalysisDetail({ id, onBack }) {
      const [item, setItem] = useState(null)
      const [series, setSeries] = useState({ points: [], changes: [] })
      const [error, setError] = useState('')
      useEffect(() => {
        let alive = true
        setError('')
        api('GET', `/egx/api/valuations/${id}`)
          .then((v) => {
            if (!alive) return
            setItem(v)
            return api('GET', `/egx/api/valuations/series/${encodeURIComponent(v.symbol)}`).then((s) => alive && setSeries(s))
          })
          .catch((e) => alive && setError(e.message))
        return () => { alive = false }
      }, [id])

      const crumbs = [{ label: 'التحليلات', onClick: onBack }]
      if (!item) return h('div', { className: 'qm egxp-page', dir: 'rtl', lang: 'ar' }, h('style', null, QM_CSS + CSS),
        h(PanelHeader, { here: '…', crumbs }),
        h('div', { className: error ? 'egxp-error' : 'egxp-empty' }, error || 'جارٍ التحميل…'))

      const margin = marginSentence(item.price_at_valuation, item.fair_value)
      const card = (label, value, note, cls) => h('div', { className: 'egxp-card' },
        h('div', { className: 'egxp-card-label' }, label),
        h('div', { className: `egxp-card-value ${cls || ''}` }, value),
        note ? h('div', { className: 'egxp-card-note' }, note) : null)
      const methods = item.methods || []
      const sources = item.sources || []
      const checks = (item.sanity && item.sanity.checks) || []
      return h('div', { className: 'qm egxp-page', dir: 'rtl', lang: 'ar' },
        h('style', null, QM_CSS + CSS),
        h(PanelHeader, { crumbs, here: h('span', null, h('span', { className: 'q-sym' }, item.symbol), ' — ', N(fmtDate(item.created_at))) }),
        h('p', { className: 'egxp-intro' }, `${KIND[item.kind] || item.kind} · الفترة المالية ${item.financial_period || '—'}`),
        h('div', { className: 'egxp-cards' },
          card('السعر العادل', money(item.fair_value), item.bear != null ? h('span', null, 'النطاق ', range(item.bear, item.bull)) : null),
          card('سعر الحماية', money(item.protection_price), 'مرجع الدخول = السعر العادل نفسه، وليس توصية بالشراء.'),
          card('السعر وقت التقييم', money(item.price_at_valuation), margin == null ? null : h('span', null, margin.text, ' ', margin.value ? N(margin.value) : null)),
          card('التصنيف', item.risk_rating ? RATING[item.risk_rating] || item.risk_rating : '—', null, item.risk_rating ? `egxp-${item.risk_rating}` : '')),
        h(Section, { title: `تاريخ السعر العادل لسهم ${item.symbol}` },
          series.points.length > 1 ? h(FairValueChart, { points: series.points }) : h('div', { className: 'egxp-sub' }, 'تقييم واحد فقط حتى الآن.'),
          series.changes.length ? h('table', { className: 'egxp-table', style: { marginTop: 12 } },
            h('thead', null, h('tr', null, ['التاريخ', 'من', 'إلى', 'التغير', 'السبب'].map((t, i) => h('th', { key: i, className: i && i < 4 ? 'egxp-num' : undefined }, t)))),
            h('tbody', null, series.changes.map((c) => h('tr', { key: c.id },
              h('td', null, N(fmtDate(c.created_at))), h('td', { className: 'egxp-num' }, money(c.previous_fair_value)),
              h('td', { className: 'egxp-num' }, money(c.new_fair_value)),
              h('td', { className: 'egxp-num' }, pctSigned(c.change_pct)),
              h('td', { dir: 'auto' }, c.reason))))) : null),
        item.report
          ? h(Section, { title: 'التقرير' }, h(Markdown, { text: item.report }))
          : h(Section, { title: item.kind === 'light' ? 'ما تمت مراجعته' : 'التقرير' },
            h('p', { className: 'egxp-pre', dir: 'auto' }, item.reason || 'لا يوجد تقرير محفوظ لهذا التقييم.')),
        item.kind === 'full' ? h('div', { className: 'egxp-grid2' },
          h(Section, { title: 'الأطروحة' }, h('p', { className: 'egxp-pre', dir: 'auto' }, item.thesis || '—')),
          h(Section, { title: 'ملاحظات الناقد' }, h('p', { className: 'egxp-pre', dir: 'auto' }, item.critic_notes || '—'))) : null,
        methods.length ? h(Section, { title: 'طرق التقييم' }, h('table', { className: 'egxp-table' },
          h('thead', null, h('tr', null, ['الطريقة', 'الوزن', 'متشائم', 'أساسي', 'متفائل'].map((t, i) => h('th', { key: i, className: i ? 'egxp-num' : undefined }, t)))),
          h('tbody', null, methods.map((m, i) => h('tr', { key: i },
            h('td', { dir: 'ltr' }, m.method), h('td', { className: 'egxp-num' }, N(fmtPct(m.weight, { digits: 0 }))),
            h('td', { className: 'egxp-num' }, money(m.bear)), h('td', { className: 'egxp-num' }, money(m.base)),
            h('td', { className: 'egxp-num' }, money(m.bull))))))) : null,
        item.kind === 'full' ? h('div', { className: 'egxp-grid2' },
          h(Section, { title: 'الافتراضات' }, h(KeyValues, { data: item.assumptions })),
          h(Section, { title: 'فحوصات المنطق' }, checks.length
            ? h('ul', { style: { margin: 0, paddingInlineStart: 18, fontSize: 13 } }, checks.map((c, i) => h('li', { key: i },
              h('span', { className: `egxp-check-${c.status}` }, c.status === 'pass' ? 'سليم' : c.status === 'warn' ? 'تحذير' : 'فشل'),
              ' — ', h('span', { dir: 'auto' }, c.message))))
            : h('div', { className: 'egxp-sub' }, '—'))) : null,
        sources.length ? h(Section, { title: 'المصادر' }, h('table', { className: 'egxp-table' },
          h('thead', null, h('tr', null, ['البند', 'القيمة', 'المصدر', 'التاريخ'].map((t, i) => h('th', { key: i }, t)))),
          h('tbody', null, sources.map((src, i) => h('tr', { key: i },
            h('td', { dir: 'auto' }, src.item), h('td', { dir: 'auto' }, src.value),
            h('td', { dir: 'auto', style: { whiteSpace: 'normal' } }, src.source), h('td', null, src.as_of)))))) : null,
        h('p', { className: 'egxp-foot' }, 'تحليل تقييمي للفهم والمتابعة، وليس توصية بالشراء أو البيع. القرار قرارك.'))
    }

    function AnalysesList({ onOpen }) {
      const [filters, setFilters] = useState({ symbol: '', risk_rating: '', kind: 'full', date_from: '', date_to: '' })
      const [data, setData] = useState(null)
      const [items, setItems] = useState([])
      const [error, setError] = useState('')
      const [loadingMore, setLoadingMore] = useState(false)

      const query = useCallback((offset) => {
        const q = new URLSearchParams({ limit: '50', offset: String(offset), kind: filters.kind })
        for (const k of ['symbol', 'risk_rating', 'date_from', 'date_to']) if (filters[k]) q.set(k, filters[k])
        return api('GET', `/egx/api/valuations?${q}`)
      }, [filters])

      useEffect(() => {
        let alive = true
        setError('')
        query(0).then((d) => { if (alive) { setData(d); setItems(d.items) } }).catch((e) => alive && setError(e.message))
        return () => { alive = false }
      }, [query])

      async function more() {
        setLoadingMore(true)
        try { const d = await query(items.length); setItems((prev) => prev.concat(d.items)) } catch (e) { setError(e.message) } finally { setLoadingMore(false) }
      }
      const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }))
      const field = (label, control) => h('label', { className: 'egxp-field' }, label, control)
      const headers = ['التاريخ', 'السهم', 'النوع', 'السعر العادل', 'النطاق', 'السعر وقت التقييم', 'الفرق عن العادل وقتها', 'التغير عن السابق', 'التصنيف', 'السبب']
      const numeric = new Set([3, 4, 5, 7])

      let body
      if (!data) body = h('tr', null, h('td', { colSpan: headers.length, className: 'egxp-empty' }, error ? 'تعذّر تحميل التحليلات.' : 'جارٍ التحميل…'))
      else if (!items.length) body = h('tr', null, h('td', { colSpan: headers.length, className: 'egxp-empty' },
        data.total === 0 && !filters.symbol && !filters.risk_rating && !filters.date_from && !filters.date_to
          ? 'لا توجد تحليلات محفوظة بعد. اطلب من المحلل تقييم سهم، وسيظهر هنا تلقائيًا بعد الحفظ.'
          : 'لا توجد نتائج لهذه الفلاتر.'))
      else body = items.map((v) => {
        const margin = marginSentence(v.price_at_valuation, v.fair_value)
        const open = () => onOpen(v.id)
        return h('tr', { key: v.id, className: 'egxp-row-link', tabIndex: 0, onClick: open,
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } } },
          h('td', null, N(fmtDate(v.created_at))),
          h('td', null, h('span', { className: 'egxp-sym' }, v.symbol)),
          h('td', null, KIND[v.kind] || v.kind),
          h('td', { className: 'egxp-num' }, money(v.fair_value)),
          h('td', { className: 'egxp-num' }, v.bear != null ? range(v.bear, v.bull) : '—'),
          h('td', { className: 'egxp-num' }, money(v.price_at_valuation)),
          h('td', null, margin == null ? '—' : h('span', null, margin.text, ' ', margin.value ? N(margin.value) : null)),
          h('td', { className: 'egxp-num' }, v.change_pct == null ? '—' : N(fmtPct(v.change_pct, { signed: true }))),
          h('td', null, v.risk_rating ? h('span', { className: `egxp-badge egxp-${v.risk_rating}` }, RATING[v.risk_rating] || v.risk_rating) : '—'),
          h('td', { className: 'egxp-reason', dir: 'auto', title: v.reason || '' }, v.reason || '—'))
      })

      return h('div', { className: 'qm egxp-page', dir: 'rtl', lang: 'ar' },
        h('style', null, QM_CSS + CSS),
        h(PanelHeader, { here: 'التحليلات', demo: Boolean(data && data.demo_data) }),
        h('p', { className: 'egxp-intro' }, 'كل التقييمات التي حفظها المحلل، بتقاريرها وافتراضاتها ومصادرها وسبب كل تغيير.'),
        h('section', { className: 'egxp-section' },
          h('div', { className: 'egxp-filters' },
            field('السهم', h('select', { className: 'egxp-input', value: filters.symbol, onChange: set('symbol') },
              h('option', { value: '' }, 'كل الأسهم'),
              ((data && data.symbols) || []).map((s) => h('option', { key: s, value: s }, s)))),
            field('التصنيف', h('select', { className: 'egxp-input', value: filters.risk_rating, onChange: set('risk_rating') },
              h('option', { value: '' }, 'الكل'),
              Object.entries(RATING).map(([k, label]) => h('option', { key: k, value: k }, label)))),
            field('النوع', h('select', { className: 'egxp-input', value: filters.kind, onChange: set('kind') },
              h('option', { value: 'full' }, 'التقييمات الكاملة'),
              h('option', { value: 'light' }, 'المراجعات الأسبوعية'),
              h('option', { value: '' }, 'الكل'))),
            field('من تاريخ', h('input', { className: 'egxp-input', type: 'date', value: filters.date_from, onChange: set('date_from') })),
            field('إلى تاريخ', h('input', { className: 'egxp-input', type: 'date', value: filters.date_to, onChange: set('date_to') }))),
          h('div', { className: 'egxp-table-wrap' },
            h('table', { className: 'egxp-table' },
              h('thead', null, h('tr', null, headers.map((t, i) => h('th', { key: i, className: numeric.has(i) ? 'egxp-num' : undefined }, t)))),
              h('tbody', null, body))),
          data && items.length < data.total
            ? h('div', { style: { marginTop: 12 } }, h('button', { className: 'egxp-btn', disabled: loadingMore, onClick: more },
              loadingMore ? 'جارٍ التحميل…' : `تحميل المزيد (${data.total - items.length})`))
            : null,
          error ? h('div', { className: 'egxp-error', role: 'alert' }, error) : null))
    }

    function AnalysesPage() {
      const [openId, setOpenId] = useState(() => {
        const pending = nav.pendingAnalysisId
        nav.pendingAnalysisId = null
        return pending
      })
      return openId == null
        ? h(AnalysesList, { onOpen: setOpenId })
        : h(AnalysisDetail, { id: openId, onBack: () => setOpenId(null) })
    }


    // ── Market list ──────────────────────────────────────────────────────────

    const timeFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Cairo' })
    const price2 = fmtPrice
    const PERIODS = [['day', 'اليوم'], ['1w', 'أسبوع'], ['1m', 'شهر'], ['3m', '3 شهور'], ['ytd', 'منذ بداية السنة'], ['1y', 'سنة']]
    const SORTS = [['weight', 'الوزن في المؤشر'], ['change', 'التغير'], ['period', 'أداء الفترة'], ['margin', 'الفرق عن العادل'], ['symbol', 'الرمز']]

    const MARKET_CSS = `
.egxm-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.egxm-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; margin-inline-end: 6px; background: var(--dsw-alias-label-tertiary); }
.egxm-toolbar { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; justify-content: space-between; }
.egxm-toolbar-group { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.egxm-search { width: 220px; }
.egxm-seg { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; }
.egxm-seg button { border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; padding: 4px 10px; cursor: pointer; white-space: nowrap; transition: background-color .15s ease, color .15s ease; }
.egxm-seg button:hover { color: var(--dsw-alias-label-primary); }
.egxm-seg button[aria-pressed='true'] { background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); }
.egxm-check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.egxm-breadth { display: flex; flex-direction: column; gap: 6px; }
.egxm-breadth-bar { display: flex; height: 4px; border-radius: 2px; overflow: hidden; background: var(--dsw-alias-border-l2); max-width: 420px; }
.egxm-breadth-bar span { display: block; height: 100%; }
.egxm-breadth-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.egxm-table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
.egxm-table th { position: sticky; top: 0; z-index: 1; background: var(--dsw-alias-bg-layer-1); font-weight: 500; font-size: 12px; color: var(--dsw-alias-label-secondary); text-align: start; padding: 8px 8px; white-space: nowrap; border-bottom: 1px solid var(--dsw-alias-border-l3); }
.egxm-table th button { all: unset; cursor: pointer; }
.egxm-table th button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; border-radius: 3px; }
.egxm-table td { padding: 9px 8px; border-bottom: 1px solid var(--dsw-alias-border-l4); white-space: nowrap; vertical-align: middle; }
.egxm-row { cursor: pointer; transition: background-color .12s ease; }
.egxm-row:hover td, .egxm-row[aria-expanded='true'] td { background: var(--dsw-alias-interactive-bg-hover); }
.egxm-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
.egxm-row.egxm-nodata td { color: var(--dsw-alias-label-tertiary); }
.egxm-num { text-align: end !important; }
.egxm-sym { font-weight: 600; letter-spacing: .01em; }
.egxm-name { font-size: 11px; color: var(--dsw-alias-label-tertiary); max-width: 170px; overflow: hidden; text-overflow: ellipsis; }
.egxm-held { display: inline-block; margin-inline-start: 6px; font-size: 10px; font-weight: 500; padding: 0 6px; border-radius: 999px; color: var(--dsw-alias-brand-primary); border: 1px solid currentColor; vertical-align: 1px; }
.egxm-price { font-weight: 500; }
.egxm-sub { display: block; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.egxm-sub.egxm-warn { color: var(--dsw-alias-state-warn-primary); }
.egxm-range { display: flex; align-items: center; gap: 8px; direction: ltr; justify-content: flex-end; }
.egxm-range-bar { position: relative; width: 64px; height: 4px; border-radius: 2px; background: var(--dsw-alias-border-l2); }
.egxm-range-mark { position: absolute; top: -3px; width: 2px; height: 10px; border-radius: 1px; background: var(--dsw-alias-label-primary); transform: translateX(-1px); }
.egxm-range-label { font-size: 11px; color: var(--dsw-alias-label-tertiary); min-width: 44px; }
.egxm-detail td { background: var(--dsw-alias-bg-layer-1); padding: 16px 12px 20px; cursor: default; }
.egxm-detail-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr); gap: 20px; align-items: start; }
@media (max-width: 1100px) { .egxm-detail-grid { grid-template-columns: 1fr; } }
.egxm-chart { height: 300px; direction: ltr; }
.egxm-detail-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px; }
.egxm-detail-title { font-size: 14px; font-weight: 500; }
.egxm-levels { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 8px; }
.egxm-mini th, .egxm-mini td { padding: 5px 8px; font-size: 12px; white-space: nowrap; }
.egxm-mini th { color: var(--dsw-alias-label-secondary); font-weight: 500; text-align: start; border-bottom: 1px solid var(--dsw-alias-border-l3); }
.egxm-mini td { border-bottom: 1px solid var(--dsw-alias-border-l4); }
.egxm-skel { display: inline-block; height: 10px; border-radius: 4px; background: var(--dsw-alias-bg-skeleton, var(--dsw-alias-bg-layer-3)); animation: egxm-pulse 1.4s ease-in-out infinite; }
@keyframes egxm-pulse { 50% { opacity: .45 } }
@media (prefers-reduced-motion: reduce) { .egxm-skel { animation: none } .egxm-row, .egxm-seg button { transition: none } }
.egxm-notice { font-size: 13px; line-height: 1.7; color: var(--dsw-alias-label-secondary); }
.egxm-notice strong { color: var(--dsw-alias-label-primary); font-weight: 500; }
.egxm-link { all: unset; cursor: pointer; color: var(--dsw-alias-brand-primary); font-size: 12px; }
.egxm-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.egxm-link:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; border-radius: 3px; }
.egxm-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--dsw-alias-border-l3); margin-bottom: 14px; }
.egxm-tab { all: unset; cursor: pointer; padding: 7px 12px; font-size: 13px; color: var(--dsw-alias-label-secondary); border-bottom: 2px solid transparent; margin-bottom: -1px; transition: color .15s ease, border-color .15s ease; }
.egxm-tab:hover { color: var(--dsw-alias-label-primary); }
.egxm-tab[aria-selected='true'] { color: var(--dsw-alias-label-primary); border-bottom-color: var(--dsw-alias-brand-primary); font-weight: 500; }
.egxm-tab:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; border-radius: 4px; }
.egxm-tv { direction: ltr; border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); color-scheme: normal; }
.egxm-tv-note { display: flex; gap: 8px; align-items: baseline; font-size: 12px; line-height: 1.7; color: var(--dsw-alias-label-secondary); margin: 8px 0 0; }
.egxm-caution { font-size: 13px; line-height: 1.7; padding: 10px 12px; margin-bottom: 10px; border-radius: 8px; color: var(--dsw-alias-label-primary); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent); }
.egxm-caution strong { font-weight: 600; }
.egxp-page ::selection { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 28%, transparent); }
`


    function periodValue(row, period) {
      return period === 'day' ? row.change_pct : (row.returns || {})[period]
    }

    function RangeBar({ low, high, price }) {
      if (low == null || high == null || price == null || high <= low) return h('span', { className: 'egxm-sub' }, '—')
      const pos = Math.min(100, Math.max(0, ((price - low) / (high - low)) * 100))
      return h('div', { className: 'egxm-range', title: `أدنى ${price2(low)} · أعلى ${price2(high)} خلال 52 أسبوعًا` },
        h('span', { className: 'egxm-range-label num' }, price2(low)),
        h('div', { className: 'egxm-range-bar', role: 'img', 'aria-label': `السعر عند ${Math.round(pos)}٪ من نطاق 52 أسبوعًا` },
          h('span', { className: 'egxm-range-mark', style: { left: `${pos}%` } })),
        h('span', { className: 'egxm-range-label num' }, price2(high)))
    }

    function SymbolChart({ history, rangeDays }) {
      const ref = React.useRef(null)
      useEffect(() => {
        const bars = history.bars
        if (!bars.length) return undefined
        const theme = chartTheme()
        const { up, down } = theme
        const chart = LightweightCharts.createChart(ref.current, {
          autoSize: true,
          layout: { background: { color: 'transparent' }, textColor: theme.text, panes: { separatorColor: theme.grid } },
          grid: { vertLines: { visible: false }, horzLines: { color: theme.grid } },
          rightPriceScale: { borderVisible: false },
          timeScale: { borderVisible: false },
          localization: { locale: 'en-US' },
          crosshair: { mode: 0 },
        })
        const candles = chart.addSeries(LightweightCharts.CandlestickSeries, {
          upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false, priceLineVisible: false,
        })
        candles.setData(bars.filter((b) => b.open != null).map((b) => ({ time: b.date, open: b.open, high: b.high, low: b.low, close: b.close })))
        const volume = chart.addSeries(LightweightCharts.HistogramSeries, {
          priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false,
        }, 1)
        volume.setData(bars.map((b, i) => ({
          time: b.date, value: b.volume || 0,
          color: i && b.close < bars[i - 1].close ? theme.downSoft : theme.upSoft,
        })))
        chart.panes()[1]?.setHeight(64)
        const lv = history.levels
        if (lv) {
          candles.createPriceLine({ price: lv.fair_value, color: theme.fair, lineWidth: 2, lineStyle: 2, title: 'العادل' })
          candles.createPriceLine({ price: lv.protection_price, color: theme.protection, lineWidth: 1, lineStyle: 0, title: 'الحماية' })
        }
        const total = bars.length
        const from = Math.max(0, total - Math.ceil(rangeDays * 0.69))
        chart.timeScale().setVisibleLogicalRange({ from, to: total + 2 })
        return () => chart.remove()
      }, [history, rangeDays])
      return h('div', { ref, className: 'egxm-chart' })
    }


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

    const TV_LOCALE = 'ar_AE'
    const tvSymbol = (symbol) => `EGX:${symbol}`
    const DETAIL_TABS = [['ours', 'تقييمنا'], ['chart', 'الشارت الفني'], ['financials', 'البيانات المالية'], ['technical', 'التحليل الفني']]

    function SymbolDetail({ row, colSpan }) {
      const [tab, setTab] = useState('ours')
      const theme = useHostTheme()
      const [history, setHistory] = useState(null)
      const [error, setError] = useState('')
      const [rangeDays, setRangeDays] = useState(182)
      useEffect(() => {
        let alive = true
        api('GET', `/egx/api/market/${encodeURIComponent(row.symbol)}/history?days=400`)
          .then((d) => alive && setHistory(d))
          .catch((e) => alive && setError(e.message))
        return () => { alive = false }
      }, [row.symbol])

      const recent = history ? history.bars.slice(-10).reverse() : []
      const openAnalysis = () => {
        if (!row.valuation || !nav.selectPanel) return
        nav.pendingAnalysisId = row.valuation.id
        nav.selectPanel(ANALYSES_ID)
      }
      let body
      if (error) body = h('div', { className: 'egxp-error', role: 'alert' }, error)
      else if (!history) body = h('div', { className: 'egxm-chart' }, h('span', { className: 'egxm-skel', style: { width: '40%' } }))
      else if (!history.bars.length) body = h('div', { className: 'egxm-notice' },
        'لا توجد أسعار محفوظة لهذا السهم بعد. سيتم جلبها في التحديث القادم حسب حد الطلبات اليومي.')
      else body = h('div', { className: 'egxm-detail-grid' },
        h('div', null,
          h('div', { className: 'egxm-detail-head' },
            h('span', { className: 'egxm-detail-title' }, `${row.symbol} — شموع يومية`),
            h('div', { className: 'egxm-seg', role: 'group', 'aria-label': 'مدى الرسم' },
              [[30, 'شهر'], [91, '3 شهور'], [182, '6 شهور'], [365, 'سنة']].map(([d, label]) =>
                h('button', { key: d, type: 'button', 'aria-pressed': rangeDays === d, onClick: () => setRangeDays(d) }, label)))),
          h(SymbolChart, { history, rangeDays }),
          history.levels
            ? h('div', { className: 'egxm-levels' },
              h('span', null, 'السعر العادل ', h('strong', null, N(price2(history.levels.fair_value), 'q-blue'))),
              h('span', null, 'سعر الحماية ', ltr(price2(history.levels.protection_price))),
              h('span', null, 'النطاق ', range(history.levels.bear, history.levels.bull)),
              h('button', { type: 'button', className: 'egxm-link', onClick: openAnalysis }, 'فتح التحليل ←'))
            : h('div', { className: 'egxm-levels' }, 'لا يوجد تقييم محفوظ لهذا السهم. اطلب من المحلل: «قيّم سهم ', row.symbol, '».')),
        h('div', null,
          h('div', { className: 'egxm-detail-head' }, h('span', { className: 'egxm-detail-title' }, 'آخر 10 جلسات')),
          h('div', { className: 'egxp-table-wrap' }, h('table', { className: 'egxm-mini', style: { width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' } },
            h('thead', null, h('tr', null, ['الجلسة', 'الإغلاق', 'التغير', 'الأعلى', 'الأدنى', 'الحجم'].map((t, i) =>
              h('th', { key: i, className: i ? 'egxm-num' : undefined }, t)))),
            h('tbody', null, recent.map((b, i) => {
              const prev = history.bars[history.bars.length - 2 - i]
              const chg = prev ? b.close / prev.close - 1 : null
              return h('tr', { key: b.date },
                h('td', null, N(fmtDayMonth(b.date))),
                h('td', { className: 'egxm-num' }, N(price2(b.close))),
                h('td', { className: 'egxm-num' }, chg == null ? '—' : N(fmtPct(chg, { digits: 2, signed: true }), tone(chg))),
                h('td', { className: 'egxm-num' }, N(price2(b.high))),
                h('td', { className: 'egxm-num' }, N(price2(b.low))),
                h('td', { className: 'egxm-num' }, b.volume == null ? '—' : N(fmtCompact(b.volume))))
            }))))))
      const symbol = tvSymbol(row.symbol)
      const shared = { colorTheme: theme, isTransparent: true, width: '100%', height: '100%', locale: TV_LOCALE }
      const tvNote = h('p', { className: 'egxm-tv-note' },
        'بيانات TradingView متأخرة (علامة D) وللعرض فقط؛ لا تدخل في حسابات التقييم. الأرقام قد تختلف قليلًا عن EODHD بسبب توقيت التحديث.')
      let panel = body
      if (tab === 'chart') panel = h('div', null,
        h(TvWidget, { name: 'symbol-info', height: 190, config: { ...shared, symbol, height: 190 } }),
        h('div', { style: { height: 12 } }),
        h(TvWidget, { name: 'advanced-chart', height: 560, config: {
          autosize: true, symbol, interval: 'D', timezone: 'Africa/Cairo', theme, style: '1', locale: TV_LOCALE,
          allow_symbol_change: false, withdateranges: true, hide_side_toolbar: false, details: false,
          width: '100%', height: '100%' } }),
        tvNote)
      else if (tab === 'financials') panel = h('div', null,
        h(TvWidget, { name: 'financials', height: 620, config: { ...shared, symbol, displayMode: 'adaptive', largeChartUrl: '' } }),
        h('p', { className: 'egxm-tv-note' },
          'البيانات المالية من TradingView للعرض والمقارنة فقط. التقييم يعتمد على القوائم المالية المحفوظة بمصادرها، وبعض التعريفات تختلف بين المصادر (مثل إيرادات البنوك).'))
      else if (tab === 'technical') panel = h('div', null,
        h('div', { className: 'egxm-caution', role: 'note' },
          h('strong', null, 'تنبيه: '),
          'هذه إشارة فنية آلية من TradingView تعتمد على المتوسطات المتحركة والمؤشرات الفنية فقط. ليست تقييمنا، ولا تأخذ في الاعتبار السعر العادل أو القوائم المالية، وليست توصية بالشراء أو البيع.'),
        h(TvWidget, { name: 'technical-analysis', height: 440, config: { ...shared, symbol, interval: '1D', displayMode: 'single', showIntervalTabs: true } }),
        tvNote)
      const tabs = h('div', { className: 'egxm-tabs', role: 'tablist', 'aria-label': `تفاصيل ${row.symbol}` },
        DETAIL_TABS.map(([key, label]) => h('button', {
          key, type: 'button', role: 'tab', className: 'egxm-tab', 'aria-selected': tab === key,
          tabIndex: tab === key ? 0 : -1, onClick: () => setTab(key),
          onKeyDown: (e) => {
            const i = DETAIL_TABS.findIndex(([k]) => k === tab)
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault()
              // Right-to-left: ArrowLeft moves to the next tab.
              const step = e.key === 'ArrowLeft' ? 1 : -1
              setTab(DETAIL_TABS[(i + step + DETAIL_TABS.length) % DETAIL_TABS.length][0])
            }
          },
        }, label)))
      return h('tr', { className: 'egxm-detail' }, h('td', { colSpan }, tabs, h('div', { role: 'tabpanel' }, panel)))
    }

    function MarketRow({ row, period, expanded, onToggle }) {
      const value = periodValue(row, period)
      const v = row.valuation
      const noData = row.price == null
      const toggle = () => onToggle(row.symbol)
      return h('tr', {
        className: `egxm-row${noData ? ' egxm-nodata' : ''}`, tabIndex: 0, 'aria-expanded': expanded,
        onClick: toggle, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } },
      },
      h('td', null,
        h('span', { className: 'egxm-sym' }, row.symbol), row.held ? h('span', { className: 'egxm-held' }, 'في محفظتك') : null,
        h('span', { className: 'egxm-sub egxm-name', title: row.name, dir: 'ltr' }, row.name)),
      h('td', { className: 'egxm-num' },
        noData ? h('span', { className: 'egxm-sub' }, 'بانتظار التحديث')
          : [h('span', { key: 'p', className: 'egxm-price num' }, price2(row.price)),
            h('span', { key: 'd', className: `egxm-sub${row.stale ? ' egxm-warn' : ''}` },
              row.price_kind === 'delayed' ? ['متأخر · ', N(fmtTime(row.as_of))] : ['إغلاق ', N(fmtDayMonth(row.as_of))])]),
      h('td', { className: 'egxm-num' },
        row.change == null ? '—' : N(fmtChange(row.change, row.change_pct), row.stale ? 'q-ter' : tone(row.change))),
      h('td', { className: 'egxm-num' }, value == null ? '—' : N(fmtPct(value, { signed: true }), tone(value))),
      h('td', { className: 'egxm-num' }, h(RangeBar, { low: row.low_52w, high: row.high_52w, price: row.price })),
      h('td', { className: 'egxm-num' }, row.volume == null ? '—' : N(fmtCompact(row.volume))),
      h('td', { className: 'egxm-num' },
        v ? [h('span', { key: 'f', className: 'num q-blue' }, price2(v.fair_value)),
          h('span', { key: 'u', className: 'egxm-sub' }, ...marginParts(row.price, v.fair_value))]
          : h('span', { className: 'egxm-sub' }, 'غير مقيَّم')),
      h('td', null, v && v.risk_rating ? h('span', { className: `egxp-badge egxp-${v.risk_rating}` }, RATING[v.risk_rating]) : '—'),
      h('td', { className: 'egxm-num' }, N(fmtPct(row.weight_pct / 100, { digits: 2 }))))
    }

    function MarketPage() {
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [syncing, setSyncing] = useState(false)
      const [syncNote, setSyncNote] = useState('')
      const [query, setQuery] = useState('')
      const [period, setPeriod] = useState('day')
      const [sort, setSort] = useState('weight')
      const [heldOnly, setHeldOnly] = useState(false)
      const [expanded, setExpanded] = useState(null)

      const lastSyncSeen = React.useRef(undefined)
      const load = useCallback(async () => {
        try {
          const next = await api('GET', '/egx/api/market')
          setData(next); setError('')
          // A finished sync means new prices: refresh the shared portfolio (icon + header) too.
          const finished = next.last_sync && next.last_sync.finished_at
          if (lastSyncSeen.current !== undefined && finished !== lastSyncSeen.current) qima.refresh()
          lastSyncSeen.current = finished
        } catch (e) { setError(e.message) }
      }, [])
      useEffect(() => {
        load()
        const timer = setInterval(load, 60_000)
        return () => clearInterval(timer)
      }, [load])

      async function sync() {
        setSyncing(true); setSyncNote('')
        try {
          const r = await api('POST', '/egx/api/market/sync', {})
          if (r.ok === false && r.error === 'no_key') setSyncNote('لم يتم العثور على مفتاح EODHD.')
          else if (r.ok === false) setSyncNote(`تعذّر التحديث: ${r.error}`)
          else {
            const parts = []
            parts.push(r.bars_updated.length ? `حُدّثت أسعار ${r.bars_updated.length} سهمًا` : 'الأسعار محدّثة بالفعل')
            if (r.skipped_for_budget.length) parts.push(`${r.skipped_for_budget.length} بانتظار رصيد طلبات الغد`)
            setSyncNote(parts.join(' · '))
          }
          await load()
          qima.refresh()
        } catch (e) {
          setSyncNote(e.message)
        } finally {
          setSyncing(false)
        }
      }

      const rows = React.useMemo(() => {
        if (!data) return []
        const q = query.trim().toLowerCase()
        let list = data.rows.filter((r) => (!heldOnly || r.held) && (!q || r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)))
        const key = {
          weight: (r) => -r.weight_pct,
          change: (r) => (r.change_pct == null ? Infinity : -r.change_pct),
          period: (r) => { const v = periodValue(r, period); return v == null ? Infinity : -v },
          margin: (r) => { const m = r.valuation && marginToFair(r.valuation.fair_value, r.price); return m == null ? Infinity : -m },
          symbol: (r) => r.symbol,
        }[sort]
        return list.slice().sort((a, b) => { const x = key(a), y = key(b); return x < y ? -1 : x > y ? 1 : 0 })
      }, [data, query, heldOnly, sort, period])

      const run = data && data.last_sync
      const usage = run && run.daily_limit ? h('span', null, 'تحديثات الأسعار اليوم ', N(fmtCount((run.used_before || 0) + (run.calls_made || 0))), ' من ', N(fmtCount(run.daily_limit))) : null
      const latestDay = data && data.rows.reduce((m, r) => (r.as_of && r.as_of > m ? r.as_of : m), '')
      const b = data && data.breadth
      const priced = b ? b.up + b.down + b.flat : 0
      const headers = [['symbol', 'السهم'], [null, 'آخر سعر'], ['change', 'التغير اليومي'], ['period', `الأداء: ${PERIODS.find((p) => p[0] === period)[1]}`],
        [null, 'نطاق 52 أسبوعًا'], [null, 'الحجم'], ['margin', 'السعر العادل'], [null, 'التصنيف'], ['weight', 'الوزن']]
      const numeric = new Set([1, 2, 3, 4, 5, 6, 8])

      let body
      if (!data && !error) body = Array.from({ length: 8 }, (_, i) => h('tr', { key: i }, headers.map((_, j) =>
        h('td', { key: j }, h('span', { className: 'egxm-skel', style: { width: j ? 48 : 90 } })))))
      else if (!data) body = h('tr', null, h('td', { colSpan: headers.length, className: 'egxp-empty' }, 'تعذّر تحميل السوق.'))
      else if (!rows.length) body = h('tr', null, h('td', { colSpan: headers.length, className: 'egxp-empty' },
        heldOnly ? 'لا توجد أسهم في محفظتك تطابق البحث.' : 'لا يوجد سهم يطابق البحث.'))
      else body = rows.flatMap((r) => {
        const out = [h(MarketRow, { key: r.symbol, row: r, period, expanded: expanded === r.symbol, onToggle: (s) => setExpanded((cur) => (cur === s ? null : s)) })]
        if (expanded === r.symbol) out.push(h(SymbolDetail, { key: `${r.symbol}-detail`, row: r, colSpan: headers.length }))
        return out
      })

      const noKey = data && !data.last_sync && b && b.no_data === data.rows.length
      return h('div', { className: 'qm egxp-page', dir: 'rtl', lang: 'ar' },
        h('style', null, QM_CSS + CSS + MARKET_CSS),
        h(PanelHeader, { here: 'السوق', demo: Boolean(data && data.demo_data),
          actions: h('button', { type: 'button', className: 'q-btn q-btn-p', disabled: syncing, onClick: sync },
            syncing ? 'جارٍ التحديث…' : 'تحديث الأسعار الآن') }),
        h('div', null,
          h('div', { className: 'egxm-meta' },
            h('span', null, h('span', { className: 'egxm-dot' }),
              data ? (data.session_open ? 'الجلسة مفتوحة' : 'الجلسة مغلقة') : '…'),
            latestDay ? h('span', null, `آخر إغلاق ${weekdayName(latestDay)} `, N(fmtDate(latestDay))) : null,
            h('span', null, 'المصدر EODHD · أسعار متأخرة، ليست لحظية'),
            usage ? h('span', null, usage) : null,
            run && run.finished_at ? h('span', null, 'آخر تحديث ', N(fmtTime(run.finished_at))) : null)),
        noKey ? h('section', { className: 'egxp-section egxm-notice' },
          h('strong', null, 'لا توجد أسعار بعد. '),
          'التطبيق يجلب الأسعار تلقائيًا من EODHD كل بضع دقائق. تأكد من وجود المفتاح في ',
          h('code', { dir: 'ltr' }, '~/.dsh/.env'), ' (EODHD_API_KEY) أو في ملف ', h('code', { dir: 'ltr' }, 'egx-api.docx'),
          ' داخل مجلد المشروع، ثم اضغط «تحديث الأسعار الآن».') : null,
        b ? h('div', { className: 'egxm-breadth' },
          h('div', { className: 'egxm-breadth-bar', 'aria-hidden': true },
            priced ? [h('span', { key: 'u', style: { width: `${(b.up / priced) * 100}%`, background: 'var(--dsw-alias-state-success-primary)' } }),
              h('span', { key: 'f', style: { width: `${(b.flat / priced) * 100}%`, background: 'var(--dsw-alias-label-tertiary)' } }),
              h('span', { key: 'd', style: { width: `${(b.down / priced) * 100}%`, background: 'var(--dsw-alias-state-error-primary)' } })] : null),
          h('div', { className: 'egxm-breadth-legend' },
            h('span', null, 'صاعد ', N(fmtCount(b.up), 'q-up')),
            h('span', null, 'هابط ', N(fmtCount(b.down), 'q-down')),
            h('span', null, 'دون تغيير ', N(fmtCount(b.flat))),
            b.no_data ? h('span', null, 'بدون بيانات ', N(fmtCount(b.no_data))) : null)) : null,
        h('section', { className: 'egxp-section' },
          h('div', { className: 'egxm-toolbar', style: { marginBottom: 12 } },
            h('div', { className: 'egxm-toolbar-group' },
              h('input', { className: 'egxp-input egxm-search', type: 'search', placeholder: 'ابحث بالرمز أو الاسم', 'aria-label': 'بحث',
                value: query, onChange: (e) => setQuery(e.target.value) }),
              h('div', { className: 'egxm-seg', role: 'group', 'aria-label': 'فترة الأداء' },
                PERIODS.map(([k, label]) => h('button', { key: k, type: 'button', 'aria-pressed': period === k, onClick: () => setPeriod(k) }, label))),
              h('label', { className: 'egxm-check' },
                h('input', { type: 'checkbox', checked: heldOnly, onChange: (e) => setHeldOnly(e.target.checked) }), 'محفظتي فقط')),
            h('div', { className: 'egxm-toolbar-group' },
              h('label', { className: 'egxm-check' }, 'ترتيب',
                h('select', { className: 'egxp-input', value: sort, onChange: (e) => setSort(e.target.value) },
                  SORTS.map(([k, label]) => h('option', { key: k, value: k }, label)))),
              null)),
          syncNote ? h('div', { className: 'egxm-notice', role: 'status', style: { marginBottom: 10 } }, syncNote) : null,
          h('div', { className: 'egxp-table-wrap' },
            h('table', { className: 'egxm-table' },
              h('thead', null, h('tr', null, headers.map(([key, label], i) => h('th', {
                key: i, className: numeric.has(i) ? 'egxm-num' : undefined,
                'aria-sort': key && sort === key ? (key === 'symbol' ? 'ascending' : 'descending') : undefined,
              }, key ? h('button', { type: 'button', onClick: () => setSort(key) }, label, sort === key ? ' ▾' : '') : label)))),
              h('tbody', null, body))),
          error ? h('div', { className: 'egxp-error', role: 'alert' }, error) : null),
        h('p', { className: 'egxp-foot' },
          'الأسعار من EODHD: إغلاقات يومية، وأسعار متأخرة 15–20 دقيقة أثناء الجلسة على الخطط المدفوعة. ليست للتداول اللحظي، وليست توصية بالشراء أو البيع.'))
    }

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
