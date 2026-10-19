// monos-portfolio client: the «المحفظة» sidebar entry and the portfolio page.
import { PANEL_ID, PortfolioIcon } from '../../shared/runtime.js'
import { PortfolioPage } from './portfolio.js'

export default {
  inject: ['slots', 'layout'],
  apply(ctx) {
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist', id: PANEL_ID, order: 10, label: 'المحفظة',
    }, PortfolioIcon))
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, PortfolioPage))
  },
}
