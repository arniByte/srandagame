import type { Action, BattleState } from '../engine'
import { cardDef, findPiece, pieceAt, pieceType } from '../engine'

/**
 * Сортировка действий для alpha-beta: TT-ход → взятия и removal-карты
 * (MVV-LVA) → killer-ходы → тихие ходы → endTurn → прочие карты в конце.
 * Тай-брейк — исходный индекс генерации (детерминизм).
 */

const MAX_PLY = 128

/** 2 killer-слота на ply: [ply*2] и [ply*2+1]. */
export type KillerTable = (Action | null)[]

export function makeKillers(): KillerTable {
  return new Array<Action | null>(MAX_PLY * 2).fill(null)
}

export function sameAction(a: Action, b: Action): boolean {
  if (a.t !== b.t) return false
  switch (a.t) {
    case 'move':
      return b.t === 'move' && a.piece === b.piece && a.to === b.to
    case 'playCard': {
      if (b.t !== 'playCard' || a.iid !== b.iid || a.targets.length !== b.targets.length) return false
      for (let i = 0; i < a.targets.length; i++) {
        if (a.targets[i] !== b.targets[i]) return false
      }
      return true
    }
    case 'promote':
      return b.t === 'promote' && a.piece === b.piece && a.into === b.into
    default:
      return true // endTurn/concede — без полей
  }
}

/** Запомнить тихий ход, вызвавший отсечку (killer move). */
export function noteKiller(killers: KillerTable, ply: number, act: Action): void {
  if (ply >= MAX_PLY) return
  const i = ply * 2
  const k0 = killers[i]
  if (k0 && sameAction(k0, act)) return
  killers[i + 1] = k0 ?? null
  killers[i] = act
}

// Ярусы сортировки (степени двойки — не пересекаются).
const S_TT = 1 << 30
const S_PROMOTE = 1 << 29
const S_CAPTURE = 1 << 28
const S_KILLER0 = (1 << 27) + 1
const S_KILLER1 = 1 << 27
const S_QUIET = 1 << 20
const S_ENDTURN = 1 << 10

/** Возвращает порядок обхода — массив индексов в actions. */
export function orderActions(
  state: BattleState,
  actions: Action[],
  ttIdx: number,
  killers: KillerTable,
  ply: number,
): number[] {
  const n = actions.length
  const score = new Array<number>(n)
  const k0 = ply < MAX_PLY ? killers[ply * 2] ?? null : null
  const k1 = ply < MAX_PLY ? killers[ply * 2 + 1] ?? null : null

  for (let i = 0; i < n; i++) {
    const a = actions[i] as Action
    if (i === ttIdx) { score[i] = S_TT; continue }
    switch (a.t) {
      case 'move': {
        const victim = pieceAt(state, a.to)
        if (victim) {
          // MVV-LVA: ценность жертвы минус ценность атакующего.
          const mover = findPiece(state, a.piece)
          const attVal = mover ? pieceType(mover.type).value : 0
          score[i] = S_CAPTURE + pieceType(victim.type).value * 100 - attVal
        } else if (k0 && sameAction(k0, a)) score[i] = S_KILLER0
        else if (k1 && sameAction(k1, a)) score[i] = S_KILLER1
        else score[i] = S_QUIET
        break
      }
      case 'playCard': {
        const card = state.cards.find(c => c.iid === a.iid)
        const def = card ? cardDef(card.def) : null
        if (def && def.aiHint.cat === 'removal' && a.targets.length > 0) {
          // Removal по фигуре — в ярус взятий (жертва минус «цена» карты).
          const t = pieceAt(state, a.targets[0] as number)
          score[i] = S_CAPTURE + (t ? pieceType(t.type).value * 100 : 0) - def.cost * 10
        } else {
          // Прочие карты — в самом конце, чуть упорядочены по aiHint.weight.
          score[i] = def ? def.aiHint.weight : 0
        }
        break
      }
      case 'promote':
        score[i] = S_PROMOTE + pieceType(a.into).value * 100
        break
      case 'endTurn':
        score[i] = S_ENDTURN
        break
      case 'concede':
        score[i] = 0
        break
    }
  }

  const order = new Array<number>(n)
  for (let i = 0; i < n; i++) order[i] = i
  order.sort((x, y) => (score[y] as number) - (score[x] as number) || x - y)
  return order
}
