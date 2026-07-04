import type { BattleState } from './types'
import { cardIdx, pieceTypeIdx, traitIdx } from './registry'

/**
 * Zobrist-хеш для transposition table ИИ.
 * Таблицы генерируются лениво из ФИКСИРОВАННОГО сида — стабильны между сессиями
 * (при неизменном порядке регистрации контента).
 * Хеш считается с нуля на каждый узел (~150 XOR) — это дёшево и исключает
 * целый класс багов инкрементального обновления.
 */

const SQ = 256

// splitmix32 c фиксированным сидом — база всех таблиц.
let smState = 0x9e3779b9
function sm(): number {
  smState = (smState + 0x9e3779b9) >>> 0
  let z = smState
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0
  return (z ^ (z >>> 15)) >>> 0
}

// Плоские таблицы, растущие по мере надобности (индексы контента детерминированы).
const pieceKeys: number[] = []   // [typeIdx*2*SQ*2 + owner*SQ*2 + sq*2 (+1)]
const traitKeys: number[] = []   // [traitIdx*SQ + sq] (одна u32 на черту — этого хватает)
const tileKeys: number[] = []    // [(terr+1)*SQ + sq]
const handKeys: number[] = []    // [cardIdx*8 + count] — мультимножество руки
const miscKeys: number[] = []    // [активная сторона, movedThisTurn, фаза, краска×2]

function ensure(arr: number[], upTo: number): void {
  while (arr.length <= upTo) arr.push(sm())
}

export function computeZobrist(state: BattleState): [number, number] {
  let h1 = 0, h2 = 0

  for (const p of state.pieces) {
    const ti = pieceTypeIdx(p.type)
    const base = ((ti * 2 + p.owner) * SQ + (p.pos & 0xff)) * 2
    ensure(pieceKeys, base + 1)
    h1 ^= pieceKeys[base] as number
    h2 ^= pieceKeys[base + 1] as number
    for (const t of p.traits) {
      const tb = traitIdx(t.id) * SQ + (p.pos & 0xff)
      ensure(traitKeys, tb)
      h1 ^= traitKeys[tb] as number
    }
    if (p.hp > 0) {
      // HP структур влияет на позицию — подмешиваем.
      h2 ^= Math.imul(p.hp, 0x9e3779b1) ^ p.id
    }
  }

  const b = state.board
  for (let i = 0; i < b.tiles.length; i++) {
    const terr = (b.tiles[i] as number) + 1
    if (terr === 1) continue // T_PLAIN — базовый, не хешируем (экономия)
    const tb = terr * SQ + (i & 0xff)
    ensure(tileKeys, tb)
    h1 ^= tileKeys[tb] as number
  }

  // Рука активной стороны как мультимножество определений.
  const side = state.sides[state.active]
  const counts = new Map<number, number>()
  for (const iid of side.hand) {
    const card = state.cards.find(c => c.iid === iid)
    if (!card) continue
    const ci = cardIdx(card.def)
    counts.set(ci, (counts.get(ci) ?? 0) + 1)
  }
  for (const [ci, n] of [...counts.entries()].sort((a, b2) => a[0] - b2[0])) {
    const hb = ci * 8 + Math.min(n, 7)
    ensure(handKeys, hb)
    h2 ^= handKeys[hb] as number
  }

  ensure(miscKeys, 5)
  if (state.active === 1) h1 ^= miscKeys[0] as number
  if (state.movedThisTurn) h1 ^= miscKeys[1] as number
  if (state.phase === 'promote') h1 ^= miscKeys[2] as number
  h2 ^= Math.imul(state.sides[0].paint, 0x85ebca6b)
  h2 ^= Math.imul(state.sides[1].paint + 64, 0xc2b2ae35)

  return [h1 >>> 0, h2 >>> 0]
}
