import type { RelicDef } from '../engine/types'

export const RELICS: RelicDef[] = [
  {
    id: 'ochreBrush', name: 'Охристая кисть',
    desc: '+1 краска в начале каждого хода.',
    illus: 'relic.ochreBrush',
    hooks: {
      onTurnStart(ctx, side) {
        ctx.gainPaint(side, 1)
      },
    },
  },
  {
    id: 'paletteKnife', name: 'Мастихин',
    desc: '+3 краски в начале боя.',
    illus: 'relic.paletteKnife',
    hooks: {
      onBattleStart(ctx) {
        ctx.gainPaint(0, 3)
      },
    },
  },
]
