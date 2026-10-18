// The plugin the host loads: registers the sidebar entries, the three screens and the
// empty-conversation mark. Entry point of the esbuild bundle (build-client.mjs).
import { ANALYSES_ID, AnalysesIcon, MARKET_ID, PANEL_ID, PortfolioIcon, nav } from './runtime.js'
import { HeroMonosMark, SidebarMonosIcon } from './identity.js'
import { AnalysesPage } from './analyses.js'
import { MarketPage } from './market.js'
import { PortfolioPage } from './portfolio.js'

export default {
  inject: ['slots', 'layout'],
  apply(ctx) {
    nav.selectPanel = (id) => ctx.layout.selectPanel(id)
    ctx.effect(() => () => { nav.selectPanel = null })
    ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({
      name: 'conversation.hero.brand.mark',
    }, HeroMonosMark))
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist', id: MARKET_ID, order: 8, label: 'Monos',
    }, SidebarMonosIcon))
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
