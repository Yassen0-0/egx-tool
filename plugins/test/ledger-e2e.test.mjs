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
      await pick('دهب 24')
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
  assert.match(seen.gold, /الذهب عيار 24 \(جرام\)/)
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
      await click(row('الذهب عيار 24 (جرام)'))
      const gold = row('الذهب عيار 24 (جرام)').nextElementSibling
      await click(button('حذف', gold.querySelector('.l-lot')))
      await click(button('احذف العملية', gold))
      await wait(() => !row('الذهب عيار 24 (جرام)'), 'the gold row to go')
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
  assert.doesNotMatch(seen.final, /الذهب عيار 24 \(جرام\)/)
  assert.match(seen.final, /32,650 جنيه/)  // 26,000 + 5,000 + 1,650
})

test('a certificate: picked by kind, its terms typed, the mistakes named, then its row and terms', { skip }, async () => {
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
      const click = async (el) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) }) }
      const button = (label, scope = host) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
      const row = (name) => [...host.querySelectorAll('.l-row')].find((b) => b.textContent.includes(name))
      const labelled = (name) => [...host.querySelectorAll('form.l-add label')].find((l) => l.textContent.startsWith(name)).querySelector('input, select')
      const form = () => host.querySelector('form.l-add')
      await wait(() => host.querySelector('input[role="combobox"]') && row('الجنيه المصري'), 'the ledger from the earlier tests')
      const input = host.querySelector('input[role="combobox"]')
      await setValue(input, 'شهادة')
      await wait(() => host.querySelector('[role="option"]'), 'the add-by-name option')
      await act(async () => { host.querySelector('[role="option"]').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })) })
      await wait(form, 'the custom add line')
      await setValue(labelled('النوع'), 'deposit')
      seen.fields = [...form().querySelectorAll('label .q-label')].map((l) => l.textContent)
      seen.checks = [...form().querySelectorAll('label input[type="checkbox"]')].map((c) => [c.parentElement.textContent, c.checked])
      seen.kinds = [...labelled('النوع').options].map((o) => o.textContent)

      await click(button('إضافة', form()))
      seen.noAmount = form().querySelector('[role="alert"]').textContent
      await setValue(labelled('المبلغ'), '100,000')
      await setValue(labelled('العائد السنوي'), '27')
      await setValue(labelled('تاريخ البداية'), '1/1/2026')
      await setValue(labelled('تاريخ الاستحقاق'), '1/1/2025')
      await click(button('إضافة', form()))
      seen.badOrder = form().querySelector('[role="alert"]').textContent
      await setValue(labelled('تاريخ الاستحقاق'), '1/1/2029')
      await setValue(labelled('البنك'), 'البنك الأهلي')
      await setValue(labelled('صرف العائد'), 'monthly')
      await click(button('إضافة', form()))
      await wait(() => row('شهادة البنك الأهلي'), 'the certificate row')
      seen.row = row('شهادة البنك الأهلي').textContent
      seen.heading = text()

      await click(row('شهادة البنك الأهلي'))
      const detail = row('شهادة البنك الأهلي').nextElementSibling
      seen.detail = detail.textContent.replace(/\s+/g, ' ')

      // Editing the certificate changes its terms, not just the purchase line.
      await click(button('تعديل', detail))
      const box = (name) => [...detail.querySelectorAll('label')].find((l) => l.textContent.startsWith(name)).querySelector('input, select')
      seen.editFields = [...detail.querySelectorAll('.l-lot label .q-label')].map((l) => l.textContent)
      await setValue(box('العائد السنوي'), '30')
      await setValue(box('تاريخ الاستحقاق'), '1/1/2025')
      await click(button('حفظ', detail))
      seen.editBadOrder = detail.querySelector('[role="alert"]').textContent
      await setValue(box('تاريخ الاستحقاق'), '1/1/2030')
      await click(button('حفظ', detail))
      await wait(() => row('شهادة البنك الأهلي 30%'), 'the certificate at its new rate')
      seen.edited = row('شهادة البنك الأهلي 30%').nextElementSibling.textContent.replace(/\s+/g, ' ')
    },
  })
  assert.deepEqual(r.errors, [])
  assert.deepEqual(seen.fields, ['النوع', 'البنك', 'المبلغ (ج.م)', 'العائد السنوي %', 'تاريخ البداية', 'تاريخ الاستحقاق', 'صرف العائد', 'ملاحظة (اختياري)'])
  assert.ok(seen.kinds.includes('شهادة/وديعة'))
  assert.deepEqual(seen.checks, [['العائد والأصل في الاستحقاق يدخلوا الجنيه اللي في السجل', true], ['اشتريتها بجنيه من اللي في السجل', false]])
  assert.match(seen.noAmount, /اكتب مبلغ الشهادة/)
  assert.match(seen.badOrder, /بعد تاريخ البداية/)
  assert.match(seen.row, /100,000/)
  assert.match(seen.row, /27% · شهري/)
  assert.match(seen.heading, /شهادات وودائع/)
  assert.match(seen.detail, /العائد السنوي 27%/)
  assert.match(seen.detail, /صرف شهري/)
  assert.match(seen.detail, /الاستحقاق 01\/01\/2029/)
  assert.match(seen.detail, /العائد في السنة 27,000 ج\.م/)
  assert.match(seen.detail, /الصرف الجاي \d\d\/\d\d\/\d{4}/)
  assert.doesNotMatch(seen.detail, /تحديث السعر/)
  assert.deepEqual(seen.editFields, ['المبلغ', 'تاريخ البداية', 'العائد السنوي %', 'تاريخ الاستحقاق', 'صرف العائد', 'البنك', 'ملاحظة'])
  assert.match(seen.editBadOrder, /بعد تاريخ البداية/)
  assert.match(seen.edited, /العائد السنوي 30%/)
  assert.match(seen.edited, /الاستحقاق 01\/01\/2030/)
  assert.match(seen.edited, /العائد في السنة 30,000 ج\.م/)
})

test('money moving: pounds to riyals, the other side one click away, a shortfall named then topped up, a sale back', { skip }, async () => {
  const seen = {}
  const r = await harness.renderClient([join(here, '..', 'monos-portfolio', 'client.js')], {
    fetch: backend,
    now: Date.now(),
    async interact(key, host, { act, window }) {
      if (!host.querySelector('.qm')) return
      const text = (el = host) => el.textContent.replace(/\s+/g, ' ')
      const wait = async (cond, what) => {
        for (let i = 0; i < 300; i++) {
          if (cond()) return
          await act(async () => { await new Promise((res) => setTimeout(res, 20)) })
        }
        throw new Error(`timed out waiting for ${what}\n${text().slice(-600)}`)
      }
      const setValue = async (el, value) => {
        const proto = el.type === 'checkbox' ? null : window.HTMLInputElement.prototype
        await act(async () => {
          if (proto) {
            Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
            el.dispatchEvent(new window.Event('input', { bubbles: true }))
          } else el.click()
        })
      }
      const click = async (el) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) }) }
      const button = (label, scope = host) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
      const row = (name) => [...host.querySelectorAll('.l-row')].find((b) => b.querySelector('.l-name').textContent === name)
      const detail = (name) => row(name).nextElementSibling
      const form = () => host.querySelector('form.l-move')
      const field = (name) => form() && [...form().querySelectorAll('label, .q-stack')].find((l) => l.textContent.startsWith(name))
      const labelled = (name) => field(name).querySelector('input')
      const submit = () => click(button('سجّل', form()))

      await wait(() => row('الجنيه المصري'), 'the pounds from the earlier tests')
      await click(row('الجنيه المصري'))
      await click(button('تحويل منه', detail('الجنيه المصري')))
      await submit()
      seen.noQuantity = form().querySelector('[role="alert"]').textContent
      await setValue(labelled('خرج كام'), '1000')
      await setValue(form().querySelector('input[role="combobox"]'), 'ريال')
      await wait(() => form().querySelector('[role="option"]'), 'the riyal in the move search')
      await act(async () => { form().querySelector('[role="option"]').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })) })
      await wait(() => field('دخل كام'), 'the arrived field (riyals)')
      await setValue(labelled('دخل كام'), '70')
      seen.rate = text(form())
      await submit()
      await wait(() => text(detail('الجنيه المصري')).includes('الحركات'), 'the transfer in the pounds')
      seen.out = text(detail('الجنيه المصري'))

      // The other side of a movement opens with one click.
      await click([...detail('الجنيه المصري').querySelectorAll('.l-move-item button.q-link')].find((b) => b.textContent === 'الريال السعودي'))
      await wait(() => row('الريال السعودي').getAttribute('aria-expanded') === 'true', 'the riyal row to open')
      seen.in = text(detail('الريال السعودي'))

      // 75 riyals sold for 1,050 pounds: only 70 are held, then the 5 are recorded as money from outside.
      await click(button('تحويل منه', detail('الريال السعودي')))
      await setValue(labelled('خرج كام'), '75')
      await setValue(form().querySelector('input[role="combobox"]'), 'جنيه')
      await wait(() => form().querySelector('[role="option"]'), 'the pound in the move search')
      await act(async () => { form().querySelector('[role="option"]').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })) })
      await wait(() => field('دخل كام'), 'the arrived field (sale)')
      await setValue(labelled('دخل كام'), '1050')
      await submit()
      await wait(() => form().querySelector('[role="alert"]'), 'the shortfall')
      seen.short = form().querySelector('[role="alert"]').textContent
      await setValue(form().querySelector('input[type="checkbox"]'))
      await submit()
      await wait(() => row('الريال السعودي') && row('الريال السعودي').closest('section').getAttribute('aria-label') === 'اتصرفت بالكامل', 'the riyal to close')
      seen.closed = text(row('الريال السعودي').closest('section'))
      seen.total = text(host.querySelector('.l-total'))

      // «الحركات»: the whole ledger's movements, and an asset's name back to its row.
      await click([...host.querySelectorAll('[role="tab"]')].find((b) => b.textContent === 'الحركات'))
      await wait(() => host.querySelector('.l-act'), 'the activity list')
      seen.activity = text(host.querySelector('.l-activity'))
      await click([...host.querySelectorAll('.l-act button.q-link')].find((b) => b.textContent === 'الريال السعودي'))
      await wait(() => row('الريال السعودي') && row('الريال السعودي').getAttribute('aria-expanded') === 'true', 'the riyal row from the activity')
    },
  })
  assert.deepEqual(r.errors, [])
  assert.match(seen.noQuantity, /اكتب الكمية اللي خرجت/)
  assert.match(seen.rate, /سعرك 14\.29 ج\.م للـ SAR/)
  assert.match(seen.out, /−1,000 ج\.م لـ الريال السعودي \(70 SAR\)/)
  assert.match(seen.out, /الحركات/)
  assert.match(seen.in, /\+70 SAR من الجنيه المصري \(1,000 ج\.م\)/)
  assert.match(seen.in, /سعر السوق يومها 971 ج\.م/)  // 70 × 52 / 3.75
  assert.match(seen.short, /ناقص 5/)
  assert.match(seen.closed, /اتحوّل أو اتصرف كله/)
  assert.match(seen.total, /ربح محقق −19/)  // 1,050 − (1,000 + 5 × 13.87)
  assert.match(seen.activity, /تحويل ?75 SAR من الريال السعودي ← 1,050 ج\.م في الجنيه المصري/)
  assert.match(seen.activity, /تحويل ?1,000 ج\.م من الجنيه المصري ← 70 SAR في الريال السعودي/)
  assert.match(seen.activity, /دخل ?5 SAR في الريال السعودي/)  // the gap recorded as money from outside
})

test('a debt: added by kind with its pounds received at a place, an installment paid, pounds moved between places', { skip }, async () => {
  const seen = {}
  const r = await harness.renderClient([join(here, '..', 'monos-portfolio', 'client.js')], {
    fetch: backend,
    now: Date.now(),
    async interact(key, host, { act, window }) {
      if (!host.querySelector('.qm')) return
      const text = (el = host) => el.textContent.replace(/\s+/g, ' ')
      const wait = async (cond, what) => {
        for (let i = 0; i < 300; i++) {
          if (cond()) return
          await act(async () => { await new Promise((res) => setTimeout(res, 20)) })
        }
        throw new Error(`timed out waiting for ${what}\n${text().slice(-600)}`)
      }
      const setValue = async (el, value) => {
        const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
        await act(async () => {
          if (el.type === 'checkbox') { el.click(); return }
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
          el.dispatchEvent(new window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
        })
      }
      const click = async (el) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) }) }
      const button = (label, scope = host) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
      const row = (name) => [...host.querySelectorAll('.l-row')].find((b) => b.querySelector('.l-name').textContent === name)
      const detail = (name) => row(name).nextElementSibling
      const labelIn = (scope, name) => [...scope.querySelectorAll('label, .q-stack')].find((l) => l.textContent.startsWith(name)).querySelector('input, select')

      await wait(() => host.querySelector('input[role="combobox"]') && row('الجنيه المصري'), 'the ledger from the earlier tests')
      await setValue(host.querySelector('input[role="combobox"]'), 'قرض العربية')
      await wait(() => host.querySelector('[role="option"]'), 'the add-by-name option')
      await act(async () => { host.querySelector('[role="option"]').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })) })
      const form = () => host.querySelector('form.l-add')
      await wait(form, 'the add line')
      await setValue(labelIn(form(), 'النوع'), 'debt')
      await setValue(labelIn(form(), 'اسمه'), 'قرض العربية')
      await setValue(labelIn(form(), 'المبلغ اللي عليك'), '50,000')
      await setValue(labelIn(form(), 'القسط الشهري'), '2500')
      await setValue(labelIn(form(), 'يوم القسط'), '5')
      await setValue([...form().querySelectorAll('input[type="checkbox"]')][0])
      await setValue(labelIn(form(), 'في مكان'), 'الأهلي')
      await click(button('إضافة', form()))
      await wait(() => row('قرض العربية'), 'the debt row')
      seen.total = text(host.querySelector('.l-total'))
      seen.debt = text(row('قرض العربية'))

      await click(row('قرض العربية'))
      await click(button('سدّد', detail('قرض العربية')))
      const repay = () => host.querySelector('form[aria-label="سداد"]')
      await click(button('سجّل السداد', repay()))
      await wait(() => text(detail('قرض العربية')).includes('السدادات (1)'), 'the payment')
      seen.paid = text(detail('قرض العربية'))
      seen.paidRow = text(row('قرض العربية'))

      await click(row('الجنيه المصري'))
      await wait(() => detail('الجنيه المصري') && text(detail('الجنيه المصري')).includes('فين:'), 'the places of the pounds')
      seen.places = text(detail('الجنيه المصري'))
      await click(button('نقل لمكان تاني', detail('الجنيه المصري')))
      const move = () => host.querySelector('form[aria-label="نقل"]')
      await setValue(labelIn(move(), 'خرج كام'), '1000')
      await setValue(labelIn(move(), 'من مكان'), 'الأهلي')
      await setValue(labelIn(move(), 'دخل كام'), '1000')
      await setValue(labelIn(move(), 'لمكان'), 'كاش')
      await click(button('سجّل', move()))
      await wait(() => text(detail('الجنيه المصري')).includes('كاش 1,000'), 'the pounds in cash')
      seen.moved = text(detail('الجنيه المصري'))
    },
  })
  assert.deepEqual(r.errors, [])
  assert.match(seen.total, /جنيه صافي \(بعد الديون\)/)
  assert.match(seen.total, /ديون 50,000/)
  assert.match(seen.debt, /قسط 2,500/)
  assert.match(seen.debt, /50,000باقي من 50,000/)
  assert.match(seen.paid, /−2,500 ج\.م من الدين/)
  assert.match(seen.paid, /دفعت 2,500 ج\.م من الجنيه المصري/)
  assert.match(seen.paidRow, /47,500باقي من 50,000/)
  // A payment with no place named comes out of every place in proportion.
  const before = Number(/فين: الأهلي ([\d,]+)/.exec(seen.places)[1].replace(/,/g, ''))
  assert.ok(before < 50000 && before > 45000)
  assert.match(seen.places, /سداد قرض العربية/)
  assert.match(seen.moved, new RegExp(`الأهلي ${(before - 1000).toLocaleString('en-US')}`))
  assert.match(seen.moved, /نقل من الأهلي لـ كاش/)
})

test('a stock: bought, a dividend into the pounds, bonus shares at no cost, and what is due soon', { skip }, async () => {
  const seen = {}
  const r = await harness.renderClient([join(here, '..', 'monos-portfolio', 'client.js')], {
    fetch: backend,
    now: Date.now(),
    async interact(key, host, { act, window }) {
      if (!host.querySelector('.qm')) return
      const text = (el = host) => el.textContent.replace(/\s+/g, ' ')
      const wait = async (cond, what) => {
        for (let i = 0; i < 300; i++) {
          if (cond()) return
          await act(async () => { await new Promise((res) => setTimeout(res, 20)) })
        }
        throw new Error(`timed out waiting for ${what}\n${text().slice(-600)}`)
      }
      const setValue = async (el, value) => {
        await act(async () => {
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value)
          el.dispatchEvent(new window.Event('input', { bubbles: true }))
        })
      }
      const click = async (el) => { await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) }) }
      const button = (label, scope = host) => [...scope.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
      const row = (name) => [...host.querySelectorAll('.l-row')].find((b) => b.querySelector('.l-name').textContent === name)
      const detail = (name) => row(name).nextElementSibling
      const labelIn = (scope, name) => [...scope.querySelectorAll('label, .q-stack')].find((l) => l.textContent.startsWith(name)).querySelector('input')
      const bank = 'البنك التجاري الدولي'

      await wait(() => host.querySelector('input[role="combobox"]') && row('الجنيه المصري'), 'the ledger from the earlier tests')
      seen.upcoming = text(host.querySelector('.l-upcoming'))
      await setValue(host.querySelector('input[role="combobox"]'), 'COMI')
      await wait(() => host.querySelector('[role="option"]'), 'COMI in the search')
      await act(async () => { host.querySelector('[role="option"]').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })) })
      const add = host.querySelector('form.l-add')
      await setValue(add.querySelector('input[aria-label="الكمية أو المبلغ"]'), '100')
      await setValue(add.querySelector('input[aria-label="سعر الشرا"]'), '100')
      await click(button('إضافة', add))
      await wait(() => row(bank), 'the stock row')
      await click(row(bank))

      await click(button('توزيعات', detail(bank)))
      await setValue(labelIn(host.querySelector('form[aria-label="توزيعات"]'), 'المبلغ اللي دخلك'), '250')
      await click(button('سجّل', host.querySelector('form[aria-label="توزيعات"]')))
      await wait(() => text(detail(bank)).includes('توزيعات استلمتها 250'), 'the dividend under the stock')

      await click(button('أسهم مجانية', detail(bank)))
      const bonus = host.querySelector('form[aria-label="أسهم مجانية أو تقسيم"]')
      await setValue(labelIn(bonus, 'عدد الأسهم المجانية'), '10')
      await click(button('سجّل', bonus))
      await wait(() => text(row(bank)).includes('110 سهم'), 'the bonus shares')
      seen.stock = text(detail(bank))
      seen.row = text(row(bank))
      await click(row('الجنيه المصري'))
      await wait(() => detail('الجنيه المصري'), 'the pounds open')
      seen.pounds = text(detail('الجنيه المصري'))
    },
  })
  assert.deepEqual(r.errors, [])
  assert.match(seen.upcoming, /الجاي قريب.*عائد شهادة البنك الأهلي 30% ?2,500 ج\.م.*قسط قرض العربية ?2,500 ج\.م/)
  assert.match(seen.stock, /\+10 سهم أسهم مجانية/)
  assert.match(seen.row, /110 سهم/)
  assert.match(seen.row, /13,420/)  // 110 × 122, at the same 10,000 cost
  assert.match(seen.row, /\+34\.2%/)
  assert.match(seen.pounds, /توزيعات البنك التجاري الدولي/)
})
