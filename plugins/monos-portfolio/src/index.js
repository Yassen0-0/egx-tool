// monos-portfolio client: «السجل». It owns the sidebar's «Monos» row (the Monos mark and today's
// move, which the market screen used to register) and the ledger page it opens.
import { PANEL_ID } from '../../shared/runtime.js'
import { SidebarMonosIcon } from '../../shared/identity.js'
import { PortfolioPage } from './portfolio.js'

export default {
  inject: ['slots', 'layout'],
  apply(ctx) {
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist', id: PANEL_ID, order: 8, label: 'Monos',
    }, SidebarMonosIcon))
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, PortfolioPage))
  },
}
