import type { RngState } from '../engine/types'
import { rngInt, rngShuffle } from '../engine/rng'
import { allEncounters } from '../engine/registry'
import type { MapNode, NodeKind } from './runState'
import { EVENTS } from './events'

/**
 * Сид-генерация карты акта по рецепту Slay the Spire:
 * 13 рядов × 7 колонок, 5 путей снизу вверх со слияниями, без пересечений рёбер.
 * Ряд 0 = бой, 6 = сокровище, 11 = привал, 12 = босс; элитки не раньше ряда 4.
 */

export const MAP_ROWS = 13
export const MAP_COLS = 7
const PATHS = 5

const TIER_RANK: Record<string, number> = { apprentice: 0, journeyman: 1, master: 2 }

export function generateMap(rng: RngState, act: number): MapNode[] {
  const nodes = new Map<string, MapNode>()
  const id = (row: number, col: number): string => `n${row}-${col}`

  const ensure = (row: number, col: number): MapNode => {
    const key = id(row, col)
    let n = nodes.get(key)
    if (!n) {
      n = { id: key, row, col, kind: 'battle', edges: [], visited: false }
      nodes.set(key, n)
    }
    return n
  }

  // --- Пути: стартовые колонки без повторов.
  const startCols = rngShuffle(rng, [0, 1, 2, 3, 4, 5, 6]).slice(0, PATHS)
  let cols = startCols.slice()
  for (const c of cols) ensure(0, c)

  for (let row = 0; row < MAP_ROWS - 2; row++) {
    // Предложения следующих колонок.
    const proposals = cols.map(c => {
      const delta = rngInt(rng, 3) - 1
      return Math.max(0, Math.min(MAP_COLS - 1, c + delta))
    })
    // Анти-пересечение: сортируем предложения в порядке текущих колонок.
    const order = cols.map((c, i) => ({ c, i })).sort((a, b) => a.c - b.c || a.i - b.i)
    const sorted = proposals.slice().sort((a, b) => a - b)
    const nextCols = new Array<number>(cols.length)
    order.forEach((o, k) => { nextCols[o.i] = sorted[k] as number })

    for (let p = 0; p < cols.length; p++) {
      const from = ensure(row, cols[p] as number)
      const to = ensure(row + 1, nextCols[p] as number)
      if (!from.edges.includes(to.id)) from.edges.push(to.id)
    }
    cols = nextCols
  }

  // --- Босс: единственный узел последнего ряда, входы из всего ряда 11.
  const boss = ensure(MAP_ROWS - 1, 3)
  boss.kind = 'boss'
  for (const n of nodes.values()) {
    if (n.row === MAP_ROWS - 2 && !n.edges.includes(boss.id)) n.edges.push(boss.id)
  }

  // --- Виды узлов.
  for (const n of nodes.values()) {
    if (n.row === MAP_ROWS - 1) continue
    if (n.row === 0) { n.kind = 'battle'; continue }
    if (n.row === 6) { n.kind = 'treasure'; continue }
    if (n.row === MAP_ROWS - 2) { n.kind = 'rest'; continue }
    const roll = rngInt(rng, 100)
    let kind: NodeKind
    if (roll < 45) kind = 'battle'
    else if (roll < 67) kind = 'event'
    else if (roll < 79) kind = n.row >= 4 ? 'elite' : 'battle'
    else if (roll < 89) kind = 'shop'
    else kind = 'rest'
    n.kind = kind
  }

  // --- Гарантии: хотя бы одна лавка и одно событие.
  const list = [...nodes.values()].sort((a, b) => a.row - b.row || a.col - b.col)
  const middle = list.filter(n => n.row >= 2 && n.row <= 10)
  for (const need of ['shop', 'event'] as const) {
    if (!list.some(n => n.kind === need)) {
      const battles = middle.filter(n => n.kind === 'battle')
      if (battles.length > 0) {
        (battles[rngInt(rng, battles.length)] as MapNode).kind = need
      }
    }
  }

  // --- Энкаунтеры и события.
  const encounters = allEncounters()
  const normal = encounters.filter(e => !e.elite && !e.boss)
    .sort((a, b) => (TIER_RANK[a.aiTier] ?? 0) - (TIER_RANK[b.aiTier] ?? 0))
  const elites = encounters.filter(e => e.elite)
  const bosses = encounters.filter(e => e.boss)

  for (const n of list) {
    if (n.kind === 'battle') {
      // Чем выше ряд — тем жёстче тир.
      const maxRank = n.row < 4 ? 0 : n.row < 9 ? 1 : 2
      const pool = normal.filter(e => (TIER_RANK[e.aiTier] ?? 0) <= maxRank)
      const from = pool.length > 0 ? pool : normal
      n.encounterId = (from[rngInt(rng, from.length)] as { id: string }).id
    } else if (n.kind === 'elite' && elites.length > 0) {
      n.encounterId = (elites[rngInt(rng, elites.length)] as { id: string }).id
    } else if (n.kind === 'boss' && bosses.length > 0) {
      n.encounterId = (bosses[rngInt(rng, bosses.length)] as { id: string }).id
    } else if (n.kind === 'event' && EVENTS.length > 0) {
      n.eventId = (EVENTS[rngInt(rng, EVENTS.length)] as { id: string }).id
    }
  }

  void act // акт 2+ добавит свои пулы энкаунтеров
  return list
}

/** Достижим ли босс из каждого стартового узла (для тестов). */
export function bossReachableFromAllStarts(map: MapNode[]): boolean {
  const byId = new Map(map.map(n => [n.id, n]))
  const bossId = map.find(n => n.kind === 'boss')?.id
  if (!bossId) return false
  for (const start of map.filter(n => n.row === 0)) {
    const seen = new Set<string>()
    const stack = [start.id]
    let found = false
    while (stack.length > 0) {
      const cur = stack.pop() as string
      if (cur === bossId) { found = true; break }
      if (seen.has(cur)) continue
      seen.add(cur)
      for (const e of byId.get(cur)?.edges ?? []) stack.push(e)
    }
    if (!found) return false
  }
  return true
}
