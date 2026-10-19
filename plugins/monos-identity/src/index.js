// monos-identity client: fills the host's conversation.hero.brand.mark slot with the Monos mark, so
// the engine's animated fallback (the whale) never shows in an empty conversation.
import { HeroMonosMark } from '../../shared/identity.js'

export default {
  inject: ['slots'],
  apply(ctx) {
    ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({
      name: 'conversation.hero.brand.mark',
    }, HeroMonosMark))
  },
}
