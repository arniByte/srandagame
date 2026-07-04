import type { Action, RngState } from '../engine/types'
import { rngNextU32, seedFromString } from '../engine/rng'
import { STARTER_DECK, STARTER_ROSTER } from '../content'
import { generateMap } from './mapGen'

/**
 * Состояние забега. Все редьюсеры ЧИСТЫЕ: клонируют RunState и возвращают новый.
 * Вся случайность меты — из run.rng (клон мутируется внутри нового состояния).
 */

export interface RosterPiece {
  rid: string
  type: string
  traits: string[]
  name: string
}

export type NodeKind = 'battle' | 'elite' | 'event' | 'shop' | 'rest' | 'treasure' | 'boss'

export interface MapNode {
  id: string
  row: number
  col: number
  kind: NodeKind
  /** Для battle/elite/boss. */
  encounterId?: string
  /** Для event. */
  eventId?: string
  /** id узлов следующего ряда, куда можно пойти. */
  edges: string[]
  visited: boolean
}

export interface RunState {
  v: 1
  seed: string
  rng: RngState
  act: number
  /** Текущий узел; null = старт акта (выбор из ряда 0). */
  nodeId: string | null
  map: MapNode[]
  gold: number
  roster: RosterPiece[]
  deck: { def: string; upgraded: boolean }[]
  relics: string[]
  history: { nodeId: string; outcome: string }[]
  inBattle: null | { encounterId: string; battleSeed: RngState; log: Action[] }
}

export function newRun(seed: string): RunState {
  const rng = seedFromString(seed + ':run')
  const run: RunState = {
    v: 1,
    seed,
    rng,
    act: 1,
    nodeId: null,
    map: [],
    gold: 60,
    roster: STARTER_ROSTER.map((r, i) => ({
      rid: `r${i}`, type: r.type, traits: [], name: r.name,
    })),
    deck: STARTER_DECK.map(def => ({ def, upgraded: false })),
    relics: [],
    history: [],
    inBattle: null,
  }
  run.map = generateMap(run.rng, run.act)
  return run
}

const clone = (run: RunState): RunState => structuredClone(run)

export function nodeById(run: RunState, id: string): MapNode | null {
  return run.map.find(n => n.id === id) ?? null
}

/** Узлы, доступные для перехода из текущей позиции. */
export function availableNodes(run: RunState): MapNode[] {
  if (run.nodeId === null) return run.map.filter(n => n.row === 0)
  const cur = nodeById(run, run.nodeId)
  if (!cur) return []
  return cur.edges
    .map(id => nodeById(run, id))
    .filter((n): n is MapNode => n !== null)
}

export function chooseNode(run: RunState, nodeId: string): RunState {
  const ok = availableNodes(run).some(n => n.id === nodeId)
  if (!ok) throw new Error(`node ${nodeId} недостижим из ${run.nodeId}`)
  const next = clone(run)
  next.nodeId = nodeId
  return next
}

/** Отметить не-боевой узел пройденным. */
export function completeNode(run: RunState, outcome: string): RunState {
  const next = clone(run)
  if (next.nodeId) {
    const node = nodeById(next, next.nodeId)
    if (node) node.visited = true
    next.history.push({ nodeId: next.nodeId, outcome })
  }
  return next
}

/** Начать бой на текущем узле: зафиксировать сид боя. */
export function startBattle(run: RunState, encounterId: string): RunState {
  const next = clone(run)
  const battleSeed: RngState = [
    rngNextU32(next.rng), rngNextU32(next.rng),
    rngNextU32(next.rng), rngNextU32(next.rng),
  ]
  if ((battleSeed[0] | battleSeed[1] | battleSeed[2] | battleSeed[3]) === 0) battleSeed[0] = 1
  next.inBattle = { encounterId, battleSeed, log: [] }
  return next
}

export function appendBattleAction(run: RunState, action: Action): RunState {
  const next = clone(run)
  if (next.inBattle) next.inBattle.log.push(action)
  return next
}

export interface BattleSurvivor {
  rid: string
  type: string
  traits: string[]
}

/**
 * Завершить бой: погибшие покидают ростер навсегда, выжившие синхронизируют
 * тип (промоушен сохраняется!) и постоянные черты.
 */
export function finishBattle(
  run: RunState,
  survivors: BattleSurvivor[],
  victory: boolean,
  gold: number,
): RunState {
  const next = clone(run)
  const byRid = new Map(survivors.map(s => [s.rid, s]))
  next.roster = next.roster
    .filter(r => byRid.has(r.rid))
    .map(r => {
      const s = byRid.get(r.rid) as BattleSurvivor
      return { ...r, type: s.type, traits: s.traits }
    })
  next.gold += gold
  next.inBattle = null
  if (next.nodeId) {
    const node = nodeById(next, next.nodeId)
    if (node) node.visited = true
    next.history.push({ nodeId: next.nodeId, outcome: victory ? 'win' : 'loss' })
  }
  return next
}

// ---------------------------------------------------------------------------
// Лавка / привал

export function addGold(run: RunState, n: number): RunState {
  const next = clone(run)
  next.gold = Math.max(0, next.gold + n)
  return next
}

export function buyCard(run: RunState, def: string, price: number): RunState {
  if (run.gold < price) throw new Error('не хватает золота')
  const next = clone(run)
  next.gold -= price
  next.deck.push({ def, upgraded: false })
  return next
}

export function buyRelic(run: RunState, relicId: string, price: number): RunState {
  if (run.gold < price) throw new Error('не хватает золота')
  if (run.relics.includes(relicId)) throw new Error('реликвия уже есть')
  const next = clone(run)
  next.gold -= price
  next.relics.push(relicId)
  return next
}

export function buyRecruit(run: RunState, type: string, price: number, name: string): RunState {
  if (run.gold < price) throw new Error('не хватает золота')
  const next = clone(run)
  next.gold -= price
  const rid = `r${next.roster.length}-${next.history.length}-${type}`
  next.roster.push({ rid, type, traits: [], name })
  return next
}

export function removeCard(run: RunState, index: number, price: number): RunState {
  if (run.gold < price) throw new Error('не хватает золота')
  if (index < 0 || index >= run.deck.length) throw new Error('нет такой карты')
  const next = clone(run)
  next.gold -= price
  next.deck.splice(index, 1)
  return next
}

export function upgradeCard(run: RunState, index: number): RunState {
  const card = run.deck[index]
  if (!card) throw new Error('нет такой карты')
  if (card.upgraded) throw new Error('уже улучшена')
  const next = clone(run)
  ;(next.deck[index] as { upgraded: boolean }).upgraded = true
  return next
}

/** Привал: добавить постоянную черту фигуре. */
export function trainPiece(run: RunState, rid: string, traitId: string): RunState {
  const next = clone(run)
  const piece = next.roster.find(r => r.rid === rid)
  if (!piece) throw new Error(`нет фигуры ${rid}`)
  if (!piece.traits.includes(traitId)) piece.traits.push(traitId)
  return next
}

/** Добавить карту бесплатно (награда). */
export function gainCard(run: RunState, def: string): RunState {
  const next = clone(run)
  next.deck.push({ def, upgraded: false })
  return next
}

export function gainRelic(run: RunState, relicId: string): RunState {
  if (run.relics.includes(relicId)) return clone(run)
  const next = clone(run)
  next.relics.push(relicId)
  return next
}
