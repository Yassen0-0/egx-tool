// monos-market client: the «Monos» sidebar entry (with today's portfolio move) and the market page.
import { MARKET_ID, bindNavigation } from '../../shared/runtime.js'
import { SidebarMonosIcon } from '../../shared/identity.js'
import { MarketPage } from './market.js'

export default {
  inject: ['slots', 'layout'],
  apply(ctx) {
    bindNavigation(ctx)
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist', id: MARKET_ID, order: 8, label: 'Monos',
    }, SidebarMonosIcon))
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: MARKET_ID }, MarketPage))
  },
}
