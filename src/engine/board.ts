import type { BattleState, Piece, Sq } from './types'

/** Бинарный поиск фигуры по id (pieces отсортированы по id). */
export function findPiece(state: BattleState, id: number): Piece | null {
  const arr = state.pieces
  let lo = 0, hi = arr.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const p = arr[mid] as Piece
    if (p.id === id) return p
    if (p.id < id) lo = mid + 1
    else hi = mid - 1
  }
  return null
}

/** Вставка фигуры с сохранением сортировки по id. */
export function insertPiece(state: BattleState, piece: Piece): void {
  const arr = state.pieces
  let lo = 0, hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((arr[mid] as Piece).id < piece.id) lo = mid + 1
    else hi = mid
  }
  arr.splice(lo, 0, piece)
}

export function removePiece(state: BattleState, id: number): Piece | null {
  const arr = state.pieces
  for (let i = 0; i < arr.length; i++) {
    if ((arr[i] as Piece).id === id) {
      return arr.splice(i, 1)[0] as Piece
    }
  }
  return null
}

/** Линейный поиск фигуры на клетке (армии маленькие — это быстро). */
export function pieceAt(state: BattleState, s: Sq): Piece | null {
  for (const p of state.pieces) if (p.pos === s) return p
  return null
}

export function royalOf(state: BattleState, owner: 0 | 1): Piece | null {
  for (const p of state.pieces) {
    if (p.owner === owner && isRoyalType(p.type)) return p
  }
  return null
}

import { pieceType } from './registry'

export function isRoyalType(typeId: string): boolean {
  return pieceType(typeId).royal === true
}

export function hasTrait(p: Piece, traitId: string): boolean {
  for (const t of p.traits) if (t.id === traitId) return true
  return false
}
