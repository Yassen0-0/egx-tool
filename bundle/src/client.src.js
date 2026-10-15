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
    const nav = { selectPanel: null, pendingAnalysisId: null, pendingSection: null }

    const QM_CSS = '/* @css styles.css */'
    // One LTR-isolated span per number: sign, digits and % never get split by the bidi algorithm.
    const N = (text, cls) => h('span', { className: cls ? `num ${cls}` : 'num' }, text)

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
          blocks.push(h('div', { key: key++, className: 'q-scroll' }, h('table', null,
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
      return h('div', { ref, style: { height, direction: 'ltr', colorScheme: 'normal' } })
    }


    /* @inline labels.mjs */
    /* @inline components.js */
    /* @inline analyses.js */
    /* @inline market.js */
    /* @inline portfolio.js */

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
