import type { BattleState, Piece, PlayerId, Sq } from '../engine'
import {
  findPiece, mkSq, movesFor, onBoard, pieceType, sqX, sqY, traitDef,
} from '../engine'

/**
 * Оценка позиции в сантипешках С ТОЧКИ ЗРЕНИЯ state.active.
 * Один проход по фигурам: материал + черты + мобильность + карта атак.
 * Карты атак — статические буферы с меткой поколения: ноль аллокаций
 * в горячем цикле, семантика идентична isAttacked (те же movesFor),
 * но без второго прохода по фигурам.
 */

const ATK: readonly [Int32Array, Int32Array] = [new Int32Array(256), new Int32Array(256)]
let gen = 0

const attacked = (by: PlayerId, sq: Sq): boolean => ATK[by][sq & 255] === gen

const cheb = (a: Sq, b: Sq): number => {
  const dx = Math.abs(sqX(a) - sqX(b))
  const dy = Math.abs(sqY(a) - sqY(b))
  return dx > dy ? dx : dy
}

/** Опасность вокруг короля: атакованный король + атакованные соседние клетки. */
function kingDanger(state: BattleState, royal: Piece, by: PlayerId): number {
  let d = attacked(by, royal.pos) ? 150 : 0
  const b = state.board
  const x = sqX(royal.pos), y = sqY(royal.pos)
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      if (!onBoard(b, x + dx, y + dy)) continue
      if (attacked(by, mkSq(x + dx, y + dy))) d += 15
    }
  }
  return d
}

export function evaluate(state: BattleState): number {
  gen++
  const b = state.board
  const obj = state.objective

  // Опорные фигуры цели боя — до основного прохода.
  let gate: Piece | null = null
  let escort: Piece | null = null
  if (obj.kind === 'siege') gate = findPiece(state, obj.gatePieceId)
  else if (obj.kind === 'escort') escort = findPiece(state, obj.escortPieceId)

  let mat0 = 0, mat1 = 0     // материал + бонусы черт/центра
  let mob0 = 0, mob1 = 0     // мобильность (число ходов)
  let prox0 = 0              // близость фигур игрока к воротам (осада)
  let royal0: Piece | null = null
  let royal1: Piece | null = null

  for (const p of state.pieces) {
    const def = pieceType(p.type)
    let v = def.value * 100
    for (const t of p.traits) v += traitDef(t.id).hooks?.evalBonus ?? 0
    // Структуры с HP: ценность пропорциональна остатку прочности.
    if (p.hp > 0 && p.maxHp > 0) v = ((v * p.hp) / p.maxHp) | 0
    // Лёгкий бонус центра.
    const x = sqX(p.pos), y = sqY(p.pos)
    v += (Math.min(x, b.w - 1 - x) + Math.min(y, b.h - 1 - y)) * 2

    // Мобильность и карта атак — единственный вызов movesFor на фигуру.
    const ms = movesFor(state, p)
    const marks = ATK[p.owner]
    for (const m of ms) marks[m & 255] = gen

    if (p.owner === 0) {
      mat0 += v
      mob0 += ms.length
      if (def.royal) royal0 = p
      if (gate) {
        const d = cheb(p.pos, gate.pos)
        if (d < 8) prox0 += (8 - d) * 6
      }
    } else {
      mat1 += v
      mob1 += ms.length
      if (def.royal) royal1 = p
    }
  }

  let score0 = (mat0 - mat1) + (mob0 - mob1) * 2 +
    (state.sides[0].paint - state.sides[1].paint) * 15

  // Гибель короля игрока — поражение при любой цели: его безопасность всегда важна.
  if (royal0 && state.hadRoyal[0]) score0 -= kingDanger(state, royal0, 1)

  // Цель боя доминирует над позиционными слагаемыми.
  switch (obj.kind) {
    case 'regicide':
      if (royal1) score0 += kingDanger(state, royal1, 0)
      break
    case 'siege':
      if (gate) score0 += -gate.hp * 120 + prox0
      break
    case 'survive': {
      const remaining = obj.turnsRequired + 1 - state.turn
      if (remaining > 0) score0 -= remaining * 50
      score0 += mat0 >> 2 // сохранение материала важнее размена
      break
    }
    case 'escort': {
      if (escort && obj.goals.length > 0) {
        let dmin = 99
        for (const g of obj.goals) {
          const d = cheb(escort.pos, g)
          if (d < dmin) dmin = d
        }
        score0 -= dmin * 80
        if (attacked(1, escort.pos)) score0 -= 120
      }
      break
    }
  }

  // Темп: активной стороне +10.
  return (state.active === 0 ? score0 : -score0) + 10
}
