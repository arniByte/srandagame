import type { BattleState, Piece, Sq } from './types'
import { HOLE, mkSq, onBoard, sqX, sqY, tileAt } from './types'
import { pieceAt } from './board'
import { pieceType, traitDef } from './registry'

/**
 * Генерация ходов на произвольной доске с дырами.
 * Лучи (rides) останавливаются на дыре/крае/фигуре; прыжки (leaps) перелетают дыры,
 * но не могут приземлиться на дыру/свою фигуру.
 * Направление «вперёд» для owner 0 = -y (игрок снизу), для owner 1 = +y.
 */

const fwd = (owner: 0 | 1): number => (owner === 0 ? -1 : 1)

export function movesFor(state: BattleState, piece: Piece): Sq[] {
  const def = pieceType(piece.type)
  const moves: Sq[] = []
  const b = state.board
  const px = sqX(piece.pos), py = sqY(piece.pos)
  const dirY = fwd(piece.owner)

  let blocked = false
  for (const t of piece.traits) {
    const td = traitDef(t.id)
    if (td.blocksMovement) { blocked = true; break }
  }

  if (!blocked && !def.immobile) {
    if (def.pawn) {
      // Шаг вперёд (пустая клетка, не дыра).
      const oneY = py + dirY
      if (onBoard(b, px, oneY)) {
        const one = mkSq(px, oneY)
        if (tileAt(b, one) !== HOLE && !pieceAt(state, one)) {
          moves.push(one)
          // Двойной шаг с места.
          const twoY = py + dirY * 2
          if (!piece.moved && onBoard(b, px, twoY)) {
            const two = mkSq(px, twoY)
            if (tileAt(b, two) !== HOLE && !pieceAt(state, two)) moves.push(two)
          }
        }
      }
      // Взятия по диагонали.
      for (const dx of [-1, 1]) {
        const cx = px + dx, cy = py + dirY
        if (!onBoard(b, cx, cy)) continue
        const c = mkSq(cx, cy)
        if (tileAt(b, c) === HOLE) continue
        const occ = pieceAt(state, c)
        if (occ && occ.owner !== piece.owner) moves.push(c)
      }
    }

    if (def.leaps) {
      for (const [dx, dy] of def.leaps) {
        // Наборы прыжков в контенте симметричны — направление владельца не важно.
        const cx = px + dx, cy = py + dy
        if (!onBoard(b, cx, cy)) continue
        const c = mkSq(cx, cy)
        if (tileAt(b, c) === HOLE) continue
        const occ = pieceAt(state, c)
        if (occ && occ.owner === piece.owner) continue
        moves.push(c)
      }
    }

    if (def.rides) {
      for (const [dx, dy] of def.rides) {
        let cx = px + dx, cy = py + dy
        while (onBoard(b, cx, cy)) {
          const c = mkSq(cx, cy)
          if (tileAt(b, c) === HOLE) break
          const occ = pieceAt(state, c)
          if (occ) {
            if (occ.owner !== piece.owner) moves.push(c)
            break
          }
          moves.push(c)
          cx += dx; cy += dy
        }
      }
    }
  }

  // Черты модифицируют список ходов (например, «стремительность» добавляет шаги короля).
  let result = moves
  if (!blocked) {
    for (const t of piece.traits) {
      const hook = traitDef(t.id).hooks?.modifyMoves
      if (hook) result = hook(state, piece, result)
    }
  }

  // Дедупликация (черты могли добавить дубли).
  if (result.length > 1) {
    const seen = new Set<number>()
    result = result.filter(s => (seen.has(s) ? false : (seen.add(s), true)))
  }
  return result
}

/** Атакована ли клетка стороной attacker (для события «шах» и оценки ИИ). */
export function isAttacked(state: BattleState, sq: Sq, attacker: 0 | 1): boolean {
  for (const p of state.pieces) {
    if (p.owner !== attacker) continue
    const ms = movesFor(state, p)
    for (const m of ms) if (m === sq) return true
  }
  return false
}
