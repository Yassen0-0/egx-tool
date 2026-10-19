// Scaffold a new Monos screen plugin: npm run new-plugin -- <name> "<Arabic title>"
// Creates plugins/monos-<name>/ with the package manifest, host stub, patch row, locale, icon,
// a client entry that registers a sidebar entry and a page, and FEATURE.md from _template/ (write
// that first). Then: npm run build && npm run check && ./scripts/install-desktop.sh --plugins-only
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const [slug, titleAr = slug] = process.argv.slice(2)
if (!slug || !/^[a-z][a-z0-9-]{1,30}$/.test(slug)) {
  console.error('usage: npm run new-plugin -- <name> "<Arabic title>"   (name: lowercase letters, digits, -)')
  process.exit(2)
}
const name = `monos-${slug}`
const dir = join(here, name)
if (existsSync(dir)) { console.error(`${name} already exists`); process.exit(1) }
mkdirSync(join(dir, 'src'), { recursive: true })
mkdirSync(join(dir, 'locale'))
const json = (value) => `${JSON.stringify(value, null, 2)}\n`
writeFileSync(join(dir, 'package.json'), json({
  name, version: '0.1.0', description: `Monos ${slug}`, license: 'UNLICENSED', private: true, type: 'module', icon: './icon.svg',
  exports: { '.': './index.js', './client': './client.js', './cordis.patch.yml': './cordis.patch.yml', './locale/*.json': './locale/*.json', './icon': './icon.svg', './package.json': './package.json' },
  files: ['index.js', 'client.js', 'cordis.patch.yml', 'locale/*.json', 'icon.svg'],
  dsh: { bundle: { patch: ['./cordis.patch.yml'] }, client: { platform: 'web', inject: ['@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar'] } },
  monos: { feature: 'FEATURE.md' },
}))
writeFileSync(join(dir, 'index.js'), `// Host half of ${name}: nothing runs on the host; the plugin is its client.js.\nexport const name = '${name}'\n\nexport function apply() {}\n`)
writeFileSync(join(dir, 'cordis.patch.yml'), `# ${name}: ${titleAr}. Turn it off alone with a profile patch row (id: ${name}, disabled: true).\n- insert:\n    - id: ${name}\n      name: ${name}\n`)
writeFileSync(join(dir, 'locale', 'ar.json'), json({ meta: { title: `Monos — ${titleAr}`, description: titleAr } }))
writeFileSync(join(dir, 'locale', 'en.json'), json({ meta: { title: `Monos — ${slug}`, description: slug } }))
copyFileSync(join(here, 'monos-identity', 'icon.svg'), join(dir, 'icon.svg'))
writeFileSync(join(dir, 'src', 'index.js'), `// ${name} client: the sidebar entry and the page. Describe the feature in FEATURE.md first.
import { PanelHeader, Disclaimer } from '../../shared/identity.js'
import { QM_CSS, h } from '../../shared/runtime.js'

const PAGE_ID = '${name}'

function Icon({ size }) {
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true },
    h('rect', { x: 4, y: 4, width: 16, height: 16, rx: 3 }))
}

function Page() {
  return h('div', { className: 'qm', dir: 'rtl', lang: 'ar' }, h('style', null, QM_CSS),
    h(PanelHeader, { crumbs: [], here: ${JSON.stringify(titleAr)} }),
    h('div', { className: 'q-wrap', style: { paddingTop: 16 } }, h('div', { className: 'q-card q-empty' }, 'قيد البناء')),
    h(Disclaimer))
}

export default {
  inject: ['slots', 'layout'],
  apply(ctx) {
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PAGE_ID, order: 20, label: ${JSON.stringify(titleAr)} }, Icon))
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PAGE_ID }, Page))
  },
}
`)
writeFileSync(join(dir, 'FEATURE.md'), readFileSync(join(here, '_template', 'FEATURE.md'), 'utf8')
  .replaceAll('{{name}}', name).replaceAll('{{title_ar}}', titleAr))
console.log(`created plugins/${name}/: write FEATURE.md, then npm run build && npm run check`)
