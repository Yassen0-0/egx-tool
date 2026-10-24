// «سجّل» (docs/الواجهة.md §٤): one place to record anything — a purchase, a transfer, an expense, a
// dividend, a debt, a payment, a certificate. A type switch on top, then the form for that type.
// The forms are the screen's own (AddLine, MoveForm, StockEventForm, RepayForm), passed in so this
// file does not import portfolio.js back; every check and every number stays theirs and Python's.
import { h, useState } from '../../shared/runtime.js'
import { DEBT_KIND, RepayForm } from './debts.js'
import { DEPOSIT_KIND } from './deposit.js'
import { StockEventForm } from './events.js'
import { MoveForm } from './moves.js'

const TYPES = [
  ['buy', 'شرا'], ['transfer', 'تحويل'], ['expense', 'خروج'], ['dividend', 'توزيعات'],
  ['debt', 'دين'], ['repay', 'سداد'], ['deposit', 'شهادة'],
]

/** Which types make sense for this ledger: nothing to move, no stock, no debt left → not offered. */
function offered(assets, debts) {
  const movable = assets.filter((a) => a.quantity > 0 && a.kind !== DEPOSIT_KIND)
  const stocks = movable.filter((a) => a.kind === 'stock' || a.kind === 'fund')
  const open = (debts || []).filter((d) => !d.settled)
  return TYPES.filter(([t]) => (t !== 'transfer' && t !== 'expense') || movable.length)
    .filter(([t]) => t !== 'dividend' || stocks.length)
    .filter(([t]) => t !== 'repay' || open.length)
}

const pickField = (label, value, onChange, options) => h('label', { className: 'q-stack l-composer-pick' },
  h('span', { className: 'q-label' }, label),
  h('select', { className: 'q-input', value, onChange: (e) => onChange(e.target.value) },
    options.map(([v, text]) => h('option', { key: v, value: v }, text))))

export function Composer({ ledger, catalog, places, initial = 'buy', AddLine, SearchBox, onDone, onCancel }) {
  const assets = ledger.groups.flatMap((g) => g.assets)
  const types = offered(assets, ledger.debts)
  const [type, setType] = useState(types.some(([t]) => t === initial) ? initial : 'buy')
  const [picked, setPicked] = useState(null)
  const movable = assets.filter((a) => a.quantity > 0 && a.kind !== DEPOSIT_KIND)
  const stocks = movable.filter((a) => a.kind === 'stock' || a.kind === 'fund')
  const openDebts = (ledger.debts || []).filter((d) => !d.settled)
  const [source, setSource] = useState((movable.find((a) => a.key === 'EGP') || movable[0] || {}).key || '')
  const [stock, setStock] = useState((stocks[0] || {}).key || '')
  const [debtKey, setDebtKey] = useState((openDebts[0] || {}).key || '')
  const choose = (t) => { setType(t); setPicked(null) }
  const done = (key, text) => onDone(key, text)

  let body
  if (type === 'buy') {
    body = picked
      ? h(AddLine, { key: picked.entry ? picked.entry.key : `custom:${picked.name}`, entry: picked.entry || null, customName: picked.name,
        places, onDone: (key) => done(key, 'اتسجّلت عملية الشرا'), onCancel: () => setPicked(null) })
      : h('div', { className: 'q-stack' },
        h(SearchBox, { catalog, autoFocus: true, onPick: (entry) => setPicked({ entry }), onCustom: (name) => setPicked({ name }) }),
        h('p', { className: 'l-hint' }, 'اكتب اسم الأصل: دولار، دهب 21، COMI، SPY، أو اسم صندوق. ومش لاقيه؟ ضيفه بالاسم.'))
  } else if (type === 'debt' || type === 'deposit') {
    body = h(AddLine, { key: type, entry: null, customName: '', initialKind: type === 'debt' ? DEBT_KIND : DEPOSIT_KIND, lockKind: true, places,
      onDone: (key) => done(key, type === 'debt' ? 'اتسجّل الدين' : 'اتسجّلت الشهادة'), onCancel })
  } else if (type === 'transfer' || type === 'expense') {
    const asset = movable.find((a) => a.key === source) || movable[0]
    body = h('div', { className: 'q-stack' },
      pickField('من', asset ? asset.key : '', setSource, movable.map((a) => [a.key, a.name])),
      asset ? h(MoveForm, { key: `${type}:${asset.key}`, asset, kind: type, catalog, SearchBox,
        onDone: () => done(asset.key, type === 'transfer' ? 'اتسجّل التحويل' : 'اتسجّل الخروج'), onCancel }) : null)
  } else if (type === 'dividend') {
    const asset = stocks.find((a) => a.key === stock) || stocks[0]
    body = h('div', { className: 'q-stack' },
      pickField('من سهم أو صندوق', asset ? asset.key : '', setStock, stocks.map((a) => [a.key, a.name])),
      asset ? h(StockEventForm, { key: asset.key, asset, kind: 'dividend', onDone: () => done(asset.key, 'اتسجّلت التوزيعات'), onCancel }) : null)
  } else if (type === 'repay') {
    const debt = openDebts.find((d) => d.key === debtKey) || openDebts[0]
    body = h('div', { className: 'q-stack' },
      pickField('الدين', debt ? debt.key : '', setDebtKey, openDebts.map((d) => [d.key, d.name])),
      debt ? h(RepayForm, { key: debt.key, debt, assets, onDone: () => done(debt.key, 'اتسجّل السداد'), onCancel }) : null)
  }

  return h('section', { className: 'l-composer', 'aria-label': 'سجّل',
      onKeyDown: (e) => { if (e.key === 'Escape') onCancel() } },
    h('div', { className: 'l-composer-head' },
      h('b', null, 'سجّل'),
      h('div', { className: 'q-seg', role: 'radiogroup', 'aria-label': 'نوع العملية' },
        types.map(([t, label]) => h('button', { key: t, type: 'button', role: 'radio', 'aria-checked': type === t, tabIndex: type === t ? 0 : -1,
          onClick: () => choose(t) }, label))),
      h('button', { type: 'button', className: 'q-toast-x l-composer-x', 'aria-label': 'قفل', onClick: onCancel }, '×')),
    body)
}
