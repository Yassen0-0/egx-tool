// EGX portfolio panel for the Harness Web/Desktop client: a sidebar entry plus a
// page in the main area. Data comes from the host half's /egx/api routes, which
// run the same Python portfolio logic as the mcp__egx__portfolio_* tools.
window.__ModuleLoader__.load({
  id: 'dsh-egx-bundle',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useCallback } = React
    const h = React.createElement
    const PANEL_ID = 'egx-portfolio'

    const num = new Intl.NumberFormat('ar-EG-u-nu-latn', { maximumFractionDigits: 2 })
    const qtyFmt = new Intl.NumberFormat('ar-EG-u-nu-latn', { maximumFractionDigits: 4 })
    const pct = new Intl.NumberFormat('ar-EG-u-nu-latn', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' })
    const weightFmt = new Intl.NumberFormat('ar-EG-u-nu-latn', { style: 'percent', maximumFractionDigits: 1 })
    const RATING = { safe: 'آمن', balanced: 'متوازن', high_risk: 'مرتفع المخاطر' }
    const STATUS = {
      above_fair_value: 'أعلى من السعر العادل',
      at_or_below_fair_value: 'بين سعر الحماية والسعر العادل',
      below_protection: 'تحت سعر الحماية — يحتاج مراجعة',
    }
    const money = (v) => (v == null ? '—' : num.format(v))
    const tone = (v) => (v > 0 ? 'egxp-gain' : v < 0 ? 'egxp-loss' : '')

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

    const CSS = `
.egxp-page { height: 100%; overflow: auto; box-sizing: border-box; padding: 0 clamp(24px, 4vw, 48px) 48px;
  color: var(--dsw-alias-label-primary); display: flex; flex-direction: column; align-items: center; gap: 24px; }
.egxp-page > * { width: 100%; max-width: 1100px; }
.egxp-head { padding-top: 28px; display: flex; flex-direction: column; gap: 4px; }
[data-platform='darwin'] .egxp-head { padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px)); }
.egxp-title { margin: 0; font-size: 20px; font-weight: 500; line-height: 28px; }
.egxp-intro { margin: 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.egxp-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.egxp-card { border: 1px solid var(--dsw-alias-border-l3); border-radius: 12px; padding: 12px 16px; background: var(--dsw-alias-bg-layer-2); }
.egxp-card-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.egxp-card-value { font-size: 20px; font-weight: 500; margin-top: 2px; font-variant-numeric: tabular-nums; }
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
.egxp-error { color: var(--dsw-alias-state-error-primary); font-size: 13px; margin-top: 8px; }
.egxp-table-wrap { overflow-x: auto; }
.egxp-table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
.egxp-table th { font-weight: 500; font-size: 12px; color: var(--dsw-alias-label-secondary); text-align: start; padding: 8px; white-space: nowrap; border-bottom: 1px solid var(--dsw-alias-border-l3); }
.egxp-table td { padding: 10px 8px; border-bottom: 1px solid var(--dsw-alias-border-l4); white-space: nowrap; vertical-align: middle; }
.egxp-table tr:last-child td { border-bottom: 0; }
.egxp-num { text-align: end !important; }
.egxp-sym { font-weight: 500; }
.egxp-sub { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.egxp-gain { color: var(--dsw-alias-state-success-primary); }
.egxp-loss { color: var(--dsw-alias-state-error-primary); }
.egxp-badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 500; border: 1px solid currentColor; }
.egxp-safe { color: var(--dsw-alias-state-success-primary); }
.egxp-balanced { color: var(--dsw-alias-state-warn-primary); }
.egxp-high_risk { color: var(--dsw-alias-state-error-primary); }
.egxp-status-below_protection { color: var(--dsw-alias-state-error-primary); font-weight: 500; }
.egxp-status-at_or_below_fair_value { color: var(--dsw-alias-state-success-primary); }
.egxp-status-above_fair_value { color: var(--dsw-alias-state-warn-primary); }
.egxp-empty { padding: 24px 8px; text-align: center; color: var(--dsw-alias-label-tertiary); }
.egxp-actions { display: flex; gap: 6px; }
.egxp-cell-input { width: 90px; }
.egxp-foot { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
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
          h('div', { className: `egxp-card-value ${tone(totals.pnl)}` }, money(totals.pnl),
            totals.pnl_pct == null ? null : h('span', { className: 'egxp-sub' }, ' ', pct.format(totals.pnl_pct)))),
        h('div', { className: 'egxp-card' },
          h('div', { className: 'egxp-card-label' }, 'أسهم بدون سعر حالي'),
          h('div', { className: 'egxp-card-value' }, String(unpriced.length)),
          unpriced.length ? h('div', { className: 'egxp-card-note' }, `${unpriced.join('، ')} — أضف السعر في prices.csv`) : null))
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
          'aria-label': 'الكمية', onChange: (e) => setQuantity(e.target.value) }) : qtyFmt.format(row.quantity), true),
        td(editing ? h('input', { className: 'egxp-input egxp-cell-input', type: 'number', min: 0, step: 'any', value: buyPrice,
          'aria-label': 'سعر الشراء', onChange: (e) => setBuyPrice(e.target.value) }) : money(row.buy_price), true),
        td(money(row.cost), true),
        td([money(row.current_price), row.price_as_of ? sub(row.price_as_of) : null], true),
        td(money(row.market_value), true),
        td([h('span', { key: 'p', className: tone(row.pnl) }, money(row.pnl)),
          row.pnl_pct == null ? null : sub(pct.format(row.pnl_pct), tone(row.pnl_pct))], true),
        td(row.weight == null ? '—' : weightFmt.format(row.weight), true),
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
        try { setData(await api('GET', '/egx/api/portfolio')) } catch (e) { setError(e.message) }
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

      return h('div', { className: 'egxp-page', dir: 'rtl', lang: 'ar' },
        h('style', null, CSS),
        h('header', { className: 'egxp-head', 'data-window-drag': true },
          h('h1', { className: 'egxp-title' }, 'محفظتي'),
          h('p', { className: 'egxp-intro' }, 'أسهم EGX30 كما أدخلتها أنت. الأرقام مسؤوليتك، والأداة تعرضها فقط.')),
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
          'الأسعار من data/manual/prices.csv، والتقييمات من آخر تقييم محفوظ لكل سهم.'))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 10, label: 'المحفظة',
        }, PortfolioIcon))
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, PortfolioPage))
      },
    }
  },
})
