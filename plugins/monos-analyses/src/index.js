// monos-analyses client: the «التحليلات» sidebar entry and the archive / analysis page.
import { ANALYSES_ID, AnalysesIcon, bindNavigation } from '../../shared/runtime.js'
import { AnalysesPage } from './analyses.js'

export default {
  inject: ['slots', 'layout'],
  apply(ctx) {
    bindNavigation(ctx)
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist', id: ANALYSES_ID, order: 9, label: 'التحليلات',
    }, AnalysesIcon))
    ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: ANALYSES_ID }, AnalysesPage))
  },
}
