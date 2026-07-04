import type { Sq, TraitDef } from '../engine/types'
import { mkSq, sqX, sqY, tileAt, HOLE } from '../engine/types'
import { pieceAt } from '../engine/board'

/**
 * Черты фигур. Порядок регистрации фиксирован (Zobrist).
 */
export const TRAITS: TraitDef[] = [
  {
    id: 'frozen', name: 'Оцепенение',
    desc: 'Фигура не может ходить.',
    stacking: 'refresh',
    blocksMovement: true,
  },
  {
    id: 'swift', name: 'Порыв',
    desc: 'Дополнительно ходит на 1 клетку в любую сторону.',
    stacking: 'refresh',
    hooks: {
      modifyMoves(state, self, moves): Sq[] {
        const px = sqX(self.pos), py = sqY(self.pos)
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue
            const c = mkSq(px + dx, py + dy)
            if (px + dx < 0 || py + dy < 0 || px + dx >= state.board.w || py + dy >= state.board.h) continue
            if (tileAt(state.board, c) === HOLE) continue
            const occ = pieceAt(state, c)
            if (occ && occ.owner === self.owner) continue
            moves.push(c)
          }
        }
        return moves
      },
      evalBonus: 30,
    },
  },
  {
    id: 'thirsty', name: 'Жажда краски',
    desc: '+1 краска за каждое взятие этой фигурой.',
    stacking: 'none',
    hooks: {
      onCapture(ctx, self) {
        ctx.gainPaint(self.owner, 1)
      },
      evalBonus: 20,
    },
  },
  {
    id: 'anchor', name: 'Якорь',
    desc: 'Нельзя сдвинуть, обменять или заморозить картами врага.',
    stacking: 'none',
    anchored: true,
    hooks: { evalBonus: 15 },
  },
]
