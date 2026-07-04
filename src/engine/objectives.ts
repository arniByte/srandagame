import type { BattleState, PlayerId } from './types'
import { findPiece, royalOf } from './board'

/**
 * Проверка исхода боя. Вызывается после каждого действия.
 * Универсально: гибель королевской фигуры игрока или всей армии = поражение.
 */
export function checkResult(
  state: BattleState,
): { winner: PlayerId | 'draw'; reason: string } | null {
  let p0Count = 0, p1Count = 0
  for (const p of state.pieces) {
    if (p.owner === 0) p0Count++
    else p1Count++
  }

  // Гибель короля игрока / истребление армии.
  if (state.hadRoyal[0] && !royalOf(state, 0)) return { winner: 1, reason: 'regicide' }
  if (p0Count === 0) return { winner: 1, reason: 'annihilation' }

  const obj = state.objective
  switch (obj.kind) {
    case 'regicide': {
      if (!royalOf(state, 1)) return { winner: 0, reason: 'regicide' }
      break
    }
    case 'siege': {
      if (!findPiece(state, obj.gatePieceId)) return { winner: 0, reason: 'siege' }
      break
    }
    case 'survive': {
      if (state.turn > obj.turnsRequired) return { winner: 0, reason: 'survived' }
      break
    }
    case 'escort': {
      const escort = findPiece(state, obj.escortPieceId)
      if (!escort) return { winner: 1, reason: 'escortLost' }
      if (obj.goals.includes(escort.pos)) return { winner: 0, reason: 'escorted' }
      break
    }
  }

  // Врагов не осталось — победа в любом сценарии.
  if (p1Count === 0) return { winner: 0, reason: 'annihilation' }

  return null
}
