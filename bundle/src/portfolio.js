// «قيمة / المحفظة»: today first and biggest, the add form above the holdings with a live total,
// and the holdings grid tied to each stock's valuation (§7.4). Inlined into the factory scope.
// Data comes from the shared portfolio store (identity.js), so the sidebar icon always agrees.

const PORTFOLIO_CSS = '/* @css portfolio.css */'
const HOLDING_SORTS = [['pnl', 'مساهمة الربح/الخسارة'], ['value', 'القيمة'], ['share', 'نسبة من المحفظة']]
const todayCairo = () => cairoDay(new Date().toISOString())

function SummaryCard({ portfolio, lastClose }) {
  const t = portfolio.totals
  const valued = portfolio.holdings.filter((r) => r.fair_value != null)
  const under = t.below_protection.length
  const unvalued = portfolio.holdings.length - valued.length
  return h('section', { className: 'q-card', 'aria-label': 'ملخص المحفظة', style: { overflow: 'hidden' } },
    h('div', { className: 'p-summary' },
      h('div', null,
        h('small', null, h('b', { style: { color: 'var(--dsw-alias-label-primary)' } }, 'اليوم'), t.today_as_of ? [' · حتى إغلاق ', N(fmtDayMonth(t.today_as_of))] : null),
        t.today_has_fresh
          ? [h('span', { key: 'v', className: `num q-hero ${toneOf(t.today_change)}` }, fmtSigned(t.today_change)),
            h('span', { key: 'p', className: `num ${toneOf(t.today_change)}`, style: { fontWeight: 600 } }, fmtPct(t.today_change_pct, { digits: 2, signed: true }))]
          : [h('span', { key: 'v', className: 'num q-hero q-ter' }, '—'), h('small', { key: 'n' }, 'لا يوجد سعر جديد اليوم لأسهمك')]),
      h('div', null, h('small', null, 'القيمة الحالية'), N(fmtPrice(t.market_value), 'p-big'), h('small', null, 'ج.م')),
      h('div', null, h('small', null, 'الربح / الخسارة الكلي'), N(fmtSigned(t.pnl), `p-big ${toneOf(t.pnl)}`),
        t.pnl_pct == null ? null : h('small', null, N(fmtPct(t.pnl_pct, { signed: true })))),
      h('div', null, h('small', null, 'التكلفة الإجمالية'), N(fmtPrice(t.cost), 'p-big'), h('small', null, 'ج.م')),
      h('div', null, h('small', null, 'حالة التقييم'),
        under ? h('span', { className: 'q-amber' }, 'تحت سعر الحماية: ', N(String(under))) : h('span', { className: 'q-sec' }, 'لا يوجد سهم تحت سعر الحماية'),
        unvalued ? h('small', null, 'لم يُقيَّم بعد: ', N(String(unvalued))) : null,
        t.unpriced_holdings.length ? h('small', null, 'بانتظار السعر: ', t.unpriced_holdings.join('، ')) : null)),
    h('div', { className: 'p-strip' },
      portfolio.demo_data ? h('span', { className: 'q-chip' }, 'بيانات تجريبية') : null,
      h('span', null, portfolio.demo_data ? 'المراكز أمثلة توضيحية من بيانات التطوير. ' : '',
        'الأرقام كما أدخلتها أنت، والأسعار إغلاق متأخر وليست لحظية',
        lastClose ? [' (آخر إغلاق ', N(fmtDate(lastClose)), ')'] : null)))
}

function AddForm({ universe, onAdded, startOpen }) {
  const [open, setOpen] = useState(startOpen)
  const [symbol, setSymbol] = useState('')
  const [price, setPrice] = useState('')
  const [mode, setMode] = useState('shares')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (startOpen) setOpen(true) }, [startOpen])

  const sym = symbol.trim().toUpperCase().split(/\s/)[0]
  const known = universe.find((c) => c.symbol === sym)
  const p = parseNumberInput(price)
  const a = parseNumberInput(amount)
  const valid = p > 0 && a > 0
  const shares = valid ? (mode === 'shares' ? a : a / p) : null
  const total = valid ? (mode === 'shares' ? a * p : a) : null

  async function submit(e) {
    e.preventDefault()
    setError('')
    const day = parseDayInput(date)
    if (!known) return setError('اختر سهمًا من قائمة EGX30.')
    if (!(p > 0)) return setError('أدخل سعر تنفيذ أكبر من صفر.')
    if (!(a > 0)) return setError(mode === 'shares' ? 'أدخل عدد الأسهم.' : 'أدخل المبلغ بالجنيه.')
    if (day === undefined) return setError('اكتب التاريخ بصيغة يوم/شهر/سنة، أو اتركه فارغًا لليوم.')
    const body = { symbol: known.symbol, buy_price: p, buy_date: day || todayCairo(), note: note.trim() || null }
    body[mode === 'shares' ? 'quantity' : 'invested_amount'] = a
    setBusy(true)
    try {
      await api('POST', '/egx/api/holdings', body)
      setSymbol(''); setPrice(''); setAmount(''); setDate(''); setNote('')
      onAdded(known.symbol)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const plus = h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }, h('path', { d: 'M8 3v10M3 8h10' }))
  return h('section', { className: 'q-card', 'aria-label': 'إضافة سهم' },
    h('div', { className: 'p-formhead' },
      h('button', { type: 'button', className: 'q-btn', 'aria-expanded': open, 'aria-controls': 'p-add-form', onClick: () => setOpen(!open) }, plus, 'أضف سهمًا'),
      h('span', { className: 'q-meta' }, 'إدخال يدوي بالسعر والتاريخ كما نُفّذ فعلًا.'),
      h('span', { className: 'q-grow' }),
      h('button', { type: 'button', className: 'q-btn', disabled: true, title: 'قريبًا: رفع ملف جداول فيه الرمز والكمية وسعر التنفيذ والتاريخ لإضافة كل المراكز مرة واحدة' },
        'استيراد ملف جداول (CSV) · قريبًا')),
    open ? h('form', { id: 'p-add-form', onSubmit: submit, noValidate: true },
      h('div', { className: 'p-form' },
        h('label', { className: 'q-stack' }, h('span', { className: 'q-label' }, 'السهم'),
          h('input', { className: 'q-input', list: 'p-universe', value: symbol, placeholder: 'ابحث بالرمز أو الاسم، مثل COMI أو التجاري', autoComplete: 'off',
            onChange: (e) => setSymbol(e.target.value) }),
          h('datalist', { id: 'p-universe' }, universe.map((c) => h('option', { key: c.symbol, value: c.symbol }, `${c.symbol} — ${c.name_ar || c.name}`))),
          known ? h('small', { className: 'q-sec' }, known.name_ar) : null),
        h('label', { className: 'q-stack' }, h('span', { className: 'q-label' }, 'سعر التنفيذ (ج.م)'),
          h('input', { className: 'q-input num', inputMode: 'decimal', value: price, placeholder: '80.00', onChange: (e) => setPrice(e.target.value) })),
        h('div', { className: 'q-stack' }, h('span', { className: 'q-label', id: 'p-qty-l' }, mode === 'shares' ? 'الكمية' : 'المبلغ'),
          h('div', { className: 'q-row', style: { flexWrap: 'nowrap', gap: 8 } },
            h('div', { className: 'q-seg', role: 'group', 'aria-label': 'طريقة إدخال الكمية' },
              h('button', { type: 'button', 'aria-pressed': mode === 'shares', onClick: () => setMode('shares') }, 'عدد الأسهم'),
              h('button', { type: 'button', 'aria-pressed': mode === 'amount', onClick: () => setMode('amount') }, 'المبلغ بالجنيه')),
            h('input', { className: 'q-input num', inputMode: 'decimal', value: amount, 'aria-labelledby': 'p-qty-l', style: { width: 110 },
              placeholder: mode === 'shares' ? '100' : '8000', onChange: (e) => setAmount(e.target.value) }))),
        h('label', { className: 'q-stack' }, h('span', { className: 'q-label' }, 'تاريخ التنفيذ ', h('small', null, '(اختياري، الافتراضي اليوم)')),
          h('input', { className: 'q-input', value: date, placeholder: 'يوم/شهر/سنة', inputMode: 'numeric', onChange: (e) => setDate(e.target.value) })),
        h('label', { className: 'q-stack' }, h('span', { className: 'q-label' }, 'ملاحظة ', h('small', null, '(اختياري)')),
          h('input', { className: 'q-input', value: note, maxLength: 200, onChange: (e) => setNote(e.target.value) }))),
      h('div', { className: 'p-formfoot' },
        h('span', { className: 'p-total', 'aria-live': 'polite' }, h('span', { className: 'q-sec' }, 'الإجمالي: '),
          valid ? (mode === 'shares'
            ? [N(`${fmtQty(a)} × ${fmtPrice(p)} = ${fmtPrice(total)}`, 'q-strong'), ' ج.م']
            : [N(fmtPrice(total), 'q-strong'), ' ج.م · الأسهم ', N(`${fmtPrice(a)} ÷ ${fmtPrice(p)} = ${fmtQty(Math.round(shares * 10000) / 10000)}`, 'q-strong')])
            : h('span', { className: 'q-ter' }, 'أدخل السعر والكمية')),
        h('span', { className: 'q-grow' }),
        error ? h('span', { className: 'q-error', role: 'alert' }, error) : null,
        h('button', { type: 'submit', className: 'q-btn q-btn-p', disabled: busy }, plus, busy ? 'جارٍ الإضافة…' : 'أضف إلى المحفظة'))) : null)
}

const EDIT_ICON = h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round' },
  h('path', { d: 'M10.5 2.5l3 3L6 13H3v-3z' }))
const TRASH_ICON = h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' },
  h('path', { d: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5' }))

function HoldingRow({ row, onChanged, onValue }) {
  const [mode, setMode] = useState('view')
  const [qty, setQty] = useState(String(row.quantity))
  const [cost, setCost] = useState(String(row.buy_price))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (action) => {
    setBusy(true); setError('')
    try { await action(); setMode('view'); onChanged() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const save = () => {
    const q = parseNumberInput(qty), c = parseNumberInput(cost)
    if (!(q > 0) || !(c > 0)) return setError('الكمية والسعر لازم يكونوا أكبر من صفر')
    return run(() => api('PATCH', `/egx/api/holdings/${row.id}`, { quantity: q, buy_price: c }))
  }
  const remove = () => run(() => api('DELETE', `/egx/api/holdings/${row.id}`, {}))
  const under = row.status === 'below_protection'
  const editing = mode === 'edit'
  const label = `${row.symbol} ${row.name_ar || ''}`.trim()
  return h('div', { className: `q-grid p-g p-row${under ? ' q-warn' : ''}`, role: 'row' },
    h('span', { className: 'q-cell', role: 'cell' },
      h('b', { className: 'q-sym' }, row.symbol), h('span', null, row.name_ar || row.name),
      editing
        ? h('span', { className: 'q-row', style: { gap: 6 } },
          h('input', { className: 'q-input num', value: qty, 'aria-label': `عدد أسهم ${label}`, onChange: (e) => setQty(e.target.value) }),
          h('small', null, 'سهم @'),
          h('input', { className: 'q-input num', value: cost, 'aria-label': `سعر التنفيذ لـ ${label}`, onChange: (e) => setCost(e.target.value) }))
        : h('small', null, N(fmtQty(row.quantity)), ' سهم · متوسط التكلفة ', N(fmtPrice(row.buy_price)))),
    h('span', { role: 'cell' }, h(PriceCell, { price: row.current_price, asOf: row.price_as_of, stale: row.price_stale, kind: row.price_as_of && row.price_as_of.length > 10 ? 'delayed' : 'close' })),
    h('span', { className: 'q-cell', role: 'cell' },
      row.today_change != null
        ? [N(fmtSigned(row.today_change), toneOf(row.today_change)), h('small', { key: 'p' }, N(fmtPct(row.day_change_pct, { digits: 2, signed: true }), toneOf(row.day_change_pct)))]
        : row.price_stale ? [N(fmtSigned(row.day_change == null ? null : row.day_change * row.quantity), 'q-ter'), h('small', { key: 's' }, 'جلسة ', N(fmtDayMonth(row.price_as_of)))]
          : h('span', { className: 'q-ter' }, '—')),
    h('span', { role: 'cell' }, N(fmtPrice(row.market_value))),
    h('span', { className: 'q-cell', role: 'cell' }, N(fmtSigned(row.pnl), toneOf(row.pnl)),
      row.pnl_pct == null ? null : h('small', null, N(fmtPct(row.pnl_pct, { signed: true }), toneOf(row.pnl_pct)))),
    h('span', { role: 'cell' }, N(fmtPct(row.share_of_portfolio))),
    h('span', { className: 'q-cell', role: 'cell', style: { alignItems: 'stretch' } },
      row.fair_value != null
        ? [h(Ruler, { key: 'r', fair: row.fair_value, bear: row.bear, bull: row.bull, price: row.current_price }),
          row.current_price != null ? h(MarginText, { key: 'm', price: row.current_price, fair: row.fair_value }) : null,
          under ? h('small', { key: 'u' }, 'وأقل من العادل بـ ', N(fmtPct(row.margin_to_fair)))
            : row.current_price != null ? h('small', { key: 'u' }, row.status === 'above_fair_value' ? 'فوق العادل وفوق سعر الحماية' : 'فوق سعر الحماية') : null]
        : [h('span', { key: 'n', className: 'q-status' }, h(StatusMark, { status: 'between' }), 'لم يُقيَّم بعد'),
          h('button', { key: 'b', type: 'button', className: 'q-link', style: { padding: 0, minHeight: 28 }, onClick: () => onValue(row.symbol) }, 'اطلب التقييم من المحادثة')]),
    h('span', { className: 'p-actions', role: 'cell' },
      editing
        ? [h('button', { key: 's', type: 'button', className: 'q-btn q-btn-sm q-btn-p', disabled: busy, onClick: save }, 'حفظ'),
          h('button', { key: 'c', type: 'button', className: 'q-btn q-btn-sm q-btn-quiet', onClick: () => { setMode('view'); setQty(String(row.quantity)); setCost(String(row.buy_price)) } }, 'إلغاء')]
        : mode === 'confirm'
          ? [h('button', { key: 'd', type: 'button', className: 'q-btn q-btn-sm q-btn-danger', disabled: busy, onClick: remove }, 'احذف'),
            h('button', { key: 'c', type: 'button', className: 'q-btn q-btn-sm q-btn-quiet', onClick: () => setMode('view') }, 'إلغاء')]
          : [h('button', { key: 'e', type: 'button', className: 'q-btn q-icon-btn q-btn-quiet', 'aria-label': `تعديل ${label}`, title: 'تعديل', onClick: () => setMode('edit') }, EDIT_ICON),
            h('button', { key: 'r', type: 'button', className: 'q-btn q-icon-btn q-btn-quiet q-btn-danger', 'aria-label': `حذف ${label}`, title: 'حذف', onClick: () => setMode('confirm') }, TRASH_ICON)],
      error ? h('span', { className: 'q-error', role: 'alert', style: { fontSize: 12 } }, error) : null))
}

function sortHoldings(rows, key) {
  const value = { pnl: (r) => r.pnl, value: (r) => r.market_value, share: (r) => r.share_of_portfolio }[key]
  return rows.slice().sort((a, b) => {
    const x = value(a), y = value(b)
    if (x == null && y == null) return 0
    if (x == null) return 1
    if (y == null) return -1
    return y - x
  })
}

function PortfolioPage() {
  const portfolio = useQima()
  const [universe, setUniverse] = useState([])
  const [market, setMarket] = useState(null)
  const [sort, setSort] = useState('pnl')
  const [help, setHelp] = useState(false)
  const [toastNode, toast] = useToast()
  useEffect(() => {
    qima.refresh()
    api('GET', '/egx/api/universe').then((u) => setUniverse(u.constituents.slice().sort((a, b) => a.symbol.localeCompare(b.symbol)))).catch(() => {})
    api('GET', '/egx/api/market').then(setMarket).catch(() => {})
  }, [])
  const refresh = () => qima.refresh()
  const onValue = (symbol) => copyValuationPrompt(symbol, toast)
  const lastClose = market ? market.rows.reduce((m, r) => (r.price != null && r.as_of > m ? r.as_of.slice(0, 10) : m), '') : ''
  const session = market ? sessionLine(market.as_of, market.session_open) : null
  const run = market && market.last_sync
  const used = run && run.daily_limit ? (run.used_before || 0) + (run.calls_made || 0) : null

  const holdings = portfolio && portfolio.holdings ? sortHoldings(portfolio.holdings, sort) : []
  const loading = portfolio === undefined
  const failed = portfolio === null
  const empty = portfolio && !portfolio.holdings.length

  const headerMeta = market ? h('span', { className: 'q-meta', style: { marginInlineStart: 'auto' } },
    lastClose ? ['إغلاق ', N(fmtDayMonth(lastClose))] : null,
    run && run.finished_at ? [' · آخر مزامنة ', N(fmtTime(run.finished_at))] : null,
    used != null ? [' · تحديثات الأسعار اليوم ', N(fmtCount(used)), ' من ', N(fmtCount(run.daily_limit))] : null,
    ' · المصدر EODHD (مزوّد الأسعار)',
    session ? [' · ', session.text, session.time ? ' ' : null, session.time ? N(session.time) : null] : null) : null

  let content
  if (loading) content = h('div', { className: 'q-card q-pad', 'aria-busy': true }, h(Skeleton, { width: '30%' }), h('br'), h(Skeleton, { width: '80%' }), h('br'), h(Skeleton, { width: '60%' }))
  else if (failed) content = h('div', { className: 'q-card q-empty', role: 'alert' }, h('span', { className: 'q-h2' }, 'تعذّر تحميل المحفظة'),
    h('button', { type: 'button', className: 'q-btn', onClick: refresh }, 'حاول مرة أخرى'))
  else if (empty) content = [
    h('div', { key: 'e', className: 'q-card q-empty' },
      h(QimaIcon, { state: 'neutral', size: 40 }),
      h('span', { className: 'q-h2' }, 'محفظتك فاضية'),
      h('span', null, 'تقدر تستخدم قيمة للتحليل بس، أو تضيف الأسهم اللي عندك عشان تشوف حركتها اليومية وموقعها من التقييم.'),
      h('small', { className: 'q-ter' }, 'أيقونة قيمة تفضل محايدة لحد ما تضيف مراكز.')),
    h(AddForm, { key: 'f', universe, onAdded: refresh, startOpen: true }),
  ]
  else content = [
    h(SummaryCard, { key: 's', portfolio, lastClose }),
    h(AddForm, { key: 'f', universe, onAdded: refresh, startOpen: false }),
    h('section', { key: 'h', className: 'q-card', 'aria-label': 'المراكز', style: { overflow: 'hidden' } },
      h('div', { className: 'p-formhead' },
        h('h2', { className: 'q-h2' }, 'المراكز ', h('span', { className: 'q-sec', style: { fontSize: 13, fontWeight: 400 } }, '(', N(String(holdings.length)), ')')),
        h('span', { className: 'q-grow' }),
        h('span', { className: 'q-meta' }, 'ترتيب حسب'),
        h('div', { className: 'q-seg', role: 'group', 'aria-label': 'ترتيب المراكز' },
          HOLDING_SORTS.map(([key, label]) => h('button', { key, type: 'button', 'aria-pressed': sort === key, onClick: () => setSort(key) }, label)))),
      h('div', { className: 'q-scroll', role: 'table', 'aria-label': 'المراكز' },
        h('div', { className: 'q-grid p-g q-th', role: 'row' },
          ['السهم', 'آخر سعر', 'اليوم', 'القيمة', 'الربح / الخسارة', 'نسبة من المحفظة', 'موضع السعر من التقييم', ''].map((t, i) => h('span', { key: i, role: 'columnheader' }, t))),
        holdings.map((r) => h(HoldingRow, { key: `${r.id}:${r.updated_at}`, row: r, onChanged: refresh, onValue }))),
      h('div', { className: 'p-legend' },
        h('span', { className: 'm-key' }, h('span', { style: { width: 10, height: 10, borderRadius: '50%', background: 'var(--dsw-alias-label-primary)', display: 'inline-block' } }), 'آخر إغلاق'),
        h('span', { className: 'm-key' }, h('span', { style: { width: 3, height: 14, background: 'var(--dsw-alias-state-warn-primary)', display: 'inline-block' } }), 'سعر الحماية',
          h(ProtectionHelp, { open: help, onToggle: () => setHelp(!help) })),
        h('span', { className: 'm-key' }, h('span', { style: { width: 3, height: 14, background: 'var(--dsw-alias-state-business-primary)', display: 'inline-block' } }), 'السعر العادل'),
        h('span', { className: 'm-key' }, h('span', { style: { width: 18, height: 6, borderRadius: 3, background: 'var(--dsw-alias-state-business-primary)', opacity: 0.35, display: 'inline-block' } }), 'النطاق (المتشائم – المتفائل)')),
      h('div', { style: { padding: 16 } }, help ? h(ProtectionNote) : h('p', { className: 'q-meta', style: { margin: 0 } },
        'سعر الحماية = ', N('80%'), ' من السعر العادل. لو السعر نزل تحته، المحلل بيراجع التقييم تلقائيًا. ده تنبيه للمراجعة، مش أمر بيع.'))),
  ]

  return h('div', { className: 'qm', dir: 'rtl', lang: 'ar' },
    h('style', null, QM_CSS + MARKET_CSS + PORTFOLIO_CSS),
    h(PanelHeader, { here: 'المحفظة', demo: Boolean(portfolio && portfolio.demo_data) }, headerMeta),
    h('div', { className: 'q-wrap', style: { paddingTop: 12 } },
      content,
      h(Disclaimer, { extra: 'الأسعار إغلاق يومي متأخر من EODHD (مزوّد بيانات الأسعار)، وكل سعر مؤرّخ بيوم إغلاقه. الربح والخسارة محسوبان على التكلفة المُدخلة يدويًا ولا يشملان رسوم الوساطة أو الضرائب. «نسبة من المحفظة» = قيمة المركز ÷ قيمة المحفظة، وهي غير وزن السهم في المؤشر.' })),
    toastNode)
}
