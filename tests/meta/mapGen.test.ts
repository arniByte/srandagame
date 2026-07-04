import { describe, expect, it } from 'vitest'
import { loadContent } from '../../src/content'
import { seedFromString } from '../../src/engine/rng'
import { generateMap, bossReachableFromAllStarts, MAP_ROWS } from '../../src/meta/mapGen'

loadContent()

describe('генерация карты акта', () => {
  it('детерминизм: один сид → одна карта', () => {
    const a = generateMap(seedFromString('map-seed'), 1)
    const b = generateMap(seedFromString('map-seed'), 1)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('разные сиды → разные карты', () => {
    const a = generateMap(seedFromString('map-a'), 1)
    const b = generateMap(seedFromString('map-b'), 1)
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
  })

  it('инварианты структуры на 30 сидах', () => {
    for (let i = 0; i < 30; i++) {
      const map = generateMap(seedFromString(`inv-${i}`), 1)

      // Босс единственный, в последнем ряду, с энкаунтером boss.
      const bosses = map.filter(n => n.kind === 'boss')
      expect(bosses).toHaveLength(1)
      expect((bosses[0]!).row).toBe(MAP_ROWS - 1)
      expect((bosses[0]!).encounterId).toBeDefined()

      // Фиксированные ряды.
      for (const n of map) {
        if (n.row === 0) expect(n.kind).toBe('battle')
        if (n.row === 6) expect(n.kind).toBe('treasure')
        if (n.row === MAP_ROWS - 2) expect(n.kind).toBe('rest')
        // Элитки не раньше 4 ряда.
        if (n.kind === 'elite') expect(n.row).toBeGreaterThanOrEqual(4)
        // У всех боёв есть энкаунтер, у событий — событие.
        if (n.kind === 'battle' || n.kind === 'elite') expect(n.encounterId).toBeDefined()
        if (n.kind === 'event') expect(n.eventId).toBeDefined()
        // Рёбра только вверх на соседние колонки.
        for (const eid of n.edges) {
          const to = map.find(m => m.id === eid)!
          expect(to.row).toBe(n.row + 1)
          if (to.kind !== 'boss') expect(Math.abs(to.col - n.col)).toBeLessThanOrEqual(1)
        }
      }

      // Гарантии лавки и события.
      expect(map.some(n => n.kind === 'shop')).toBe(true)
      expect(map.some(n => n.kind === 'event')).toBe(true)

      // Босс достижим с любого старта.
      expect(bossReachableFromAllStarts(map)).toBe(true)

      // Нет пересечений рёбер между соседними рядами.
      for (let row = 0; row < MAP_ROWS - 1; row++) {
        const edges: [number, number][] = []
        for (const n of map.filter(m => m.row === row)) {
          for (const eid of n.edges) {
            const to = map.find(m => m.id === eid)!
            edges.push([n.col, to.col])
          }
        }
        for (const [a1, b1] of edges) {
          for (const [a2, b2] of edges) {
            // Пересечение: a1 < a2, но b1 > b2.
            expect(a1 < a2 && b1 > b2).toBe(false)
          }
        }
      }
    }
  })
})
