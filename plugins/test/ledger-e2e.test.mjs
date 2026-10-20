// «السجل» end to end, the way a person uses it: the built screen in jsdom, every request answered by
// the real host API (monos-core/host/api.mjs) running the real egx-cli on a TEMPORARY database with
// synthetic prices. Never touches data/egx.sqlite. Skipped without the Python env (uv sync) or npm install.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const python = join(root, 'mcp', '.venv', 'bin', 'python')
let harness = null
try { harness = await import('./harness.mjs') } catch { /* dev dependencies not installed */ }
const skip = (!harness && 'run npm install at the repo root') || (!existsSync(python) && 'run uv sync --project mcp')

let handler
before(async () => {
  if (skip) return
  const tmp = mkdtempSync(join(tmpdir(), 'monos-e2e-'))
  Object.assign(process.env, { EGX_HOME: root, EGX_DATA_DIR: tmp, EGX_DB_PATH: join(tmp, 'egx.sqlite'), EGX_AUTO_SYNC: '0' })
  // Prices up to today (UTC): dollar 50 → 52, gold 4000 → 4100 $/oz, bitcoin 80,000 → 82,000 $,
  // COMI 120 → 122 with its last close yesterday or earlier.
  execFileSync(python, ['-I', '-c', `
from datetime import date, timedelta
from egx_mcp.store.db import connect
from egx_mcp.market import store
from egx_mcp.config import db_path
conn = connect(db_path())
today = date.today()
def put(symbol, closes, every_day=True):
    days, d = [], today - timedelta(days=1)
    while len(days) < len(closes):
        if every_day or d.weekday() in {6, 0, 1, 2, 3}:
            days.append(d)
        d -= timedelta(days=1)
    store.upsert_bars(conn, symbol, [{"date": x.isoformat(), "open": c, "high": c, "low": c, "close": c,
        "adjusted_close": c, "volume": 1.0} for x, c in zip(reversed(days), closes)], "EODHD")
put("USDEGP.FOREX", [50.0] * 400 + [52.0])
put("XAUUSD.FOREX", [4000.0, 4100.0])
put("BTC-USD.CC", [80000.0, 82000.0])
put("COMI", [120.0, 122.0], every_day=False)
conn.commit()
conn.close()
`], { env: process.env })
  const host = await import('../monos-core/host/api.mjs')
  host.apply({ effect: (fn) => fn(), webServer: { register: (route) => { handler = route.handler } } })
})

// The screen's fetch, answered by the real route handler.
function backend(path, init = {}) {
  const req = Readable.from(init.body === undefined ? [] : [Buffer.from(init.body)])
  Object.assign(req, { method: init.method || 'GET', url: path, headers: { host: '127.0.0.1:3180', ...(init.headers || {}) } })
  return new Promise((resolve) => {
    let status
    handler(req, {
      headersSent: false,
      writeHead: (s) => { status = s },
      end: (text) => resolve({ ok: status === 200, status, json: async () => JSON.parse(text) }),
    })
  })
}

test('a person builds a ledger: search, add, mistakes, a fund by name, edit and delete', { skip }, async () => {
  const seen = {}
  const r = await harness.renderClient([join(here, '..', 'monos-portfolio', 'client.js')], {
    fetch: backend,
    now: Date.now(),
    async interact(key, host, { act, window }) {
      if (!host.querySelector('.qm')) return  // the sidebar slot shares the key
      const text = () => host.textContent.replace(/\s+/g, ' ')
      const wait = async (cond, what) => {
        for (let i = 0; i < 300; i++) {
          if (cond()) return
          await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
        }
        throw new Error(`timed out waiting for ${what}\n${text()}`)
      }
      const setValue = async (el, value) => {
        const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
        await act(async () => {
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
          el.dispatchEvent(new window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
        })
      }
      const click = async (el) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) }) }
      const button = (label, scope = host) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
      const field = (label) => host.querySelector(`form.l-add [aria-label="${label}"]`)
      const labelled = (name) => [...host.querySelectorAll('form.l-add label')].find((l) => l.textContent.startsWith(name)).querySelector('input, select')
      const pick = async (query, index = 0) => {
        await setValue(input, query)
        await wait(() => host.querySelectorAll('[role="option"]')[index], `a result for ${query}`)
        const option = host.querySelectorAll('[role="option"]')[index]
        await act(async () => { option.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })) })
        await wait(() => host.querySelector('form.l-add'), 'the add line')
      }
      const submit = async () => { await click(button('إضافة', host.querySelector('form.l-add'))) }
      const row = (name) => [...host.querySelectorAll('.l-row')].find((b) => b.textContent.includes(name))

      await wait(() => text().includes('ابحث عن أصل وأضفه.'), 'the empty ledger')
      const input = host.querySelector('input[role="combobox"]')
      seen.empty = text()

      // 1. Dollars bought at 30.9, typed with Arabic-Indic digits.
      await pick('دولار')
      await setValue(field('الكمية أو المبلغ'), '١٠٠٠')
      await setValue(field('سعر الشرا'), '30.9')
      await submit()
      await wait(() => row('الدولار الأمريكي'), 'the dollar row')
      seen.dollar = row('الدولار الأمريكي').textContent

      // 2. Bitcoin in dollars: the EGP cost is filled from today's rate.
      await pick('بتكوين')
      await setValue(field('الكمية أو المبلغ'), '0.01')
      await setValue(field('سعر الشرا'), '60000')
      await wait(() => labelled('المبلغ اللي دفعته بالجنيه').value !== '', 'the EGP cost suggestion')
      seen.btcCost = labelled('المبلغ اللي دفعته بالجنيه').value
      await submit()
      await wait(() => row('بيتكوين'), 'the bitcoin row')
      seen.btc = row('بيتكوين').textContent

      // 3. Gold with mistakes first: no quantity, then an impossible date.
      await pick('دهب')
      seen.goldOptions = null
      await submit()
      seen.noQuantity = host.querySelector('form.l-add [role="alert"]').textContent
      await setValue(field('الكمية أو المبلغ'), '10')
      await setValue(field('سعر الشرا'), '4000')
      await setValue(labelled('التاريخ'), '32/13/2025')
      await submit()
      seen.badDate = host.querySelector('form.l-add [role="alert"]').textContent
      await setValue(labelled('التاريخ'), '1/6/2025')
      seen.goldHint = host.querySelector('form.l-add').textContent
      await setValue(field('سعر الشرا'), '130000')  // an ounce price typed for a gram
      seen.unitWarning = host.querySelector('form.l-add [role="status"]')?.textContent
      await setValue(field('سعر الشرا'), '4000')
      await submit()
      await wait(() => row('الذهب'), 'the gold row')
      seen.gold = row('الذهب').textContent

      // 4. Bitcoin bought long before any stored rate: the screen asks for the EGP paid.
      await pick('بتكوين')
      await setValue(field('الكمية أو المبلغ'), '0.01')
      await setValue(field('سعر الشرا'), '20000')
      await setValue(labelled('التاريخ'), '1/1/2020')
      await wait(() => true, 'nothing')
      await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
      await submit()
      await wait(() => host.querySelector('form.l-add [role="alert"]'), 'the missing rate message')
      seen.oldRate = host.querySelector('form.l-add [role="alert"]').textContent
      await click(button('إلغاء', host.querySelector('form.l-add')))

      // 5. A fund the catalog does not know, added by name with its current price.
      await setValue(input, 'صندوق مصر الذهبي')
      seen.customOption = host.querySelector('[role="option"]').textContent
      await act(async () => { host.querySelector('[role="option"]').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })) })
      await wait(() => host.querySelector('form.l-add'), 'the custom add line')
      await setValue(labelled('النوع'), 'fund')
      await setValue(labelled('السعر الحالي'), '15')
      await setValue(field('الكمية أو المبلغ'), '100')
      await setValue(field('سعر الشرا'), '10')
      await submit()
      await wait(() => row('صندوق مصر الذهبي'), 'the fund row')
      seen.fund = row('صندوق مصر الذهبي').textContent

      // 6. Its components: COMI at 30%.
      await click(row('صندوق مصر الذهبي'))
      const detail = row('صندوق مصر الذهبي').nextElementSibling
      await setValue(detail.querySelector('select[aria-label="السهم"]'), 'COMI')
      await setValue(detail.querySelector('input[aria-label="النسبة من الصندوق"]'), '30')
      await click(button('إضافة مكون', detail))
      await wait(() => row('صندوق مصر الذهبي').nextElementSibling.textContent.includes('من الصندوق'), 'the component')
      seen.component = row('صندوق مصر الذهبي').nextElementSibling.textContent

      // 7. Sold half the dollars: edit the purchase.
      await click(row('الدولار الأمريكي'))
      const usd = row('الدولار الأمريكي').nextElementSibling
      await click(button('تعديل', usd))
      const qty = [...usd.querySelectorAll('label')].find((l) => l.textContent.startsWith('الكمية')).querySelector('input')
      await setValue(qty, '500')
      await click(button('حفظ', usd))
      await wait(() => row('الدولار الأمريكي').textContent.includes('26,000'), 'the halved dollar value')
      seen.halfDollar = row('الدولار الأمريكي').textContent

      // 8. Delete the bitcoin entirely.
      await click(row('بيتكوين'))
      const btc = row('بيتكوين').nextElementSibling
      await click(button('حذف الأصل', btc))
      await click(button('احذف', btc))
      await wait(() => !row('بيتكوين'), 'the bitcoin row to go')
      seen.final = text()
    },
  })
  assert.deepEqual(r.errors, [])
  assert.match(seen.empty, /0 جنيه/)
  assert.match(seen.dollar, /52,000/)  // 1000 × 52
  assert.match(seen.dollar, /\+68\.3%/)  // 52 / 30.9 − 1
  assert.equal(seen.btcCost, '31200')  // 0.01 × 60000 × 52
  assert.match(seen.btc, /42,640/)  // 0.01 × 82000 × 52
  assert.match(seen.noQuantity, /اكتب الكمية/)
  assert.match(seen.badDate, /يوم\/شهر\/سنة/)
  assert.match(seen.goldHint, /سعر الجرام وقت الشرا/)
  assert.match(seen.goldHint, /آخر سعر 6,854\.\d\d ج\.م/)  // 4100 × 52 / 31.1035
  assert.match(seen.unitWarning, /راجع الوحدة/)
  assert.match(seen.gold, /الذهب \(جرام\)/)
  assert.match(seen.gold, /68,5\d\d/)  // 10 g × 4100 × 52 / 31.1035 = 68,546
  assert.match(seen.oldRate, /بالجنيه/)
  assert.match(seen.customOption, /إضافة بالاسم ده/)
  assert.match(seen.fund, /1,500/)  // 100 × 15
  assert.match(seen.component, /البنك التجاري الدولي/)
  assert.match(seen.component, /30\.0% من الصندوق/)
  assert.match(seen.halfDollar, /26,000/)
  assert.doesNotMatch(seen.final, /بيتكوين/)
  // Total = dollars 26,000 + gold 68,546 + fund 1,500.
  assert.match(seen.final, /96,04\d جنيه/)
})

test('the keyboard, cash in pounds, a fund found again by name, its price, and the last purchase going', { skip }, async () => {
  const seen = {}
  const r = await harness.renderClient([join(here, '..', 'monos-portfolio', 'client.js')], {
    fetch: backend,
    now: Date.now(),
    async interact(key, host, { act, window }) {
      if (!host.querySelector('.qm')) return
      const text = () => host.textContent.replace(/\s+/g, ' ')
      const wait = async (cond, what) => {
        for (let i = 0; i < 300; i++) {
          if (cond()) return
          await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
        }
        throw new Error(`timed out waiting for ${what}\n${text().slice(-600)}`)
      }
      const setValue = async (el, value) => {
        const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
        await act(async () => {
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
          el.dispatchEvent(new window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
        })
      }
      const key_ = async (el, k) => { await act(async () => { el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true })) }) }
      const click = async (el) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) }) }
      const button = (label, scope = host) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
      const row = (name) => [...host.querySelectorAll('.l-row')].find((b) => b.textContent.includes(name))
      await wait(() => host.querySelector('input[role="combobox"]') && row('الدولار الأمريكي'), 'the ledger from the first test')
      const input = host.querySelector('input[role="combobox"]')
      // Typed before the catalog arrives: nothing to pick yet, and no «add by name» for a known asset.
      await setValue(input, 'جنيه')
      seen.early = text().includes('جارٍ تحميل القائمة') ? 'loading' : [...host.querySelectorAll('[role="option"]')].map((o) => o.textContent).join(' | ')
      await wait(() => host.querySelector('[role="option"]'), 'the catalog')

      // Keyboard: «جنيه» → the Egyptian pound is first; ↓ moves to the next; ↑ back; Enter picks.
      await setValue(input, 'جنيه')
      seen.poundOptions = [...host.querySelectorAll('[role="option"]')].map((o) => o.textContent)
      await key_(input, 'ArrowDown')
      seen.active = input.getAttribute('aria-activedescendant')
      await key_(input, 'ArrowUp')
      await key_(input, 'Enter')
      await wait(() => host.querySelector('form.l-add'), 'the pound add line')
      seen.poundForm = host.querySelector('form.l-add').textContent
      await setValue(host.querySelector('form.l-add [aria-label="الكمية أو المبلغ"]'), '5,000')
      await click(button('إضافة', host.querySelector('form.l-add')))
      await wait(() => row('الجنيه المصري'), 'the cash row')
      seen.cash = row('الجنيه المصري').textContent

      // The fund added by name in the first test is in the search now.
      await setValue(input, 'مصر الذهبي')
      seen.fundOption = host.querySelector('[role="option"]').textContent
      await key_(input, 'Escape')
      seen.cleared = input.value

      // A new unit price for the fund, then its date shows when it is old: here it is today's.
      await click(row('صندوق مصر الذهبي'))
      const fund = row('صندوق مصر الذهبي').nextElementSibling
      await setValue(fund.querySelector('input[aria-label^="السعر الحالي"]'), '16.5')
      await click(button('حفظ السعر', fund))
      await wait(() => row('صندوق مصر الذهبي').textContent.includes('1,650'), 'the fund at its new price')
      seen.fund = row('صندوق مصر الذهبي').textContent

      // Deleting the only purchase of the gold removes the asset.
      await click(row('الذهب (جرام)'))
      const gold = row('الذهب (جرام)').nextElementSibling
      await click(button('حذف', gold.querySelector('.l-lot')))
      await click(button('احذف العملية', gold))
      await wait(() => !row('الذهب (جرام)'), 'the gold row to go')
      seen.final = text()
    },
  })
  assert.deepEqual(r.errors, [])
  assert.ok(seen.early === 'loading' || seen.early.startsWith('USDالجنيه') || seen.early.includes('الجنيه المصري'), seen.early)
  assert.doesNotMatch(seen.early, /إضافة بالاسم ده/)
  assert.ok(seen.poundOptions[0].includes('الجنيه المصري'), seen.poundOptions.join(' | '))
  assert.equal(seen.active, 'l-opt-1')
  assert.doesNotMatch(seen.poundForm, /سعر/)  // the pound is always 1: no price to type
  assert.match(seen.cash, /5,000/)
  assert.match(seen.cash, /0\.0%/)
  assert.match(seen.fundOption, /صندوق مصر الذهبي/)
  assert.equal(seen.cleared, '')
  assert.match(seen.fund, /\+65\.0%/)  // 16.5 / 10 − 1
  assert.doesNotMatch(seen.final, /الذهب \(جرام\)/)
  assert.match(seen.final, /32,650 جنيه/)  // 26,000 + 5,000 + 1,650
})
