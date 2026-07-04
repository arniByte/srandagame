import type { Action, BattleState, Piece, PlayerId, Sq } from '../engine'
import {
  HOLE, cardDef, effectiveCost, findPiece, legalTargetsFor, mkSq, movesFor,
  onBoard, pieceAt, pieceType, royalOf, sqX, sqY, tileAt, validate,
} from '../engine'

/**
 * Эвристические кандидаты карточных действий: полный перебор целей взорвал бы
 * дерево, поэтому на каждую карту руки — не больше CARD_CAP конкретных действий
 * по категории aiHint.cat, и не больше NODE_CAP на узел суммарно.
 */

const NODE_CAP = 6
const CARD_CAP = 3

const cheb = (a: Sq, b: Sq): number => {
  const dx = Math.abs(sqX(a) - sqX(b))
  const dy = Math.abs(sqY(a) - sqY(b))
  return dx > dy ? dx : dy
}

/** Ключевая клетка цели боя для активной стороны (куда стремиться). */
function goalSquare(state: BattleState): Sq {
  const center = mkSq(state.board.w >> 1, state.board.h >> 1)
  const obj = state.objective
  switch (obj.kind) {
    case 'regicide': {
      const enemy = (1 - state.active) as PlayerId
      const k = royalOf(state, enemy) ?? royalOf(state, state.active)
      return k ? k.pos : center
    }
    case 'siege': {
      const gate = findPiece(state, obj.gatePieceId)
      return gate ? gate.pos : center
    }
    case 'survive': {
      // Всё крутится вокруг короля игрока: он выживает, враг его ищет.
      const k = royalOf(state, 0)
      return k ? k.pos : center
    }
    case 'escort': {
      const e = findPiece(state, obj.escortPieceId)
      return e ? e.pos : center
    }
  }
}

/** Пустые клетки на лучах вражеских лучевых фигур → ценность самой фигуры. */
function riderRaySquares(state: BattleState): Map<Sq, number> {
  const map = new Map<Sq, number>()
  const b = state.board
  for (const p of state.pieces) {
    if (p.owner === state.active) continue
    const def = pieceType(p.type)
    if (!def.rides) continue
    for (const ray of def.rides) {
      const dx = ray[0], dy = ray[1]
      let x = sqX(p.pos) + dx, y = sqY(p.pos) + dy
      while (onBoard(b, x, y)) {
        const s = mkSq(x, y)
        if (tileAt(b, s) === HOLE || pieceAt(state, s)) break
        if (def.value > (map.get(s) ?? 0)) map.set(s, def.value)
        x += dx; y += dy
      }
    }
  }
  return map
}

/** Отбор и стабильная сортировка: score убывает, тай-брейк — sq возрастает. */
function topSquares(scored: { sq: Sq; score: number }[], cap: number): Sq[] {
  scored.sort((a, b) => b.score - a.score || a.sq - b.sq)
  const out: Sq[] = []
  for (let i = 0; i < scored.length && i < cap; i++) out.push((scored[i] as { sq: Sq }).sq)
  return out
}

export function cardCandidates(state: BattleState): Action[] {
  const out: Action[] = []
  const side = state.sides[state.active]
  if (side.hand.length === 0) return out
  const goal = goalSquare(state)

  // Клетки под боем врага (нужны только категории buff — считаем лениво).
  let enemyAtk: Set<Sq> | null = null
  const enemyAttacks = (): Set<Sq> => {
    if (!enemyAtk) {
      enemyAtk = new Set<Sq>()
      for (const p of state.pieces) {
        if (p.owner === state.active) continue
        for (const m of movesFor(state, p)) enemyAtk.add(m)
      }
    }
    return enemyAtk
  }

  const push = (a: Action): void => {
    if (out.length < NODE_CAP && validate(state, a).ok) out.push(a)
  }

  for (const iid of side.hand) {
    if (out.length >= NODE_CAP) break
    const card = state.cards.find(c => c.iid === iid)
    if (!card) continue
    const def = cardDef(card.def)
    if (side.paint < effectiveCost(state, state.active, card.upgraded, def.id)) continue

    switch (def.aiHint.cat) {
      case 'removal': {
        // Самые ценные вражеские цели.
        const scored: { sq: Sq; score: number }[] = []
        for (const sq of legalTargetsFor(state, iid)) {
          const p = pieceAt(state, sq)
          if (p) scored.push({ sq, score: pieceType(p.type).value * 100 })
        }
        for (const sq of topSquares(scored, CARD_CAP)) push({ t: 'playCard', iid, targets: [sq] })
        break
      }

      case 'summon': {
        // Клетки ближе к цели боя.
        const scored: { sq: Sq; score: number }[] = []
        for (const sq of legalTargetsFor(state, iid)) {
          scored.push({ sq, score: -cheb(sq, goal) })
        }
        for (const sq of topSquares(scored, CARD_CAP)) push({ t: 'playCard', iid, targets: [sq] })
        break
      }

      case 'terrain': {
        if ((def.target.tile ?? 'any') === 'hole') {
          // Клей: латаем дыры ближе к цели боя.
          const scored: { sq: Sq; score: number }[] = []
          for (const sq of legalTargetsFor(state, iid)) {
            scored.push({ sq, score: -cheb(sq, goal) })
          }
          for (const sq of topSquares(scored, 2)) push({ t: 'playCard', iid, targets: [sq] })
        } else {
          // Ножницы: режем линии вражеских лучевых фигур и путь эскорта.
          const rays = riderRaySquares(state)
          const obj = state.objective
          const escort = obj.kind === 'escort' && state.active === 1
            ? findPiece(state, obj.escortPieceId) : null
          const scored: { sq: Sq; score: number }[] = []
          for (const sq of legalTargetsFor(state, iid)) {
            let s = (rays.get(sq) ?? 0) * 10
            if (escort && cheb(sq, escort.pos) <= 2) s += 25
            if (s > 0) scored.push({ sq, score: s })
          }
          for (const sq of topSquares(scored, CARD_CAP)) push({ t: 'playCard', iid, targets: [sq] })
        }
        break
      }

      case 'buff': {
        // Своя самая ценная атакующая/атакованная фигура.
        const atk = enemyAttacks()
        let best: Piece | null = null
        let bestScore = -1
        let cheapSafe: Piece | null = null // партнёр для swap
        for (const p of state.pieces) {
          if (p.owner !== state.active) continue
          const isAtt = atk.has(p.pos)
          let attacking = false
          if (!isAtt) {
            for (const m of movesFor(state, p)) {
              const v = pieceAt(state, m)
              if (v && v.owner !== p.owner) { attacking = true; break }
            }
          }
          const s = pieceType(p.type).value * 100 + (isAtt ? 50 : 0) + (attacking ? 40 : 0)
          if ((isAtt || attacking) && s > bestScore) { bestScore = s; best = p }
          if (!isAtt && (!cheapSafe || pieceType(p.type).value < pieceType(cheapSafe.type).value)) {
            cheapSafe = p
          }
        }
        if (!best) {
          // Никто не в контакте — берём самую ценную фигуру.
          for (const p of state.pieces) {
            if (p.owner !== state.active) continue
            const s = pieceType(p.type).value * 100
            if (s > bestScore) { bestScore = s; best = p }
          }
        }
        if (best) {
          if (def.target.kind === 'twoPieces') {
            // Swap: уводим ценную фигуру из-под боя, подставляя дешёвую.
            if (cheapSafe && cheapSafe.id !== best.id) {
              push({ t: 'playCard', iid, targets: [best.pos, cheapSafe.pos] })
            }
          } else {
            push({ t: 'playCard', iid, targets: [best.pos] })
          }
        }
        break
      }

      case 'economy': {
        // Одно тривиальное действие.
        if (def.target.kind === 'none') {
          push({ t: 'playCard', iid, targets: [] })
        } else {
          const ts = legalTargetsFor(state, iid)
          if (ts.length > 0) push({ t: 'playCard', iid, targets: [ts[0] as Sq] })
        }
        break
      }
    }
  }

  return out
}
